/**
 * A ROLE'S WORDS, BEFORE AND AFTER, under one row of the structure review.
 *
 * The fields come from `roleFieldChanges` (shared/roleFieldChanges.ts): every
 * field a new role writes, and every field a moved role's words change. That
 * includes the handover words of 0268, "Bring me", "Not mine to hold" and the
 * runbook, so a steward reads them before consenting like aim and domain.
 * Draws nothing when nothing changes.
 */
import type { PlanLiveSeat, PlanSeatMatch } from "@shared/structurePlan";
import { FIELD_CHANGE_WORDS as W, roleFieldChanges } from "@shared/roleFieldChanges";

export function RoleFieldChanges({
  payload,
  match,
  liveSeats,
}: {
  payload: Record<string, unknown>;
  /** The live role this one moves onto, or null for a new role. */
  match: PlanSeatMatch | null;
  liveSeats: readonly PlanLiveSeat[];
}) {
  const live = match ? liveSeats.find((s) => s.id === match.seatId) : null;
  const changes = roleFieldChanges(match ? (live?.words ?? {}) : null, payload);
  if (!changes.length) return null;
  return (
    <dl className="mt-1.5 grid gap-1.5 text-[13px]" data-testid="role-field-changes">
      {changes.map((c) => (
        <div key={c.key} className="grid gap-0.5">
          <dt className="font-semibold">{c.label}</dt>
          {match && (
            <dd className="text-muted-foreground">
              <span className="font-medium">{W.before}:</span> {c.before ?? W.none}
            </dd>
          )}
          <dd>
            {match && <span className="font-medium">{W.after}: </span>}
            {c.after ?? W.none}
          </dd>
        </div>
      ))}
    </dl>
  );
}
