import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { as, client, origin, signUp } from "../../../server/test/rivet.ts";
import { launchAgent, serviceEnv, systemdUnit } from "../src/service.ts";

const CLI = join(import.meta.dir, "../src/cli.ts");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tm-cli-"));
  await mkdir(join(dir, "claude", "projects", "p"), { recursive: true });
  await writeFile(join(dir, "claude", "projects", "p", "w1.jsonl"), line(`w1${Date.now()}`));
});

/** One Claude Code assistant turn of 15 tokens, now. */
const line = (id: string) =>
  `${JSON.stringify({
    type: "assistant",
    sessionId: id,
    timestamp: new Date().toISOString(),
    message: { id, model: "claude-haiku-4-5-20251001", usage: { input_tokens: 10, output_tokens: 5 } },
  })}\n`;

afterEach(() => rm(dir, { recursive: true, force: true }));

/** This test's logs, config and home. */
const env = () => ({
  ...process.env,
  HOME: join(dir, "home"),
  TOKENMAXXING_CLI_DIR: join(dir, "cli"),
  CLAUDE_CONFIG_DIR: join(dir, "claude"),
  CODEX_HOME: join(dir, "codex"),
  CURSOR_DATA_DIR: join(dir, "cursor"),
  CURSOR_PROJECTS_DIR: join(dir, "cursor-projects"),
  TOKENMAXXING_CLAUDE_COWORK_DIR: join(dir, "cowork"),
  TOKENMAXXING_POSTHOG_DESKTOP_DIR: join(dir, "posthog"),
});

/** Runs the CLI as its own process. */
async function cli(...args: string[]) {
  const p = Bun.spawn(["bun", CLI, ...args], {
    env: env(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { out, err, code };
}

async function linkedUser(prefix: string) {
  const u = await signUp(prefix);
  const code = await as(u.token).player(u.userId).mintLinkCode();
  const r = await cli("link", code, "--server", origin, "--name", "box", "--no-service");
  return { u, r };
}

describe("tokenmaxxing CLI", () => {
  test("link sends this computer's usage to the account, and unlink removes it", async () => {
    const { u, r } = await linkedUser("cli");
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Linked to @${u.name}: 15 tokens today.`);
    const app = as(u.token).player(u.userId);
    expect((await app.devices()).map((d) => [d.kind, d.name])).toEqual([
      ["app", "Desktop app"],
      ["linked", "box"],
    ]);

    const status = await cli("status");
    expect(status.out).toContain("Computer:  box");
    expect(status.out).toContain(`Account:   @${u.name}`);

    const again = await cli("link", await app.mintLinkCode(), "--server", origin);
    expect(again.code).toBe(1);
    expect(again.err).toContain('Already linked as "box"');

    const unlink = await cli("unlink");
    expect(unlink.out).toContain('Unlinked "box"');
    expect((await app.devices()).map((d) => d.kind)).toEqual(["app"]);
    expect(existsSync(join(dir, "cli"))).toBe(false);
  });

  test("a bad or used code is refused, with the server's reason", async () => {
    const u = await signUp("clibad");
    const r = await cli("link", `${u.userId}.${"x".repeat(43)}`, "--server", origin, "--no-service");
    expect(r.code).toBe(1);
    expect(r.err).toContain("That code has expired");
    expect(existsSync(join(dir, "cli"))).toBe(false);
  });

  test("a computer removed in the game forgets its token on the next sync", async () => {
    const { u } = await linkedUser("clirevoked");
    const app = as(u.token).player(u.userId);
    const linked = (await app.devices()).find((d) => d.kind === "linked")!;
    await app.revokeDevice(linked.id);
    // New usage goes to `player`, which checks the token itself (other actors cache it for a minute).
    await writeFile(join(dir, "claude", "projects", "p", "w2.jsonl"), line(`w2${Date.now()}`));
    const r = await cli("sync");
    expect(r.code).toBe(1);
    expect(r.err).toContain("removed from your account");
    expect(existsSync(join(dir, "cli", "config.json"))).toBe(false);
  });

  test("the service stops for good, and cleans up, once the computer is removed", async () => {
    const { u } = await linkedUser("clirun");
    const app = as(u.token).player(u.userId);
    await app.revokeDevice((await app.devices()).find((d) => d.kind === "linked")!.id);
    await writeFile(join(dir, "claude", "projects", "p", "w3.jsonl"), line(`w3${Date.now()}`));
    const r = await cli("run");
    // A clean exit: launchd and systemd restart the service only when it fails.
    expect(r.code).toBe(0);
    expect(r.err).toContain("removed from the account; stopping");
    expect(existsSync(join(dir, "cli"))).toBe(false);
  });

  test("the server is required", async () => {
    const r = await cli("link", "1.abc");
    expect(r.code).toBe(1);
    expect(r.err).toContain("--server");
    expect(client).toBeDefined();
  });
});

describe("install.sh", () => {
  /** The server's install script, as `curl … | sh -s --` would run it. */
  const installer = async () => {
    const path = join(dir, "install.sh");
    await writeFile(path, await (await fetch(`${origin}/install.sh`)).text());
    return path;
  };

  test("installs the checked binary and links with the server it came from", async () => {
    const releases = join(dir, "releases");
    const file = `tokenmaxxing-${process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`;
    const build = Bun.spawnSync(["bun", "build", CLI, "--compile", "--outfile", join(releases, file)]);
    expect(build.exitCode).toBe(0);
    const sum = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(join(releases, file)).bytes())
      .digest("hex");
    await writeFile(join(releases, "SHA256SUMS"), `${sum}  ${file}\n`);

    const u = await signUp("install");
    const code = await as(u.token).player(u.userId).mintLinkCode();
    const p = Bun.spawn(["sh", await installer(), "link", code, "--name", "installed", "--no-service"], {
      env: {
        ...env(),
        TOKENMAXXING_DOWNLOAD_BASE: `file://${releases}`,
        TOKENMAXXING_INSTALL_DIR: join(dir, "bin"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()];
    expect(await p.exited, err).toBe(0);
    expect(out).toContain(`Installed ${join(dir, "bin", "tokenmaxxing")}`);
    expect(out).toContain(`Linked to @${u.name}: 15 tokens today.`);
  }, 60_000);

  test("a download that doesn't match its checksum isn't installed", async () => {
    const releases = join(dir, "releases");
    const file = `tokenmaxxing-${process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`;
    await mkdir(releases, { recursive: true });
    await writeFile(join(releases, file), "#!/bin/sh\necho tampered\n");
    await writeFile(join(releases, "SHA256SUMS"), `${"0".repeat(64)}  ${file}\n`);
    const p = Bun.spawn(["sh", await installer(), "--version"], {
      env: {
        ...env(),
        TOKENMAXXING_DOWNLOAD_BASE: `file://${releases}`,
        TOKENMAXXING_INSTALL_DIR: join(dir, "bin"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await p.exited).toBe(1);
    expect(await new Response(p.stderr).text()).toContain("didn't match its checksum");
    expect(existsSync(join(dir, "bin", "tokenmaxxing"))).toBe(false);
  });
});

describe("service files", () => {
  const program = ["/Users/a b/.local/bin/tokenmaxxing", "run"];
  const env = { PATH: "/opt/homebrew/bin:/usr/bin", CODEX_HOME: "/x/&y" };

  test("the LaunchAgent runs `tokenmaxxing run` with the environment, restarting only on failure", () => {
    const plist = launchAgent(program, env, "/tmp/cli.log");
    expect(plist).toContain("<string>/Users/a b/.local/bin/tokenmaxxing</string>\n    <string>run</string>");
    expect(plist).toContain("<key>CODEX_HOME</key>\n    <string>/x/&amp;y</string>");
    expect(plist).toContain("<key>SuccessfulExit</key>\n    <false/>");
  });

  test("the systemd unit quotes its words and escapes what systemd expands", () => {
    const unit = systemdUnit(program, { PATH: "/bin", HOME_ISH: "50%$HOME" });
    expect(unit).toContain('ExecStart="/Users/a b/.local/bin/tokenmaxxing" "run"');
    expect(unit).toContain('Environment="HOME_ISH=50%%$$HOME"');
    expect(unit).toContain("Restart=on-failure");
  });

  test("only the variables that locate logs and tools are passed on", () => {
    expect(serviceEnv({ PATH: "/bin", SECRET: "x", CODEX_HOME: "/c" })).toEqual({
      PATH: "/bin",
      CODEX_HOME: "/c",
    });
  });
});
