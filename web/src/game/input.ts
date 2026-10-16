import {
  DIRS,
  type Facing,
  JUMP_MS,
  RUN_STEP_MS,
  route,
  type StepResult,
  stepTarget,
  TILE,
  WALK_STEP_MS,
} from "@tokenmaxxing/core/world.ts";
import { conn, town } from "../net.ts";
import { chatBeside, hud } from "../store.ts";
import { camera, zoom } from "./camera.ts";
import { gameHits } from "./games.ts";
import { buildingAt, companyOnPlot, peekHits } from "./houses.ts";
import { chipHits, signHits } from "./labels.ts";
import { avatarAt, beginStep, dropAt, self, stepping, world } from "./world.ts";

const KEYS: Record<string, Facing> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

/** Arrow keys currently held, most recent last. */
const held: Facing[] = [];
let running = false;
/** A key pressed and released between two frames still takes its step. */
let tapped: Facing | null = null;
/** Click-to-walk: the remaining steps, and whether to interact, or take what's there, on arrival. */
let path: Facing[] = [];
let interactOnArrival = false;
let takeOnArrival = false;

const typing = (e: Event) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

export function bindInput(canvas: HTMLCanvasElement): void {
  window.addEventListener("keydown", (e) => {
    // Escape is ours (menus, chat): unhandled, macOS takes it to leave full screen.
    if (e.key === "Escape") e.preventDefault();
    if (typing(e) || e.metaKey || e.ctrlKey) return;
    const s = hud.get();
    if (e.key === "Escape") {
      hud.set({ panel: s.panel || s.dialog ? null : { kind: "menu" }, dialog: null });
      return;
    }
    // Beside a game the chat is still there: Enter goes to it, unless it's pressing a button.
    if (e.key === "Enter" && chatBeside(s.panel) && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      hud.set({ chatFocus: s.chatFocus + 1 });
      return;
    }
    if (s.panel) return;
    const dir = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
    if (dir) {
      e.preventDefault();
      if (!held.includes(dir)) held.push(dir);
      tapped = dir;
      path = [];
      takeOnArrival = false;
      return;
    }
    switch (e.key.toLowerCase()) {
      case "x":
      case "shift":
        running = true;
        return;
      case " ":
        e.preventDefault();
        jump();
        return;
      case "e":
        if (s.dialog) hud.set({ dialog: null });
        else interact();
        return;
      case "g":
        take();
        return;
      case "enter":
        e.preventDefault();
        hud.set({ chatFocus: s.chatFocus + 1 });
        return;
      case "l":
        hud.set({ panel: { kind: "leaderboard" } });
        return;
      case "+":
      case "=":
        zoom(1);
        return;
      case "-":
      case "_":
        zoom(-1);
        return;
      case "0":
        zoom(0);
        return;
    }
  });
  window.addEventListener("keyup", (e) => {
    const dir = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
    if (dir) held.splice(held.indexOf(dir), 1);
    if (e.key.toLowerCase() === "x" || e.key === "Shift") running = false;
  });
  window.addEventListener("blur", () => {
    held.length = 0;
    running = false;
  });
  // Wheel or trackpad pinch (which arrives as a ctrl+wheel): one zoom step per notch.
  let wheel = 0;
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      wheel += e.deltaY;
      const notch = e.ctrlKey ? 12 : 60;
      if (Math.abs(wheel) < notch) return;
      zoom(wheel < 0 ? 1 : -1);
      wheel = 0;
    },
    { passive: false },
  );
  canvas.addEventListener("click", (e) => {
    if (hud.get().panel) return;
    // Someone inside a house: their name chip (screen pixels) or their face in a window (world pixels).
    const sx = e.clientX * camera.dpr;
    const sy = e.clientY * camera.dpr;
    const gx = sx / camera.scale + camera.x;
    const gy = sy / camera.scale + camera.y;
    const inside = (h: { x: number; y: number; w: number; h: number }, px: number, py: number) =>
      px >= h.x && px < h.x + h.w && py >= h.y && py < h.y + h.h;
    const hit = gameHits.find((h) => inside(h, sx, sy));
    if (hit) return void hit.open();
    const peeked = chipHits.find((h) => inside(h, sx, sy)) ?? peekHits.find((h) => inside(h, gx, gy));
    if (peeked) return void hud.set({ panel: { kind: "card", userId: peeked.id } });
    const signed = signHits.find((h) => inside(h, sx, sy));
    if (signed) return void hud.set({ panel: { kind: "companyCard", companyId: signed.id } });
    const x = Math.floor(gx / TILE);
    const y = Math.floor(gy / TILE);
    const other = avatarAt(x, y);
    if (other) return void hud.set({ panel: { kind: "card", userId: other.info.id } });
    // A company's house (not its door, which you walk through) opens its page.
    const plot = world.map.kind(x, y).portal ? null : buildingAt(x, y)?.plot;
    const company = plot ? companyOnPlot(plot) : null;
    if (company) return void hud.set({ panel: { kind: "companyCard", companyId: company.id } });
    walkTo(x, y);
  });
  // Right-click a drop (or yourself, on one): take it, walking there first (onto it, into its seat, or
  // up to it). Never the browser's menu.
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (hud.get().panel) return;
    const x = Math.floor(((e.clientX * camera.dpr) / camera.scale + camera.x) / TILE);
    const y = Math.floor(((e.clientY * camera.dpr) / camera.scale + camera.y) / TILE);
    const me = self();
    if (!me || !dropAt(x, y)) return;
    if (x === me.x && y === me.y) return void take();
    walkTo(x, y);
    // A seat is sat on first; anything else is only taken.
    interactOnArrival &&= world.map.kind(x, y).seat !== undefined;
    takeOnArrival = path.length > 0;
  });
}

/** Click-to-walk (the world or the minimap): route there, and interact if it's a thing, not floor. */
export function walkTo(x: number, y: number): void {
  const me = self();
  takeOnArrival = false;
  if (!me || (x === me.x && y === me.y)) return;
  path = route(world.map, [me.x, me.y], [x, y]) ?? [];
  interactOnArrival = path.length > 0 && !world.map.walkable(x, y) && !world.map.kind(x, y).portal;
}

/** The server's answer to a move: a notice, a correction, or another room (its snapshot follows). */
export function send(result: Promise<StepResult>): void {
  result
    .then((r) => {
      if (!r) {
        world.portalPending = false;
        return;
      }
      if ("notice" in r) {
        world.portalPending = false;
        hud.set({ dialog: r.notice });
        return;
      }
      const me = self();
      // Same room: the server disagreed (too fast, a seat) — take its word. Another room: a snapshot follows.
      if (me && r.room === world.room) {
        Object.assign(me, { x: r.x, y: r.y, facing: r.facing, state: r.state, from: null });
        world.portalPending = false;
      }
    })
    .catch(() => {
      world.portalPending = false;
    });
}

/** Called every frame: start the next step if a key is held or a clicked path remains. */
export function updateSelf(now: number): void {
  const me = self();
  if (!me || world.portalPending || stepping(me, now)) return;
  // At a game table: stay put until the game is over.
  if (me.state === "playing") {
    tapped = null;
    path = [];
    return;
  }
  const dir = held.at(-1) ?? tapped ?? path.shift();
  tapped = null;
  if (!dir) {
    if (interactOnArrival) {
      interactOnArrival = false;
      interact();
    }
    if (takeOnArrival) {
      takeOnArrival = false;
      take();
    }
    return;
  }
  // Getting up from bed or desk: the server puts us back where we were before, so wait for it.
  if (me.state === "away" || me.state === "working") {
    world.portalPending = true;
    send(conn.step(dir));
    return;
  }
  const target = stepTarget(world.map, me.x, me.y, dir);
  if (target.kind === "blocked") {
    if (me.facing !== dir || me.state !== "idle") send(conn.step(dir));
    me.facing = dir;
    if (!interactOnArrival) path = [];
    return;
  }
  if (hud.get().dialog) hud.set({ dialog: null });
  me.facing = dir;
  me.state = "idle";
  if (target.kind === "portal") world.portalPending = true;
  else beginStep(me, target.x, target.y, running ? RUN_STEP_MS : WALK_STEP_MS);
  send(conn.step(dir));
}

/** G, or a right-click: take what's there. It goes in the bag, so the wallet's count moves. */
function take(): void {
  send(
    conn.take().then((r) => {
      if (r?.drop) void town.wallet().then((wallet) => hud.set({ wallet }));
      return r;
    }),
  );
}

/** Space: a hop, standing or walking. Everyone in the room sees it. */
function jump(): void {
  const me = self();
  const now = performance.now();
  if (me?.state !== "idle" || (me.jump !== null && now - me.jump < JUMP_MS)) return;
  me.jump = now;
  void conn.jump().catch(() => {});
}

/** E: talk to whoever or whatever is in front of you. */
export function interact(): void {
  const me = self();
  if (!me) return;
  const [dx, dy] = DIRS[me.facing];
  const x = me.x + dx;
  const y = me.y + dy;
  const other = avatarAt(x, y);
  if (other) return void hud.set({ panel: { kind: "card", userId: other.info.id } });
  const ch = world.map.at(x, y);
  const kind = world.map.kind(x, y);
  if (ch === "N") return void hud.set({ panel: { kind: "leaderboard" } });
  if (kind.seat) return void send(conn.sit(me.facing));
  if (ch === "o") return void send(conn.drink(me.facing));
  if (ch === "H") {
    const b = buildingAt(x, y);
    const company = b?.plot ? companyOnPlot(b.plot) : null;
    // A company's house opens its page.
    if (company) return void hud.set({ panel: { kind: "companyCard", companyId: company.id } });
    return void hud.set({ dialog: b?.plot === null ? "The Inn. Beds for anyone without a company." : null });
  }
  if (kind.text) hud.set({ dialog: kind.text });
}
