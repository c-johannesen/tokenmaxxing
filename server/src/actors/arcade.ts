/**
 * The social side of games, and the money: tables waiting for players (invited,
 * open to everyone, or both), who is playing what, side bets, and settling the
 * pot when a match ends. Coins move only through `town`'s ledger.
 */
import { GAMES, gameOf, parseOptions } from "@tokenmaxxing/core/games/index.ts";
import {
  effectiveSplit,
  MAX_SIDE_BET,
  MAX_STAKE,
  potShares,
  type SideBet,
  SPLITS,
  type Split,
  sideBetShares,
} from "@tokenmaxxing/core/games/payouts.ts";
import type { GameId, Options, Outcome } from "@tokenmaxxing/core/games/types.ts";
import type { Lobby, MatchInfo, TableView } from "@tokenmaxxing/core/games/wire.ts";
import type { Battle } from "@tokenmaxxing/core/protocol.ts";
import { actor, UserError } from "rivetkit";
import type { Client } from "rivetkit/client";
import { RateLimiter } from "../rate-limit.ts";
import type { registry } from "./registry.ts";
import {
  authenticate,
  type Caller,
  type ConnParams,
  INTERNAL_KEY,
  main,
  matchOf,
  requireInternal,
  requireMain,
  requireSyncer,
  requireUser,
  serial,
  type TokenCache,
  waitForTick,
} from "./shared.ts";

interface Invite {
  userId: number;
  expiresAt: number;
  /** "Yes, but for this stake." */
  counter: number | null;
}

interface Table {
  id: number;
  game: GameId;
  host: number;
  stake: number;
  seats: number;
  split: Split;
  open: boolean;
  options: Options;
  seated: number[];
  invited: Invite[];
  createdAt: number;
}

interface Live {
  id: number;
  game: GameId;
  players: number[];
  stake: number;
  split: Split;
  options: Options;
  startedAt: number;
  betsCloseAt: number;
  bets: SideBet[];
  outcome: Outcome | null;
  endedAt: number | null;
  /** Players who asked for double or nothing. */
  rematch: number[];
  /** What the town square hears when it ends. */
  line?: string;
  /** `world` has let the players go (retried until it has). */
  released?: boolean;
}

interface ArcadeState {
  nextId: number;
  tables: Record<string, Table>;
  matches: Record<string, Live>;
  /** Names of everyone at a table or in a match; refreshed when they sit down or are invited. */
  names: Record<string, string>;
}

const INVITE_MS = 2 * 60_000;
const TABLE_MS = 10 * 60_000;
const REMATCH_MS = 20_000;
/** Finished matches stay listed this long (the end screen, and the rematch offer). */
const KEEP_MS = 60_000;
/** Pots this big get a 💰 in the town square. */
const BIG_POT = 500;
/** Invites a host can send a minute (each one is a toast for someone). */
const INVITES_PER_MIN = 10;
/** A match still unfinished this long after it started is stuck: it's called off and refunded. */
const HOUR = 3_600_000;
const stuckAfter = (game: GameId) => (GAMES[game]?.holdPlayers === false ? 25 * HOUR : 30 * 60_000);
/** People one open or invite can name. */
const MAX_INVITEES = 12;
/** How often expired invites, stale tables and stuck or finished matches are swept. */
const SWEEP_MS = 1000;

const tableRef = (id: number) => `table:${id}`;
const betsRef = (id: number) => `bets:${id}`;

export const arcade = actor({
  onCreate: (c) => requireMain(c),
  state: { nextId: 1, tables: {}, matches: {}, names: {} } as ArcadeState,
  createVars: () => ({
    serial: serial(),
    tokens: new Map() as TokenCache,
    invites: new RateLimiter(INVITES_PER_MIN, 60_000),
  }),
  createConnState: (c, params: ConnParams): Promise<Caller> =>
    authenticate(params, c.client(), c.vars.tokens),
  run: async (c): Promise<void> => {
    const signal = c.abortSignal;
    const run = c.vars.serial;
    while (await waitForTick(signal, SWEEP_MS)) {
      // Caught, or one failed refund ends the loop for good: the next sweep tries again.
      await c
        .keepAwake(run(() => (signal.aborted ? Promise.resolve() : sweep(c, Date.now()))))
        .catch((err) => console.warn(`[arcade] sweep: ${String(err)}`));
    }
  },
  actions: {
    lobby: (c): Lobby => lobbyFor(c.state, requireUser(c.conn.state)),

    /** Opens a table: you take the first seat, and your invites go out. */
    open: (c, rawGame: unknown, raw: unknown): Promise<Lobby> =>
      c.vars.serial(async () => {
        const userId = requireUser(c.conn.state);
        const game = gameOf(rawGame);
        if (!game) throw new UserError("That game doesn't exist.", { code: "not_found" });
        const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
        const stake = parseStake(o.stake ?? 0);
        const seats = o.seats ?? game.players.max;
        if (
          !Number.isInteger(seats) ||
          (seats as number) < game.players.min ||
          (seats as number) > game.players.max
        )
          throw new UserError(`${game.name} is for ${game.players.min}–${game.players.max} players.`, {
            code: "invalid_seats",
          });
        const split = typeof o.split === "string" && o.split in SPLITS ? (o.split as Split) : "all";
        busy(c.state, userId);
        const id = c.state.nextId++;
        const table: Table = {
          id,
          game: game.id,
          host: userId,
          stake,
          seats: seats as number,
          split,
          open: o.open !== false,
          options: parseOptions(game, o.options),
          seated: [],
          invited: [],
          createdAt: Date.now(),
        };
        await seat(c, table, userId, table.stake);
        c.state.tables[id] = table;
        await addInvites(c, table, await resolve(c, o.invite));
        push(c);
        return lobbyFor(c.state, userId);
      }),

    invite: (c, tableId: unknown, userIds: unknown): Promise<void> =>
      c.vars.serial(async () => {
        const userId = requireUser(c.conn.state);
        const table = hostedTable(c.state, userId, tableId);
        await addInvites(c, table, await resolve(c, userIds));
        push(c);
      }),

    /** Yes, no, or "yes, but for this stake". */
    answer: (c, tableId: unknown, reply: unknown): Promise<void> =>
      c.vars.serial(async () => {
        const userId = requireUser(c.conn.state);
        const table = tableOf(c.state, tableId);
        const invite = table.invited.find((i) => i.userId === userId);
        if (!invite) throw new UserError("That invite is gone.", { code: "not_found" });
        const counter = (reply as { counter?: unknown } | null)?.counter;
        const client = c.client();
        // Saying no and countering both ping the host.
        if ((reply === false || counter !== undefined) && !c.vars.invites.take(String(userId), Date.now()))
          throw new UserError("Give it a minute.", { code: "rate_limited" });
        if (reply === false) {
          table.invited = table.invited.filter((i) => i !== invite);
          await tell(client, table.host, `${nameOf(c.state, userId)} said no to ${gameName(table)}.`);
        } else if (counter !== undefined) {
          invite.counter = parseStake(counter);
          await tell(
            client,
            table.host,
            `${nameOf(c.state, userId)} would play ${gameName(table)} for 🪙 ${counter} instead.`,
          );
        } else {
          busy(c.state, userId);
          if (table.seated.length >= table.seats)
            throw new UserError("That table just filled.", { code: "full" });
          await seat(c, table, userId, table.stake);
          table.invited = table.invited.filter((i) => i !== invite);
          await startIfFull(c, table);
        }
        push(c);
      }),

    /** The host takes a counter offer: the table is re-priced and they sit down. */
    takeCounter: (c, tableId: unknown, invitee: unknown): Promise<void> =>
      c.vars.serial(async () => {
        const userId = requireUser(c.conn.state);
        const table = hostedTable(c.state, userId, tableId);
        const invite = table.invited.find((i) => i.userId === invitee);
        if (!invite || invite.counter === null)
          throw new UserError("There's no counter offer.", { code: "not_found" });
        if (table.seated.length !== 1)
          throw new UserError("Someone else already sat down at the old stake.", { code: "taken" });
        busy(c.state, invite.userId);
        const town = main(c.client()).town;
        const ref = tableRef(table.id);
        const old = table.stake;
        await town.refund(ref, [userId]);
        try {
          await town.hold(ref, "stake", [
            { userId, amount: invite.counter },
            { userId: invite.userId, amount: invite.counter },
          ]);
        } catch (err) {
          await town.hold(ref, "stake", [{ userId, amount: old }]);
          throw err;
        }
        table.stake = invite.counter;
        table.seated.push(invite.userId);
        table.invited = table.invited.filter((i) => i !== invite);
        await startIfFull(c, table);
        push(c);
      }),

    /** Takes a free seat at an open table. */
    join: (c, tableId: unknown): Promise<void> =>
      c.vars.serial(async () => {
        const userId = requireUser(c.conn.state);
        const table = tableOf(c.state, tableId);
        const invited = table.invited.some((i) => i.userId === userId);
        if (!table.open && !invited) throw new UserError("That table is invite only.", { code: "private" });
        if (table.seated.includes(userId)) return;
        busy(c.state, userId);
        if (table.seated.length >= table.seats)
          throw new UserError("That table just filled.", { code: "full" });
        await seat(c, table, userId, table.stake);
        table.invited = table.invited.filter((i) => i.userId !== userId);
        await startIfFull(c, table);
        push(c);
      }),

    /** Gets up and takes your stake back. The host leaving closes the table. */
    leave: (c, tableId: unknown): Promise<void> =>
      c.vars.serial(async () => {
        const userId = requireUser(c.conn.state);
        const table = tableOf(c.state, tableId);
        if (!table.seated.includes(userId)) return;
        if (userId === table.host) await closeTable(c, table, `${nameOf(c.state, userId)} closed the table.`);
        else {
          await main(c.client()).town.refund(tableRef(table.id), [userId]);
          table.seated = table.seated.filter((id) => id !== userId);
        }
        push(c);
      }),

    start: (c, tableId: unknown): Promise<void> =>
      c.vars.serial(async () => {
        const userId = requireUser(c.conn.state);
        const table = hostedTable(c.state, userId, tableId);
        const min = GAMES[table.game]!.players.min;
        if (table.seated.length < min)
          throw new UserError(`${gameName(table)} needs at least ${min} players.`, { code: "too_few" });
        await startMatch(c, table);
        push(c);
      }),

    /** One side bet on one player of a match you're not in, while bets are open. */
    bet: (c, matchId: unknown, on: unknown, amount: unknown): Promise<void> =>
      c.vars.serial(async () => {
        const userId = requireUser(c.conn.state);
        const live = c.state.matches[String(matchId)];
        if (!live || live.outcome) throw new UserError("That game is over.", { code: "over" });
        if (Date.now() >= live.betsCloseAt) throw new UserError("Bets are closed.", { code: "closed" });
        if (live.players.includes(userId))
          throw new UserError("You can't bet on your own game.", { code: "own_game" });
        if (live.bets.some((b) => b.userId === userId))
          throw new UserError("You've already bet on this one.", { code: "already" });
        if (!live.players.includes(on as number))
          throw new UserError("They're not playing.", { code: "not_found" });
        if (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > MAX_SIDE_BET)
          throw new UserError(`A side bet is 1 to ${MAX_SIDE_BET} coins.`, { code: "invalid_bet" });
        await main(c.client()).town.hold(betsRef(live.id), "bet", [{ userId, amount: amount as number }]);
        live.bets.push({ userId, on: on as number, amount: amount as number });
        await matchOf(c.client(), live.id)
          .bets(betPools(live))
          .catch(() => {});
        push(c);
      }),

    /** Double or nothing after a 1v1: when both ask, the new game starts at once. */
    rematch: (c, matchId: unknown): Promise<void> =>
      c.vars.serial(async () => {
        const userId = requireUser(c.conn.state);
        const live = c.state.matches[String(matchId)];
        if (!live?.outcome || !live.endedAt || live.players.length !== 2 || !live.players.includes(userId))
          throw new UserError("There's no rematch to ask for.", { code: "not_found" });
        if (Date.now() > live.endedAt + REMATCH_MS)
          throw new UserError("The rematch offer ran out.", { code: "expired" });
        if (!live.rematch.includes(userId)) live.rematch.push(userId);
        const other = live.players.find((p) => p !== userId)!;
        const client = c.client();
        if (live.rematch.length < 2) {
          await tell(client, other, `${nameOf(c.state, userId)} wants double or nothing.`);
          push(c);
          return;
        }
        live.rematch = [];
        for (const p of live.players) busy(c.state, p);
        const id = c.state.nextId++;
        const table: Table = {
          id,
          game: live.game,
          host: live.players[0]!,
          stake: Math.min(MAX_STAKE, live.stake * 2),
          seats: 2,
          split: "all",
          open: false,
          options: live.options,
          seated: [],
          invited: [],
          createdAt: Date.now(),
        };
        try {
          await main(client).town.hold(
            tableRef(id),
            "stake",
            live.players.map((p) => ({ userId: p, amount: table.stake })),
          );
        } catch (err) {
          const why = err instanceof Error ? err.message : "Someone can't afford it.";
          for (const p of live.players) await tell(client, p, `No rematch: ${why}`);
          push(c);
          return;
        }
        table.seated = [...live.players];
        await startMatch(c, table);
        push(c);
      }),

    /** For the app after each sync: the battle (Tokenmaxxing) I'm in and where I stand, or null. */
    battle: (c): Promise<Battle | null> => {
      const userId = requireSyncer(c.conn.state);
      const live = usageMatch(c.state, userId);
      return live ? matchOf(c.client(), live.id).standing(userId) : Promise.resolve(null);
    },

    // MARK: From `player` and `match`

    /** A player synced: the usage game they're in pulls their new score. */
    usage: (c, userId: number): Promise<Battle | null> => {
      requireInternal(c.conn.state);
      const live = usageMatch(c.state, userId);
      return live ? matchOf(c.client(), live.id).usage(userId) : Promise.resolve(null);
    },

    finished: (c, matchId: number, outcome: Outcome): Promise<void> =>
      c.vars.serial(async () => {
        requireInternal(c.conn.state);
        const live = c.state.matches[String(matchId)];
        if (!live || live.outcome) return;
        await settle(c, live, outcome);
        push(c);
      }),
  },
});

// MARK: Helpers (plain functions over state, like `world`)

type ArcadeCtx = {
  state: ArcadeState;
  vars: { invites: RateLimiter };
  conns: Map<string, { state: unknown; send(name: string, ...args: unknown[]): void }>;
  client(): Client<typeof registry>;
};

/** The running usage game (Tokenmaxxing) a player is in. */
const usageMatch = (s: ArcadeState, userId: number) =>
  Object.values(s.matches).find((m) => !m.outcome && m.players.includes(userId) && GAMES[m.game]?.usage);

const nameOf = (s: ArcadeState, userId: number) => s.names[userId] ?? "Someone";
const gameName = (t: { game: GameId }) => GAMES[t.game]!.name;

function parseStake(raw: unknown): number {
  if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > MAX_STAKE)
    throw new UserError(`A stake is 0 to ${MAX_STAKE} coins.`, { code: "invalid_stake" });
  return raw as number;
}

function tableOf(s: ArcadeState, id: unknown): Table {
  const table = s.tables[String(id)];
  if (!table) throw new UserError("That table is gone.", { code: "not_found" });
  return table;
}

function hostedTable(s: ArcadeState, userId: number, id: unknown): Table {
  const table = tableOf(s, id);
  if (table.host !== userId) throw new UserError("Only the host can do that.", { code: "not_host" });
  return table;
}

/** One game at a time: not at another table, not in a match. */
function busy(s: ArcadeState, userId: number): void {
  if (Object.values(s.tables).some((t) => t.seated.includes(userId)))
    throw new UserError(`${nameOf(s, userId)} is already at a table.`, { code: "busy" });
  if (Object.values(s.matches).some((m) => !m.outcome && m.players.includes(userId)))
    throw new UserError(`${nameOf(s, userId)} is in a game.`, { code: "busy" });
}

/** Fresh names for people sitting down or being invited (so renames show up). */
async function learnNames(c: ArcadeCtx, userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  const names = await main(c.client()).town.names(userIds);
  for (const [id, name] of Object.entries(names)) c.state.names[id] = name;
}

/** People to invite, given as user ids or names. */
async function resolve(c: ArcadeCtx, raw: unknown): Promise<number[]> {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_INVITEES) : [];
  const ids = list.filter((x): x is number => Number.isInteger(x));
  const names = list.filter((x): x is string => typeof x === "string");
  if (names.length === 0) return ids;
  const found = await main(c.client()).town.ids(names);
  return [...ids, ...Object.values(found)];
}

/** Holds the stake and gives them a seat. */
async function seat(c: ArcadeCtx, table: Table, userId: number, stake: number): Promise<void> {
  await learnNames(c, [userId]);
  await main(c.client()).town.hold(tableRef(table.id), "stake", [{ userId, amount: stake }]);
  table.seated.push(userId);
}

/** Invites, each a toast for someone: at most `INVITES_PER_MIN` a minute per host, the rest are dropped. */
async function addInvites(c: ArcadeCtx, table: Table, userIds: number[]): Promise<void> {
  await learnNames(c, userIds);
  const now = Date.now();
  const client = c.client();
  for (const userId of userIds) {
    if (!(userId in c.state.names) || table.seated.includes(userId)) continue;
    if (table.invited.length + table.seated.length >= table.seats) break;
    if (!c.vars.invites.take(String(table.host), now)) {
      await tell(client, table.host, "That's a lot of invites: the rest didn't go out. Give it a minute.");
      break;
    }
    table.invited = [
      ...table.invited.filter((i) => i.userId !== userId),
      { userId, expiresAt: now + INVITE_MS, counter: null },
    ];
    await tell(
      client,
      userId,
      `${nameOf(c.state, table.host)} invites you to ${gameName(table)} · 🪙 ${table.stake}.`,
    );
  }
}

async function startIfFull(c: ArcadeCtx, table: Table): Promise<void> {
  if (table.seated.length >= table.seats) await startMatch(c, table);
}

async function startMatch(c: ArcadeCtx, table: Table): Promise<void> {
  const client = c.client();
  const game = GAMES[table.game]!;
  const players = table.seated.map((userId) => ({ userId, name: nameOf(c.state, userId) }));
  const split = effectiveSplit(table.split, players.length);
  await client.match.create([String(table.id)], {
    input: {
      id: table.id,
      game: table.game,
      players,
      stake: table.stake,
      split,
      options: table.options,
      seed: Math.floor(Math.random() * 2 ** 31),
      internal: INTERNAL_KEY,
    },
  });
  const info = await matchOf(client, table.id).info();
  delete c.state.tables[String(table.id)];
  c.state.matches[String(table.id)] = {
    id: table.id,
    game: table.game,
    players: table.seated,
    stake: table.stake,
    split,
    options: table.options,
    startedAt: info.startedAt,
    betsCloseAt: info.betsCloseAt,
    bets: [],
    outcome: null,
    endedAt: null,
    rematch: [],
  };
  await main(client)
    .world.gather(table.id, table.game, table.seated, game.holdPlayers !== false)
    .catch(() => {});
}

/**
 * Pays the pot by place and the side bets to the winners' backers, or refunds it all. Safe to run
 * again after a failure: a ref that's already paid out holds nothing, and stats are recorded once.
 */
async function settle(c: ArcadeCtx, live: Live, outcome: Outcome): Promise<void> {
  const client = c.client();
  const town = main(client).town;
  const pot = live.stake * live.players.length;
  const ref = tableRef(live.id);
  const winners = "places" in outcome ? (outcome.places[0] ?? []) : [];
  let line: string;
  if ("void" in outcome) {
    await town.refund(ref);
    await town.refund(betsRef(live.id));
    line = `${gameName(live)} was called off: everyone got their coins back.`;
  } else {
    const shares = potShares(outcome.places, pot, live.split);
    if ((await town.held(ref)) > 0)
      await town.pay(
        ref,
        "payout",
        [...shares].map(([userId, amount]) => ({ userId, amount })),
      );
    const side = sideBetShares(live.bets, winners);
    if ((await town.held(betsRef(live.id))) > 0)
      await town.pay(
        betsRef(live.id),
        side.refund ? "refund" : "winnings",
        [...side.shares].map(([userId, amount]) => ({ userId, amount })),
      );
    await town.recordMatch(
      live.id,
      live.game,
      live.stake,
      outcome.places.flatMap((group, i) =>
        group.map((userId) => ({ userId, place: i + 1, won: shares.get(userId) ?? 0 })),
      ),
    );
    const names = winners.map((id) => nameOf(c.state, id)).join(" & ");
    line = pot > 0 ? `${names} won 🪙 ${pot} at ${gameName(live)}!` : `${names} won ${gameName(live)}!`;
    if (pot >= BIG_POT) line = `💰 Big pot! ${line}`;
    for (const [userId, amount] of side.refund ? [] : side.shares)
      line += ` ${nameOf(c.state, userId)} won 🪙 ${amount} backing ${names}.`;
  }
  live.outcome = outcome;
  live.endedAt = Date.now();
  live.line = line;
  await release(c, live);
  for (const p of live.players) await tell(client, p, line);
}

/** Lets the players go in `world`; `sweep` retries it if `world` is down. */
async function release(c: ArcadeCtx, live: Live): Promise<void> {
  const winners = live.outcome && "places" in live.outcome ? (live.outcome.places[0] ?? []) : [];
  try {
    await main(c.client()).world.release(live.id, winners, live.line ?? "");
    live.released = true;
  } catch (err) {
    console.warn(`[arcade] releasing match ${live.id}: ${String(err)}`);
  }
}

async function closeTable(c: ArcadeCtx, table: Table, why: string): Promise<void> {
  const client = c.client();
  await main(client).town.refund(tableRef(table.id));
  delete c.state.tables[String(table.id)];
  for (const userId of [...table.seated, ...table.invited.map((i) => i.userId)])
    if (userId !== table.host) await tell(client, userId, why);
}

/** Once a second: invites and tables that ran out, and finished matches that can go. */
async function sweep(c: ArcadeCtx, now: number): Promise<void> {
  let changed = false;
  for (const table of Object.values(c.state.tables)) {
    const before = table.invited.length;
    table.invited = table.invited.filter((i) => i.expiresAt > now);
    if (table.invited.length !== before) changed = true;
    if (now - table.createdAt > TABLE_MS) {
      await closeTable(c, table, `${gameName(table)} didn't start in time: your stake is back.`);
      await tell(c.client(), table.host, `${gameName(table)} didn't start in time: your stake is back.`);
      changed = true;
    }
  }
  for (const live of Object.values(c.state.matches)) {
    if (!live.outcome && now - live.startedAt > stuckAfter(live.game)) {
      await settle(c, live, { void: `${gameName(live)} got stuck and was called off.` }).catch((err) =>
        console.warn(`[arcade] voiding match ${live.id}: ${String(err)}`),
      );
      changed = true;
    }
    if (live.outcome && !live.released) await release(c, live);
    if (live.endedAt && now - live.endedAt > KEEP_MS && live.released) {
      delete c.state.matches[String(live.id)];
      await matchOf(c.client(), live.id)
        .close()
        .catch(() => {}); // already gone
      changed = true;
    }
  }
  if (changed) {
    // Only names still in use are kept.
    const inUse = new Set([
      ...Object.values(c.state.tables).flatMap((t) => [...t.seated, ...t.invited.map((i) => i.userId)]),
      ...Object.values(c.state.matches).flatMap((m) => [...m.players, ...m.bets.map((b) => b.userId)]),
    ]);
    for (const id of Object.keys(c.state.names)) if (!inUse.has(Number(id))) delete c.state.names[id];
    push(c);
  }
}

const betPools = (live: Live): Record<number, number> => {
  const out: Record<number, number> = {};
  for (const b of live.bets) out[b.on] = (out[b.on] ?? 0) + b.amount;
  return out;
};

const tableView = (s: ArcadeState, t: Table): TableView => ({
  id: t.id,
  game: t.game,
  host: t.host,
  stake: t.stake,
  seats: t.seats,
  split: t.split,
  open: t.open,
  options: t.options,
  seated: t.seated.map((userId) => ({ userId, name: nameOf(s, userId) })),
  invited: t.invited.map((i) => ({ ...i, name: nameOf(s, i.userId) })),
  createdAt: t.createdAt,
});

const matchInfo = (s: ArcadeState, m: Live): MatchInfo => ({
  id: m.id,
  game: m.game,
  players: m.players.map((userId) => ({ userId, name: nameOf(s, userId) })),
  stake: m.stake,
  pot: m.stake * m.players.length,
  split: m.split,
  options: m.options,
  startedAt: m.startedAt,
  betsCloseAt: m.betsCloseAt,
  bets: betPools(m),
  outcome: m.outcome,
});

function lobbyFor(s: ArcadeState, userId: number): Lobby {
  const tables = Object.values(s.tables).filter(
    (t) => t.open || t.seated.includes(userId) || t.invited.some((i) => i.userId === userId),
  );
  const mine = Object.values(s.tables).find((t) => t.seated.includes(userId));
  // Your running game; else the one you just finished (its end screen and rematch offer).
  const mineAll = Object.values(s.matches).filter((m) => m.players.includes(userId));
  const playing =
    mineAll.find((m) => !m.outcome) ?? mineAll.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  const bets: Lobby["me"]["bets"] = {};
  for (const m of Object.values(s.matches)) {
    const b = m.bets.find((x) => x.userId === userId);
    if (b) bets[m.id] = { on: b.on, amount: b.amount };
  }
  return {
    tables: tables.map((t) => tableView(s, t)),
    matches: Object.values(s.matches).map((m) => matchInfo(s, m)),
    me: { table: mine?.id ?? null, match: playing?.id ?? null, bets },
  };
}

/** Everyone connected gets their own lobby: open tables plus the private ones that are theirs. */
function push(c: ArcadeCtx): void {
  for (const conn of c.conns.values()) {
    const caller = conn.state as Caller;
    if (caller.kind === "user") conn.send("lobby", lobbyFor(c.state, caller.userId));
  }
}

/** A toast for one player, through `world` (the tab they have open). */
const tell = (client: Client<typeof registry>, userId: number, text: string) =>
  main(client)
    .world.notify(userId, { text })
    .catch(() => {});
