import { beforeEach, describe, expect, test } from "bun:test";
import { itemById } from "@tokenmaxxing/core/shop.ts";
import type { TxSql } from "../src/actors/shared.ts";
import {
  balances,
  buy,
  heldIn,
  hold,
  pay,
  refund,
  setBalance,
  settleTrade,
  type Trade,
  wallet,
} from "../src/town/coins.ts";
import { migrate } from "../src/town/schema.ts";
import { memorySql } from "./memory-sql.ts";

let sql: TxSql;
const NOW = Date.UTC(2026, 8, 29, 12);
const names = { 1: "ada", 2: "bo", 3: "cy" };

/** Gives `userId` a balance: √(tokens ÷ 1M) coins for one old day, plus 25 for finishing it first. */
async function earn(userId: number, day: string, tokens: number) {
  await sql.execute(
    "INSERT INTO usage_daily (user_id, day, model, input, output, cache_creation, cache_read, turns) VALUES (?, ?, 'm', ?, 0, 0, 0, 1)",
    userId,
    day,
    tokens,
  );
}
/** An `activity_daily` row: `agents` at once on `day`, nothing else. */
async function peak(userId: number, day: string, agents: number) {
  await sql.execute(
    "INSERT INTO activity_daily (user_id, day, prompts, prs, agent_buckets, active_buckets, peak_agents) VALUES (?, ?, 0, 0, 0, 0, ?)",
    userId,
    day,
    agents,
  );
}
const balance = async (userId: number) => (await wallet(sql, userId, NOW)).balance;
const sumOf = async (ref: string) =>
  ((await sql.execute("SELECT SUM(amount) AS n FROM ledger WHERE ref = ?", ref)) as [{ n: number }])[0].n;

/** Signs `userId` up on `day` (noon UTC is the same day in Copenhagen). */
async function signUpOn(userId: number, day: string) {
  await sql.execute(
    "INSERT INTO users (id, name, look, created_at) VALUES (?, ?, '{}', ?)",
    userId,
    `u${userId}`,
    Date.parse(`${day}T12:00:00Z`),
  );
}

beforeEach(async () => {
  sql = memorySql().sql;
  await migrate(sql);
  for (const id of [1, 2, 3]) await signUpOn(id, "2025-12-31");
  await earn(1, "2026-01-01", 10_000e6); // √10000 = 100, +25 first place, +5 for 500M = 130
  await earn(2, "2026-01-02", 2_500e6); // 50, +25, +5 = 80
  await earn(3, "2026-01-03", 100e6); // 10, +25 = 35
});

describe("the coin ledger", () => {
  test("a stake is held, then paid out, and the ref sums to 0", async () => {
    expect(await balance(1)).toBe(130);
    await hold(
      sql,
      "table:1",
      "stake",
      [
        { userId: 1, amount: 30 },
        { userId: 2, amount: 30 },
      ],
      names,
      NOW,
    );
    expect(await balance(1)).toBe(100);
    expect(await balance(2)).toBe(50);
    expect(await heldIn(sql, "table:1")).toEqual(
      new Map([
        [1, 30],
        [2, 30],
      ]),
    );
    await pay(sql, "table:1", "payout", [{ userId: 2, amount: 60 }], NOW);
    expect(await balance(1)).toBe(100);
    expect(await balance(2)).toBe(110);
    expect(await sumOf("table:1")).toBe(0);
  });

  test("a stake is at most half your coins, and holds are all or nothing", async () => {
    await expect(
      hold(
        sql,
        "table:2",
        "stake",
        [
          { userId: 1, amount: 20 },
          { userId: 3, amount: 20 }, // cy has 35: at most 17
        ],
        names,
        NOW,
      ),
    ).rejects.toThrow("cy can stake at most 🪙 17");
    expect(await balance(1)).toBe(130); // nothing was taken from ada either
    // A side bet only has to fit the balance.
    await hold(sql, "bets:2", "bet", [{ userId: 3, amount: 35 }], names, NOW);
    expect(await balance(3)).toBe(0);
  });

  test("a pot never pays out more than it holds", async () => {
    await hold(sql, "table:3", "stake", [{ userId: 1, amount: 10 }], names, NOW);
    await expect(pay(sql, "table:3", "payout", [{ userId: 2, amount: 11 }], NOW)).rejects.toThrow(
      "only 10 held",
    );
    await pay(sql, "table:3", "payout", [{ userId: 2, amount: 10 }], NOW);
    await expect(pay(sql, "table:3", "payout", [{ userId: 2, amount: 1 }], NOW)).rejects.toThrow();
  });

  test("a refund gives back exactly what each still has in", async () => {
    await hold(
      sql,
      "table:4",
      "stake",
      [
        { userId: 1, amount: 40 },
        { userId: 2, amount: 20 },
      ],
      names,
      NOW,
    );
    await refund(sql, "table:4", NOW, [2]);
    expect(await balance(2)).toBe(80);
    expect(await heldIn(sql, "table:4")).toEqual(new Map([[1, 40]]));
    await refund(sql, "table:4", NOW);
    expect(await balance(1)).toBe(130);
    expect(await sumOf("table:4")).toBe(0);
  });
});

describe("the wallet", () => {
  test("the top 3 of a finished day get a bonus", async () => {
    for (const id of [4, 5, 6, 7]) await signUpOn(id, "2026-03-03");
    await Promise.all([4e9, 3e9, 2e9, 1e9].map((tokens, i) => earn(4 + i, "2026-03-03", tokens)));
    const wins = await Promise.all([4, 5, 6, 7].map((id) => wallet(sql, id, NOW)));
    // Each also burned 500M: +5.
    expect(wins.map((w) => w.balance)).toEqual([63 + 25 + 5, 54 + 15 + 5, 44 + 10 + 5, 31 + 5]);
    // Only the last 30 days are listed, but old wins still count in the balance.
    expect(wins[0]!.wins).toEqual([]);
  });

  test("days before signing up pay nothing and win nothing", async () => {
    await signUpOn(4, "2026-03-03");
    await earn(4, "2026-03-02", 10_000e6); // would be 100 + 25 for 1st
    await earn(4, "2026-03-03", 100e6); // √100 = 10, and 1st: 25
    expect(await balance(4)).toBe(10 + 25);
    // Nor do they push anyone else off a podium: signed up the day after that day.
    await signUpOn(5, "2026-03-04");
    await earn(5, "2026-03-03", 1e12);
    expect(await balance(4)).toBe(10 + 25);
  });
});

describe("daily quests", () => {
  test("pay from the day you signed up, not before", async () => {
    await peak(1, "2026-01-01", 5); // Run 5 agents at once
    expect(await balance(1)).toBe(130 + 5);
    await signUpOn(4, "2026-03-03");
    await peak(4, "2026-03-02", 5);
    expect(await balance(4)).toBe(0);
  });

  test("today's are done once the day's rollups pass", async () => {
    await signUpOn(4, "2026-09-29");
    expect((await wallet(sql, 4, NOW)).quests.map((q) => q.done)).toEqual([false, false, false, false]);
    await earn(4, "2026-09-29", 500e6);
    const w = await wallet(sql, 4, NOW);
    expect(w.quests.filter((q) => q.done).map((q) => q.id)).toEqual(["tokens"]);
    expect(w.balance).toBe(22 + 5); // √500, and no podium for a day that isn't over
  });
});

describe("the admin page's balances", () => {
  test("add up to what each wallet says", async () => {
    for (const id of [4, 5]) await signUpOn(id, "2026-03-03");
    await Promise.all([4e9, 3e9].map((tokens, i) => earn(4 + i, "2026-03-03", tokens)));
    await earn(4, "2026-03-02", 1e12); // before signing up: pays nothing
    await peak(4, "2026-03-03", 5);
    await peak(5, "2026-03-02", 5); // before signing up
    await peak(1, "2026-02-01", 5); // a day with no tokens
    await sql.execute("INSERT INTO purchases VALUES (5, 'hat.1', 20, 0)");
    await hold(sql, "table:1", "stake", [{ userId: 1, amount: 40 }], names, NOW);
    const all = await balances(sql, NOW);
    for (const id of [1, 2, 3, 4, 5]) expect(all.get(id)).toBe(await balance(id));
  });

  test("an admin sets a balance through the ledger", async () => {
    expect(await setBalance(sql, 1, 500, NOW)).toEqual({ before: 130, balance: 500 });
    expect(await balance(1)).toBe(500);
    await setBalance(sql, 1, 3, NOW);
    expect(await balance(1)).toBe(3);
    expect((await balances(sql, NOW)).get(1)).toBe(3);
  });
});

describe("trades", () => {
  const specs = itemById("glasses.1")!; // Nerd specs, 60
  /** ada (130, level 10 with the top hat) offers bo (80), unless told otherwise. */
  const trade = (t: Partial<Trade>): Trade => ({
    fromId: 1,
    from: "ada",
    toId: 2,
    to: "bo",
    give: { coins: 0, items: [] },
    want: { coins: 0, items: [] },
    at: NOW,
    ...t,
  });

  test("coins both ways net the difference, and the ref sums to 0", async () => {
    await settleTrade(sql, trade({ give: { coins: 50, items: [] }, want: { coins: 20, items: [] } }), NOW);
    expect(await balance(1)).toBe(130 - 30);
    expect(await balance(2)).toBe(80 + 30);
    expect(await sumOf(`trade:1:${NOW}`)).toBe(0);
  });

  test("an item moves; the giver's balance stays put, and they can buy it back", async () => {
    await buy(sql, 1, specs, NOW);
    expect(await balance(1)).toBe(70);
    await settleTrade(sql, trade({ give: { coins: 0, items: [specs.id] } }), NOW);
    expect(await balance(1)).toBe(70);
    expect(await balance(2)).toBe(80);
    expect((await wallet(sql, 1, NOW)).owned).toEqual(["hat.4"]);
    expect((await wallet(sql, 2, NOW)).owned).toEqual([specs.id]);
    expect(await sumOf(`trade:1:${NOW}`)).toBe(-specs.price);
    // bo got it at price 0: passing it on to cy takes nothing back, so no ledger row.
    await settleTrade(
      sql,
      trade({ fromId: 2, from: "bo", toId: 3, to: "cy", give: { coins: 0, items: [specs.id] }, at: NOW + 1 }),
      NOW,
    );
    expect(await sumOf(`trade:2:${NOW + 1}`)).toBeNull();
    expect([await balance(2), await balance(3)]).toEqual([80, 35]);
    await buy(sql, 1, specs, NOW);
    expect(await balance(1)).toBe(10);
  });

  test("the giver's coins dropped since the offer: too_poor, and nothing moves", async () => {
    const offer = trade({ give: { coins: 100, items: [] } });
    await buy(sql, 1, specs, NOW); // 130 → 70
    await expect(settleTrade(sql, offer, NOW)).rejects.toMatchObject({ code: "too_poor" });
    expect([await balance(1), await balance(2)]).toEqual([70, 80]);
  });

  test("the receiver bought it meanwhile: owned", async () => {
    await buy(sql, 1, specs, NOW);
    const offer = trade({ give: { coins: 0, items: [specs.id] } });
    await buy(sql, 2, specs, NOW);
    await expect(settleTrade(sql, offer, NOW)).rejects.toMatchObject({ code: "owned" });
    expect((await wallet(sql, 1, NOW)).owned).toEqual([specs.id, "hat.4"]);
  });
});
