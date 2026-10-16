import { expect, test } from "bun:test";
import {
  clock,
  hoursText,
  levelAt,
  levelFor,
  levelTitle,
  minutesText,
  plural,
  secondsUntil,
} from "../src/format.ts";

test("clocks, durations and plurals", () => {
  expect(clock(65_000)).toBe("1:05");
  expect(clock(3_725_000)).toBe("1:02:05");
  expect(clock(-5)).toBe("0:00");
  expect(secondsUntil(1_500, 0)).toBe(2);
  expect(secondsUntil(0, 10)).toBe(0);
  expect(hoursText(0.5)).toBe("30m");
  expect(hoursText(3 + 25 / 60)).toBe("3h 25m");
  expect(minutesText(15)).toBe("15 min");
  expect(minutesText(60)).toBe("1 hour");
  expect(minutesText(1440)).toBe("24 hours");
  expect(plural(1, "game")).toBe("1 game");
  expect(plural(2, "PR")).toBe("2 PRs");
});

test("levelAt is where levelFor ticks over, up to Singularity at 30", () => {
  expect(levelAt(0)).toBe(0);
  expect(levelAt(1)).toBe(1e6);
  expect(levelAt(7)).toBe(1e9);
  expect(levelAt(10)).toBe(10e9);
  expect(levelAt(30)).toBe(30e9);
  expect(levelAt(31)).toBe(Infinity);
  expect(levelFor(31e9)).toBe(30);
  expect(levelTitle(13)).toBe("Examaxxer");
  expect(levelTitle(30)).toBe("Singularity");
  expect(levelTitle(99)).toBe("Singularity");
  for (let level = 1; level <= 30; level++) {
    expect(levelFor(levelAt(level))).toBe(level);
    expect(levelFor(levelAt(level) - 1)).toBe(level - 1);
  }
});
