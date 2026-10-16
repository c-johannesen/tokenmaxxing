import { describe, expect, test } from "bun:test";
import { frontier, plotId } from "@tokenmaxxing/core/maps.ts";
import { admin, admit, as, client, event, MIN, signUp } from "./rivet.ts";

describe("accounts", () => {
  test("names are unique and validated", async () => {
    const a = await signUp("name");
    await expect(client.town.getOrCreate(["main"]).signUp(a.name)).rejects.toThrow("taken");
    await expect(client.town.getOrCreate(["main"]).signUp("No Spaces!")).rejects.toThrow();
  });

  test("rename and look", async () => {
    const a = await signUp("rn");
    await a.town.rename(`${a.name}x`);
    await a.town.setLook({ style: 1, skin: 2, hair: 3, outfit: 4 });
    const me = await a.town.me();
    expect(me.name).toBe(`${a.name}x`);
    expect(me.look).toEqual({ style: 1, skin: 2, hair: 3, outfit: 4, glasses: 0, hat: 0, pet: 0 });
    await expect(a.town.setLook({ style: 99, skin: 0, hair: 0, outfit: 0 })).rejects.toThrow();
  });

  test("name search for @mentions: by prefix, at most 8", async () => {
    const a = await signUp("zsearch");
    await signUp("zsearch");
    const names = await a.town.searchNames("zsearch");
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names.every((n) => n.startsWith("zsearch"))).toBe(true);
    expect(await a.town.searchNames("no spaces")).toEqual([]);
  });

  test("everything but sign-up needs a token", async () => {
    await expect(client.town.getOrCreate(["main"]).me()).rejects.toThrow();
    await expect(client.town.getOrCreate(["main"]).report(1, [], [], [])).rejects.toThrow();
  });
});

describe("companies", () => {
  test("a new company builds where its owner picks, next to the town", async () => {
    const owner = await signUp("builder");
    const town = await as(owner.token).world.join();
    const pick = frontier(town.companies.flatMap((co) => co.plot)).at(-1)!;
    const co = await owner.town.createCompany("Builders", pick);
    expect(co.plot).toBe(pick);
    await expect((await signUp("late")).town.createCompany("Late", pick)).rejects.toThrow(
      "Pick another spot",
    );
    await expect((await signUp("far")).town.createCompany("Far", plotId(40, 40))).rejects.toThrow();
  });

  test("create, apply, the owner accepts; one company per person", async () => {
    const owner = await signUp("own");
    const mate = await signUp("mate");
    const co = await owner.town.createCompany("Arox");
    expect(co.isOwner).toBe(true);
    expect((await mate.town.listings()).map((l) => l.name)).toContain("Arox");

    await mate.town.apply(co.id);
    expect((await mate.town.me()).application).toEqual({ companyId: co.id, name: "Arox" });
    const mine = (await owner.town.me()).company!;
    expect(mine.applicants.map((a) => a.name)).toEqual([mate.name]);
    // Only the owner sees who's asking, and only the owner can answer.
    await expect(mate.town.approve(mate.userId)).rejects.toThrow("owner");

    const after = await owner.town.approve(mate.userId);
    expect(after.members.map((m) => m.name)).toEqual([owner.name, mate.name]);
    expect(after.applicants).toEqual([]);
    const joined = await mate.town.me();
    expect(joined.company!.isOwner).toBe(false);
    expect(joined.company!.applicants).toEqual([]);
    expect(joined.application).toBeNull();

    const other = await mate.town.createCompany("Solo");
    expect((await owner.town.me()).company!.members).toHaveLength(1);
    expect(other.members.map((m) => m.name)).toEqual([mate.name]);
  });

  test("declining, withdrawing, and one application at a time", async () => {
    const a = await signUp("dec");
    const b = await signUp("dec");
    const c = await signUp("dec");
    const first = await a.town.createCompany("First Co");
    const second = await b.town.createCompany("Second Co");
    await c.town.apply(first.id);
    await c.town.apply(second.id); // replaces the first
    expect((await a.town.me()).company!.applicants).toEqual([]);
    expect((await c.town.me()).application!.companyId).toBe(second.id);

    const declined = await b.town.decline(c.userId);
    expect(declined.applicants).toEqual([]);
    expect((await c.town.me()).application).toBeNull();
    await expect(b.town.approve(c.userId)).rejects.toThrow("asking");

    await c.town.apply(first.id);
    await c.town.withdraw();
    await expect(a.town.approve(c.userId)).rejects.toThrow("asking");
    await expect(a.town.apply(first.id)).rejects.toThrow("already");
  });

  test("owner hand-off, kick, and the last one out closes it", async () => {
    const a = await signUp("ho");
    const b = await signUp("ho");
    const c = await signUp("ho");
    const co = await a.town.createCompany("Handoff");
    await admit(a, b, co.id);
    await admit(a, c, co.id);
    await expect(b.town.kick(c.userId)).rejects.toThrow("owner");
    await a.town.kick(c.userId);
    expect((await c.town.me()).company).toBeNull();

    await a.town.leaveCompany();
    const mine = (await b.town.me()).company!;
    expect(mine.isOwner).toBe(true);
    await b.town.leaveCompany();
    await expect(c.town.apply(co.id)).rejects.toThrow("gone");
  });

  test("a closed company's id is never reused", async () => {
    const a = await signUp("reuse");
    const first = await a.town.createCompany("First");
    await a.town.leaveCompany(); // the last one out closes it
    const second = await a.town.createCompany("Second");
    expect(second.id).toBeGreaterThan(first.id);
  });

  test("only the owner sets the website; it's stored as a bare host", async () => {
    const a = await signUp("web");
    const b = await signUp("web");
    const co = await a.town.createCompany("Web Co");
    await admit(a, b, co.id);
    await expect(b.town.setWebsite("acme.com")).rejects.toThrow("owner");
    await expect(a.town.setWebsite("not a website")).rejects.toThrow("website");
    const set = await a.town.setWebsite("https://www.Acme.com/about");
    expect(set.website).toBe("acme.com");
    // No Firecrawl key in tests: the website goes on the sign, no branding starts.
    expect(set.branding).toBeNull();
    expect((await b.town.me()).company!.website).toBe("acme.com");
    expect((await a.town.setWebsite("")).website).toBeNull();
  });
});

describe("leaderboard", () => {
  test("players and companies, ranked and priced", async () => {
    const a = await signUp("lb");
    const b = await signUp("lb");
    const co = await a.town.createCompany("Board Co");
    await admit(a, b, co.id);
    await as(a.token)
      .player(a.userId)
      .ingest([event({ inputTokens: 5_000_000 })]);
    await as(b.token)
      .player(b.userId)
      .ingest([event({ inputTokens: 1_000_000 })]);

    const board = await a.town.leaderboard("today", "tokens");
    const ia = board.players.findIndex((p) => p.userId === a.userId);
    const ib = board.players.findIndex((p) => p.userId === b.userId);
    expect(ia).toBeLessThan(ib);
    expect(board.players[ia]!.costUsd).toBeGreaterThan(0);
    expect(board.players[ia]!.company).toBe("Board Co");
    const company = board.companies.find((c) => c.companyId === co.id)!;
    expect(company.tokens).toBe(board.players[ia]!.tokens + board.players[ib]!.tokens);
    expect(company.members).toBe(2);
  });

  test("a company's card: its numbers, its people busiest first, and its last 30 days", async () => {
    const a = await signUp("card");
    const b = await signUp("card");
    const co = await a.town.createCompany("Card Co");
    await admit(a, b, co.id);
    await as(a.token)
      .player(a.userId)
      .ingest([event({ inputTokens: 1_000_000 })]);
    await as(b.token)
      .player(b.userId)
      .ingest([event({ inputTokens: 3_000_000 })]);
    const card = await b.town.company(co.id, "today");
    expect(card).toMatchObject({ id: co.id, name: "Card Co", website: null, logo: null });
    expect(card.members.map((m) => [m.name, m.isOwner])).toEqual([
      [b.name, false],
      [a.name, true],
    ]);
    expect(card.totals.tokens).toBe(card.members[0]!.tokens + card.members[1]!.tokens);
    expect(card.rank).toBeGreaterThan(0);
    expect(card.daily).toHaveLength(30);
    expect(card.daily.at(-1)!.tokens).toBe(card.totals.tokens);
    await expect(b.town.company(999_999, "today")).rejects.toThrow("gone");
  });

  test("today's corner has the top 5 and me, even at zero", async () => {
    const quiet = await signUp("quiet");
    const today = await quiet.town.today();
    expect(today.me.rank).toBeNull();
    expect(today.top.at(-1)).toMatchObject({ isMe: true, name: quiet.name });
    expect(today.top.length).toBeLessThanOrEqual(6);
  });

  test("profiles have 30 days, models and a level", async () => {
    const a = await signUp("prof");
    await as(a.token)
      .player(a.userId)
      .ingest([event({ cacheReadTokens: 20_000_000 })]);
    const p = await a.town.profile(a.userId, "30d");
    expect(p.daily).toHaveLength(30);
    expect(p.daily.at(-1)!.tokens).toBeGreaterThan(0);
    expect(p.models[0]!.model).toBe("claude-haiku-4-5-20251001");
    expect(p.level).toBeGreaterThan(0);
  });
});

describe("coins and the shop", () => {
  test("usage earns coins, square-rooted per day", async () => {
    const a = await signUp("coin");
    // 100M today: √100 = 10. 400M more the same day makes it √500 = 22, not 30. (A minute counts
    // for at most 200M, so the 400M comes over the next two.)
    const now = Date.now();
    await as(a.token)
      .player(a.userId)
      .ingest([event({ inputTokens: 100e6, timestamp: now })]);
    expect((await a.town.wallet()).balance).toBe(10);
    await as(a.token)
      .player(a.userId)
      .ingest([
        event({ inputTokens: 200e6, timestamp: now + 60_000 }),
        event({ inputTokens: 200e6, timestamp: now + 120_000 }),
      ]);
    expect((await a.town.wallet()).balance).toBe(22);
    // Logs from before signing up (a first sync's backfill) pay nothing.
    await as(a.token)
      .player(a.userId)
      .ingest([event({ inputTokens: 150e6, timestamp: Date.UTC(2023, 5, 14, 12) })]);
    expect((await a.town.wallet()).balance).toBe(22);
  });

  test("buy, then wear; not before, not twice, not when short", async () => {
    const a = await signUp("shop");
    await expect(a.town.buy("glasses.1")).rejects.toThrow("coins");
    await expect(a.town.setLook({ ...(await a.town.me()).look, glasses: 1 })).rejects.toThrow("shop");
    await admin().adminSetCoins(a.userId, 100);
    const before = await a.town.wallet();
    const after = await a.town.buy("glasses.1");
    expect(after.balance).toBe(before.balance - 60);
    expect(after.owned).toEqual(["glasses.1"]);
    await expect(a.town.buy("glasses.1")).rejects.toThrow("already");
    await expect(a.town.buy("nope")).rejects.toThrow();
    await a.town.setLook({ ...(await a.town.me()).look, glasses: 1 });
    expect((await a.town.me()).look.glasses).toBe(1);
  });

  test("level items: worn from level 10, never sold", async () => {
    const a = await signUp("top");
    // 10B lifetime: 50 minutes at the 200M a minute that counts.
    const start = Date.now() - 2 * 60 * MIN;
    await as(a.token)
      .player(a.userId)
      .ingest(
        Array.from({ length: 50 }, (_, i) =>
          event({ inputTokens: 200e6, outputTokens: 0, timestamp: start + i * MIN }),
        ),
      );
    expect((await a.town.profile(a.userId, "all")).level).toBe(10);
    expect((await a.town.wallet()).owned).toContain("hat.4");
    await a.town.setLook({ ...(await a.town.me()).look, hat: 4 });
    expect((await a.town.me()).look.hat).toBe(4);
    await expect(a.town.buy("hat.4")).rejects.toMatchObject({ code: "not_for_sale" });

    const b = await signUp("top");
    await expect(b.town.setLook({ ...(await b.town.me()).look, hat: 4 })).rejects.toMatchObject({
      code: "not_owned",
    });
  });
});
