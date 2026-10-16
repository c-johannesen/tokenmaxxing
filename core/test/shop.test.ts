import { expect, test } from "bun:test";
import { ITEMS, levelItems } from "../src/shop.ts";
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
