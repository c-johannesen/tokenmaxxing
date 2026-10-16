import { describe, expect, test } from "bun:test";
import { ITEMS, levelItems, OFFICE_PIECES, officeCost, parseOffice, STARTER_OFFICE } from "../src/shop.ts";
import { LOOK_OPTIONS } from "../src/world.ts";

test("level items come at 10, 20 and 30, free and wearable", () => {
  expect(levelItems(9)).toEqual([]);
  expect(levelItems(10).map((i) => i.name)).toEqual(["Top hat"]);
  expect(levelItems(30)).toHaveLength(3);
  for (const i of ITEMS.filter((i) => i.level !== undefined)) {
    expect(i.price).toBe(0);
    expect(i.index).toBeLessThan(LOOK_OPTIONS[i.slot]);
  }
});

describe("offices", () => {
  const sofa = { ch: "s", x: 1, y: 1 };
  const rug = { ch: "=", x: 2, y: 1 };

  test("you pay for what's new; moving is free and removing refunds nothing", () => {
    expect(officeCost(STARTER_OFFICE, [...STARTER_OFFICE, sofa, rug])).toBe(110);
    const [desk, chair] = STARTER_OFFICE;
    expect(officeCost(STARTER_OFFICE, [{ ...desk!, x: 8 }, chair!])).toBe(0);
    expect(officeCost(STARTER_OFFICE, [desk!])).toBe(0);
  });

  test("only known pieces on the floor, one per tile, at most OFFICE_PIECES", () => {
    expect(parseOffice([...STARTER_OFFICE, sofa])).toEqual([...STARTER_OFFICE, sofa]);
    expect(parseOffice([{ ch: "s", x: 0, y: 1 }])).toBeNull(); // the wall
    expect(parseOffice([{ ch: "t", x: 10, y: 1 }])).toBeNull(); // half in the wall
    expect(parseOffice([sofa, { ...sofa }])).toBeNull();
    expect(
      parseOffice([
        { ch: "t", x: 1, y: 2 },
        { ch: "p", x: 2, y: 2 },
      ]),
    ).toBeNull(); // the TV's second tile
    expect(parseOffice([{ ch: "W", x: 1, y: 1 }])).toBeNull();
    expect(parseOffice("nope")).toBeNull();
    const floor = Array.from({ length: 70 }, (_, i) => ({
      ch: "=",
      x: 1 + (i % 10),
      y: 1 + Math.floor(i / 10),
    }));
    expect(parseOffice(floor.slice(0, OFFICE_PIECES))).toHaveLength(OFFICE_PIECES);
    expect(parseOffice(floor.slice(0, OFFICE_PIECES + 1))).toBeNull();
  });
});
