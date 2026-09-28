/**
 * THE SENTENCES OF A BLOCK'S LEARN FRAME: the Governance Canvas Database's
 * resources under one block (Wave 4, 2026-09-28).
 *
 * client/src/components/canvas/CanvasLearnResources.tsx renders what
 * GET /api/canvas/resources sends; every sentence it shows, and the one list
 * edit its placing form needs, lives here, so the component sifts and counts
 * nothing (client/src/lib/canvasCopy.test.ts holds the canvas components to
 * that, and holds this file to its own sweep).
 *
 * Written from the member's side of the screen: where a resource came from,
 * why it is under this block, whether its link is known to work, and how old
 * the copy is. Nothing here counts resources or ranks them.
 */
import { CANVAS_BLOCK_IDS, type CanvasBlockId } from "@shared/governanceCanvas";
import type { CanvasResourcesPayload, CanvasResourceView } from "@shared/canvasResources";
import { readingDate } from "./canvasCopy";

export type { CanvasResourcesPayload, CanvasResourceView };

/** The kind of resource, and who wrote it: "Article, by Sociocracy For All". */
export function byLine(r: Pick<CanvasResourceView, "type" | "authors">): string {
  const type = r.type.trim() || "Resource";
  return r.authors.trim() ? `${type}, by ${r.authors.trim()}` : type;
}

/**
 * Why a resource is under this block, when a member should be told. The
 * platform's own map says nothing: it is the ordinary case. A suggestion
 * names the keyword that made it, so a member can judge it.
 */
export function placingLine(r: Pick<CanvasResourceView, "placing">, blockName: string): string | null {
  if (r.placing.by === "village") return `This village chose to show it under ${blockName}.`;
  if (r.placing.by === "suggested") {
    return r.placing.keyword
      ? `Suggested for ${blockName} because its keywords include "${r.placing.keyword}".`
      : `Suggested for ${blockName} by its keywords.`;
  }
  return null;
}

/** Said of a row whose address upstream is a filename or nothing. No call to action: the file is the authors'. */
export const LINK_PENDING_LINE = "The database lists this one without a link yet.";

/** Said of an address that failed the village's last check, and only then. */
export function brokenLinkLine(r: Pick<CanvasResourceView, "link" | "linkCheckedAt">, locale?: string): string | null {
  if (r.link !== "broken") return null;
  const when = r.linkCheckedAt ? ` on ${readingDate(r.linkCheckedAt, locale)}` : "";
  return `This address failed the village's last check${when}. It may still open for you.`;
}

/** How old the shelf is, and whether it is kept fresh. The answer to "is this up to date?" (plan 5.8). */
export function sourceLine(source: CanvasResourcesPayload["source"], locale?: string): string {
  const when = source.asOf ? readingDate(source.asOf, locale) : "an unknown date";
  const nightly = source.syncOn
    ? " The village reads it again every night."
    : " Reading it every night is switched off in this village.";
  return source.kind === "database"
    ? `Read from the database on ${when}.${nightly}`
    : `A copy of the database taken on ${when} and shipped with this platform. This village has not read the database itself yet.${source.syncOn ? "" : nightly}`;
}

/** What an empty block says. */
export function emptyLine(blockName: string): string {
  return `The Governance Canvas Database lists nothing under ${blockName} yet.`;
}

/** The pen's placing form: `blocks` with `id` switched on or off, in canvas order, once each. */
export function withBlock(blocks: readonly CanvasBlockId[], id: CanvasBlockId, on: boolean): CanvasBlockId[] {
  return CANVAS_BLOCK_IDS.filter((b) => (b === id ? on : blocks.includes(b)));
}
