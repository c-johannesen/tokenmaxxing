import type { Placed } from "@tokenmaxxing/core/office.ts";
import { all, type Sql } from "../actors/shared.ts";

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
  // Coins spent in the shop, per kind: a rebuy adds its price. What you hold is in `items`.
  await sql.execute(`CREATE TABLE IF NOT EXISTS purchases (
    user_id INTEGER NOT NULL, item TEXT NOT NULL, price INTEGER NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item)) WITHOUT ROWID`);
  // Decided before it's made: `items` can empty out again later, and the backfill mustn't run twice.
  const fresh =
    (await sql.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'items'")).length === 0;
  // One row per copy anyone holds. `owner_id` is NULL while it's on the floor: `dropped_by` and
  // `dropped_at` say whose and since when, `room`, `x` and `y` where (once `world` has put it down).
  // `placed` is from before offices were furnished by dropping: always 0 now.
  await sql.execute(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER, item TEXT NOT NULL, at INTEGER NOT NULL,
    placed INTEGER NOT NULL DEFAULT 0, dropped_by INTEGER, dropped_at INTEGER, room TEXT, x INTEGER, y INTEGER)`);
  const itemColumns = (await sql.execute("PRAGMA table_info(items)")) as { name: string }[];
  if (!itemColumns.some((c) => c.name === "room"))
    for (const col of ["room TEXT", "x INTEGER", "y INTEGER"])
      await sql.execute(`ALTER TABLE items ADD COLUMN ${col}`);
  await sql.execute("CREATE INDEX IF NOT EXISTS items_owner ON items (owner_id, item)");
  // Level rewards handed out, so each comes once.
  await sql.execute(`CREATE TABLE IF NOT EXISTS rewards (
    user_id INTEGER NOT NULL, item TEXT NOT NULL, PRIMARY KEY (user_id, item))`);
  // Coins that move between players: stakes and side bets held, then paid out or refunded, and
  // trades (kind `trade`). Before `items`, a traded item also took its price back from the giver,
  // whose purchase row went, and office furniture was paid for here (kind `furniture`, ref
  // `office:<userId>`); those rows stay. Negative amounts leave a wallet. Every `ref` sums to 0 or
  // less, never more, except `admin`: coins an admin gave or took (kind `admin`).
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
  // Whether each office is open. A row is also "the desk and chair are given" (`starterDrops`).
  // `furniture` is from before offices were furnished by dropping: always `[]` once migrated.
  await sql.execute(`CREATE TABLE IF NOT EXISTS offices (
    user_id INTEGER PRIMARY KEY, furniture TEXT NOT NULL, open INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL)`);
  // Into the bag, once, when `items` is new: a purchase row was the item (a traded one already belonged
  // to the receiver), and each office piece was paid for, so it's a placed row.
  if (fresh) {
    await sql.execute("INSERT INTO items (owner_id, item, at) SELECT user_id, item, at FROM purchases");
    await sql.execute(
      `INSERT INTO items (owner_id, item, at, placed)
       SELECT user_id, 'furn.' || json_extract(p.value, '$.ch'), updated_at, 1 FROM offices, json_each(furniture) p`,
    );
    const [{ n }] = (await sql.execute("SELECT COUNT(*) AS n FROM items")) as [{ n: number }];
    if (n > 0) console.log(`[town] ${n} items into the bag`);
  }
  // Offices furnished by dropping: each saved piece takes one of its owner's placed rows down onto
  // the office floor where it stood. Once per office, since its JSON empties.
  const saved = await all<{ userId: number; furniture: string; at: number }>(
    sql,
    "SELECT user_id AS userId, furniture, updated_at AS at FROM offices WHERE furniture <> '[]'",
  );
  let moved = 0;
  for (const o of saved) {
    for (const p of JSON.parse(o.furniture) as Placed[])
      moved += (
        await sql.execute(
          `UPDATE items SET owner_id = NULL, dropped_by = ?, dropped_at = ?, room = ?, x = ?, y = ?, placed = 0
           WHERE id = (SELECT id FROM items WHERE owner_id = ? AND item = ? AND placed = 1 LIMIT 1) RETURNING id`,
          o.userId,
          o.at,
          `office:${o.userId}`,
          p.x,
          p.y,
          o.userId,
          `furn.${p.ch}`,
        )
      ).length;
    await sql.execute("UPDATE offices SET furniture = '[]' WHERE user_id = ?", o.userId);
  }
  // More placed rows than pieces: the rest are in the bag.
  const back = (await sql.execute("UPDATE items SET placed = 0 WHERE placed = 1 RETURNING id")).length;
  if (saved.length + back > 0)
    console.log(`[town] ${saved.length} offices: ${moved} pieces onto their floors, ${back} into the bag`);
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
