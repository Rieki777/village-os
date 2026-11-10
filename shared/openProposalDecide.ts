/**
 * OPEN ROLE PROPOSALS, THE DECISION (part B): the words and the shapes. PURE,
 * so the member page, the task board and the server read one spelling.
 *
 * Part A (shared/openProposals.ts) takes a proposal from somebody with no
 * account and holds it until its address confirms. Part B makes a confirmed
 * proposal decidable:
 *
 *   1. CONFIRMING ASKS THE CIRCLE. Every live holder of a role in the circles
 *      of the proposed roles is asked to consent or object within 2 business
 *      days (shared/roleProposalConsent.ts, the member proposals' window), and
 *      the live holders of the power to place people in roles hear it waits on them.
 *      Nothing is asked and nobody hears before the address confirms.
 *   2. A MEMBERS-ONLY PAGE, `/open-proposals/:id`, where a member reads it, an
 *      asked holder consents or objects, and a holder of the power adopts it or
 *      declines it.
 *   3. WHO DECIDES (Rye, 2026-10-31, sheet 24a): "The default for adopting a
 *      role proposal is those in founder roles until they give that power to
 *      the community to use governance to do". In code, the rule member
 *      applications already use: a live holder of a role carrying `org.seat`,
 *      never on their own proposal (`adoptRefusal`). Once the village holds
 *      that power nobody adopts one at the door, and the page says so.
 *   4. ADOPTING makes the person's place: an address that already has an
 *      account here is given the roles; any other address is sent a one-use
 *      invitation, and the account it makes has the roles waiting. Adoption
 *      admits nobody: Member, and with it a vote, comes with the signed Love
 *      Letter (Rye's ruling; server/lib/admission.ts), which the letters ask for.
 *   5. DECLINING sends a short, kind no.
 *
 * In the 2026-10-02 voice: say what happens next, never how.
 */
import { andList } from "./openProposals";

/** The member page, and the shape of a proposal's id (server/routes/openProposals.ts mints `op-` and 20 hex). */
export const OPEN_PROPOSAL_ID = /^op-[0-9a-f]{20}$/;
export const openProposalHref = (id: string): string => `/open-proposals/${encodeURIComponent(id)}`;

/**
 * The invitation an adopted proposal carries, named after the proposal, so a
 * second look finds it without a column, and the sign-up it makes can be told
 * apart from every other invitation.
 */
export const OPEN_INVITE_PREFIX = "inv-open-";
export const openInviteId = (proposalId: string): string => `${OPEN_INVITE_PREFIX}${proposalId}`.slice(0, 64);
/** The proposal an invitation was made for, or null for any other invitation. */
export function proposalOfInvite(inviteId: string): string | null {
  if (!inviteId.startsWith(OPEN_INVITE_PREFIX)) return null;
  const id = inviteId.slice(OPEN_INVITE_PREFIX.length);
  return OPEN_PROPOSAL_ID.test(id) ? id : null;
}

/** A first name for a greeting or a row, or null when the proposal gave none worth using. */
export function greetingName(raw: unknown): string | null {
  const first = String(raw ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || first.includes("@") || first.length > 40) return null;
  return first;
}

/**
 * THE DECISION, as it is kept on the proposal: the record in words, which
 * names a role and never a person, and the authority an adoption was made
 * under (`org.seat@<role id>`), which the application written for the person
 * carries when they arrive.
 */
export interface OpenDecision {
  words: string | null;
  authority: string | null;
}

/** "Declined on 4 Nov". The day is the caller's, in the village's zone. */
export const declinedWords = (shortDay: string): string => `Declined on ${shortDay}`;

/** Why an email did not go out, in the decider's words. */
export type NotSentWhy = "not_set_up" | "bad_address" | "no_address" | "failed";

const NOT_SENT: Record<NotSentWhy, string> = {
  not_set_up: "Email is not set up yet, so nothing went out.",
  bad_address: "Their address does not look like an email address, so nothing went out.",
  no_address: "Their address was taken off, so nothing went out.",
  failed: "The email did not go through.",
};

/** Who may decide at the door now, in the words the page shows a reader who may not. */
export type DoorReason = "village-holds-it" | "a-role-holds-it" | "nobody-holds-it" | "the-scaffolding-holds-it";

/**
 * The same three readings by name, for client code: the dash guard
 * (scripts/check-hyphen-dash.mjs) reads raw text under client/src and takes
 * "-it" for a hyphen standing in for a dash.
 */
export const DOOR = { villageHolds: "village-holds-it", nobodyHolds: "nobody-holds-it", aRoleHolds: "a-role-holds-it" } as const satisfies Record<string, DoorReason>;

export const DECIDE_WORDS = {
  moonEnded: "The moon this was proposed for has ended. You can adopt it for the moon running now; the letter will say so.",
  // The page.
  heading: (proposer: string | null, roles: readonly string[], moon = false) =>
    `${proposer || "Somebody"} proposes to hold ${andList(roles) || "a role"} ${moon ? "this moon" : "next season"}`,
  fromOutside: "Proposed through the village's public page. Adopted, they hold these roles from the season's first day.",
  fromOutsideMoon: (from: string, to: string) => `Proposed through the village's public page, for this moon. Adopted, they hold these roles from adoption (never before ${from}) to the next new moon, ${to}.`,
  rolesHeading: "The roles",
  wordsHeading: "In their words",
  why: "Why them, and why now",
  aim: "Their aim for the season",
  roleGone: "A role no longer offered",
  membersOnly: "Members read role proposals.",
  membersOnlyLine: "A proposal carries what somebody wrote to the village, so it opens at the member rung.",
  missing: "There is no proposal at this address.",
  loadFailed: "The proposal did not load. Try again.",
  loading: "Reading the proposal",

  // Where it stands.
  status: {
    confirmed: "Waiting for the village",
    adopted: "Adopted",
    declined: "Declined",
    withdrawn: "Withdrawn",
  },

  // The decider's card.
  deciderHeading: "For the village",
  deciderLine: "You hold the power to place people in roles. Adopt it for the village, or decline it.",
  adopt: "Adopt for the village",
  decline: "Decline",
  declineAsk: "Decline it? They get a short, kind email saying no.",
  declineYes: "Yes, decline it",
  declineNo: "Keep it",
  ownProposal: "This proposal came from your own address, so it is decided by another holder of the power to place people in roles.",
  /** A former member's address (coordinator, 2026-10-31, after Rye's ruling that former members never invite). */
  formerMember: "This address belongs to somebody who left the village. Welcoming a former member back is its own act, so this proposal is not adopted here. You can still decline it.",
  /** The door after a handover, and with nobody in the chair. Plain, and no path invented. */
  door: {
    "village-holds-it": "The village holds the power to place people in roles now, so nobody adopts this proposal on their own. It waits here until the village settles how it adopts one from outside.",
    "nobody-holds-it": "Right now nobody holds the power to place people in roles, so this proposal waits here until somebody does.",
    "a-role-holds-it": "It is adopted or declined by a holder of the power to place people in roles.",
    // Answered only when a caller names who carries the power until the village holds it (shared/powerHands.ts).
    "the-scaffolding-holds-it": "Until the village holds the power to place people in roles, the founders and stewards adopt or decline it.",
  } satisfies Record<DoorReason, string>,

  // What a decision answers. Every one that sends nothing says what to do instead.
  adoptedEmailed: (days: number) => `Adopted. Their invitation went by email. It works once and lasts ${days} days. It is below as well, if they ask you for it.`,
  adoptedNotEmailed: (why: NotSentWhy) => `Adopted. ${NOT_SENT[why]} Copy their invitation below and send it to them yourself.`,
  adoptedAccount: "Adopted. That address already has an account here, so no invitation was needed: their roles start on the season's first day.",
  accountTold: "They were told by email as well.",
  accountNotTold: (why: NotSentWhy) => `${NOT_SENT[why]} They see it in their notifications when they sign in.`,
  declinedEmailed: "Declined. A kind no went to them by email.",
  declinedNotEmailed: (why: NotSentWhy) => `Declined. ${NOT_SENT[why]}`,
  reissued: (days: number) => `A new invitation is ready, and the old one no longer works. It works once and lasts ${days} days.`,
  reissuedEmailed: "It went to them by email.",
  reissuedNotEmailed: (why: NotSentWhy) => `${NOT_SENT[why]} Copy it below and send it to them yourself.`,
  reissue: "Make a new invitation",
  reissueLine: "They have not used their invitation yet. A new one replaces it, and goes to them by email.",
  invitationUsed: "They made their account with their invitation.",
  invitationSent: (when: string, emailed: boolean) => (emailed ? `The invitation went to them by email on ${when}.` : `The invitation was made on ${when}, and the email did not go. Send it again, or hand them the link.`),
  copy: "Copy invitation",
  copied: "Copied",

  // Refusals, each with what to do.
  notAHolder: "Adopting or declining a proposal is for a live holder of the power to place people in roles.",
  pending: "That address already has an application waiting for one of these roles. Decide that one on its page first.",
  decided: "This proposal has been decided, so there is nothing left to decide.",
  raced: "Somebody else decided this proposal a moment ago. Read it again.",
  noInvitation: "There is no invitation to replace: they already made their account, or this proposal was not adopted.",
  notAPlace: "This proposal was adopted, and its roles could not be set up. Nothing was changed. Read the roles on the chart, then try again.",
  failed: "That did not reach the server. Try again.",
  tooMany: "That is a lot of decisions in a few minutes. Wait a little and try again.",
} as const;

/** Why an email did not go out, from what the post office answered. PURE. */
export function whyNotSent(r: { reason?: string | null }): NotSentWhy {
  if (r.reason === "not_configured" || r.reason === "no_api_key") return "not_set_up";
  if (r.reason === "bad_address") return "bad_address";
  return "failed";
}

// ── The letters ────────────────────────────────────────────────────────────

export interface AdoptLetterIn {
  firstName: string | null;
  village: string;
  roleNames: readonly string[];
  /** "Season of Roots", or null when the season has no name. */
  season: string | null;
  /** The season's first day, in words ("1 January 2099"). */
  startsOn: string;
  /** A moon proposal's days, in words; absent for a season one. */
  moon?: { from: string; to: string } | null;
  /** Where the membership agreement is signed (/love-letter), when the village serves it. */
  loveLetter?: string | null;
}

/** Signing comes before seating and before any vote (Rye's ruling; the role card's Agreements). */
const signFirst = (i: AdoptLetterIn): string[] =>
  i.loveLetter
    ? ["", "Before you are seated, align with the Love Letter, the village's membership agreement (aligning is the village's way of signing). Aligning with it is what makes you a member, with a voice in the village's decisions:", i.loveLetter]
    : [];

const hello = (firstName: string | null) => (firstName ? `Hi ${firstName},` : "Hi,");
const whenRolesStart = (i: AdoptLetterIn) =>
  i.moon ? `Your roles run from ${i.moon.from} to the next new moon, ${i.moon.to}.` : `Your roles start when ${i.season || "next season"} begins, on ${i.startsOn}.`;
const forWhen = (i: AdoptLetterIn) => (i.moon ? "this moon" : "next season");

/** The yes, with the invitation, for an address with no account here. The email shows `button` as a button and keeps the link in the text. */
export function adoptedInviteLetter(i: AdoptLetterIn & { link: string; days: number }): { subject: string; text: string; button: { label: string; url: string } } {
  return {
    subject: `${i.village} adopted your proposal`,
    button: { label: INVITE_BUTTON, url: i.link },
    text: [
      hello(i.firstName),
      "",
      `${i.village} adopted your proposal to hold ${andList(i.roleNames) || "a role"} ${forWhen(i)}.`,
      "",
      `Here is your invitation. Use the button to create your profile, or open this link:`,
      i.link,
      "",
      `It works once and lasts ${i.days} days. ${whenRolesStart(i)}`,
      "",
      NEXT_AFTER_PROFILE,
      ...signFirst(i),
      "",
    ].join("\n"),
  };
}

/** The button's label, and what we tell a person to do once their profile exists. */
export const INVITE_BUTTON = "Create your profile";
export const NEXT_AFTER_PROFILE = "Then check your profile. Your tasks for the moon appear there, and it is where we run our sessions and track our work together.";

/** The yes, for an address that already has an account here. */
export function adoptedAccountLetter(i: AdoptLetterIn & { signIn: string }): { subject: string; text: string } {
  return {
    subject: `${i.village} adopted your proposal`,
    text: [
      hello(i.firstName),
      "",
      `${i.village} adopted your proposal to hold ${andList(i.roleNames) || "a role"} ${forWhen(i)}.`,
      "",
      `Sign in with this address to see your roles. ${whenRolesStart(i)}`,
      i.signIn,
      ...signFirst(i),
      "",
    ].join("\n"),
  };
}

/**
 * The kind no. It thanks, gives no reasons of its own, and points to three
 * ways to stay close: a quest, the other open roles, the next season.
 */
export function declinedLetter(i: { firstName: string | null; village: string; roleNames: readonly string[]; site: string }): { subject: string; text: string } {
  return {
    subject: `Your proposal to ${i.village}`,
    text: [
      hello(i.firstName),
      "",
      `Thank you for proposing to hold ${andList(i.roleNames) || "a role"} in ${i.village}. We can't say yes this time.`,
      "",
      "We're glad you found us. If you'd like to stay close, here are three ways in:",
      `Take a quest: ${i.site}/quests`,
      `Look at other open roles: ${i.site}/roles`,
      "Or propose again next season. We would be glad to read it.",
      "",
    ].join("\n"),
  };
}

/** The same no, as the status page says it. Links are paths, so the page makes them its own. */
export const DECLINED_PAGE_WORDS = {
  heading: "Thank you for proposing",
  line: "We can't say yes this time, and we're glad you found us. If you'd like to stay close:",
  quests: { label: "Take a quest", href: "/quests" },
  roles: { label: "Look at other open roles", href: "/roles" },
  again: "Or propose again next season.",
} as const;

/** The reply promise on the status page: one sentence, the number from the village's setting. */
export const replyPromise = (days: number): string => `We reply within ${days} ${days === 1 ? "day" : "days"}.`;

// ── Updates about a proposal, to the person who made it ─────────────────────

export type ApplicantUpdateKind = "confirmed" | "first_reply" | "conversation" | "consent" | "terms" | "adopted" | "declined";

/** Kinds that go as an email as well as to the profile. The rest already have a letter of their own, so they only reach the profile. */
export const UPDATE_EMAILS: Record<ApplicantUpdateKind, boolean> = {
  confirmed: false,
  first_reply: true,
  conversation: true,
  consent: true,
  terms: true,
  adopted: false,
  declined: false,
};

/** One update's title (the email's subject and the profile's headline) and its text. */
export function applicantUpdate(
  kind: ApplicantUpdateKind,
  i: { firstName: string | null; village: string; roleNames: readonly string[]; replyDays: number; withRole?: string | null; minutes?: number | null },
): { title: string; text: string } {
  const roles = andList(i.roleNames) || "a role";
  const keep = "Your status page link is in the first email we sent you, so you can follow it any time.";
  const body = (lines: string[]) => [hello(i.firstName), "", ...lines, "", keep, ""].join("\n");
  switch (kind) {
    case "confirmed":
      return { title: `Your proposal is with ${i.village}`, text: `Your proposal to hold ${roles} is with us. ${replyPromise(i.replyDays)}` };
    case "first_reply":
      return { title: `We have taken up your proposal`, text: body([`The role that welcomes people has taken up your proposal to hold ${roles} and is writing to you about a time to talk.`, replyPromise(i.replyDays)]) };
    case "conversation":
      return {
        title: `A conversation is asked for`,
        text: body([`The next step on your proposal to hold ${roles} is a conversation${i.withRole ? ` with ${i.withRole}` : ""}${i.minutes ? `, about ${i.minutes} minutes` : ""}. We will write to you about a time.`]),
      };
    case "consent":
      return { title: `The circle is weighing your proposal`, text: body([`The conversations are written up, and the circle is now asked to consent to your proposal to hold ${roles}. We will tell you what it decides.`]) };
    case "terms":
      return { title: `The terms for your proposal changed`, text: body([`We changed the terms we suggest for your proposal to hold ${roles}. Open your status page to read them, and tell us what you think.`]) };
    case "adopted":
      return { title: `${i.village} adopted your proposal`, text: `${i.village} adopted your proposal to hold ${roles}. ${NEXT_AFTER_PROFILE}` };
    case "declined":
      return { title: `Your proposal to ${i.village}`, text: `Thank you for proposing to hold ${roles}. We can't say yes this time. You can take a quest, look at other open roles, or propose again next season.` };
  }
}

// ── The notices ─────────────────────────────────────────────────────────────

export const OPEN_NOTICE_WORDS = {
  waitingTitle: (roles: readonly string[]) => `A role proposal from outside the village waits on you: ${andList(roles) || "a role"}`,
  waitingBody: "Open it to adopt it for the village or decline it. It waits under Tasks on your profile too.",
  /** To the admins, when nobody holds the power to place people in roles live, or the village holds it. No vote is opened. */
  nobodyToDecideTitle: (roles: readonly string[]) => `A role proposal from outside the village is waiting, and nobody in a role can adopt it now: ${andList(roles) || "a role"}`,
  arrivalFailedTitle: (roles: readonly string[]) => `An adopted proposal's roles could not be set up: ${andList(roles) || "a role"}`,
} as const;
