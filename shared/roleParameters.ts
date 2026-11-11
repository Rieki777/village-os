/**
 * THE PARAMETERS OF A ROLE CARD, and the one reader of them (role journey,
 * PR-B "Edit this role", 9 Nov 2026).
 *
 * A role card is its words (aim, domain, accountabilities and the rest) plus a
 * block of parameters: whether the role is listed, how its door stands, its
 * track, where it is worked, the languages, the budget line, who interviews
 * and for how long, the selection criteria, the access bundle, the booking
 * link and the pay on offer. The editor, the "Bring in a card" import and the
 * card text format all read them through THIS file, so a card that reads clean
 * saves clean, as the word fields already do.
 *
 * ── THE COLUMNS ARRIVE WITH PR-A ───────────────────────────────────────────
 *
 * Most of these live in columns the listing PR adds (one migration, in PR-A).
 * `PARAMETER_COLUMNS` names the column each key writes, and the server writes a
 * key only when the column exists (server/lib/roleParameterColumns.ts). This
 * file adds no column and reads none.
 *
 * Pure: no pool, no clock, no Node builtins.
 */
import { CONVERSATION_MODES, INTERVIEW_MAX_MINUTES, INTERVIEW_MAX_STEPS, INTERVIEW_MIN_MINUTES, type ConversationMode } from "./interviewerRoles";
import { looksLikePaymentDetails, PAY_KINDS, parseSeatSettings, type PaySettings } from "./seatSettings";
import { TRACKS, TRACK_WORDS, readTrack, type Track } from "./roleTracks";
import { HELD_BY, readHeldBy, type HeldBy } from "./agentHolders";

/** Every parameter key, in the order the editor and the card text show them. */
export const PARAMETER_KEYS = [
  "listed",
  "recruiting",
  "alwaysChecked",
  "heldBy",
  "track",
  "whereWorked",
  "languages",
  "villageGoals",
  "budgetLine",
  "fundedFrom",
  "reviewAfterDays",
  "selectionCriteria",
  "conversations",
  "conversationMode",
  "accessBundle",
  "bookingUrl",
] as const;
export type ParameterKey = (typeof PARAMETER_KEYS)[number];

/** The `org_roles` column each key writes. `recruiting` is the door and has always been there. */
export const PARAMETER_COLUMNS: Record<ParameterKey, string> = {
  listed: "listed",
  recruiting: "recruiting",
  alwaysChecked: "always_checked",
  heldBy: "held_by",
  track: "track",
  whereWorked: "where_worked",
  languages: "languages",
  villageGoals: "village_goals",
  budgetLine: "budget_line",
  fundedFrom: "funded_from",
  reviewAfterDays: "review_after_days",
  selectionCriteria: "selection_criteria",
  conversations: "conversations",
  conversationMode: "conversation_mode",
  accessBundle: "access_bundle",
  bookingUrl: "booking_url",
};

/** Keys whose column is stored as JSON text. */
export const JSON_PARAMETERS: ReadonlySet<ParameterKey> = new Set<ParameterKey>(["languages", "villageGoals", "selectionCriteria", "conversations", "accessBundle"]);

// One list for the editor and the card (shared/roleTracks.ts, guide v2).
export { TRACKS, TRACK_WORDS } from "./roleTracks";
export type { Track } from "./roleTracks";

export { CONVERSATION_MODES, type ConversationMode };

export const WHERE_WORKED = ["land", "remote", "both"] as const;
export type WhereWorked = (typeof WHERE_WORKED)[number];

export const LIMITS_PARAMETERS = {
  languages: 6,
  languageChars: 40,
  villageGoals: 5,
  goalChars: 200,
  criteriaMin: 3,
  criteriaMax: 5,
  criterionChars: 200,
  interviewersMax: INTERVIEW_MAX_STEPS,
  minutesMin: INTERVIEW_MIN_MINUTES,
  minutesMax: INTERVIEW_MAX_MINUTES,
  bundleItems: 12,
  bundleChars: 160,
  budgetLineChars: 120,
  reviewDaysMax: 3650,
  urlChars: 300,
} as const;

/** One person-seat in the interview sequence: a role, for some minutes, perhaps with the final say. */
export interface Interviewer {
  roleId: string;
  minutes: number;
  final: boolean;
}

/** The parameters of one role, as the editor holds them. A key left out is a key left alone. */
export type ParameterValues = {
  listed?: boolean;
  recruiting?: boolean;
  /** A background check happens for this role whatever the references say (0370). */
  alwaysChecked?: boolean;
  /** Who may hold it: a person, an agent or either (0374, shared/agentHolders.ts). Null: the card has not said, which reads as either. */
  heldBy?: HeldBy | null;
  track?: Track | null;
  whereWorked?: WhereWorked | null;
  languages?: string[];
  villageGoals?: string[];
  budgetLine?: string | null;
  fundedFrom?: string | null;
  reviewAfterDays?: number | null;
  selectionCriteria?: string[];
  conversations?: Interviewer[];
  conversationMode?: ConversationMode | null;
  accessBundle?: string[];
  bookingUrl?: string | null;
};

export type Read<T> = { ok: true; value: T } | { ok: false; problem: string };
const ok = <T>(value: T): Read<T> => ({ ok: true, value });
const no = (problem: string): Read<never> => ({ ok: false, problem });

/** The words the editor and the reader use when a parameter is refused. */
export const PARAMETER_WORDS = {
  notAList: (what: string) => `${what} is a list of lines.`,
  tooMany: (what: string, max: number) => `${what}: at most ${max} lines.`,
  tooLong: (what: string, max: number) => `${what}: keep each line to ${max} characters.`,
  payment: "Keep bank, card and account numbers out of a role card.",
  track: `Track is one of: ${TRACKS.join(", ")}.`,
  heldBy: `Who can hold it is one of: ${HELD_BY.join(", ")}.`,
  where: `Where it is worked is one of: ${WHERE_WORKED.join(", ")}.`,
  date: "Write the date as year-month-day, like 2027-01-15.",
  days: "Write whole days, like 90.",
  url: "The booking link is a web address that starts with https://.",
  criteria: `Selection criteria: ${LIMITS_PARAMETERS.criteriaMin} to ${LIMITS_PARAMETERS.criteriaMax} lines.`,
  interviewMinutes: `Each interview is ${LIMITS_PARAMETERS.minutesMin} to ${LIMITS_PARAMETERS.minutesMax} minutes.`,
  interviewersTooMany: `At most ${LIMITS_PARAMETERS.interviewersMax} interviewers.`,
  oneFinal: "Only one interviewer can give the final approval.",
  interviewRole: "Each interviewer is a role the village has.",
  twice: "A role is named once in the interview order.",
  unlistedHint: "A role must pass its card gate before it is listed.",
} as const;

function lines(raw: unknown, what: string, max: number, chars: number): Read<string[]> {
  if (raw === null || raw === undefined) return ok([]);
  const list = typeof raw === "string" ? raw.split(/\r?\n/) : Array.isArray(raw) ? raw : null;
  if (!list) return no(PARAMETER_WORDS.notAList(what));
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") return no(PARAMETER_WORDS.notAList(what));
    const t = item.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, "").trim();
    if (!t) continue;
    if (t.length > chars) return no(PARAMETER_WORDS.tooLong(what, chars));
    if (looksLikePaymentDetails(t)) return no(PARAMETER_WORDS.payment);
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > max) return no(PARAMETER_WORDS.tooMany(what, max));
  return ok(out);
}

/** The interviewers, in order: a list of `{ roleId, minutes, final }`. */
export function readInterviewers(raw: unknown, isRole: (id: string) => boolean): Read<Interviewer[]> {
  if (raw === null || raw === undefined) return ok([]);
  if (!Array.isArray(raw)) return no(PARAMETER_WORDS.notAList("Interviewers"));
  if (raw.length > LIMITS_PARAMETERS.interviewersMax) return no(PARAMETER_WORDS.interviewersTooMany);
  const out: Interviewer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return no(PARAMETER_WORDS.interviewRole);
    const o = item as Record<string, unknown>;
    const roleId = typeof o.roleId === "string" ? o.roleId.trim() : "";
    if (!roleId || !isRole(roleId)) return no(PARAMETER_WORDS.interviewRole);
    if (out.some((x) => x.roleId === roleId)) return no(PARAMETER_WORDS.twice);
    const minutes = typeof o.minutes === "number" ? o.minutes : typeof o.minutes === "string" && /^\d{1,3}$/.test(o.minutes.trim()) ? Number(o.minutes) : NaN;
    if (!Number.isInteger(minutes) || minutes < LIMITS_PARAMETERS.minutesMin || minutes > LIMITS_PARAMETERS.minutesMax) return no(PARAMETER_WORDS.interviewMinutes);
    const final = o.final === true || o.final === "true";
    out.push({ roleId, minutes, final });
  }
  if (out.filter((x) => x.final).length > 1) return no(PARAMETER_WORDS.oneFinal);
  return ok(out);
}

/** The whole time the interviews take, in minutes. */
export const interviewMinutesTotal = (list: readonly Interviewer[]): number => list.reduce((n, x) => n + x.minutes, 0);

/**
 * ONE PARAMETER, JUDGED. `isRole` answers whether an id is a role the village
 * has (the interviewers need it). Blank clears a text parameter and an empty
 * list clears a list one: a card never clears a word by leaving it out, but the
 * editor can, by writing nothing in a field it shows.
 */
export function readParameter(key: ParameterKey, raw: unknown, isRole: (id: string) => boolean = () => true): Read<ParameterValues[ParameterKey]> {
  switch (key) {
    case "listed":
    case "alwaysChecked":
    case "recruiting": {
      if (typeof raw === "boolean") return ok(raw);
      if (raw === 0 || raw === 1) return ok(raw === 1);
      if (typeof raw === "string" && /^(true|false|yes|no|open|closed|listed|unlisted)$/i.test(raw.trim())) return ok(/^(true|yes|open|listed)$/i.test(raw.trim()));
      return no(key === "listed" ? "Listed is yes or no." : key === "alwaysChecked" ? "Always background-checked is yes or no." : "The door is open or closed.");
    }
    case "heldBy": {
      if (raw === null || raw === undefined || raw === "") return ok(null);
      // The card text writes the words ("A person or an agent"); the editor sends the key.
      const said = String(raw).trim().toLowerCase().replace(/[.]$/, "");
      const hit = readHeldBy(said) ?? (/^(a )?person or (an )?agent$/.test(said) ? "either" : /^an? (person|agent)$/.test(said) ? readHeldBy(said.replace(/^an? /, "")) : null);
      return hit ? ok(hit) : no(PARAMETER_WORDS.heldBy);
    }
    case "track": {
      if (raw === null || raw === undefined || raw === "") return ok(null);
      const hit = readTrack(raw);
      return hit ? ok(hit) : no(PARAMETER_WORDS.track);
    }
    case "whereWorked": {
      if (raw === null || raw === undefined || raw === "") return ok(null);
      const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      return (WHERE_WORKED as readonly string[]).includes(v) ? ok(v as WhereWorked) : no(PARAMETER_WORDS.where);
    }
    case "languages":
      return lines(raw, "Languages", LIMITS_PARAMETERS.languages, LIMITS_PARAMETERS.languageChars);
    case "villageGoals":
      return lines(raw, "Village goals it serves", LIMITS_PARAMETERS.villageGoals, LIMITS_PARAMETERS.goalChars);
    case "accessBundle":
      return lines(raw, "Access bundle", LIMITS_PARAMETERS.bundleItems, LIMITS_PARAMETERS.bundleChars);
    case "selectionCriteria": {
      const r = lines(raw, "Selection criteria", LIMITS_PARAMETERS.criteriaMax, LIMITS_PARAMETERS.criterionChars);
      if (!r.ok) return r;
      // Written as 3 to 5 lines, or none. A role below the count is "being written", never refused to save.
      if (r.value.length && r.value.length < LIMITS_PARAMETERS.criteriaMin) return no(PARAMETER_WORDS.criteria);
      return r;
    }
    case "budgetLine": {
      if (raw === null || raw === undefined) return ok(null);
      if (typeof raw !== "string") return no("The budget line is text.");
      const t = raw.trim();
      if (t.length > LIMITS_PARAMETERS.budgetLineChars) return no(PARAMETER_WORDS.tooLong("Budget line", LIMITS_PARAMETERS.budgetLineChars));
      if (looksLikePaymentDetails(t)) return no(PARAMETER_WORDS.payment);
      return ok(t || null);
    }
    case "fundedFrom": {
      if (raw === null || raw === undefined || raw === "") return ok(null);
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return no(PARAMETER_WORDS.date);
      const d = new Date(`${raw.trim()}T00:00:00Z`);
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw.trim() ? no(PARAMETER_WORDS.date) : ok(raw.trim());
    }
    case "reviewAfterDays": {
      if (raw === null || raw === undefined || raw === "") return ok(null);
      const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,4}$/.test(raw.trim()) ? Number(raw) : NaN;
      return Number.isInteger(n) && n >= 1 && n <= LIMITS_PARAMETERS.reviewDaysMax ? ok(n) : no(PARAMETER_WORDS.days);
    }
    case "bookingUrl": {
      if (raw === null || raw === undefined || raw === "") return ok(null);
      if (typeof raw !== "string") return no(PARAMETER_WORDS.url);
      const t = raw.trim();
      if (t.length > LIMITS_PARAMETERS.urlChars || !/^https:\/\/[^\s/$.?#][^\s]*$/i.test(t)) return no(PARAMETER_WORDS.url);
      try {
        new URL(t);
      } catch {
        return no(PARAMETER_WORDS.url);
      }
      return ok(t);
    }
    case "conversationMode": {
      if (raw === null || raw === undefined || raw === "") return ok(null);
      const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      return (CONVERSATION_MODES as readonly string[]).includes(v) ? ok(v as ConversationMode) : no("Conversations are held as a block or separately.");
    }
    case "conversations":
      return readInterviewers(raw, isRole);
  }
}

// ── The pay group on offer, and Sera's range ────────────────────────────────

/** What the service sent about a role's pay (`readSourcePay`), as far as a suggestion needs it. */
export interface SourcePayLike {
  model: string | null;
  standing: "settled" | "pending" | "agreed-not-paying" | "other" | null;
  statusLabel: string | null;
  terms: string | null;
  monthlyUsd: number | null;
  /** The range the source holds (shared/sourcePayRange.ts), in whole units of its currency. */
  range?: { min: number; max: number; currency: string; per: string; status: string | null } | null;
}

/**
 * THE PAY GROUP SERA'S FIGURES SUGGEST, for a person to read, change and save.
 * Nothing here writes: the editor shows it, and only the person's save puts a
 * group on offer. A target becomes a range of one figure either side of it,
 * a month at a time, in dollars (the unit the service uses); "deferred" or
 * "proposed" says "funding-dependent" in the note. Null when Sera sent nothing
 * to go on. A volunteer model suggests no money.
 */
export function suggestPayGroup(src: SourcePayLike | null, currency = "USD"): PaySettings | null {
  if (!src) return null;
  const model = (src.model ?? "").toLowerCase();
  const fundingDependent = src.standing === "pending" || src.standing === "agreed-not-paying";
  const note = fundingDependent ? "Funding-dependent" : undefined;
  if (/volunteer|unpaid|honorary/.test(model)) return { kind: "honorary", ...(note ? { note } : {}) };
  // A range the source states outright wins over a single target. Only a monthly or per-moon range fits a pay group; another period is shown, never converted.
  if (src.range && (src.range.per === "month" || src.range.per === "moon")) {
    return { kind: "range", currency: src.range.currency, minMinor: Math.round(src.range.min * 100), maxMinor: Math.round(src.range.max * 100), per: src.range.per, ...(note ? { note } : {}) };
  }
  if (src.monthlyUsd !== null && src.monthlyUsd > 0) {
    const minor = Math.round(src.monthlyUsd * 100);
    return { kind: "range", currency, minMinor: minor, maxMinor: minor, per: "month", ...(note ? { note } : {}) };
  }
  if (src.standing === "agreed-not-paying") return { kind: "deferred", currency, per: "month", note: "Funding-dependent" };
  return null;
}

/** A pay group the person typed or accepted, judged by the terms' own parser. */
export function readPayGroup(raw: unknown): Read<PaySettings | null> {
  if (raw === null || raw === undefined) return ok(null);
  if (typeof raw !== "object" || Array.isArray(raw)) return no("The pay on offer could not be read.");
  const o = raw as Record<string, unknown>;
  if (!(PAY_KINDS as readonly string[]).includes(String(o.kind))) return no("Pick the kind of pay on offer.");
  const parsed = parseSeatSettings({ v: 1, pay: o });
  if (!parsed.ok || !parsed.settings) return no(parsed.problems[0]?.message ?? "The pay on offer could not be read.");
  return ok(parsed.settings.pay ?? null);
}

// ── The card text: headings, and the pay and interview lines ────────────────

/** A parameter's place in the "Amora role card v1" text: the heading, whether it is a list, and the spellings read. */
export interface ParameterCardSpec {
  key: ParameterKey | "pay";
  heading: string;
  list: boolean;
  oneLine: boolean;
  aliases: readonly string[];
  limit: string;
}

/** Every parameter heading, in the order a card writes them. */
export const PARAMETER_CARD_FIELDS: readonly ParameterCardSpec[] = [
  { key: "listed", heading: "Listed", list: false, oneLine: true, aliases: ["is it listed"], limit: "Yes or no: whether visitors and members find this role." },
  { key: "alwaysChecked", heading: "Always background-checked", list: false, oneLine: true, aliases: ["background check"], limit: "Yes or no: whether a check happens for this role whatever the references say." },
  { key: "heldBy", heading: "Who can hold it", list: false, oneLine: true, aliases: ["held by"], limit: "Person, agent or either: whether a person, an agent or either may hold this role." },
  { key: "recruiting", heading: "Door", list: false, oneLine: true, aliases: ["door state"], limit: "Open or closed: whether the role is looking for someone." },
  { key: "track", heading: "Track", list: false, oneLine: true, aliases: [], limit: `One of: ${TRACKS.map((t) => TRACK_WORDS[t]).join(", ")}.` },
  { key: "whereWorked", heading: "Where it is worked", list: false, oneLine: true, aliases: ["where the work happens"], limit: "Land, remote or both." },
  { key: "languages", heading: "Languages", list: true, oneLine: false, aliases: [], limit: `Up to ${LIMITS_PARAMETERS.languages} lines.` },
  { key: "villageGoals", heading: "Village goals this role serves", list: true, oneLine: false, aliases: ["role village goals"], limit: `Up to ${LIMITS_PARAMETERS.villageGoals} lines, from the season's goals.` },
  { key: "budgetLine", heading: "Budget line", list: false, oneLine: true, aliases: [], limit: `Up to ${LIMITS_PARAMETERS.budgetLineChars} characters.` },
  { key: "fundedFrom", heading: "Funded from", list: false, oneLine: true, aliases: [], limit: "A date, like 2027-01-15." },
  { key: "reviewAfterDays", heading: "Review after (days)", list: false, oneLine: true, aliases: ["review after"], limit: "Whole days, like 90." },
  { key: "selectionCriteria", heading: "Selection criteria", list: true, oneLine: false, aliases: [], limit: `${LIMITS_PARAMETERS.criteriaMin} to ${LIMITS_PARAMETERS.criteriaMax} lines.` },
  { key: "conversations", heading: "Interviewers", list: true, oneLine: false, aliases: ["interview order"], limit: `In order, one per line: Role title | minutes | final approval (optional). Up to ${LIMITS_PARAMETERS.interviewersMax}.` },
  { key: "conversationMode", heading: "Conversations held", list: false, oneLine: true, aliases: ["conversation mode"], limit: "Block (one sitting, back to back) or separate (one at a time, on different days)." },
  { key: "accessBundle", heading: "Access bundle", list: true, oneLine: false, aliases: [], limit: `Up to ${LIMITS_PARAMETERS.bundleItems} lines: the tools and places the role is given.` },
  { key: "bookingUrl", heading: "Booking link", list: false, oneLine: true, aliases: [], limit: "A web address that starts with https://." },
  { key: "pay", heading: "Pay on offer", list: true, oneLine: false, aliases: ["pay"], limit: "One line, like Range 1000 to 1500 USD per month, or Fixed 1200 USD per month, Honorary, In kind, Deferred, None. A Note: line may follow." },
];

const KIND_WORDS: Record<string, PaySettings["kind"]> = {
  none: "none",
  fixed: "fixed",
  range: "range",
  honorary: "honorary",
  "in kind": "in-kind",
  "in-kind": "in-kind",
  deferred: "deferred",
};

const wholeUnits = (s: string): number | null => {
  const t = s.replace(/,/g, "");
  return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
};

/** The pay lines of a card, read into a pay group, or the sentence why not. */
export function payFromLines(rawLines: readonly string[]): Read<PaySettings | null> {
  const lines = rawLines.map((l) => l.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, "").trim()).filter(Boolean);
  if (!lines.length) return ok(null);
  let note: string | undefined;
  let head = lines[0];
  for (const l of lines.slice(1)) {
    const m = /^note\s*:\s*(.+)$/i.exec(l);
    if (m) note = m[1].trim();
    else return no("Write the pay on one line, and a Note: line if it needs one.");
  }
  const inline = /(?:^|[.;,]\s*)note\s*:\s*(.+)$/i.exec(head);
  if (inline) {
    note = inline[1].trim();
    head = head.slice(0, inline.index).trim();
  }
  const m = /^(none|fixed|range|honorary|in[ -]kind|deferred)\b\s*(.*)$/i.exec(head);
  if (!m) return no("Start the pay line with None, Fixed, Range, Honorary, In kind or Deferred.");
  const kind = KIND_WORDS[m[1].toLowerCase().replace(/\s+/, " ")];
  const rest = m[2].replace(/[.]$/, "").trim();
  const out: Record<string, unknown> = { kind };
  if (note) out.note = note;
  if (rest) {
    const money = /^([\d,]+(?:\.\d{1,2})?)(?:\s*(?:to|-|and)\s*([\d,]+(?:\.\d{1,2})?))?\s*([A-Za-z]{3})?\s*(?:per|a|each)?\s*(month|moon)?$/i.exec(rest);
    if (!money) return no("Write the amount like 1000 to 1500 USD per month.");
    const lo = wholeUnits(money[1]);
    const hi = money[2] ? wholeUnits(money[2]) : null;
    if (lo === null || (money[2] && hi === null)) return no("Write the amount in whole units, like 1000 or 1000.50.");
    if (kind === "range") {
      out.minMinor = lo;
      out.maxMinor = hi ?? lo;
    } else out.amountMinor = lo;
    if (money[3]) out.currency = money[3].toUpperCase();
    if (money[4]) out.per = money[4].toLowerCase();
  }
  return readPayGroup(out);
}

/** A pay group as the card writes it: one line, and a Note: line. */
export function payToLines(pay: PaySettings | null | undefined): string[] {
  if (!pay) return [];
  const units = (n: number) => (n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2));
  const kindWord = pay.kind === "in-kind" ? "In kind" : pay.kind.charAt(0).toUpperCase() + pay.kind.slice(1);
  const bits: string[] = [kindWord];
  if (pay.kind === "range" && pay.minMinor !== undefined && pay.maxMinor !== undefined) bits.push(`${units(pay.minMinor)} to ${units(pay.maxMinor)}`);
  else if (pay.amountMinor !== undefined) bits.push(units(pay.amountMinor));
  if (pay.currency) bits.push(pay.currency);
  if (pay.per) bits.push(`per ${pay.per}`);
  return [bits.join(" "), ...(pay.note ? [`Note: ${pay.note}`] : [])];
}

/** An interview line, "Role title | 20 minutes | final approval", into its parts. */
export function interviewerFromLine(line: string): { title: string; minutes: number | null; final: boolean } | null {
  const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const minutes = parts.slice(1).map((p) => /^(\d{1,3})\s*(?:min|minutes?)?$/i.exec(p)).find(Boolean);
  const final = parts.slice(1).some((p) => /^final(?:\s+approval)?$/i.test(p));
  return { title: parts[0], minutes: minutes ? Number(minutes[1]) : null, final };
}

/** The interview lines a card writes, in order. */
export function interviewerToLines(list: readonly Interviewer[], titleOf: (roleId: string) => string): string[] {
  return list.map((x) => [titleOf(x.roleId), `${x.minutes} minutes`, ...(x.final ? ["final approval"] : [])].join(" | "));
}
