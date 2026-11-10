/**
 * A role's pay RANGE as the outside service holds it, read into one shape.
 *
 * Two sources, one rule: information beside a role, never a term. The sync
 * never writes terms (`shared/proposedSeats.ts` keeps money out of a proposal);
 * a person reads this range in the role editor and writes terms on their own
 * save.
 *
 *   1. STRUCTURED fields, when the service sends them: Pay Min, Pay Max,
 *      Currency, Per, Budget Line, Funded From, Pay Status.
 *   2. The free text of "Compensation Terms" ("Range: $800 to $1,200 per
 *      month"), read ONLY when it is unambiguous: exactly one range, a
 *      recognised currency, a recognised period. Anything else stays text.
 *
 * Pure: no pool, no clock, no network.
 */

export type PayPer = "hour" | "week" | "moon" | "month" | "season" | "year";
export type PayRangeStatus = "proposed" | "consented";
export type PayRangeFrom = "fields" | "text";

export interface PayRange {
  min: number;
  max: number;
  /** An upper-case code such as "USD". */
  currency: string;
  per: PayPer;
  budgetLine: string | null;
  fundedFrom: string | null;
  /** "proposed" until the people who hold the budget have consented. Null when not sent. */
  status: PayRangeStatus | null;
  /** Where the range was read from, so a person knows how much to trust it. */
  from: PayRangeFrom;
}

/** The structured field names, under the service's own words. */
export const PAY_RANGE_FIELDS = ["Pay Min", "Pay Max", "Currency", "Per", "Budget Line", "Funded From", "Pay Status"] as const;

const PERS: Record<string, PayPer> = {
  hour: "hour",
  hourly: "hour",
  week: "week",
  weekly: "week",
  moon: "moon",
  month: "month",
  monthly: "month",
  season: "season",
  year: "year",
  yearly: "year",
  annual: "year",
};

export function payPerOf(v: unknown): PayPer | null {
  if (typeof v !== "string") return null;
  return PERS[v.trim().toLowerCase().replace(/^per\s+|^a\s+|^every\s+|^\//, "")] ?? null;
}

const SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "₡": "CRC" };

export function currencyOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (SYMBOLS[t]) return SYMBOLS[t];
  return /^[A-Za-z]{3}$/.test(t) ? t.toUpperCase() : null;
}

function amountOf(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const t = v.trim().replace(/^[$€£₡]/, "").replace(/,/g, "");
    if (/^\d+(\.\d{1,2})?$/.test(t)) n = Number(t);
  }
  return n !== null && Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null;
}

function clip(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
}

function statusOf(v: unknown): PayRangeStatus | null {
  if (typeof v !== "string") return null;
  const k = v.trim().toLowerCase();
  return k === "proposed" ? "proposed" : k === "consented" ? "consented" : null;
}

/**
 * The structured range, or null when Min, Max, Currency or Per is missing or
 * unreadable, or when Min is above Max. A half-sent range is not guessed whole.
 */
export function rangeFromFields(f: {
  min?: unknown;
  max?: unknown;
  currency?: unknown;
  per?: unknown;
  budgetLine?: unknown;
  fundedFrom?: unknown;
  status?: unknown;
}): PayRange | null {
  const min = amountOf(f.min);
  const max = amountOf(f.max);
  const currency = currencyOf(f.currency);
  const per = payPerOf(f.per);
  if (min === null || max === null || currency === null || per === null || min > max) return null;
  return {
    min,
    max,
    currency,
    per,
    budgetLine: clip(f.budgetLine, 120),
    fundedFrom: clip(f.fundedFrom, 120),
    status: statusOf(f.status),
    from: "fields",
  };
}

// "$800 to $1,200", "USD 800-1200", "$800 - 1,200". The dash is a hyphen, an en dash or an em dash.
const RANGE =
  /(\$|\u20AC|\u00A3|\u20A1|USD|EUR|GBP|CRC)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:to|-|\u2013|\u2014)\s*(\$|\u20AC|\u00A3|\u20A1|USD|EUR|GBP|CRC)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;
const PER = /\b(?:per|a|every)\s+(hour|week|moon|month|season|year)\b|\b(hourly|weekly|monthly|yearly)\b|\/(hour|week|moon|month|season|year)\b/gi;

/**
 * The range in a "Compensation Terms" text, or null when there is not exactly
 * one unambiguous range with one currency and one period. Two ranges, a range
 * without a currency, a range without a period, or two different periods all
 * leave the text as text.
 */
export function rangeFromText(text: string | null | undefined): PayRange | null {
  if (typeof text !== "string" || text.length > 2000) return null;
  const ranges = Array.from(text.matchAll(RANGE));
  if (ranges.length !== 1) return null;
  const m = ranges[0];
  // Groups: 1 currency, 2 min, 3 optional second currency, 4 max.
  const c1 = currencyOf(m[1]);
  const c2 = m[3] ? currencyOf(m[3]) : null;
  if (!c1 || (c2 && c2 !== c1)) return null;
  const lo = amountOf(m[2]);
  const hi = amountOf(m[4]);
  if (lo === null || hi === null || lo > hi) return null;
  const pers = new Set<PayPer>();
  for (const p of Array.from(text.matchAll(PER))) {
    const per = payPerOf(p[1] ?? p[2] ?? p[3]);
    if (per) pers.add(per);
  }
  if (pers.size !== 1) return null;
  return { min: lo, max: hi, currency: c1, per: Array.from(pers)[0], budgetLine: null, fundedFrom: null, status: null, from: "text" };
}

/** A stored `range`, read defensively: what the payload says, or null. */
export function readPayRange(v: unknown): PayRange | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const r = rangeFromFields(o);
  if (!r) return null;
  return { ...r, from: o.from === "text" ? "text" : "fields" };
}
