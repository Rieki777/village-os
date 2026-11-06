/**
 * What waits for a person among the differences between the outside service
 * and the chart here (spec R29), as ONE rule for the count every member reads
 * and the list a moderator reads, so the two never say different numbers.
 *
 *   - toDecide: every decision, and every conflict whatever its lane, because
 *     a person settles each one;
 *   - small: a low-risk change, which waits only while automatic apply is off;
 *   - facts: the service's facts, which wait for nobody;
 *   - oursAhead: changed here and still the old way there, never acted on.
 *
 * Small and free of anything heavier than a type, so the page can import it.
 */
import type { Difference, DifferenceCount, DifferenceFlag } from "./seraDifferences";

export type WaitingKind = "toDecide" | "small" | "facts" | "oursAhead";

export function waitingKind(d: Pick<Difference, "state" | "lane">): WaitingKind {
  if (d.state === "oursAhead") return "oursAhead";
  if (d.state === "conflict" || d.lane === "decision") return "toDecide";
  return d.lane === "lowRisk" ? "small" : "facts";
}

/**
 * The headline's number: what is to decide, or the small changes when nothing
 * is. With nothing to decide there is no conflict either, so every low-risk
 * difference is a small change.
 */
export function headlineCount(c: Pick<DifferenceCount, "toDecide" | "small">): number {
  return c.toDecide > 0 ? c.toDecide : c.small;
}

/** A page id as one key: lower case, dashes gone. The engine and the page group by it alike (review C4). */
export const pageKey = (id: string): string => id.trim().toLowerCase().replace(/-/g, "");

/**
 * The flags a person is shown. The unknown base says nothing beside a first
 * sight, which implies it, or on pay, whose base is never known and which is
 * always a person's act, so it is left off the screen there. DISPLAY ONLY: the
 * difference keeps every flag, because an unknown base is never bulk-taken or
 * applied by itself (R2). Check first is counted from these (review C8).
 */
export function shownFlags(d: Pick<Difference, "kind" | "flags">): DifferenceFlag[] {
  const firstSight = d.flags.some((f) => f.key === "firstSight");
  return d.flags.filter((f) => f.key !== "baseUnknown" || (!firstSight && d.kind !== "pay"));
}
