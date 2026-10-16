import { describe, expect, test } from "bun:test";
import { BOTS } from "@tokenmaxxing/core/bots.ts";
import { MAPS } from "@tokenmaxxing/core/maps.ts";
import { hqMap, STARTER_OFFICE } from "@tokenmaxxing/core/office.ts";
import {
  type ChatLine,
  cupsLeft,
  type Drop,
  defaultLook,
  type Moves,
  mapOf,
  outsideDoor,
  type PlayerInfo,
  type RoomId,
  roomEntry,
  route,
  type Snapshot,
  setDrops,
} from "@tokenmaxxing/core/world.ts";
import { world } from "../src/actors/world.ts";
import { memorySql } from "./memory-sql.ts";
import { admin, admit, as, event, eventually, signUp, veteran } from "./rivet.ts";

async function connect(token: string) {
  const conn = as(token).world.connect();
  const events = {
    moves: [] as Moves[],
    chat: [] as ChatLine[],
    snapshots: [] as Snapshot[],
    mentions: [] as ChatLine[],
  };
  conn.on("mention", (l: ChatLine) => events.mentions.push(l));
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
    await Bun.sleep(140);
  }
  return results;
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
    expect(inside.furniture).toEqual([...STARTER_OFFICE]);
    expect(inside.owner).toEqual({ id: owner.userId, name: owner.name });

    await owner.town.setOfficeOpen(false);
    expect(await g.conn.visit(owner.userId)).toEqual({ notice: `🔒 ${owner.name}'s office is closed.` });
    expect((await guest.town.profile(owner.userId, "7d")).office).toBe("closed");
    const o = await connect(owner.token);
    expect(await o.conn.visit(owner.userId)).toMatchObject({ room });
    await o.conn.dispose();

    // Deleted, their office goes from the world too; the guest still inside sees a new one.
    await admin().adminSetCoins(owner.userId, 100);
    await owner.town.buy("furn.s");
    await owner.town.setOffice([...STARTER_OFFICE, { ch: "s", x: 1, y: 1 }]);
    await admin().adminDeleteUser(owner.userId);
    const again = await connect(guest.token);
    expect(again.snap).toMatchObject({ room, furniture: [...STARTER_OFFICE] });
    for (const c of [g, again]) await c.conn.dispose();
  });
});

// MARK: Drops

const actions = world.config.actions!;
type Ctx = Parameters<typeof actions.take>[0];

/**
 * The world's actions in this process, players `ids` standing at (3, 4) in `room`: nothing calls
 * `placeDrop` from `town` yet, and the internal key never leaves the test server.
 */
function floor(room: RoomId, ...ids: number[]) {
  const { db, sql } = memorySql();
  db.run(
    "CREATE TABLE chat (id INTEGER PRIMARY KEY, room TEXT, user_id INTEGER, name TEXT, text TEXT, at INTEGER)",
  );
  setDrops(room, []);
  const state: Ctx["state"] = { seeded: true, players: {}, companies: {} };
  for (const id of ids)
    state.players[id] = {
      id,
      name: `p${id}`,
      look: defaultLook(id),
      level: 0,
      companyId: null,
      todayTokens: 0,
      room,
      x: 3,
      y: 4,
      facing: "down",
      state: "idle",
      lastInputAt: 0,
      lastAgentAt: 0,
      liveAgents: 0,
    };
  const sent: { to: number; event: string; payload: unknown }[] = [];
  const conns = new Map(
    ids.map((id) => [
      String(id),
      {
        state: { kind: "user", userId: id, via: "session", joined: true },
        send: (event: string, payload: unknown) => sent.push({ to: id, event, payload }),
      },
    ]),
  );
  const vars = (world.config as unknown as { createVars: () => Ctx["vars"] }).createVars();
  const ctx = (conn: unknown) =>
    ({ state, vars, conns, conn, db: sql, broadcast: () => {} }) as unknown as Ctx;
  const internal = ctx({ state: { kind: "internal" } });
  const user = (id: number) => ctx(conns.get(String(id)));
  return {
    sent: (event: string) => sent.filter((e) => e.event === event),
    me: (id: number) => state.players[id]!,
    put: (id: number, x: number, y: number, facing: "up" | "down" | "left" | "right" = "down") =>
      Object.assign(state.players[id]!, { x, y, facing, state: "idle" }),
    drop: (id: number, item: string, by: number) => actions.placeDrop(internal, { id, item, by }) as Drop,
    removeDrops: (dropIds: number[]) => actions.removeDrops(internal, dropIds),
    take: (id: number) => actions.take(user(id)),
    sit: (id: number, facing: string) => actions.sit(user(id), facing),
    step: (id: number, dir: string) => actions.step(user(id), dir),
    join: (id: number) => actions.join(user(id)),
  };
}

describe("drops", () => {
  test("a parcel lies where it's dropped; only someone on it takes it, once, and it's gone for everyone", async () => {
    const f = floor("inn", 1, 2);
    const duck = f.drop(10, "pet.1", 1);
    expect(duck).toMatchObject({ id: 10, item: "pet.1", room: "inn", x: 3, y: 4, by: 1 });
    expect((await f.join(1)).drops).toEqual([duck]);
    expect(f.sent("drop").map((e) => e.to)).toEqual([1, 2]);
    f.put(2, 4, 4, "left");
    expect(f.take(2)).toBeNull(); // next to it
    f.step(2, "left");
    expect(f.take(2)).toEqual({ notice: "🎒 Took the Duck.", drop: duck });
    expect(f.sent("pickup")).toEqual([1, 2].map((to) => ({ to, event: "pickup", payload: { id: 10 } })));
    expect((await f.join(1)).drops).toEqual([]);
    expect(f.take(2)).toBeNull(); // already gone
  });

  test("one drop per tile, the next lands beside it; a room holds 30", () => {
    const f = floor("inn", 1);
    const drops = Array.from({ length: 30 }, (_, i) => f.drop(100 + i, "hat.1", 1));
    expect(drops[0]).toMatchObject({ x: 3, y: 4 });
    expect(Math.max(Math.abs(drops[1]!.x - 3), Math.abs(drops[1]!.y - 4))).toBe(1);
    expect(new Set(drops.map((d) => `${d.x},${d.y}`)).size).toBe(30);
    expect(f.drop(130, "hat.1", 1)).toEqual({ notice: "There's no room on the floor here." } as never);
  });

  test("a dropped sofa is a sofa: sat on, taken while seated, and the sitter is up after", () => {
    const f = floor("inn", 1, 2);
    const sofa = f.drop(30, "furn.s", 1);
    expect(mapOf("inn").at(sofa.x, sofa.y)).toBe("s");
    f.put(2, sofa.x + 1, sofa.y, "left");
    expect(f.take(2)).toBeNull(); // a seat is taken from on it
    expect(f.sit(2, "left")).toMatchObject({ x: sofa.x, y: sofa.y, state: "sit" });
    expect(f.take(2)).toEqual({ notice: "🎒 Took the Sofa.", drop: sofa });
    expect(f.me(2)).toMatchObject({ x: sofa.x, y: sofa.y, state: "idle" });
    expect(mapOf("inn").at(sofa.x, sofa.y)).toBe("_");
    // Gone back to its dropper while someone sits on it: they're up too.
    const again = f.drop(31, "furn.s", 1);
    f.put(2, again.x + 1, again.y, "left");
    f.sit(2, "left");
    f.removeDrops([31]);
    expect(f.me(2)).toMatchObject({ x: again.x, y: again.y, state: "idle" });
    expect(f.sent("pickup").map((e) => e.payload)).toEqual([{ id: 30 }, { id: 30 }, { id: 31 }, { id: 31 }]);
  });

  test("a dropped desk blocks; it's taken from the next tile, facing it, not from further or off a parcel", () => {
    const f = floor("inn", 1, 2);
    const desk = f.drop(40, "furn.d", 1);
    f.put(2, desk.x + 1, desk.y, "left");
    f.step(2, "left");
    expect(f.me(2)).toMatchObject({ x: desk.x + 1, y: desk.y });
    f.put(2, desk.x + 2, desk.y, "left");
    expect(f.take(2)).toBeNull();
    // Standing on a parcel, facing the desk: the parcel is what's taken.
    f.put(1, desk.x + 1, desk.y);
    const hat = f.drop(41, "hat.1", 1);
    f.put(2, desk.x + 1, desk.y, "left");
    expect(f.take(2)).toMatchObject({ drop: hat });
    expect(f.take(2)).toEqual({ notice: "🎒 Took the Desk.", drop: desk });
    expect(mapOf("inn").walkable(desk.x, desk.y)).toBe(true);
  });

  test("an office floor is its owner's: a visitor's gift is theirs to take", () => {
    const f = floor("office:1", 1, 2);
    const cat = f.drop(50, "pet.2", 2);
    expect(f.take(2)).toEqual({ notice: "That's p1's floor." });
    f.put(1, cat.x, cat.y);
    expect(f.take(1)).toMatchObject({ drop: cat });
  });
});
