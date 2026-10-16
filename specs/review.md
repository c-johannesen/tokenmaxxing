# Review: levels, offices, quests, badges and trading

A review of `feat/progression` (the five feature branches merged, `git diff feat/level-xp-bar..feat/progression`)
against `specs/level-rewards.md`, `offices.md`, `quests.md`, `badges.md` and `trading.md`. Everything below
is a change to make on that branch. Typecheck, lint and 394 of 395 tests pass before any of it; the one
failure is environmental (item 9).

Order: 1 to 5 are the real findings; 6 to 9 are cleanups and test hygiene. Each is small. Keep the diff
small and the comment voice the codebase has.

## 1. The level-10 toast promises an office to people who can't have one

`web/src/hud/Hud.tsx`, `LevelToast`: `reward.level === 10 ? " and your own office" : ""` says it to
everyone, but an office needs a company (`specs/offices.md`, `Profile.office` in `boards.ts`).

Fix: read `hud.me?.company` (`useHud((s) => s.me?.company)`) and only add the office line when it's set.
Without a company say ` · Join a company for your own office`, so the unlock is still announced.

## 2. A deleted account's office lingers in the world

`server/src/actors/world.ts`, `removePlayer`: `town` drops the `offices` row on delete (`admin.ts`), but
the world keeps `c.state.offices[userId]` and the baked map in `OFFICES` (core `maps.ts`). Ids are never
reused, so it's only a leak, but it's a two-line one.

Fix: in `removePlayer`, `delete c.state.offices?.[userId]` and `OFFICES.delete(userId)` (export it is
already). Anyone standing in that office stays until they leave; the exit still works.

## 3. `setLook` runs the whole wallet to check ownership

`server/src/actors/town.ts`, `setLook`: `(await wallet(c.db, userId, Date.now())).owned` now costs the
wallet's seven queries (days, activity, podiums over every user, purchases, ledger, lifetime, quests) for
one `Set` of ids. Before the level items it was one query.

Fix: a helper in `server/src/town/coins.ts`,

```ts
/** Shop item ids `userId` owns: bought, and earned by level. */
export async function ownedIds(sql: Sql, userId: number): Promise<string[]>
```

doing `ownedItems` plus `levelItems(await levelOf(sql, userId))` (`levelOf` is in `users.ts` now), used by
both `wallet()` (for `owned`) and `setLook`. Two queries. Leave `checkTrade` on `ownedItems`: level items
can't move anyway (`isTradeable`).

## 4. `core/src/shop.ts` and `core/src/maps.ts` import each other

`maps.ts` imports `pieceOf` and `Placed` from `shop.ts` for `officeMap`; `shop.ts` imports `MAPS` from
`maps.ts` for `parseOffice`; `world.ts` imports both. It works because each only uses the other inside a
function, which is the kind of thing that breaks silently in a later refactor. `maps.ts` is documented as
the one place tiles are defined, with no imports.

Fix: a new `core/src/office.ts` holding everything office-shaped: `Piece`, `FURNITURE`, `pieceOf`,
`Placed`, `STARTER_OFFICE`, `OFFICE_PIECES`, `OFFICE_LEVEL`, `officeCost`, `parseOffice`, and also
`officeMap`, `OFFICES` and `setOffice` from `maps.ts` (they only need `GameMap` and `MAPS.office`). Then
`office.ts` imports `maps.ts`, `maps.ts` imports nothing again, `shop.ts` is coins and items again, and
`world.ts`, the actors, the HUD and the tests import from `office.ts`. The office template itself stays in
`MAPS`. No behaviour change; `core/test/shop.test.ts`'s office tests move to `core/test/office.test.ts`.

## 5. Trading fetches a whole profile for a name and a list

`web/src/hud/Trades.tsx`, `TradePanel`: `town.profile(userId, "today")` to get `them.name` and
`them.owned`. `profile()` now also runs the badge queries and the podium ranking over every user.

Fix: `town.office(userId)` already exists as a cheap per-player call; add `owned: string[]` (tradeable
ids) and `name` to the `office` action's result and rename it to `peek` … no: keep it simpler. Add a tiny
action in `town.ts`:

```ts
/** What `userId` could trade away, for the trade panel. */
tradeables: async (c, targetId: unknown): Promise<{ name: string; owned: string[] }>
```

(`requireUser`, `userById`, `ownedItems(...).filter(isTradeable)`), use it in `TradePanel`, and drop
`Profile.owned` and its `isTradeable` import from `boards.ts` since nothing else reads it. Update the
`town.test.ts` trade test if it asserted on `profile().owned` (it doesn't today).

## 6. Shop reading order

`web/src/hud/Shop.tsx`: the quest list sits between the balance line and the paragraph that explains how
coins are earned. Move the `📜 Today's quests` heading and list below that paragraph, so the page reads
balance, how you earn, today's quests, then the tabs. No other change.

## 7. The office editor's tool row and the door

`web/src/hud/OfficePanel.tsx`: twelve `Pills` (eleven pieces and ✕ Remove) in one row will overflow a
modal that isn't wide. Add `flex-wrap: wrap` for `.pills` inside the office panel the way
`.trade-sides .pills` does in `hud.css`, with a class on the panel (`office-tools`) rather than a global
change.

`web/src/art/tiles.ts` draws the `R` door with the exit's ground art. That's fine, but nothing says what it
is until you step in: give `LEGEND.R` a label the way houses have signs, or at least make `interact()` on a
wall in your own office show "Press E on a wall to furnish your office" the first time (`dialog`). Pick the
cheaper one: the dialog hint. Nobody can face the door (a step goes through it), which is why the editor
opens from walls; say so in a one-line comment in `OfficePanel.tsx` too.

## 8. Specs that drifted from what shipped

Update the three spec files so they describe the code, in their "Deliberate limits" or a short "As built"
line at the end; no rewriting:

- `specs/offices.md`: the editor opens with E facing a wall (or the menu) rather than the door; one ledger
  row per save, not per piece; a never-saved office reads as `STARTER_OFFICE` from `mapOf` on both sides;
  `deleteUser` ignores `furniture` refs in its unsettled-game check.
- `specs/trading.md`: `acceptTrade(fromId, at)` takes the offer's `at` so a swapped offer isn't accepted
  unseen; `settleTrade` deletes the offer inside its transaction; `deleteUser` ignores `trade` refs; arcade
  toasts carry no `open`; both panels live in `Trades.tsx`.
- `specs/level-rewards.md`: the office line in the toast is gated on having a company (item 1).

## 9. Two pre-existing test failures on macOS

Not from these branches, but they make `bun test` red on a Mac, which hides real failures:

- `core/test/codex.test.ts` (`listCodexFiles`, three cases): `tmpdir()` is `/var/…` and macOS resolves
  it to `/private/var/…`. Resolve the temp home with `realpathSync` where the test builds `home`, so the
  expected and actual paths match on every OS.
- `server/test/security.test.ts`, "the page files aren't served without those headers": `/index.html`
  is a 200 whenever `site/dist` exists (the marketing site's own index, served by the static handler in
  `main.ts`). The test means the *game's* page file. Assert `/admin.html` is not 200, and for
  `/index.html` assert that it is either not 200 or carries no game script: fetch it and
  `expect(body).not.toContain("/play")`-style, whichever is cheapest and still fails if `main.ts` ever
  serves the game bundle at its own path.

## Done when

- `bun run typecheck`, `bun run lint`, and `bun test` all pass on a Mac with `site/dist` present.
- Items 1 to 5 each have the test the spec asked for, or the existing test adjusted: a `LevelToast` has
  no test (React), so item 1 needs none; item 2 is one `world.test.ts` assertion after
  `adminDeleteUser`; item 3 is covered by the existing level-items test; item 4 by the moved tests;
  item 5 by the trade panel's existing server test plus one for `tradeables`.
- One commit on `feat/progression`, no attribution lines.
