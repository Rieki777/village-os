/**
 * THE ROLE CARD TEXT FORMAT, VERSION 1: one plain-text shape for a member's
 * role proposal that people and AIs can both write, and ONE reader for it.
 *
 * Rye, 2026-10-24: a member brings their role into the village by uploading
 * any document that describes it, or by running a copy-and-paste prompt in
 * their own AI (shared/roleCardPrompt.ts). Either way what comes back is this
 * format, and `readRoleCard` turns it into the exact body the proposal's PUT
 * takes (server/routes/roleProposals.ts). The AI half (the village's guide,
 * through the Saberra bridge) writes this format too and is read by the same
 * function, so this file is the contract both halves share.
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────
 *
 *   write(input: RoleCardDoc | ProposalPayloadLike, opts?: { village?: string | null }): string
 *   read(text: string, ctx: RoleCardContext): RoleCardRead
 *     RoleCardRead = { ok, isCard, version, proposalBody, problems: [{ field, sentence, kind, blocks }], sections, ignored }
 *
 * `write` takes a `RoleCardDoc` or the draft exactly as GET
 * /api/governance/role-proposals/:id sends it. `read` answers the PUT body.
 *
 * ── THE SHAPE ──────────────────────────────────────────────────────────────
 *
 *   <Village> role card v1
 *   ## Role title
 *   <the role's full title>
 *   Role id: <id>                    written by the village, kept as it is
 *   ### Circle
 *   <the circle it sits in>
 *   ### Purpose                      and every heading in ROLE_CARD_FIELDS
 *   <words>, or one "- " line per item for a list
 *   ## How we'll know it's working   once, after the roles
 *   ## My season
 *   ### My aim this season / My seasonal goals / Village goals it serves
 *   - <title>
 *     Done when: <when it is done>   (How it helps: for a goal served)
 *
 * The headings are the player card's own (`CARD_WORDS`). FORGIVING about how
 * it is written: `#` levels, bold, a colon, words on the heading's own line,
 * case and spacing, code fences, "* " or "1. " for "- ", and prose before the
 * header or under a heading it does not know (listed in `ignored`). STRICT
 * about what it keeps: every limit is the PUT's, read by the same parsers, so
 * a card that reads clean saves clean. Nothing over a limit is cut or dropped:
 * it is kept as written and a problem names the field and the server's own
 * sentence. Payment details are refused everywhere.
 *
 * ── WHAT A CARD CHANGES ────────────────────────────────────────────────────
 *
 * A role is found by its Role id line, else by its title among the village's
 * roles (or the draft's renames); its words are diffed against the role as
 * posted, as the PUT stores them. Any other title is a NEW role, whose Circle
 * is matched by name or alias (`circlesNamed`) and asked about when it
 * matches none or several, never guessed. A heading left out or empty keeps
 * what the draft holds, so a card never clears a word. Given the draft
 * (`ctx.current`), the reader keeps its new roles' ids, review dates, sizes
 * and the roles the card does not mention: `proposalBody` is the whole next
 * draft. The terms are one set for every role, so every "How we'll know it's
 * working" list merges, each measure once, into `settings.scoreboard.measures`
 * over the draft's terms; a measure the draft holds keeps what it counts.
 *
 * NAMES (Rye, 2026-10-22): a member's name in the words is reported, "Name the
 * role, not the person", and swapped for their role where they hold one
 * (shared/roleCardNames.ts).
 *
 * FIELD PATHS (`fieldPath`): every problem names a path into `proposalBody`,
 * like `newRoles.0.words.accountabilities.2`, `roles.1.words.aim`,
 * `newRoles.0.circleId`, `season.seasonalGoals.0.doneWhen`,
 * `settings.scoreboard.measures.3`, or `card`. `sections` maps each role in
 * the card, in order, to its path.
 *
 * Pure: no pool, no clock, no Node builtins.
 */
import { CARD_WORDS } from "./playerCardWords";
import { circlesNamed, type LiveCircle } from "./proposedSeats";
import { applyNameRule, nameRule, type NameRule, type RoleCardPerson } from "./roleCardNames";
import {
  MAX_PROPOSAL_ROLES,
  NEW_ROLE_ID,
  normalWord,
  parseRoleWords,
  PROPOSAL_WORDS,
  ROLE_NAME_MAX,
  WORD_ITEM_MAX,
  type NewRole,
  type ProposalBody,
  type ProposalRole,
  type RoleWords,
  type SeasonWords,
  type WordFieldsContext,
  type WordValue,
} from "./roleProposals";
import { AIM_MAX } from "./seasonPlans";
import { parseSeasonalGoals, parseServesGoals, type SeasonalGoal, type ServedGoal } from "./seasonPlanWords";
import { LIMITS, looksLikePaymentDetails, parseSeatSettings, type ScoreMeasure, type SeatSettings } from "./seatSettings";

export const ROLE_CARD_VERSION = 1;

/** The first line of a card: the village's name, then "role card v1". */
export function roleCardHeader(village?: string | null): string {
  const name = String(village ?? "").replace(/\s+/g, " ").trim();
  return name ? `${name} role card v${ROLE_CARD_VERSION}` : `Role card v${ROLE_CARD_VERSION}`;
}

const HEADER_RE = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(.{0,80}?)\s*\brole\s+card\s+v\.?\s*(\d+)\s*(?:\*\*|__)?\s*$/i;

// ── The headings ────────────────────────────────────────────────────────────

/** A role word the format carries, by the field name the PUT takes. */
export const ROLE_CARD_WORD_FIELDS = [
  "name",
  "aim",
  "existsWhile",
  "domain",
  "authorities",
  "accountabilities",
  "responsibilities",
  "bringMe",
  "notMine",
  "signsStretched",
  "flowsBack",
  "stepBack",
  "timeCommitment",
] as const;
export type RoleCardWordField = (typeof ROLE_CARD_WORD_FIELDS)[number];

type SectionKey = RoleCardWordField | "circle" | "roleId" | "measures" | "season" | "seasonAim" | "seasonalGoals" | "servesGoals";

export interface RoleCardFieldSpec {
  key: SectionKey;
  /** The heading the writer writes: the card's own plain heading. */
  heading: string;
  list: boolean;
  /** Written on one line. */
  oneLine?: boolean;
  /** Other spellings the reader accepts, compared folded (case, spacing and apostrophes aside). */
  aliases: readonly string[];
  /** The limit in plain words, for the prompt. */
  limit: string;
}

/** Every heading, in the order a card is written. */
export const ROLE_CARD_FIELDS: readonly RoleCardFieldSpec[] = [
  { key: "name", heading: "Role title", list: false, oneLine: true, aliases: ["role", "title", "role name", "the role", "role title"], limit: `The role's full title, up to ${ROLE_NAME_MAX} characters.` },
  { key: "roleId", heading: "Role id", list: false, oneLine: true, aliases: ["id"], limit: "Written by the village under a role it already knows. Keep it exactly as it is, and never write one yourself." },
  { key: "circle", heading: "Circle", list: false, oneLine: true, aliases: ["the circle", "circle it sits in", "sits in"], limit: "The circle the role sits in, by the circle's name." },
  { key: "aim", heading: CARD_WORDS.purpose, list: false, aliases: ["role purpose", "the purpose"], limit: "One or two sentences: what the role is for." },
  { key: "existsWhile", heading: CARD_WORDS.existsWhile, list: false, oneLine: true, aliases: ["exists while", "this role exists"], limit: "One line that finishes the sentence: the condition the role serves, and when it should change or fold. Up to 300 characters." },
  { key: "domain", heading: CARD_WORDS.decide, list: false, aliases: ["domain", "what it looks after", "what i look after"], limit: "What the role looks after: its domain, in a few sentences." },
  { key: "authorities", heading: CARD_WORDS.authorities, list: true, aliases: ["authorities", "what i decide on my own", "what it can decide on its own"], limit: "Up to 8 lines, each under 200 characters: decisions the role makes without asking anyone." },
  { key: "accountabilities", heading: CARD_WORDS.countOnMe, list: true, aliases: ["accountabilities", "what you can count on me"], limit: "3 to 6 lines, each under 200 characters: what the role answers for." },
  { key: "responsibilities", heading: CARD_WORDS.responsibilities, list: true, aliases: ["responsibilities", "what i do regularly", "regular work"], limit: "Up to 8 lines, each under 200 characters: what the role does each week or each moon." },
  { key: "bringMe", heading: CARD_WORDS.bringMe, list: true, aliases: [], limit: "Up to 8 lines, each under 160 characters: what people should bring to this role." },
  { key: "notMine", heading: CARD_WORDS.notMine, list: true, aliases: ["not mine"], limit: "Up to 8 lines, each under 160 characters: what this role does not hold, so people take it elsewhere." },
  { key: "signsStretched", heading: CARD_WORDS.signsStretched, list: false, aliases: ["signs i am stretched", "signs im stretched"], limit: "Up to 300 characters: early signs the work has grown too much for whoever holds it." },
  { key: "flowsBack", heading: CARD_WORDS.flowsBack, list: false, aliases: [], limit: "Up to 300 characters: the support and feedback that come back to whoever holds it." },
  { key: "stepBack", heading: CARD_WORDS.stepBack, list: false, aliases: [], limit: "Up to 300 characters: how whoever holds it can slow down or hand work on." },
  { key: "timeCommitment", heading: CARD_WORDS.timeCommitment, list: false, oneLine: true, aliases: ["time commitment", "time it takes"], limit: "A few words on one line, up to 80 characters, like Part of a full-time season." },
  { key: "measures", heading: CARD_WORDS.signs, list: true, aliases: ["how we will know it's working", "how we will know it is working", "how we'll know it is working", "measures"], limit: `2 to 4 lines for each role, each under ${LIMITS.measureChars} characters: signs of the work, never a ranking of people. At most ${LIMITS.scoreMeasures} across all the roles, since one set of terms covers them.` },
  { key: "season", heading: "My season", list: false, aliases: ["your season", "season"], limit: "" },
  { key: "seasonAim", heading: CARD_WORDS.aim, list: false, aliases: ["aim", "my aim", "season aim", "aim for the season", "my aim for the season"], limit: `What will be true at the end of the season because of you, up to ${AIM_MAX} characters.` },
  { key: "seasonalGoals", heading: CARD_WORDS.seasonalGoals(2), list: true, aliases: ["my seasonal goal", "seasonal goals", "seasonal goal"], limit: "1 to 3 bigger goals for the season. Each is a title (up to 120 characters) and a Done when: line (up to 300 characters)." },
  { key: "servesGoals", heading: CARD_WORDS.goals, list: true, aliases: ["village goals it serves", "village goals i serve", "goals i serve", "village goals they serve", "org goals i serve", "goals it serves", "which village goals they serve"], limit: "Only goals from the village's own list for that season, each with a How it helps: line (up to 200 characters)." },
];

const SPEC = new Map<SectionKey, RoleCardFieldSpec>(ROLE_CARD_FIELDS.map((f) => [f.key, f]));
/** The role words, in the order the card writes them, the title first. */
const WORD_SPECS = ROLE_CARD_FIELDS.filter((f): f is RoleCardFieldSpec & { key: RoleCardWordField } => (ROLE_CARD_WORD_FIELDS as readonly string[]).includes(f.key));

/** A heading folded for comparison: case, spacing, curly apostrophes and a trailing colon or ellipsis aside. */
export function foldHeading(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[’‘`]/g, "'")
    .toLowerCase()
    .replace(/[:.…]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIASES = new Map<string, SectionKey>();
for (const f of ROLE_CARD_FIELDS) for (const a of [f.heading, ...f.aliases]) ALIASES.set(foldHeading(a), f.key);
/** "Role 1", "Role 2": a role's heading with no title on it. */
const NUMBERED_ROLE = /^role\s*#?\s*\d{1,2}$/;
const EXISTS_WHILE = foldHeading(CARD_WORDS.existsWhile);
/** The heading's own words at the start of its value, as a person often writes it. */
const EXISTS_WHILE_LEAD = /^this\s+role\s+exists\s+while[\s:.…]*/i;
/** A bare "Aim" is the role's purpose inside a role, and the season's aim under My season. */
const BARE_AIM = foldHeading("aim");

// ── Field paths ─────────────────────────────────────────────────────────────

export type RoleGroup = "roles" | "newRoles";

/**
 * THE PATH SCHEME every problem, change and source uses: a dotted path into
 * `proposalBody`, the shape the PUT takes. One spelling, used by the reader,
 * the import preview and the AI half's sources map.
 */
export const fieldPath = {
  /** The card as a whole. */
  card: "card",
  /** A role in the body: `roles.0`, `newRoles.1`. */
  role: (group: RoleGroup, i: number) => `${group}.${i}`,
  /** One word of a role, or one item of a list word: `newRoles.0.words.accountabilities.2`. */
  word: (group: RoleGroup, i: number, field: RoleCardWordField, item?: number) =>
    item === undefined ? `${group}.${i}.words.${field}` : `${group}.${i}.words.${field}.${item}`,
  /** A new role's circle: `newRoles.0.circleId`. */
  circle: (group: RoleGroup, i: number) => `${group}.${i}.circleId`,
  /** A part of the season: `season.aim`, `season.seasonalGoals.0.doneWhen`, `season.servesGoals.1.howItHelps`. */
  season: (part: "aim" | "seasonalGoals" | "servesGoals", i?: number, key?: "title" | "doneWhen" | "goal" | "howItHelps") =>
    [`season.${part}`, i, key].filter((x) => x !== undefined).join("."),
  /** The measures, or one of them: `settings.scoreboard.measures.3`. */
  measures: (i?: number) => (i === undefined ? "settings.scoreboard.measures" : `settings.scoreboard.measures.${i}`),
} as const;

// ── What the reader is handed and what it answers ───────────────────────────

/** A role the village has, as posted now. */
export interface RoleCardRoleIn {
  id: string;
  name: string;
  circleId: string | null;
  /** The role as the role reader returns it (`rowToRole`), so its words compare as the PUT compares them. */
  posted: Record<string, unknown>;
}

export interface RoleCardContext {
  /** The word fields of this platform's roles (`ROLE_WORD_FIELDS` on the server). */
  words: WordFieldsContext;
  /** The roles a card may name: live and not examples. */
  roles: readonly RoleCardRoleIn[];
  /** The village's live circles. */
  circles: readonly LiveCircle[];
  /** The goals of the season the draft is for, as written. */
  orgGoals: readonly string[];
  /** The village's members, for the name rule. Leave out to skip it. */
  people?: readonly RoleCardPerson[];
  /** The draft as it stands. Given, the reader keeps what the card leaves out. */
  current?: ProposalBody | null;
  /** At most this many roles in one proposal. */
  maxRoles?: number;
}

export type { RoleCardPerson } from "./roleCardNames";

export type RoleCardProblemKind = "format" | "limit" | "refused" | "circle" | "match" | "name" | "missing" | "goal";

export interface RoleCardProblem {
  /** A `fieldPath` into `proposalBody`, or `card`. */
  field: string;
  sentence: string;
  kind: RoleCardProblemKind;
  /** True when the PUT would refuse the value as it stands, so it cannot be kept until it is fixed. */
  blocks: boolean;
}

/** A new role as the card reads it: an id only when the draft already gave it one. */
export type RoleCardNewRole = Omit<NewRole, "id"> & { id?: string };

/** The PUT body a card makes. A group is present only when the card carries it. */
export interface RoleCardBody {
  roles?: ProposalRole[];
  newRoles?: RoleCardNewRole[];
  settings?: SeatSettings;
  season?: Partial<SeasonWords>;
}

export interface RoleCardSection {
  /** The role's place in the card, from 0. */
  index: number;
  title: string | null;
  /** Where it landed in `proposalBody`: `roles.0` or `newRoles.1`. */
  path: string;
}

export interface RoleCardRead {
  /** True when nothing needs a second look. */
  ok: boolean;
  /** True when the text is a role card at all. */
  isCard: boolean;
  version: number | null;
  proposalBody: RoleCardBody;
  problems: RoleCardProblem[];
  sections: RoleCardSection[];
  /** Headings the reader met and does not read, in the card's words. */
  ignored: string[];
}

export const ROLE_CARD_WORDS = {
  notACard: (header: string) => `This is not a role card. A role card starts with the line ${header}.`,
  noHeader: (header: string) => `Start the card with the line ${header}, so it is read as a role card.`,
  wrongVersion: (v: number) => `This card says version ${v}. This village reads version ${ROLE_CARD_VERSION}.`,
  empty: "This card holds no role and no season. Start each role with a Role title heading.",
  noTitle: "Give this role a title under Role title.",
  twice: "This role appears twice in the card. Keep one.",
  unknownId: (id: string) => `No role here has the id ${id}, so the role under it is read by its title.`,
  noCircle: (names: string) => (names ? `Name the circle this new role sits in: ${names}.` : PROPOSAL_WORDS.newRoleCircle),
  unknownCircle: (name: string, names: string) => (names ? `No circle in this village is called "${name}". Pick its circle: ${names}.` : `No circle in this village is called "${name}".`),
  twoCircles: (name: string) => `More than one circle is called "${name}". Pick its circle.`,
  otherCircle: (title: string, circle: string) => `${title} sits in ${circle}. A proposal keeps a role in its circle, so this card does not move it.`,
  payment: PROPOSAL_WORDS.paymentInWords,
  person: "Name the role, not the person.",
  personSwapped: (name: string, role: string) => `Name the role, not the person. This now says "${role}" where it said "${name}".`,
  tooManyMeasures: `Up to ${LIMITS.scoreMeasures} measures across all your roles, since one set of terms covers them.`,
  noSeasonalGoal: "Write at least one seasonal goal, with when it is done.",
  noDoneWhen: "Say when this goal is done, on a Done when: line.",
  noOrgGoals: "The village hasn't set next season's goals yet, so the card cannot say which it serves. Add them once they are set.",
  notAnOrgGoal: (goal: string, goals: string) => `"${goal}" is not one of next season's goals. They are: ${goals}.`,
  ignoredHeading: (h: string) => `Not read: ${h}`,
} as const;

// ── Tokenising ──────────────────────────────────────────────────────────────

interface Heading {
  key: SectionKey | null;
  /** The heading's own words when it is not one the format reads. */
  label: string;
  inline: string;
}

const LIST_MARKER = /^\s*(?:[-*•‣▪–]|\d{1,2}[.)])\s+/;

/** A line as a heading, or null when it is content. */
function headingOf(line: string): Heading | null {
  const raw = line.trim();
  if (!raw) return null;
  const hashed = /^#{1,6}(?:\s|$)/.test(raw);
  let s = raw.replace(/^#{1,6}\s*/, "");
  let label: string;
  let rest = "";
  const bold = /^(\*\*|__)(.+?)\1\s*(.*)$/.exec(s);
  if (bold) {
    label = bold[2];
    rest = bold[3].replace(/^:\s*/, "");
  } else {
    s = s.replace(/^(\*\*|__)/, "").replace(/(\*\*|__)$/, "");
    const colon = s.indexOf(":");
    if (colon > 0 && colon <= 60) {
      label = s.slice(0, colon);
      rest = s.slice(colon + 1);
    } else {
      label = s;
    }
  }
  const folded = foldHeading(label);
  const key = ALIASES.get(folded) ?? (NUMBERED_ROLE.test(folded) ? "name" : null);
  if (key) {
    // A plain line with words after its colon is a heading only for a label it knows.
    return { key, label: label.trim(), inline: rest.trim() };
  }
  // "This role exists while people are still arriving": the heading is the sentence's start.
  const whole = foldHeading(s);
  if (whole.startsWith(`${EXISTS_WHILE} `)) {
    return { key: "existsWhile", label: CARD_WORDS.existsWhile, inline: s.trim().replace(EXISTS_WHILE_LEAD, "") };
  }
  if (hashed || bold) return { key: null, label: (bold ? bold[2] : s).replace(/[:\s]+$/, "").trim(), inline: "" };
  return null;
}

interface RawRole {
  index: number;
  title: string[];
  circle: string[];
  id: string[];
  fields: Map<RoleCardWordField, string[]>;
  /** True once any heading other than the title was read into it. */
  started: boolean;
}

interface RawCard {
  header: boolean;
  version: number | null;
  roles: RawRole[];
  measures: string[][];
  season: { present: boolean; aim: string[] | null; seasonalGoals: string[] | null; servesGoals: string[] | null };
  ignored: string[];
}

type Target = { kind: "role"; role: RawRole; key: RoleCardWordField | "circle" | "roleId" } | { kind: "measures"; lines: string[] } | { kind: "season"; part: "aim" | "seasonalGoals" | "servesGoals" } | { kind: "ignore" };

function tokenise(text: string): RawCard {
  const lines = String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const card: RawCard = { header: false, version: null, roles: [], measures: [], season: { present: false, aim: null, seasonalGoals: null, servesGoals: null }, ignored: [] };
  let start = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = HEADER_RE.exec(lines[i]);
    if (m) {
      card.header = true;
      card.version = Number(m[2]);
      start = i + 1;
      break;
    }
  }
  let target: Target | null = null;
  let inSeason = false;
  const newRole = (): RawRole => {
    const r: RawRole = { index: card.roles.length, title: [], circle: [], id: [], fields: new Map(), started: false };
    card.roles.push(r);
    return r;
  };
  const lastRole = (): RawRole => card.roles[card.roles.length - 1] ?? newRole();
  const push = (line: string) => {
    if (!target || target.kind === "ignore") return;
    if (target.kind === "measures") return void target.lines.push(line);
    if (target.kind === "season") {
      const part = target.part;
      (card.season[part] ??= []).push(line);
      return;
    }
    if (target.key === "name") return void target.role.title.push(line);
    if (target.key === "circle") return void target.role.circle.push(line);
    if (target.key === "roleId") return void target.role.id.push(line);
    const list = target.role.fields.get(target.key) ?? [];
    list.push(line);
    target.role.fields.set(target.key, list);
  };
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) continue;
    if (HEADER_RE.test(line)) continue;
    const h = headingOf(line);
    if (!h) {
      push(line);
      continue;
    }
    if (h.key === null) {
      if (!card.ignored.includes(h.label)) card.ignored.push(h.label);
      target = { kind: "ignore" };
      continue;
    }
    const key: SectionKey = h.key === "seasonAim" && !inSeason && foldHeading(h.label) === BARE_AIM && card.roles.length ? "aim" : h.key;
    switch (key) {
      case "name": {
        // "## Role 1" then "### Role title": one role, not two.
        const last = card.roles[card.roles.length - 1];
        const role = last && !last.started && !last.title.some((l) => l.trim()) ? last : newRole();
        target = { kind: "role", role, key: "name" };
        inSeason = false;
        break;
      }
      case "measures": {
        const lines: string[] = [];
        card.measures.push(lines);
        target = { kind: "measures", lines };
        break;
      }
      case "season":
        card.season.present = true;
        inSeason = true;
        target = { kind: "ignore" };
        break;
      case "seasonAim":
      case "seasonalGoals":
      case "servesGoals": {
        card.season.present = true;
        inSeason = true;
        const part = key === "seasonAim" ? "aim" : key;
        card.season[part] ??= [];
        target = { kind: "season", part };
        break;
      }
      default: {
        const role = lastRole();
        role.started = true;
        target = { kind: "role", role, key };
      }
    }
    if (h.inline) push(h.inline);
  }
  return card;
}

// ── Turning lines into values ───────────────────────────────────────────────

/** Leading and trailing blank lines off, trailing spaces off each line. */
function trimLines(lines: readonly string[]): string[] {
  const out = lines.map((l) => l.replace(/\s+$/, ""));
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

const stripMarker = (s: string) => s.replace(LIST_MARKER, "").replace(/^(\*\*|__)(.*)\1$/, "$2").trim();

/** A text value: lines as written, or joined on one line for a one-line field. Null when empty. */
function textValue(lines: readonly string[], oneLine: boolean): string | null {
  const t = trimLines(lines);
  if (!t.length) return null;
  if (t.length === 1 && LIST_MARKER.test(t[0])) t[0] = stripMarker(t[0]);
  const v = oneLine ? t.map((l) => l.trim()).filter(Boolean).join(" ") : t.join("\n").trim();
  return v || null;
}

/** List items, each the item's first line and any lines that continue it. */
function listItems(lines: readonly string[]): string[][] {
  const t = trimLines(lines).filter((l) => l.trim());
  const marked = t.some((l) => LIST_MARKER.test(l));
  const items: string[][] = [];
  for (const l of t) {
    if (!marked || LIST_MARKER.test(l) || !items.length) items.push([stripMarker(l)]);
    else items[items.length - 1].push(l.trim());
  }
  return items.filter((it) => it[0] || it.length > 1);
}

/** A list word: each item on one line. */
const listValue = (lines: readonly string[]): string[] => listItems(lines).map((it) => it.join(" ").trim()).filter(Boolean);

/** List items where a "- Done when: ..." bullet of its own belongs to the item above it. */
function pairedItems(lines: readonly string[], label: RegExp): string[][] {
  const own = new RegExp(`^\\s*${label.source}\\s*:?`, "i");
  const out: string[][] = [];
  for (const it of listItems(lines)) {
    if (out.length && own.test(it[0])) out[out.length - 1].push(...it);
    else out.push(it);
  }
  return out;
}

/** An item with a labelled second part ("Done when:", "How it helps:"), on its own line or the same one. */
function pairOf(item: readonly string[], label: RegExp): { head: string; tail: string | null } {
  // `–` is the en dash some writers put before "Done when", spelled as an escape so the copy guard reads no dash.
  const inline = new RegExp(`\\s*(?:[.;|,\\u2013-]\\s*)?\\(?\\s*${label.source}\\s*:?\\s*`, "i");
  let head = item[0] ?? "";
  let tail: string | null = null;
  const at = head.search(inline);
  if (at > 0) {
    tail = head.slice(at).replace(inline, "").replace(/\)\s*$/, "").trim();
    head = head.slice(0, at).trim();
  }
  for (const line of item.slice(1)) {
    const own = new RegExp(`^\\s*(?:[-*]\\s*)?${label.source}\\s*:?\\s*`, "i");
    if (own.test(line)) tail = [tail, line.replace(own, "").trim()].filter(Boolean).join(" ");
    else if (tail !== null) tail = `${tail} ${line.trim()}`;
    else head = `${head} ${line.trim()}`;
  }
  return { head: head.trim(), tail: tail ? tail.trim() : null };
}

// ── Reading ─────────────────────────────────────────────────────────────────

const fold = (s: unknown) => String(s ?? "").normalize("NFKC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** True when the text is a role card: the header line, or a titled role with at least two other headings. */
export function isRoleCardText(text: string): boolean {
  const raw = tokenise(text);
  if (raw.header) return true;
  return raw.roles.some((r) => r.title.some((l) => l.trim()) && r.fields.size >= 2);
}

interface ReadState {
  problems: RoleCardProblem[];
  rule: NameRule | null;
}

function problem(st: ReadState, field: string, sentence: string, kind: RoleCardProblemKind, blocks: boolean): void {
  if (!st.problems.some((p) => p.field === field && p.sentence === sentence)) st.problems.push({ field, sentence, kind, blocks });
}

/** Run the name rule over one piece of a card, reporting at its path. */
function named(st: ReadState, text: string, at: string): string {
  const r = applyNameRule(text, st.rule);
  for (const f of r.found) problem(st, at, f.role ? ROLE_CARD_WORDS.personSwapped(f.name, f.role.startsWith("the ") ? f.role : `the ${f.role}`) : ROLE_CARD_WORDS.person, "name", false);
  return r.text;
}

/**
 * One role's word, judged by the PUT's own parser, item by item for a list so
 * a problem names the line. Returns the problems' sentences by path.
 */
function judgeWord(st: ReadState, ctx: RoleCardContext, field: RoleCardWordField, value: WordValue, group: RoleGroup, i: number, posted: Record<string, unknown> | null): void {
  const at = fieldPath.word(group, i, field);
  const list = ctx.words.lists.has(field);
  const kindOf = (sentence: string): RoleCardProblemKind => (/bank or card|https|link/i.test(sentence) ? "refused" : "limit");
  const check = (v: WordValue, path: string, against: Record<string, unknown> | null) => {
    const r = parseRoleWords({ [field]: v }, "w", ctx.words, against);
    if (!r.ok) problem(st, path, r.error, kindOf(r.error), true);
  };
  if (Array.isArray(value)) {
    // Each line alone first, so a problem names its line. The count rules
    // (3 to 6 things a role answers for, at most so many lines) are judged
    // on the whole list, against the posted role as the PUT judges it.
    value.forEach((item, n) => {
      const line = fieldPath.word(group, i, field, n);
      if (field === "accountabilities") {
        // One line alone would trip the 3 to 6 count, so its own two rules are read directly.
        if (looksLikePaymentDetails(item)) problem(st, line, PROPOSAL_WORDS.paymentInWords, "refused", true);
        else if (item.length > WORD_ITEM_MAX) problem(st, line, `Keep each line to ${WORD_ITEM_MAX} characters.`, "limit", true);
      } else {
        check([item], line, null);
      }
    });
    if (!st.problems.some((p) => p.field.startsWith(`${at}.`))) check(value, at, posted ? { [field]: posted[field] ?? null } : null);
  } else if (value !== null) {
    check(list ? [value] : value, at, posted ? { [field]: posted[field] ?? null } : null);
  }
}

/** Every role word a card section gives, read and named. */
function roleWordsOf(st: ReadState, raw: RawRole, group: RoleGroup, i: number): Partial<Record<RoleCardWordField, WordValue>> {
  const out: Partial<Record<RoleCardWordField, WordValue>> = {};
  const title = textValue(raw.title, true);
  if (title) out.name = named(st, stripMarker(title), fieldPath.word(group, i, "name"));
  for (const spec of WORD_SPECS) {
    if (spec.key === "name") continue;
    const lines = raw.fields.get(spec.key);
    if (!lines) continue;
    if (spec.list) {
      const items = listValue(lines).map((item, n) => named(st, item, fieldPath.word(group, i, spec.key, n)));
      if (items.length) out[spec.key] = items;
    } else {
      let v = textValue(lines, !!spec.oneLine);
      if (v && spec.key === "existsWhile") v = v.replace(EXISTS_WHILE_LEAD, "").trim() || null;
      if (v) out[spec.key] = named(st, v, fieldPath.word(group, i, spec.key));
    }
  }
  return out;
}

const circleNames = (ctx: RoleCardContext) => ctx.circles.filter((c) => !c.isExample).map((c) => String(c.name ?? c.id)).join(", ");

/** A circle name read against the village's circles, forgiving "the" and a missing " circle". */
function circleFor(name: string, ctx: RoleCardContext): string[] {
  const tries = [name, name.replace(/^the\s+/i, ""), /\bcircle$/i.test(name) ? name.replace(/\s*circle$/i, "") : `${name} circle`];
  for (const t of tries) {
    const ids = circlesNamed(t, ctx.circles);
    if (ids.length) return ids;
  }
  return [];
}

/** The draft's value for one word of a role it holds, as the card would write it. */
const draftWord = (words: RoleWords | undefined, field: string, list: boolean): WordValue | undefined =>
  words && Object.prototype.hasOwnProperty.call(words, field) ? normalWord(words[field], list) : undefined;

/**
 * READ A CARD INTO THE PUT BODY. PURE.
 *
 * `ok` is true when there is nothing to look at twice. A problem that `blocks`
 * is one the PUT would refuse; the value is still in `proposalBody` exactly as
 * written, so nothing is lost, and a page leaves that field out until it is
 * fixed.
 */
export function readRoleCard(text: string, ctx: RoleCardContext): RoleCardRead {
  const raw = tokenise(text);
  const isCard = isRoleCardText(text);
  const st: ReadState = { problems: [], rule: null };
  const header = roleCardHeader(null);
  const empty: RoleCardRead = { ok: false, isCard, version: raw.version, proposalBody: {}, problems: st.problems, sections: [], ignored: raw.ignored };
  if (!isCard) {
    problem(st, fieldPath.card, ROLE_CARD_WORDS.notACard(header), "format", true);
    return empty;
  }
  if (!raw.header) problem(st, fieldPath.card, ROLE_CARD_WORDS.noHeader(header), "format", false);
  if (raw.version !== null && raw.version !== ROLE_CARD_VERSION) {
    problem(st, fieldPath.card, ROLE_CARD_WORDS.wrongVersion(raw.version), "format", true);
    return empty;
  }
  const roleTitles = new Set([...ctx.roles.map((r) => r.name.toLowerCase()), ...ctx.circles.map((c) => String(c.name ?? "").toLowerCase())]);
  st.rule = nameRule(ctx.people, roleTitles);

  const current = ctx.current ?? null;
  const body: RoleCardBody = {};
  const sections: RoleCardSection[] = [];
  const roles: ProposalRole[] = [];
  const newRoles: RoleCardNewRole[] = [];
  const max = ctx.maxRoles ?? MAX_PROPOSAL_ROLES;
  const byTitle = new Map<string, RoleCardRoleIn[]>();
  for (const r of ctx.roles) byTitle.set(fold(r.name), [...(byTitle.get(fold(r.name)) ?? []), r]);
  const seen = new Set<string>();

  const cardRoles = raw.roles.filter((r) => r.title.some((l) => l.trim()) || r.started);
  for (const rr of cardRoles) {
    const titleText = textValue(rr.title, true);
    const title = titleText ? stripMarker(titleText) : null;
    const circleText = textValue(rr.circle, true);
    const circleName = circleText ? stripMarker(circleText) : null;
    // A Role id line names the role outright: one the village has, or a new role the draft already holds.
    const idText = textValue(rr.id, true);
    const givenId = idText ? stripMarker(idText).replace(/^`+|`+$/g, "").trim() : null;
    const byId = givenId ? ctx.roles.find((r) => r.id === givenId) ?? null : null;
    const draftNewById = givenId && !byId ? current?.newRoles.find((r) => r.id === givenId) ?? null : null;
    // With no draft to check against, a new role's own id is trusted; the PUT refuses one the draft does not hold.
    const keptNewId = givenId && !byId && !draftNewById && !current && NEW_ROLE_ID.test(givenId) ? givenId : null;
    if (givenId && !byId && !draftNewById && !keptNewId) problem(st, fieldPath.card, ROLE_CARD_WORDS.unknownId(givenId), "match", false);
    // Otherwise a role the village has, by its posted title, or by the new title the draft already gives it.
    const renamed = title
      ? (current?.roles ?? []).filter((r) => typeof r.words.name === "string" && fold(r.words.name) === fold(title)).flatMap((r) => ctx.roles.filter((x) => x.id === r.roleId))
      : [];
    const candidates = title ? byTitle.get(fold(title)) ?? renamed : [];
    const circleIds = circleName ? circleFor(circleName, ctx) : [];
    const byTitleMatch = candidates.length === 1 ? candidates[0] : candidates.find((c) => c.circleId && circleIds.includes(c.circleId)) ?? null;
    const existing = byId ?? (draftNewById || keptNewId ? null : byTitleMatch);

    if (existing) {
      const i = roles.length;
      const path = fieldPath.role("roles", i);
      sections.push({ index: rr.index, title, path });
      if (seen.has(`role:${existing.id}`)) problem(st, path, ROLE_CARD_WORDS.twice, "match", true);
      seen.add(`role:${existing.id}`);
      const read = roleWordsOf(st, rr, "roles", i);
      // Found by its posted title, the title is no change; found by the draft's new title, it is that rename.
      if (title && fold(title) === fold(existing.name)) delete read.name;
      const draft = current?.roles.find((r) => r.roleId === existing.id);
      const words: RoleWords = {};
      for (const field of ctx.words.fields) {
        const list = ctx.words.lists.has(field);
        const postedV = normalWord(existing.posted[field], list);
        const fromCard = (read as Record<string, WordValue>)[field];
        const next = fromCard !== undefined ? normalWord(fromCard, list) : draftWord(draft?.words, field, list);
        if (next === undefined || same(next, postedV)) continue;
        words[field] = next;
        if (fromCard !== undefined) judgeWord(st, ctx, field as RoleCardWordField, next, "roles", i, existing.posted);
      }
      if (circleName && existing.circleId && !circleIds.includes(existing.circleId)) {
        const sits = ctx.circles.find((c) => String(c.id) === existing.circleId);
        problem(st, path, ROLE_CARD_WORDS.otherCircle(existing.name, String(sits?.name ?? existing.circleId)), "match", false);
      }
      roles.push({ roleId: existing.id, words, reviewOn: draft?.reviewOn ?? null });
      continue;
    }

    const i = newRoles.length;
    const path = fieldPath.role("newRoles", i);
    sections.push({ index: rr.index, title, path });
    const read = roleWordsOf(st, rr, "newRoles", i);
    if (!title) problem(st, fieldPath.word("newRoles", i, "name"), ROLE_CARD_WORDS.noTitle, "missing", true);
    const key = `new:${fold(read.name ?? title ?? `#${rr.index}`)}`;
    if (title && seen.has(key)) problem(st, path, ROLE_CARD_WORDS.twice, "match", true);
    seen.add(key);
    const draft = draftNewById ?? (title ? current?.newRoles.find((r) => typeof r.words.name === "string" && fold(r.words.name) === fold(title)) : undefined);
    const words: RoleWords = {};
    for (const field of ctx.words.fields) {
      const list = ctx.words.lists.has(field);
      const fromCard = (read as Record<string, WordValue>)[field];
      const next = fromCard !== undefined ? normalWord(fromCard, list) : draftWord(draft?.words, field, list);
      if (next === undefined || next === null) continue;
      words[field] = next;
      if (fromCard !== undefined) judgeWord(st, ctx, field as RoleCardWordField, next, "newRoles", i, null);
    }
    let circleId = "";
    if (circleName) {
      if (circleIds.length === 1) circleId = circleIds[0];
      else if (circleIds.length > 1) problem(st, fieldPath.circle("newRoles", i), ROLE_CARD_WORDS.twoCircles(circleName), "circle", true);
      else problem(st, fieldPath.circle("newRoles", i), ROLE_CARD_WORDS.unknownCircle(circleName, circleNames(ctx)), "circle", true);
    } else if (draft?.circleId) {
      circleId = draft.circleId;
    } else {
      problem(st, fieldPath.circle("newRoles", i), ROLE_CARD_WORDS.noCircle(circleNames(ctx)), "circle", true);
    }
    const keepId = draft?.id ?? keptNewId;
    newRoles.push({ ...(keepId ? { id: keepId } : {}), circleId, seats: draft?.seats ?? 1, words, reviewOn: draft?.reviewOn ?? null });
  }

  if (cardRoles.length) {
    // The draft's roles the card does not mention stay, after the card's own.
    for (const r of current?.roles ?? []) if (!roles.some((x) => x.roleId === r.roleId)) roles.push({ roleId: r.roleId, words: { ...r.words }, reviewOn: r.reviewOn });
    for (const r of current?.newRoles ?? []) if (!newRoles.some((x) => x.id === r.id)) newRoles.push({ id: r.id, circleId: r.circleId, seats: r.seats, words: { ...r.words }, reviewOn: r.reviewOn });
    body.roles = roles;
    body.newRoles = newRoles;
    if (roles.length + newRoles.length > max) problem(st, "roles", PROPOSAL_WORDS.tooManyRoles, "limit", true);
  }

  // ── How we'll know it's working: one list for every role ──
  const measureTexts: string[] = [];
  for (const lines of raw.measures) for (const m of listValue(lines)) if (!measureTexts.some((x) => fold(x) === fold(m))) measureTexts.push(m);
  if (measureTexts.length) {
    const held = current?.settings?.scoreboard?.measures ?? [];
    const measures: ScoreMeasure[] = measureTexts.map((m, n) => {
      const text = named(st, m, fieldPath.measures(n));
      return held.find((h) => fold(h.measure) === fold(text)) ?? { measure: text };
    });
    const settings: SeatSettings = { ...(current?.settings ?? { v: 1 }), scoreboard: { measures } };
    if (measures.length > LIMITS.scoreMeasures) problem(st, fieldPath.measures(), ROLE_CARD_WORDS.tooManyMeasures, "limit", true);
    measures.forEach((m, n) => {
      const r = parseSeatSettings({ v: 1, scoreboard: { measures: [m] } });
      if (!r.ok) problem(st, fieldPath.measures(n), r.problems[0]?.message ?? "This measure cannot be read.", "limit", true);
      else if (looksLikePaymentDetails(m.measure)) problem(st, fieldPath.measures(n), ROLE_CARD_WORDS.payment, "refused", true);
    });
    body.settings = settings;
  }

  // ── My season ──
  const s = raw.season;
  if (s.present) {
    const season: Partial<SeasonWords> = {};
    if (s.aim) {
      const v = textValue(s.aim, false);
      if (v) {
        const aim = named(st, v, fieldPath.season("aim"));
        season.aim = aim;
        if (aim.length > AIM_MAX) problem(st, fieldPath.season("aim"), `Keep your aim to ${AIM_MAX} characters.`, "limit", true);
        if (looksLikePaymentDetails(aim)) problem(st, fieldPath.season("aim"), ROLE_CARD_WORDS.payment, "refused", true);
      }
    }
    if (s.seasonalGoals) {
      const goals: SeasonalGoal[] = pairedItems(s.seasonalGoals, /done when/).map((item, n) => {
        const { head, tail } = pairOf(item, /done when/);
        return {
          title: named(st, head, fieldPath.season("seasonalGoals", n, "title")),
          doneWhen: tail ? named(st, tail, fieldPath.season("seasonalGoals", n, "doneWhen")) : null,
        };
      });
      if (goals.length) {
        season.seasonalGoals = goals;
        const r = parseSeasonalGoals(goals);
        if (!r.ok) problem(st, `season.${r.field}`, r.error, "limit", true);
        goals.forEach((g, n) => {
          const one = parseSeasonalGoals([g]);
          if (!one.ok) problem(st, `season.${one.field.replace(/^seasonalGoals\.0/, `seasonalGoals.${n}`)}`, one.error, "limit", true);
          if (!g.doneWhen) problem(st, fieldPath.season("seasonalGoals", n, "doneWhen"), ROLE_CARD_WORDS.noDoneWhen, "missing", false);
        });
      } else if (!current?.season.seasonalGoals.length) {
        problem(st, fieldPath.season("seasonalGoals"), ROLE_CARD_WORDS.noSeasonalGoal, "missing", false);
      }
    }
    if (s.servesGoals) {
      const served: ServedGoal[] = [];
      const items = pairedItems(s.servesGoals, /how it helps/);
      if (items.length && !ctx.orgGoals.length) problem(st, fieldPath.season("servesGoals"), ROLE_CARD_WORDS.noOrgGoals, "goal", true);
      items.forEach((item, n) => {
        const { head, tail } = pairOf(item, /how it helps/);
        const want = fold(head);
        const exact = ctx.orgGoals.filter((g) => fold(g) === want);
        const near = exact.length ? exact : ctx.orgGoals.filter((g) => want && (fold(g).startsWith(want) || want.startsWith(fold(g))));
        const goal = near.length === 1 ? near[0] : head;
        if (ctx.orgGoals.length && near.length !== 1) problem(st, fieldPath.season("servesGoals", n, "goal"), ROLE_CARD_WORDS.notAnOrgGoal(head, ctx.orgGoals.join("; ")), "goal", true);
        served.push({ goal, howItHelps: tail ? named(st, tail, fieldPath.season("servesGoals", n, "howItHelps")) : null });
      });
      if (served.length) {
        season.servesGoals = served;
        if (ctx.orgGoals.length && !st.problems.some((p) => p.field.startsWith("season.servesGoals"))) {
          const r = parseServesGoals(served, ctx.orgGoals);
          if (!r.ok) problem(st, `season.${r.field}`, r.error, "limit", true);
        }
      }
    }
    if (current) {
      // Whatever the card leaves out keeps what the draft holds.
      if (season.aim === undefined) season.aim = current.season.aim;
      if (season.seasonalGoals === undefined) season.seasonalGoals = current.season.seasonalGoals;
      if (season.servesGoals === undefined) season.servesGoals = current.season.servesGoals;
    }
    if (Object.keys(season).length) body.season = season;
  }

  if (!cardRoles.length && !measureTexts.length && !s.present) problem(st, fieldPath.card, ROLE_CARD_WORDS.empty, "missing", true);
  return { ok: st.problems.length === 0, isCard, version: raw.version, proposalBody: body, problems: st.problems, sections, ignored: raw.ignored };
}

// ── Writing ─────────────────────────────────────────────────────────────────

/** One role as a card writes it. */
export interface RoleCardRole {
  title: string;
  /** A role the village has: its id, written as a Role id line under the title. A new role has none and is found by its title. */
  id?: string | null;
  circle: string | null;
  /** By field name; a list one item per line. `name` is ignored here: the title is `title`. */
  words: Partial<Record<RoleCardWordField, WordValue>>;
}

/** Everything a card holds, in the order it is written. */
export interface RoleCardDoc {
  village?: string | null;
  roles: RoleCardRole[];
  /** How we'll know it's working, one list for every role. */
  measures: string[];
  season: SeasonWords | null;
}

function valueLines(v: WordValue | undefined, list: boolean): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => x.trim()).filter(Boolean).map((x) => `- ${x}`);
  const s = v.trim();
  if (!s) return [];
  if (list) return s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((x) => `- ${x.replace(LIST_MARKER, "")}`);
  return s.split(/\r?\n/).map((x) => x.replace(/\s+$/, ""));
}

/** WRITE A CARD. PURE. `readRoleCard` reads it back to the same body. */
export function writeRoleCard(doc: RoleCardDoc): string {
  const out: string[] = [roleCardHeader(doc.village)];
  for (const r of doc.roles) {
    out.push("", `## ${SPEC.get("name")!.heading}`, r.title.trim());
    if (r.id && r.id.trim()) out.push(`${SPEC.get("roleId")!.heading}: ${r.id.trim()}`);
    if (r.circle && r.circle.trim()) out.push("", `### ${SPEC.get("circle")!.heading}`, r.circle.trim());
    for (const spec of WORD_SPECS) {
      if (spec.key === "name") continue;
      const lines = valueLines(r.words[spec.key], spec.list);
      if (lines.length) out.push("", `### ${spec.heading}`, ...lines);
    }
  }
  const measures = doc.measures.map((m) => m.trim()).filter(Boolean);
  if (measures.length) out.push("", `## ${SPEC.get("measures")!.heading}`, ...measures.map((m) => `- ${m}`));
  const s = doc.season;
  if (s && ((s.aim && s.aim.trim()) || s.seasonalGoals.length || s.servesGoals.length)) {
    out.push("", `## ${SPEC.get("season")!.heading}`);
    if (s.aim && s.aim.trim()) out.push("", `### ${SPEC.get("seasonAim")!.heading}`, ...valueLines(s.aim, false));
    if (s.seasonalGoals.length) {
      out.push("", `### ${SPEC.get("seasonalGoals")!.heading}`);
      for (const g of s.seasonalGoals) out.push(`- ${g.title.trim()}`, ...(g.doneWhen ? [`  Done when: ${g.doneWhen.trim()}`] : []));
    }
    if (s.servesGoals.length) {
      out.push("", `### ${SPEC.get("servesGoals")!.heading}`);
      for (const g of s.servesGoals) out.push(`- ${g.goal.trim()}`, ...(g.howItHelps ? [`  How it helps: ${g.howItHelps.trim()}`] : []));
    }
  }
  return `${out.join("\n")}\n`;
}

// ── The proposal payload, written directly ──────────────────────────────────

/** A role as `GET /api/governance/role-proposals/:id` sends it (`proposalOut`). */
export interface PayloadRole {
  /** An existing role's id. */
  roleId?: string;
  /** A new role's id. */
  id?: string;
  name: string;
  circle: { id: string; name: string } | null;
  fields: ReadonlyArray<{ field: string; proposed: WordValue }>;
}

/** The draft proposal as `GET /api/governance/role-proposals/:id` sends it, as far as a card reads it. */
export interface ProposalPayloadLike {
  roles: readonly PayloadRole[];
  newRoles: readonly PayloadRole[];
  settings?: SeatSettings;
  season?: SeasonWords;
}

const CARD_WORDS_ONLY = ROLE_CARD_WORD_FIELDS.filter((f) => f !== "name");

/** The draft a page holds, or the guide is handed, as a card: every role with its proposed words and its id. PURE. */
export function docFromProposal(p: ProposalPayloadLike, village?: string | null): RoleCardDoc {
  const role = (r: PayloadRole): RoleCardRole => {
    const words: RoleCardRole["words"] = {};
    let title = r.name;
    for (const f of r.fields) {
      if (f.field === "name") {
        if (typeof f.proposed === "string" && f.proposed.trim()) title = f.proposed;
        continue;
      }
      if ((CARD_WORDS_ONLY as readonly string[]).includes(f.field) && f.proposed !== null) words[f.field as RoleCardWordField] = f.proposed;
    }
    // Only a role the village has carries its id: a new role is found again by its title.
    return { title, id: r.roleId ?? null, circle: r.circle?.name ?? null, words };
  };
  const measures = (p.settings?.scoreboard?.measures ?? []).map((m) => m.measure).filter(Boolean);
  return { village: village ?? null, roles: [...p.roles.map(role), ...p.newRoles.map(role)], measures, season: p.season ?? null };
}

const isDoc = (x: RoleCardDoc | ProposalPayloadLike): x is RoleCardDoc => Array.isArray((x as RoleCardDoc).measures);

/**
 * WRITE A CARD from a `RoleCardDoc`, or straight from the draft proposal as
 * `GET /api/governance/role-proposals/:id` sends it. PURE. `opts.village`
 * names the village in the header when the input does not.
 */
export function write(input: RoleCardDoc | ProposalPayloadLike, opts: { village?: string | null } = {}): string {
  const doc = isDoc(input) ? input : docFromProposal(input, opts.village);
  return writeRoleCard(opts.village !== undefined && isDoc(input) && !input.village ? { ...input, village: opts.village } : doc);
}

/** The reader, by the name both halves of the import call it. */
export { readRoleCard as read };
