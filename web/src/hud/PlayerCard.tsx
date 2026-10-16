import { BADGES } from "@tokenmaxxing/core/badges.ts";
import { BOTS } from "@tokenmaxxing/core/bots.ts";
import { compact, hoursText, levelAt, levelTitle, plural, usd } from "@tokenmaxxing/core/format.ts";
import type { RangeKey } from "@tokenmaxxing/core/range.ts";
import type { Profile } from "@tokenmaxxing/server/registry";
import { useEffect, useState } from "react";
import { world } from "../game/world.ts";
import { errorText, town } from "../net.ts";
import { hud } from "../store.ts";
import { Computers } from "./Computers.tsx";
import { AvatarImage, Modal, Pills } from "./ui.tsx";

export const RANGES = [
  ["today", "Today"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["all", "All"],
] as const;

function doing(userId: number): string | null {
  const a = world.avatars.get(userId);
  if (!a) return null;
  if (a.state === "working") return `💻 running ${plural(Math.max(1, a.info.liveAgents), "agent")}`;
  if (a.state === "away") return "💤 asleep";
  if (a.info.dozing) return "💤 away";
  return a.info.online ? "🟢 here" : null;
}

/** A town character: no stats, just who they are. */
export function BotCard({ id }: { id: number }) {
  const bot = BOTS.find((b) => b.id === id);
  if (!bot) return <Modal title="Player">Gone for a walk.</Modal>;
  return (
    <Modal title={bot.name}>
      <div className="card-head">
        <AvatarImage look={bot.look} scale={5} />
        <div>
          <p>
            <strong>Level {bot.level}</strong> · 🤖 Town character
          </p>
          <p className="muted">{bot.bio}</p>
        </div>
      </div>
    </Modal>
  );
}

export function PlayerCard({ userId }: { userId: number }) {
  const [range, setRange] = useState<RangeKey>("7d");
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    town.profile(userId, range).then(
      (r) => live && setP(r),
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [userId, range]);

  if (error) return <Modal title="Player">{error}</Modal>;
  if (!p) return <Modal title="Player">Loading…</Modal>;
  const t = p.totals;
  const status = doing(userId);
  const today = p.daily.at(-1)?.tokens ?? 0;
  return (
    <Modal
      title={
        <>
          {p.name}
          {status && <span className="status small"> {status}</span>}
        </>
      }
    >
      <div className="card-head">
        <AvatarImage look={p.look} scale={5} />
        <div>
          <p>
            <strong>Level {p.level}</strong> · {p.levelTitle}
            {today > 0 && <span className="xp-today small"> · +{compact(today)} today</span>}
          </p>
          <XpBar level={p.level} tokens={p.lifetimeTokens} today={today} />
          <p className="muted small">
            Next: Lv{p.level + 1} {levelTitle(p.level + 1)} in{" "}
            {compact(levelAt(p.level + 1) - p.lifetimeTokens)} tokens
          </p>
          {p.badges.length > 0 && (
            <ul className="badges">
              {p.badges.map((b) => {
                const next = BADGES.find((d) => d.id === b.id)?.tiers[b.tier];
                return (
                  <li key={b.id} className="badge" title={next && `${next.label} next`}>
                    {b.emoji} {b.label}
                  </li>
                );
              })}
            </ul>
          )}
          {p.company ? (
            <p>
              <button
                type="button"
                className="link"
                onClick={() => hud.set({ panel: { kind: "companyCard", companyId: p.company!.id } })}
              >
                🏢 {p.company.name}
              </button>
            </p>
          ) : (
            <p className="muted">Freelancer</p>
          )}
          <p className="muted">{compact(p.lifetimeTokens)} tokens all time</p>
          {userId !== world.selfId && (
            <button type="button" onClick={() => hud.set({ panel: { kind: "newTable", invite: userId } })}>
              🎮 Invite to a game
            </button>
          )}
        </div>
      </div>
      <Pills value={range} options={RANGES} onChange={setRange} />
      <StatsGrid totals={t} />
      {p.models.length > 0 && (
        <p className="muted small">
          Top model: <strong>{p.models[0]!.model}</strong>
        </p>
      )}
      <DailyChart daily={p.daily} />
      {p.games && (
        <p className="muted small">
          🎮 {plural(p.games.played, "game")} · {Math.round((p.games.wins / p.games.played) * 100)}% won ·{" "}
          {p.games.net >= 0 ? "+" : "−"}🪙 {Math.abs(p.games.net)}
          {p.games.biggestPot > 0 && ` · biggest pot 🪙 ${p.games.biggestPot}`}
        </p>
      )}
      {userId === world.selfId && <Computers />}
    </Modal>
  );
}

/** Progress through the current level: earlier tokens, then today's. */
function XpBar({ level, tokens, today }: { level: number; tokens: number; today: number }) {
  const start = levelAt(level);
  const span = levelAt(level + 1) - start;
  // Today's tokens that count toward this level: all of the progress if today crossed into it.
  const before = Math.max(0, tokens - today - start);
  const gained = tokens - start - before;
  return (
    <div className="xp" aria-hidden="true">
      <span className="xp-done" style={{ width: `${(before / span) * 100}%` }} />
      <span className="xp-gain" style={{ width: `${(gained / span) * 100}%` }} />
    </div>
  );
}

/** The numbers both cards show, for the chosen range. */
export function StatsGrid({ totals: t }: { totals: Profile["totals"] }) {
  return (
    <dl className="stats">
      <div>
        <dt>Tokens</dt>
        <dd>{compact(t.tokens)}</dd>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>{usd(t.costUsd)}</dd>
      </div>
      <div>
        <dt>Agent hours</dt>
        <dd>{hoursText(t.activeHours)}</dd>
      </div>
      <div>
        <dt>Parallel</dt>
        <dd>{t.parallelism === null ? "–" : `${t.parallelism.toFixed(1)}×`}</dd>
      </div>
      <div>
        <dt>Peak agents</dt>
        <dd>{t.peakAgents}</dd>
      </div>
      <div>
        <dt>Per active hour</dt>
        <dd>{t.tokensPerActiveHour === null ? "–" : compact(t.tokensPerActiveHour)}</dd>
      </div>
      <div>
        <dt>PRs</dt>
        <dd>{t.prs}</dd>
      </div>
    </dl>
  );
}

/** Tokens per day, the last 30 days. */
export function DailyChart({ daily }: { daily: Profile["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.tokens));
  return (
    <figure className="chart">
      <svg
        viewBox="0 0 300 60"
        preserveAspectRatio="none"
        role="img"
        aria-label="Tokens per day, last 30 days"
      >
        {daily.map((d, i) => {
          const h = (d.tokens / max) * 56;
          return (
            <rect key={d.day} x={i * 10 + 1} y={60 - h} width={8} height={Math.max(h, d.tokens ? 1 : 0)}>
              <title>
                {d.day}: {compact(d.tokens)} tokens, {usd(d.costUsd)}
              </title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="muted small">Last 30 days</figcaption>
    </figure>
  );
}
