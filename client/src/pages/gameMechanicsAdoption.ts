/**
 * WHO MAY LAND A PROPOSAL FROM THE MECHANICS PAGE, out of the page that renders
 * the buttons.
 *
 * `client/src/pages/GameMechanics.tsx` is under the monolith ratchet
 * (`scripts/check-file-lines.mjs`), so the page's rules about which proposal
 * an admin applies, which one a founder adopts, and which dials are never
 * staged as plain dials live here. `APPLYABLE` moved whole from the page.
 */
import type { ProposalStatus } from "./GameMechanics";

/**
 * The statuses an admin may apply from, mirroring the ONE apply route
 * (`POST /api/admin/mechanics/proposals/:id/apply`, server/index.ts).
 *
 * `passed_onsite` shipped in that route's accepted set and NOT in this page's
 * button, so a proposal the village carried at its own vote and the brake was
 * holding had no way to be applied from the only surface that shows it. The
 * route's own comment already said a ballot-passed proposal is applied by the
 * same human hand as a Hypha-verified one; the button disagreed in silence.
 * gameMechanicsStates.test.ts reads the route's set out of the server source
 * and holds this to it, the same way it reads the status enum off the
 * migration instead of trusting a union kept by hand.
 */
/**
 * How votes are weighed lands only as a mode switch, so these two are never
 * staged as plain dials (server/lib/mechanics.ts `WEIGHING_KEYS`). Every other
 * dial, founder-held ones too, may be proposed (Rye, 2026-09-25).
 */
export const WEIGHING_KEYS: ReadonlySet<string> = new Set(["governance.weight_mode", "governance.weight_token"]);

/**
 * A proposal a founder adopts by hand before the start: still open, and made
 * only of founder-held dials (server/lib/founderDials.ts `founderAdoptable`).
 * The apply route answers after the start, so a stale button says why.
 */
export function founderAdoptable(p: { status: string; changes: Array<{ key: string }> }, ringOf: (key: string) => string | undefined): boolean {
  if (p.status !== "open" && p.status !== "draft") return false;
  return p.changes.length > 0 && p.changes.every((c) => ringOf(c.key) === "founder");
}

export const APPLYABLE: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>([
  "to_hypha",
  "passed_claimed",
  "passed_verified",
  "passed_onsite",
]);
