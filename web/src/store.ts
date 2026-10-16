import type { Frame, Lobby, MatchChatLine } from "@tokenmaxxing/core/games/wire.ts";
import type { ChatLine, CompanyInfo, Notice, RoomId } from "@tokenmaxxing/core/world.ts";
import type { Me, Today, Wallet } from "@tokenmaxxing/server/registry";
import { useSyncExternalStore } from "react";

export type Panel =
  | { kind: "leaderboard" }
  | { kind: "card"; userId: number }
  | { kind: "companyCard"; companyId: number }
  | { kind: "company" }
  | { kind: "look" }
  | { kind: "shop" }
  | { kind: "arcade" }
  | { kind: "newTable"; invite?: number }
  | { kind: "match"; id: number }
  | { kind: "trade"; userId: number }
  | { kind: "trades" }
  | { kind: "office" }
  | { kind: "menu" };

/** Game panels keep the chat usable beside them. */
export const chatBeside = (panel: Panel | null): boolean =>
  panel?.kind === "arcade" || panel?.kind === "newTable" || panel?.kind === "match";

/** Everything the React HUD shows. The canvas world keeps its own state in `game/world.ts`. */
interface HudState {
  status: "connecting" | "ready" | "signedOut" | "expired" | "offline";
  me: Me | null;
  stats: Today["me"] | null;
  wallet: Wallet | null;
  /** Today's top players by tokens, with me appended when I'm outside them. */
  board: Today["top"];
  room: RoomId;
  occupancy: Partial<Record<RoomId, number>>;
  companies: CompanyInfo[];
  chat: ChatLine[];
  panel: Panel | null;
  /** A line of text at the bottom (inspecting things, locked doors). */
  dialog: string | null;
  /** The room name, shown briefly on entering. */
  banner: { text: string; at: number } | null;
  /** Bumped to ask the chat input to take focus. */
  chatFocus: number;
  /** A line from the server for me: someone asked to join my company, or offered me a trade. */
  notice: (Notice & { at: number }) | null;
  /** Tables, games and where I am in them, live from the arcade. */
  lobby: Lobby | null;
  /** The open match panel's latest frame. */
  frame: Frame | null;
  /** The open match's own chat. */
  matchChat: MatchChatLine[];
  /** How far my clock is ahead of the server's, for countdowns. */
  clockSkew: number;
  /** The table of an invite that just came in, shown as a toast. */
  inviteTable: number | null;
  /** The last time someone @-mentioned me from another room. */
  mention: { line: ChatLine; at: number } | null;
}

let state: HudState = {
  status: "connecting",
  me: null,
  stats: null,
  wallet: null,
  board: [],
  room: "town",
  occupancy: {},
  companies: [],
  chat: [],
  panel: null,
  dialog: null,
  banner: null,
  chatFocus: 0,
  mention: null,
  notice: null,
  lobby: null,
  frame: null,
  matchChat: [],
  clockSkew: 0,
  inviteTable: null,
};
const listeners = new Set<() => void>();

export const hud = {
  get: () => state,
  set(patch: Partial<HudState> | ((s: HudState) => Partial<HudState>)) {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useHud<T>(select: (s: HudState) => T): T {
  return useSyncExternalStore(hud.subscribe, () => select(state));
}
