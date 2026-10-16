# UI fixes from the browser test

Findings from a full browser run of the five features (levels, offices, quests, badges, trading) on
`feat/netstationen`. One bug and eight small observations. Each is a few lines; keep the diff that size.

## 1. Toasts stack instead of covering each other (the bug)

Every toast (`NoticeToast`, `QuestToast`, `LevelToast`, `MentionToast` in `web/src/hud/Hud.tsx`, and
`InviteToast` in `web/src/hud/Arcade.tsx`) is positioned on its own at the same spot (`.toast` and
`.mention-toast` in `web/src/hud/hud.css:241` and `:873`: `position: absolute; top: 110px; left: 50%`).
Two at once draw on top of each other, and only the top one can be clicked. A big sync that levels you
up also finishes the token quest, so this is the common case, and a trade offer under a quest toast
sends the click to the Shop instead of Trades.

Fix: one `<div className="toasts">` in `Hud()` wrapping the five toast components, laid out as a column:

```css
.toasts { position: absolute; top: 110px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
.toasts > * { pointer-events: auto; position: static; transform: none; }
```

so `.mention-toast` and `.invite-toast` keep their look but lose their own positioning. The two
connection `.toast` lines at `Hud.tsx:43` and `:48` ("offline", "expired") stay where they are. Nothing
else changes: each toast keeps its own timing.

## 2. The Shop's "+N from today so far" leaves out quest coins

`wallet().today` (`server/src/town/coins.ts:89`) is token coins only, so after two quests the line
reads 24 while the balance rose 36.

Fix: `today: coinsForTokens(todayTokens) + questCoins(todays)`, and the field's comment becomes
"Coins from today so far: tokens and quests." Check `server/test/ledger.test.ts` and `town.test.ts` for
assertions on `today` and adjust them.

## 3. The trade panel's coin box clamps silently

`web/src/hud/Trades.tsx:90`: typing 600 becomes 500 with no word, and the offer goes out at 500.

Fix: keep the number as typed (still an integer ≥ 0), show a small red line `Up to 🪙 500` under the
box when it's over `TRADE_COINS_CAP`, and disable Offer while either side is over. The server still
refuses it anyway.

## 4. The empty-offer error reads like a rule

`server/src/actors/town.ts:436`: "Up to 🪙 500 and 4 shop items a side, and something at all." for every
bad side.

Fix: two messages. Empty both ways: "Offer something, or ask for something." (code `invalid_trade`).
Otherwise: "Up to 🪙 500 and 4 shop items a side." (same code). The empty check goes first.

## 5. The Trades panel goes stale

`TradesPanel` in `Trades.tsx` fetches once. A withdrawn offer stays listed until Accept says it's gone.

Fix: refetch `town.trades()` every 10 s while the panel is open (`setInterval` in the effect, cleared on
unmount). ponytail: a poll, not an event; an offer withdrawn under you is rare.

## 6. The office editor's Save is disabled with no word

`web/src/hud/OfficePanel.tsx:105`: over budget, Save just greys out.

Fix: when `cost > wallet.balance`, a muted `Not enough coins` next to the Save button.

## 7. A two-wide TV labels both cells "TV"

`OfficePanel.tsx:81`: `pieceOf(at(x, y)?.ch)?.name` on both tiles.

Fix: the name on the piece's own tile only (`at(x, y)?.x === x`), and `·` on the second tile, so two TVs
side by side read as two.

## 8. Bots show Lv99 and Lv100 over a cap of 30

`core/src/bots.ts:47` and `:147`. With Singularity at 30, 99 reads wrong.

Fix: both bots get `level: 30` (import `MAX_LEVEL` from `format.ts` rather than the literal). Their
cards then say "Level 30". `core/test/bots.test.ts` may assert the old numbers; adjust.

## 9. Overflow sleepers pile up in adjacent tiles

`core/src/world.ts:386`, `restSpot`: past the beds, people rest on floor tiles in reading order, so from
the ninth member on they stand shoulder to shoulder at x=1,2,3… and their name labels overlap.

Fix: every other floor tile in the fallback (`x % 2 === 1`), so neighbours are a tile apart. The
building has well over 100 floor tiles for a 50-person cap. `core/test/world.test.ts` has a `restSpot`
overflow case; keep it true.

## 10. "💻 Desktop app the app" on your own card

`web/src/hud/Computers.tsx:66`: the device named "Desktop app" gets the small "the app" after it.

Fix: for `kind === "app"` show `this Mac` in the small text (the app only runs on macOS); linked
computers keep their platform.

## Not changing

- Console warnings for expected server errors, and Rivet's "transaction coordinator is closed" log
  lines when player actors sleep: pre-existing, outside these features.
- Chat keeping focus until the first Escape: pre-existing.

## Done when

- `bun run typecheck`, `bun run lint`, `bun run test` pass (`bun run test`, with the project's timeout).
- Item 1 has no automated test (layout); items 2, 8 and 9 adjust or add the unit tests named above.
- One commit on `feat/netstationen`, no attribution lines.
