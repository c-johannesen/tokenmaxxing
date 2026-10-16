# Inventory, and loot on the floor

Today nobody *has* items: a `purchases` row says you bought one, your level says you earned one, and
your office JSON says where your furniture is. This spec makes every item a thing you hold: pets, clothes
and level rewards sit in an inventory, can be traded (rewards too), and can be dropped on the floor of a
room for someone else to pick up. Furniture joining the inventory is an optional last step.

Difficulty, overall: **3.5 / 5, medium-large.** Two PRs. The first (inventory, rewards as grants,
trading from the bag) is medium: one new table with a backfill, and the ownership checks moved over. The
second (drops) is the hard part: items change hands between two actors, which needs a handshake and a
sweeper so nothing is ever lost or duplicated. Per-part scores are at the end.

## Rules

- **An item is a row.** `items (id, owner_id, item, at)`: one row per copy. You can hold two Ducks. You
  wear a kind (`look.pet = 1`) if you hold at least one row of it.
- **Buying** adds a row and a `purchases` row for the spend; `purchases` stops meaning ownership. Buying
  something you already hold is allowed (a second copy, to trade or drop).
- **Level rewards** are granted once, as rows, the first time your level reaches 10, 20 and 30
  (`rewards (user_id, item)` records the grant, so trading the orb away never regrants it). The derived
  "owned from level" rule goes. Consequence worth saying out loud: the orb stops being proof of level 30;
  the title and badges still are.
- **Trading** moves rows. A side names kinds, as now; settling moves one row of each kind. The "you
  already have it" refusal goes (copies are fine), and so does the ledger row that kept the giver's
  balance put: spend stays in `purchases`, ownership is in `items`, and the two no longer touch.
- **Dropping** puts one row on the floor at your feet, in the room you're in: `owner_id` becomes null and
  the world draws it there. Anyone who **steps on it picks it up**. Unclaimed drops go back to the dropper
  after an hour. Up to 5 drops per person and 30 per room; a worn item dropped comes off your look.
- **Furniture (optional):** a piece becomes an item too (`furn.s`). Placing takes it out of the bag,
  removing puts it back, so "removing refunds nothing" becomes "removing keeps the piece", which is what
  people expect. Furniture can then be traded and dropped like anything else.

## Data

```sql
-- Ownership. owner_id NULL while on the floor (see drops), with dropped_by for the sweeper.
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER, item TEXT NOT NULL, at INTEGER NOT NULL,
  dropped_by INTEGER, dropped_at INTEGER);
CREATE INDEX IF NOT EXISTS items_owner ON items (owner_id, item);
-- Once per level reward.
CREATE TABLE IF NOT EXISTS rewards (user_id INTEGER NOT NULL, item TEXT NOT NULL, PRIMARY KEY (user_id, item));
```

Backfill, in `migrate` (`server/src/town/schema.ts`), guarded by `items` being empty:
`INSERT INTO items (owner_id, item, at) SELECT user_id, item, at FROM purchases` (a row moved by a trade
already belongs to the receiver at price 0, so this is right today). `purchases` keeps its primary key; a
rebuy upserts the price: `ON CONFLICT(user_id, item) DO UPDATE SET price = price + excluded.price`.

`core/src/shop.ts`: `isTradeable(id)` becomes "a shop item" (rewards included); `Side` unchanged.

## Server, PR 1: the bag

`server/src/town/coins.ts`:

- `ownedItems(sql, userId)` reads `items`; `ownedIds` goes (no derived items). A `bag(sql, userId)`
  returns `{ item, count }[]` for the panel.
- `buy()`: insert `items` and upsert `purchases`; drop the "already have it" check.
- `grantRewards(sql, userId, level)`: for each `levelItems(level)` not in `rewards`, insert both rows.
  Called from `report` (`town.ts`) after the rollups land, since that's the only place a level changes.
  First sync after deploy grants everyone above 10 what they're owed.
- `settleTrade`: per item kind, `UPDATE items SET owner_id = receiver WHERE id = (SELECT id FROM items
  WHERE owner_id = giver AND item = ? LIMIT 1)`; no ledger row for items; the un-wear step stays. The
  `ponytail:` note about `purchases` goes with it.
- `wallet().owned`: distinct kinds from `items`, so the Shop's Wear buttons keep working.

`server/src/actors/town.ts`: `setLook` checks `items`; `tradeables` reads the bag; `buy` loses the
`not_for_sale` refusal for rewards? No: rewards stay off the shelf (`price: 0`, earned), but a traded-in
orb is wearable because it's a row. `deleteUser` deletes the account's `items` and `rewards`.

## Server, PR 2: drops

World state (`server/src/actors/world.ts`): `drops?: Record<string, Drop>` with
`Drop { id: number (the items row); item: string; room: RoomId; x; y; by: number; at: number }`.

- `town.drop(itemKind)` (`requireUser`): under `serial`, pick one row of that kind I own; refuse past 5
  live drops by me (`SELECT COUNT(*) FROM items WHERE dropped_by = ? AND owner_id IS NULL`); set
  `owner_id = NULL, dropped_by = me, dropped_at = now`; un-wear if worn; then
  `world.placeDrop({ id, item, by })`, which puts it on my tile (or the nearest free floor tile if I'm on
  a seat) and sends `drop` to the room. If the world call fails, the sweeper returns it.
- **Picking up** is in `step`: after a successful move, if a drop is on the new tile, remove it from state,
  send `pickup` to the room, and call `town.pickUp(dropId, userId)`: `UPDATE items SET owner_id = ?,
  dropped_by = NULL WHERE id = ? AND owner_id IS NULL`. If that updates 0 rows (the sweeper got there
  first), the world has already removed the drop; nothing else to do. Refuse to pick up past 30 kinds in
  the bag? No cap; the bag is a list.
- **Sweeper:** a town alarm every 10 minutes (RivetKit `c.schedule`, as the arcade uses) returns rows with
  `owner_id IS NULL AND dropped_at < now - 1h` to `dropped_by`, and tells the world
  `world.removeDrops(ids)`. A deleted dropper's drops go to nobody: delete the rows.
- Room caps: `placeDrop` refuses past 30 in the room with a notice; the town then returns the row at once.
- `Snapshot` gains `drops: Drop[]` for the room; events `drop` and `pickup` (`{ id }`).
- `removePlayer` and `removeCompany` leave drops where they are; a company building that closes takes its
  drops with it (`removeDrops` for that room, rows back to the droppers).

`portal`/`stepTarget` need nothing: drops sit on walkable tiles and never block.

## Client

- **Bag panel** (`web/src/hud/Bag.tsx`, panel `{ kind: "bag" }`, 🎒 in the menu and next to the Shop
  button): rows of kinds with counts, drawn with `AvatarImage` / the pet frame, and per row **Wear** (or
  Take off), **Trade** (opens the trade panel with the item pre-picked; needs a target, so really it opens
  the leaderboard with a hint; keep it to Wear and Drop in v1) and **Drop**. Rewards show a 🏅 mark.
- **Shop** keeps its tabs; owned counts show as `×2` on the item.
- **Drops in the world** (`web/src/game/render.ts`): a small parcel sprite per drop, with the pet's own
  frame for pets, and a label with the kind's name on hover/nearby (reuse `sign`). `loadSnapshot` sets
  `world.drops`; `drop`/`pickup` events update it. Stepping onto one shows a notice line
  `🎒 Picked up a Duck.`
- **Trade panel**: "You give" lists bag kinds with counts; unchanged otherwise.
- **Office editor (optional furniture step)**: the piece pills show `×n` from the bag and only owned
  pieces can be placed; a Furniture tab in the Shop sells pieces into the bag.

## Tests

- `server/test/ledger.test.ts`: buy twice gives two rows and one spend upsert; a trade moves one row and
  leaves the balance alone; `grantRewards` is idempotent and never regrants a traded-away reward; the
  backfill from `purchases` is idempotent.
- `server/test/town.test.ts`: `report` crossing 10B grants the top hat; `setLook` accepts a traded-in orb
  at level 1; `drop` un-wears and refuses a sixth drop; `pickUp` with a swept row updates nothing.
- `server/test/world.test.ts`: a drop appears in the room snapshot; a colleague stepping on it picks it up
  and the dropper's bag loses it; the drop is gone for everyone in the room; a second pickup of the same
  id fails cleanly; a closed company's room returns drops.
- `core/test`: `isTradeable` includes rewards; nothing else is pure here.

## Difficulty

| Part | Size | Score | Why |
|---|---|---|---|
| Items table + backfill, ownership checks moved | M | 3 | Touches every owner check and the live migration; mechanical but wide |
| Rewards as grants | S | 2 | One function in `report`, one table |
| Trading from the bag | S | 2 | Simplifies `settleTrade`; removes the ledger trick |
| Bag panel, Shop counts | S–M | 2 | New panel from existing pieces |
| Drops and pickups | M–L | 4 | Two-actor handoff, sweeper, caps, rendering, events; the only part with real failure modes |
| Furniture into the bag (optional) | M | 3 | Editor and `officeCost` become bag-driven; furniture becomes tradeable |

PR 1 (first four rows) is about the size of the trading feature. PR 2 (drops) is about the size of the
offices feature. Together, 3.5 / 5.

## Open questions

- Should rewards be tradeable at all? It's what was asked; the cost is that a level-30 orb on a level-2
  player says nothing. A middle path is `tradeable: false` on reward items (one field), keeping them in
  the bag for the look but out of trades and drops.
- Pick up by stepping, or by pressing E? Stepping is one `if` in `step` and feels like a game; E is safer
  against accidental pickups in a crowded Inn. Default: stepping.
- Does the Inn need a lower drop cap, since everyone passes through it? Default: the same 30.
