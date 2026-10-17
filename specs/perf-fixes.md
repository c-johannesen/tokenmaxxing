# Load-test fixes for this PR

From the load test of `feat/progression` (numbers and scripts in `/tmp/perf/`): drops cost almost nothing on the
server, the client re-bakes the whole ground on every drop and pickup, and an uncaught promise in the world's tick
turns any database stall into a crashed server. Three fixes here; the 250-player ceiling is
`specs/world-scale.md`, a separate PR.

## 1. An error in the tick's snapshot must not kill the server

`server/src/actors/world.ts:1235`, in `flush` (the 10 Hz tick): `if (online.has(id)) void sendSnapshot(c, p);`.
`sendSnapshot` awaits `chatOf`, a SQLite query. When the world's database is closed or stalls (an actor stopping or
restarting, overload, a slow disk), the query rejects, nothing catches it, and Bun exits the whole process: every
player is disconnected and Railway restarts the server. The load test hit it twice (`/tmp/perf/server-crash-1.log`
and `server-crash-2-sleep.log`, same stack: `chatOf` ← `snapshot` ← `sendSnapshot`). Upstream `main` has the same
line (897), and production runs `main`. Games move players to and from their tables, which is a room change, which
is what sends these snapshots: this is the leading suspect for the production crashes.

Fix:
- `void sendSnapshot(c, p).catch((err) => console.warn(\`[world] snapshot for ${p.id}: ${String(err)}\`));`
- Every other fire-and-forget promise the crash investigation lists gets the same treatment (its report decides the
  list; this item is final once that report is in).
- A process-level `unhandledRejection` handler in `server/src/main.ts` that logs with the stack and keeps running,
  so the next one is a log line, not an outage. `uncaughtException` stays fatal (state may be corrupt after a
  synchronous throw); log it before exiting.
- **Also as a hotfix against upstream `main`**: the one-line `.catch` and the handler, on their own small branch from
  `origin/main`, so production stops crashing without waiting for this PR.

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

- **1:** an in-process `world` test (like the restart test's fake context) whose `db.execute` rejects on the chat
  query: run a tick that sends a snapshot and assert the test run sees no unhandled rejection (Bun's test runner
  fails on one), and the warning is logged. Check it fails without the `.catch`.
- **2:** none automated (canvas). Rerun the load test's browser measurement in a 50-company town with drop churn
  (`/tmp/perf/browser.ts`, `scenC.sh`): frames over 25 ms should go from 74 in 50 s to about 0, with the ground still
  correct after drops and pickups next to rugs, walls and doors (screenshot).
- **3:** a core test: `setDrops` with a parcel added returns the same map object from `mapOf`; with a piece of
  furniture added, a new one.

## Done when

`bun run typecheck`, `bun run lint`, `bun run test` pass; the browser measurement above is in the report; one commit
on `feat/progression`, plus the separate hotfix branch for item 1, no attribution lines.
