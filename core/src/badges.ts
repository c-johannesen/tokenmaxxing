/** Badges on the player card: worked out on read from a player's facts, never stored or claimed. */
import { plural } from "./format.ts";
import { addDays } from "./range.ts";

export interface BadgeFacts {
  /** World days in a row with tokens, ending today or yesterday. */
  streak: number;
  /** Tokens on the best single day. */
  bestDay: number;
  /** Days finished in the top 3. */
  podiums: number;
  peakAgents: number;
  prs: number;
  wins: number;
  biggestPot: number;
  founder: boolean;
}

export interface BadgeDef {
  id: string;
  emoji: string;
  name: string;
  /** Ascending; the label for each. */
  tiers: { at: number; label: string }[];
  of: (f: BadgeFacts) => number;
}

export interface Badge {
  id: string;
  emoji: string;
  label: string;
  /** 1-based tier reached. */
  tier: number;
}

export const BADGES: readonly BadgeDef[] = [
  {
    id: "streak",
    emoji: "🔥",
    name: "Streak",
    tiers: [7, 30, 100].map((at) => ({ at, label: `${at}-day streak` })),
    of: (f) => f.streak,
  },
  {
    id: "bigday",
    emoji: "🧠",
    name: "Big day",
    tiers: [1, 5, 10].map((b) => ({ at: b * 1e9, label: `${b}B-token day` })),
    of: (f) => f.bestDay,
  },
  {
    id: "podium",
    emoji: "🏆",
    name: "Podium",
    tiers: [1, 10, 50].map((at) => ({ at, label: plural(at, "podium") })),
    of: (f) => f.podiums,
  },
  {
    id: "octopus",
    emoji: "🐙",
    name: "Octopus",
    tiers: [5, 10, 20].map((at) => ({ at, label: `${at} agents at once` })),
    of: (f) => f.peakAgents,
  },
  {
    id: "shipper",
    emoji: "🚢",
    name: "Shipper",
    tiers: [10, 50, 250].map((at) => ({ at, label: plural(at, "PR") })),
    of: (f) => f.prs,
  },
  {
    id: "shark",
    emoji: "🦈",
    name: "Shark",
    tiers: [5, 25, 100].map((at) => ({ at, label: plural(at, "win") })),
    of: (f) => f.wins,
  },
  {
    id: "whale",
    emoji: "🐋",
    name: "Whale",
    tiers: [500, 2000].map((at) => ({ at, label: `${at}-coin pot` })),
    of: (f) => f.biggestPot,
  },
  {
    id: "founder",
    emoji: "🏢",
    name: "Founder",
    tiers: [{ at: 1, label: "Founder" }],
    of: (f) => +f.founder,
  },
];

/** The highest tier met of each badge; badges below their first tier are left out. */
export const badgesFor = (f: BadgeFacts): Badge[] =>
  BADGES.flatMap((b) => {
    const tier = b.tiers.filter((t) => b.of(f) >= t.at).length;
    return tier ? [{ id: b.id, emoji: b.emoji, label: b.tiers[tier - 1]!.label, tier }] : [];
  });

/** Current streak from the set of `YYYY-MM-DD` days with tokens: counts back from `today`, or from yesterday if today has none yet. */
export function streakOf(days: Set<string>, today: string): number {
  let n = 0;
  for (let day = days.has(today) ? today : addDays(today, -1); days.has(day); day = addDays(day, -1)) n++;
  return n;
}
