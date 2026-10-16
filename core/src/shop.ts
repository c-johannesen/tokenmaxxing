/**
 * Coins and the shop. Coins come from using AI (per world day, square-rooted so
 * a heavy day earns more but not wildly more) and from finishing a day in the
 * top 3. They buy clothes, glasses, hats and pets, worn through `Look`.
 */
import type { Look } from "./world.ts";

/**
 * Coins for one day's tokens. Real days from the leaderboard: 1.5B tokens
 * earns 38, 600M earns 24, 120M earns 10, 10M earns 3.
 */
export const coinsForTokens = (tokens: number): number => Math.floor(Math.sqrt(Math.max(0, tokens) / 1e6));

/** Extra coins for finishing a world day 1st, 2nd or 3rd on tokens. */
export const PODIUM_COINS = [25, 15, 10] as const;

export type Slot = "outfit" | "glasses" | "hat" | "pet";

export interface Item {
  /** `<slot>.<index>`, e.g. `pet.2`. */
  id: string;
  slot: Slot;
  /** The value of `look[slot]` when worn. */
  index: number;
  name: string;
  price: number;
  /** Owned from this level on; never sold. */
  level?: number;
}

/** Outfits below this are free; the ones after are sold. */
export const FREE_OUTFITS = 8;

const item = (slot: Slot, index: number, name: string, price: number): Item => ({
  id: `${slot}.${index}`,
  slot,
  index,
  name,
  price,
});
const reward = (slot: Slot, index: number, name: string, level: number): Item => ({
  ...item(slot, index, name, 0),
  level,
});

export const ITEMS: readonly Item[] = [
  item("outfit", 8, "Hacker hoodie", 150),
  item("outfit", 9, "Sharp suit", 250),
  item("outfit", 10, "Galaxy jacket", 350),
  item("outfit", 11, "Gold suit", 600),
  item("glasses", 1, "Nerd specs", 60),
  item("glasses", 2, "Shades", 100),
  item("glasses", 3, "Heart glasses", 150),
  item("hat", 1, "Beanie", 100),
  item("hat", 2, "Headphones", 180),
  item("hat", 3, "Crown", 500),
  item("pet", 1, "Duck", 250),
  item("pet", 2, "Cat", 400),
  item("pet", 3, "Dog", 400),
  item("pet", 4, "Dragon", 1500),
  item("pet", 5, "Panda", 800),
  reward("hat", 4, "Top hat", 10),
  reward("outfit", 12, "Server-rack armour", 20),
  reward("pet", 6, "Singularity orb", 30),
];

/** The level items `level` has earned. */
export const levelItems = (level: number): Item[] =>
  ITEMS.filter((i) => i.level !== undefined && i.level <= level);

export const itemById = (id: unknown): Item | undefined => ITEMS.find((i) => i.id === id);

/** The shop items a look wears; everything else in it is free. */
export const itemsIn = (look: Look): Item[] => ITEMS.filter((i) => look[i.slot] === i.index);
