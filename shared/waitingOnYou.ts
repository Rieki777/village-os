/**
 * WAITING ON YOU: the decisions a member holds the power to make, on their
 * own task board (Rye, 2026-10-20: "a section in their profile under tasks to
 * approve role proposals that are submitted").
 *
 *   GET /api/governance/waiting-on-me   WaitingPayload, members only
 *
 * Two kinds of row, both read by the server and never worked out here:
 *
 *   applications  every seat application waiting on a seat holder, where the
 *                 reader is a live holder of `org.seat` who may adopt it. The
 *                 rule is `adoptRefusal` (shared/seatApplications.ts), the one
 *                 the application page's adopt button and the adopt route ask,
 *                 so a candidate never sees their own application here.
 *   drafts        open org drafts a submitted proposal made, for a reader who
 *                 may publish them.
 *   toAccept      done tasks the reader may accept as accomplished: they hold
 *                 `org.seat` live, and neither hold the task, sit in its role,
 *                 nor marked it done (`acceptRefusal`, shared/sessionTasks.ts).
 *                 The row carries the control itself, since the task is not on
 *                 the reader's own board. Done in the last three moons only.
 *   raisedWithYou tensions a member raised with a role the reader holds live,
 *                 not answered yet (shared/roleTensions.ts). The row carries
 *                 the words, which only the role's holders and the raiser may
 *                 read, and the controls: take it, answer it, or bring it to
 *                 the circle. It never names who raised it.
 *   toConsent     role proposals the reader's circle is asked about, inside
 *                 the circle's 2 business days, that the reader has not
 *                 answered (shared/roleProposalConsent.ts). Answered, or the
 *                 window closed, and the row is gone. The board draws them
 *                 under their own heading, "Asked to consent" (PR D), each
 *                 linking the application, where Consent and Object live.
 *   openProposals role proposals from somebody with no account yet
 *                 (shared/openProposalDecide.ts), confirmed and not decided:
 *                 `consent` where the reader's circle asks them and they have
 *                 not answered inside the 2 business days, `adopt` where the
 *                 reader may adopt or decline it. Each links the proposal's
 *                 own page, `/open-proposals/:id`.
 *
 * An application leaves the group the moment it leaves `awaiting-holder`:
 * adopted, put to the village or withdrawn. The read filters on the status,
 * so nothing has to remember to take it off.
 *
 * NO COUNTS, as the rest of the board (TaskBoard.tsx). The heading carries no
 * number and nothing totals what anybody has or has not decided. A draft's
 * row says what it would add, which is what the draft IS, never a tally of
 * the reader. No money on a row: the terms stay in the drawer on the
 * application's own page.
 */
import { seatList } from "./seatApplications";
import { civilDayWords } from "./seasonPlans";
import { readHeldTensions, type HeldTension } from "./roleTensions";

export const WAITING_URL = "/api/governance/waiting-on-me";

/** One application waiting on the reader. */
export interface WaitingApplication {
  id: string;
  /** `/role-applications/:id`, where the adopt controls are. */
  href: string;
  seats: string[];
  /** The circles those seats sit in, each named once, in seat order. */
  circles: string[];
  /** The applicant's first name only. */
  applicant: string;
  /** The day it was written, a civil date in the village's zone. */
  appliedOn: string;
}

/** One open org draft the reader may publish. */
export interface WaitingDraft {
  id: string;
  title: string;
  /** Circles and seats the draft would create. */
  circles: number;
  seats: number;
  /** `/review/structure/<batchId>`, or the review queue when the batch is not known. */
  href: string;
}

/** One done task the reader may accept as accomplished. Names no person. */
export interface WaitingAcceptance {
  entryId: number;
  /** The task's words as said in the call. */
  text: string;
  /** The role holding it, by full title, or null for a task a person holds. */
  role: string | null;
  circle: string | null;
  /** The day it was marked done, a civil date in the village's zone. */
  doneOn: string;
}

/**
 * One role proposal the reader's circle is asked to consent to or object to
 * (role proposals PR B), and the reader has not answered. The answer is given
 * at `POST /api/governance/role-applications/:id/consent`.
 */
export interface WaitingConsent {
  proposalId: string;
  applicationId: string;
  /** `/role-applications/:id`, where the proposal is read. */
  href: string;
  /** The roles it proposes, new ones by their proposed name. */
  roles: string[];
  /** The circle the reader was asked for. */
  circle: string;
  /** The proposer's first name only. */
  applicant: string;
  /** The last day of the circle's 2 business days, a civil date in the village's zone. */
  closesOn: string;
}

/**
 * One role proposal from somebody with no account yet, waiting on the reader
 * (open proposals part B). Names the proposer by first name only, never their
 * address.
 */
export interface WaitingOpenProposal {
  id: string;
  /** `/open-proposals/:id`, where it is read, answered and decided. */
  href: string;
  roles: string[];
  /** The circles those roles sit in, each named once. */
  circles: string[];
  proposer: string;
  /** `consent`: the reader's circle asks them. `adopt`: the reader may adopt or decline it. */
  ask: "consent" | "adopt";
  /** The last day of the circle's 2 business days, for a consent row. */
  closesOn: string | null;
  /** The day its address confirmed it, a civil date in the village's zone. */
  confirmedOn: string;
}

export interface WaitingPayload {
  applications: WaitingApplication[];
  drafts: WaitingDraft[];
  /** Absent from a server before PR 4 of the player card: read as none. */
  toAccept?: WaitingAcceptance[];
  /** Absent from a server before PR 5 of the player card: read as none. */
  raisedWithYou?: HeldTension[];
  /** Absent from a server before role proposals PR B: read as none. */
  toConsent?: WaitingConsent[];
  /** Absent from a server before open proposals part B: read as none. */
  openProposals?: WaitingOpenProposal[];
}

/** One gentle reminder, this long after an application was written, to a holder it still waits on. */
export const REMINDER_AFTER_MS = 48 * 60 * 60 * 1000;

/** The review queue, for a draft whose batch is not known. */
export const REVIEW_QUEUE_HREF = "/review";

export function structureReviewHref(batchId: string): string {
  return `/review/structure/${encodeURIComponent(batchId)}`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const WAITING_COPY = {
  heading: "Waiting on you",
  /** Under the board's heading when Live Sessions is off and only this group shows. */
  ledeAlone: "Decisions that wait on a power you hold.",
  loadFailed: "What waits on you did not load.",
  retry: "Try again",
  applicationLine: (applicant: string, seats: readonly string[]): string => `${applicant || "A member"} applied for ${seatList(seats)}`,
  inCircles: (circles: readonly string[]): string => (circles.length ? `In ${seatList(circles)}` : ""),
  appliedOn: (day: string): string => `Applied ${civilDayWords(day)}`,
  applicationAction: "Align for the village, or put it to the village",
  draftLine: (title: string): string => `A draft to publish: ${title}`,
  draftAdds: (circles: number, seats: number): string => {
    if (circles === 0 && seats === 0) return "It changes roles already on the chart";
    if (circles === 0) return `It adds ${plural(seats, "role", "roles")}`;
    if (seats === 0) return `It adds ${plural(circles, "circle", "circles")}`;
    return `It adds ${plural(circles, "circle", "circles")} and ${plural(seats, "role", "roles")}`;
  },
  draftAction: "Read it and publish",
  acceptLine: (text: string): string => `Done: ${text}`,
  acceptWhere: (role: string | null, circle: string | null): string => [role, circle].filter(Boolean).join(" · "),
  doneOn: (day: string): string => `Marked done ${civilDayWords(day)}`,
  acceptAction: "Accept as accomplished",
  acceptNote: "A word about the work, if you like",
  acceptConfirm: "Accept as accomplished",
  acceptCancel: "Not now",
  accepted: "Accepted. It moves to Accomplished.",
  acceptFailed: "That did not save. Try again.",
  /** The holder's notice body, beside its link to the application. */
  holderNoticeBody: "Open it to align for the village or put it to the village. It waits under Tasks on your profile too.",
  reminderTitle: (seats: readonly string[]): string => `Still waiting on a role holder: ${seatList(seats)}`,
  reminderBody: "This application has waited two days. Open it to align for the village or put it to the village.",
  consentLine: (applicant: string, roles: readonly string[]): string => `${applicant || "A member"} proposes to hold ${seatList(roles)} next season`,
  consentBy: (day: string): string => `Consent or object by ${civilDayWords(day)}`,
  consentAction: "Consent or object",
  /** The group's own heading on the board (role proposals PR D). No count. */
  consentHeading: "Asked to consent",
  consentIn: (circle: string): string => (circle.trim() ? `In ${circle.trim()}` : ""),
  consentCloses: (day: string): string => `Closes on ${civilDayWords(day)}`,
  /** A proposal from somebody with no account yet (open proposals part B). */
  openLine: (proposer: string, roles: readonly string[]): string => `${proposer || "Somebody"} proposes to hold ${seatList(roles)} next season`,
  openFrom: "From outside the village",
  openAction: "Adopt it, or decline it",
} as const;

/** What a draft would create, read off its changes. */
export function draftAdds(changes: ReadonlyArray<{ op: string }>): { circles: number; seats: number } {
  let circles = 0;
  let seats = 0;
  for (const c of changes) {
    if (c.op === "create_circle") circles += 1;
    else if (c.op === "create_seat") seats += 1;
  }
  return { circles, seats };
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** The payload as the client trusts it, or null for anything it cannot draw. */
export function readWaiting(v: unknown): WaitingPayload | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Partial<Record<keyof WaitingPayload, unknown>>;
  if (!Array.isArray(p.applications) || !Array.isArray(p.drafts)) return null;
  const applications = (p.applications as any[]).filter(
    (a): a is WaitingApplication =>
      !!a && typeof a.id === "string" && typeof a.href === "string" && isStrings(a.seats) && isStrings(a.circles) && typeof a.appliedOn === "string",
  );
  const drafts = (p.drafts as any[]).filter(
    (d): d is WaitingDraft => !!d && typeof d.id === "string" && typeof d.title === "string" && typeof d.href === "string",
  );
  // A server from before the accept group sends none: the group reads as empty.
  const toAccept = (Array.isArray(p.toAccept) ? (p.toAccept as any[]) : []).filter(
    (t): t is WaitingAcceptance =>
      !!t && Number.isSafeInteger(t.entryId) && t.entryId > 0 && typeof t.text === "string" && typeof t.doneOn === "string",
  ).map((t) => ({
    entryId: t.entryId,
    text: t.text,
    role: typeof t.role === "string" && t.role.trim() ? t.role : null,
    circle: typeof t.circle === "string" && t.circle.trim() ? t.circle : null,
    doneOn: t.doneOn,
  }));
  // A server from before the tension group sends none: the group reads as empty.
  const raisedWithYou = readHeldTensions(p.raisedWithYou);
  // A server from before role proposals PR B sends no consent group: it reads as empty.
  const toConsent = (Array.isArray(p.toConsent) ? (p.toConsent as any[]) : []).filter(
    (c): c is WaitingConsent =>
      !!c && typeof c.proposalId === "string" && typeof c.applicationId === "string" && typeof c.href === "string" && isStrings(c.roles) && typeof c.closesOn === "string",
  );
  // A server from before open proposals part B sends none: the group reads as empty.
  const openProposals = (Array.isArray(p.openProposals) ? (p.openProposals as any[]) : []).filter(
    (o): o is WaitingOpenProposal =>
      !!o &&
      typeof o.id === "string" &&
      typeof o.href === "string" &&
      isStrings(o.roles) &&
      isStrings(o.circles) &&
      typeof o.proposer === "string" &&
      (o.ask === "consent" || o.ask === "adopt") &&
      (o.closesOn === null || typeof o.closesOn === "string") &&
      typeof o.confirmedOn === "string",
  );
  return { applications, drafts, toAccept, raisedWithYou, toConsent, openProposals };
}
