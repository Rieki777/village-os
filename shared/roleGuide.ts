/**
 * THE ROLE GUIDE, as the page and the server both see it: one turn asked, one
 * turn answered, and the words the page says around it.
 *
 * Rye, 2026-10-24: "Let AI help me with this" on the role proposal steps. A
 * member brings in a description of their role; the guide reads it and
 * suggests every field of the card, each with the sentence it came from;
 * then it asks only about what is missing or weak, one question at a time.
 * Each suggestion stays marked suggested until the member accepts it, and the
 * guide never saves or submits anything. The document is read and thrown
 * away, and only accepted fields are kept.
 *
 * WHO ANSWERS is the member's choice of guide (shared/guideChoice.ts), and
 * every answer carries who gave it.
 *
 * Pure: types and words only.
 */
import type { GuideId } from "./guideChoice";
import { guideNameAtSentenceStart as atStart } from "./guideName";
import type { GuideFlag } from "./roleGuideChecks";

export type RoleGuideStep = "words" | "season";

/** The longest document text one turn carries: the most the upload extracts (ROLE_DOCUMENT_TEXT_MAX, server/lib/roleDocumentText.ts). */
export const GUIDE_DOCUMENT_MAX = 60_000;
/** The longest one answer of the member's may run. */
export const GUIDE_ANSWER_MAX = 2_000;
/** Turns kept in one conversation: the guide's questions and the member's answers. */
export const GUIDE_TURNS_MAX = 24;

/** One line of the conversation. */
export interface GuideLine {
  from: "guide" | "member";
  text: string;
}

/** What the page sends for one turn. */
export interface GuideAsk {
  step: RoleGuideStep;
  /** The extracted text of the member's document, on the turn it is brought in. Never stored. */
  document?: string | null;
  /** The conversation so far, oldest first. */
  conversation?: GuideLine[];
}

/** One field the guide suggests, for the member to accept or leave. */
export interface GuideSuggestion {
  /** Where it goes: `roles.0.words.domain`, `newRoles.1.words.accountabilities`, `season.aim`. */
  path: string;
  /** The role it belongs to, by name, or null for the season. */
  role: string | null;
  /** That role's id: the posted role it renews, or the new role's draft id. Null for the season. */
  roleId: string | null;
  /** The field's key: `domain`, `accountabilities`, `aim`. */
  field: string;
  /** The suggested words. A list field arrives as lines. */
  words: string | string[];
  /** The sentence of the document it came from, or null when it came from what the village already knows. */
  source: string | null;
  /** Why the card could not take it as it stands, or null. */
  problem: string | null;
}

/** What one turn answers. */
export interface GuideAnswer {
  guide: { id: GuideId; name: string };
  /** A sentence when this answer came from a guide the member did not choose. */
  note: string | null;
  suggestions: GuideSuggestion[];
  /** The one thing the guide asks next, or null when nothing is missing. */
  question: string | null;
  /** The village's own checks, worded. */
  flags: GuideFlag[];
}

export const ROLE_GUIDE_WORDS = {
  open: "Let AI help me with this",
  bringIn: "Bring in a description of your role",
  kept: (village: string) => `${atStart(village)} doesn't keep your document. Only the fields you accept are saved.`,
  sharedWith: {
    village: (name: string) => `${atStart(name)} reads it here to suggest your card.`,
    saberra: (name: string) =>
      `${atStart(name)} reads it through the village's outside memory service to suggest your card. It goes under your role titles, with people's names swapped for their role titles.`,
  },
  suggested: "Suggested",
  from: "From what you wrote:",
  fromKnown: "From what the village already knows",
  accept: "Use this",
  leave: "Leave it",
  answer: "Your answer",
  send: "Send",
  nothingMissing: "That's everything the card needs. Look it over and change anything you like.",
  unreachable: "The guide can't answer right now. Your words are safe, and you can carry on by hand.",
  thinking: (name: string) => `${atStart(name)} is reading`,
  /** The label before the guide's question: "Maia:", "The village guide:". */
  asks: (name: string) => `${atStart(name)}:`,
} as const;
