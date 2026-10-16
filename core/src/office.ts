/**
 * Offices: the furniture you can buy, what it costs, and each owner's office map. The template
 * itself is `MAPS.office`, with the other rooms.
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
 * Null unless every piece is a known char on a floor tile, nothing overlaps, and it's under OFFICE_PIECES.
 * ponytail: no reachability check. You can wall off the entry tile; a visitor can still step back out.
 */
export function parseOffice(raw: unknown): Placed[] | null {
  if (!Array.isArray(raw) || raw.length > OFFICE_PIECES) return null;
  const taken = new Set<string>();
  const out: Placed[] = [];
  for (const r of raw as Partial<Placed>[]) {
    const piece = pieceOf(r?.ch);
    const { x, y } = r ?? {};
    if (!piece || !Number.isInteger(x) || !Number.isInteger(y)) return null;
    for (let i = 0; i < (piece.w ?? 1); i++) {
      const tile = `${x! + i},${y}`;
      if (MAPS.office.at(x! + i, y!) !== "_" || taken.has(tile)) return null;
      taken.add(tile);
    }
    out.push({ ch: piece.ch, x: x!, y: y! });
  }
  return out;
}

/** An office: the template with its owner's furniture written over the floor (or any room's map: drops). */
export function officeMap(furniture: readonly Placed[], base = MAPS.office): GameMap {
  const rows = base.rows.map((r) => [...r]);
  for (const p of furniture)
    for (let i = 0; i < (pieceOf(p.ch)?.w ?? 1); i++)
      if (base.contains(p.x + i, p.y)) rows[p.y - base.y0]![p.x + i - base.x0] = p.ch;
  return new GameMap(
    base.id,
    base.name,
    rows.map((r) => r.join("")),
    base.x0,
    base.y0,
  );
}

/** Each owner's office map. ponytail: one process holds every office it has seen, like the town. */
export const OFFICES = new Map<number, GameMap>();

export function setOffice(userId: number, furniture: readonly Placed[]): GameMap {
  const map = officeMap(furniture);
  OFFICES.set(userId, map);
  return map;
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
export const DOORS_PER_HALLWAY = 10;
/** The gap up through the walls from the floor to every hallway: between two doors. */
const PASSAGE_X = 14;

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

/** Each company's building. ponytail: one process holds every building it has seen, like the offices. */
export const HQS = new Map<number, GameMap>();

export function setHq(companyId: number, doors: readonly Door[]): GameMap {
  const map = hqMap(doors);
  HQS.set(companyId, map);
  return map;
}

/** The door at (x, y) in a building, if any. */
export const doorAt = (doors: readonly Door[], x: number, y: number): Door | undefined =>
  doors.find((d) => d.x === x && d.y === y);
