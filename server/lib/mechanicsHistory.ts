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
import { withheldFromPublic, type VariableDef } from "../../shared/gameVariables";

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
  const held = (v: string | null) => withheldFromPublic({ withheld: def?.withheld, value: v ?? "" });
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
