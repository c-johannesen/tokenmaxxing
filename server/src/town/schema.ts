import type { Sql } from "../actors/shared.ts";

/** Every table `town` keeps. Also run by tests against an in-memory database. */
export async function migrate(sql: Sql): Promise<void> {
  await sql.execute(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    company_id INTEGER,
    joined_at INTEGER,
    look TEXT NOT NULL,
    created_at INTEGER NOT NULL)`);
  await sql.execute("CREATE INDEX IF NOT EXISTS users_company ON users (company_id, joined_at)");
  // AUTOINCREMENT: a closed company's id is never handed out again, so a new company
  // can't inherit its house chat (`hq:<id>`) or its logo.
  await sql.execute(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    plot INTEGER NOT NULL UNIQUE,
    website TEXT,
    branding TEXT,
    brand TEXT,
    created_at INTEGER NOT NULL)`);
  await sql.execute(`CREATE TABLE IF NOT EXISTS usage_daily (
    user_id INTEGER NOT NULL, day TEXT NOT NULL, model TEXT NOT NULL,
    input INTEGER NOT NULL, output INTEGER NOT NULL,
    cache_creation INTEGER NOT NULL, cache_read INTEGER NOT NULL, turns INTEGER NOT NULL,
    PRIMARY KEY (user_id, day, model)) WITHOUT ROWID`);
  const usageColumns = (await sql.execute("PRAGMA table_info(usage_daily)")) as { name: string }[];
  if (!usageColumns.some((c) => c.name === "reported_cost_cents")) {
    await sql.execute("ALTER TABLE usage_daily ADD COLUMN reported_cost_cents REAL NOT NULL DEFAULT 0");
  }
  await sql.execute("CREATE INDEX IF NOT EXISTS usage_day ON usage_daily (day)");
  await sql.execute(`CREATE TABLE IF NOT EXISTS activity_daily (
    user_id INTEGER NOT NULL, day TEXT NOT NULL,
    prompts INTEGER NOT NULL, prs INTEGER NOT NULL,
    agent_buckets INTEGER NOT NULL, active_buckets INTEGER NOT NULL, peak_agents INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)) WITHOUT ROWID`);
  await sql.execute("CREATE INDEX IF NOT EXISTS activity_day ON activity_daily (day)");
  // One pending application per person: applying elsewhere replaces it.
  await sql.execute(`CREATE TABLE IF NOT EXISTS applications (
    user_id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, at INTEGER NOT NULL)`);
  await sql.execute("CREATE INDEX IF NOT EXISTS applications_company ON applications (company_id, at)");
  await sql.execute(`CREATE TABLE IF NOT EXISTS purchases (
    user_id INTEGER NOT NULL, item TEXT NOT NULL, price INTEGER NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item)) WITHOUT ROWID`);
  // Coins that move between players: stakes and side bets held, then paid out or refunded, and
  // trades (kind `trade`: an item that changed hands takes its price back from the giver, whose
  // purchase row went). Negative amounts leave a wallet. Every `ref` sums to 0 or less, never more,
  // except `admin`: coins an admin gave or took (kind `admin`).
  await sql.execute(`CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, amount INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
    at INTEGER NOT NULL)`);
  await sql.execute("CREATE INDEX IF NOT EXISTS ledger_user ON ledger (user_id)");
  await sql.execute("CREATE INDEX IF NOT EXISTS ledger_ref ON ledger (ref)");
  // One open offer per sender: a new one replaces it. `give` and `want` are `Side` JSON.
  await sql.execute(`CREATE TABLE IF NOT EXISTS trades (
    from_id INTEGER PRIMARY KEY, to_id INTEGER NOT NULL,
    give TEXT NOT NULL, want TEXT NOT NULL, at INTEGER NOT NULL)`);
  await sql.execute("CREATE INDEX IF NOT EXISTS trades_to ON trades (to_id, at)");
  // One row per player per finished game (void games aren't recorded), for stats and the Games board.
  await sql.execute(`CREATE TABLE IF NOT EXISTS match_players (
    match_id INTEGER NOT NULL, user_id INTEGER NOT NULL, game TEXT NOT NULL, place INTEGER NOT NULL,
    stake INTEGER NOT NULL, won INTEGER NOT NULL, pot INTEGER NOT NULL, day TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (match_id, user_id))`);
  await sql.execute("CREATE INDEX IF NOT EXISTS match_players_day ON match_players (day)");
  await sql.execute("CREATE INDEX IF NOT EXISTS match_players_user ON match_players (user_id)");
  // Tokens past the per-minute cap (`player.ts`), per day: they count for nothing, and the admin
  // page flags who sends them.
  await sql.execute(`CREATE TABLE IF NOT EXISTS capped_daily (
    user_id INTEGER NOT NULL, day TEXT NOT NULL, tokens INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)) WITHOUT ROWID`);
  // What was done from the admin page, and when.
  await sql.execute(`CREATE TABLE IF NOT EXISTS admin_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
    action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT)`);
  // Accounts an admin deleted. `users` ids come after these, so a new account never takes over a
  // deleted one's `player` actor, or its rows in `ledger` and `match_players` (which stay, since
  // other players' games add up with them).
  await sql.execute(`CREATE TABLE IF NOT EXISTS deleted_users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL)`);
}
