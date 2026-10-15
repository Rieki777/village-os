/**
 * ONE PUBLIC LINE PER CANVAS BLOCK, and what members read beside it
 * (plan 2.3 "Content section canvas" and 4.6 "Visibility"; 2026-09-28).
 *
 * A village says, in one line per block, how it works, and anybody can read
 * the line, signed in or not, on "How we work together" (/governance). The
 * lines name roles and never people, so the one door that writes them
 * (`PUT /api/canvas/public/:block`, server/routes/canvasPublic.ts) refuses a
 * line holding the name of anybody the village has admitted, and the read
 * checks again, because a member can join, or change their name, after the
 * line was written.
 *
 * ── WHERE THE LINES LIVE ───────────────────────────────────────────────────
 *
 * In the village's `content` document, under the key `canvas`, as one string
 * per block id. That document has a generic door of its own
 * (`PUT /api/admin/content/:section`), and a line written through it would
 * skip the name check, so that door refuses this one key and so does its
 * public read (`GET /api/content/:section`), which would otherwise hand out a
 * withheld line. Both refusals are one line in server/index.ts, keyed on
 * `CANVAS_PUBLIC_SECTION` below.
 *
 * ── ISOMORPHIC ─────────────────────────────────────────────────────────────
 *
 * The page's form and the route read the same parser, so a person never
 * meets two different refusals for one mistake. The name check is the one
 * rule the page cannot run, because a visitor's browser holds nobody's name;
 * it lives on the server (server/lib/canvasNames.ts).
 */
import { CANVAS_BLOCK_IDS, CANVAS_BLOCKS, isCanvasBlockId, type CanvasBlockId } from "./governanceCanvas";

/** The key in the `content` document. Written only through `PUT /api/canvas/public/:block`. */
export const CANVAS_PUBLIC_SECTION = "canvas";

/** Where anybody reads the lines. The route and the page both use this. */
export const CANVAS_PUBLIC_PATH = "/api/canvas/public";

/** Where anybody reads the Decision Matrix rows the platform generates. */
export const CANVAS_PUBLIC_MATRIX_PATH = "/api/canvas/public/decision-matrix";

/** One line, as characters a person would count. */
export const CANVAS_PUBLIC_LINE_MAX = 280;

/** The stored lines, one per block that has one. */
export type CanvasPublicLines = Partial<Record<CanvasBlockId, string>>;

/** One block as `GET /api/canvas/public` answers it, to everybody alike. */
export interface CanvasPublicBlock {
  id: CanvasBlockId;
  /** The line, or null when there is none to show. */
  line: string | null;
  /**
   * True when a line is stored and is held back because it now holds the name
   * of somebody the village has admitted. The line itself never leaves the
   * server while this is true.
   */
  withheld: boolean;
}

/**
 * What a signed-in member reads for one block, beside its public line: the
 * village's own words from a brief section the block draws on.
 */
export interface CanvasMemberAnswer {
  section: string;
  title: string;
  body: string;
}

/**
 * Brief sections that stay with the admins for reading AND writing whatever
 * their audience column says (plan 2.3 "Three pens", 4.6). They name members,
 * title holders and a village's private limits, so a member's view of the
 * canvas never carries them.
 */
export const ADMIN_ONLY_BRIEF_SECTIONS: ReadonlySet<string> = new Set(["people", "legal", "land", "constraints"]);

/** What the refusals and the page say, in one place. */
export const PUBLIC_LINE_WORDS = {
  notText: "Send the line as text. An empty line takes the block's public line down.",
  oneLine: "A public line is one line. Take out the line breaks.",
  tooLong: `Keep a public line to ${CANVAS_PUBLIC_LINE_MAX} characters.`,
  notABlock: "That is not one of the twelve canvas blocks.",
} as const;

/**
 * Zero-width spaces and joiners, soft hyphens and the other format characters.
 * Built with the constructor: the typecheck target predates the `u` flag on a
 * regular expression literal, and every runtime this ships to has it.
 */
export const FORMAT_CHARACTERS = new RegExp("\\p{Cf}", "gu");

/**
 * The line as it will be stored and checked: composed Unicode, with format
 * characters (zero-width spaces and joiners, soft hyphens) taken out, and
 * trimmed. A name split by an invisible character is still a name, so what
 * the check reads and what the page shows are the same text.
 */
export function normalisePublicLine(raw: string): string {
  return raw.normalize("NFC").replace(FORMAT_CHARACTERS, "").trim();
}

/** Characters as a person counts them, so an emoji is one and not two. */
export function lineLength(line: string): number {
  return Array.from(line).length;
}

/**
 * THE ONE PARSER, for the route and for the form.
 *
 * An empty line is allowed and means "take this block's line down". It does
 * not check names; the route does that after this passes.
 */
export function parsePublicLine(body: unknown): { ok: true; line: string } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.line !== "string") return { ok: false, error: PUBLIC_LINE_WORDS.notText };
  const line = normalisePublicLine(b.line);
  if (/[\r\n\u2028\u2029]/.test(line)) return { ok: false, error: PUBLIC_LINE_WORDS.oneLine };
  if (lineLength(line) > CANVAS_PUBLIC_LINE_MAX) return { ok: false, error: PUBLIC_LINE_WORDS.tooLong };
  return { ok: true, line };
}

/**
 * The stored section, read defensively: the twelve block ids only, strings
 * only, blank lines dropped. Anything else in the document is ignored and
 * never served.
 */
export function readPublicLines(section: unknown): CanvasPublicLines {
  const out: CanvasPublicLines = {};
  if (!section || typeof section !== "object" || Array.isArray(section)) return out;
  for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
    if (!isCanvasBlockId(key) || typeof value !== "string") continue;
    const line = normalisePublicLine(value);
    if (line) out[key] = line;
  }
  return out;
}

/** The fields of a brief row this reads. `BriefRow` (server/lib/villageBrain.ts) satisfies it. */
export interface BriefRowFacts {
  section: string;
  title: string;
  body: string;
  status: string;
}

/**
 * Each block's member-audience answers, in the order the block lists its
 * sections: confirmed rows with words in them, from the sections the block
 * draws on, never an admin-only section. Hand it rows already read at the
 * member audience (`briefAll(pool, "member")`); this narrows and never widens.
 */
export function memberAnswersFrom(rows: readonly BriefRowFacts[]): Record<CanvasBlockId, CanvasMemberAnswer[]> {
  const bySection = new Map<string, BriefRowFacts>();
  for (const row of rows) bySection.set(row.section, row);
  const out = {} as Record<CanvasBlockId, CanvasMemberAnswer[]>;
  for (const id of CANVAS_BLOCK_IDS) {
    const answers: CanvasMemberAnswer[] = [];
    for (const section of CANVAS_BLOCKS[id].briefSections) {
      if (ADMIN_ONLY_BRIEF_SECTIONS.has(section)) continue;
      const row = bySection.get(section);
      if (!row || row.status !== "confirmed" || !row.body.trim()) continue;
      answers.push({ section: row.section, title: row.title, body: row.body.trim() });
    }
    out[id] = answers;
  }
  return out;
}
