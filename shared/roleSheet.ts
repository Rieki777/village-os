/**
 * THE ROLE CARD'S VIEW MODEL: every word and every number a seat card prints.
 *
 * Pure, and node-tested. A host page reads its own payload, normalises it with
 * `shared/roleSheetInputs.ts`, and hands the result here; the card component
 * (`SeatTradingCard`) then draws exactly what comes back and decides nothing.
 * The rules a card has broken before live here, where a test can hold them:
 *
 *   1. A VALUE THAT WAS NOT READ IS ABSENT, NEVER 0. `Read<T>` keeps the two
 *      apart: `undefined` is "this payload does not carry the field" and `null`
 *      is "read, and empty". An unread commitment draws no chip and is left out
 *      of the tally, so deploy skew can never read as a village that has not
 *      written something down.
 *   2. EVERY NUMBER NAMES THE FIELD IT CAME FROM (`source`), so a test can
 *      trace it, and a read 0 prints 0 in plain ink: gold and green mean
 *      "above zero" and nothing else.
 *   3. THE STATE WORDS AND THE FIGURES COME FROM THEIR OWN FIELDS. A state set
 *      by hand can say "Held" over a seat with nobody in it, and both are true;
 *      the state line is the one place the two meet, and it says which is which.
 *   4. NOTHING HERE PRINTS PAY, TENURE, HOURS, RANK, AVERAGES OR A SCOREBOARD,
 *      and criticality is a chip, never a number (R55).
 *
 * `daysUntil` and `termWords` moved here from the power map, so the card and
 * the map read one clock and one set of words about a term reaching its date.
 * `client/src/components/power/types.ts` re-exports `daysUntil` and
 * `SeatStateWord` from here, so nothing that imported them there changed.
 *
 * Two neighbours: the copy deck (`./roleSheetWords`, re-exported below) and
 * the permission face (`./permissionSheet`), which draws a role from
 * `/api/roles` with this file's roster. They are separate files so this one
 * keeps room under the 1000-line gate for the card that reads it.
 */
import { ARCHETYPE_KEYS } from "./archetypes";
import { cssColourForCircle } from "./circleView";
import { decidesByById, howChosenById } from "./power";
import { COMMITMENT_LABELS, COMMITMENT_PHRASES, SHEET_WORDS, moreOpenLine, type CommitmentKey } from "./roleSheetWords";

// The copy deck lives in its own file and is read from here, so a host imports
// every word the card prints from one place.
export * from "./roleSheetWords";

// ── The five states, and their one set of words ─────────────────────────────

export const SEAT_STATES = ["open", "partial", "filled", "forming", "expired"] as const;
export type SeatStateWord = (typeof SEAT_STATES)[number];

/**
 * The words for a seat's state, keyed by the union so a sixth state cannot
 * render an empty badge. "Ready to be re-chosen" is the succession model's
 * word for a term that reached its date: nothing was taken from anyone.
 */
export const STATE_WORDS: Record<SeatStateWord, string> = {
  open: "Open",
  partial: "Partly held",
  filled: "Held",
  forming: "Forming",
  expired: "Ready to be re-chosen",
};

export function isSeatState(v: unknown): v is SeatStateWord {
  return typeof v === "string" && (SEAT_STATES as readonly string[]).includes(v);
}

// ── Inputs ──────────────────────────────────────────────────────────────────

/** undefined = this payload does not carry the field (unread). null = read, and empty. */
export type Read<T> = T | undefined;

/** One holder row, exactly as the payload served it. */
export interface SeatHolderIn {
  name: string | null;
  userId?: string | null;
  kind?: "member" | "documented";
  isAgent?: boolean;
  focus?: string | null;
  lapsed?: boolean;
  avatar?: string | null;
  termEndsAt?: string | null;
}

/**
 * Which doors this host opens. The map opens both. `/roles` and `/circles`
 * offer a raised hand while the map module is on for the viewer (the route
 * lives under `/api/map` and is gated by that module) and never offer the
 * contact relay. A proposal opens neither.
 */
export interface SeatOffers {
  raiseHand: boolean;
  contact: boolean;
}

export interface SeatInput {
  mode: "seat" | "proposal";
  id: string;
  name: string;
  isExample: boolean;
  circle: { id: string; name: string; decidesBy: string | null; color: string | null } | null;
  /** A proposal that names a circle not yet placed. */
  circleNameOnly: string | null;
  aim: string | null;
  domain: string | null;
  accountabilities: string[];
  whyItMatters: string | null;
  seats: number;
  /** null on a proposal. */
  holderCount: number | null;
  state: SeatStateWord | null;
  stateSource: Read<"declared" | "derived">;
  criticality: Read<"normal" | "high">;
  recruiting: Read<boolean>;
  representsCircle: Read<boolean>;
  howChosen: Read<string | null>;
  howChosenGloss: Read<string | null>;
  termEnds: Read<string | null>;
  archetypes: Read<string[]>;
  villageDecidesBy: Read<string | null>;
  /** Exactly as served; never fetched wider. */
  holders: SeatHolderIn[];
  /** This tier carried holder rows at all. */
  namesServed: boolean;
  signedIn: boolean;
  offers: SeatOffers;
}

export interface SheetContext {
  now: Date;
  /** null = unread. */
  season: { name: string | null; endsOn: string | null; daysLeft: number | null } | null;
  /** The village's own class names from /api/archetypes; null = unread. */
  classNames: Record<string, string> | null;
}

// ── The clock and the words about a term ────────────────────────────────────

/** Days until an ISO date, floored; negative when it has passed. */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now.getTime()) / 86400000);
}

/**
 * WHAT A TERM'S DATE SAYS ONCE IT HAS PASSED.
 *
 * Two words used to live on the power map: one that put a term in the past
 * tense as a thing that had failed, and one that called the person holding
 * the seat late. They were the only public deficit language in the whole
 * succession model, they sat on a shared surface with a named person
 * attached, and they described something the code does not do. `isLapsed`
 * revokes nothing and writes nothing, by design, and its own note in
 * `server/lib/orgChart.ts` says so: a lapsed holding is still a holding.
 *
 * A term reaching its date is the village's own agreement asking to be made
 * again. The seat has not slipped and its holder has taken nothing away from
 * anyone. The date arrived, which is what dates do.
 *
 * `seatLapse.test.ts` and `succession.copy.test.ts` hold the words to this.
 */
export function termWords(iso: string | null | undefined): string | null {
  const d = daysUntil(iso);
  if (d === null) return null;
  if (d < 0) return "ready to be re-chosen";
  if (d === 0) return "term ends today";
  if (d <= 30) return `term ends in ${d} day${d === 1 ? "" : "s"}`;
  return `term ends ${new Date(iso!).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * "21 Mar 2027", or "21 Mar" without the year. Null for anything unreadable.
 *
 * A civil date ("2027-03-21", how a season's end is stored) is printed as the
 * day it names: parsed as an instant it would be UTC midnight and read a day
 * early anywhere west of Greenwich. An instant (a term's end, resolved in the
 * village's zone when the seat was made) is read in the reader's own zone,
 * which is where the member reading it lives.
 */
export function formatDay(iso: string | null | undefined, withYear = true): string | null {
  const s = String(iso ?? "").trim();
  if (!s) return null;
  const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let y: number;
  let m: number;
  let d: number;
  if (civil) {
    y = Number(civil[1]);
    m = Number(civil[2]) - 1;
    d = Number(civil[3]);
    if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  } else {
    const t = new Date(s);
    if (Number.isNaN(t.getTime())) return null;
    y = t.getFullYear();
    m = t.getMonth();
    d = t.getDate();
  }
  return withYear ? `${d} ${MONTHS[m]} ${y}` : `${d} ${MONTHS[m]}`;
}

/** "a", "a and b", "a, b and c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ── The portrait ────────────────────────────────────────────────────────────

/** 32-bit FNV-1a over UTF-16 code units. Stable across every browser and Node. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const PRESENTATIONS = ["f", "m"] as const;
const TONES = ["olive", "deep", "light"] as const;

export type Portrait =
  | { kind: "class"; src: string; alt: string; key: string }
  | { kind: "sigil"; letter: string };

/**
 * THE ART IS STOCK ART FOR A SUGGESTED CLASS, NEVER THE HOLDER.
 *
 * The first class tag picks the art, and the seat's own id picks which of the
 * six drawings of that class, so the map and /roles show the same picture for
 * the same seat. With no tag, an unknown key, or (in the component) a file
 * that will not load, the seat draws its sigil: the first letter of its name.
 * The alt names the class only once the village's own word for it is read.
 */
export function portraitFor(
  seat: { id: string; name: string },
  archetypes: Read<string[]>,
  classNames: Record<string, string> | null = null,
): Portrait {
  const key = archetypes?.[0];
  if (key && ARCHETYPE_KEYS.includes(key)) {
    const h = fnv1a(seat.id);
    const presentation = PRESENTATIONS[h & 1];
    const tone = TONES[(h >>> 1) % 3];
    const className = classNames && Object.prototype.hasOwnProperty.call(classNames, key) ? classNames[key] : null;
    return {
      kind: "class",
      key,
      src: `/images/avatars/${key}-${presentation}-${tone}.webp`,
      alt: className
        ? `Stock art for ${className}, a class suggested for this seat`
        : "Stock art for a class suggested for this seat",
    };
  }
  return { kind: "sigil", letter: (Array.from(seat.name.trim())[0] ?? "").toUpperCase() };
}

/** lg up to 22 characters, md up to 36, sm past that. The live longest is 53. */
export function nameScaleFor(name: string): "lg" | "md" | "sm" {
  const n = Array.from(name).length;
  return n <= 22 ? "lg" : n <= 36 ? "md" : "sm";
}

// ── The view ────────────────────────────────────────────────────────────────

export type FigureKey = "places" | "heldNow" | "seated" | "open" | "answersFor" | "termDays" | "seasonDays" | "powers";

export interface SheetFigure {
  key: FigureKey;
  label: string;
  value: number;
  /** Gold and living green mean "above zero". A read 0 is plain. */
  tone: "gold" | "living" | null;
  /** The input field this number is read from, so a test can trace it. */
  source: string;
  /** Printed in the wide figure row only. */
  wideOnly?: boolean;
}

export type SheetClock = SheetFigure & { sub: string };

export type SpotKind = "person" | "agent" | "nameless" | "open" | "forming";

export interface Spot {
  key: string;
  kind: SpotKind;
  /** A seating whose term reached its date: a dashed disc and a gold sub. */
  ready: boolean;
  title: string;
  sub: string | null;
  /** The sub is a date, so it does not wrap. */
  subIsDate: boolean;
  /** As served, people only. An agent never carries one. */
  avatar: string | null;
  /** The person filter's key (userId, else name). People only. */
  pickKey: string | null;
}

export type ActionKind = "raise" | "signIn" | "contact" | "unreachable" | "none";

export interface SeatActionView {
  kind: ActionKind;
  seatName: string;
  /** The button's words, and the back footer shortcut's. Null when there is no button. */
  label: string | null;
  ariaLabel: string | null;
  consequence: string | null;
  contactName?: string;
  contactUserId?: string;
}

export type CommitmentLook = "gilded" | "edged" | "dashed";

export interface Commitment {
  key: CommitmentKey;
  label: string;
  look: CommitmentLook;
  suffix?: string;
  srWords: string;
}

export interface Fact {
  label: string;
  value: string;
  sub: string | null;
  /** A date sets in the body face; words set in the display face. */
  isDate: boolean;
}

export type Pip = "lit" | "edged" | "empty";

export interface SeatSheetView {
  id: string;
  name: string;
  nameScale: "lg" | "md" | "sm";
  isExample: boolean;
  mode: "seat" | "proposal";
  eyebrow: string | null;
  /** cssColourForCircle, for the accent dot only. */
  circleColour: string | null;
  /** `held` is what the badge's SeatGlyph draws. */
  badge: { word: SeatStateWord | "proposed"; label: string; held: number } | null;
  chips: {
    keySeat: boolean;
    recruiting: boolean;
    speaksFor: string | null;
    suits: { key: string; name: string } | null;
  };
  portrait: Portrait;
  aim: string | null;
  figures: SheetFigure[];
  clock: SheetClock | null;
  stateLine: string | null;
  spots: Spot[];
  moreOpen: number;
  moreOpenLine: string | null;
  rosterNote: string | null;
  action: SeatActionView;
  commitments: Commitment[];
  tally: { written: number; of: number };
  stillToWrite: string | null;
  unreadLine: string | null;
  sections: { aim: string | null; domain: string | null; accountabilities: string[]; why: string | null };
  facts: { term: Fact | null; nextHolder: Fact | null; wayOfDeciding: Fact | null };
  flip: { title: string; sub: string; pips: Pip[] };
}

// ── Commitments: seven, in a fixed order, one look each ─────────────────────

const COMMITMENT_ORDER: CommitmentKey[] = ["aim", "domain", "accountabilities", "why", "term", "nextHolder", "decides"];

const SR_WRITTEN = ", written down";
const SR_VILLAGES = ", the village's way";
const SR_AT_SEATING = ", set when someone is seated";
const SR_UNWRITTEN = ", still to be written down";

/** A commitment's look, or "unread" when the payload does not carry it. */
function commitmentLook(key: CommitmentKey, input: SeatInput): CommitmentLook | "unread" {
  const has = (v: string | null) => !!v && v.trim() !== "";
  switch (key) {
    case "aim":
      return has(input.aim) ? "gilded" : "dashed";
    case "domain":
      return has(input.domain) ? "gilded" : "dashed";
    case "accountabilities":
      return input.accountabilities.length > 0 ? "gilded" : "dashed";
    case "why":
      return has(input.whyItMatters) ? "gilded" : "dashed";
    case "term":
      // Derived from seatings, so a seat nobody holds can never light it.
      // Asking anyone to write it down would ask for something no form takes.
      if (input.termEnds === undefined) return "unread";
      if (has(input.termEnds)) return "gilded";
      return input.holderCount === 0 ? "edged" : "dashed";
    case "nextHolder":
      if (input.howChosen === undefined) return "unread";
      return has(input.howChosen) ? "gilded" : "dashed";
    case "decides":
      // A way of deciding the village holds belongs to the village. Counting
      // it as the seat's would overstate every seat that inherits it by one.
      if (has(input.circle?.decidesBy ?? null)) return "gilded";
      if (input.villageDecidesBy === undefined) return "unread";
      return has(input.villageDecidesBy) ? "edged" : "dashed";
  }
}

function commitmentsFor(input: SeatInput): Commitment[] {
  const out: Commitment[] = [];
  for (const key of COMMITMENT_ORDER) {
    const look = commitmentLook(key, input);
    if (look === "unread") continue;
    const label = COMMITMENT_LABELS[key];
    if (look === "gilded") out.push({ key, label, look, srWords: SR_WRITTEN });
    else if (look === "dashed") out.push({ key, label, look, srWords: SR_UNWRITTEN });
    else if (key === "term") out.push({ key, label, look, suffix: "set at seating", srWords: SR_AT_SEATING });
    else out.push({ key, label, look, suffix: "the village's", srWords: SR_VILLAGES });
  }
  return out;
}

const FOUR: CommitmentKey[] = ["aim", "domain", "accountabilities", "why"];

/**
 * WHAT THIS SEAT HAS NOT SAID YET, SAID OUT LOUD, from the dashed chips only.
 *
 * A fork starts with none of its seats written, and blank reads as broken. So
 * the box names what is missing, once, and says who writes it. Silent on a
 * seat with nothing dashed, which is a village that has done the work.
 */
export function stillToWriteLine(commitments: Commitment[]): string | null {
  const dashed = commitments.filter((c) => c.look === "dashed").map((c) => c.key);
  if (!dashed.length) return null;
  const close = ` ${SHEET_WORDS.foundingTeamWrites}`;
  if (FOUR.every((k) => dashed.includes(k))) {
    const rest = dashed.filter((k) => !FOUR.includes(k)).map((k) => COMMITMENT_PHRASES[k]);
    const also = rest.length ? ` Also still to be written down: ${joinList(rest)}.` : "";
    return `${SHEET_WORDS.nobodyWroteThisSeat}${also}${close}`;
  }
  return `Still to be written down: ${joinList(dashed.map((k) => COMMITMENT_PHRASES[k]))}.${close}`;
}

// ── The seat face ───────────────────────────────────────────────────────────

/**
 * Whether every holder row arrived with its lapse flag, which is what makes
 * "Held now" sayable. `holderCount` counts lapsed seatings too, so without the
 * flags the honest figure is "Seated".
 */
function lapseReading(input: SeatInput): { read: boolean; lapsed: number } {
  const hc = input.holderCount;
  const read =
    hc !== null && input.holders.length === hc && input.holders.every((h) => typeof h.lapsed === "boolean");
  return { read, lapsed: read ? input.holders.filter((h) => h.lapsed).length : 0 };
}

function clockFor(input: SeatInput, ctx: SheetContext): SheetClock | null {
  if (input.mode === "proposal") return null;
  // The member rows' own terms when served (the earliest one still ahead),
  // else the seat's earliest term. A term already past is never a clock: it
  // would print a negative number, and the Term fact says it instead.
  const rowTerms = input.holders
    .map((h) => h.termEndsAt)
    .filter((t): t is string => typeof t === "string" && t.trim() !== "");
  let term: { iso: string; source: string } | null = null;
  if (rowTerms.length) {
    const ahead = rowTerms
      .filter((t) => (daysUntil(t, ctx.now) ?? -1) >= 0)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    if (ahead.length) term = { iso: ahead[0], source: "holders[].termEndsAt" };
  } else if (typeof input.termEnds === "string" && (daysUntil(input.termEnds, ctx.now) ?? -1) >= 0) {
    term = { iso: input.termEnds, source: "termEnds" };
  }
  if (term) {
    const date = formatDay(term.iso);
    const days = daysUntil(term.iso, ctx.now);
    if (date && days !== null) {
      return { key: "termDays", label: "Days left in term", value: days, tone: null, source: term.source, sub: `Term ends ${date}` };
    }
  }
  const s = ctx.season;
  if (s && typeof s.daysLeft === "number" && Number.isFinite(s.daysLeft) && s.daysLeft >= 0) {
    const date = formatDay(s.endsOn);
    if (date) {
      const name = s.name && s.name.trim() ? s.name.trim() : null;
      return {
        key: "seasonDays",
        label: "Days left in the season",
        value: s.daysLeft,
        tone: null,
        source: "season.daysLeft",
        sub: name ? `${name} ends ${date}` : `The season ends ${date}`,
      };
    }
  }
  return null;
}

function figuresFor(input: SeatInput, lapse: { read: boolean; lapsed: number }): SheetFigure[] {
  const out: SheetFigure[] = [{ key: "places", label: "Places", value: input.seats, tone: null, source: "seats" }];
  const hc = input.holderCount;
  if (input.mode === "seat" && hc !== null) {
    if (lapse.read) {
      const now = hc - lapse.lapsed;
      out.push({ key: "heldNow", label: "Held now", value: now, tone: now > 0 ? "gold" : null, source: "holderCount - holders[].lapsed" });
    } else {
      out.push({ key: "seated", label: "Seated", value: hc, tone: hc > 0 ? "gold" : null, source: "holderCount" });
    }
    const open = Math.max(0, input.seats - hc);
    out.push({
      key: "open",
      label: "Open places",
      value: open,
      // A forming place is not an open call, so it never reads as one.
      tone: open > 0 && input.state !== "forming" ? "living" : null,
      source: "seats - holderCount",
    });
  }
  if (input.accountabilities.length > 0) {
    out.push({
      key: "answersFor",
      label: "Answers for",
      value: input.accountabilities.length,
      tone: null,
      source: "accountabilities.length",
      wideOnly: true,
    });
  }
  return out;
}

/**
 * THE LINE UNDER THE FIGURES, where the badge and the numbers meet.
 *
 * The first rule that matches wins. The re-chosen claims from the state
 * itself need a derived state: a state set by hand says so and claims nothing
 * about anyone's term. They fire wherever the payload does not carry each
 * holder's lapse flag, which is a stranger with no names and also a public
 * tier that serves first names and nothing else.
 */
function stateLineFor(input: SeatInput, lapse: { read: boolean; lapsed: number }): string | null {
  if (input.mode === "proposal") return null;
  const hc = input.holderCount ?? 0;
  if (lapse.read && hc > 0 && lapse.lapsed > 0) {
    if (lapse.lapsed === hc) return SHEET_WORDS.everyoneReady;
    return `${lapse.lapsed} of ${hc} seated ${lapse.lapsed === 1 ? "is" : "are"} ready to be re-chosen.`;
  }
  if (input.stateSource === "declared") return SHEET_WORDS.setByHand;
  if (input.stateSource === "derived" && !lapse.read) {
    if (input.state === "expired") return SHEET_WORDS.everyoneReady;
    if (input.state === "partial" && Math.max(0, input.seats - hc) === 0) return SHEET_WORDS.atLeastOneReady;
  }
  return null;
}

function personSub(h: SeatHolderIn, now: Date): { sub: string | null; isDate: boolean } {
  if (h.lapsed) return { sub: SHEET_WORDS.readyToBeRechosen, isDate: false };
  const focus = h.focus && h.focus.trim() ? h.focus.trim() : null;
  if (focus) return { sub: focus, isDate: false };
  const d = daysUntil(h.termEndsAt ?? null, now);
  const day = formatDay(h.termEndsAt ?? null, false);
  if (d !== null && d >= 0 && day) return { sub: `term ends ${day}`, isDate: true };
  return { sub: null, isDate: false };
}

/**
 * One spot per place: the holders as served (current first, then those ready
 * to be re-chosen), a nameless "Seated" for each seating this tier counts but
 * does not name, then the open places, three at most. An agent is "An agent"
 * and never its served name, which is a vendor's product name.
 */
export function rosterFor(
  holders: SeatHolderIn[],
  holderCount: number,
  seats: number,
  opts: { now: Date; forming: boolean; openSub: (holderCount: number) => string },
): { spots: Spot[]; moreOpen: number } {
  const spots: Spot[] = [];
  const ordered = [...holders.filter((h) => !h.lapsed), ...holders.filter((h) => h.lapsed)];
  ordered.forEach((h, i) => {
    const ready = !!h.lapsed;
    const base = { key: `holder-${i}`, ready, avatar: null, pickKey: null, subIsDate: false };
    if (h.isAgent) {
      spots.push({ ...base, kind: "agent", title: SHEET_WORDS.agent, sub: ready ? SHEET_WORDS.readyToBeRechosen : null });
      return;
    }
    const name = h.name && h.name.trim() ? h.name.trim() : null;
    if (!name) {
      spots.push({ ...base, kind: "nameless", title: SHEET_WORDS.seated, sub: ready ? SHEET_WORDS.readyToBeRechosen : null });
      return;
    }
    const { sub, isDate } = personSub(h, opts.now);
    spots.push({
      ...base,
      kind: "person",
      title: name,
      sub,
      subIsDate: isDate,
      avatar: h.avatar ?? null,
      pickKey: h.userId ?? name,
    });
  });
  for (let i = 0; i < Math.max(0, holderCount - holders.length); i++) {
    spots.push({ key: `nameless-${i}`, kind: "nameless", ready: false, title: SHEET_WORDS.seated, sub: null, subIsDate: false, avatar: null, pickKey: null });
  }
  const open = Math.max(0, seats - holderCount);
  const shown = Math.min(3, open);
  for (let i = 0; i < shown; i++) {
    spots.push(
      opts.forming
        ? { key: `open-${i}`, kind: "forming", ready: false, title: SHEET_WORDS.formingPlace, sub: null, subIsDate: false, avatar: null, pickKey: null }
        : { key: `open-${i}`, kind: "open", ready: false, title: SHEET_WORDS.openPlace, sub: opts.openSub(holderCount), subIsDate: false, avatar: null, pickKey: null },
    );
  }
  return { spots, moreOpen: open - shown };
}

/**
 * The one action a seat offers, first match wins.
 *
 * `invite` covers a place ready to be re-chosen and a seat recruiting while
 * full, because the raise-hand route does not check vacancy: a seat that says
 * "Recruiting" and offers no way in is a door drawn on a wall.
 */
function actionFor(input: SeatInput): SeatActionView {
  const none: SeatActionView = { kind: "none", seatName: input.name, label: null, ariaLabel: null, consequence: null };
  if (input.isExample || input.mode === "proposal") return none;
  const hc = input.holderCount ?? 0;
  const open = Math.max(0, input.seats - hc);
  const invite =
    (open > 0 && input.state !== "forming") ||
    input.state === "partial" ||
    input.state === "expired" ||
    input.recruiting === true;
  if (invite && input.offers.raiseHand) {
    return input.signedIn
      ? {
          kind: "raise",
          seatName: input.name,
          label: SHEET_WORDS.raise,
          ariaLabel: `Raise your hand for ${input.name}`,
          consequence: SHEET_WORDS.raiseConsequence,
        }
      : { kind: "signIn", seatName: input.name, label: SHEET_WORDS.signInToRaise, ariaLabel: null, consequence: null };
  }
  if (input.offers.contact && input.namesServed) {
    // An agent is seated as a documented holder, so `kind` already excludes it.
    const c = input.holders.find((h) => h.kind !== "documented" && !!h.userId);
    if (c && c.userId) {
      const name = c.name ?? "";
      return {
        kind: "contact",
        seatName: input.name,
        label: `Contact ${name}`,
        ariaLabel: null,
        consequence: null,
        contactName: name,
        contactUserId: c.userId,
      };
    }
    if (input.holders.length > 0) return { ...none, kind: "unreachable" };
  }
  return none;
}

function factsFor(input: SeatInput, now: Date): SeatSheetView["facts"] {
  let term: Fact | null = null;
  if (typeof input.termEnds === "string" && input.termEnds.trim()) {
    const date = formatDay(input.termEnds);
    const d = daysUntil(input.termEnds, now);
    if (date && d !== null) {
      term =
        d >= 0
          ? { label: "Term", value: `Ends ${date}`, sub: SHEET_WORDS.termFutureSub, isDate: true }
          : { label: "Term", value: `Reached its date on ${date}`, sub: SHEET_WORDS.termPastSub, isDate: true };
    }
  } else if (input.termEnds === null && input.holderCount === 0) {
    term = { label: "Term", value: SHEET_WORDS.termAtSeating, sub: SHEET_WORDS.termAtSeatingSub, isDate: false };
  }

  let nextHolder: Fact | null = null;
  if (typeof input.howChosen === "string" && input.howChosen.trim()) {
    const def = howChosenById(input.howChosen);
    const gloss = input.howChosenGloss && input.howChosenGloss.trim() ? input.howChosenGloss.trim() : null;
    const value = input.howChosen === "other" ? (gloss ?? def?.label ?? null) : (def?.label ?? null);
    if (value) nextHolder = { label: "Next holder", value, sub: null, isDate: false };
  }

  let wayOfDeciding: Fact | null = null;
  if (input.circle && input.circle.decidesBy && input.circle.decidesBy.trim()) {
    // The circle's own way, even when this page cannot name it: falling back
    // to the village's here would say the circle has none of its own.
    const own = decidesByById(input.circle.decidesBy);
    if (own) wayOfDeciding = { label: "Way of deciding", value: own.label, sub: `${input.circle.name}'s own way.`, isDate: false };
  } else if (input.villageDecidesBy) {
    const village = decidesByById(input.villageDecidesBy);
    if (village) {
      wayOfDeciding = {
        label: "Way of deciding",
        value: village.label,
        sub: input.circle
          ? `${SHEET_WORDS.villagesWay} ${input.circle.name} has not set one of its own.`
          : SHEET_WORDS.villagesWay,
        isDate: false,
      };
    }
  }
  return { term, nextHolder, wayOfDeciding };
}

export const textOrNull = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/**
 * What the badge's SeatGlyph draws as held. An open seat draws its empty ring
 * whatever a hand-set state sits over; every other state draws the held-now
 * count where the lapse flags were served, else the seated count.
 */
function badgeHeld(state: SeatStateWord, hc: number | null, lapse: { read: boolean; lapsed: number }): number {
  if (state === "open") return 0;
  const seated = hc ?? 0;
  return lapse.read ? seated - lapse.lapsed : seated;
}

export function seatSheet(input: SeatInput, ctx: SheetContext): SeatSheetView {
  const proposal = input.mode === "proposal";
  const lapse = lapseReading(input);
  const hc = input.holderCount;

  const suitsKey = input.archetypes?.[0];
  const suitsName =
    suitsKey && ARCHETYPE_KEYS.includes(suitsKey) && ctx.classNames && Object.prototype.hasOwnProperty.call(ctx.classNames, suitsKey)
      ? textOrNull(ctx.classNames[suitsKey])
      : null;

  const roster =
    proposal || hc === null
      ? { spots: [] as Spot[], moreOpen: 0 }
      : rosterFor(input.holders, hc, input.seats, {
          now: ctx.now,
          forming: input.state === "forming",
          openSub: (n) => (n === 0 ? SHEET_WORDS.nobodyHoldsThis : SHEET_WORDS.waitingForAHand),
        });

  const action = actionFor(input);
  let rosterNote: string | null = null;
  if (!proposal && hc !== null) {
    if (!input.namesServed && hc > 0) rosterNote = input.signedIn ? SHEET_WORDS.namesNotShared : SHEET_WORDS.signInToSeeNames;
    else if (action.kind === "unreachable") rosterNote = SHEET_WORDS.unreachable;
  }

  const commitments = commitmentsFor(input);
  const written = commitments.filter((c) => c.look === "gilded").length;
  const of = commitments.length;
  const unread = proposal ? [] : COMMITMENT_ORDER.filter((k) => !commitments.some((c) => c.key === k));
  const describesWork = !!textOrNull(input.domain) || input.accountabilities.length > 0;

  return {
    id: input.id,
    name: input.name,
    nameScale: nameScaleFor(input.name),
    isExample: input.isExample,
    mode: input.mode,
    eyebrow: input.circle ? input.circle.name : proposal ? textOrNull(input.circleNameOnly) : null,
    circleColour: input.circle ? cssColourForCircle({ id: input.circle.id, color: input.circle.color }) : null,
    badge: proposal
      ? { word: "proposed", label: SHEET_WORDS.proposed, held: 0 }
      : input.state
        ? { word: input.state, label: STATE_WORDS[input.state], held: badgeHeld(input.state, hc, lapse) }
        : null,
    chips: {
      keySeat: input.criticality === "high",
      recruiting: input.recruiting === true,
      speaksFor: input.representsCircle === true && input.circle ? input.circle.name : null,
      suits: suitsKey && suitsName ? { key: suitsKey, name: suitsName } : null,
    },
    portrait: portraitFor({ id: input.id, name: input.name }, input.archetypes, ctx.classNames),
    aim: textOrNull(input.aim),
    figures: figuresFor(input, lapse),
    clock: clockFor(input, ctx),
    stateLine: stateLineFor(input, lapse),
    spots: roster.spots,
    moreOpen: roster.moreOpen,
    moreOpenLine: roster.moreOpen > 0 ? moreOpenLine(roster.moreOpen) : null,
    rosterNote,
    action,
    commitments,
    tally: { written, of },
    stillToWrite: stillToWriteLine(commitments),
    unreadLine: unread.length ? `This page does not carry ${joinList(unread.map((k) => COMMITMENT_PHRASES[k]))}.` : null,
    sections: {
      aim: textOrNull(input.aim),
      domain: textOrNull(input.domain),
      accountabilities: input.accountabilities.map((a) => a.trim()).filter(Boolean),
      why: textOrNull(input.whyItMatters),
    },
    facts: factsFor(input, ctx.now),
    flip: {
      title: SHEET_WORDS.flipTitle,
      sub: describesWork
        ? `What it decides on and answers for. ${written} of ${of} written down.`
        : `Its commitments. ${written} of ${of} written down.`,
      pips: commitments.map((c) => (c.look === "gilded" ? "lit" : c.look === "edged" ? "edged" : "empty")),
    },
  };
}
