import type { Brand, Notice } from "@tokenmaxxing/core/world.ts";
import type { Client } from "rivetkit/client";
import type { registry } from "../actors/registry.ts";
import { main, type Sql } from "../actors/shared.ts";
import { brandFor } from "../brand.ts";
import { giveBack, officeOf } from "./coins.ts";
import { type Changed, companyInfos } from "./companies.ts";
import { playerCores } from "./users.ts";

export async function pushPlayers(
  sql: Sql,
  client: Client<typeof registry>,
  userIds: number[],
): Promise<void> {
  const world = main(client).world;
  for (const p of await playerCores(sql, userIds)) await world.setPlayer(p);
}

export async function push(sql: Sql, client: Client<typeof registry>, changed: Changed): Promise<void> {
  const world = main(client).world;
  const companies = [...new Set(changed.companies)];
  const infos = await companyInfos(sql, companies);
  for (const id of companies) {
    const info = infos.find((i) => i.id === id);
    if (info) await world.setCompany(info);
    // Closed: what was dropped in its building goes back to whoever dropped it.
    else await giveBack(sql, await world.removeCompany(id));
  }
  await pushPlayers(sql, client, [...new Set(changed.users)]);
}

/** Someone's office opened or closed: the 🔒 on its door. */
export async function pushOffice(sql: Sql, client: Client<typeof registry>, userId: number): Promise<void> {
  await main(client).world.setOfficeOpen(userId, (await officeOf(sql, userId)).open);
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
