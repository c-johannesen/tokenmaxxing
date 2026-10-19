import { describe, expect, test } from "bun:test";
import { BOTS } from "@tokenmaxxing/core/bots.ts";
import { MAPS } from "@tokenmaxxing/core/maps.ts";
import { hqMap } from "@tokenmaxxing/core/office.ts";
import {
  type ChatLine,
  cupsLeft,
  DROPS,
  type Drop,
  type Moves,
  mapOf,
  outsideDoor,
  type PlayerInfo,
  roomEntry,
  route,
  type Snapshot,
  setDrops,
} from "@tokenmaxxing/core/world.ts";
import { town } from "../src/actors/town.ts";
import { world } from "../src/actors/world.ts";
import { bag, grantRewards, placed, takeOut } from "../src/town/coins.ts";
import { migrate } from "../src/town/schema.ts";
import { memorySql } from "./memory-sql.ts";
import { admin, admit, as, event, eventually, HOUR, rich, signUp, veteran } from "./rivet.ts";

async function connect(token: string) {
  const conn = as(token).world.connect();
  const events = {
    moves: [] as Moves[],
    chat: [] as ChatLine[],
    snapshots: [] as Snapshot[],
    mentions: [] as ChatLine[],
    drops: [] as Drop[],
    pickups: [] as { id: number }[],
    infos: [] as PlayerInfo[],
  };
  conn.on("info", (i: PlayerInfo) => events.infos.push(i));
  conn.on("mention", (l: ChatLine) => events.mentions.push(l));
  conn.on("drop", (d: Drop) => events.drops.push(d));
  conn.on("pickup", (p: { id: number }) => events.pickups.push(p));
  conn.on("moves", (m: Moves) => events.moves.push(m));
  conn.on("chat", (l: ChatLine) => events.chat.push(l));
  conn.on("snapshot", (s: Snapshot) => events.snapshots.push(s));
  const snap = await conn.join();
  return { conn, snap, events };
}

/** Walks `dirs` one step at a time, at running pace. */
async function walk(conn: Awaited<ReturnType<typeof connect>>["conn"], dirs: string[]) {
  const results = [];
  for (const d of dirs) {
    results.push(await conn.step(d));
    await Bun.sleep(105);
  }
  return results;
}

/** Closes `c`'s tab, and waits until `watcher` hears they're offline: in bed, remembering where they were. */
async function asleep(c: Awaited<ReturnType<typeof connect>>, watcher: typeof c, userId: number) {
  await c.conn.dispose();
  await eventually(() => expect(watcher.events.infos.findLast((i) => i.id === userId)?.online).toBe(false));
}

describe("world", () => {
  test("a new player rests at the Inn and wakes up there", async () => {
    const a = await signUp("w");
    const { conn, snap } = await connect(a.token);
    expect(snap.room).toBe("inn");
    const me = snap.players.find((p) => p.id === a.userId)!;
    expect(me.state).toBe("idle");
    expect(me.online).toBe(true);
    await conn.dispose();
  });

  test("walking out of the Inn lands in town, next to its door", async () => {
    const a = await signUp("w");
    const { conn, events, snap } = await connect(a.token);
    const me = snap.players.find((p) => p.id === a.userId)!;
    const path = route(MAPS.inn, [me.x, me.y], MAPS.inn.find("x")[0]!)!;
    const results = await walk(conn, path);
    expect(results.at(-1)).toEqual({ ...outsideDoor("inn"), state: "idle" });
    await eventually(() => expect(events.snapshots.at(-1)!.room).toBe("town"));
    await conn.dispose();
  });

  test("reloading puts you back where you were, not in bed", async () => {
    const a = await signUp("back");
    const first = await connect(a.token);
    const me = first.snap.players.find((p) => p.id === a.userId)!;
    await walk(first.conn, route(MAPS.inn, [me.x, me.y], MAPS.inn.find("x")[0]!)!);
    await walk(first.conn, ["left", "left"]);
    await Bun.sleep(150);
    // Closing the tab sends them to bed at the Inn...
    await first.conn.dispose();
    await Bun.sleep(300);
    // ...and opening it again gets them up where they left off.
    const again = await connect(a.token);
    const door = outsideDoor("inn");
    expect(again.snap.room).toBe("town");
    const back = again.snap.players.find((p) => p.id === a.userId)!;
    expect([back.x, back.y, back.state]).toEqual([door.x - 2, door.y, "idle"]);
    await again.conn.dispose();
  });

  test("steps into walls are refused; teleport-speed steps are corrected", async () => {
    const a = await signUp("w");
    const { conn } = await connect(a.token);
    const burst = await Promise.all(Array.from({ length: 8 }, () => conn.step("left")));
    expect(burst.some((r) => r !== null)).toBe(true);
    await conn.dispose();
  });

  test("coffee makes you shake, and more cups make it last longer", async () => {
    const a = await signUp("coffee");
    const { conn, snap } = await connect(a.token);
    const infos: PlayerInfo[] = [];
    conn.on("info", (i: PlayerInfo) => infos.push(i));
    const me = snap.players.find((p) => p.id === a.userId)!;
    const path = route(MAPS.inn, [me.x, me.y], MAPS.inn.find("o")[0]!)!;
    await walk(conn, path.slice(0, -1));
    expect(await conn.drink("down")).toBeNull(); // not facing the machine
    expect(await conn.drink(path.at(-1))).toEqual({ notice: expect.stringContaining("fresh cup") });
    expect(await conn.drink(path.at(-1))).toEqual({ notice: expect.stringContaining("Second cup") });
    await eventually(() => {
      const until = infos.filter((i) => i.id === a.userId).at(-1)?.coffeeUntil ?? 0;
      expect(cupsLeft(until, Date.now())).toBeGreaterThan(1.5);
    });
    await conn.dispose();
  });

  test("bots are up and about in town, and wander off", async () => {
    const a = await signUp("w");
    const { conn, events, snap } = await connect(a.token);
    const me = snap.players.find((p) => p.id === a.userId)!;
    await walk(conn, route(MAPS.inn, [me.x, me.y], MAPS.inn.find("x")[0]!)!);
    await eventually(() => expect(events.snapshots.at(-1)?.room).toBe("town"));
    const bot = events.snapshots.at(-1)!.players.find((p) => p.id === BOTS[0]!.id)!;
    expect(bot).toMatchObject({ name: BOTS[0]!.name, online: true, dozing: false, state: "idle" });
    await eventually(
      () => expect(events.moves.some((m) => m.m.some(([id]) => id === bot.id))).toBe(true),
      20_000,
    );
    await conn.dispose();
  }, 30_000);

  test("chat reaches the room, and only the room", async () => {
    const a = await signUp("chat");
    const b = await signUp("chat");
    const co = await a.town.createCompany("Chatters");
    await admit(a, b, co.id);
    const ca = await connect(a.token);
    const cb = await connect(b.token);
    await ca.conn.say("hello inn?");
    // a rests at the company house now, b too: same room, both hear it.
    expect(ca.snap.room).toBe(`hq:${co.id}`);
    await eventually(() => expect(cb.events.chat.map((l) => l.text)).toContain("hello inn?"));

    const outsider = await signUp("chat");
    const co2 = await connect(outsider.token);
    await ca.conn.say("members only");
    await Bun.sleep(200);
    expect(co2.events.chat.map((l) => l.text)).not.toContain("members only");
    await expect(outsider.town.me()).resolves.toBeDefined();
    for (const c of [ca, cb, co2]) await c.conn.dispose();
  });

  test("from town you see who is inside a house, names and levels, without going in", async () => {
    const member = await signUp("peek");
    const co = await member.town.createCompany("Glass House");
    const outsider = await signUp("peek");
    const o = await connect(outsider.token);
    // Freelancers wake at the Inn: walk out into town, where the houses are.
    const me = o.snap.players.find((p) => p.id === outsider.userId)!;
    await walk(o.conn, route(MAPS.inn, [me.x, me.y], MAPS.inn.find("x")[0]!)!);
    const town = await eventually(() => {
      const snap = o.events.snapshots.at(-1)!;
      expect(snap.room).toBe("town");
      return snap;
    });
    // The member is offline, so asleep in their house.
    expect(town.houses[co.id]).toEqual([
      { id: member.userId, name: member.name, level: 0, look: expect.any(Object), state: "away" },
    ]);
    await o.conn.dispose();
  });

  test("an @mention reaches someone in another room, once", async () => {
    const a = await signUp("ment");
    const co = await a.town.createCompany("Mentioners");
    const b = await signUp("ment"); // a freelancer: wakes up at the Inn, not in a's house
    const ca = await connect(a.token);
    const cb = await connect(b.token);
    expect(ca.snap.room).toBe(`hq:${co.id}`);
    expect(cb.snap.room).toBe("inn");
    await ca.conn.say(`hey @${b.name.toUpperCase()} and @${b.name} and @nobody`);
    await eventually(() =>
      expect(cb.events.mentions.map((l) => l.text)).toEqual([
        `hey @${b.name.toUpperCase()} and @${b.name} and @nobody`,
      ]),
    );
    expect(cb.events.chat).toHaveLength(0);
    expect(ca.events.mentions).toHaveLength(0);
    for (const c of [ca, cb]) await c.conn.dispose();
  });

  test("offline players work at a desk while agents run, and sleep otherwise", async () => {
    const a = await signUp("rest");
    const viewer = await signUp("rest");
    const v = await connect(viewer.token); // both freelancers: both at the Inn
    await as(a.token)
      .player(a.userId)
      .ingest([event({ timestamp: Date.now() - 60_000 })]);
    await eventually(() => {
      const moved = v.events.moves.flatMap((m) => [
        ...m.m,
        ...m.join.map((p) => [p.id, p.x, p.y, p.facing, p.state]),
      ]);
      expect(moved.filter((m) => m[0] === a.userId).at(-1)?.[4]).toBe("working");
    });
    await v.conn.dispose();
  });

  test("a level-10 member's door is in the building; colleagues walk through it unless it's closed", async () => {
    const owner = await signUp("door");
    const co = await owner.town.createCompany("Doors");
    await veteran(owner);
    const mate = await signUp("door");
    await admit(owner, mate, co.id);
    const room = `office:${owner.userId}` as const;
    // Only the owner has a door: the colleague is level 0.
    const m = await connect(mate.token);
    expect(m.snap.room).toBe(`hq:${co.id}`);
    const door = { userId: owner.userId, name: owner.name, open: true, x: 1, y: -2 };
    expect(m.snap.doors).toEqual([door]);
    const me = m.snap.players.find((p) => p.id === mate.userId)!;
    const path = route(hqMap(m.snap.doors), [me.x, me.y], [door.x, door.y])!;
    expect((await walk(m.conn, path)).at(-1)).toMatchObject({ room });
    // Out again: below the door.
    expect(await m.conn.step("down")).toEqual({
      room: `hq:${co.id}`,
      x: 1,
      y: -1,
      facing: "down",
      state: "idle",
    });

    await owner.town.setOfficeOpen(false);
    await eventually(() => expect(m.events.snapshots.at(-1)!.doors).toEqual([{ ...door, open: false }]));
    expect(await m.conn.step("up")).toEqual({ notice: `🔒 ${owner.name}'s office is closed.` });
    const o = await connect(owner.token);
    const at = o.snap.players.find((p) => p.id === owner.userId)!;
    const own = await walk(o.conn, route(hqMap(o.snap.doors), [at.x, at.y], [door.x, door.y])!);
    expect(own.at(-1)).toMatchObject({ room });
    await o.conn.dispose();

    // Leaving the company takes the door; the colleague in its hallway goes back to the entry.
    await owner.town.leaveCompany();
    const after = await eventually(() => {
      const snap = m.events.snapshots.at(-1)!;
      expect(snap.doors).toEqual([]);
      return snap;
    });
    const { x, y } = roomEntry(`hq:${co.id}`);
    expect(after.players.find((p) => p.id === mate.userId)).toMatchObject({ x, y });
    await m.conn.dispose();
  });

  test("anyone visits an open office from its owner's card; a closed one lets only its owner in", async () => {
    const owner = await signUp("office");
    await owner.town.createCompany("Tower");
    await veteran(owner);
    const guest = await signUp("office");
    const g = await connect(guest.token);
    const room = `office:${owner.userId}` as const;
    expect(await g.conn.visit(owner.userId)).toMatchObject({ room });
    const inside = await eventually(() => {
      const snap = g.events.snapshots.at(-1)!;
      expect(snap.room).toBe(room);
      return snap;
    });
    // Level 10 put a desk and a chair on its floor.
    expect(inside.drops).toMatchObject([
      { item: "furn.d", x: 5, y: 3, by: owner.userId },
      { item: "furn.c", x: 5, y: 4, by: owner.userId },
    ]);
    expect(inside.owner).toEqual({ id: owner.userId, name: owner.name, open: true });
    // Only its owner opens or closes it: anyone else's call is about their own, and they have none.
    await expect(guest.town.setOfficeOpen(false)).rejects.toMatchObject({ code: "not_found" });
    expect((await guest.town.profile(owner.userId, "7d")).office).toBe("open");
    expect(await g.conn.visit(owner.userId)).toMatchObject({ room });

    await owner.town.setOfficeOpen(false);
    expect(await g.conn.visit(owner.userId)).toEqual({ notice: `🔒 ${owner.name}'s office is closed.` });
    expect((await guest.town.profile(owner.userId, "7d")).office).toBe("closed");
    const o = await connect(owner.token);
    expect(await o.conn.visit(owner.userId)).toMatchObject({ room });
    await o.conn.dispose();

    // Deleted, their office goes from the world too, furniture and all; the guest still inside sees a bare one.
    await admin().adminDeleteUser(owner.userId);
    const again = await connect(guest.token);
    expect(again.snap).toMatchObject({ room, drops: [] });
    for (const c of [g, again]) await c.conn.dispose();
  });

  test("an office that closed while you slept isn't where you wake up", async () => {
    const owner = await signUp("shut");
    await owner.town.createCompany("Shutters");
    await veteran(owner);
    const guest = await signUp("shut");
    const g = await connect(guest.token);
    const w = await connect(owner.token);
    expect(await g.conn.visit(owner.userId)).toMatchObject({ room: `office:${owner.userId}` });
    // Closing the tab remembers the office...
    await asleep(g, w, guest.userId);
    await owner.town.setOfficeOpen(false);
    // ...but it's closed now, so they're up in their bed at the Inn.
    const again = await connect(guest.token);
    expect(again.snap.room).toBe("inn");
    for (const c of [w, again]) await c.conn.dispose();
  });

  test("nor is the office of someone who left their company", async () => {
    const owner = await signUp("left");
    await owner.town.createCompany("Leavers");
    await veteran(owner);
    const guest = await signUp("left");
    const g = await connect(guest.token);
    const w = await connect(owner.token);
    expect(await g.conn.visit(owner.userId)).toMatchObject({ room: `office:${owner.userId}` });
    await asleep(g, w, guest.userId);
    await owner.town.leaveCompany(); // still open, but no office without a company
    const again = await connect(guest.token);
    expect(again.snap.room).toBe("inn");
    for (const c of [w, again]) await c.conn.dispose();
  });
});

// MARK: Drops

/** `owner`'s company with `mate` in it, both in its house (`room`) on their beds; `owner` bought `items`. */
async function house(...items: string[]) {
  const owner = await rich("drop", 2000);
  const co = await owner.town.createCompany("Floor");
  const mate = await rich("drop");
  await admit(owner, mate, co.id);
  for (const i of items) await owner.town.buy(i);
  const room = `hq:${co.id}` as const;
  const o = await connect(owner.token);
  const m = await connect(mate.token);
  const at = (c: typeof o, id: number) => c.snap.players.find((p) => p.id === id)!;
  return { owner, mate, room, o, m, ownerAt: at(o, owner.userId), mateAt: at(m, mate.userId) };
}

/** `town.drop`, which has to land. Furniture goes in this process's map too, for `route`. */
async function drop(u: { town: { drop(item: string): Promise<{ drop?: Drop }> } }, item: string) {
  const { drop } = await u.town.drop(item);
  if (!drop) throw new Error(`${item} didn't land`);
  setDrops(drop.room, [...(DROPS.get(drop.room) ?? []), drop]);
  return drop;
}

describe("drops", () => {
  test("a pet lies where it's dropped; a colleague on it takes it, once, and it's gone for everyone", async () => {
    const { owner, mate, room, o, m, ownerAt, mateAt } = await house("pet.1", "hat.1");
    await walk(o.conn, ["down"]); // off the bed
    const duck = await drop(owner, "pet.1");
    expect(duck).toMatchObject({ item: "pet.1", room, x: ownerAt.x, y: ownerAt.y + 1, by: owner.userId });
    // One drop per tile: the next lands beside it.
    const hat = await drop(owner, "hat.1");
    expect(Math.max(Math.abs(hat.x - duck.x), Math.abs(hat.y - duck.y))).toBe(1);
    await eventually(() => expect(m.events.drops).toEqual([duck, hat]));
    const again = await connect(owner.token);
    expect(again.snap.drops).toEqual([duck, hat]);
    await again.conn.dispose();

    const path = route(mapOf(room), [mateAt.x, mateAt.y], [duck.x, duck.y])!;
    await walk(m.conn, path.slice(0, -1));
    expect(await m.conn.take()).toBeNull(); // next to it
    await walk(m.conn, path.slice(-1));
    expect(await m.conn.take()).toEqual({ notice: "🎒 Took the Duck.", drop: duck });
    expect(await owner.town.bag()).toEqual([]);
    expect(await mate.town.bag()).toEqual([{ item: "pet.1", count: 1 }]);
    for (const c of [o, m]) await eventually(() => expect(c.events.pickups).toEqual([{ id: duck.id }]));
    expect(await m.conn.take()).toBeNull(); // already gone
    for (const c of [o, m]) await c.conn.dispose();
  });

  test("a room holds 30; the 31st stays in its dropper's bag", async () => {
    const owner = await rich("full", 50);
    const co = await owner.town.createCompany("Full House");
    const people = [owner];
    for (let i = 0; i < 6; i++) {
      const u = await rich("full", 50);
      await admit(owner, u, co.id);
      people.push(u);
    }
    // Five each, the most anyone has on the floor at once: they lie in the house, asleep in bed.
    for (const u of people) for (let i = 0; i < 5; i++) await u.town.buy("furn.=");
    for (const u of people.slice(0, 6)) for (let i = 0; i < 5; i++) await drop(u, "furn.=");
    const last = people[6]!;
    expect(await last.town.drop("furn.=")).toEqual({ notice: "There's no room on the floor here." });
    expect(await last.town.bag()).toEqual([{ item: "furn.=", count: 5 }]);
    // Closed, its floor goes back to whoever dropped it.
    await admin().adminCloseCompany(co.id);
    expect(await owner.town.bag()).toEqual([{ item: "furn.=", count: 5 }]);
  });

  test("a dropped sofa is a sofa: sat on, taken while seated, and the sitter is up after", async () => {
    const { owner, mate, room, o, m, mateAt } = await house("furn.s");
    const sofa = await drop(owner, "furn.s");
    // Walking into it only turns you to face it.
    const path = route(mapOf(room), [mateAt.x, mateAt.y], [sofa.x, sofa.y])!;
    await walk(m.conn, path);
    expect(await m.conn.take()).toBeNull(); // a seat is taken from on it
    expect(await m.conn.sit(path.at(-1))).toMatchObject({ x: sofa.x, y: sofa.y, state: "sit" });
    expect(await m.conn.take()).toEqual({ notice: "🎒 Took the Sofa.", drop: sofa });
    await eventually(() => {
      const [, x, y, , state] = o.events.moves.flatMap((mv) => mv.m).findLast(([id]) => id === mate.userId)!;
      expect([x, y, state]).toEqual([sofa.x, sofa.y, "idle"]);
    });
    expect(await mate.town.bag()).toEqual([{ item: "furn.s", count: 1 }]);
    for (const c of [o, m]) await c.conn.dispose();
  });

  test("a dropped desk blocks; it's taken from the next tile, facing it, not from further or off a hat", async () => {
    const { owner, room, o, m, ownerAt, mateAt } = await house("furn.d", "hat.1");
    // Furniture goes on the free tile you face: here, below (5, 4).
    await walk(o.conn, [...route(mapOf(room), [ownerAt.x, ownerAt.y], [5, 3])!, "down"]);
    const desk = await drop(owner, "furn.d");
    expect(desk).toMatchObject({ x: 5, y: 5 });
    // A hat on the tile below the desk: the owner stands there to drop it.
    const at = { x: 5, y: 4 };
    await walk(o.conn, route(mapOf(room), [at.x, at.y], [desk.x, desk.y + 1])!);
    expect(await drop(owner, "hat.1")).toMatchObject({ x: desk.x, y: desk.y + 1 });
    // Two tiles below it, facing it: too far.
    await walk(m.conn, [...route(mapOf(room), [mateAt.x, mateAt.y], [desk.x, desk.y + 3])!, "up"]);
    expect(await m.conn.take()).toBeNull();
    // On the hat, facing the desk: the hat is what's taken.
    await walk(m.conn, ["up"]);
    expect(await m.conn.take()).toMatchObject({ notice: "🎒 Took the Beanie." });
    // Into the desk: still in front of it, which only the take shows.
    await walk(m.conn, ["up"]);
    expect(await m.conn.take()).toEqual({ notice: "🎒 Took the Desk.", drop: desk });
    for (const c of [o, m]) await c.conn.dispose();
  });

  test("you wake where you were only if you still can: not on a sofa that's gone, not inside a desk", async () => {
    const { owner, mate, room, o, m, mateAt } = await house("furn.s", "furn.d");
    const sofa = await drop(owner, "furn.s"); // below the owner's bed
    const path = route(mapOf(room), [mateAt.x, mateAt.y], [sofa.x, sofa.y])!;
    await walk(m.conn, path);
    expect(await m.conn.sit(path.at(-1))).toMatchObject({ x: sofa.x, y: sofa.y, state: "sit" });
    await asleep(m, o, mate.userId);
    // The owner sits on it, takes it and steps off: the mate wakes up there, standing.
    expect(await o.conn.sit("down")).toMatchObject({ x: sofa.x, y: sofa.y, state: "sit" });
    expect(await o.conn.take()).toMatchObject({ drop: sofa });
    setDrops(room, []);
    await walk(o.conn, ["right"]);
    const up = await connect(mate.token);
    const there = up.snap.players.find((p) => p.id === mate.userId);
    expect(there).toMatchObject({ x: sofa.x, y: sofa.y, state: "idle" });
    // Asleep again, a desk goes where they stood: they wake in bed, not inside it.
    await asleep(up, o, mate.userId);
    await walk(o.conn, ["right", "left"]);
    expect(await drop(owner, "furn.d")).toMatchObject({ x: sofa.x, y: sofa.y });
    const again = await connect(mate.token);
    const me = again.snap.players.find((p) => p.id === mate.userId)!;
    expect(mapOf(room).at(me.x, me.y)).toBe("b");
    for (const c of [o, again]) await c.conn.dispose();
  });

  test("furniture stays out of a building's hallways; a hallway that goes gives back what lay in it", async () => {
    const owner = await signUp("hall");
    const co = await owner.town.createCompany("Hallways");
    await veteran(owner); // a door, and a hallway to it
    const mate = await rich("hall", 500);
    await admit(owner, mate, co.id);
    for (const item of ["furn.p", "hat.1"]) await mate.town.buy(item);
    const m = await connect(mate.token);
    const me = m.snap.players.find((p) => p.id === mate.userId)!;
    // Up the passage into the hallway, facing along it.
    await walk(m.conn, [...route(hqMap(m.snap.doors), [me.x, me.y], [9, -1])!, "left"]);
    const plant = await drop(mate, "furn.p");
    expect(plant.y).toBeGreaterThanOrEqual(2); // down on the floor
    expect(plant).not.toMatchObject({ x: 14, y: 2 }); // not at the foot of the passage either
    const hat = await drop(mate, "hat.1");
    expect(hat).toMatchObject({ x: 8, y: -1 });
    // The owner leaves: no door, no hallway, and the hat is back in the mate's bag.
    await owner.town.leaveCompany();
    expect(await mate.town.bag()).toEqual([{ item: "hat.1", count: 1 }]);
    await eventually(() => expect(m.events.pickups).toContainEqual({ id: hat.id }));
    await m.conn.dispose();
  });

  test("an office owner can't wall a visitor in", async () => {
    const owner = await rich("wall", 500);
    await owner.town.createCompany("Walls");
    await veteran(owner);
    for (let i = 0; i < 2; i++) await owner.town.buy("furn.p");
    const guest = await signUp("wall");
    const room = `office:${owner.userId}` as const;
    const g = await connect(guest.token);
    await g.conn.visit(owner.userId);
    const inside = await eventually(() => {
      const snap = g.events.snapshots.at(-1)!;
      expect(snap.room).toBe(room);
      return snap;
    });
    setDrops(room, inside.drops); // the desk and chair, for `route` here
    const exit = mapOf(room).find("x")[0]!;
    // The guest in the top-left corner; the owner puts a plant to their right, then one below them.
    await walk(g.conn, route(mapOf(room), [exit[0], exit[1] - 1], [1, 1])!);
    const o = await connect(owner.token);
    await o.conn.visit(owner.userId);
    await walk(o.conn, [...route(mapOf(room), [exit[0], exit[1] - 1], [4, 1])!, "left"]);
    expect(await drop(owner, "furn.p")).toMatchObject({ x: 2, y: 1 });
    await walk(o.conn, [...route(mapOf(room), [3, 1], [1, 4])!, "up"]);
    expect(await drop(owner, "furn.p")).not.toMatchObject({ x: 1, y: 2 });
    expect(route(mapOf(room), [1, 1], exit)).not.toBeNull();
    setDrops(room, []);
    for (const c of [g, o]) await c.conn.dispose();
  });

  test("an office floor is its owner's: its furniture, and a visitor's gift, are theirs to take", async () => {
    const owner = await signUp("gift");
    await owner.town.createCompany("Gifts");
    await veteran(owner);
    const guest = await rich("gift", 500);
    await guest.town.buy("pet.2");
    const g = await connect(guest.token);
    expect(await g.conn.visit(owner.userId)).toMatchObject({ room: `office:${owner.userId}` });
    // Both land on the office's entry tile, where the cat is.
    const cat = await drop(guest, "pet.2");
    expect(await g.conn.take()).toEqual({ notice: `That's ${owner.name}'s floor.` });
    // Nor the chair that came at level 10, sitting on it.
    await walk(g.conn, ["up", "up", "up"]);
    expect(await g.conn.sit("up")).toMatchObject({ x: 5, y: 4, state: "sit" });
    expect(await g.conn.take()).toEqual({ notice: `That's ${owner.name}'s floor.` });
    const o = await connect(owner.token);
    await o.conn.visit(owner.userId);
    expect(await o.conn.take()).toMatchObject({ drop: cat });
    expect(await owner.town.bag()).toContainEqual({ item: "pet.2", count: 1 });
    expect(await guest.town.bag()).toEqual([]);
    for (const c of [g, o]) await c.conn.dispose();
  });

  test("an office is furnished by dropping: a desk lands on the tile you face; 40 pieces at most", async () => {
    const owner = await rich("furnish", 400);
    await owner.town.createCompany("Furnished");
    await veteran(owner); // the desk and chair: 2
    await owner.town.buy("furn.d");
    for (let i = 0; i < 28; i++) await owner.town.buy("furn.=");
    const o = await connect(owner.token);
    const room = `office:${owner.userId}` as const;
    expect(await o.conn.visit(owner.userId)).toMatchObject({ room, x: 5, y: 7, facing: "up" });
    expect(await drop(owner, "furn.d")).toMatchObject({ room, x: 5, y: 6 });
    // Your own office's floor isn't loot: no five at a time.
    for (let i = 0; i < 27; i++) await drop(owner, "furn.="); // 30
    for (let n = 0; n < 2; n++) {
      const guest = await rich("furnish", 50);
      for (let i = 0; i < 5; i++) await guest.town.buy("furn.=");
      const g = await connect(guest.token);
      await g.conn.visit(owner.userId);
      for (let i = 0; i < 5; i++) await drop(guest, "furn.="); // 40
      await g.conn.dispose();
    }
    expect(await owner.town.drop("furn.=")).toEqual({ notice: "There's no room on the floor here." });
    expect(await owner.town.bag()).toContainEqual({ item: "furn.=", count: 1 });
    await o.conn.dispose();
  });

  test("a world starting up lays every floor again from `town`: an office's furniture, a drop in the Inn", async () => {
    // `town` and `world` in this process, on an in-memory database: the world's restart can't be driven
    // on the server.
    const { sql } = memorySql();
    await migrate(sql);
    await sql.execute("INSERT INTO users (id, name, look, created_at) VALUES (7, 'ada', '{}', 0)");
    await sql.execute("INSERT INTO items (owner_id, item, at) VALUES (7, 'pet.1', 0)");
    await grantRewards(sql, 7, 10, 0);
    const id = await takeOut(sql, 7, "pet.1", 0);
    await placed(sql, { id, item: "pet.1", room: "inn", x: 3, y: 3, by: 7, at: 0 });
    const seed = await town.config.actions!.seed({ conn: { state: { kind: "internal" } }, db: sql } as never);
    // What it had before sleeping isn't kept: a ghost of a drop whose call failed goes.
    setDrops("inn", [{ id: id + 100, item: "pet.2", room: "inn", x: 1, y: 1, by: 7, at: 0 }]);
    await world.config.onWake!({
      state: { seeded: true, players: {}, companies: {} },
      conns: new Map(),
      client: () => {
        const actor = { getOrCreate: () => ({ seed: async () => seed }) };
        return { town: actor, world: actor, arcade: actor };
      },
    } as never);
    expect([mapOf("office:7").at(5, 3), mapOf("office:7").at(5, 4)]).toEqual(["d", "c"]);
    expect(DROPS.get("inn")).toEqual([{ id, item: "pet.1", room: "inn", x: 3, y: 3, by: 7, at: 0 }]);
    for (const room of ["inn", "office:7"] as const) setDrops(room, []);
  });

  test("the sweeper takes an hour-old drop off the world's floor and back to its dropper", async () => {
    // In this process, like the one above: the sweeper's alarm is every 10 minutes.
    const { sql } = memorySql();
    await migrate(sql);
    await sql.execute("INSERT INTO users (id, name, look, created_at) VALUES (7, 'ada', '{}', 0)");
    await sql.execute("INSERT INTO items (owner_id, item, at) VALUES (7, 'pet.1', 0), (7, 'pet.2', 0)");
    const at = [Date.now() - 2 * HOUR, Date.now()];
    const drops: Drop[] = [];
    for (const [i, item] of ["pet.1", "pet.2"].entries()) {
      const d: Drop = {
        id: await takeOut(sql, 7, item, at[i]!),
        item,
        room: "inn",
        x: 3 + i,
        y: 3,
        by: 7,
        at: at[i]!,
      };
      await placed(sql, d);
      drops.push(d);
    }
    setDrops("inn", drops);
    const inWorld = {
      conn: { state: { kind: "internal" } },
      state: { players: {} },
      conns: new Map(),
      vars: { dirty: new Set() },
    };
    const actor = {
      getOrCreate: () => ({
        removeDrops: (ids: number[]) => world.config.actions!.removeDrops(inWorld as never, ids),
      }),
    };
    await town.config.actions!.sweep({
      db: sql,
      client: () => ({ town: actor, world: actor, arcade: actor }),
    } as never);
    expect(DROPS.get("inn")).toEqual([drops[1]!]);
    expect(await bag(sql, 7)).toEqual([{ item: "pet.1", count: 1 }]);
    setDrops("inn", []);
  });
});
