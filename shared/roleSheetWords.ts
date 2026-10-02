/**
 * THE ROLE CARD'S WORDS: every fixed string a seat card or a permission card
 * prints, in one place, so a component holds no copy of its own and the voice
 * gates read all of it at once.
 *
 * `shared/roleSheet.ts` re-exports everything here, so a host imports the words
 * and the view model from the same module. The two ladders' labels and the
 * phrases that name each commitment inside a sentence are keyed by
 * `CommitmentKey`, so an eighth commitment cannot render an empty chip.
 */

export type CommitmentKey = "aim" | "domain" | "accountabilities" | "why" | "term" | "nextHolder" | "decides";

/** Every fixed string the card prints, so the component holds no copy of its own. */
export const SHEET_WORDS = {
  figuresName: "Right now",
  aimLabel: "Aim",
  aimMissing: "The aim is still to be written down.",
  rosterHeading: "Holding it now",
  commitmentsHeading: "Its commitments",
  flipTitle: "What it does",
  backButton: "Back to the card",
  showingBack: "Showing what it does.",
  showingFront: "Showing the card.",
  proposed: "Proposed",
  keySeat: "Key seat",
  keySeatGloss: "The village marked this seat as key.",
  recruiting: "Recruiting",
  recruitingGloss: "The village is looking for someone to hold this seat.",
  suggestedTag: "Suggested",
  suitsGloss: "Guessed from the seat's own words. Nobody has confirmed it yet. The picture is stock art for this class.",
  readyToBeRechosen: "ready to be re-chosen",
  agent: "An agent",
  seated: "Seated",
  openPlace: "Open place",
  nobodyHoldsThis: "Nobody holds this yet",
  waitingForAHand: "Waiting for a hand",
  formingPlace: "A place still forming",
  aVoteFillsThis: "A vote fills this place",
  signInToSeeNames: "Sign in to see who holds it.",
  namesNotShared: "Names are not shared on this page.",
  unreachable: "Held, and not reachable through the map yet.",
  raise: "Raise your hand",
  raiseConsequence: "A raised hand reaches the founding team, who will be in touch.",
  raisePlaceholder: "Why this role calls to you (optional)",
  raiseTermLabel: "End date for your seat (optional)",
  raiseSubmit: "Raise my hand",
  cancel: "Cancel",
  raised: "Hand raised. The founding team will be in touch.",
  signInToRaise: "Sign in to raise your hand",
  nobodyWroteThisSeat: "Nobody has written down what this seat is for yet.",
  foundingTeamWrites: "The founding team writes these down.",
  setByHand: "This state was set by hand.",
  everyoneReady: "Everyone seated here is ready to be re-chosen.",
  atLeastOneReady: "At least one place is ready to be re-chosen.",
  termFutureSub: "The earliest term among its holders.",
  termPastSub: "Ready to be re-chosen.",
  termAtSeating: "Set at seating",
  termAtSeatingSub: "With no date asked, it ends with the season.",
  villagesWay: "The village's way.",
  proposalLead: "A preview of the text below, read the way accepting reads it.",
  proposalInvalid: "The text below is not valid JSON yet, so there is nothing to preview.",
  seatNeedsAName: "A seat needs a name",
  whatItDoes: "What it does",
  roleUnwritten: "Nobody has written down what this role does yet.",
  powersHeading: "Powers it carries",
  rungHeading: "Rung it asks for",
  unknownPower: "A power this page cannot name yet",
  noRung: "This role asks for no rung.",
  unknownRung: "Asks for a rung this village no longer names.",
  livePreview: "Live preview",
  livePreviewSub: "Shows the role you picked.",
} as const;

export const suitsLabel = (className: string): string => `Suits ${className}`;
export const speaksForLabel = (circle: string): string => `Speaks for ${circle}`;
export const speaksForGloss = (circle: string): string => `This seat speaks for ${circle} on how it decides.`;
export const moreOpenLine = (n: number): string => `+${n} more open place${n === 1 ? "" : "s"}`;
export const notReadLine = (keys: string[]): string | null => (keys.length ? `Not read: ${keys.join(", ")}.` : null);
export const rungLine = (stageName: string): string =>
  `Asks for ${stageName} or above. The vote turns away anyone on a lower rung.`;

// ── The seven commitments, in a label and inside a sentence ────────────────

export const COMMITMENT_LABELS: Record<CommitmentKey, string> = {
  aim: "Aim",
  domain: "Decides on",
  accountabilities: "Answers for",
  why: "Why it matters",
  term: "Term",
  nextHolder: "Next holder",
  decides: "Way of deciding",
};

/** How each commitment is named inside a sentence. */
export const COMMITMENT_PHRASES: Record<CommitmentKey, string> = {
  aim: "what it works toward",
  domain: "what it decides on",
  accountabilities: "what it answers for",
  why: "why it matters",
  term: "when the term ends",
  nextHolder: "how the next holder is chosen",
  decides: "how its decisions pass",
};
