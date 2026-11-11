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
import { LANGUAGES, wordsIn, type ApplicantLanguage } from "./applicantWords";
import { changedIn, currentCommitment, currentWords, openTalks, type CounterOffer, type OfferKey } from "./counterOffer";
import { TERM_KEYS, type TermAnswers, type TermsWords } from "./termsWords";

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

  // Every seat taken (audit B3, 11 Nov 2026): refused by default, adopted for later only on purpose.
  seatsFull: (full: readonly FullSeatWords[]) =>
    `${full.map(seatCountLine).join(". ")}. Adopting now would promise a role nobody can start. You can adopt them for when a place opens: we tell them their role starts then, never sooner.`,
  adoptWhenASeatOpens: "Adopt for when a place opens",
  forWhenASeatOpens: "for when a place opens",
  adoptedAccountWaits: "Adopted for when a place opens. That address already has an account here, so no invitation was needed: their role starts once a place is free.",

  // What is left before Adopt can be pressed (audit M10).
  leftHeading: "Before you can adopt",
  conversationMissing: (role: string) => `The conversation with ${role} is not written up yet.`,
  conversationUnheld: (role: string) => `Nobody holds ${role} right now, so nobody can hold that conversation. Seat somebody in ${role} on the chart, and they can hold it.`,
  chartLink: "Open the chart",
} as const;

/**
 * THE HOLDER'S WORDS WHEN EVERY SEAT IS TAKEN (audit B3): in the bell and on the profile's start
 * steps, in place of "Your role starts within the hour after the last one", which would not be true.
 */
export const SEAT_OPENS_WORDS = {
  after: (roles: readonly string[]) =>
    `Every place in ${andList(roles) || "your role"} is filled right now, so your role starts when a place opens, after these steps. We will tell you the day it does. Aligning is the village's way of signing.`,
  heldTitle: "Your role starts when a place opens",
  held: (roles: readonly string[]) => `Every place in ${andList(roles) || "your role"} is filled right now. Your terms are kept, and your role starts when a place opens. We will tell you the day it does.`,
} as const;

/** A role that has no free place, as the deciders read it: its name, how many seats it has, how many are taken or promised. */
export interface FullSeatWords {
  name: string;
  seats: number;
  taken: number;
}

/** "Lead Financial Steward has room for 1 person, and that place is filled" */
export function seatCountLine(s: FullSeatWords): string {
  if (s.seats <= 0) return `${s.name} has no places`;
  if (s.seats === 1) return `${s.name} has room for 1 person, and that place is filled`;
  if (s.seats === 2) return `${s.name} has room for 2 people, and both places are filled`;
  return `${s.name} has room for ${s.seats} people, and all ${s.seats} places are filled`;
}

// ── What was agreed is what is signed (audit B2) ───────────────────────────

/**
 * THE TERMS AS AGREED AT ADOPTION: the role's offer, each counter-offer
 * revision on top, and the applicant's last answer to each setting. PURE.
 *
 *   words          the wording now for each setting (`currentWords`)
 *   commitmentPct  the commitment now (`currentCommitment`): theirs, or the last change
 *   answers        their answer per setting: a CHANGED setting reads their reply to its
 *                  latest change, and one still waiting reads "talk"; an unchanged one
 *                  reads what they sent on the form
 *   open           the settings still being talked about, by key
 *
 * This is what becomes the application's settings and the words the holder aligns with,
 * so nothing negotiated is dropped at the door.
 */
export function agreedTerms(p: { base: TermsWords; answers: TermAnswers; theirs: number | null; co: CounterOffer | null }): {
  words: TermsWords;
  commitmentPct: number | null;
  answers: TermAnswers;
  open: OfferKey[];
} {
  const co = p.co;
  const at = changedIn(co);
  const answers: TermAnswers = {};
  for (const k of TERM_KEYS) {
    const given = p.answers[k];
    if (co && at[k]) {
      const r = co.replies[k];
      answers[k] = r && r.rev >= (at[k] ?? 0) ? { choice: r.choice, note: r.note } : { choice: "talk", note: given?.note ?? "" };
    } else if (given) {
      answers[k] = { choice: given.choice, note: given.note };
    }
  }
  return { words: currentWords(p.base, co), commitmentPct: currentCommitment(p.theirs, co), answers, open: openTalks({ answers: p.answers, co }) };
}

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
  lang?: ApplicantLanguage;
  /** A decider's note for the applicant. */
  note?: string | null;
  /** Every seat of a role is taken: adopted for when a seat opens (audit B3). The letter promises no day. */
  waitsForSeat?: boolean;
}

/**
 * THE ADOPTION LETTER'S EXTRA LINES (audit P11 and B3), in every applicant language. Kept here
 * beside the letters so the two languages are judged together (shared/applicantWords.ts holds the rest).
 */
export const ADOPT_MORE: Record<ApplicantLanguage, {
  nextHeading: string;
  stepCreate: string;
  stepSignIn: string;
  stepAgreements: string;
  stepFirstDays: string;
  seatOpens(roles: string): string;
}> = {
  en: {
    nextHeading: "What comes next:",
    stepCreate: "1. Create your profile with the button above.",
    stepSignIn: "1. Sign in with this address.",
    stepAgreements: "2. Your profile lists any agreements we ask you to align with before your role starts, such as our confidentiality agreement and your role's terms. Each one has its own door there.",
    stepFirstDays: "3. Once your role starts, your profile shows your first days with us, step by step.",
    seatOpens: (roles) => `Every place in ${roles} is filled right now, so your role starts when a place opens. We will tell you the day it does.`,
  },
  es: {
    nextHeading: "Lo que sigue:",
    stepCreate: "1. Crea tu perfil con el botón de arriba.",
    stepSignIn: "1. Inicia sesión con este correo.",
    stepAgreements: "2. Tu perfil muestra los acuerdos con los que te pedimos alinear antes de que empiece tu rol, como nuestro acuerdo de confidencialidad y los términos de tu rol. Cada uno tiene allí su propia puerta.", // check: "alinear", "puerta"
    stepFirstDays: "3. Cuando empiece tu rol, tu perfil muestra tus primeros días con nosotros, paso a paso.",
    seatOpens: (roles) => `Todos los lugares de ${roles} están ocupados ahora, así que tu rol empieza cuando se abra un lugar. Te avisaremos el día que eso pase.`, // check: "lugar" for a place in a role
  },
};

const nextSteps = (i: AdoptLetterIn, first: "create" | "signIn"): string[] => {
  const m = ADOPT_MORE[i.lang ?? "en"] ?? ADOPT_MORE.en;
  return ["", m.nextHeading, first === "create" ? m.stepCreate : m.stepSignIn, m.stepAgreements, m.stepFirstDays];
};

const noteLines = (lang: ApplicantLanguage | undefined, note: string | null | undefined): string[] => (note ? ["", wordsIn(lang).noteIntro, note] : []);

/** Signing comes before seating and before any vote (Rye's ruling; the role card's Agreements). */
const signFirst = (i: AdoptLetterIn): string[] => (i.loveLetter ? ["", wordsIn(i.lang).adopt.signFirst(), i.loveLetter] : []);

const whenRolesStart = (i: AdoptLetterIn) => {
  const w = wordsIn(i.lang);
  // A role with every seat taken starts when one opens, and the letter promises no day (audit B3).
  if (i.waitsForSeat) return (ADOPT_MORE[i.lang ?? "en"] ?? ADOPT_MORE.en).seatOpens(w.list(i.roleNames) || w.aRole);
  return i.moon ? w.adopt.moonRuns(i.moon.from, i.moon.to) : w.adopt.seasonStarts(i.season, i.startsOn);
};
const forWhen = (i: AdoptLetterIn) => (i.moon ? wordsIn(i.lang).adopt.forThisMoon : wordsIn(i.lang).adopt.forNextSeason);

/** The yes, with the invitation, for an address with no account here. The email shows `button` as a button and keeps the link in the text. */
export function adoptedInviteLetter(i: AdoptLetterIn & { link: string; days: number }): { subject: string; text: string; button: { label: string; url: string } } {
  const w = wordsIn(i.lang);
  return {
    subject: w.adopt.subject(i.village),
    button: { label: w.adopt.button, url: i.link },
    text: [
      w.hello(i.firstName),
      "",
      w.adopt.headline(i.village, w.list(i.roleNames) || w.aRole, forWhen(i)),
      ...noteLines(i.lang, i.note),
      "",
      w.adopt.inviteIntro,
      i.link,
      "",
      w.adopt.inviteWorks(i.days, whenRolesStart(i)),
      "",
      w.adopt.nextAfterProfile,
      ...nextSteps(i, "create"),
      ...signFirst(i),
      "",
    ].join("\n"),
  };
}

/** The button's label, and what we tell a person to do once their profile exists. */
export const INVITE_BUTTON = LANGUAGES.en.adopt.button;
export const NEXT_AFTER_PROFILE = LANGUAGES.en.adopt.nextAfterProfile;

/** The yes, for an address that already has an account here. */
export function adoptedAccountLetter(i: AdoptLetterIn & { signIn: string }): { subject: string; text: string } {
  const w = wordsIn(i.lang);
  return {
    subject: w.adopt.subject(i.village),
    text: [
      w.hello(i.firstName),
      "",
      w.adopt.headline(i.village, w.list(i.roleNames) || w.aRole, forWhen(i)),
      ...noteLines(i.lang, i.note),
      "",
      w.adopt.signIn(whenRolesStart(i)),
      i.signIn,
      ...nextSteps(i, "signIn"),
      ...signFirst(i),
      "",
    ].join("\n"),
  };
}

/**
 * The kind no. It thanks, gives no reasons of its own (a decider's note is the
 * only reason, and only when they write one), and points to three ways to stay
 * close: a quest, the other open roles, the next season.
 */
export function declinedLetter(i: { firstName: string | null; village: string; roleNames: readonly string[]; site: string; lang?: ApplicantLanguage; note?: string | null }): { subject: string; text: string } {
  const w = wordsIn(i.lang);
  return {
    subject: w.declined.subject(i.village),
    text: [
      w.hello(i.firstName),
      "",
      w.declined.thanks(w.list(i.roleNames) || w.aRole, i.village),
      ...noteLines(i.lang, i.note),
      "",
      w.declined.stayClose,
      w.declined.quest(`${i.site}/quests`),
      w.declined.roles(`${i.site}/roles`),
      w.declined.again,
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
export const replyPromise = (days: number, lang?: ApplicantLanguage): string => wordsIn(lang).replyPromise(days);

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

/** One update's title (the email's subject and the profile's headline) and its text. A decider's note rides under the text. */
export function applicantUpdate(
  kind: ApplicantUpdateKind,
  i: { firstName: string | null; village: string; roleNames: readonly string[]; replyDays: number; withRole?: string | null; minutes?: number | null; lang?: ApplicantLanguage; note?: string | null; statusLink?: string | null },
): { title: string; text: string } {
  const w = wordsIn(i.lang);
  const u = w.update;
  const roles = w.list(i.roleNames) || w.aRole;
  const body = (lines: string[]) => [w.hello(i.firstName), "", ...lines, ...noteLines(i.lang, i.note), "", i.statusLink ? w.statusLinkLine(i.statusLink) : w.keepStatusLink, ""].join("\n");
  const withNote = (text: string) => [text, ...noteLines(i.lang, i.note)].join("\n");
  switch (kind) {
    case "confirmed":
      return { title: u.confirmedTitle(i.village), text: u.confirmed(roles, w.replyPromise(i.replyDays)) };
    case "first_reply":
      return { title: u.firstReplyTitle, text: body([u.firstReply(roles), w.replyPromise(i.replyDays)]) };
    case "conversation":
      return { title: u.conversationTitle, text: body([u.conversation(roles, i.withRole ?? null, i.minutes ?? null)]) };
    case "consent":
      return { title: u.consentTitle, text: body([u.consent(roles)]) };
    case "terms":
      return { title: u.termsTitle, text: body([u.terms(roles)]) };
    case "adopted":
      return { title: u.adoptedTitle(i.village), text: withNote(u.adopted(i.village, roles, w.adopt.nextAfterProfile)) };
    case "declined":
      return { title: u.declinedTitle(i.village), text: withNote(u.declined(roles)) };
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
