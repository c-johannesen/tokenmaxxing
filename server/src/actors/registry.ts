import { setup } from "rivetkit";
import { arcade } from "./arcade.ts";
import { match } from "./match.ts";
import { player } from "./player.ts";
import { town } from "./town.ts";
import { world } from "./world.ts";

/** RivetKit reads RIVET_RUN_ENGINE_PORT too; tests move it off the dev server's port. */
export const ENGINE_PORT = Number(process.env.RIVET_RUN_ENGINE_PORT ?? 6420);

/**
 * The engine's admin token: it refuses requests without it. Browsers and the app never have it (or
 * need it): the proxy adds it to what it forwards, which is only the client gateway, and the actors
 * check who you are themselves. RivetKit's default for a local engine, spelled out: clients it sees as
 * local (localhost, as in tests and dev) send it on their own, and nothing else would.
 */
export const ENGINE_TOKEN = "default";

/**
 * One process runs everything: RivetKit starts the engine on localhost and
 * `main.ts` exposes only the client gateway through its own server.
 */
export const registry = setup({
  use: { town, player, world, arcade, match },
  startEngine: true,
  token: ENGINE_TOKEN,
  engineHost: "127.0.0.1",
  enginePort: ENGINE_PORT,
  startServices: false,
  noWelcome: true,
  // A sync batch is up to 1000 events (~300 KB of JSON); the default cap is 64 KB.
  maxIncomingMessageSize: 1024 * 1024,
  // Rejected actions (a taken name, say) log as warnings: noise. The native side reads
  // RIVET_LOG_LEVEL from the real environment instead (see package.json and the Dockerfile).
  logging: { level: "error" },
  // ponytail: one process holds the engine and every actor, so a deploy restarts both and
  // there's never an old runner to drain. Bump this if actors ever run on more than one host.
  envoy: { version: 1 },
  // Railway waits a few seconds after SIGTERM; the default grace is the engine's 30 minutes.
  shutdown: { gracePeriodMs: 5_000 },
});

export type { DeviceInfo } from "./player.ts";
export type {
  AdminCompany,
  AdminLogEntry,
  AdminOverview,
  AdminUser,
  BagRow,
  BoardCompany,
  BoardPlayer,
  CompanyProfile,
  GamePlayer,
  Leaderboard,
  Listing,
  Me,
  MyCompany,
  Profile,
  Today,
  Trade,
  Wallet,
} from "./town.ts";
