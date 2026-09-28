/**
 * "TAKE THE CANVAS WITH YOU": the export pack (plan 5.6; Wave 4, 2026-09-28).
 *
 * Four Markdown files a member saves and can add to a notebook of their own
 * (a Gemini notebook, say): `README.md`, `canvas.md`, `resources.md` and
 * `our-documents.md`. Built here, sent by `POST /api/canvas/exports`, saved by
 * the member's own browser. Nothing is sent anywhere by this server.
 *
 * ── THIS CHANGES A WRITTEN PROMISE, AND ONLY THIS FAR ──────────────────────
 *
 * The brief was "fork-local, always" (drizzle/0052, shared/villageBrief.ts),
 * and the Brain tab said "None of it leaves this village". Rye asked for the
 * export (BUILD_PLAN Q11: yes, for member-audience answers only), so the
 * promise now reads: what a member can already read on the canvas may leave
 * in that member's own hands, and nothing else.
 *
 * ── THE FENCE ──────────────────────────────────────────────────────────────
 *
 * This file reads the brief through ONE function, `memberCanvasAnswers`
 * (server/lib/villageBrain.ts): member audience, confirmed rows, and never
 * `people`, `legal`, `land` or `constraints`. It imports nothing else from the
 * brain, and server/lib/villageBrain.test.ts reads this file's source to hold
 * it to that, so a later edit that reaches for any other reader of the brief
 * fails a test and never a village.
 *
 * The other things it reads are ones a member already reads in the app: the
 * canvas readings (every member reads them on the canvas), the documents the
 * village shared, the exporting member's OWN documents, and the picks. Never
 * another member's private document: `textDocumentsReadableBy` says so in its
 * WHERE.
 *
 * ── ROLES, NOT PEOPLE ──────────────────────────────────────────────────────
 *
 * A reading carries who recorded it, and the app shows their first name to
 * members. The pack does not: the reader never even receives the name (the
 * gather step drops it), and the file says the readings were recorded by
 * whoever held the village's story. Shared documents are not credited to
 * their owners either.
 *
 * ── NO NUMBER BUT THE LEVEL ────────────────────────────────────────────────
 *
 * R55 holds here as on the canvas: each reading's level, 1 to 5, and nothing
 * combined across blocks. No total, no average, no "so many of twelve", no
 * percent. The export's own test sweeps the four files for each shape.
 */
import { createHash } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { CANVAS_ORDER, LEVEL_WORDS, MOMENT_LABELS, type CanvasBlockId, type CanvasLevel, type CanvasMoment } from "../../shared/governanceCanvas";
import { CANVAS_CREDIT } from "../../shared/governanceCanvasText";
import type { CanvasMemberAnswer } from "../../shared/canvasPublicLines";
import { KIND_LABELS, isTextKind, type DocumentKind } from "../../shared/villageDocuments";
import { memberCanvasAnswers } from "./villageBrain";
import { allCanvasReadings } from "../repos/canvasReadings";
import {
  documentsOwnedBy,
  resourceFactsFor,
  resourcePicksFor,
  sharedDocuments,
  textDocumentsReadableBy,
  VILLAGE_PICK,
  type ResourceFacts,
} from "../repos/villageDocuments";

/** The four files, in the order the page offers them. */
export const PACK_FILE_NAMES = ["README.md", "canvas.md", "resources.md", "our-documents.md"] as const;
export type PackFileName = (typeof PACK_FILE_NAMES)[number];

/**
 * The Governance Canvas Database, restricted to its five public columns
 * (name, type, authors, short description, link). The sheet's other columns
 * hold submitters' names and email addresses, and this query never asks for
 * them (plan 5.1).
 */
export const CANVAS_DATABASE_CSV =
  "https://docs.google.com/spreadsheets/d/1rDA_fXJe-WziLzhqV2WLBBTdSgNyPa7AwK_ftuGDs24/gviz/tq?tqx=out:csv&sheet=Database&headers=1&tq=select%20A%2CB%2CC%2CD%2CE";

export const CANVAS_DATABASE_CREDIT = "the Governance Canvas Database, by the Bioregional Weaving Labs Collective and Commonland";

/** One reading as the pack carries it. No recorder: the gather step drops it. */
export interface PackReading {
  blockId: CanvasBlockId;
  level: CanvasLevel;
  sentence: string;
  moment: CanvasMoment;
  recordedAt: string;
}

export interface PackDocument {
  title: string;
  kind: DocumentKind;
  /** The text, on a text kind. Null on a PDF or Word file, which stays in the village. */
  body: string | null;
  createdAt: string;
  sharedAt: string | null;
}

export interface PackPick {
  key: string;
  facts: ResourceFacts | null;
}

export interface PackInput {
  villageName: string;
  answers: Record<CanvasBlockId, CanvasMemberAnswer[]>;
  /** Newest first. */
  readings: PackReading[];
  shared: PackDocument[];
  /** The exporting member's own documents that are still private. */
  mine: PackDocument[];
  villagePicks: PackPick[];
  myPicks: PackPick[];
  /** False when the canvas resources table could not be read, so picks show by key. */
  resourcesReadable: boolean;
}

export interface PackFile {
  name: PackFileName;
  content: string;
}

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");

/**
 * A document's own headings, pushed below the pack's, so a document that
 * opens with `# Title` does not read as a new top-level part of the file.
 */
export function demoteHeadings(body: string, by: number): string {
  return body
    .split("\n")
    .map((line) => {
      const m = /^(\s{0,3})(#{1,6})(\s+.*)$/.exec(line);
      if (!m) return line;
      return `${m[1]}${"#".repeat(Math.min(6, m[2].length + by))}${m[3]}`;
    })
    .join("\n");
}

function renderReadme(input: PackInput, dated: string): string {
  return [
    `# Take the canvas with you: ${input.villageName}`,
    "",
    `Exported on ${dated}. This pack is a snapshot of that day and does not update itself. Export again after the next canvas moon: the village's canvas page says when something has changed since your last export.`,
    "",
    "## The four files",
    "",
    "- `canvas.md`: the twelve blocks of the governance canvas, the village's own confirmed answers that members can read, and every reading with its level and its sentence.",
    "- `resources.md`: the resources the village picked and the ones you picked, and the address of the Governance Canvas Database.",
    "- `our-documents.md`: the documents the village shared, and your own private documents.",
    "- `README.md`: this file.",
    "",
    "## What stays in the village",
    "",
    "- Everything the village keeps to its administrators. The sections on people, legal matters, land and red lines never leave, whoever they are open to.",
    "- Answers that are still proposed and not confirmed.",
    "- Every other member's private documents.",
    "- Who recorded each reading. The readings name the role that records them, and never the person.",
    "- PDF and Word files. Their titles are listed; the files stay in the village.",
    "",
    "## Adding it to a Gemini notebook",
    "",
    "Uploading these files to a Gemini notebook sends everything in them to Google. Your own private documents are in `our-documents.md`, under their own heading: take them out before you upload if they should stay with you.",
    "",
    "To add the Governance Canvas Database as a source, add this address as a web link. It asks for the database's five public columns and nothing else:",
    "",
    CANVAS_DATABASE_CSV,
    "",
    "A web link or an uploaded file does not refresh itself in a notebook. Add them again to pick up what changed.",
    "",
    "## Credit",
    "",
    `The twelve blocks come from the ${CANVAS_CREDIT.text}: ${CANVAS_CREDIT.url}. The questions under each block are this platform's own words.`,
    "",
  ].join("\n");
}

function renderCanvas(input: PackInput, dated: string): string {
  const lines: string[] = [
    `# ${input.villageName}: our governance canvas`,
    "",
    `Exported on ${dated}. A snapshot of that day.`,
    "",
    `The twelve blocks come from the ${CANVAS_CREDIT.text} (${CANVAS_CREDIT.url}). The question under each block is this platform's own words.`,
    "",
    "A reading gives one block a level from 1 (Absent) to 5 (Thriving) and one sentence saying why. Every reading here was recorded by whoever held the village's story at the time, and this file names that role, never the person.",
    "",
  ];
  for (const block of CANVAS_ORDER) {
    lines.push(`## ${block.number}. ${block.name}`, "", `Our question: ${block.question}`, "", "### In our own words", "");
    const answers = input.answers[block.id] ?? [];
    if (!answers.length) {
      lines.push("Nothing confirmed that members can read is written for this block yet.", "");
    }
    for (const a of answers) {
      lines.push(`#### ${a.title}`, "", demoteHeadings(a.body.trim(), 4), "");
    }
    lines.push("### Readings, newest first", "");
    const readings = input.readings.filter((r) => r.blockId === block.id);
    if (!readings.length) lines.push("Not read yet.", "");
    for (const r of readings) {
      lines.push(`- ${day(r.recordedAt)}, ${MOMENT_LABELS[r.moment]}: ${LEVEL_WORDS[r.level]} (level ${r.level}). ${r.sentence.replace(/\s*\n\s*/g, " ")}`);
    }
    if (readings.length) lines.push("");
  }
  return lines.join("\n");
}

function pickLine(p: PackPick, readable: boolean): string {
  if (!p.facts) {
    return readable
      ? `- \`${p.key}\`: this village's copy of the database no longer lists it.`
      : `- \`${p.key}\``;
  }
  const f = p.facts;
  const where = f.withdrawn ? "withdrawn from the database" : f.url ?? "link pending";
  return `- **${f.name || p.key}**${f.type ? ` (${f.type})` : ""}: ${where}`;
}

function renderResources(input: PackInput): string {
  const lines: string[] = [
    "# Resources",
    "",
    "## The Governance Canvas Database",
    "",
    `This comes from ${CANVAS_DATABASE_CREDIT}. Its five public columns (name, type, authors, short description and link) are at this address, which a Gemini notebook takes as a web link:`,
    "",
    CANVAS_DATABASE_CSV,
    "",
  ];
  if (!input.resourcesReadable && (input.villagePicks.length || input.myPicks.length)) {
    lines.push("The names of the picks below could not be read in the village when this was exported, so each is listed by its key.", "");
  }
  lines.push("## The village's picks", "");
  if (!input.villagePicks.length) lines.push("The village has not picked any resources yet.");
  for (const p of input.villagePicks) lines.push(pickLine(p, input.resourcesReadable));
  lines.push("", "## Your picks", "");
  if (!input.myPicks.length) lines.push("You have not picked any resources yet.");
  for (const p of input.myPicks) lines.push(pickLine(p, input.resourcesReadable));
  lines.push("");
  return lines.join("\n");
}

function documentBlock(d: PackDocument, when: string): string[] {
  const out = [`### ${d.title}`, ""];
  if (!isTextKind(d.kind) || d.body === null) {
    out.push(`A ${KIND_LABELS[d.kind]} file kept in the village, ${when}. The file is not in this pack: open it in the village to read it.`, "");
    return out;
  }
  out.push(`${KIND_LABELS[d.kind]}, ${when}.`, "", demoteHeadings(d.body.trim(), 3), "");
  return out;
}

function renderDocuments(input: PackInput): string {
  const lines: string[] = ["# Our documents", "", "## Shared with the village", ""];
  if (!input.shared.length) lines.push("The village has not shared any documents yet.", "");
  for (const d of input.shared) lines.push(...documentBlock(d, `shared on ${day(d.sharedAt)}`));
  lines.push("## Yours, private", "");
  if (!input.mine.length) {
    lines.push("You have no private documents in your notebook.", "");
  } else {
    lines.push("Only you can read these in the village. They are here because you made this export.", "");
    for (const d of input.mine) lines.push(...documentBlock(d, `added on ${day(d.createdAt)}`));
  }
  return lines.join("\n");
}

/**
 * The four files. `exportedAt` null renders the same files with no date in
 * them, which is what the content hash is taken over, so two exports of an
 * unchanged canvas on different days hash the same.
 */
export function renderPack(input: PackInput, exportedAt: Date | null): PackFile[] {
  const dated = exportedAt ? `${exportedAt.toISOString().slice(0, 10)} (UTC)` : "(date)";
  return [
    { name: "README.md", content: renderReadme(input, dated) },
    { name: "canvas.md", content: renderCanvas(input, dated) },
    { name: "resources.md", content: renderResources(input) },
    { name: "our-documents.md", content: renderDocuments(input) },
  ];
}

/** What changed since the last export is asked of this: the four files, undated, hashed. */
export function packHash(input: PackInput): string {
  const h = createHash("sha256");
  for (const f of renderPack(input, null)) h.update(`${f.name}\n${f.content}\n`);
  return h.digest("hex");
}

/**
 * Read everything the pack holds for one member. The ONLY brief reader is
 * `memberCanvasAnswers`; the readings lose their recorder here, before any
 * renderer sees them.
 */
export async function gatherPackInput(pool: Pool, viewerId: string, villageName: string): Promise<PackInput> {
  const [answers, readings, sharedList, ownList, texts, villageKeys, myKeys] = await Promise.all([
    memberCanvasAnswers(pool),
    allCanvasReadings(pool),
    sharedDocuments(pool),
    documentsOwnedBy(pool, viewerId),
    textDocumentsReadableBy(pool, viewerId),
    resourcePicksFor(pool, VILLAGE_PICK),
    viewerId ? resourcePicksFor(pool, viewerId) : Promise.resolve([] as string[]),
  ]);
  const bodies = new Map(texts.map((t) => [t.id, t.body]));
  const asPack = (d: { id: number; title: string; kind: DocumentKind; createdAt: string; sharedAt: string | null }): PackDocument => ({
    title: d.title,
    kind: d.kind,
    body: isTextKind(d.kind) ? bodies.get(d.id) ?? null : null,
    createdAt: d.createdAt,
    sharedAt: d.sharedAt,
  });
  const facts = await resourceFactsFor(pool, Array.from(new Set(villageKeys.concat(myKeys))));
  return {
    villageName: villageName.trim() || "Our village",
    answers,
    readings: readings.map((r) => ({ blockId: r.blockId, level: r.level, sentence: r.sentence, moment: r.moment, recordedAt: r.recordedAt })),
    shared: sharedList.map(asPack),
    mine: ownList.filter((d) => !d.shared).map(asPack),
    villagePicks: villageKeys.map((key) => ({ key, facts: facts?.get(key) ?? null })),
    myPicks: myKeys.map((key) => ({ key, facts: facts?.get(key) ?? null })),
    resourcesReadable: facts !== null,
  };
}
