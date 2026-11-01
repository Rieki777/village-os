/**
 * PULL A CARD (Rye, 2026-10-30): an optional reading at the start of a live
 * session. Anyone in the room may pull one, as many times as they like. It
 * weaves the Gene Keys and Human Design of the people present with the sky of
 * the day, names each person, and offers the room a few ways to hold the
 * session. A lens for being present, never a forecast.
 *
 * This file is the pure part, shared by the server and the browser:
 *  - the sky of the day as the puller's browser read it (`CardSky`), and the
 *    check the server runs on it (`parseSky`);
 *  - the room read as a group (`readRoom`): each person's type, what today's
 *    sky switches on for them, the channels two people make only together, the
 *    centres nobody here defines;
 *  - the plain reading built from those facts in Amora's own words
 *    (`plainReading`), which is the whole card when no assistant key is set and
 *    the draft Maia weaves from when one is.
 *
 * WHO IS READ. A person gets a reading only when they show their lines, said
 * yes to Maia using them, and have not asked to be left out of cards. Everyone
 * else present is welcomed by name and nothing more is said about them: the
 * server never hands this file a chart it may not read (server/lib/sessionCard.ts).
 *
 * WHOSE WORDS. No Gene Keys text of Richard Rudd's is reproduced here: gates
 * and lines are numbers, the centres are named the way every Human Design
 * source names them, and every sentence about them is Amora's. The strategy and
 * authority lines are the ones the lines card already shows (shared/geneKeys.ts).
 *
 * BOTH SKIES, LABELLED. Rye chose to read the Western sky too: signs, the
 * Moon's phase, retrogrades and a void-of-course Moon. Each line of the card
 * says which system it comes from, so nobody mistakes one for the other.
 */
import {
  AUTHORITY_WORDS, BODIES, CHANNELS, STRATEGY_WORDS, analyse, centerOf, profileOf, withArticle,
  type Activation, type Activations, type Authority, type Body, type Center, type Chart, type HdType,
} from "./geneKeys";

// ── THE SKY OF THE DAY ──────────────────────────────────────────────────────

export const SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
] as const;
export type SignName = (typeof SIGNS)[number];
export type Element = "fire" | "earth" | "air" | "water";
/** Aries fire, Taurus earth, Gemini air, Cancer water, and round again. */
export const ELEMENTS: readonly Element[] = ["fire", "earth", "air", "water"];
export const elementOf = (sign: number): Element => ELEMENTS[sign % 4];

export const WESTERN_BODIES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"] as const;
export type WesternBody = (typeof WESTERN_BODIES)[number];
/** The bodies that can turn retrograde. */
export const RETRO_BODIES = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"] as const;
export type RetroBody = (typeof RETRO_BODIES)[number];

/**
 * The sky at the moment of the pull, read in the puller's browser
 * (shared/geneKeysSky.ts `skyAt`). The server may not import the ephemeris, so
 * it checks the shape and keeps what it was sent; the sky is public and the
 * same for everybody, so a browser that lied would only fool its own room.
 */
export interface CardSky {
  /** The instant read, ISO. */
  at: string;
  /** Every body's gate and line now: one personality side, as a transit is read. */
  gates: Activations;
  /** The sign each body stands in, 0 Aries to 11 Pisces. */
  signs: Record<WesternBody, number>;
  /** The bodies moving backwards along the ecliptic right now. */
  retro: RetroBody[];
  /** 0 new, 0.5 full, toward 1 as it wanes: the fraction the calendar's MoonGlyph draws. */
  moonPhase: number;
  /** Set when the Moon makes no further major aspect before it leaves its sign: the ISO instant it does. */
  moonVoidUntil: string | null;
}

/** How far from the server's clock a sky may be read: a day and a half, for any time zone and a slow tab. */
export const SKY_SLACK_MS = 36 * 60 * 60 * 1000;

const isActivation = (v: unknown): v is Activation => {
  const a = v as Activation;
  return !!a && Number.isInteger(a.gate) && a.gate >= 1 && a.gate <= 64 && Number.isInteger(a.line) && a.line >= 1 && a.line <= 6;
};

/** The sky a browser sent, rebuilt field by field, or null when any part is wrong. */
export function parseSky(raw: unknown, now: number): CardSky | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const at = typeof r.at === "string" ? Date.parse(r.at) : NaN;
  if (!Number.isFinite(at) || Math.abs(at - now) > SKY_SLACK_MS) return null;
  const g = r.gates as Record<string, unknown> | null;
  const s = r.signs as Record<string, unknown> | null;
  if (!g || typeof g !== "object" || !s || typeof s !== "object") return null;
  const gates = {} as Activations;
  for (const b of BODIES) {
    if (!isActivation(g[b])) return null;
    gates[b] = { gate: (g[b] as Activation).gate, line: (g[b] as Activation).line };
  }
  const signs = {} as Record<WesternBody, number>;
  for (const b of WESTERN_BODIES) {
    const v = s[b];
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 11) return null;
    signs[b] = v as number;
  }
  if (!Array.isArray(r.retro)) return null;
  const retro = RETRO_BODIES.filter((b) => (r.retro as unknown[]).includes(b));
  const phase = Number(r.moonPhase);
  if (!Number.isFinite(phase) || phase < 0 || phase > 1) return null;
  let moonVoidUntil: string | null = null;
  if (r.moonVoidUntil != null) {
    const until = typeof r.moonVoidUntil === "string" ? Date.parse(r.moonVoidUntil) : NaN;
    // A void lasts at most a little over two days; anything else was not read from the sky.
    if (!Number.isFinite(until) || until < at || until - at > 3 * 24 * 60 * 60 * 1000) return null;
    moonVoidUntil = new Date(until).toISOString();
  }
  return { at: new Date(at).toISOString(), gates, signs, retro, moonPhase: phase, moonVoidUntil };
}

export type MoonPhaseName =
  | "New moon" | "Waxing crescent" | "First quarter" | "Waxing gibbous" | "Full moon" | "Waning gibbous" | "Last quarter" | "Waning crescent";

/** The eight phases, each an eighth of the cycle centred on its moment. */
export function moonPhaseName(phase: number): MoonPhaseName {
  const names: MoonPhaseName[] = [
    "New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent",
  ];
  return names[Math.floor((((phase % 1) + 1) % 1) * 8 + 0.5) % 8];
}

// ── THE ROOM, READ AS A GROUP ───────────────────────────────────────────────

/** Somebody present. `chart` is null for a person the card welcomes and does not read. */
export interface CardPerson {
  userId: string;
  name: string;
  chart: Chart | null;
}

export interface PersonFacts {
  userId: string;
  /** The name the card calls them by: a first name, or the full name where two people share one. */
  name: string;
  type: HdType;
  authority: Authority;
  profile: string;
  /** Today's Sun stands in one of their own gates. */
  sunInTheirGate: boolean;
  /** Channels today's sky completes for them: they carry one gate, the sky the other. */
  lit: { channel: string; skyGate: number }[];
  /** Channels they make only with one other person here: neither carries both gates. */
  together: { channel: string; withUserId: string; withName: string }[];
}

export type RoomMood = "inward" | "outward" | "steady";

export interface RoomFacts {
  sky: {
    sun: Activation;
    earth: Activation;
    moon: Activation;
    sunSign: SignName;
    moonSign: SignName;
    moonElement: Element;
    moonPhase: MoonPhaseName;
    retro: RetroBody[];
    moonVoidUntil: string | null;
  };
  people: PersonFacts[];
  welcomed: { userId: string; name: string }[];
  types: Partial<Record<HdType, number>>;
  /** How many of the people read decide with an emotional authority. */
  emotional: number;
  /** Centres nobody read here defines, even with today's sky: the room takes them in from outside. */
  openCenters: Center[];
  mood: RoomMood;
}

const gatesOf = (chart: Chart): Set<number> => {
  const set = new Set<number>();
  for (const side of ["personality", "design"] as const) for (const b of BODIES) set.add(chart[side][b].gate);
  return set;
};

const channelName = ([a, b]: readonly [number, number]): string => `${a}-${b}`;

/** First names, except where two people present share one, who keep their whole name. */
export function callNames(people: readonly { userId: string; name: string }[]): Map<string, string> {
  const first = (n: string) => n.trim().split(/\s+/)[0] || n.trim() || "Someone";
  const count = new Map<string, number>();
  for (const p of people) count.set(first(p.name), (count.get(first(p.name)) ?? 0) + 1);
  return new Map(people.map((p) => [p.userId, (count.get(first(p.name)) ?? 0) > 1 ? p.name.trim() : first(p.name)]));
}

/**
 * Inward or outward from the Moon alone: its phase and its element. Waxing and
 * fire or air lean out; waning and earth or water lean in; the new moon leans
 * in hardest and the full moon out. The people in the room are not weighed
 * here, so two rooms on one day read the same weather.
 */
export function moodOf(moonPhase: number, moonSign: number): RoomMood {
  const p = ((moonPhase % 1) + 1) % 1;
  let score = p < 0.5 ? 1 : -1;
  if (p < 0.0625 || p >= 0.9375) score -= 1;
  if (p >= 0.4375 && p < 0.5625) score += 1;
  const el = elementOf(moonSign);
  score += el === "fire" || el === "air" ? 1 : -1;
  return score >= 2 ? "outward" : score <= -2 ? "inward" : "steady";
}

export function readRoom(present: readonly CardPerson[], sky: CardSky): RoomFacts {
  const names = callNames(present);
  const read = present.filter((p): p is CardPerson & { chart: Chart } => p.chart != null);
  const skyGates = new Set(BODIES.map((b) => sky.gates[b].gate));
  const gates = new Map(read.map((p) => [p.userId, gatesOf(p.chart)]));

  const people: PersonFacts[] = read.map((p) => {
    const mine = gates.get(p.userId)!;
    const d = analyse(p.chart);
    const lit = CHANNELS.filter(([a, b]) => (mine.has(a) && !mine.has(b) && skyGates.has(b)) || (mine.has(b) && !mine.has(a) && skyGates.has(a))).map(
      (c) => ({ channel: channelName(c), skyGate: mine.has(c[0]) ? c[1] : c[0] }),
    );
    const together: PersonFacts["together"] = [];
    for (const other of read) {
      if (other.userId === p.userId) continue;
      const theirs = gates.get(other.userId)!;
      for (const c of CHANNELS) {
        const [a, b] = c;
        const mineHalf = (mine.has(a) && !mine.has(b)) || (mine.has(b) && !mine.has(a));
        const theirsCompletes = (mine.has(a) && theirs.has(b) && !theirs.has(a)) || (mine.has(b) && theirs.has(a) && !theirs.has(b));
        if (mineHalf && theirsCompletes) together.push({ channel: channelName(c), withUserId: other.userId, withName: names.get(other.userId)! });
      }
    }
    return {
      userId: p.userId,
      name: names.get(p.userId)!,
      type: d.type,
      authority: d.authority,
      profile: profileOf(p.chart),
      sunInTheirGate: mine.has(sky.gates.Sun.gate),
      lit,
      together,
    };
  });

  // The room's own chart: every gate anyone read carries, and the sky's.
  const all = new Set<number>(Array.from(skyGates));
  for (const set of Array.from(gates.values())) for (const g of Array.from(set)) all.add(g);
  const defined = new Set<Center>();
  for (const [a, b] of CHANNELS) {
    if (!all.has(a) || !all.has(b)) continue;
    const x = centerOf(a), y = centerOf(b);
    if (x) defined.add(x);
    if (y) defined.add(y);
  }
  const ORDER: Center[] = ["Head", "Ajna", "Throat", "G", "Heart", "Spleen", "SolarPlexus", "Sacral", "Root"];
  const types: Partial<Record<HdType, number>> = {};
  for (const p of people) types[p.type] = (types[p.type] ?? 0) + 1;

  return {
    sky: {
      sun: sky.gates.Sun,
      earth: sky.gates.Earth,
      moon: sky.gates.Moon,
      sunSign: SIGNS[sky.signs.Sun],
      moonSign: SIGNS[sky.signs.Moon],
      moonElement: elementOf(sky.signs.Moon),
      moonPhase: moonPhaseName(sky.moonPhase),
      retro: sky.retro,
      moonVoidUntil: sky.moonVoidUntil,
    },
    people,
    welcomed: present.filter((p) => p.chart == null).map((p) => ({ userId: p.userId, name: names.get(p.userId)! })),
    types,
    emotional: people.filter((p) => p.authority === "Emotional").length,
    // Only a room somebody was read in has a chart to be open in.
    openCenters: people.length ? ORDER.filter((c) => !defined.has(c)) : [],
    mood: moodOf(sky.moonPhase, sky.signs.Moon),
  };
}

// ── THE WORDS ───────────────────────────────────────────────────────────────

/** Amora's words for what each centre carries, for "the room is open in...". */
export const CENTER_WORDS: Record<Center, { name: string; carries: string }> = {
  Head: { name: "Head", carries: "questions and inspiration" },
  Ajna: { name: "Ajna", carries: "making sense of things" },
  Throat: { name: "Throat", carries: "speaking up and getting things moving" },
  G: { name: "G", carries: "direction and belonging" },
  Heart: { name: "Heart", carries: "willpower and promises" },
  Spleen: { name: "Spleen", carries: "instinct and wellbeing" },
  SolarPlexus: { name: "Solar Plexus", carries: "feeling and mood" },
  Sacral: { name: "Sacral", carries: "steady energy for the work" },
  Root: { name: "Root", carries: "the pressure to get going" },
};

/** The plural each type takes in "two Projectors". */
const TYPE_PLURAL: Record<HdType, string> = {
  Generator: "Generators",
  "Manifesting Generator": "Manifesting Generators",
  Projector: "Projectors",
  Manifestor: "Manifestors",
  Reflector: "Reflectors",
};

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const countWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function andList(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Which system a line of the card comes from. */
export type CardSystem = "human-design" | "western" | "both";

export const SYSTEM_LABELS: Record<CardSystem, string> = {
  "human-design": "Human Design and Gene Keys",
  western: "Western astrology",
  both: "Both skies",
};

export type SuggestionKind = "longer-arrival" | "brisk-arrival" | "sleep-on-it" | "review" | "hold-conflict" | "seed" | "harvest";

/** A way to hold the session the room may take up. Nothing changes until somebody does. */
export interface CardSuggestion {
  kind: SuggestionKind;
  system: CardSystem;
  words: string;
}

export interface CardLine {
  system: CardSystem;
  text: string;
}

export interface CardReading {
  /** The collective reading, a few short paragraphs, each labelled with its system. */
  collective: CardLine[];
  /** Each read person's own words, by user id. Private to them unless they share it. */
  lines: Record<string, string>;
  suggestions: CardSuggestion[];
  /** The people present the card welcomes by name without reading. */
  welcomed: string[];
  /** Who wrote it: the plain builder, or Maia weaving the same facts. */
  source: "plain" | "maia";
}

/** The sky of the day in a line for each system, for Maia's facts. The card's panels show the same. */
export function skyLines(f: RoomFacts): Record<"human-design" | "western", string> {
  return {
    "human-design": `Today's Sun is in gate ${f.sky.sun.gate}, line ${f.sky.sun.line}, with the Earth in gate ${f.sky.earth.gate}, and the Moon passes through gate ${f.sky.moon.gate}.`,
    western: westernLine(f),
  };
}

/** What the sky says about the Western side of the day, in a line or two. */
function westernLine(f: RoomFacts): string {
  const s = f.sky;
  const parts = [`The Sun is in ${s.sunSign}, and the Moon is in ${s.moonSign}, ${withArticle(s.moonElement)} sign. Its phase: ${s.moonPhase.toLowerCase()}.`];
  if (s.retro.length) parts.push(`${andList(s.retro)} ${s.retro.length === 1 ? "is" : "are"} retrograde.`);
  if (s.moonVoidUntil) parts.push("The Moon is void of course, between signs in spirit, until it moves on.");
  return parts.join(" ");
}

function moodLine(mood: RoomMood): string {
  if (mood === "inward") return "The day leans inward. Slower voices, more listening, and room for what is felt before what is done.";
  if (mood === "outward") return "The day leans outward. Energy for making, deciding and speaking plainly to each other.";
  return "The day sits in between: steady enough for real work, soft enough to listen.";
}

function roomLine(f: RoomFacts): string | null {
  if (!f.people.length) return null;
  const order: HdType[] = ["Generator", "Manifesting Generator", "Projector", "Manifestor", "Reflector"];
  const kinds = order
    .filter((t) => f.types[t])
    .map((t) => (f.types[t] === 1 ? withArticle(t) : `${countWord(f.types[t]!)} ${TYPE_PLURAL[t]}`));
  // Everyone present is named here, the people read and the people welcomed,
  // so nobody in the room reads a "here today" that leaves them out. What
  // follows is about the people read, and says so when that is not everyone.
  const read = f.people.map((p) => p.name);
  const parts = f.welcomed.length
    ? [`Here today: ${andList([...read, ...f.welcomed.map((w) => w.name)])}. Read from their own lines: ${andList(read)}, ${andList(kinds)}.`]
    : [`Here today: ${andList(read)}. Between you, ${andList(kinds)}.`];
  const nobody = f.welcomed.length ? "nobody read today" : "nobody here";
  if (f.openCenters.length) {
    const open = f.openCenters.map((c) => CENTER_WORDS[c].carries);
    parts.push(
      f.openCenters.length === 1
        ? `Even with today's sky, ${nobody} defines the ${CENTER_WORDS[f.openCenters[0]].name}, so ${open[0]} will come from outside the circle today. Notice whose is whose.`
        : `Even with today's sky, ${f.welcomed.length ? "the people read are" : "the room is"} open in ${andList(f.openCenters.map((c) => CENTER_WORDS[c].name))}: ${andList(open)} will come from outside the circle today.`,
    );
  } else {
    parts.push("Together, and with today's sky, every centre is defined: the room carries a whole chart between you.");
  }
  // One pair is enough for the shared screen; each person's own line names theirs.
  const pair = f.people.flatMap((p) => p.together.map((t) => ({ a: p.name, b: t.withName, channel: t.channel }))).find((x) => x.a < x.b);
  if (pair) parts.push(`${pair.a} and ${pair.b} make channel ${pair.channel} only together, something neither carries alone.`);
  return parts.join(" ");
}

/** One person's own words: what today switches on for them, then how they decide. */
export function personLine(p: PersonFacts, f: RoomFacts): string {
  const parts: string[] = [];
  if (p.sunInTheirGate) parts.push(`Today's Sun stands in your gate ${f.sky.sun.gate}: a day when that part of you is easy to see. Let it be seen.`);
  else if (p.lit.length) {
    const l = p.lit[0];
    parts.push(`Today's sky lends you gate ${l.skyGate} and completes your channel ${l.channel}: something usually half open in you is switched on today.`);
  }
  if (p.together.length) parts.push(`With ${p.together[0].withName} you make channel ${p.together[0].channel}; notice what moves when you two work on something.`);
  if (parts.length < 2) parts.push(`As ${withArticle(p.type)}, ${lowerFirst(STRATEGY_WORDS[p.type].line)}`);
  if (parts.length < 2 || p.authority === "Emotional") parts.push(`Your authority: ${AUTHORITY_WORDS[p.authority].line}`);
  return parts.slice(0, 3).join(" ");
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

export function suggestionsFor(f: RoomFacts): CardSuggestion[] {
  const out: CardSuggestion[] = [];
  if (f.mood === "inward") out.push({ kind: "longer-arrival", system: "western", words: "Give the arrival round more time today, and leave a breath between voices." });
  if (f.mood === "outward") out.push({ kind: "brisk-arrival", system: "western", words: "A good day to make and decide. Keep the arrival round brisk and give the time to the items." });
  if (f.emotional > 0) {
    out.push({
      kind: "sleep-on-it",
      system: "human-design",
      words:
        f.emotional === 1
          ? "One of you decides with an emotional authority. On a big proposal, the sleep answer lets it rest overnight."
          : `${countWord(f.emotional).replace(/^./, (c) => c.toUpperCase())} of you decide with an emotional authority. On a big proposal, the sleep answer lets it rest overnight.`,
    });
  }
  if (f.sky.retro.includes("Mercury")) {
    out.push({ kind: "review", system: "western", words: "Mercury is retrograde: good for reviewing and finishing. Read each action back before it leaves the room." });
  }
  if (f.sky.retro.includes("Mars") || f.sky.moonVoidUntil) {
    out.push({
      kind: "hold-conflict",
      system: "western",
      words: f.sky.moonVoidUntil
        ? "The Moon is void of course: a weak time to settle a tension between people. If one is on the agenda, consider giving it a later session."
        : "Mars is retrograde: heat turns inward. If a tension between people is on the agenda, consider giving it a session of its own.",
    });
  }
  if (f.sky.moonPhase === "New moon") out.push({ kind: "seed", system: "western", words: "New moon: a session for intentions. Name what you want to start before you plan it." });
  if (f.sky.moonPhase === "Full moon") out.push({ kind: "harvest", system: "western", words: "Full moon: name what has come to fruit, and thank someone for it." });
  return out;
}

/**
 * The whole card in plain words, from the facts alone. Always available; Maia's
 * weaving falls back to it.
 *
 * EACH THING SAID ONCE, as the room asks of its own stages. The card's two sky
 * panels already list the gates, the signs, the phase and what is retrograde,
 * so the plain reading does not repeat them: it says what the panels cannot,
 * who is here and how the day leans. Maia is handed the sky facts all the same
 * (`skyLines` among them), to weave from.
 */
export function plainReading(f: RoomFacts): CardReading {
  const collective: CardLine[] = [];
  const room = roomLine(f);
  if (room) collective.push({ system: "human-design", text: room });
  collective.push({ system: "western", text: moodLine(f.mood) });
  const lines: Record<string, string> = {};
  for (const p of f.people) lines[p.userId] = personLine(p, f);
  return { collective, lines, suggestions: suggestionsFor(f), welcomed: f.welcomed.map((w) => w.name), source: "plain" };
}

// ── LIMITS AND THE HTTP SHAPES ──────────────────────────────────────────────

export const CARD_LIMITS = {
  /** Cards one session may hold. Pulling again is the point; a room of a hundred cards is not. */
  perSession: 24,
  /** Seconds between two pulls in one room, so a double tap is one card. */
  gapSeconds: 10,
  /** Pulls one member may make in an hour, across every room. */
  perMemberHour: 30,
  /** The longest collective paragraph and personal line kept from Maia. */
  paragraph: 600,
  line: 400,
} as const;

export const SESSION_CARD_API = "/api/session-card";

/** One card as a viewer receives it. */
export interface CardView {
  id: number;
  /** 1 for the session's first card. */
  n: number;
  pulledByName: string;
  pulledAt: string;
  sky: CardSky;
  collective: CardLine[];
  suggestions: CardSuggestion[];
  welcomed: string[];
  source: "plain" | "maia";
  /** The viewer's own line, or null when the card did not read them. */
  mine: string | null;
  /** Whether the viewer has shared their line with the room. */
  mineShared: boolean;
  /** Lines other people chose to share, in the order they were read. */
  shared: { name: string; line: string }[];
}

export interface CardsAnswer {
  cards: CardView[];
  /** Whether this viewer may pull now: in the room and the session still open. */
  mayPull: boolean;
  /** Why the viewer is not read, when they are not: so the card can say how to be. */
  notRead: "no-lines" | "hidden" | "no-maia" | "left-out" | null;
}
