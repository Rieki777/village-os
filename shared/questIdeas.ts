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
