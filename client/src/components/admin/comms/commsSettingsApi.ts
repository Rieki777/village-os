/**
 * What Comms Settings and the Overview read from the server, and the one call
 * they make it through (server/routes/commsSettings.ts answers every shape
 * below).
 *
 * THE PATH COMES FIRST in `commsCall`, on purpose: scripts/check-admin-reach.mjs
 * reads the first argument of every client call to find which admin routes a
 * founder can reach, so a helper that took the password first would hide every
 * route behind it from the gate that proves they have a door.
 */
import type { CommsSettings, SetupItem } from "@shared/comms/settings";
import { API_BASE, authHeaders } from "@/components/admin/adminApi";

export interface DnsRecord {
  record: string;
  type: string;
  name: string;
  value: string;
  ttl: string;
  priority: number | null;
  status: string;
}

export interface DomainPanel {
  domain: string | null;
  status: string;
  records: DnsRecord[];
  /** The key in use cannot ask Resend, so the steps are done by hand. */
  byHand: boolean;
  steps: string[];
  error?: string;
}

export interface SettingsPayload {
  lifecycle: string;
  ready: boolean;
  checklist: SetupItem[];
  settings: CommsSettings;
  key: { configured: boolean; source: string; last4: string | null; setAt: string | null; setBy: string | null };
  webhook: {
    configured: boolean;
    source: string;
    url: string;
    events: string[];
    connectedAt: string | null;
    connectedBy: string | null;
    byHand: boolean;
    lastReportAt: number | null;
  };
  sender: { line: string; source: string; name: string; address: string };
  paths: Array<{ id: string; label: string; inbox: string | null }>;
  members: Array<{ id: string; name: string }>;
  holders: Array<{ id: string; name: string }>;
  admins: string[];
  testEmail: { status: string; toEmail: string; createdAt: number; delivered: boolean } | null;
  me: { email: string | null };
  secretsKeySet: boolean;
  /** Present on the answers to the domain routes. */
  domainPanel?: DomainPanel;
  /** Present when connecting delivery reports needs doing by hand. */
  byHand?: boolean;
  steps?: string[];
  /** Present on the answer to a test email. */
  result?: { status: string; messageId: string | null; reason?: string };
}

export interface OverviewPayload {
  lifecycle: string;
  paused: boolean;
  setup: { ready: boolean; done: number; total: number; open: Array<{ key: string; label: string; fix: string }> };
  numbers: { days: number; byStatus: Record<string, number>; byKind: Record<string, number> };
  upcoming: {
    days: number;
    total: number;
    next: Array<{ id: string; at: number | null; kind: string; origin: string; subject: string; journeyKey: string | null; stepKey: string | null }>;
    letters: Array<{ id: string; subject: string; scheduledFor: number; recipientCount: number }>;
  };
  journeys: Array<{ key: string; kind: string | null; steps: number | null; state: string; edited: boolean; active: number }>;
  failures: Array<{ id: string; toEmail: string; kind: string; origin: string; subject: string; status: string; lastError: string | null; at: number }>;
  jobs: string[];
}

export interface CallAnswer<T = any> {
  ok: boolean;
  status: number;
  data: T;
}

/** One admin call, answered with its status and its body, never a throw. */
export async function commsCall<T = any>(
  path: string,
  password: string,
  init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
): Promise<CallAnswer<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? "GET",
      headers: authHeaders(password, init.body === undefined ? {} : { "Content-Type": "application/json" }),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    // A refusal body, read by `refusal()` on the caller's side like any other.
    return { ok: false, status: 0, data: { error: "That did not reach the server, so nothing changed." } as unknown as T };
  }
}

/** An epoch-seconds instant as a short local date and time, or "" for none. */
export function whenOf(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null || !Number.isFinite(epochSeconds)) return "";
  return new Date(epochSeconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** An ISO instant the same way. */
export function whenOfIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? whenOf(t / 1000) : "";
}
