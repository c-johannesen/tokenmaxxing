import { compact } from "@tokenmaxxing/core/format.ts";
import { BLOCK_W } from "@tokenmaxxing/core/maps.ts";
import { itemById } from "@tokenmaxxing/core/shop.ts";
import {
  cupsLeft,
  dropName,
  houseTier,
  JUMP_MS,
  ownerOfOffice,
  pieceOfDrop,
  TILE,
} from "@tokenmaxxing/core/world.ts";
import { house, inn } from "../art/buildings.ts";
import { characterFrame, lookPalette, poseFor, sleeperFrame } from "../art/characters.ts";
import { chairBack, objectAt, parcel, sortY } from "../art/objects.ts";
import { C } from "../art/palette.ts";
import { PET_H, petFrame } from "../art/pets.ts";
import { drawWaterGlints } from "../art/tiles.ts";
import { camera, zoomScale } from "./camera.ts";
import { drawGames } from "./games.ts";
import { buildings, companyOnPlot, drawFace, drawLogo, peekHits } from "./houses.ts";
import { avatarLabels, chipHits, chips, sign, signHits } from "./labels.ts";
import { followPet, prunePets } from "./pets.ts";
import { type Avatar, drawPos, stepping, WARP_MS, world } from "./world.ts";

let lastFrame = performance.now();

type Draw = { y: number; draw: () => void };

type Label = () => void;

export function render(canvas: HTMLCanvasElement, now: number): void {
  const g = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const scale = zoomScale(dpr, w, h, now);
  const map = world.map;
  const viewW = w / scale;
  const viewH = h / scale;
  const me = world.avatars.get(world.selfId);
  const focus = me ? drawPos(me, now) : { x: map.x0 + map.width / 2, y: map.y0 + map.height / 2 };
  const clampCam = (center: number, view: number, start: number, size: number) =>
    start +
    (size <= view ? (size - view) / 2 : Math.min(Math.max(center - start - view / 2, 0), size - view));
  const camX =
    Math.round(clampCam((focus.x + 0.5) * TILE, viewW, map.x0 * TILE, map.width * TILE) * scale) / scale;
  const camY =
    Math.round(clampCam((focus.y + 0.5) * TILE, viewH, map.y0 * TILE, map.height * TILE) * scale) / scale;
  Object.assign(camera, { x: camX, y: camY, scale, dpr });

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = map.id === "town" ? C.leafInk : "#1b1f2a";
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = false;
  g.setTransform(scale, 0, 0, scale, -camX * scale, -camY * scale);
  if (world.ground) g.drawImage(world.ground, map.x0 * TILE, map.y0 * TILE);
  drawWaterGlints(g, map, now);

  const x0 = Math.max(map.x0, Math.floor(camX / TILE) - 1);
  const y0 = Math.max(map.y0, Math.floor(camY / TILE) - 1);
  const x1 = Math.min(map.x0 + map.width, Math.ceil((camX + viewW) / TILE) + 1);
  const y1 = Math.min(map.y0 + map.height, Math.ceil((camY + viewH) / TILE) + 3);
  const items: Draw[] = [];
  peekHits.length = 0;
  chipHits.length = 0;
  signHits.length = 0;
  const labels: Label[] = [];
  const toScreen = (px: number, py: number) => [(px - camX) * scale, (py - camY) * scale] as const;

  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const o = objectAt(map, x, y);
      if (o)
        items.push({
          y: y * TILE + sortY(map.at(x, y)),
          draw: () => g.drawImage(o.canvas, x * TILE + o.dx, y * TILE + o.dy),
        });
    }

  for (const b of buildings(map)) {
    const company = b.plot === null ? null : companyOnPlot(b.plot);
    if (b.plot !== null && !company) continue; // the town catches up with a company closing
    const plan = company ? house(houseTier(company.tokens30d, company.members), company.brand) : null;
    const sprite = plan?.canvas ?? inn();
    const left = b.x * TILE;
    const bottom = (b.y + b.h) * TILE;
    const top = bottom - sprite.height;
    const inside = company ? (world.houses[company.id] ?? []) : [];
    const panes = plan?.panes ?? [];
    const plaque = plan?.plaque;
    const logo = company?.brand?.logo;
    const faces = inside.slice(0, panes.length);
    for (const [i, p] of faces.entries()) {
      const pane = panes[i]!;
      peekHits.push({ x: left + pane.x, y: top + pane.y, w: pane.w, h: pane.h, id: p.id });
    }
    items.push({
      y: bottom - 1,
      draw: () => {
        g.drawImage(sprite, left, top);
        if (logo && plaque) drawLogo(g, logo, left + plaque.x, top + plaque.y, plaque.w, plaque.h);
        for (const [i, p] of faces.entries())
          drawFace(g, p, left + panes[i]!.x, top + panes[i]!.y, panes[i]!, now);
      },
    });
    const [sx, sy] = toScreen(left + (b.w * TILE) / 2, bottom - sprite.height);
    const text = company ? `🏢 ${company.name} · ${compact(company.todayTokens)} today` : "🛏 The Inn";
    labels.push(() => {
      const y = sy - 6 * dpr;
      const { w, h } = sign(g, sx, y, text, dpr, company !== null, (BLOCK_W - 0.5) * TILE * scale);
      if (company) signHits.push({ x: sx - w / 2, y: y - h, w, h, id: company.id });
    });
    if (inside.length) labels.push(() => chips(g, sx, sy + 4 * dpr, inside, dpr));
  }

  // Office doors: the owner's name over each, 🔒 when it's closed; yours stands out.
  for (const d of world.doors) {
    const [sx, sy] = toScreen((d.x + 0.5) * TILE, d.y * TILE);
    const text = `${d.open ? "" : "🔒 "}${d.name}`;
    labels.push(() => sign(g, sx, sy, text, dpr, d.userId === world.selfId, 1.9 * TILE * scale));
  }

  // Drops: furniture is in the map; a wearable is a parcel, a pet itself. What it is shows when you're
  // on it or next to it, with a 🔒 on someone else's office floor.
  const owner = ownerOfOffice(world.room);
  for (const d of world.drops) {
    const piece = pieceOfDrop(d);
    const w = piece?.w ?? 1;
    const kind = itemById(d.item);
    const sprite = piece
      ? null
      : ((kind?.slot === "pet" ? petFrame(kind.index, false, false) : null) ?? parcel());
    if (sprite)
      items.push({
        y: d.y * TILE + TILE / 2,
        draw: () =>
          g.drawImage(sprite, d.x * TILE + (TILE - sprite.width) / 2, (d.y + 1) * TILE - sprite.height - 1),
      });
    if (!me || Math.abs(me.y - d.y) > 1 || me.x < d.x - 1 || me.x > d.x + w) continue;
    const top = d.y * TILE + Math.min(0, objectAt(map, d.x, d.y)?.dy ?? 0);
    const [sx, sy] = toScreen((d.x + w / 2) * TILE, top - 2);
    const text = `${owner !== null && owner !== world.selfId ? "🔒 " : ""}${dropName(d)}`;
    labels.push(() => sign(g, sx, sy, text, dpr, false));
  }

  drawGames(g, items, labels, toScreen, now, dpr);

  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  prunePets();
  for (const a of [...world.avatars.values(), ...world.leaving]) {
    const pos = drawPos(a, now);
    const px = pos.x * TILE;
    const py = pos.y * TILE;
    const tile = map.at(a.x, a.y);
    items.push({
      y: py + (tile === "b" || tile === "s" ? 1 : TILE - 0.5),
      draw: () => drawAvatar(g, a, px, py, tile, now),
    });
    const pet = a.warp ? null : followPet(a, px, py, dt);
    if (pet) {
      const frame = petFrame(a.info.look.pet, pet.left, pet.moving && Math.floor(now / 140) % 2 === 0);
      if (frame)
        items.push({
          y: pet.y + PET_H,
          draw: () => g.drawImage(frame, Math.round(pet.x), Math.round(pet.y)),
        });
    }
    labels.push(() => avatarLabels(g, a, ...toScreen(px + TILE / 2, py), tile, now, dpr));
  }

  items.sort((a, b) => a.y - b.y);
  for (const i of items) i.draw();

  g.setTransform(1, 0, 0, 1, 0, 0);
  for (const l of labels) l();
}

function drawAvatar(
  g: CanvasRenderingContext2D,
  a: Avatar,
  px: number,
  py: number,
  tile: string,
  now: number,
): void {
  const look = a.info.look;
  // Coffee: a random nudge every frame, a pixel per cup still in their system.
  const shake = Math.min(4, cupsLeft(a.info.coffeeUntil, Date.now()));
  if (shake > 0) {
    px += Math.round((Math.random() * 2 - 1) * shake);
    py += Math.round((Math.random() * 2 - 1) * shake * 0.5);
  }
  if (a.warp) {
    const t = Math.min(1, (now - a.warp.at) / WARP_MS);
    g.globalAlpha = a.warp.out ? 1 - t : t;
  }
  const lying = a.state === "away" || (a.state === "sit" && tile === "b");
  if (lying) {
    if (tile !== "b") {
      // A sleeping bag on the floor.
      g.fillStyle = C.ink;
      g.fillRect(px + 2, py + 1, 12, 15);
      g.fillStyle = C.fabricDark;
      g.fillRect(px + 3, py + 2, 10, 13);
    }
    g.drawImage(sleeperFrame(look), px, py + 1);
    const pal = lookPalette(look);
    g.fillStyle = pal.c!;
    g.fillRect(px + 3, py + 8, 10, 7);
    g.fillStyle = pal.C!;
    g.fillRect(px + 3, py + 8, 10, 1);
  } else if (a.state === "working" || (a.state === "sit" && tile === "c")) {
    const typing = a.state === "working" && Math.floor(now / 180) % 2 === 0 ? 1 : 0;
    g.drawImage(characterFrame(look, "up", "sit"), px, py - 6 + typing);
    g.drawImage(chairBack(), px, py);
  } else if (a.state === "sit") {
    g.drawImage(characterFrame(look, a.facing === "up" ? "up" : "down", "sit"), px, py - 5);
  } else {
    const walking = stepping(a, now);
    const pose = poseFor(a.state, walking, now);
    // A hop: up and down on an arc, the shadow shrinking while they're in the air.
    const t = a.jump === null ? 1 : (now - a.jump) / JUMP_MS;
    const lift = t < 1 ? Math.round(Math.sin(t * Math.PI) * 7) : 0;
    const shrink = lift > 3 ? 1 : 0;
    g.fillStyle = C.shadow;
    g.fillRect(px + 4 + shrink, py + 14, 8 - 2 * shrink, 2);
    g.drawImage(characterFrame(look, a.facing, pose), px, py - 2 - lift - (pose === "walkA" ? 1 : 0));
  }
  g.globalAlpha = 1;
}
