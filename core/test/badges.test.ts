import { expect, test } from "bun:test";
import { type BadgeFacts, badgesFor, streakOf } from "../src/badges.ts";

const none: BadgeFacts = {
  streak: 0,
  bestDay: 0,
  podiums: 0,
  peakAgents: 0,
  prs: 0,
  wins: 0,
  biggestPot: 0,
  founder: false,
};

test("streaks count back from today, or from yesterday before today's first tokens, and stop at a gap", () => {
  const days = new Set(["2026-09-27", "2026-09-29", "2026-09-30", "2026-10-01"]);
  expect(streakOf(days, "2026-10-01")).toBe(3);
  expect(streakOf(days, "2026-10-02")).toBe(3);
  expect(streakOf(days, "2026-10-03")).toBe(0);
  expect(streakOf(new Set(), "2026-10-01")).toBe(0);
});

test("badges show the highest tier met, and nothing below the first", () => {
  expect(badgesFor(none)).toEqual([]);
  expect(badgesFor({ ...none, streak: 31 })).toEqual([
    { id: "streak", emoji: "🔥", label: "30-day streak", tier: 2 },
  ]);
  expect(badgesFor({ ...none, founder: true })).toEqual([
    { id: "founder", emoji: "🏢", label: "Founder", tier: 1 },
  ]);
});
