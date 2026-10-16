# Offices furnished by dropping

A change to `specs/offices.md` and `specs/inventory.md` as built. The office editor goes. Your office's
furniture is what you have dropped in it, and only you can pick anything up from your own floor. One
system instead of two: no `placed` flag, no office JSON, no Save.

Decided:
- **No editor.** Furnishing is dropping from the Bag while standing in your office. Rearranging is
  taking a piece (G, or a right-click) and dropping it again where you want it.
- **Only the owner takes anything on their office floor.** Already the rule; it now covers furniture too.
  A visitor may drop something in your office (a gift) and can't take it back; you can.

## Rules

- **Where a drop lands.** Furniture lands on the tile you face if it's free floor, otherwise the nearest
  free floor tile (as `placeDrop` does today). Parcels land at your feet. That's how you put a desk
  where you want it: stand next to the spot, face it, drop.
- **Your own drops in your own office are furniture, not loot.** They never expire, and they don't count
  toward your five live drops elsewhere. An office holds at most `OFFICE_PIECES` (40) drops; that replaces
  the 30-per-room cap there. A visitor's drop in your office still goes back to them after an hour unless
  you take it.
- **The starter desk and chair** arrive at level 10 as two items dropped in your office at the
  `STARTER_OFFICE` tiles, free, once. (Today they're placed rows made on first touch.)
- **Open or closed** stays. Its toggle moves from the editor to the Menu while you're in your own office:
  `🔓 Open to visitors` / `🔒 Closed`.
- **Trading furniture** means picking it up first: what's on your floor isn't in your bag.
- **The first-visit hint** becomes "Drop furniture from your Bag to furnish your office." Pressing E on
  a wall in your office does nothing special any more.

## Data

Drops become the town's to remember, not only the world's: furniture is long-lived now, and the world's
state is a cache that must rebuild from `seed`.

- `items` gains `room TEXT, x INTEGER, y INTEGER`, set while a row is on a floor (`owner_id IS NULL`), null
  otherwise. `placed` and `offices.furniture` stop being used (leave the columns; note it in the schema
  comment).
- **Migration**, in `migrate`, idempotent: for every `offices` row with furniture JSON, for each piece in
  it, take one `items` row of that user with `item = 'furn.<ch>' AND placed = 1`, set
  `owner_id = NULL, dropped_by = user, dropped_at = updated_at, room = 'office:<user>', x, y` from the
  piece, `placed = 0`. Then clear that office's `furniture` to `'[]'` so it never runs again for it. Rows
  with `placed = 1` left over (more rows than pieces) become bag rows (`placed = 0`).
- `seed` returns every row on a floor (`owner_id IS NULL AND room IS NOT NULL`) as `Drop`s; the world
  rebuilds `drops` and `DROPS` from it on start and no longer persists drops in its own state.

## Server

`server/src/town/coins.ts`:

- `takeOut(sql, userId, item, now)`: the live-drop count excludes rows with `room = 'office:' || userId`.
- `placed(sql, id, drop)`: after the world has placed it, write `room, x, y` on the row. `pickUp` clears
  them. `giveBack` clears them. `unclaimed(before)` excludes rows where `room = 'office:' || dropped_by`.
- `starterOffice` becomes `starterDrops(sql, userId, now)`: two rows, `furn.d` and `furn.c`, already on the
  floor at the `STARTER_OFFICE` tiles in `office:<userId>`, created once per user (keep the `offices` row
  as the "done" marker: insert it with `furniture = '[]'`). Called from `grantRewards` at level 10 as now.
  The town then tells the world `placeDrops` for them.
- `furnish`, `bag().placed`, the `placed = 0` filters in `ownedItems`/`takeOut`: gone. `offices()`/`officeOf()`
  return `{ open }` only.

`server/src/actors/town.ts`:

- `drop(itemKind)` stays; after `world.placeDrop` answers with the tile, call `placed(...)`. The cap check in
  the world uses `OFFICE_PIECES` for an office room and 30 elsewhere (the world knows the room; pass
  nothing new).
- `setOffice` and the `office(targetId)` action go (the review's item 6 wanted `office()` for the caller;
  now nothing needs it: the open flag is on `Profile.office` and in the snapshot's `doors`). `setOfficeOpen`
  stays, without `starterOffice`.
- `seed` includes the floor rows. `adminDeleteUser`, `closeCompany`: unchanged in meaning; drops in a
  deleted owner's office are now deleted with the owner (they're theirs), visitors' drops there go back.

`server/src/actors/world.ts`:

- `placeDrop` takes the facing rule: furniture to the faced tile when it's free floor, else the nearest
  free floor tile; the office cap. Internal `placeDrops(drops)` for seeding the starter pieces and for
  `seed`. `drops` in state becomes a cache filled from `seed` on start (drop it from persisted state).
- `setOffice(userId, furniture, open)` becomes `setOfficeOpen(userId, open)`; the office map is the
  template plus its drops, through `mapOf` as today, so `OFFICES`/`officeMap` in core go and `DROPS` does
  all of it.
- `take` and the office-floor rule: unchanged.

## Client

- Delete `web/src/hud/OfficePanel.tsx`, the `office` panel kind, the Menu's "Furnish your office" entry and
  the E-on-a-wall branch in `interact()`. Add the open/closed toggle to the Menu while `room ===
  office:${selfId}` (one button calling `town.setOfficeOpen`, reading the current state from
  `world.doors`/the snapshot's office owner, or a tiny `town.office()` if nothing else carries it: prefer
  carrying `open` in the snapshot's `owner` field).
- `Bag.tsx`: no "placed" counts; the Drop button's notice is enough. In your own office the button can read
  "Drop here" to hint that it furnishes.
- `Snapshot.furniture` goes; `Snapshot.owner` gains `open: boolean`. `game/world.ts` stops calling
  `setOffice`.
- The first-visit hint text.

## Tests

- `server/test/ledger.test.ts`: the migration turns an office JSON into floor rows at the right tiles and
  runs once; `takeOut` ignores own-office drops for the cap; `unclaimed` ignores own-office drops;
  `starterDrops` once per user.
- `server/test/town.test.ts` / `world.test.ts`: level 10 puts a desk and chair on your office floor; dropping
  a desk while facing a free tile lands it there; the 41st drop in an office is refused; a visitor's drop
  in your office can't be taken by them, can by you, and is swept back to them after an hour (drive the
  sweep query directly); your own office drops aren't swept; after a world restart (`seed`), the office
  still has its furniture and a drop in the Inn is still there.
- Remove the editor's and `furnish`'s tests.

## Difficulty

M, mostly deletion. The new parts are the three columns and the migration, `placed()` after the world
answers, the facing rule, and `seed` carrying drops. Net lines: fewer than today.

## Open questions

- None. The Inn's and buildings' 30-drop cap and the hour's expiry there are unchanged.

## As built

- `officeMap` stays, as `withPieces(pieces, base)`: `mapOf` writes a room's dropped furniture with it, and
  the Shop draws a piece with it. `parseOffice`, `OFFICES` and `setOffice` are gone.
- The world's only copy of the floors is `DROPS`. `onWake` asks `seed` every start: the floors and the
  offices' open flags each time, everyone and every company only the first time.
- The facing rule is `findSpot` searched from the faced tile, so "the nearest free tile" is the nearest to
  that one. A TV, centred like a game table, covers the faced tile and the one to its left.
- `placed(sql, drop)` takes the drop (it has the id); `floors(sql)` is `seed`'s query. `grantRewards`
  returns the desk and chair, and `report` tells `world.placeDrops` after its transaction.
- `takeOut` doesn't know the room yet: with five out elsewhere, you can't furnish either until one comes
  back (`ponytail:`).
- `setOfficeOpen` changes nothing for someone with no `offices` row: making one would mark their desk and
  chair as given.
- Rows on a floor from before `room` existed aren't in `seed`, so they're off the world's floors; the
  sweeper sends them home within the hour. The migration logs
  `[town] N offices: M pieces onto their floors, K into the bag`.
- The restart test runs `town.seed` and `world.onWake` in the test process on an in-memory database: the
  test server's world can't be restarted.
- In your own office the Bag's button reads "Drop here".
