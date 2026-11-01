/**
 * THE CIRCLE CONSENTS TO A ROLE PROPOSAL, AND THE NUDGES (role proposals PR B).
 *
 * Rye, 2026-10-22: a submitted role proposal is adopted when "the circle
 * consents within 2 business days, OR a holder of the founder, steward or
 * organisation (operations) role power" adopts it. This file is the part with
 * no database and no request in it: the window, the state a proposal's
 * consent is in, an answer, the decision record in words, which nudge is due,
 * and every sentence. The routes (server/routes/roleProposals.ts,
 * server/routes/seatApplications.ts) and the lib
 * (server/lib/roleProposalCircle.ts) read these, so a rule has one spelling.
 *
 * ── TWO PATHS, ONE CLICK ───────────────────────────────────────────────────
 *
 *   (a) THE POWER. A live holder of `org.seat` who is not the candidate adopts
 *       it, at any time, as an application is adopted today (`adoptRefusal`).
 *       Rye confirmed it on 2026-10-31 (sheet item 24a): the founder and
 *       steward roles adopt until they give the power to the village, and
 *       then the village decides by vote. An admin holding no such role does
 *       not adopt.
 *   (b) THE CIRCLE. On submit, every live holder of a role in the circles the
 *       proposed roles sit in, the candidate excluded, is asked to consent or
 *       object within 2 business days. An objection needs a reason, brings
 *       the proposal to the circle's next meeting as a tension in its backlog,
 *       and blocks this path. When every holder asked has consented, or the
 *       window closes with no objection and at least one consent, the
 *       proposal is "Consented by the circle", and a holder of the power
 *       records it with one click.
 *
 * A circle with nobody else in it cannot consent, so only (a) applies, and the
 * payload says so in words.
 *
 * ── THE RECORD NAMES A ROLE, NEVER A PERSON ────────────────────────────────
 *
 * "Adopted on 4 Nov after the circle consented", "Adopted on 4 Nov by the
 * founder's power" (Rye, 2026-10-22: name the role, never the person).
 */
import { addBusinessDays, isWithinBusinessDays } from "./businessDays";
import { civilDateKey } from "./lunar";
import { NEW_PROPOSAL_HREF } from "./roleProposals";
import { looksLikePaymentDetails } from "./seatSettings";
import { adoptsClause, seatList, voteWords, type AdopterFacts } from "./seatApplications";
import { civilDayWords } from "./seasonPlans";

/** The circle's window, in business days on the village's clock. */
export const CONSENT_BUSINESS_DAYS = 2;
/** How long the tension an objection writes may run: a tension's room, the roles' names included. */
export const REASON_MAX = 600;
/**
 * How long an objection's own reason may run (role proposals PR D): the box
 * on the application page holds this many characters, and the route refuses
 * more, so the limit has one spelling. It leaves the tension room for the
 * roles' names in front of it.
 */
export const OBJECTION_MAX = 300;

export const CONSENT_ANSWERS = ["consent", "object"] as const;
export type ConsentAnswer = (typeof CONSENT_ANSWERS)[number];

/**
 * Where a proposal's consent stands.
 *
 *   no-other-holders  nobody else holds a role in its circles; only the power adopts
 *   open              inside the window, no objection yet
 *   objected          somebody objected: path (b) is blocked
 *   consented         the window closed with a consent and no objection
 *   lapsed            the window closed with no consent; only the power adopts
 */
export const CONSENT_STATES = ["no-other-holders", "open", "objected", "consented", "lapsed"] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

/** When the circle's window closes, from the moment the proposal was submitted. PURE. */
export function consentClosesAt(submittedAt: Date, timeZone: string): Date {
  return addBusinessDays(submittedAt, CONSENT_BUSINESS_DAYS, timeZone || "UTC");
}

/** One ask as the state reads it. */
export interface AskIn {
  answer: ConsentAnswer | null;
  closesAt: Date;
}

/**
 * THE STATE, from the asks. PURE. An objection blocks at once, whatever the window.
 *
 * EVERY HOLDER ASKED HAS CONSENTED: consented at once (E8, found end to end
 * on main e1c5eb6). The window is there for answers still to come, so once
 * the last holder asked has consented it has nothing left to wait for, and
 * one holder asked who consented no longer leaves the proposal "Waiting on
 * the circle" for 2 business days. The power still records the adoption.
 */
export function consentState(asks: readonly AskIn[], now: Date): ConsentState {
  if (asks.length === 0) return "no-other-holders";
  if (asks.some((a) => a.answer === "object")) return "objected";
  if (asks.every((a) => a.answer === "consent")) return "consented";
  const closesAt = Math.max(...asks.map((a) => a.closesAt.getTime()));
  if (now.getTime() < closesAt) return "open";
  return asks.some((a) => a.answer === "consent") ? "consented" : "lapsed";
}

/** A holder's answer, or the reason it cannot be one. PURE. An objection needs a reason. */
export function parseConsentAnswer(body: unknown): { ok: true; answer: ConsentAnswer; reason: string | null } | { ok: false; field: string; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const answer = b.answer;
  if (answer !== "consent" && answer !== "object") return { ok: false, field: "answer", error: "Answer consent or object." };
  const raw = typeof b.reason === "string" ? b.reason.trim() : "";
  if (answer === "object" && !raw) return { ok: false, field: "reason", error: CONSENT_WORDS.reasonNeeded };
  if (raw.length > OBJECTION_MAX) return { ok: false, field: "reason", error: `Keep the reason to ${OBJECTION_MAX} characters.` };
  if (raw && looksLikePaymentDetails(raw)) return { ok: false, field: "reason", error: "This looks like a bank or card number. Payment details are never stored in a reason." };
  return { ok: true, answer, reason: raw || null };
}

/** "4 Nov", the day in the village's zone. */
export function shortDay(at: Date, timeZone: string): string {
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: timeZone || "UTC" });
}

/**
 * The power a role carries, as the record says it: "the founder's power" for a
 * one-word role, "the Operations Lead's power" for a longer title, kept as
 * written. A badge, which seats nobody in a role, says so.
 */
export function powerPhrase(roleName: string | null): string {
  const name = String(roleName ?? "").trim();
  if (!name) return "the power a badge grants";
  return /\s/.test(name) ? `the ${name}'s power` : `the ${name.toLowerCase()}'s power`;
}

/** THE DECISION RECORD IN WORDS. PURE. Names a role, never a person. */
export function decisionWords(how: "circle" | "power", at: Date, timeZone: string, roleName: string | null): string {
  const day = shortDay(at, timeZone);
  return how === "circle" ? `Adopted on ${day} after the circle consented` : `Adopted on ${day} by ${powerPhrase(roleName)}`;
}

/**
 * THE SUBMIT CONFIRM'S LINE: who approves it in THIS village (E8). PURE.
 *
 * It replaced one fixed sentence, "the founder, steward or organisation power
 * adopts it", which on a fresh village promised a power nobody held. The
 * facts are the ones `adoptRefusal` reads (`AdopterFacts`): the role carrying
 * the power named as "Role (FirstName)" (Rye, 2026-10-30, signed-in views
 * only), what has to happen first when nobody holds it, and once the village
 * holds it, the vote, with no circle line, because nobody at the door can
 * record a consent then (Rye, 2026-10-31, sheet item 24a).
 */
export function whoApprovesWords(f: AdopterFacts): string {
  return voteWords(f) ?? `The circle consents within ${CONSENT_BUSINESS_DAYS} business days, or ${adoptsClause(f)}`;
}

/** What an objection writes into the circle's backlog: the roles and the reason, never the candidate. PURE. */
export function objectionTension(roleNames: readonly string[], reason: string): string {
  return `An objection to a role proposal for ${seatList(roleNames)}: ${reason}`.slice(0, REASON_MAX);
}

export const CONSENT_WORDS = {
  open: (closesOnDay: string) => `The circle is asked to consent or object by ${civilDayWords(closesOnDay)}.`,
  objected: "A member of the circle objected, so the proposal goes to the circle's next meeting. It can still be adopted by a holder of the power that seats people.",
  consented: "Consented by the circle",
  lapsed: "The circle's 2 business days passed with no consent. It can still be adopted by a holder of the power that seats people.",
  noOtherHolders: "Nobody else holds a role in this circle, so the circle cannot consent. It is adopted by a holder of the power that seats people.",
  /** The one click that records a circle's consent. */
  record: "Record the adoption",
  reasonNeeded: "Say why you object, so the circle can talk it through.",
  notAsked: "This proposal did not ask you. The circle's holders answer it.",
  answered: "You have answered this already.",
  windowClosed: "The circle's 2 business days have passed, so answers are closed.",
  /** The application was withdrawn, or already decided, so the circle's answers are closed (PR D). */
  withdrawn: "This proposal was withdrawn, so answers are closed.",
  decided: "This proposal has been decided, so answers are closed.",
  /** An objection where the circle has no meeting to carry it to yet. */
  notCarried: "The circle has not met yet, so the objection waits on the application page.",
  sessionsOff: "Live Sessions is off, so the objection waits on the application page.",
  askTitle: (roles: readonly string[]) => `Your circle is asked about a role proposal: ${seatList(roles)}`,
  askBody: (closesOnDay: string) => `Consent or object by ${civilDayWords(closesOnDay)}. It waits under Tasks on your profile too.`,
  noVote: "A proposal that changes roles is adopted by its circle's consent or by a holder of the power that seats people. It does not go to a village vote.",

  // The application page's controls (role proposals PR D).
  heading: "The circle's answer",
  askedYou: (closesOnDay: string) => `Your circle asks you to consent or object by ${civilDayWords(closesOnDay)}.`,
  consentButton: "Consent",
  objectButton: "Object",
  objectionGoes: "Your objection goes to the circle's next meeting.",
  reasonLabel: "Why you object",
  reasonHelp: `Up to ${OBJECTION_MAX} characters.`,
  sendObjection: "Send my objection",
  notNow: "Not now",
  youConsented: "You consented.",
  youObjected: "You objected.",
  /** The route takes one answer per holder, so an answer is shown as final. */
  answerStands: "Each holder answers once, so your answer stands.",
  /** Above "Record the adoption", for a holder of the power once the circle has consented. */
  recordLine: "The circle consented. Record the adoption for the village.",
  failed: "That did not reach the server. Try again.",
} as const;

/**
 * THE TALLY under the state (role proposals PR D): who the circle asked, who
 * consented and who objected, as counts and the titles of the roles they hold
 * in the circle. A person is never named.
 */
export const TALLY_WORDS = {
  asked: "Asked",
  consented: "Consented",
  objected: "Objected",
  none: "None",
} as const;

/** "2 (Gate keeper, Orchard keeper)", "1", or "None". PURE. */
export function tallyWords(count: number, roles: readonly string[]): string {
  if (!Number.isFinite(count) || count <= 0) return TALLY_WORDS.none;
  const titles = roles.map((r) => String(r).trim()).filter(Boolean);
  return titles.length ? `${count} (${titles.join(", ")})` : String(count);
}

/** The words for a state, with the window's last day where it is open. PURE. */
export function consentStateWords(state: ConsentState, closesOnDay: string | null): string {
  switch (state) {
    case "open":
      return CONSENT_WORDS.open(closesOnDay ?? "");
    case "objected":
      return CONSENT_WORDS.objected;
    case "consented":
      return CONSENT_WORDS.consented;
    case "lapsed":
      return CONSENT_WORDS.lapsed;
    case "no-other-holders":
      return CONSENT_WORDS.noOtherHolders;
  }
}

// ── The nudges ──────────────────────────────────────────────────────────────

/**
 * Where a nudge and the profile banner send a member: the proposal steps (PR
 * C), which start a draft from the member's current card, or open the draft
 * they already have.
 */
export const PROPOSE_ENTRY_HREF = NEW_PROPOSAL_HREF;

/** Why a member is nudged to propose their roles, most pressing first. */
export const NUDGE_REASONS = ["window-closing", "review-due", "window-open"] as const;
export type NudgeReason = (typeof NUDGE_REASONS)[number];

/** A review date stays a reason to propose for two weeks, so a nudge never fires for one long past. */
export const REVIEW_NUDGE_DAYS = 14;

export const NUDGE_WORDS = {
  heading: "Propose your roles for next season",
  reasons: {
    "window-open": "The window is open",
    "review-due": "Your review is due",
    "window-closing": "The window closes in 2 business days",
  } satisfies Record<NudgeReason, string>,
  body: {
    "window-open": "Planning for next season is open. Propose the roles you will hold.",
    "review-due": "One of your roles is due its review. Propose how you will hold it next season.",
    "window-closing": "Your role proposal is still a draft, and the window closes in 2 business days.",
  } satisfies Record<NudgeReason, string>,
  link: "Propose my roles",
} as const;

/** `GET /api/governance/role-proposals/nudge`, what the profile banner reads. */
export interface NudgePayload {
  show: boolean;
  reason: NudgeReason | null;
  heading: string;
  reasonWords: string | null;
  href: string;
  linkWords: string;
}

/** The payload as the banner trusts it, or null for anything it cannot draw. PURE. */
export function readNudge(v: unknown): NudgePayload | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (typeof p.show !== "boolean" || typeof p.href !== "string" || !p.href.startsWith("/")) return null;
  const reason = (NUDGE_REASONS as readonly string[]).includes(String(p.reason)) ? (p.reason as NudgeReason) : null;
  return {
    show: p.show && reason !== null,
    reason,
    heading: NUDGE_WORDS.heading,
    reasonWords: reason ? NUDGE_WORDS.reasons[reason] : null,
    href: p.href,
    linkWords: NUDGE_WORDS.link,
  };
}

export interface NudgeInput {
  now: Date;
  timeZone: string;
  /** The plan window of the season being planned, or null when none has opened. */
  window: { seasonId: string; opensAt: Date; closesAt: Date } | null;
  /** The member's proposals: their status and the season each is for. */
  proposals: ReadonlyArray<{ status: "draft" | "submitted"; targetSeasonId: string | null }>;
  /** Each live role's review day, YYYY-MM-DD. */
  reviewDays: ReadonlyArray<{ roleId: string; reviewOn: string }>;
}

export interface DueNudge {
  reason: NudgeReason;
  /** What makes it this nudge and no other, for the notice's dedupe key. */
  trigger: string;
}

const addDays = (day: string, n: number): string => {
  const t = new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};

/**
 * EVERY NUDGE DUE FOR ONE MEMBER NOW, most pressing first. PURE.
 *
 *   window-closing  a draft for the season being planned, not submitted, and
 *                   the window closes within 2 business days
 *   review-due      a live role's review day has come, in the last two weeks
 *   window-open     the window is open and the member has no draft and no
 *                   submission for that season
 *
 * Each carries the trigger that makes it unique, so a sweep run as often as
 * it likes sends each one once.
 */
export function dueNudges(input: NudgeInput): DueNudge[] {
  const out: DueNudge[] = [];
  const { now, window } = input;
  const open = !!window && now.getTime() >= window.opensAt.getTime() && now.getTime() < window.closesAt.getTime();
  const forSeason = window ? input.proposals.filter((p) => p.targetSeasonId === window.seasonId || (p.status === "draft" && p.targetSeasonId === null)) : [];
  if (open && window && forSeason.some((p) => p.status === "draft") && !forSeason.some((p) => p.status === "submitted")) {
    if (isWithinBusinessDays(now, window.closesAt, CONSENT_BUSINESS_DAYS, input.timeZone)) out.push({ reason: "window-closing", trigger: window.seasonId });
  }
  const today = civilDateKey(now, input.timeZone || "UTC");
  // Each role's review is its own trigger, so two reviews due the same week are each said once.
  for (const r of input.reviewDays) {
    if (r.reviewOn <= today && today < addDays(r.reviewOn, REVIEW_NUDGE_DAYS)) out.push({ reason: "review-due", trigger: `${r.roleId}:${r.reviewOn}` });
  }
  if (open && window && forSeason.length === 0) out.push({ reason: "window-open", trigger: window.seasonId });
  return out;
}
