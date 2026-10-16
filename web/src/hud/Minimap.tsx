import type { GameMap } from "@tokenmaxxing/core/maps.ts";
import { mapOf } from "@tokenmaxxing/core/world.ts";
import { useEffect, useRef } from "react";
import { C } from "../art/palette.ts";
import { zoom } from "../game/camera.ts";
import { buildings, companyOnPlot } from "../game/houses.ts";
import { walkTo } from "../game/input.ts";
import { roomName, world } from "../game/world.ts";
import { useHud } from "../store.ts";

/** Widest the map may be, in CSS pixels; each tile gets a whole number of pixels. */
const MAX_WIDTH = 200;

const COLORS: Record<string, string> = {
  T: C.leafDark,
  "^": C.leaf,
  "~": C.water,
  ",": C.path,
  ":": C.plaza,
  F: C.waterLight,
  W: C.wallTop,
  _: C.floor,
  "=": C.rug,
  x: C.rugLight,
  R: C.rugLight,
};

const bases = new WeakMap<GameMap, HTMLCanvasElement>();

/** The map's tiles, one block per tile, drawn once per map. */
function base(map: GameMap, scale: number): HTMLCanvasElement {
  const cached = bases.get(map);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = map.width * scale;
  canvas.height = map.height * scale;
  const g = canvas.getContext("2d")!;
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      g.fillStyle = COLORS[map.at(map.x0 + x, map.y0 + y)] ?? (map.id === "town" ? C.grass : C.woodDark);
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  bases.set(map, canvas);
  return canvas;
}

/** Always in the bottom-right corner: the room you're in, everyone in it, and you. Click to walk there. */
export function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const room = useHud((s) => s.room);
  const myCompany = useHud((s) => s.me?.company?.id);
  useHud((s) => s.companies); // the town grows with them
  const map = mapOf(room);
  const scale = Math.max(1, Math.floor(MAX_WIDTH / map.width));

  useEffect(() => {
    const draw = () => {
      const g = ref.current?.getContext("2d");
      if (!g) return;
      // As it is now: a drop or a take makes the room a new map.
      g.drawImage(base(mapOf(room), scale), 0, 0);
      for (const b of buildings(map)) {
        const company = b.plot === null ? null : companyOnPlot(b.plot);
        g.fillStyle = b.plot === null ? C.leaf : company?.id === myCompany ? C.flowerYellow : C.roofRed;
        g.fillRect((b.x - map.x0) * scale, (b.y - map.y0) * scale, b.w * scale, b.h * scale);
      }
      for (const a of world.avatars.values()) {
        const me = a.info.id === world.selfId;
        const r = me ? scale + 2 : scale;
        const cx = (a.x - map.x0) * scale + scale / 2;
        const cy = (a.y - map.y0) * scale + scale / 2;
        g.fillStyle = me ? C.ink : C.white;
        g.fillRect(cx - r / 2 - 1, cy - r / 2 - 1, r + 2, r + 2);
        g.fillStyle = me ? C.flowerRed : a.info.online ? C.screen : C.stoneLight;
        g.fillRect(cx - r / 2, cy - r / 2, r, r);
      }
    };
    draw();
    const id = setInterval(draw, 200);
    return () => clearInterval(id);
  }, [room, map, scale, myCompany]);

  return (
    <section className="panel minimap" aria-label="Map">
      <header>
        <span>🗺 {roomName(room)}</span>
        <span className="zoom">
          <button type="button" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoom(-1)}>
            −
          </button>
          <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoom(1)}>
            +
          </button>
        </span>
      </header>
      <canvas
        ref={ref}
        width={map.width * scale}
        height={map.height * scale}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          // As a fraction of the canvas shown: CSS can draw it bigger or smaller than its pixels.
          walkTo(
            map.x0 + Math.floor(((e.clientX - rect.left) / rect.width) * map.width),
            map.y0 + Math.floor(((e.clientY - rect.top) / rect.height) * map.height),
          );
        }}
      />
    </section>
  );
}
