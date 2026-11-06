/**
 * A CIRCLE'S CHARTER: the words a circle lives by, shaped by the CCOS Circle
 * Charter and written in Amora's plain words.
 *
 * Rye, 2026-10-22: circle cards are the circle-level sibling of the player
 * role card. The words below belong to the circle, so they change only by
 * consent, through an org draft (the `update_circle` op), the same way a
 * role's words do. They live in `circle_charters` (migration 0270), one row
 * per circle, and the purpose stays where it always was, `circles.purpose`.
 *
 * What the CCOS template asks for and this file keeps:
 *
 *   existsWhile        "This circle exists while ..." (Purpose, its condition)
 *   accountabilities   what the circle answers for, 3 to 6 (Accountabilities / Outcomes)
 *   domains            what it looks after (Domains)
 *   authorities        what it may decide on its own (Authorities)
 *   responsibilities   what it does regularly (Responsibilities / Actions)
 *   stewardship        how it gives back more than it takes (Regenerative Stewardship)
 *   tools              what it relies on (Tools and Resources)
 *   checks             how it keeps power in balance (Checks & Balances)
 *   succession         how a role changes hands (Succession Planning)
 *   values             up to two of its own values, each with one practice
 *   livingAgreement    optional, a short living agreement
 *
 * What it leaves off, by the brief: policy and legal clauses (village level,
 * stated once), closing statements, AI Secretary specifics, signatures (the
 * adoption record stands in), and every number Amora can count itself.
 *
 * Pure: no pool, no clock, no Node builtins.
 */
import { readStoredRoleList } from "./roleHandover";

/** The list fields, in the order the card reads them. */
export const CHARTER_LIST_FIELDS = [
  "accountabilities",
  "domains",
  "authorities",
  "responsibilities",
  "stewardship",
  "checks",
  "succession",
  "livingAgreement",
  "tools",
] as const;
export type CharterListField = (typeof CHARTER_LIST_FIELDS)[number];

/** Every word the charter holds besides the purpose. */
export const CHARTER_FIELDS = ["existsWhile", ...CHARTER_LIST_FIELDS, "values"] as const;
export type CharterField = (typeof CHARTER_FIELDS)[number];

/** The `circle_charters` column each field writes. */
export const CHARTER_COLUMNS: Record<CharterField, string> = {
  existsWhile: "exists_while",
  accountabilities: "accountabilities",
  domains: "domains",
  authorities: "authorities",
  responsibilities: "responsibilities",
  stewardship: "stewardship",
  checks: "checks",
  succession: "succession",
  livingAgreement: "living_agreement",
  tools: "tools",
  values: "circle_values",
};

/** "This circle exists while ..." is one line. */
export const EXISTS_WHILE_MAX = 300;
/** The purpose's own limit, the one the admin circle form has always kept. */
export const CIRCLE_PURPOSE_MAX = 2000;
/** The most characters one line of a list may hold. */
export const CHARTER_ITEM_MAX = 200;
/** A circle names up to two values of its own. */
export const CIRCLE_VALUES_MAX = 2;
export const CIRCLE_VALUE_NAME_MAX = 40;
export const CIRCLE_VALUE_PRACTICE_MAX = 200;

/**
 * How many lines each list may hold. `min` applies only once a list is
 * written: an empty list is "not written yet", never refused. The CCOS
 * template sets 3 to 6 accountabilities and 3 to 7 lines of living agreement.
 */
export const CHARTER_LIST_LIMITS: Record<CharterListField, { min: number; max: number }> = {
  accountabilities: { min: 3, max: 6 },
  domains: { min: 1, max: 8 },
  authorities: { min: 1, max: 8 },
  responsibilities: { min: 1, max: 8 },
  stewardship: { min: 1, max: 6 },
  checks: { min: 1, max: 6 },
  succession: { min: 1, max: 6 },
  livingAgreement: { min: 3, max: 7 },
  tools: { min: 1, max: 8 },
};

/** One of the circle's own values, and the one practice that shows it is lived. */
export interface CircleValue {
  value: string;
  practice: string;
}

/** A circle's charter as stored. `null` on a field is "not written yet". */
export interface CircleCharter {
  existsWhile: string | null;
  accountabilities: string[] | null;
  domains: string[] | null;
  authorities: string[] | null;
  responsibilities: string[] | null;
  stewardship: string[] | null;
  checks: string[] | null;
  succession: string[] | null;
  livingAgreement: string[] | null;
  tools: string[] | null;
  values: CircleValue[] | null;
}

/** A circle with no charter row yet: every field unwritten. */
export const EMPTY_CHARTER: CircleCharter = {
  existsWhile: null,
  accountabilities: null,
  domains: null,
  authorities: null,
  responsibilities: null,
  stewardship: null,
  checks: null,
  succession: null,
  livingAgreement: null,
  tools: null,
  values: null,
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The stored values read back: the JSON text or the parsed value MySQL hands
 * over. A pair missing either half is dropped, and anything malformed reads as
 * `null`, so a bad row draws "not written yet" and never a broken card.
 */
export function readStoredValues(v: unknown): CircleValue[] | null {
  let x = v;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(x)) return null;
  const pairs = x
    .map((p) => (p && typeof p === "object" ? { value: text((p as any).value), practice: text((p as any).practice) } : null))
    .filter((p): p is CircleValue => !!p && p.value !== null && p.practice !== null)
    .slice(0, CIRCLE_VALUES_MAX);
  return pairs.length ? pairs : null;
}

/** A `circle_charters` row, as the driver returns it. */
export type CharterRow = Partial<Record<(typeof CHARTER_COLUMNS)[CharterField], unknown>>;

/** A stored row read back through the one reader per field. `null` is no row: every field unwritten. */
export function charterFromRow(row: CharterRow | null | undefined): CircleCharter {
  if (!row) return { ...EMPTY_CHARTER };
  const list = (f: CharterListField) => readStoredRoleList(row[CHARTER_COLUMNS[f] as keyof CharterRow]);
  return {
    existsWhile: text(row.exists_while),
    accountabilities: list("accountabilities"),
    domains: list("domains"),
    authorities: list("authorities"),
    responsibilities: list("responsibilities"),
    stewardship: list("stewardship"),
    checks: list("checks"),
    succession: list("succession"),
    livingAgreement: list("livingAgreement"),
    tools: list("tools"),
    values: readStoredValues(row.circle_values),
  };
}
