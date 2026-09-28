/**
 * THE CLOSING SECTION OF THE EXIT POLICY, on the server: how it is written,
 * how the launch checklist reads it, and when the redemption screen mentions
 * it. The registry and the rules every surface shares are in
 * shared/closingPolicies.ts; read that header first.
 *
 * ── ONE WRITER, AND IT IS NOT THE EXIT POLICY'S OWN PUT ───────────────────
 *
 * The section is written by `PUT /api/admin/exit-policy/closing`
 * (server/routes/closingPolicy.ts) and by nothing else. The exit policy's own
 * `PUT /api/admin/exit-policy` replaces the whole document on every save, so
 * `normalizeExitPolicy` CARRIES the stored section forward and never reads one
 * from that body. Two reasons it is kept apart:
 *
 *   1. WHO ADOPTED IT IS STAMPED HERE, from the session. A body that could
 *      carry `adoptedBy` would let any save claim that somebody else adopted
 *      the words, and "a human saying done is evidence, anonymous state is
 *      not" (server/lib/launch.ts) is the whole point of the stamp.
 *   2. AN EDITOR LOADED BEFORE THE ADOPTION cannot erase it by saving the rest
 *      of the policy afterwards, because that save never touches this section.
 *
 * Gated exactly as the exit policy is: `isAdmin`, the same gate its PUT
 * calls. No transferable power covers the exit policy today (the plan's
 * "consequence pen" says so), so the writers of this section are the writers
 * of that document. The village may PROPOSE a change from day one (the dials
 * ruling of 2026-09-25); the member page carries that door.
 *
 * ── ADOPTION IS AN ACT, AND THE DEFAULT'S WORDS ALONE NEVER COUNT ─────────
 *
 * The editor pre-fills the statement from the chosen policy's default text.
 * Saving those words records a DRAFT. The section counts as named only when
 * the save says `adopt: true`, and then the server writes who and when. That
 * is `exit-policy-terms` in a second shape: the platform's words are offered,
 * and offering them is not the village deciding them.
 *
 * Re-adopting the same words keeps the first adoption's stamp, so saving an
 * unchanged section twice does not move the date the village made its
 * promise. Changed words are a new promise and get a new stamp. A save
 * without `adopt` turns the section back into a draft, deliberately: the
 * checkbox is how a founder says "not agreed yet", and the launch row reads
 * that honestly.
 */
import type { Pool } from "mysql2/promise";
import { readConfigDocument } from "../repos/appConfigDocs";
import {
  closingNamed,
  closingPolicyDef,
  closingStatementProblem,
  redemptionClosingNotice,
  type ClosingSection,
} from "../../shared/closingPolicies";

/** The `checkKey` of the launch row, spelled once so the registry and the resolver cannot drift. */
export const CLOSING_CHECK_KEY = "closing-policy-named";

/** The app_config key the exit policy lives under (server/index.ts `exitPolicyRepo`). */
const EXIT_POLICY_KEY = "exit-policy";

export type ClosingWrite =
  | { ok: true; section: ClosingSection }
  | { ok: false; status: 400 | 401; error: string; message: string };

const sameWords = (a: unknown, b: unknown): boolean =>
  String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() ===
  String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Turn an admin's body into the section to store, or the refusal.
 *
 * PURE: the stored section, the account and the clock all arrive as
 * arguments, so every rule here is tested without a server.
 *
 * @param body   `{ policyId, statement, adopt }` from the request
 * @param stored the section already on record, or anything else
 * @param by     the admin account writing, from the session
 * @param now    the instant an adoption is stamped with
 */
export function closingWrite(body: unknown, stored: unknown, by: string | null, now: Date): ClosingWrite {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const policyId = typeof b.policyId === "string" ? b.policyId.trim() : "";
  const statement = typeof b.statement === "string" ? b.statement.trim() : "";
  const problem = closingStatementProblem(policyId, statement);
  if (problem) return { ok: false, status: 400, error: "closing_policy_invalid", message: problem };

  if (b.adopt !== true) {
    return { ok: true, section: { policyId, statement, adoptedBy: null, adoptedAt: null } };
  }
  if (!by) {
    return {
      ok: false,
      status: 401,
      error: "auth_required",
      message: "Adopting what closing means needs a named admin, so the record can say who",
    };
  }
  const prior = closingNamed(stored) ? (stored as ClosingSection) : null;
  if (prior && prior.policyId === policyId && sameWords(prior.statement, statement)) {
    return { ok: true, section: { policyId, statement, adoptedBy: prior.adoptedBy ?? by, adoptedAt: prior.adoptedAt } };
  }
  return { ok: true, section: { policyId, statement, adoptedBy: by, adoptedAt: now.toISOString() } };
}

/**
 * The launch row's reading of one section.
 *
 * NEVER THROWS AND NEVER ERRORS ON AN OLD DOCUMENT. Every exit policy saved
 * before this section existed has no `closing` key, live Amora's included,
 * and that reads MISSING with a sentence, which is the truth about it. A
 * section some future release wrote in a shape this one does not know reads
 * missing too, naming what is wrong, rather than taking the checklist down.
 */
export function closingCheckOf(section: unknown): { state: "ok" | "missing"; detail: string } {
  if (closingNamed(section)) {
    // No date here: this file has no village timezone, and a UTC day read
    // beside the editor's local one would tell a founder two different days.
    const s = section as ClosingSection;
    const def = closingPolicyDef(s.policyId);
    return { state: "ok", detail: `Named and adopted: ${def?.name ?? s.policyId}` };
  }
  if (!section || typeof section !== "object") {
    return {
      state: "missing",
      detail: "Nothing is named yet. Members reading the exit policy are told the village has not said what happens if it closes",
    };
  }
  const s = section as Partial<ClosingSection>;
  const problem = closingStatementProblem(s.policyId, s.statement);
  if (problem) return { state: "missing", detail: `The saved draft cannot be adopted as it stands. ${problem}` };
  return {
    state: "missing",
    detail: "Written and not adopted yet. The words count once somebody adopts them for the village",
  };
}

/** The raw stored section, read fresh from the document and never from a cache. */
async function storedClosing(pool: Pool): Promise<unknown> {
  const doc = await readConfigDocument<{ closing?: unknown }>(pool, EXIT_POLICY_KEY);
  return doc?.closing;
}

/**
 * The launch row, resolved. Called from server/lib/launch.ts, which has a
 * pool and no cache, the same shape the GPS row has.
 */
export async function closingLaunchCheck(pool: Pool): Promise<{ state: "ok" | "missing"; detail: string }> {
  return closingCheckOf(await storedClosing(pool));
}

/**
 * The sentence the redemption screen shows before a member asks, or null.
 * The rule is `redemptionClosingNotice` in the shared file; this only reads
 * the section it is asked about.
 */
export async function redemptionClosingNoticeFor(pool: Pool): Promise<string | null> {
  return redemptionClosingNotice(await storedClosing(pool));
}
