/**
 * THE CASH BUDGET, THE PURE HALF (budgets spec v0.2; tables in 9999).
 *
 * Rye, 9 Nov: "build an Admin Budgets upload section, so the Treasurer can
 * upload or update the cash budget." A moon's cash share is the budget left for
 * that moon over the base still to be set (`cycleCashShare`,
 * shared/valuationSetting.ts), and with no budget no cash is offered. This file
 * is everything about that which needs no database: what a period means in
 * days, how an amount a person typed is read, which cells are refused, which
 * lines count toward the moon and how much of each, and the one figure the
 * engine reads.
 *
 * The store and the one write path are server/lib/budgets.ts. Nothing here
 * writes, and nothing here decides who may.
 *
 * ── NULL AND 0 TRAVEL SEPARATELY (R7) ──────────────────────────────────────
 *
 * `budgetFigure` answers null when no line that counts touches the moon, and a
 * figure (possibly 0 left) when one does. `moonCashTerms` is the one place a
 * caller turns that into what the engine reads: a share that is always a
 * number, and `budgetSet` that is false only for null. So null never reaches
 * the engine's `ctx.cashSharePct ?? work.cashPct`, which would fall back to the
 * model's default, and 0 left never reads as "no budget".
 */
import { boundsForNumber, parseId } from "./cycleClock";
import { exponentOf } from "./money";
import { addDays, daysInclusive, moonDays } from "./moonRecap";
import { parseLocaleNumber } from "./i18nNumbers";
import { cycleCashShare } from "./valuationSetting";

// ── The vocabulary (R1) ─────────────────────────────────────────────────────

export const BUDGET_SOURCES = ["upload", "sera", "manual"] as const;
export type BudgetSource = (typeof BUDGET_SOURCES)[number];

export const PERIOD_KINDS = ["moon", "month", "season", "span"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export const BUDGET_CATEGORIES = ["role_pay", "quest_pay", "materials", "other"] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

/** The categories the moon's cash figure is made of (R7). Materials and other are shown, never counted. */
export const CASH_CATEGORIES: readonly BudgetCategory[] = ["role_pay", "quest_pay"];

export const LINE_STATUSES = ["approved", "draft", "closed", "withdrawn"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

/** The longest label and note a line keeps (R1). */
export const LABEL_MAX = 120;
export const NOTE_MAX = 500;
/** The most rows one import may carry (R11). */
export const IMPORT_ROWS_MAX = 2000;

/** What `changed_as` says for an admin who wrote before the launch vote carried (R1, R21). */
export const ADMIN_BEFORE_LAUNCH = "admin, before launch";
/** What `changed_as` says when a village vote carried the change (R22). */
export const BY_VILLAGE_VOTE = "the village, by a vote";

/**
 * THE VILLAGE-WIDE SCOPE (R34, M2): what `circle_id` holds for a line about
 * the whole village. A fixed marker, never the circle the
 * `budgets.village_circle_id` dial names today, so moving the dial moves no
 * line, no key and no figure; the circles view puts these lines on the
 * village's circle only when it is read. `@` never appears in a circle id.
 */
export const VILLAGE_WIDE = "@village";

export const isBudgetSource = (v: unknown): v is BudgetSource => typeof v === "string" && (BUDGET_SOURCES as readonly string[]).includes(v);

/** A category as a person wrote it ("Role pay", "role-pay", "quest_pay"), or null. */
export function readCategory(v: unknown): BudgetCategory | null {
  const s = String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (BUDGET_CATEGORIES as readonly string[]).includes(s) ? (s as BudgetCategory) : null;
}

// ── Periods (R6) ────────────────────────────────────────────────────────────

export interface ResolvedPeriod {
  kind: PeriodKind;
  /** The moon id, `YYYY-MM`, the season id, or `YYYY-MM-DD..YYYY-MM-DD`. */
  key: string;
  /** Inclusive civil days in the village's zone. */
  startsOn: string;
  endsOn: string;
}

export interface SeasonLike {
  id: string;
  startsOn?: string | null;
  /** The first day AFTER the season, as the season calendar stores it. */
  endsOn?: string | null;
}

export interface PeriodEnv {
  timezone: string;
  seasons: readonly SeasonLike[];
}

export type PeriodRead = { ok: true; period: ResolvedPeriod } | { ok: false; message: string };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const SPAN = /^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|\/|\bto\b|\u2013|\u2014|,|\s)\s*(\d{4}-\d{2}-\d{2})$/i;

function realDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

/** The moon a cycle id names, in days, or null for an id no clock reads. */
export function moonPeriod(moonId: string, timezone: string): (ResolvedPeriod & { days: number }) | null {
  const parsed = parseId(moonId);
  if (!parsed || parsed.clock === "legacy_month" || parsed.cycleNumber === null) return null;
  const d = moonDays(boundsForNumber(parsed.cycleNumber), timezone);
  return { kind: "moon", key: moonId, startsOn: d.firstDay, endsOn: d.lastDay, days: d.days };
}

/**
 * A period as a person named it: a moon id (`lunar-000123`, `month-2026-11`),
 * a month (`2026-11`), a season by its id, or two dates. A calendar moon is
 * already a whole month, so `month-2026-11` is the moon and counts whole.
 */
export function resolvePeriod(text: unknown, env: PeriodEnv): PeriodRead {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: false, message: "Say which period this line is for: a moon, a month like 2026-11, a season, or two dates." };
  const moon = moonPeriod(raw, env.timezone);
  if (moon) return { ok: true, period: { kind: "moon", key: moon.key, startsOn: moon.startsOn, endsOn: moon.endsOn } };
  const month = MONTH.exec(raw);
  if (month) {
    const m = Number(month[2]);
    if (m < 1 || m > 12) return { ok: false, message: `${raw} is not a month. Write a month like 2026-11.` };
    const first = `${month[1]}-${month[2]}-01`;
    const next = m === 12 ? `${Number(month[1]) + 1}-01-01` : `${month[1]}-${String(m + 1).padStart(2, "0")}-01`;
    return { ok: true, period: { kind: "month", key: raw, startsOn: first, endsOn: addDays(next, -1) } };
  }
  const span = SPAN.exec(raw);
  if (span) {
    const [, a, b] = span;
    if (!realDate(a) || !realDate(b)) return { ok: false, message: "One of these dates is not a real day. Write dates like 2026-11-09." };
    if (b < a) return { ok: false, message: "The second date comes before the first. Give the first day, then the last day." };
    return { ok: true, period: { kind: "span", key: `${a}..${b}`, startsOn: a, endsOn: b } };
  }
  const season = env.seasons.find((s) => s.id === raw);
  if (season) {
    if (!season.startsOn || !realDate(season.startsOn)) return { ok: false, message: "This season has no start date yet. Give two dates instead." };
    if (!season.endsOn || !realDate(season.endsOn)) return { ok: false, message: "This season has no end date yet, so a line for it has no length. Give two dates instead." };
    const last = addDays(season.endsOn, -1);
    if (last < season.startsOn) return { ok: false, message: "This season ends before it starts. Give two dates instead." };
    return { ok: true, period: { kind: "season", key: season.id, startsOn: season.startsOn, endsOn: last } };
  }
  return { ok: false, message: `${raw.slice(0, 40)} is not a period this village knows. Use a moon, a month like 2026-11, a season, or two dates.` };
}

/** The text that resolves back to a stored period, for a hand edit that leaves the period alone. */
export function periodText(p: Pick<ResolvedPeriod, "kind" | "key">): string {
  return p.key;
}

// ── Cells (R13) ─────────────────────────────────────────────────────────────

/**
 * A cell a spreadsheet would run as a formula: one starting `=`, `+`, `-`,
 * `@`, a tab or a carriage return (the shape `csvCell` in server/lib/cashOwed.ts
 * guards on export). In a label or a note it is kept as text and flagged; in an
 * amount it is refused.
 */
export function isFormulaCell(v: unknown): boolean {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) || /^[=+\-@]/.test(s.trimStart());
}

// ── Amounts (R12) ───────────────────────────────────────────────────────────

/**
 * The number format a person reads their sheet in. `chosen` is true when they
 * picked it in the preview, and false when it is only the default from their
 * own formatting locale. Only a chosen format settles a cell like `1,234`.
 */
export interface NumberFormatChoice {
  locale: string;
  chosen: boolean;
}

export type AmountRefusal = "empty" | "formula" | "ambiguous" | "unreadable" | "negative" | "too_precise" | "too_large" | "currency_mismatch";

export type AmountRead =
  | { ok: true; minor: number; cell: string }
  | { ok: false; reason: AmountRefusal; message: string };

/** Every mark a sheet might separate digits with, whatever its locale. A space is never one of them: it only ever groups thousands. */
const SEPARATOR = /[.,'\u2019\u066b\u066c]/g;
const SPACES = /[ \u00a0\u202f\u2009]/g;
/** Thousands grouped by spaces, with an optional decimal part: "1 234", "12 345 678.90", "1 234,50". */
const SPACE_GROUPED = /^\d{1,3}(?:[ \u00a0\u202f\u2009]\d{3})+(?:[.,]\d+)?$/;
// Built with the constructor: the typecheck targets a language level that
// refuses the `u` flag on a literal (the reason server/lib/nameSwap.ts gives).
const CURRENCY_SIGN = new RegExp(String.raw`US\$|\p{Sc}`, "gu");
const LETTER = new RegExp(String.raw`\p{L}`, "u");
const DIGIT = new RegExp(String.raw`\p{Nd}`, "u");
const THREE_DIGITS = /^\d{3}$/;

/**
 * A currency sign a sheet might carry, and the currencies it can mean (M5).
 * A sign that is not here is refused: the cell says its currency by code.
 * "$" is the US dollar here, as decided; another dollar is written by code.
 */
const SIGNS: Readonly<Record<string, readonly string[]>> = {
  "$": ["USD"],
  "US$": ["USD"],
  "\u20ac": ["EUR"],
  "\u20a1": ["CRC"],
  "\u00a3": ["GBP"],
  "\u00a5": ["JPY", "CNY"],
  "\u20b9": ["INR"],
  "\u20a9": ["KRW"],
  "\u20a6": ["NGN"],
  "\u20b1": ["PHP"],
  "\u20ab": ["VND"],
  "\u20aa": ["ILS"],
  "\u20ba": ["TRY"],
  "\u20b4": ["UAH"],
  "\u20bd": ["RUB"],
  "\u0e3f": ["THB"],
  "\u20b2": ["PYG"],
  "\u20b5": ["GHS"],
};

/** The zero of each decimal-digit script `parseLocaleNumber` reads, so a digit becomes its ASCII twin before any arithmetic. */
const DIGIT_ZEROS = [0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810, 0xff10];
function asciiDigits(text: string): string {
  let out = "";
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0) ?? 0;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    out += zero === undefined ? ch : String(cp - zero);
  }
  return out;
}

function localeMarks(locale: string): { group: string; decimal: string } {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    return { group: parts.find((p) => p.type === "group")?.value ?? ",", decimal: parts.find((p) => p.type === "decimal")?.value ?? "." };
  } catch {
    return { group: ",", decimal: "." };
  }
}

const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Read one amount cell into minor units of `currency` (R12, R13, M5).
 *
 * Text is checked under the chosen format with `parseLocaleNumber`, and the
 * minor units are then counted off the digits themselves, as whole numbers,
 * so an amount near the top of what a number holds is never a unit out.
 * Before that: a currency sign is mapped to the currencies it can mean and
 * refused when the line is in another; a three-letter code before or after the
 * number is taken off, and refused when it is not the line's; any other letter
 * is refused, so "100k", "2M" and "1.5bn" never read as 100, 2 and 1.5. A
 * space groups thousands and is never a decimal mark. Refused as well: an
 * empty cell, a formula cell, one separator followed by exactly three digits
 * unless the format was chosen, a value below 0 (by value, so a Unicode minus
 * is caught), and more fraction digits than the currency has.
 *
 * A JSON number is read through the same digits. One longer than a float
 * holds exactly (15 significant digits) is refused: send it as text.
 */
export function readAmount(cell: unknown, currency: string, format: NumberFormatChoice): AmountRead {
  const cur = currency.toUpperCase();
  const exp = exponentOf(cur);
  const refuse = (reason: AmountRefusal, message: string): AmountRead => ({ ok: false, reason, message });
  const tooPrecise = (n: number) => refuse("too_precise", `${cur} has ${exp} digit${exp === 1 ? "" : "s"} after the decimal mark, and this amount has ${n}.`);

  /** Whole digits and fraction digits, signless, to minor units exactly. */
  const exact = (int: string, frac: string, negative: boolean, shown: string): AmountRead => {
    if (frac.length > exp) return tooPrecise(frac.length);
    const minor = BigInt((int.replace(/^0+(?=\d)/, "") || "0") + frac.padEnd(exp, "0"));
    if (minor > MAX_MINOR) return refuse("too_large", "This amount is too large to keep exactly.");
    if (negative && minor > BigInt(0)) return refuse("negative", "A budget line plans an amount of 0 or more. Write a cut as a smaller amount.");
    return { ok: true, minor: Number(minor), cell: shown };
  };

  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return refuse("unreadable", "This amount is not a number.");
    if (cell < 0) return refuse("negative", "A budget line plans an amount of 0 or more. Write a cut as a smaller amount.");
    const text = String(cell);
    if (/e/i.test(text)) return cell >= 1 ? refuse("too_large", "This amount is too large to keep exactly.") : tooPrecise(exp + 1);
    if (text.replace(/[^0-9]/g, "").replace(/^0+/, "").length > 15) return refuse("unreadable", "An amount this long is sent as text, so no digit is lost on the way.");
    const [int, frac = ""] = text.split(".");
    return exact(int, frac, false, text);
  }

  const raw = String(cell ?? "");
  if (!raw.trim()) return refuse("empty", "Write the amount this line plans.");
  if (isFormulaCell(raw)) return refuse("formula", "This cell starts like a formula. Write the amount itself, with no = + - or @ in front.");
  let text = asciiDigits(raw.trim());

  // A currency sign, mapped (M5).
  const signs = Array.from(new Set(Array.from(text.matchAll(CURRENCY_SIGN)).map((m) => m[0])));
  if (signs.length > 1) return refuse("unreadable", "This cell names more than one currency.");
  if (signs.length === 1) {
    const means = SIGNS[signs[0]];
    if (!means) return refuse("currency_mismatch", `Write the currency of this amount as its three-letter code, like ${cur}.`);
    if (!means.includes(cur)) return refuse("currency_mismatch", `This amount is in ${means.join(" or ")} and the line is in ${cur}. Put the code in the currency column, or write the amount in ${cur}.`);
    text = text.replace(CURRENCY_SIGN, " ").trim();
  }
  // A three-letter code before or after the number, and nothing else made of letters.
  let code: string | null = null;
  const lead = /^([A-Za-z]{3})(?![A-Za-z])\s*/.exec(text);
  if (lead) {
    code = lead[1].toUpperCase();
    text = text.slice(lead[0].length);
  }
  const tail = /([^A-Za-z])\s*([A-Za-z]{3})$/.exec(text);
  if (tail) {
    code = code ?? tail[2].toUpperCase();
    text = text.slice(0, tail.index + 1);
  }
  text = text.trim();
  if (code && code !== cur) return refuse("currency_mismatch", `This amount says ${code} and the line is in ${cur}. Put ${code} in the currency column, or write the amount in ${cur}.`);
  if (LETTER.test(text)) return refuse("unreadable", "Write the whole amount in figures, like 100000, with no k, M or bn.");
  if (!DIGIT.test(text)) return refuse("unreadable", "There is no number in this cell.");

  // The sign: a minus is read, then refused by value below.
  text = text.replace(/\u2212/g, "-");
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1).trim() : text;
  if (body.includes("-")) return refuse("unreadable", "This amount does not read as a number.");

  // Spaces group thousands, and only thousands (M5).
  const spaced = SPACE_GROUPED.test(body);
  const grouped = spaced ? body.replace(SPACES, "") : body;
  if (!spaced && /[ \u00a0\u202f\u2009]/.test(body)) return refuse("unreadable", "Group thousands with a space, a comma or a point, three digits at a time.");

  const marks = Array.from(grouped.matchAll(SEPARATOR));
  // One mark with three digits after it reads either way, space groups or not, until a format is chosen (V8).
  if (!format.chosen && marks.length === 1 && THREE_DIGITS.test(grouped.slice((marks[0].index ?? 0) + 1))) {
    return refuse("ambiguous", `"${raw.trim().slice(0, 30)}" could be a whole number or a decimal, depending on the number format. Pick the format in the preview.`);
  }
  if (parseLocaleNumber(grouped, format.locale) === null) {
    return refuse("unreadable", `This amount does not read as a number in the ${format.locale} format. Check the separators, or pick another format.`);
  }
  // Counted off the digits: the locale's group marks out, its decimal mark to a point.
  const { group, decimal } = localeMarks(format.locale);
  let digits = grouped.replace(/\u066c/g, "").replace(/\u066b/g, ".");
  digits = /[ \u00a0\u202f\u2009]/.test(group) ? digits.replace(SPACES, "") : digits.split(group).join("");
  if (decimal !== ".") digits = digits.split(decimal).join(".");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(digits);
  if (!m) return refuse("unreadable", `This amount does not read as a number in the ${format.locale} format. Check the separators, or pick another format.`);
  return exact(m[1], m[2] ?? "", negative, raw.trim());
}

// ── Which lines count, and how much of each (R4, R7, R8) ────────────────────

/** A line as the figure reads it. */
export interface FigureLine {
  id: string;
  label: string;
  source: BudgetSource;
  periodKind: PeriodKind;
  periodKey: string;
  startsOn: string;
  endsOn: string;
  circleId: string | null;
  roleId: string | null;
  matched: boolean;
  category: BudgetCategory;
  plannedMinor: number;
  currency: string;
  status: LineStatus;
  adoptedAt: string | null;
  /**
   * A rate a person locked on a line in another currency (spec 5a, option b):
   * village-currency units per one unit of the line's currency, as stored
   * text (decimal(18,8)). Null when nothing is locked.
   */
  fxRate?: string | null;
  /** Where the rate came from: the stored daily rate and its provider, or a typed rate and its note. */
  fxSource?: string | null;
  /** The day the rate is from. */
  fxAsOf?: string | null;
  /** Who locked it. An account id: the read route names the role instead, never the id. */
  fxLockedBy?: string | null;
  fxLockedAt?: string | null;
  /** A source's line that named no circle and is village-wide (R34). */
  sourceVillageWide?: boolean;
  /** The currency a locked rate converts into (M4). A rate converts into nothing else. */
  fxInto?: string | null;
  /** A source's line whose words may name a member: kept out of the figure and the member view until renamed (R15, M9). */
  nameHeld?: boolean;
}

// ── A locked rate (spec 5a, option b) ───────────────────────────────────────

/** The digits a stored rate keeps after the decimal mark (decimal(18,8)). */
export const RATE_DIGITS = 8;
/** A stored daily rate older than this is no rate at all (`latestRates` keeps 14 days). */
export const PROVIDER_RATE_MAX_DAYS = 14;
/** Drift past this, either way, raises the members-only warning (spec 5a, guard 2). */
export const DRIFT_WARN_PCT = 5;

const pow10 = (n: number): bigint => BigInt(`1${"0".repeat(Math.max(0, n))}`);

/**
 * A rate as a whole count of 1e-8 units, read exactly off its decimal text,
 * so 509.86 is 50986000000 and never 509.8599999. Null for anything that is
 * not a positive decimal. A JS number is fixed to 8 digits first.
 */
export function rateUnits(rate: string | number | null | undefined): bigint | null {
  const text = typeof rate === "number" ? (Number.isFinite(rate) && rate > 0 ? rate.toFixed(RATE_DIGITS) : "") : String(rate ?? "").trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const units = BigInt(m[1] + (m[2] ?? "").slice(0, RATE_DIGITS).padEnd(RATE_DIGITS, "0"));
  return units > BigInt(0) ? units : null;
}

/**
 * An amount in `from`'s minor units, at `rate` units of `to` per unit of
 * `from`, in `to`'s minor units, FLOORED (spec 5a: "Conversion floors in minor
 * units"). Exact integer arithmetic, so no rate is a hair off. Null when the
 * rate is not a positive decimal or the result is past what a number holds.
 */
export function convertAtRate(minor: number, from: string, to: string, rate: string | number | null | undefined): number | null {
  const units = rateUnits(rate);
  if (units === null || !Number.isFinite(minor) || minor < 0) return null;
  const out = (BigInt(Math.trunc(minor)) * units * pow10(exponentOf(to))) / pow10(RATE_DIGITS + exponentOf(from));
  const n = Number(out);
  return Number.isSafeInteger(n) ? n : null;
}

/** What a line plans in the village's currency: itself, or converted at its locked rate, or null (R8). */
export function inVillageCurrency(line: Pick<FigureLine, "plannedMinor" | "currency" | "fxRate" | "fxInto">, villageCurrency: string): number | null {
  if (line.currency.toUpperCase() === villageCurrency.toUpperCase()) return line.plannedMinor;
  // A rate converts only into the currency it was locked into (M4).
  if (!line.fxRate || !line.fxInto || line.fxInto.toUpperCase() !== villageCurrency.toUpperCase()) return null;
  return convertAtRate(line.plannedMinor, line.currency, villageCurrency, line.fxRate);
}

export interface RateDrift {
  id: string;
  label: string;
  currency: string;
  plannedMinor: number;
  lockedRate: string;
  /** The figure at the locked rate, which is what counts. */
  lockedMinor: number | null;
  /** Today's stored rate, or null when there is none. */
  todayRate: number | null;
  /** The figure at today's rate. Shown, never applied. */
  todayMinor: number | null;
  /** Percent from the locked figure, one decimal. */
  pct: number | null;
  overThreshold: boolean;
}

/**
 * DRIFT, DISPLAY ONLY (spec 5a, guard 2): "at today's rate this would be
 * ₡612,000 (+3.1%)". Nothing reads this to move a figure; a person
 * re-locks if they choose to.
 */
export function rateDrift(
  line: Pick<FigureLine, "id" | "label" | "currency" | "plannedMinor" | "fxRate" | "fxInto"> & { labelOverride?: string | null },
  villageCurrency: string,
  todayRate: number | null,
): RateDrift {
  const lockedMinor = line.fxRate ? convertAtRate(line.plannedMinor, line.currency, villageCurrency, line.fxRate) : null;
  const todayMinor = todayRate !== null && todayRate > 0 ? convertAtRate(line.plannedMinor, line.currency, villageCurrency, todayRate) : null;
  const pct = lockedMinor && todayMinor !== null ? Math.round(((todayMinor - lockedMinor) / lockedMinor) * 1000) / 10 : null;
  return {
    id: line.id,
    // The label members read: a holder's rename before a source's own words (V6).
    label: line.labelOverride ?? line.label,
    currency: line.currency,
    plannedMinor: line.plannedMinor,
    lockedRate: String(line.fxRate ?? ""),
    lockedMinor,
    todayRate,
    todayMinor,
    pct,
    overThreshold: pct !== null && Math.abs(pct) > DRIFT_WARN_PCT,
  };
}

export interface MoonSpan {
  id: string;
  startsOn: string;
  endsOn: string;
  days: number;
}

/** The days two inclusive ranges share. 0 when they do not touch. */
export function sharedDays(a: { startsOn: string; endsOn: string }, b: { startsOn: string; endsOn: string }): number {
  const from = a.startsOn > b.startsOn ? a.startsOn : b.startsOn;
  const to = a.endsOn < b.endsOn ? a.endsOn : b.endsOn;
  return to < from ? 0 : daysInclusive(from, to);
}

/**
 * What one line gives a moon. A line for that very moon counts whole. Any other
 * counts `floor(planned x shared days / line days)`: rounded down, so the
 * shares one line gives the moons it crosses never add up to more than the
 * line (the property test pins it).
 */
export function lineShareOfMoon(line: Pick<FigureLine, "periodKind" | "periodKey" | "startsOn" | "endsOn" | "plannedMinor">, moon: MoonSpan): { sharedDays: number; lineDays: number; countedMinor: number; whole: boolean } {
  const lineDays = daysInclusive(line.startsOn, line.endsOn);
  const shared = sharedDays(line, moon);
  if (line.periodKind === "moon" && line.periodKey === moon.id) return { sharedDays: shared, lineDays, countedMinor: line.plannedMinor, whole: true };
  if (shared <= 0 || lineDays <= 0) return { sharedDays: 0, lineDays, countedMinor: 0, whole: false };
  if (shared >= lineDays) return { sharedDays: shared, lineDays, countedMinor: line.plannedMinor, whole: true };
  return { sharedDays: shared, lineDays, countedMinor: Math.floor((line.plannedMinor * shared) / lineDays), whole: false };
}

export type NotCountedReason = "status" | "currency" | "no_currency" | "not_adopted" | "unmatched" | "no_circle" | "name_held";

/** Why a line touching the moon does not count, or null when it counts (R7, R8). */
export function whyNotCounted(line: FigureLine, villageCurrency: string | null): NotCountedReason | null {
  if (line.status !== "approved" && line.status !== "closed") return "status";
  if (!villageCurrency) return "no_currency";
  if (!line.matched) return "unmatched";
  // Every line that counts names a circle, or the village-wide scope (R34, M10).
  if (!line.circleId) return "no_circle";
  if (line.nameHeld) return "name_held";
  if (inVillageCurrency(line, villageCurrency) === null) return "currency";
  if (line.source === "sera" && !line.adoptedAt) return "not_adopted";
  return null;
}

export type DropReason = "village_line" | "circle_line" | "role_line";

/** A line about the whole village: the village-wide scope (or, read the old way, no circle), with no role. */
export const isVillageWide = (l: Pick<FigureLine, "circleId" | "roleId">): boolean => l.roleId === null && (l.circleId === VILLAGE_WIDE || l.circleId === null);

/**
 * PRECEDENCE, by moon and scope, never by period key (R4, M6, decided). Among
 * the lines that count and touch this moon, per category, a line from the
 * village's own people (an upload or a hand line):
 *
 *   village-wide         drops every line a source sent in that category;
 *   on a circle          drops every source line for that circle, its role
 *                        lines included;
 *   for a circle's role  drops the source's line for that same circle and role.
 *
 * Village-wide is its own scope, whatever circle the village's dial names
 * (M2), so the dial moves no figure.
 */
export function precedence(lines: readonly FigureLine[]): { kept: FigureLine[]; dropped: Array<{ id: string; by: DropReason }> } {
  const dropped = new Map<string, DropReason>();
  for (const category of BUDGET_CATEGORIES) {
    const inCat = lines.filter((l) => l.category === category);
    const own = inCat.filter((l) => l.source !== "sera");
    const sera = inCat.filter((l) => l.source === "sera");
    if (!sera.length) continue;
    if (own.some(isVillageWide)) {
      for (const l of sera) dropped.set(l.id, "village_line");
      continue;
    }
    const circles = new Set(own.filter((l) => l.roleId === null && !isVillageWide(l)).map((l) => l.circleId));
    const roles = new Set(own.filter((l) => l.roleId !== null).map((l) => `${l.circleId}|${l.roleId}`));
    for (const l of sera) {
      if (l.circleId !== null && circles.has(l.circleId)) dropped.set(l.id, "circle_line");
      else if (l.roleId !== null && roles.has(`${l.circleId}|${l.roleId}`)) dropped.set(l.id, "role_line");
    }
  }
  return { kept: lines.filter((l) => !dropped.has(l.id)), dropped: Array.from(dropped, ([id, by]) => ({ id, by })) };
}

/** The cash committed to this moon's work, by where it came from (R7). */
export interface CommittedParts {
  /** `cash_owed` role rows whose decoded cycle is this moon, allowances left out. */
  roleMinor: number;
  /** `cash_owed` quest rows owed inside the moon. */
  questMinor: number;
  /** `cash_owed` proposal rows owed inside the moon. */
  proposalMinor: number;
  /** Cash on work set this moon with no `cash_owed` row yet (the valuation lane's records). */
  settingsMinor: number;
  /** Allowance rows of this moon. Shown, and counted against materials, never against role pay (P3). */
  materialsMinor: number;
  /** Rows in another currency, which the figure cannot add. */
  otherCurrencyRows: number;
  /** The newest `owed_at` among the rows the committed figure counts: its "as of" (R29). */
  asOf?: string | null;
  /**
   * Cash set this moon with no `cash_owed` row yet, answered in a currency that
   * is not the village's: left out of the figure, never summed across
   * currencies, and named here so the working says why.
   */
  settingsCurrencyIgnored?: { currency: string; minor: number; rows: number } | null;
}

export const NO_COMMITMENTS: CommittedParts = { roleMinor: 0, questMinor: 0, proposalMinor: 0, settingsMinor: 0, materialsMinor: 0, otherCurrencyRows: 0, asOf: null, settingsCurrencyIgnored: null };

export interface FigureWorkingLine {
  id: string;
  label: string;
  source: BudgetSource;
  category: BudgetCategory;
  periodKind: PeriodKind;
  periodKey: string;
  /** The line's own amount, in its own currency. */
  plannedMinor: number;
  currency: string;
  /** The amount in the village's currency: itself, or converted at the locked rate before pro-rating. */
  convertedMinor: number;
  /** The locked rate, its source, its date and who locked it, when the line is in another currency. */
  fx: { rate: string; source: string | null; asOf: string | null; lockedBy: string | null; lockedAt: string | null } | null;
  lineDays: number;
  sharedDays: number;
  countedMinor: number;
  whole: boolean;
}

/** The figure's working, as data. The client words it through Lingui (R7, R28). */
export interface FigureWorking {
  moon: MoonSpan;
  lines: FigureWorkingLine[];
  dropped: Array<{ id: string; by: DropReason }>;
  notCounted: Array<{ id: string; reason: NotCountedReason; currency: string }>;
  committed: CommittedParts;
}

export interface CashBudgetLeft {
  plannedMinor: number;
  committedMinor: number;
  leftMinor: number;
  currency: string;
  /** The budget state the figure came from, for the valuation lane's setting record to store. */
  revision: string;
  working: FigureWorking;
}

/** The cash committed parts that count against role pay and quest pay. */
export const committedTotal = (c: CommittedParts): number => c.roleMinor + c.questMinor + c.proposalMinor + c.settingsMinor;

/**
 * THE MOON'S FIGURE (R7). Null when no line that counts touches the moon in
 * role pay or quest pay, or when the village has no currency set (R8).
 * Otherwise planned, committed and `left = max(0, planned - committed)`.
 */
export function budgetFigure(
  lines: readonly FigureLine[],
  moon: MoonSpan,
  villageCurrency: string | null,
  committed: CommittedParts,
  revision: string,
): CashBudgetLeft | null {
  const touching = lines.filter((l) => CASH_CATEGORIES.includes(l.category) && sharedDays(l, moon) > 0);
  const notCounted: FigureWorking["notCounted"] = [];
  const counting: FigureLine[] = [];
  for (const l of touching) {
    const why = whyNotCounted(l, villageCurrency);
    if (why === null) counting.push(l);
    else if (l.status !== "withdrawn") notCounted.push({ id: l.id, reason: why, currency: l.currency });
  }
  if (!villageCurrency || counting.length === 0) return null;
  const { kept, dropped } = precedence(counting);
  const workingLines: FigureWorkingLine[] = kept.map((l) => {
    // Converted first, then pro-rated (spec 5a: "pro-rating applies after conversion").
    const convertedMinor = inVillageCurrency(l, villageCurrency)!;
    const s = lineShareOfMoon({ ...l, plannedMinor: convertedMinor }, moon);
    const fx = l.currency.toUpperCase() === villageCurrency.toUpperCase() || !l.fxRate
      ? null
      : { rate: l.fxRate, source: l.fxSource ?? null, asOf: l.fxAsOf ?? null, lockedBy: l.fxLockedBy ?? null, lockedAt: l.fxLockedAt ?? null };
    return { id: l.id, label: l.label, source: l.source, category: l.category, periodKind: l.periodKind, periodKey: l.periodKey, plannedMinor: l.plannedMinor, currency: l.currency, convertedMinor, fx, ...s };
  });
  const plannedMinor = workingLines.reduce((n, l) => n + l.countedMinor, 0);
  const committedMinor = committedTotal(committed);
  return {
    plannedMinor,
    committedMinor,
    leftMinor: Math.max(0, plannedMinor - committedMinor),
    currency: villageCurrency.toUpperCase(),
    revision,
    working: { moon, lines: workingLines, dropped, notCounted, committed },
  };
}

const zeroByCategory = (): Record<BudgetCategory, number> => ({ role_pay: 0, quest_pay: 0, materials: 0, other: 0 });

/** One moon's plan: every category, every circle, from the lines that count (R30, R31). */
export interface MoonPlan {
  moonId: string;
  byCategory: Record<BudgetCategory, number>;
  /** Role pay and quest pay: the planned part of the moon's cash figure (R7). */
  cashPlannedMinor: number;
  /** Every category together. */
  totalMinor: number;
  /** Per circle, the village-wide scope first as its own entry (`VILLAGE_WIDE`), then by circle id. */
  byCircle: Array<{ circleId: string | null; byCategory: Record<BudgetCategory, number>; totalMinor: number }>;
  /** The lines that gave this moon something, for its "as of" (R29). */
  lineIds: string[];
}

/**
 * WHAT A MOON PLANS, by category and by circle (R30, R31): the lines that
 * count (R7, R8), precedence by moon and scope (R4), converted at a locked
 * rate and pro-rated after conversion. The same arithmetic the figure uses,
 * so its role pay and quest pay are the figure's planned amount.
 */
export function moonPlan(lines: readonly FigureLine[], moon: MoonSpan, villageCurrency: string | null): MoonPlan {
  const out: MoonPlan = { moonId: moon.id, byCategory: zeroByCategory(), cashPlannedMinor: 0, totalMinor: 0, byCircle: [], lineIds: [] };
  if (!villageCurrency) return out;
  const counting = lines.filter((l) => sharedDays(l, moon) > 0 && whyNotCounted(l, villageCurrency) === null);
  const circles = new Map<string, MoonPlan["byCircle"][number]>();
  for (const l of precedence(counting).kept) {
    const minor = lineShareOfMoon({ ...l, plannedMinor: inVillageCurrency(l, villageCurrency)! }, moon).countedMinor;
    if (minor > 0) out.lineIds.push(l.id);
    out.byCategory[l.category] += minor;
    const key = l.circleId ?? "";
    const c = circles.get(key) ?? { circleId: l.circleId, byCategory: zeroByCategory(), totalMinor: 0 };
    c.byCategory[l.category] += minor;
    c.totalMinor += minor;
    circles.set(key, c);
  }
  out.cashPlannedMinor = CASH_CATEGORIES.reduce((n, c) => n + out.byCategory[c], 0);
  out.totalMinor = BUDGET_CATEGORIES.reduce((n, c) => n + out.byCategory[c], 0);
  const first = (id: string | null) => id === null || id === VILLAGE_WIDE;
  out.byCircle = Array.from(circles.values()).sort((a, b) => (first(a.circleId) ? -1 : first(b.circleId) ? 1 : a.circleId! < b.circleId! ? -1 : 1));
  return out;
}

/**
 * WHAT A CALLER HANDS THE ENGINE (R7). The share is always a number, so null
 * never reaches the engine's `??`; `budgetSet` is false only for no budget at
 * all, so a budget with 0 left still reads as a budget to `settleDeficit`.
 */
export function moonCashTerms(left: Pick<CashBudgetLeft, "leftMinor"> | null, baseToSetMinor: number): { cashSharePct: number; budgetSet: boolean } {
  return { cashSharePct: cycleCashShare(left?.leftMinor ?? null, baseToSetMinor), budgetSet: left !== null };
}

/** The moon's share as the preview shows it before and after a write (R10). */
export interface ShareState {
  moonId: string;
  set: boolean;
  leftMinor: number | null;
  /** Null until the valuation lane hands in the moon's base still to set. */
  sharePct: number | null;
}

export function shareState(moonId: string, left: CashBudgetLeft | null, baseToSetMinor: number | null): ShareState {
  return { moonId, set: left !== null, leftMinor: left ? left.leftMinor : null, sharePct: baseToSetMinor === null ? null : moonCashTerms(left, baseToSetMinor).cashSharePct };
}

/** Whether a write moved the share, or flipped it between set and unset (R10). */
export function shareMoved(before: ShareState, after: ShareState): boolean {
  return before.set !== after.set || before.leftMinor !== after.leftMinor || before.sharePct !== after.sharePct;
}
