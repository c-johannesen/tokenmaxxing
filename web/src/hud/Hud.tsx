import { isBot } from "@tokenmaxxing/core/bots.ts";
import { compact, levelTitle } from "@tokenmaxxing/core/format.ts";
import { levelItems } from "@tokenmaxxing/core/shop.ts";
import { useEffect, useRef, useState } from "react";
import { roomName, world } from "../game/world.ts";
import { chatBeside, hud, useHud } from "../store.ts";
import { AppSignIn } from "./AppSignIn.tsx";
import { AppUpdate, tauri } from "./AppUpdate.tsx";
import { ArcadePanel, GamesBox, InviteToast, NewTable } from "./Arcade.tsx";
import { Bag } from "./Bag.tsx";
import { Chat } from "./Chat.tsx";
import { CompanyCard } from "./CompanyCard.tsx";
import { CompanyPanel } from "./CompanyPanel.tsx";
import { Leaderboard } from "./Leaderboard.tsx";
import { LookPicker } from "./LookPicker.tsx";
import { MatchPanel } from "./Match.tsx";
import { MiniBoard } from "./MiniBoard.tsx";
import { Minimap } from "./Minimap.tsx";
import { OfficePanel } from "./OfficePanel.tsx";
import { BotCard, PlayerCard } from "./PlayerCard.tsx";
import { Shop } from "./Shop.tsx";
import { TradePanel, TradesPanel } from "./Trades.tsx";
import { Modal } from "./ui.tsx";

export function Hud() {
  const status = useHud((s) => s.status);
  const beside = useHud((s) => chatBeside(s.panel));
  if (status === "signedOut" || status === "expired")
    return tauri ? <AppSignIn /> : <SignedOut expired={status === "expired"} />;
  return (
    <>
      <Hints />
      <Stats />
      <div className="corner">
        <MiniBoard />
        <GamesBox />
      </div>
      <Banner />
      {!beside && <Chat />}
      <Minimap />
      <Dialog />
      <Panel />
      {status === "connecting" && (
        <div className="toast" role="status">
          Walking into town…
        </div>
      )}
      {status === "offline" && (
        <div className="toast" role="status">
          Reconnecting…
        </div>
      )}
      <div className="toasts">
        <MentionToast />
        <NoticeToast />
        <QuestToast />
        <InviteToast />
        <LevelToast />
      </div>
      <FirstVisit />
    </>
  );
}

function Hints() {
  return (
    // Just an ⓘ until hovered (or focused from the keyboard), then the whole cheat sheet.
    <div className="panel hints">
      <button type="button" className="title" aria-label="Controls">
        ⓘ<span className="hints-name"> ⚡ tokenmaxxing</span>
      </button>
      <dl>
        <dt>Arrows</dt>
        <dd>Move</dd>
        <dt>X</dt>
        <dd>Run</dd>
        <dt>Space</dt>
        <dd>Jump</dd>
        <dt>E</dt>
        <dd>Interact</dd>
        <dt>Enter</dt>
        <dd>Chat</dd>
        <dt>L</dt>
        <dd>Leaderboard</dd>
        <dt>Esc</dt>
        <dd>Menu</dd>
        <dt>+ −</dt>
        <dd>Zoom</dd>
      </dl>
    </div>
  );
}

function Stats() {
  const stats = useHud((s) => s.stats);
  const wallet = useHud((s) => s.wallet);
  const waiting = useHud((s) => s.me?.company?.applicants.length ?? 0);
  return (
    <div className="panel stats-chip">
      <AppUpdate />
      {stats && (
        <button
          type="button"
          className="chip"
          onClick={() => hud.set({ panel: { kind: "card", userId: world.selfId } })}
        >
          <strong>{compact(stats.tokensToday)}</strong> today
          {stats.rank !== null && <span className="badge">#{stats.rank}</span>}
          <span className="badge lv">Lv{stats.level}</span>
        </button>
      )}
      {wallet && (
        <button
          type="button"
          className="chip"
          title="Shop"
          aria-label={`Shop: ${wallet.balance} coins`}
          onClick={() => hud.set({ panel: { kind: "shop" } })}
        >
          🪙 <strong>{wallet.balance.toLocaleString()}</strong>
        </button>
      )}
      <button
        type="button"
        className="icon"
        title="Bag"
        aria-label="Bag"
        onClick={() => hud.set({ panel: { kind: "bag" } })}
      >
        🎒
      </button>
      <button
        type="button"
        className="icon"
        title={waiting ? `Company: ${waiting} asking to join` : "Company"}
        aria-label={waiting ? `Company: ${waiting} asking to join` : "Company"}
        onClick={() => hud.set({ panel: { kind: "company" } })}
      >
        🏢{waiting > 0 && <span className="count">{waiting}</span>}
      </button>
    </div>
  );
}

const BANNER_MS = 2500;
const MENTION_MS = 8000;

/** True while something that happened `at` is less than `ms` old; re-renders when it expires. */
function useFresh(at: number | undefined, ms: number): boolean {
  const [, tick] = useState(0);
  useEffect(() => {
    if (at === undefined) return;
    const id = setTimeout(() => tick((n) => n + 1), at + ms - Date.now() + 50);
    return () => clearTimeout(id);
  }, [at, ms]);
  return at !== undefined && Date.now() - at <= ms;
}

function Banner() {
  const banner = useHud((s) => s.banner);
  if (!useFresh(banner?.at, BANNER_MS) || !banner) return null;
  return <div className="banner">{banner.text}</div>;
}

function Dialog() {
  const dialog = useHud((s) => s.dialog);
  if (!dialog) return null;
  return (
    <div className="panel dialog" role="status">
      {dialog}
      <span className="muted small"> ▼ E</span>
    </div>
  );
}

function Panel() {
  const panel = useHud((s) => s.panel);
  const inMyOffice = useHud((s) => s.room === `office:${world.selfId}`);
  if (!panel) return null;
  switch (panel.kind) {
    case "leaderboard":
      return <Leaderboard />;
    case "card":
      return isBot(panel.userId) ? <BotCard id={panel.userId} /> : <PlayerCard userId={panel.userId} />;
    case "companyCard":
      return <CompanyCard companyId={panel.companyId} />;
    case "company":
      return <CompanyPanel />;
    case "look":
      return <LookPicker />;
    case "shop":
      return <Shop />;
    case "bag":
      return <Bag />;
    case "arcade":
      return <ArcadePanel />;
    case "newTable":
      return <NewTable invite={panel.invite} />;
    case "match":
      return <MatchPanel id={panel.id} />;
    case "trade":
      return <TradePanel userId={panel.userId} />;
    case "trades":
      return <TradesPanel />;
    case "office":
      return <OfficePanel />;
    case "menu":
      return (
        <Modal title="Menu">
          <nav className="menu">
            {inMyOffice && (
              <button type="button" onClick={() => hud.set({ panel: { kind: "office" } })}>
                🛋 Furnish your office
              </button>
            )}
            <button type="button" onClick={() => hud.set({ panel: { kind: "look" } })}>
              🎨 Your character
            </button>
            <button type="button" onClick={() => hud.set({ panel: { kind: "shop" } })}>
              🪙 Shop
            </button>
            <button type="button" onClick={() => hud.set({ panel: { kind: "bag" } })}>
              🎒 Bag
            </button>
            <button type="button" onClick={() => hud.set({ panel: { kind: "trades" } })}>
              🔁 Trades
            </button>
            <button type="button" onClick={() => hud.set({ panel: { kind: "arcade" } })}>
              🎮 Arcade
            </button>
            <button type="button" onClick={() => hud.set({ panel: { kind: "company" } })}>
              🏢 Company
            </button>
            <button type="button" onClick={() => hud.set({ panel: { kind: "leaderboard" } })}>
              🏆 Leaderboard
            </button>
            <a href="https://github.com/HansKristoffer/tokenmaxxing" target="_blank" rel="noreferrer">
              ⌥ GitHub
            </a>
          </nav>
        </Modal>
      );
  }
}

function SignedOut({ expired }: { expired: boolean }) {
  return (
    <div className="signed-out">
      <div className="panel">
        <p className="title">⚡ tokenmaxxing</p>
        <p>{expired ? "That link has expired." : "A tiny town for people who run AI coding agents."}</p>
        <p>
          Open the world from the <strong>tokenmaxxing</strong> menu bar app to walk in.
        </p>
        <p className="muted">
          Don't have it yet? <code>brew install --cask hanskristoffer/tap/tokenmaxxing</code>
        </p>
      </div>
    </div>
  );
}

const FIRST_VISIT_KEY = "tokenmaxxing.pickedCompany";

/** Right after signing up: the first time in town without a company, offer to start or join one. */
function FirstVisit() {
  const me = useHud((s) => s.me);
  useEffect(() => {
    if (!me || localStorage.getItem(FIRST_VISIT_KEY)) return;
    localStorage.setItem(FIRST_VISIT_KEY, "1");
    if (!me.company && !me.application) hud.set({ panel: { kind: "company" } });
  }, [me]);
  return null;
}

const NOTICE_ICONS = { company: "🏢", trades: "🔁", shop: "🪙" } as const;

/** A line for me from the server (a company application, a trade); a click opens what it's about. */
function NoticeToast() {
  const notice = useHud((s) => s.notice);
  if (!useFresh(notice?.at, MENTION_MS) || !notice) return null;
  const { open } = notice;
  return (
    <button
      type="button"
      className="toast mention-toast"
      onClick={() => hud.set({ notice: null, ...(open && { panel: { kind: open } }) })}
    >
      {open && `${NOTICE_ICONS[open]} `}
      {notice.text}
    </button>
  );
}

/** My level went up while I was here; the first level after load is just where I started. */
function LevelToast() {
  const level = useHud((s) => s.stats?.level);
  const company = useHud((s) => s.me?.company);
  const seen = useRef<number | undefined>(undefined);
  const [up, setUp] = useState<{ from: number; to: number; at: number } | null>(null);
  useEffect(() => {
    if (level === undefined) return;
    if (seen.current !== undefined && level > seen.current)
      setUp({ from: seen.current, to: level, at: Date.now() });
    seen.current = level;
  }, [level]);
  if (!useFresh(up?.at, MENTION_MS) || !up) return null;
  // The first reward passed on the way up: a big sync can skip a level or two.
  const reward = levelItems(up.to).find((i) => i.level! > up.from);
  return (
    <button
      type="button"
      className="toast mention-toast"
      onClick={() => {
        setUp(null);
        hud.set({ panel: { kind: "shop" } });
      }}
    >
      ⬆️ Level {up.to} · {levelTitle(up.to)}
      {reward && ` · You unlocked the ${reward.name}`}
      {reward?.level === 10 && (company ? " and your own office" : " · Join a company for your own office")}
    </button>
  );
}

/** Someone @-mentioned me from another room. */
function MentionToast() {
  const mention = useHud((s) => s.mention);
  if (!useFresh(mention?.at, MENTION_MS) || !mention) return null;
  const { line } = mention;
  return (
    <button
      type="button"
      className="toast mention-toast"
      onClick={() => hud.set({ mention: null, panel: { kind: "card", userId: line.userId } })}
    >
      💬 <strong>{line.name}</strong> mentioned you in {roomName(line.room)}: {line.text}
    </button>
  );
}

/**
 * Quests the last wallet has done that the one before didn't. The first wallet after load
 * is the baseline, so a reload doesn't toast what's already done.
 */
function QuestToast() {
  const quests = useHud((s) => s.wallet?.quests);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<{ quests: NonNullable<typeof quests>; at: number } | null>(null);
  useEffect(() => {
    if (!quests) return;
    const done = quests.filter((q) => q.done);
    const before = seen.current;
    seen.current = new Set(done.map((q) => q.id));
    const now = before ? done.filter((q) => !before.has(q.id)) : [];
    if (now.length > 0) setFresh({ quests: now, at: Date.now() });
  }, [quests]);
  if (!useFresh(fresh?.at, MENTION_MS) || !fresh) return null;
  return (
    <button
      type="button"
      className="toast mention-toast"
      onClick={() => {
        setFresh(null);
        hud.set({ panel: { kind: "shop" } });
      }}
    >
      {fresh.quests.map((q) => `✓ ${q.text} · 🪙 ${q.coins}`).join("  ")}
    </button>
  );
}
