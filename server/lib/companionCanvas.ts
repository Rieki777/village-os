/**
 * WHAT THE COMPANION READS ABOUT THE CANVAS, AND WHAT IT SAYS WITH NO MODEL
 * (plan 5.4 and defect 10; Wave 4, 2026-09-28).
 *
 * Three readers in the registry (server/lib/villageReaders.ts) read through
 * the functions below, and the deterministic answer is written here too, so
 * a village with no model key still gets an answer from its own record.
 *
 * ── THE AUTHORITY ORDER ────────────────────────────────────────────────────
 *
 * Highest first: what is live in the village now (the other readers); then
 * the canvas answers the village adopted and its latest readings
 * (`canvas.answers`); then the village's own documents; then resources and
 * the shared shelf (`canvas.library`), which are counsel. The village's own
 * material outranks the shared brain (server/lib/knowledge.ts header).
 *
 * ── MEMBERS' WORDS ONLY, WHOEVER ASKS ──────────────────────────────────────
 *
 * `canvasAnswersForMembers` reads the brief at the MEMBER audience, whoever is
 * asking, and `memberAnswersFrom` (shared/canvasPublicLines.ts) then keeps
 * confirmed rows only and drops the four sections that stay with the admins
 * whatever their audience column says (`people`, `legal`, `land`,
 * `constraints`). An admin asking the companion reads what a member reads:
 * the admin-audience rows have their own editor, and the organize mode reads
 * them for stewards (server/routes/organize.ts). The readings carry the level
 * as its word and never the recorder's name.
 *
 * ── CANVAS RESOURCES ARE NOT ON THIS BRANCH YET ────────────────────────────
 *
 * `relevantCanvasResources` is a stub that returns nothing. The resources
 * lane owns `canvas_resources` (migration 0224) and its sync; when it lands,
 * this function reads that table through its repo, ranks it with `rank()`
 * (knowledge.ts), and puts the village's own picks first. Until then the
 * library's other half, the platform's own governance shelf, still answers.
 *
 * ── NO NUMBER BUT A LEVEL'S WORD ───────────────────────────────────────────
 *
 * R55 governs every surface, and the canvas's 1 to 5 radar is the one
 * exception, on the canvas view only. So nothing here adds, averages, counts
 * or ranks readings, and no sentence says how many blocks are read: the
 * overview names blocks and never counts them.
 */
import type { Pool } from "mysql2/promise";
import { memberAnswersFrom } from "../../shared/canvasPublicLines";
import {
  CANVAS_BLOCK_IDS,
  CANVAS_BLOCKS,
  LEVEL_WORDS,
  MOMENT_LABELS,
  isCanvasBlockId,
  type CanvasBlockId,
} from "../../shared/governanceCanvas";
import { allCanvasReadings, readingsByBlock } from "../repos/canvasReadings";
import { allDecisionMatrixRows } from "../repos/decisionMatrixRows";
import { governingPurpose } from "./governingPurpose";
import { relevantSections, sectionCitation } from "./knowledge";
import { briefAll } from "./villageBrain";

/** One adopted answer, in the village's own words. */
export interface CanvasAnswerWords {
  /** The brief section id, or `purpose-statement` for the governing purpose statement. */
  section: string;
  title: string;
  words: string;
}

/** One block as the companion reads it. */
export interface CanvasBlockRecord {
  block: CanvasBlockId;
  name: string;
  answers: CanvasAnswerWords[];
  /** The newest reading, as its word and sentence, or null when there is none. */
  reading: { word: string; sentence: string; moment: string; on: string } | null;
}

/** What `canvas.answers` returns. `focus` names the blocks the question asked about, if any. */
export interface CanvasAnswersRead {
  focus: CanvasBlockId[];
  blocks: CanvasBlockRecord[];
}

/** A Canvas Resource as the companion may cite it: metadata only, never a full text. */
export interface CanvasResourceHit {
  key: string;
  title: string;
  type: string;
  url: string | null;
  credit: string;
}

/** A section of the platform's own shelf, cited and cut short. */
export interface ShelfHit {
  citation: string;
  excerpt: string;
}

/** What `canvas.library` returns. */
export interface CanvasLibraryRead {
  resources: CanvasResourceHit[];
  shelf: ShelfHit[];
}

/** One row of the Decision Matrix the village wrote, without who last wrote it. */
export interface MatrixRowRead {
  subject: string;
  approval: string;
  consultation: string;
  information: string;
  method: string;
  riskTags: string[];
}

/** How much of one answer rides along: whole words for the blocks asked about, a glimpse for the rest. */
export const FOCUSED_WORDS = 900;
export const GLIMPSE_WORDS = 160;
const SENTENCE_GLIMPSE = 200;
/** The most blocks one question may focus on. More than this reads as the whole canvas. */
export const MAX_FOCUS = 2;

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}...`;
}

/**
 * The blocks a question names, in canvas order. A block is named by its own
 * name or id as a whole word ("power", "Conflict"), and a plural of the name
 * counts ("meeting" finds Meetings). More than `MAX_FOCUS` names reads as a
 * question about the whole canvas, which returns none.
 */
export function blocksNamedIn(text: string): CanvasBlockId[] {
  const q = String(text ?? "").toLowerCase();
  const named: CanvasBlockId[] = [];
  for (const id of CANVAS_BLOCK_IDS) {
    const name = CANVAS_BLOCKS[id].name.toLowerCase();
    const stem = name.endsWith("s") ? name.slice(0, -1) : name;
    if (new RegExp(`\\b(${id}|${name}|${stem}s?)\\b`).test(q)) named.push(id);
  }
  return named.length > MAX_FOCUS ? [] : named;
}

/**
 * Every block's adopted answers and newest reading, at the MEMBER audience.
 *
 * `query` narrows: the blocks it names come back with their answers whole,
 * and nothing else comes back. With no block named, all twelve come back in
 * canvas order, each answer cut to a glimpse, so the whole canvas fits one
 * prompt.
 */
export async function canvasAnswersForMembers(pool: Pool, query?: string): Promise<CanvasAnswersRead> {
  const focus = blocksNamedIn(query ?? "");
  const [brief, readings, purpose] = await Promise.all([
    briefAll(pool, "member"),
    allCanvasReadings(pool),
    governingPurpose(pool),
  ]);
  const answers = memberAnswersFrom(brief);
  const newest = new Map(readingsByBlock(readings).map(({ blockId, readings: rs }) => [blockId, rs[0] ?? null]));
  const ids = focus.length > 0 ? focus : CANVAS_BLOCK_IDS;
  const cut = focus.length > 0 ? FOCUSED_WORDS : GLIMPSE_WORDS;
  const blocks = ids.map((id): CanvasBlockRecord => {
    const words: CanvasAnswerWords[] = answers[id].map((a) => ({ section: a.section, title: a.title, words: clip(a.body, cut) }));
    // The purpose statement is the village's adopted answer to block 1, and
    // any signed-in member may read it (GET /api/governance/purpose).
    if (id === "purpose" && purpose.statement.trim()) {
      words.unshift({ section: "purpose-statement", title: "The governing purpose statement", words: clip(purpose.statement, cut) });
    }
    const r = newest.get(id) ?? null;
    return {
      block: id,
      name: CANVAS_BLOCKS[id].name,
      answers: words,
      reading: r
        ? {
            word: LEVEL_WORDS[r.level],
            sentence: focus.length > 0 ? r.sentence : clip(r.sentence, SENTENCE_GLIMPSE),
            moment: MOMENT_LABELS[r.moment],
            on: r.recordedAt.slice(0, 10),
          }
        : null,
    };
  });
  return { focus, blocks };
}

/**
 * THE STUB. Canvas Resources that fit the question, the village's own picks
 * first. Returns nothing until the resources lane's table lands; see the
 * header. The signature is the one the reader and the answer below use, so
 * the lane replaces the body and nothing else.
 */
export async function relevantCanvasResources(_pool: Pool, _query: string, _max = 3): Promise<CanvasResourceHit[]> {
  return [];
}

/** Resources, then the platform's own shelf, for one question. An empty question reads nothing. */
export async function canvasLibrary(pool: Pool, query: string): Promise<CanvasLibraryRead> {
  if (!query.trim()) return { resources: [], shelf: [] };
  const resources = await relevantCanvasResources(pool, query, 3);
  const shelf = relevantSections(query, { shelves: ["knowledge"], budget: { maxSections: 3, maxTokens: 600 } }).map((s) => ({
    citation: sectionCitation(s),
    excerpt: clip(s.body.replace(/\s+/g, " "), 400),
  }));
  return { resources, shelf };
}

/** The Decision Matrix rows the village wrote, each field cut short, and never who wrote them. */
export async function matrixRowsForMembers(pool: Pool): Promise<MatrixRowRead[]> {
  return (await allDecisionMatrixRows(pool)).map((r) => ({
    subject: clip(r.subject, 200),
    approval: clip(r.approval, 200),
    consultation: clip(r.consultation, 200),
    information: clip(r.information, 200),
    method: clip(r.method, 200),
    riskTags: r.riskTags.slice(0, 8),
  }));
}

// ── Saying it without a model ────────────────────────────────────────────────

/** The route's response shape for a record answer, the same as every renderer's. */
export interface RecordAnswer {
  reply: string;
  consulted: { ownRecord: string[]; references: string[]; readers: string[] };
}

/** Why an answer came from the record alone, said first so the member knows. */
export type RecordReason = "no-key" | "no-consent" | "lookup";

export const RECORD_REASON_SENTENCE: Record<RecordReason, string> = {
  "no-key": "No model is connected to this village, so this answer comes straight from its record.",
  "no-consent": "Nothing you ask goes to a model until you agree to the line below, so this answer comes straight from the village's record.",
  lookup: "",
};

/** What the record can answer, said when a question is about something else. */
export const RECORD_SCOPE_SENTENCE =
  "From the record alone this can answer what the village has written down about how it governs itself. Ask about a canvas block by name, or from its card.";

/**
 * Whether a question is about the canvas at all: it names a block, or asks
 * about the canvas, its answers, its readings or what is still blank. A
 * question about something else gets the scope sentence, never a tour of the
 * canvas it did not ask for.
 */
export function looksLikeCanvasQuestion(text: string): boolean {
  if (blocksNamedIn(text).length > 0) return true;
  return /\b(canvas|blank|readings?|adopted|answered|our answers?|govern\w*)\b/i.test(String(text ?? ""));
}

/** Names joined as a person would say them: "A", "A and B", "A, B and C". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function blockSentences(b: CanvasBlockRecord): string[] {
  const out: string[] = [];
  if (b.answers.length > 0) {
    for (const a of b.answers) out.push(`Our answer for ${b.name}, from ${a.title}: "${a.words}"`);
  } else {
    out.push(`The village has not adopted an answer for ${b.name} yet.`);
    const elsewhere = CANVAS_BLOCKS[b.block].elsewhere;
    if (elsewhere) out.push(elsewhere.note);
  }
  out.push(
    b.reading
      ? `Our last reading of ${b.name}: ${b.reading.word}, "${b.reading.sentence}" (${b.reading.moment}, ${b.reading.on}).`
      : `${b.name} has no reading yet.`,
  );
  return out;
}

/** The whole canvas in three lists of names, and never a count. */
function overviewSentences(blocks: readonly CanvasBlockRecord[]): string[] {
  const answered: string[] = [];
  const read: string[] = [];
  const blank: string[] = [];
  for (const b of blocks) {
    if (b.answers.length > 0) answered.push(b.name);
    if (b.reading) read.push(`${b.name} (${b.reading.word})`);
    if (b.answers.length === 0 && !b.reading) blank.push(b.name);
  }
  const out: string[] = [];
  out.push(answered.length ? `The village has adopted an answer for ${joinNames(answered)}.` : "The village has not adopted an answer for any block yet.");
  out.push(read.length ? `Its latest readings: ${joinNames(read)}.` : "No block has a reading yet.");
  if (blank.length) out.push(`Nothing is on record yet for ${joinNames(blank)}.`);
  out.push("Ask about one block by name, or from its card, to read its answer and reading in full.");
  return out;
}

function librarySentences(lib: CanvasLibraryRead): { lines: string[]; references: string[] } {
  if (lib.resources.length > 0) {
    const shown = lib.resources.slice(0, 3);
    return {
      lines: [`To read: ${joinNames(shown.map((r) => `${r.title} (${r.type}${r.url ? `, ${r.url}` : ""})`))}.`],
      references: shown.map((r) => `${r.title}. ${r.credit}`),
    };
  }
  if (lib.shelf.length > 0) {
    const shown = lib.shelf.slice(0, 3);
    return {
      lines: ["From the platform's own governance shelf:", ...shown.map((s) => `${s.citation}: ${s.excerpt}`)],
      references: shown.map((s) => s.citation),
    };
  }
  return { lines: [], references: [] };
}

/**
 * THE ANSWER FROM THE RECORD, with no model: our answer, our last reading,
 * and up to three resources, and first a sentence saying why it came from
 * the record. `canvas` is null when it was not read (the question is about
 * something else) or the canvas reader refused this viewer, and `refusal` is
 * then what they are told. `library` is null when it was not read.
 */
export function recordAnswer(input: {
  why: RecordReason;
  canvas: CanvasAnswersRead | null;
  refusal?: string;
  library: CanvasLibraryRead | null;
  /**
   * What the live readers the question named said, already in words (their
   * templates). Live state is the highest authority, so it comes first.
   */
  live?: readonly RecordAnswer[];
}): RecordAnswer {
  const lines: string[] = [];
  const readers: string[] = [];
  const why = RECORD_REASON_SENTENCE[input.why];
  if (why) lines.push(why);
  for (const l of input.live ?? []) {
    lines.push(l.reply);
    readers.push(...l.consulted.readers);
  }
  if (input.canvas) {
    readers.push("canvas.answers");
    lines.push(...(input.canvas.focus.length > 0 ? input.canvas.blocks.flatMap(blockSentences) : overviewSentences(input.canvas.blocks)));
  } else if (input.refusal) {
    lines.push(input.refusal);
  } else if (!input.live?.length) {
    lines.push(RECORD_SCOPE_SENTENCE);
  }
  let references: string[] = [];
  if (input.library) {
    readers.push("canvas.library");
    const lib = librarySentences(input.library);
    if (lib.lines.length) lines.push(...lib.lines);
    else if (input.canvas?.focus.length) lines.push("Nothing on the shelf matches this block's question yet.");
    references = lib.references;
  }
  return { reply: lines.join("\n"), consulted: { ownRecord: [], references, readers } };
}

// ── The three readers' templates (the router's deterministic road) ───────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * `canvas.answers` said without a model. Null when the data is not the
 * reader's own shape, which includes the over-budget `{ truncated }` shape:
 * a sentence about a canvas this process did not see whole could name a
 * block as blank that is not.
 */
export function renderCanvasAnswers(data: unknown): RecordAnswer | null {
  if (!isRecord(data) || data.truncated || !Array.isArray(data.focus) || !Array.isArray(data.blocks)) return null;
  return recordAnswer({ why: "lookup", canvas: data as unknown as CanvasAnswersRead, library: null });
}

/** `canvas.library` said without a model. */
export function renderCanvasLibrary(data: unknown): RecordAnswer | null {
  if (!isRecord(data) || data.truncated || !Array.isArray(data.resources) || !Array.isArray(data.shelf)) return null;
  const lib = librarySentences(data as unknown as CanvasLibraryRead);
  return {
    reply: lib.lines.length ? lib.lines.join("\n") : "Nothing on the shelf matches that question yet.",
    consulted: { ownRecord: [], references: lib.references, readers: ["canvas.library"] },
  };
}

/**
 * `matrix.rows` said without a model. Null on a truncated list: the rows
 * that fell off the end could be the one asked about.
 */
export function renderMatrixRows(data: unknown): RecordAnswer | null {
  if (!Array.isArray(data)) return null;
  const said = (v: unknown) => String(v ?? "").trim() || "not written";
  const lines = (data as MatrixRowRead[]).map(
    (r) =>
      `${said(r.subject)}: approved by ${said(r.approval)}; asked first: ${said(r.consultation)}; told: ${said(r.information)}; method: ${said(r.method)}.`,
  );
  return {
    reply: lines.length
      ? ["The Decision Matrix rows the village wrote:", ...lines].join("\n")
      : "The village has not written any rows of its Decision Matrix yet. The platform's own half is on the canvas's Power block.",
    consulted: { ownRecord: [], references: [], readers: ["matrix.rows"] },
  };
}

/** The block a request names, or null. The Ask buttons send it; anything else is ignored. */
export function blockFromBody(raw: unknown): CanvasBlockId | null {
  return isCanvasBlockId(raw) ? raw : null;
}
