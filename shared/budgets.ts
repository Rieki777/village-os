/**
 * THE CASH BUDGET, THE PURE HALF (budgets spec v0.2; tables in 0347).
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

/** Every mark a sheet might separate digits with, whatever its locale. */
const SEPARATOR = /[.,'\u2019\u00a0\u202f\u2009 \u066b\u066c]/g;
const CURRENCY_SYMBOL = new RegExp(String.raw`\p{Sc}`, "gu");
// Built with the constructor: the typecheck targets a language level that
// refuses the `u` flag on a literal (the reason server/lib/nameSwap.ts gives).
const DIGIT = new RegExp(String.raw`\p{Nd}`, "u");
const THREE_DIGITS = new RegExp(String.raw`^\p{Nd}{3}$`, "u");

function localeMarks(locale: string): { group: string; decimal: string } {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    return { group: parts.find((p) => p.type === "group")?.value ?? ",", decimal: parts.find((p) => p.type === "decimal")?.value ?? "." };
  } catch {
    return { group: ",", decimal: "." };
  }
}

/** The cell with any currency symbol and any code before or after the number taken off, and the code it named. */
function stripCurrency(raw: string): { text: string; code: string | null } {
  let text = raw.replace(CURRENCY_SYMBOL, " ").trim();
  let code: string | null = null;
  const lead = /^([A-Za-z]{1,3})\.?\s*(?=[\d\u2212.,-])/.exec(text);
  if (lead) {
    if (lead[1].length === 3) code = lead[1].toUpperCase();
    text = text.slice(lead[0].length);
  }
  const tail = /[\d.,]\s*([A-Za-z]{1,3})\.?$/.exec(text);
  if (tail) {
    if (tail[1].length === 3) code = code ?? tail[1].toUpperCase();
    text = text.slice(0, tail.index + 1);
  }
  return { text: text.trim(), code };
}

/**
 * Read one amount cell into minor units of `currency` (R12, R13).
 *
 * A JSON number is already a number and is only checked. Text is read under
 * the chosen format with `parseLocaleNumber`, after any currency symbol or
 * code is taken off. Refused: an empty cell, a formula cell, one separator
 * followed by exactly three digits unless the format was chosen, anything the
 * locale cannot read, a value below 0 (by value, so a Unicode minus is caught
 * too), more fraction digits than the currency has, and a code that is not the
 * line's currency.
 */
export function readAmount(cell: unknown, currency: string, format: NumberFormatChoice): AmountRead {
  const exp = exponentOf(currency);
  const unit = 10 ** exp;
  const finish = (n: number, shown: string): AmountRead => {
    if (n < 0) return { ok: false, reason: "negative", message: "A budget line plans an amount of 0 or more. Write a cut as a smaller amount." };
    const scaled = n * unit;
    const minor = Math.round(scaled);
    if (Math.abs(minor - scaled) > 1e-6) {
      return { ok: false, reason: "too_precise", message: `${currency} has ${exp} digit${exp === 1 ? "" : "s"} after the decimal mark, and this amount has more.` };
    }
    if (!Number.isSafeInteger(minor)) return { ok: false, reason: "too_large", message: "This amount is too large to keep exactly." };
    return { ok: true, minor: Object.is(minor, -0) ? 0 : minor, cell: shown };
  };

  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return { ok: false, reason: "unreadable", message: "This amount is not a number." };
    return finish(cell, String(cell));
  }
  const raw = String(cell ?? "");
  if (!raw.trim()) return { ok: false, reason: "empty", message: "Write the amount this line plans." };
  if (isFormulaCell(raw)) {
    return { ok: false, reason: "formula", message: "This cell starts like a formula. Write the amount itself, with no = + - or @ in front." };
  }
  const { text, code } = stripCurrency(raw.trim());
  if (code && code !== currency.toUpperCase()) {
    return { ok: false, reason: "currency_mismatch", message: `This amount says ${code} and the line is in ${currency.toUpperCase()}. Put ${code} in the currency column, or write the amount in ${currency.toUpperCase()}.` };
  }
  if (!text || !DIGIT.test(text)) return { ok: false, reason: "unreadable", message: "There is no number in this cell." };
  const marks = Array.from(text.matchAll(SEPARATOR));
  if (!format.chosen && marks.length === 1) {
    const after = text.slice((marks[0].index ?? 0) + 1);
    if (THREE_DIGITS.test(after)) {
      return {
        ok: false,
        reason: "ambiguous",
        message: `"${raw.trim().slice(0, 30)}" could be a whole number or a decimal, depending on the number format. Pick the format in the preview.`,
      };
    }
  }
  const n = parseLocaleNumber(text, format.locale);
  if (n === null) return { ok: false, reason: "unreadable", message: `This amount does not read as a number in the ${format.locale} format. Check the separators, or pick another format.` };
  // Fraction digits are counted off the text, so 1.500 is three digits even though it is 1.5.
  const { decimal } = localeMarks(format.locale);
  const decimalAt = text.lastIndexOf(decimal);
  const fraction = decimalAt >= 0 && text.split(decimal).length === 2 ? Array.from(text.slice(decimalAt + decimal.length)).filter((c) => DIGIT.test(c)).length : 0;
  if (fraction > exp) {
    return { ok: false, reason: "too_precise", message: `${currency} has ${exp} digit${exp === 1 ? "" : "s"} after the decimal mark, and this amount has ${fraction}.` };
  }
  return finish(n, raw.trim());
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
export function inVillageCurrency(line: Pick<FigureLine, "plannedMinor" | "currency" | "fxRate">, villageCurrency: string): number | null {
  if (line.currency.toUpperCase() === villageCurrency.toUpperCase()) return line.plannedMinor;
  if (!line.fxRate) return null;
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
export function rateDrift(line: Pick<FigureLine, "id" | "label" | "currency" | "plannedMinor" | "fxRate">, villageCurrency: string, todayRate: number | null): RateDrift {
  const lockedMinor = line.fxRate ? convertAtRate(line.plannedMinor, line.currency, villageCurrency, line.fxRate) : null;
  const todayMinor = todayRate !== null && todayRate > 0 ? convertAtRate(line.plannedMinor, line.currency, villageCurrency, todayRate) : null;
  const pct = lockedMinor && todayMinor !== null ? Math.round(((todayMinor - lockedMinor) / lockedMinor) * 1000) / 10 : null;
  return {
    id: line.id,
    label: line.label,
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

export type NotCountedReason = "status" | "currency" | "no_currency" | "not_adopted" | "unmatched";

/** Why a line touching the moon does not count, or null when it counts (R7, R8). */
export function whyNotCounted(line: FigureLine, villageCurrency: string | null): NotCountedReason | null {
  if (line.status !== "approved" && line.status !== "closed") return "status";
  if (!villageCurrency) return "no_currency";
  if (inVillageCurrency(line, villageCurrency) === null) return "currency";
  if (line.source === "sera" && !line.adoptedAt) return "not_adopted";
  if (!line.matched) return "unmatched";
  return null;
}

export type DropReason = "village_line" | "circle_line";

/**
 * PRECEDENCE, by moon and scope, never by period key (R4). Among the lines
 * that count and touch this moon, per category: a village-wide line from the
 * village's own people (an upload or a hand line) drops every line the
 * library sent in that category; a circle line of theirs drops the library's
 * lines for that circle.
 */
export function precedence(lines: readonly FigureLine[]): { kept: FigureLine[]; dropped: Array<{ id: string; by: DropReason }> } {
  const dropped = new Map<string, DropReason>();
  for (const category of BUDGET_CATEGORIES) {
    const inCat = lines.filter((l) => l.category === category);
    const own = inCat.filter((l) => l.source !== "sera");
    const sera = inCat.filter((l) => l.source === "sera");
    if (!sera.length) continue;
    if (own.some((l) => l.circleId === null && l.roleId === null)) {
      for (const l of sera) dropped.set(l.id, "village_line");
      continue;
    }
    const circles = new Set(own.filter((l) => l.circleId !== null && l.roleId === null).map((l) => l.circleId));
    for (const l of sera) if (l.circleId !== null && circles.has(l.circleId)) dropped.set(l.id, "circle_line");
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
}

export const NO_COMMITMENTS: CommittedParts = { roleMinor: 0, questMinor: 0, proposalMinor: 0, settingsMinor: 0, materialsMinor: 0, otherCurrencyRows: 0 };

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
