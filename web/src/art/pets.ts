import { C } from "./palette.ts";
import { bake, cached, type Palette } from "./pixels.ts";

/**
 * Pets from the shop: 12×10, facing right (mirrored for left), two frames so
 * they hop along behind their owner. Index 0 is no pet.
 */

interface Pet {
  frames: [string[], string[]];
  pal: Palette;
}

// biome-ignore format: pixel art reads as a grid
const PETS: (Pet | null)[] = [
  null,
  // Duck.
  {
    frames: [
      [
        "............",
        "......ooo...",
        ".....oyyyo..",
        ".....oyeyoo.",
        ".....oyyynno",
        ".oo..oyyyoo.",
        "oyyooyyyyyo.",
        ".oyyyyyyyo..",
        "..ooooooo...",
        "...n...n....",
      ],
      [
        "......ooo...",
        ".....oyyyo..",
        ".....oyeyoo.",
        ".....oyyynno",
        ".oo..oyyyoo.",
        "oyyooyyyyyo.",
        ".oyyyyyyyo..",
        "..ooooooo...",
        "..n.....n...",
        "............",
      ],
    ],
    pal: { o: C.ink, y: "#f5d14a", e: C.ink, n: "#f08a3c" },
  },
  // Cat.
  {
    frames: [
      [
        "............",
        ".......o..o.",
        "o.....obooba",
        "bo....obbbbo",
        ".bo...oebebo",
        "..o..obbnbbo",
        "..oooobbbbo.",
        ".obbbbbbbo..",
        ".obobbbobo..",
        ".o.o..o.o...",
      ],
      [
        ".......o..o.",
        "o.....obooba",
        "bo....obbbbo",
        ".bo...oebebo",
        "..o..obbnbbo",
        "..oooobbbbo.",
        ".obbbbbbbo..",
        ".obobbbobo..",
        "o.o....o.o..",
        "............",
      ],
    ],
    pal: { o: C.ink, b: "#f0a04b", a: "#f0a04b", e: C.ink, n: "#e0584f" },
  },
  // Dog.
  {
    frames: [
      [
        "............",
        "......oooo..",
        "o....oEbbbo.",
        "bo...oEbebbo",
        ".o...oEbbbbn",
        ".o..oobbbbo.",
        "..oobbbbtoo.",
        ".obbbbbbbo..",
        ".obobbbobo..",
        ".o.o..o.o...",
      ],
      [
        "......oooo..",
        "o....oEbbbo.",
        "bo...oEbebbo",
        ".o...oEbbbbn",
        ".o..oobbbbo.",
        "..oobbbbtoo.",
        ".obbbbbbbo..",
        ".obobbbobo..",
        "o.o....o.o..",
        "............",
      ],
    ],
    pal: { o: C.ink, b: "#c9925a", E: "#7a4f2c", e: C.ink, n: C.ink, t: "#e0584f" },
  },
  // Dragon.
  {
    frames: [
      [
        "..oo........",
        ".owwo....oo.",
        "owwwwo..oggo",
        "owwwwwoogego",
        ".oowwwogggnn",
        "o...ogggyyo.",
        "go.ogggyyyo.",
        ".ogggggyyo..",
        "..oggoogo...",
        "..oo..oo....",
      ],
      [
        "............",
        "..oo.....oo.",
        ".owwo...oggo",
        "owwwwooogego",
        "owwwwwogggnn",
        "go.ogggyyyo.",
        ".oggggyyyyo.",
        "..ogggggyo..",
        "..oggoogo...",
        "..oo..oo....",
      ],
    ],
    pal: { o: C.ink, g: "#4fb36a", w: "#8fd6a0", y: "#f5d98a", e: C.ink, n: "#ff8a3c" },
  },
  // Panda.
  {
    frames: [
      [
        "............",
        "......kk.kk.",
        ".....owwwwwo",
        ".....owwkkwo",
        ".....owwwwwn",
        ".....owwwwo.",
        "..ookkkwwoo.",
        ".owwkkwwwo..",
        ".okkwwwkko..",
        ".k.k..k.k...",
      ],
      [
        "......kk.kk.",
        ".....owwwwwo",
        ".....owwkkwo",
        ".....owwwwwn",
        ".....owwwwo.",
        "..ookkkwwoo.",
        ".owwkkwwwo..",
        ".okkwwwkko..",
        "k.k....k.k..",
        "............",
      ],
    ],
    pal: { o: C.ink, w: "#f4f1ea", k: "#3a3540", n: C.ink },
  },
  // Singularity orb (level 30): a tiny black hole with a glowing ring, floating off the ground.
  {
    frames: [
      [
        "............",
        "....oooo....",
        "...oppppo...",
        "..opkkkkpo..",
        "wwwkkkkkkwww",
        "..wpkkkkpw..",
        "...oppppo...",
        "....oooo....",
        "............",
        "............",
      ],
      [
        "....oooo....",
        "...oppppo...",
        "..opkkkkpo..",
        "wwwkkkkkkwww",
        "..wpkkkkpw..",
        "...oppppo...",
        "....oooo....",
        "............",
        "............",
        "............",
      ],
    ],
    pal: { o: C.ink, p: "#9b6fd6", k: "#14101f", w: "#ffd27a" },
  },
];

export const PET_W = 12;
export const PET_H = 10;

/** One frame of pet `pet`, or null for none. */
export const petFrame = (pet: number, left: boolean, hop: boolean): HTMLCanvasElement | null =>
  PETS[pet] ? frame(pet, left, hop) : null;

const frame = cached(
  (pet: number, left: boolean, hop: boolean) => `${pet}:${left}:${hop}`,
  (pet: number, left: boolean, hop: boolean) =>
    bake(PET_W, PET_H, (p) => p.grid(PETS[pet]!.frames[hop ? 1 : 0], PETS[pet]!.pal, 0, 0, left)),
);
