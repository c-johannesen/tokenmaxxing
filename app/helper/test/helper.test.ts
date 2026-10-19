import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppState, Command, Message } from "@tokenmaxxing/core/protocol.ts";
import { client, origin, signUp } from "../../../server/test/rivet.ts";
import { Helper } from "../src/helper.ts";

let dir: string;

/** Distributes over the union, so each command keeps its own fields. */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tm-helper-"));
  process.env.CLAUDE_CONFIG_DIR = join(dir, "claude");
  process.env.CODEX_HOME = join(dir, "codex");
  process.env.CURSOR_DATA_DIR = join(dir, "cursor");
  process.env.CURSOR_PROJECTS_DIR = join(dir, "cursor-projects");
  process.env.TOKENMAXXING_CLAUDE_COWORK_DIR = join(dir, "cowork");
  process.env.TOKENMAXXING_POSTHOG_DESKTOP_DIR = join(dir, "posthog");
  await mkdir(join(dir, "claude", "projects", "p"), { recursive: true });
  await writeFile(
    join(dir, "claude", "projects", "p", "s1.jsonl"),
    `${JSON.stringify({
      type: "assistant",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      message: {
        id: "m1",
        model: "claude-haiku-4-5-20251001",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    })}\n`,
  );
});

afterEach(async () => {
  for (const k of [
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "CURSOR_DATA_DIR",
    "CURSOR_PROJECTS_DIR",
    "TOKENMAXXING_CLAUDE_COWORK_DIR",
    "TOKENMAXXING_POSTHOG_DESKTOP_DIR",
  ]) {
    delete process.env[k];
  }
  await rm(dir, { recursive: true, force: true });
});

function harness() {
  const messages: Message[] = [];
  const helper = new Helper({
    statePath: join(dir, "state.v2.json"),
    githubAccounts: null,
    write: (m) => messages.push(m),
    log: () => {},
  });
  let id = 0;
  const send = async (cmd: WithoutId<Command>) => {
    const withId = { ...cmd, id: ++id } as Command;
    await helper.handle(withId);
    return messages.find((m) => "id" in m && m.id === withId.id) as Extract<Message, { id: number }>;
  };
  const lastState = () =>
    (messages.filter((m) => "event" in m && m.event === "state").at(-1) as { state: AppState }).state;
  return { helper, messages, send, lastState };
}

const init = (token: string | null) => ({ cmd: "init" as const, token, serverUrl: origin });

describe("helper", () => {
  test("sync now acknowledges a long backfill before it finishes", async () => {
    const { helper, send } = harness();
    const pending = Promise.withResolvers<void>();
    const ticking = spyOn(helper, "tick").mockImplementation(() => pending.promise);
    try {
      expect(await send({ cmd: "syncNow" })).toMatchObject({ ok: true });
      expect(ticking).toHaveBeenCalledTimes(1);
      pending.resolve();
      await pending.promise;
    } finally {
      pending.resolve();
      ticking.mockRestore();
      helper.stop();
    }
  });

  test("slow periodic work shares one sync and refresh across repeated polls", async () => {
    const { helper } = harness();
    const sending = Promise.withResolvers<void>();
    const refreshing = Promise.withResolvers<void>();
    const sync = spyOn(helper, "syncOnce").mockImplementation(() => sending.promise);
    const refresh = spyOn(helper, "refresh").mockImplementation(() => refreshing.promise);
    try {
      const first = helper.tick();
      expect(helper.tick()).toBe(first);
      expect(sync).toHaveBeenCalledTimes(1);
      sending.resolve();
      await Promise.resolve();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(helper.tick()).toBe(first);
      expect(sync).toHaveBeenCalledTimes(1);
      refreshing.resolve();
      await first;
      await helper.tick();
      expect(sync).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      sending.resolve();
      refreshing.resolve();
      sync.mockRestore();
      refresh.mockRestore();
      helper.stop();
    }
  });

  test("a failed poll releases the periodic run for the next attempt", async () => {
    const { helper } = harness();
    const sync = spyOn(helper, "syncOnce").mockResolvedValue(undefined);
    const refresh = spyOn(helper, "refresh")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    try {
      await expect(helper.tick()).rejects.toThrow("offline");
      await helper.tick();
      expect(sync).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      sync.mockRestore();
      refresh.mockRestore();
      helper.stop();
    }
  });

  test("onboarding → sign up → my usage reaches the world", async () => {
    const { helper, messages, send, lastState } = harness();
    await send(init(null));
    expect(lastState().phase).toBe("onboarding");

    const name = `helper${Date.now().toString(36)}`;
    const r = await send({ cmd: "signUp", name });
    expect(r.ok).toBe(true);
    const tokenMsg = messages.find((m) => "event" in m && m.event === "token") as { token: string };
    expect(tokenMsg.token).toMatch(/^\d+\./);

    await helper.syncOnce();
    expect(helper.state.phase).toBe("ready");
    await helper.refresh();
    // The menu bar's count.
    expect(helper.state.today).toMatchObject({
      tokens: 15,
      rank: expect.any(Number),
      sources: [{ source: "claude_code", tokens: 15 }],
      prs: 0,
    });
    expect(helper.state.battle).toBeNull();
    helper.stop();
  });

  test("a taken name comes back as a stable error code", async () => {
    const taken = await signUp("taken");
    const { send } = harness();
    await send(init(null));
    expect(await send({ cmd: "signUp", name: taken.name })).toMatchObject({ ok: false, error: "name_taken" });
  });

  test("open world: a single-use code that signs the game window in", async () => {
    const u = await signUp("world");
    const { helper, send } = harness();
    await send(init(u.token));
    const { code } = ((await send({ cmd: "openWorld" })) as { ok: true; result: { code: string } }).result;
    const player = client.player.get([String(u.userId)]);
    const session = await player.redeemLoginCode(code);
    expect(session).toMatch(new RegExp(`^${u.userId}\\.`));
    await expect(player.redeemLoginCode(code)).rejects.toThrow();
    helper.stop();
  });

  test("link a computer: a code, and the line that uses it on the other computer", async () => {
    const u = await signUp("linkapp");
    const { helper, send } = harness();
    await send(init(u.token));
    const r = (await send({ cmd: "linkComputer" })) as {
      ok: true;
      result: { code: string; command: string };
    };
    expect(r.result.command).toBe(`curl -fsSL ${origin}/install.sh | sh -s -- link ${r.result.code}`);
    const linked = await client.player.get([String(u.userId)]).redeemLinkCode(r.result.code, "box", "linux");
    expect(linked.token).toMatch(new RegExp(`^${u.userId}\\.`));
    helper.stop();
  });

  test("a rejected token goes back to onboarding and tells the shell to forget it", async () => {
    const { helper, messages, send } = harness();
    await send(init("999999.not-a-real-token-at-all-aaaaaaaaaaaaaaaaa"));
    expect(helper.state.phase).toBe("onboarding");
    expect(messages).toContainEqual({ event: "token", token: null });
  });

  test("offline: commands fail with `offline`, not a crash", async () => {
    const { helper, send } = harness();
    await send({ ...init("1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), serverUrl: "http://127.0.0.1:9" });
    expect(await send({ cmd: "openWorld" })).toMatchObject({ ok: false, error: "offline" });
    helper.stop();
  });
});
