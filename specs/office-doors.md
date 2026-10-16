# Offices in the company building

A change to `specs/offices.md` as built. Today the building has one door that leads to *your own* office,
and colleagues' offices are reached only from their player card. Instead, the building houses every
office: when a member reaches level 10, a door with their name on it appears inside the building, and
anyone in the building walks through it (if the office is open). Employees can always get to their
company building; the offices are in it.

## Rules

- **One door per office**, inside the building, with the owner's name over it. A member gets a door the
  moment their level reaches `OFFICE_LEVEL` (10); it goes when they leave the company or lose the level.
  No door, no office: the level gate notice (`🔒 Your own office opens at level 10`) goes away.
- **The building grows** by one hallway for every 10 doors. A hallway is three rows above the floor you
  know: a wall top, a wall face with doors at every other tile (10 per hallway), and a corridor. Hallways
  are added *above*, with negative `y` like the town's blocks (`GameMap.y0`, `core/src/maps.ts:52`), so
  every tile the building has today keeps its coordinates and nobody stands in a wall after a rebuild.
  With no level-10 members the building is exactly today's map without the `R` tile.
- **Doors are ordered** by user id, so they don't shuffle when someone new arrives: a new door takes the
  next free slot; a door that goes leaves its slot to the next arrival. ponytail: slots are never
  compacted, so a long-lived company can have gaps; fine.
- **Stepping into a door** takes you to that owner's office, if it's open or yours; a closed one says
  `🔒 bo's office is closed.` and you stay put.
- **The exit of an office** puts you below that owner's door, in their building, if you're a member of
  that company. Otherwise (you came in from the owner's card) it's your own building's entry, or the
  Inn's, as today.
- **The player card's `🚪 Visit office`** stays: it's how someone outside the company gets in, with the
  owner's consent being the open flag. Inside the company it's a shortcut.
- Everything about the office itself is unchanged: `office:<userId>` rooms, furniture, the editor,
  open/closed, `setOffice`, `Profile.office`.

## Data

`core/src/office.ts`:

```ts
/** A door in a company building: whose office, and where. */
export interface Door { userId: number; name: string; x: number; y: number }
export const DOORS_PER_HALLWAY = 10;
/** The building with a hallway of doors per 10 offices, above today's floor (negative y). */
export function hqMap(doors: readonly Door[]): GameMap;
/** Door slots for these owners (sorted by id): slot n is hallway ⌊n/10⌋, tile 1 + 2·(n mod 10). */
export function doorsFor(owners: readonly { userId: number; name: string }[]): Door[];
export const HQS = new Map<number, GameMap>();
export function setHq(companyId: number, doors: readonly Door[]): GameMap;
/** The door at (x, y) in a building, if any. */
export const doorAt = (doors: readonly Door[], x: number, y: number): Door | undefined;
```

`core/src/maps.ts`: the `R` tile comes out of the `hq` rows; `LEGEND.R` stays (`portal`, name "office door").
`MAPS.hq` is the floor without doors; `hqMap` builds on it.

`core/src/world.ts`:

- `mapOf(`hq:${id}`)` returns `HQS.get(id) ?? MAPS.hq`.
- `portal(room, door, companyId, plots, userId, doors)`: an `R` in a building → `roomEntry(`office:${doorAt(doors, x, y).userId}`)`;
  leaving `office:<owner>` → below the owner's door in `hq:<companyId>` when that building has it, else
  `roomEntry(`hq:${companyId}`)`, else the Inn. The open/closed check is the actor's (it has the flag).
- `Snapshot` gains `doors: Door[]` (only in a building; `[]` elsewhere) so the client can build the map
  and draw the names.

## Server (`server/src/actors/world.ts`)

- `doorsOf(s, companyId)`: members of that company with `level >= OFFICE_LEVEL`, by id, through
  `doorsFor`. `buildHq(s, companyId, dirty)`: `setHq` and, like `buildTown`, move anyone in that room who
  is now inside a wall to `roomEntry` (can't happen with negative-y growth, but it's the same guard).
- Rebuild a company's building when it can change: `setPlayer` (level crossed 10 either way, company
  changed: both old and new), `removePlayer`, `removeCompany`, and on start for every company. Then
  resend the snapshot to everyone in that building (the "changed room" helper).
- `step`: drop the `R` level gate. Before `portal`, if the target is `R` in a building: find the door;
  if the owner isn't me and the office is closed, return the closed notice.
- `visit` is unchanged.
- `snapshot()` fills `doors` for a building.

## Client

- `web/src/game/world.ts` `loadSnapshot`: `setHq(companyId, s.doors)` before `showMap`, as it does for
  furniture. Keep `world.doors` for drawing.
- `web/src/game/labels.ts`: a small name over each door, the way `sign` draws a house's sign; nothing
  fancy. Closed offices get a `🔒` before the name (the client knows only names and positions, so add
  `open: boolean` to `Door`).
- `web/src/art/tiles.ts`: the hallway's wall face above the doors already draws right (the `R` rule).
- `OfficePanel` and `PlayerCard` are unchanged.

## Tests

- `core/test/office.test.ts`: `doorsFor` puts 11 owners into two hallways at the right tiles and keeps
  ids sorted; `hqMap([])` equals the floor; `hqMap` with 3 doors has `R` at those tiles, `_` corridor
  below and `W` above, and `y0 === -3`; `MAPS.hq` has no `R`.
- `core/test/world.test.ts`: `portal` through bo's door lands in `office:bo`; the exit lands below bo's
  door for a member and at the Inn for a freelancer.
- `server/test/world.test.ts`: a level-10 member's door shows in the building's snapshot and a colleague
  walks through it; after `setOfficeOpen(false)` the step returns the closed notice and the owner still
  gets in; a level-0 member has no door; leaving the company removes the door.

## Out of scope

- Offices as cubicles drawn inside one shared building map (walk in, see colleagues at their desks). It's
  the more vivid version and the bigger rewrite: furniture for every member in one map, editor offsets,
  the building becomes a tower past a dozen members, and open/closed becomes door locking. Doors with
  nameplates get the same "walk from the building into an office" with what's already built.
