# The bag as a grid, and items that look like themselves

Four client changes from playing with the inventory. No rules change.

## 1. No labels over drops

`web/src/game/render.ts:128`: the name sign over a drop (and its `🔒` on someone else's office floor)
goes. Taking still says what you took, and someone else's floor still answers "That's ada's floor.".
Remove whatever that leaves unused (`dropName` if nothing else reads it).

## 2. A dropped thing looks like the thing

Today a dropped hat, pair of glasses or outfit is a gift box (`parcel` in `web/src/art/objects.ts:264`).
It should be the item itself, lying on the floor:

- **Hats and glasses:** the hat's or glasses' own grid, `down` view (`HATS`, `GLASSES` and their palettes in
  `web/src/art/characters.ts`), with no head under it.
- **Outfits:** the body only, `BODIES.down.stand` in that outfit's colours, with the skin pixels (hands,
  neck) left transparent, and the rack overlay for outfit 12. No head, no legs if the body grid has them
  in a separate colour: whatever reads as the garment.
- **Pets** stay their own frame; **furniture** stays itself in the map.

Add one `itemFrame(item: Item): HTMLCanvasElement` (cached, like `characterFrame`) in `characters.ts`
for the three wearable slots, and use it in `render.ts` in place of `parcel()`. Delete `parcel`.

## 3. The bag shows the item, not you wearing it

`ItemImage` in `web/src/hud/Shop.tsx:136` draws a whole character for clothes. In the bag, draw only the
item: `itemFrame` scaled up for wearables, the pet frame for pets, the piece for furniture. Keep the Shop's
try-on (the whole character wearing it) as it is: that's a preview, not the bag. A `bare` prop on
`ItemImage`, or a small `BagImage` next to it, whichever is fewer lines.

## 4. The bag counts what you hold, and shows it as a grid

The chat and the minimap own the bottom of the screen, so the bag stays where it is.

- **The button:** the top bar's 🎒, next to the coins, reads `🎒 12`, where `12` is how many things you
  hold (every row in your bag, rewards included, nothing on a floor). The Menu entry stays.
- **The count:** `Wallet` gains `items: number` (one `COUNT(*)` of rows you own in
  `server/src/town/coins.ts`), so it refreshes wherever the wallet already does (every sync, every 30 s,
  after a buy, a trade). Also refresh the wallet after a drop from the bag and after a successful take
  (`G` / right-click in `web/src/game/input.ts`).
- **The grid:** the bag opens as today's `{ kind: "bag" }` panel (the `Modal`), but its contents are a
  **grid** of square cells: the item's image, a small `×n` count in a corner, 🏅 on rewards, a ring on what
  you're wearing. Clicking a cell selects it and shows its name and actions in a strip at the top of the
  panel: **Wear** / **Take off**, and **Drop** (or **Drop here** in your own office) for tradeable kinds.
  Empty: "Nothing yet." with a link to the Shop.

## Done when

- `bun run typecheck`, `bun run lint`, `bun run test` pass (the `Wallet.items` count gets one assertion in
  `server/test/ledger.test.ts` or `town.test.ts`).
- Looked at in a browser: a dropped hat, glasses and outfit on the floor; the bag button and its count; the
  bag open with a grid; a hat in the grid without a character under it.
- One commit on `feat/progression`, no attribution lines.
