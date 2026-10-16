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

/** What an office can hold: furniture from the map legend, drawn as it is everywhere else. */
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
 * Coins to go from `before` to `after`: the price of each piece there's more of. ponytail: no refund
 * on removal and no inventory; add "pick up into inventory" if people ask.
 */
export function officeCost(before: readonly Placed[], after: readonly Placed[]): number {
  const count = (list: readonly Placed[], ch: string) => list.filter((p) => p.ch === ch).length;
  return FURNITURE.reduce((n, f) => n + Math.max(0, count(after, f.ch) - count(before, f.ch)) * f.price, 0);
}

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

/** An office: the template with its owner's furniture written over the floor. */
export function officeMap(furniture: readonly Placed[]): GameMap {
  const rows = MAPS.office.rows.map((r) => [...r]);
  for (const p of furniture) for (let i = 0; i < (pieceOf(p.ch)?.w ?? 1); i++) rows[p.y]![p.x + i] = p.ch;
  return new GameMap(
    "office",
    MAPS.office.name,
    rows.map((r) => r.join("")),
  );
}

/** Each owner's office map. ponytail: one process holds every office it has seen, like the town. */
export const OFFICES = new Map<number, GameMap>();

export function setOffice(userId: number, furniture: readonly Placed[]): GameMap {
  const map = officeMap(furniture);
  OFFICES.set(userId, map);
  return map;
}
