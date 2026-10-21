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

export const WAITING_URL = "/api/governance/waiting-on-me";

/** One application waiting on the reader. */
export interface WaitingApplication {
  id: string;
  /** `/seat-applications/:id`, where the adopt controls are. */
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

export interface WaitingPayload {
  applications: WaitingApplication[];
  drafts: WaitingDraft[];
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
    if (circles === 0 && seats === 0) return "It changes seats already on the chart";
    if (circles === 0) return `It adds ${plural(seats, "seat", "seats")}`;
    if (seats === 0) return `It adds ${plural(circles, "circle", "circles")}`;
    return `It adds ${plural(circles, "circle", "circles")} and ${plural(seats, "seat", "seats")}`;
  },
  draftAction: "Read it and publish",
  /** The holder's notice body, beside its link to the application. */
  holderNoticeBody: "Open it to align for the village or put it to the village. It waits under Tasks on your profile too.",
  reminderTitle: (seats: readonly string[]): string => `Still waiting on a seat holder: ${seatList(seats)}`,
  reminderBody: "This application has waited two days. Open it to align for the village or put it to the village.",
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
  return { applications, drafts };
}
