import { describe, expect, test } from "bun:test";
import { MAPS } from "../src/maps.ts";
import { doorsFor, hqMap, withPieces } from "../src/office.ts";
import { route } from "../src/world.ts";

describe("offices", () => {
  test("doors: 10 to a hallway, by id", () => {
    const owners = [5, 3, 11, 1, 2, 4, 6, 7, 8, 9, 10].map((id) => ({
      userId: id,
      name: `u${id}`,
      open: true,
    }));
    const doors = doorsFor(owners);
    expect(doors.map((d) => d.userId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(doors.slice(0, 10).map((d) => [d.x, d.y])).toEqual(
      [1, 3, 5, 7, 9, 11, 13, 15, 17, 19].map((x) => [x, -2]),
    );
    expect(doors[10]).toMatchObject({ userId: 11, x: 1, y: -5 });
  });

  test("the building: today's floor, with hallways of doors above it, all reachable", () => {
    expect(MAPS.hq.find("R")).toEqual([]);
    expect(hqMap([])).toEqual(MAPS.hq);
    const three = doorsFor([1, 2, 3].map((id) => ({ userId: id, name: `u${id}`, open: true })));
    const map = hqMap(three);
    expect(map.y0).toBe(-3);
    expect(map.find("R")).toEqual(three.map((d) => [d.x, d.y]));
    for (const d of three) expect([map.at(d.x, d.y - 1), map.at(d.x, d.y + 1)]).toEqual(["W", "_"]);
    expect(map.rows.slice(2 - map.y0)).toEqual(MAPS.hq.rows.slice(2)); // the floor, where it was
    const tower = hqMap(
      doorsFor(Array.from({ length: 25 }, (_, i) => ({ userId: i, name: "", open: true }))),
    );
    const [ex, ey] = tower.find("x")[0]!;
    for (const [x, y] of tower.find("R")) expect(route(tower, [ex, ey - 1], [x, y])).not.toBeNull();
  });

  test("furniture is written over floor only: never over a wall or a door", () => {
    const pieces = [
      { ch: "d", x: 0, y: 0 },
      { ch: "d", x: 5, y: 8 },
      { ch: "t", x: 10, y: 1 },
    ];
    const map = withPieces(pieces, MAPS.office);
    expect([map.at(0, 0), map.at(5, 8), map.at(10, 1), map.at(11, 1)]).toEqual(["W", "x", "t", "W"]);
  });
});
