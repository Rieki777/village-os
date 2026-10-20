// One submission path for every kind of proposal, so the Work With Us offer and
// a self-proposed quest can never drift apart in how they reach the admin inbox.
import { authToken } from "./gameApi";
import type { IdeaReceipt } from "@shared/questIdeas";

export type ProposalKind = "work-with-us" | "quest-proposal";

/**
 * What the server said. `idea` is where a quest idea went: the review queue,
 * or held in the inbox and why (shared/questIdeas.ts). Null for every other
 * kind, and for a server too old to say, which the page reads as queued.
 */
export type ProposalAnswer = { ok: false } | { ok: true; idea: IdeaReceipt | null };

/** The receipt a quest idea's answer carries, or null when it carries none. A body that will not parse is none. */
async function ideaOf(res: Response): Promise<IdeaReceipt | null> {
  try {
    const body = await res.json();
    return body && typeof body.idea === "object" && body.idea !== null ? (body.idea as IdeaReceipt) : null;
  } catch {
    return null;
  }
}

/** Posts to the shared submissions pipeline. `type` is what the admin filters on. */
export async function sendProposal(
  type: ProposalKind,
  data: object,
  hp = ""
): Promise<ProposalAnswer> {
  try {
    const token = authToken();
    const res = await fetch("/api/forms/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ type, data, hp }),
    });
    return res.ok ? { ok: true, idea: await ideaOf(res) } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** `sendProposal` for a caller that needs only whether it was taken. */
export async function submitProposal(type: ProposalKind, data: object, hp = ""): Promise<boolean> {
  return (await sendProposal(type, data, hp)).ok;
}

/** Whether the guided assistant is switched on for this deployment. */
export async function assistantAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/assistant/status");
    const data = await res.json();
    return !!data.available;
  } catch {
    return false;
  }
}
