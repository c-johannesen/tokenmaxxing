import type { DeviceInfo } from "@tokenmaxxing/server/registry";
import { useEffect, useState } from "react";
import { withPlayer } from "../net.ts";
import { tauri } from "./AppUpdate.tsx";
import { useRun } from "./ui.tsx";

const PLATFORMS: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" };

const devices = () => withPlayer((p) => p.devices());

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
function ago(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / (24 * 60))} days ago`;
}

/**
 * On my own card: the computers whose usage counts for me (WORKHORSE.md). The app makes the line that
 * links another one; a plain browser can't, as only the app may.
 */
export function Computers() {
  const [list, setList] = useState<DeviceInfo[] | null>(null);
  const [command, setCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { error, busy, run } = useRun();

  useEffect(() => {
    void devices().then(setList, () => {});
  }, []);
  // While a line is out, watch for the new computer to show up.
  useEffect(() => {
    if (!command) return;
    const id = setInterval(() => void devices().then(setList, () => {}), 5000);
    return () => clearInterval(id);
  }, [command]);

  const link = run(async () => {
    setCommand(await tauri!.core.invoke<string>("link_computer"));
    setCopied(false);
  });
  const copy = run(async () => {
    await navigator.clipboard.writeText(command!);
    setCopied(true);
  });
  const remove = (id: number) =>
    run(async () => {
      await withPlayer((p) => p.revokeDevice(id));
      setList(await devices());
    });

  const now = Date.now();
  return (
    <>
      <h3>Computers</h3>
      <p className="muted small">Tokens from every computer you link count for you.</p>
      {list && (
        <ul className="members">
          {list.map((d) => (
            <li key={d.id}>
              <span>
                {d.kind === "app" ? "💻" : "🖥"} {d.name}{" "}
                <small className="muted">
                  {d.kind === "app" ? "this Mac" : (PLATFORMS[d.platform] ?? d.platform)}
                  {d.kind === "linked" && ` · synced ${ago(d.lastSeenAt, now)}`}
                </small>
              </span>
              {d.kind === "linked" && (
                <button type="button" className="link" disabled={busy} onClick={() => void remove(d.id)()}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!tauri ? (
        <p className="muted small">To link another computer, open the world from the app.</p>
      ) : command ? (
        <>
          <p className="small">Run this in a terminal on the other computer (macOS or Linux):</p>
          <div className="command">
            <code>{command}</code>
            <button type="button" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="muted small">
            It works once, for 10 minutes. The computer shows up here once it's linked.
          </p>
        </>
      ) : (
        <button type="button" className="primary" disabled={busy} onClick={() => void link()}>
          Link a computer
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
