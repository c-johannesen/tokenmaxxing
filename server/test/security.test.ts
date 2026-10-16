import { describe, expect, test } from "bun:test";
import { sha256 } from "../src/crypto.ts";
import { admin, as, client, event, from, origin, signUp } from "./rivet.ts";

describe("nobody outside makes actors", () => {
  test("a stranger can't claim the next account by making its player first", async () => {
    const me = await signUp("claim");
    const next = me.userId + 1;
    const secret = "attackerattackerattacker";
    await expect(
      client.player
        .getOrCreate([String(next)], { createWithInput: { userId: next, tokenHash: sha256(secret) } })
        .mintLoginCode(),
    ).rejects.toThrow();
    const victim = await signUp("claimed");
    expect((await victim.town.me()).name).toBe(victim.name);
    await expect(
      client.town.getOrCreate(["main"], { params: { token: `${victim.userId}.${secret}` } }).me(),
    ).rejects.toThrow();
  });

  test("a token for a player that doesn't exist is unauthorized", async () => {
    await expect(
      client.town.getOrCreate(["main"], { params: { token: "999999.nosuchplayernosuchplayer" } }).me(),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  test("only the singletons, only as main", async () => {
    await expect(client.town.getOrCreate(["evil"]).signUp("evilname")).rejects.toThrow();
    await expect(client.world.getOrCreate(["other"]).join()).rejects.toThrow();
    await expect(client.match.getOrCreate(["999999"]).info()).rejects.toThrow();
  });
});

describe("sign-ups", () => {
  test("are limited per IP, not for everyone", async () => {
    const office = from("10.200.0.1");
    const stamp = Date.now().toString(36);
    for (let i = 0; i < 20; i++) await office.town.getOrCreate(["main"]).signUp(`ip${stamp}${i}`);
    await expect(office.town.getOrCreate(["main"]).signUp(`ip${stamp}x`)).rejects.toThrow("Too many");
    // Someone else, elsewhere, still gets in.
    expect((await signUp("elsewhere")).userId).toBeGreaterThan(0);
  });
});

describe("the import", () => {
  test("absurd numbers are dropped, and odd model names don't show", async () => {
    const u = await signUp("absurd");
    const player = as(u.token).player(u.userId);
    const r = await player.ingest([
      event({ inputTokens: 9_007_199_254_740_991, timestamp: Date.now() }),
      event({ inputTokens: 1_000, timestamp: Date.now(), model: "buy my stuff at scam.example" }),
      event({ inputTokens: 1_000, timestamp: Date.now() + 2 * 3_600_000 }),
    ]);
    expect(r).toMatchObject({ inserted: 1, skipped: 2 });
    const profile = await u.town.profile(u.userId, "today");
    expect(profile.models.map((m) => m.model)).toEqual(["unknown"]);
  });

  test("a minute counts for at most 200M, and the rest is flagged for the admin", async () => {
    const u = await signUp("capped");
    const now = Date.now();
    await as(u.token)
      .player(u.userId)
      .ingest([900e6, 900e6, 900e6].map((n, i) => event({ inputTokens: n, timestamp: now + i })));
    const me = (await admin().adminUsers()).find((x) => x.id === u.userId)!;
    expect(me.tokensToday).toBeLessThanOrEqual(200e6 + 1);
    expect(me.capped30d).toBeGreaterThan(2e9);
    expect((await admin().adminOverview()).flagged).toBeGreaterThanOrEqual(1);
  });

  test("syncing is limited per minute", async () => {
    const u = await signUp("spam");
    const player = as(u.token).player(u.userId);
    for (let i = 0; i < 60; i++) await player.ingest([]);
    await expect(player.ingest([])).rejects.toThrow("too often");
  });

  test("the admin can wipe made-up usage, and it's in the log", async () => {
    const u = await signUp("wiped");
    await as(u.token)
      .player(u.userId)
      .ingest([event({ inputTokens: 100e6, timestamp: Date.now() })]);
    await admin().adminWipeUsage(u.userId);
    const me = (await admin().adminUsers()).find((x) => x.id === u.userId)!;
    expect(me).toMatchObject({ tokensTotal: 0, balance: 0 });
    const [last] = await admin().adminLog();
    expect(last).toMatchObject({ action: "wipe usage", target: `${u.name} (#${u.userId})` });
    // The same events can be synced again: they were forgotten, not kept as duplicates.
    const again = await as(u.token)
      .player(u.userId)
      .ingest([event({ inputTokens: 1_000, timestamp: Date.now() })]);
    expect(again.inserted).toBe(1);
  });
});

describe("pages", () => {
  test("the game and the admin page only load our own scripts, and can't be framed", async () => {
    for (const path of ["/play", "/admin"]) {
      const res = await fetch(`${origin}${path}`);
      const csp = res.headers.get("content-security-policy")!;
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect((await fetch(`${origin}/admin`)).headers.get("content-security-policy")).not.toContain("ipc:");
  });

  test("the page files aren't served without those headers", async () => {
    expect((await fetch(`${origin}/admin.html`)).status).not.toBe(200);
    // With `site/dist` built, `/index.html` is the marketing site's; it mustn't be the game's.
    const game = await (await fetch(`${origin}/play`)).text();
    const index = await fetch(`${origin}/index.html`);
    if (index.status === 200) expect(await index.text()).not.toBe(game);
  });
});
