# Review 2: inventory, drops, doors and the rest of the branch

A second review of `feat/progression` (`git diff feat/level-xp-bar..feat/progression`), against
`ARCHITECTURE.md` and the specs, with `specs/review.md` and `specs/ui-fixes.md` taken as applied (none of
those regressed). Typecheck and lint are clean, and the core, ledger, world and town tests pass (277).
Auth checks hold on every new action, and the item handoffs (buy, trade, furnish, drop, take, sweep,
delete, close) neither lose nor duplicate a row under the races I traced. What's below is what's left.

Order: 1 to 5 are bugs, by severity; 6 and 7 are cleanups. Items 1 and 4 were reproduced with throwaway
tests against the real code; the rest are from reading each path end to end.

## 1. Waking up puts you back in an office that closed (and `back` doesn't check at all)

`server/src/actors/world.ts:803`, `wake`: `canGo` checks only that a remembered *house* is still yours.
An office room has no company, so `back` into any `office:<id>` always passes. `back` (`:447`, after a
game) checks nothing.

Scenario (reproduced): bo visits ada's open office and closes the tab; `rest` remembers the office. ada
closes it. bo opens the game: `join` → `wake` puts bo back in ada's closed office, with its chat history.
Through `back`: someone who leaves their company during a game is put back in that company's building
after it, and stepping into an office door there throws, since `portal` does `doorAt(doors, …)!` on an
empty door list (`core/src/world.ts:422`).

Fix: pull `wake`'s check into one helper and add offices to it:

```ts
/** Whether `p` may go back to `to`: not a house they've left, not someone's closed office. */
const canReturn = (s: WorldState, p: WorldPlayer, to: Place) => {
  const house = companyOfRoom(to.room);
  const owner = ownerOfOffice(to.room);
  return (house === null || house === p.companyId) && (owner === null || owner === p.id || officeOf(s, owner).open);
};
```

`wake` uses it in place of `canGo`; `back` does `if (!canReturn(...)) { p.back = null; p.state = "idle"; return correction(p); }`
(they stay where the game left them). In `portal`, return `{ notice: "That door isn't yours to open." }` when
`doorAt` finds nothing, rather than `!`.

## 2. The new writes that fan out to a whole room have no rate limit

`server/src/actors/town.ts:590` `setOffice`, `:605` `setOfficeOpen`, `:455` `drop`. Each one ends in
work for everyone in a room:

- `setOfficeOpen` → `world.setOffice` (`world.ts:620`): every flip resends the full snapshot (with a chat
  query each) to everyone in the owner's office *and* the whole company building, and each client rebuilds
  the map and bakes the ground again.
- `setOffice` resends the snapshot to everyone in the office.
- `drop`, then `take` it back, in a loop: each `drop`/`pickup` event makes every client in the room
  `setDrops` and `showMap` (`web/src/game/world.ts:282`), which bakes the ground again for any furniture
  (the town's ground is the biggest one).

Scenario: a script toggles `setOfficeOpen(true/false)` at the gateway's 1,200 a minute; everyone in that
building gets 20 snapshots a second. A drop/take loop with a rug in the town square does the same to
everyone in town. The only bound today is the per-IP gateway limit. (`rename` now rebuilds the building
too, through the door's name, and has no limit either.)

Fix: two `RateLimiter`s in `town`'s `createVars`, keyed by user id, `rate_limited` like the others:
`offices: new RateLimiter(30, 60_000)` taken in `setOffice` and `setOfficeOpen`, and
`drops: new RateLimiter(30, 60_000)` taken in `drop` (a take needs a drop, so that bounds both). Optionally
the same for `rename` (10 an hour).

## 3. `drop` holds the town's write lock across a call to `world`

`server/src/actors/town.ts:458`: everything from `takeOut` to `unwear` runs inside `c.vars.serial`,
including `await world.placeDrop(...)`. Every other coin and item write in the town waits on that chain:
`report` from every syncing app, `buy`, the arcade's `hold`/`pay`/`refund`, `acceptTrade`, `setOffice`.

Scenario: the world is slow or restarting (a deploy, a long tick). A drop waits up to RivetKit's 60 s
action timeout; every sync and every game settlement queues behind it, and a second drop queues another
60 s.

Fix: two short serial sections around an unlocked call:

```ts
const id = await c.vars.serial(() => takeOut(c.db, userId, itemId, Date.now()));
const put = await main(client).world.placeDrop({ id, item: itemId as string, by: userId }).catch(...);
const out = await c.vars.serial(async () => {
  if ("notice" in put) { await giveBack(c.db, [id]); return put; }
  await unwear(c.db, userId, [put.item]);
  return { notice: `Dropped the ${dropName(put)}.`, drop: put };
});
```

It's safe in between: the row is on the floor (`owner_id` NULL) with a fresh `dropped_at`, so the sweeper
leaves it; if it landed and someone takes it first, `giveBack` only touches rows still on the floor and
does nothing. The `ponytail:` comment about a timed-out drop stays.

## 4. The backfill runs again whenever `items` is empty, and mints the old purchases

`server/src/town/schema.ts:79`: the guard is "`items` has no rows", not "`items` is new". `items` can
empty out again (deleting an account deletes its rows; `giveBack` deletes a deleted dropper's), and the
next `migrate` copies every `purchases` row, and every saved office's pieces, into bags once more.

Scenario (reproduced in memory): ada bought a Duck before the deploy; the backfill gives her the row. She
trades it to bo, and bo is deleted, so `items` is empty. On the next restart ada has a Duck again. It
needs every item in town to be gone, so it's unlikely in production and likely on a dev or staging
database; either way it breaks "items are never duplicated".

Fix: decide before creating the table:

```ts
const fresh = (await sql.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'items'")).length === 0;
// CREATE TABLE IF NOT EXISTS items … as now
if (fresh) { /* the two INSERTs and the log line, as now */ }
```

`server/test/ledger.test.ts`, "the backfill turns purchases and office pieces into rows, once": `migrate`
already ran in `beforeEach`, so start with `DROP TABLE items`, then the inserts and `migrate` twice as
now, and add: delete every `items` row, `migrate` again, and the bag stays empty.

## 5. Two TVs side by side draw as one

`web/src/art/objects.ts:325`: a `t` draws only when the tile to its left isn't `t`. Two TVs in a row are
`tttt`, so the second one's first tile sees a `t` on its left and draws nothing: it's invisible, and it
still blocks.

Scenario: two TVs next to each other in an office (the editor allows it); or a dropped TV landing on the
rug right of the company building's own TV (`W__==tt==…`, `core/src/maps.ts:310`), which `findSpot` picks
because rugs are walkable.

Fix: draw on every other tile of a run:

```ts
case "t": {
  let n = 0;
  while (map.at(x - n - 1, y) === "t") n++;
  return n % 2 === 0 ? at(tv()) : null;
}
```

## 6. `town.office` takes anyone's id and returns fields nobody reads

`server/src/actors/town.ts:582`: `office(targetId)` returns `level` and `companyId` too (a `levelOf` sum
and a user lookup per call). The only callers are `OfficePanel` (`web/src/hud/OfficePanel.tsx:21`, with
`world.selfId`) and one test, both reading `furniture` and `open` for themselves. It also hands any
signed-in caller a closed office's layout.

Fix: `office: (c): Promise<Office> => officeOf(c.db, requireUser(c.conn.state))`; `town.office()` in
`OfficePanel` and in `server/test/town.test.ts:424`.

## 7. Specs and comments that drifted

A line each, no rewriting:

- `specs/quests.md`: line 3 ("Four small goals, the same four"), line 16 ("At most 14 coins"), the Data and
  Server sections (`prs` in `DayFacts`, `EMPTY_DAY` and the query), line 53 ("four rows") and the Tests
  (`questCoins` of a full day is 14, `done: false` ×4, `tokens` after a 500M day). The code is two quests
  and 7 coins (`core/src/quests.ts`).
- `specs/level-rewards.md:150`: "`setLook` checks `ownedIds`". It's `ownedItems` now (the `items` table,
  one query); `ownedIds` is gone.
- `ARCHITECTURE.md:189`: "`world` asks `town` only to put a taken drop in the bag": it also asks for
  `seed` when it starts from nothing.
- `specs/inventory.md:251`: the reason for reading furniture through `FURNITURE` ("before PR 1 adds those
  ids to `ITEMS`") is gone. `dropName` (`core/src/world.ts:109`) can be `itemById(d.item)?.name ?? "Something"`;
  `pieceOfDrop` stays for `ch` and `w`.
- `specs/offices.md` and `specs/trading.md`: their Rules still say placing costs coins (`officeCost`,
  ledger kind `furniture`, "one ledger row per save") and that items move through `purchases` with a
  `−price` ledger row. Add one As built line to each: superseded by `specs/inventory.md` (furniture from
  the bag, placing free; trades move `items` rows, no ledger row for items).

## Done when

- `bun run typecheck`, `bun run lint` and `bun run test` pass.
- Item 1: a `world.test.ts` case: a guest visits an open office, disposes the connection, the owner closes
  it, the guest joins again and its snapshot's room isn't the office. A `core/test/world.test.ts` line:
  `portal` through an `R` with no matching door returns a notice.
- Item 2: a `town.test.ts` case: the 31st `setOfficeOpen` in a minute rejects `rate_limited` (`drop`
  shares the code).
- Item 3: the existing drop tests (town and world) pass unchanged.
- Item 4: the ledger backfill test adjusted as above.
- Items 5 to 7 need no tests (a sprite, an action's signature with its one test updated, docs).
- One commit on `feat/progression`, no attribution lines.
