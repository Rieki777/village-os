/**
 * THE CIRCLE CARD'S WORDS: every fixed string the circle-level card prints,
 * and the CCOS term each plain heading stands for.
 *
 * Kept apart from `shared/circleCard.ts` so the voice gate reads all of the
 * copy in one file. The rules this copy keeps, each one a ruling:
 *   - Plain-word headings, with the CCOS term shown on hover or tap
 *     (Rye, 2026-10-22). A village that does not use CCOS turns the terms off
 *     (`org.ccos_terms`), and the headings stay as they are.
 *   - "role" is the noun for a sociocratic role everywhere a member reads it.
 *   - No copy names a person. A role is named by its full title, and the
 *     adoption record names a vote or a decision, never who pressed a button.
 *   - Time promises are "2 business days", never a count of hours.
 *   - Headings on the circle's own words speak as the circle: "What we look after".
 */

/** The framework the hover terms come from. */
export const FRAMEWORK_NAME = "CCOS";

/** Every heading on the card, by section key, in the order the card reads them. */
export const CIRCLE_SECTION_KEYS = [
  "purpose",
  "accountabilities",
  "domains",
  "authorities",
  "responsibilities",
  "roles",
  "signs",
  "meet",
  "wholeness",
  "tensions",
  "stewardship",
  "checks",
  "succession",
  "values",
  "livingAgreement",
  "tools",
  "review",
  "adoption",
] as const;
export type CircleSectionKey = (typeof CIRCLE_SECTION_KEYS)[number];

export const CIRCLE_HEADINGS: Record<CircleSectionKey, string> = {
  purpose: "Why this circle exists",
  accountabilities: "What you can count on us for",
  domains: "What we look after",
  authorities: "What we can decide on our own",
  responsibilities: "What we do regularly",
  roles: "Roles in this circle",
  signs: "How we'll know it's working",
  meet: "How we meet",
  wholeness: "How we look after ourselves",
  tensions: "How tensions flow",
  stewardship: "How we give back more than we take",
  checks: "How we keep power in balance",
  succession: "When a role changes hands",
  values: "What we value",
  livingAgreement: "How we agree to be together",
  tools: "Tools we rely on",
  review: "When we look at this again",
  adoption: "Who agreed to this, and when",
};

/** The matching heading in the CCOS Circle Charter, shown as "CCOS: <term>". */
export const CCOS_TERMS: Record<CircleSectionKey | "existsWhile", string> = {
  existsWhile: "Purpose, while the circle is needed",
  purpose: "Purpose",
  accountabilities: "Accountabilities / Outcomes",
  domains: "Domains",
  authorities: "Authorities",
  responsibilities: "Responsibilities / Actions",
  roles: "Role Structure Overview",
  signs: "Measurable Key Performance Indicators (KPIs)",
  meet: "Time Commitment (meetings)",
  wholeness: "Wholeness Practices",
  tensions: "Relational Flow",
  stewardship: "Regenerative Stewardship",
  checks: "Checks & Balances",
  succession: "Succession Planning",
  values: "Alignment with Core Values",
  livingAgreement: "Living Agreement",
  tools: "Tools and Resources",
  review: "Review and Adaptation Process",
  adoption: "Signatures",
};

/** "CCOS: Domains", the words a hover or a tap shows. */
export const termLabel = (term: string): string => `${FRAMEWORK_NAME}: ${term}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const CIRCLE_CARD_WORDS = {
  // Header
  eyebrow: "Circle",
  partOf: "Part of",
  existsWhile: "This circle exists while",
  existsWhileEmpty: "not written yet",
  status: { forming: "Forming", dormant: "Resting" } as Record<string, string>,
  termsKey: "Underlined headings show the matching CCOS term when you hover or tap them.",
  backToCircles: "All circles",

  // Empty states
  notWritten: "Not written yet",
  noPurpose: "No purpose written yet",
  accountabilitiesShort: (n: number) => `${plural(n, "line", "lines")} written. A circle answers for 3 to 6 things.`,

  // Roles
  noRoles: "No roles in this circle yet",
  roleFilled: "Filled",
  roleOpen: "Open",
  rolePartly: (n: number, of: number) => `${n} of ${of} filled`,
  roleForming: "Forming",
  roleExpired: "Term ended",
  seeCard: "See their card",
  seeCardOf: (role: string, i: number, of: number) =>
    of > 1 ? `See the card of holder ${i} of ${role}` : `See the card of the holder of ${role}`,
  roleDetails: "About this role",
  apply: "Apply for this role",
  holdersPrivate: "Sign in to open the holders' cards.",

  // Values
  valueLine: (value: string, practice: string) => `${value}: ${practice}`,

  // Adoption
  noAdoption: "No words for this circle have been adopted by consent yet.",
  adoptedByVote: (day: string) => `Adopted by a village vote on ${day}`,
  adoptedDirectly: (day: string) => `Adopted by a direct decision on ${day}`,
  adoptionCount: (n: number, first: string) => `${plural(n, "change", "changes")} adopted since ${first}`,
  createdLine: "The circle was created",
  wordsLine: "New words for the circle",

  // Proposing new words (they change only by consent, through an org draft)
  proposeWords: "Propose new words",
  doneProposing: "Done",
  proposeNote: "A circle's words change by consent. Your words go to the village as a proposed change, and the card shows them once it is adopted.",
  oneLine: "One line each.",
  valuesHint: "Up to two, one per line, each as the value, a colon, then one practice that shows it.",
  proposeSend: "Propose this change",
  cancel: "Cancel",
  proposed: "Proposed, waiting for consent",
  proposalSent: "Sent as a proposal for consent.",
  pending: "Proposed, waiting for consent",
  proposeFailed: "That did not go through. Try again.",

  // Deciding a proposal, through the doors every org draft has
  proposedOn: (day: string) => `Proposed on ${day}`,
  clears: "Clears what is written now",
  adopt: "Adopt these words",
  adoptConfirm: "Adopt now? The circle's card changes for everyone.",
  adoptYes: "Yes, adopt them",
  putToVillage: "Put it to the village",
  putConfirm: "Open a village vote on these words?",
  putYes: "Yes, open the vote",
  voting: (day: string) => `The village is voting on this until ${day}.`,
  waitingHolder: "The role that holds the power to change the structure decides this.",
  waitingVillage: "The village decides this by vote.",
  blocked: "This cannot be adopted as it stands:",
  adopted: "Adopted. The card now shows the new words.",
  putDone: "Put to the village. Members are asked to vote.",

  // The live parts, which Amora reads itself and nobody types
  notCountedYet: "Not counted yet",
  nOf: (n: number, of: number) => `${n} of ${of}`,
  trend: { up: "Up on last moon", down: "Down on last moon", same: "Same as last moon" } as Record<"up" | "down" | "same", string>,
  trendLater: "Trend from next moon",
  lastMet: (day: string) => `Last met on ${day}`,
  notMetYet: "Has not met yet",
  rhythmNotSet: "Meeting rhythm: not set yet",
  rhythm: (words: string) => `Meeting rhythm: ${words}`,
  nextMeeting: (words: string) => `Next meeting: ${words}`,
  waiting: (n: number) =>
    n === 0 ? "Nothing waiting for the next meeting" : n === 1 ? "1 item waiting for the next meeting" : `${n} items waiting for the next meeting`,
  openSessions: "Open Live Sessions",
  arrivalRound: "Each meeting in Live Sessions opens by asking how everyone is arriving, with a number from 1 to 11.",
  sharedBreath: "Whoever facilitates can start a shared breath for everyone in the room.",
  gratitudeRound: "A meeting can close with a round of thanks to each person in it.",
  bringSomething: "Bring something to the next meeting",
  openTensions: (n: number) =>
    n === 0 ? "No open tensions on this circle's roles" : n === 1 ? "1 open tension on this circle's roles" : `${n} open tensions on this circle's roles`,
  tensionFlow: "A tension goes to the role it is about. The role's holders answer it, or bring it to the circle's next meeting.",
  tensionWhere: "Raise one from the card of a holder of the role it is about.",
  reviewDue: (day: string) => `Due for review on ${day}, the last day of this season.`,
  noReviewDate: "No season is set, so there is no review date yet.",
  lastChanged: (day: string) => `Last changed by consent on ${day}.`,

  // Below the card, for the circle's members and admins: Live Sessions' own sections, for this circle alone
  decisionsLede: "What this circle decided by consent, newest first. Give one a review date, and it comes back as an agenda item when the time comes.",
  pulseLede: "How this circle has been doing this season, from what its sessions already wrote down. Counts only, never a name.",

  // Loading
  failed: "This circle card did not load.",
  retry: "Retry",
  notFound: "There is no circle here.",
} as const;

/** The refusals a proposal for a circle's words can meet, one sentence each. */
export const CIRCLE_WORD_REFUSALS = {
  notWords: "This needs to be words.",
  textTooLong: (max: number) => `Keep it to ${max} characters.`,
  itemTooLong: (max: number) => `Keep each line to ${max} characters.`,
  tooMany: (max: number) => `Up to ${max} lines.`,
  tooFew: (min: number, max: number) => `Write ${min} to ${max} lines, or leave it empty for now.`,
  valueShape: "Write each value as the value, a colon, then the practice that shows it.",
  valuesTooMany: (max: number) => `Up to ${max} values of the circle's own.`,
  valueTooLong: (value: number, practice: number) => `Keep a value to ${value} characters and its practice to ${practice}.`,
  nothingNamed: "This names no word this village can change on a circle.",
  notAHolder: "Only someone who holds a role in this circle can propose its words from the card.",
  example: "A standing example circle is not changed. Publish your own circles and it is removed.",
  signIn: "Sign in to propose new words for a circle.",
  tooManyProposals: "That is a lot of proposals in a few minutes. Wait a little and try again.",
} as const;
