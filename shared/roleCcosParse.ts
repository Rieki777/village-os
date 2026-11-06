/**
 * THE ONE PARSER for a role's CCOS words (shared/roleCcos.ts). The draft
 * preview refuses with these sentences, the publish refuses again with the
 * same ones, a proposal from an outside service is read through them, and the
 * admin editor and the card's "Edit my card" show them under their inputs.
 *
 * Kept apart from `shared/roleCcos.ts` because it reads the payment-detail
 * rule from the terms model, which no module that moves value may reach
 * (`shared/seatSettings.boundary.test.ts` holds the wall).
 *
 * Pure: no pool, no clock, no Node builtins.
 */
import { looksLikePaymentDetails } from "./seatSettings";
import {
  CCOS_LIST_ITEM_MAX,
  CCOS_LIST_MAX_ITEMS,
  ROLE_CCOS_FIELDS,
  ROLE_CCOS_TEXT_MAX,
  ROLE_CCOS_WORDS,
  accountabilitiesProblem,
  isRoleCcosListField,
  payloadAccountabilitiesProblem,
  type RoleCcosField,
  type RoleCcosTextField,
} from "./roleCcos";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problem: string };

const PAYMENT_DETAILS = "This looks like a bank or card number. Payment details are never stored on a role.";

/** The two fields that print as one line: the inline "This role exists while" and the chip. */
const ONE_LINE: ReadonlySet<RoleCcosField> = new Set<RoleCcosField>(["existsWhile", "timeCommitment"]);

/**
 * "What I can decide on my own" or "What I do regularly", as a draft carries
 * it: a list of strings, or one string with an item per line (what an editor
 * sends). Items are trimmed and blank ones dropped. `null`, an empty list and
 * blank text all read as `null`: nothing written, which clears the field.
 */
export function parseCcosList(v: unknown): ParseResult<string[] | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  let raw: unknown[];
  if (typeof v === "string") raw = v.split(/\r?\n/);
  else if (Array.isArray(v)) raw = v;
  else return { ok: false, problem: ROLE_CCOS_WORDS.notWords };
  const items: string[] = [];
  for (const item of raw) {
    if (item === null || item === undefined) continue;
    if (typeof item !== "string") return { ok: false, problem: ROLE_CCOS_WORDS.notWords };
    const s = item.trim();
    if (!s) continue;
    if (s.length > CCOS_LIST_ITEM_MAX) return { ok: false, problem: ROLE_CCOS_WORDS.itemTooLong };
    if (looksLikePaymentDetails(s)) return { ok: false, problem: PAYMENT_DETAILS };
    items.push(s);
  }
  if (items.length > CCOS_LIST_MAX_ITEMS) return { ok: false, problem: ROLE_CCOS_WORDS.tooMany };
  return { ok: true, value: items.length ? items : null };
}

/** One text field, trimmed; blank reads as `null`, which clears it. */
export function parseCcosText(field: RoleCcosTextField, v: unknown): ParseResult<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, problem: ROLE_CCOS_WORDS.notWords };
  const s = v.trim();
  if (!s) return { ok: true, value: null };
  if (ONE_LINE.has(field) && /\r|\n/.test(s)) return { ok: false, problem: ROLE_CCOS_WORDS.oneLine };
  const max = ROLE_CCOS_TEXT_MAX[field];
  if (s.length > max) return { ok: false, problem: ROLE_CCOS_WORDS.textTooLong(max) };
  if (looksLikePaymentDetails(s)) return { ok: false, problem: PAYMENT_DETAILS };
  return { ok: true, value: s };
}

/** One CCOS field, by its draft key. */
export function parseRoleCcosField(field: RoleCcosField, v: unknown): ParseResult<string[] | string | null> {
  return isRoleCcosListField(field) ? parseCcosList(v) : parseCcosText(field, v);
}

/**
 * The first problem with any CCOS field a draft payload names, or with the
 * number of accountabilities it writes, or null. A key the payload does not
 * carry is not checked: an absent key changes nothing. A draft names the
 * canonical keys only; a proposal's column spellings are read into them by
 * `normaliseProposedSeat` (shared/proposedSeats.ts) before any draft exists.
 *
 * `op` is the change the payload rides on. Only a `create_seat` may carry in a
 * role that already exists elsewhere (`CARRIED_FROM_KEY`) and keep its own
 * count of accountabilities; an edit to a role here is always held to 3 to 6.
 */
export function roleCcosProblem(
  payload: Record<string, unknown> | null | undefined,
  op: "create_seat" | "update_seat" = "update_seat",
): string | null {
  if (!payload) return null;
  for (const f of ROLE_CCOS_FIELDS) {
    if (payload[f] === undefined) continue;
    const r = parseRoleCcosField(f, payload[f]);
    if (!r.ok) return `${ROLE_CCOS_WORDS[f]}: ${r.problem}`;
  }
  return op === "create_seat" ? payloadAccountabilitiesProblem(payload) : accountabilitiesProblem(payload.accountabilities);
}
