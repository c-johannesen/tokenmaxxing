# Inventory, and loot on the floor

Today nobody *has* items: a `purchases` row says you bought one, your level says you earned one, and
your office JSON says where your furniture is. This spec makes every item a thing you hold: pets, clothes,
furniture and level rewards sit in an inventory; pets, clothes and furniture can be traded and dropped on
the floor for someone else to take; rewards show in the bag but never leave you.

Decided:
- **Rewards are not tradeable** and not droppable (a drop is a trade with extra steps). They show in the
  bag with a 🏅 mark and can be worn; nothing else.
- **Picking up is not stepping**: a dropped sofa must be sittable where it lies.
- **Furniture is tradeable.** Furniture placed in your office is yours: nobody else can take it.

Difficulty, overall: **4 / 5.** Two PRs. The first (inventory, grants, trading from the bag, furniture into
the bag) is medium: one new table with a backfill, every ownership check moved over, and the office editor
becomes bag-driven. The second (drops) is the hard part: items change hands between two actors, dropped
furniture changes the room's map for everyone, and nothing may be lost or duplicated. Scores per part at
the end.

## What other games do about picking up

| Game | Pick up | Who can take it | Notes |
|---|---|---|---|
| Pokémon (overworld) | Stand beside, face it, press A | Single player | One generic ball sprite for every item; you learn what it is on pickup |
| Animal Crossing: New Horizons | Walk over it, press Y (A is "use") | Anyone on the island for *dropped* items; *placed* furniture can't be taken by visitors | Drops persist; two states, dropped vs placed |
| Habbo Hotel | Click furni, "Pick up" (Ctrl+click) | Room owner, or people given rights; guests never | Furni is only ever placed in a room or in inventory; dropping furni in others' rooms was removed after scams |
| RuneScape | Left-click "Take" on the ground | Anyone, after a grace period | Drops are invisible to others for 1 minute, then vanish about 2 minutes later |
| Stardew Valley, Terraria, Minecraft | Walk near: it flies to you (magnetism) | Anyone | Fast and passive; a Stardew forum thread asks for manual pickup because auto-pickup lags on high-ping multiplayer |
| Path of Exile | Click each item | Anyone (with allocation rules) | Defended as "an active decision of what you're picking up"; PoE 2 added hold-to-click so loot doesn't hijack movement |
| Diablo IV | Auto-loot in a radius | Instanced per player | The convenient end of the scale |

Three patterns, then. **Walk-over** is for games where items are small and plentiful and nothing on the
floor is usable (and it misbehaves over a laggy connection). **Face and press** is for deliberate, sparse
pickups, and games with usable things on the floor separate "use" from "take" (Animal Crossing's A vs Y).
**Click to take** is the mouse version of the same deliberate act, and the better games walk you there
first. For a room with seats and a coffee machine, where E already means "use what you face", the Animal
Crossing split is the one that fits: **E uses, G takes**, and a click walks you over and takes.

The ownership rules we decided are the Animal Crossing and Habbo ones combined: placed furniture in
your own office is yours; anything dropped anywhere else is loot for whoever takes it.

Sources: [Pokémon items](https://breezewiki.discard.no/pokemon/wiki/Item),
[ACNH: visitors and placed vs dropped](https://www.gameslearningsociety.org/wiki/can-visitors-take-things-from-your-house-in-animal-crossing/),
[ACNH: drops persist](https://sportskeeda.com/esports/will-dropped-items-disappear-animal-crossing-new-horizons),
[Habbox: room rights](https://habboxwiki.com/Rights), [Habbo help: group rooms](https://help.habbo.com/hc/en-us/articles/360011512600-Groups),
[OSRS: drop timer](https://oldschool.runescape.wiki/w/Drop), [Stardew: magnetism](https://stardewvalleywiki.com/Magnetism),
[Stardew forum: manual pickup on multiplayer](https://forums.stardewvalley.net/threads/add-option-toggle-to-manually-pick-up-items.10673/latest),
[PoE: click-to-loot debate](https://lemmy.federate.cc/comment/421724).

## Rules

- **An item is a row.** `items (id, owner_id, item, at, placed)`: one row per copy. You can hold two
  Ducks. You wear a kind (`look.pet = 1`) if you hold at least one row of it.
- **Buying** adds a row and a `purchases` row for the spend; `purchases` stops meaning ownership. Buying
  a kind you already hold is fine (a second copy, to trade or drop). The Shop gains a Furniture tab.
- **Level rewards** are granted once, as rows, the first time your level reaches 10, 20 and 30
  (`rewards (user_id, item)` records the grant). They're `tradeable: false`: never in a trade, never
  dropped. The derived "owned from level" rule goes.
- **Trading** moves rows. A side names kinds, as now; settling moves one row of each kind. The "you
  already have it" refusal goes, and so does the ledger row that kept the giver's balance put: spend stays
  in `purchases`, ownership is in `items`, and the two no longer touch.
- **Furniture** lives in the bag. Your office lists what's placed; placing takes a row out of the bag
  (`placed = 1`), removing puts it back. Placing is free; buying costs. "Removing refunds nothing" becomes
  "removing keeps the piece". Only the owner edits an office, so placed furniture can't be taken.
- **Dropping** puts one row on the floor of the room you're in, at your tile (or the nearest free floor
  tile if you're seated). Small things (clothes, hats, glasses, pets) lie on a walkable tile and don't
  block. **Dropped furniture is furniture**: it's written into the room's map like office pieces are, so
  people sit on a dropped sofa and pour from a dropped coffee machine. A worn thing dropped comes off
  your look.
- **Taking:** press **G** facing a drop or standing on one, or click it (you walk there and take it).
  Taking needs you adjacent to or on the tile; the server checks. Anyone can take any drop, including in
  someone's office: an office's *placed* furniture is the owner's, a drop in it is loot.
- Unclaimed drops go back to the dropper after an hour. At most 5 live drops per person and 30 per room.
  Dropping in a room that's full says so.

## Data

```sql
-- Ownership. owner_id NULL while on the floor, with dropped_by for the sweeper. placed = 1 in an office.
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER, item TEXT NOT NULL, at INTEGER NOT NULL,
  placed INTEGER NOT NULL DEFAULT 0, dropped_by INTEGER, dropped_at INTEGER);
CREATE INDEX IF NOT EXISTS items_owner ON items (owner_id, item);
CREATE TABLE IF NOT EXISTS rewards (user_id INTEGER NOT NULL, item TEXT NOT NULL, PRIMARY KEY (user_id, item));
```

Backfill in `migrate` (`server/src/town/schema.ts`), guarded by `items` being empty:
`INSERT INTO items (owner_id, item, at) SELECT user_id, item, at FROM purchases` (a row moved by a trade
already belongs to the receiver, so this is right), then one `placed` row per office piece from `offices`
(`furn.<ch>`, `placed = 1`, free: they were paid for already). `purchases` keeps its key; a rebuy upserts
the price: `ON CONFLICT(user_id, item) DO UPDATE SET price = price + excluded.price`.

`core/src/shop.ts`: furniture joins `ITEMS` as `furn.<ch>` with its price (`FURNITURE` stays the
catalogue for the editor; `Item.slot` gains `"furniture"`); `Item.tradeable` is false for rewards;
`isTradeable(id)` reads it. `Side` unchanged.

## Server, PR 1: the bag

`server/src/town/coins.ts`:

- `ownedItems(sql, userId)` reads `items` (not placed); `bag(sql, userId)` returns
  `{ item, count, placed }[]` for the panel. `ownedIds` goes.
- `buy()`: insert `items` and upsert `purchases`; drop the "already have it" check.
- `grantRewards(sql, userId, level)`: for each `levelItems(level)` not in `rewards`, insert both rows.
  Called from `report` in `town.ts` after the rollups land. The first sync after deploy grants everyone
  above 10 what they're owed.
- `settleTrade`: per kind, `UPDATE items SET owner_id = receiver WHERE id = (SELECT id FROM items WHERE
  owner_id = giver AND item = ? AND placed = 0 LIMIT 1)`; no ledger row for items; the un-wear step stays.
- `furnish()`: no coins. Validate counts per kind against the bag (placed or not); set `placed = 1` on that
  many rows and `0` on the rest. `officeCost` goes.
- `wallet().owned`: distinct kinds held, so the Shop's Wear buttons keep working.

`server/src/actors/town.ts`: `setLook` checks `items`; `tradeables` reads the bag minus rewards and
placed pieces; `buy` sells furniture into the bag; `deleteUser` deletes the account's `items` and
`rewards` and returns its live drops to nobody (deletes them).

## Server, PR 2: drops

World state (`server/src/actors/world.ts`): `drops?: Record<string, Drop>` with
`Drop { id: number (the items row); item: string; room: RoomId; x; y; by: number; at: number }`.

- `town.drop(itemKind)` (`requireUser`): under `serial`, pick one unplaced row of that kind I own, refuse
  rewards (`not_tradeable`) and a sixth live drop (`SELECT COUNT(*) … WHERE dropped_by = ? AND owner_id IS
  NULL`); set `owner_id = NULL, dropped_by = me, dropped_at = now`; un-wear if worn; then
  `world.placeDrop({ id, item, by })`. The world puts it on my tile (furniture: the nearest free floor
  tile that keeps the room walkable, with the same no-reachability-check `ponytail` as offices), or
  refuses past 30 with a notice, in which case the town returns the row at once.
- `world.take()`: the drop I face or stand on, within one tile; remove it from state, send `pickup` to
  the room, call `town.pickUp(dropId, userId)`: `UPDATE items SET owner_id = ?, dropped_by = NULL WHERE
  id = ? AND owner_id IS NULL`. Zero rows updated means the sweeper got there first; the drop is already
  gone from the world. Returns a `StepResult` notice: `🎒 Took a Duck.`
- **Dropped furniture in the map:** `core` gets `DROPS = new Map<RoomId, Drop[]>()` and `setDrops(room,
  drops)`; `mapOf(room)` overlays furniture drops (their `ch`) on the base map and caches per room until
  `setDrops` runs again. `stepTarget`, `sit` and `drink` then just work. Both the world and the client
  call `setDrops` from the snapshot and the `drop`/`pickup` events.
- **Sweeper:** a town alarm every 10 minutes (`c.schedule`, as `arcade` uses) returns rows with
  `owner_id IS NULL AND dropped_at < now - 1h` to `dropped_by`, and tells the world `removeDrops(ids)`.
- `Snapshot` gains `drops: Drop[]`; events `drop` (a Drop) and `pickup` (`{ id }`).
- A company building that closes, or an office whose owner is deleted, returns its drops to the droppers.

## Client

- **Bag panel** (`web/src/hud/Bag.tsx`, `{ kind: "bag" }`, 🎒 in the menu and next to the Shop button):
  rows of kinds with counts (`×2`, `1 placed`), drawn with `AvatarImage` / the pet frame / the piece's
  sprite; per row **Wear** / **Take off**, and **Drop** for tradeable kinds. Rewards show 🏅 and no Drop.
- **Shop:** a Furniture tab; owned counts as `×n` on every item.
- **Office editor:** the pills show `×n in bag`; a piece can be placed only if the bag has one; Save no
  longer charges; Remove returns to the bag. The "Not enough coins" line goes; "None left in your bag"
  takes its place when relevant.
- **Trade panel:** "You give" lists bag kinds with counts, rewards and placed pieces excluded.
- **Drops in the world** (`web/src/game/render.ts`): a parcel sprite for clothes, the pet's frame for
  pets, furniture as itself from the map; a `sign` with the kind's name when you're within two tiles.
  `G` calls `conn.take()`; clicking a drop walks you adjacent (`walkTo` with a `takeOnArrival` flag next
  to `interactOnArrival` in `web/src/game/input.ts`) and takes. The ⓘ Controls overlay lists G.

## Tests

- `server/test/ledger.test.ts`: buy twice gives two rows and one spend upsert; a trade moves one row and
  leaves the balance alone; a placed piece can't be traded; `grantRewards` is idempotent and never regrants
  a traded… never regrants at all (rewards can't leave); the backfill is idempotent and turns office
  pieces into placed rows.
- `server/test/town.test.ts`: `report` crossing 10B grants the top hat; `setLook` accepts a traded-in
  Duck; `drop` of a reward is refused, of a worn hat un-wears, of a sixth drop is refused; `pickUp` with a
  swept row updates nothing; `furnish` refuses more sofas than the bag holds and flips `placed`.
- `server/test/world.test.ts`: a drop appears in the room snapshot; `take` from two tiles away is refused;
  a colleague adjacent takes it and the dropper's bag loses it; the drop is gone for everyone; a second
  take of the same id fails cleanly; a dropped sofa is sittable; a room at 30 drops refuses the 31st.
- `core/test`: `mapOf` with furniture drops overlays and caches; `isTradeable` is false for rewards.

## Difficulty

| Part | Size | Score | Why |
|---|---|---|---|
| Items table + backfill, ownership checks moved | M | 3 | Touches every owner check and the live data; mechanical but wide |
| Rewards as grants, not tradeable | S | 2 | One function in `report`, one table, one flag |
| Trading from the bag | S | 2 | Simplifies `settleTrade`; removes the ledger trick |
| Furniture into the bag, editor rework | M | 3 | `furnish` and the editor change meaning; a Shop tab |
| Bag panel, Shop counts | S–M | 2 | New panel from existing pieces |
| Drops, taking, dropped furniture in maps, sweeper | L | 4 | Two-actor handoff; room maps change live for everyone; caps and expiry; rendering and input |

PR 1 (first five rows) is bigger than the trading feature was. PR 2 (drops) is bigger than offices.
Together, 4 / 5.

## Open questions

- Should drops in someone's *closed* office be allowed? A closed office only keeps visitors out; someone
  already inside could leave junk. Default: allowed; the owner takes it like anyone.
- The Inn: same 30-drop cap as any room, or lower, since everyone passes through? Default: the same.
