/**
 * One sentence for today, and what changed since this device last looked.
 *
 * The last visit stays in the browser. Nothing here is sent to the server.
 */
import { storedText, writeStored } from "@/lib/safeStorage";

export const LAST_GLANCE_KEY = "admin.lastGlance";

export interface GlanceSnap {
  at: string;
  requests: number;
  needs: number;
}

export interface ConnCard {
  module?: string | null;
  key?: string | null;
  title?: string;
  health?: { verdict?: string }[];
}

export interface ConnInput {
  emailConfigured?: boolean;
  stripeConfigured?: boolean;
  cards?: ConnCard[];
  secrets?: { key?: string; configured?: boolean; present?: boolean }[];
}

export type ConnState = "working" | "needs" | "broken";

export interface ConnectionRow {
  id: string;
  name: string;
  state: ConnState;
  word: string;
  detail: string;
}

const WORD: Record<ConnState, string> = {
  working: "Working",
  needs: "Needs you",
  broken: "Broken right now",
};

function secretOn(input: ConnInput, key: string): boolean {
  const row = (input.secrets ?? []).find((s) => s.key === key);
  if (!row) return false;
  return row.configured === true || row.present === true;
}

function cardFor(input: ConnInput, moduleId: string): ConnCard | undefined {
  return (input.cards ?? []).find((c) => c.module === moduleId);
}

function stateFrom(on: boolean, card: ConnCard | undefined): ConnState {
  const verdict = card?.health?.find((h) => h.verdict)?.verdict;
  if (verdict === "failing") return "broken";
  if (!on && verdict !== "quiet") return "needs";
  if (verdict === "quiet" || verdict === "ok") return "working";
  return on ? "working" : "needs";
}

export function connectionRows(input: ConnInput): ConnectionRow[] {
  const emailOn = input.emailConfigured === true || secretOn(input, "resend_api_key");
  const payOn = input.stripeConfigured === true || secretOn(input, "stripe_secret_key");
  const calendar = cardFor(input, "events");
  const sera = cardFor(input, "saberra");
  const seraOn = secretOn(input, "sera_api_secret") || !!sera;
  const rows: { id: string; name: string; state: ConnState }[] = [
    { id: "email", name: "Email", state: stateFrom(emailOn, undefined) },
    { id: "payments", name: "Payments", state: stateFrom(payOn, undefined) },
    { id: "calendar", name: "Calendar", state: stateFrom(!!calendar, calendar) },
    { id: "sera", name: "Sera", state: stateFrom(seraOn, sera) },
  ];
  return rows.map((row) => ({
    ...row,
    word: WORD[row.state],
    detail: row.state === "broken"
      ? "The last call failed."
      : row.state === "needs"
        ? "It is not connected yet."
        : "A key is saved.",
  }));
}

export function glanceSentence(requests: number, rows: ConnectionRow[]): string {
  const req = requests === 1 ? "1 request" : `${requests} requests`;
  const broken = rows.filter((r) => r.state === "broken").length;
  const needs = rows.filter((r) => r.state === "needs").length;
  if (broken > 0) {
    const c = broken === 1 ? "1 connection is broken right now" : `${broken} connections are broken right now`;
    return `${req}, ${c}.`;
  }
  if (needs > 0) {
    const c = needs === 1 ? "1 connection needs you" : `${needs} connections need you`;
    return requests === 0 ? `${c}. Everything else is fine.` : `${req}, ${c}, everything else is fine.`;
  }
  if (requests === 0) return "Nothing is waiting, and every connection is fine.";
  return `${req}, everything else is fine.`;
}

export function readLastGlance(): GlanceSnap | null {
  const raw = storedText("local", LAST_GLANCE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GlanceSnap;
    if (!parsed || typeof parsed.at !== "string" || typeof parsed.requests !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sinceLastVisit(prev: GlanceSnap | null, requests: number): string {
  if (!prev) return "First look on this device.";
  const when = new Date(prev.at);
  const label = Number.isNaN(when.getTime()) ? "your last look" : when.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const more = requests - prev.requests;
  if (more > 0) return `${more} more ${more === 1 ? "request" : "requests"} since ${label}.`;
  if (more < 0) {
    const n = -more;
    return `${n} fewer ${n === 1 ? "request" : "requests"} since ${label}.`;
  }
  return `Nothing new since ${label}.`;
}

export function rememberGlance(requests: number, needs: number, now = new Date()): void {
  const snap: GlanceSnap = { at: now.toISOString(), requests, needs };
  writeStored("local", LAST_GLANCE_KEY, JSON.stringify(snap));
}
