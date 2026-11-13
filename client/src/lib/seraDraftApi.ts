/**
 * One press of "Ask Sera for a first draft" (server/routes/proposalDrafts.ts).
 *
 *   askForDraft   POST /api/governance/proposal-drafts
 *
 * The body is `draftBody` (shared/seraDrafts.ts) and nothing else. A failure
 * answers the server's own sentence; a guide that takes longer than the wait
 * answers `slow`, and the form carries on without it.
 */
import { authToken } from "@/lib/gameApi";
import { DRAFT_WORDS, type DraftReply, type DraftRequest } from "@shared/seraDrafts";

export const DRAFT_URL = "/api/governance/proposal-drafts";
/** A little longer than the server waits for Sera (60 seconds). */
export const DRAFT_WAIT_MS = 75_000;

export type DraftResult = { ok: true; reply: DraftReply } | { ok: false; slow: boolean; error: string };

export async function askForDraft(body: DraftRequest, waitMs = DRAFT_WAIT_MS): Promise<DraftResult> {
  const t = authToken();
  try {
    const res = await fetch(DRAFT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(waitMs),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, slow: false, error: typeof out?.error === "string" && out.error.includes(" ") ? out.error : DRAFT_WORDS.unavailable };
    return { ok: true, reply: out as DraftReply };
  } catch (e) {
    return { ok: false, slow: (e as Error)?.name === "TimeoutError", error: (e as Error)?.name === "TimeoutError" ? DRAFT_WORDS.slow : DRAFT_WORDS.unavailable };
  }
}
