import { describe, expect, test } from "bun:test";
import {
  doorOf,
  frontier,
  type GameMap,
  LEGEND,
  MAPS,
  plotBlock,
  plotId,
  TOWN_SPAWN,
  townMap,
} from "../src/maps.ts";
import { roomEntry } from "../src/world.ts";

/** Tiles you can walk onto or stand next to (to sit, read or open a door) from (x, y). */
function reachable(map: GameMap, x: number, y: number): Set<string> {
  const seen = new Set([`${x},${y}`]);
  const queue = [[x, y] as [number, number]];
  while (queue.length) {
    const [cx, cy] = queue.shift()!;
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const nx = cx + dx!;
      const ny = cy + dy!;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (map.walkable(nx, ny)) queue.push([nx, ny]);
    }
  }
  return seen;
}

describe("maps", () => {
  for (const map of Object.values(MAPS)) {
    test(`${map.id}: rectangular, every tile in the legend`, () => {
      for (const row of map.rows) expect(row.length).toBe(map.width);
      for (const row of map.rows) for (const ch of row) expect(LEGEND[ch]).toBeDefined();
    });
  }

  test("town: grows around its companies, and the spawn reaches every door, bench and the Inn", () => {
    // Companies on every side, with a gap left by one that closed (a park).
    let plots: number[] = [];
    for (let i = 0; i < 12; i++) plots.push(frontier(plots)[i % 3]!);
    plots = plots.filter((_, i) => i !== 4);
    const town = townMap(plots);
    for (const row of town.rows) expect(row.length).toBe(town.width);
    for (const row of town.rows) for (const ch of row) expect(LEGEND[ch]).toBeDefined();
    expect(town.walkable(...TOWN_SPAWN)).toBe(true);
    const seen = reachable(town, ...TOWN_SPAWN);
    expect(town.find("D")).toHaveLength(plots.length);
    for (const plot of plots) {
      expect(town.at(...doorOf(plot))).toBe("D");
      expect(seen.has(doorOf(plot).join(","))).toBe(true);
    }
    for (const ch of ["I", "B", "N", "o"])
      for (const t of town.find(ch)) expect(seen.has(t.join(","))).toBe(true);
    expect(town.x0).toBeLessThan(0);
  });

  test("town: you can build on any empty block next to it, nearest the square first", () => {
    const first = frontier([]);
    expect(first).toHaveLength(8); // around the 2×2 core
    expect(first).not.toContain(plotId(0, 0));
    const next = frontier([plotId(2, 0)]);
    expect(next).toContain(plotId(3, 0));
    expect(next).not.toContain(plotId(2, 0));
    for (const p of next) expect(plotId(...plotBlock(p))).toBe(p);
  });

  for (const id of ["hq", "inn"] as const) {
    test(`${id}: one exit, and every bed and chair is reachable from it`, () => {
      const map = MAPS[id];
      expect(map.find("x")).toHaveLength(1);
      const entry = roomEntry(id === "hq" ? "hq:1" : "inn");
      const seen = reachable(map, entry.x, entry.y);
      for (const ch of ["b", "c"]) for (const t of map.find(ch)) expect(seen.has(t.join(","))).toBe(true);
    });
  }
});
