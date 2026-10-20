import type { Brand, Notice } from "@tokenmaxxing/core/world.ts";
import type { Client } from "rivetkit/client";
import type { registry } from "../actors/registry.ts";
import { main, type Sql, serial } from "../actors/shared.ts";
import { brandFor } from "../brand.ts";
import { giveBack, officeOf } from "./coins.ts";
import { type Changed, companyInfos } from "./companies.ts";
import { playerCores } from "./users.ts";

// Each push reads the database as it is now and sends that: one at a time, or an older read lands
// after a newer one. Two leaving a company at once left the closed company standing in the world.
// One queue for the module: there's one town.
const inOrder = serial();

export function pushPlayers(sql: Sql, client: Client<typeof registry>, userIds: number[]): Promise<void> {
  return inOrder(() => sendPlayers(sql, client, userIds));
}

async function sendPlayers(sql: Sql, client: Client<typeof registry>, userIds: number[]): Promise<void> {
  const world = main(client).world;
  // A door that came or went can leave drops where the building has no place for them: they go home.
  for (const p of await playerCores(sql, userIds)) await giveBack(sql, await world.setPlayer(p));
}

export function push(sql: Sql, client: Client<typeof registry>, changed: Changed): Promise<void> {
  return inOrder(async () => {
    const world = main(client).world;
    const companies = [...new Set(changed.companies)];
    const infos = await companyInfos(sql, companies);
    for (const id of companies) {
      const info = infos.find((i) => i.id === id);
      // Drops the town has no place for any more go back to whoever dropped them; for a closed company,
      // what was in its building too.
      await giveBack(sql, await (info ? world.setCompany(info) : world.removeCompany(id)));
    }
    await sendPlayers(sql, client, [...new Set(changed.users)]);
  });
}

/** Someone's office opened or closed: the 🔒 on its door. */
export function pushOffice(sql: Sql, client: Client<typeof registry>, userId: number): Promise<void> {
  return inOrder(async () => {
    await main(client).world.setOfficeOpen(userId, (await officeOf(sql, userId)).open);
  });
}

/** Reads the website and stores the house's colours and logo, unless the website changed meanwhile. */
export async function brand(
  sql: Sql,
  client: Client<typeof registry>,
  id: number,
  name: string,
  website: string,
) {
  const result = await brandFor(id, name, website).catch((err) => {
    console.warn(`[brand] ${website}: ${err instanceof Error ? err.message : err}`);
    return null;
  });
  await sql.execute(
    "UPDATE companies SET branding = ?, brand = ? WHERE id = ? AND website = ?",
    result ? null : "failed",
    result ? JSON.stringify({ ...result.palette, logo: result.logo } satisfies Brand) : null,
    id,
    website,
  );
  await push(sql, client, { companies: [id], users: [] });
}

/**
 * A line for one player's open game tabs (someone applied, you got in); nothing if they're offline.
 * Best effort: what caused it has already happened.
 */
export async function notify(client: Client<typeof registry>, userId: number, notice: Notice): Promise<void> {
  await main(client)
    .world.notify(userId, notice)
    .catch((err) => console.warn(`[notify] ${userId}: ${String(err)}`));
}
