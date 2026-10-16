# Offices

From level 10, every company member gets an office of their own behind a door in the company building,
starting with a desk and a chair, and furnishes it with coins. Anyone can visit from your player card.
This is the biggest coin sink in the game, and the most personal thing a player owns.

## Rules

- **Unlock:** `OFFICE_LEVEL = 10` (10B lifetime tokens, `specs/level-rewards.md`). Below it the door says
  `🔒 Your own office opens at level 10.`
- **The door** is a new tile `R` ("office door", `portal: true`) on the back wall of the `hq` map
  (`core/src/maps.ts:298`). Everyone in the building sees the same door; stepping in takes *you* to
  `office:<yourId>`. The Inn has no door: an office is part of being in a company.
- **No company, no office.** Your furniture stays saved; it's there again in the next building you join.
  Visiting someone needs them to be in a company for the same reason.
- **The office** is one fixed layout (`MAPS.office`, 12×9: walls, floor `_`, exit `x` in the bottom wall)
  plus the owner's furniture written over the floor. A new office holds `STARTER_OFFICE`: a desk with a
  chair in front of it. They're ordinary pieces: move them, throw them out, buy more.
- **The exit** puts you on the tile below the `R` door in your *own* company building, whether you were
  visiting or at home; a visitor with no company lands at the Inn's entry.
- **Furniture is the existing legend.** No new art: `=` rug, `p` plant, `L` lamp, `c` chair, `k` shelf, `d`
  desk, `B` bench, `o` coffee machine, `b` bed, `s` sofa, `t` TV (2 tiles wide). Seats seat, the coffee
  machine pours, sofas join up: all of it already works per tile (`sit`, `drink`, `objectAt`).
- **Placing costs coins; moving is free; removing refunds nothing.** The office's furniture list is the
  truth. Saving a new list charges the price of every piece the new list has *more of* than the old one,
  per character. At most `OFFICE_PIECES = 40`.
- **Open or closed.** An office is open by default: anyone can visit it from your player card. Close it and
  only you get in, through the door. Toggle it in the office panel; the owner can always enter either way.
- **Visiting:** anyone, from the player card, while the office is open. Resting (`rest`: bed and desk while
  offline) stays in the company building's shared floor; the office is for being awake in.

| Piece | Char | Coins |
|---|---|---|
| Rug | `=` | 10 |
| Plant | `p` | 20 |
| Lamp | `L` | 25 |
| Chair | `c` | 30 |
| Shelf | `k` | 40 |
| Bench | `B` | 40 |
| Desk | `d` | 50 |
| Coffee machine | `o` | 60 |
| Bed | `b` | 80 |
| Sofa | `s` | 100 |
| TV | `t` (`w: 2`) | 120 |

## Data

`core/src/shop.ts`:

```ts
export interface Piece { ch: string; name: string; price: number; /** Tiles wide; 1 unless set. */ w?: number }
export const FURNITURE: readonly Piece[] = [...];
export const OFFICE_PIECES = 40;
export const OFFICE_LEVEL = 10;
/** One placed piece: its top-left tile. */
export interface Placed { ch: string; x: number; y: number }
/** What a new office holds: a desk with a chair in front of it. */
export const STARTER_OFFICE: readonly Placed[];
/** Coins to go from `before` to `after`: the price of each piece there's more of. */
export function officeCost(before: Placed[], after: Placed[]): number;
/** Null unless every piece is a known char on a floor tile, nothing overlaps, and it's under OFFICE_PIECES. */
export function parseOffice(raw: unknown): Placed[] | null;
```

`core/src/maps.ts`:

- `LEGEND.R = { name: "office door", portal: true, text: "Your office." }`; `MapId` gains `"office"`;
  `MAPS.office` is the template; `R` goes in the `hq` rows.
- `officeMap(furniture: Placed[]): GameMap` writes the chars over the template (TV writes `tt`).
- `OFFICES = new Map<number, GameMap>()` and `setOffice(userId, furniture)`: the `setTown` pattern
  (`maps.ts:287`); one process holds the offices it has seen.

`core/src/world.ts`:

- `RoomId` gains `` `office:${number}` ``; `mapOf` returns `OFFICES.get(id) ?? MAPS.office` for it;
  `ownerOfOffice(room): number | null`.
- `portal(room, door, companyId, plots, userId)`: `R` → `roomEntry(`office:${userId}`)`; `x` in an `office:` →
  the tile below `R` in `hq:<companyId>`, or `roomEntry("inn")` with no company. The level gate is the
  actor's (it knows levels).
- `Snapshot` gains `furniture: Placed[] | null` (set in an `office:`) and `owner: { id; name } | null` for the
  banner ("ada's office").
- `Profile` (`server/src/town/boards.ts:70`) gains `office: "open" | "closed" | null` (null without one: under
  level 10 or no company), so the card knows whether to offer a visit.

`server/src/town/schema.ts`:
`offices (user_id INTEGER PRIMARY KEY, furniture TEXT NOT NULL, open INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)`.
No row means `STARTER_OFFICE`, open. The coins go in the `ledger` as kind `furniture`, ref `office:<userId>`,
negative amounts; the ref only ever sums to zero or less, as the table's comment requires. `wallet()`
already adds `ledgerSum`, so nothing else changes for balances.

## Server

`server/src/actors/town.ts`:

- `office(userId)`: anyone signed in; `{ furniture, open, level, companyId }`.
- `setOfficeOpen(raw)`: `requireUser`; a boolean; upsert the row (`INSERT … ON CONFLICT(user_id) DO UPDATE SET open`,
  with `STARTER_OFFICE` as the furniture when there was no row); then `world.setOffice(userId, furniture, open)`.
- `setOffice(raw)`: `requireUser`; level ≥ `OFFICE_LEVEL` (from `tokensIn`) or `UserError("too_low")`;
  in a company or `no_company`; `parseOffice` or `invalid_office`; under `serial`: read the old list (or
  the starter), `officeCost`, check the wallet balance (`too_poor`), one ledger `INSERT` per paid piece,
  `INSERT OR REPLACE INTO offices`. Then `world.setOffice(userId, furniture)` and return the wallet.
- `seed` returns every office so `world` can rebuild `OFFICES` from nothing.
- `deleteUser` (`server/src/town/admin.ts:227`) drops the `offices` row. Its ledger rows stay, like a game's.

`server/src/actors/world.ts`:

- State: `offices: Record<number, { furniture: Placed[]; open: boolean }>`; `setOffice(userId, furniture, open)`
  (internal) updates it, calls `setOffice` from maps, and resends the snapshot to everyone in
  `office:<userId>` (the "changed room" path at `:867`). Closing doesn't throw visitors out; they leave
  when they leave.
- `step` (`:241`): before `portal`, if the target is `R` and `p.level < OFFICE_LEVEL` return the lock notice.
  `portal` gets `userId`.
- `visit(userId)`: `requireUser`; target exists, `level >= OFFICE_LEVEL` and has a company (else
  `"They don't have an office yet."`); the office is open or the target is me (else
  `"🔒 ada's office is closed."`); not while `playing`; moves you to `roomEntry(`office:${target}`)`
  and sends the snapshot. The owner being offline doesn't matter.
- `snapshot()` (`:812`) fills `furniture` and `owner` for an `office:`. Occupancy and chat are already per
  `RoomId`; the chat table keeps 200 lines per room, so offices get their own history for free.
- `setPlayer` (`:459`): someone whose company goes to null while inside *any* `office:` is sent to
  `townSpawn()`, next to the existing "out of the old house" rule.

## Client

- `web/src/net.ts` `loadSnapshot`: when `s.furniture`, `setOffice(ownerOfOffice(s.room), s.furniture)` before
  the map is drawn; the banner shows `${owner.name}'s office`.
- `web/src/hud/OfficePanel.tsx`, panel kind `{ kind: "office" }`: opened with E facing the `R` door inside your
  own office, or from the menu while you're in it. It is the editor:
  - a 10×7 grid of buttons, one per floor tile, showing the piece's name or empty;
  - a `Pills` row of `FURNITURE` with prices; click a piece then a tile to place it (TV takes the tile and
    the one to its right); click a placed piece to pick it up (free) or ✕ to remove it;
  - a footer `Costs 🪙 130 · you have 🪙 412` from `officeCost`, and Save → `town.setOffice`, then
    `refreshStats()` for the wallet;
  - a toggle at the top, `🔓 Open to visitors` / `🔒 Closed`, calling `town.setOfficeOpen` at once.
  Furniture edits are local until Save; the canvas keeps drawing the saved office.
- `web/src/hud/PlayerCard.tsx`: `🚪 Visit office` when `p.office === "open"` and it isn't you; a muted
  `🔒 Office closed` when `"closed"`; nothing when null. Calls `conn.visit(userId)` and closes the panel.
  On your own card: `🚪 My office`.
- `web/src/art/objects.ts` draws from the map chars, so a furnished office renders with no changes.
  `bakeGround` (`tiles.ts:160`) needs `office` added to whatever it keys floors on.

## Tests

- `core/test/maps.test.ts`: `officeMap(STARTER_OFFICE)` has a `d` with a `c` below it; the TV writes its
  second tile; `R` is a portal in `hq` and absent from `inn`.
- `core/test/world.test.ts`: `portal` from `R` lands in `office:<me>`; the exit from `office:7` lands below
  `R` in `hq:3` for a member of company 3 and at the Inn's entry for a freelancer.
- `core/test/shop.test.ts`: `officeCost(STARTER_OFFICE, [...STARTER_OFFICE, sofa, rug])` is 110; moving the
  desk costs 0; removing the chair refunds 0; `parseOffice` refuses walls, overlaps and 41 pieces.
- `server/test/town.test.ts`: a level-0 member's `setOffice` rejects `too_low`; a level-10 freelancer's
  rejects `no_company`; after reporting 10B tokens and earning coins, a member's `setOffice([...starter, sofa])`
  takes 100 coins and `wallet().balance` drops; the ledger ref `office:<id>` sums to −100.
- `server/test/world.test.ts`: `visit` puts a second user in `office:<first>` and the snapshot carries the
  starter desk and chair; after `setOfficeOpen(false)` the same `visit` returns the closed notice while the
  owner's own `visit` still works; a `step` into `R` at level 0 returns the lock notice;
  `profile()` shows `office: "closed"`.

## Deliberate limits

- `ponytail:` no reachability check. You can wall off the entry tile; a visitor can still step back out.
- `ponytail:` no refund on removal, no inventory. Add "pick up into inventory" if people ask.
- `ponytail:` one template. Bigger offices per house tier is a later `OFFICE_SIZES` table.
- Open or closed only; no guest lists or company-only setting.
- Offline players still rest at the building's shared desks, not in their office. Moving them to their
  own desk is a nice later change to `rest` (`world.ts:580`), but `houses` (who's seen through the walls
  from town) would need to look into offices too.

## Open questions

- None. Visiting an open office bypasses the building's members-only door on purpose: a visitor exits into
  *their own* building, so nothing leaks.

## As built

- The editor opens with E facing a wall of your own office, or from the menu, not from the door: a door
  can't be faced, a step goes through it. The first time you walk in, a dialog says so.
- Saving writes one ledger row for the whole cost, not one per piece.
- A never-saved office reads as `STARTER_OFFICE` from `mapOf`, on the server and in the client alike.
- `deleteUser` ignores `furniture` refs in its unsettled-game check: they sum to minus the price for good.
- The office code is in `core/src/office.ts`, not `shop.ts` and `maps.ts`; the template stays in `MAPS`.
- Superseded by `specs/inventory.md`: furniture comes from the bag and placing it is free, so there's no
  `officeCost`, no `furniture` ledger kind and no ledger row on save.
