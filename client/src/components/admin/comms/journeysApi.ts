/**
 * The Journeys screen's calls to `/api/admin/comms/journeys/*`
 * (server/routes/commsJourneys.ts), and the shapes they answer.
 *
 * Every call reads the status before it reads the body, and a refusal comes
 * back as a sentence (`refusal` in ../adminApi), never as a body that looks
 * like a success.
 */
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import type { ConditionKey, JourneyAnchor, JourneyKind, StopKey } from "@shared/comms/contracts";
import type { EmailKind } from "@shared/comms/kinds";

export interface JourneySummary {
  key: string;
  title: string;
  kind: JourneyKind;
  emailKind: EmailKind;
  state: "on" | "off";
  version: number;
  own: boolean;
  active: number;
  steps: Array<{ key: string; label: string; timing: string }>;
}

export interface JourneyStepView {
  key: string;
  label: string;
  templateKey: string;
  timing: string;
  anchor: JourneyAnchor;
  offsetMinutes: number;
  window: "any" | "daytime";
  audience: "all" | "came" | "missed";
  skipIf: ConditionKey[];
  catchUp: "skip" | "latest";
  maxLateMinutes: number;
  urgent: boolean;
  subject: string | null;
  words: "village" | "platform" | "missing";
}

export interface JourneyEnrollment {
  id: string;
  name: string | null;
  email: string | null;
  subjectRef: string;
  version: number;
  /** Epoch seconds. */
  enrolledAt: number;
  /** Epoch seconds, or null. */
  nextCheckAt: number | null;
}

export interface JourneyDetail {
  key: string;
  title: string;
  kind: JourneyKind;
  emailKind: EmailKind;
  trigger: string;
  state: "on" | "off";
  version: number;
  own: boolean;
  followsDials: boolean;
  active: number;
  steps: JourneyStepView[];
  stops: Array<{ key: StopKey; label: string }>;
  conditions: Array<{ key: ConditionKey; label: string }>;
  templates: Array<{ key: string; label: string }>;
  versions: Array<{ version: number; createdBy: string | null; createdAt: number; active: number }>;
  enrollments: JourneyEnrollment[];
}

export interface StepEdit {
  offsetMinutes?: number;
  window?: "any" | "daytime";
  audience?: "all" | "came" | "missed";
  templateKey?: string;
  skipIf?: ConditionKey[];
}

export interface WalkStepView {
  key: string;
  label: string;
  templateKey: string;
  timing: string;
  at: string | null;
  sendsAt: string | null;
  outcome: "sent" | "skipped" | "pending";
  alreadySent: boolean;
  reason: string | null;
  why: string;
  subject: string | null;
}

export interface WalkView {
  journeyKey: string;
  version: number;
  state: "on" | "off";
  person: { name: string | null; email: string | null; timezone: string | null; madeUp: boolean };
  subjectRef: string | null;
  enrolledAt: string;
  zone: string;
  stoppedBy: StopKey | null;
  steps: WalkStepView[];
}

export type WalkRequest =
  | { enrollmentId: string }
  | { email: string; subjectRef: string }
  | { madeUp: { name?: string; timezone?: string; startsAt?: string; endsAt?: string; enrolledAt?: string } };

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
const keyPath = (key: string) => encodeURIComponent(key);

export async function fetchJourneys(password: string): Promise<Answer<{ journeys: JourneySummary[] }>> {
  return read(await fetch(`${API_BASE}/admin/comms/journeys`, { headers: authHeaders(password) }), "The journeys could not be read");
}

export async function fetchJourney(password: string, key: string): Promise<Answer<JourneyDetail>> {
  return read(await fetch(`${API_BASE}/admin/comms/journeys/${keyPath(key)}`, { headers: authHeaders(password) }), "This journey could not be read");
}

export async function setJourneyOn(password: string, key: string, on: boolean): Promise<Answer<{ state: "on" | "off"; adopted: string[] }>> {
  const res = await fetch(`${API_BASE}/admin/comms/journeys/${keyPath(key)}/state`, { method: "POST", headers: json(password), body: JSON.stringify({ state: on ? "on" : "off" }) });
  return read(res, on ? "The journey could not be turned on" : "The journey could not be turned off");
}

export async function saveStep(password: string, key: string, step: string, edit: StepEdit): Promise<Answer<{ version: number }>> {
  const res = await fetch(`${API_BASE}/admin/comms/journeys/${keyPath(key)}/steps/${encodeURIComponent(step)}`, { method: "PUT", headers: json(password), body: JSON.stringify(edit) });
  return read(res, "The step could not be saved");
}

export async function testStep(password: string, key: string, step: string): Promise<Answer<{ status: string; reason: string | null; sentTo: string }>> {
  const res = await fetch(`${API_BASE}/admin/comms/journeys/${keyPath(key)}/steps/${encodeURIComponent(step)}/test`, { method: "POST", headers: json(password), body: "{}" });
  return read(res, "The test email could not be sent");
}

export async function walk(password: string, key: string, request: WalkRequest): Promise<Answer<WalkView>> {
  const res = await fetch(`${API_BASE}/admin/comms/journeys/${keyPath(key)}/walk`, { method: "POST", headers: json(password), body: JSON.stringify(request) });
  return read(res, "The walk-through could not be made");
}

export async function fetchSubjects(password: string, key: string): Promise<Answer<{ subjects: Array<{ subjectRef: string; label: string; startsAt: string | null }> }>> {
  return read(await fetch(`${API_BASE}/admin/comms/journeys/${keyPath(key)}/subjects`, { headers: authHeaders(password) }), "The list could not be read");
}

export async function stopEnrollment(password: string, id: string): Promise<Answer<{ stopped: string }>> {
  const res = await fetch(`${API_BASE}/admin/comms/journeys/enrollments/${encodeURIComponent(id)}/stop`, { method: "POST", headers: json(password), body: "{}" });
  return read(res, "The journey could not be stopped");
}

/** A moment, in the reader's own clock: "Sat, Oct 17, 6:00 PM". */
export function whenLabel(iso: string | number | null): string {
  if (iso === null) return "";
  const d = typeof iso === "number" ? new Date(iso * 1000) : new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
