/**
 * THE REVIEW ROUND, THE PURE HALF (Rye, 2026-11-06, 3c and 3d; spec US3, US4,
 * R3, R4, R9, R20, R39, C3, C9).
 *
 * Before a change request goes to the vote the village reviews it, in the
 * sociocratic words the app already uses: a question, a concern, an objection
 * (a reason it would harm the village or keep it from its purpose), or consent
 * ("I can live with this"). The author answers every objection, or takes in an
 * edit somebody suggested, which is a new revision.
 *
 * Here: the review length, the checklist that says when it may go to the vote,
 * who may post what, and which powers' holders are asked to review.
 */
import type { Capability } from "./capabilities";
import { REVIEW_DAYS_KEY } from "./changeRequestLimits";

export { REVIEW_DAYS_KEY, REVIEW_DAYS_DEFAULT } from "./changeRequestLimits";

export const NOTE_BODY_MAX = 2000;

/** What a member may post in a review. Answers and suggested edits have their own doors. */
export const NOTE_KINDS = ["question", "concern", "objection", "consent"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the review may end: the clock's last start plus the LONGER of the
 * length when review opened and the length now (R20), so a vote that lowers
 * the dial shortens no review already running. 0 means no wait (Article 0).
 */
export function reviewEndsAt(clockFrom: Date, daysAtOpen: number, daysNow: number): Date {
  const days = Math.max(0, Math.trunc(Number(daysAtOpen) || 0), Math.trunc(Number(daysNow) || 0));
  return new Date(clockFrom.getTime() + days * DAY_MS);
}

export interface NotePost {
  kind: NoteKind;
  body: string;
  state: string;
  /** The request comes from an agent acting for somebody, not the person. */
  byAgent: boolean;
  /** This member already has an unanswered objection on this revision. */
  openObjectionThisRevision: boolean;
}

/** Why this note cannot be posted, or null. */
export function notePostProblem(input: NotePost): string | null {
  if (!(NOTE_KINDS as readonly string[]).includes(input.kind)) return "A review takes a question, a concern, an objection, or consent.";
  if (input.state === "voting") return "This change request is in the vote now, so its review is closed. Say it on the ballot.";
  if (input.state !== "in_review") return "This change request is not in review.";
  if (input.byAgent && (input.kind === "consent" || input.kind === "objection")) {
    return "Consent and objection come from the person, never through an agent.";
  }
  const body = String(input.body ?? "").trim();
  if (body.length > NOTE_BODY_MAX) return `A note is at most ${NOTE_BODY_MAX} characters.`;
  if (input.kind === "objection") {
    if (!body) return "Say what harm it could do to the village, or what it would stop us doing.";
    if (input.openObjectionThisRevision) return "You already have an objection waiting for an answer on this version. Add to it once it is answered.";
  }
  if ((input.kind === "question" || input.kind === "concern") && !body) return "Write your question or concern.";
  return null;
}

export interface ReadinessInput {
  now: Date;
  endsAt: Date;
  changes: number;
  objections: { answered: boolean; postedAfterEnd: boolean }[];
}

export interface ReadinessLine {
  key: "changes" | "review_time" | "objections";
  done: boolean;
  words: string;
}

const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/**
 * The "ready for the vote" checklist (R39): every line has a state in words,
 * so the page never shows a silently disabled button. An objection posted
 * after the review ended does not hold it up; it travels to the vote (R9).
 */
export function readiness(input: ReadinessInput): { ready: boolean; lines: ReadinessLine[] } {
  const waiting = input.objections.filter((o) => !o.answered && !o.postedAfterEnd).length;
  const timeDone = input.now.getTime() >= input.endsAt.getTime();
  const lines: ReadinessLine[] = [
    { key: "changes", done: input.changes > 0, words: input.changes > 0 ? "Done" : "Add at least one change" },
    { key: "review_time", done: timeDone, words: timeDone ? "Done" : `Waits until ${when(input.endsAt)}` },
    {
      key: "objections",
      done: waiting === 0,
      words: waiting === 0 ? "Done" : `${waiting} objection${waiting === 1 ? "" : "s"} waiting for your answer`,
    },
  ];
  return { ready: lines.every((l) => l.done), lines };
}

/**
 * Whose holders are asked to review a change (C9): a module's own powers for
 * its dials, `dial.set` for any other dial, and the power behind each other
 * kind. `moduleCapsOf` answers the capabilities of the module that owns a dial
 * key, or null when no module owns it.
 */
export function powersTouchedBy(
  change: { kind?: unknown; key?: unknown; [field: string]: unknown },
  moduleCapsOf: (dialKey: string) => readonly string[] | null,
): Capability[] {
  switch (change.kind) {
    case "module_lifecycle":
      return ["module.switch"];
    case "brand_field":
      return ["story.tell"];
    case "mint_rule":
    case "mint_rule_create":
      return ["cash.pay"];
    case "mode_switch":
    case "weight_allocation":
      return ["dial.set"];
    default: {
      const caps = moduleCapsOf(String(change.key ?? ""));
      return caps && caps.length ? (caps as Capability[]) : ["dial.set"];
    }
  }
}
