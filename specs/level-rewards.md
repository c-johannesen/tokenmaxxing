# Levels to 30, and level rewards

Thirty levels instead of thirteen, Singularity at 30, and a piece of gear nobody can buy at 10, 20 and 30.
The XP bar already says "next level in N tokens"; this gives it a long ladder and something at the end of it.

Netstationen: every level had a claimable reward. Here only the big three do; the rest are titles.

## The ladder

Levels 1 to 9 keep roughly today's shape (one level per ×3), level 10 is 10B, and from there it's one
level per billion lifetime tokens up to 30. A table replaces the formula in `core/src/format.ts:21`.

| Level | Lifetime tokens | Title |
|---|---|---|
| 0 | 0 | Newcomer |
| 1 | 1M | Prompt Intern |
| 2 | 3M | Context Goblin |
| 3 | 10M | Cache Enjoyer |
| 4 | 30M | Agent Wrangler |
| 5 | 100M | Subagent Shepherd |
| 6 | 300M | Token Baron |
| 7 | 1B | Gigamaxxer |
| 8 | 3B | Context Lord |
| 9 | 6B | Teramaxxer |
| 10 | 10B | Petamaxxer |
| 11 | 11B | Datacenter Tycoon |
| 12 | 12B | Compute Overlord |
| 13 | 13B | Examaxxer |
| 14 | 14B | Rate Limit Survivor |
| 15 | 15B | Cluster Captain |
| 16 | 16B | GPU Hoarder |
| 17 | 17B | Zettamaxxer |
| 18 | 18B | Inference Warlord |
| 19 | 19B | Hyperscaler |
| 20 | 20B | Yottamaxxer |
| 21 | 21B | Benchmark Breaker |
| 22 | 22B | Transformer Tamer |
| 23 | 23B | Foundation Model |
| 24 | 24B | Frontier Lab |
| 25 | 25B | Planetary Compute |
| 26 | 26B | Dyson Sphere |
| 27 | 27B | AGI Candidate |
| 28 | 28B | Superintelligence |
| 29 | 29B | Event Horizon |
| 30 | 30B | Singularity |

Titles 0 to 12 are today's. 13 was Singularity and gets a new name; 13 to 29 are new; 30 is Singularity.
Swap any name you don't like; the numbers are the spec.

Level 8 and 9 at 3B and 6B are my pick: steps of 2B, 3B, 4B into the 1B-a-level region from 10. The
alternative 2B and 5B works too.

## Rewards

- A **level item** is a shop item with a `level` and no price. You own it from the moment your level
  reaches `level`; there is nothing to claim and nothing to buy.
- Ownership is derived from lifetime tokens, like coins are derived from usage: no new table. A late sync
  that lifts your level unlocks the item; an admin usage wipe takes it back next time you change your look
  (what's already worn stays drawn; `setLook` is the only check).
- Level items never appear for sale. `buy` refuses them.
- Level 10 also opens your office (`specs/offices.md`); the level-up toast says both.

| Level | Title | Item | Slot |
|---|---|---|---|
| 10 | Petamaxxer | Top hat | hat 4 |
| 20 | Yottamaxxer | Server-rack armour | outfit 12 |
| 30 | Singularity | Singularity orb (a floating pet) | pet 6 |

Names and sprites are placeholders; the levels and slots are the spec. Three sprites is the real cost.

## Data

`core/src/format.ts`:

```ts
/** Lifetime tokens where each level starts; the index is the level. */
const LEVELS = [0, 1e6, 3e6, 10e6, 30e6, 100e6, 300e6, 1e9, 3e9, 6e9, ...Array.from({ length: 21 }, (_, i) => (10 + i) * 1e9)];
export const MAX_LEVEL = 30;
export const levelFor = (tokens: number): number => LEVELS.findLastIndex((at) => tokens >= at);
/** Infinity past the top, so "next level" maths can't divide by zero. */
export const levelAt = (level: number): number => LEVELS[level] ?? Infinity;
// LEVEL_TITLES: the 31 titles above; levelTitle keeps clamping (bots are level 99 and 100, core/src/bots.ts:47).
```

`core/src/shop.ts`:

```ts
export interface Item { id; slot; index; name; price; /** Owned from this level on; never sold. */ level?: number }
const reward = (slot, index, name, level): Item => ({ id: `${slot}.${index}`, slot, index, name, price: 0, level });
// appended to ITEMS:
reward("hat", 4, "Top hat", 10), reward("outfit", 12, "Server-rack armour", 20), reward("pet", 6, "Singularity orb", 30),
/** The level items `level` has earned. */
export const levelItems = (level: number): Item[] => ITEMS.filter((i) => i.level !== undefined && i.level <= level);
```

`core/src/world.ts:55` `LOOK_OPTIONS`: hat 4 → 5, outfit 12 → 13, pet 6 → 7. `parseLook` and `defaultLook`
need no change (`defaultLook` picks outfits `% 8`).

## Server

Every caller of `levelFor` (`boards.ts`, `users.ts`, `companies.ts`, `admin.ts`) just gets new numbers.

- `server/src/town/coins.ts` `wallet()`: `owned` becomes purchases ∪ `levelItems(levelFor(lifetime))`. Lifetime
  tokens come from `tokensIn(sql, [userId])` (`server/src/town/users.ts:38`), one extra query.
- `server/src/actors/town.ts` `setLook`: build `owned` from `wallet(...).owned` instead of `ownedItems`, so
  level items pass the "Buy it in the shop first" check.
- `town.ts` `buy`: `if (item.level !== undefined) throw new UserError("That one is earned, not bought.", { code: "not_for_sale" })`.

## Client

- `web/src/art/characters.ts` (hats are drawn around `:362`), `web/src/art/pets.ts`: the three sprites.
  The orb is a pet so it follows you like the others.
- `web/src/hud/PlayerCard.tsx:86` and the `XpBar` at `:132`: at `MAX_LEVEL` the bar is full and the line
  reads `Max level`. Otherwise unchanged. Under "Next: …", `Reward at Lv20: Server-rack armour` for the
  nearest level item not yet reached.
- `web/src/hud/Shop.tsx`: level items show in their slot tab. Owned: the usual Wear / Take off. Not yet:
  a disabled `🔒 Lv 20` button instead of a price.
- Level-up toast: a `LevelToast` in `Hud.tsx` keeps the last seen `stats.level` (`hud.stats` is
  `Today["me"]`, refreshed every 30 s and after each sync, `web/src/net.ts:157`). When it rises:
  `⬆️ Level 14 · Rate Limit Survivor`; at 10, 20 and 30 add `You unlocked the Top hat` (and at 10,
  `and your own office`). Clicking opens the shop. The first value after load sets the baseline and
  shows nothing.
- The menu bar shows `Lv{n}` from `today.level` (`app/desktop/src-tauri/src/tray.rs:217`); nothing to change.

## Tests

- `core/test/format.test.ts:29`: rewrite the expectations: `levelAt(10)` is 10B, `levelAt(30)` is 30B,
  `levelAt(31)` is `Infinity`, `levelFor(31e9)` is 30, `levelTitle(30)` is Singularity, `levelTitle(13)`
  is Examaxxer, and the round trip `levelFor(levelAt(n)) === n` for 1 to 30.
- `core/test/shop.test.ts` (new): `levelItems(10)` is the top hat, `levelItems(30)` all three,
  `levelItems(9)` empty; every level item has `price: 0` and an index inside `LOOK_OPTIONS`.
- `server/test/town.test.ts`: report 10B tokens for a user (`as(token).town.report(...)` as the usage tests
  do), then `setLook({ ..., hat: 4 })` works, `buy("hat.4")` rejects `not_for_sale`, and a fresh user's
  `setLook({ ..., hat: 4 })` rejects `not_owned`. `wallet().owned` lists `hat.4` for the first user.

## Out of scope

- Claiming, a rewards inbox, rewards past 30, coin bonuses per level.
- Re-sorting titles 0 to 12 to match the new token numbers (Gigamaxxer still lands at 1B; the rest were
  never literal).

## Open questions

- None that block. Names 13 to 29 and the three item names are yours to swap.

## As built

- The toast's office line is gated on having a company; without one it says
  `· Join a company for your own office`.
- `setLook` checks `ownedIds` (purchases and level items, two queries), not the whole `wallet`.
