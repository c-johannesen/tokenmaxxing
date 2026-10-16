import { BOTS, between, chase, isBot, lineFor, pick, toCoffee, wander } from "@tokenmaxxing/core/bots.ts";
import {
  findSpot,
  propTiles,
  type Seat,
  type Spot,
  seatsFor,
  spotSize,
} from "@tokenmaxxing/core/games/gather.ts";
import type { GameId } from "@tokenmaxxing/core/games/types.ts";
import { setOffice, setTown, TOWN_SPAWN } from "@tokenmaxxing/core/maps.ts";
import { OFFICE_LEVEL, type Placed, STARTER_OFFICE } from "@tokenmaxxing/core/shop.ts";
import {
  CHAT_HISTORY,
  type ChatLine,
  type CompanyInfo,
  companyOfRoom,
  cupsLeft,
  DIRS,
  drinkCoffee,
  type Facing,
  type GameStatus,
  type Houses,
  homeRoom,
  IDLE_MS,
  isFacing,
  JUMP_MS,
  type Moves,
  mapOf,
  mentionsIn,
  type Notice,
  ownerOfOffice,
  type Place,
  type PlayerInfo,
  type PlayerPos,
  type PlayerState,
  type PlayerView,
  portal,
  type RoomId,
  restSpot,
  roomEntry,
  type Snapshot,
  STEP_BURST,
  type StepResult,
  stepTarget,
  TICK_MS,
  takeStep,
  townSpawn,
  WORKING_MS,
  type WorldGame,
} from "@tokenmaxxing/core/world.ts";
import { actor, UserError } from "rivetkit";
import { db } from "rivetkit/db";
import { RateLimiter } from "../rate-limit.ts";
import { parseChatText } from "../validate.ts";
import {
  all,
  authenticate,
  type Caller,
  type ConnParams,
  main,
  requireInternal,
  requireMain,
  requireUser,
  type Sql,
  type TokenCache,
  waitForTick,
} from "./shared.ts";
import type { Office, PlayerCore } from "./town.ts";

interface WorldPlayer extends PlayerCore, Place {
  state: PlayerState;
  lastInputAt: number;
  lastAgentAt: number;
  liveAgents: number;
  /** Where they were when sent to bed or desk, so they come back there. */
  back?: (Place & { state: "idle" | "sit" }) | null;
  /** In a long game (Tokenmaxxing): their desk at the arena, which replaces their bed until it ends. */
  arena?: Seat | null;
  /** Optional: players from before coffee have had none. */
  coffeeUntil?: number;
  /** Online with no input for `IDLE_MS`; cleared by the next input. */
  dozing?: boolean;
}

interface WorldState {
  seeded: boolean;
  players: Record<string, WorldPlayer>;
  companies: Record<string, CompanyInfo>;
  /** Games on show in town. Optional: worlds from before games have none. */
  games?: Record<string, WorldGame>;
  /** Saved offices, by owner (optional, like games). No entry is a new one: `officeOf`. */
  offices?: Record<string, Office>;
}

type ConnState = Caller & { joined?: boolean };

const CHAT_KEEP = 200;
/** What a cup says, by how many are in your system. */
const COFFEE_LINES = [
  "☕ A fresh cup. You feel a little buzz.",
  "☕☕ Second cup. Your fingers tap on their own.",
  "☕☕☕ Third cup. You could refactor the whole monorepo right now.",
  "☕☕☕☕ Fourth cup. You can hear colours.",
  "☕☕☕☕☕ Fifth cup. Your heart is running at 10 Hz.",
  "☕☕☕☕☕☕ The machine refuses to make it any stronger. You vibrate anyway.",
];
const CHAT_PER_MIN = 20;
const REST_CHECK_EVERY = 10; // ticks
/** Bots take a step every this many ticks: a stroll. */
const BOT_STEP_EVERY = 3;
/** How long a bot stands around between walks, and after saying something. */
const BOT_PAUSE_MS: [number, number] = [2_000, 12_000];
const BOT_TALK_PAUSE_MS = 4_000;
/** The chance a bot done with a walk tags along after someone online in town instead (by default), and for how long. */
const BOT_FOLLOW_CHANCE = 0.3;
const BOT_FOLLOW_MS: [number, number] = [20_000, 60_000];
/** How soon a bot that starts following someone says something to them. */
const BOT_GREET_MS: [number, number] = [3_000, 10_000];
/** The chance a bot done with a walk goes for coffee instead, and how many cups it has there. */
const BOT_COFFEE_CHANCE = 0.15;
const BOT_CUPS: [number, number] = [1, 3];

/** A bot's plans, kept in memory: a restart just starts it on a new walk. */
interface BotRun {
  path: Facing[];
  restUntil: number;
  sayAt: number;
  /** Who it's tagging along after, until `followUntil`. */
  following: number | null;
  followUntil: number;
  /** On its way to coffee: how to face the machine when it gets there. */
  coffee: Facing | null;
  /** Cups in its system after coffee, until it's said something about it. */
  cups: number;
}

const view = (p: WorldPlayer, online: boolean): PlayerView => ({
  id: p.id,
  name: p.name,
  look: p.look,
  level: p.level,
  companyId: p.companyId,
  todayTokens: p.todayTokens,
  liveAgents: p.liveAgents,
  online: online || isBot(p.id),
  coffeeUntil: p.coffeeUntil ?? 0,
  dozing: online && !!p.dozing,
  x: p.x,
  y: p.y,
  facing: p.facing,
  state: p.state,
});

const info = (p: WorldPlayer, online: boolean): PlayerInfo => {
  const { x: _x, y: _y, facing: _f, state: _s, ...rest } = view(p, online);
  return rest;
};

const pos = (p: WorldPlayer): PlayerPos => [p.id, p.x, p.y, p.facing, p.state];

export const world = actor({
  createConnState: (c, params: ConnParams): Promise<ConnState> =>
    authenticate(params, c.client(), c.vars.tokens),
  state: { seeded: false, players: {}, companies: {} } as WorldState,
  createVars: () => ({
    /** Open game connections per player. */
    online: new Map<number, number>(),
    /** Players that moved or changed room since the last tick. */
    dirty: new Set<number>(),
    /** The room each player was last announced in. */
    announced: new Map<number, RoomId>(),
    steps: new Map<number, { budget: number; at: number }>(),
    /** When each player last jumped. */
    jumps: new Map<number, number>(),
    chat: new RateLimiter(CHAT_PER_MIN, 60_000),
    occupancy: "",
    /** The last `houses` sent to town, as JSON. */
    houses: "",
    tokens: new Map() as TokenCache,
    bots: new Map<number, BotRun>(),
  }),
  db: db({
    onMigrate: async (d) => {
      await d.execute(`CREATE TABLE IF NOT EXISTS chat (
        id INTEGER PRIMARY KEY, room TEXT NOT NULL, user_id INTEGER NOT NULL,
        name TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)`);
      await d.execute("CREATE INDEX IF NOT EXISTS chat_room ON chat (room, id)");
      // Bots used to talk in the chat; they only talk over their heads now.
      await d.execute("DELETE FROM chat WHERE user_id < 0");
    },
  }),
  onCreate: (c) => requireMain(c),
  onWake: async (c) => {
    // First start (or a wiped world): load everyone from `town` and put them to bed.
    if (!c.state.seeded) {
      const seed = await main(c.client()).town.seed();
      for (const co of seed.companies) c.state.companies[co.id] = co;
      for (const p of seed.players) upsert(c.state, p, Date.now());
      c.state.offices = seed.offices;
      c.state.seeded = true;
    }
    placeBots(c.state);
    buildTown(c.state);
    for (const [id, o] of Object.entries(c.state.offices ?? {})) setOffice(Number(id), o.furniture);
  },
  onDisconnect: (c, conn) => {
    const s = conn.state as ConnState;
    if (s.kind !== "user" || !s.joined) return;
    const left = (c.vars.online.get(s.userId) ?? 1) - 1;
    if (left > 0) return void c.vars.online.set(s.userId, left);
    c.vars.online.delete(s.userId);
    const p = c.state.players[s.userId];
    if (!p) return;
    // At a game table they stay put: the match decides what happens if they don't come back.
    if (p.state !== "playing") rest(c.state, p, Date.now() - p.lastAgentAt < WORKING_MS ? "working" : "away");
    c.vars.dirty.add(p.id);
    c.broadcast("info", info(p, false));
  },
  run: async (c) => {
    const signal = c.abortSignal;
    let n = 0;
    while (await waitForTick(signal, TICK_MS)) {
      const now = Date.now();
      if (++n % REST_CHECK_EVERY === 0)
        for (const p of settle(c.state, c.vars, now)) c.broadcast("info", info(p, true));
      if (n % BOT_STEP_EVERY === 0) {
        for (const p of walkBots(c.state, c.vars, now)) c.broadcast("info", info(p, true));
        talkBots(c, now);
      }
      flush(c);
    }
  },
  actions: {
    /** Called once per game connection: wakes you up and returns your room. */
    join: async (c): Promise<Snapshot> => {
      const userId = requireUser(c.conn.state);
      const p = c.state.players[userId];
      if (!p) throw new UserError("Unknown player.", { code: "not_found" });
      (c.conn.state as ConnState).joined = true;
      c.vars.online.set(userId, (c.vars.online.get(userId) ?? 0) + 1);
      p.lastInputAt = Date.now();
      p.dozing = false;
      if (wake(c.state, p)) c.vars.dirty.add(p.id);
      c.broadcast("info", info(p, true));
      return snapshot(c.state, c.vars.online, p, chatOf(c.db, p.room));
    },

    step: (c, rawDir: unknown): StepResult => {
      const userId = requireUser(c.conn.state);
      const p = c.state.players[userId];
      if (!p || !isFacing(rawDir)) return null;
      const now = Date.now();
      touch(c, p, now);
      // At a game table: the arrow keys do nothing until the game ends.
      if (p.state === "playing") return correction(p);
      // Back from being away: the first key press returns them to where they were.
      if (wake(c.state, p)) {
        c.vars.dirty.add(p.id);
        return correction(p);
      }
      const s = c.vars.steps.get(userId) ?? { budget: STEP_BURST, at: 0 };
      const budget = takeStep(s.budget, s.at, now);
      if (budget === null) return correction(p);
      c.vars.steps.set(userId, { budget, at: now });

      const wasSeated = p.state !== "idle";
      p.facing = rawDir;
      p.state = "idle";
      c.vars.dirty.add(p.id);
      const target = stepTarget(mapOf(p.room), p.x, p.y, rawDir);
      if (target.kind === "move" && p.room === "town" && onProp(c.state, target.x, target.y))
        return correction(p);
      if (target.kind === "move") {
        p.x = target.x;
        p.y = target.y;
        return null;
      }
      if (target.kind === "blocked") return wasSeated ? correction(p) : null;
      if (target.ch === "R" && p.level < OFFICE_LEVEL)
        return { notice: `🔒 Your own office opens at level ${OFFICE_LEVEL}.` };
      const dest = portal(p.room, target, p.companyId, plots(c.state), p.id);
      if ("notice" in dest) return { notice: dest.notice };
      Object.assign(p, dest);
      return correction(p);
    },

    /** Space: a hop, shown to everyone in the room. Only on your feet, and one at a time. */
    jump: (c): void => {
      const userId = requireUser(c.conn.state);
      const p = c.state.players[userId];
      const now = Date.now();
      if (p?.state !== "idle" || now - (c.vars.jumps.get(userId) ?? 0) < JUMP_MS) return;
      c.vars.jumps.set(userId, now);
      touch(c, p, now);
      sendToRoom(c, p.room, "jump", userId);
    },

    /** E while facing a free seat: sits you on it (beds lie you down). */
    sit: (c, facing: unknown): StepResult => {
      const userId = requireUser(c.conn.state);
      const p = c.state.players[userId];
      if (!p || p.state === "playing") return null;
      touch(c, p, Date.now());
      if (isFacing(facing)) p.facing = facing;
      const [dx, dy] = DIRS[p.facing];
      const x = p.x + dx;
      const y = p.y + dy;
      const seat = mapOf(p.room).kind(x, y).seat;
      const taken = Object.values(c.state.players).some((o) => o.room === p.room && o.x === x && o.y === y);
      if (!seat) return null;
      if (taken) return { notice: "Someone's already there." };
      Object.assign(p, { x, y, state: "sit", facing: seat === "chair" ? "up" : "down" });
      c.vars.dirty.add(p.id);
      return correction(p);
    },

    /** E while facing a coffee machine: one more cup, and everyone sees you shake. */
    drink: (c, facing: unknown): StepResult => {
      const userId = requireUser(c.conn.state);
      const p = c.state.players[userId];
      if (!p || p.state === "playing") return null;
      const now = Date.now();
      touch(c, p, now);
      if (isFacing(facing)) p.facing = facing;
      const [dx, dy] = DIRS[p.facing];
      if (mapOf(p.room).at(p.x + dx, p.y + dy) !== "o") return null;
      p.coffeeUntil = drinkCoffee(p.coffeeUntil ?? 0, now);
      c.broadcast("info", info(p, c.vars.online.has(p.id)));
      const cups = Math.round(cupsLeft(p.coffeeUntil, now));
      return { notice: COFFEE_LINES[Math.min(cups, COFFEE_LINES.length) - 1]! };
    },

    say: async (c, rawText: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      const p = c.state.players[userId];
      const text = parseChatText(rawText);
      if (!p || !text) return;
      if (!c.vars.chat.take(String(userId), Date.now()))
        throw new UserError("Slow down a little.", { code: "rate_limited" });
      touch(c, p, Date.now());
      const at = Date.now();
      const [row] = await all<{ id: number }>(
        c.db,
        "INSERT INTO chat (room, user_id, name, text, at) VALUES (?, ?, ?, ?, ?) RETURNING id",
        p.room,
        userId,
        p.name,
        text,
        at,
      );
      await c.db.execute("DELETE FROM chat WHERE room = ? AND id <= ?", p.room, row!.id - CHAT_KEEP);
      const line: ChatLine = { id: row!.id, room: p.room, userId, name: p.name, text, at };
      sendToRoom(c, p.room, "chat", line);
      // People mentioned elsewhere hear about it; those in the room already see the line.
      const named = new Set(mentionsIn(text));
      if (named.size === 0) return;
      for (const conn of c.conns.values()) {
        const s = conn.state as ConnState;
        if (s.kind !== "user" || !s.joined || s.userId === userId) continue;
        const other = c.state.players[s.userId];
        if (other && other.room !== p.room && named.has(other.name)) conn.send("mention", line);
      }
    },

    /**
     * From a player card: into their office, if they have one and it's open (your own always is).
     * It bypasses their building's door on purpose: its exit leads into your own building.
     */
    visit: (c, targetId: unknown): StepResult => {
      const userId = requireUser(c.conn.state);
      const p = c.state.players[userId];
      const owner = typeof targetId === "number" ? c.state.players[targetId] : undefined;
      if (!p || p.state === "playing") return null;
      if (!owner || owner.level < OFFICE_LEVEL || owner.companyId === null)
        return { notice: "They don't have an office yet." };
      if (owner.id !== userId && !officeOf(c.state, owner.id).open)
        return { notice: `🔒 ${owner.name}'s office is closed.` };
      touch(c, p, Date.now());
      Object.assign(p, roomEntry(`office:${owner.id}`), { state: "idle" });
      c.vars.dirty.add(p.id);
      return correction(p);
    },

    /** After a game: back to where you were before it. */
    back: (c): StepResult => {
      const userId = requireUser(c.conn.state);
      const p = c.state.players[userId];
      if (!p || p.state === "playing" || !p.back) return null;
      Object.assign(p, p.back, { state: "idle" });
      p.back = null;
      c.vars.dirty.add(p.id);
      return correction(p);
    },

    // MARK: Games (from `arcade` and `match`)

    /**
     * A match starts: its players gather in the town square. At a table, they're moved
     * there and held until it ends. In an arena (long games), their desk becomes their
     * rest spot: resting players sit down there, and online ones keep walking around.
     */
    gather: (c, id: number, game: GameId, players: number[], hold: boolean): void => {
      requireInternal(c.conn.state);
      c.state.games ??= {};
      const games = c.state.games;
      const kind = hold ? "table" : "arena";
      const { w, h } = spotSize(kind, players.length);
      const host = c.state.players[players[0]!];
      const from: [number, number] = host?.room === "town" ? [host.x, host.y] : TOWN_SPAWN;
      const map = mapOf("town");
      const others = Object.values(games).map((g) => g.spot);
      const at = findSpot(map, from, w, h, others) ?? findSpot(map, TOWN_SPAWN, w, h, others);
      if (!at) return;
      const spot: Spot = { ...at, w, h, kind };
      const seats = seatsFor(spot, players.length);
      games[id] = {
        id,
        game,
        spot,
        players,
        seats,
        status: {},
        board: null,
        watchers: 0,
        headline: null,
        endsAt: null,
      };
      for (const [i, userId] of players.entries()) {
        const p = c.state.players[userId];
        if (!p) continue;
        const seat = seats[i]!;
        if (hold) {
          // Remember where they were, like resting does, so Back takes them there after.
          // Resting players keep the spot they had before resting, or at least their bed.
          if (p.state === "idle" || p.state === "sit")
            p.back = { room: p.room, x: p.x, y: p.y, facing: p.facing, state: p.state };
          else p.back ??= { room: p.room, x: p.x, y: p.y, facing: p.facing, state: "idle" };
          Object.assign(p, { room: "town", x: seat.x, y: seat.y, facing: seat.facing, state: "playing" });
        } else {
          p.arena = seat;
          if (p.state === "away" || p.state === "working") rest(c.state, p, "working");
        }
        c.vars.dirty.add(p.id);
      }
      sendToRoom(c, "town", "game", games[id]);
    },

    /** A match ended: the table goes, the players are free, the town hears who won. */
    release: async (c, id: number, winners: number[], line: string): Promise<void> => {
      requireInternal(c.conn.state);
      const g = c.state.games?.[id];
      if (!g) return;
      delete c.state.games![id];
      const now = Date.now();
      for (const userId of g.players) {
        const p = c.state.players[userId];
        if (!p) continue;
        p.arena = null;
        if (p.state === "playing") p.state = "idle";
        // Offline, or resting at the arena: back to their own bed or desk, keeping where they were.
        if (!c.vars.online.has(p.id) || p.state === "away" || p.state === "working") {
          const before = p.back;
          rest(c.state, p, now - p.lastAgentAt < WORKING_MS ? "working" : "away");
          if (before) p.back = before;
        }
        c.vars.dirty.add(p.id);
      }
      sendToRoom(c, "town", "gameOver", { id, winners });
      if (line) await announce(c, "town", line);
    },

    /** Something happened in a game, said out loud: a bubble over the player (or the table). */
    callout: (c, id: number, player: number | null, text: string): void => {
      requireInternal(c.conn.state);
      if (c.state.games?.[id]) sendToRoom(c, "town", "callout", { id, userId: player, text });
    },

    /** The live status over each player's head, the scoreboard, and how many are watching. */
    gameStatus: (c, id: number, update: GameStatus): void => {
      requireInternal(c.conn.state);
      const g = c.state.games?.[id];
      if (!g) return;
      Object.assign(g, update);
      sendToRoom(c, "town", "game", g);
    },

    setPlayer: (c, core: PlayerCore): void => {
      requireInternal(c.conn.state);
      const before = c.state.players[core.id]?.companyId;
      const p = upsert(c.state, core, Date.now());
      const online = c.vars.online.has(p.id);
      if (before !== undefined && before !== p.companyId) {
        // Changed company: out of the old house (and out of any office with no company at all),
        // and resting players move to the new one.
        if (!online) rest(c.state, p, p.state === "working" ? "working" : "away");
        else if (
          (p.room.startsWith("hq:") && p.room !== `hq:${p.companyId}`) ||
          (p.companyId === null && ownerOfOffice(p.room) !== null)
        )
          Object.assign(p, townSpawn());
        c.vars.dirty.add(p.id);
      }
      c.broadcast("info", info(p, online));
    },

    /** From `town`, when an admin deletes an account: out of the world, and their tabs closed. */
    removePlayer: (c, userId: number): void => {
      requireInternal(c.conn.state);
      const p = c.state.players[userId];
      if (!p) return;
      sendToRoom(c, p.room, "moves", { room: p.room, join: [], m: [], leave: [userId] } satisfies Moves);
      delete c.state.players[userId];
      for (const vars of [c.vars.online, c.vars.announced, c.vars.steps, c.vars.jumps]) vars.delete(userId);
      c.vars.dirty.delete(userId);
      for (const conn of c.conns.values()) {
        const s = conn.state as ConnState;
        if (s.kind === "user" && s.userId === userId) void conn.disconnect("deleted");
      }
    },

    setCompany: (c, company: CompanyInfo): void => {
      requireInternal(c.conn.state);
      c.state.companies[company.id] = company;
      buildTown(c.state, c.vars.dirty);
      c.broadcast("companies", Object.values(c.state.companies));
    },

    removeCompany: (c, id: number): void => {
      requireInternal(c.conn.state);
      delete c.state.companies[id];
      buildTown(c.state, c.vars.dirty);
      c.broadcast("companies", Object.values(c.state.companies));
    },

    /** From `town`: an office saved, opened or closed. Whoever is inside sees it; closing throws nobody out. */
    setOffice: async (c, userId: number, furniture: Placed[], open: boolean): Promise<void> => {
      requireInternal(c.conn.state);
      c.state.offices ??= {};
      c.state.offices[userId] = { furniture, open };
      setOffice(userId, furniture);
      for (const p of Object.values(c.state.players))
        if (p.room === `office:${userId}`) await sendSnapshot(c, p);
    },

    /** From `town`: a line for one player's open tabs (a company application, a trade, an answer). */
    notify: (c, userId: number, notice: Notice): void => {
      requireInternal(c.conn.state);
      for (const conn of c.conns.values()) {
        const s = conn.state as ConnState;
        if (s.kind === "user" && s.joined && s.userId === userId) conn.send("notice", notice);
      }
    },

    /** From `player` after an ingest: offline players work at their desk while agents run. */
    activity: (c, userId: number, lastAt: number, liveAgents: number): void => {
      requireInternal(c.conn.state);
      const p = c.state.players[userId];
      if (!p) return;
      p.lastAgentAt = Math.max(p.lastAgentAt, lastAt);
      p.liveAgents = liveAgents;
      const online = c.vars.online.has(userId);
      if (!online) {
        const want = Date.now() - p.lastAgentAt < WORKING_MS ? "working" : "away";
        if (p.state !== want) {
          rest(c.state, p, want);
          c.vars.dirty.add(p.id);
        }
      }
      c.broadcast("info", info(p, online));
    },
  },
});

// MARK: Helpers (plain functions over state, so the tick and the actions share them)

type Vars = {
  online: Map<number, number>;
  dirty: Set<number>;
  announced: Map<number, RoomId>;
  occupancy: string;
  houses: string;
};

function upsert(s: WorldState, core: PlayerCore, now: number): WorldPlayer {
  const existing = s.players[core.id];
  if (existing) return Object.assign(existing, core);
  const p: WorldPlayer = {
    ...core,
    ...townSpawn(),
    state: "idle",
    lastInputAt: now,
    lastAgentAt: 0,
    liveAgents: 0,
  };
  s.players[core.id] = p;
  rest(s, p, "away");
  p.back = null; // Nowhere to go back to: a new player wakes up at home.
  return p;
}

function plots(s: WorldState): Map<number, { id: number; name: string }> {
  const out = new Map<number, { id: number; name: string }>();
  for (const co of Object.values(s.companies)) out.set(co.plot, co);
  return out;
}

/**
 * Rebuilds the town for its companies. Anyone now standing inside a new house, or past the edge of a
 * town that shrank, goes back to the square.
 */
function buildTown(s: WorldState, dirty?: Set<number>): void {
  const town = setTown([...plots(s).keys()]);
  for (const p of Object.values(s.players)) {
    const where = p.state === "away" || p.state === "working" ? p.back : p;
    const tile = where?.room === "town" && !p.arena ? town.kind(where.x, where.y) : null;
    if (!tile || tile.walk || tile.seat) continue;
    Object.assign(where!, townSpawn());
    dirty?.add(p.id);
  }
}

/** Sends `p` to their bed (`away`) or desk (`working`) at home, remembering where they were. */
function rest(s: WorldState, p: WorldPlayer, state: "away" | "working"): void {
  if (p.state === "idle" || p.state === "sit")
    p.back = { room: p.room, x: p.x, y: p.y, facing: p.facing, state: p.state };
  // In a battle, they rest at their arena desk, typing away.
  if (p.arena) {
    Object.assign(p, { room: "town", x: p.arena.x, y: p.arena.y, facing: p.arena.facing, state: "working" });
    return;
  }
  const room = homeRoom(p.companyId);
  const taken = new Set(
    Object.values(s.players)
      .filter((o) => o.id !== p.id && o.room === room)
      .map((o) => `${o.x},${o.y}`),
  );
  Object.assign(p, restSpot(room, state, taken), { state });
}

/**
 * Gets up a resting player: back where they were before resting, if they can
 * still be there (not a house they've left), else up where they lie. False if
 * they weren't resting.
 */
function wake(s: WorldState, p: WorldPlayer): boolean {
  if (p.state !== "away" && p.state !== "working") return false;
  const back = p.back;
  p.back = null;
  const house = back ? companyOfRoom(back.room) : null;
  const canGo = back && (house === null || house === p.companyId);
  if (!canGo) {
    p.state = "idle";
    return true;
  }
  // Someone took their seat meanwhile: stand up there instead.
  const taken = Object.values(s.players).some(
    (o) => o.id !== p.id && o.room === back.room && o.x === back.x && o.y === back.y,
  );
  Object.assign(p, back, { state: back.state === "sit" && !taken ? "sit" : "idle" });
  return true;
}

/** Input from `p`: wakes them if they were dozing. */
function touch(c: { broadcast(name: string, ...args: unknown[]): void }, p: WorldPlayer, now: number): void {
  p.lastInputAt = now;
  if (!p.dozing) return;
  p.dozing = false;
  c.broadcast("info", info(p, true));
}

/**
 * Idle players doze where they are (a second screen still shows the town); offline ones switch
 * between desk and bed as their agents start and stop. Returns who just dozed off.
 */
function settle(s: WorldState, v: Vars, now: number): WorldPlayer[] {
  const dozed: WorldPlayer[] = [];
  for (const p of Object.values(s.players)) {
    if (p.state === "playing" || isBot(p.id)) continue;
    if (v.online.has(p.id)) {
      if (!p.dozing && now - p.lastInputAt > IDLE_MS) {
        p.dozing = true;
        dozed.push(p);
      }
      continue;
    }
    const want = p.arena || now - p.lastAgentAt < WORKING_MS ? "working" : "away";
    if (p.state !== want) {
      rest(s, p, want);
      v.dirty.add(p.id);
    }
  }
  return dozed;
}

/** A table or desk of a game in town: nobody walks onto it. */
const onProp = (s: WorldState, x: number, y: number) =>
  Object.values(s.games ?? {}).some((g) => propTiles(g.spot).some(([px, py]) => px === x && py === y));

/** A line in a room's chat from the town itself (a game's result). */
async function announce(
  c: Sender & { db: Sql },
  room: RoomId,
  text: string,
  userId = 0,
  name = "🎮",
): Promise<void> {
  const at = Date.now();
  const [row] = await all<{ id: number }>(
    c.db,
    "INSERT INTO chat (room, user_id, name, text, at) VALUES (?, ?, ?, ?, ?) RETURNING id",
    room,
    userId,
    name,
    text,
    at,
  );
  await c.db.execute("DELETE FROM chat WHERE room = ? AND id <= ?", room, row!.id - CHAT_KEEP);
  sendToRoom(c, room, "chat", { id: row!.id, room, userId, name, text, at } satisfies ChatLine);
}

// MARK: Bots (core/src/bots.ts)

/** Puts every bot in the square on wake, and drops bots no longer in `BOTS`. */
function placeBots(s: WorldState): void {
  for (const p of Object.values(s.players))
    if (isBot(p.id) && !BOTS.some((b) => b.id === p.id)) delete s.players[p.id];
  for (const b of BOTS)
    s.players[b.id] = {
      id: b.id,
      name: b.name,
      look: b.look,
      level: b.level,
      companyId: null,
      todayTokens: 0,
      ...townSpawn(),
      state: "idle",
      lastInputAt: 0,
      lastAgentAt: 0,
      liveAgents: 0,
    };
}

const runOf = (
  v: { bots: Map<number, BotRun> },
  id: number,
  every: [number, number],
  now: number,
): BotRun => {
  const run = v.bots.get(id) ?? {
    path: [],
    restUntil: now + between(BOT_PAUSE_MS),
    sayAt: now + between(every),
    following: null,
    followUntil: 0,
    coffee: null,
    cups: 0,
  };
  v.bots.set(id, run);
  return run;
};

/**
 * One step for each bot on a walk, following someone, or on its way to coffee; something new to do for
 * each that has stood around long enough. Returns the bots that just had coffee (they shake).
 */
function walkBots(s: WorldState, v: Vars & { bots: Map<number, BotRun> }, now: number): WorldPlayer[] {
  const map = mapOf("town");
  const inTown = [...v.online.keys()].filter((id) => s.players[id]?.room === "town");
  const drank: WorldPlayer[] = [];
  for (const b of BOTS) {
    const p = s.players[b.id];
    const run = runOf(v, b.id, b.every, now);
    if (p?.room !== "town" || now < run.restUntil) continue;
    // Following someone: until they leave town or go offline, or it gets boring.
    if (run.following !== null && (now > run.followUntil || !inTown.includes(run.following))) {
      run.following = null;
      run.restUntil = now + between(BOT_PAUSE_MS);
      continue;
    }
    if (run.following === null && run.path.length === 0) {
      // At the coffee machine.
      if (run.coffee) {
        p.facing = run.coffee;
        run.coffee = null;
        for (let i = Math.round(between(BOT_CUPS)); i > 0; i--)
          p.coffeeUntil = drinkCoffee(p.coffeeUntil ?? 0, now);
        run.cups = Math.round(cupsLeft(p.coffeeUntil ?? 0, now));
        run.sayAt = Math.min(run.sayAt, now);
        run.restUntil = now + between(BOT_PAUSE_MS);
        v.dirty.add(p.id);
        drank.push(p);
        continue;
      }
      const roll = Math.random();
      const follow = b.followChance ?? BOT_FOLLOW_CHANCE;
      if (inTown.length > 0 && roll < follow) {
        run.following = pick(inTown);
        run.followUntil = now + between(BOT_FOLLOW_MS);
        run.sayAt = Math.min(run.sayAt, now + between(BOT_GREET_MS));
      } else if (roll < follow + BOT_COFFEE_CHANCE) {
        const trip = toCoffee(map, p.x, p.y);
        run.path = trip?.path ?? [];
        run.coffee = trip?.facing ?? null;
      } else run.path = wander(map, p.x, p.y) ?? [];
    }
    const leader = run.following === null ? null : s.players[run.following]!;
    // Right next to who it follows, it waits for them to move.
    const dir = leader ? chase(map, p.x, p.y, leader.x, leader.y) : run.path.shift();
    if (!dir) continue;
    const target = stepTarget(map, p.x, p.y, dir);
    p.facing = dir;
    // The town changed under it, or a game table went up: give up on this walk.
    if (target.kind === "move" && !onProp(s, target.x, target.y))
      Object.assign(p, { x: target.x, y: target.y });
    else Object.assign(run, { path: [], coffee: null });
    if (!leader && run.path.length === 0 && !run.coffee) run.restUntil = now + between(BOT_PAUSE_MS);
    v.dirty.add(p.id);
  }
  return drank;
}

/** Bots due a line say one over their heads (never in the chat), if anyone online is in the room to hear it. */
function talkBots(c: Sender & { vars: Vars & { bots: Map<number, BotRun> } }, now: number): void {
  for (const b of BOTS) {
    const p = c.state.players[b.id];
    const run = runOf(c.vars, b.id, b.every, now);
    if (!p || now < run.sayAt) continue;
    run.sayAt = now + between(b.every);
    const leader = run.following === null ? null : c.state.players[run.following];
    const text = lineFor(b, now, { leader, cups: run.cups });
    run.cups = 0;
    if (![...c.vars.online.keys()].some((id) => c.state.players[id]?.room === p.room)) continue;
    run.restUntil = Math.max(run.restUntil, now + BOT_TALK_PAUSE_MS);
    sendToRoom(c, p.room, "bubble", { userId: b.id, text });
  }
}

const correction = (p: WorldPlayer): StepResult => ({
  x: p.x,
  y: p.y,
  facing: p.facing,
  state: p.state,
  room: p.room,
});

function occupancy(s: WorldState, online: Map<number, number>): Partial<Record<RoomId, number>> {
  const out: Partial<Record<RoomId, number>> = {};
  for (const id of online.keys()) {
    const room = s.players[id]?.room;
    if (room) out[room] = (out[room] ?? 0) + 1;
  }
  return out;
}

async function snapshot(
  s: WorldState,
  online: Map<number, number>,
  self: WorldPlayer,
  chat: Promise<ChatLine[]>,
): Promise<Snapshot> {
  const owner = ownerOfOffice(self.room);
  return {
    room: self.room,
    selfId: self.id,
    players: Object.values(s.players)
      .filter((p) => p.room === self.room)
      .map((p) => view(p, online.has(p.id))),
    companies: Object.values(s.companies),
    occupancy: occupancy(s, online),
    chat: await chat,
    houses: self.room === "town" ? houses(s) : {},
    games: Object.values(s.games ?? {}),
    furniture: owner === null ? null : officeOf(s, owner).furniture,
    owner: owner === null ? null : { id: owner, name: s.players[owner]?.name ?? "Someone" },
  };
}

/** Someone's office; one never saved is new: `STARTER_OFFICE`, open. */
const officeOf = (s: WorldState, userId: number): Office =>
  s.offices?.[userId] ?? { furniture: [...STARTER_OFFICE], open: true };

/** Everyone inside each company house, for drawing them through its walls from town. */
function houses(s: WorldState): Houses {
  const out: Houses = {};
  for (const p of Object.values(s.players)) {
    const companyId = companyOfRoom(p.room);
    if (companyId === null) continue;
    const list = out[companyId] ?? [];
    list.push({ id: p.id, name: p.name, level: p.level, look: p.look, state: p.state });
    out[companyId] = list;
  }
  return out;
}

async function chatOf(sql: Sql, room: RoomId) {
  const rows = await all<ChatLine>(
    sql,
    "SELECT id, room, user_id AS userId, name, text, at FROM chat WHERE room = ? ORDER BY id DESC LIMIT ?",
    room,
    CHAT_HISTORY,
  );
  return rows.reverse();
}

interface Sender {
  conns: Map<string, { state: unknown; send(name: string, ...args: unknown[]): void }>;
  state: WorldState;
}

function sendToRoom(c: Sender, room: RoomId, event: string, payload: unknown): void {
  for (const conn of c.conns.values()) {
    const s = conn.state as ConnState;
    if (s.kind === "user" && s.joined && c.state.players[s.userId]?.room === room) conn.send(event, payload);
  }
}

/** A player who changed room (a door, or sent to bed) gets the new room whole. */
async function sendSnapshot(c: Sender & { vars: Vars; db: Sql }, p: WorldPlayer): Promise<void> {
  const snap = await snapshot(c.state, c.vars.online, p, chatOf(c.db, p.room));
  for (const conn of c.conns.values()) {
    const s = conn.state as ConnState;
    if (s.kind === "user" && s.joined && s.userId === p.id) conn.send("snapshot", snap);
  }
}

/** One tick: batched moves per room, and head counts when they change. */
function flush(c: Sender & { vars: Vars; db: Sql; broadcast(name: string, ...args: unknown[]): void }): void {
  const { dirty, announced, online } = c.vars;
  if (dirty.size > 0) {
    const rooms = new Map<RoomId, Moves>();
    const at = (room: RoomId) => {
      const m = rooms.get(room) ?? { room, join: [], m: [], leave: [] };
      rooms.set(room, m);
      return m;
    };
    for (const id of dirty) {
      const p = c.state.players[id];
      if (!p) continue;
      const was = announced.get(id);
      if (was === p.room) {
        at(p.room).m.push(pos(p));
        continue;
      }
      if (was) at(was).leave.push(id);
      at(p.room).join.push(view(p, online.has(id)));
      announced.set(id, p.room);
      if (online.has(id)) void sendSnapshot(c, p);
    }
    dirty.clear();
    for (const [room, m] of rooms) sendToRoom(c, room, "moves", m);
  }
  const counts = JSON.stringify(occupancy(c.state, online));
  if (counts !== c.vars.occupancy) {
    c.vars.occupancy = counts;
    c.broadcast("occupancy", JSON.parse(counts));
  }
  // ponytail: recomputed every tick (a pass over all players) so renames and level-ups show too.
  // Track changes per house if the world gets big.
  const inside = JSON.stringify(houses(c.state));
  if (inside !== c.vars.houses) {
    c.vars.houses = inside;
    sendToRoom(c, "town", "houses", JSON.parse(inside));
  }
}
