/**
 * One game being played. It runs the game's rules (core/src/games), keeps its
 * timers, sends each viewer their own view, and tells `arcade` how it ended.
 */
import { gameOf } from "@tokenmaxxing/core/games/index.ts";
import type { Split } from "@tokenmaxxing/core/games/payouts.ts";
import { type GameId, isRefused, type Options, type Outcome } from "@tokenmaxxing/core/games/types.ts";
import type { Frame, MatchChatLine, MatchInfo, Seat } from "@tokenmaxxing/core/games/wire.ts";
import type { Battle } from "@tokenmaxxing/core/protocol.ts";
import { CHAT_HISTORY } from "@tokenmaxxing/core/world.ts";
import { actor, UserError } from "rivetkit";
import { RateLimiter } from "../rate-limit.ts";
import { parseChatText } from "../validate.ts";
import type { registry } from "./registry.ts";
import {
  authenticate,
  type Caller,
  type ConnParams,
  fromInside,
  internal,
  main,
  requireInternal,
  requireUser,
  type TokenCache,
  waitForTick,
} from "./shared.ts";

interface MatchInput {
  id: number;
  game: GameId;
  players: Seat[];
  stake: number;
  split: Split;
  options: Options;
  seed: number;
}

interface MatchState extends MatchInput {
  startedAt: number;
  betsCloseAt: number;
  state: unknown;
  outcome: Outcome | null;
  /** When each player was last connected; a held game forfeits whoever is gone too long. */
  seen: Record<number, number>;
  /** Side bets, as `arcade` last told us (for the frame). */
  bets: Record<number, number>;
  /** Players who left or lost their connection for too long. */
  forfeited: number[];
  /** `arcade` has settled it (retried until it has). */
  reported?: boolean;
  /** The match's own chat, newest last (missing on matches from before it had one). */
  chat?: MatchChatLine[];
}

/** Gone this long from a game that holds its players, and you forfeit. */
const AWAY_MS = 20_000;
/** A safety net: a held game still running after this is called off and refunded. */
const HELD_LIMIT_MS = 20 * 60_000;
const REPORT_RETRY_MS = 5_000;
const CHAT_PER_MIN = 20;

const defOf = (s: { game: GameId }) => gameOf(s.game)!;

export const match = actor({
  createState: (_c, raw: MatchInput & { internal: string }): MatchState => {
    const input = fromInside<MatchInput>(raw);
    const now = Date.now();
    const def = defOf(input);
    const state = def.setup(
      input.players.map((p) => p.userId),
      input.seed,
      input.options,
      now,
    );
    return {
      ...input,
      startedAt: now,
      betsCloseAt: def.betsCloseAt(state),
      state,
      outcome: null,
      seen: Object.fromEntries(input.players.map((p) => [p.userId, now])),
      bets: {},
      forfeited: [],
    };
  },
  createVars: () => ({ tokens: new Map() as TokenCache, chat: new RateLimiter(CHAT_PER_MIN, 60_000) }),
  createConnState: (c, params: ConnParams): Promise<Caller> =>
    authenticate(params, c.client(), c.vars.tokens),
  // Only a person watching changes what the frames show (the watcher count). Other actors' calls,
  // like each app's battle poll, connect too.
  onConnect: (c, conn): void => {
    if ((conn.state as Caller).kind === "user") pushFrames(c);
  },
  onDisconnect: (c, conn): void => {
    if ((conn.state as Caller).kind === "user") pushFrames(c);
  },
  run: async (c): Promise<void> => {
    const signal = c.abortSignal;
    const def = defOf(c.state);
    while (!signal.aborted && !c.state.reported) {
      // Look every turn, not only after a change: a restart between saving the final state and
      // finishing left a game over but never paid out, as nothing changed after it.
      const ended = c.state.outcome ? null : def.outcome(plain(c.state).state);
      if (ended) {
        await c.keepAwake(finish(c, ended));
        continue;
      }
      if (c.state.outcome) {
        await c.keepAwake(report(c));
        if (signal.aborted) return;
        if (!c.state.reported && !(await waitForTick(signal, REPORT_RETRY_MS))) return;
        continue;
      }
      if (!(await waitForTick(signal, def.tickMs ?? 1000))) return;
      const now = Date.now();
      const current = plain(c.state);
      let next = current.state;
      if (def.tick) next = def.tick(next, now);
      if (def.holdPlayers !== false) {
        const here = connectedPlayers(c);
        for (const p of current.players) {
          if (here.has(p.userId)) c.state.seen[p.userId] = now;
          else if (
            now - (c.state.seen[p.userId] ?? now) > AWAY_MS &&
            !c.state.forfeited.includes(p.userId) &&
            !def.outcome(next)
          ) {
            c.state.forfeited = [...c.state.forfeited, p.userId];
            next = def.forfeit(next, p.userId, now);
          }
        }
        if (now - c.state.startedAt > HELD_LIMIT_MS && !def.outcome(next)) {
          await c.keepAwake(finish(c, { void: "The game ran too long and was called off." }));
          continue;
        }
      }
      if (next !== current.state) await c.keepAwake(apply(c, next));
    }
  },
  actions: {
    /** Your frame, when opening the game. */
    frame: (c): Frame => {
      const s = plain(c.state);
      return frameFor(s, viewerOf(s, c.conn.state), watchersOf(c, s));
    },

    move: async (c, move: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      const s = plain(c.state);
      const player = requirePlayer(s, userId);
      if (s.outcome) throw new UserError("This game is over.", { code: "over" });
      const next = defOf(s).move(s.state, player, move, Date.now());
      if (isRefused(next)) throw new UserError(next.refused, { code: "refused" });
      if (next !== s.state) await apply(c, next);
    },

    /** Give up: you're placed last, and your stake stays in the pot. */
    forfeit: async (c): Promise<void> => {
      const userId = requireUser(c.conn.state);
      const s = plain(c.state);
      requirePlayer(s, userId);
      if (s.outcome || s.forfeited.includes(userId)) return;
      c.state.forfeited = [...s.forfeited, userId];
      await apply(c, defOf(s).forfeit(s.state, userId, Date.now()));
    },

    /** The match's chat so far, when opening the game. */
    chat: (c): MatchChatLine[] => {
      requireUser(c.conn.state);
      return c.state.chat ?? [];
    },

    /** A line in the match's chat: its players and everyone watching see it. */
    say: async (c, rawText: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      const text = parseChatText(rawText);
      if (!text) return;
      if (!c.vars.chat.take(String(userId), Date.now()))
        throw new UserError("Slow down a little.", { code: "rate_limited" });
      const name =
        c.state.players.find((p) => p.userId === userId)?.name ??
        (await main(c.client()).town.names([userId]))[userId] ??
        "?";
      // From a plain copy: spreading the live array would wrap the old lines in one more proxy each time.
      const chat = plain(c.state).chat ?? [];
      const line: MatchChatLine = { id: (chat.at(-1)?.id ?? 0) + 1, userId, name, text, at: Date.now() };
      c.state.chat = [...chat, line].slice(-CHAT_HISTORY);
      for (const conn of c.conns.values())
        if ((conn.state as Caller).kind === "user") conn.send("chat", line);
    },

    // MARK: From `arcade`

    /** Side bets so far, for the frame. */
    bets: (c, bets: Record<number, number>): void => {
      requireInternal(c.conn.state);
      c.state.bets = bets;
      pushFrames(c);
    },

    /** After a player syncs (usage games): pull their tokens in the window. Returns until when to keep syncing fast. */
    usage: async (c, userId: number): Promise<Battle | null> => {
      requireInternal(c.conn.state);
      const s = plain(c.state);
      const def = defOf(s);
      const window = def.usageWindow?.(s.state);
      if (!window || !def.usage || !standing(s, userId)) return null;
      const used = await c
        .client()
        .player.get([String(userId)], internal)
        .tokensBetween(window.from, window.to);
      // Another sync or tick may have updated the match while the player query was running.
      const current = plain(c.state);
      if (!standing(current, userId)) return null;
      const next = def.usage(current.state, userId, used, Date.now());
      if (next !== current.state) await apply(c, next);
      return standing(plain(c.state), userId);
    },

    /**
     * Where a player stands, from the last pull. For the app's poll: each sync already pulls (`usage`),
     * so this reads nothing, and a slow player database can't pile polls up here.
     */
    standing: (c, userId: number): Battle | null => {
      requireInternal(c.conn.state);
      return standing(plain(c.state), userId);
    },

    /** The arcade is done with it: the match and its state go. */
    close: (c): void => {
      requireInternal(c.conn.state);
      c.destroy();
    },

    info: (c): MatchInfo => {
      requireInternal(c.conn.state);
      return infoOf(plain(c.state));
    },
  },
});

type MatchCtx = {
  state: MatchState;
  conns: Map<string, { state: unknown; send(name: string, ...args: unknown[]): void }>;
  client(): import("rivetkit/client").Client<typeof registry>;
};

function standing(s: MatchState, userId: number): Battle | null {
  const def = defOf(s);
  const window = def.usageWindow?.(s.state);
  if (!def.usage || !window || s.outcome || !s.players.some((p) => p.userId === userId)) return null;
  const board = def.board?.(s.state, Date.now()) ?? [];
  const place = board.findIndex((r) => r.player === userId);
  return {
    name: def.name,
    place: place < 0 || !board[place]!.value ? null : place + 1,
    players: s.players.length,
    tokens: board[place]?.value ?? 0,
    endsAt: window.to,
    until: window.until,
  };
}

const viewerOf = (s: MatchState, caller: unknown): number | null => {
  const c = caller as Caller;
  return c.kind === "user" && s.players.some((p) => p.userId === c.userId) ? c.userId : null;
};

function requirePlayer(s: MatchState, userId: number): number {
  if (!s.players.some((p) => p.userId === userId))
    throw new UserError("You're watching this game, not playing it.", { code: "not_playing" });
  return userId;
}

function connectedPlayers(c: MatchCtx): Set<number> {
  const out = new Set<number>();
  for (const conn of c.conns.values()) {
    const s = conn.state as Caller;
    if (s.kind === "user") out.add(s.userId);
  }
  return out;
}

function watchersOf(c: MatchCtx, s: MatchState): number {
  const players = new Set(s.players.map((p) => p.userId));
  let n = 0;
  for (const conn of c.conns.values()) {
    const s = conn.state as Caller;
    if (s.kind === "user" && !players.has(s.userId)) n++;
  }
  return n;
}

const infoOf = (s: MatchState): MatchInfo => ({
  id: s.id,
  game: s.game,
  players: s.players,
  stake: s.stake,
  pot: s.stake * s.players.length,
  split: s.split,
  options: s.options,
  startedAt: s.startedAt,
  betsCloseAt: s.betsCloseAt,
  bets: s.bets,
  outcome: s.outcome,
});

const frameFor = (s: MatchState, you: number | null, watchers: number): Frame => ({
  info: infoOf(s),
  you,
  view: defOf(s).view(s.state, you, Date.now()),
  now: Date.now(),
  watchers,
});

/** Everyone connected gets their own view: players see their secrets, watchers don't. */
function pushFrames(c: MatchCtx): void {
  const viewers = [...c.conns.values()].filter((conn) => (conn.state as Caller).kind === "user");
  if (!viewers.length) return;
  const s = plain(c.state);
  const watchers = watchersOf(c, s);
  for (const conn of viewers) conn.send("frame", frameFor(s, viewerOf(s, conn.state), watchers));
}

/**
 * Game rules and views read plain JSON. RivetKit's change-tracking proxy also tracks array methods:
 * ranking, mapping and spreading live state can retain proxies in new state and multiply the work
 * on later updates. Only writes go through the live state; a no-op compares against its own snapshot.
 */
const plain = (s: MatchState): MatchState => JSON.parse(JSON.stringify(s));

async function apply(c: MatchCtx, next: unknown): Promise<void> {
  const def = defOf(c.state);
  const before = plain(c.state).state;
  c.state.state = next;
  const callouts = def.callouts?.(before, next) ?? [];
  const world = main(c.client()).world;
  for (const line of callouts) await world.callout(c.state.id, line.player, line.text).catch(() => {});
  pushFrames(c);
  await reportStatus(c);
  const out = def.outcome(next);
  if (out) await finish(c, out);
}

/** The live status over each player's head in the world, and the arena's scoreboard. */
async function reportStatus(c: MatchCtx): Promise<void> {
  const s = plain(c.state);
  const def = defOf(s);
  const now = Date.now();
  const status = Object.fromEntries(
    s.players.map((p) => [p.userId, def.status?.(s.state, p.userId, now) ?? null]),
  );
  await main(c.client())
    .world.gameStatus(s.id, {
      status,
      board: def.board?.(s.state, now) ?? null,
      watchers: watchersOf(c, s),
      headline: def.headline?.(s.state, now) ?? null,
      endsAt: def.endsAt?.(s.state) ?? null,
    })
    .catch(() => {});
}

async function finish(c: MatchCtx, outcome: Outcome): Promise<void> {
  if (c.state.outcome) return;
  c.state.outcome = outcome;
  pushFrames(c);
  await report(c);
}

/** Tells `arcade` how it ended, so it pays out. The run loop retries until it has. */
async function report(c: MatchCtx): Promise<void> {
  if (!c.state.outcome || c.state.reported) return;
  try {
    const s = plain(c.state);
    await main(c.client()).arcade.finished(s.id, s.outcome!);
    c.state.reported = true;
  } catch (err) {
    console.warn(`[match ${c.state.id}] reporting the outcome: ${String(err)}`);
  }
}
