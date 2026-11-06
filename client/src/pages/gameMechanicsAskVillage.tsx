/**
 * THE DOOR FOR A HELD OUTCOME (readiness R039, and Rye, 2026-11-06:
 * "EVERYTHING can change with the highest village vote").
 *
 * A Hypha outcome that named no space, or arrived while applying was switched
 * off, waits at `passed_verified`. After launch the admin apply door is
 * closed, so the only way left is the village's own vote:
 * `POST /api/governance/mechanics/:id/open-ballot` admits any member on the
 * roll for it and conducts it at the village's highest set tier. The standing
 * payload's `mayAskVillage` answers with the same rule the route enforces, so
 * the button and the door agree, and nobody meets the button by being refused.
 *
 * Its own file because GameMechanics.tsx is a ratcheted monolith
 * (scripts/check-file-lines.mjs).
 */
export function mayAskVillageOn(
  p: { status: string },
  standing: { denied: boolean; mayAskVillage?: boolean } | null | undefined,
): boolean {
  return p.status === "passed_verified" && !!standing && !standing.denied && !!standing.mayAskVillage;
}

export function AskVillageButton({ onAsk }: { onAsk: () => void }) {
  return (
    <button
      type="button"
      onClick={onAsk}
      className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium hover:bg-teal-deep-dark"
    >
      Ask the village to decide it here
    </button>
  );
}
