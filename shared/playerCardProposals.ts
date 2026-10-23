/**
 * A ROLE'S OPEN PROPOSALS, as the player card shows them beside the role.
 *
 * A holder's new words for a role open an org draft (`update_seat`), and a
 * draft opened from a card is listed on no review page (`/review` lists only
 * the drafts its own queue made). So the card lists each open proposal on the
 * role's own section, with the words it would put live, and draws the doors
 * that adopt it (client/src/components/review/DecideDoors.tsx). The circle
 * card does the same for circle words.
 *
 * Only the role words the card edits are read off a payload (`ROLE_WORD_FIELD`
 * in shared/playerCardEdit.ts), each under the heading the card prints it
 * with. No proposer is named. Pure.
 */
import { CARD_WORDS as W } from "./playerCardWords";
import { ROLE_EDIT_KEYS, ROLE_WORD_FIELD, type RoleEditKey } from "./playerCardEdit";
import { formatDay } from "./roleSheet";

/** One open draft that would change a role's words. */
export interface RoleProposalIn {
  draftId: string;
  /** When the draft was opened, ISO. */
  proposedAt: string;
  payload: unknown;
}

export interface RoleProposalOut {
  draftId: string;
  /** "Proposed on 22 Oct 2026". */
  proposedOn: string;
  /** Each word it changes: the card's heading and the lines it would show. No lines clears the word. */
  fields: { key: RoleEditKey; label: string; lines: string[] }[];
}

export const ROLE_PROPOSAL_WORDS = {
  heading: "Proposed, waiting for consent",
  proposedOn: (day: string) => `Proposed on ${day}`,
  clears: "Clears what is written now",
  adopt: "Adopt these words",
  adoptConfirm: "Adopt now? The role's words change for everyone.",
  adoptYes: "Yes, adopt them",
  putToVillage: "Put it to the village",
  putConfirm: "Open a village vote on these words?",
  putYes: "Yes, open the vote",
  voting: (day: string) => `The village is voting on this until ${day}.`,
  waitingHolder: "The role that holds the power to change the structure decides this.",
  waitingVillage: "The village decides this by vote.",
  blocked: "This cannot be adopted as it stands:",
  adopted: "Adopted. The role now has the new words.",
  putDone: "Put to the village. Members are asked to vote.",
  cancel: "Cancel",
  failed: "That did not go through. Try again.",
} as const;

/** The heading the card prints each role word under. */
const LABEL: Record<RoleEditKey, string> = {
  purpose: W.purpose,
  decide: W.decide,
  countOnMe: W.countOnMe,
  bringMe: W.bringMe,
  notMine: W.notMine,
  runbook: W.runbook,
};

function linesOf(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (Array.isArray(v)) return v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim());
  return [];
}

/** The open proposals for one role, oldest first, each with the words it would put live. */
export function roleProposalsOut(proposals: readonly RoleProposalIn[], timeZone: string): RoleProposalOut[] {
  return [...proposals]
    .sort((a, b) => Date.parse(a.proposedAt) - Date.parse(b.proposedAt))
    .map((p) => {
      const body = p.payload && typeof p.payload === "object" ? (p.payload as Record<string, unknown>) : {};
      const fields = ROLE_EDIT_KEYS.filter((k) => body[ROLE_WORD_FIELD[k]] !== undefined).map((key) => ({
        key,
        label: LABEL[key],
        lines: linesOf(body[ROLE_WORD_FIELD[key]]),
      }));
      return { draftId: p.draftId, proposedOn: ROLE_PROPOSAL_WORDS.proposedOn(formatDay(p.proposedAt, true, timeZone) ?? ""), fields };
    })
    .filter((p) => p.fields.length > 0);
}
