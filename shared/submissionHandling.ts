/**
 * What an admin Remove, Redirect or Done keeps, and what is owed to Sera.
 *
 * The reason and the note are stored for the village either way. Sera is told
 * only when the member's switch is on, the request is one of Sera's tasks,
 * and we know which Sera person it belongs to. A note is stripped of emails
 * and phone numbers before it is stored.
 */
import {
  libraryCode, parseFeedback, reviewOf, stripContact, SCREEN_REASON_WORDS,
  type FeedbackAction, type ScreenReason,
} from "./memberTaskFeedback";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

export function seraTaskIdFrom(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  for (const key of ["seraTaskId", "sera_task_id", "externalId", "external_id"]) {
    const value = row[key];
    if (typeof value === "string" && SAFE_ID.test(value)) return value;
  }
  return null;
}

function safeId(value: unknown): string | null {
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

export interface HandlingPlan {
  action: Extract<FeedbackAction, "remove" | "redirect" | "done">;
  feedbackId: string;
  reason: ScreenReason | null;
  note: string | null;
  code: ReturnType<typeof libraryCode>;
  review: "auto" | "steward";
  toUserId: string | null;
  toRoleId: string | null;
  seraTaskId: string | null;
  toldSera: boolean;
  eventText: string;
  /** Queued for Sera when toldSera is true. */
  feedbackPayload: Record<string, unknown> | null;
  /** A note for Sera. The route holds it until notes are released. */
  notePayload: Record<string, unknown> | null;
}

export function planSubmissionHandling(
  body: unknown,
  opts: { share: boolean; submissionId: string; data: unknown; ownerId: string | null },
): { ok: true; plan: HandlingPlan } | { ok: false; problem: string } {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const action = raw.action === "remove" || raw.action === "redirect" || raw.action === "done" ? raw.action : null;
  if (!action) return { ok: false, problem: "Choose remove, redirect or done." };
  const parsed = parseFeedback(body, action);
  if (!parsed.ok) return parsed;
  const toUserId = safeId(raw.toUserId);
  const toRoleId = safeId(raw.toRoleId);
  if (action === "redirect" && !toUserId && !toRoleId) return { ok: false, problem: "Choose who should have this." };
  if (action === "redirect" && toUserId && toRoleId) return { ok: false, problem: "Choose a person or a role, not both." };
  const seraTaskId = seraTaskIdFrom(opts.data) ?? seraTaskIdFrom({ seraTaskId: raw.seraTaskId });
  const toldSera = opts.share && !!seraTaskId && !!opts.ownerId;
  const reasonWords = parsed.value.reason ? SCREEN_REASON_WORDS[parsed.value.reason] : "Done";
  const verb = action === "remove" ? "Removed" : action === "redirect" ? "Handed on" : "Marked done";
  const eventText = stripContact(`${verb} a request. Reason: ${reasonWords}.`).slice(0, 240);
  const note = parsed.value.note ? stripContact(parsed.value.note) : null;
  const code = libraryCode(action, parsed.value.reason);
  const payloadBase = toldSera
    ? {
        task_id: seraTaskId,
        owner_id: opts.ownerId,
        reason_code: code ?? "not_a_task",
        action,
        feedback_id: parsed.value.feedbackId,
        surface: "board",
        screen_reason: parsed.value.reason,
        ...(toUserId ? { reassign_to_owner_id: null, redirect_target: { type: "person" } } : {}),
        ...(!toUserId && toRoleId ? { redirect_target: { type: "role", role_id: toRoleId } } : {}),
        context: { surface: "board", screen_reason: parsed.value.reason, submission_id: opts.submissionId },
      }
    : null;
  return {
    ok: true,
    plan: {
      action,
      feedbackId: parsed.value.feedbackId,
      reason: parsed.value.reason,
      note,
      code,
      review: reviewOf(action, parsed.value.reason, !!toUserId),
      toUserId,
      toRoleId,
      seraTaskId,
      toldSera,
      eventText,
      feedbackPayload: payloadBase,
      notePayload: toldSera && note ? { ...payloadBase, note, feedback_id: `${parsed.value.feedbackId}-note` } : null,
    },
  };
}
