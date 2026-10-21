/**
 * The two names a quest idea from the public Propose a Quest form travels under.
 *
 * The page and its guided chat submit under the form type `quest-proposal`
 * (`QUEST_IDEA_FORM`). The server derives a proposal from that submission and
 * stamps it with `PROPOSE_QUEST_MODULE` (server/lib/publicForms.ts), and /review
 * reads the id to say where an idea came from. Both sides import it from here,
 * so the card's sentence cannot drift from the id the server writes.
 */

/** The form type the Propose a Quest page and its guided chat submit under. */
export const QUEST_IDEA_FORM = "quest-proposal";

/** The module id every quest idea from that form carries in `quest_proposals`. */
export const PROPOSE_QUEST_MODULE = "propose-quest";

/**
 * WHERE AN IDEA WENT, told back to the page that sent it.
 *
 * An idea can be stored as a submission and still never reach /review: past
 * an allowance, carrying an email address, and the rest of the hold-backs in
 * server/lib/publicForms.ts. The page used to answer "Your Quest idea is in."
 * for all of them, because `POST /api/forms/submit` said `success` either way
 * and nothing told the sender their idea was waiting in a place no steward
 * reviews. So the route answers this beside `success` for a quest idea, and
 * the page says plainly which one happened (server/lib/questIdeaReceipt.ts).
 *
 * The reasons are codes, never sentences: the page owns the words, keyed by
 * this union, so a reason added here without words there is a compile error.
 *
 *   over_allowance       the sender already has as many ideas waiting as the
 *                        queue takes (`allowance` says how many)
 *   contained_an_email   the idea's own words carry an email address
 *   empty_payload        nothing to title the idea by
 *   identifier_too_long  an id on it ran past 64 characters
 *   not_filed            anything else that kept it out, a database error
 *                        among them
 */
export type IdeaHold = "over_allowance" | "contained_an_email" | "empty_payload" | "identifier_too_long" | "not_filed";

export type IdeaReceipt =
  | { queued: true }
  | {
      queued: false;
      held: IdeaHold;
      /** Whether the sender was signed in, which decides whose allowance was full. */
      member: boolean;
      /** The allowance that was full, for `over_allowance`; null for every other hold. */
      allowance: number | null;
    };
