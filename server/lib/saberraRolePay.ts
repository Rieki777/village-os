/**
 * The newest pay range the outside service holds, per role of this village,
 * for the role editor's "Use Sera's range" (role journey L10).
 *
 * Read from the newest kept snapshot whose roles were read WHOLE, through the
 * same `sourcePayOf` the structure translator uses, so a structured range and
 * an unambiguous "Range: ..." text land in one shape. A role is keyed by the id
 * the sync matched it to here (`match.ourId`); an unmatched record is not
 * guessed onto a role.
 *
 * This only READS. It writes no term and no offer: the editor copies a range
 * into a role's terms on a person's own save, and nothing else does.
 *
 * Pure over the rows it is handed: no pool, no clock, no network.
 */
import type { SnapshotRow } from "../repos/saberraSnapshots";
import { readSourcePay, type SourcePay } from "../../shared/structurePlan";
import { sourcePayOf } from "./saberraProposals";

export interface RolePayReading {
  /** When the read was taken, ISO. */
  readAt: string;
  /** Role id here to the pay the service holds for it. Roles with none are absent. */
  byRole: Record<string, SourcePay>;
}

export function latestRolePay(rows: readonly SnapshotRow[]): RolePayReading | null {
  // Rows come newest first; the first whole read is the latest.
  const row = rows.find((r) => r.snapshot.roles.read === "whole");
  if (!row) return null;
  const byRole: Record<string, SourcePay> = {};
  for (const rec of row.snapshot.roles.records) {
    const ourId = rec.match?.ourId;
    if (!ourId) continue;
    const raw = sourcePayOf(rec.fields as Record<string, unknown>);
    const pay = raw ? readSourcePay(raw) : null;
    if (pay) byRole[ourId] = pay;
  }
  return { readAt: row.snapshot.takenAt, byRole };
}
