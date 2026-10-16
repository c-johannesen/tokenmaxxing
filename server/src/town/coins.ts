import { levelFor } from "@tokenmaxxing/core/format.ts";
import { type DayFacts, EMPTY_DAY, QUESTS, questCoins } from "@tokenmaxxing/core/quests.ts";
import { addDays, dayKey } from "@tokenmaxxing/core/range.ts";
import {
  coinsForTokens,
  type Item,
  itemById,
  itemsIn,
  levelItems,
  PODIUM_COINS,
  type Side,
} from "@tokenmaxxing/core/shop.ts";
import { UserError } from "rivetkit";
import { all, one, type Sql, type TxSql } from "../actors/shared.ts";
import { lookOf, TOKENS, tokensIn, userById } from "./users.ts";

export interface Wallet {
  balance: number;
  /** Coins from today's tokens so far. */
  today: number;
  /** Days finished in the top 3, newest first (the last 30 days). */
  wins: { day: string; place: number; coins: number }[];
  /** Shop item ids: bought, and earned by level. */
  owned: string[];
  /** Today's quests, and which are done so far. */
  quests: { id: string; text: string; coins: number; done: boolean }[];
}

export const ownedItems = async (sql: Sql, userId: number): Promise<string[]> =>
  (await all<{ item: string }>(sql, "SELECT item FROM purchases WHERE user_id = ? ORDER BY at", userId)).map(
    (r) => r.item,
  );

/**
 * Coins are worked out from usage every time rather than stored, so a late sync
 * still pays. Podium places count once a day is over. Only days from the world day
 * someone signed up count, for pay and for places: a first sync backfills months of
 * logs, and those days would otherwise pay out (and win podiums nobody else was on).
 * ponytail: a late sync can also knock someone off a past podium after they spent
 * the bonus; the balance then reads short until they earn it back. Settle days into
 * a ledger if that ever matters.
 */
export async function wallet(sql: Sql, userId: number, now: number): Promise<Wallet> {
  const today = dayKey(now);
  const me = await one<{ createdAt: number }>(
    sql,
    "SELECT created_at AS createdAt FROM users WHERE id = ?",
    userId,
  );
  const from = me ? dayKey(me.createdAt) : today;
  const days = await all<{ day: string; tokens: number }>(
    sql,
    `SELECT day, SUM(${TOKENS}) AS tokens
     FROM usage_daily WHERE user_id = ? AND day >= ? GROUP BY day`,
    userId,
    from,
  );
  // ponytail: one more query per call for the quests, like the rest of the wallet.
  const activity = await all<{ day: string } & Omit<DayFacts, "tokens">>(
    sql,
    `SELECT day, peak_agents AS peakAgents, active_buckets AS activeBuckets, prs
     FROM activity_daily WHERE user_id = ? AND day >= ?`,
    userId,
    from,
  );
  const facts = new Map<string, DayFacts>(days.map((d) => [d.day, { ...EMPTY_DAY, tokens: d.tokens }]));
  for (const { day, ...a } of activity) facts.set(day, { ...EMPTY_DAY, ...facts.get(day), ...a });
  const places = await podiumDays(sql, userId, now);
  const [{ spent }] = (await all<{ spent: number | null }>(
    sql,
    "SELECT SUM(price) AS spent FROM purchases WHERE user_id = ?",
    userId,
  )) as [{ spent: number | null }];
  const wins = places.map((p) => ({ ...p, coins: PODIUM_COINS[p.place - 1]! }));
  const earned =
    days.reduce((n, d) => n + coinsForTokens(d.tokens), 0) +
    wins.reduce((n, w) => n + w.coins, 0) +
    [...facts.values()].reduce((n, f) => n + questCoins(f), 0);
  const since = addDays(today, -29);
  const lifetime = (await tokensIn(sql, [userId])).get(userId) ?? 0;
  const todays = facts.get(today) ?? EMPTY_DAY;
  return {
    balance: earned - (spent ?? 0) + (await ledgerSum(sql, userId)),
    today: coinsForTokens(days.find((d) => d.day === today)?.tokens ?? 0),
    wins: wins.filter((w) => w.day >= since),
    owned: [...(await ownedItems(sql, userId)), ...levelItems(levelFor(lifetime)).map((i) => i.id)],
    quests: QUESTS.map(({ done, ...q }) => ({ ...q, done: done(todays) })),
  };
}

/** Days `userId` finished in the top 3, newest first. Only finished days from each player's sign-up day count. */
export async function podiumDays(
  sql: Sql,
  userId: number,
  now: number,
): Promise<{ day: string; place: number }[]> {
  // ponytail: reads every user per call; store a signup day column if the town gets big.
  const signups = await all<{ id: number; created_at: number }>(sql, "SELECT id, created_at FROM users");
  return all(
    sql,
    `SELECT day, place FROM (
       SELECT user_id, day, ROW_NUMBER() OVER (PARTITION BY day ORDER BY SUM(${TOKENS}) DESC, user_id) AS place
       FROM usage_daily JOIN json_each(?) s ON user_id = CAST(s.key AS INTEGER) AND day >= s.value
       WHERE day < ? GROUP BY user_id, day)
     WHERE user_id = ? AND place <= ? ORDER BY day DESC`,
    JSON.stringify(Object.fromEntries(signups.map((u) => [u.id, dayKey(u.created_at)]))),
    dayKey(now),
    userId,
    PODIUM_COINS.length,
  );
}

/**
 * Every user's balance, for the admin page: `wallet`'s sums over everyone at once.
 * ponytail: all of `usage_daily` and `activity_daily` per call, like the leaderboards.
 */
export async function balances(sql: Sql, now: number): Promise<Map<number, number>> {
  const today = dayKey(now);
  const signups = await all<{ id: number; created_at: number }>(sql, "SELECT id, created_at FROM users");
  const firstDay = JSON.stringify(Object.fromEntries(signups.map((u) => [u.id, dayKey(u.created_at)])));
  const out = new Map(signups.map((u) => [u.id, 0]));
  const add = (userId: number, n: number) => {
    const had = out.get(userId);
    if (had !== undefined) out.set(userId, had + n);
  };
  const days = await all<{ userId: number; day: string; tokens: number }>(
    sql,
    `SELECT user_id AS userId, day, SUM(${TOKENS}) AS tokens
     FROM usage_daily JOIN json_each(?) s ON user_id = CAST(s.key AS INTEGER) AND day >= s.value
     GROUP BY user_id, day`,
    firstDay,
  );
  for (const d of days) add(d.userId, coinsForTokens(d.tokens));
  const activity = await all<{ userId: number; day: string } & Omit<DayFacts, "tokens">>(
    sql,
    `SELECT user_id AS userId, day, peak_agents AS peakAgents, active_buckets AS activeBuckets, prs
     FROM activity_daily JOIN json_each(?) s ON user_id = CAST(s.key AS INTEGER) AND day >= s.value`,
    firstDay,
  );
  const facts = new Map<string, DayFacts & { userId: number }>(
    days.map((d) => [`${d.userId} ${d.day}`, { ...EMPTY_DAY, userId: d.userId, tokens: d.tokens }]),
  );
  for (const a of activity) {
    const key = `${a.userId} ${a.day}`;
    facts.set(key, { ...EMPTY_DAY, ...facts.get(key), ...a });
  }
  for (const f of facts.values()) add(f.userId, questCoins(f));
  const places = await all<{ userId: number; place: number }>(
    sql,
    `SELECT user_id AS userId, place FROM (
       SELECT user_id, ROW_NUMBER() OVER (PARTITION BY day ORDER BY SUM(${TOKENS}) DESC, user_id) AS place
       FROM usage_daily JOIN json_each(?) s ON user_id = CAST(s.key AS INTEGER) AND day >= s.value
       WHERE day < ? GROUP BY user_id, day)
     WHERE place <= ?`,
    firstDay,
    today,
    PODIUM_COINS.length,
  );
  for (const p of places) add(p.userId, PODIUM_COINS[p.place - 1]!);
  for (const r of await all<{ userId: number; n: number }>(
    sql,
    "SELECT user_id AS userId, -SUM(price) AS n FROM purchases GROUP BY user_id",
  ))
    add(r.userId, r.n);
  for (const r of await all<{ userId: number; n: number }>(
    sql,
    "SELECT user_id AS userId, SUM(amount) AS n FROM ledger GROUP BY user_id",
  ))
    add(r.userId, r.n);
  return out;
}

/**
 * An admin sets `userId`'s balance: the difference goes in the ledger (kind and ref `admin`),
 * since balances are worked out rather than stored. Run it serialized with every other coin write.
 */
export async function setBalance(
  sql: Sql,
  userId: number,
  balance: number,
  now: number,
): Promise<{ before: number; balance: number }> {
  const before = (await wallet(sql, userId, now)).balance;
  if (balance !== before)
    await sql.execute(
      "INSERT INTO ledger (user_id, amount, kind, ref, at) VALUES (?, ?, 'admin', 'admin', ?)",
      userId,
      balance - before,
      now,
    );
  return { before, balance };
}

/** Pays for `item` from `userId`'s coins. Run it serialized, so two buys can't both spend the same coins. */
export async function buy(sql: Sql, userId: number, item: Item, now: number): Promise<Wallet> {
  const w = await wallet(sql, userId, now);
  if (w.owned.includes(item.id)) throw new UserError("You already have it.", { code: "owned" });
  if (w.balance < item.price) throw new UserError("Not enough coins yet.", { code: "too_poor" });
  await sql.execute(
    "INSERT INTO purchases (user_id, item, price, at) VALUES (?, ?, ?, ?)",
    userId,
    item.id,
    item.price,
    now,
  );
  return wallet(sql, userId, now);
}

// MARK: The ledger: coins moving between players

export type HoldKind = "stake" | "bet";
export type PayKind = "payout" | "refund" | "winnings";
export interface Entry {
  userId: number;
  amount: number;
}

const ledgerSum = async (sql: Sql, userId: number): Promise<number> =>
  (await all<{ n: number | null }>(sql, "SELECT SUM(amount) AS n FROM ledger WHERE user_id = ?", userId))[0]
    ?.n ?? 0;

/** What each player has in `ref` right now: held coins as positive numbers. */
export async function heldIn(sql: Sql, ref: string): Promise<Map<number, number>> {
  const rows = await all<{ userId: number; n: number }>(
    sql,
    "SELECT user_id AS userId, -SUM(amount) AS n FROM ledger WHERE ref = ? GROUP BY user_id",
    ref,
  );
  return new Map(rows.filter((r) => r.n > 0).map((r) => [r.userId, r.n]));
}

/**
 * Takes each entry's coins into `ref`, from everyone or from nobody. A stake may be at
 * most half your balance, so one bad game can't wipe you out; a side bet just has to fit.
 * Run it serialized with every other coin write, or two holds could spend the same coins.
 */
export async function hold(
  sql: Sql,
  ref: string,
  kind: HoldKind,
  entries: Entry[],
  names: Record<number, string>,
  now: number,
): Promise<void> {
  const paying = entries.filter((e) => e.amount > 0);
  for (const e of paying) {
    const { balance } = await wallet(sql, e.userId, now);
    const limit = kind === "stake" ? Math.floor(balance / 2) : balance;
    if (e.amount > limit) {
      const who = names[e.userId] ?? "Someone";
      throw new UserError(
        kind === "stake"
          ? `${who} can stake at most 🪙 ${limit} right now (half their coins).`
          : `${who} only has 🪙 ${balance}.`,
        { code: "too_poor" },
      );
    }
  }
  for (const e of paying)
    await sql.execute(
      "INSERT INTO ledger (user_id, amount, kind, ref, at) VALUES (?, ?, ?, ?, ?)",
      e.userId,
      -e.amount,
      kind,
      ref,
      now,
    );
}

/** Pays coins out of `ref`. Never more than it holds: a pot can't pay out coins nobody put in. */
export async function pay(
  sql: Sql,
  ref: string,
  kind: PayKind,
  entries: Entry[],
  now: number,
): Promise<void> {
  const out = entries.filter((e) => e.amount > 0);
  const [{ held }] = (await all<{ held: number | null }>(
    sql,
    "SELECT -SUM(amount) AS held FROM ledger WHERE ref = ?",
    ref,
  )) as [{ held: number | null }];
  const total = out.reduce((n, e) => n + e.amount, 0);
  if (total > (held ?? 0)) throw new Error(`${ref}: paying ${total} but only ${held ?? 0} held`);
  for (const e of out)
    await sql.execute(
      "INSERT INTO ledger (user_id, amount, kind, ref, at) VALUES (?, ?, ?, ?, ?)",
      e.userId,
      e.amount,
      kind,
      ref,
      now,
    );
}

/** Gives everyone back what they still have in `ref` (or just `userIds`). */
export async function refund(sql: Sql, ref: string, now: number, userIds?: number[]): Promise<void> {
  const held = await heldIn(sql, ref);
  const back = [...held].filter(([id]) => !userIds || userIds.includes(id));
  await pay(
    sql,
    ref,
    "refund",
    back.map(([userId, amount]) => ({ userId, amount })),
    now,
  );
}

// MARK: Trades: coins and items between two players

export interface Trade {
  fromId: number;
  from: string;
  toId: number;
  to: string;
  give: Side;
  want: Side;
  at: number;
}

/** Both ways a trade goes. */
const directions = (t: Trade) => [
  { giverId: t.fromId, giver: t.from, receiverId: t.toId, receiver: t.to, side: t.give },
  { giverId: t.toId, giver: t.to, receiverId: t.fromId, receiver: t.from, side: t.want },
];

/** Open offers matching `where` (on `trades`), newest first, with names. */
export async function tradesWhere(sql: Sql, where: string, ...args: unknown[]): Promise<Trade[]> {
  const rows = await all<Omit<Trade, "give" | "want"> & { give: string; want: string }>(
    sql,
    `SELECT from_id AS fromId, f.name AS "from", to_id AS toId, r.name AS "to", give, want, at
     FROM trades JOIN users f ON f.id = from_id JOIN users r ON r.id = to_id
     WHERE ${where} ORDER BY at DESC`,
    ...args,
  );
  return rows.map((r) => ({ ...r, give: JSON.parse(r.give), want: JSON.parse(r.want) }));
}

/**
 * Throws unless each side owns what it gives (`not_owned`), has none of what it gets (`owned`),
 * and has the coins it gives (`too_poor`).
 */
export async function checkTrade(sql: Sql, t: Trade, now: number): Promise<void> {
  for (const d of directions(t)) {
    const has = await ownedItems(sql, d.giverId);
    const gets = await ownedItems(sql, d.receiverId);
    for (const id of d.side.items) {
      const name = itemById(id)?.name ?? id;
      if (!has.includes(id)) throw new UserError(`${d.giver} doesn't have ${name}.`, { code: "not_owned" });
      if (gets.includes(id)) throw new UserError(`${d.receiver} already has ${name}.`, { code: "owned" });
    }
    if (d.side.coins === 0) continue;
    const { balance } = await wallet(sql, d.giverId, now);
    if (balance < d.side.coins)
      throw new UserError(`${d.giver} only has 🪙 ${balance}.`, { code: "too_poor" });
  }
}

/**
 * Moves `give` from `from` to `to` and `want` the other way, in one ref, all or nothing, and drops
 * the offer. Run it serialized. Throws `too_poor` / `not_owned` / `owned` when something changed
 * since the offer.
 * ponytail: items live in `purchases` and their value follows them through the ledger. If that ever
 * reads wrong, the upgrade is an `items (user_id, item)` table for ownership, `purchases` left as spend.
 */
export async function settleTrade(sql: TxSql, t: Trade, now: number): Promise<void> {
  await sql.transaction(async (tx) => {
    await checkTrade(tx, t, now);
    // The offer goes with it, so it can't be settled twice.
    await tx.execute("DELETE FROM trades WHERE from_id = ? AND at = ?", t.fromId, t.at);
    const ref = `trade:${t.fromId}:${t.at}`;
    const entry = (userId: number, amount: number) =>
      tx.execute(
        "INSERT INTO ledger (user_id, amount, kind, ref, at) VALUES (?, ?, 'trade', ?, ?)",
        userId,
        amount,
        ref,
        now,
      );
    for (const d of directions(t)) {
      if (d.side.coins > 0) {
        await entry(d.giverId, -d.side.coins);
        await entry(d.receiverId, d.side.coins);
      }
      if (d.side.items.length === 0) continue;
      for (const id of d.side.items) {
        const [bought] = await all<{ price: number }>(
          tx,
          "DELETE FROM purchases WHERE user_id = ? AND item = ? RETURNING price",
          d.giverId,
          id,
        );
        // Without its purchase row the item would be refunded; this keeps the giver's balance put.
        if (bought!.price > 0) await entry(d.giverId, -bought!.price);
        await tx.execute(
          "INSERT INTO purchases (user_id, item, price, at) VALUES (?, ?, 0, ?)",
          d.receiverId,
          id,
          now,
        );
      }
      // Nobody wears what they don't own.
      const look = lookOf(await userById(tx, d.giverId));
      for (const i of itemsIn(look)) if (d.side.items.includes(i.id)) look[i.slot] = 0;
      await tx.execute("UPDATE users SET look = ? WHERE id = ?", JSON.stringify(look), d.giverId);
    }
  });
}
