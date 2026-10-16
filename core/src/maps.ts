/**
 * The world's maps as character grids. The client draws them and the server
 * checks steps against them, so every tile is defined exactly once, here.
 * One character per tile; `LEGEND` says what it is.
 */

export type MapId = "town" | "hq" | "inn" | "office";
type SeatKind = "bench" | "sofa" | "bed" | "chair";

interface TileKind {
  name: string;
  walk?: true;
  /** E while facing it sits you down (beds lie you down). */
  seat?: SeatKind;
  /** Stepping into it changes room. */
  portal?: true;
  /** Shown when you press E facing it. */
  text?: string;
}

export const LEGEND: Record<string, TileKind> = {
  ".": { name: "grass", walk: true },
  ",": { name: "path", walk: true },
  ":": { name: "plaza", walk: true },
  '"': { name: "flowers", walk: true },
  _: { name: "floor", walk: true },
  "=": { name: "rug", walk: true },
  T: { name: "tree", text: "A tree. It has seen a lot of deploys." },
  "~": { name: "water", text: "The water is calm. Someone dropped a USB stick in there." },
  "^": { name: "bush", text: "Just a bush. It rustles." },
  L: { name: "lamp", text: "The lamp hums quietly. It's always on, like a good server." },
  F: { name: "fountain", text: "A fountain. People toss spare tokens in for luck." },
  N: { name: "board", text: "The leaderboard." },
  B: { name: "bench", seat: "bench", text: "A bench with a view of the square." },
  H: { name: "building" },
  W: { name: "wall" },
  b: { name: "bed", seat: "bed", text: "A bed. Unmade. Someone shipped late last night." },
  d: { name: "desk", text: "A laptop covered in stickers. Four agents are still running." },
  c: { name: "chair", seat: "chair", text: "An ergonomic chair. Your back says thanks." },
  s: { name: "sofa", seat: "sofa", text: "A comfy sofa. Perfect for a quick nap." },
  t: { name: "tv", text: "It's a show about context windows. Season 7." },
  k: { name: "shelf", text: "Books about prompting, caching and cold starts." },
  p: { name: "plant", text: "A healthy plant. Someone remembers to water it." },
  o: { name: "coffee" },
  I: { name: "inn door", portal: true },
  x: { name: "exit", portal: true },
  D: { name: "door", portal: true },
  R: { name: "office door", portal: true, text: "Your office." },
};

/**
 * A map's tiles. `rows[0][0]` is tile (x0, y0): the town grows in every direction, so its tiles keep
 * their coordinates as it does (they can be negative); rooms start at (0, 0).
 */
export class GameMap {
  readonly width: number;
  readonly height: number;

  constructor(
    readonly id: MapId,
    readonly name: string,
    readonly rows: readonly string[],
    readonly x0 = 0,
    readonly y0 = 0,
  ) {
    this.width = rows[0]!.length;
    this.height = rows.length;
  }

  /** Tile character; outside the map reads as a wall. */
  at(x: number, y: number): string {
    return this.rows[y - this.y0]?.[x - this.x0] ?? "W";
  }

  contains(x: number, y: number): boolean {
    return x >= this.x0 && y >= this.y0 && x < this.x0 + this.width && y < this.y0 + this.height;
  }

  /** A tile's slot in a flat array of `width × height`. */
  index(x: number, y: number): number {
    return (y - this.y0) * this.width + (x - this.x0);
  }

  kind(x: number, y: number): TileKind {
    return LEGEND[this.at(x, y)] ?? LEGEND.W!;
  }

  walkable(x: number, y: number): boolean {
    return this.kind(x, y).walk === true;
  }

  /** Every tile with character `ch`, in reading order. */
  find(ch: string): [number, number][] {
    const out: [number, number][] = [];
    this.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === ch) out.push([x + this.x0, y + this.y0]);
    });
    return out;
  }
}

// MARK: The town

/**
 * The town is a grid of blocks. The square, the Inn and the pond are the core (2×2 blocks around
 * block (0, 0)); every company is one block, its plot, which it picks when it starts (any empty block
 * next to the town). The map is exactly the blocks in use, wrapped in trees: it grows as companies
 * start, and gaps left by companies that close become small parks. Each block brings the road along
 * its top and left, so the roads join up; the town's last row and column of road close it off.
 */
export const BLOCK_W = 10;
export const BLOCK_H = 9;

/** Each company house is 7×5 tiles, with its door in the middle of the bottom row. */
export const PLOT_W = 7;
export const PLOT_H = 5;

/** Blocks (0, 0) to (1, 1): the square with the fountain, leaderboard and coffee, the pond and the Inn. */
const CORE = [
  ",,,,,,,,,,,,,,,,,,,,",
  ",..T....,,,....T....",
  ",..L::::::::::::L...",
  ",..:B::::FF::::B:...",
  ",..::N:::FF:::o::...",
  ",..::::::::::::::...",
  ",..L::::::::::::L...",
  ",.......,,,.........",
  ",.......,,,.........",
  ",,,,,,,,,,,,,,,,,,,,",
  ",.^....,....T.......",
  ",..~~~~,..HHHHHHH...",
  ",.~~~~~,..HHHHHHH...",
  ",.~~~~~,..HHHHHHH...",
  ",..~~~.,..HHHIHHH...",
  ',.."...,.....,......',
  ",..T...,,,,,,,......",
  ',..........".....^..',
];
export const CORE_BLOCKS: [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

/** A company's block: its house, and a path from the door down to the next road. */
const LOT = [
  ",,,,,,,,,,",
  ",.........",
  ",.HHHHHHH.",
  ",.HHHHHHH.",
  ",.HHHHHHH.",
  ",.HHHHHHH.",
  ",.HHHDHHH.",
  ",....,....",
  ",....,....",
];
/** Where the door is in a LOT. */
const DOOR: [number, number] = [5, 6];

/** Empty blocks inside the town: small parks. */
const PARKS = [
  [
    ",,,,,,,,,,",
    ",.........",
    ',..T....".',
    ",....^....",
    ',.".....T.',
    ",.........",
    ',..T..."..',
    ",.........",
    ",.....^...",
  ],
  [
    ",,,,,,,,,,",
    ',...."....',
    ",.T.....T.",
    ",.........",
    ',...".^...',
    ",.........",
    ",.T.....T.",
    ',......"..',
    ",.........",
  ],
];

/** A plot's number stands for its block: (by + 500) · 1000 + (bx + 500). */
export const plotId = (bx: number, by: number): number => (by + 500) * 1000 + (bx + 500);
export const plotBlock = (plot: number): [number, number] => [
  (plot % 1000) - 500,
  Math.floor(plot / 1000) - 500,
];
export const blockOf = (x: number, y: number): [number, number] => [
  Math.floor(x / BLOCK_W),
  Math.floor(y / BLOCK_H),
];

const isCore = (bx: number, by: number) => CORE_BLOCKS.some(([cx, cy]) => cx === bx && cy === by);

/** A company's front door, in town tiles. */
export function doorOf(plot: number): [number, number] {
  const [bx, by] = plotBlock(plot);
  return [bx * BLOCK_W + DOOR[0], by * BLOCK_H + DOOR[1]];
}

/**
 * Where a new company can build: every empty block next to the town (sharing an edge with the core
 * or a company), nearest the square first.
 */
export function frontier(plots: readonly number[]): number[] {
  const used = new Set([...plots, ...CORE_BLOCKS.map(([x, y]) => plotId(x, y))]);
  const out = new Set<number>();
  for (const id of used) {
    const [bx, by] = plotBlock(id);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = plotId(bx + dx, by + dy);
      if (!used.has(next)) out.add(next);
    }
  }
  // From the middle of the core: the corner where its four blocks meet.
  const distance = (id: number) => {
    const [bx, by] = plotBlock(id);
    return Math.hypot(bx + 0.5 - 1, by + 0.5 - 1);
  };
  return [...out].sort((a, b) => distance(a) - distance(b) || a - b);
}

/** The town for these company plots. */
export function townMap(plots: readonly number[]): GameMap {
  const blocks = [...CORE_BLOCKS, ...plots.map(plotBlock)];
  const minBx = Math.min(...blocks.map(([x]) => x));
  const maxBx = Math.max(...blocks.map(([x]) => x));
  const minBy = Math.min(...blocks.map(([, y]) => y));
  const maxBy = Math.max(...blocks.map(([, y]) => y));
  // One tree ring around it all, and the closing road along the right and bottom.
  const x0 = minBx * BLOCK_W - 1;
  const y0 = minBy * BLOCK_H - 1;
  const width = (maxBx - minBx + 1) * BLOCK_W + 3;
  const height = (maxBy - minBy + 1) * BLOCK_H + 3;
  const grid = Array.from({ length: height }, () => Array<string>(width).fill("."));
  const put = (x: number, y: number, ch: string) => {
    grid[y - y0]![x - x0] = ch;
  };
  const taken = new Set(plots);
  for (let by = minBy; by <= maxBy; by++)
    for (let bx = minBx; bx <= maxBx; bx++) {
      const rows = isCore(bx, by)
        ? CORE.slice((by - 0) * BLOCK_H, (by + 1) * BLOCK_H).map((r) =>
            r.slice(bx * BLOCK_W, (bx + 1) * BLOCK_W),
          )
        : taken.has(plotId(bx, by))
          ? LOT
          : PARKS[Math.abs(bx * 7 + by * 13) % PARKS.length]!;
      rows.forEach((row, dy) => {
        for (let dx = 0; dx < BLOCK_W; dx++) put(bx * BLOCK_W + dx, by * BLOCK_H + dy, row[dx]!);
      });
    }
  const right = (maxBx + 1) * BLOCK_W;
  const bottom = (maxBy + 1) * BLOCK_H;
  for (let y = minBy * BLOCK_H; y <= bottom; y++) put(right, y, ",");
  for (let x = minBx * BLOCK_W; x <= right; x++) put(x, bottom, ",");
  for (let x = x0; x < x0 + width; x++) {
    put(x, y0, "T");
    put(x, y0 + height - 1, "T");
  }
  for (let y = y0; y < y0 + height; y++) {
    put(x0, y, "T");
    put(x0 + width - 1, y, "T");
  }
  return new GameMap(
    "town",
    "Town square",
    grid.map((r) => r.join("")),
    x0,
    y0,
  );
}

/**
 * Rebuilds the town for these company plots. ponytail: one town per process (the world actor on the
 * server, the page in a browser), so it's kept in MAPS like the fixed rooms.
 */
export function setTown(plots: readonly number[]): GameMap {
  MAPS.town = townMap(plots);
  return MAPS.town;
}

/** Where you arrive in town: the middle of the square. */
export const TOWN_SPAWN: [number, number] = [9, 5];

export const MAPS: Record<MapId, GameMap> = {
  // Rebuilt from the companies in it (setTown); until then, just the square.
  town: townMap([]),
  hq: new GameMap("hq", "Company house", [
    "WWWWWWWWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWRWWWWWWWW",
    "Wkk_b_b_b_b_p__dddd_oW",
    "W______________cccc__W",
    "W____________________W",
    "W___b_b_b_b__________W",
    "W______________dddd__W",
    "W______________cccc__W",
    "W____________________W",
    "W__==tt==____________W",
    "W__======____________W",
    "W__=ssss=____________W",
    "Wp__________________pW",
    "WWWWWWWWWWWxWWWWWWWWWW",
  ]),
  inn: new GameMap("inn", "The Inn", [
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "W_b_b_b_b__okkpW",
    "W______________W",
    "W______________W",
    "W_b_b_b_b_dddd_W",
    "W_________cccc_W",
    "W______________W",
    "Wp____________pW",
    "WWWWWWWxWWWWWWWW",
  ]),
  // Everyone's office, before their furniture goes in (officeMap). ponytail: one template; bigger
  // offices per house tier would be an `OFFICE_SIZES` table.
  office: new GameMap("office", "Office", [
    "WWWWWWWWWWWW",
    "W__________W",
    "W__________W",
    "W__________W",
    "W__________W",
    "W__________W",
    "W__________W",
    "W__________W",
    "WWWWWxWWWWWW",
  ]),
};
