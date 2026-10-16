# Architecture

tokenmaxxing is a small pixel-art town for people who run AI coding agents. The desktop app syncs your token
usage from the menu bar and shows the town in its window. Everyone is in **one world**. You work for at most one **company**, which has a house in
town; when you're not playing, your character sleeps in its bed, or sits at its desk while your agents run.

```
Tokenmaxxing.app (Tauri v2, app/desktop)             server (one Railway service)
├─ menu bar: ⚡ tokens today, menu                   Bun.serve (server/src/main.ts)
├─ sidecar: TS helper ◄─ NDJSON ─► Rust ───────────►  ├─ /               the marketing site (site/, Astro, built in the image)
│    parses logs, player.ingest()                     ├─ /play           the game (web/, bundled at boot)
│                                                     ├─ /admin          the admin page (web/admin.html)
│                                                     ├─ /logos/:file    company logos (sandboxed)
├─ game window: Canvas 2D world + React HUD           ├─ /health
│    (the live page, over WebSocket) ◄─────────────►  └─ /api/rivet/*    proxy to the Rivet engine (gateway only)
└─ Keychain, login item, updater                      Rivet engine on 127.0.0.1, actors in this process,
                                                      storage on the /data volume
```

The game also runs in any browser; the app's window is that same page, at `/play`.

| Path | What |
|---|---|
| `core/` | Log parsers and sync, the shell↔helper protocol, `world.ts` (shared rules), `maps.ts` (the maps), `shop.ts` (coins and items), `office.ts` (offices and furniture), `games/` (every game's rules), `format.ts`, `range.ts` |
| `server/src/actors/` | The actors (`player`, `town`, `world`, `arcade`, `match`), `registry.ts`, `shared.ts` (auth and SQL helpers) |
| `server/src/town/` | What `town` does, as plain functions: `users`, `companies`, `boards` (leaderboards, profiles, the HUD's corner), `games` (game stats), `coins`, `sync` (pushes to `world`) |
| `server/src/` | `main.ts`, `proxy.ts`, `headers.ts` (CSP and friends), `brand.ts` (websites → house colours and logos), `pricing.ts`, `stats.ts`, `validate.ts` |
| `web/src/` | `game/` (canvas loop, input, camera, houses, labels, pets), `art/` (every sprite, drawn in code), `hud/` (React panels) |
| `app/helper/` | The sync helper: log parsing and `player.ingest`, run by the app as a sidecar |
| `app/desktop/` | The desktop app (Tauri v2): the menu bar, the game window, updates |
| `site/` | The marketing site at `/` (Astro, static): `bun run site:dev` to work on it, `bun run site:build` before serving it |

## Serving

- `main.ts` bundles the game with `Bun.build`, *then* starts the registry. Once RivetKit's native runtime is
  up, Bun's HTML bundler fails in the same process, so there's no hot reload: restart `bun run dev`.
- `registry.start()` runs the Rivet engine on `127.0.0.1`. `proxy.ts` forwards only the client gateway
  (`/api/rivet/gateway/*` and `/metadata`, HTTP and WebSocket); the engine's admin API is never exposed.
- The gateway would let a browser create any actor, with any key and input. `gatewayAllowed` lets through
  only existing actors (by id, or `get` by key) and `getOrCreate(["main"])` of `town`, `world` and `arcade`,
  with no input. The actors check too: `player` and `match` refuse to be created without `INTERNAL_KEY` in
  their input (`fromInside`), and the singletons refuse any key but `main` (`requireMain`). Otherwise
  anyone could make `player[<the next id>]` with their own token and own the next account.
- Per client IP, the proxy allows 1,200 gateway requests and 300 new WebSockets a minute
  (`GATEWAY_REQUESTS_PER_MIN`, `GATEWAY_SOCKETS_PER_MIN`). The IP is `CLIENT_IP_HEADER` (`x-real-ip`, set by
  Railway's edge) or the socket's; the proxy passes it on to actors as `x-tokenmaxxing-ip`, replacing any
  the client sent.
- `/play` and `/admin` send a CSP (`headers.ts`): our own scripts only, connections only back to us (and the
  desktop app's IPC for the game), no framing. The page files aren't served at their own paths.
- `RIVETKIT_STORAGE_PATH` and `RIVET_LOG_LEVEL` must be real environment variables: RivetKit's native side
  ignores `process.env` changes made at runtime. The Dockerfile and `bun run dev` set them.
- Company logos live next to the Rivet data (`/data/logos` in Docker, `.data/logos` in dev).
- A sync batch is about 300 KB, so `maxIncomingMessageSize` is 1 MB. Shutdown grace is 5 s.

## Auth

- Tokens are `<userId>.<secret>`; the `player` actor stores `sha256(secret)`. Other actors check a token by
  asking that player (`authenticate` in `shared.ts`, cached for a minute) and trust only the caller they get.
- Actors call each other with an in-process `INTERNAL_KEY`.
- **Open world:** the app's window loads `/play`. With no session, the page asks the app (`enter_world`), whose
  helper mints a one-time login code (2 minutes); the page redeems it for a 30-day session. With no account
  yet, the page asks for a name first and the app signs up. The device token never leaves the app.
- A browser can still be signed in with `/#code=…`: the page redeems the code and removes it from the URL.
- The app forgets its token when the server rejects it and goes back to picking a name.
- There's no web sign-up: in a browser, without a session the page says to open the world from the app.
- **Linked computers** (a second machine running agents; see `WORKHORSE.md`). The app mints a link code
  (`mintLinkCode`, 10 minutes, single use); the other computer trades it for its own token
  (`redeemLinkCode`). That token only syncs: it can `ingest` and read `town.today` and `arcade.battle`
  (`requireSyncer`), and `requireUser` refuses it everywhere else. The player lists them (`devices`) and
  removes them (`revokeDevice`); a computer can remove only itself, and nobody can remove the app's own.
- **Admin:** `/admin#token=…` keeps the token in `localStorage`, drops it from the URL, and connects to `town`
  with `{ admin: token }`. A fragment never reaches the server, so the token stays out of logs (`?token=`
  works too, but does reach it). `authenticate` checks it against `ADMIN_TOKEN` (constant time; unset lets
  nobody in, and under 32 characters fails the boot). Only `town`'s `admin*` actions accept that caller.
- Login codes, link codes and sessions are capped per player (5 live codes of each kind, 20 sessions; the
  oldest go first).

## The desktop app

`app/desktop/src-tauri/src/`, in Rust:

- **`helper.rs`** runs the helper sidecar (Bun-compiled) and speaks the NDJSON protocol in
  `core/src/protocol.ts`: `init`, `signUp`, `syncNow`, `openWorld` (a login code) and `linkComputer` (a link
  code and the line that uses it), and `state` and `token` events. It
  restarts the helper with backoff. A fixture written by `app/helper/test/protocol.test.ts` keeps the Rust
  types and the TypeScript ones in step.
- **`tray.rs`**: the menu bar. The bolt is a template image with today's tokens as its title. Its menu:
  - Open world;
  - your rank and level, today's tokens per source (Claude Code, Codex, …, as the server has them), and the
    battle you're in;
  - Sync now;
  - Link a computer… (copies the line to run on the other computer);
  - Launch at login;
  - updates;
  - Quit.

  It's rebuilt from the helper's state after every sync: every 2 minutes, or every 10 seconds during a battle.
- **`world.rs`**: the game window, the app's only window.
  - It loads the live page (`/play`) once the helper knows whether there's an account, and opens by itself
    when there isn't one. It stays on the server's origin; other links open in the browser.
  - The page, from the server's origin only, may sign itself in (`enter_world`: a login code, after signing
    up if it's given a name), ask about app updates and start one (`update_status`, `install_update` and
    their `app-update` event), and get the line that links another computer (`link_computer`). The capability is added in `lib.rs`, since it names the server. App commands
    are otherwise denied (`build.rs`).
  - The app is in the Dock only while the window is open (`LSUIElement`, then the activation policy).
- **`keychain.rs`**: the device token, in the login Keychain as `dk.hanskristoffer.tokenmaxxing` /
  `api-token`. Dev builds use `….dev` and their own state dir.
- **`updates.rs`**: Tauri's updater. It checks `latest.json` on this repo's latest release on launch and every
  hour. With no window open, a new version installs right away and the app restarts. While the game is open,
  it waits: the game shows an "Update" button (`web/src/hud/AppUpdate.tsx`) and the menu an "Update to…"
  item, and it installs when either is clicked or the window closes. After an update started with the game
  open, the game opens again. Downloads must be signed with the key in `TAURI_SIGNING_PRIVATE_KEY`, and the
  release job checks the published one against the app's public key before anyone installs it.
- **Plugins:** single-instance (a second launch opens the world), window-state, autostart (a LaunchAgent) and
  log.
- **The server URL** is baked in at build time (`TOKENMAXXING_SERVER_URL`). A release build refuses to build
  without it; a dev build uses `localhost:8787`.

## Linked computers

A second computer running agents syncs into the same player (`WORKHORSE.md`).

- **The CLI** (`app/helper/src/cli.ts`) wraps the same `Helper` as the app: `link`, `run`, `sync`, `status`,
  `logs`, `unlink`. Its token and read positions are in `~/Library/Application Support/Tokenmaxxing CLI/` or
  `$XDG_CONFIG_HOME/tokenmaxxing/` (`TOKENMAXXING_CLI_DIR` for tests), the token readable only by its user.
  It won't link on a Mac where the app syncs already.
- **The service** (`service.ts`): a LaunchAgent, or a `systemd --user` unit with lingering on, so it runs
  while nobody's logged in. Both carry the `PATH` and log-location variables from when it was linked, and
  restart it only when it fails: once its token is revoked, it removes itself and exits cleanly.
- **Installing** (`server/src/install.sh`, served at `/install.sh` with the server's own origin filled in):
  picks the binary for the OS and CPU, checks it against `SHA256SUMS` from the latest release, and runs it
  with its arguments. The binaries are `bun build --compile` output (`app/helper/scripts/cli.sh`), built on a
  Mac so the Mac ones are signed ad hoc; curl doesn't quarantine what it downloads.
- **The game** shows your computers on your own card (`web/src/hud/Computers.tsx`) and removes them; only the
  app's window can make a link code.

## Actors

**`player[userId]`**: raw events (SQLite, deduplicated), devices (the app and linked computers), sessions,
login codes and link codes. Events from every device land in the same table, so a linked computer's usage
counts everywhere with nothing else to add up. `ingest` stores a
batch, recomputes the touched world days (per-model sums, prompts, PRs, 5-minute agent buckets) and sends them
to `town.report`, then tells `world` how many agents are live, and `arcade.usage` in case they're in a battle.
- **The numbers come from the user's own machine,** so they're bounded rather than trusted: an event over 1B
  tokens in any field, or stamped over an hour ahead, is dropped (`validate.ts`); model names that aren't
  model-shaped count as `unknown` (they're shown on profiles). Each minute counts for at most 200M tokens
  (`USAGE_MINUTE_CAP`; a busy real day is ~1.5B): past it, that minute is scaled down and the rest goes in
  `capped_daily`, which flags the account on the admin page. That also keeps every `SUM` far below SQLite's
  64-bit limit, where it would throw and take the leaderboards down.
- Per player: 60 ingests a minute and 500,000 new events a world day. Past either, the app's sync fails and
  picks up where it stopped on its next run, so a big first sync is delayed, never lost.

**`town["main"]`**: everything cold, joined in SQL.
- Tables: `users`, `companies` (ids never reused), `usage_daily`, `activity_daily`, `capped_daily`,
  `purchases` (coins spent, per kind), `items` (one row per copy anyone holds), `rewards` (level rewards
  handed out), `ledger` (coins held and paid by games, and traded), `trades` (one open offer per sender),
  `offices`, `match_players` (one row per player per finished game), `deleted_users`, `admin_log`.
- Accounts: `signUp` (20 an hour per IP, 1,000 an hour in all), `rename` (10 an hour), `setLook` (refuses items you don't hold), `me`.
- Companies: create (on a plot the owner picks: any empty block next to the town, see `frontier` in
  `core/src/maps.ts`), leave, kick, rename, `setWebsite`. One company per person, at most 50 members. The
  earliest joiner takes over from a leaving owner; the last one out closes the company. The town is built from
  its companies' plots (`townMap`), so it grows as they start and shrinks, or gets a park, as they close.
- Joining: `listings` shows every company; `apply` asks to join one (one pending application per person,
  applying elsewhere replaces it); the owner will `approve` or `decline`, and `withdraw` takes it back. The
  owner hears about an application, and the applicant about the answer, through `world.notify` (a `notice`
  event, shown as a toast). A new player's first visit opens this choice.
- Stats: `leaderboard`, `profile`, `today` (the HUD's corner), `searchNames`, `gameBoard`. Cost is priced
  when read.
- Coins: `wallet`, `buy`, `bag`; for `arcade`: `hold`, `pay`, `refund`, `recordMatch`. Games: `gameBoard`.
- Trades: `offerTrade` (10 an hour; a new offer replaces your old one), `trades`, `acceptTrade`,
  `declineTrade`, `withdrawTrade`. See *Coins and the shop*.
- Offices: `setOfficeOpen` (your own; 30 a minute, since each one sends the office and its building to
  everyone inside). What's in an office is what its owner dropped there.
- Drops: `drop` (30 a minute) takes one of a kind out of your bag (not a reward; at most 5 of yours on the
  floor at once, not counting your own office's) and asks `world.placeDrop` to put it where you are; a full
  room says so, and the row comes straight back. On the floor a row has `owner_id` NULL, with `dropped_by`
  and `dropped_at`, and `room`, `x`, `y` once `world` has put it down (`placed`). `pickUp` (from
  `world.take`) puts it in the taker's bag, unless it's gone home already. **The sweeper** is a cron alarm
  (`sweep`, every 10 minutes; it outlives restarts and wakes the town): drops nobody took in an hour come
  off the floor (`world.removeDrops`) and go back to their droppers, except what's in its dropper's own
  office: that's furniture. A closed company's building and a deleted owner's office give theirs back at
  once (`removeCompany` and `removePlayer` return the ids); a deleted account's own drops are deleted with
  it, office furniture and all.
- Admin (`town/admin.ts`, for `/admin`): `adminOverview`, `adminUsers` and `adminCompanies`; rename people
  and companies; set a balance (the difference goes in the `ledger` as kind and ref `admin`); take someone
  out of their company; close a company; wipe someone's usage (their `player` drops its raw events too:
  `wipe`); delete an account. Every change goes in `admin_log`, shown on the page's Log tab. Deleting drops their usage, activity,
  purchases, items, rewards, application and trade offers, hands over or closes their company, takes them out of `world`
  (`removePlayer`) and destroys their `player` (`close`), so every token and session stops working. It's
  refused while they have coins in an unsettled game. Their `ledger` and `match_players` rows stay, and
  `deleted_users` keeps new ids above theirs, so nobody inherits them.
- Every change a player could see is pushed to `world` (`town/sync.ts`); `world` asks `town` only to put a
  taken drop in the bag (`pickUp`), and for every floor and office lock (`seed`) when it starts, and for
  everyone too when it starts from nothing.

**`world["main"]`**: everything live, in actor state, with chat in SQLite (last 200 lines per room).
- A 10 Hz tick sends each room its `moves`, and head counts (`occupancy`) and who's inside each house
  (`houses`, for town) when they change.
- Actions: `join`, `step` (one adjacent walkable tile, no faster than running; doors change room), `sit`,
  `drink` (a coffee machine: each cup adds 90 s of shaking, up to 6 stacked, sent as `coffeeUntil` in `info`),
  `say` (20 a minute; `@name` sends `mention` to someone in another room), `back` (after a game), `visit`
  (someone's open office, from their card), `take` (G: the drop you're on, or a blocking piece you face; on
  an office floor, only its owner).
- Events: `snapshot` (on joining or changing room), `moves`, `info`, `companies`, `occupancy`, `houses`, `notice`,
  `chat`, `mention`, `drop`, `pickup`.
- **Drops** (`DROPS`, in memory only: `town` has every floor, and a starting world lays them again from
  `seed`; at most 30 a room, 40 an office): a parcel on the dropper's tile or the nearest free one,
  furniture on the tile they face or the nearest free one to it, as itself in the room's map (`mapOf`), so
  a dropped sofa seats. An office's map is the template and its drops. `take` lifts it off the floor first,
  then asks `town.pickUp`; if that call fails, it goes back down.
- **Resting.** Closing the last tab sends you to your bed; offline with agents active in the last 10 minutes, to
  your desk. Company members rest in their house, others at the Inn. Your spot is remembered: the next `join` puts
  you back there, unless it's a house you've left or someone's office that closed (`back` after a game too).
  Online with 3 minutes without input, you just doze where you are (`dozing`, drawn as a "z") until
  your next input, so a town left open on a second screen keeps showing what's going on.

**`arcade["main"]`** and **`match[id]`**: the mini games; see *Games*.

## Companies and houses

- A house's size follows its 30-day tokens **per member** (`houseTier`): basement, shack from 100M, cottage
  1B, house 5B, villa 15B, mansion 40B.
- **Websites** (`brand.ts`). The owner sets one; it goes on the sign at once. If `FIRECRAWL_API_KEY` is set,
  Firecrawl's `branding` format reads the site's colours and logo. Claude (`claude-opus-5-5`, low effort,
  structured output) turns them into roof, wall, trim and plaque colours; without `ANTHROPIC_API_KEY` the site's
  own colours are used. The logo is downloaded from public hosts only (no private or loopback addresses, a few
  redirects, images up to 512 KB), and served from `/logos/` with a sandboxing CSP.

## Coins and the shop

- Each world day pays `√(tokens ÷ 1M)` coins (1.5B ≈ 38, 600M ≈ 24, 100M = 10). Finishing a day 1st, 2nd or 3rd
  adds 25, 15 or 10.
- Only days from the world day you signed up count, for pay and for podium places: a first sync backfills
  old logs, and those days would otherwise pay out (and win podiums nobody else was around for).
- Balances aren't stored: they're worked out from `usage_daily` minus `purchases`, so a late sync still pays.
- Two daily quests (`core/src/quests.ts`) pay up to 7 more a day: 5 agents at once, and 2 hours of
  agents running. They're worked out from `activity_daily`, so nothing is stored.
- The catalogue (`core/src/shop.ts`): 4 outfits, 3 glasses, 3 hats, 5 pets and the 11 pieces of furniture
  (`furn.<ch>`), 10 to 1,500 coins. Items are worn through `Look` (`outfit` ≥ 8, `glasses`, `hat`, `pet`).
  Pets follow their owner in the client.
- **The bag** (`items`, the 🎒 panel): one row per copy, so you can hold two Ducks; you can wear a kind if you
  hold one. Buying adds a row and adds the price to `purchases` (spend only, one row per kind); buying a
  kind you hold already is fine. `bag()` counts each kind. What's on a floor isn't in anyone's bag.
- Three items are earned, not bought: a top hat, server-rack armour and a Singularity orb, at levels 10, 20
  and 30. `report` hands them out as rows the first time a sync reaches the level (`grantRewards`, once each,
  recorded in `rewards`), with the office's desk and chair at level 10, dropped on its floor
  (`starterDrops`). Rewards are `tradeable: false`.
- **Trades** (from a player card): up to 🪙 500 and 4 items each way, for 7 days; not rewards, and not
  furniture on a floor (pick it up first). Accepting re-checks both sides under `serial` and moves everything in one
  transaction (`settleTrade`): coins through the `ledger` (kind `trade`), items by moving one row of each kind
  to the receiver. Spend stays in `purchases`, so balances don't change. A kind you no longer hold comes off
  your look.
- **Offices.** From level 10, every company member has one behind a door with their name on it in the
  company building (`office:<userId>`, one map template plus their furniture). The doors are in hallways of
  10 above the building's floor (negative `y`, `hqMap`), which `world` rebuilds when a door comes or goes.
  Furniture is the map legend's own pieces, bought into the bag and furnished by dropping: in your own
  office a drop stays (no hour, no five), at most 40, and only you take anything off its floor, a
  visitor's gift too. The Menu opens or closes it while you're in it. Anyone in the building walks into an
  open office; from outside, from the owner's card.

## Games

**Decided:** stakes only (every coin a winner gets came from the other players; no house prize and no town
cut). A stake is at most 500 and half your balance, a side bet at most 200, one game at a time. Every game
gathers in the town square so anyone can watch, and you play in a panel over the world.

**The games:**
- **Ship, Pivot, Raise** (1v1): rock-paper-scissors for founders, best of 5, 15 seconds a pick.
- **Hype Cycle** (2–8): the valuation climbs as e^(t/12) until it crashes; cash out in time. Three rounds.
  Each round's crash point comes from a seed whose SHA-256 is shown before it and the seed after.
- **Due Diligence** (2–6): Liar's Dice with 🦄 wild, 30 seconds a turn; the last with dice wins.
- **Tokenmaxxing** (2–12): the most real tokens in 15 minutes to 24 hours, starting on the minute after a
  minute's countdown, with 3 minutes of grace for late syncs.

- **Rules are pure** (`core/src/games/`): each game is a `GameDef` over plain JSON state: `setup`, `move`,
  `tick`, `forfeit`, a per-viewer `view` (hiding what a player mustn't see yet), `outcome` (places, or void),
  plus optional `callouts`, `status`, `board`, `headline` and `endsAt` for the world. Usage games add
  `usageWindow` and `usage`. `GAMES` lists them: Ship, Pivot, Raise; Hype Cycle; Due Diligence; Tokenmaxxing.
- **`arcade["main"]`** is the social side and the money. Everything starts as a table: `open` (invite people,
  open it to anyone, or both), `invite`, `answer` (yes, no or a counter offer), `join`, `leave`, `start`. A
  full table starts a match. It also takes side bets, runs double or nothing, and `settle`s: the pot is paid by
  place (`core/src/games/payouts.ts`, integer math), side bets are a parimutuel pool, and a void game refunds
  everything. Each connection gets its own `lobby` event.
- **`match[id]`** runs one game: its tick loop, frames per viewer (`frame` events), forfeits after 20 seconds
  away for games that hold their players, and a 20-minute safety net. It tells `world` the live status and
  `arcade` the outcome.
- **Coins** move only through the `ledger` in `town`: `hold` is all or nothing (a stake is at most 500 and half
  your balance), `pay` never pays out more than a ref holds, and `refund` returns what's left. Every ref sums to
  zero when it's settled; there's no house cut and no house prize.
- **In the world** (`world.gather`/`release`): players walk to a table in the town square and stand there as
  `playing` until it ends; `back` returns them to where they were. Tokenmaxxing gets an **arena** instead: its
  players stay free, and it's their rest spot until the battle ends. Banners, signs over open tables and the
  arena's scoreboard are drawn in `web/src/game/games.ts`.
- **Tokenmaxxing** pulls, it doesn't add up: after each sync, the match asks `player.tokensBetween(start, end)`
  (each minute capped at 50M and flagged), so re-sent or late events can't double count. After each sync the
  app asks `arcade.battle` (which pulls its score too) and syncs every 10 seconds until the battle is over.
- **When something fails:** a match retries reporting its outcome, settling can run again without paying
  twice, the arcade calls off a match stuck past a limit (refunding everyone) and retries letting its players
  go, and it destroys match actors a minute after they end.

### Adding a game

1. Write `core/src/games/<id>.ts` exporting a `GameDef`, add its id to `GameId` and it to `GAMES`.
2. Write `web/src/games/<id>.tsx` (it gets `{ view, info, you, now, move }`), add it to `COMPONENTS`, and
   optionally give it a table in `web/src/art/tables.ts`.
3. Write `core/test/games/<id>.test.ts`; `registry.test.ts` already checks every game's basics.

No server changes, actions or tables are needed.

### Later

- A physical arcade in the town square (machines that open the lobby, a trophy shelf of today's winners).
- Inviting a whole company at once; company tournaments built from tables.
- Easing Tokenmaxxing's counters between updates, and "✓ syncing" next to seated players.
- More games: Term Sheet (Split or Steal; needs a rule for when both steal), Runway (Farkle), Burn Rate
  (blackjack), Unicorn (highest unique number), a coin flip at the fountain, Prompt Race (typing), and
  fighting "Rate Limit" in the tall grass.

## The client

- Plain Canvas 2D with `imageSmoothingEnabled = false`, integer zoom, and grid movement: your own steps are
  predicted and corrected by the server; other players replay a short step queue.
- Every sprite is a palette-string grid baked into a canvas at runtime (`web/src/art/`), so there are no image
  assets.
- Chat has quick replies above it: emoji and startup one-liners, sent with one click. A line made only of
  emoji (up to 8) bursts around its author instead of showing a bubble (`game/emoji.ts`).
- React draws only the HUD and reads a small `useSyncExternalStore` store (`store.ts`). Game state never passes
  through React.

## One clock

"Today" is `Europe/Copenhagen` for everyone (`core/src/range.ts`).

## Known limits

These are deliberate, and marked `ponytail:` in the code:
- one `world` actor for everyone (split it per room when hundreds are online at once; the protocol is already
  per room);
- rate limits are in memory, so a deploy resets them;
- usage is reported by each user's machine: capped and flagged, but it can't be proven;
- leaderboards and wallets are recomputed on every request;
- a late sync can knock someone off a past podium after they spent the bonus;
- the logo download checks DNS before fetching, so DNS rebinding in between isn't caught.

## Tests

`bun run check` runs typecheck, lint and every test. Actor tests start a real server in a subprocess, with its
own engine, port and data directory (`server/test/rivet.ts`), so they use the production code paths. Map, step,
rest-spot and coin rules are pure and tested in `core/test/`.
