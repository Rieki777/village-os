/**
 * WHAT THE VILLAGE HOLDS (0098). The substrate of the handover.
 *
 * R54: "these villages are meant to be taken over by the electorate to run
 * the game and put the admins out of a full time job." Admin is scaffolding
 * and not a tier, and until this file existed a power could not leave it: the
 * one gate answered `true` for an admin before it consulted anything, so
 * "the village holds this now" was a sentence with no mechanism under it.
 *
 * One row per power, naming the role that holds it. `capability_holding` is
 * the whole of the mechanism, and this file is the whole of the read.
 *
 * ── READ LIVE, NEVER CACHED ────────────────────────────────────────────────
 *
 * `badgeGrantsFor` is the shape being copied: one indexed query per request,
 * no store above it. The reason is specific and it has already bitten this
 * repo. Deleting rows from `tools`, `circles` and `roles` with raw SQL left
 * the API serving them until the next reboot, because those go through
 * `dbCollection` caches. A cache HERE would be worse than an inconvenience:
 * a hand-written `UPDATE capability_holding` would take effect for some
 * processes and not others, so a power would be village-held on one node and
 * admin-held on the next, and the audit trail would record whichever node the
 * request landed on. A permission that depends on which process answered is
 * not a permission.
 *
 * The table is tiny by construction: at most one row per capability, and
 * `ALL_CAPABILITIES` is a couple of dozen keys. The query is a primary-key
 * scan of a table that cannot grow past that.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { ALL_CAPABILITIES, TRANSFERABLE, type Capability } from "../../shared/capabilities";
import { WIRED_BUT_HELD_BACK } from "./capabilityRegistry";

export interface CapabilityHoldingRow {
  capability: string;
  holderRoleId: string;
  /** The role's own name, for the sentence a member reads. Null if the role is gone. */
  holderRoleName: string | null;
  /** The ballot that moved it, when the village voted it across. */
  movedByBallotId: string | null;
  movedByUserId: string | null;
  movedAt: string;
  note: string | null;
}

/**
 * The capabilities this village holds, as the gate wants them.
 *
 * Filtered through TRANSFERABLE here as well as in the gate. Two locks on the
 * same door, because the failure mode being guarded against is a row nobody
 * reviewed: a hand-written INSERT naming `message.send` would otherwise stop
 * an admin from messaging in a village whose members never asked for that.
 *
 * Fails OPEN, deliberately and with a loud log. If this query throws, the
 * honest answer is the one every deployment gave before 0098 existed: the
 * village holds nothing, admins pass, nobody is locked out by a database
 * hiccup. Failing closed here would mean a transient error suspends the
 * operator's own access to the panel that could fix it.
 */
export async function villageHeldCapabilities(pool: Pool): Promise<string[]> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT capability FROM capability_holding",
    );
    return rows
      .map((r) => String(r.capability))
      .filter((c) => TRANSFERABLE[c as Capability] === true);
  } catch (e) {
    console.error("[capabilityHolding] read failed, treating the village as holding nothing", e);
    return [];
  }
}

/** Every holding, with the holding role's name, newest crossing first. */
export async function capabilityHoldings(pool: Pool): Promise<CapabilityHoldingRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT h.capability, h.holder_role_id, h.moved_by_ballot_id, h.moved_by_user_id, " +
      "h.moved_at, h.note, r.name AS role_name " +
      "FROM capability_holding h LEFT JOIN roles r ON r.id = h.holder_role_id " +
      "ORDER BY h.moved_at DESC, h.capability",
  );
  return rows.map((r) => ({
    capability: String(r.capability),
    holderRoleId: String(r.holder_role_id),
    holderRoleName: r.role_name == null ? null : String(r.role_name),
    movedByBallotId: r.moved_by_ballot_id == null ? null : String(r.moved_by_ballot_id),
    movedByUserId: r.moved_by_user_id == null ? null : String(r.moved_by_user_id),
    movedAt: r.moved_at instanceof Date ? r.moved_at.toISOString() : String(r.moved_at),
    note: r.note == null ? null : String(r.note),
  }));
}

export interface MoveInput {
  capability: string;
  holderRoleId: string;
  movedByBallotId?: string | null;
  movedByUserId?: string | null;
  note?: string | null;
}

/**
 * Record that a power has crossed to the village.
 *
 * Idempotent on the capability, which is what lane G-C's double-close needs:
 * closing the same transfer ballot twice writes one row and moves nothing the
 * second time. The refusals are here rather than at the route, because there
 * will be two writers (an admin route now, a passed ballot later) and a check
 * that lives in one of them is a check the other one does not have.
 */
export async function moveCapabilityToVillage(
  pool: Pool,
  input: MoveInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cap = input.capability as Capability;
  if (!ALL_CAPABILITIES.includes(cap)) {
    return { ok: false, error: `"${input.capability}" is not a capability this platform knows about.` };
  }
  if (TRANSFERABLE[cap] !== true) {
    /*
     * 0103: the true reason, when there is a truer one than the default. A
     * key the product uses and this map still refuses is not a personal act,
     * and saying it is would be a sentence written before the fact it now
     * describes. `WIRED_BUT_HELD_BACK` carries the reason beside the power.
     */
    return {
      ok: false,
      error:
        WIRED_BUT_HELD_BACK[input.capability] ??
        `"${input.capability}" is not a power that can move. It names something a member does for themselves, ` +
          `or plumbing the deployment has to keep reachable, so there is nobody for it to move to.`,
    };
  }
  const [roles] = await pool.query<RowDataPacket[]>(
    "SELECT id, capabilities FROM roles WHERE id = ?",
    [input.holderRoleId],
  );
  if (roles.length === 0) {
    return { ok: false, error: `There is no role called "${input.holderRoleId}" to hold it.` };
  }
  /*
   * A HOLDER THAT CANNOT ACT IS NOT A HOLDER.
   *
   * Handing `library.keep` to a role whose capability list does not include
   * it produces the worst state this table can reach: the admin stops
   * passing the gate, the named holder never passed it either, and the power
   * belongs to nobody at all. The village would read "the library keepers
   * look after that" off a page while every one of them got a 403.
   *
   * So the role has to already grant it. The order of the two acts is
   * therefore fixed and it is the right way round: a village grants the
   * power to a role first, watches somebody use it, and then takes it on.
   */
  let granted: string[] = [];
  try {
    const raw = (roles[0] as any).capabilities;
    granted = Array.isArray(raw) ? raw.map(String) : JSON.parse(String(raw ?? "[]")).map(String);
  } catch {
    granted = [];
  }
  if (!granted.includes(input.capability)) {
    return {
      ok: false,
      error:
        `The role "${input.holderRoleId}" does not carry ${input.capability} yet, so nobody in it could act. ` +
        `Give the role the power first, then hand it over.`,
    };
  }
  await pool.query( // module-review-ok: the whole point of this file is that the holding table has NO repo cache above it (see the header): a cached permission that a hand-written UPDATE can desync between processes is not a permission
    "INSERT INTO capability_holding (capability, holder_role_id, moved_by_ballot_id, moved_by_user_id, note) " +
      "VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE holder_role_id = VALUES(holder_role_id), " +
      "moved_by_ballot_id = VALUES(moved_by_ballot_id), moved_by_user_id = VALUES(moved_by_user_id), " +
      "note = VALUES(note)",
    [
      input.capability,
      input.holderRoleId,
      input.movedByBallotId ?? null,
      input.movedByUserId ?? null,
      input.note ?? null,
    ],
  );
  return { ok: true };
}

/**
 * THE SENTENCE AN ADMINISTRATOR MEETS AT THE HAND-BACK ROUTE (Rye, 2026-09-23).
 *
 * The ruling: handing a village-held power BACK to the admin panel needs a
 * VILLAGE VOTE. He was offered "steward-founder only" and "leave it open" and
 * chose neither, which matches his standing rule that power changes go to a
 * constitutional vote.
 *
 * It names the ballot rather than only refusing, for the reason
 * `STEWARD_SEAT_REFUSAL` gives: a refusal that says only "no" teaches nobody
 * where the door is, and the door here was BUILT BEFORE THE RULING — the
 * `power_return` subject type, its closer and
 * `POST /api/governance/power-returns` have all existed since the R55 round.
 * What was missing was the refusal on the other side of the same act.
 *
 * One exported constant so the route, the admin panel and the tests read the
 * same words.
 */
export const RETURN_NEEDS_A_VOTE =
  "Handing a power back to the admin panel is the village's decision, not an administrator's. " +
  "Open a power_return ballot (POST /api/governance/power-returns) and let the whole roll vote on it; " +
  "if it carries, the power comes back here through the same landing every other decision uses, " +
  "inside the same veto window.";

/**
 * Hand a power back to the scaffolding.
 *
 * This exists and it is not a hedge. The platform is the custodian of
 * deployments whose operators did not choose any of this, so an irreversible
 * transfer would mean a captured village has no way back and no redeploy it
 * can pull. Reversal is a visible act with a public record, like the
 * break-glass, which is the property that matters.
 *
 * TWO CALLERS, AND THEY ARRIVE BY DIFFERENT DOORS. The `power_return` closer
 * calls this when the village's own vote carries. The admin route calls it
 * only for a founder seated as a steward with the veto who has broken the
 * glass, which is the one exception in Rye's 2026-09-23 ruling and the one
 * case that already leaves the village a record it can read. Everybody else
 * meets `RETURN_NEEDS_A_VOTE`.
 */
export async function returnCapabilityToScaffolding(pool: Pool, capability: string): Promise<boolean> {
  const [r] = await pool.query<any>("DELETE FROM capability_holding WHERE capability = ?", [capability]);
  return Number(r?.affectedRows ?? 0) > 0;
}

/**
 * BOOT ASSERTION, in the shape of `assertBadgeInvariants`.
 *
 * A hand-written row is invisible to code review by definition, and this is
 * the one table where an unreviewed row can close a door on the person who
 * would have to open it again. If the holding table names a capability that
 * may never move, the deployment refuses to serve and says which row, rather
 * than starting up with a permission nobody chose.
 *
 * A holding whose ROLE has since been deleted is a warning and not a refusal.
 * That state is reachable by an ordinary admin act (retire a role), it locks
 * nobody out permanently because the break-glass is right there, and
 * refusing the boot over it would turn a tidy-up into an outage.
 */
export async function assertCapabilityHoldingInvariants(pool: Pool): Promise<void> {
  let rows: CapabilityHoldingRow[];
  try {
    rows = await capabilityHoldings(pool);
  } catch (e) {
    console.error("[capability holding] could not read the holding table at boot", e);
    return;
  }
  const problems: string[] = [];
  for (const row of rows) {
    const cap = row.capability as Capability;
    if (!ALL_CAPABILITIES.includes(cap)) {
      problems.push(`capability_holding names "${row.capability}", which is not a capability`);
    } else if (TRANSFERABLE[cap] !== true) {
      problems.push(`capability_holding names "${row.capability}", which is not transferable`);
    }
    if (row.holderRoleName === null) {
      console.warn(
        `[capability holding] ${row.capability} is held by role "${row.holderRoleId}", which no longer exists. ` +
          `Nobody holds it until a role does.`,
      );
    }
  }
  if (problems.length) {
    for (const p of problems) console.error(`[capability holding] ${p}`);
    throw new Error(`capability holding invariants violated (${problems.length}), refusing to serve`);
  }
}
