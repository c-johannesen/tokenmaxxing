import { describe, expect, spyOn, test } from "bun:test";
import type { Snapshot } from "@tokenmaxxing/core/world.ts";
import { arcade } from "../src/actors/arcade.ts";
import { serial } from "../src/actors/shared.ts";
import { as, eventually, rich } from "./rivet.ts";

type Rich = Awaited<ReturnType<typeof rich>>;
const balance = async (u: Rich) => (await u.town.wallet()).balance;
const pick = (u: Rich, id: number, p: string) => u.match(id).move({ pick: p });

/** Both pick, then wait out the 2-second reveal. */
async function round(a: Rich, b: Rich, id: number, pa: string, pb: string) {
  await pick(a, id, pa);
  await pick(b, id, pb);
  await Bun.sleep(2_100);
}

async function townGames(u: Rich) {
  const conn = as(u.token).world.connect();
  const snap: Snapshot = await conn.join();
  await conn.dispose();
  return snap.games;
}

describe("the arcade", () => {
  test("invite → accept → play → the winner takes the pot; players gather in town and go back", async () => {
    const ada = await rich("ada");
    const bo = await rich("bo");
    const [a0, b0] = [await balance(ada), await balance(bo)];
    const lobby = await ada.arcade.open("spr", { stake: 40, open: false, invite: [bo.userId] });
    const tableId = lobby.me.table!;
    expect(await balance(ada)).toBe(a0 - 40);
    const invited = await bo.arcade.lobby();
    expect(invited.tables.map((t) => t.id)).toContain(tableId);
    expect(invited.tables.find((t) => t.id === tableId)!.invited[0]!.userId).toBe(bo.userId);

    await bo.arcade.answer(tableId, true); // the table is full: the match starts
    const started = await ada.arcade.lobby();
    expect(started.me.match).toBe(tableId);
    expect(started.tables.some((t) => t.id === tableId)).toBe(false);
    // Both gathered at a table in town, as `playing`.
    const games = await townGames(ada);
    const g = games.find((x) => x.id === tableId)!;
    expect(g.players.sort()).toEqual([ada.userId, bo.userId].sort());
    await expect(as(ada.token).world.step("up")).resolves.toMatchObject({ state: "playing" });

    await round(ada, bo, tableId, "ship", "raise");
    await round(ada, bo, tableId, "raise", "pivot");
    await pick(ada, tableId, "pivot");
    await pick(bo, tableId, "ship");
    await eventually(async () => {
      expect(await balance(ada)).toBe(a0 + 40);
      expect(await balance(bo)).toBe(b0 - 40);
      expect((await townGames(ada)).some((x) => x.id === tableId)).toBe(false);
    });
    const frame = await ada.match(tableId).frame();
    expect(frame.info.outcome).toEqual({ places: [[ada.userId], [bo.userId]] });
    // Stats: on her card, and on the Games board.
    expect((await ada.town.profile(ada.userId, "today")).games).toEqual({
      played: 1,
      wins: 1,
      net: 40,
      biggestPot: 80,
    });
    const board = await ada.town.gameBoard("today");
    expect(board.find((p) => p.userId === bo.userId)).toMatchObject({ played: 1, wins: 0, net: -40 });
    // Free again, and back where she was before the game (the Inn, where she woke up): by Back if she
    // was in the world when it ended, or on coming back if she wasn't.
    const back = await as(ada.token).world.back();
    if (back) expect(back).toMatchObject({ room: "inn", state: "idle" });
    else {
      const conn = as(ada.token).world.connect();
      expect((await conn.join()).room).toBe("inn");
      await conn.dispose();
    }
  });

  test("private tables refuse strangers; open ones take anyone; one game at a time", async () => {
    const host = await rich("host");
    const guest = await rich("guest");
    const stranger = await rich("stranger");
    const priv = (await host.arcade.open("spr", { stake: 0, open: false, invite: [guest.userId] })).me.table!;
    await expect(stranger.arcade.join(priv)).rejects.toThrow("invite only");
    await expect(host.arcade.open("spr", { stake: 0 })).rejects.toThrow("already at a table");
    await guest.arcade.answer(priv, false); // declined
    expect((await host.arcade.lobby()).tables.find((t) => t.id === priv)!.invited).toEqual([]);
    await host.arcade.leave(priv); // the host leaving closes it
    expect((await host.arcade.lobby()).me.table).toBeNull();

    const open = (await host.arcade.open("spr", { stake: 10 })).me.table!;
    expect((await stranger.arcade.lobby()).tables.some((t) => t.id === open)).toBe(true);
    await stranger.arcade.join(open);
    expect((await stranger.arcade.lobby()).me.match).toBe(open);
    await host.match(open).forfeit();
    await eventually(async () =>
      expect((await stranger.arcade.lobby()).matches.find((m) => m.id === open)!.outcome).toEqual({
        places: [[stranger.userId], [host.userId]],
      }),
    );
  });

  test("a stake is at most half your coins; leaving before the start gives it back", async () => {
    const poor = await rich("poor", 35);
    await expect(poor.arcade.open("spr", { stake: 20 })).rejects.toThrow("at most 🪙 17");
    await expect(poor.arcade.open("spr", { stake: 600 })).rejects.toThrow("0 to 500");
    const before = await balance(poor);
    const host = await rich("host2");
    const t = (await host.arcade.open("spr", { stake: 15, seats: 2 })).me.table!;
    await expect(poor.arcade.join(t)).resolves.toBeUndefined(); // 15 ≤ 17: fine, and the match starts
    await poor.match(t).forfeit();
    await eventually(async () => expect(await balance(poor)).toBe(before - 15));
  });

  test("side bets: the winner's backers take the pool; no betting on your own game", async () => {
    const a = await rich("sa");
    const b = await rich("sb");
    const fan = await rich("fan");
    const doubter = await rich("doubter");
    const id = (await a.arcade.open("spr", { stake: 0, invite: [b.userId], open: false })).me.table!;
    await b.arcade.answer(id, true);
    await expect(a.arcade.bet(id, a.userId, 10)).rejects.toThrow("own game");
    await expect(fan.arcade.bet(id, a.userId, 500)).rejects.toThrow("1 to 200");
    const [f0, d0] = [await balance(fan), await balance(doubter)];
    await fan.arcade.bet(id, a.userId, 30);
    await doubter.arcade.bet(id, b.userId, 20);
    await expect(fan.arcade.bet(id, b.userId, 5)).rejects.toThrow("already");
    expect((await fan.arcade.lobby()).matches.find((m) => m.id === id)!.bets).toEqual({
      [a.userId]: 30,
      [b.userId]: 20,
    });
    await b.match(id).forfeit(); // a wins
    await eventually(async () => {
      expect(await balance(fan)).toBe(f0 + 20);
      expect(await balance(doubter)).toBe(d0 - 20);
    });
  });

  test("a counter offer re-prices the table; double or nothing needs both", async () => {
    const a = await rich("ca");
    const b = await rich("cb");
    const t = (await a.arcade.open("spr", { stake: 50, open: false, invite: [b.userId] })).me.table!;
    await b.arcade.answer(t, { counter: 20 });
    expect((await a.arcade.lobby()).tables.find((x) => x.id === t)!.invited[0]!.counter).toBe(20);
    const [a0, b0] = [await balance(a), await balance(b)];
    await a.arcade.takeCounter(t, b.userId); // both seated at 20: it starts
    expect(await balance(a)).toBe(a0 + 50 - 20);
    expect(await balance(b)).toBe(b0 - 20);
    await b.match(t).forfeit();
    await eventually(async () => expect(await balance(a)).toBe(a0 + 50 + 20));

    await a.arcade.rematch(t);
    expect((await a.arcade.lobby()).me.match).toBe(t); // still the old one: b hasn't said yes
    await b.arcade.rematch(t);
    const again = (await a.arcade.lobby()).me.match!;
    expect(again).not.toBe(t);
    expect((await a.arcade.lobby()).matches.find((m) => m.id === again)!.stake).toBe(40);
  });

  test("Tokenmaxxing: an arena in town, players stay free, and the app syncs fast until it's over", async () => {
    const a = await rich("ta");
    const b = await rich("tb");
    const id = (
      await a.arcade.open("tokenmaxxing", {
        stake: 10,
        seats: 2,
        open: false,
        invite: [b.userId],
        options: { minutes: 15 },
      })
    ).me.table!;
    await b.arcade.answer(id, true);
    const g = (await townGames(a)).find((x) => x.id === id)!;
    expect(g.spot.kind).toBe("arena");
    expect(g.seats).toHaveLength(2);
    // Not held at the table: they can walk around.
    await expect(as(a.token).world.step("up")).resolves.not.toMatchObject({ state: "playing" });
    // The menu bar's battle line, and the app syncs fast until the battle and its grace period end.
    const battle = (await a.arcade.battle())!;
    expect(battle).toMatchObject({ name: "Tokenmaxxing", place: null, players: 2, tokens: 0 });
    expect(battle.until - battle.endsAt).toBe(3 * 60_000);
    expect(battle.endsAt).toBeGreaterThan(Date.now() + 15 * 60_000);
    expect((await as(b.token).arcade.battle())!.until).toBe(battle.until);
    await b.match(id).forfeit();
    await eventually(async () => {
      expect(await a.arcade.battle()).toBeNull();
      expect((await townGames(a)).some((x) => x.id === id)).toBe(false);
    });
  });
  test("a host can send 10 invites a minute, however they open and close tables", async () => {
    const host = await rich("spam");
    const guests = await Promise.all(Array.from({ length: 7 }, () => rich("guest")));
    const ids = guests.map((g) => g.userId);
    const first = (await host.arcade.open("hype", { stake: 0, invite: ids })).me.table!;
    await host.arcade.leave(first); // closing and reopening doesn't reset it
    const second = (await host.arcade.open("hype", { stake: 0, invite: ids })).me.table!;
    const table = (await host.arcade.lobby()).tables.find((t) => t.id === second)!;
    expect(table.invited).toHaveLength(3);
  });
});

test("a refund that fails during a sweep doesn't stop the sweeps: the next one closes the table", async () => {
  // In this process, with `town` and `world` faked: a failing refund can't be driven on the server.
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  let refunds = 0;
  const actor = {
    getOrCreate: () => ({
      refund: async () => {
        if (++refunds === 1) throw new Error("town is restarting");
      },
      notify: async () => {},
    }),
  };
  const controller = new AbortController();
  const state = {
    nextId: 2,
    matches: {},
    names: {},
    tables: {
      1: {
        id: 1,
        game: "spr",
        host: 7,
        stake: 0,
        seats: 2,
        split: "all",
        open: true,
        options: {},
        seated: [7],
        invited: [],
        createdAt: 0,
      },
    },
  };
  const running = (arcade.config.run as (c: unknown) => Promise<void>)({
    state,
    vars: { serial: serial() },
    conns: new Map(),
    client: () => ({ town: actor, world: actor, arcade: actor }),
    keepAwake: <T>(p: Promise<T>) => p,
    abortSignal: controller.signal,
  });
  try {
    await eventually(() => expect(Object.keys(state.tables)).toEqual([]));
    expect(refunds).toBe(2);
    expect(warn).toHaveBeenCalledWith("[arcade] sweep: Error: town is restarting");
  } finally {
    controller.abort();
    await running;
    warn.mockRestore();
  }
});
