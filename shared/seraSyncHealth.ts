/**
 * Sync health for the Sera bridge board: the 6-hourly read of linked members'
 * changes is flagged when it is older than 8 hours or its last run failed.
 */
export const SYNC_STALE_HOURS = 8;

export interface SyncLast {
  at: string;
  ok: boolean;
  /** Our own short status word, never the service's text. */
  status: string;
  members: number;
  errors: number;
  /** Tasks Sera held back for carrying an email address, added up over every page of the run. */
  dropped?: number;
}

export type SyncHealth =
  | { state: "never" }
  | { state: "ok"; hours: number }
  | { state: "stale"; hours: number }
  | { state: "failed"; hours: number; errors: number; status: string };

export function parseSyncLast(raw: string | null): SyncLast | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (typeof j.at !== "string") return null;
    return { at: j.at, ok: j.ok === true, status: String(j.s ?? ""), members: Number(j.m ?? 0) || 0, errors: Number(j.e ?? 0) || 0, dropped: Math.max(0, Number(j.d ?? 0) || 0) };
  } catch {
    return null;
  }
}

export function syncHealth(last: SyncLast | null, now: number): SyncHealth {
  if (!last) return { state: "never" };
  const t = Date.parse(last.at);
  if (!Number.isFinite(t)) return { state: "never" };
  const hours = Math.max(0, Math.floor((now - t) / 3_600_000));
  if (!last.ok) return { state: "failed", hours, errors: last.errors, status: last.status };
  return hours >= SYNC_STALE_HOURS ? { state: "stale", hours } : { state: "ok", hours };
}

/** Plain words for the board. */
export function syncHealthWords(h: SyncHealth): string {
  const ago = (n: number) => (n < 1 ? "less than an hour ago" : n === 1 ? "1 hour ago" : `${n} hours ago`);
  switch (h.state) {
    case "never": return "The members' sync has not run yet. It runs every 6 hours; a steward can also press Read changes now.";
    case "ok": return `Healthy. Last read ${ago(h.hours)}.`;
    case "stale": return `Behind. The last read was ${ago(h.hours)}, and it should run every 6 hours. Check the connection.`;
    case "failed": return `The last read, ${ago(h.hours)}, did not work${h.errors ? ` for ${h.errors} member${h.errors === 1 ? "" : "s"}` : ""}${h.status && h.status !== "ok" ? ` (${h.status})` : ""}. It tries again in 6 hours.`;
  }
}

/** The held-back count for one run, in plain words; null when there is nothing to say. */
export function droppedWords(last: SyncLast | null): string | null {
  if (!last || !last.dropped) return null;
  const n = last.dropped;
  return `Sera held back ${n} task${n === 1 ? "" : "s"} in the last read because ${n === 1 ? "it" : "they"} carried an email address.`;
}
