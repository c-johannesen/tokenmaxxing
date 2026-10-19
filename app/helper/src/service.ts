import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Keeps `tokenmaxxing run` going on a linked computer: a LaunchAgent on macOS, a systemd user unit on
 * Linux. Both restart it when it crashes but not when it exits cleanly, which it does once its token is
 * revoked.
 */

const LABEL = "dk.hanskristoffer.tokenmaxxing.cli";
const UNIT = "tokenmaxxing.service";

/**
 * A service starts with a bare environment, so it gets the variables that decide where logs are and
 * where `gh` is, as they were when the computer was linked.
 */
const PASSED_ENV = [
  "PATH",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "CURSOR_DATA_DIR",
  "CURSOR_PROJECTS_DIR",
  "TOKENMAXXING_CLAUDE_COWORK_DIR",
  "TOKENMAXXING_CLI_DIR",
  "TOKENMAXXING_POSTHOG_DESKTOP_DIR",
  "XDG_CONFIG_HOME",
];

export const serviceEnv = (env: NodeJS.ProcessEnv = process.env): Record<string, string> =>
  Object.fromEntries(PASSED_ENV.flatMap((k) => (env[k] ? [[k, env[k]]] : [])));

/** How to run `tokenmaxxing run`: the compiled binary itself, or Bun and this script from source. */
export function runCommand(): string[] {
  const compiled = Bun.main.startsWith("/$bunfs/") || Bun.main.includes("~BUN");
  return compiled ? [process.execPath, "run"] : [process.execPath, Bun.main, "run"];
}

export const launchAgentPath = (home = homedir()) => join(home, "Library", "LaunchAgents", `${LABEL}.plist`);

export const macLogPath = (home = homedir()) => join(home, "Library", "Logs", "Tokenmaxxing", "cli.log");

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function launchAgent(program: string[], env: Record<string, string>, logPath: string): string {
  const strings = (xs: string[]) => xs.map((x) => `    <string>${xml(x)}</string>`).join("\n");
  const vars = Object.entries(env)
    .map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings(program)}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${vars}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

export const systemdUnitPath = (env: NodeJS.ProcessEnv = process.env) =>
  join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user", UNIT);

/** systemd's own quoting: each word in double quotes, with `\`, `"`, `%` and `$` escaped. */
const quote = (s: string) => `"${s.replace(/[\\"]/g, "\\$&").replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;

export function systemdUnit(program: string[], env: Record<string, string>): string {
  const vars = Object.entries(env)
    .map(([k, v]) => `Environment=${quote(`${k}=${v}`)}`)
    .join("\n");
  return `[Unit]
Description=Tokenmaxxing: sends this computer's AI agent token usage to your account
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=${program.map(quote).join(" ")}
${vars}
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`;
}

async function sh(cmd: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { ok: code === 0, out: `${out}${err}`.trim() };
  } catch (err) {
    return { ok: false, out: String(err) };
  }
}

const gui = () => `gui/${process.getuid?.() ?? 0}`;

export type ServiceResult = { ok: true; note?: string } | { ok: false; why: string };

/** Installs and starts the service. Where there's no service manager, says how to run it instead. */
export async function installService(): Promise<ServiceResult> {
  const program = runCommand();
  const env = serviceEnv();
  if (process.platform === "darwin") {
    const path = launchAgentPath();
    await mkdir(dirname(path), { recursive: true });
    await mkdir(dirname(macLogPath()), { recursive: true });
    await writeFile(path, launchAgent(program, env, macLogPath()));
    await sh(["launchctl", "bootout", `${gui()}/${LABEL}`]);
    const r = await sh(["launchctl", "bootstrap", gui(), path]);
    return r.ok ? { ok: true } : { ok: false, why: `launchctl: ${r.out}` };
  }
  if (process.platform === "linux" && Bun.which("systemctl")) {
    const path = systemdUnitPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, systemdUnit(program, env));
    await sh(["systemctl", "--user", "daemon-reload"]);
    const r = await sh(["systemctl", "--user", "enable", "--now", UNIT]);
    if (!r.ok) return { ok: false, why: `systemctl: ${r.out}` };
    // Without lingering, user services stop at logout and don't start at boot: a workhorse nobody
    // logs in to would never sync.
    const user = process.env.USER ?? "";
    const linger = await sh(["loginctl", "enable-linger", user]);
    return linger.ok
      ? { ok: true }
      : { ok: true, note: `To keep syncing while you're logged out: sudo loginctl enable-linger ${user}` };
  }
  return { ok: false, why: "no launchd or systemd here" };
}

/** Stops and removes the service. `running` false: called from the service itself, which exits next. */
export async function uninstallService(running = true): Promise<void> {
  if (process.platform === "darwin") {
    if (running) await sh(["launchctl", "bootout", `${gui()}/${LABEL}`]);
    await rm(launchAgentPath(), { force: true });
  } else if (process.platform === "linux" && Bun.which("systemctl")) {
    await sh(["systemctl", "--user", "disable", ...(running ? ["--now"] : []), UNIT]);
    await rm(systemdUnitPath(), { force: true });
    await sh(["systemctl", "--user", "daemon-reload"]);
  }
}

/** Whether the service is running, as the service manager sees it; null where there's none. */
export async function serviceRunning(): Promise<boolean | null> {
  if (process.platform === "darwin") {
    const r = await sh(["launchctl", "print", `${gui()}/${LABEL}`]);
    return r.ok && /state = running/.test(r.out);
  }
  if (process.platform === "linux" && Bun.which("systemctl"))
    return (await sh(["systemctl", "--user", "is-active", UNIT])).out === "active";
  return null;
}

/** Follows the service's log. */
export function logsCommand(): string[] | null {
  if (process.platform === "darwin") return ["tail", "-n", "50", "-F", macLogPath()];
  if (process.platform === "linux") return ["journalctl", "--user", "-u", UNIT, "-n", "50", "-f"];
  return null;
}
