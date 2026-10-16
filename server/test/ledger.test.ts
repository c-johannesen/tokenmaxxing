import { beforeEach, describe, expect, test } from "bun:test";
import { STARTER_OFFICE } from "@tokenmaxxing/core/office.ts";
import { itemById } from "@tokenmaxxing/core/shop.ts";
import type { TxSql } from "../src/actors/shared.ts";
import {
  bag,
  balances,
  buy,
  furnish,
  giveBack,
  grantRewards,
  heldIn,
  hold,
  pay,
  pickUp,
  refund,
  setBalance,
  settleTrade,
  type Trade,
  takeOut,
  unclaimed,
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
  await earn(1, "2026-01-01", 10_000e6); // √10000 = 100, +25 first place = 125
  await earn(2, "2026-01-02", 2_500e6); // 50, +25 = 75
  await earn(3, "2026-01-03", 100e6); // 10, +25 = 35
});

describe("the coin ledger", () => {
  test("a stake is held, then paid out, and the ref sums to 0", async () => {
    expect(await balance(1)).toBe(125);
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
    expect(await balance(1)).toBe(95);
    expect(await balance(2)).toBe(45);
    expect(await heldIn(sql, "table:1")).toEqual(
      new Map([
        [1, 30],
        [2, 30],
      ]),
    );
    await pay(sql, "table:1", "payout", [{ userId: 2, amount: 60 }], NOW);
    expect(await balance(1)).toBe(95);
    expect(await balance(2)).toBe(105);
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
    expect(await balance(1)).toBe(125); // nothing was taken from ada either
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
    expect(await balance(2)).toBe(75);
    expect(await heldIn(sql, "table:4")).toEqual(new Map([[1, 40]]));
    await refund(sql, "table:4", NOW);
    expect(await balance(1)).toBe(125);
    expect(await sumOf("table:4")).toBe(0);
  });
});

describe("the bag", () => {
  const sofa = itemById("furn.s")!;
  const placedSofa = { ch: "s", x: 1, y: 1 };

  test("buying twice is two rows and one spend", async () => {
    await buy(sql, 1, itemById("glasses.1")!, NOW);
    await buy(sql, 1, itemById("glasses.1")!, NOW);
    expect(await bag(sql, 1)).toEqual([{ item: "glasses.1", count: 2, placed: 0 }]);
    expect(await sql.execute("SELECT item, price FROM purchases WHERE user_id = 1")).toEqual([
      { item: "glasses.1", price: 120 },
    ]);
    expect(await balance(1)).toBe(5);
    await expect(buy(sql, 1, sofa, NOW)).rejects.toMatchObject({ code: "too_poor" });
  });

  test("level rewards and the office's desk and chair come once", async () => {
    await grantRewards(sql, 1, 10, NOW);
    await grantRewards(sql, 1, 10, NOW);
    expect(await bag(sql, 1)).toEqual([
      { item: "furn.d", count: 1, placed: 1 },
      { item: "furn.c", count: 1, placed: 1 },
      { item: "hat.4", count: 1, placed: 0 },
    ]);
    await grantRewards(sql, 2, 9, NOW);
    expect(await bag(sql, 2)).toEqual([]);
  });

  test("furnishing places pieces from the bag, free, and no more than it holds", async () => {
    await buy(sql, 1, sofa, NOW);
    await furnish(sql, 1, [...STARTER_OFFICE, placedSofa], NOW); // a new office: its desk and chair come too
    expect(await balance(1)).toBe(25);
    expect(await bag(sql, 1)).toEqual([
      { item: "furn.s", count: 1, placed: 1 },
      { item: "furn.d", count: 1, placed: 1 },
      { item: "furn.c", count: 1, placed: 1 },
    ]);
    await expect(furnish(sql, 1, [placedSofa, { ...placedSofa, y: 2 }], NOW)).rejects.toThrow("None left");
    // Throwing everything out puts it back in the bag.
    await furnish(sql, 1, [], NOW);
    expect((await bag(sql, 1)).map((b) => b.placed)).toEqual([0, 0, 0]);
    expect(await balance(1)).toBe(25);
  });

  test("the backfill turns purchases and office pieces into rows, once", async () => {
    // A database from before `items`.
    await sql.execute("DROP TABLE items");
    await sql.execute("INSERT INTO purchases VALUES (2, 'hat.1', 100, 5), (3, 'glasses.1', 0, 6)");
    await sql.execute(
      "INSERT INTO offices (user_id, furniture, updated_at) VALUES (2, ?, 7)",
      JSON.stringify([...STARTER_OFFICE, placedSofa]),
    );
    await migrate(sql);
    await migrate(sql);
    expect(await bag(sql, 2)).toEqual([
      { item: "hat.1", count: 1, placed: 0 },
      { item: "furn.d", count: 1, placed: 1 },
      { item: "furn.c", count: 1, placed: 1 },
      { item: "furn.s", count: 1, placed: 1 },
    ]);
    expect(await bag(sql, 3)).toEqual([{ item: "glasses.1", count: 1, placed: 0 }]);
    expect(await balance(2)).toBe(75 - 100);
    // Every item gone (traded to someone deleted, say): the next start doesn't hand them out again.
    await sql.execute("DELETE FROM items");
    await migrate(sql);
    expect(await bag(sql, 2)).toEqual([]);
    expect(await bag(sql, 3)).toEqual([]);
  });
});

describe("drops", () => {
  const HOUR = 3_600_000;

  test("the sweeper sends an hour-old drop home; taking it after gets nothing", async () => {
    await buy(sql, 1, itemById("glasses.1")!, NOW);
    await buy(sql, 1, itemById("glasses.1")!, NOW);
    const old = await takeOut(sql, 1, "glasses.1", NOW - 2 * HOUR);
    const fresh = await takeOut(sql, 1, "glasses.1", NOW - HOUR / 6);
    expect(await bag(sql, 1)).toEqual([]);
    expect(await unclaimed(sql, NOW - HOUR)).toEqual([old]);
    await giveBack(sql, [old]);
    expect(await pickUp(sql, old, 2)).toBe(false);
    expect(await bag(sql, 1)).toEqual([{ item: "glasses.1", count: 1, placed: 0 }]);
    expect(await pickUp(sql, fresh, 2)).toBe(true);
    expect(await bag(sql, 2)).toEqual([{ item: "glasses.1", count: 1, placed: 0 }]);
    expect(await unclaimed(sql, NOW)).toEqual([]);
  });

  test("a deleted dropper's drop is gone, not given back", async () => {
    await buy(sql, 2, itemById("glasses.1")!, NOW);
    const id = await takeOut(sql, 2, "glasses.1", NOW);
    await sql.execute("DELETE FROM users WHERE id = 2");
    await giveBack(sql, [id]);
    expect(await sql.execute("SELECT id FROM items")).toEqual([]);
  });
});

describe("the wallet", () => {
  test("the top 3 of a finished day get a bonus", async () => {
    for (const id of [4, 5, 6, 7]) await signUpOn(id, "2026-03-03");
    await Promise.all([4e9, 3e9, 2e9, 1e9].map((tokens, i) => earn(4 + i, "2026-03-03", tokens)));
    const wins = await Promise.all([4, 5, 6, 7].map((id) => wallet(sql, id, NOW)));
    expect(wins.map((w) => w.balance)).toEqual([63 + 25, 54 + 15, 44 + 10, 31]);
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
    expect(await balance(1)).toBe(125 + 5);
    await signUpOn(4, "2026-03-03");
    await peak(4, "2026-03-02", 5);
    expect(await balance(4)).toBe(0);
  });

  test("today's are done once the day's rollups pass", async () => {
    await signUpOn(4, "2026-09-29");
    expect((await wallet(sql, 4, NOW)).quests.map((q) => q.done)).toEqual([false, false]);
    await earn(4, "2026-09-29", 500e6);
    await peak(4, "2026-09-29", 5);
    const w = await wallet(sql, 4, NOW);
    expect(w.quests.filter((q) => q.done).map((q) => q.id)).toEqual(["parallel"]);
    expect(w.balance).toBe(22 + 5); // √500, and no podium for a day that isn't over
    expect(w.today).toBe(22 + 5);
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
    expect(await setBalance(sql, 1, 500, NOW)).toEqual({ before: 125, balance: 500 });
    expect(await balance(1)).toBe(500);
    await setBalance(sql, 1, 3, NOW);
    expect(await balance(1)).toBe(3);
    expect((await balances(sql, NOW)).get(1)).toBe(3);
  });
});

describe("trades", () => {
  const specs = itemById("glasses.1")!; // Nerd specs, 60
  /** ada (125) offers bo (75), unless told otherwise. */
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
    expect(await balance(1)).toBe(125 - 30);
    expect(await balance(2)).toBe(75 + 30);
    expect(await sumOf(`trade:1:${NOW}`)).toBe(0);
  });

  test("an item moves one row and no coins; the receiver may hold one already", async () => {
    await buy(sql, 1, specs, NOW);
    await buy(sql, 1, specs, NOW);
    await buy(sql, 2, specs, NOW);
    await settleTrade(sql, trade({ give: { coins: 0, items: [specs.id] } }), NOW);
    expect([await balance(1), await balance(2)]).toEqual([5, 15]);
    expect((await bag(sql, 1))[0]!.count).toBe(1);
    expect((await bag(sql, 2))[0]!.count).toBe(2);
    expect(await sumOf(`trade:1:${NOW}`)).toBeNull();
  });

  test("a placed piece can't be traded until it's back in the bag", async () => {
    await buy(sql, 1, itemById("furn.s")!, NOW);
    await furnish(sql, 1, [{ ch: "s", x: 1, y: 1 }], NOW);
    const offer = trade({ give: { coins: 0, items: ["furn.s"] } });
    await expect(settleTrade(sql, offer, NOW)).rejects.toMatchObject({ code: "not_owned" });
    await furnish(sql, 1, [], NOW);
    await settleTrade(sql, offer, NOW);
    expect((await wallet(sql, 2, NOW)).owned).toEqual(["furn.s"]);
  });

  test("the giver's coins dropped since the offer: too_poor, and nothing moves", async () => {
    const offer = trade({ give: { coins: 100, items: [] } });
    await buy(sql, 1, specs, NOW); // 125 → 65
    await expect(settleTrade(sql, offer, NOW)).rejects.toMatchObject({ code: "too_poor" });
    expect([await balance(1), await balance(2)]).toEqual([65, 75]);
  });
});
