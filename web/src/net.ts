import type { Frame, Lobby, MatchChatLine } from "@tokenmaxxing/core/games/wire.ts";
import {
  CHAT_HISTORY,
  type ChatLine,
  type CompanyInfo,
  type Houses,
  type Moves,
  type Notice,
  type PlayerInfo,
  type RoomId,
  type Snapshot,
  type WorldGame,
} from "@tokenmaxxing/core/world.ts";
import type { registry } from "@tokenmaxxing/server/registry";
import { createClient } from "rivetkit/client";
import {
  applyBubble,
  applyCallout,
  applyChat,
  applyGame,
  applyGameOver,
  applyInfo,
  applyJump,
  applyMoves,
  loadSnapshot,
  setCompanies,
  world,
} from "./game/world.ts";
import { hud } from "./store.ts";

const TOKEN_KEY = "tokenmaxxing.session";

// Actions go over connections, not stateless HTTP: the client streams request bodies, which
// Chrome only allows over HTTP/2 (so it breaks on plain-http localhost).
const client = createClient<typeof registry>({ endpoint: `${location.origin}/api/rivet`, devtools: false });

type Town = ReturnType<ReturnType<typeof client.town.getOrCreate>["connect"]>;
type WorldConn = ReturnType<ReturnType<typeof client.world.getOrCreate>["connect"]>;
type ArcadeConn = ReturnType<ReturnType<typeof client.arcade.getOrCreate>["connect"]>;
type MatchConn = ReturnType<ReturnType<typeof client.match.get>["connect"]>;
type PlayerConn = ReturnType<ReturnType<typeof client.player.get>["connect"]>;

export let town: Town;
export let conn: WorldConn;
export let arcade: ArcadeConn;
/** The match you're playing or watching, if its panel is open. */
export let matchConn: MatchConn | null = null;
let session = "";

/** Trades a single-use login code (`<userId>.<code>`) for a session, kept for the next load. */
export async function redeem(code: string): Promise<void> {
  const player = client.player.get([code.split(".")[0]!]).connect();
  localStorage.setItem(TOKEN_KEY, await player.redeemLoginCode(code).finally(() => player.dispose()));
}

/**
 * A browser may open `/#code=<userId>.<code>`: trade it for a session, then
 * drop it from the URL and history. The app's window signs in through the app
 * instead (AppSignIn).
 */
export async function signIn(): Promise<string | null> {
  const code = new URLSearchParams(location.hash.slice(1)).get("code");
  if (code) {
    history.replaceState(null, "", location.pathname);
    try {
      await redeem(code);
    } catch {
      if (!localStorage.getItem(TOKEN_KEY)) {
        hud.set({ status: "expired" });
        return null;
      }
    }
  }
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) hud.set({ status: "signedOut" });
  return token;
}

const isUnauthorized = (err: unknown) => (err as { code?: string } | null)?.code === "unauthorized";

function signedOut(): void {
  localStorage.removeItem(TOKEN_KEY);
  conn?.dispose();
  town?.dispose();
  arcade?.dispose();
  closeMatch();
  hud.set({ status: "signedOut" });
}

export function connect(token: string): void {
  session = token;
  town = client.town.getOrCreate(["main"], { params: { token } }).connect();
  arcade = client.arcade.getOrCreate(["main"], { params: { token } }).connect();
  arcade.on("lobby", (lobby: Lobby) => applyLobby(lobby));
  arcade.onOpen(async () => applyLobby(await arcade.lobby()));
  for (const c of [town, arcade])
    c.onError((err) => {
      if (isUnauthorized(err)) signedOut();
    });
  conn = client.world.getOrCreate(["main"], { params: { token } }).connect();

  conn.on("snapshot", (s: Snapshot) => loadSnapshot(s));
  conn.on("moves", (m: Moves) => applyMoves(m));
  conn.on("info", (info: PlayerInfo) => {
    applyInfo(info);
    if (info.id === world.selfId) void refreshStats();
  });
  conn.on("companies", (list: CompanyInfo[]) => setCompanies(list));
  conn.on("houses", (h: Houses) => {
    world.houses = h;
  });
  conn.on("occupancy", (o: Partial<Record<RoomId, number>>) => hud.set({ occupancy: o }));
  conn.on("chat", (line: ChatLine) => applyChat(line));
  conn.on("bubble", (e: { userId: number; text: string }) => applyBubble(e));
  conn.on("jump", (id: number) => applyJump(id));
  conn.on("notice", (n: Notice) => {
    hud.set({ notice: { ...n, at: Date.now() } });
    void refreshMe();
  });
  conn.on("mention", (line: ChatLine) => hud.set({ mention: { line, at: Date.now() } }));
  conn.on("game", (g: WorldGame) => applyGame(g));
  conn.on("gameOver", (e: { id: number; winners: number[] }) => applyGameOver(e.id, e.winners));
  conn.on("callout", (e: { id: number; userId: number | null; text: string }) => applyCallout(e));
  conn.onError((err) => {
    if (isUnauthorized(err)) signedOut();
  });
  conn.onClose(() => {
    if (hud.get().status === "ready") hud.set({ status: "offline" });
    // ponytail: the client retries on its own, but can stall after a long outage (a deploy);
    // a reload after 20 s always gets back in. Replace with a proper backoff if it annoys anyone.
    setTimeout(() => {
      if (hud.get().status === "offline") location.reload();
    }, 20_000);
  });
  // Other people's syncs move the board too; nothing announces those, so poll.
  setInterval(() => {
    if (hud.get().status === "ready") void refreshStats();
  }, 30_000);
  // Every (re)connect: join the world again and take a fresh snapshot.
  conn.onOpen(async () => {
    try {
      loadSnapshot(await conn.join());
      hud.set({ status: "ready" });
      await Promise.all([refreshMe(), refreshStats()]);
    } catch (err) {
      if (isUnauthorized(err)) signedOut();
    }
  });
}

export async function refreshMe(): Promise<void> {
  hud.set({ me: await town.me() });
}

let statsTimer: ReturnType<typeof setTimeout> | null = null;

/** My tokens, rank, level and coins today, at most every few seconds. */
async function refreshStats(): Promise<void> {
  if (statsTimer) return;
  statsTimer = setTimeout(() => {
    statsTimer = null;
  }, 5000);
  const [m, wallet] = await Promise.all([town.today(), town.wallet()]);
  hud.set({ stats: m.me, board: m.top, wallet });
}

// MARK: Games

/**
 * A new lobby. Two things happen on their own: a new invite for me shows a toast, and a
 * game I've just started playing opens its panel.
 */
function applyLobby(lobby: Lobby): void {
  const before = hud.get().lobby;
  const me = hud.get().me?.userId;
  const invite = lobby.tables.find(
    (t) =>
      t.invited.some((i) => i.userId === me) &&
      !before?.tables.some((b) => b.id === t.id && b.invited.some((i) => i.userId === me)),
  );
  hud.set({ lobby, ...(invite ? { inviteTable: invite.id } : {}) });
  // Stakes, bets and payouts move coins, and they all change the lobby.
  const ended = (l: Lobby | null | undefined) => l?.matches.filter((m) => m.outcome).length ?? 0;
  if (JSON.stringify(lobby.me) !== JSON.stringify(before?.me) || ended(lobby) > ended(before))
    void town.wallet().then((wallet) => hud.set({ wallet }));
  const playing = lobby.me.match;
  if (playing !== null && playing !== before?.me.match) {
    const m = lobby.matches.find((x) => x.id === playing);
    if (m && !m.outcome) openMatch(playing);
  }
}

/** Opens a match's panel: yours to play, or someone else's to watch. */
export function openMatch(id: number): void {
  if (hud.get().frame?.info.id !== id || !matchConn) {
    matchConn?.dispose();
    hud.set({ frame: null, matchChat: [] });
    const c = client.match.get([String(id)], { params: { token: session } }).connect();
    c.on("frame", (frame: Frame) => {
      if (frame.info.id === id) hud.set({ frame, clockSkew: Date.now() - frame.now });
    });
    c.on("chat", (line: MatchChatLine) => {
      if (matchConn === c) hud.set((s) => ({ matchChat: [...s.matchChat, line].slice(-CHAT_HISTORY) }));
    });
    c.onOpen(async () => {
      const [frame, matchChat] = await Promise.all([c.frame(), c.chat()]);
      hud.set({ frame, matchChat, clockSkew: Date.now() - frame.now });
    });
    matchConn = c;
  }
  hud.set({ panel: { kind: "match", id } });
}

/** Closing the panel stops watching (a game you play keeps going, and reopens from the 🎮 button). */
export function closeMatch(): void {
  matchConn?.dispose();
  matchConn = null;
  hud.set({ frame: null, matchChat: [] });
}

/** A call on my own `player` (my computers), over a connection that closes after it. */
export async function withPlayer<T>(fn: (player: PlayerConn) => Promise<T>): Promise<T> {
  const player = client.player.get([String(world.selfId)], { params: { token: session } }).connect();
  try {
    return await fn(player);
  } finally {
    player.dispose();
  }
}

/** A readable message from a failed call. */
export const errorText = (err: unknown): string =>
  (err as { message?: string } | null)?.message?.replace(/^.*?: /, "") ?? "Something went wrong.";
