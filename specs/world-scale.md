# The world past 250 players (a separate PR)

From the load test of `feat/progression` (`/tmp/perf/`, runs `ramp-pr` and `ramp-main`). Not in this PR: the cause
is on `main` too, and the fix touches how the world actor keeps its state.

## What happens

Between 200 and 300 connected players everything stalls: `step` goes from 2 ms to 1.7–2.3 s, wallet calls to
2–3 s, joins to 2–14 s. CPU falls at the same time, so it's waiting, not working. The cause: `c.state.players` in
`server/src/actors/world.ts` holds every player ever, and each step dirties it (`x`, `y`, `facing`,
`lastInputAt`). RivetKit saves dirty state once a second, and past about 250 connections that save is a 400–570
statement SQLite transaction taking 2.7–16 s (`slow sqlite transaction … statement_count=408`). Everything else
on the world actor queues behind it; under a join burst the bun↔engine link times out too. `main` breaks at the same
step.

## 4. Keep live positions out of saved state

Keep online players' live fields (`x`, `y`, `facing`, `state`, `lastInputAt`, `dozing`, `coffeeUntil`) in
`c.vars`, and write to `c.state` only what must survive a restart (where they rest, `back`), on disconnect, rest,
room change, or every few seconds per player at most. Check every reader of `c.state.players` (snapshots, `houses`,
`occupancy`, bots, games' `gather`/`release`, `rest`/`wake`). Expected: the save shrinks to the players whose
resting place changed.

## 5. Don't list every sleeper in a snapshot

The Inn's snapshot is 120 KB with 450 company-less players asleep in it, and town's 60–72 KB at 200: `snapshot()`
sends every player in the room, online or not. Send offline sleepers in a room as a count (and the few in view), or
cap the list; the client draws a "+N asleep" instead of every bed.

## Done when

`/tmp/perf/ramp.sh` (100 more walkers a minute up to 500) keeps walker `step` p95 under 50 ms at 500 connected,
with no `slow sqlite transaction` warnings for the world; the Inn snapshot at 450 sleepers is under 20 KB; the
suite passes. Its own branch and PR.
