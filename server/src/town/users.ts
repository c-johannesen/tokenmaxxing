import { levelFor } from "@tokenmaxxing/core/format.ts";
import { dayKey } from "@tokenmaxxing/core/range.ts";
import { defaultLook, type Look, parseLook } from "@tokenmaxxing/core/world.ts";
import { UserError } from "rivetkit";
import { all, one, type Sql } from "../actors/shared.ts";

/** What `world` needs to draw someone; `town` owns all of it. */
export interface PlayerCore {
  id: number;
  name: string;
  look: Look;
  level: number;
  companyId: number | null;
  todayTokens: number;
}

export interface UserRow {
  id: number;
  name: string;
  companyId: number | null;
  look: string;
}

export const USER_COLS = "id, name, company_id AS companyId, look";

export const lookOf = (u: UserRow): Look => parseLook(JSON.parse(u.look)) ?? defaultLook(u.id);

export async function userById(sql: Sql, id: number): Promise<UserRow> {
  const u = await one<UserRow>(sql, `SELECT ${USER_COLS} FROM users WHERE id = ?`, id);
  if (!u) throw new UserError("Unknown player.", { code: "not_found" });
  return u;
}

/** Tokens counted everywhere: input, output, cache writes and cache reads (a `usage_daily` row). */
export const TOKENS = "input + output + cache_creation + cache_read";

/** Tokens per user, over `[from, to]` world days, or all time. */
export async function tokensIn(
  sql: Sql,
  userIds: number[],
  [from, to] = ["0000-00-00", "9999-99-99"],
): Promise<Map<number, number>> {
  const rows = await all<{ userId: number; tokens: number }>(
    sql,
    `SELECT user_id AS userId, SUM(${TOKENS}) AS tokens
     FROM usage_daily WHERE user_id IN (SELECT value FROM json_each(?)) AND day >= ? AND day <= ?
     GROUP BY user_id`,
    JSON.stringify(userIds),
    from,
    to,
  );
  return new Map(rows.map((r) => [r.userId, r.tokens]));
}

export const levelOf = async (sql: Sql, userId: number): Promise<number> =>
  levelFor((await tokensIn(sql, [userId])).get(userId) ?? 0);

export async function playerCores(sql: Sql, userIds: number[]): Promise<PlayerCore[]> {
  const users = await all<UserRow>(
    sql,
    `SELECT ${USER_COLS} FROM users WHERE id IN (SELECT value FROM json_each(?))`,
    JSON.stringify(userIds),
  );
  const today = dayKey(Date.now());
  const [lifetime, todays] = await Promise.all([
    tokensIn(sql, userIds),
    tokensIn(sql, userIds, [today, today]),
  ]);
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    look: lookOf(u),
    level: levelFor(lifetime.get(u.id) ?? 0),
    companyId: u.companyId,
    todayTokens: todays.get(u.id) ?? 0,
  }));
}
