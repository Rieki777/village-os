/**
 * ONE LINE OF HEALTH, IN PLAIN WORDS, for a steward reading a module's page.
 *
 * The admin payload already carries every vendor call's reading (verdict and a
 * technical detail with a correlation id). A steward deciding whether to worry
 * needs one sentence: did the outside service answer, and when. This turns the
 * readings into that sentence; the detail stays one click away on the page for
 * whoever has to chase it.
 *
 * Pure, so the sentences are tested without a server or a clock.
 */

export interface HealthRow {
  operation: string;
  lastSuccessAt?: string | null;
  consecutiveFailures?: number;
  reading?: { verdict: string; detail: string } | null;
}

export type HealthTone = "good" | "watch" | "bad";

export interface HealthLine {
  tone: HealthTone;
  text: string;
}

/** "just now", "4 minutes ago", "3 hours ago", "2 days ago". */
export function ago(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

/**
 * The worst reading wins, because one failing call is the one a steward needs
 * to hear about. Null when the module talks to nobody outside.
 */
export function healthLine(input: {
  vendorName: string | null;
  /** Whether a key is set. Null when the listing needs none. */
  credentialPresent: boolean | null;
  health: readonly HealthRow[];
  now?: Date;
}): HealthLine | null {
  const { vendorName, credentialPresent, health } = input;
  if (!vendorName) return null;
  const now = input.now ?? new Date();
  if (credentialPresent === false) {
    return { tone: "bad", text: `No key for ${vendorName} yet, so this module cannot reach it.` };
  }
  const failing = health.find((h) => h.reading?.verdict === "failing");
  if (failing) {
    const n = failing.consecutiveFailures ?? 1;
    return {
      tone: "bad",
      text: `${vendorName} did not answer the last time it was called${n > 1 ? `, ${n} times in a row` : ""}.`,
    };
  }
  const stale = health.find((h) => h.reading?.verdict === "stale");
  if (stale?.lastSuccessAt) {
    return { tone: "watch", text: `${vendorName} last answered ${ago(stale.lastSuccessAt, now)}, longer than expected.` };
  }
  const latest = health
    .map((h) => h.lastSuccessAt)
    .filter((v): v is string => !!v)
    .sort()
    .pop();
  if (latest) return { tone: "good", text: `${vendorName} answered ${ago(latest, now)}.` };
  return { tone: "watch", text: `${vendorName} has not answered yet. A key being set does not prove it works.` };
}
