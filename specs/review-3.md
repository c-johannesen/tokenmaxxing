# Review 3: the full PR, six angles

Six parallel reviews of `feat/progression` (PR #2), `git diff 251964b feat/progression -- . ':!specs'`: security and
auth, economy and data, concurrency and lifecycle, game rules, web client, and tests/performance/simplicity. No
critical or high findings in any area. Duplicates across reviewers are merged below; the top items were re-checked
against the code. Earlier passes (`review.md`, `review-2.md`, `ui-fixes.md`) did not regress.

Sound, per the reviewers: every new action checks its caller and every internal action refuses clients (tested over
HTTP and WebSocket); no SQL is injectable; coins are only minted from usage, podiums, quests and admin, and `wallet()`
and `balances()` agree across 200 random towns; no path loses or duplicates an item row in normal operation; the
migrations run inside RivetKit's migration transaction; every door is reachable for 1 to 50 members; level edges,
streaks across months and DST, quest and trade rules hold. Suite: 412 pass, 2 skip.

## Medium

1. **Closing your office does nothing until your first sync after the deploy.** `town.ts:600` `setOfficeOpen` is a
   bare `UPDATE`; the `offices` row only appears when `report` runs `grantRewards`. Anyone already at level 10 has a
   door and an office (the world treats no row as open) but can't close it, and the Menu shows 🔒 anyway. Related:
   `starterDrops` (`coins.ts:278`) can put the desk and chair on furniture the owner already dropped there, and a
   failed `placeDrops` in `report` (`town.ts:663`) leaves them out of the world until the next wake.
   Fix: in `setOfficeOpen`, under `serial`, run `grantRewards` for the caller's level and `world.placeDrops` its new
   pieces, then `UPDATE … RETURNING user_id` and throw `not_found` on no row. `starterDrops` puts the pieces in the
   bag when `office:<id>` already has a floor row. `.catch(warn)` the `placeDrops` in `report`. Test with `veteran()`.
2. **A withdrawn or replaced trade offer can still settle.** `coins.ts:461`: `settleTrade` deletes the offer without
   checking a row went; `withdrawTrade` and `offerTrade` aren't serialized, so they can run between `acceptTrade`'s
   read and its settle (reproduced). Fix: `DELETE … RETURNING from_id`, throw "That offer is gone." on none (rolls the
   settle back).
3. **Players put back where they can't be.** `world.ts:802` `canReturn` checks neither the tile nor the office:
   - back from a table game into a hallway that has since gone puts you outside the map, walled in, and resting
     there remembers the spot again; furniture dropped on a resting player's tile does the same;
   - you can wake inside the office of a deleted owner, or one who left their company or fell below level 10;
   - `wake` restores "sit" onto a seat that has since been taken or swept.
   Fix: `canReturn` also requires `mapOf(to.room).kind(to.x, to.y)` to be walkable or a seat, and for an office the
   same check `visit` makes (owner exists, has a company, level ≥ 10, open or yours).
4. **Map rebuilds put walls and doors under drops, and furniture can block hallways.** `withPieces`
   (`core/src/office.ts:50`) writes a piece over any tile; `buildTown` and `buildHq` move players but not drops.
   A desk on a park tile becomes a new house's door; a sofa beside a future door slot blocks it when the next member
   reaches level 10; pieces end up drawn inside walls when a hallway goes. `placeDrop` also allows furniture in the
   hallway corridors and at the passage foot (14,2), cutting off every door. Fix: `withPieces` skips tiles that aren't
   walkable in the base map; `setCompany`/`rebuildHq` lift drops whose tile is no longer free floor or is next to a
   portal and give them back (as `removeCompany` does); in a company building, furniture can't land at `y < 2` or on
   (14,2).
5. **An office owner can wall a visitor in.** Only the owner can take from their floor and their own drops never
   expire, so four desks around a visitor trap them, and reconnecting puts them back. Fix: `placeDrop` refuses a
   furniture tile that would leave anyone in the room with no `route` to the exit (`withPieces` + `route`).
6. **Ghost drops survive the world going to sleep.** `world.ts:225`: `onWake` lays `seed`'s drops over a
   module-level `DROPS` that outlived the sleep, so a ghost (a drop whose call timed out, or a take whose reply was
   lost) stays until taken. `pickUp` matches by id only, so taking a ghost can steal the same row after its owner
   dropped it again elsewhere. Fix: clear every room's drops before laying in `onWake`; `pickUp` also requires
   `room IS NULL OR room = ?` with the drop's room.
7. **An open Bag goes stale.** `Bag.tsx:21` fetches once; clicking a "bag" toast over it keeps the same component, and
   the trade sender's wallet isn't refreshed on the accepted notice (`net.ts:119`). Fix: refetch the bag when the
   wallet changes; refresh the wallet in the `notice` handler.
8. **Opening a player card went from ~1 ms to ~85 ms at 500 players.** `boards.ts:199`: badges call `podiumDays`,
   which ranks all of `usage_daily`; the comment calls it a small query. Fix: memoize the top-3 table per world day in
   town vars, used by `wallet` and `profile`; correct the comment. (`Arcade.tsx:298` fetches a whole profile for a
   name; use a lighter call.)
9. **Migration code for a schema that never shipped.** `schema.ts:49-61, 82-125` and friends: `items`, `offices`,
   `trades` and `rewards` are new in this PR, so on production the furniture backfill, the `placed` column, the
   `room`/`x`/`y` `ALTER`, `offices.furniture` and `updated_at` only ever matter for local dev data. Fix: create the
   final tables directly, keep only the purchases → items backfill, remove the rest (~60 lines and one test), and
   wipe local `.data` once. Check first that the branch hasn't been deployed anywhere.

## Low

- **Orphans from a sync during account deletion** (`report`, `pickUp`): add a user-exists check first in `report`'s
  transaction and to `pickUp`'s `UPDATE`.
- **`setLook` isn't serialized**: a drop or trade can un-wear between its check and write. Wrap both in `serial`.
- **A snapshot can carry another room's drops** (`world.ts:1033`): save `self.room` before the `await`.
- **Accepting an offer reveals the offerer's balance** (`coins.ts:448`): "can't cover 🪙 n right now" without the
  number when the giver isn't the caller.
- **`resend` builds snapshots and chat queries for offline players** (`world.ts:1127`): only online players.
- **A closed office isn't fully private**: its chat history shows to visitors after it reopens, and occupancy counts
  reveal someone is inside. Clear the office's chat when it opens; optionally leave offices out of `occupancy`.
- **A TV dropped facing right lands above you** (`world.ts:665`): shift the search by `floor(w / 2)`.
- **Every drop broadcasts `info` to the whole world** (`town.ts:490`): push only when a look changed.
- **A full wallet fetch for the 🎒 count** after each take or drop: count from the bag or add locally.
- **Client**: arrow keys cancel a right-click take but not its sit (`input.ts:66`); the minimap doesn't show dropped
  or taken furniture until the next snapshot (`Minimap.tsx:50`); the Bag and Shop say "Loading…" forever if the first
  fetch fails; Bag cells' `aria-label` drops "wearing" and "reward", focus is lost when the last of a kind is dropped,
  and the bag button reads "1 things".
- **Tests**: no actor test for the sweeper or `world.removeDrops`; the `setOfficeOpen` test can't fail (level-0 user
  with no row); walking tests sleep 140 ms a step where 105 ms is enough; a `Bun.sleep(300)` race in `world.test.ts:307`.
- **Docs and dead code**: "parcel" survives in comments and `ARCHITECTURE.md` after the sprite went; two comments
  still describe the old ledger; `ownedItems` and `bag` are the same query; a few exports are file-local.

## Done when

`bun run typecheck`, `bun run lint`, `bun run test` pass; items 1 to 6 each have a test that fails without the fix;
one commit, no attribution lines.
