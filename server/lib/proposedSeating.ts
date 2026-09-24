/**
 * A proposed seating, in the one shape an outside producer is allowed to send
 * it: a reference to a member, and never a member.
 *
 * ── THE RULING THIS IMPLEMENTS ───────────────────────────────────────────
 *
 * Rye, 2026-09-23: "machine and saberra can propose anything but a human or a
 * full vote (depending on who's empowered) is required to adopt accept."
 *
 * That moves ruling 0143, which refused `seat_holder` from a machine-sourced
 * draft outright, and it moves it in a specific direction. PROPOSING becomes
 * unrestricted. The guard moves to ADOPTION, where it was always really doing
 * its work: the reasoning under 0143 was that a holder is the change a mistake
 * cannot be undone from, and that is an argument about who COMMITS a change.
 *
 * "Depending on who's empowered" needs no new concept. `org.seat` is a
 * capability and it is transferable, so the existing rule answers it: where a
 * role holds the power its holder adopts, and where the village holds it any
 * member may put it to a ballot. A single steward-accept path would quietly
 * concentrate a power the village may already hold, so whoever wires adoption
 * reads the holding and routes on it.
 *
 * ── WHY A REFERENCE AND NOT A PERSON ─────────────────────────────────────
 *
 * The `seat_holder` draft payload is `{ userId, displayName }` today, filled
 * by a founder in the admin panel who is naming somebody they know. An outside
 * producer cannot send either field. `displayName` is a person's name, and a
 * vendor sending one puts a name in the org chart from outside, which is the
 * thing the whole record boundary exists to stop. `userId` is this village's
 * own identifier and no outside system has any business asserting one.
 *
 * So a producer sends `subjectRef`, which `server/lib/subjectRefs.ts` defines
 * as 128 bits of randomness "carrying nothing about its subject", resolvable
 * back to a member only from inside this village and revocable by the erasure
 * sweep. The name shown on the adopted change is read from THIS village's own
 * member record at adoption time. The vendor never learns it and never sends
 * it.
 *
 * ── REFUSED, NOT CLEANED ─────────────────────────────────────────────────
 *
 * A payload arriving with `userId` or `displayName` is refused whole and the
 * offending key is named. Stripping it quietly would be worse: the same
 * producer would keep sending it, nobody would find out, and the one time the
 * strip had a gap a name would land. This matches `landProposal`, which
 * refuses a record carrying an email address instead of cleaning it.
 *
 * Pure: no pool, no clock, no network. Resolving a reference to a member needs
 * the database and belongs to the caller, which is also where the capability
 * holding is read.
 */
import { looksLikeSubjectRef } from "./subjectRefs";

/** Keys an outside producer may never send on a seating. */
const NEVER_FROM_OUTSIDE = ["userId", "displayName", "user_id", "display_name", "email", "name"] as const;

export type SeatingRefusal =
  | { why: "named-a-person"; key: string }
  | { why: "no-subject-ref" }
  | { why: "malformed-subject-ref" }
  | { why: "no-seat" };

export interface ProposedSeating {
  /** The seat this proposes filling, as this village identifies it. */
  orgRoleId: string;
  /** Who, as a reference this village can resolve and nobody outside can read. */
  subjectRef: string;
}

export type SeatingReading =
  | { ok: true; seating: ProposedSeating }
  | { ok: false; refusal: SeatingRefusal };

/**
 * One proposed seating, read from what a producer sent.
 *
 * The person-naming check runs FIRST, before the shape is even looked at, for
 * the same reason `landProposal` scans for an address before it normalises
 * anything: a refusal that happened after a partial read has already handled
 * the thing it was refusing.
 */
export function readProposedSeating(raw: unknown): SeatingReading {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, refusal: { why: "no-seat" } };
  }
  const p = raw as Record<string, unknown>;

  for (const key of NEVER_FROM_OUTSIDE) {
    if (p[key] !== undefined) return { ok: false, refusal: { why: "named-a-person", key } };
  }

  const orgRoleId = typeof p.orgRoleId === "string" ? p.orgRoleId.trim() : "";
  if (orgRoleId === "") return { ok: false, refusal: { why: "no-seat" } };

  if (p.subjectRef === undefined) return { ok: false, refusal: { why: "no-subject-ref" } };
  if (!looksLikeSubjectRef(p.subjectRef)) return { ok: false, refusal: { why: "malformed-subject-ref" } };

  return { ok: true, seating: { orgRoleId, subjectRef: p.subjectRef } };
}

/** What a steward reads when a seating was refused. */
export function refusalSentence(r: SeatingRefusal): string {
  switch (r.why) {
    case "named-a-person":
      return `This proposal carried a field called ${r.key}, which names a person. A proposal references a member and never names one, so the whole record was refused.`;
    case "no-subject-ref":
      return "This proposal says a seat should be filled and does not say by whom.";
    case "malformed-subject-ref":
      return "This proposal references a member in a shape this village does not issue.";
    case "no-seat":
      return "This proposal says somebody should hold a seat and does not say which seat.";
  }
}
