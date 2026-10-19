import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollectOptions } from "../src/sync/collect.ts";
import { emptyState, loadState } from "../src/sync/state.ts";
import { sync } from "../src/sync/sync.ts";
import type { Source, TokenEvent } from "../src/types.ts";

let dir: string;
let statePath: string;
const enabled = new Set<Source>(["claude_code"]);

const line = (id: string, ts = "2026-09-01T10:00:00.000Z") =>
  `${JSON.stringify({
    type: "assistant",
    sessionId: "s1",
    timestamp: ts,
    message: { id, model: "claude-opus-5", usage: { input_tokens: 1, output_tokens: 2 } },
  })}\n`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tm-sync-"));
  statePath = join(dir, "state", "state.json");
  process.env.CLAUDE_CONFIG_DIR = join(dir, "claude");
  process.env.TOKENMAXXING_POSTHOG_DESKTOP_DIR = join(dir, "posthog");
  await mkdir(join(dir, "claude", "projects", "p"), { recursive: true });
});

afterEach(async () => {
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.TOKENMAXXING_POSTHOG_DESKTOP_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("sync", () => {
  test("sends new lines once, resumes from the saved offset", async () => {
    const file = join(dir, "claude", "projects", "p", "s1.jsonl");
    await writeFile(file, line("m1") + line("m2"));
    const sent: TokenEvent[][] = [];
    const send = async (events: TokenEvent[]) => {
      sent.push(events);
      return { inserted: events.length, duplicates: 0 };
    };

    const r1 = await sync(emptyState(), { statePath, enabled, send });
    expect(r1.sent).toBe(2);
    expect((await loadState(statePath)).files[file]!.byteOffset).toBeGreaterThan(0);

    await appendFile(file, line("m3"));
    await utimes(file, new Date(), new Date(Date.now() + 5000));
    const r2 = await sync(r1.state, { statePath, enabled, send });
    expect(r2.sent).toBe(1);
    expect(sent.flat().map((e) => e.messageId)).toEqual(["m1", "m2", "m3"]);
  });

  test("a failed send leaves the offset where it was, so nothing is lost", async () => {
    const file = join(dir, "claude", "projects", "p", "s1.jsonl");
    await writeFile(file, line("m1"));
    const failing = async () => {
      throw new Error("offline");
    };
    await expect(sync(emptyState(), { statePath, enabled, send: failing })).rejects.toThrow("offline");
    expect((await loadState(statePath)).files[file]).toBeUndefined();

    let got = 0;
    await sync(await loadState(statePath), {
      statePath,
      enabled,
      send: async (events) => {
        got += events.length;
        return { inserted: events.length, duplicates: 0 };
      },
    });
    expect(got).toBe(1);
  });

  test("disabled sources are skipped", async () => {
    await writeFile(join(dir, "claude", "projects", "p", "s1.jsonl"), line("m1"));
    let got = 0;
    await sync(emptyState(), {
      statePath,
      enabled: new Set(),
      send: async (events) => {
        got += events.length;
        return { inserted: 0, duplicates: 0 };
      },
    });
    expect(got).toBe(0);
  });
  test("GitHub is searched at most every 15 minutes, per account, and says why it can't", async () => {
    const searched: string[] = [];
    const githubFetch = (async (url: string, init: RequestInit) => {
      searched.push(`${new URL(url).host} ${(init.headers as Record<string, string>).authorization}`);
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;
    let accounts: Awaited<ReturnType<NonNullable<CollectOptions["githubAccounts"]>>> = [
      { host: "github.com", login: "me", token: "a" },
      { host: "ghe.acme.com", login: "me-at-work", token: "b" },
    ];
    const send = async () => ({ inserted: 0, duplicates: 0 });
    const opts = {
      statePath,
      enabled: new Set<Source>(["github"]),
      githubAccounts: async () => accounts,
      githubFetch,
      send,
    };
    const t0 = Date.UTC(2026, 8, 29, 12);
    let state = (await sync(emptyState(), { ...opts, now: () => t0 })).state;
    state = (await sync(state, { ...opts, now: () => t0 + 10 * 60_000 })).state;
    expect(searched).toEqual(["api.github.com Bearer a", "ghe.acme.com Bearer b"]);
    expect(state.github?.problem).toBeUndefined();
    accounts = "no_gh";
    state = (await sync(state, { ...opts, now: () => t0 + 15 * 60_000 })).state;
    expect(state.github?.problem).toBe("no_gh");
  });

  test("deleted files are forgotten; the same message in two files is sent once", async () => {
    const dirP = join(dir, "claude", "projects", "p");
    await writeFile(join(dirP, "a.jsonl"), line("m1"));
    await writeFile(join(dirP, "b.jsonl"), line("m1") + line("m2")); // a subagent log repeating m1
    const sent: TokenEvent[] = [];
    const send = async (events: TokenEvent[]) => {
      sent.push(...events);
      return { inserted: events.length, duplicates: 0 };
    };
    const r1 = await sync(emptyState(), { statePath, enabled, send });
    expect(sent.map((e) => e.messageId).sort()).toEqual(["m1", "m2"]);
    await rm(join(dirP, "a.jsonl"));
    const r2 = await sync(r1.state, { statePath, enabled, send });
    expect(Object.keys(r2.state.files)).toEqual([join(dirP, "b.jsonl")]);
  });

  test("a big backlog goes in sends of at most 1000", async () => {
    await writeFile(
      join(dir, "claude", "projects", "p", "big.jsonl"),
      Array.from({ length: 2500 }, (_, i) => line(`m${i}`)).join(""),
    );
    const sizes: number[] = [];
    await sync(emptyState(), {
      statePath,
      enabled,
      send: async (events) => {
        sizes.push(events.length);
        return { inserted: events.length, duplicates: 0 };
      },
    });
    expect(sizes).toEqual([1000, 1000, 500]);
  });
});
