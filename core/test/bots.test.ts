import { describe, expect, test } from "bun:test";
import { BOTS, type BotDef, chase, lineFor, toCoffee, wander } from "../src/bots.ts";
import { MAX_LEVEL } from "../src/format.ts";
import { MAPS, plotId, townMap } from "../src/maps.ts";
import { worldClock } from "../src/range.ts";
import { CHAT_MAX_LENGTH, DIRS, parseLook } from "../src/world.ts";

describe("bots", () => {
  test("every bot is well formed", () => {
    expect(new Set(BOTS.map((b) => b.id)).size).toBe(BOTS.length);
    for (const b of BOTS) {
      expect(b.id).toBeLessThan(0);
      expect(b.level).toBeLessThanOrEqual(MAX_LEVEL);
      expect(parseLook(b.look)).toEqual(b.look);
      expect(b.lines.length).toBeGreaterThan(0);
      for (const line of b.lines) expect(line.length).toBeLessThanOrEqual(CHAT_MAX_LENGTH);
      expect(b.every[0]).toBeGreaterThan(0);
      expect(b.every[1]).toBeGreaterThanOrEqual(b.every[0]);
    }
  });

  test("wanders over walkable tiles only", () => {
    const town = townMap([plotId(2, 0)]);
    let walks = 0;
    for (let i = 0; i < 200; i++) {
      const path = wander(town, 9, 5);
      if (!path) continue;
      walks++;
      let [x, y] = [9, 5];
      for (const dir of path) {
        x += DIRS[dir][0];
        y += DIRS[dir][1];
        expect(town.walkable(x, y)).toBe(true);
      }
    }
    expect(walks).toBeGreaterThan(50);
  });

  test("chases someone and stops next to them", () => {
    const town = townMap([plotId(2, 0)]);
    let [x, y] = [9, 5];
    const [tx, ty] = [9, 12];
    for (let dir = chase(town, x, y, tx, ty); dir; dir = chase(town, x, y, tx, ty)) {
      x += DIRS[dir][0];
      y += DIRS[dir][1];
      expect(town.walkable(x, y)).toBe(true);
    }
    expect(Math.abs(tx - x) + Math.abs(ty - y)).toBe(1);
  });

  test("walks to the coffee machine and faces it", () => {
    const town = MAPS.town;
    const trip = toCoffee(town, 9, 5)!;
    let [x, y] = [9, 5];
    for (const dir of trip.path) {
      x += DIRS[dir][0];
      y += DIRS[dir][1];
    }
    expect(town.at(x + DIRS[trip.facing][0], y + DIRS[trip.facing][1])).toBe("o");
  });

  test("every bot's lines fit in chat once filled in", () => {
    for (const b of BOTS)
      for (const line of [
        ...(b.followLines ?? []),
        ...(b.coffeeLines ?? []),
        ...(b.moments ?? []).flatMap((m) => m.lines),
      ])
        expect(line.replace("{name}", "x".repeat(32)).length).toBeLessThanOrEqual(CHAT_MAX_LENGTH);
  });
});

describe("what bots say", () => {
  const bot: BotDef = {
    ...BOTS[0]!,
    lines: ["any"],
    followLines: ["@{name} {tokens}", "@{name} hi"],
    coffeeLines: ["{cups} cups"],
    moments: [{ days: [5], from: 17, lines: ["friday night"] }],
  };
  // Friday 2 October 2026, 17:30 in Copenhagen (CEST), and the Thursday before at noon.
  const friday = Date.parse("2026-10-02T15:30:00Z");
  const thursday = Date.parse("2026-10-01T10:00:00Z");
  const low = () => 0;

  test("the world clock is Copenhagen's", () => {
    expect(worldClock(friday)).toEqual({ day: 5, hour: 17 });
    expect(worldClock(Date.parse("2026-10-04T22:30:00Z"))).toEqual({ day: 1, hour: 0 });
  });

  test("coffee first, then whoever it follows, then the time of day", () => {
    const leader = { name: "anna", todayTokens: 4.2e9 };
    expect(lineFor(bot, friday, { leader, cups: 3 }, low)).toBe("3 cups");
    expect(lineFor(bot, friday, { leader }, low)).toBe("@anna 4.2B");
    expect(lineFor(bot, friday, {}, low)).toBe("friday night");
    expect(lineFor(bot, thursday, {}, low)).toBe("any");
    expect(lineFor(bot, friday, {}, () => 0.99)).toBe("any");
  });

  test("no token lines for someone with no tokens today", () => {
    expect(lineFor(bot, thursday, { leader: { name: "bo", todayTokens: 0 } }, low)).toBe("@bo hi");
  });
});
