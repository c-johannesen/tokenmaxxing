/**
 * Daily quests: the same two every day, paid in coins on top of the usual pay
 * (at most 7). Nothing is stored: a quest is done when the day's rollups pass its check.
 */

/** One day's rollups: tokens from `usage_daily`, the rest from `activity_daily`. */
export interface DayFacts {
  tokens: number;
  peakAgents: number;
  /** 5-minute buckets with at least one agent running. */
  activeBuckets: number;
}

export interface Quest {
  id: string;
  text: string;
  coins: number;
  done: (f: DayFacts) => boolean;
}

// ponytail: fixed thresholds; scale them to the player's 30-day median if it matters.
export const QUESTS: readonly Quest[] = [
  { id: "parallel", text: "Run 5 agents at once", coins: 5, done: (f) => f.peakAgents >= 5 },
  // 24 buckets of 5 minutes.
  { id: "hours", text: "Keep agents running for 2 hours", coins: 2, done: (f) => f.activeBuckets >= 24 },
];

export const EMPTY_DAY: DayFacts = { tokens: 0, peakAgents: 0, activeBuckets: 0 };

/** Coins a day paid: the sum over the quests that are done. */
export const questCoins = (f: DayFacts): number => QUESTS.reduce((n, q) => n + (q.done(f) ? q.coins : 0), 0);
