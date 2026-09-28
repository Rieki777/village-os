/**
 * The sentences the canvas view says, kept pure so they can be tested line by
 * line, and the shape of what GET /api/canvas sends.
 *
 * Every sentence here talks about ONE block or ONE reading. Nothing in this
 * file combines readings across blocks, because R55 forbids the scorecard and
 * the radar is the only exception Rye made (2026-09-24). The radar's text
 * alternative below walks the twelve blocks one by one for the same reason: a
 * screen reader hears what a sighted member sees, and neither hears a total.
 */
import {
  CANVAS_ORDER,
  type CanvasBlockId,
  type CanvasLevel,
  type CanvasMoment,
} from "@shared/governanceCanvas";

export interface CanvasReadingView {
  id: number;
  level: CanvasLevel;
  word: string;
  sentence: string;
  moment: CanvasMoment;
  momentLabel: string;
  recordedBy: { id: string; name: string };
  recordedAt: string;
}

export interface CanvasBlockView {
  id: CanvasBlockId;
  latest: CanvasReadingView | null;
  history: CanvasReadingView[];
}

export interface CanvasPayload {
  blocks: CanvasBlockView[];
  mayRecord: boolean;
}

/** A date the way a person writes it, in the reader's own locale. */
export function readingDate(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an unknown date";
  return d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Who wrote a reading, when, and on what occasion. The baseline is the
 * ordinary case and is not named; any other moment is.
 */
export function recordedLine(r: CanvasReadingView, locale?: string): string {
  const when = readingDate(r.recordedAt, locale);
  const who = r.recordedBy.name || "Someone";
  return r.moment === "baseline"
    ? `Recorded by ${who} on ${when}`
    : `Recorded by ${who} on ${when}, ${r.momentLabel.toLowerCase()}`;
}

/** Each block's newest level, or null where nobody has read it yet. Keyed by the union. */
export function newestLevels(blocks: readonly CanvasBlockView[]): Record<CanvasBlockId, CanvasLevel | null> {
  const byId = new Map(blocks.map((b) => [b.id, b.latest?.level ?? null]));
  return Object.fromEntries(CANVAS_ORDER.map((b) => [b.id, byId.get(b.id) ?? null])) as Record<
    CanvasBlockId,
    CanvasLevel | null
  >;
}

/**
 * The radar in words, block by block in canvas order. This is the chart's
 * accessible name, so it says exactly what the picture shows.
 */
export function radarDescription(levels: Record<CanvasBlockId, CanvasLevel | null>, words: Record<CanvasLevel, string>): string {
  return CANVAS_ORDER.map((b) => {
    const level = levels[b.id];
    return `${b.name}: ${level === null ? "no reading yet" : words[level]}.`;
  }).join(" ");
}

/** The Season Two weeks a block comes up in, as a phrase: "week 3", "weeks 3, 6 and 11". */
export function weeksPhrase(weeks: readonly number[]): string {
  if (weeks.length === 0) return "";
  const last = weeks[weeks.length - 1];
  if (weeks.length === 1) return `week ${last}`;
  return `weeks ${weeks.slice(0, -1).join(", ")} and ${last}`;
}
