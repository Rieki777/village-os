/**
 * Why a member removed, redirected, finished or re-tiered a task, and how
 * that crosses to Organisational Memory (PR E, the feedback bridge).
 *
 * THE LIBRARY TAKES EIGHT CODES AND NOTHING ELSE. The screen offers words a
 * member recognises; `libraryCode` maps each onto one of the eight. Context
 * (where the task was shown, its score, how long it sat on the list, which
 * surface) crosses from day one. A NOTE is held in the village until a steward
 * releases notes, and has emails and phone numbers stripped before it leaves.
 * Journal text never crosses: it is not in the feedback at all.
 *
 * WHAT THE LIBRARY APPLIES BY ITSELF and what waits for a steward:
 *   auto     done, removed as already done, redirected to a named person, priority changed
 *   steward  merged, removed for any other reason, heard wrong
 * Either way the member's own list changes at once: a removed task leaves it
 * immediately, and our tombstone is the guarantee it never comes back.
 */

export const LIBRARY_CODES = [
  "not_mine", "wrong_role", "duplicate", "already_done", "not_now", "not_a_task", "wrong_priority", "wrong_due_date",
] as const;
export type LibraryCode = (typeof LIBRARY_CODES)[number];

/** What the member picks on the card. */
export const SCREEN_REASONS = [
  "not_mine", "not_my_role", "better_for_someone_else", "needs_named_person", "already_done", "duplicate",
  "merged", "wrong_timing", "not_a_task", "wrong_priority", "wrong_due_date", "heard_wrong", "other",
] as const;
export type ScreenReason = (typeof SCREEN_REASONS)[number];

export const SCREEN_REASON_WORDS: Record<ScreenReason, string> = {
  not_mine: "This isn't mine",
  not_my_role: "Not my role",
  better_for_someone_else: "Better for someone else",
  needs_named_person: "It needs a named person",
  already_done: "Already done",
  duplicate: "It's a duplicate",
  merged: "I merged it with another task",
  wrong_timing: "Not now",
  not_a_task: "It isn't a task",
  wrong_priority: "Wrong priority",
  wrong_due_date: "Wrong due date",
  heard_wrong: "Organisational Memory heard it wrong",
  other: "Something else",
};

/** The reasons offered for Remove, and for Redirect. */
export const REMOVE_CHOICES: readonly ScreenReason[] = [
  "already_done", "not_mine", "duplicate", "merged", "wrong_timing", "not_a_task", "heard_wrong", "other",
];
export const REDIRECT_CHOICES: readonly ScreenReason[] = ["not_my_role", "better_for_someone_else", "needs_named_person"];

export const LIBRARY_CODE_OF: Record<ScreenReason, LibraryCode | null> = {
  not_mine: "not_mine",
  not_my_role: "wrong_role",
  better_for_someone_else: "wrong_role",
  needs_named_person: "wrong_role",
  already_done: "already_done",
  duplicate: "duplicate",
  merged: "duplicate",
  wrong_timing: "not_now",
  not_a_task: "not_a_task",
  wrong_priority: "wrong_priority",
  wrong_due_date: "wrong_due_date",
  heard_wrong: "not_a_task",
  other: null,
};

export const ACTIONS = ["remove", "redirect", "done", "priority_changed"] as const;
export type FeedbackAction = (typeof ACTIONS)[number];

export const SURFACES = ["profile", "journal", "assistant", "board"] as const;
export type Surface = (typeof SURFACES)[number];

export interface FeedbackContext {
  shownIn: "today" | "week" | "later" | "hidden" | null;
  rankScore: number | null;
  daysOnList: number | null;
  surface: Surface;
}

export const NOTE_MAX = 1000;
/** Feedback is kept this long, then deleted. */
export const RETENTION_DAYS = 365;

/** Which side decides: the library by itself, or a steward. */
export function reviewOf(action: FeedbackAction, reason: ScreenReason | null, redirectToPerson: boolean): "auto" | "steward" {
  if (action === "done" || action === "priority_changed") return "auto";
  if (action === "redirect") return redirectToPerson ? "auto" : "steward";
  return reason === "already_done" ? "auto" : "steward";
}

/** The code the library gets for an action. Done is already_done; a priority change is wrong_priority. */
export function libraryCode(action: FeedbackAction, reason: ScreenReason | null): LibraryCode | null {
  if (action === "done") return "already_done";
  if (action === "priority_changed") return "wrong_priority";
  return reason ? LIBRARY_CODE_OF[reason] : null;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Seven or more digits, allowing spaces, dots, dashes, brackets and a leading +.
const PHONE = /(?:\+?\d[\d\s().-]{5,}\d)/g;

/** A note with every email and phone number taken out, trimmed to the cap. */
export function stripContact(note: string): string {
  return note
    .replace(EMAIL, "[email removed]")
    .replace(PHONE, (m) => (/^\s*\d{4}-\d{2}-\d{2}\s*$/.test(m) ? m : (m.match(/\d/g) ?? []).length >= 7 ? "[number removed]" : m))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NOTE_MAX);
}

const FEEDBACK_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const isFeedbackId = (v: unknown): v is string => typeof v === "string" && FEEDBACK_ID.test(v);

export interface FeedbackInput {
  feedbackId: string;
  reason: ScreenReason | null;
  note: string | null;
  context: FeedbackContext;
}

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? null : Math.min(hi, Math.max(lo, n));
};

/** A feedback body from the card. The reason is required for remove and redirect. */
export function parseFeedback(body: unknown, action: FeedbackAction): { ok: true; value: FeedbackInput } | { ok: false; problem: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!isFeedbackId(b.feedbackId)) return { ok: false, problem: "feedback_id_required" };
  let reason: ScreenReason | null = null;
  if (b.reason != null) {
    if (!SCREEN_REASONS.includes(b.reason as ScreenReason)) return { ok: false, problem: "That is not one of the reasons." };
    reason = b.reason as ScreenReason;
  }
  if ((action === "remove" || action === "redirect") && !reason) return { ok: false, problem: "Pick a reason." };
  const rawNote = typeof b.note === "string" ? b.note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, NOTE_MAX) : "";
  const c = (b.context && typeof b.context === "object" ? b.context : {}) as Record<string, unknown>;
  const shown = ["today", "week", "later", "hidden"].includes(String(c.shownIn)) ? (c.shownIn as FeedbackContext["shownIn"]) : null;
  const surface = SURFACES.includes(c.surface as Surface) ? (c.surface as Surface) : "profile";
  return {
    ok: true,
    value: {
      feedbackId: b.feedbackId,
      reason,
      note: rawNote || null,
      context: { shownIn: shown, rankScore: num(c.rankScore, -1000, 1000), daysOnList: num(c.daysOnList, 0, 100000), surface },
    },
  };
}

/** The steward import's evidence filter (Roots, Nov 2): exactly the tasks loaded for this village. */
export const DEFAULT_IMPORT_PHRASE = "Loaded directly into Sera because the amora.regencivics.earth profile page does not yet read from here"; // brand-ok: the library's literal evidence text, steward-editable

/** The library's test person for end-to-end sends (Roots, Nov 2). Never a real member's id. */
export const SERA_TEST_OWNER_ID = "40d0a88e-f36a-8150-9dd6-ec0acc8381fa";
