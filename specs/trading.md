# Trading

Offer anyone a trade from their player card: coins and items on your side, coins and items on theirs. They
accept or decline, and both sides move at once. It reuses the ledger and purchases tables as they are.

Netstationen's right-click menu was where status got traded; here the card is that menu.

## Rules

- **An offer** is what I give and what I want: each side is `coins` (0 to `TRADE_COINS_CAP = 500`, the
  stake cap) and up to 4 shop items. At least one thing on either side.
- **Items** are shop items with a price. Level rewards (`specs/level-rewards.md`) are derived from your
  level and can't move; furniture (`specs/offices.md`) has no inventory and can't either. You can't
  receive an item you already own, so nobody ends up with two of anything.
- **One open offer per sender.** A new offer replaces your old one. Offers older than `TRADE_TTL` (7 days)
  are gone. `TRADES_PER_HOUR = 10` offers per sender (a `RateLimiter` like `applications`,
  `server/src/actors/town.ts:166`). Not to yourself, not to a bot or an unknown id.
- **Accepting re-checks everything** (both balances, both sides' ownership) under `serial`, then moves
  coins and items in one transaction. If anything changed since the offer, it fails with a clear reason
  and the offer stays.
- **Coins** move through the `ledger`, kind `trade`, one ref per trade, so the ref sums to zero, as the
  table's comment requires.
- **Items** move by deleting the giver's `purchases` row and inserting one for the receiver at price 0.
  Balances are `earned − Σ purchases.price + ledger` (`coins.ts:31`), so deleting the giver's row would
  refund them; a ledger row for the giver of `−price`, kind `trade`, same ref, keeps their balance where
  it was. A price-0 row moving on later costs nothing and needs no ledger row.
- **Wearing it?** When an item leaves you, its slot in your look goes to 0, so nobody wears what they
  don't own.
- A finished trade can't be undone. The economy is closed (nothing cashes out), so trading with your own
  alt gains nothing; the rate limit covers spam.

## Data

`server/src/town/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS trades (
  from_id INTEGER PRIMARY KEY, to_id INTEGER NOT NULL,
  give TEXT NOT NULL, want TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS trades_to ON trades (to_id, at);
```

`core/src/shop.ts`:

```ts
export interface Side { coins: number; items: string[] }
export const TRADE_COINS_CAP = 500;
export const TRADE_ITEMS_CAP = 4;
/** Null unless coins is an integer in range and every item is a priced shop item, no repeats. */
export function parseSide(raw: unknown): Side | null;
export const emptySide = (s: Side): boolean => s.coins === 0 && s.items.length === 0;
```

`server/src/town/coins.ts`:

```ts
export interface Trade { fromId: number; from: string; toId: number; to: string; give: Side; want: Side; at: number }
/** Moves `give` from `from` to `to` and `want` the other way, in one ref. Run it serialized. Throws `too_poor` / `not_owned` / `owned`. */
export async function settleTrade(sql, trade: Trade, now): Promise<void>;
```

`Profile` (`boards.ts:70`) gains `owned: string[]` (priced items only), so the trade panel can list what
the other person has.

The `notice` event grows from a string to `{ text, open?: "company" | "trades" | "shop" }` so a toast can
open the right panel (`web/src/hud/Hud.tsx:240` opens `company` on every click today). `notify`
(`server/src/town/sync.ts:56`) and `world.notify` (`world.ts:503`) pass it through.

## Server

`server/src/actors/town.ts`:

- `offerTrade(toId, give, want)`: `requireUser`; `toId` is a number, not me, and `userById` finds it;
  `parseSide` both (`invalid_trade`); not both empty; I own every `give.items` and none of `want.items`,
  they own every `want.items` and none of `give.items` (`not_owned` / `owned`); `give.coins ≤` my balance
  (`too_poor`); the rate limiter (`rate_limited`); `INSERT OR REPLACE INTO trades`. Then
  `notify(client, toId, { text: "ada offers you a trade.", open: "trades" })`.
- `trades()`: `{ incoming: Trade[], outgoing: Trade | null }` with names, newest first, dropping rows past
  `TRADE_TTL` (and deleting them on the way).
- `acceptTrade(fromId)`: I must be its `to_id` (`not_found` otherwise, or when expired); under `serial`:
  `settleTrade`, delete the row; then `pushPlayers` for both (looks may have changed) and
  `notify(fromId, { text: "bo accepted your trade.", open: "shop" })`; return my wallet.
- `declineTrade(fromId)`: delete; `notify(fromId, { text: "bo passed on your trade." })`.
- `withdrawTrade()`: delete mine.
- `deleteUser` (`admin.ts:227`) deletes trades from and to the account.

`settleTrade` in `coins.ts`, inside one `sql.transaction`:

1. Re-check: `wallet(from).balance ≥ give.coins`, `wallet(to).balance ≥ want.coins`; `ownedItems` both ways
   as in `offerTrade`.
2. Coins: for `give.coins` → `(from, −n)`, `(to, +n)`; for `want.coins` the mirror. Skip zeros. Kind `trade`,
   ref `trade:<from>:<at>`.
3. Items, each direction: `SELECT price FROM purchases WHERE user_id = ? AND item = ?`; `DELETE` it; if
   `price > 0`, ledger `(giver, −price)`; `INSERT INTO purchases (receiver, item, 0, now)`.
4. Looks: for each giver, `parseLook` their `users.look`; for every item that left, set `look[item.slot] = 0`
   if it was `item.index`; `UPDATE users SET look`.

## Client

- `web/src/net.ts:115`: `conn.on("notice", (n: Notice) => hud.set({ notice: { ...n, at } }))`;
  `NoticeToast` opens `n.open` when set, otherwise just dismisses.
- `web/src/hud/PlayerCard.tsx`: `🔁 Trade` next to `🎮 Invite to a game` (not on your own card), opening
  `{ kind: "trade", userId }`.
- `web/src/hud/TradePanel.tsx`, `{ kind: "trade", userId }`: two columns. **You give:** a coins input and
  pills of my priced items (`wallet.owned` minus level items). **You get:** a coins input and pills of
  their `profile.owned`. `Offer` → `town.offerTrade`, then `Sent. They'll get a toast.` `useRun` for busy
  and errors.
- `web/src/hud/TradesPanel.tsx`, `{ kind: "trades" }`: my incoming offers, each with both sides spelled
  out (`🪙 50 + Shades  ⇄  Duck`) and Accept / Decline; my outgoing with Withdraw. Opened from the toast,
  and a `🔁 Trades` line in the menu panel.
- `Panel` in `web/src/store.ts` gains both kinds; the switch in `Hud.tsx:159` renders them.

## Tests

- `server/test/ledger.test.ts`: `settleTrade` with coins both ways nets the difference and the ref sums
  to 0; with an item one way the giver's balance is unchanged, the receiver owns it, the ref sums to
  `−price`; a price-0 item traded on again adds no ledger row; the giver can `buy` the item back
  afterwards; `too_poor` when the giver's balance dropped since the offer; `owned` when the receiver
  bought it meanwhile.
- `server/test/town.test.ts`: `offerTrade(me, …)` rejects; both sides empty rejects `invalid_trade`;
  offering a level reward rejects `invalid_trade`; the receiver gets a `notice` event
  (`event(...)` from `server/test/rivet.ts`) with `open: "trades"`; `acceptTrade` moves a worn hat and
  the giver's `me().look.hat` is 0 afterwards; a second offer replaces the first in `trades()`; the
  eleventh offer in an hour rejects `rate_limited`; `declineTrade` notifies the sender.

## Deliberate limits

- `ponytail:` items live in `purchases` and their value follows them through the ledger. If that ever
  reads wrong at 3am, the upgrade is an `items (user_id, item)` table for ownership with `purchases` left
  as spend only.
- `ponytail:` no counter offers. Decline and send your own.
- No message with the offer, no trade history on the card. Chat is right there.

## Open questions

- Should the coin cap be higher than a stake's 500? Trades aren't a bet, so a bigger cap is harmless; 500
  just keeps a fat-finger from emptying a wallet.

## As built

- `acceptTrade(fromId, at)` takes the offer's `at`, so an offer swapped meanwhile isn't accepted unseen.
- `settleTrade` deletes the offer inside its transaction, so it can't settle twice.
- `deleteUser` ignores `trade` refs in its unsettled-game check: an item's ref sums to minus its price.
- Arcade toasts carry no `open`.
- Both panels live in `web/src/hud/Trades.tsx`.
- The trade panel lists their items from `town.tradeables(userId)`; `Profile` has no `owned`.
