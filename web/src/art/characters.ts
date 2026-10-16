import type { Item } from "@tokenmaxxing/core/shop.ts";
import type { Facing, Look, PlayerState } from "@tokenmaxxing/core/world.ts";
import { C, HAIRS, OUTFITS, PANTS, SKINS } from "./palette.ts";
import { bake, cached, type Palette } from "./pixels.ts";

/**
 * Characters are a head (one of four styles) on a body, 16×16, recoloured per
 * look. `o` outline, `s` skin, `e` eyes, `r` blush, `h`/`H` hair, `c`/`C`
 * outfit (and caps), `p` trousers, `f` shoes. Glasses and hats from the shop
 * are drawn over the head.
 */

type View = "down" | "side" | "up";
type Pose = "stand" | "walkA" | "walkB" | "sit";

// biome-ignore format: pixel art reads as a grid
const HEADS: Record<View, string[][]> = {
  down: [
    [
      "................",
      ".....oooooo.....",
      "....ohhhhhho....",
      "...ohhhhhhhho...",
      "...ohHhhhhHho...",
      "...ohssssssho...",
      "...osesssseso...",
      "...osrssssrso...",
      "....osssssso....",
    ],
    [
      "................",
      ".....oooooo.....",
      "....occcccco....",
      "...occcccccco...",
      "..oCCCCCCCCCCo..",
      "...ohssssssho...",
      "...osesssseso...",
      "...osrssssrso...",
      "....osssssso....",
    ],
    [
      "......oooo......",
      ".....ohhhho.....",
      "....ohhhhhho....",
      "...ohhhhhhhho...",
      "...ohhhhhhhho...",
      "...ohssssssho...",
      "...osesssseso...",
      "...osrssssrso...",
      "....osssssso....",
    ],
    [
      "................",
      ".....oooooo.....",
      "....ohhhhhho....",
      "...ohhhhhhhho...",
      "...ohhhhhhhho...",
      "..ohhssssssHho..",
      "..ohsesssseho...",
      "..ohsrssssrho...",
      "..ohhssssssHho..",
    ],
  ],
  side: [
    [
      "................",
      ".....oooooo.....",
      "....ohhhhhho....",
      "...ohhhhhhhho...",
      "...ohhhhhhHso...",
      "...ohhhhsssso...",
      "...ohhhssseso...",
      "...oHhsssrsso...",
      "....ohssssso....",
    ],
    [
      "................",
      ".....oooooo.....",
      "....occcccco....",
      "...occcccccco...",
      "...occcccCCCCCo.",
      "...ohhhhsssso...",
      "...ohhhssseso...",
      "...oHhsssrsso...",
      "....ohssssso....",
    ],
    [
      "...ooo..........",
      "..ohhoooooo.....",
      "..ohhhhhhhho....",
      "...ohhhhhhhho...",
      "...ohhhhhhhso...",
      "...ohhhhsssso...",
      "...ohhhssseso...",
      "...oHhsssrsso...",
      "....ohssssso....",
    ],
    [
      "................",
      ".....oooooo.....",
      "....ohhhhhho....",
      "...ohhhhhhhho...",
      "..ohhhhhhhhso...",
      "..ohhhhhsssso...",
      "..ohhhhssseso...",
      "..ohhHhsssrso...",
      "..ohhhoossso....",
    ],
  ],
  up: [
    [
      "................",
      ".....oooooo.....",
      "....ohhhhhho....",
      "...ohhhhhhhho...",
      "...ohhhhhhhho...",
      "...ohhhhhhhho...",
      "...ohHhhhhHho...",
      "...oshhhhhhso...",
      "....osssssso....",
    ],
    [
      "................",
      ".....oooooo.....",
      "....occcccco....",
      "...occcccccco...",
      "...occcccccco...",
      "...oCCCCCCCCo...",
      "...ohhhhhhhho...",
      "...oshhhhhhso...",
      "....osssssso....",
    ],
    [
      "......oooo......",
      ".....ohhhho.....",
      "....ohhHHhho....",
      "...ohhhhhhhho...",
      "...ohhhhhhhho...",
      "...ohhhhhhhho...",
      "...ohHhhhhHho...",
      "...oshhhhhhso...",
      "....osssssso....",
    ],
    [
      "................",
      ".....oooooo.....",
      "....ohhhhhho....",
      "...ohhhhhhhho...",
      "..ohhhhhhhhhho..",
      "..ohhhhhhhhhho..",
      "..ohhHhhhhHhho..",
      "..ohhhhhhhhhho..",
      "..ohhhhhhhhhho..",
      "...ohhhhhhhho...",
    ],
  ],
};

// biome-ignore format: pixel art reads as a grid
const BODIES: Record<View, Record<Pose, string[]>> = {
  down: {
    stand: [
      "....occcccco....",
      "...occcccccco...",
      "...oscccccCso...",
      "....oppppppo....",
      "....oppooppo....",
      "....ofo..ofo....",
      "................",
    ],
    walkA: [
      "....occcccco....",
      "...occcccccco...",
      "...oscccccCso...",
      "....oppppppo....",
      "....oppooffo....",
      "....ofo..oo.....",
      "................",
    ],
    walkB: [
      "....occcccco....",
      "...occcccccco...",
      "...oscccccCso...",
      "....oppppppo....",
      "....offooppo....",
      ".....oo..ofo....",
      "................",
    ],
    sit: [
      "....occcccco....",
      "...occcccccco...",
      "...oscccccCso...",
      "....oppppppo....",
      "....offooffo....",
      "................",
      "................",
    ],
  },
  side: {
    stand: [
      ".....occcco.....",
      "....occcccco....",
      "....occcsCco....",
      ".....opppo......",
      ".....opppo......",
      ".....offffo.....",
      "................",
    ],
    walkA: [
      ".....occcco.....",
      "....occcccco....",
      "....occcsCco....",
      ".....opppo......",
      "....oppopo......",
      "....offoffo.....",
      "................",
    ],
    walkB: [
      ".....occcco.....",
      "....occcccco....",
      "....occcsCco....",
      ".....opppo......",
      ".....oppo.......",
      ".....offfo......",
      "................",
    ],
    sit: [
      ".....occcco.....",
      "....occcccco....",
      "....occcsCco....",
      ".....oppppo.....",
      ".....opoffo.....",
      "................",
      "................",
    ],
  },
  up: {
    stand: [
      "....occcccco....",
      "...occcccccco...",
      "...osccccccso...",
      "....oppppppo....",
      "....oppooppo....",
      "....ofo..ofo....",
      "................",
    ],
    walkA: [
      "....occcccco....",
      "...occcccccco...",
      "...osccccccso...",
      "....oppppppo....",
      "....oppooffo....",
      "....ofo..oo.....",
      "................",
    ],
    walkB: [
      "....occcccco....",
      "...occcccccco...",
      "...osccccccso...",
      "....oppppppo....",
      "....offooppo....",
      ".....oo..ofo....",
      "................",
    ],
    sit: [
      "....occcccco....",
      "...occcccccco...",
      "...osccccccso...",
      "....oppppppo....",
      "................",
      "................",
      "................",
    ],
  },
};

/** Glasses over the eyes (rows 5–7 of the head); from behind they don't show. */
// biome-ignore format: pixel art reads as a grid
const GLASSES: Record<"down" | "side", string[]>[] = [
  { down: [], side: [] },
  // Nerd specs: round frames, eyes still showing.
  {
    down: ["....ggg..ggg....", "...gl.lggl.lg...", "....ggg..ggg...."],
    side: [".........ggg....", "......gggl.lg...", ".........ggg...."],
  },
  // Shades and heart glasses: solid lenses.
  {
    down: ["....gggggggg....", "....lllggllll...", ".....ll..ll....."],
    side: ["........gggg....", "......ggllll....", ".........ll....."],
  },
  {
    down: ["....l.l..l.l....", "....lllggllll...", ".....l....l....."],
    side: ["........l.l.....", "......gglll.....", ".........l......"],
  },
];
const GLASSES_COLORS: Palette[] = [
  {},
  { g: "#6b4226", l: "#cde9f6" },
  { g: C.ink, l: "#1c1a24" },
  { g: "#c23a6b", l: "#ff6fa3" },
];

/** Hats over the top of the head, from row 0. `o` outline. */
// biome-ignore format: pixel art reads as a grid
const HATS: Record<View, string[]>[] = [
  { down: [], side: [], up: [] },
  // Beanie with a bobble.
  {
    down: [".......bb.......", ".....oooooo.....", "....obbbbbbo....", "...obbbbbbbbo...", "...oBBBBBBBBo..."],
    side: [".......bb.......", ".....oooooo.....", "....obbbbbbo....", "...obbbbbbbbo...", "...oBBBBBBBBBo.."],
    up: [".......bb.......", ".....oooooo.....", "....obbbbbbo....", "...obbbbbbbbo...", "...oBBBBBBBBo..."],
  },
  // Headphones: a band over the top and a cup on each ear.
  {
    down: ["................", "....okkkkkko....", "...ok......ko...", "..ok........ko..", "..omo......omo..", "..omo......omo..", "..omo......omo..", "...o........o..."],
    side: ["................", ".....okkkkko....", ".....k.....o....", ".....k..........", "....omo.........", "....omo.........", "....omo.........", ".....o.........."],
    up: ["................", "....okkkkkko....", "...ok......ko...", "..ok........ko..", "..omo......omo..", "..omo......omo..", "..omo......omo..", "...o........o..."],
  },
  // Crown.
  {
    down: [".....y.yy.y.....", ".....yyyyyy.....", ".....yryyby.....", ".....YYYYYY....."],
    side: [".....y.yy.y.....", ".....yyyyyy.....", ".....yryyby.....", ".....YYYYYY....."],
    up: [".....y.yy.y.....", ".....yyyyyy.....", ".....yyyyyy.....", ".....YYYYYY....."],
  },
  // Top hat (level 10): tall, with a red band and a wide brim.
  {
    down: ["....oooooooo....", "....okkkkkKo....", "....okkkkkKo....", "....orrrrrro....", "..okkkkkkkkkko.."],
    side: ["....oooooooo....", "....okkkkkKo....", "....okkkkkKo....", "....orrrrrro....", "..okkkkkkkkkkko."],
    up: ["....oooooooo....", "....okkkkkko....", "....okkkkkko....", "....orrrrrro....", "..okkkkkkkkkko.."],
  },
];
const HAT_COLORS: Palette[] = [
  {},
  { o: C.ink, b: "#e0584f", B: "#f4efe4" },
  { o: C.ink, k: "#3a3f4b", m: "#e0584f" },
  { y: "#f5c842", Y: "#c9971f", r: "#e0584f", b: "#4f8fe0" },
  { o: C.ink, k: "#3a3546", K: "#5a5468", r: "#c23a3a" },
];

/** Server-rack armour (outfit 12): seams and blinking lights over the top of the body. */
// biome-ignore format: pixel art reads as a grid
const RACK: Record<View, string[]> = {
  down: [".....g.y.g......", "....llllllll....", ".....g.g.y......"],
  side: [".......g.y......", ".....llllll.....", "......g........."],
  up: ["................", "....llllllll....", "................"],
};
const RACK_COLORS: Palette = { l: "#8a93a1", g: "#3ddc84", y: "#f5c842" };

const darken = (hex: string, f = 0.78) =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * f)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

export function lookPalette(look: Look): Palette {
  const hair = HAIRS[look.hair] ?? HAIRS[0]!;
  const [outfit, outfitShade] = OUTFITS[look.outfit] ?? OUTFITS[0]!;
  const pants = PANTS[look.outfit] ?? PANTS[0]!;
  return {
    o: C.ink,
    s: SKINS[look.skin] ?? SKINS[0]!,
    e: C.ink,
    r: "#f19a8b",
    h: hair,
    H: darken(hair),
    c: outfit,
    C: outfitShade,
    p: pants,
    f: "#3a2e2a",
  };
}

const lookKey = (l: Look) => `${l.style}.${l.skin}.${l.hair}.${l.outfit}.${l.glasses}.${l.hat}`;

/** One 16×16 frame. Left is the right-facing side view, mirrored. */
export const characterFrame = cached(
  (look: Look, facing: Facing, pose: Pose) => `${lookKey(look)}:${facing}:${pose}`,
  (look: Look, facing: Facing, pose: Pose) => {
    const view: View = facing === "left" || facing === "right" ? "side" : facing;
    const flip = facing === "left";
    const pal = lookPalette(look);
    return bake(16, 16, (p) => {
      p.grid(BODIES[view][pose], pal, 0, 9, flip);
      if (look.outfit === 12) p.grid(RACK[view], RACK_COLORS, 0, 9, flip);
      p.grid(HEADS[view][look.style] ?? HEADS[view][0]!, pal, 0, 0, flip);
      if (view !== "up")
        p.grid(GLASSES[look.glasses]?.[view] ?? [], GLASSES_COLORS[look.glasses] ?? {}, 0, 5, flip);
      p.grid(HATS[look.hat]?.[view] ?? [], HAT_COLORS[look.hat] ?? {}, 0, 0, flip);
    });
  },
);

/**
 * A hat, glasses or outfit on its own, as it lies on the floor and sits in the bag: as tall as the
 * thing. An outfit is the top of the body, hands left out and the trousers' row as its hem.
 */
export const itemFrame = cached(
  (item: Item) => item.id,
  (item: Item) => {
    const { slot, index: i } = item;
    if (slot === "hat") return bake(16, HATS[i]!.down.length, (p) => p.grid(HATS[i]!.down, HAT_COLORS[i]!));
    if (slot === "glasses") return bake(16, 3, (p) => p.grid(GLASSES[i]!.down, GLASSES_COLORS[i]!));
    const [c, shade] = OUTFITS[i] ?? OUTFITS[0]!;
    return bake(16, 4, (p) => {
      p.grid(BODIES.down.stand.slice(0, 4), { o: C.ink, c, C: shade, p: C.ink });
      if (i === 12) p.grid(RACK.down, RACK_COLORS);
    });
  },
);

/** Asleep in bed, seen from above: head on the pillow, blanket in the outfit colour. */
export const sleeperFrame = cached(
  (look: Look) => lookKey(look),
  (look: Look) => {
    const pal = lookPalette(look);
    return bake(16, 16, (p) => {
      p.grid(HEADS.down[look.style] ?? HEADS.down[0]!, { ...pal, e: pal.s!, r: pal.s! }, 0, -1);
      p.grid(HATS[look.hat]?.down ?? [], HAT_COLORS[look.hat] ?? {}, 0, -1);
      p.rect(3, 6, 10, 1, C.ink);
      p.px(6, 5, C.ink);
      p.px(9, 5, C.ink);
    });
  },
);

/** The pose for a moment: walking alternates feet; seated players sit; resting ones don't move. */
export function poseFor(state: PlayerState, walking: boolean, t: number): Pose {
  if (state === "sit" || state === "working") return "sit";
  if (!walking) return "stand";
  return Math.floor(t / 110) % 2 === 0 ? "walkA" : "walkB";
}
