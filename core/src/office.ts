/**
 * Offices: the furniture you can buy, what it costs, and the doors to them. The template itself is
 * `MAPS.office`, with the other rooms; what's in each office is what its owner dropped there.
 */
import { GameMap, MAPS } from "./maps.ts";

export interface Piece {
  ch: string;
  name: string;
  price: number;
  /** Tiles wide; 1 unless set. */
  w?: number;
}

/** What an office can hold: furniture from the map legend, drawn as it is everywhere else. Sold as `furn.<ch>`. */
export const FURNITURE: readonly Piece[] = [
  { ch: "=", name: "Rug", price: 10 },
  { ch: "p", name: "Plant", price: 20 },
  { ch: "L", name: "Lamp", price: 25 },
  { ch: "c", name: "Chair", price: 30 },
  { ch: "k", name: "Shelf", price: 40 },
  { ch: "B", name: "Bench", price: 40 },
  { ch: "d", name: "Desk", price: 50 },
  { ch: "o", name: "Coffee machine", price: 60 },
  { ch: "b", name: "Bed", price: 80 },
  { ch: "s", name: "Sofa", price: 100 },
  { ch: "t", name: "TV", price: 120, w: 2 },
];
/** At most this many drops on an office's floor. */
export const OFFICE_PIECES = 40;
/** Your own office opens at this level. */
export const OFFICE_LEVEL = 10;

export const pieceOf = (ch: unknown): Piece | undefined => FURNITURE.find((f) => f.ch === ch);

/** One placed piece: its top-left tile. */
export interface Placed {
  ch: string;
  x: number;
  y: number;
}

/** What a new office holds: a desk with a chair in front of it. */
export const STARTER_OFFICE: readonly Placed[] = [
  { ch: "d", x: 5, y: 3 },
  { ch: "c", x: 5, y: 4 },
];

/**
 * A map with these pieces written over its floor: a room's dropped furniture (`mapOf`). Only over floor:
 * a wall or door the map gained under a piece stays a wall or door.
 */
export function withPieces(pieces: readonly Placed[], base: GameMap): GameMap {
  const rows = base.rows.map((r) => [...r]);
  for (const p of pieces)
    for (let i = 0; i < (pieceOf(p.ch)?.w ?? 1); i++)
      if (base.walkable(p.x + i, p.y)) rows[p.y - base.y0]![p.x + i - base.x0] = p.ch;
  return new GameMap(
    base.id,
    base.name,
    rows.map((r) => r.join("")),
    base.x0,
    base.y0,
  );
}

// MARK: Doors

/** A door in a company building: whose office, where, and whether it's open (the client draws a 🔒). */
export interface Door {
  userId: number;
  name: string;
  open: boolean;
  x: number;
  y: number;
}
const DOORS_PER_HALLWAY = 10;
/** The gap up through the walls from the floor (from y = 2) to every hallway: between two doors. */
export const PASSAGE_X = 14;

/**
 * Door slots for these owners (sorted by id): slot n is hallway ⌊n/10⌋, tile 1 + 2·(n mod 10).
 * ponytail: packed, not stored, so when a door goes the later ones move down a slot; store slots if
 * people mind their door moving.
 */
export function doorsFor(owners: readonly Omit<Door, "x" | "y">[]): Door[] {
  return [...owners]
    .sort((a, b) => a.userId - b.userId)
    .map((o, n) => ({
      ...o,
      x: 1 + 2 * (n % DOORS_PER_HALLWAY),
      y: -3 * Math.floor(n / DOORS_PER_HALLWAY) - 2,
    }));
}

/**
 * The building with a hallway of doors per 10 offices, above today's floor (negative y, like the town),
 * so every tile it had keeps its coordinates. A hallway is a wall top, a wall face with the doors, and a
 * corridor.
 */
export function hqMap(doors: readonly Door[]): GameMap {
  const floor = MAPS.hq;
  const y0 = Math.min(0, ...doors.map((d) => d.y - 1));
  const hall = ["W".repeat(floor.width), "W".repeat(floor.width), `W${"_".repeat(floor.width - 2)}W`];
  const rows = [...Array.from({ length: -y0 }, (_, i) => hall[i % 3]!), ...floor.rows].map((r) => [...r]);
  for (const d of doors) rows[d.y - y0]![d.x] = "R";
  for (let y = y0 + 3; y < 2; y++) rows[y - y0]![PASSAGE_X] = "_";
  return new GameMap(
    "hq",
    floor.name,
    rows.map((r) => r.join("")),
    0,
    y0,
  );
}

/** Each company's building. ponytail: one process holds every building it has seen, like the town. */
export const HQS = new Map<number, GameMap>();

export function setHq(companyId: number, doors: readonly Door[]): GameMap {
  const map = hqMap(doors);
  HQS.set(companyId, map);
  return map;
}

/** The door at (x, y) in a building, if any. */
export const doorAt = (doors: readonly Door[], x: number, y: number): Door | undefined =>
  doors.find((d) => d.x === x && d.y === y);
