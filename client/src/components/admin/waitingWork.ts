/**
 * Which form submissions still need a steward.
 *
 * Accepted and declined are finished. A missing status is the same as new:
 * nobody has moved it yet. Home counts only these. The inbox still lists the
 * finished ones, and says so on the row.
 */
const SETTLED = new Set(["accepted", "declined"]);

export function needsAction(status: string | null | undefined): boolean {
  return !SETTLED.has(String(status || "new").toLowerCase());
}

export function waitingRequests<T extends { status?: string | null }>(rows: readonly T[]): number {
  return rows.filter((row) => needsAction(row.status)).length;
}

export function prettyLabel(value: string | null | undefined): string {
  const raw = String(value || "new").replace(/-/g, " ");
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function submittedLabel(iso: string | null | undefined): string {
  const when = new Date(iso ?? "");
  if (Number.isNaN(when.getTime())) return "Date not recorded";
  return when.toLocaleString([], { month: "short", day: "numeric", year: "numeric" });
}

export interface RequestRow {
  id: string;
  title: string;
  detail: string;
  next: string;
}

export function requestRow(input: {
  id?: string;
  name?: string | null;
  type?: string | null;
  status?: string | null;
  submittedAt?: string | null;
}): RequestRow {
  const status = input.status || "new";
  const open = needsAction(status);
  return {
    id: String(input.id ?? ""),
    title: String(input.name || "").trim() || "Untitled",
    detail: `${prettyLabel(input.type || "request")} · ${submittedLabel(input.submittedAt)} · ${prettyLabel(status)}`,
    next: open ? "Open it and answer." : "Already answered. Open the form to read it.",
  };
}
