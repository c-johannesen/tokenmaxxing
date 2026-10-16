/**
 * Daily quests: the same four every day, paid in coins on top of the usual pay
 * (at most 14). Nothing is stored: a quest is done when the day's rollups pass its check.
 */

/** One day's rollups: tokens from `usage_daily`, the rest from `activity_daily`. */
export interface DayFacts {
  tokens: number;
  peakAgents: number;
  /** 5-minute buckets with at least one agent running. */
  activeBuckets: number;
  prs: number;
}

export interface Quest {
  id: string;
  text: string;
  coins: number;
  done: (f: DayFacts) => boolean;
}

// ponytail: fixed thresholds. 500M is a quiet day for a heavy user and a big one for a light
// user; scale them to the player's 30-day median if it matters.
export const QUESTS: readonly Quest[] = [
  { id: "tokens", text: "Burn 500M tokens", coins: 5, done: (f) => f.tokens >= 500e6 },
  { id: "parallel", text: "Run 5 agents at once", coins: 5, done: (f) => f.peakAgents >= 5 },
  // 24 buckets of 5 minutes.
  { id: "hours", text: "Keep agents running for 2 hours", coins: 2, done: (f) => f.activeBuckets >= 24 },
  { id: "prs", text: "Open 2 pull requests", coins: 2, done: (f) => f.prs >= 2 },
];

export const EMPTY_DAY: DayFacts = { tokens: 0, peakAgents: 0, activeBuckets: 0, prs: 0 };

/** Coins a day paid: the sum over the quests that are done. */
export const questCoins = (f: DayFacts): number => QUESTS.reduce((n, q) => n + (q.done(f) ? q.coins : 0), 0);
