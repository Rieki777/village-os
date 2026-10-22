/**
 * WHAT A CHANGE DOES TO A ROLE'S WORDS, field by field, before and after.
 *
 * The structure review draws this under each role a change creates or moves,
 * so a steward reads the words that would change in plain language instead of
 * a payload. It covers the role's own words: its purpose, what it decides, why
 * it matters, what people can count on it for, and the handover words of 0268
 * ("Bring me", "Not mine to hold", the runbook).
 *
 * A role a change creates has no before, so every field it writes is listed.
 * A role a change moves lists only the fields its payload names whose words
 * differ from the live role's. A field the payload does not name is untouched
 * by the publish, so it is never listed.
 *
 * Pure: no pool, no clock.
 */
import { ROLE_HANDOVER_WORDS } from "./roleHandover";

/** A role's words as `/api/org` and the live chart read them. Every field optional. */
export interface RoleWordsLike {
  aim?: string | null;
  domain?: string | null;
  whyItMatters?: string | null;
  accountabilities?: readonly string[] | null;
  bringMe?: readonly string[] | null;
  notMine?: readonly string[] | null;
  runbook?: string | null;
}

export type RoleWordKey = keyof RoleWordsLike;

/** The fields, in the order the role card reads them, with the words for each. */
export const ROLE_WORD_FIELDS: ReadonlyArray<{ key: RoleWordKey; label: string; list: boolean }> = [
  { key: "aim", label: "Purpose", list: false },
  { key: "domain", label: "What it decides", list: false },
  { key: "whyItMatters", label: "Why it matters", list: false },
  { key: "accountabilities", label: "What people can count on it for", list: true },
  { key: "bringMe", label: ROLE_HANDOVER_WORDS.bringMe, list: true },
  { key: "notMine", label: ROLE_HANDOVER_WORDS.notMine, list: true },
  { key: "runbook", label: ROLE_HANDOVER_WORDS.runbook, list: false },
];

export const FIELD_CHANGE_WORDS = {
  before: "Before",
  after: "After",
  none: ROLE_HANDOVER_WORDS.notWritten,
} as const;

export interface FieldChange {
  key: RoleWordKey;
  label: string;
  /** The words before, or null when nothing was written (or the role is new). */
  before: string | null;
  /** The words after, or null when the change clears the field. */
  after: string | null;
}

/** A field's value as one line of words, or null for nothing written. Lists join with "; ". */
export function fieldWords(v: unknown, list: boolean): string | null {
  if (v === null || v === undefined) return null;
  if (list) {
    const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\r?\n/) : [];
    const clean = items.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean);
    return clean.length ? clean.join("; ") : null;
  }
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

/**
 * The fields a change writes, before and after. `before` is the live role's
 * words, or null for a role the change creates.
 */
export function roleFieldChanges(
  before: RoleWordsLike | null,
  payload: Record<string, unknown> | null | undefined,
): FieldChange[] {
  const p = payload ?? {};
  const out: FieldChange[] = [];
  for (const f of ROLE_WORD_FIELDS) {
    if (p[f.key] === undefined) continue;
    const after = fieldWords(p[f.key], f.list);
    const was = before ? fieldWords(before[f.key], f.list) : null;
    if (before === null && after === null) continue;
    if (before !== null && was === after) continue;
    out.push({ key: f.key, label: f.label, before: was, after });
  }
  return out;
}
