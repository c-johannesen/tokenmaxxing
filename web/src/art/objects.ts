import type { GameMap } from "@tokenmaxxing/core/maps.ts";
import { TILE } from "@tokenmaxxing/core/world.ts";
import { C } from "./palette.ts";
import { bake, cached } from "./pixels.ts";

/** A baked sprite and where it sits relative to its tile's top-left corner. */
export interface Placed {
  canvas: HTMLCanvasElement;
  dx: number;
  dy: number;
}

const tree = cached(
  () => "tree",
  () =>
    bake(16, 26, (p) => {
      p.rect(3, 23, 10, 2, C.shadow);
      p.rect(6, 16, 4, 8, C.trunkDark);
      p.rect(7, 16, 2, 7, C.trunk);
      p.disc(8, 9, 8, C.leafInk);
      p.disc(8, 9, 7, C.leafDark);
      p.disc(7, 8, 6, C.leaf);
      p.disc(5, 5, 2, C.leafLight);
      for (const [x, y] of [
        [10, 5],
        [4, 10],
        [11, 11],
        [8, 13],
        [12, 8],
      ] as const)
        p.px(x, y, C.leafDark);
      for (const [x, y] of [
        [9, 3],
        [3, 7],
        [6, 11],
      ] as const)
        p.px(x, y, C.leafLight);
    }),
);

const bush = cached(
  () => "bush",
  () =>
    bake(16, 16, (p) => {
      p.rect(3, 14, 10, 2, C.shadow);
      p.disc(8, 9, 6, C.leafInk);
      p.disc(8, 9, 5, C.leafDark);
      p.disc(7, 8, 4, C.leaf);
      p.px(5, 6, C.leafLight);
      p.px(6, 5, C.leafLight);
      p.px(10, 10, C.leafDark);
    }),
);

const lamp = cached(
  () => "lamp",
  () =>
    bake(16, 32, (p) => {
      p.rect(4, 29, 8, 2, C.shadow);
      p.rect(5, 27, 6, 3, C.metal);
      p.rect(7, 8, 2, 20, C.metal);
      p.rect(7, 8, 1, 20, C.metalLight);
      p.rect(4, 1, 8, 1, C.metal);
      p.rect(4, 2, 8, 6, C.ink);
      p.rect(5, 3, 6, 4, C.lamp);
      p.rect(5, 3, 2, 1, C.white);
    }),
);

const fountain = cached(
  () => "fountain",
  () =>
    bake(32, 32, (p) => {
      p.disc(16, 18, 15, C.stoneDark);
      p.disc(16, 17, 14, C.stone);
      p.disc(16, 17, 12, C.stoneLight);
      p.disc(16, 17, 11, C.waterDark);
      p.disc(16, 16, 10, C.water);
      p.disc(16, 15, 3, C.stoneDark);
      p.disc(16, 14, 3, C.stoneLight);
      p.rect(15, 4, 3, 10, C.stone);
      p.rect(15, 4, 1, 10, C.stoneLight);
      p.disc(16, 4, 2, C.waterLight);
    }),
);

const board = cached(
  () => "board",
  () =>
    bake(16, 26, (p) => {
      p.rect(2, 24, 12, 2, C.shadow);
      p.rect(3, 14, 2, 11, C.woodDark);
      p.rect(11, 14, 2, 11, C.woodDark);
      p.rect(0, 1, 16, 15, C.ink);
      p.rect(1, 2, 14, 13, C.woodDark);
      p.rect(2, 3, 12, 11, C.wood);
      p.rect(3, 4, 6, 8, C.white);
      for (let y = 6; y < 12; y += 2) p.rect(4, y, 4, 1, C.stoneDark);
      // A little trophy: it's the leaderboard.
      p.rect(10, 5, 3, 3, C.flowerYellow);
      p.px(9, 5, C.flowerYellow);
      p.px(13, 5, C.flowerYellow);
      p.rect(11, 8, 1, 2, C.flowerYellow);
      p.rect(10, 10, 3, 1, C.woodDark);
    }),
);

const bench = cached(
  () => "bench",
  () =>
    bake(16, 16, (p) => {
      p.rect(1, 13, 14, 2, C.shadow);
      p.rect(1, 2, 14, 1, C.ink);
      p.rect(1, 3, 14, 3, C.woodDark);
      p.rect(1, 3, 14, 1, C.wood);
      p.rect(0, 7, 16, 5, C.ink);
      p.rect(1, 7, 14, 4, C.wood);
      p.rect(1, 9, 14, 1, C.woodDark);
      p.rect(2, 11, 2, 3, C.woodDark);
      p.rect(12, 11, 2, 3, C.woodDark);
    }),
);

export const bed = cached(
  () => "bed",
  () =>
    bake(16, 16, (p) => {
      p.rect(1, 0, 14, 16, C.ink);
      p.rect(2, 1, 12, 14, C.woodDark);
      p.rect(3, 1, 10, 14, C.white);
      p.rect(4, 2, 8, 4, C.pillow);
      p.rect(4, 5, 8, 1, C.stoneLight);
      p.rect(3, 7, 10, 8, C.fabric);
      p.rect(3, 7, 10, 1, C.fabricDark);
      p.rect(3, 14, 10, 1, C.fabricDark);
    }),
);

const desk = cached(
  () => "desk",
  () =>
    bake(16, 18, (p) => {
      p.rect(0, 6, 16, 12, C.ink);
      p.rect(0, 7, 16, 4, C.woodLight);
      p.rect(0, 11, 16, 5, C.wood);
      p.rect(0, 16, 2, 2, C.woodDark);
      p.rect(14, 16, 2, 2, C.woodDark);
      // Laptop, screen glowing: someone's agents are running.
      p.rect(4, 0, 8, 7, C.ink);
      p.rect(5, 1, 6, 5, C.screen);
      p.rect(5, 2, 3, 1, C.white);
      p.rect(5, 4, 5, 1, "#5fc6e8");
      p.rect(3, 7, 10, 2, C.metalLight);
      p.rect(3, 9, 10, 1, C.metal);
    }),
);

export const chairBack = cached(
  () => "chairBack",
  () =>
    bake(16, 16, (p) => {
      p.rect(4, 9, 8, 6, C.ink);
      p.rect(5, 10, 6, 4, C.fabricDark);
      p.rect(7, 15, 2, 1, C.metal);
    }),
);

const chair = cached(
  () => "chair",
  () =>
    bake(16, 16, (p) => {
      p.rect(4, 4, 8, 6, C.ink);
      p.rect(5, 5, 6, 4, C.fabric);
      p.rect(4, 9, 8, 6, C.ink);
      p.rect(5, 10, 6, 4, C.fabricDark);
      p.rect(7, 15, 2, 1, C.metal);
    }),
);

const sofa = cached(
  (left: boolean, right: boolean) => `sofa${+left}${+right}`,
  (left: boolean, right: boolean) =>
    bake(16, 16, (p) => {
      p.rect(0, 1, 16, 14, C.ink);
      p.rect(0, 2, 16, 5, C.fabricDark);
      p.rect(0, 7, 16, 6, C.fabric);
      p.rect(0, 12, 16, 2, C.fabricDark);
      if (left) {
        p.rect(0, 1, 4, 14, C.ink);
        p.rect(1, 3, 2, 10, C.fabricDark);
      }
      if (right) {
        p.rect(12, 1, 4, 14, C.ink);
        p.rect(13, 3, 2, 10, C.fabricDark);
      }
    }),
);

const tv = cached(
  () => "tv",
  () =>
    bake(32, 18, (p) => {
      p.rect(1, 11, 30, 7, C.ink);
      p.rect(2, 12, 28, 5, C.woodDark);
      p.rect(4, 0, 24, 12, C.ink);
      p.rect(5, 1, 22, 9, "#2f6f96");
      p.rect(5, 6, 22, 4, "#4f9b3d");
      p.disc(21, 4, 2, C.lamp);
      p.rect(14, 10, 4, 2, C.metal);
    }),
);

const shelf = cached(
  () => "shelf",
  () =>
    bake(16, 26, (p) => {
      p.rect(0, 0, 16, 26, C.ink);
      p.rect(1, 1, 14, 24, C.woodDark);
      const books = [C.rug, C.fabric, C.flowerYellow, C.leaf, C.white, "#9b6fd6", C.rugLight];
      for (const row of [2, 10, 18]) {
        let x = 2;
        let i = row;
        while (x < 14) {
          const w = 1 + (i % 2);
          p.rect(x, row + (i % 3 === 0 ? 1 : 0), w, 6 - (i % 3 === 0 ? 1 : 0), books[i % books.length]!);
          x += w + (i % 4 === 0 ? 1 : 0);
          i++;
        }
        p.rect(1, row + 6, 14, 1, C.wood);
      }
    }),
);

const plant = cached(
  () => "plant",
  () =>
    bake(16, 20, (p) => {
      p.rect(4, 18, 8, 2, C.shadow);
      p.rect(4, 12, 8, 7, C.ink);
      p.rect(5, 13, 6, 5, "#c2703d");
      p.rect(5, 13, 6, 1, "#e08e57");
      p.disc(8, 7, 5, C.leafInk);
      p.disc(8, 7, 4, C.leaf);
      p.disc(6, 5, 2, C.leafLight);
      p.px(10, 9, C.leafDark);
    }),
);

const coffee = cached(
  () => "coffee",
  () =>
    bake(16, 22, (p) => {
      p.rect(3, 2, 10, 18, C.ink);
      p.rect(4, 3, 8, 16, C.metal);
      p.rect(4, 3, 8, 3, C.metalLight);
      p.px(10, 7, C.rug);
      p.rect(6, 9, 4, 2, C.ink);
      p.rect(6, 14, 4, 4, C.white);
      p.rect(10, 15, 1, 2, C.white);
    }),
);

/** Something dropped on the floor (a wearable): a small box with a bow. */
export const parcel = cached(
  () => "parcel",
  () =>
    bake(12, 11, (p) => {
      p.rect(1, 9, 10, 2, C.shadow);
      p.rect(1, 3, 10, 7, C.ink);
      p.rect(2, 4, 8, 5, C.fabric);
      p.rect(2, 4, 8, 1, C.screen);
      p.rect(5, 3, 2, 7, C.flowerYellow);
      // The bow.
      p.rect(2, 0, 3, 3, C.ink);
      p.rect(7, 0, 3, 3, C.ink);
      p.px(3, 1, C.flowerYellow);
      p.px(8, 1, C.flowerYellow);
      p.rect(5, 1, 2, 2, C.flowerYellow);
    }),
);

const at = (canvas: HTMLCanvasElement, dx = 0, dy = TILE - canvas.height): Placed => ({ canvas, dx, dy });

/** Maps are fixed, so each map's objects are worked out once (the render loop asks every frame). */
const placed = new WeakMap<GameMap, (Placed | null | undefined)[]>();

/**
 * The scenery or furniture on tile (x, y), if it draws anything. Multi-tile
 * things (fountain, TV) draw once from their top-left tile.
 */
export function objectAt(map: GameMap, x: number, y: number): Placed | null {
  let cells = placed.get(map);
  if (!cells) {
    cells = [];
    placed.set(map, cells);
  }
  const i = map.index(x, y);
  if (cells[i] === undefined) cells[i] = placeObject(map, x, y);
  return cells[i];
}

function placeObject(map: GameMap, x: number, y: number): Placed | null {
  const ch = map.at(x, y);
  switch (ch) {
    case "T":
      return at(tree());
    case "^":
      return at(bush());
    case "L":
      return at(lamp());
    case "N":
      return at(board());
    case "B":
      return at(bench());
    case "F":
      return map.at(x - 1, y) !== "F" && map.at(x, y - 1) !== "F" ? at(fountain(), 0, 0) : null;
    case "b":
      return at(bed());
    case "d":
      return at(desk());
    case "c":
      return at(chair());
    case "s":
      return at(sofa(map.at(x - 1, y) !== "s", map.at(x + 1, y) !== "s"));
    case "t": {
      // Two tiles each: in a run of them (TVs side by side), every other tile starts one.
      let n = 0;
      while (map.at(x - n - 1, y) === "t") n++;
      return n % 2 === 0 ? at(tv()) : null;
    }
    case "k":
      return at(shelf());
    case "p":
      return at(plant());
    case "o":
      return at(coffee());
    default:
      return null;
  }
}

/** Where on the tile the object's "feet" are, for depth sorting against people. */
export const sortY = (ch: string): number =>
  ch === "F" ? TILE * 2 - 2 : ch === "b" || ch === "s" ? 0 : TILE - 1;
