/**
 * The world's rules and wire types, shared by the `world` actor and the game
 * client. Everything here is pure so it can be tested without Rivet.
 */
import type { Seat, Spot } from "./games/gather.ts";
import type { BoardRow, GameId } from "./games/types.ts";
import { blockOf, doorOf, type GameMap, MAPS, type MapId, plotId, TOWN_SPAWN } from "./maps.ts";
import { type Door, doorAt, HQS, OFFICES, type Placed, STARTER_OFFICE, setOffice } from "./office.ts";

export const TILE = 16;
/** Client animation time per step; the server only enforces the running pace. */
export const WALK_STEP_MS = 220;
export const RUN_STEP_MS = 130;
/** A hop on Space: how long it's in the air, and the fastest the server passes them on. */
export const JUMP_MS = 360;
/** How often the world sends batched moves. */
export const TICK_MS = 100;
/** Connected but no input this long → dozing where they stand (only going offline sends them to bed). */
export const IDLE_MS = 3 * 60_000;
/** Offline and agents active this recently → working at a desk. */
export const WORKING_MS = 10 * 60_000;
export const CHAT_MAX_LENGTH = 280;
export const CHAT_HISTORY = 50;
export const COMPANY_CAP = 50;

export type Facing = "up" | "down" | "left" | "right";
/** `playing`: at a game table in town, until the match ends (see core/src/games/gather.ts). */
export type PlayerState = "idle" | "sit" | "away" | "working" | "playing";
export type RoomId = "town" | "inn" | `hq:${number}` | `office:${number}`;

export const DIRS: Record<Facing, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
export const isFacing = (v: unknown): v is Facing => typeof v === "string" && v in DIRS;

export const companyOfRoom = (room: RoomId): number | null =>
  room.startsWith("hq:") ? Number(room.slice(3)) : null;
export const ownerOfOffice = (room: RoomId): number | null =>
  room.startsWith("office:") ? Number(room.slice(7)) : null;

/** An office nobody has furnished yet holds `STARTER_OFFICE`; a building nobody has built is the bare floor. */
export function mapOf(room: RoomId): GameMap {
  const owner = ownerOfOffice(room);
  if (owner !== null) return OFFICES.get(owner) ?? setOffice(owner, STARTER_OFFICE);
  const company = companyOfRoom(room);
  return company !== null ? (HQS.get(company) ?? MAPS.hq) : MAPS[room as MapId];
}

// MARK: Looks

export interface Look {
  style: number;
  skin: number;
  hair: number;
  /** Free below `FREE_OUTFITS` (shop.ts), bought above. */
  outfit: number;
  /** Shop extras; 0 is none. */
  glasses: number;
  hat: number;
  pet: number;
}
export const LOOK_OPTIONS: Record<keyof Look, number> = {
  style: 4,
  skin: 4,
  hair: 6,
  outfit: 13,
  glasses: 4,
  hat: 5,
  pet: 7,
};
/** Looks saved before the shop have no extras. */
const EXTRAS = { glasses: 0, hat: 0, pet: 0 };
export const STYLE_NAMES = ["Short hair and tee", "Cap and hoodie", "Bun and jacket", "Long hair and skirt"];

export function parseLook(raw: unknown): Look | null {
  if (!raw || typeof raw !== "object") return null;
  const r: Record<string, unknown> = { ...EXTRAS, ...(raw as Record<string, unknown>) };
  const out = {} as Look;
  for (const k of Object.keys(LOOK_OPTIONS) as (keyof Look)[]) {
    const v = r[k];
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= LOOK_OPTIONS[k]) return null;
    out[k] = v as number;
  }
  return out;
}

/** A stable starting look, so a new player isn't a clone of everyone else. */
export function defaultLook(seed: number): Look {
  const n = Math.abs(Math.imul(seed + 1, 2654435761));
  return {
    style: n % LOOK_OPTIONS.style,
    skin: (n >>> 3) % LOOK_OPTIONS.skin,
    hair: (n >>> 6) % LOOK_OPTIONS.hair,
    outfit: (n >>> 9) % 8,
    ...EXTRAS,
  };
}

// MARK: Wire types

/** Who someone is. Sent once per room entry and whenever it changes. */
export interface PlayerInfo {
  id: number;
  name: string;
  look: Look;
  level: number;
  companyId: number | null;
  todayTokens: number;
  /** Agents that ran in the last 10 minutes. */
  liveAgents: number;
  online: boolean;
  /** When their coffee wears off (epoch ms); see `drinkCoffee`. */
  coffeeUntil: number;
  /** Online but no input for `IDLE_MS`: snoozing in place. */
  dozing: boolean;
}

/** A line from `town` for one player (`notice`), and the panel a click on it opens. */
export interface Notice {
  text: string;
  open?: "company" | "trades" | "shop";
}

/** Where someone is: `[id, x, y, facing, state]`. */
export type PlayerPos = [number, number, number, Facing, PlayerState];

export interface PlayerView extends PlayerInfo {
  x: number;
  y: number;
  facing: Facing;
  state: PlayerState;
}

/** A company's house colours (`#rrggbb`) and logo, picked from its website. */
export interface Brand {
  roof: string;
  wall: string;
  /** Door and window frames. */
  trim: string;
  /** Behind the logo. */
  plaque: string;
  /** Same-origin path, e.g. `/logos/3.png?v=k2x9`. */
  logo: string | null;
}

export interface CompanyInfo {
  id: number;
  name: string;
  plot: number;
  members: number;
  todayTokens: number;
  tokens30d: number;
  /** Bare host, e.g. `acme.com`. */
  website: string | null;
  brand: Brand | null;
}

export interface ChatLine {
  id: number;
  room: RoomId;
  userId: number;
  name: string;
  text: string;
  at: number;
}

/** Someone inside a company house, as seen through its walls from town. */
export interface Peek {
  id: number;
  name: string;
  level: number;
  look: Look;
  /** Asleep (`away`), at a desk (`working`), or up and about. */
  state: PlayerState;
}

/** Who is inside each company house, by company id. */
export type Houses = Record<number, Peek[]>;

/** `@name` in chat: the same handle rules as sign-up names. */
const MENTION_RE = /@([a-z0-9][a-z0-9._-]{1,31})/gi;

/** Lowercased names mentioned in `text`, each once. */
export const mentionsIn = (text: string): string[] => [
  ...new Set([...text.matchAll(MENTION_RE)].map((m) => m[1]!.toLowerCase())),
];

/** Names in an invite field like "@ada bo, @cy": with or without the @. */
export const namesIn = (text: string): string[] => [
  ...new Set(
    text
      .split(/[\s,]+/)
      .map((s) => s.replace(/^@/, "").toLowerCase())
      .filter(Boolean),
  ),
];

export interface Snapshot {
  room: RoomId;
  selfId: number;
  players: PlayerView[];
  companies: CompanyInfo[];
  occupancy: Partial<Record<RoomId, number>>;
  chat: ChatLine[];
  /** Only in town: who is inside each house. */
  houses: Houses;
  /** Games being played in town, with their tables or arenas. */
  games: WorldGame[];
  /** Only in an office: its furniture, and whose it is (for the banner). */
  furniture: Placed[] | null;
  owner: { id: number; name: string } | null;
  /** Only in a building: its office doors, to build the map and draw the names. */
  doors: Door[];
}

/** A game on show in town: where its table (or arena) is, who's at it, and how it's going. */
export interface WorldGame {
  id: number;
  game: GameId;
  spot: Spot;
  players: number[];
  /** Where each player sits, in `players` order. */
  seats: Seat[];
  /** The short status over each player's head ("🪂 ×3.1"). */
  status: Record<number, string | null>;
  /** The live scoreboard, for games that have one (Tokenmaxxing). */
  board: BoardRow[] | null;
  watchers: number;
  /** How it's going ("Round 3 · 2–1"). */
  headline: string | null;
  /** When it ends, for a countdown. */
  endsAt: number | null;
}

/** What a match tells the world about itself, after every change. */
export type GameStatus = Pick<WorldGame, "status" | "board" | "watchers" | "headline" | "endsAt">;

/** One tick's changes in a room. */
export interface Moves {
  room: RoomId;
  join: PlayerView[];
  m: PlayerPos[];
  leave: number[];
}

/** What `step` answers when it didn't simply move you. */
export type StepResult =
  | null
  | { notice: string }
  | { x: number; y: number; facing: Facing; state: PlayerState; room: RoomId };

// MARK: Houses

/** Minimum tokens per member over the last 30 days for each house. */
const TIERS = [
  { name: "Basement", min: 0 },
  { name: "Shack", min: 100e6 },
  { name: "Cottage", min: 1e9 },
  { name: "House", min: 5e9 },
  { name: "Villa", min: 15e9 },
  { name: "Mansion", min: 40e9 },
] as const;
export const HOUSE_TIERS = TIERS.length;

/** Tokens per member over the last 30 days: what a company's house is built from. */
export const perMember = (tokens30d: number, members: number): number => tokens30d / Math.max(1, members);

/**
 * A company's house reflects how hard its people push, not how many there are:
 * a big team of light users lives in a basement, two heavy users in a mansion.
 */
export const houseTier = (tokens30d: number, members: number): number =>
  TIERS.findLastIndex((t) => perMember(tokens30d, members) >= t.min);
export const houseTierName = (tier: number): string => TIERS[tier]?.name ?? TIERS[0].name;
export const nextTierAt = (tier: number): number | null => TIERS[tier + 1]?.min ?? null;

// MARK: Coffee

/** How long one cup keeps you shaking. Cups stack, up to `MAX_CUPS` in your system at once. */
export const CUP_MS = 90_000;
export const MAX_CUPS = 6;

/** Another cup: adds `CUP_MS` to whatever is still in your system. */
export const drinkCoffee = (until: number, now: number): number =>
  Math.min(Math.max(until, now) + CUP_MS, now + MAX_CUPS * CUP_MS);

/** Cups still in your system (fractional, wearing off): how hard you shake. */
export const cupsLeft = (until: number, now: number): number => Math.max(0, until - now) / CUP_MS;

// MARK: Movement

/** Steps allowed in a burst: covers network jitter bunching up a few steps. */
export const STEP_BURST = 4;

/**
 * A token bucket that refills at running pace. Returns the new budget, or null
 * when the step comes too fast.
 */
export function takeStep(budget: number, lastAt: number, now: number): number | null {
  const refilled = Math.min(STEP_BURST, budget + (now - lastAt) / (RUN_STEP_MS * 0.8));
  return refilled >= 1 ? refilled - 1 : null;
}

type StepTarget =
  | { kind: "move"; x: number; y: number }
  | { kind: "portal"; ch: string; x: number; y: number }
  | { kind: "blocked" };

/** One step from (x, y). Seats and furniture block; you can always step off a seat. */
export function stepTarget(map: GameMap, x: number, y: number, dir: Facing): StepTarget {
  const [dx, dy] = DIRS[dir];
  const nx = x + dx;
  const ny = y + dy;
  const kind = map.kind(nx, ny);
  if (kind.portal) return { kind: "portal", ch: map.at(nx, ny), x: nx, y: ny };
  return kind.walk ? { kind: "move", x: nx, y: ny } : { kind: "blocked" };
}

export interface Place {
  room: RoomId;
  x: number;
  y: number;
  facing: Facing;
}

export const townSpawn = (): Place => ({ room: "town", x: TOWN_SPAWN[0], y: TOWN_SPAWN[1], facing: "down" });

/** Just inside a room's exit, facing in. */
export function roomEntry(room: RoomId): Place {
  const [x, y] = mapOf(room).find("x")[0]!;
  return { room, x, y: y - 1, facing: "up" };
}

/** Just outside a town door (a company's plot, or the Inn), facing away from it. */
export function outsideDoor(plot: number | "inn"): Place {
  const [x, y] = plot === "inn" ? MAPS.town.find("I")[0]! : doorOf(plot);
  return { room: "town", x, y: y + 1, facing: "down" };
}

/**
 * Where the portal at (x, y) takes you, or why it doesn't. `plots` maps a plot to the company holding
 * it; `doors` are your own company building's. An office door takes you to its owner's office (open or
 * closed is the world's to check); leaving an office puts you below its door in your own building, if
 * it has one, else at your building's entry.
 */
export function portal(
  room: RoomId,
  door: { ch: string; x: number; y: number },
  companyId: number | null,
  plots: ReadonlyMap<number, { id: number; name: string }>,
  doors: readonly Door[] = [],
): Place | { notice: string } {
  if (door.ch === "R") return roomEntry(`office:${doorAt(doors, door.x, door.y)!.userId}`);
  const owner = ownerOfOffice(room);
  if (owner !== null) {
    if (companyId === null) return roomEntry("inn");
    const d = doors.find((d) => d.userId === owner);
    return d ? { room: `hq:${companyId}`, x: d.x, y: d.y + 1, facing: "down" } : roomEntry(`hq:${companyId}`);
  }
  if (room === "town") {
    if (door.ch === "I") return roomEntry("inn");
    const holder = plots.get(plotId(...blockOf(door.x, door.y)));
    if (!holder) return { notice: "Nobody lives here any more." };
    if (holder.id !== companyId) return { notice: `🔒 ${holder.name}'s house. Members only.` };
    return roomEntry(`hq:${holder.id}`);
  }
  if (room === "inn") return outsideDoor("inn");
  const plot = [...plots].find(([, c]) => c.id === companyOfRoom(room))?.[0];
  return plot === undefined ? townSpawn() : outsideDoor(plot);
}

/** The room a player rests in: their company's house, or the Inn without one. */
export function homeRoom(companyId: number | null): RoomId {
  return companyId !== null ? `hq:${companyId}` : "inn";
}

/**
 * The first free bed (`away`) or desk chair (`working`) in `room`, then the
 * first free floor tile: every other one first, so neighbours' name labels don't
 * overlap, then the rest. `taken` holds `"x,y"` of spots already in use.
 */
export function restSpot(room: RoomId, state: "away" | "working", taken: ReadonlySet<string>): Place {
  const map = mapOf(room);
  const floor = map.find("_").filter(([, y]) => y >= 3);
  const spots = [
    ...map.find(state === "away" ? "b" : "c"),
    ...floor.filter(([x]) => x % 2 === 1),
    ...floor.filter(([x]) => x % 2 === 0),
  ];
  const free = spots.find(([x, y]) => !taken.has(`${x},${y}`)) ?? spots[0]!;
  return { room, x: free[0], y: free[1], facing: state === "working" ? "up" : "down" };
}

/**
 * Shortest walk from `from` to `to` as steps (BFS over walkable tiles). The
 * target itself may be a door or seat: the last step walks into it. Null when
 * there's no way.
 */
export function route(map: GameMap, from: [number, number], to: [number, number]): Facing[] | null {
  const key = (x: number, y: number) => map.index(x, y);
  const goal = key(...to);
  const prev = new Map<number, [number, Facing]>([[key(...from), [-1, "down"]]]);
  const queue: [number, number][] = [from];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    if (key(x, y) === goal) {
      const out: Facing[] = [];
      for (let k = goal; prev.get(k)![0] !== -1; k = prev.get(k)![0]) out.push(prev.get(k)![1]);
      return out.reverse();
    }
    for (const dir of Object.keys(DIRS) as Facing[]) {
      const [dx, dy] = DIRS[dir];
      const nx = x + dx;
      const ny = y + dy;
      const k = key(nx, ny);
      if (prev.has(k) || !map.contains(nx, ny)) continue;
      if (!map.walkable(nx, ny) && k !== goal) continue;
      prev.set(k, [key(x, y), dir]);
      queue.push([nx, ny]);
    }
  }
  return null;
}
