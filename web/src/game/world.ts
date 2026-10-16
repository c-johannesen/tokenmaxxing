import { type GameMap, setOffice, setTown } from "@tokenmaxxing/core/maps.ts";
import {
  type ChatLine,
  type CompanyInfo,
  defaultLook,
  type Facing,
  type Houses,
  type Moves,
  mapOf,
  ownerOfOffice,
  type PlayerInfo,
  type PlayerPos,
  type PlayerState,
  type PlayerView,
  type RoomId,
  RUN_STEP_MS,
  type Snapshot,
  WALK_STEP_MS,
  type WorldGame,
} from "@tokenmaxxing/core/world.ts";
import { bakeGround } from "../art/tiles.ts";
import { hud } from "../store.ts";
import { emojiOnly } from "./emoji.ts";

/** Someone in the room, as drawn: a logical tile plus an in-flight step. */
export interface Avatar {
  info: PlayerInfo;
  x: number;
  y: number;
  facing: Facing;
  state: PlayerState;
  from: { x: number; y: number; at: number; ms: number } | null;
  /** Steps received but not yet walked (remote players). */
  queue: PlayerPos[];
  bubble: { text: string; until: number } | null;
  /** An emoji-only line, bursting around them. */
  burst: { emojis: string[]; at: number } | null;
  warp: { at: number; out: boolean } | null;
  /** When their current hop started. */
  jump: number | null;
}

const BUBBLE_MS = 6000;
export const WARP_MS = 300;

export const world = {
  room: "town" as RoomId,
  selfId: 0,
  map: mapOf("town") as GameMap,
  ground: null as HTMLCanvasElement | null,
  avatars: new Map<number, Avatar>(),
  /** Avatars playing their warp-out before disappearing. */
  leaving: [] as Avatar[],
  companies: new Map<number, CompanyInfo>(),
  /** Town only: who is inside each company house, drawn through its walls. */
  houses: {} as Houses,
  /** Waiting for the server to move us through a door. */
  portalPending: false,
  /** Games on show in town: their tables or arenas, players and status. */
  games: new Map<number, WorldGame>(),
  /** A line said at a game's table itself ("🤝 Draw"), shown over the table briefly. */
  tableBubbles: new Map<number, { text: string; until: number }>(),
  /** In an office: whose it is. */
  owner: null as Snapshot["owner"],
};

/** Someone's look: as seen in the world, or their default while they're not in it. */
export const lookOf = (userId: number) => world.avatars.get(userId)?.info.look ?? defaultLook(userId);

const grounds = new WeakMap<GameMap, HTMLCanvasElement>();

/** Shows `room`'s map (the town as it is now), its ground baked once. */
function showMap(room: RoomId): void {
  world.map = mapOf(room);
  const ground = grounds.get(world.map) ?? bakeGround(world.map);
  grounds.set(world.map, ground);
  world.ground = ground;
}

const avatarOf = (v: PlayerView, now: number, warp: boolean): Avatar => ({
  info: v,
  x: v.x,
  y: v.y,
  facing: v.facing,
  state: v.state,
  from: null,
  queue: [],
  bubble: null,
  burst: null,
  jump: null,
  warp: warp ? { at: now, out: false } : null,
});

export const self = (): Avatar | undefined => world.avatars.get(world.selfId);

export function loadSnapshot(s: Snapshot): void {
  const now = performance.now();
  const changedRoom = s.room !== world.room || world.selfId === 0;
  world.room = s.room;
  world.selfId = s.selfId;
  world.owner = s.owner;
  setCompanies(s.companies);
  const owner = ownerOfOffice(s.room);
  if (owner !== null && s.furniture) setOffice(owner, s.furniture);
  showMap(s.room);
  const bubbles = new Map([...world.avatars].map(([id, a]) => [id, a.bubble]));
  world.avatars = new Map(
    s.players.map((p) => {
      const a = avatarOf(p, now, false);
      if (!changedRoom) a.bubble = bubbles.get(p.id) ?? null;
      return [p.id, a];
    }),
  );
  world.leaving = [];
  world.portalPending = false;
  world.houses = s.houses;
  world.games = new Map(s.games.map((g) => [g.id, g]));
  hud.set({
    room: s.room,
    occupancy: s.occupancy,
    chat: s.chat,
    ...(changedRoom ? { banner: { text: roomName(s.room), at: Date.now() }, dialog: null } : {}),
  });
}

let townPlots = "";

/** The companies, and the town grown (or shrunk) to fit their plots. */
export function setCompanies(list: CompanyInfo[]): void {
  world.companies = new Map(list.map((c) => [c.id, c]));
  const plots = list.map((c) => c.plot).sort((a, b) => a - b);
  if (plots.join() !== townPlots) {
    townPlots = plots.join();
    setTown(plots);
    if (world.room === "town") showMap("town");
  }
  hud.set({ companies: list });
}

export function roomName(room: RoomId): string {
  if (room === "town") return "Town square";
  if (room === "inn") return "The Inn";
  if (ownerOfOffice(room) !== null)
    return room === world.room && world.owner ? `${world.owner.name}'s office` : "An office";
  const company = world.companies.get(Number(room.slice(3)));
  return company ? `${company.name}'s house` : "Company house";
}

/** One tick of changes from the server. */
export function applyMoves(m: Moves): void {
  if (m.room !== world.room) return;
  const now = performance.now();
  for (const id of m.leave) {
    const a = world.avatars.get(id);
    if (!a || id === world.selfId) continue;
    world.avatars.delete(id);
    world.leaving.push({ ...a, warp: { at: now, out: true } });
  }
  for (const v of m.join) {
    if (v.id === world.selfId) continue;
    world.avatars.set(v.id, avatarOf(v, now, true));
  }
  for (const pos of m.m) {
    const a = world.avatars.get(pos[0]);
    if (!a) continue;
    if (pos[0] === world.selfId) reconcileSelf(a, pos);
    else {
      a.queue.push(pos);
      if (a.queue.length > 6) a.queue.splice(0, a.queue.length - 6);
    }
  }
}

/** The server moved us (to bed, off a seat): take its word unless it's a step we already made. */
function reconcileSelf(a: Avatar, [, x, y, facing, state]: PlayerPos): void {
  if (state === a.state && Math.abs(x - a.x) + Math.abs(y - a.y) <= 1) return;
  Object.assign(a, { x, y, facing, state, from: null });
}

export function applyInfo(info: PlayerInfo): void {
  const a = world.avatars.get(info.id);
  if (a) a.info = info;
}

export function applyChat(line: ChatLine): void {
  if (line.room !== world.room) return;
  hud.set((s) => ({ chat: [...s.chat.slice(-99), line] }));
  applyBubble(line);
}

/** Something said over someone's head: a bubble, or a burst if it's only emoji. Bots only talk this way. */
export function applyBubble(e: { userId: number; text: string }): void {
  const a = world.avatars.get(e.userId);
  if (!a) return;
  const emojis = emojiOnly(e.text);
  if (emojis) a.burst = { emojis, at: performance.now() };
  else a.bubble = { text: e.text, until: performance.now() + BUBBLE_MS };
}

/** Starts a one-tile step animation. */
export function beginStep(a: Avatar, x: number, y: number, ms: number): void {
  a.from = { x: a.x, y: a.y, at: performance.now(), ms };
  a.x = x;
  a.y = y;
}

export const stepping = (a: Avatar, now: number): boolean => a.from !== null && now < a.from.at + a.from.ms;

/** Where to draw an avatar right now, in tiles. */
export function drawPos(a: Avatar, now: number): { x: number; y: number } {
  if (!a.from || now >= a.from.at + a.from.ms) return { x: a.x, y: a.y };
  const t = (now - a.from.at) / a.from.ms;
  return { x: a.from.x + (a.x - a.from.x) * t, y: a.from.y + (a.y - a.from.y) * t };
}

/** Someone else hopped (our own hops start locally). */
export function applyJump(id: number): void {
  const a = world.avatars.get(id);
  if (a && id !== world.selfId) a.jump = performance.now();
}

/** Remote players walk their queued steps; long queues catch up at running pace. */
export function advanceRemotes(now: number): void {
  for (const a of world.avatars.values()) {
    if (a.info.id === world.selfId || stepping(a, now)) continue;
    const next = a.queue.shift();
    if (!next) {
      a.from = null;
      continue;
    }
    const [, x, y, facing, state] = next;
    a.facing = facing;
    a.state = state;
    if (Math.abs(x - a.x) + Math.abs(y - a.y) === 1)
      beginStep(a, x, y, a.queue.length > 1 ? RUN_STEP_MS : WALK_STEP_MS);
    else Object.assign(a, { x, y, from: null });
  }
  world.leaving = world.leaving.filter((a) => now - a.warp!.at < WARP_MS);
}

export const avatarAt = (x: number, y: number): Avatar | undefined =>
  [...world.avatars.values()].find((a) => a.x === x && a.y === y && a.info.id !== world.selfId);

// MARK: Games

export function applyGame(g: WorldGame): void {
  world.games.set(g.id, g);
}

/** A game ended: its table goes, and coins burst around the winners. */
export function applyGameOver(id: number, winners: number[]): void {
  world.games.delete(id);
  world.tableBubbles.delete(id);
  for (const w of winners) {
    const a = world.avatars.get(w);
    if (a) a.burst = { emojis: ["🪙"], at: performance.now() };
  }
}

/** Something said in a game: over the player who said it, or over the table. */
export function applyCallout(e: { id: number; userId: number | null; text: string }): void {
  const until = performance.now() + BUBBLE_MS;
  const a = e.userId === null ? undefined : world.avatars.get(e.userId);
  if (a) a.bubble = { text: e.text, until };
  else world.tableBubbles.set(e.id, { text: e.text, until });
}

/** "🎮 ★★ ✓" over someone at a game table, "🏁 2nd · 412M" for someone in a battle. */
export function gameTag(userId: number): string | null {
  for (const g of world.games.values()) {
    if (!g.players.includes(userId)) continue;
    const status = g.status[userId];
    return `${g.spot.kind === "arena" ? "🏁" : "🎮"}${status ? ` ${status}` : ""}`;
  }
  return null;
}
