/**
 * A SEAT'S SETTINGS: the terms for whoever holds it, as one checked object.
 *
 * The seat card says what a seat is for. This says what holding it means:
 * how long, on which clocks, which standing gatherings, what is recorded
 * about money, how many quests a moon, which measures of the work, and how it
 * ends. One object, nine optional groups, in the order the season card reads
 * them. A group that is absent is NOT SET, and every reader says "Not set",
 * never 0: an empty pay group and a pay group of nothing are different facts.
 *
 * WHO READS THIS FILE. The editor (client), the drawer under the live card
 * (client) and, from PR4 on, the routes that store applications (server). One
 * parser, `parseSeatSettings`, serves all three, so the editor's red line and
 * the route's refusal are the same sentence.
 *
 * MONEY IS A RECORD, NEVER A MOVEMENT. Pay, allowance and bonus are words and
 * whole numbers somebody wrote down. Nothing reads them to post, pay, promote
 * or release value, and an import-boundary test
 * (`shared/seatSettings.boundary.test.ts`) holds every ledger, economy,
 * settlement, `role.cycle` and Contributor-promotion module away from this
 * file. Every money row the drawer draws carries `MONEY_LINE`.
 *
 * NO PAYMENT DETAILS (economics ruling 23). Every free-text field refuses a
 * run of eight or more digits and anything shaped like an IBAN. A routing
 * number is nine digits, so the digit rule covers it. These terms are read by
 * every member, and a bank number in them would be published to all of them.
 *
 * THE EQUITY BONUS IS WORDS (decision 1, defaulted here): `capWords`, never a
 * numeric cap. A number would reopen the ruling against numeric capital
 * columns. Changing that later is one field in BonusSettings and its parser.
 *
 * NOT THE TERM IN THE END-DATE SENSE. `shared/seatTerms.ts`, the
 * `role_holder_terms` rows and `SeatInput.termEnds` are the seat's own end
 * date and are untouched by this file. The `term` group below is what an
 * application asks for; resolving it against the season cap happens where
 * the seating is written, through `resolveSeatTerm`.
 *
 * Pure: no Node builtins at import time. `settingsHash` reaches for Web
 * Crypto when it is called, which Node 22 and every browser provide, and it is
 * meant for the server alone.
 */
import { canonicalJson } from "./canonicalJson";

export const SEAT_SETTINGS_VERSION = 1 as const;

/** The groups, in the order the season card reads them. */
export const SETTINGS_GROUPS = [
  "term",
  "clocks",
  "rhythm",
  "pay",
  "allowance",
  "bonus",
  "quests",
  "scoreboard",
  "ending",
] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

export const GROUP_LABELS: Record<SettingsGroup, string> = {
  term: "Term",
  clocks: "Clocks",
  rhythm: "Rhythm",
  pay: "Pay",
  allowance: "Allowance",
  bonus: "Bonus",
  quests: "Quests",
  scoreboard: "Scoreboard",
  ending: "Ending",
};

/** The groups that record money. Each one's row carries MONEY_LINE. */
export const MONEY_GROUPS: readonly SettingsGroup[] = ["pay", "allowance", "bonus"];

export const MONEY_LINE = "Recorded here. Paid outside the platform.";
export const NOT_SET = "Not set";

// ── The shape ────────────────────────────────────────────────────────────────

export interface TermSettings {
  /** YYYY-MM-DD, or null for the season's end. */
  endsOn?: string | null;
  /** A length counted from the day of seating, when no date is written. */
  lengthMoons?: number;
  noticeDays?: number;
  reviewOn?: string;
  renewalOn?: string;
}

export const PAY_CLOCKS = ["calendar-month", "moon"] as const;
export const WORK_CLOCKS = ["moon", "week"] as const;
export interface ClockSettings {
  pay?: (typeof PAY_CLOCKS)[number];
  work?: (typeof WORK_CLOCKS)[number];
}

export const GATHERING_EVERY = ["week", "fortnight"] as const;
export interface Gathering {
  label: string;
  /** 0 is Sunday, 6 is Saturday. */
  weekday: number;
  /** HH:MM, on the rhythm's clock. */
  time: string;
  every?: (typeof GATHERING_EVERY)[number];
}
export interface RhythmSettings {
  gatherings?: Gathering[];
  quietDays?: number[];
  /** An IANA zone. Absent means the season's own zone. */
  tz?: string;
}

export const PAY_KINDS = ["none", "fixed", "range", "honorary", "in-kind", "deferred"] as const;
export type PayKind = (typeof PAY_KINDS)[number];
export const MONEY_PER = ["month", "moon"] as const;
export interface PaySettings {
  kind: PayKind;
  /** ISO 4217. An unknown code is flagged and kept as written. */
  currency?: string;
  /** Whole minor units. */
  amountMinor?: number;
  minMinor?: number;
  maxMinor?: number;
  per?: (typeof MONEY_PER)[number];
  note?: string;
}

export const ALLOWANCE_KINDS = ["none", "flat", "reimbursed"] as const;
export interface AllowanceSettings {
  kind: (typeof ALLOWANCE_KINDS)[number];
  currency?: string;
  amountMinor?: number;
  per?: (typeof MONEY_PER)[number];
  note?: string;
}

export const BONUS_KINDS = ["none", "equity"] as const;
export interface BonusSettings {
  kind: (typeof BONUS_KINDS)[number];
  /** The cap, in words. Never a number (decision 1). */
  capWords?: string;
  ratedBy?: string;
  cadence?: string;
}

export interface QuestSettings {
  perMoonMin?: number;
  perMoonMax?: number;
  agreedHow?: string;
  /** Every quest carries a done when. Always true; it is not a setting. */
  doneWhenRequired: true;
}

export interface ScoreMeasure {
  measure: string;
  readFrom?: string;
  target?: string;
}
export interface ScoreboardSettings {
  measures: ScoreMeasure[];
}

export interface EndingSettings {
  noticeDays?: number;
  payThroughNotice?: boolean;
}

export interface PresetProvenance {
  group: SettingsGroup;
  presetId: string;
  presetVersion: number;
}

export interface SeatSettings {
  v: typeof SEAT_SETTINGS_VERSION;
  term?: TermSettings;
  clocks?: ClockSettings;
  rhythm?: RhythmSettings;
  pay?: PaySettings;
  allowance?: AllowanceSettings;
  bonus?: BonusSettings;
  quests?: QuestSettings;
  scoreboard?: ScoreboardSettings;
  ending?: EndingSettings;
  /** Which preset each group started from. Provenance only: values win. */
  presets?: PresetProvenance[];
}

export const emptySettings = (): SeatSettings => ({ v: SEAT_SETTINGS_VERSION });

// ── Limits ───────────────────────────────────────────────────────────────────

export const LIMITS = {
  gatherings: 6,
  scoreMeasures: 8,
  noteChars: 300,
  wordsChars: 200,
  labelChars: 60,
  measureChars: 120,
  noticeDays: 365,
  lengthMoons: 13,
  questsPerMoon: 12,
  /** Whole minor units. A ceiling far above any stipend, to refuse typos. */
  amountMinor: 1_000_000_000_000,
} as const;

// ── The parser ───────────────────────────────────────────────────────────────

export interface SettingsProblem {
  /** Dotted path to the field, `pay.amountMinor`, or the group alone. */
  path: string;
  message: string;
}

export interface ParsedSettings {
  ok: boolean;
  /** The clean object when ok, else null. */
  settings: SeatSettings | null;
  /** Refusals. Any one of them makes `ok` false. */
  problems: SettingsProblem[];
  /** Kept as written and said out loud: an unknown currency code. */
  flags: SettingsProblem[];
}

/**
 * Keys that are never terms of a seat, refused with a reason wherever they
 * appear. They are the old role application's fields and the ideas behind
 * them: a seat's terms never scale a member's voice, and a commitment
 * percentage scaled both pay and voice.
 */
const REFUSED_KEYS: Record<string, string> = {
  voice: "Voice is never a term of a seat. Every member's say comes from the village's own rules.",
  voiceWeight: "Voice is never a term of a seat. Every member's say comes from the village's own rules.",
  commitment: "A seat is held whole. Terms carry no commitment share.",
  commitmentPct: "A seat is held whole. Terms carry no commitment share.",
  deferredPct: "Deferred pay is written as a pay kind with a note.",
  tokenSlug: "Terms record money in a currency. Tokens are paid through the village's own rules.",
  tokenPerCycle: "Terms record money in a currency. Tokens are paid through the village's own rules.",
};

/** Eight or more digits, allowing one space, dot or dash between them. */
const DIGIT_RUN = /\d(?:[ .-]?\d){7,}/;
/** Calendar dates are dates, never account numbers. */
const ISO_DATE_IN_TEXT = /\b\d{4}-\d{2}-\d{2}\b/g;
/** Two letters, two check digits, then eleven to thirty letters or digits. */
const IBAN_SHAPE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/i;

/** A scoreboard measures the work. These words rank people. */
const RANKS_PEOPLE =
  /\b(rank|ranks|ranked|ranking|leaderboard|league table|top \d+|best (?:member|person|people|holder)|worst|power level)\b/i;

export const PAYMENT_DETAIL_MESSAGE =
  "This looks like a bank or card number. Payment details are never stored in a seat's terms.";

/** True when a piece of free text carries something shaped like payment details. */
export function looksLikePaymentDetails(text: string): boolean {
  const withoutDates = text.replace(ISO_DATE_IN_TEXT, " ");
  return DIGIT_RUN.test(withoutDates) || IBAN_SHAPE.test(text);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TZ_RE = /^[A-Za-z]+(?:[/_+-][A-Za-z0-9]+)*$/;
const PRESET_ID_RE = /^[a-z0-9][a-z0-9:._-]{0,79}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

const validDate = (s: string): boolean => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

let knownCurrencies: Set<string> | null = null;
/** ISO 4217 codes this runtime knows. Null when it cannot say. */
function currencyKnown(code: string): boolean | null {
  if (!knownCurrencies) {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    if (typeof intl.supportedValuesOf !== "function") return null;
    try {
      knownCurrencies = new Set(intl.supportedValuesOf("currency"));
    } catch {
      return null;
    }
  }
  return knownCurrencies.has(code);
}

/** One parse, carrying its own problem list. */
class Reader {
  problems: SettingsProblem[] = [];
  flags: SettingsProblem[] = [];

  refuse(path: string, message: string): void {
    this.problems.push({ path, message });
  }

  /** Unknown keys are refused, with a reason where the key is a known mistake. */
  onlyKeys(path: string, obj: Record<string, unknown>, allowed: readonly string[]): void {
    for (const k of Object.keys(obj)) {
      if (allowed.includes(k)) continue;
      const at = path ? `${path}.${k}` : k;
      this.refuse(at, REFUSED_KEYS[k] ?? `"${k}" is not one of this group's settings.`);
    }
  }

  text(path: string, v: unknown, max: number, opts: { required?: boolean; ranks?: boolean } = {}): string | undefined {
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
      if (opts.required) this.refuse(path, "This needs a few words.");
      return undefined;
    }
    if (typeof v !== "string") {
      this.refuse(path, "This needs to be words.");
      return undefined;
    }
    const s = v.trim();
    if (s.length > max) this.refuse(path, `Keep this to ${max} characters.`);
    if (looksLikePaymentDetails(s)) this.refuse(path, PAYMENT_DETAIL_MESSAGE);
    if (opts.ranks && RANKS_PEOPLE.test(s)) this.refuse(path, "A scoreboard measures the work. It never ranks people.");
    return s;
  }

  whole(path: string, v: unknown, min: number, max: number): number | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
      this.refuse(path, "Whole numbers only.");
      return undefined;
    }
    if (v < min || v > max) {
      this.refuse(path, `This runs from ${min} to ${max}.`);
      return undefined;
    }
    return v;
  }

  date(path: string, v: unknown): string | undefined {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || !validDate(v)) {
      this.refuse(path, "A date reads year, month, day.");
      return undefined;
    }
    return v;
  }

  oneOf<T extends string>(path: string, v: unknown, options: readonly T[], required = false): T | undefined {
    if (v === undefined || v === null || v === "") {
      if (required) this.refuse(path, "Pick one.");
      return undefined;
    }
    if (typeof v !== "string" || !(options as readonly string[]).includes(v)) {
      this.refuse(path, "Pick one of the offered choices.");
      return undefined;
    }
    return v as T;
  }

  bool(path: string, v: unknown): boolean | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "boolean") {
      this.refuse(path, "This is a yes or a no.");
      return undefined;
    }
    return v;
  }

  currency(path: string, v: unknown): string | undefined {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || !CURRENCY_RE.test(v.trim().toUpperCase())) {
      this.refuse(path, "A currency is a three letter code.");
      return undefined;
    }
    const code = v.trim().toUpperCase();
    if (currencyKnown(code) === false) {
      this.flags.push({ path, message: `${code} is not a currency code the platform knows. It is kept as written.` });
    }
    return code;
  }

  group(path: string, v: unknown): Record<string, unknown> | null {
    if (!isPlainObject(v)) {
      this.refuse(path, "This group's settings did not arrive as a set of fields.");
      return null;
    }
    return v;
  }
}

/** Drop the keys whose value is undefined, so absent stays absent. */
function compact<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

function readTerm(r: Reader, raw: unknown): TermSettings | undefined {
  const g = r.group("term", raw);
  if (!g) return undefined;
  r.onlyKeys("term", g, ["endsOn", "lengthMoons", "noticeDays", "reviewOn", "renewalOn"]);
  const out: TermSettings = compact({
    lengthMoons: r.whole("term.lengthMoons", g.lengthMoons, 1, LIMITS.lengthMoons),
    noticeDays: r.whole("term.noticeDays", g.noticeDays, 0, LIMITS.noticeDays),
    reviewOn: r.date("term.reviewOn", g.reviewOn),
    renewalOn: r.date("term.renewalOn", g.renewalOn),
  });
  if (g.endsOn === null) out.endsOn = null;
  else if (g.endsOn !== undefined) {
    const d = r.date("term.endsOn", g.endsOn);
    if (d) out.endsOn = d;
  }
  if (typeof out.endsOn === "string" && out.lengthMoons !== undefined) {
    r.refuse("term.lengthMoons", "An end date and a length in moons cannot both be set. Keep one.");
  }
  return out;
}

function readClocks(r: Reader, raw: unknown): ClockSettings | undefined {
  const g = r.group("clocks", raw);
  if (!g) return undefined;
  r.onlyKeys("clocks", g, ["pay", "work"]);
  return compact({
    pay: r.oneOf("clocks.pay", g.pay, PAY_CLOCKS),
    work: r.oneOf("clocks.work", g.work, WORK_CLOCKS),
  });
}

function readRhythm(r: Reader, raw: unknown): RhythmSettings | undefined {
  const g = r.group("rhythm", raw);
  if (!g) return undefined;
  r.onlyKeys("rhythm", g, ["gatherings", "quietDays", "tz"]);
  const out: RhythmSettings = {};
  if (g.gatherings !== undefined) {
    if (!Array.isArray(g.gatherings)) r.refuse("rhythm.gatherings", "Gatherings arrive as a list.");
    else {
      if (g.gatherings.length > LIMITS.gatherings) {
        r.refuse("rhythm.gatherings", `Up to ${LIMITS.gatherings} standing gatherings.`);
      }
      out.gatherings = g.gatherings.slice(0, LIMITS.gatherings).flatMap((row, i) => {
        const at = `rhythm.gatherings.${i}`;
        const m = r.group(at, row);
        if (!m) return [];
        r.onlyKeys(at, m, ["label", "weekday", "time", "every"]);
        const label = r.text(`${at}.label`, m.label, LIMITS.labelChars, { required: true });
        const weekday = r.whole(`${at}.weekday`, m.weekday, 0, 6);
        if (weekday === undefined && m.weekday === undefined) r.refuse(`${at}.weekday`, "Pick a day.");
        const time = typeof m.time === "string" && TIME_RE.test(m.time) ? m.time : undefined;
        if (!time) r.refuse(`${at}.time`, "A time reads hours and minutes, 09:30.");
        const every = r.oneOf(`${at}.every`, m.every, GATHERING_EVERY);
        if (!label || weekday === undefined || !time) return [];
        return [compact({ label, weekday, time, every })];
      });
    }
  }
  if (g.quietDays !== undefined) {
    if (!Array.isArray(g.quietDays)) r.refuse("rhythm.quietDays", "Quiet days arrive as a list.");
    else {
      const days = g.quietDays.map((d, i) => r.whole(`rhythm.quietDays.${i}`, d, 0, 6));
      const clean = days.filter((d): d is number => d !== undefined);
      if (new Set(clean).size !== clean.length) r.refuse("rhythm.quietDays", "Each quiet day once.");
      out.quietDays = Array.from(new Set(clean)).sort((a, b) => a - b);
    }
  }
  if (g.tz !== undefined && g.tz !== null && g.tz !== "") {
    if (typeof g.tz !== "string" || g.tz.length > 64 || !TZ_RE.test(g.tz)) r.refuse("rhythm.tz", "That is not a time zone name.");
    else out.tz = g.tz;
  }
  return out;
}

function readMoney(
  r: Reader,
  group: "pay" | "allowance",
  g: Record<string, unknown>,
  kinds: readonly string[],
): { kind: string; currency?: string; amountMinor?: number; minMinor?: number; maxMinor?: number; per?: "month" | "moon"; note?: string } | undefined {
  const kind = r.oneOf(`${group}.kind`, g.kind, kinds, true);
  const out = compact({
    kind,
    currency: r.currency(`${group}.currency`, g.currency),
    amountMinor: r.whole(`${group}.amountMinor`, g.amountMinor, 0, LIMITS.amountMinor),
    minMinor: group === "pay" ? r.whole("pay.minMinor", g.minMinor, 0, LIMITS.amountMinor) : undefined,
    maxMinor: group === "pay" ? r.whole("pay.maxMinor", g.maxMinor, 0, LIMITS.amountMinor) : undefined,
    per: r.oneOf(`${group}.per`, g.per, MONEY_PER),
    note: r.text(`${group}.note`, g.note, LIMITS.noteChars),
  });
  if (!kind) return undefined;
  const carriesAmount = out.amountMinor !== undefined || out.minMinor !== undefined || out.maxMinor !== undefined;
  if ((kind === "none" || kind === "honorary") && carriesAmount) {
    r.refuse(`${group}.amountMinor`, "An unpaid or honorary seat records no amount.");
  }
  if (kind === "range" && out.amountMinor !== undefined) {
    r.refuse("pay.amountMinor", "A range records its lowest and highest amounts.");
  }
  if (kind !== "range" && (out.minMinor !== undefined || out.maxMinor !== undefined)) {
    r.refuse("pay.minMinor", "Lowest and highest amounts belong to a range.");
  }
  if (out.minMinor !== undefined && out.maxMinor !== undefined && out.minMinor > out.maxMinor) {
    r.refuse("pay.maxMinor", "The highest amount is below the lowest.");
  }
  return out as any;
}

function readPay(r: Reader, raw: unknown): PaySettings | undefined {
  const g = r.group("pay", raw);
  if (!g) return undefined;
  r.onlyKeys("pay", g, ["kind", "currency", "amountMinor", "minMinor", "maxMinor", "per", "note"]);
  return readMoney(r, "pay", g, PAY_KINDS) as PaySettings | undefined;
}

function readAllowance(r: Reader, raw: unknown): AllowanceSettings | undefined {
  const g = r.group("allowance", raw);
  if (!g) return undefined;
  r.onlyKeys("allowance", g, ["kind", "currency", "amountMinor", "per", "note"]);
  return readMoney(r, "allowance", g, ALLOWANCE_KINDS) as AllowanceSettings | undefined;
}

function readBonus(r: Reader, raw: unknown): BonusSettings | undefined {
  const g = r.group("bonus", raw);
  if (!g) return undefined;
  r.onlyKeys("bonus", g, ["kind", "capWords", "ratedBy", "cadence"]);
  const kind = r.oneOf("bonus.kind", g.kind, BONUS_KINDS, true);
  const out = compact({
    kind,
    capWords: r.text("bonus.capWords", g.capWords, LIMITS.wordsChars),
    ratedBy: r.text("bonus.ratedBy", g.ratedBy, LIMITS.wordsChars),
    cadence: r.text("bonus.cadence", g.cadence, LIMITS.wordsChars),
  });
  if (!kind) return undefined;
  return out as BonusSettings;
}

function readQuests(r: Reader, raw: unknown): QuestSettings | undefined {
  const g = r.group("quests", raw);
  if (!g) return undefined;
  r.onlyKeys("quests", g, ["perMoonMin", "perMoonMax", "agreedHow", "doneWhenRequired"]);
  const out = compact({
    perMoonMin: r.whole("quests.perMoonMin", g.perMoonMin, 1, LIMITS.questsPerMoon),
    perMoonMax: r.whole("quests.perMoonMax", g.perMoonMax, 1, LIMITS.questsPerMoon),
    agreedHow: r.text("quests.agreedHow", g.agreedHow, LIMITS.wordsChars),
  });
  if (out.perMoonMin !== undefined && out.perMoonMax !== undefined && out.perMoonMin > out.perMoonMax) {
    r.refuse("quests.perMoonMax", "The most quests a moon is below the fewest.");
  }
  if (g.doneWhenRequired !== undefined && g.doneWhenRequired !== true) {
    r.refuse("quests.doneWhenRequired", "Every quest has a done when. That part is always on.");
  }
  return { ...out, doneWhenRequired: true };
}

function readScoreboard(r: Reader, raw: unknown): ScoreboardSettings | undefined {
  const g = r.group("scoreboard", raw);
  if (!g) return undefined;
  r.onlyKeys("scoreboard", g, ["measures"]);
  if (!Array.isArray(g.measures)) {
    r.refuse("scoreboard.measures", "Measures arrive as a list.");
    return undefined;
  }
  if (g.measures.length > LIMITS.scoreMeasures) {
    r.refuse("scoreboard.measures", `Up to ${LIMITS.scoreMeasures} measures.`);
  }
  const measures = g.measures.slice(0, LIMITS.scoreMeasures).flatMap((row, i) => {
    const at = `scoreboard.measures.${i}`;
    const m = r.group(at, row);
    if (!m) return [];
    r.onlyKeys(at, m, ["measure", "readFrom", "target"]);
    const measure = r.text(`${at}.measure`, m.measure, LIMITS.measureChars, { required: true, ranks: true });
    const out = compact({
      measure,
      readFrom: r.text(`${at}.readFrom`, m.readFrom, LIMITS.measureChars, { ranks: true }),
      target: r.text(`${at}.target`, m.target, LIMITS.measureChars, { ranks: true }),
    });
    return measure ? [out as ScoreMeasure] : [];
  });
  return { measures };
}

function readEnding(r: Reader, raw: unknown): EndingSettings | undefined {
  const g = r.group("ending", raw);
  if (!g) return undefined;
  r.onlyKeys("ending", g, ["noticeDays", "payThroughNotice"]);
  return compact({
    noticeDays: r.whole("ending.noticeDays", g.noticeDays, 0, LIMITS.noticeDays),
    payThroughNotice: r.bool("ending.payThroughNotice", g.payThroughNotice),
  });
}

function readPresets(r: Reader, raw: unknown): PresetProvenance[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    r.refuse("presets", "Preset provenance arrives as a list.");
    return undefined;
  }
  const seen = new Set<string>();
  return raw.flatMap((row, i) => {
    const at = `presets.${i}`;
    const p = r.group(at, row);
    if (!p) return [];
    r.onlyKeys(at, p, ["group", "presetId", "presetVersion"]);
    const group = r.oneOf(`${at}.group`, p.group, SETTINGS_GROUPS, true);
    const presetId = typeof p.presetId === "string" && PRESET_ID_RE.test(p.presetId) ? p.presetId : undefined;
    if (!presetId) r.refuse(`${at}.presetId`, "That is not a preset's id.");
    const presetVersion = r.whole(`${at}.presetVersion`, p.presetVersion, 1, 1_000_000);
    if (presetVersion === undefined) r.refuse(`${at}.presetVersion`, "A preset's version is a whole number.");
    if (!group || !presetId || presetVersion === undefined) return [];
    if (seen.has(group)) {
      r.refuse(at, "Each group starts from one preset.");
      return [];
    }
    seen.add(group);
    return [{ group, presetId, presetVersion }];
  });
}

const READERS: { [G in SettingsGroup]: (r: Reader, raw: unknown) => SeatSettings[G] | undefined } = {
  term: readTerm,
  clocks: readClocks,
  rhythm: readRhythm,
  pay: readPay,
  allowance: readAllowance,
  bonus: readBonus,
  quests: readQuests,
  scoreboard: readScoreboard,
  ending: readEnding,
};

/**
 * Read a seat's settings from anything: a stored JSON column, a request body,
 * the editor's state. Refuses what it cannot keep and says why, per field.
 * `null` and `undefined` read as an empty set of terms, every group not set.
 */
export function parseSeatSettings(raw: unknown): ParsedSettings {
  const r = new Reader();
  if (raw === undefined || raw === null) {
    return { ok: true, settings: emptySettings(), problems: [], flags: [] };
  }
  if (!isPlainObject(raw)) {
    r.refuse("", "A seat's settings arrive as a set of groups.");
    return { ok: false, settings: null, problems: r.problems, flags: r.flags };
  }
  if (raw.v !== undefined && raw.v !== SEAT_SETTINGS_VERSION) {
    r.refuse("v", "These settings were written for a different version of the platform.");
  }
  r.onlyKeys("", raw, ["v", "presets", ...SETTINGS_GROUPS]);
  const out: SeatSettings = emptySettings();
  for (const group of SETTINGS_GROUPS) {
    if (raw[group] === undefined || raw[group] === null) continue;
    const value = READERS[group](r, raw[group]);
    if (value !== undefined) (out as any)[group] = value;
  }
  const presets = readPresets(r, raw.presets);
  if (presets && presets.length > 0) out.presets = presets;
  const ok = r.problems.length === 0;
  return { ok, settings: ok ? out : null, problems: r.problems, flags: r.flags };
}

// ── The words ────────────────────────────────────────────────────────────────

export interface SettingsRow {
  group: SettingsGroup;
  label: string;
  /** False when the group is absent. Its headline is then NOT_SET. */
  set: boolean;
  headline: string;
  lines: string[];
  /** MONEY_LINE on a set money group that records money (kind not none or honorary), else null. */
  moneyLine: string | null;
  /** The preset this group started from, by id, or null. */
  presetId: string | null;
  /** For quests: the pips, filled to the fewest and outlined to the most. */
  pips?: { filled: number; outlined: number };
}

export interface WordsContext {
  /** BCP 47 locale for dates and amounts. Defaults to en-GB. */
  locale?: string;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** How many minor units make one of a currency, read from Intl; 2 when it cannot say. */
export function minorDigits(currency: string | undefined): number {
  if (!currency) return 2;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Said where an amount was typed that is not a whole number. Never a rescaled figure. */
export const AMOUNT_NOT_WHOLE = "amount not a whole number";
/** Appended once to a money headline whose amounts carry no currency. */
export const NO_CURRENCY = " (currency not set)";

/**
 * Whole minor units, written as money. An unknown currency is said by its
 * code; an absent one prints the bare figure, and the headline says once,
 * at its end, that the currency is not set.
 */
export function moneyWords(minor: number, currency: string | undefined, locale = "en-GB"): string {
  // Mid-edit text or a fraction: say so, never print a figure it does not mean.
  if (typeof minor !== "number" || !Number.isInteger(minor)) return AMOUNT_NOT_WHOLE;
  const digits = minorDigits(currency);
  const major = minor / 10 ** digits;
  if (currency && currencyKnown(currency) !== false) {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: digits }).format(major);
    } catch {
      /* fall through to the plain form */
    }
  }
  const n = new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(major);
  return currency ? `${currency} ${n}` : n;
}

export function dateWords(iso: string, locale = "en-GB"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

const perWords = (per: string | undefined): string => (per === "moon" ? " a moon" : per === "month" ? " a month" : "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function termWords(t: TermSettings, locale: string): Pick<SettingsRow, "headline" | "lines"> {
  const headline =
    t.endsOn === null
      ? "Until the season ends"
      : typeof t.endsOn === "string"
        ? `Until ${dateWords(t.endsOn, locale)}`
        : t.lengthMoons !== undefined
          ? `${plural(t.lengthMoons, "moon", "moons")} from seating`
          : "End not set";
  const lines: string[] = [];
  if (t.noticeDays !== undefined) lines.push(`Notice: ${plural(t.noticeDays, "day", "days")}`);
  if (t.reviewOn) lines.push(`Review on ${dateWords(t.reviewOn, locale)}`);
  if (t.renewalOn) lines.push(`Renewal on ${dateWords(t.renewalOn, locale)}`);
  return { headline, lines };
}

function clockWords(c: ClockSettings): Pick<SettingsRow, "headline" | "lines"> {
  const pay = c.pay === "calendar-month" ? "Paid by the calendar month" : c.pay === "moon" ? "Paid by the moon" : null;
  const work = c.work === "moon" ? "works by the moon" : c.work === "week" ? "works by the week" : null;
  const headline = pay && work ? `${pay}, ${work}` : pay ? pay : work ? work.charAt(0).toUpperCase() + work.slice(1) : NOT_SET;
  return { headline, lines: [] };
}

function rhythmWords(r: RhythmSettings): Pick<SettingsRow, "headline" | "lines"> {
  const gatherings = r.gatherings ?? [];
  const lines = gatherings.map(
    (g) => `${g.label}: ${g.every === "fortnight" ? "every other" : "every"} ${WEEKDAYS[g.weekday]} at ${g.time}`,
  );
  if (r.quietDays && r.quietDays.length > 0) lines.push(`Quiet days: ${r.quietDays.map((d) => WEEKDAYS[d]).join(", ")}`);
  lines.push(r.tz ? `Times in ${r.tz}` : "Times on the season's clock");
  const headline =
    gatherings.length === 0
      ? "No standing gatherings"
      : gatherings.length === 1
        ? `${gatherings[0].label}, ${WEEKDAYS[gatherings[0].weekday]}s`
        : `${gatherings.length} standing gatherings`;
  return { headline, lines };
}

function payWords(p: PaySettings, locale: string): Pick<SettingsRow, "headline" | "lines"> {
  const amount = (m: number | undefined) => (m === undefined ? "amount not set" : moneyWords(m, p.currency, locale));
  const per = perWords(p.per);
  let headline: string;
  switch (p.kind) {
    case "none":
      headline = "Unpaid";
      break;
    case "honorary":
      headline = "Honorary";
      break;
    case "fixed":
      headline = p.amountMinor === undefined ? `A fixed stipend${per}, amount not set` : `${amount(p.amountMinor)}${per}`;
      break;
    case "range":
      headline =
        p.minMinor === undefined && p.maxMinor === undefined
          ? `A stipend range${per}, amounts not set`
          : `Between ${amount(p.minMinor)} and ${amount(p.maxMinor)}${per}`;
      break;
    case "in-kind":
      headline = p.amountMinor === undefined ? "In kind" : `In kind, worth ${amount(p.amountMinor)}${per}`;
      break;
    case "deferred":
      headline = p.amountMinor === undefined ? "Deferred" : `${amount(p.amountMinor)}${per}, deferred`;
      break;
    default:
      // Mid-edit, before a kind is picked. Parsed settings never reach here.
      headline = "Kind not set";
  }
  const anyAmount = p.amountMinor !== undefined || p.minMinor !== undefined || p.maxMinor !== undefined;
  if (anyAmount && !p.currency) headline += NO_CURRENCY;
  const lines = p.note ? [p.note] : [];
  return { headline, lines };
}

function allowanceWords(a: AllowanceSettings, locale: string): Pick<SettingsRow, "headline" | "lines"> {
  const per = perWords(a.per);
  const headline =
    a.kind === "none"
      ? "No allowance"
      : a.kind === "reimbursed"
        ? "Costs reimbursed"
        : a.kind !== "flat"
          ? "Kind not set"
          : a.amountMinor === undefined
          ? `A flat allowance${per}, amount not set`
          : `A flat allowance of ${moneyWords(a.amountMinor, a.currency, locale)}${per}${a.currency ? "" : NO_CURRENCY}`;
  return { headline, lines: a.note ? [a.note] : [] };
}

function bonusWords(b: BonusSettings): Pick<SettingsRow, "headline" | "lines"> {
  if (b.kind === "none") return { headline: "No bonus", lines: [] };
  if (b.kind !== "equity") return { headline: "Kind not set", lines: [] };
  const lines: string[] = [];
  if (b.capWords) lines.push(b.capWords);
  if (b.ratedBy) lines.push(`Rated by ${b.ratedBy}`);
  if (b.cadence) lines.push(b.cadence);
  return { headline: "An equity bonus, written in words", lines };
}

function questWords(q: QuestSettings): Pick<SettingsRow, "headline" | "lines" | "pips"> {
  const min = q.perMoonMin;
  const max = q.perMoonMax;
  const headline =
    min !== undefined && max !== undefined
      ? min === max
        ? `${plural(min, "quest", "quests")} a moon`
        : `${min} to ${max} quests a moon`
      : min !== undefined
        ? `At least ${plural(min, "quest", "quests")} a moon`
        : max !== undefined
          ? `Up to ${plural(max, "quest", "quests")} a moon`
          : "Quests a moon not set";
  const lines: string[] = [];
  if (q.agreedHow) lines.push(`Agreed: ${q.agreedHow}`);
  lines.push("Every quest has a done when");
  const filled = min ?? 0;
  const pips = max !== undefined || min !== undefined ? { filled, outlined: Math.max(0, (max ?? filled) - filled) } : undefined;
  return { headline, lines, pips };
}

function scoreboardWords(s: ScoreboardSettings): Pick<SettingsRow, "headline" | "lines"> {
  const measures = Array.isArray(s.measures) ? s.measures : [];
  const n = measures.length;
  const headline = n === 0 ? "No measures yet" : `${plural(n, "measure", "measures")} of the work`;
  const lines = measures.map((m) => {
    const parts = [m.measure];
    if (m.target) parts.push(m.target);
    let line = parts.join(": ");
    if (m.readFrom) line += ` (read from ${m.readFrom})`;
    return line;
  });
  return { headline, lines };
}

function endingWords(e: EndingSettings): Pick<SettingsRow, "headline" | "lines"> {
  const headline = e.noticeDays !== undefined ? `${plural(e.noticeDays, "day", "days")} notice` : "Notice not set";
  const lines: string[] = [];
  if (e.payThroughNotice === true) lines.push("Pay runs through the notice");
  if (e.payThroughNotice === false) lines.push("Pay stops when notice is given");
  return { headline, lines };
}

/**
 * True when a set group records money, so its row carries MONEY_LINE. A money
 * group whose kind is "none" (unpaid, no allowance, no bonus) or "honorary"
 * records nothing, and a line about paying would say something untrue.
 */
function recordsMoney(group: SettingsGroup, value: unknown): boolean {
  if (!MONEY_GROUPS.includes(group)) return false;
  const kind = (value as { kind?: unknown } | undefined)?.kind;
  return kind !== "none" && kind !== "honorary";
}

/**
 * Every group, in season-card order, as a headline and its lines. A group
 * that is absent comes back with `set: false` and the headline NOT_SET. The
 * drawer and the editor both print these, so the words cannot differ.
 *
 * Takes settings that already passed `parseSeatSettings`. A caller holding
 * raw input parses first.
 */
export function settingsWords(settings: SeatSettings | null | undefined, ctx: WordsContext = {}): SettingsRow[] {
  const locale = ctx.locale ?? "en-GB";
  const s = settings ?? emptySettings();
  const provenance = new Map((s.presets ?? []).map((p) => [p.group, p.presetId]));
  return SETTINGS_GROUPS.map((group) => {
    const base = {
      group,
      label: GROUP_LABELS[group],
      presetId: provenance.get(group) ?? null,
    };
    const value = s[group];
    if (value === undefined) {
      return { ...base, set: false, headline: NOT_SET, lines: [], moneyLine: null };
    }
    const words =
      group === "term"
        ? termWords(value as TermSettings, locale)
        : group === "clocks"
          ? clockWords(value as ClockSettings)
          : group === "rhythm"
            ? rhythmWords(value as RhythmSettings)
            : group === "pay"
              ? payWords(value as PaySettings, locale)
              : group === "allowance"
                ? allowanceWords(value as AllowanceSettings, locale)
                : group === "bonus"
                  ? bonusWords(value as BonusSettings)
                  : group === "quests"
                    ? questWords(value as QuestSettings)
                    : group === "scoreboard"
                      ? scoreboardWords(value as ScoreboardSettings)
                      : endingWords(value as EndingSettings);
    return {
      ...base,
      set: true,
      ...words,
      moneyLine: recordsMoney(group, value) ? MONEY_LINE : null,
    };
  });
}

// ── The fingerprint ──────────────────────────────────────────────────────────

/**
 * sha256 over the canonical bytes of a parsed settings object, as lowercase
 * hex. Server side only: the alignment store (PR5) salts its own hash, and
 * this one is never shown to anyone. Async because Web Crypto is.
 */
export async function settingsHash(settings: SeatSettings): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) throw new Error("settingsHash needs Web Crypto, which this runtime does not provide");
  const bytes = new TextEncoder().encode(canonicalJson(settings));
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
