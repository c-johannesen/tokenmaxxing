import type { GameMap } from "@tokenmaxxing/core/maps.ts";
import { TILE } from "@tokenmaxxing/core/world.ts";
import { C } from "./palette.ts";
import { bake, hash, Pen } from "./pixels.ts";

/** What a tile's ground is made of. Objects stand on whatever their neighbours are. */
type Ground = "grass" | "path" | "plaza" | "flowers" | "water" | "floor" | "rug" | "wall" | "exit";

const GROUND: Record<string, Ground> = {
  ".": "grass",
  ",": "path",
  ":": "plaza",
  '"': "flowers",
  "~": "water",
  _: "floor",
  "=": "rug",
  W: "wall",
  x: "exit",
  R: "exit",
};

function groundAt(map: GameMap, x: number, y: number): Ground {
  const own = GROUND[map.at(x, y)];
  if (own) return own;
  // Furniture and scenery: take the most common walkable ground around it.
  const counts = new Map<Ground, number>();
  for (const [dx, dy] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [1, 1],
    [-1, 1],
  ] as const) {
    const g = GROUND[map.at(x + dx, y + dy)];
    if (g && g !== "wall" && g !== "water" && g !== "exit") counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ?? (map.id === "town" ? "grass" : "floor");
}

function grass(p: Pen, ox: number, oy: number, x: number, y: number): void {
  p.rect(ox, oy, TILE, TILE, C.grass);
  for (let j = 0; j < TILE; j++)
    for (let i = 0; i < TILE; i++) {
      const h = hash(x * TILE + i, y * TILE + j, 1);
      if (h < 0.035) {
        p.px(ox + i, oy + j, C.grassDark);
        if (j > 0) p.px(ox + i, oy + j - 1, C.grassDark);
      } else if (h < 0.06) p.px(ox + i, oy + j, C.grassLight);
    }
}

function flowers(p: Pen, ox: number, oy: number, x: number, y: number): void {
  grass(p, ox, oy, x, y);
  const colors = [C.flowerRed, C.flowerYellow, C.flowerWhite];
  for (let k = 0; k < 4; k++) {
    const fx = 2 + Math.floor(hash(x, y, 10 + k) * 11);
    const fy = 2 + Math.floor(hash(x, y, 20 + k) * 11);
    const c = colors[Math.floor(hash(x, y, 30 + k) * 3)]!;
    p.rect(ox + fx - 1, oy + fy, 3, 1, c);
    p.rect(ox + fx, oy + fy - 1, 1, 3, c);
    p.px(ox + fx, oy + fy, C.flowerYellow === c ? C.flowerRed : C.flowerYellow);
    p.px(ox + fx, oy + fy + 2, C.leafDark);
  }
}

function speckle(
  p: Pen,
  ox: number,
  oy: number,
  x: number,
  y: number,
  base: string,
  dark: string,
  light: string,
) {
  p.rect(ox, oy, TILE, TILE, base);
  for (let j = 0; j < TILE; j++)
    for (let i = 0; i < TILE; i++) {
      const h = hash(x * TILE + i, y * TILE + j, 2);
      if (h < 0.05) p.px(ox + i, oy + j, dark);
      else if (h < 0.09) p.px(ox + i, oy + j, light);
    }
}

function plaza(p: Pen, ox: number, oy: number, x: number, y: number): void {
  p.rect(ox, oy, TILE, TILE, C.plaza);
  for (let j = 0; j < TILE; j++) {
    const gy = y * TILE + j;
    const offset = Math.floor(gy / 8) % 2 === 0 ? 0 : 4;
    for (let i = 0; i < TILE; i++) {
      const gx = x * TILE + i;
      if (gy % 8 === 0 || (gx + offset) % 8 === 0) p.px(ox + i, oy + j, C.plazaDark);
      else if (gy % 8 === 1 || (gx + offset) % 8 === 1) p.px(ox + i, oy + j, C.plazaLight);
    }
  }
}

function water(p: Pen, map: GameMap, ox: number, oy: number, x: number, y: number): void {
  p.rect(ox, oy, TILE, TILE, C.water);
  for (let j = 0; j < TILE; j++)
    for (let i = 0; i < TILE; i++)
      if (hash(x * TILE + i, y * TILE + j, 3) < 0.04) p.px(ox + i, oy + j, C.waterDark);
  // Shore: foam and a dark lip wherever the water meets land.
  const land = (dx: number, dy: number) => map.at(x + dx, y + dy) !== "~";
  if (land(0, -1)) {
    p.rect(ox, oy, TILE, 2, C.foam);
    p.rect(ox, oy + 2, TILE, 1, C.waterLight);
  }
  if (land(0, 1)) p.rect(ox, oy + TILE - 2, TILE, 2, C.waterDark);
  if (land(-1, 0)) p.rect(ox, oy, 2, TILE, C.foam);
  if (land(1, 0)) p.rect(ox + TILE - 2, oy, 2, TILE, C.foam);
}

function floor(p: Pen, ox: number, oy: number, x: number, y: number): void {
  p.rect(ox, oy, TILE, TILE, C.floor);
  for (let j = 0; j < TILE; j += 4) {
    p.rect(ox, oy + j + 3, TILE, 1, C.floorLine);
    const joint = Math.floor(hash(x, y * 4 + j, 4) * TILE);
    p.rect(ox + joint, oy + j, 1, 3, C.floorDark);
  }
}

function rug(p: Pen, map: GameMap, ox: number, oy: number, x: number, y: number): void {
  p.rect(ox, oy, TILE, TILE, C.rug);
  const edge = (dx: number, dy: number) =>
    map.at(x + dx, y + dy) !== "=" && map.at(x + dx, y + dy) !== "t" && map.at(x + dx, y + dy) !== "s";
  if (edge(0, -1)) p.rect(ox, oy, TILE, 2, C.rugDark);
  if (edge(0, 1)) p.rect(ox, oy + TILE - 2, TILE, 2, C.rugDark);
  if (edge(-1, 0)) p.rect(ox, oy, 2, TILE, C.rugDark);
  if (edge(1, 0)) p.rect(ox + TILE - 2, oy, 2, TILE, C.rugDark);
  if ((x + y) % 2 === 0) {
    p.rect(ox + 7, oy + 4, 2, 8, C.rugLight);
    p.rect(ox + 4, oy + 7, 8, 2, C.rugLight);
  }
}

function wall(p: Pen, map: GameMap, ox: number, oy: number, x: number, y: number): void {
  // The office door is in the wall's face, so the wall above it stays a wall top.
  const face = !"WR".includes(map.at(x, y + 1)) && map.contains(x, y + 1);
  if (!face) {
    p.rect(ox, oy, TILE, TILE, C.wallTop);
    if (hash(x, y, 5) < 0.3) p.rect(ox + 3, oy + 6, 6, 1, C.wallTopLight);
    return;
  }
  p.rect(ox, oy, TILE, TILE, C.wall);
  for (let i = 0; i < TILE; i += 4) p.rect(ox + i, oy + 2, 1, TILE - 5, C.wallDark);
  p.rect(ox, oy, TILE, 2, C.wallTopLight);
  p.rect(ox, oy + TILE - 3, TILE, 3, C.woodDark);
}

function exit(p: Pen, ox: number, oy: number, x: number, y: number): void {
  floor(p, ox, oy, x, y);
  p.rect(ox, oy, 2, TILE, C.woodDark);
  p.rect(ox + TILE - 2, oy, 2, TILE, C.woodDark);
  p.rect(ox + 3, oy + 4, TILE - 6, 8, C.rugLight);
  p.rect(ox + 4, oy + 5, TILE - 8, 6, C.rug);
}

/** One tile's ground, in its place on a canvas of the whole map. */
function paintTile(p: Pen, map: GameMap, x: number, y: number): void {
  const ox = (x - map.x0) * TILE;
  const oy = (y - map.y0) * TILE;
  switch (groundAt(map, x, y)) {
    case "grass":
      grass(p, ox, oy, x, y);
      break;
    case "flowers":
      flowers(p, ox, oy, x, y);
      break;
    case "path":
      speckle(p, ox, oy, x, y, C.path, C.pathDark, C.pathLight);
      break;
    case "plaza":
      plaza(p, ox, oy, x, y);
      break;
    case "water":
      water(p, map, ox, oy, x, y);
      break;
    case "floor":
      floor(p, ox, oy, x, y);
      break;
    case "rug":
      rug(p, map, ox, oy, x, y);
      break;
    case "wall":
      wall(p, map, ox, oy, x, y);
      break;
    case "exit":
      exit(p, ox, oy, x, y);
      break;
  }
}

/** The whole map's ground as one canvas; scenery and people are drawn over it every frame. */
export function bakeGround(map: GameMap): HTMLCanvasElement {
  return bake(map.width * TILE, map.height * TILE, (p) => {
    for (let y = map.y0; y < map.y0 + map.height; y++)
      for (let x = map.x0; x < map.x0 + map.width; x++) paintTile(p, map, x, y);
  });
}

/** Paints just these tiles again, on a ground baked for the same map before a drop came or went. */
export function repaintGround(canvas: HTMLCanvasElement, map: GameMap, tiles: [number, number][]): void {
  const p = new Pen(canvas.getContext("2d")!);
  for (const [x, y] of tiles) {
    if (!map.contains(x, y)) continue;
    p.g.clearRect((x - map.x0) * TILE, (y - map.y0) * TILE, TILE, TILE);
    paintTile(p, map, x, y);
  }
}

/** Moving glints on water, drawn per frame on top of the baked ground. */
export function drawWaterGlints(g: CanvasRenderingContext2D, map: GameMap, t: number): void {
  g.fillStyle = C.waterLight;
  const phase = Math.floor(t / 600);
  for (const [x, y] of waterTiles(map)) {
    if (hash(x, y, phase % 7) > 0.5) continue;
    const i = 2 + Math.floor(hash(x, y, phase) * 9);
    const j = 4 + Math.floor(hash(y, x, phase) * 8);
    g.fillRect(x * TILE + i, y * TILE + j, 3, 1);
  }
}

const waterCache = new WeakMap<GameMap, [number, number][]>();
const waterTiles = (map: GameMap) => {
  const tiles = waterCache.get(map) ?? map.find("~");
  waterCache.set(map, tiles);
  return tiles;
};
