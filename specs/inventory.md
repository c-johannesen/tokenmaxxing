# Inventory, and loot on the floor

Today nobody *has* items: a `purchases` row says you bought one, your level says you earned one, and
your office JSON says where your furniture is. This spec makes every item a thing you hold: pets, clothes,
furniture and level rewards sit in an inventory; pets, clothes and furniture can be traded and dropped on
the floor for someone else to take; rewards show in the bag but never leave you.

Decided:
- **Rewards are not tradeable** and not droppable (a drop is a trade with extra steps). They show in the
  bag with a 🏅 mark and can be worn; nothing else.
- **You take what you're on**, or, for a piece nobody can be on, what you face from the next tile.
  Stepping onto a drop does nothing by itself; G, or a right-click, takes it.
- **Furniture is tradeable.** Furniture placed in your office is yours: nobody else can take it.
- **Your office floor is yours too.** Anything dropped in your own office can be taken only by you.

"On it" means occupying its tile: standing on a parcel or a rug, or **sitting on a dropped seat**. So
every dropped piece of furniture is real furniture where it lies: anyone sits on a dropped sofa, anyone
pours from a dropped coffee machine. Whoever is sitting on a seat can take it (they stand up holding it);
a piece nobody can be on (desk, shelf, lamp, plant, coffee machine, TV) is taken by facing it from an
adjacent tile. Only wearables and pets lie as parcels.

Difficulty, overall: **4 / 5.** Two PRs. The first (inventory, grants, trading from the bag, furniture
into the bag) is medium: one new table with a backfill, every ownership check moved over, and the office
editor becomes bag-driven. The second (drops) is the hard part: items change hands between two actors,
and dropped seats change the room's map for everyone in it. Scores per part at the end.

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

Three patterns, then. **Walk-over** is for games where items are small and plentiful (and it misbehaves
over a laggy connection). **Face and press** is for deliberate, sparse pickups, and games with usable
things on the floor separate "use" from "take" (Animal Crossing's A vs Y). **Click to take** is the mouse
version of the same deliberate act, and the better games walk you there first. What we decided is
Animal Crossing's model with Habbo's mouse: walk onto the parcel, or sit on the dropped seat, and press a
take key (**G**; E keeps meaning "use what you face"), or **right-click** it (or yourself, when you're on
it) and your character goes there if needed and takes. Left-click keeps meaning what it means everywhere:
walk there, sit on it.

The ownership rules are Animal Crossing's and Habbo's combined: placed furniture in your office is yours,
your office floor is yours, and anything dropped anywhere else is loot for whoever stands on it.

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
- **Dropping** puts one row on the floor of the room you're in. **Furniture** goes into the room's map
  as itself on the nearest free floor tile, and works like any furniture: seats seat, the coffee machine
  pours, the rest blocks. **Wearables and pets** lie as a parcel on your tile (or the nearest free one),
  never blocking. One drop per tile. A worn thing dropped comes off your look.
- **Taking:** press **G** on it: standing on a parcel or a rug, or sitting on a dropped seat (you stand
  up with it). For a piece nobody can be on (desk, shelf, lamp, plant, coffee machine, TV): stand next to
  it, face it, press G. With the mouse, **right-click** the drop, or yourself when you're on one: if
  you're in reach it's taken at once; if not, you walk onto the parcel, sit on the seat, or walk up to the
  blocking piece, and take on arrival. **Left-click** stays what it is everywhere: walk there, or sit on
  it, without taking. The server checks you occupy the tile, or face it from the next tile for a blocking
  piece. Anyone can take a drop in town, the Inn or a company building. In an office, only its owner
  can: a visitor's drop there becomes the owner's to take, or goes back to the visitor after an hour
  like any unclaimed drop. Placed office furniture is never a drop.
- Unclaimed drops go back to the dropper after an hour. At most 5 live drops per person and 30 per room.
  Dropping in a room that's full, or on a tile that already has a parcel, says so.

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
  `world.placeDrop({ id, item, by })`. A parcel goes on my tile, or the nearest free walkable one if I'm
  seated or mine has a drop; furniture goes on the nearest free floor tile that isn't a doorway or the
  tile in front of one (the same no-reachability-check `ponytail` as offices). Past 30 in the room it
  refuses with a notice, and the town returns the row at once.
- `world.take()`: the drop on my tile (standing on a parcel or rug, or `state === "sit"` on a dropped
  seat), else the drop on the tile I face if it's a piece that can't be occupied; else nothing. In an
  `office:<owner>` room, only the owner (`"That's ada's floor."` otherwise). Remove it from state, stand
  me up if I was sitting on it, send `pickup` to the room, call
  `town.pickUp(dropId, userId)`: `UPDATE items SET owner_id = ?, dropped_by = NULL WHERE id = ? AND
  owner_id IS NULL`. Zero rows updated means the sweeper got there first; the drop is already gone from
  the world. Returns a `StepResult` notice: `🎒 Took a Sofa.`
- **Dropped furniture in the map:** `core` gets `DROPS = new Map<RoomId, Drop[]>()` and
  `setDrops(room, drops)`; `mapOf(room)` overlays the furniture drops (their `ch`) on the base map and
  caches per room until `setDrops` runs again. `stepTarget`, `sit` and `drink` then just work. Parcels
  aren't in the map. Both the world and the client call `setDrops` from the snapshot and the `drop`/`pickup`
  events; the sweeper's `removeDrops` does too. A player sitting on a seat the sweeper removes is stood
  up in place.
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
- **Drops in the world** (`web/src/game/render.ts`): furniture draws itself from the map; wearables and
  pets are one parcel sprite (a small box with a bow, drawn in `web/src/art/objects.ts`), with the pet's
  frame instead for pets. A `sign` with the kind's name shows when you're on it or next to it.
  - `G` calls `conn.take()`.
  - A `contextmenu` listener on the canvas (`web/src/game/input.ts`, next to the `click` one;
    `preventDefault` always, so the browser menu never shows over the game): a right-click on a drop, or
    on your own avatar while you're on a drop, takes it if you're in reach, else walks you there
    (`walkTo` with a `takeOnArrival` flag next to `interactOnArrival`) and takes on arrival. A right-click
    anywhere else does nothing.
  - Left-click on a drop is the ordinary `walkTo`: onto a parcel or rug, sitting on a seat, up to a
    blocking piece; no take.
  - In someone else's office the sign reads `🔒 Sofa` and both G and the right-click say whose floor it
    is. The ⓘ Controls overlay lists G and right-click. ponytail: no touch gesture for taking; a phone has
    neither G nor a right button, and the HUD isn't built for phones today.

## Tests

- `server/test/ledger.test.ts`: buy twice gives two rows and one spend upsert; a trade moves one row and
  leaves the balance alone; a placed piece can't be traded; `grantRewards` is idempotent (a second call grants nothing); the backfill is idempotent and turns office
  pieces into placed rows.
- `server/test/town.test.ts`: `report` crossing 10B grants the top hat; `setLook` accepts a traded-in
  Duck; `drop` of a reward is refused, of a worn hat un-wears, of a sixth drop is refused; `pickUp` with a
  swept row updates nothing; `furnish` refuses more sofas than the bag holds and flips `placed`.
- `server/test/world.test.ts`: a drop appears in the room snapshot; `take` from the next tile is refused;
  a colleague standing on it takes it and the dropper's bag loses it; the drop is gone for everyone; a
  second take of the same id fails cleanly; a dropped sofa is in the room's map, a colleague sits on it,
  takes it while seated and is standing afterwards; a dropped desk blocks, is taken from the next tile
  while facing it and not from two tiles away or from on top of a parcel elsewhere; a visitor can't take a
  drop in the owner's office and the owner can; a room at 30 drops refuses the 31st; a second drop on
  the same tile lands next to it.
- `core/test`: `mapOf` with furniture drops overlays and caches, and leaves parcels out; `isTradeable`
  is false for rewards; `parseSide` refuses them.

## Difficulty

| Part | Size | Score | Why |
|---|---|---|---|
| Items table + backfill, ownership checks moved | M | 3 | Touches every owner check and the live data; mechanical but wide |
| Rewards as grants, not tradeable | S | 2 | One function in `report`, one table, one flag |
| Trading from the bag | S | 2 | Simplifies `settleTrade`; removes the ledger trick |
| Furniture into the bag, editor rework | M | 3 | `furnish` and the editor change meaning; a Shop tab |
| Bag panel, Shop counts | S–M | 2 | New panel from existing pieces |
| Drops, taking, dropped furniture in maps, sweeper | L | 4 | Two-actor handoff; furniture changes room maps live for everyone; caps and expiry; a sprite and a key |

PR 1 (first five rows) is bigger than the trading feature was. PR 2 (drops) is bigger than offices.
Together, 4 / 5.

## Open questions

- The Inn: same 30-drop cap as any room, or lower, since everyone passes through? Default: the same.
- Should a visitor be allowed to drop in someone else's office at all, given only the owner can take it
  there? It's how you leave a gift on someone's floor, so default: yes.
