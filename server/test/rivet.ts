/**
 * One real server for the whole test run (bun runs every file in one process):
 * `main.ts` in a subprocess with a throwaway data dir and spare ports, so the
 * proxy, the engine and every actor are the production code paths.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenEvent } from "@tokenmaxxing/core/types.ts";
import { createClient } from "rivetkit/client";
import type { registry as Registry } from "../src/actors/registry.ts";
import { afterEveryTest, atExit } from "./cleanup.ts";

/** The admin page's token on the test server. */
export const ADMIN_TOKEN = "test-admin-token-0123456789abcdef";

const port = 20_000 + Math.floor(Math.random() * 20_000);
const enginePort = port + 100;
const server = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts")], {
  env: {
    ...process.env,
    PORT: String(port),
    TOKENMAXXING_HOST: "127.0.0.1",
    RIVET_RUN_ENGINE_PORT: String(enginePort),
    RIVETKIT_STORAGE_PATH: join(mkdtempSync(join(tmpdir(), "tokenmaxxing-test-")), "rivet"),
    RIVET_LOG_LEVEL: "error",
    // Company websites stay on the sign; no scraping or Claude calls from tests.
    FIRECRAWL_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    ADMIN_TOKEN,
    // Every test comes from 127.0.0.1; `signUp` below poses as a new address each time instead.
    GATEWAY_REQUESTS_PER_MIN: "1000000",
    GATEWAY_SOCKETS_PER_MIN: "1000000",
  },
  stdout: "ignore",
  stderr: "ignore",
});

export const origin = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  const up = await fetch(`${origin}/health`).then(
    (r) => r.ok,
    () => false,
  );
  if (up) break;
  if (i > 300) throw new Error("test server didn't start");
  await Bun.sleep(100);
}

// The engine is its own process and would outlive the server, so kill both on exit.
const enginePid = Number(
  Bun.spawnSync(["lsof", "-t", `-iTCP:${enginePort}`, "-sTCP:LISTEN"])
    .stdout.toString()
    .split("\n")[0],
);
atExit.push(() => {
  server.kill("SIGKILL");
  if (enginePid) process.kill(enginePid, "SIGKILL");
});

export const client = createClient<typeof Registry>({ endpoint: `${origin}/api/rivet` });

/** A client that comes from `ip`, as Railway's edge would say (`x-real-ip`): sign-ups are limited per IP. */
export const from = (ip: string) =>
  createClient<typeof Registry>({ endpoint: `${origin}/api/rivet`, headers: { "x-real-ip": ip } });

let n = 0;
/** Tokens of users signed up during the current test. */
const fresh: string[] = [];

/** A fresh user; names are unique per run since `town` is shared by every test. */
export async function signUp(prefix = "u") {
  const name = `${prefix}${Date.now().toString(36)}${n++}`;
  const r = await from(`10.1.${Math.floor(n / 250)}.${n % 250}`)
    .town.getOrCreate(["main"])
    .signUp(name);
  fresh.push(r.token);
  return { ...r, town: client.town.getOrCreate(["main"], { params: { token: r.token } }) };
}

type User = Awaited<ReturnType<typeof signUp>>;

/** `member` applies to `owner`'s company and `owner` lets them in. */
export async function admit(owner: User, member: User, companyId: number) {
  await member.town.apply(companyId);
  return owner.town.approve(member.userId);
}

// Every test shares the town: after each test its users leave their companies, which closes them,
// so the town doesn't keep growing.
afterEveryTest.push(async () => {
  const tokens = fresh.splice(0);
  await Promise.all(
    tokens.map(
      (token) =>
        client.town
          .getOrCreate(["main"], { params: { token } })
          .leaveCompany()
          .catch(() => {}), // signed out during the test
    ),
  );
});

/** `town` as the admin page calls it. */
export const admin = () => client.town.getOrCreate(["main"], { params: { admin: ADMIN_TOKEN } });

export const as = (token: string) => ({
  town: client.town.getOrCreate(["main"], { params: { token } }),
  world: client.world.getOrCreate(["main"], { params: { token } }),
  player: (userId: number) => client.player.get([String(userId)], { params: { token } }),
  arcade: client.arcade.getOrCreate(["main"], { params: { token } }),
  match: (id: number) => client.match.get([String(id)], { params: { token } }),
});

/** A fresh user with `coins` coins, given from the admin page (real usage that big would be capped). */
export async function rich(prefix = "rich", coins = 100) {
  const u = await signUp(prefix);
  await admin().adminSetCoins(u.userId, coins);
  return { ...u, ...as(u.token) };
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;
let seq = 0;

/**
 * Lifetime tokens past level 10 (`OFFICE_LEVEL`): ~50B over 250 minutes, each just under the
 * per-minute cap, on a day from before signing up so it pays no coins.
 */
export async function veteran(u: { token: string; userId: number }) {
  const start = Date.UTC(2024, 0, 10, 12);
  await as(u.token)
    .player(u.userId)
    .ingest(Array.from({ length: 250 }, (_, i) => event({ inputTokens: 199e6, timestamp: start + i * MIN })));
}

export function event(overrides: Partial<TokenEvent> = {}): TokenEvent {
  seq++;
  return {
    source: "claude_code",
    sessionId: "s1",
    agentId: null,
    messageId: `m${seq}`,
    requestId: null,
    timestamp: Date.now() - HOUR,
    model: "claude-haiku-4-5-20251001",
    messageType: "assistant",
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: null,
    ...overrides,
  };
}

/** One assistant event every 5 minutes from `start` for `durationMs`. */
export function activity(
  sessionId: string,
  start: number,
  durationMs: number,
  agentId: string | null = null,
) {
  const out: TokenEvent[] = [];
  for (let t = start; t < start + durationMs; t += 5 * MIN)
    out.push(event({ sessionId, agentId, timestamp: t }));
  return out;
}

/** Retries `check` (a function with `expect`s) until it passes, or rethrows its failure after `ms`. */
export async function eventually<T>(check: () => Promise<T> | T, ms = 5_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await check();
    } catch (err) {
      if (Date.now() > end) throw err;
      await Bun.sleep(50);
    }
  }
}
