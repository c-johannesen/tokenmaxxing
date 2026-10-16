import { frontier } from "@tokenmaxxing/core/maps.ts";
import { OFFICE_LEVEL, parseOffice } from "@tokenmaxxing/core/office.ts";
import { isRangeKey } from "@tokenmaxxing/core/range.ts";
import {
  emptySide,
  isTradeable,
  itemById,
  itemsIn,
  parseSide,
  TRADE_COINS_CAP,
  TRADE_ITEMS_CAP,
} from "@tokenmaxxing/core/shop.ts";
import {
  type CompanyInfo,
  type Drop,
  defaultLook,
  dropName,
  type Look,
  parseLook,
} from "@tokenmaxxing/core/world.ts";
import { actor, UserError } from "rivetkit";
import { db } from "rivetkit/db";
import { canBrand } from "../brand.ts";
import { RateLimiter } from "../rate-limit.ts";
import { type ActivityRow, isSortKey, type UsageRow } from "../stats.ts";
import {
  type AdminCompany,
  type AdminLogEntry,
  type AdminOverview,
  type AdminUser,
  companies as adminCompanies,
  adminLog,
  users as adminUsers,
  closeCompany,
  deleteUser,
  logAdmin,
  overview,
  wipeUsage,
} from "../town/admin.ts";
import {
  type CompanyProfile,
  companyProfile,
  type Leaderboard,
  leaderboard,
  type Profile,
  profile,
  type Today,
  today,
} from "../town/boards.ts";
import {
  type BagRow,
  bag,
  buy,
  checkTrade,
  type Entry,
  furnish,
  giveBack,
  grantRewards,
  type HoldKind,
  heldIn,
  hold,
  type Office,
  officeOf,
  offices,
  ownedItems,
  type PayKind,
  pay,
  pickUp,
  refund,
  setBalance,
  settleTrade,
  starterOffice,
  type Trade,
  takeOut,
  tradesWhere,
  unclaimed,
  unwear,
  type Wallet,
  wallet,
} from "../town/coins.ts";
import {
  applicationOf,
  apply,
  approve,
  companyById,
  companyInfos,
  decline,
  type Listing,
  leave,
  listings,
  type MyCompany,
  myCompany,
  ownedCompany,
  withdraw,
} from "../town/companies.ts";
import { type GamePlayer, gameBoard, type Placed, recordMatch } from "../town/games.ts";
import { migrate } from "../town/schema.ts";
import { brand, notify, push, pushOffice, pushPlayers } from "../town/sync.ts";
import {
  levelOf,
  lookOf,
  type PlayerCore,
  playerCores,
  USER_COLS,
  type UserRow,
  userById,
} from "../town/users.ts";
import { parseCompanyName, parseUserName, parseWebsite } from "../validate.ts";
import type { registry } from "./registry.ts";
import {
  all,
  authenticate,
  type Caller,
  type ConnParams,
  clientIpOf,
  INTERNAL_KEY,
  internal,
  main,
  makeToken,
  one,
  requireAdmin,
  requireInternal,
  requireMain,
  requireSyncer,
  requireUser,
  type Sql,
  serial,
  type TokenCache,
} from "./shared.ts";

export type { AdminCompany, AdminLogEntry, AdminOverview, AdminUser } from "../town/admin.ts";
export type {
  BoardCompany,
  BoardPlayer,
  CompanyProfile,
  Leaderboard,
  Profile,
  Today,
} from "../town/boards.ts";
export type { BagRow, Office, Trade, Wallet } from "../town/coins.ts";
export type { Listing, MyCompany } from "../town/companies.ts";
export type { GamePlayer, GameStats } from "../town/games.ts";
export type { PlayerCore } from "../town/users.ts";

export interface UsageDay extends UsageRow {
  day: string;
}

export interface ActivityDay extends ActivityRow {
  day: string;
  /** Tokens past the per-minute cap, which count for nothing. */
  capped: number;
}

export interface Me {
  userId: number;
  name: string;
  look: Look;
  company: MyCompany | null;
  /** The company I've asked to join and am waiting to hear from. */
  application: { companyId: number; name: string } | null;
}

/**
 * Per client IP (from `proxy.ts`): an office signing up together fits, a script doesn't. The
 * global bucket is the backstop against many IPs at once.
 */
const SIGNUPS_PER_IP_PER_HOUR = 20;
const SIGNUPS_PER_HOUR = 1000;

/** Each one scrapes a site and asks Claude, so owners can't loop it. */
const BRANDINGS_PER_HOUR = 5;
/** Each one pings the company's owner. */
const APPLICATIONS_PER_HOUR = 10;
/** Each one pings the other person. */
const TRADES_PER_HOUR = 10;
const HOUR = 3_600_000;
/** Offers older than this are gone. */
const TRADE_TTL = 7 * 24 * HOUR;
/** Drops nobody took go back to their droppers after this; the sweeper looks every `SWEEP_MS`. */
const DROP_TTL = HOUR;
const SWEEP_MS = 10 * 60_000;

/** Many rows in few statements (a first sync can report years of days). */
async function insertRows(sql: Sql, insert: string, rows: unknown[][]): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const row = `(${chunk[0]!.map(() => "?").join(",")})`;
    await sql.execute(`${insert} ${chunk.map(() => row).join(",")}`, ...chunk.flat());
  }
}

type TownConn = Caller & { ip: string | null };

function userName(raw: unknown): string {
  const name = parseUserName(raw);
  if (!name)
    throw new UserError("Use 2–32 characters: a–z, 0–9, dot, dash or underscore.", { code: "invalid_name" });
  return name;
}

function companyName(raw: unknown): string {
  const name = parseCompanyName(raw);
  if (!name) throw new UserError("Use 1–32 characters.", { code: "invalid_name" });
  return name;
}

export const town = actor({
  createVars: () => ({
    serial: serial(),
    signups: new RateLimiter(SIGNUPS_PER_HOUR, HOUR),
    signupsPerIp: new RateLimiter(SIGNUPS_PER_IP_PER_HOUR, HOUR),
    brandings: new RateLimiter(BRANDINGS_PER_HOUR, HOUR),
    applications: new RateLimiter(APPLICATIONS_PER_HOUR, HOUR),
    trades: new RateLimiter(TRADES_PER_HOUR, HOUR),
    /** Verified tokens, so a burst of calls doesn't ask `player` every time. */
    tokens: new Map() as TokenCache,
  }),
  db: db({ onMigrate: migrate }),
  onCreate: (c) => requireMain(c),
  createConnState: async (c, params: ConnParams): Promise<TownConn> => ({
    ...(await authenticate(params, c.client(), c.vars.tokens)),
    ip: clientIpOf(c.request),
  }),
  // The sweeper's alarm. Set once: it outlives restarts, and wakes the town when it's asleep.
  onWake: async (c) => {
    if (!(await c.cron.get("sweep")))
      await c.cron.every({ name: "sweep", interval: SWEEP_MS, action: "sweep" });
  },
  actions: {
    health: async (c): Promise<void> => {
      requireInternal(c.conn.state);
      await c.db.execute("SELECT 1");
    },
    signUp: async (c, rawName: unknown): Promise<{ userId: number; name: string; token: string }> => {
      const name = userName(rawName);
      const now = Date.now();
      if (!c.vars.signupsPerIp.take(c.conn.state.ip ?? "inside", now) || !c.vars.signups.take("all", now))
        throw new UserError("Too many sign-ups right now. Try again in a bit.", { code: "rate_limited" });
      const client = c.client<typeof registry>();
      const userId = await c.vars.serial(async () => {
        if (await one(c.db, "SELECT 1 FROM users WHERE name = ?", name))
          throw new UserError("That name is taken.", { code: "name_taken" });
        // After every id there's been, deleted accounts too.
        const [row] = await all<{ id: number }>(
          c.db,
          `INSERT INTO users (id, name, look, created_at) VALUES (
             COALESCE((SELECT MAX(id) FROM (SELECT id FROM users UNION ALL SELECT id FROM deleted_users)), 0) + 1,
             ?, '{}', ?) RETURNING id`,
          name,
          Date.now(),
        );
        await c.db.execute(
          "UPDATE users SET look = ? WHERE id = ?",
          JSON.stringify(defaultLook(row!.id)),
          row!.id,
        );
        return row!.id;
      });
      const { token, hash } = makeToken(userId);
      try {
        await client.player.create([String(userId)], {
          input: { userId, tokenHash: hash, internal: INTERNAL_KEY },
        });
      } catch (err) {
        // Nobody holds a token for this account, so it goes; the name is free again.
        await c.db.execute("DELETE FROM users WHERE id = ?", userId);
        throw err;
      }
      await pushPlayers(c.db, client, [userId]);
      return { userId, name, token };
    },

    me: async (c): Promise<Me> => {
      const userId = requireUser(c.conn.state);
      const u = await userById(c.db, userId);
      return {
        userId,
        name: u.name,
        look: lookOf(u),
        company: u.companyId === null ? null : await myCompany(c.db, u.companyId, userId),
        application: await applicationOf(c.db, userId),
      };
    },

    rename: async (c, rawName: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      await renameUser(c.db, c.vars.serial, c.client<typeof registry>(), userId, rawName);
    },

    setLook: async (c, rawLook: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      const look = parseLook(rawLook);
      if (!look) throw new UserError("Unknown look.", { code: "invalid_look" });
      const owned = new Set(await ownedItems(c.db, userId));
      if (itemsIn(look).some((i) => !owned.has(i.id)))
        throw new UserError("Buy it in the shop first.", { code: "not_owned" });
      await c.db.execute("UPDATE users SET look = ? WHERE id = ?", JSON.stringify(look), userId);
      await pushPlayers(c.db, c.client<typeof registry>(), [userId]);
    },

    /** `rawPlot`: the block to build on, one of `frontier()`; the one nearest the square without. */
    createCompany: async (c, rawName: unknown, rawPlot?: unknown): Promise<MyCompany> => {
      const userId = requireUser(c.conn.state);
      const name = companyName(rawName);
      const changed = await c.vars.serial(async () => {
        const taken = await all<{ plot: number }>(c.db, "SELECT plot FROM companies");
        const free = frontier(taken.map((r) => r.plot));
        const plot = (rawPlot ?? free[0]) as number;
        if (!free.includes(plot))
          throw new UserError("Someone just built there. Pick another spot.", { code: "plot_taken" });
        const left = await leave(c.db, userId);
        await withdraw(c.db, userId);
        const now = Date.now();
        const [row] = await all<{ id: number }>(
          c.db,
          "INSERT INTO companies (name, owner_id, plot, created_at) VALUES (?, ?, ?, ?) RETURNING id",
          name,
          userId,
          plot,
          now,
        );
        await c.db.execute(
          "UPDATE users SET company_id = ?, joined_at = ? WHERE id = ?",
          row!.id,
          now,
          userId,
        );
        return { companies: [...left.companies, row!.id], users: [userId] };
      });
      await push(c.db, c.client<typeof registry>(), changed);
      return myCompany(c.db, changed.companies.at(-1)!, userId);
    },

    /** Every company, for choosing one to apply to. */
    listings: (c): Promise<Listing[]> => {
      requireUser(c.conn.state);
      return listings(c.db);
    },

    /** Asks to join a company; its owner accepts or declines. */
    apply: async (c, companyId: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      if (typeof companyId !== "number") throw new UserError("That company is gone.", { code: "not_found" });
      if (!c.vars.applications.take(String(userId), Date.now()))
        throw new UserError("That's a lot of applications. Try again in an hour.", { code: "rate_limited" });
      const company = await c.vars.serial(() => apply(c.db, userId, companyId, Date.now()));
      const me = await userById(c.db, userId);
      await notify(c.client<typeof registry>(), company.ownerId, {
        text: `${me.name} asks to join ${company.name}.`,
        open: "company",
      });
    },

    withdraw: async (c): Promise<void> => {
      await withdraw(c.db, requireUser(c.conn.state));
    },

    approve: async (c, applicantId: unknown): Promise<MyCompany> => {
      const userId = requireUser(c.conn.state);
      const client = c.client<typeof registry>();
      const { company, changed } = await c.vars.serial(async () => {
        const company = await ownedCompany(c.db, userId);
        return { company, changed: await approve(c.db, company, applicantId, Date.now()) };
      });
      await push(c.db, client, changed);
      await notify(client, changed.users[0]!, {
        text: `You're in! Welcome to ${company.name}.`,
        open: "company",
      });
      return myCompany(c.db, company.id, userId);
    },

    decline: async (c, applicantId: unknown): Promise<MyCompany> => {
      const userId = requireUser(c.conn.state);
      const company = await ownedCompany(c.db, userId);
      const declined = await c.vars.serial(() => decline(c.db, company, applicantId));
      await notify(c.client<typeof registry>(), declined, {
        text: `${company.name} said no this time.`,
        open: "company",
      });
      return myCompany(c.db, company.id, userId);
    },

    leaveCompany: async (c): Promise<void> => {
      const userId = requireUser(c.conn.state);
      const changed = await c.vars.serial(() => leave(c.db, userId));
      await push(c.db, c.client<typeof registry>(), changed);
    },

    kick: async (c, memberId: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      const changed = await c.vars.serial(async () => {
        const company = await ownedCompany(c.db, userId);
        const member = typeof memberId === "number" ? await userById(c.db, memberId).catch(() => null) : null;
        if (!member || member.companyId !== company.id || member.id === userId)
          throw new UserError("They're not in your company.", { code: "not_found" });
        return leave(c.db, member.id);
      });
      await push(c.db, c.client<typeof registry>(), changed);
    },

    renameCompany: async (c, rawName: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      const company = await ownedCompany(c.db, userId);
      await renameCompany(c.db, c.client<typeof registry>(), company.id, rawName);
    },

    /**
     * The owner sets the company's website (empty clears it). The sign shows it at
     * once; the house is repainted in the brand's colours when reading the site is done.
     */
    setWebsite: async (c, raw: unknown): Promise<MyCompany> => {
      const userId = requireUser(c.conn.state);
      const company = await ownedCompany(c.db, userId);
      const website = raw === "" ? null : parseWebsite(raw);
      if (website === null && raw !== "")
        throw new UserError("That doesn't look like a website. Try acme.com.", { code: "invalid_website" });
      if (website && website !== company.website && !c.vars.brandings.take(String(company.id), Date.now()))
        throw new UserError("That's a lot of websites. Try again in an hour.", { code: "rate_limited" });
      const client = c.client<typeof registry>();
      if (website !== company.website) {
        await c.db.execute(
          "UPDATE companies SET website = ?, branding = ?, brand = NULL WHERE id = ?",
          website,
          website && canBrand() ? "working" : null,
          company.id,
        );
        await push(c.db, client, { companies: [company.id], users: [] });
        if (website && canBrand()) c.waitUntil(brand(c.db, client, company.id, company.name, website));
      }
      return myCompany(c.db, company.id, userId);
    },

    wallet: (c): Promise<Wallet> => wallet(c.db, requireUser(c.conn.state), Date.now()),

    /** What I hold, per kind, for the bag panel. */
    bag: (c): Promise<BagRow[]> => bag(c.db, requireUser(c.conn.state)),

    buy: async (c, itemId: unknown): Promise<Wallet> => {
      const userId = requireUser(c.conn.state);
      const item = itemById(itemId);
      if (!item) throw new UserError("That's not in the shop.", { code: "not_found" });
      if (item.level !== undefined)
        throw new UserError("That one is earned, not bought.", { code: "not_for_sale" });
      return c.vars.serial(() => buy(c.db, userId, item, Date.now()));
    },

    // MARK: Drops

    /**
     * One of mine onto the floor where I am, for anyone to take. A full room says so (the notice is for
     * the Bag), and the item stays mine.
     */
    drop: async (c, itemId: unknown): Promise<{ notice: string; drop?: Drop }> => {
      const userId = requireUser(c.conn.state);
      const client = c.client<typeof registry>();
      const out = await c.vars.serial(async () => {
        const id = await takeOut(c.db, userId, itemId, Date.now());
        // ponytail: one that landed but timed out stays on the floor with its row back here: taking it
        // gets nothing (`pickUp` is false). `removeDrops` it here if that ever shows up.
        const put = await main(client)
          .world.placeDrop({ id, item: itemId as string, by: userId })
          .catch((err) => {
            console.warn(`[drop] ${id}: ${String(err)}`);
            return { notice: "That didn't work. Try again." };
          });
        if ("notice" in put) {
          await giveBack(c.db, [id]);
          return put;
        }
        await unwear(c.db, userId, [put.item]);
        return { notice: `Dropped the ${dropName(put)}.`, drop: put };
      });
      // Off it comes, if it was the last one worn.
      if ("drop" in out) await pushPlayers(c.db, client, [userId]);
      return out;
    },

    /** From `world.take`: a drop into the taker's bag. False if it went back to its dropper first. */
    pickUp: async (c, dropId: number, userId: number): Promise<boolean> => {
      requireInternal(c.conn.state);
      return pickUp(c.db, dropId, userId);
    },

    /** The alarm, every 10 minutes: drops nobody took in an hour go back to whoever dropped them. */
    sweep: async (c): Promise<void> => {
      // The alarm calls with no connection; anyone else has one, and has to be inside.
      if (c.conn) requireInternal(c.conn.state);
      const ids = await unclaimed(c.db, Date.now() - DROP_TTL);
      if (ids.length === 0) return;
      // Off the floor first: if `world` is down, nothing changed and the next sweep tries again.
      await main(c.client<typeof registry>()).world.removeDrops(ids);
      await giveBack(c.db, ids);
    },

    // MARK: Trades

    /** Offers `toId` my `give` for their `want`. It replaces my open offer, if I had one. */
    offerTrade: async (c, toId: unknown, rawGive: unknown, rawWant: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      if (typeof toId !== "number") throw new UserError("Unknown player.", { code: "not_found" });
      if (toId === userId) throw new UserError("Trade with someone else.", { code: "invalid_trade" });
      const me = await userById(c.db, userId);
      const them = await userById(c.db, toId);
      const give = parseSide(rawGive);
      const want = parseSide(rawWant);
      if (give && want && emptySide(give) && emptySide(want))
        throw new UserError("Offer something, or ask for something.", { code: "invalid_trade" });
      if (!give || !want)
        throw new UserError(`Up to 🪙 ${TRADE_COINS_CAP} and ${TRADE_ITEMS_CAP} shop items a side.`, {
          code: "invalid_trade",
        });
      const now = Date.now();
      const trade = { fromId: userId, from: me.name, toId, to: them.name, give, want, at: now };
      // Their coins are theirs to know: accepting checks them.
      await checkTrade(c.db, { ...trade, want: { ...want, coins: 0 } }, now);
      if (!c.vars.trades.take(String(userId), now))
        throw new UserError("That's a lot of offers. Try again in an hour.", { code: "rate_limited" });
      await c.db.execute(
        "INSERT OR REPLACE INTO trades (from_id, to_id, give, want, at) VALUES (?, ?, ?, ?, ?)",
        userId,
        toId,
        JSON.stringify(give),
        JSON.stringify(want),
        now,
      );
      await notify(c.client<typeof registry>(), toId, {
        text: `${me.name} offers you a trade.`,
        open: "trades",
      });
    },

    /** Offers to me and my own, newest first. */
    trades: async (c): Promise<{ incoming: Trade[]; outgoing: Trade | null }> => {
      const userId = requireUser(c.conn.state);
      await c.db.execute("DELETE FROM trades WHERE at < ?", Date.now() - TRADE_TTL);
      return {
        incoming: await tradesWhere(c.db, "to_id = ?", userId),
        outgoing: (await tradesWhere(c.db, "from_id = ?", userId))[0] ?? null,
      };
    },

    /** `at`: the offer as I saw it, so one swapped meanwhile isn't accepted unseen. */
    acceptTrade: async (c, fromId: unknown, at: unknown): Promise<Wallet> => {
      const userId = requireUser(c.conn.state);
      const now = Date.now();
      const trade = await c.vars.serial(async () => {
        const trade = await offerTo(c.db, userId, fromId, now);
        if (trade.at !== at)
          throw new UserError("They changed the offer. Have another look.", { code: "not_found" });
        await settleTrade(c.db, trade, now);
        return trade;
      });
      const client = c.client<typeof registry>();
      // Looks may have changed.
      await pushPlayers(c.db, client, [trade.fromId, userId]);
      await notify(client, trade.fromId, { text: `${trade.to} accepted your trade.`, open: "bag" });
      return wallet(c.db, userId, now);
    },

    declineTrade: async (c, fromId: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      const trade = await offerTo(c.db, userId, fromId, Date.now());
      await c.db.execute("DELETE FROM trades WHERE from_id = ? AND at = ?", trade.fromId, trade.at);
      await notify(c.client<typeof registry>(), trade.fromId, { text: `${trade.to} passed on your trade.` });
    },

    withdrawTrade: async (c): Promise<void> => {
      await c.db.execute("DELETE FROM trades WHERE from_id = ?", requireUser(c.conn.state));
    },

    /** What `userId` could trade away, for the trade panel. */
    tradeables: async (c, targetId: unknown): Promise<{ name: string; owned: string[] }> => {
      requireUser(c.conn.state);
      if (typeof targetId !== "number") throw new UserError("Unknown player.", { code: "not_found" });
      const u = await userById(c.db, targetId);
      return { name: u.name, owned: (await ownedItems(c.db, u.id)).filter(isTradeable) };
    },

    /** Someone's office: what's in it, whether it's open, and what having one takes (level, company). */
    office: async (c, targetId: unknown): Promise<Office & { level: number; companyId: number | null }> => {
      requireUser(c.conn.state);
      if (typeof targetId !== "number") throw new UserError("Unknown player.", { code: "not_found" });
      const u = await userById(c.db, targetId);
      return { ...(await officeOf(c.db, u.id)), level: await levelOf(c.db, u.id), companyId: u.companyId };
    },

    /** Saves my office's furniture, from my bag. */
    setOffice: async (c, raw: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      if ((await levelOf(c.db, userId)) < OFFICE_LEVEL)
        throw new UserError(`Your own office opens at level ${OFFICE_LEVEL}.`, { code: "too_low" });
      if ((await userById(c.db, userId)).companyId === null)
        throw new UserError("Offices are in company buildings. Join a company first.", {
          code: "no_company",
        });
      const furniture = parseOffice(raw);
      if (!furniture) throw new UserError("That doesn't fit in the office.", { code: "invalid_office" });
      await c.vars.serial(() => furnish(c.db, userId, furniture, Date.now()));
      await pushOffice(c.db, c.client<typeof registry>(), userId);
    },

    /** Open: anyone can visit from my player card. Closed: only I get in, through the door. */
    setOfficeOpen: async (c, open: unknown): Promise<void> => {
      const userId = requireUser(c.conn.state);
      if (typeof open !== "boolean") throw new UserError("Open or closed?", { code: "invalid_office" });
      await starterOffice(c.db, userId, Date.now());
      await c.db.execute("UPDATE offices SET open = ? WHERE user_id = ?", open ? 1 : 0, userId);
      await pushOffice(c.db, c.client<typeof registry>(), userId);
    },

    /** From `player` after an ingest: replaces those days' rollups and hands out level rewards reached. */
    report: async (
      c,
      userId: number,
      days: string[],
      usage: UsageDay[],
      activity: ActivityDay[],
    ): Promise<void> => {
      requireInternal(c.conn.state);
      await c.vars.serial(() =>
        c.db.transaction(
          async (tx) => {
            const inDays = `day IN (${days.map(() => "?").join(",")})`;
            await tx.execute(`DELETE FROM usage_daily WHERE user_id = ? AND ${inDays}`, userId, ...days);
            await insertRows(
              tx,
              "INSERT INTO usage_daily (user_id, day, model, input, output, cache_creation, cache_read, turns, reported_cost_cents) VALUES",
              usage.map((r) => [
                userId,
                r.day,
                r.model,
                r.input,
                r.output,
                r.cacheCreation,
                r.cacheRead,
                r.turns,
                r.reportedCostCents ?? 0,
              ]),
            );
            await insertRows(
              tx,
              "INSERT OR REPLACE INTO activity_daily VALUES",
              activity.map((a) => [
                userId,
                a.day,
                a.prompts,
                a.prs,
                a.agentBuckets,
                a.activeBuckets,
                a.peakAgents,
              ]),
            );
            await tx.execute(`DELETE FROM capped_daily WHERE user_id = ? AND ${inDays}`, userId, ...days);
            await insertRows(
              tx,
              "INSERT INTO capped_daily VALUES",
              activity.filter((a) => a.capped > 0).map((a) => [userId, a.day, a.capped]),
            );
            await grantRewards(tx, userId, await levelOf(tx, userId), Date.now());
          },
          { name: "report-usage" },
        ),
      );
      const u = await userById(c.db, userId);
      await push(c.db, c.client<typeof registry>(), {
        users: [userId],
        companies: u.companyId === null ? [] : [u.companyId],
      });
    },

    leaderboard: (c, rawRange: unknown, rawSort: unknown): Promise<Leaderboard> =>
      leaderboard(
        c.db,
        requireUser(c.conn.state),
        isRangeKey(rawRange) ? rawRange : "today",
        isSortKey(rawSort) ? rawSort : "tokens",
        Date.now(),
      ),

    /** A company's card: its numbers, website, logo and people. */
    company: (c, companyId: unknown, rawRange: unknown): Promise<CompanyProfile> => {
      requireUser(c.conn.state);
      if (typeof companyId !== "number") throw new UserError("That company is gone.", { code: "not_found" });
      return companyProfile(c.db, companyId, isRangeKey(rawRange) ? rawRange : "30d", Date.now());
    },

    profile: async (c, targetId: unknown, rawRange: unknown): Promise<Profile> => {
      requireUser(c.conn.state);
      if (typeof targetId !== "number") throw new UserError("Unknown player.", { code: "not_found" });
      const range = isRangeKey(rawRange) ? rawRange : "30d";
      return profile(c.db, targetId, range, Date.now());
    },

    /** Names starting with `prefix`, for @-mention suggestions. */
    searchNames: async (c, prefix: unknown): Promise<string[]> => {
      requireUser(c.conn.state);
      if (typeof prefix !== "string" || !/^[a-z0-9._-]{1,32}$/i.test(prefix)) return [];
      const from = prefix.toLowerCase();
      const rows = await all<{ name: string }>(
        c.db,
        "SELECT name FROM users WHERE name >= ? AND name < ? ORDER BY name LIMIT 8",
        from,
        `${from}\uffff`,
      );
      return rows.map((r) => r.name);
    },

    /** The HUD's corner: my numbers today and today's top 5. */
    today: (c): Promise<Today> => today(c.db, requireSyncer(c.conn.state), Date.now()),

    // MARK: Coins for games (from `arcade` only)

    /** Takes a stake or a side bet from each entry, or from nobody. */
    hold: async (c, ref: string, kind: HoldKind, entries: Entry[]): Promise<void> => {
      requireInternal(c.conn.state);
      const names = await namesOf(
        c.db,
        entries.map((e) => e.userId),
      );
      await c.vars.serial(() => hold(c.db, ref, kind, entries, names, Date.now()));
    },

    pay: async (c, ref: string, kind: PayKind, entries: Entry[]): Promise<void> => {
      requireInternal(c.conn.state);
      await c.vars.serial(() => pay(c.db, ref, kind, entries, Date.now()));
    },

    /** What a ref still holds, so settling a game can be retried without paying twice. */
    held: async (c, ref: string): Promise<number> => {
      requireInternal(c.conn.state);
      return [...(await heldIn(c.db, ref)).values()].reduce((a, b) => a + b, 0);
    },

    refund: async (c, ref: string, userIds?: number[]): Promise<void> => {
      requireInternal(c.conn.state);
      await c.vars.serial(() => refund(c.db, ref, Date.now(), userIds));
    },

    /** A finished game, for stats. */
    recordMatch: async (
      c,
      matchId: number,
      game: string,
      stake: number,
      players: Placed[],
    ): Promise<void> => {
      requireInternal(c.conn.state);
      await recordMatch(c.db, matchId, game, stake, players, Date.now());
    },

    gameBoard: (c, rawRange: unknown): Promise<GamePlayer[]> => {
      requireUser(c.conn.state);
      return gameBoard(c.db, isRangeKey(rawRange) ? rawRange : "today", Date.now());
    },

    /** User ids for names (inviting people to a game by name). */
    ids: async (c, names: string[]): Promise<Record<string, number>> => {
      requireInternal(c.conn.state);
      const rows = await all<{ id: number; name: string }>(
        c.db,
        "SELECT id, name FROM users WHERE name IN (SELECT value FROM json_each(?))",
        JSON.stringify(names.map((n) => String(n).toLowerCase())),
      );
      return Object.fromEntries(rows.map((r) => [r.name, r.id]));
    },

    /** Names for user ids (tables and matches show who's playing). */
    names: async (c, userIds: number[]): Promise<Record<number, string>> => {
      requireInternal(c.conn.state);
      return namesOf(c.db, userIds);
    },

    // MARK: The admin page (`ADMIN_TOKEN`)

    adminOverview: (c): Promise<AdminOverview> => {
      requireAdmin(c.conn.state);
      return overview(c.db, Date.now());
    },

    adminUsers: (c): Promise<AdminUser[]> => {
      requireAdmin(c.conn.state);
      return adminUsers(c.db, Date.now());
    },

    adminCompanies: (c): Promise<AdminCompany[]> => {
      requireAdmin(c.conn.state);
      return adminCompanies(c.db);
    },

    adminLog: (c): Promise<AdminLogEntry[]> => {
      requireAdmin(c.conn.state);
      return adminLog(c.db);
    },

    /** Sets someone's balance; returns it. */
    adminSetCoins: async (c, userId: unknown, balance: unknown): Promise<number> => {
      requireAdmin(c.conn.state);
      if (!Number.isSafeInteger(balance) || (balance as number) < 0 || (balance as number) > 10_000_000)
        throw new UserError("Use a whole number from 0 to 10,000,000.", { code: "invalid_amount" });
      const user = await adminTarget(c.db, userId);
      const now = Date.now();
      const set = await c.vars.serial(() => setBalance(c.db, user.id, balance as number, now));
      await logAdmin(c.db, "set coins", who(user), `${set.before} → ${set.balance}`, now);
      return set.balance;
    },

    adminRenameUser: async (c, userId: unknown, rawName: unknown): Promise<void> => {
      requireAdmin(c.conn.state);
      const user = await adminTarget(c.db, userId);
      await renameUser(c.db, c.vars.serial, c.client<typeof registry>(), user.id, rawName);
      await logAdmin(c.db, "rename user", who(user), `→ ${userName(rawName)}`, Date.now());
    },

    /** Takes someone out of their company (the owner hands over, the last one out closes it). */
    adminRemoveFromCompany: async (c, userId: unknown): Promise<void> => {
      requireAdmin(c.conn.state);
      const user = await adminTarget(c.db, userId);
      const changed = await c.vars.serial(() => leave(c.db, user.id));
      await push(c.db, c.client<typeof registry>(), changed);
      await logAdmin(c.db, "remove from company", who(user), `company #${user.companyId}`, Date.now());
    },

    /** Forgets someone's usage, raw events and all: for numbers that were made up. */
    adminWipeUsage: async (c, userId: unknown): Promise<void> => {
      requireAdmin(c.conn.state);
      const user = await adminTarget(c.db, userId);
      const client = c.client<typeof registry>();
      const days = await client.player.get([String(user.id)], internal).wipe();
      await c.vars.serial(() => wipeUsage(c.db, user.id));
      await push(c.db, client, {
        users: [user.id],
        companies: user.companyId === null ? [] : [user.companyId],
      });
      await logAdmin(c.db, "wipe usage", who(user), `${days.length} days`, Date.now());
    },

    /** Deletes an account for good: their device token and sessions stop working, and they leave the world. */
    adminDeleteUser: async (c, userId: unknown): Promise<void> => {
      requireAdmin(c.conn.state);
      const user = await adminTarget(c.db, userId);
      const now = Date.now();
      const changed = await c.vars.serial(() => deleteUser(c.db, user.id, now));
      await logAdmin(c.db, "delete user", who(user), null, now);
      const client = c.client<typeof registry>();
      await push(c.db, client, changed);
      // Out of the world with their drops; what others dropped in their office goes back to them.
      await giveBack(c.db, await main(client).world.removePlayer(user.id));
      await client.player.get([String(user.id)], internal).close();
    },

    adminRenameCompany: async (c, companyId: unknown, rawName: unknown): Promise<void> => {
      requireAdmin(c.conn.state);
      const company = typeof companyId === "number" ? await companyById(c.db, companyId) : undefined;
      if (!company) throw new UserError("That company is gone.", { code: "not_found" });
      await renameCompany(c.db, c.client<typeof registry>(), company.id, rawName);
      await logAdmin(
        c.db,
        "rename company",
        `${company.name} (#${company.id})`,
        `→ ${companyName(rawName)}`,
        Date.now(),
      );
    },

    adminCloseCompany: async (c, companyId: unknown): Promise<void> => {
      requireAdmin(c.conn.state);
      const client = c.client<typeof registry>();
      const company = typeof companyId === "number" ? await companyById(c.db, companyId) : undefined;
      if (!company) throw new UserError("That company is gone.", { code: "not_found" });
      const changed = await c.vars.serial(() => closeCompany(c.db, company.id));
      await logAdmin(
        c.db,
        "close company",
        `${company.name} (#${company.id})`,
        `${changed.users.length} members`,
        Date.now(),
      );
      await push(c.db, client, changed);
      for (const id of changed.users)
        await notify(client, id, { text: "Your company was closed by the town admin.", open: "company" });
    },

    /** For `world` starting from nothing: everyone, every company and every saved office. */
    seed: async (
      c,
    ): Promise<{ players: PlayerCore[]; companies: CompanyInfo[]; offices: Record<number, Office> }> => {
      requireInternal(c.conn.state);
      const users = await all<UserRow>(c.db, `SELECT ${USER_COLS} FROM users`);
      const companies = await all<{ id: number }>(c.db, "SELECT id FROM companies");
      return {
        players: await playerCores(
          c.db,
          users.map((u) => u.id),
        ),
        companies: await companyInfos(
          c.db,
          companies.map((r) => r.id),
        ),
        offices: await offices(c.db),
      };
    },
  },
});

type Client = Parameters<typeof push>[1];

/** How the admin log names someone. */
const who = (u: { id: number; name: string }) => `${u.name} (#${u.id})`;

const adminTarget = (sql: Sql, userId: unknown) => {
  if (typeof userId !== "number") throw new UserError("Unknown player.", { code: "not_found" });
  return userById(sql, userId);
};

/** For the player themselves, and for the admin page. Run under `serial`, since names are unique. */
async function renameUser(
  sql: Sql,
  run: ReturnType<typeof serial>,
  client: Client,
  userId: number,
  rawName: unknown,
): Promise<void> {
  const name = userName(rawName);
  await run(async () => {
    const taken = await one<{ id: number }>(sql, "SELECT id FROM users WHERE name = ?", name);
    if (taken && taken.id !== userId) throw new UserError("That name is taken.", { code: "name_taken" });
    await sql.execute("UPDATE users SET name = ? WHERE id = ?", name, userId);
  });
  await pushPlayers(sql, client, [userId]);
}

async function renameCompany(sql: Sql, client: Client, companyId: number, rawName: unknown): Promise<void> {
  const name = companyName(rawName);
  await sql.execute("UPDATE companies SET name = ? WHERE id = ?", name, companyId);
  await push(sql, client, { companies: [companyId], users: [] });
}

/** The open offer `fromId` made me, or `not_found`. */
async function offerTo(sql: Sql, userId: number, fromId: unknown, now: number): Promise<Trade> {
  const [trade] =
    typeof fromId === "number"
      ? await tradesWhere(sql, "from_id = ? AND to_id = ? AND at >= ?", fromId, userId, now - TRADE_TTL)
      : [];
  if (!trade) throw new UserError("That offer is gone.", { code: "not_found" });
  return trade;
}

async function namesOf(sql: Sql, userIds: number[]): Promise<Record<number, string>> {
  const rows = await all<{ id: number; name: string }>(
    sql,
    "SELECT id, name FROM users WHERE id IN (SELECT value FROM json_each(?))",
    JSON.stringify(userIds),
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}
