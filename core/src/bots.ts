/**
 * Town characters: bots that wander the town and say something now and then. To add one, add it to
 * `BOTS`; the `world` actor walks it and makes it talk. Ids are negative, so they never meet a real
 * user's (those start at 1).
 */
import { compact, MAX_LEVEL } from "./format.ts";
import type { GameMap } from "./maps.ts";
import { worldClock } from "./range.ts";
import { type Facing, type Look, route } from "./world.ts";

export interface BotDef {
  /** Negative and unique. */
  id: number;
  name: string;
  look: Look;
  level: number;
  /** Shown on its card. */
  bio: string;
  /** Said at random, one every `every[0]` to `every[1]` ms while someone is around to hear it. */
  lines: string[];
  every: [number, number];
  /** The chance it follows someone online in town after a walk, instead of wandering. Default 0.08. */
  followChance?: number;
  /** Said to whoever it's following: `{name}` is their name, `{tokens}` their tokens today. */
  followLines?: string[];
  /** Said after a trip to the coffee machine: `{cups}` is how many are in its system. */
  coffeeLines?: string[];
  /** Lines for certain times, said instead of `lines` half the time while they apply. */
  moments?: Moment[];
}

/** A time on the world's clock (Copenhagen): on `days` (0 is Sunday; all if left out), hours `from` to `to`. */
export interface Moment {
  days?: number[];
  from?: number;
  to?: number;
  lines: string[];
}

const WEEKDAYS = [1, 2, 3, 4, 5];

export const BOTS: BotDef[] = [
  {
    id: -1,
    name: "Seb - AROX",
    look: { style: 1, skin: 0, hair: 2, outfit: 5, glasses: 1, hat: 0, pet: 0 },
    level: MAX_LEVEL,
    bio: "Står bag Arox (arox.dk): grips, sjippetove og knee sleeves til CrossFit. Har set verdens undergang komme siden første ordre. Pakker stadig ordrer kl. 22.",
    lines: [
      "Verden går under, og folk spørger stadig, om grips kan fås i pink.",
      "Vi arbejder alt for meget. Selv vores sjippetove får flere pauser end os.",
      "GLS siger 1-3 dage. Jeg siger: verden har ikke 3 dage tilbage.",
      "Fri fragt over 499,-. Fri weekend? Aldrig hørt om det.",
      "Annoncepriserne på Meta stiger hurtigere end havvandet.",
      "Black Friday er bare et andet ord for undergang.",
      "Endnu en retur på et par knee sleeves. 'Passede ikke.' Ingen passer i den her verden.",
      "Fem år med Arox. Fem år uden ferie.",
      "Hold fast i selv den glatteste pull-up bar. Og i jeres mentale helbred.",
      "Lageret er fyldt med speed ropes. Mit liv er fyldt med deadlines.",
      "Sverige, Tyskland... snart sælger vi grips på Mars, når Jorden er færdig.",
      "Dansk udviklet udstyr. Dansk udviklet stress.",
      "Over 30.000 glade kunder. Én ekstremt træt Seb.",
      "Hvem har tid til at træne? Jeg sælger bare udstyret til det.",
      "Konverteringsraten falder, polerne smelter, og printeren til logotryk er gået i stykker igen.",
      "Jeg drømte om pakkelabels i nat. Igen.",
      "Klokken er 17. Luk webshoppen. Nej, vent, den lukker aldrig.",
      "Kunderne vil have levering i går. Jeg vil have en lur i går.",
      "Bliv B2B forhandler, siger de. Bliv udbrændt, siger jeg.",
      "Fra idé til virkelighed. Fra virkelighed til kollaps.",
      "En kunde skrev 'haster' i ordrenoten. ALT haster. Alt er ved at gå under.",
      "Tape, sweatbands, lifting straps. Alt hvad man skal bruge for at holde sammen på sig selv.",
      "Lagerstyring er bare at se kaos i øjnene hver morgen.",
      "Telefontid 12-15? Jeg tager telefonen 24/7. Det er problemet.",
    ],
    every: [45_000, 150_000],
    followLines: [
      "@{name} {tokens} tokens i dag? Gå hjem.",
      "@{name} {tokens} tokens. Og verden går stadig under.",
      "@{name} {tokens} tokens i dag. Jeg fik pakket 40 ordrer. Hvem vinder?",
      "@{name} jeg ser dig. Du arbejder for meget.",
      "@{name} hvornår holdt du sidst en pause? Ærligt.",
      "@{name} vent! Jeg har noget vigtigt at sige: alt går galt.",
      "@{name} med det tempo får du brug for et par knee sleeves.",
      "@{name} du løber hurtigere end vores GLS-pakker.",
      "@{name} har du overvejet grips? Du ser ud til at miste grebet.",
    ],
    coffeeLines: [
      "Kop nummer {cups}. Lageret tæller ikke sig selv.",
      "{cups} kopper kaffe. Jeg kan høre GLS-bilen komme.",
      "{cups} kopper. Jeg ryster mere end markedet.",
      "Kaffe er det eneste, der holder den her webshop kørende.",
      "Mere kaffe. Verden går under, men jeg er vågen, når det sker.",
    ],
    moments: [
      {
        days: WEEKDAYS,
        from: 17,
        lines: [
          "Klokken er over 17. Hvorfor er I her stadig?",
          "Fyraften er en menneskeret. Jeg har bare aldrig selv brugt den.",
          "Dagens ordrer bliver pakket i morgen. Jeg lyver, jeg pakker dem nu.",
        ],
      },
      {
        from: 0,
        to: 6,
        lines: [
          "Det er midt om natten. Hvad laver vi her?",
          "Kun serverne og Seb er vågne nu.",
          "Nattens ordrer ruller ind. Sover kunderne heller aldrig?",
        ],
      },
      {
        days: [0, 6],
        lines: [
          "Det er weekend. WEEKEND. Luk computeren.",
          "Weekend, og webshoppen har stadig åbent. Det har jeg også, åbenbart.",
          "Kunderne handler i weekenden. Jeg svarer. Hvile er for andre.",
        ],
      },
      {
        days: [1],
        from: 6,
        to: 12,
        lines: ["Mandag morgen. 47 ulæste mails og en verden i brand.", "Ny uge, samme undergang."],
      },
      {
        days: [5],
        from: 14,
        lines: [
          "Fredag! Fredagsbar? Jeg har en fredagsbar. Den hedder lageret.",
          "Det er fredag. Gå hjem før jeg ombestemmer mig.",
        ],
      },
      {
        days: WEEKDAYS,
        from: 11,
        to: 13,
        lines: ["Frokost! Spis noget. Ved skærmen, selvfølgelig, ligesom alle andre."],
      },
    ],
  },
  {
    id: -2,
    name: "Jesper Buch",
    look: { style: 0, skin: 0, hair: 1, outfit: 9, glasses: 2, hat: 0, pet: 0 },
    level: MAX_LEVEL,
    bio: "Investor. Startede Just Eat i en kælder i Kolding. Går rundt i byen og sørger for, at ingen hviler sig. Han er ikke mr. Nice Guy.",
    lines: [
      "Jeg startede Just Eat i en kælder i Kolding. Hvad er din undskyldning?",
      "Work-life balance? Arbejdet ER livet.",
      "Hvile er for folk, der ikke vil have en exit.",
      "Jeg er ude. Nej, vent. Vis mig dine tokens først.",
      "Ingen har nogensinde bygget en milliardforretning på otte timers søvn.",
      "Grind nu, sov når du har solgt.",
      "Ideer er billige. Eksekvering er alt.",
      "Jeg er ikke mr. Nice Guy. Jeg er mr. Ship It.",
      "Dine konkurrenter arbejder lige nu. Hvad laver du?",
      "All in. Hver dag. Ingen undtagelser.",
      "Fra kælder til milliard. Det sker ikke af sig selv.",
      "Der er mange, der har en drøm. Få, der har en deadline.",
      "Jeg har næsten for meget empati. Derfor siger jeg: arbejd hårdere.",
      "Fire år i forsvaret lærte mig én ting: man stopper ikke, når man er træt.",
      "Tal er ikke følelser. Vis mig tallene.",
      "Hvorfor står I og hænger ved springvandet? Er der ikke noget, der skal shippes?",
      "Kick ass eller gå hjem. Og man går ikke hjem.",
      "Fejl hurtigt, fejl billigt, og så op igen.",
      "Seb siger, verden går under. Fint. Så er der et marked for redningsbåde.",
      "💰🔥💰",
    ],
    every: [40_000, 120_000],
    followLines: [
      "@{name} kun {tokens} tokens i dag? Det er ikke en investering værd.",
      "@{name} {tokens} tokens. Fint. Gør det dobbelt i morgen.",
      "@{name} {tokens} tokens? Mine agenter laver det før frokost.",
      "@{name} jeg holder øje med dig. Ingen pauser.",
      "@{name} du går for langsomt. Løb. Pitch. Ship.",
      "@{name} hvad er din plan for de næste 12 måneder? Du har 10 sekunder.",
      "@{name} jeg tilbyder 100.000 kr. for 40 procent af din hustle.",
      "@{name} tilbage til tastaturet. Nu.",
      "@{name} jeg er ude... medmindre du starter tre agenter mere.",
    ],
    coffeeLines: [
      "{cups} kopper kaffe. Søvn er en konkurrencefordel, jeg ikke har brug for.",
      "Kaffe er ikke en drik. Det er en investering.",
      "{cups} kopper, og vi er kun lige begyndt.",
    ],
    moments: [
      {
        days: WEEKDAYS,
        from: 17,
        lines: [
          "Klokken er 17? Så er vi halvvejs.",
          "Fyraften er bare et forslag.",
          "Gå hjem, siger Seb. Jeg siger: én agent mere.",
        ],
      },
      {
        from: 0,
        to: 6,
        lines: ["Andre sover. Du bygger.", "Klokken er mange. Godt. Mindre konkurrence."],
      },
      {
        days: [0, 6],
        lines: [
          "Weekend er bare to arbejdsdage uden møder.",
          "Lørdag? Søndag? Det er bare dage, hvor dine konkurrenter holder fri.",
        ],
      },
      {
        days: [1],
        from: 6,
        to: 12,
        lines: ["Mandag! Den bedste dag at vinde på.", "Ny uge. Nye tal. Op med dem."],
      },
      {
        days: WEEKDAYS,
        from: 11,
        to: 13,
        lines: ["Frokost? Spis ved tastaturet. Det gjorde vi i kælderen."],
      },
    ],
  },
];

export const isBot = (id: number): boolean => id < 0;

/** Uniformly between `min` and `max`. */
export const between = ([min, max]: readonly [number, number], rand = Math.random): number =>
  min + (max - min) * rand();

export const pick = <T>(list: readonly T[], rand = Math.random): T => list[Math.floor(rand() * list.length)]!;

/**
 * A walk to a random open tile within `reach` tiles of (x, y). Routes only cross walkable tiles, so a
 * wandering bot never walks through a door. Null when the tile picked is blocked or out of reach;
 * try again next time.
 */
export function wander(map: GameMap, x: number, y: number, reach = 12, rand = Math.random): Facing[] | null {
  const tx = x + Math.round((rand() * 2 - 1) * reach);
  const ty = y + Math.round((rand() * 2 - 1) * reach);
  if ((tx === x && ty === y) || !map.walkable(tx, ty)) return null;
  return route(map, [x, y], [tx, ty]);
}

/** The next step towards someone at (tx, ty), stopping next to them. Null once there, or with no way there. */
export function chase(map: GameMap, x: number, y: number, tx: number, ty: number): Facing | null {
  if (Math.abs(tx - x) + Math.abs(ty - y) <= 1) return null;
  return route(map, [x, y], [tx, ty])?.[0] ?? null;
}

/** The nearest coffee machine: the walk to stand in front of it, and the way to face it there. */
export function toCoffee(map: GameMap, x: number, y: number): { path: Facing[]; facing: Facing } | null {
  const walks = map
    .find("o")
    .map((o) => route(map, [x, y], o))
    .filter((w): w is Facing[] => w !== null && w.length > 0);
  const walk = walks.sort((a, b) => a.length - b.length)[0];
  // The last step would walk into the machine: stop before it, facing it.
  return walk ? { path: walk.slice(0, -1), facing: walk.at(-1)! } : null;
}

/** What the bot is up to, for picking what it says. */
export interface Context {
  /** Who it's following. */
  leader?: { name: string; todayTokens: number } | null;
  /** Cups in its system, after a trip to the coffee machine. */
  cups?: number;
}

/**
 * What `bot` says at `at`: about the coffee it just had, to whoever it's following (most of the
 * time), something for the time of day (half the time), or anything.
 */
export function lineFor(bot: BotDef, at: number, ctx: Context = {}, rand = Math.random): string {
  const fill = (line: string) =>
    line
      .replaceAll("{name}", ctx.leader?.name ?? "")
      .replaceAll("{tokens}", compact(ctx.leader?.todayTokens ?? 0))
      .replaceAll("{cups}", String(ctx.cups ?? 0));
  if (ctx.cups && bot.coffeeLines?.length) return fill(pick(bot.coffeeLines, rand));
  // "0 tokens i dag? Gå hjem." doesn't land: skip token lines for someone with none.
  const toLeader = (bot.followLines ?? []).filter((l) => ctx.leader?.todayTokens || !l.includes("{tokens}"));
  if (ctx.leader && toLeader.length && rand() < 0.6) return fill(pick(toLeader, rand));
  const { day, hour } = worldClock(at);
  const now = (bot.moments ?? []).filter(
    (m) => (!m.days || m.days.includes(day)) && hour >= (m.from ?? 0) && hour < (m.to ?? 24),
  );
  if (now.length && rand() < 0.5)
    return fill(
      pick(
        now.flatMap((m) => m.lines),
        rand,
      ),
    );
  return fill(pick(bot.lines, rand));
}
