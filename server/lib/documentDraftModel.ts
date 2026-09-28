/**
 * A MODEL-ASSISTED DRAFT of the canvas from one member's document: the
 * contract of ReGen's `analyzeDocument` (regen server/routes/plays.ts), with
 * the canvas's twelve blocks as its sections (plan 5.5).
 *
 * Reached only after the documents route has checked two things itself: that
 * a key exists (`modelRoute`), and that the document's owner said yes to the
 * disclosure naming where the text goes. This file does not ask either
 * question again and must never be called without both.
 *
 * It spends through `callAssistant`, so every guard the guide has applies: the
 * per-IP burst limit, the mode's day budget, the borrowed-key ceiling, and a
 * member's own key paying its own allowance. The spend is recorded like every
 * other call, including a refusal that had already bought tokens.
 *
 * Any failure, from a refused call to an answer that is not JSON, comes back
 * as the ported contract's fallback: nothing drafted and every block a gap,
 * with `read: false` so the page can say plainly that the model's answer
 * could not be used.
 */
import { callAssistant, DEFAULT_ASSISTANT_MODEL, type MemberKey } from "./assistant";
import { recordAssistantUsage } from "./assistantUsage";
import { instanceIdentity } from "./identity";
import type { Pool } from "mysql2/promise";
import { modelDraftMessage, modelDraftPrompt, modelFallback, parseModelDraft, type ModelDraftResult } from "../../shared/documentDraft";

/** Room for twelve passages. The member mode's own cap is for a chat reply. */
export const MODEL_DRAFT_MAX_TOKENS = 4000;

export interface ModelDraftInput {
  pool: Pool;
  userId: string;
  clientIp: string;
  title: string;
  text: string;
  memberKey: MemberKey | null;
}

/** What the route hears: a draft, or the refusal the guide's own guards gave. */
export type ModelDraftOutcome = { ok: true; result: ModelDraftResult } | { ok: false; status: number; error: string };

export async function draftWithModel(input: ModelDraftInput): Promise<ModelDraftOutcome> {
  const call = await callAssistant({
    mode: "member",
    system: modelDraftPrompt(),
    messages: [{ role: "user", content: modelDraftMessage(input.title, input.text) }],
    maxTokens: MODEL_DRAFT_MAX_TOKENS,
    model: DEFAULT_ASSISTANT_MODEL,
    clientIp: input.clientIp,
    userId: input.userId,
    memberKey: input.memberKey,
  });
  const paid = call.ok
    ? { keySource: call.keySource, usage: call.usage, iterations: call.iterations, stopReason: call.stopReason }
    : call.spent;
  if (paid) {
    await recordAssistantUsage(input.pool, {
      villageId: instanceIdentity().instanceId,
      mode: "member",
      model: DEFAULT_ASSISTANT_MODEL,
      keySource: paid.keySource,
      userId: input.userId,
      usage: paid.usage,
      iterations: paid.iterations,
      stopReason: paid.stopReason,
      path: "loop",
    });
  }
  if (!call.ok) {
    // The guards' own refusals (a day budget spent, too many calls from one
    // place) are said as they came; anything else is the contract's fallback.
    if (call.status === 429 || call.status === 503) return { ok: false, status: call.status, error: refusalWords(call.error) };
    return { ok: true, result: { read: false, draft: modelFallback() } };
  }
  return { ok: true, result: parseModelDraft(call.text) };
}

/** A guard's refusal, from the member's side of the screen. */
function refusalWords(error: string): string {
  if (error === "assistant-unavailable") return "No model is connected here any more. The words-only draft still works.";
  if (/budget|allowance|cap/i.test(error)) return "The model has done all it can for today. The words-only draft still works.";
  return error || "The model could not be asked just now. The words-only draft still works.";
}
