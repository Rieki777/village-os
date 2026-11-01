/**
 * ONE ROW OF THE PUBLIC AMENDMENT HISTORY, AS A STRANGER MAY READ IT.
 *
 * `GET /api/game/mechanics/history` is unauthenticated, and it used to hand
 * out each change's stored before and after values raw. The snapshot beside
 * it (`GET /api/game/mechanics`) already withholds a dial that can carry a
 * credential (`publicValueFields`, shared/gameVariables.ts), which is what
 * closed the Alchemy key's first door on 2026-10-05. This was the second door
 * to the same value: the moment anybody set `tokens.base_rpc_url` through the
 * admin panel, `recordMechanicsChange` stored the URL, key and all, and this
 * feed published it to anyone who asked. The comment over the variables route
 * says the before and after "sit behind auth". They did not.
 *
 * The same rule as the snapshot, through the same function: a dial flagged
 * `withheld`, or a value SHAPED like a credential on a dial nobody flagged,
 * keeps its row, its label, its date and who changed it, and loses both
 * values. Both, because a row whose new value is a key often has the old key
 * as its previous value.
 */
import { VARIABLES_BY_KEY, withheldFromPublic, type VariableDef } from "../../shared/gameVariables";
import { isRedactedCredential } from "./credentialRedaction";

/** What a proposal's change shows where a value is held back. */
export const KEPT_PRIVATE = "(kept private)";

/**
 * THE SAME RULE FOR A PROPOSAL'S CHANGES, the other anonymous mechanics door.
 *
 * `GET /api/game/mechanics/proposals` serves each change's `from`, `to`, their
 * display forms and `currentValue`, the dial's LIVE value read at request
 * time; `/proposals/:id/document` and `/handoff` print the stored `from` and
 * `to` into markdown. None of the three asked this question. Today the one
 * flagged dial cannot reach them, because `validateChangeSet` refuses every
 * founder-held dial and `tokens.base_rpc_url` is one, so this is the second
 * lock and not the first: it holds the day a dial is flagged without being
 * founder-held, and for a credential-SHAPED value on an open dial, which is
 * the case `looksLikeCredential` exists for.
 */
export function changeIsWithheld(key: string, ...values: unknown[]): boolean {
  const def = VARIABLES_BY_KEY[key];
  if (def?.withheld) return true;
  return values.some((v) => v != null && withheldFromPublic({ withheld: undefined, value: String(v) }));
}

/** A change set safe to print into a public document: a withheld change keeps its key and loses both values. */
export function publicChangeSet<T extends { key: string; from?: unknown; to?: unknown }>(changes: T[]): T[] {
  return changes.map((c) => (changeIsWithheld(c.key, c.from, c.to) ? { ...c, from: KEPT_PRIVATE, to: KEPT_PRIVATE } : c));
}

/** A served proposal safe for the anonymous list: every value field of a withheld change goes, `currentValue` included. */
export function publicProposal<T extends { changes: any[] }>(served: T): T {
  return {
    ...served,
    changes: served.changes.map((c) =>
      changeIsWithheld(String(c.key), c.from, c.to, c.currentValue)
        ? { ...c, from: KEPT_PRIVATE, to: KEPT_PRIVATE, fromDisplay: KEPT_PRIVATE, toDisplay: KEPT_PRIVATE, currentValue: null, withheld: true }
        : c,
    ),
  };
}

export interface AmendmentRow {
  id: unknown;
  config_key: unknown;
  old_value: string | null;
  new_value: string | null;
  actor_user_id: unknown;
  source: unknown;
  proposal_ref: string | null;
  note: string | null;
  at: unknown;
}

export interface PublicAmendment {
  id: string;
  key: string;
  label: string;
  from: string | null;
  fromWasDefault: boolean;
  to: string | null;
  toIsDefault: boolean;
  /** True when the values were held back, so the page can say "kept private" instead of drawing nothing. */
  withheld: boolean;
  by: string | null;
  source: string;
  proposalRef: string | null;
  note: string | null;
  at: string;
}

export function publicAmendment(
  r: AmendmentRow,
  def: Pick<VariableDef, "label" | "default" | "withheld"> | undefined,
  by: string | null,
): PublicAmendment {
  // NULL stored = "the platform default at the time"; resolve to the CURRENT
  // default for display, marked so the page can say so.
  const from = r.old_value ?? def?.default ?? null;
  const to = r.new_value ?? def?.default ?? null;
  // A value the ledger stored with its key removed (credentialRedaction.ts) is
  // no longer credential-shaped, so it is held back by its marker, and the
  // feed says "kept private" where a key used to be, as it always did.
  const held = (v: string | null) =>
    withheldFromPublic({ withheld: def?.withheld, value: v ?? "" }) || isRedactedCredential(v);
  const withheld = !!def?.withheld || held(from) || held(to);
  return {
    id: String(r.id),
    key: String(r.config_key),
    label: def?.label ?? String(r.config_key),
    from: withheld ? "" : from,
    fromWasDefault: r.old_value == null,
    to: withheld ? "" : to,
    toIsDefault: r.new_value == null,
    withheld,
    by,
    source: String(r.source),
    proposalRef: r.proposal_ref ?? null,
    note: r.note ?? null,
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
  };
}
