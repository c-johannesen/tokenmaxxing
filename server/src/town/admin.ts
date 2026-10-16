import { levelFor } from "@tokenmaxxing/core/format.ts";
import { addDays, dayKey } from "@tokenmaxxing/core/range.ts";
import { houseTier } from "@tokenmaxxing/core/world.ts";
import { UserError } from "rivetkit";
import { all, one, type Sql } from "../actors/shared.ts";
import { forgetLogo } from "../brand.ts";
import { balances } from "./coins.ts";
import { type Changed, companyById, companyInfos, leave, withdraw } from "./companies.ts";
import { TOKENS, userById } from "./users.ts";

export interface AdminOverview {
  users: number;
  companies: number;
  signups24h: number;
  signups7d: number;
  /** People with usage today, and in the last 7 days. */
  activeToday: number;
  active7d: number;
  tokensToday: number;
  tokens30d: number;
  gamesToday: number;
  /** Every balance added up. */
  coins: number;
  deleted: number;
  /** People who sent tokens past the per-minute cap in the last 30 days. */
  flagged: number;
}

export interface AdminUser {
  id: number;
  name: string;
  createdAt: number;
  company: { id: number; name: string; isOwner: boolean } | null;
  level: number;
  tokensToday: number;
  tokens30d: number;
  tokensTotal: number;
  /** The last world day with usage. */
  lastDay: string | null;
  balance: number;
  items: number;
  games: number;
  /** Tokens past the per-minute cap in the last 30 days: they didn't count. More than 0 is suspicious. */
  capped30d: number;
}

/** One thing done from the admin page. */
export interface AdminLogEntry {
  id: number;
  at: number;
  action: string;
  target: string;
  detail: string | null;
}

export interface AdminCompany {
  id: number;
  name: string;
  owner: { id: number; name: string };
  plot: number;
  website: string | null;
  branding: "working" | "failed" | null;
  createdAt: number;
  members: { id: number; name: string }[];
  applicants: number;
  tier: number;
  tokensToday: number;
  tokens30d: number;
}

const count = async (sql: Sql, query: string, ...args: unknown[]): Promise<number> =>
  (await one<{ n: number | null }>(sql, query, ...args))?.n ?? 0;

export async function overview(sql: Sql, now: number): Promise<AdminOverview> {
  const today = dayKey(now);
  const week = addDays(today, -6);
  const coins = [...(await balances(sql, now)).values()].reduce((a, b) => a + b, 0);
  return {
    users: await count(sql, "SELECT COUNT(*) AS n FROM users"),
    companies: await count(sql, "SELECT COUNT(*) AS n FROM companies"),
    signups24h: await count(sql, "SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", now - 86_400_000),
    signups7d: await count(
      sql,
      "SELECT COUNT(*) AS n FROM users WHERE created_at >= ?",
      now - 7 * 86_400_000,
    ),
    activeToday: await count(
      sql,
      "SELECT COUNT(DISTINCT user_id) AS n FROM usage_daily WHERE day = ?",
      today,
    ),
    active7d: await count(sql, "SELECT COUNT(DISTINCT user_id) AS n FROM usage_daily WHERE day >= ?", week),
    tokensToday: await count(sql, `SELECT SUM(${TOKENS}) AS n FROM usage_daily WHERE day = ?`, today),
    tokens30d: await count(
      sql,
      `SELECT SUM(${TOKENS}) AS n FROM usage_daily WHERE day >= ?`,
      addDays(today, -29),
    ),
    gamesToday: await count(
      sql,
      "SELECT COUNT(DISTINCT match_id) AS n FROM match_players WHERE day = ?",
      today,
    ),
    coins,
    deleted: await count(sql, "SELECT COUNT(*) AS n FROM deleted_users"),
    flagged: await count(
      sql,
      "SELECT COUNT(DISTINCT user_id) AS n FROM capped_daily WHERE day >= ?",
      addDays(today, -29),
    ),
  };
}

/** Everyone, newest first. */
export async function users(sql: Sql, now: number): Promise<AdminUser[]> {
  const today = dayKey(now);
  const rows = await all<{
    id: number;
    name: string;
    createdAt: number;
    companyId: number | null;
    companyName: string | null;
    ownerId: number | null;
  }>(
    sql,
    `SELECT u.id, u.name, u.created_at AS createdAt, u.company_id AS companyId,
            c.name AS companyName, c.owner_id AS ownerId
     FROM users u LEFT JOIN companies c ON c.id = u.company_id ORDER BY u.id DESC`,
  );
  const usage = new Map(
    (
      await all<{ userId: number; today: number; d30: number; total: number; lastDay: string }>(
        sql,
        `SELECT user_id AS userId, SUM(${TOKENS}) AS total, MAX(day) AS lastDay,
                SUM(CASE WHEN day = ? THEN ${TOKENS} ELSE 0 END) AS today,
                SUM(CASE WHEN day >= ? THEN ${TOKENS} ELSE 0 END) AS d30
         FROM usage_daily GROUP BY user_id`,
        today,
        addDays(today, -29),
      )
    ).map((r) => [r.userId, r]),
  );
  const perUser = async (query: string) =>
    new Map((await all<{ userId: number; n: number }>(sql, query)).map((r) => [r.userId, r.n]));
  const items = await perUser("SELECT owner_id AS userId, COUNT(*) AS n FROM items GROUP BY owner_id");
  const games = await perUser("SELECT user_id AS userId, COUNT(*) AS n FROM match_players GROUP BY user_id");
  const capped = new Map(
    (
      await all<{ userId: number; n: number }>(
        sql,
        "SELECT user_id AS userId, SUM(tokens) AS n FROM capped_daily WHERE day >= ? GROUP BY user_id",
        addDays(today, -29),
      )
    ).map((r) => [r.userId, r.n]),
  );
  const coins = await balances(sql, now);
  return rows.map((r) => {
    const u = usage.get(r.id);
    return {
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      company:
        r.companyId === null ? null : { id: r.companyId, name: r.companyName!, isOwner: r.ownerId === r.id },
      level: levelFor(u?.total ?? 0),
      tokensToday: u?.today ?? 0,
      tokens30d: u?.d30 ?? 0,
      tokensTotal: u?.total ?? 0,
      lastDay: u?.lastDay ?? null,
      balance: coins.get(r.id) ?? 0,
      items: items.get(r.id) ?? 0,
      games: games.get(r.id) ?? 0,
      capped30d: capped.get(r.id) ?? 0,
    };
  });
}

/** Every company, busiest first (30-day tokens). */
export async function companies(sql: Sql): Promise<AdminCompany[]> {
  const rows = await all<{
    id: number;
    ownerId: number;
    ownerName: string | null;
    branding: AdminCompany["branding"];
    createdAt: number;
    applicants: number;
  }>(
    sql,
    `SELECT c.id, c.owner_id AS ownerId, o.name AS ownerName, c.branding, c.created_at AS createdAt,
            (SELECT COUNT(*) FROM applications a WHERE a.company_id = c.id) AS applicants
     FROM companies c LEFT JOIN users o ON o.id = c.owner_id`,
  );
  const infos = new Map(
    (
      await companyInfos(
        sql,
        rows.map((r) => r.id),
      )
    ).map((i) => [i.id, i]),
  );
  const members = await all<{ id: number; name: string; companyId: number }>(
    sql,
    "SELECT id, name, company_id AS companyId FROM users WHERE company_id IS NOT NULL ORDER BY joined_at, id",
  );
  return rows
    .map((r) => {
      const info = infos.get(r.id)!;
      return {
        id: r.id,
        name: info.name,
        owner: { id: r.ownerId, name: r.ownerName ?? "?" },
        plot: info.plot,
        website: info.website,
        branding: r.branding,
        createdAt: r.createdAt,
        members: members.filter((m) => m.companyId === r.id).map(({ id, name }) => ({ id, name })),
        applicants: r.applicants,
        tier: houseTier(info.tokens30d, info.members),
        tokensToday: info.todayTokens,
        tokens30d: info.tokens30d,
      };
    })
    .sort((a, b) => b.tokens30d - a.tokens30d);
}

/**
 * Deletes an account: its usage, activity, purchases, items (those it dropped too), rewards, office,
 * application, trade offers and company seat (the company hands over or closes, as when leaving).
 * Refused while they have coins on a game that isn't settled, so no pot comes up short (furniture is
 * paid for, not held). Their `ledger` and `match_players` rows stay: other players' games add up with
 * them, and ids are never reused (`deleted_users`).
 */
export async function deleteUser(sql: Sql, userId: number, now: number): Promise<Changed> {
  const u = await userById(sql, userId);
  // From before `items`, a trade that moved an item, or furniture, sums to minus its price for good:
  // that's not a game.
  const playing = await one(
    sql,
    `SELECT ref FROM ledger WHERE kind NOT IN ('admin', 'trade', 'furniture')
       AND ref IN (SELECT ref FROM ledger WHERE user_id = ?)
     GROUP BY ref HAVING SUM(amount) < 0 LIMIT 1`,
    userId,
  );
  if (playing)
    throw new UserError(`${u.name} has coins in a game that isn't over. Try again when it is.`, {
      code: "playing",
    });
  const changed = await leave(sql, userId);
  await withdraw(sql, userId);
  await sql.execute("DELETE FROM trades WHERE from_id = ? OR to_id = ?", userId, userId);
  for (const table of ["usage_daily", "activity_daily", "capped_daily", "purchases", "rewards", "offices"])
    await sql.execute(`DELETE FROM ${table} WHERE user_id = ?`, userId);
  await sql.execute(
    "DELETE FROM items WHERE owner_id = ? OR (owner_id IS NULL AND dropped_by = ?)",
    userId,
    userId,
  );
  await sql.execute("INSERT INTO deleted_users (id, name, at) VALUES (?, ?, ?)", userId, u.name, now);
  await sql.execute("DELETE FROM users WHERE id = ?", userId);
  return changed;
}

/** Closes a company: everyone's out, its plot and logo are freed and its applications dropped. */
export async function closeCompany(sql: Sql, companyId: number): Promise<Changed> {
  if (!(await companyById(sql, companyId)))
    throw new UserError("That company is gone.", { code: "not_found" });
  const members = await all<{ id: number }>(sql, "SELECT id FROM users WHERE company_id = ?", companyId);
  await sql.execute("UPDATE users SET company_id = NULL, joined_at = NULL WHERE company_id = ?", companyId);
  await sql.execute("DELETE FROM companies WHERE id = ?", companyId);
  await sql.execute("DELETE FROM applications WHERE company_id = ?", companyId);
  await forgetLogo(companyId);
  return { users: members.map((m) => m.id), companies: [companyId] };
}

/** Forgets someone's usage (their `player` drops the raw events first): for faked numbers. */
export async function wipeUsage(sql: Sql, userId: number): Promise<void> {
  for (const table of ["usage_daily", "activity_daily", "capped_daily"])
    await sql.execute(`DELETE FROM ${table} WHERE user_id = ?`, userId);
}

/** Every change made from the admin page is written down, with what it was before where that matters. */
export async function logAdmin(
  sql: Sql,
  action: string,
  target: string,
  detail: string | null,
  now: number,
): Promise<void> {
  await sql.execute(
    "INSERT INTO admin_log (at, action, target, detail) VALUES (?, ?, ?, ?)",
    now,
    action,
    target,
    detail,
  );
}

/** The newest 500 entries. */
export const adminLog = (sql: Sql): Promise<AdminLogEntry[]> =>
  all<AdminLogEntry>(sql, "SELECT id, at, action, target, detail FROM admin_log ORDER BY id DESC LIMIT 500");
