/**
 * THE ONE PARSER for a proposed change to a circle's words (the `update_circle`
 * op). The card's editor checks with it before it sends, the route refuses
 * with it, the draft preview blocks a line with it, and the publish refuses
 * again with it inside the transaction. So the sentence a member reads under
 * their text box and the one the server sends are the same words.
 *
 * A payload names only the fields it changes:
 *
 *   purpose            text, up to 2000 characters, on `circles.purpose`
 *   existsWhile        one line, up to 300
 *   the nine lists     a list of lines, or one text with a line each
 *   values             up to two { value, practice } pairs, or text lines
 *                      written "Value: practice"
 *
 * `null`, an empty list or blank text clears a field. A key the payload does
 * not carry is not touched. Every line passes the role words' own checks: no
 * payment details, and links only as https.
 *
 * Pure: no pool, no clock, no Node builtins.
 */
import {
  CHARTER_ITEM_MAX,
  CHARTER_LIST_FIELDS,
  CHARTER_LIST_LIMITS,
  CIRCLE_PURPOSE_MAX,
  CIRCLE_VALUE_NAME_MAX,
  CIRCLE_VALUE_PRACTICE_MAX,
  CIRCLE_VALUES_MAX,
  EXISTS_WHILE_MAX,
  type CharterListField,
  type CircleValue,
} from "./circleCharter";
import { CIRCLE_HEADINGS, CIRCLE_CARD_WORDS, CIRCLE_WORD_REFUSALS as R } from "./circleCardWords";
import { textProblem, type ParseResult } from "./roleHandoverParse";

/** Every key an `update_circle` payload may carry, in the card's order. */
export const CIRCLE_WORD_KEYS = ["purpose", "existsWhile", ...CHARTER_LIST_FIELDS, "values"] as const;
export type CircleWordKey = (typeof CIRCLE_WORD_KEYS)[number];

/** A parsed payload: each named field as it will be stored, `null` to clear it. */
export type CircleWordsPayload = Partial<{
  purpose: string | null;
  existsWhile: string | null;
  values: CircleValue[] | null;
}> &
  Partial<Record<CharterListField, string[] | null>>;

/** The plain label a refusal is prefixed with, the heading the card prints. */
export function circleWordLabel(key: CircleWordKey): string {
  if (key === "existsWhile") return CIRCLE_CARD_WORDS.existsWhile;
  return CIRCLE_HEADINGS[key];
}

function parseText(v: unknown, max: number): ParseResult<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, problem: R.notWords };
  const s = v.trim();
  if (!s) return { ok: true, value: null };
  if (s.length > max) return { ok: false, problem: R.textTooLong(max) };
  const p = textProblem(s);
  return p ? { ok: false, problem: p } : { ok: true, value: s };
}

function rawLines(v: unknown): unknown[] | null {
  if (typeof v === "string") return v.split(/\r?\n/);
  if (Array.isArray(v)) return v;
  return null;
}

/** One of the nine lists, held to its own limits. */
export function parseCharterList(field: CharterListField, v: unknown): ParseResult<string[] | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  const raw = rawLines(v);
  if (!raw) return { ok: false, problem: R.notWords };
  const items: string[] = [];
  for (const item of raw) {
    if (item === null || item === undefined) continue;
    if (typeof item !== "string") return { ok: false, problem: R.notWords };
    const s = item.trim();
    if (!s) continue;
    if (s.length > CHARTER_ITEM_MAX) return { ok: false, problem: R.itemTooLong(CHARTER_ITEM_MAX) };
    const p = textProblem(s);
    if (p) return { ok: false, problem: p };
    items.push(s);
  }
  if (!items.length) return { ok: true, value: null };
  const { min, max } = CHARTER_LIST_LIMITS[field];
  if (items.length > max) return { ok: false, problem: R.tooMany(max) };
  if (items.length < min) return { ok: false, problem: R.tooFew(min, max) };
  return { ok: true, value: items };
}

/** The circle's own values: pairs, or text lines written "Value: practice". */
export function parseCircleValues(v: unknown): ParseResult<CircleValue[] | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  const raw = rawLines(v);
  if (!raw) return { ok: false, problem: R.notWords };
  const pairs: CircleValue[] = [];
  for (const item of raw) {
    if (item === null || item === undefined) continue;
    let value: unknown;
    let practice: unknown;
    if (typeof item === "string") {
      if (!item.trim()) continue;
      const at = item.indexOf(":");
      if (at < 0) return { ok: false, problem: R.valueShape };
      value = item.slice(0, at);
      practice = item.slice(at + 1);
    } else if (typeof item === "object") {
      value = (item as Record<string, unknown>).value;
      practice = (item as Record<string, unknown>).practice;
    } else return { ok: false, problem: R.notWords };
    if (typeof value !== "string" || typeof practice !== "string") return { ok: false, problem: R.valueShape };
    const v1 = value.trim();
    const p1 = practice.trim();
    if (!v1 || !p1) return { ok: false, problem: R.valueShape };
    if (v1.length > CIRCLE_VALUE_NAME_MAX || p1.length > CIRCLE_VALUE_PRACTICE_MAX) {
      return { ok: false, problem: R.valueTooLong(CIRCLE_VALUE_NAME_MAX, CIRCLE_VALUE_PRACTICE_MAX) };
    }
    const p = textProblem(v1) ?? textProblem(p1);
    if (p) return { ok: false, problem: p };
    pairs.push({ value: v1, practice: p1 });
  }
  if (pairs.length > CIRCLE_VALUES_MAX) return { ok: false, problem: R.valuesTooMany(CIRCLE_VALUES_MAX) };
  return { ok: true, value: pairs.length ? pairs : null };
}

/** One field, by its payload key. */
export function parseCircleWord(key: CircleWordKey, v: unknown): ParseResult<string | string[] | CircleValue[] | null> {
  if (key === "purpose") return parseText(v, CIRCLE_PURPOSE_MAX);
  if (key === "existsWhile") return parseText(v, EXISTS_WHILE_MAX);
  if (key === "values") return parseCircleValues(v);
  return parseCharterList(key, v);
}

/**
 * A whole `update_circle` payload. Keys it does not know are dropped; a
 * payload that names none of the circle's words is refused, because a change
 * that changes nothing is not a change. A refusal is prefixed with the plain
 * heading of the field it is about.
 */
export function parseCircleWords(payload: unknown): ParseResult<CircleWordsPayload> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, problem: R.nothingNamed };
  const body = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of CIRCLE_WORD_KEYS) {
    if (!(key in body) || body[key] === undefined) continue;
    const r = parseCircleWord(key, body[key]);
    if (!r.ok) return { ok: false, problem: `${circleWordLabel(key)}: ${r.problem}` };
    out[key] = r.value;
  }
  if (!Object.keys(out).length) return { ok: false, problem: R.nothingNamed };
  return { ok: true, value: out as CircleWordsPayload };
}

/** The keys a payload names, for "Proposed, waiting for consent" beside each. */
export function circleWordKeysOf(payload: unknown): CircleWordKey[] {
  if (!payload || typeof payload !== "object") return [];
  return CIRCLE_WORD_KEYS.filter((k) => (payload as Record<string, unknown>)[k] !== undefined);
}
