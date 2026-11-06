/**
 * Voting weight, resolved and recorded (round 5, lane G1; GOV_DESIGN 2.2).
 *
 * Three modes, chosen by the founder-held `governance.weight_mode`:
 *
 *   equal   every electorate member weighs 1. One person, one vote.
 *   token   weight = the member's balance of `governance.weight_token` at
 *           ballot open, read from the ledger's recomputed token_balances
 *           (recompute, never increment — the cache is already the truth by
 *           the time this reads it). Platform-governed tokens only: a
 *           hypha-governed mirror is a display-only fact about Base, and
 *           weighting votes by it would make this platform the cap table's
 *           second source of truth.
 *   custom  weight = the member's governance_weights row. Absent row = 0,
 *           fail closed: nobody holds power an admin never assigned.
 *
 * Every custom-mode change appends to governance_weight_changes with a
 * REQUIRED note. The trail is member-visible by design: weights are power,
 * and hidden power ends here.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { tokenDef, memberAccount } from "./ledger";
import { isListedForTrade } from "./exchange";
import { boolVar, numberVar, stringVar } from "./variables";
import { capWeights, fewestHoldersForCap } from "../../shared/governanceShare";

/**
 * The share arithmetic, re-exported so a server caller has ONE door to
 * everything about weight. It is pure and lives in `shared/` because the dry
 * run needs it and may not import this file: `shared/dryRun/` has no import
 * path to a connection, and this module opens one on its second line.
 */
export { capWeights, fewestHoldersForCap, shareOfTotal, topShares } from "../../shared/governanceShare";

export type WeightMode = "equal" | "token" | "custom";

/** The switch and the number for the cap on one member's weight (Rye, 2026-11-05). */
export const WEIGHT_CAP_ON_KEY = "governance.weight_cap_on";
export const WEIGHT_CAP_PCT_KEY = "governance.weight_cap_pct";

export interface WeightModeSnapshot {
  mode: WeightMode;
  /** The token slug when mode = token, else null. */
  token: string | null;
  /**
   * The cap on one member's share of the vote, in percent, when mode = token
   * and the cap is switched on. Null or absent means no cap, which is the
   * shipped posture, so a snapshot built before the cap existed reads the same.
   */
  capPct?: number | null;
}

/**
 * The weight-mode snapshot the NEXT ballot would freeze, read off the
 * founder-held dials. The one place that decides it: `server/index.ts` passes
 * this to every route module through deps, and none of them rebuilds it.
 *
 * The cap rides the snapshot only in token mode, the same way the token does,
 * because it is only in token mode that one member's weight can grow without
 * a steward allocating it.
 */
export function weightModeNow(): WeightModeSnapshot {
  const raw = stringVar("governance.weight_mode");
  const mode: WeightMode = raw === "token" || raw === "custom" ? raw : "equal";
  if (mode !== "token") return { mode, token: null, capPct: null };
  return {
    mode,
    token: stringVar("governance.weight_token").trim(),
    capPct: boolVar(WEIGHT_CAP_ON_KEY) ? numberVar(WEIGHT_CAP_PCT_KEY) : null,
  };
}

/**
 * What a member reads about the cap, or null when there is nothing to say: the
 * switch is off, or the mode is not token, where the cap does nothing.
 */
export function weightCapLine(snapshot: WeightModeSnapshot): string | null {
  if (snapshot.mode !== "token" || snapshot.capPct == null) return null;
  const share = `The cap is on: when a ballot opens, no member carries more than ${snapshot.capPct}% of the vote.`;
  // The same number `capWeights` switches on, so the sentence and the
  // arithmetic cannot disagree about where everyone starts to weigh the same.
  const fewest = fewestHoldersForCap(snapshot.capPct);
  if (!(fewest > 1) || !Number.isFinite(fewest)) return share;
  return `${share} With fewer than ${fewest} members holding weight, everyone weighs the same.`;
}

/**
 * Every weight on a WHOLE roll, as a ballot freezes it: `weightsFor`, then
 * the cap when the snapshot carries one.
 *
 * Its own function because the cap is a fact about the roll and never about
 * one member. `weightsFor` is also asked about a single member (a member's
 * own standing), and capping a roll of one would trim that member against
 * their own balance. Only a caller holding the whole roll may call this.
 */
export async function rollWeightsFor(
  pool: Pool,
  userIds: string[],
  snapshot: WeightModeSnapshot,
): Promise<Map<string, number>> {
  const weights = await weightsFor(pool, userIds, snapshot);
  if (snapshot.mode !== "token" || snapshot.capPct == null) return weights;
  return capWeights(weights, snapshot.capPct);
}

/**
 * Refuse a weight-token choice the engine may not conduct. Returns the
 * refusal sentence, or null when the token can weigh votes.
 *
 * ── WHY A LISTED TOKEN MAY NOT WEIGH A VOTE ─────────────────────────────────
 *
 * Until 2026-08-30 this refused exactly one thing, a hypha mirror, and the
 * reason was source-of-truth rather than power: weighting by a mirror would
 * make this platform the cap table's second author. That left every
 * platform-governed token eligible, INCLUDING one currently listed on the
 * exchange for a card payment. A founder pointing `governance.weight_token` at
 * the village's ordinary credit token, in `token` weight mode, turns every
 * dollar into voting weight, with nothing anywhere refusing it.
 *
 * So the rule the exchange states from its side ("the token that weighs votes
 * is not listed", `weightTokenListingProblem`) is stated here from this one:
 * a token that is listed does not weigh votes. Two doors, one rule, and
 * neither door can be reached without passing a check.
 *
 * THIS SIDE IS THE ONE THAT FAILS CLOSED IN THE GAP. The exchange's clause is
 * re-proven at boot and at every listing write; a founder who flips the mode
 * to `token` between two boots would otherwise have a listed weight token
 * until the next restart. This runs at every ballot open and inside
 * `weightsFor`, so during that gap the weights simply cannot be resolved and
 * no ballot opens.
 *
 * Deliberately NOT gated on `weight_mode`. Every caller already asks this only
 * when the mode is `token` (see `weightsFor` below), so re-reading the mode
 * here would add a second copy of that judgment and no safety.
 */
export function weightTokenProblem(slug: string): string | null {
  const def = tokenDef(slug);
  if (!def) return `No token called "${slug}" exists in this village's registry`;
  if (def.governance !== "platform") {
    return `${def.name} is governed on Hypha and only mirrored here. Voting weight reads platform-governed tokens only`;
  }
  if (isListedForTrade(slug)) {
    return (
      `${def.name} is listed on the exchange, so anybody can buy it. A token money can buy is not what weighs a vote. ` +
      `Take it off the exchange, or weigh votes with something else`
    );
  }
  return null;
}

/**
 * Resolve each member's weight under a mode. Members absent from the returned
 * map weigh 0 by contract; the caller decides whether a zero-weight member
 * still enters the electorate (they do: an electorate row with weight 0 keeps
 * the record of who was asked, while adding nothing to any tally).
 */
export async function weightsFor(
  pool: Pool,
  userIds: string[],
  snapshot: WeightModeSnapshot,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  if (snapshot.mode === "equal") {
    for (const id of userIds) out.set(id, 1);
    return out;
  }
  if (snapshot.mode === "token") {
    const slug = snapshot.token ?? "";
    const problem = weightTokenProblem(slug);
    if (problem) throw new Error(problem);
    const accounts = userIds.map((id) => memberAccount(id));
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT account_id, balance FROM token_balances WHERE token_type = ? AND account_id IN (${accounts.map(() => "?").join(",")})`,
      [slug, ...accounts],
    );
    const byAccount = new Map(rows.map((r) => [String(r.account_id), Number(r.balance)]));
    for (const id of userIds) {
      // A negative member balance cannot happen outside faucet accounts; the
      // clamp is belt to that braces so weight never goes below zero.
      out.set(id, Math.max(0, byAccount.get(memberAccount(id)) ?? 0));
    }
    return out;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT user_id, weight FROM governance_weights WHERE user_id IN (${userIds.map(() => "?").join(",")})`,
    userIds,
  );
  const byUser = new Map(rows.map((r) => [String(r.user_id), Number(r.weight)]));
  for (const id of userIds) out.set(id, Math.max(0, byUser.get(id) ?? 0));
  return out;
}

export interface WeightChangeInput {
  userId: string;
  weight: number;
  actorUserId: string;
  note: string;
}

/** What is wrong with a proposed allocation, or null. Shared by set and bulk. */
export function weightChangeProblem(input: { weight: unknown; note: unknown }): string | null {
  const w = Number(input.weight);
  if (!Number.isFinite(w) || w < 0) return "A weight must be zero or a positive number";
  if (w > 1_000_000_000) return "That weight is past any believable allocation. Check the number";
  const note = String(input.note ?? "").trim();
  if (!note) return "Every weight change carries a reason. Say why";
  if (note.length > 500) return "The reason runs past 500 characters";
  return null;
}

export interface WeightChangeResult {
  /** The audit row this write appended. The bell's dedupe key rides it. */
  changeId: string;
  /** What the member weighed before, or null when they had no row at all. */
  oldWeight: number | null;
  /** Whether the member's actual weight moved. A re-save of the same number
   *  appends a trail row (the act happened) and changes no power. */
  moved: boolean;
}

/**
 * Set one member's custom-mode weight and append the audit row, in one
 * transaction. The current-state upsert and the trail row commit together or
 * never: an allocation the trail cannot explain must not exist.
 *
 * Returns what changed, because the member whose power moved has to be TOLD
 * and the caller cannot work either fact out afterwards: the previous weight
 * is gone the moment this commits, and the trail row's id is what makes the
 * notice dedupe per change instead of collapsing every future change into
 * one row that is never seen again.
 */
export async function setWeight(pool: Pool, input: WeightChangeInput): Promise<WeightChangeResult> {
  const problem = weightChangeProblem(input);
  if (problem) throw new Error(problem);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [prev] = await conn.query<RowDataPacket[]>(
      "SELECT weight FROM governance_weights WHERE user_id = ? FOR UPDATE",
      [input.userId],
    );
    const oldWeight = prev[0] ? Number(prev[0].weight) : null;
    await conn.query( // module-review-ok: the weight tables' one enumerable home; state and trail commit in one transaction here and nowhere else
      "INSERT INTO governance_weights (user_id, weight) VALUES (?,?) ON DUPLICATE KEY UPDATE weight = VALUES(weight)",
      [input.userId, input.weight],
    );
    const [trail] = await conn.query<any>( // module-review-ok: the weight tables' one enumerable home; state and trail commit in one transaction here and nowhere else
      "INSERT INTO governance_weight_changes (user_id, old_weight, new_weight, actor_user_id, note) VALUES (?,?,?,?,?)",
      [input.userId, oldWeight, input.weight, input.actorUserId, input.note.trim()],
    );
    await conn.commit();
    return {
      changeId: String(trail?.insertId ?? ""),
      oldWeight,
      // An absent row and a stored zero are the same amount of power, so
      // going from one to the other moved nothing and is not news.
      moved: (oldWeight ?? 0) !== input.weight,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export interface WeightChangeRow {
  id: string;
  userId: string;
  oldWeight: number | null;
  newWeight: number;
  actorUserId: string;
  note: string;
  at: string;
}

/** The append-only trail, newest first. One member's, or everyone's. */
export async function weightHistory(pool: Pool, userId?: string, limit = 200): Promise<WeightChangeRow[]> {
  const capped = Math.max(1, Math.min(500, limit));
  const [rows] = userId
    ? await pool.query<RowDataPacket[]>(
        "SELECT * FROM governance_weight_changes WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT ?",
        [userId, capped],
      )
    : await pool.query<RowDataPacket[]>(
        "SELECT * FROM governance_weight_changes ORDER BY at DESC, id DESC LIMIT ?",
        [capped],
      );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    oldWeight: r.old_weight === null ? null : Number(r.old_weight),
    newWeight: Number(r.new_weight),
    actorUserId: String(r.actor_user_id),
    note: String(r.note),
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
  }));
}

/** Current custom-mode allocations, for the admin table and the member trail. */
export async function allWeights(pool: Pool): Promise<Map<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT user_id, weight FROM governance_weights");
  return new Map(rows.map((r) => [String(r.user_id), Number(r.weight)]));
}
