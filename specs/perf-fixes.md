# Load-test and crash fixes for this PR

From the load test of `feat/progression` (numbers and scripts in `/tmp/perf/`) and the crash investigation
(`/tmp/crash/`): drops cost almost nothing on the server, the client re-bakes the whole ground on every drop and
pickup, and an uncaught promise in the world's tick turns any database stall into a crashed server, in production
too. Three fixes here; the 250-player ceiling is
`specs/world-scale.md`, a separate PR.

## 1. Stop game-time errors from killing the server

**Reproduced on upstream `main` (v1.5.0, production)** by the crash investigation (`/tmp/crash/`, log
`server-main.log`): with games starting and ending and players walking through doors, a 25 s stall of the
`rivet-engine` child made the world's SQLite close; the next room change crashed the process:

```
RivetError: SQLite transaction coordinator is closed.   (group "sqlite", actor key "main")
      at async chatOf (…/server/src/actors/world.ts:846:22)
      at async snapshot (…/world.ts:826:17)
      at async sendSnapshot (…/world.ts:869:22)
Bun v1.4.2
```

The load test hit the same stack twice on this branch, under 500 players and after the Mac woke from sleep.

Why it kills the process: the world's tick (`flush`, branch `world.ts:1235`, main `:897`) starts
`void sendSnapshot(c, p)` for every online player who changed room, with no `.catch`. RivetKit catches errors from
actions, `run` loops, hooks and `c.waitUntil`, but not a detached promise; after `main.ts`'s top-level `await` has
finished, Bun 1.4.2 exits on any unhandled rejection. Why "some games": Ship, Pivot, Raise, Hype Cycle and Due
Diligence move every online player to the square when they start and back when they end, which is a room change
for each; Tokenmaxxing battles don't move anyone. The trigger is anything that stalls the engine link: load, CPU
starvation, a paused container, a deploy.

Fixes, all small, in this PR **and** as a hotfix against upstream `main`:

- **a. The crash:** `sendSnapshot(c, p).catch((err) => console.warn(\`[world] snapshot for ${id}: ${String(err)}\`))` in
  `flush`. Verified on `main`: six more freeze cycles logged the error four times and the server stayed up; town,
  arcade and world answered normally within a minute.
- **b. The same kind, by reading:** `void conn.disconnect("deleted")` in `removePlayer` (branch `world.ts:601`, main
  `:484`) gets `.catch(() => {})`. `biome --only=noFloatingPromises server/src` finds nothing else.
- **c. A safety net:** in `server/src/main.ts`, `process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err))`,
  so the next one is a loud log line, not an outage. `uncaughtException` stays fatal (synchronous code may have
  stopped halfway): log it, then `process.exit(1)`.
- **d. A dead engine never restarts:** after `kill -9` of `rivet-engine`, Bun logs `engine process crashed while
  rivetkit was still running`, every actor stops, `/health` returns `{"ok":false}`, and the process never exits, so
  Railway (`restartPolicyType: ON_FAILURE`) never restarts it. Add a watchdog in `main.ts`: check `health()` every
  30 s and `process.exit(1)` after four failures in a row.
- **e. The arcade's cleanup loop can stop for good:** in `sweep` (`server/src/actors/arcade.ts:593`) an uncaught
  `closeTable` failure (one failed `town.refund`) throws out of the `run` loop (`:123`), which RivetKit doesn't
  restart while anyone is connected; expired tables and stuck matches are then never cleaned up. Wrap it:
  `await c.keepAwake(run(...)).catch((err) => console.warn(\`[arcade] sweep: ${String(err)}\`))`, or catch per table.
- **f. Match chat makes the tick expensive** (`server/src/actors/match.ts:184-186`): each `say` rebuilds the chat
  array through a fresh state proxy, so old lines gain one proxy layer per later line; with 50 lines one
  `plain(c.state)` takes ~14 ms and Hype Cycle calls it at least twice every 50 ms, more than half of the only JS
  thread. That starvation can itself trip the engine link. Fix: build the new array from `plain(c.state).chat ?? []`.

What to look for in Railway's logs to confirm production is hitting (a): one of `SQLite database is closed`,
`SQLite transaction coordinator is closed` or `An internal error occurred` (with `disk I/O error`), then
`at async chatOf (/app/server/src/actors/world.ts:846:22)`, `Bun v1.4.2 (Linux x64)` and a fresh
`[tokenmaxxing] v1.5.0 listening`. For (d): `engine process crashed while rivetkit was still running` with no restart
after it.

## 2. Repaint only the tiles a drop changed

`web/src/game/world.ts:280`, `showDrops` → `showMap` → `bakeGround` (`web/src/art/tiles.ts`): every `drop` and
`pickup` event makes every client in the room bake a new ground canvas for the whole room. In today's 3-company
town that's about 1 ms; in a 50-company town (83×75 tiles) it's 7–18 ms, and every furniture drop costs one frame
over 25 ms (median 26, max 35). The CPU profile put 44% of all client main-thread work in `bakeGround`.

Fix:
- In `tiles.ts`, pull the body of `bakeGround`'s loop into `paintTile(p, map, x, y)`; `bakeGround` loops over it as
  now. Add `repaintGround(canvas, map, tiles)` that clears and repaints just those tiles on an existing canvas.
- In `showDrops`, work out which furniture pieces came or went (compare the old and new drop lists by id and
  `pieceOfDrop`). When the room is the same and the ground canvas exists, repaint the tiles from `x − 1` to `x + w`
  and `y − 1` to `y + 1` around each changed piece (`groundAt`, `rug` and `wall` only look at direct neighbours, so
  that's enough), then file the patched canvas under the new map in `grounds`. A room change or a snapshot still
  bakes the whole ground.
- Parcels (wearables, pets) change no ground: no repaint at all.

## 3. Don't rebuild the map when only parcels change

`core/src/world.ts:87`, `setDrops` throws away the room's cached overlay on every call, so a dropped hat rebuilds
the map (and, on the client, misses the `grounds` cache) although no furniture moved. The `ponytail:` comment there
already names this.

Fix: keep a key of the room's furniture drops (their `ch`, `x`, `y`) next to the cached map; `setDrops` only drops
the cache when the key changes. `mapOf` then returns the same `GameMap` object for a parcel-only change, and the
client's `grounds` lookup hits.

## Tests

- **1a:** an in-process `world` test (like the restart test's fake context) whose `db.execute` rejects on the chat
  query: run a tick that sends a snapshot and assert the test run sees no unhandled rejection (Bun's test runner
  fails on one), and the warning is logged. Check it fails without the `.catch`.
- **1e:** an arcade test where `town.refund` fails once during `sweep`, and the next sweep still runs.
- **1f:** a match test that says 50 lines and checks `plain(c.state)` stays flat (no growing proxy depth), or time it.
- **1d:** none automated; verify by killing the engine on a local server and watching the process exit within ~2 min.
- **Hotfix:** rerun `/tmp/crash/_crash-snapshot.ts` with `freeze.sh` against the hotfix branch: no exit.
- **2:** none automated (canvas). Rerun the load test's browser measurement in a 50-company town with drop churn
  (`/tmp/perf/browser.ts`, `scenC.sh`): frames over 25 ms should go from 74 in 50 s to about 0, with the ground still
  correct after drops and pickups next to rugs, walls and doors (screenshot).
- **3:** a core test: `setDrops` with a parcel added returns the same map object from `mapOf`; with a piece of
  furniture added, a new one.

## Done when

`bun run typecheck`, `bun run lint`, `bun run test` pass; the browser measurement above is in the report; one commit
on `feat/progression`, plus item 1 (a–f) on its own branch from `origin/main` for a hotfix PR to upstream; no
attribution lines.
