# tokenmaxxing

A tiny pixel town for people who run AI coding agents. Install the app, pick a name, and
**Open world**: you walk around town as your own character, chat with whoever is in the same room, and
open anyone's stats. Start a **company** (or pick one from the list and ask to join; its owner says yes or
no) and it gets a
house in town, painted in your brand's colours with your logo on it. When you're not playing, your
character is in that house: **at a desk** while your agents run, **asleep in bed** when they don't. Using
AI earns **coins**, and so does finishing a day in the top 3; spend them on clothes, glasses, hats and
pets that follow you around. Or play for them: challenge someone to a game in the town square, from
rock-paper-scissors for founders and Liar's Dice to **Tokenmaxxing**, a battle over who burns the most real
tokens in an hour.

Reads usage from Claude Code (including subagents), Claude Cowork, Codex and Cursor, including the Claude Code and
Codex sessions PostHog Desktop runs, and your pull requests from GitHub.

## Install

```bash
brew install --cask hanskristoffer/tap/tokenmaxxing
```

Open **Tokenmaxxing** and pick a name. From then on it lives in the menu bar: it syncs in the background
and shows your tokens today next to the ⚡. **Open world** (from its menu, the Dock or Spotlight) opens the
game in its own window, where everything else is: leaderboards, stats, companies and games. The app keeps
itself up to date.

### On a second computer

Running agents on another machine too, like a Mac mini under the desk or a Linux box? Link it, and its tokens
count for you. In the app, choose **Link a computer…** (in the menu bar, or on your own card in the game).
That gives you a line to run in a terminal on the other computer, good for 10 minutes:

```bash
curl -fsSL https://<server>/install.sh | sh -s -- link 42.Xk3…
```

It installs the `tokenmaxxing` command (macOS or Linux, in `~/.local/bin`), links it, sends that computer's
history, and keeps syncing in the background (a LaunchAgent, or a systemd user service). Then:
`tokenmaxxing status`, `sync`, `logs` and `unlink`. A linked computer can only send usage: it can't chat,
spend coins or open the world. Your card in the game lists your computers and removes them.

**Coming from 0.5 or earlier?** The world is a new backend and starts fresh: update the app, pick a name again and
recreate your company. Your usage history comes back by itself, because the app re-reads your local logs on
its first sync.

## What's shared

Only **token counts, model names, timestamps and opaque session/message ids** leave your Mac. Message
content never does. The app reads local logs and Cursor dashboard usage:

| Source | Where |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` (subagents included), and PostHog Desktop's agent sessions in `~/Library/Application Support/@posthog/posthog-code/claude/projects/**/*.jsonl` |
| Claude Cowork | `~/Library/Application Support/Claude/…/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` and `~/.codex/archived_sessions/**/*.jsonl`, and PostHog Desktop's gateway runs in `~/Library/Application Support/@posthog/posthog-code/codex-home/*/sessions/**/*.jsonl`. A rollout named in `state_*.sqlite` (`threads.rollout_path`) is included when that file still exists under the Codex home. `threads.tokens_used` is one running total with no per-turn split, so it is not counted. Consumer ChatGPT chats that never write a Codex rollout have no local token ledger |
| Cursor | Dashboard usage API; signs in using `cursorAuth/accessToken` from the local `state.vscdb` |
| Grok Bot | The same Cursor dashboard, for models `grok-bot` and `grok-bot-*`. The Grok Bot app's weekly plan percent is not a token count and is not read, so Grok Bot stays at 0 until those dashboard rows exist |
| GitHub | PRs you opened, on every account the `gh` CLI is signed in to (github.com and Enterprise), or else with the github.com login git saved for HTTPS (at most every 15 minutes); only a hash of each PR's URL and when it was opened are sent. The menu says when neither is there |

Cursor must be installed and signed in. Its session credential is read locally and sent only to
`cursor.com`; it is never uploaded to Tokenmaxxing or saved in sync state. Every 15 minutes, the helper
fetches paginated input, output, cache-write and cache-read counts from the dashboard, using the
[authentication approach from cursorbar](https://github.com/c-johannesen/cursorbar). The first sync requests
all history available from Cursor, sending pages of up to 1000 events as they arrive; later syncs
re-read seven days to catch delayed usage. No public
Cursor profile is required. Requests without a token breakdown are skipped. API failures retry on the
next sync without advancing the checkpoint or falling back to text estimates. Existing estimates are
replaced on world days with dashboard events; earlier days remain as previously synced.
Grok Bot models on that dashboard are stored as Grok Bot, not Cursor. An older checkpoint re-reads
history once so rows that used to be skipped are included.

Every source that's installed is read. **Everything is public in the world:** anyone can see your
totals, cost, parallelism, models and daily activity, and the leaderboard ranks everyone.

**Company websites.** When a company's owner sets its website, the server asks
[Firecrawl](https://firecrawl.dev) to read that site's colours and logo, sends those to Claude to pick the
house's colours, and keeps a copy of the logo. Only the company's public website is involved; nobody's usage
data is sent anywhere for this.

## The stats

- **Tokens:** input + output + cache writes + cache reads.
- **Cost:** all sources use [LiteLLM's table](https://github.com/BerriAI/litellm), refreshed daily, including reasoning-effort matching. If no model price matches, Cursor uses the API's `chargedCents`, falling back to `tokenUsage.totalCents`, preserving zero and fractional cents. Reported values reflect usage-time costs and credit adjustments; there are no hardcoded Cursor rates. Models without either a price or a reported cost contribute $0. These totals combine current model-price estimates with historical reported usage values; they are not subscription invoices.
- **Parallelism ×:** the average number of agents running at the same time, measured over the time you
  had at least one running. Three agents working through the same hour is 3.0×. Time is measured in
  5-minute buckets, subagents count as agents, and you need at least 1 active hour in the range to be
  ranked.
- **Peak agents:** the most agents running at once.
- **Tokens / active hour:** tokens divided by hours with at least one agent running.
- **Days** are Copenhagen days for everyone: one world, one clock.
- **Level** comes from lifetime tokens (1M → Lv1, 1B → Lv7).
- **Houses** show how hard a company's people push: tokens **per member** over the last 30 days. Under 100M
  each is a cellar hatch in a fenced yard; then a shack (100M), cottage (1B), two-storey house (5B), villa
  (15B) and a mansion with a tower (40B). A big team of light users stays in the basement.
- **Coins:** from the day you sign up, every day pays `√(tokens ÷ 1M)`: 100M tokens is 10 coins, 1B is 31. A heavy day earns more,
  but not wildly more. Finishing a day 1st, 2nd or 3rd adds 25, 15 or 10.

## How it works

```
Tokenmaxxing.app (Tauri, Rust)                     server (Railway, one process)
├─ menu bar: ⚡ 306M, its menu                      Bun.serve
├─ game window ── loads the live game ──────────►  ├─ /             the marketing site (Astro)
├─ Keychain, login item, updater                   ├─ /play         the game (bundled at boot)
│                                                  ├─ /admin        the admin page (ADMIN_TOKEN)
│                                                  ├─ /logos/:file  company logos
└─ sidecar: TS helper ◄─ NDJSON                    ├─ /api/rivet/*  proxy to the Rivet engine's gateway ◄── game
     parses local logs, player.ingest() ────────►  └─ Rivet actors: town, world, player[userId],
                                                      arcade, match[id]
                                                   engine data: $RIVETKIT_STORAGE_PATH (the volume)
```

The backend is [Rivet Actors](https://rivet.dev/docs/actors). `rivetkit` starts the Rivet engine
inside the container; `Bun.serve` exposes only its client gateway under `/api/rivet`.

| Actor | Key | What |
|---|---|---|
| `player` | user id | Raw events (SQLite), device token and browser sessions, daily rollups on ingest |
| `town` | `main` | Accounts, companies, daily rollups for everyone: leaderboards and player cards |
| `world` | `main` | Who's where: steps, rooms, rest spots (bed/desk), room chat, a 10 Hz broadcast loop |
| `arcade` | `main` | Mini games: tables, invites, side bets, and paying out the pot |
| `match` | match id | One game being played: its rules, timers and each player's view |

| Path | What |
|---|---|
| `core/` | Log parsers, sync engine, shell↔helper protocol, `maps.ts` and `world.ts` (the world's rules, shared by client and server) |
| `server/` | `main.ts`, the Rivet proxy, the actors (`src/actors/`) and what `town` does (`src/town/`), company branding, pricing |
| `web/` | The game: canvas renderer in `src/game/`, pixel art drawn in code in `src/art/`, React HUD in `src/hud/` |
| `app/helper/` | The TypeScript helper the app runs as a sidecar (`bun build --compile`) |
| `app/desktop/` | The desktop app: Tauri v2 (`src-tauri/`), the "pick a name" page, icons and build scripts |
| `packaging/tokenmaxxing.rb` | Homebrew cask template |
| `ARCHITECTURE.md` | How it all fits together: serving, auth, the actors, houses, coins, games |

All art is drawn in code (palette-string sprites and rectangles), so the repo carries no image assets.

## Development

Requires Bun 1.4+, Rust (stable) and Xcode's command line tools (macOS 14+).

```bash
bun install --ignore-scripts
bun run dev                            # http://localhost:8787 (the site; the game is at /play; data in ./.data/rivet); restart to see web edits
bun run site:dev                       # the marketing site alone, with hot reload
bun run dev:seed                       # a few people, two companies, and a link that signs you in
bun run desktop:dev                    # the desktop app against localhost:8787
bun run check                          # typecheck + lint + tests (tests start their own server)
(cd app/desktop/src-tauri && cargo test)   # the Rust side, including the protocol contract test
```

Dev builds of the desktop app run the helper from source (so TypeScript changes only need an app restart),
with their own Keychain entry and state dir, so they never touch the installed app's account. Point one at
another server with `TOKENMAXXING_SERVER_URL=… bun run desktop:dev`.
To sync without the UI:

```bash
TOKENMAXXING_TOKEN=… TOKENMAXXING_SERVER_URL=http://localhost:8787 bun run helper:once
```

The CLI for linked computers runs from source too. Get a code from the app (or `player.mintLinkCode()`), and
keep it off your real config with `TOKENMAXXING_CLI_DIR`:

```bash
TOKENMAXXING_CLI_DIR=.data/cli bun app/helper/src/cli.ts link <code> --server http://localhost:8787 --no-service
bash app/helper/scripts/cli.sh dist/cli    # the release binaries, for every platform
```

### Server config

| Var | Default | |
|---|---|---|
| `PORT` | `8787` | |
| `RIVETKIT_STORAGE_PATH` | `~/.rivetkit` in dev | Where the engine keeps every actor. Required in production: `/data/rivet` on the Railway volume (set in the Dockerfile) |
| `RIVET_LOG_LEVEL` | | `error` keeps the engine quiet |
| `NODE_ENV` | | `production` minifies the game |
| `FIRECRAWL_API_KEY` | | Reads company websites. Without it, a website only goes on the sign |
| `ANTHROPIC_API_KEY` | | Turns a website's brand into house colours. Without it, the site's own colours are used |
| `ADMIN_TOKEN` | | Turns on the admin page at `/admin#token=<it>` (32+ characters: `openssl rand -hex 32`). Without it, the page lets nobody in |
| `CLIENT_IP_HEADER` | `x-real-ip` | Where the client's IP is, for per-IP limits. Railway's edge sets `x-real-ip` |
| `GATEWAY_REQUESTS_PER_MIN` | `1200` | Requests to the actors per client IP a minute |
| `GATEWAY_SOCKETS_PER_MIN` | `300` | New WebSockets per client IP a minute |

`RIVETKIT_STORAGE_PATH` and `RIVET_LOG_LEVEL` are read by RivetKit's native side, so they must be set in
the environment before the process starts.

### Releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org) (PR titles are checked).
[release-please](https://github.com/googleapis/release-please) keeps a Release PR open. Merging it
tags the version, builds the desktop app (universal, signed and notarized, with `tauri-action`), attaches
the `.dmg` and the updater's files (`.app.tar.gz`, `.sig`, `latest.json`), notarizes the `.dmg` too (and
attaches it again as `Tokenmaxxing.dmg`, what the website's Download button fetches), attaches the CLI for
linked computers (`tokenmaxxing-{darwin,linux}-{arm64,x64}` and `SHA256SUMS`, which `/install.sh` fetches), and
updates the cask in `HansKristoffer/homebrew-tap`. Before that, it checks what people will get: the
downloaded `.dmg` and the app in it pass Gatekeeper, and the published update's signature matches the
app's public key.
Installed apps find the update through `latest.json` on the latest release (hourly), install it by themselves
when no window is open, and otherwise show an "Update" button in the game.
Railway deploys the server from `main`, and the game window picks that up on its own.

Required repo settings: the variable `TOKENMAXXING_SERVER_URL`, and the secrets `MACOS_CERT_P12`,
`MACOS_CERT_PASSWORD`, `MACOS_SIGN_IDENTITY`, `NOTARY_APPLE_ID`, `NOTARY_TEAM_ID`, `NOTARY_PASSWORD`,
`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and `HOMEBREW_TAP_DEPLOY_KEY` (a write
deploy key on the tap repo). `app/desktop/scripts/set-signing-secrets.sh` uploads all but the last. The
updater key lives in `~/.tauri/tokenmaxxing.key`: losing it means installed apps can never update again.

## License

MIT. Based on [anaralabs/tokenleader](https://github.com/anaralabs/tokenleader).
