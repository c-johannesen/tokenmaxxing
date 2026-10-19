import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { type TokenmaxxingState, tokenmaxxing } from "@tokenmaxxing/core/games/tokenmaxxing.ts";
import type { Frame } from "@tokenmaxxing/core/games/wire.ts";
import { match } from "../src/actors/match.ts";

// Use the same proxy version as RivetKit without making it a runtime dependency of our server.
const require = createRequire(import.meta.resolve("rivetkit"));
const { default: onChange } = require("@rivetkit/on-change") as {
  default: {
    <T extends object>(value: T, changed: () => void): T;
    target<T>(value: T): T;
  };
};
const actions = match.config.actions!;
type Context = Parameters<typeof actions.usage>[0];

function battle() {
  const now = Date.now();
  const players = Array.from({ length: 12 }, (_, i) => i + 1);
  const game = tokenmaxxing.setup(players, 0, { minutes: 15 }, now - 120_000);
  game.phase = "live";
  for (const id of players) game.history[id] = Array.from({ length: 120 }, (_, i) => [game.startsAt + i, i]);
  let writes = 0;
  let tokens = 0;
  let statusUpdates = 0;
  let used = async () => ({ tokens, flagged: false });
  const frames: Frame[] = [];
  const state = onChange(
    {
      id: 8,
      game: "tokenmaxxing" as const,
      players: players.map((userId) => ({ userId, name: `p${userId}` })),
      stake: 10,
      split: "all" as const,
      options: { minutes: 15 },
      seed: 0,
      startedAt: now - 120_000,
      betsCloseAt: game.startsAt,
      state: game,
      outcome: null,
      seen: {},
      bets: {},
      forfeited: [] as number[],
      reported: false,
    },
    () => writes++,
  );
  const client = {
    player: { get: () => ({ tokensBetween: () => used() }) },
    world: {
      getOrCreate: () => ({
        callout: async () => {},
        gameStatus: async () => {
          statusUpdates++;
        },
      }),
    },
    arcade: { getOrCreate: () => ({ finished: async () => {} }) },
    town: { getOrCreate: () => ({}) },
  };
  const controller = new AbortController();
  const ctx = {
    state,
    conn: { state: { kind: "internal" } },
    conns: new Map([
      [
        "player",
        { state: { kind: "user", userId: 1 }, send: (_event: string, frame: Frame) => frames.push(frame) },
      ],
    ]),
    abortSignal: controller.signal,
    keepAwake: <T>(p: Promise<T>) => p,
    client: () => client,
  } as unknown as Context;
  return {
    ctx,
    state,
    controller,
    frames,
    writes: () => writes,
    statusUpdates: () => statusUpdates,
    score: (n: number) => {
      tokens = n;
    },
    query: (fn: typeof used) => {
      used = fn;
    },
  };
}

test("repeated battle score updates keep stored state proxy-free and preserve frames and standings", async () => {
  const b = battle();
  for (let i = 1; i <= 150; i++) {
    b.score(i * 1_000);
    expect(await actions.usage(b.ctx, 1)).toMatchObject({ tokens: i * 1_000, place: 1, players: 12 });
    // Spread updates must not store proxy children: that made each later update more expensive.
    const stored = structuredClone(onChange.target(b.state).state);
    expect(stored.tokens[1]).toBe(i * 1_000);
    expect(stored.history[1]!.length).toBeLessThanOrEqual(120);
    expect(actions.standing(b.ctx, 1)).toMatchObject({ tokens: i * 1_000, place: 1 });
  }
  expect(b.statusUpdates()).toBe(150);
  expect(b.frames).toHaveLength(150);
  expect((b.frames.at(-1)!.view as TokenmaxxingState).tokens[1]).toBe(150_000);
  expect(b.state.state.tokens[2]).toBe(0);
});

test("unchanged usage and ticks do not rewrite or broadcast a match", async () => {
  const b = battle();
  expect(await actions.usage(b.ctx, 1)).toMatchObject({ tokens: 0 });
  expect(b.writes()).toBe(0);
  expect(b.statusUpdates()).toBe(0);
  expect(b.frames).toEqual([]);
  const run = match.config.run as (c: Context) => Promise<void>;
  const running = run(b.ctx);
  try {
    await Bun.sleep(1_100);
    expect(b.writes()).toBe(0);
    expect(b.statusUpdates()).toBe(0);
  } finally {
    b.controller.abort();
    await running;
  }
});

test("a usage query finishing after a forfeit does not restore that player's score", async () => {
  const b = battle();
  const pending = Promise.withResolvers<{ tokens: number; flagged: boolean }>();
  b.query(() => pending.promise);
  const usage = actions.usage(b.ctx, 1);
  const user = { ...b.ctx, conn: { state: { kind: "user", userId: 1 } } } as Context;
  await actions.forfeit(user);
  pending.resolve({ tokens: 99_000, flagged: false });
  expect(await usage).toMatchObject({ tokens: 0, place: null });
  expect(b.state.state.forfeited).toContain(1);
  expect(b.state.state.tokens[1]).toBe(0);
});

test("match chat stores plain lines, so each new line doesn't make the state slower to read", async () => {
  const b = battle();
  const user = {
    ...b.ctx,
    conn: { state: { kind: "user", userId: 1 } },
    vars: { chat: { take: () => true } },
  } as unknown as Context;
  for (let i = 1; i <= 50; i++) await actions.say(user, `line ${i}`);
  // Spreading the live array stored the old lines as proxies, one layer deeper with every line.
  const stored = structuredClone((onChange.target(b.state) as { chat?: unknown[] }).chat!);
  expect(stored).toHaveLength(50);
  expect(stored.at(-1)).toMatchObject({ id: 50, userId: 1, name: "p1", text: "line 50" });
});
