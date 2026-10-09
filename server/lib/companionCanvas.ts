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
 * ── A CLOSED SECTION IS NEVER CALLED BLANK ─────────────────────────────────
 *
 * Only aims, vision, values and language default to the member audience, and
 * an answer adopted on the canvas keeps its section's audience, so most
 * adopted answers are ones a member may not read. Each block therefore says
 * where every section without words in `answers` stands (`others`), by the
 * rule the canvas's own Say frame keeps (GET /api/canvas/blocks/:id,
 * server/routes/canvasFrames.ts): a member is told a section is kept with the
 * administrators, or written and not opened to members, and never whether it
 * is adopted; an administrator is told its state. Either way the words stay
 * out, and nobody is told "nothing was adopted" about an answer that was
 * (second review of the companion lane, 2026-10-01). The Conflict block reads
 * the conflict agreement's own adoption stamp.
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
import { ADMIN_ONLY_BRIEF_SECTIONS, memberAnswersFrom } from "../../shared/canvasPublicLines";
import { CONFLICT_AGREEMENT_KEY, agreementOf } from "../../shared/conflictAgreement";
import {
  CANVAS_BLOCK_IDS,
  CANVAS_BLOCKS,
  LEVEL_WORDS,
  MOMENT_LABELS,
  isCanvasBlockId,
  type CanvasBlockId,
} from "../../shared/governanceCanvas";
import { BRIEF_BY_ID } from "../../shared/villageBrief";
import { readConfigDocument } from "../repos/appConfigDocs";
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

/**
 * Where a section stands when its words are not in `answers`, said from the
 * asker's side. The first two are a member's view and say nothing of whether
 * the section is adopted, exactly as the canvas's Say frame tells them.
 */
export type CanvasSectionState =
  /** A member's view: one of the four sections kept with the administrators, written or not. */
  | "admin-only"
  /** A member's view: written, and not opened to members. */
  | "not-shared"
  /** An administrator's view: adopted, and its words stay with the administrators. */
  | "adopted-kept"
  /** Written, and nobody has adopted it yet. */
  | "draft"
  /** Nothing written yet. */
  | "blank";

/** One section of a block with no words in `answers`, and why. */
export interface CanvasSectionRecord {
  section: string;
  title: string;
  state: CanvasSectionState;
}

/** The conflict agreement as the Conflict block reads it: whether it is adopted, and the day. */
export interface CanvasAgreementRecord {
  adopted: boolean;
  /** The day it was adopted, YYYY-MM-DD, or null while it is not. */
  on: string | null;
}

/** One block as the companion reads it. */
export interface CanvasBlockRecord {
  block: CanvasBlockId;
  name: string;
  answers: CanvasAnswerWords[];
  /**
   * Every section the block draws on whose words are not in `answers`, with
   * its state. Absent on a record from before this field existed, which then
   * reads as a block with no other sections.
   */
  others?: CanvasSectionRecord[];
  /** The Conflict block only: the stored conflict agreement, or null when none is stored. */
  agreement?: CanvasAgreementRecord | null;
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
  /**
   * The legal shelf's own framing, word for word, whenever a hit comes from
   * it or the question was asked from the Legal block. Said before any of it.
   */
  framing?: string;
}

/**
 * The legal shelf's framing, verbatim from docs/knowledge/legal-structures.md.
 * The platform's rule for that document is that legal counsel always carries
 * it; the record answer prints it first and the model is told to repeat it.
 */
export const LEGAL_FRAMING =
  "This is orientation, not legal advice. Rules vary by state and country, and the details (tax, securities, zoning, employment) are jurisdiction-specific. Always engage a lawyer licensed where the land sits before signing or filing anything.";

/** The shelf document `LEGAL_FRAMING` belongs to. */
export const LEGAL_SHELF_DOC = "legal-structures";

/** The rule every guide prompt carries for legal questions, shared so organize and the companion say the same thing. */
export const LEGAL_PROMPT_RULE =
  "For anything legal (structures, taxes, land): repeat the framing verbatim: this is orientation, not legal advice; engage a lawyer licensed where the land sits. NEVER soften the 508(c)(1)(A) scam warnings.";

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
 * Cut at the last whole sentence that fits, so an excerpt never stops inside
 * a word or a disclaimer. With no sentence end in the last two thirds of the
 * room, it falls back to `clip`.
 */
export function clipAtSentence(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const room = t.slice(0, max);
  const end = Math.max(room.lastIndexOf(". "), room.lastIndexOf("! "), room.lastIndexOf("? "));
  return end >= max / 3 ? `${room.slice(0, end + 1)} ...` : clip(t, max);
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
 * Where one section with no words in `answers` stands, for this asker, by the
 * Say frame's rule (GET /api/canvas/blocks/:id). `stored` is the row read at
 * the ADMIN audience; only its audience, status and whether it holds words
 * are used here, never its words. A row with no words in it counts as
 * nothing written, which is what it is.
 */
export function sectionStateFor(section: string, stored: { audience: string; status: string; body: string } | undefined, admin: boolean): CanvasSectionState {
  const written = !!stored && stored.body.trim() !== "";
  const adminOnly = ADMIN_ONLY_BRIEF_SECTIONS.has(section);
  if (!admin && adminOnly) return "admin-only";
  if (!admin && written && stored!.audience !== "member") return "not-shared";
  if (!written) return "blank";
  return stored!.status === "confirmed" ? "adopted-kept" : "draft";
}

/**
 * Every block's adopted answers and newest reading. The WORDS are read at the
 * MEMBER audience whoever asks; `admin` changes only what the asker is told
 * about the sections whose words stay out (see the header).
 *
 * `query` narrows: the blocks it names come back with their answers whole,
 * and nothing else comes back. With no block named, all twelve come back in
 * canvas order, each answer cut to a glimpse, so the whole canvas fits one
 * prompt.
 */
export async function canvasAnswersForMembers(pool: Pool, query?: string, opts: { admin?: boolean } = {}): Promise<CanvasAnswersRead> {
  const admin = opts.admin === true;
  const focus = blocksNamedIn(query ?? "");
  const ids = focus.length > 0 ? focus : CANVAS_BLOCK_IDS;
  const [brief, everyRow, readings, purpose, agreementRaw] = await Promise.all([
    briefAll(pool, "member"),
    // States only: which sections hold words, at which audience and status.
    briefAll(pool, "admin"),
    allCanvasReadings(pool),
    governingPurpose(pool),
    ids.includes("conflict") ? readConfigDocument(pool, CONFLICT_AGREEMENT_KEY) : Promise.resolve(null),
  ]);
  const answers = memberAnswersFrom(brief);
  const stored = new Map(everyRow.map((r) => [r.section, r]));
  const newest = new Map(readingsByBlock(readings).map(({ blockId, readings: rs }) => [blockId, rs[0] ?? null]));
  const cut = focus.length > 0 ? FOCUSED_WORDS : GLIMPSE_WORDS;
  // The agreement's own reading of its stamp: a document that fails its shape check is no document.
  const agreement = agreementRaw ? agreementOf(agreementRaw, []) : null;
  const blocks = ids.map((id): CanvasBlockRecord => {
    const words: CanvasAnswerWords[] = answers[id].map((a) => ({ section: a.section, title: a.title, words: clip(a.body, cut) }));
    const others: CanvasSectionRecord[] = CANVAS_BLOCKS[id].briefSections
      .filter((section) => !words.some((w) => w.section === section))
      .map((section) => ({ section, title: BRIEF_BY_ID[section]?.title ?? section, state: sectionStateFor(section, stored.get(section), admin) }));
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
      others,
      ...(id === "conflict" ? { agreement: agreement ? { adopted: !!agreement.adoptedAt, on: agreement.adoptedAt ? agreement.adoptedAt.slice(0, 10) : null } : null } : {}),
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

/**
 * Resources, then the platform's own shelf, for one question. An empty
 * question reads nothing. A hit from the legal shelf, or a question asked
 * from the Legal block, carries that shelf's framing word for word.
 */
export async function canvasLibrary(pool: Pool, query: string): Promise<CanvasLibraryRead> {
  if (!query.trim()) return { resources: [], shelf: [] };
  const resources = await relevantCanvasResources(pool, query, 3);
  const sections = relevantSections(query, { shelves: ["knowledge"], budget: { maxSections: 3, maxTokens: 600 } });
  const shelf = sections.map((s) => ({
    citation: sectionCitation(s),
    excerpt: clipAtSentence(s.body.replace(/\s+/g, " "), 400),
  }));
  const legal = sections.some((s) => s.docKey === LEGAL_SHELF_DOC) || blocksNamedIn(query).includes("legal");
  return { resources, shelf, ...(legal ? { framing: LEGAL_FRAMING } : {}) };
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

/** One section with no words in the answer, said from the asker's side. Keyed by the union, so a new state cannot say nothing. */
const SECTION_SENTENCE: Record<CanvasSectionState, (block: string, title: string) => string> = {
  "admin-only": (block, title) => `For ${block}, "${title}" is kept with the administrators, so the guide cannot read it to you.`,
  "not-shared": (block, title) => `For ${block}, "${title}" is written, and not opened to members, so the guide cannot read it to you.`,
  "adopted-kept": (block, title) => `For ${block}, "${title}" is adopted, and its words stay with the administrators. Read them on the block's Say frame or the Brain tab.`,
  draft: (block, title) => `For ${block}, "${title}" has a draft nobody has adopted yet.`,
  blank: (block, title) => `For ${block}, nothing is written under "${title}" yet.`,
};

/** Where members read the conflict agreement. */
const AGREEMENT_WHERE = "Read it on How we work together (/governance).";

/** What one block's record lets the asker say about it, before any sentence is written. */
function blockFacts(b: CanvasBlockRecord) {
  const others = Array.isArray(b.others) ? b.others : [];
  const agreement = b.agreement ?? null;
  const adopted = b.answers.length > 0 || others.some((s) => s.state === "adopted-kept") || agreement?.adopted === true;
  // A section the asker may not see into: whether it is adopted is not theirs to know.
  const closed = others.some((s) => s.state === "admin-only" || s.state === "not-shared");
  const drafted = others.some((s) => s.state === "draft") || (agreement !== null && !agreement.adopted);
  return { others, agreement, adopted, closed, drafted };
}

function blockSentences(b: CanvasBlockRecord): string[] {
  const out: string[] = [];
  const { others, agreement, adopted, closed, drafted } = blockFacts(b);
  for (const a of b.answers) out.push(`Our answer for ${b.name}, from ${a.title}: "${a.words}"`);
  if (agreement) {
    out.push(
      agreement.adopted
        ? `The village adopted its conflict agreement${agreement.on ? ` on ${agreement.on}` : ""}. ${AGREEMENT_WHERE}`
        : `The village's conflict agreement is written, and nobody has adopted it yet. ${AGREEMENT_WHERE}`,
    );
  }
  if (!adopted && !closed && !drafted) {
    // Only an asker who can see every section is told nothing was adopted.
    out.push(`The village has not adopted an answer for ${b.name} yet.`);
    const elsewhere = CANVAS_BLOCKS[b.block].elsewhere;
    if (elsewhere && !agreement) out.push(elsewhere.note);
  } else {
    for (const s of others) out.push(SECTION_SENTENCE[s.state](b.name, s.title));
  }
  out.push(
    b.reading
      ? `Our last reading of ${b.name}: ${b.reading.word}, "${b.reading.sentence}" (${b.reading.moment}, ${b.reading.on}).`
      : `${b.name} has no reading yet.`,
  );
  return out;
}

/** The whole canvas in lists of names, and never a count. */
function overviewSentences(blocks: readonly CanvasBlockRecord[]): string[] {
  const answered: string[] = [];
  const kept: string[] = [];
  const drafts: string[] = [];
  const read: string[] = [];
  const blank: string[] = [];
  for (const b of blocks) {
    const { adopted, closed, drafted } = blockFacts(b);
    if (adopted) answered.push(b.name);
    else if (closed) kept.push(b.name);
    else if (drafted) drafts.push(b.name);
    if (b.reading) read.push(`${b.name} (${b.reading.word})`);
    if (!adopted && !closed && !drafted && !b.reading) blank.push(b.name);
  }
  const out: string[] = [];
  if (answered.length) out.push(`The village has adopted an answer for ${joinNames(answered)}.`);
  else if (kept.length) out.push("No block has an adopted answer that is opened to members yet.");
  else out.push("The village has not adopted an answer for any block yet.");
  if (kept.length) out.push(`Kept with the administrators, so the guide cannot read them to you: ${joinNames(kept)}.`);
  if (drafts.length) out.push(`Drafts nobody has adopted yet: ${joinNames(drafts)}.`);
  out.push(read.length ? `Its latest readings: ${joinNames(read)}.` : "No block has a reading yet.");
  if (blank.length) out.push(`Nothing is on record yet for ${joinNames(blank)}.`);
  out.push("Ask about one block by name, or from its card, to read its answer and reading in full.");
  return out;
}

function librarySentences(lib: CanvasLibraryRead): { lines: string[]; references: string[] } {
  // The framing goes first, before any of the shelf's words.
  const framing = typeof lib.framing === "string" && lib.framing ? [lib.framing] : [];
  if (lib.resources.length > 0) {
    const shown = lib.resources.slice(0, 3);
    return {
      lines: [...framing, `To read: ${joinNames(shown.map((r) => `${r.title} (${r.type}${r.url ? `, ${r.url}` : ""})`))}.`],
      references: shown.map((r) => `${r.title}. ${r.credit}`),
    };
  }
  if (lib.shelf.length > 0) {
    const shown = lib.shelf.slice(0, 3);
    return {
      lines: [...framing, "From the platform's own governance shelf:", ...shown.map((s) => `${s.citation}: ${s.excerpt}`)],
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
