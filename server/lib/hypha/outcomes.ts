/**
 * An outcome coming home, and the two ways it can fail to.
 *
 * THE MARKER IS THE WHOLE CONTRACT AND A HUMAN CAN DELETE IT. `hypha-bridge.ts`
 * says so in its own header: the platform puts `[gm:<id>]` into the Hypha
 * proposal title, and if anybody tidies that title before the vote the outcome
 * has nothing to match on. A title is a human field on somebody else's product
 * and treating it as a primary key was always going to lose one.
 *
 * So the strong key is the AGREEMENT ID Hypha returns at creation, which the
 * link step already stores on `mechanics_proposals.hypha_proposal_id` and which
 * the chain carries by itself. The marker stays as a fallback for a delivery
 * that carries no agreement id, which is the case the shipped bridge was built
 * around and which still has to keep working.
 *
 * And when neither matches, THE DELIVERY IS RECORDED AS AN ORPHAN rather than
 * answered and forgotten. A village should learn that a decision went missing
 * from a list it can look at, never from somebody asking why nothing applied.
 *
 * Everything here is pure. The store is `server/repos/hypha.ts` and the caller
 * hands in the two lookups, so a test can drive every branch with no database.
 */
import { extractMechanicsMarker } from "../hypha-bridge";

export type OutcomeVerdict = "confirmed" | "rejected" | "unknown";
export type OutcomeMatch = "agreement" | "marker" | "none";

export interface InboundOutcome {
  /** The identifier Hypha returns at creation. The strong key. */
  agreementId: string;
  /** The `[gm:<id>]` marker, wherever it was found. The fallback. */
  marker: string;
  verdict: OutcomeVerdict;
  /** One stable key per delivery, so a retry repairs instead of duplicating. */
  deliveryKey: string;
}

/**
 * Read a delivery into the shape the matcher takes.
 *
 * Liberal in what it accepts, because the two senders (the hub's callback and a
 * self-hosted listener) are different programs and neither is this repository's
 * to dictate. Strict in what it produces.
 */
export function readInboundOutcome(payload: any, verdict: OutcomeVerdict): InboundOutcome {
  const agreementId = String(
    payload?.agreementId ?? payload?.agreement_id ?? payload?.hyphaProposalId ?? payload?.proposalId ?? "",
  ).trim().slice(0, 64);
  // The marker can arrive on its own field or buried in a title. Both are
  // searched, and a field wins because a title is the editable one.
  const marker =
    extractMechanicsMarker(String(payload?.marker ?? "")) ??
    extractMechanicsMarker(String(payload?.title ?? "")) ??
    "";
  const deliveryKey = String(
    payload?.deliveryId ?? payload?.delivery_id ?? "",
  ).trim() || `${agreementId}:${marker}:${verdict}`;
  return { agreementId, marker, verdict, deliveryKey: deliveryKey.slice(0, 190) };
}

export interface OutcomeMatchResult {
  matchedBy: OutcomeMatch;
  proposalId: string | null;
  /** True when the agreement id and the marker point at different proposals. */
  conflict: boolean;
}

/**
 * Which proposal this outcome belongs to.
 *
 * The agreement id is tried first and wins outright. The marker is tried second.
 *
 * A CONFLICT IS REPORTED RATHER THAN RESOLVED. When both resolve and they
 * disagree, the agreement id is still used, because it is the identifier the
 * chain carries and the marker is the one a person can retype. But the
 * disagreement is flagged, because the only ways it happens are a mispasted
 * link or two proposals sharing an id, and both of those are worth a human
 * looking at rather than a silent preference.
 */
export async function matchOutcome(
  outcome: InboundOutcome,
  lookups: {
    byAgreementId: (id: string) => Promise<string | null>;
    proposalExists: (id: string) => Promise<boolean>;
  },
): Promise<OutcomeMatchResult> {
  const byAgreement = outcome.agreementId ? await lookups.byAgreementId(outcome.agreementId) : null;
  const byMarker = outcome.marker && (await lookups.proposalExists(outcome.marker)) ? outcome.marker : null;

  if (byAgreement) {
    return {
      matchedBy: "agreement",
      proposalId: byAgreement,
      conflict: byMarker !== null && byMarker !== byAgreement,
    };
  }
  if (byMarker) return { matchedBy: "marker", proposalId: byMarker, conflict: false };
  return { matchedBy: "none", proposalId: null, conflict: false };
}

// ── The space check (upgrade 6) ──────────────────────────────────────────────

export type SpaceCheck =
  /** The village recorded a space id and the delivery named the same one. */
  | { verdict: "match" }
  /** The village recorded no space id. Nothing was checked and nothing is claimed. */
  | { verdict: "unconfigured" }
  /** The village recorded one and the delivery named nothing. Accepted, reported. */
  | { verdict: "unstated" }
  /** The village recorded one and the delivery named a different space. Refused. */
  | { verdict: "mismatch"; claimed: string };

/**
 * Does this delivery really concern THIS village's Hypha space.
 *
 * `hypha.space_id` shipped with a description promising it would let the
 * platform check that on-chain outcomes claiming to be yours really came from
 * your space, and nothing read the field. The webhook authenticated on a shared
 * header secret alone, so a founder who filled the field in believed they had
 * added chain-level provenance and had added nothing. This is the function that
 * makes the field do what its name says.
 *
 * WHAT IT DEFENDS AGAINST, precisely, because a check that oversells itself is
 * the same defect again. The signature already proves the sender holds this
 * village's secret. What it cannot prove is that the OUTCOME is this village's:
 * one hub carries many forks off one listener, so a routing mistake there is a
 * correctly signed delivery about somebody else's DAO. That is the failure this
 * closes, and it is the likeliest one precisely because the hub is one process
 * serving everybody.
 *
 * WHAT IT CANNOT DO. A delivery that names no space cannot be checked, and this
 * returns `unstated` for it instead of pretending. The caller records those,
 * reports them, and never applies one on its own (R039): a passed outcome
 * nobody could check waits for a person, so an operator learns the check is
 * idle and no dial moves on it. Refusing them outright would take a working
 * integration down the first time a sender dropped an optional field.
 */
export function checkSpace(configuredSpaceId: string, payload: any): SpaceCheck {
  const mine = String(configuredSpaceId ?? "").trim();
  if (!mine) return { verdict: "unconfigured" };
  const claimed = String(
    payload?.spaceId ?? payload?.space_id ?? payload?.space ?? "",
  ).trim();
  if (!claimed) return { verdict: "unstated" };
  // Compared as trimmed strings, deliberately. A space id is numeric today and
  // a numeric comparison would make "007" and "7" equal; two spellings of one
  // id is not something this check gets to decide for Hypha.
  return claimed === mine ? { verdict: "match" } : { verdict: "mismatch", claimed: claimed.slice(0, 64) };
}
