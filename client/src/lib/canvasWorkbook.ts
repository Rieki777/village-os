/**
 * THE CANVAS WORKBOOK AS A FILE (2026-09-25).
 *
 * The printable workbook at /canvas/workbook has a second way out: "Save as
 * Markdown" builds the same workbook as one .md file IN THE BROWSER, for a
 * group that would sooner fill it in a text editor or a shared document than
 * on paper. Nothing is fetched and nothing is sent. The only thing the file
 * knows about the village is its name, which is what the page knows too.
 *
 * Kept pure, so a test reads the whole file line by line, and kept to the
 * same line as the Canvas view: every level stands alone. The five levels are
 * a list to tick one from, per block; nothing here adds levels up, counts
 * blocks, or says how far through the canvas a village is.
 * client/src/lib/canvasCopy.test.ts sweeps this file with the view's own
 * rules.
 *
 * The canvas's words come from shared/governanceCanvasText.ts and the credit
 * travels with them, at the top of the file and again at its foot, so a copy
 * that outlives its first page still says whose words it holds.
 */
import {
  CANVAS_FOUNDATIONS,
  CANVAS_LEVELS,
  CANVAS_ORDER,
  type CanvasBlock,
  type CanvasLevel,
} from "@shared/governanceCanvas";
import {
  CANVAS_BLOCK_TEXT,
  CANVAS_CREDIT,
  CANVAS_DECISION_MATRIX_COLUMNS,
  CANVAS_FOUNDATION_TEXT,
  CANVAS_KEY_MOMENTS,
  CANVAS_SCALE_TEXT,
} from "@shared/governanceCanvasText";

export type WorkbookPaper = "a4" | "letter";

export const PAPER_LABELS: Record<WorkbookPaper, string> = { a4: "A4", letter: "US Letter" };

/** The CSS `@page { size }` keyword for each paper. */
export const PAPER_SIZES: Record<WorkbookPaper, string> = { a4: "A4", letter: "letter" };

/**
 * Regions whose printers default to US Letter. Everywhere else prints A4, so
 * an unknown or missing locale lands on A4, the more common sheet.
 */
const LETTER_REGIONS = new Set(["US", "CA", "MX", "PH", "PR", "CL", "CO", "VE", "GT", "CR"]);

/** The paper a reader most likely has in the tray, read from their locale. */
export function defaultPaper(locale?: string): WorkbookPaper {
  const region = (locale ?? "").split(/[-_]/)[1] ?? "";
  return LETTER_REGIONS.has(region.toUpperCase()) ? "letter" : "a4";
}

/** How many empty rows the Decision Matrix offers on paper and in the file. */
export const MATRIX_BLANK_ROWS = 8;

/**
 * Our words: how a group uses the workbook. Shared by the sheet and the file,
 * which differ in one verb: paper is circled, a file is ticked.
 */
export function workbookHowTo(mark: "circle" | "tick"): string {
  return (
    "Take one block at a time, together. Read the canvas's question and description, talk through our questions, " +
    `and write down what you say. Then ${mark} the level that fits today and give the reason in one sentence.`
  );
}

/** Our words: where the readings go once the village has its own instance. */
export const WORKBOOK_AFTER =
  "Once your village has its own instance, whoever holds the village's story records each block's level and " +
  "sentence on the Canvas view of Journey to Launch, where every reading is kept with its date.";

/** Our words, above the five levels. */
export const WORKBOOK_LEVELS_NOTE =
  "The canvas reads each block on five levels. Each block gets its own level, and nothing adds them up.";

/** Our words, above the blank Decision Matrix. */
export const WORKBOOK_MATRIX_NOTE =
  "One row for each kind of decision: who approves it, who is consulted, who is informed, and the method used.";

/** Our words, above the key moments. */
export const WORKBOOK_MOMENTS_NOTE = "Come back to the canvas at each of these moments.";

/** A block's heading, the same on paper and in the file. */
export function blockHeading(block: CanvasBlock): string {
  return `Block ${block.number}: ${block.name}`;
}

/** A foundation as one line: its name, then the canvas's description of it. */
export function foundationLine(name: string, description: string): string {
  return `${name}: ${description}`;
}

/** A level as it is circled or ticked: its numeral, its word, and the canvas's meaning. */
export function levelLine(level: CanvasLevel): string {
  return `${level} ${CANVAS_SCALE_TEXT[level].word}: ${CANVAS_SCALE_TEXT[level].meaning}`;
}

/** A file name a desktop will accept, carrying the village's name when it has one. */
export function workbookFilename(villageName: string): string {
  const slug = villageName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `governance-canvas-workbook-${slug}.md` : "governance-canvas-workbook.md";
}

/** One Markdown table row. A pipe inside a cell would split it, so it is escaped. */
function row(cells: readonly string[]): string {
  return `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
}

/** The whole workbook as Markdown, for the village of that name. */
export function workbookMarkdown(villageName: string): string {
  const credit = `Quoted from the ${CANVAS_CREDIT.text}: ${CANVAS_CREDIT.url}`;
  const out: string[] = [
    `# Governance Canvas workbook for ${villageName}`,
    "",
    credit,
    "",
    "Filled in by:",
    "",
    "On:",
    "",
    "## How to use this workbook",
    "",
    workbookHowTo("tick"),
    "",
    WORKBOOK_AFTER,
    "",
    "## The five levels",
    "",
    WORKBOOK_LEVELS_NOTE,
    "",
    ...CANVAS_LEVELS.map((level) => `- ${levelLine(level)}`),
    "",
    "## The four foundations",
    "",
    ...CANVAS_FOUNDATIONS.map((f) => `- **${CANVAS_FOUNDATION_TEXT[f].name}**: ${CANVAS_FOUNDATION_TEXT[f].description}`),
    "",
    "## The twelve blocks",
    "",
  ];

  for (const block of CANVAS_ORDER) {
    const canvas = CANVAS_BLOCK_TEXT[block.id];
    out.push(
      `### ${blockHeading(block)}`,
      "",
      `**The canvas asks:** ${canvas.question}`,
      "",
      `> ${canvas.description}`,
      "",
      "**Our questions to talk through**",
      "",
      block.question,
      "",
      ...block.prompts.map((p) => `- ${p}`),
      "",
      `Foundations: ${block.foundations.map((f) => CANVAS_FOUNDATION_TEXT[f].name).join(", ")}`,
      "",
      "**What we say**",
      "",
      "",
      "",
      "**Where it stands today** (tick one)",
      "",
      ...CANVAS_LEVELS.map((level) => `- [ ] ${levelLine(level)}`),
      "",
      "**Why, in one sentence:**",
      "",
      "",
      "---",
      "",
    );
  }

  out.push(
    "## Decision Matrix",
    "",
    WORKBOOK_MATRIX_NOTE,
    "",
    row(CANVAS_DECISION_MATRIX_COLUMNS),
    row(CANVAS_DECISION_MATRIX_COLUMNS.map(() => "---")),
    ...Array.from({ length: MATRIX_BLANK_ROWS }, () => row(CANVAS_DECISION_MATRIX_COLUMNS.map(() => " "))),
    "",
    "## Key moments",
    "",
    WORKBOOK_MOMENTS_NOTE,
    "",
    ...CANVAS_KEY_MOMENTS.map((m) => `- ${m}`),
    "",
    "---",
    "",
    credit,
    "",
  );
  return out.join("\n");
}
