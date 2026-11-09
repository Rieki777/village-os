/**
 * The calls /review makes to answer the outside service's differences (spec
 * R12 to R16, R30, R38), and the doors of the draft the answers collect in.
 *
 * Each call names its path and carries the token itself, so
 * scripts/check-auth-fetch.mjs reads every one. The draft's own doors are the
 * ones every org draft uses (server/routes/orgDraftDecide.ts and the review
 * queue's withdraw): nothing here is a second way to publish.
 *
 * WHITE LABEL (R34). The words a refusal carries come from the server, built
 * with the agent's name from config.
 */
import { authToken } from "@/lib/gameApi";
import type { Difference } from "@shared/seraDifferences";

export type AnswerAct = "take" | "keep" | "edit";

/** What one call answered: the body as sent, and whether it went. */
export interface Called {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
}

const headers = (): Record<string, string> => ({ Authorization: `Bearer ${authToken() ?? ""}`, "Content-Type": "application/json" });

async function called(r: Response | null): Promise<Called> {
  if (!r) return { ok: false, status: 0, body: null };
  const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: r.ok, status: r.status, body: body && typeof body === "object" ? body : null };
}

/** The key and both hashes as the person saw them: what the server checks again under its locks (R14). */
export const itemOf = (d: Pick<Difference, "key" | "seraHash" | "oursHash">, value?: string) => ({
  key: d.key,
  seraHash: d.seraHash,
  oursHash: d.oursHash,
  ...(value !== undefined ? { value } : {}),
});

/** Take, keep or edit one difference or many. */
export async function answerDifferences(act: AnswerAct, items: ReturnType<typeof itemOf>[]): Promise<Called> {
  const r = await fetch("/api/saberra/differences/answer", { method: "POST", headers: headers(), body: JSON.stringify({ act, items }) }).catch(() => null);
  return called(r);
}

/** Take answers back. */
export async function undoAnswers(keys: string[]): Promise<Called> {
  const r = await fetch("/api/saberra/differences/undo", { method: "POST", headers: headers(), body: JSON.stringify({ keys }) }).catch(() => null);
  return called(r);
}

/** Who may publish a draft now, whether a vote is needed, and whether one is running. */
export interface DraftDoors {
  youMayPublish: boolean;
  adminMayPublish: boolean;
  youMayPutToVillage: boolean;
  ballotNeeded: boolean;
  ballot: { id: string; closesAt: string | null } | null;
  blocked: number;
  firstBlocked: string | null;
}

export async function draftDoors(draftId: string): Promise<DraftDoors | null> {
  const r = await fetch(`/api/org/drafts/${encodeURIComponent(draftId)}/decide`, { headers: { Authorization: `Bearer ${authToken() ?? ""}` } }).catch(() => null);
  const c = await called(r);
  if (!c.ok || !c.body) return null;
  const b = c.body;
  const ballot = b.ballot && typeof b.ballot === "object" ? (b.ballot as Record<string, unknown>) : null;
  const lines = Array.isArray(b.blockedLines) ? (b.blockedLines as Array<{ blocked?: unknown }>) : [];
  return {
    youMayPublish: b.youMayPublish === true,
    adminMayPublish: b.adminMayPublish === true,
    youMayPutToVillage: b.youMayPutToVillage === true,
    ballotNeeded: b.ballotNeeded === true,
    ballot: ballot && typeof ballot.id === "string" ? { id: ballot.id, closesAt: typeof ballot.closesAt === "string" ? ballot.closesAt : null } : null,
    blocked: typeof b.blocked === "number" ? b.blocked : 0,
    firstBlocked: typeof lines[0]?.blocked === "string" ? (lines[0].blocked as string) : null,
  };
}

/** Publish through the holder's door, or the admin panel's before launch: whichever the decide read offered. */
export async function publishDraftThrough(draftId: string, door: "power" | "admin"): Promise<Called> {
  const id = encodeURIComponent(draftId);
  const r =
    door === "power"
      ? await fetch(`/api/org/drafts/${id}/publish-by-power`, { method: "POST", headers: headers() }).catch(() => null)
      : await fetch(`/api/admin/org/drafts/${id}/publish`, { method: "POST", headers: headers() }).catch(() => null);
  return called(r);
}

/** Withdraw through the review queue's own withdraw: the answers in it wait again. */
export async function withdrawDraftThere(draftId: string): Promise<Called> {
  const r = await fetch(`/api/review/drafts/${encodeURIComponent(draftId)}/withdraw`, { method: "POST", headers: headers() }).catch(() => null);
  return called(r);
}

/** Open the village's vote on the draft, through the door every org draft has (R38, constitution 0.3). */
export async function putDraftToVillage(draftId: string): Promise<Called> {
  const r = await fetch(`/api/org/drafts/${encodeURIComponent(draftId)}/put-to-village`, { method: "POST", headers: headers() }).catch(() => null);
  return called(r);
}

/** The error a call carried, or null. */
export const errorWords = (c: Called): string | null => (typeof c.body?.error === "string" ? c.body.error : typeof c.body?.message === "string" ? c.body.message : null);
