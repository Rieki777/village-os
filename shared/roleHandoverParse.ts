/**
 * THE ONE PARSER for a role's handover words ("Bring me", "Not mine to hold",
 * the runbook). The draft preview refuses with these sentences, the publish
 * refuses again with the same ones, a proposal from an outside service is
 * read through them, and the editor shows them under its inputs.
 *
 * Kept apart from `shared/roleHandover.ts` because it reads the payment-detail
 * rule from the terms model, which no module that moves value may reach.
 *
 * Pure: no pool, no clock, no Node builtins.
 */
import { looksLikePaymentDetails } from "./seatSettings";
import {
  ROLE_HANDOVER_FIELDS,
  ROLE_HANDOVER_WORDS,
  ROLE_LIST_ITEM_MAX,
  ROLE_LIST_MAX_ITEMS,
  RUNBOOK_MAX,
  type RoleHandoverField,
} from "./roleHandover";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problem: string };

/** Any `scheme://` or a script-like scheme. Only https is ever kept. */
const SCHEME_LINK = /\b([a-z][a-z0-9+.-]*):\/\//gi;
/** A script-like scheme glued to what follows. "data: the readings" is words, and passes. */
const SCRIPT_SCHEME = /\b(?:javascript|data|vbscript|file):(?=\S)/i;

/** The first problem with links in a piece of text, or null. */
function linkProblem(text: string): string | null {
  if (SCRIPT_SCHEME.test(text)) return ROLE_HANDOVER_WORDS.httpsOnly;
  const re = new RegExp(SCHEME_LINK.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1].toLowerCase() !== "https") return ROLE_HANDOVER_WORDS.httpsOnly;
  }
  return null;
}

/** A text that is nothing but one link, read as a URL, which must be https with a host. */
function singleLinkProblem(text: string): string | null {
  if (/\s/.test(text) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return ROLE_HANDOVER_WORDS.notALink;
  }
  if (u.protocol !== "https:") return ROLE_HANDOVER_WORDS.httpsOnly;
  if (!u.hostname) return ROLE_HANDOVER_WORDS.notALink;
  return null;
}

/**
 * The checks every piece of free text on a role passes. Exported for a
 * circle's charter words (shared/circleCharterParse.ts), which keep the same rules.
 */
export function textProblem(text: string): string | null {
  if (looksLikePaymentDetails(text)) return ROLE_HANDOVER_WORDS.paymentDetails;
  return linkProblem(text) ?? singleLinkProblem(text);
}

/**
 * "Bring me" or "Not mine to hold", as a draft carries it.
 *
 * Accepts a list of strings, or one string with an item per line (what the
 * editor's text box sends). Items are trimmed and blank ones dropped. `null`,
 * an empty list and blank text all read as `null`: nothing written, which
 * clears the field on publish.
 */
export function parseRoleWordList(v: unknown, field: "bringMe" | "notMine"): ParseResult<string[] | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  let raw: unknown[];
  if (typeof v === "string") raw = v.split(/\r?\n/);
  else if (Array.isArray(v)) raw = v;
  else return { ok: false, problem: ROLE_HANDOVER_WORDS.notWords };
  const items: string[] = [];
  for (const item of raw) {
    if (item === null || item === undefined) continue;
    if (typeof item !== "string") return { ok: false, problem: ROLE_HANDOVER_WORDS.notWords };
    const s = item.trim();
    if (!s) continue;
    if (s.length > ROLE_LIST_ITEM_MAX) return { ok: false, problem: ROLE_HANDOVER_WORDS.itemTooLong };
    const p = textProblem(s);
    if (p) return { ok: false, problem: p };
    items.push(s);
  }
  if (items.length > ROLE_LIST_MAX_ITEMS) return { ok: false, problem: ROLE_HANDOVER_WORDS.tooMany };
  return { ok: true, value: items.length ? items : null };
}

/**
 * The runbook, as a draft carries it: words, or one https link. Trimmed;
 * blank reads as `null`, which clears it on publish.
 */
export function parseRunbook(v: unknown): ParseResult<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, problem: ROLE_HANDOVER_WORDS.notWords };
  const s = v.trim();
  if (!s) return { ok: true, value: null };
  if (s.length > RUNBOOK_MAX) return { ok: false, problem: ROLE_HANDOVER_WORDS.runbookTooLong };
  const p = textProblem(s);
  if (p) return { ok: false, problem: p };
  return { ok: true, value: s };
}

/** One handover field, by its draft key. */
export function parseRoleHandoverField(field: RoleHandoverField, v: unknown): ParseResult<string[] | string | null> {
  return field === "runbook" ? parseRunbook(v) : parseRoleWordList(v, field);
}

/**
 * The first problem with any handover field a draft payload names, or null.
 * A key the payload does not carry is not checked: an absent key changes
 * nothing.
 */
export function roleHandoverProblem(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;
  for (const f of ROLE_HANDOVER_FIELDS) {
    if (payload[f] === undefined) continue;
    const r = parseRoleHandoverField(f, payload[f]);
    if (!r.ok) return `${ROLE_HANDOVER_WORDS[f]}: ${r.problem}`;
  }
  return null;
}
