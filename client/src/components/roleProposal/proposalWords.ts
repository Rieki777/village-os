/**
 * Every sentence the role proposal steps say (role proposals PR C), so a test
 * can assert the words and the voice guard reads them in one place. The
 * server's own sentences (refusals, the consent state, the nudge) stay where
 * the server keeps them, in shared/roleProposals.ts and
 * shared/roleProposalConsent.ts, and are drawn as sent.
 *
 * Plain words. "Role", never "seat", for a role (Rye, 2026-10-21). A role is
 * named, never the person who holds it (Rye, 2026-10-22): who holds or applies
 * is a count. The 2026-10-30 amendment ("Treasurer (Rick)" on member views,
 * `shared/roleHolderLabel.ts`) does not reach here: a proposal's shared link
 * is read by anyone holding it, so it stays counts and role titles.
 */
import type { ConsentState } from "@shared/roleProposalConsent";

export const STEPS = ["roles", "words", "season", "terms", "preview", "share"] as const;
export type StepKey = (typeof STEPS)[number];

export const STEP_TITLES: Record<StepKey, string> = {
  roles: "Pick your roles",
  words: "Each role's words",
  season: "Your season",
  terms: "Terms and review dates",
  preview: "Preview your card",
  share: "Share and submit",
};

export const RP_WORDS = {
  // The profile button.
  propose: "Propose my roles for next season",
  continue: "Continue my proposal for next season",
  // The page.
  title: "Propose my roles for next season",
  forSeason: (name: string, starts: string) => `For ${name}, starting ${starts}.`,
  signIn: "Sign in to propose your roles.",
  signInLine: "Propose the roles you will hold next season, and share the draft for feedback before you submit it.",
  membersOnly: "Proposing roles opens at the member rung.",
  starting: "Starting from your current card",
  reading: "Reading your proposal",
  missing: "There is no proposal by that id.",
  stepOf: (n: number, of: number) => `Step ${n} of ${of}`,
  goToStep: (n: number, title: string) => `Step ${n}: ${title}`,
  back: "Back",
  next: "Next",
  saving: "Saving",
  saved: "Saved",
  notSaved: "Not saved, try again",
  tryAgain: "Try again",

  // Step 1.
  rolesLede: "Pick the roles you will hold next season: ones you hold now, open roles, or roles someone else holds now. Or propose a new role.",
  picked: (n: number, max: number) => `${n} of at most ${max} picked.`,
  atMost: (max: number) => `One proposal holds at most ${max} roles. Take one off to add another.`,
  youHold: "Roles you hold",
  open: "Open roles",
  othersHold: "Roles someone else holds now",
  noRolesYet: "This village has no roles on its chart yet. Propose a new one below.",
  loadingRoles: "Reading the roles",
  rolesFailed: "The roles did not load. Try again in a moment.",
  circleLine: (circle: string, purpose: string | null) => (purpose ? `${circle}: ${purpose}` : circle),
  noCircle: "Not in a circle yet",
  youHoldThis: "You hold this role now",
  heldBy: (n: number) => (n === 1 ? "Held by 1 other member now" : `Held by ${n} other members now`),
  places: (free: number, of: number) => (free === 1 ? `1 of ${of} places open` : `${free} of ${of} places open`),
  everyPlaceHeld: "Every place is held now",
  applying: (n: number) => (n === 1 ? "1 other member is applying" : `${n} other members are applying`),
  newRoleHeading: "Propose a new role",
  newRoleLede: "A new role sits in a circle, and that circle consents to it with the rest of your proposal.",
  newRoleName: "The new role's name",
  newRoleCircle: "The circle it sits in",
  pickCircle: "Pick a circle",
  addNewRole: "Add this new role",
  removeNewRole: (name: string) => `Take ${name} off this proposal`,
  newRoleTag: "New role",
  noCircles: "This village has no circles yet, so a new role has nowhere to sit.",

  // Step 2.
  wordsLede: "These are the words on each role's card. Change any of them for next season. A change shows in gold.",
  pickRoleFirst: "Pick at least one role first, on the step before this one.",
  whichRole: "Which role",
  changed: "Changed from the posted role",
  isNew: "New",
  seePosted: "See the posted words",
  posted: "The posted words",
  nothingPosted: "Nothing is written on the posted role.",
  onePerLine: "One per line.",
  countOnMeHint: "3 to 6 things, one per line.",
  reviewOn: "Review date",
  reviewHint: "The day this role is reviewed. Leave it empty if there is none yet.",
  roleName: "Role name",
  fromHolder: "From whoever holds it now",
  fromHolderLede: "The runbook and how ready the role is to hand over, as they stand on the posted role.",
  noRunbook: "No runbook written yet",

  // Step 3.
  seasonLede: "Your own aim and goals for next season, and how they serve the village's goals for that season.",
  aim: "Your aim for the season",
  aimHelp: "What will be true at the end of next season because of you.",
  orgGoalsHeading: "The village's goals for next season",
  noOrgGoals: "The village hasn't set next season's goals yet.",
  noOrgGoalsLine: "You can save your season anyway, and come back to these once they are set.",

  // Step 4.
  termsLede: "One set of terms covers every role in this proposal. Each role keeps its own review date.",
  reviewDates: "Review dates",
  termsHeading: "Your terms",
  termsNotSaved: "These terms are not saved until the lines in red are fixed.",

  // Step 5.
  previewLede: "Your card as the circle will read it. Words you changed show in gold.",
  previewFailed: "The preview did not load.",
  loadingPreview: "Drawing your card",

  // Step 6.
  shareHeading: "Share it for feedback",
  shareLede: "Share a link to this draft before you submit it, and read the feedback here.",
  shareOff: "The link is off. Nobody else can read this draft.",
  makeLink: "Make a share link",
  whoReads: "Who can read it",
  membersOnlyTier: "Members of the village",
  membersOnlyLine: "Members with the link read it, terms included, and can leave feedback.",
  anyoneTier: "Anyone with the link",
  anyoneLine: "Anyone with the link reads the roles and their words. Terms, your season and feedback stay with members.",
  copyLink: "Copy the link",
  copied: "Copied",
  copyFailed: "Copy did not work. Select the link and copy it.",
  regenerate: "Make a new link",
  regenerated: "A new link is made. The old one no longer opens anything.",
  turnOff: "Turn the link off",
  openShared: "Open the shared view",
  theLink: "The share link",
  feedbackHeading: "Feedback",
  noFeedback: "No feedback yet.",
  fromWho: (from: string, on: string) => `${from}, ${on}`,
  submitHeading: "Submit for next season",
  submit: "Submit for next season",
  /** Only while the server names nobody: the server's own line names who adopts in this village (E8). */
  whoApproves: "The circle consents within 2 business days, or a founder or steward role adopts it.",
  youAlign: "You align with these words when you submit:",
  confirm: "Yes, submit it",
  notYet: "Not yet",
  submitted: "Submitted. Your circle is asked now.",

  // After submit.
  stateHeading: "Where it stands",
  seeApplication: "See the application",
  submittedOn: (day: string) => `Submitted on ${day}.`,
  myProposals: "My role proposals",
  proposalFor: (season: string) => `Role proposal for ${season}`,
  proposalNoSeason: "Role proposal for next season",
  draftWords: "Draft, not submitted yet",

  // The shared view.
  sharedTitle: "A role proposal for next season",
  yourOwn: "This is your own proposal.",
  editYourOwn: "Open it to edit",
  linkOff: "This link is no longer shared.",
  sharedSignIn: "Sign in as a member of the village to read this proposal.",
  readOnly: "You are reading this proposal. Feedback is for members of the village.",
  feedbackLabel: "Your feedback",
  feedbackHelp: "Up to 1000 characters. The member who wrote this proposal reads it.",
  sendFeedback: "Send feedback",
  yourFeedback: "Your feedback so far",
  feedbackSent: "Sent.",
  submittedNoFeedback: "This proposal is submitted, so feedback is closed.",

  // AI help.
  aiHelp: "Let AI help me with this",
  useSuggestion: "Use this",
} as const;

/**
 * Where a submitted proposal stands, in plain words, keyed by the stored
 * union so a new state cannot print blank. The server's own sentence for the
 * state (`consent.words`) is drawn under each.
 */
export const STATE_HEADINGS: Record<ConsentState, string> = {
  open: "Waiting on the circle",
  objected: "An objection goes to the circle's next meeting",
  consented: "Consented by the circle, waiting for a holder of the power to record it",
  lapsed: "Waiting for a holder of the power",
  "no-other-holders": "Waiting for a holder of the power",
};

export const ADOPTED_HEADING = "Adopted";
