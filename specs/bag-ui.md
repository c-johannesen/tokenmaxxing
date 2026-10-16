# The bag at the bottom, and items that look like themselves

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

## 4. The bag lives at the bottom of the screen, and opens upward as a grid

- **The button:** `🎒 12` at the bottom centre of the screen, where `12` is how many things you hold
  (every row in your bag, rewards included, nothing on a floor). The top bar's 🎒 button goes; the Menu
  entry stays and opens the same drawer.
- **The count:** `Wallet` gains `items: number` (one `COUNT(*)` of rows you own in
  `server/src/town/coins.ts`), so it refreshes wherever the wallet already does (every sync, every 30 s,
  after a buy, a trade, a drop). Also refresh the wallet after a successful take (`G` / right-click in
  `web/src/game/input.ts`).
- **The drawer:** clicking the button opens the bag as a panel that slides up from the bottom centre
  (same width rule as `.dialog`: between the chat on the left and the minimap on the right), not a modal
  in the middle. Items in a **grid** of square cells: the item's image, a small `×n` count in a corner, 🏅
  on rewards, a ring on what you're wearing. Clicking a cell selects it and shows its name and actions in a
  strip at the top of the drawer: **Wear** / **Take off**, and **Drop** (or **Drop here** in your own
  office) for tradeable kinds. Escape or the button closes it. Empty: "Nothing yet." with a link to the Shop.
- **The dialog line** (`.dialog`, `bottom: 24px` in `hud.css:270`) moves up above the bag button so the two
  don't overlap.
- The drawer is the existing `{ kind: "bag" }` panel, rendered as a drawer instead of a `Modal`; keys and
  clicks behave as they do for any open panel today.

## Done when

- `bun run typecheck`, `bun run lint`, `bun run test` pass (the `Wallet.items` count gets one assertion in
  `server/test/ledger.test.ts` or `town.test.ts`).
- Looked at in a browser: a dropped hat, glasses and outfit on the floor; the bag button and its count; the
  drawer open with a grid; a hat in the grid without a character under it.
- One commit on `feat/progression`, no attribution lines.
