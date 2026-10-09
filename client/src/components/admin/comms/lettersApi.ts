/**
 * The Letters screen's calls to `/api/admin/comms/letters*`, and the Journeys
 * screen's call to `/api/admin/comms/outcomes/:journeyKey`
 * (server/routes/commsLetters.ts), with the shapes they answer.
 *
 * Every call reads the status before the body, and a refusal comes back as a
 * sentence (`refusal` in ../adminApi), never as a body that looks like a
 * success.
 */
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import type { ConditionKey, StopKey } from "@shared/comms/contracts";
import type { LetterAudience, LetterLayout, LetterState } from "@shared/comms/letters";
import type { VoiceFinding } from "@shared/comms/voiceLint";

export interface LetterNumbers {
  posted: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  skipped: number;
  waiting: number;
  failed: number;
  rehearsed: number;
}

export interface LetterView {
  id: string;
  subject: string;
  preheader: string | null;
  bodyMd: string;
  layout: LetterLayout;
  audience: LetterAudience | null;
  audienceLabel: string;
  state: LetterState;
  createdAt: string;
  scheduledFor: string | null;
  sentAt: string | null;
  recipientCount: number;
  numbers: LetterNumbers;
}

export interface LettersAnswer {
  letters: LetterView[];
  choices: { paths: Array<{ id: string; label: string }>; gatherings: Array<{ id: string; title: string; startsAt: string }> };
  limit: { perDay: number; today: number; minutesSinceLast: number | null };
  ready: boolean;
}

export interface LetterInput {
  subject: string;
  preheader: string;
  bodyMd: string;
  layout: LetterLayout;
  audience: LetterAudience;
}

export interface PreviewAnswer {
  count: number;
  names: string[];
  inGroup: number;
  leftOut: number;
  note: string | null;
  sampleFor: string;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  voice: VoiceFinding[];
  confirmToken: string | null;
  expiresAt: number | null;
}

export interface SendAnswer {
  state: LetterState;
  duplicate: boolean;
  counts: { posted: number; skipped: number; pending: number } | null;
  scheduledFor: string | null;
}

export interface StepOutcome {
  stepKey: string;
  sent: number;
  delivered: number;
  bounced: number;
  unsubscribed: number;
  rsvpd: number;
  came: number;
  reachedGoal: number;
  tookNextStep: number | null;
  askedNextStep: number;
}

export interface OutcomesAnswer {
  journeyKey: string;
  windowDays: number;
  goals: StopKey[];
  nextStepRule: ConditionKey | null;
  steps: StepOutcome[];
}

export type Answer<T> = { ok: true; body: T } | { ok: false; error: string; problems?: string[] };

async function read<T>(res: Response, fallback: string): Promise<Answer<T>> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const problems = Array.isArray(body?.problems) ? (body.problems as string[]) : undefined;
    return { ok: false, error: refusal(body, `${fallback} (${res.status}).`), problems };
  }
  return { ok: true, body: body as T };
}

const json = (password: string) => authHeaders(password, { "Content-Type": "application/json" });
const L = `${API_BASE}/admin/comms/letters`;
const one = (id: string) => `${L}/${encodeURIComponent(id)}`;

export async function fetchLetters(password: string): Promise<Answer<LettersAnswer>> {
  return read(await fetch(L, { headers: authHeaders(password) }), "The letters could not be read");
}

export async function createLetter(password: string, input: LetterInput): Promise<Answer<{ letter: { id: string; state: LetterState } }>> {
  return read(await fetch(L, { method: "POST", headers: json(password), body: JSON.stringify(input) }), "The letter could not be saved");
}

export async function saveLetter(password: string, id: string, input: LetterInput): Promise<Answer<{ letter: { id: string; state: LetterState } }>> {
  return read(await fetch(one(id), { method: "PUT", headers: json(password), body: JSON.stringify(input) }), "The letter could not be saved");
}

export async function previewLetter(password: string, id: string): Promise<Answer<PreviewAnswer>> {
  return read(await fetch(`${one(id)}/preview`, { method: "POST", headers: json(password), body: "{}" }), "The preview could not be made");
}

export async function testLetter(password: string, id: string): Promise<Answer<{ status: string; reason: string | null; sentTo: string }>> {
  return read(await fetch(`${one(id)}/test`, { method: "POST", headers: json(password), body: "{}" }), "The test could not be sent");
}

export async function sendLetter(
  password: string,
  id: string,
  input: { confirmToken: string; idempotencyKey: string; scheduledFor?: string | null },
): Promise<Answer<SendAnswer>> {
  return read(await fetch(`${one(id)}/send`, { method: "POST", headers: json(password), body: JSON.stringify(input) }), "The letter could not be sent");
}

export async function cancelLetter(password: string, id: string): Promise<Answer<{ state: "cancelled" }>> {
  return read(await fetch(`${one(id)}/cancel`, { method: "POST", headers: json(password), body: "{}" }), "The letter could not be cancelled");
}

export async function rescheduleLetter(password: string, id: string, scheduledFor: string): Promise<Answer<{ state: "scheduled"; scheduledFor: string }>> {
  return read(
    await fetch(`${one(id)}/reschedule`, { method: "POST", headers: json(password), body: JSON.stringify({ scheduledFor }) }),
    "The letter could not be moved",
  );
}

export async function fetchOutcomes(password: string, journeyKey: string): Promise<Answer<OutcomesAnswer>> {
  return read(
    await fetch(`${API_BASE}/admin/comms/outcomes/${encodeURIComponent(journeyKey)}`, { headers: authHeaders(password) }),
    "The numbers could not be read",
  );
}

/** A `datetime-local` value in this browser's clock, as the ISO instant the server reads. */
export function localToIso(local: string): string | null {
  const d = new Date(local);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** A moment in the reader's own clock: "Sat, Oct 17, 6:00 PM". */
export function momentLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
