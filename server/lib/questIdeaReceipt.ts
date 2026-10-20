/**
 * What `POST /api/forms/submit` tells the Propose a Quest page about where an
 * idea went: into the review queue, or held in the inbox and why.
 *
 * The reasoning, and the union, live in shared/questIdeas.ts. This file only
 * turns `landPublicSubmission`'s outcome into it, and lives apart from
 * server/lib/publicForms.ts so that file keeps one job.
 */
import type { IdeaHold, IdeaReceipt } from "../../shared/questIdeas";
import { OPEN_IDEAS_PER_MEMBER, OPEN_VISITOR_IDEAS, type IdeaOutcome } from "./publicForms";

/** The hold-backs publicForms.ts can name that the page has words for. Anything else is `not_filed`. */
const NAMED: ReadonlySet<string> = new Set<IdeaHold>([
  "over_allowance",
  "contained_an_email",
  "empty_payload",
  "identifier_too_long",
]);

/**
 * The receipt to spread into the route's answer. Empty for every form that is
 * not a quest idea, so their answer is exactly what it was.
 */
export function ideaReceipt(proposal: IdeaOutcome | null, member: boolean): { idea?: IdeaReceipt } {
  if (!proposal) return {};
  if (proposal.ok) return { idea: { queued: true } };
  const reason = "heldBack" in proposal ? proposal.heldBack : null;
  const held: IdeaHold = reason && NAMED.has(reason) ? (reason as IdeaHold) : "not_filed";
  const allowance = held === "over_allowance" ? (member ? OPEN_IDEAS_PER_MEMBER : OPEN_VISITOR_IDEAS) : null;
  return { idea: { queued: false, held, member, allowance } };
}
