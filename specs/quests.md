# Daily quests

Two small goals, the same two every day, paid in coins. They turn "burn tokens" into "do this today",
and they use nothing but the rollups the town already keeps.

Netstationen tied rewards to quests; here the quests say what a good day looks like.

## Rules

- **The same two quests every day.** No rotation, no pool. (Four shipped first; "Burn 500M tokens" and
  "Open 2 pull requests" were cut on 2026-10-16, so a day pays at most 7.)
- **Nothing is stored.** Whether a quest is done is worked out from `usage_daily` and `activity_daily` for
  that day, the way coins are worked out from usage (`server/src/town/coins.ts:31`). Only days from the
  day you signed up count, same rule as coins; a late sync still pays.
- A quest completes when its check passes. No claiming. The toast is the client noticing.
- At most 7 coins a day on top of the usual pay: a side dish, not the meal.

| Id | Text | Coins | Check on the day's facts |
|---|---|---|---|
| `parallel` | Run 5 agents at once | 5 | `peakAgents >= 5` |
| `hours` | Keep agents running for 2 hours | 2 | `activeBuckets >= 24` |

## Data

```ts
// core/src/quests.ts
export interface DayFacts { tokens: number; peakAgents: number; activeBuckets: number }
export interface Quest { id: string; text: string; coins: number; done: (f: DayFacts) => boolean }
export const QUESTS: readonly Quest[];
export const EMPTY_DAY: DayFacts = { tokens: 0, peakAgents: 0, activeBuckets: 0 };
/** Coins a day paid: the sum over the quests that `done`. */
export const questCoins = (f: DayFacts): number;
```

`Wallet` (`coins.ts:7`) gains `quests: { id; text; coins; done }[]` for today. No schema change.

## Server

`server/src/town/coins.ts`:

- `wallet()` already reads tokens per day (`days`). Add one query for activity per day:
  `SELECT day, peak_agents AS peakAgents, active_buckets AS activeBuckets FROM activity_daily WHERE user_id = ? AND day >= ?`
  (`activity_daily` has one row per user and day, `schema.ts:34`). Merge the two by day into `DayFacts`.
- `earned += Σ questCoins(facts)` over those days; `quests` is `QUESTS` mapped with
  `done(facts.get(today) ?? EMPTY_DAY)`.
- `balances()` (the admin page) gets the same sum, grouped by user, from the same two tables.

That is the whole server change. `report` already replaces the day's rollups, so a sync completes quests
the moment it lands.

## Client

- `web/src/hud/Shop.tsx`, under the wallet line: `📜 Today's quests`, two rows with ✓ or ○, text and
  `🪙 n`. The wallet is already fetched there.
- Toast: `QuestToast` in `Hud.tsx` keeps the set of done quest ids from the last `wallet`
  (`hud.wallet`, refreshed after every sync and every 30 s, `web/src/net.ts:157`). A new id shows
  `✓ Run 5 agents at once · 🪙 5`; click opens the shop. The first wallet after load sets the baseline.
- Optional: `1/2 📜` in the HUD corner next to today's coins, opening the shop.

## Tests

- `core/test/quests.test.ts`: every quest is false on `EMPTY_DAY`; each is true at its threshold and false
  one below; `questCoins` of a full day is 7.
- `server/test/ledger.test.ts`: insert an `activity_daily` row with `peak_agents = 5` on a day after
  sign-up, and `wallet().balance` rises by 5; the same row on a day before sign-up pays nothing;
  `wallet().quests` for today has `done: false` ×2 for a fresh user and `done: true` for `parallel` after a
  day with 5 agents at once.

## Deliberate limits

- `ponytail:` fixed thresholds. 500M is a quiet day for a heavy user and a big one for a light user. Scale
  them to the player's 30-day median if it matters.
- `ponytail:` one more `GROUP BY day` query per `wallet()`. Wallets are already recomputed per call
  (ARCHITECTURE.md, Known limits).
- No weekly quests, no streak bonus, no social quests (visiting, chatting live in `world`, which `town`
  can't see). Social quests need `world` to report to `town`; add `town.event(userId, kind)` then.

## Open questions

- None.
