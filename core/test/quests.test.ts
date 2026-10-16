import { expect, test } from "bun:test";
import { type DayFacts, EMPTY_DAY, QUESTS, questCoins } from "../src/quests.ts";

/** Each quest's threshold, as the one fact it checks. */
const AT: Record<string, [keyof DayFacts, number]> = {
  parallel: ["peakAgents", 5],
  hours: ["activeBuckets", 24],
};

test("each quest is done at its threshold, not one below", () => {
  expect(QUESTS.map((q) => q.id)).toEqual(Object.keys(AT));
  for (const q of QUESTS) {
    const [fact, n] = AT[q.id]!;
    expect(q.done(EMPTY_DAY)).toBe(false);
    expect(q.done({ ...EMPTY_DAY, [fact]: n })).toBe(true);
    expect(q.done({ ...EMPTY_DAY, [fact]: n - 1 })).toBe(false);
  }
});

test("a full day pays 7, an empty one nothing", () => {
  expect(questCoins({ tokens: 500e6, peakAgents: 5, activeBuckets: 24 })).toBe(7);
  expect(questCoins(EMPTY_DAY)).toBe(0);
});
