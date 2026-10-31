/**
 * One turn of the role guide (server/routes/roleGuide.ts).
 *
 *   askGuide   POST /api/governance/role-proposals/:id/guide
 *
 * The document travels in the body for the turn it is brought in, and the
 * server never stores it. A failure answers the server's own sentence.
 */
import { authToken } from "@/lib/gameApi";
import type { GuideAnswer, GuideAsk } from "@shared/roleGuide";
import { FAILED, PROPOSALS_URL } from "./proposalApi";

export type GuideReply = { ok: true; answer: GuideAnswer } | { ok: false; status: number; error: string };

export async function askGuide(proposalId: string, ask: GuideAsk): Promise<GuideReply> {
  const t = authToken();
  try {
    const res = await fetch(`${PROPOSALS_URL}/${encodeURIComponent(proposalId)}/guide`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify(ask),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: typeof out?.error === "string" && out.error.includes(" ") ? out.error : FAILED };
    return { ok: true, answer: out as GuideAnswer };
  } catch {
    return { ok: false, status: 0, error: FAILED };
  }
}
