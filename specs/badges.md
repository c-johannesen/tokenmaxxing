# Badges

A row of earned marks on the player card, worked out on read from tables the town already has. The card
is what people click in chat; this gives it a trophy wall.

A level and a title say how far you've come; badges add
the things a level can't say (streaks, podiums, parallelism, games).

## Rules

- A badge is a pure function of a player's facts. No table, no claiming, no notifications in v1.
- Each badge has **thresholds**; the card shows the highest one met, as `🔥 30-day streak`. Below the first
  threshold it isn't shown at all.
- Badges are computed in `profile()` only (`server/src/town/boards.ts:170`), so the leaderboard and
  `world` don't pay for them.

| Id | Emoji | Name | Thresholds | Fact |
|---|---|---|---|---|
| `streak` | 🔥 | Streak | 7, 30, 100 days | current run of world days with tokens, ending today or yesterday |
| `bigday` | 🧠 | Big day | 1B, 5B, 10B tokens | best single day |
| `podium` | 🏆 | Podium | 1, 10, 50 | days finished in the top 3 |
| `octopus` | 🐙 | Octopus | 5, 10, 20 agents | best `peak_agents` |
| `shipper` | 🚢 | Shipper | 10, 50, 250 PRs | lifetime `prs` |
| `shark` | 🦈 | Shark | 5, 25, 100 wins | game wins |
| `whale` | 🐋 | Whale | 500, 2000 | biggest pot won |
| `founder` | 🏢 | Founder | owns a company | `companies.owner_id` |

## Data

```ts
// core/src/badges.ts
export interface BadgeFacts {
  streak: number; bestDay: number; podiums: number; peakAgents: number; prs: number;
  wins: number; biggestPot: number; founder: boolean;
}
export interface BadgeDef { id; emoji; name; /** Ascending; the label for each. */ tiers: { at: number; label: string }[]; of: (f: BadgeFacts) => number }
export const BADGES: readonly BadgeDef[];
export interface Badge { id; emoji; label; /** 1-based tier reached. */ tier: number }
export function badgesFor(f: BadgeFacts): Badge[];
/** Current streak from the set of `YYYY-MM-DD` days with tokens: counts back from `today`, or from yesterday if today has none yet. */
export function streakOf(days: Set<string>, today: string): number;
```

`Profile` (`boards.ts:70`) gains `badges: Badge[]`.

## Server

`boards.ts` `profile()`:

- Days and best day: `SELECT day, SUM(tokens) FROM usage_daily WHERE user_id = ? GROUP BY day` (the
  `daily` query there covers 30 days; this one is all time, one more query).
- `podiums`: the places query from `wallet()` (`coins.ts:43`), moved into a shared `podiumDays(sql, userId, now)`
  so both use it. Note it applies the sign-up-day rule too.
- `peakAgents`, `prs`: `MAX(peak_agents), SUM(prs)` over `activity_daily` for the user, all time.
- `wins`, `biggestPot`: already in `gameStats` (`server/src/town/games.ts:57`).
- `founder`: `SELECT 1 FROM companies WHERE owner_id = ?`.
- `badges: badgesFor(facts)`.

## Client

`web/src/hud/PlayerCard.tsx`, under the level line: a `<ul className="badges">` of chips, `🔥 30-day streak`,
each with `title` = the next tier ("100-day streak next"). Nothing when empty. One CSS rule in `hud.css`.

## Tests

- `core/test/badges.test.ts`: `streakOf` counts back from today, counts from yesterday when today is empty,
  and breaks on a gap; `badgesFor` with zero facts is `[]`; a 31-day streak gives tier 2 with the 30-day
  label; `founder` is tier 1.
- `server/test/town.test.ts`: a company owner's `profile()` includes `founder`; after reporting 1B tokens
  on one day, `bigday`.

## Deliberate limits

- `ponytail:` four small queries per profile. Fine for a card; cache per user if the card gets polled.
- No "new badge" toast and no badge in `PlayerInfo` for the world (a crown over the head). Both are later;
  the toast follows the level-up toast pattern in `specs/level-rewards.md`.

## Open questions

- Should the first-ever podium show in chat as a town line (`sayAsTown`, `world.ts:656`)? Cheap and public,
  but it needs `town` to know when a day closes, which nothing does today.
- `officer` for a furnished office once `specs/offices.md` ships.
