import { describe, expect, test } from "bun:test";
import { doorOf, MAPS, plotId, townMap } from "../src/maps.ts";
import { addDays, dayKey, rangeDays } from "../src/range.ts";
import {
  CUP_MS,
  cupsLeft,
  defaultLook,
  drinkCoffee,
  houseTier,
  MAX_CUPS,
  mentionsIn,
  namesIn,
  outsideDoor,
  parseLook,
  portal,
  RUN_STEP_MS,
  restSpot,
  roomEntry,
  stepTarget,
  takeStep,
} from "../src/world.ts";

describe("steps", () => {
  const town = townMap([plotId(2, 0)]);

  test("walks onto open ground, not into trees, water or furniture", () => {
    expect(stepTarget(town, 9, 5, "down")).toEqual({ kind: "move", x: 9, y: 6 });
    expect(stepTarget(town, 0, 2, "left").kind).toBe("blocked"); // border tree
    expect(stepTarget(town, 8, 4, "right").kind).toBe("blocked"); // fountain
  });

  test("a door is a portal", () => {
    const [x, y] = doorOf(plotId(2, 0));
    expect(stepTarget(town, x, y + 1, "up")).toEqual({ kind: "portal", ch: "D", x, y });
  });

  test("the step budget allows a short burst, then running pace", () => {
    let budget: number | null = 4;
    let t = 0;
    for (let i = 0; i < 4; i++) budget = takeStep(budget!, t, t);
    expect(budget).toBe(0);
    expect(takeStep(0, t, t + 10)).toBeNull(); // teleport-fast
    t += RUN_STEP_MS;
    expect(takeStep(0, 0, t)).not.toBeNull();
  });
});

describe("coffee", () => {
  test("cups stack, wear off, and top out", () => {
    const now = 1_000_000;
    const one = drinkCoffee(0, now);
    expect(cupsLeft(one, now)).toBe(1);
    expect(cupsLeft(drinkCoffee(one, now), now)).toBe(2);
    expect(cupsLeft(one, now + CUP_MS / 2)).toBe(0.5);
    expect(cupsLeft(one, now + CUP_MS * 2)).toBe(0);
    let until = 0;
    for (let i = 0; i < MAX_CUPS + 3; i++) until = drinkCoffee(until, now);
    expect(cupsLeft(until, now)).toBe(MAX_CUPS);
  });
});

describe("portals", () => {
  const plot = plotId(-1, 1);
  const plots = new Map([[plot, { id: 7, name: "Arox" }]]);
  const [x, y] = doorOf(plot);
  const door = { ch: "D", x, y };
  const exit = { ch: "x", x: 0, y: 0 };

  test("your own house lets you in; others are locked; an empty one says so", () => {
    expect(portal("town", door, 7, plots, 1)).toEqual(roomEntry("hq:7"));
    expect(portal("town", door, 8, plots, 1)).toEqual({ notice: "🔒 Arox's house. Members only." });
    expect("notice" in portal("town", door, 7, new Map(), 1)).toBe(true);
  });

  test("leaving a house puts you outside its door; the Inn works for everyone", () => {
    expect(portal("hq:7", exit, 7, plots, 1)).toEqual({ room: "town", x, y: y + 1, facing: "down" });
    expect(portal("town", { ch: "I", x: 13, y: 14 }, null, plots, 1)).toEqual(roomEntry("inn"));
    expect(portal("inn", exit, null, plots, 1)).toEqual(outsideDoor("inn"));
  });

  test("the office door takes you to your own office; its exit to your own building, or the Inn", () => {
    const [rx, ry] = MAPS.hq.find("R")[0]!;
    expect(portal("hq:3", { ch: "R", x: rx, y: ry }, 3, plots, 5)).toEqual(roomEntry("office:5"));
    expect(portal("office:7", exit, 3, plots, 5)).toEqual({ room: "hq:3", x: rx, y: ry + 1, facing: "down" });
    expect(portal("office:7", exit, null, plots, 5)).toEqual(roomEntry("inn"));
  });
});

describe("rest spots", () => {
  test("the first free bed, then the floor", () => {
    const beds = MAPS.hq.find("b");
    const first = restSpot("hq:1", "away", new Set());
    expect([first.x, first.y]).toEqual(beds[0]!);
    const taken = new Set(beds.map(([x, y]) => `${x},${y}`));
    const overflow = restSpot("hq:1", "away", taken);
    expect(MAPS.hq.at(overflow.x, overflow.y)).toBe("_");
  });

  test("working players get a desk chair, facing their screen", () => {
    const spot = restSpot("inn", "working", new Set());
    expect(MAPS.inn.at(spot.x, spot.y)).toBe("c");
    expect(spot.facing).toBe("up");
  });
});

describe("looks and houses", () => {
  test("default looks are valid and parse round-trips", () => {
    for (let i = 0; i < 50; i++) expect(parseLook(defaultLook(i))).toEqual(defaultLook(i));
    expect(parseLook({ style: 99, skin: 0, hair: 0, outfit: 0 })).toBeNull();
  });

  test("houses follow tokens per member, not the team's total", () => {
    expect(houseTier(0, 0)).toBe(0);
    expect(houseTier(2e9, 1)).toBe(2); // one heavy user: a cottage
    expect(houseTier(2e9, 40)).toBe(0); // the same tokens over 40 people: a basement
    expect(houseTier(2e9, 20)).toBe(1); // exactly 100M each: a shack
    expect(houseTier(1e12, 3)).toBe(5);
  });
});

describe("world days", () => {
  test("Copenhagen midnight, across DST", () => {
    expect(dayKey(Date.UTC(2026, 6, 1, 21, 59))).toBe("2026-07-01"); // 23:59 CEST
    expect(dayKey(Date.UTC(2026, 6, 1, 22, 0))).toBe("2026-07-02"); // 00:00 CEST
    expect(dayKey(Date.UTC(2026, 0, 1, 22, 59))).toBe("2026-01-01"); // 23:59 CET
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("ranges are inclusive world days", () => {
    const now = Date.UTC(2026, 8, 29, 12);
    expect(rangeDays("today", now)).toEqual({ from: "2026-09-29", to: "2026-09-29" });
    expect(rangeDays("7d", now)).toEqual({ from: "2026-09-23", to: "2026-09-29" });
    expect(rangeDays("all", now).from).toBeNull();
  });
});

test("mentions in chat need the @; invite fields take names either way", () => {
  expect(mentionsIn("hey @Ada and @bo, not cy")).toEqual(["ada", "bo"]);
  expect(namesIn("@Ada bo, @cy  @ada")).toEqual(["ada", "bo", "cy"]);
  expect(namesIn("  ")).toEqual([]);
});
