/**
 * The Journal's HTTP surface, client side. Every route here is listed at the
 * foot of shared/journal.ts, which is the contract; this file only calls them.
 *
 * Every call goes through `gameFetch`, so every call carries the member's
 * token: no journal route answers a stranger, and an entry is its author's.
 *
 * TOLERANT READS, ON PURPOSE. The contract names the payload of most routes
 * and leaves a few envelopes open (a list may come back bare or as
 * `{ entries }`). Each reader accepts both, so the page does not render empty
 * over a wrapper it did not expect.
 */
import type {
  FeedbackDraft,
  FeedbackPerson,
  FeedbackPrefs,
  FeedbackReceived,
  FeedbackResponse,
  FeedbackSent,
  GuideReply,
  GuideRequest,
  JournalAnswer,
  JournalEntry,
  JournalPractice,
  JournalPrivacy,
  PulseAggregate,
  PulseScores,
} from "@shared/journal";
import { gameFetch } from "./gameApi";

/**
 * What a refusal body says. The journal routes answer `{ error: <a sentence> }`
 * for a refusal a member can act on, and `{ error: <a-code> }` for the two
 * machine answers (`auth_required`, `assistant-unavailable`). A string with a
 * space in it is a sentence; one without is a code.
 */
export function refusalOf(body: unknown): { code: string; sentence: string } {
  const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; message?: unknown };
  const error = typeof b.error === "string" ? b.error.trim() : "";
  const message = typeof b.message === "string" ? b.message.trim() : "";
  const errorIsSentence = /\s/.test(error);
  return {
    code: errorIsSentence ? "" : error,
    sentence: message || (errorIsSentence ? error : ""),
  };
}

/** A refusal, with the status and whatever the server said. */
export class JournalHttpError extends Error {
  readonly status: number;
  readonly code: string;
  /** True when `message` is the server's own sentence for a member. */
  readonly readable: boolean;
  constructor(status: number, body: unknown) {
    const { code, sentence } = refusalOf(body);
    super(sentence || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
    this.readable = !!sentence;
  }
}

/** True for the guide's "no model configured or reachable" answer. */
export function isAssistantUnavailable(err: unknown): boolean {
  return err instanceof JournalHttpError && (err.status === 503 || err.code === "assistant-unavailable");
}

/** A sentence a member can read for any failure. */
export function problemText(err: unknown, fallback: string): string {
  if (err instanceof JournalHttpError && err.readable) return err.message;
  if (err instanceof JournalHttpError && err.status === 401) return "Your session has ended. Sign in again to carry on.";
  return fallback;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await gameFetch(path, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new JournalHttpError(res.status, body);
  return body as T;
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** A list that may arrive bare or inside an envelope under `key`. */
function listOf<T>(raw: unknown, key: string): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const inner = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

// ── Entries ──────────────────────────────────────────────────────────────────

export async function listEntries(opts: { limit?: number; before?: string } = {}): Promise<JournalEntry[]> {
  const q = new URLSearchParams();
  if (opts.limit) q.set("limit", String(opts.limit));
  if (opts.before) q.set("before", opts.before);
  const qs = q.toString();
  return listOf<JournalEntry>(await call<unknown>(`/api/journal/entries${qs ? `?${qs}` : ""}`), "entries");
}

export interface EntryPatch {
  answers?: JournalAnswer[];
  reflection?: string | null;
  privacy?: JournalPrivacy;
}

export async function patchEntry(id: string, patch: EntryPatch): Promise<JournalEntry | null> {
  const raw = await call<unknown>(`/api/journal/entries/${encodeURIComponent(id)}`, send("PATCH", patch));
  if (raw && typeof raw === "object" && "entry" in raw) return (raw as { entry: JournalEntry }).entry;
  return raw && typeof raw === "object" && "id" in raw ? (raw as JournalEntry) : null;
}

export async function deleteEntry(id: string): Promise<void> {
  await call<unknown>(`/api/journal/entries/${encodeURIComponent(id)}`, send("DELETE"));
}

// ── The guide ────────────────────────────────────────────────────────────────

export async function askGuide(req: GuideRequest): Promise<GuideReply> {
  const raw = await call<Partial<GuideReply> | null>("/api/journal/guide", send("POST", req));
  return {
    reply: String(raw?.reply ?? ""),
    nextQuestion: String(raw?.nextQuestion ?? ""),
    reflection: String(raw?.reflection ?? ""),
  };
}

// ── The pulse ────────────────────────────────────────────────────────────────

/**
 * One week of this member's own numbers. The contract names the route
 * ("this member's own scores by week") without a type, so this is the
 * client's reading of it.
 */
export interface OwnPulseWeek {
  weekId: string;
  scores: PulseScores;
}

export async function myPulse(): Promise<OwnPulseWeek[]> {
  const weeks = listOf<Partial<OwnPulseWeek>>(await call<unknown>("/api/journal/pulse"), "weeks");
  return weeks
    .filter((w) => typeof w?.weekId === "string" && w.scores && typeof w.scores === "object")
    .map((w) => ({ weekId: String(w.weekId), scores: w.scores as PulseScores }));
}

export async function pulseAggregate(): Promise<PulseAggregate> {
  const raw = await call<Partial<PulseAggregate> | null>("/api/journal/pulse/aggregate");
  return {
    floor: typeof raw?.floor === "number" ? raw.floor : 0,
    weeks: Array.isArray(raw?.weeks) ? raw.weeks : [],
    signals: Array.isArray(raw?.signals) ? raw.signals : [],
  };
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export async function getPrefs(): Promise<FeedbackPrefs | null> {
  const raw = await call<unknown>("/api/journal/feedback/prefs");
  if (!raw || typeof raw !== "object") return null;
  const inner = "prefs" in raw ? (raw as { prefs: unknown }).prefs : raw;
  return inner && typeof inner === "object" && "open" in inner ? (inner as FeedbackPrefs) : null;
}

export async function putPrefs(prefs: FeedbackPrefs): Promise<void> {
  await call<unknown>("/api/journal/feedback/prefs", send("PUT", prefs));
}

export async function feedbackPeople(): Promise<FeedbackPerson[]> {
  return listOf<FeedbackPerson>(await call<unknown>("/api/journal/feedback/people"), "people");
}

export async function shapeFeedback(draft: FeedbackDraft): Promise<string> {
  const raw = await call<{ message?: unknown } | null>("/api/journal/feedback/shape", send("POST", draft));
  return String(raw?.message ?? "");
}

export async function sendFeedback(draft: FeedbackDraft & { message: string }): Promise<FeedbackSent | null> {
  const raw = await call<unknown>("/api/journal/feedback", send("POST", draft));
  return raw && typeof raw === "object" && "id" in raw ? (raw as FeedbackSent) : null;
}

export async function sentFeedback(): Promise<FeedbackSent[]> {
  return listOf<FeedbackSent>(await call<unknown>("/api/journal/feedback/sent"), "sent");
}

export async function withdrawFeedback(id: string): Promise<void> {
  await call<unknown>(`/api/journal/feedback/${encodeURIComponent(id)}/withdraw`, send("POST"));
}

export async function receivedFeedback(): Promise<FeedbackReceived[]> {
  return listOf<FeedbackReceived>(await call<unknown>("/api/journal/feedback/received"), "received");
}

export async function respondFeedback(id: string, response: FeedbackResponse): Promise<void> {
  await call<unknown>(`/api/journal/feedback/${encodeURIComponent(id)}/respond`, send("POST", { response }));
}

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * Download the member's journal as markdown. A plain link cannot carry the
 * Authorization header this deployment authenticates by, so the file is
 * fetched with the token and handed to the browser as a blob.
 */
export async function downloadExport(practice?: JournalPractice): Promise<void> {
  const path = practice ? `/api/journal/export.md?practice=${encodeURIComponent(practice)}` : "/api/journal/export.md";
  const res = await gameFetch(path, { headers: { Accept: "text/markdown" } });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw new JournalHttpError(res.status, body);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = practice ? `journal-${practice}.md` : "journal.md";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
