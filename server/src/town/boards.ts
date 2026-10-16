import { type Badge, badgesFor, streakOf } from "@tokenmaxxing/core/badges.ts";
import { levelFor, levelTitle } from "@tokenmaxxing/core/format.ts";
import { addDays, dayKey, type RangeKey, rangeDays } from "@tokenmaxxing/core/range.ts";
import { type Brand, houseTier, type Look } from "@tokenmaxxing/core/world.ts";
import { UserError } from "rivetkit";
import { all, one, pricing, type Sql } from "../actors/shared.ts";
import {
  type ActivityRow,
  companyTotals,
  rank,
  rowCost,
  rowTokens,
  type SortKey,
  type Totals,
  totals,
  type UsageRow,
} from "../stats.ts";
import { podiumDays } from "./coins.ts";
import { COMPANY_COLS, type CompanyRow, companyById, companyInfos } from "./companies.ts";
import { type GameStats, gameStats } from "./games.ts";
import { lookOf, TOKENS, tokensIn, USER_COLS, type UserRow, userById } from "./users.ts";

export interface BoardPlayer extends Totals {
  rank: number;
  userId: number;
  name: string;
  look: Look;
  level: number;
  companyId: number | null;
  company: string | null;
}

export interface BoardCompany extends Totals {
  rank: number;
  companyId: number;
  name: string;
  members: number;
  tier: number;
}

export interface Leaderboard {
  range: RangeKey;
  sort: SortKey;
  players: BoardPlayer[];
  companies: BoardCompany[];
}

export interface Daily {
  day: string;
  tokens: number;
  costUsd: number;
}

export interface CompanyProfile {
  id: number;
  name: string;
  /** Bare host, e.g. `acme.com`. */
  website: string | null;
  /** Same-origin path to its logo, when its website had one. */
  logo: string | null;
  brand: Brand | null;
  tier: number;
  range: RangeKey;
  /** Among companies by tokens in the range; null with none. */
  rank: number | null;
  totals: Totals;
  members: { userId: number; name: string; look: Look; level: number; tokens: number; isOwner: boolean }[];
  /** The last 30 world days, oldest first. */
  daily: Daily[];
}

export interface Profile {
  userId: number;
  name: string;
  look: Look;
  level: number;
  levelTitle: string;
  lifetimeTokens: number;
  company: { id: number; name: string } | null;
  range: RangeKey;
  totals: Totals;
  models: { model: string; tokens: number; costUsd: number; turns: number }[];
  /** The last 30 world days, oldest first, zeros included. */
  daily: Daily[];
  /** All time; null for someone who never finished a game. */
  games: GameStats | null;
  badges: Badge[];
}

/** The HUD's corner: my numbers today, and today's top 5 (with me pinned below when I'm not in it). */
export interface Today {
  me: { rank: number | null; tokensToday: number; level: number };
  top: { rank: number; userId: number; name: string; tokens: number; isMe: boolean }[];
}

const TODAY_TOP = 5;

const BOARD_TOP = 100;

const ACTIVITY_SUMS = `SUM(prompts) AS prompts, SUM(prs) AS prs, SUM(agent_buckets) AS agentBuckets,
              SUM(active_buckets) AS activeBuckets, MAX(peak_agents) AS peakAgents`;

const SUMS = `SUM(input) AS input, SUM(output) AS output, SUM(cache_creation) AS cacheCreation,
              SUM(cache_read) AS cacheRead, SUM(turns) AS turns, SUM(reported_cost_cents) AS reportedCostCents`;

/** `[from, to]` as SQL bounds; all time starts at the beginning. */
export const bounds = (range: RangeKey, now: number): [string, string] => {
  const { from, to } = rangeDays(range, now);
  return [from ?? "0000-00-00", to];
};

/** Every player's totals in the range, ranked by `sort`. */
async function playerBoard(sql: Sql, range: RangeKey, sort: SortKey, now: number) {
  const [from, to] = bounds(range, now);
  const users = await all<UserRow>(sql, `SELECT ${USER_COLS} FROM users`);
  const usage = await all<UsageRow & { userId: number }>(
    sql,
    `SELECT user_id AS userId, model, ${SUMS} FROM usage_daily WHERE day >= ? AND day <= ? GROUP BY user_id, model`,
    from,
    to,
  );
  const activity = await all<ActivityRow & { userId: number }>(
    sql,
    `SELECT user_id AS userId, ${ACTIVITY_SUMS} FROM activity_daily WHERE day >= ? AND day <= ? GROUP BY user_id`,
    from,
    to,
  );
  const companies = await all<CompanyRow>(sql, `SELECT ${COMPANY_COLS} FROM companies`);
  const lifetime = await tokensIn(
    sql,
    users.map((u) => u.id),
  );
  const companyName = new Map(companies.map((co) => [co.id, co.name]));

  const usageByUser = Map.groupBy(usage, (r) => r.userId);
  const activityByUser = new Map(activity.map((a) => [a.userId, a]));
  const perUser = users.map((u) => ({
    ...totals(pricing, usageByUser.get(u.id) ?? [], activityByUser.get(u.id) ?? null),
    userId: u.id,
    name: u.name,
    look: lookOf(u),
    level: levelFor(lifetime.get(u.id) ?? 0),
    companyId: u.companyId,
    company: u.companyId === null ? null : (companyName.get(u.companyId) ?? null),
  }));
  return { players: rank(perUser, sort), perUser, companies };
}

export async function boards(sql: Sql, range: RangeKey, sort: SortKey, now: number) {
  const { players, perUser, companies } = await playerBoard(sql, range, sort, now);
  const tokens30d = new Map(
    (
      await companyInfos(
        sql,
        companies.map((co) => co.id),
      )
    ).map((i) => [i.id, i.tokens30d]),
  );
  const byCompany = Map.groupBy(perUser, (p) => p.companyId);
  const companyRows = companies.map((co) => {
    const members = byCompany.get(co.id) ?? [];
    return {
      ...companyTotals(members),
      companyId: co.id,
      name: co.name,
      members: members.length,
      tier: houseTier(tokens30d.get(co.id) ?? 0, members.length),
    };
  });
  return { players, companies: rank(companyRows, sort) };
}

export async function profile(sql: Sql, userId: number, range: RangeKey, now: number): Promise<Profile> {
  const u = await userById(sql, userId);
  const [from, to] = bounds(range, now);
  const usage = await all<UsageRow>(
    sql,
    `SELECT model, ${SUMS} FROM usage_daily WHERE user_id = ? AND day >= ? AND day <= ? GROUP BY model`,
    userId,
    from,
    to,
  );
  const activity = await one<ActivityRow>(
    sql,
    `SELECT ${ACTIVITY_SUMS} FROM activity_daily WHERE user_id = ? AND day >= ? AND day <= ?`,
    userId,
    from,
    to,
  );
  const daily = await last30Days(sql, "user_id = ?", userId, now);
  const lifetime = (await tokensIn(sql, [userId])).get(userId) ?? 0;
  const level = levelFor(lifetime);
  const co = u.companyId === null ? undefined : await companyById(sql, u.companyId);
  const company = co ? { id: co.id, name: co.name } : null;
  const games = await gameStats(sql, userId);
  // Badges. ponytail: four small queries per profile; fine for a card, cache per user if the card gets polled.
  const days = await all<{ day: string; tokens: number }>(
    sql,
    `SELECT day, SUM(${TOKENS}) AS tokens FROM usage_daily WHERE user_id = ? GROUP BY day`,
    userId,
  );
  const best = await one<{ peakAgents: number | null; prs: number | null }>(
    sql,
    "SELECT MAX(peak_agents) AS peakAgents, SUM(prs) AS prs FROM activity_daily WHERE user_id = ?",
    userId,
  );
  const badges = badgesFor({
    streak: streakOf(new Set(days.filter((d) => d.tokens > 0).map((d) => d.day)), dayKey(now)),
    bestDay: Math.max(0, ...days.map((d) => d.tokens)),
    podiums: (await podiumDays(sql, userId, now)).length,
    peakAgents: best?.peakAgents ?? 0,
    prs: best?.prs ?? 0,
    wins: games?.wins ?? 0,
    biggestPot: games?.biggestPot ?? 0,
    // An owner is always a member (`leave` hands over), so their own company says it.
    founder: co?.ownerId === userId,
  });
  return {
    userId,
    name: u.name,
    look: lookOf(u),
    level,
    levelTitle: levelTitle(level),
    lifetimeTokens: lifetime,
    company,
    range,
    totals: totals(pricing, usage, activity?.activeBuckets == null ? null : activity),
    models: usage
      .map((r) => ({ model: r.model, tokens: rowTokens(r), costUsd: rowCost(pricing, r), turns: r.turns }))
      .sort((a, b) => b.tokens - a.tokens),
    daily,
    games,
    badges,
  };
}

/** The last 30 world days of `usage_daily` rows matching `where`, oldest first, zeros included. */
async function last30Days(sql: Sql, where: string, arg: unknown, now: number): Promise<Daily[]> {
  const first = addDays(dayKey(now), -29);
  const days = await all<UsageRow & { day: string }>(
    sql,
    `SELECT day, model, ${SUMS} FROM usage_daily WHERE ${where} AND day >= ? GROUP BY day, model`,
    arg,
    first,
  );
  return Array.from({ length: 30 }, (_, i) => {
    const day = addDays(first, i);
    const rows = days.filter((r) => r.day === day);
    return {
      day,
      tokens: rows.reduce((n, r) => n + rowTokens(r), 0),
      costUsd: Math.round(rows.reduce((n, r) => n + rowCost(pricing, r), 0) * 100) / 100,
    };
  });
}

/**
 * A company's card: its numbers for the range (and where that ranks it by tokens), the last 30 days,
 * its website and logo, and its people, busiest first.
 */
export async function companyProfile(
  sql: Sql,
  companyId: number,
  range: RangeKey,
  now: number,
): Promise<CompanyProfile> {
  const company = await companyById(sql, companyId);
  if (!company) throw new UserError("That company is gone.", { code: "not_found" });
  const { players, companies } = await boards(sql, range, "tokens", now);
  const row = companies.find((c) => c.companyId === companyId)!;
  const [info] = await companyInfos(sql, [companyId]);
  return {
    id: companyId,
    name: company.name,
    website: company.website,
    logo: info?.brand?.logo ?? null,
    brand: info?.brand ?? null,
    tier: row.tier,
    range,
    rank: row.tokens > 0 ? row.rank : null,
    totals: row,
    members: players
      .filter((p) => p.companyId === companyId)
      .map((p) => ({
        userId: p.userId,
        name: p.name,
        look: p.look,
        level: p.level,
        tokens: p.tokens,
        isOwner: p.userId === company.ownerId,
      })),
    daily: await last30Days(sql, "user_id IN (SELECT id FROM users WHERE company_id = ?)", companyId, now),
  };
}

/** The leaderboard as shown: players with anything to show (and me), the top 100 of each. */
export async function leaderboard(
  sql: Sql,
  userId: number,
  range: RangeKey,
  sort: SortKey,
  now: number,
): Promise<Leaderboard> {
  const board = await boards(sql, range, sort, now);
  const players = board.players.filter((p) => p.tokens > 0 || p.prs > 0 || p.userId === userId);
  return {
    range,
    sort,
    players: players.filter((p, i) => i < BOARD_TOP || p.userId === userId),
    companies: board.companies.slice(0, BOARD_TOP),
  };
}

export async function today(sql: Sql, userId: number, now: number): Promise<Today> {
  const { players } = await playerBoard(sql, "today", "tokens", now);
  const mine = players.find((p) => p.userId === userId)!;
  const row = (p: BoardPlayer) => ({
    rank: p.rank,
    userId: p.userId,
    name: p.name,
    tokens: p.tokens,
    isMe: p.userId === userId,
  });
  const top = players.filter((p) => p.tokens > 0).slice(0, TODAY_TOP);
  return {
    me: { rank: mine.tokens > 0 ? mine.rank : null, tokensToday: mine.tokens, level: mine.level },
    top: top.some((p) => p.userId === userId) ? top.map(row) : [...top.map(row), row(mine)],
  };
}
