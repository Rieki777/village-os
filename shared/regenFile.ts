/**
 * A file from ReGen Civics, read and cleaned before a founder sees any of it.
 *
 * ReGen Civics runs the Season 2 sessions where each land project designs its
 * Game, and every project leaves with a file it can load here: the Week 4 card
 * ("regen-civics/village-card@1", the board's "Copy for Village OS") or the
 * whole Village OS 1.0 file ("regen-civics/village@1", built from the
 * project's profile, with the card riding inside as `card`). Both are written
 * in Village OS's own words: the needs list is the exact body of the scope
 * write and `decidesBy` is a `DECIDES_BY` id. The contract lives on that side, in shared/villageOsCard.ts and
 * shared/villageFile.ts of the ReGen Civics repository.
 *
 * ── TWO SHAPES, AND EVERYTHING ELSE IS REFUSED ───────────────────────────
 *
 * `schema` names the shape. A file naming neither is refused whole, in a
 * sentence that says which two this screen reads, because a half-read file of
 * unknown shape would put guesses in front of a founder dressed as answers.
 *
 * ── A BAD ENTRY IS LEFT OUT, AND SAYS SO ─────────────────────────────────
 *
 * Inside a known shape, an entry that does not hold up (a seat with no name, a
 * need key Village OS cannot store) is dropped and a sentence goes on
 * `leftOut`, so the preview can say what it did not load. Nothing is renamed
 * or repaired to make it fit.
 *
 * ── NULL KEEPS VILLAGE OS'S DEFAULT ──────────────────────────────────────
 *
 * The 1.0 file sends null for every decision its stewards have not made. This
 * file keeps those nulls, and nothing downstream turns one into a value.
 *
 * NOTHING HERE IS MONEY. The 1.0 file may carry the stewards' answer to the
 * issuance cap; it is read so the founders see it beside the launch
 * decision it answers, and no part of the import writes it
 * (shared/regenImport.ts).
 */
import { isNeedDepth, needKeyProblem, NEED_WEIGHTS, type NeedDepth, type NeedWeight } from "./needs";
import { DECIDES_BY, GLOSS_MAX } from "./power";

export const REGEN_CARD_SCHEMA = "regen-civics/village-card@1";
export const REGEN_FILE_SCHEMA = "regen-civics/village@1";

/** The biggest file this screen reads. A real 1.0 file is a few tens of kilobytes. */
export const REGEN_FILE_MAX_BYTES = 512 * 1024;

/**
 * The nine circles the Season 2 deck draws on its wheel (slide 41), keyed the
 * way the board keys them. A project's own circle arrives as "own:<name>".
 */
export const REGEN_CIRCLES = {
  food: "Food & Fertility",
  water: "Living Water",
  breath: "Nourishing Breath",
  habitats: "Habitats & Material Libraries",
  love: "Love Cultivation",
  trust: "Trust & Comms",
  purpose: "Purpose & Ikigai",
  festivals: "Festivals & Rites",
  organize: "Organize & Co-Create",
} as const;
export type RegenCircleKey = keyof typeof REGEN_CIRCLES;

export const HELD_BY = ["team", "open", "being"] as const;
export type HeldBy = (typeof HELD_BY)[number];

/** The issuance cap answer that keeps Village OS's own number, as the founders' recorded choice. It uncaps nothing. */
export const CAP_DECLINED = "declined";

/** How a decision stands in the 1.0 file. "yours" is the stewards' own answer. */
export const DECISION_STATUSES = ["yours", "suggested", "default", "open"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export interface ProfileNeed {
  needKey: string;
  /** Only a village's own need carries one. */
  label: string | null;
  depthTarget: NeedDepth | null;
  breadthTargetPct: number | null;
  sortOrder: number | null;
}

export interface ProfileCircle {
  /** One of the nine keys, or "own:<name>". */
  key: string;
  label: string;
  needs: string[];
  decidesOn: string[];
  decidesBy: string | null;
  decidesByGloss: string | null;
  /** Every way the project's cards named, so a disagreement reaches the founder as a choice. */
  decidesByAnswers: { by: string; gloss: string | null }[];
  startsWith: boolean;
}

export interface ProfileSeat {
  name: string;
  circle: string;
  circleLabel: string;
  seats: number;
  aim: string | null;
  domain: string | null;
  accountabilities: string | null;
  why: string | null;
  heldBy: HeldBy;
  who: string | null;
  contribution: { hoursPerWeek: number | null; text: string | null };
  needLinks: { needKey: string; weight: NeedWeight }[];
}

export interface ProfileCard {
  needs: ProfileNeed[];
  totalityPct: number | null;
  /** A circle that meets a need, before any seat in it exists. */
  needLinks: { needKey: string; circle: string; circleLabel: string }[];
  seats: ProfileSeat[];
  circles: ProfileCircle[];
  decisions: { together: string[]; how: string | null; agreement: string | null };
  entry: string | null;
  quests: { quest: string; need: string | null }[];
  /** Needs named on Week 3 that the project has not taken on as its own yet. */
  customNeeds: { needKey: string; label: string }[];
  firstLine: string | null;
  players: { toStart: string | null; now: string | null };
  shape: { shape: string | null; line: string | null };
}

/**
 * The 1.0 file's own sections, in the order the file puts them (ReGen Civics
 * shared/villageFile.ts, its top-level keys pinned by a test there).
 *
 *   identity  settings: the Identity boxes take the name, tagline, location,
 *             what a member is called and the currency; timezone and
 *             hemisphere are set under Season
 *   modules   the optional modules the stewards switch on
 *   economy   the stewards' answer to the issuance cap: a number, or
 *             "declined" (keep Village OS's own, as the founders' choice)
 *   purpose, membership, quests, legal
 *             words for Village OS's own editors, for the founders to save
 *   notes     the stewards' words for what the founders set by hand
 */
export interface ProfileVillage {
  identity: {
    name: string | null;
    tagline: string | null;
    location: string | null;
    memberWord: string | null;
    timezone: string | null;
    hemisphere: "north" | "south" | null;
    currency: string | null;
  };
  modules: { on: string[] | null };
  economy: { issuanceCap: number | typeof CAP_DECLINED | null };
  purpose: { statement: string | null };
  membership: { covenant: string | null };
  quests: { tokenName: string | null };
  legal: { exitPolicy: string | null };
  notes: { key: string; title: string; text: string }[];
  status: Record<string, { status: DecisionStatus; from: string | null }>;
}

export interface RegenProfile {
  schema: typeof REGEN_CARD_SCHEMA | typeof REGEN_FILE_SCHEMA;
  kind: "card" | "village";
  from: { site: string | null; project: string | null; applicationId: number | null; weeks: number[] };
  generatedAt: string | null;
  card: ProfileCard;
  /** The 1.0 file's own sections. Null for a Week 4 card. */
  village: ProfileVillage | null;
  /** One sentence per entry this read left out, and why. */
  leftOut: string[];
}

export type ReadResult = { ok: true; profile: RegenProfile } | { ok: false; error: string };

const DECIDES_BY_IDS = new Set<string>(DECIDES_BY.map((d) => d.id));
const WEIGHTS = new Set<string>(NEED_WEIGHTS);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Trimmed text, capped, or null for anything empty or not text. Numbers read as their digits. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function wholeNumber(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

function texts(v: unknown, max: number, limit = 50): string[] {
  const out: string[] = [];
  for (const x of arr(v)) {
    const s = text(x, max);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** A circle key a file may name: one of the nine, or "own:<name>". */
export function cleanCircleKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const k = v.trim();
  if (Object.hasOwn(REGEN_CIRCLES, k)) return k;
  if (k.startsWith("own:")) {
    const name = text(k.slice(4), 50);
    return name ? `own:${name}` : null;
  }
  return null;
}

/** The name a person reads for a circle key. */
export function circleKeyLabel(key: string, given?: string | null): string {
  if (Object.hasOwn(REGEN_CIRCLES, key)) return REGEN_CIRCLES[key as RegenCircleKey];
  if (key.startsWith("own:")) return key.slice(4);
  return text(given, 120) ?? key;
}

/** The schema a file names, with a full-width at sign read as the ordinary one. */
function schemaOf(raw: Record<string, unknown>): string | null {
  return typeof raw.schema === "string" ? raw.schema.normalize("NFKC").trim() : null;
}

/**
 * Read a file from ReGen Civics: the text a founder pasted, or the object it
 * parses to. Answers the cleaned profile, or the one sentence that says why
 * nothing was read.
 */
export function readRegenFile(input: unknown): ReadResult {
  let raw: unknown = input;
  if (typeof input === "string") {
    const body = input.trim();
    if (!body) return { ok: false, error: "Paste the file from ReGen Civics, or choose it, and this screen reads it." };
    if (body.length > REGEN_FILE_MAX_BYTES) {
      return { ok: false, error: "That file is larger than a ReGen Civics profile can be, so nothing was read." };
    }
    try {
      raw = JSON.parse(body);
    } catch {
      return {
        ok: false,
        error: "That could not be read as a file from ReGen Civics. Copy it again from your profile, all of it from the first brace to the last.",
      };
    }
  }
  if (!isObj(raw)) {
    return { ok: false, error: "That could not be read as a file from ReGen Civics. Copy it again from your profile, all of it from the first brace to the last." };
  }
  const schema = schemaOf(raw);
  if (!schema) {
    return {
      ok: false,
      error: "This file does not say what kind of file it is, so Village OS cannot read it. A file from ReGen Civics names its schema on its first line.",
    };
  }
  if (schema !== REGEN_CARD_SCHEMA && schema !== REGEN_FILE_SCHEMA) {
    return {
      ok: false,
      error:
        `This file says it is "${schema.slice(0, 80)}". Village OS reads two kinds of file from ReGen Civics: ` +
        `the Week 4 card ("${REGEN_CARD_SCHEMA}") and the Village OS 1.0 file ("${REGEN_FILE_SCHEMA}"). Nothing was read.`,
    };
  }

  const leftOut: string[] = [];
  if (schema === REGEN_CARD_SCHEMA) {
    return {
      ok: true,
      profile: {
        schema,
        kind: "card",
        from: readFrom(raw.from),
        generatedAt: null,
        card: readCard(raw, leftOut),
        village: null,
        leftOut,
      },
    };
  }
  const cardRaw = isObj(raw.card) ? raw.card : {};
  const cardSchema = schemaOf(cardRaw);
  if (cardSchema && cardSchema !== REGEN_CARD_SCHEMA) {
    leftOut.push(`The card inside this file says it is "${cardSchema.slice(0, 80)}", so its needs, circles and roles were not read.`);
  }
  return {
    ok: true,
    profile: {
      schema,
      kind: "village",
      from: readFrom(raw.from),
      generatedAt: text(raw.generatedAt, 40),
      card: readCard(cardSchema && cardSchema !== REGEN_CARD_SCHEMA ? {} : cardRaw, leftOut),
      village: readVillage(raw, leftOut),
      leftOut,
    },
  };
}

function readFrom(v: unknown): RegenProfile["from"] {
  const f = obj(v);
  const weeks = arr(f.weeks)
    .map((w) => wholeNumber(w, 1, 52))
    .filter((w): w is number => w !== null);
  return {
    site: text(f.site, 120),
    project: text(f.project, 160),
    applicationId: wholeNumber(f.applicationId, 1, Number.MAX_SAFE_INTEGER),
    weeks: Array.from(new Set(weeks)).sort((a, b) => a - b),
  };
}

function readNeed(v: unknown, leftOut: string[]): ProfileNeed | null {
  const n = obj(v);
  const key = typeof n.needKey === "string" ? n.needKey.trim() : "";
  const problem = needKeyProblem(key);
  if (problem) {
    leftOut.push(`A need keyed "${key.slice(0, 64) || "nothing"}" was left out. ${problem}`);
    return null;
  }
  return {
    needKey: key,
    label: key.startsWith("custom:") ? text(n.label, 120) : null,
    depthTarget: isNeedDepth(n.depthTarget) ? n.depthTarget : null,
    breadthTargetPct: wholeNumber(n.breadthTargetPct, 0, 100),
    sortOrder: wholeNumber(n.sortOrder, 0, 10_000),
  };
}

function readCircle(v: unknown, leftOut: string[]): ProfileCircle | null {
  const c = obj(v);
  const key = cleanCircleKey(c.circle);
  if (!key) {
    const named = text(c.circle, 60);
    if (named) leftOut.push(`A circle keyed "${named}" was left out: it is not one of the nine circles, and it does not name one of the project's own.`);
    return null;
  }
  const answers: ProfileCircle["decidesByAnswers"] = [];
  for (const a of arr(c.decidesByAnswers)) {
    const by = text(obj(a).by, 40);
    if (!by || !DECIDES_BY_IDS.has(by)) continue;
    const gloss = by === "other" ? text(obj(a).gloss, GLOSS_MAX) : null;
    if (by === "other" && !gloss) continue;
    if (!answers.some((x) => x.by === by && x.gloss === gloss)) answers.push({ by, gloss });
  }
  let decidesBy = text(c.decidesBy, 40);
  let decidesByGloss = decidesBy === "other" ? text(c.decidesByGloss, GLOSS_MAX) : null;
  if (decidesBy && !DECIDES_BY_IDS.has(decidesBy)) {
    leftOut.push(`How ${circleKeyLabel(key, text(c.label, 120))} decides was left out: "${decidesBy}" is not a way of deciding Village OS knows.`);
    decidesBy = null;
  } else if (decidesBy === "other" && !decidesByGloss) {
    leftOut.push(`How ${circleKeyLabel(key, text(c.label, 120))} decides was left out: "another way" needs its one line saying what the way is.`);
    decidesBy = null;
  }
  if (!decidesBy) decidesByGloss = null;
  return {
    key,
    label: circleKeyLabel(key, text(c.label, 120)),
    needs: texts(c.needs, 64).filter((k) => !needKeyProblem(k)),
    decidesOn: texts(c.decidesOn, 200, 20),
    decidesBy,
    decidesByGloss,
    decidesByAnswers: answers,
    startsWith: c.startsWith === true,
  };
}

function readSeat(v: unknown, leftOut: string[]): ProfileSeat | null {
  const s = obj(v);
  const name = text(s.name, 120);
  if (!name) {
    leftOut.push("A role with no name was left out.");
    return null;
  }
  const circle = cleanCircleKey(s.circle);
  if (!circle) {
    leftOut.push(`The role "${name}" was left out: it does not say which circle it sits in.`);
    return null;
  }
  const heldBy = (HELD_BY as readonly string[]).includes(String(s.heldBy)) ? (s.heldBy as HeldBy) : "open";
  const contribution = obj(s.contribution);
  const hours = typeof contribution.hoursPerWeek === "number" && contribution.hoursPerWeek > 0 && contribution.hoursPerWeek <= 168
    ? contribution.hoursPerWeek
    : null;
  const links: ProfileSeat["needLinks"] = [];
  for (const l of arr(s.needLinks)) {
    const key = typeof obj(l).needKey === "string" ? String(obj(l).needKey).trim() : "";
    if (needKeyProblem(key)) continue;
    const weight = WEIGHTS.has(String(obj(l).weight)) ? (obj(l).weight as NeedWeight) : "primary";
    if (!links.some((x) => x.needKey === key)) links.push({ needKey: key, weight });
  }
  return {
    name,
    circle,
    circleLabel: circleKeyLabel(circle, text(s.circleLabel, 120)),
    seats: wholeNumber(s.seats, 1, 50) ?? 1,
    aim: text(s.aim, 2000),
    domain: text(s.domain, 2000),
    accountabilities: text(s.accountabilities, 2000),
    why: text(s.why, 2000),
    heldBy,
    who: text(s.who, 120),
    contribution: { hoursPerWeek: hours, text: text(contribution.text, 300) },
    needLinks: links,
  };
}

function readCard(raw: Record<string, unknown>, leftOut: string[]): ProfileCard {
  const needs: ProfileNeed[] = [];
  for (const n of arr(raw.needs)) {
    const need = readNeed(n, leftOut);
    if (need && !needs.some((x) => x.needKey === need.needKey)) needs.push(need);
  }
  const customNeeds: ProfileCard["customNeeds"] = [];
  for (const c of arr(raw.customNeeds)) {
    const key = typeof obj(c).needKey === "string" ? String(obj(c).needKey).trim() : "";
    const label = text(obj(c).label, 120);
    if (!label || needKeyProblem(key) || !key.startsWith("custom:")) continue;
    if (needs.some((n) => n.needKey === key) || customNeeds.some((x) => x.needKey === key)) continue;
    customNeeds.push({ needKey: key, label });
  }
  const needLinks: ProfileCard["needLinks"] = [];
  for (const l of arr(raw.needLinks)) {
    const key = typeof obj(l).needKey === "string" ? String(obj(l).needKey).trim() : "";
    const circle = obj(l).circle === "own" ? "own" : cleanCircleKey(obj(l).circle);
    if (needKeyProblem(key) || !circle) continue;
    needLinks.push({ needKey: key, circle, circleLabel: circle === "own" ? "One of your own circles" : circleKeyLabel(circle, text(obj(l).circleLabel, 120)) });
  }
  const circles: ProfileCircle[] = [];
  for (const c of arr(raw.circles)) {
    const circle = readCircle(c, leftOut);
    if (circle && !circles.some((x) => x.key === circle.key)) circles.push(circle);
  }
  const seats: ProfileSeat[] = [];
  for (const s of arr(raw.seats)) {
    const seat = readSeat(s, leftOut);
    if (seat) seats.push(seat);
  }
  const quests: ProfileCard["quests"] = [];
  for (const q of arr(raw.quests)) {
    const quest = text(obj(q).quest, 200);
    if (!quest) continue;
    const need = typeof obj(q).need === "string" && !needKeyProblem(String(obj(q).need).trim()) ? String(obj(q).need).trim() : null;
    quests.push({ quest, need });
  }
  const decisions = obj(raw.decisions);
  const players = obj(raw.players);
  const shape = obj(raw.shape);
  return {
    needs,
    totalityPct: wholeNumber(obj(raw.variables)["needs.totality_target_pct"], 0, 100),
    needLinks,
    seats,
    circles,
    decisions: { together: texts(decisions.together, 200, 20), how: text(decisions.how, 200), agreement: text(decisions.agreement, 1000) },
    entry: text(raw.entry, 1000),
    quests,
    customNeeds,
    firstLine: text(raw.firstLine, 1000),
    players: { toStart: text(players.toStart, 120), now: text(players.now, 120) },
    shape: { shape: text(shape.shape, 200), line: text(shape.line, 1000) },
  };
}

/** A timezone this runtime can format in, which is what Village OS's season settings refuse without. */
function timezoneOf(v: unknown): string | null {
  const tz = text(v, 64);
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

function readVillage(raw: Record<string, unknown>, leftOut: string[]): ProfileVillage {
  const identity = obj(raw.identity);
  const hemisphere = identity.hemisphere === "north" || identity.hemisphere === "south" ? identity.hemisphere : null;
  const timezone = timezoneOf(identity.timezone);
  if (text(identity.timezone, 64) && !timezone) leftOut.push(`The timezone "${text(identity.timezone, 64)}" was left out: it is not one this browser knows.`);
  const currency = text(identity.currency, 8)?.toUpperCase() ?? null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) leftOut.push(`The currency "${currency}" was left out: a currency is three letters, like USD or CRC.`);
  const capRaw = obj(raw.economy).issuanceCap;
  const cap = capRaw === CAP_DECLINED ? CAP_DECLINED : wholeNumber(capRaw, 1, 10_000_000);
  if (capRaw !== undefined && capRaw !== null && cap === null) leftOut.push("The issuance cap was left out: it is a whole number of tokens from 1 to 10,000,000, or declined.");
  const status: ProfileVillage["status"] = {};
  for (const [key, v] of Object.entries(obj(raw.status))) {
    const k = text(key, 80);
    if (!k) continue;
    const said = String(obj(v).status ?? "");
    // "confirmed" is the word the importer was briefed with; the 1.0 file says "yours".
    const st = said === "confirmed" ? "yours" : said;
    if (!(DECISION_STATUSES as readonly string[]).includes(st)) continue;
    status[k] = { status: st as DecisionStatus, from: text(obj(v).from, 120) };
  }
  const notes: ProfileVillage["notes"] = [];
  for (const [key, v] of Object.entries(obj(raw.notes))) {
    const k = text(key, 80);
    const words = text(obj(v).text, 4000);
    if (!k || !words) continue;
    notes.push({ key: k, title: text(obj(v).title, 200) ?? k, text: words });
  }
  const on = Array.isArray(obj(raw.modules).on) ? texts(obj(raw.modules).on, 40) : null;
  return {
    identity: {
      name: text(identity.name, 120),
      tagline: text(identity.tagline, 160),
      location: text(identity.location, 200),
      memberWord: text(identity.memberWord, 40),
      timezone,
      hemisphere,
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    },
    modules: { on },
    economy: { issuanceCap: cap },
    purpose: { statement: text(obj(raw.purpose).statement, 20000) },
    membership: { covenant: text(obj(raw.membership).covenant, 4000) },
    quests: { tokenName: text(obj(raw.quests).tokenName, 40) },
    legal: { exitPolicy: text(obj(raw.legal).exitPolicy, 4000) },
    notes,
    status,
  };
}
