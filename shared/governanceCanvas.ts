/**
 * THE GOVERNANCE CANVAS, as data the compiler holds to (2026-09-24).
 *
 * Twelve blocks a village reads itself against, one level each from Absent to
 * Thriving and one sentence saying why. Season Two projects take their first
 * reading of all twelve on Saturday 3 October, and Rye ruled the same day that
 * every block must be on record before a village's Birthing. That gate row is
 * a later lane; this file is what it will read.
 *
 * ── THE CANVAS IS SOMEBODY ELSE'S WORK, AND THIS FILE SAYS SO ──────────────
 *
 * The block structure comes from the Governance Canvas by the Bioregional
 * Weaving Labs Collective and Commonland. `CANVAS_CREDIT` below is shown on
 * every surface that renders a block. The licence for the canvas's own text
 * is NOT yet confirmed, so every question and prompt here is written in this
 * platform's own words. None of it is copied from the canvas, and none of it
 * should be replaced with canvas wording until the licence says it may.
 *
 * ── WHY A RADAR IS ALLOWED HERE AND NOWHERE ELSE ───────────────────────────
 *
 * R55 is the no-scorecard rule: the handover is a journey to celebrate and
 * never a score to fail. Rye made one explicit exception on 2026-09-24: a
 * canvas-style 1 to 5 radar, for the canvas baseline only. So a block has a
 * level, the radar plots the twelve levels, and NOTHING combines them. There
 * is no function in this file that adds, averages or counts levels, and the
 * copy test in client/src/lib/canvasCopy.test.ts holds the components to the
 * same line.
 *
 * ── SHAPE ──────────────────────────────────────────────────────────────────
 *
 * Built like shared/launchRequirements.ts: isomorphic, no mysql2, so the
 * client imports it for copy and the server imports it for validation, and
 * the two cannot disagree about which blocks exist. Everything is keyed by
 * the `CanvasBlockId` union, so a block added to the id list and forgotten in
 * the record is a compile error and never an empty card.
 */
import type { BriefSectionId } from "./villageBrief";

/** The twelve blocks, in canvas order. The order IS the canvas numbering. */
export const CANVAS_BLOCK_IDS = [
  "purpose",
  "team",
  "roles",
  "meetings",
  "stakeholders",
  "coordination",
  "power",
  "conflict",
  "learning",
  "resourcing",
  "legal",
  "impact",
] as const;
export type CanvasBlockId = (typeof CANVAS_BLOCK_IDS)[number];

/** The four foundations the canvas rests on. A block sits on one or more. */
export const CANVAS_FOUNDATIONS = ["legal-framework", "internal-rules", "culture", "personal-leadership"] as const;
export type CanvasFoundation = (typeof CANVAS_FOUNDATIONS)[number];

export const FOUNDATION_LABELS: Record<CanvasFoundation, string> = {
  "legal-framework": "Legal framework",
  "internal-rules": "Internal rules",
  culture: "Culture",
  "personal-leadership": "Personal leadership",
};

export interface CanvasBlock {
  id: CanvasBlockId;
  /** Position on the canvas, 1 to 12. Derived from CANVAS_BLOCK_IDS, never typed twice. */
  number: number;
  name: string;
  /** One short question, in our own words. */
  question: string;
  /** Three to five prompts a group can talk through, in our own words. */
  prompts: readonly string[];
  foundations: readonly CanvasFoundation[];
  /**
   * The village brief sections this block draws on. Typed by `BriefSectionId`,
   * so a section renamed in shared/villageBrief.ts breaks the build here.
   */
  briefSections: readonly BriefSectionId[];
  /**
   * Where to look when no brief section holds this block yet. Present only on
   * a block whose `briefSections` is empty, and a test holds it to that.
   */
  elsewhere?: { note: string; href: string; label: string };
  /** Season Two weeks (1 to 13) in which this block comes up by default. */
  seasonWeeks: readonly number[];
}

type BlockEntry = Omit<CanvasBlock, "id" | "number">;

const ENTRIES: Record<CanvasBlockId, BlockEntry> = {
  purpose: {
    name: "Purpose",
    question: "What is this project here to do, and does everyone carry the same answer?",
    prompts: [
      "Could three people here each say why the project exists, and would their answers match?",
      "Where is the purpose written down, and when did anyone last read it aloud?",
      "Which decisions this season were checked against it?",
      "What would make you rewrite it?",
    ],
    foundations: ["culture", "legal-framework"],
    briefSections: ["aims", "vision", "constraints"],
    seasonWeeks: [1, 2],
  },
  team: {
    name: "Team",
    question: "Who is in, how did they get in, and how do they step away?",
    prompts: [
      "Who counts as part of the core group today, and who is on its edge?",
      "How does someone new join, and how does someone leave well?",
      "What does each person bring, and what do they need from the group?",
      "How do you look after the people doing the work?",
    ],
    foundations: ["culture", "personal-leadership"],
    briefSections: ["membership", "people"],
    seasonWeeks: [3, 6, 11],
  },
  roles: {
    name: "Roles",
    question: "Is it clear who holds which piece of work?",
    prompts: [
      "Could a newcomer find out who looks after what without asking around?",
      "Which roles are written down, and which live in one person's head?",
      "What happens when a role holder is away or wants to hand it on?",
      "Is there work that nobody holds?",
    ],
    foundations: ["internal-rules"],
    briefSections: ["work"],
    seasonWeeks: [3],
  },
  meetings: {
    name: "Meetings",
    question: "Do your gatherings help the group decide and move?",
    prompts: [
      "What regular meetings exist, and what is each one for?",
      "Does everyone who should be heard get a turn?",
      "Where are a meeting's decisions written down, and can people find them later?",
      "Which meeting would nobody miss if it stopped?",
    ],
    foundations: ["internal-rules", "culture"],
    briefSections: ["rhythm"],
    seasonWeeks: [3],
  },
  stakeholders: {
    name: "Stakeholders",
    question: "Who does this project touch beyond the people running it, and how do they have a say?",
    prompts: [
      "Who lives near, works with, funds or depends on this place?",
      "Which of them hear about a decision before it lands, and which hear after?",
      "Is there a way for an outside voice to reach the group?",
      "Who is missing from that list?",
    ],
    foundations: ["culture", "internal-rules"],
    briefSections: ["stakeholders"],
    seasonWeeks: [7, 13],
  },
  coordination: {
    name: "Coordination",
    question: "How does information move, and how does work pass between people?",
    prompts: [
      "Where do people look to find out what is happening this week?",
      "Which tools do you rely on, and does everyone use the same ones?",
      "How do two groups working on linked things stay in step?",
      "What fell through a gap recently, and why?",
    ],
    foundations: ["internal-rules"],
    briefSections: ["tools"],
    seasonWeeks: [5, 7, 12],
  },
  power: {
    name: "Power",
    question: "Who decides what, and does the way it works match the way it is written?",
    prompts: [
      "Which decisions are made by one person, by a small group, or by everyone?",
      "Is there power here that nobody named, such as money, land title or long service?",
      "How can someone question a decision they disagree with?",
      "What would it take to move a decision somewhere else?",
    ],
    foundations: ["internal-rules", "legal-framework", "personal-leadership"],
    briefSections: ["decisions"],
    seasonWeeks: [4],
  },
  conflict: {
    name: "Conflict",
    question: "When tension shows up, is there a known way to work through it?",
    prompts: [
      "What does someone do first when they are upset with another member?",
      "Who can help, and does everyone know who that is?",
      "How is an agreement repaired after it breaks?",
      "Is there a tension today that nobody is talking about?",
    ],
    foundations: ["culture", "personal-leadership", "internal-rules"],
    // The conflict agreement is its own document and a later lane builds it.
    // Until then the nearest thing on record is the exit policy's restorative
    // path, which is where a reader is sent.
    briefSections: [],
    elsewhere: {
      note: "No brief section holds this yet. The restorative steps in the exit policy are the nearest record until the conflict agreement is written.",
      href: "/exit-policy",
      label: "Read the restorative steps",
    },
    seasonWeeks: [4, 6, 11],
  },
  learning: {
    name: "Learning",
    question: "How does the group notice what is working, and change course when it is not?",
    prompts: [
      "When did you last look back together, and what changed afterwards?",
      "How does a lesson one person learned reach everyone else?",
      "Who outside the group do you learn from?",
      "What would you try differently next season?",
    ],
    foundations: ["culture", "personal-leadership"],
    briefSections: ["learning"],
    seasonWeeks: [6, 12],
  },
  resourcing: {
    name: "Resourcing",
    question: "Where do money, time and materials come from, and who decides how they are spent?",
    prompts: [
      "What keeps this project going from month to month?",
      "Who can spend, and up to what amount, without asking anyone?",
      "Is unpaid work seen and valued, or does it disappear?",
      "How much rests on one source, and what happens if it stops?",
    ],
    foundations: ["internal-rules", "legal-framework"],
    briefSections: ["economy"],
    seasonWeeks: [5, 8, 9, 13],
  },
  legal: {
    name: "Legal",
    question: "Does the project's legal shape match how it actually runs?",
    prompts: [
      "What exists on paper, and who holds the land title?",
      "Do the written statutes say what your everyday agreements say?",
      "Who carries legal liability, and do they know it?",
      "What would you change first if you could draw it again?",
    ],
    foundations: ["legal-framework"],
    briefSections: ["legal", "land"],
    seasonWeeks: [10, 11],
  },
  impact: {
    name: "Impact",
    question: "What difference is this project making for people and for the land, and how would you know?",
    prompts: [
      "What has changed on the land and among the people since you started?",
      "Which changes do you track, and which do you only feel?",
      "Who outside the group would say the project has made a difference?",
      "What would tell you it was time to change direction?",
    ],
    foundations: ["culture", "internal-rules"],
    briefSections: ["impact"],
    seasonWeeks: [9, 12],
  },
};

/** Every block, keyed by id. Built from ENTRIES so `number` cannot drift from the order. */
export const CANVAS_BLOCKS: Record<CanvasBlockId, CanvasBlock> = Object.fromEntries(
  CANVAS_BLOCK_IDS.map((id, i) => [id, { id, number: i + 1, ...ENTRIES[id] }]),
) as Record<CanvasBlockId, CanvasBlock>;

/** The twelve blocks as a list, in canvas order. Render from this. */
export const CANVAS_ORDER: readonly CanvasBlock[] = CANVAS_BLOCK_IDS.map((id) => CANVAS_BLOCKS[id]);

/** A reading's level. Integer, one to five, and nothing else is a level. */
export const CANVAS_LEVELS = [1, 2, 3, 4, 5] as const;
export type CanvasLevel = (typeof CANVAS_LEVELS)[number];

export const LEVEL_WORDS: Record<CanvasLevel, string> = {
  1: "Absent",
  2: "Forming",
  3: "Emerging",
  4: "Growing",
  5: "Thriving",
};

/** What each word means, for the person choosing it. Our words. */
export const LEVEL_MEANINGS: Record<CanvasLevel, string> = {
  1: "Nothing is in place yet.",
  2: "People have started talking about it.",
  3: "Some practice exists, and it is patchy.",
  4: "It works most of the time and people rely on it.",
  5: "It is part of how the village lives, and it keeps getting better.",
};

/** The occasion a reading was taken on. The first reading of every block is the baseline. */
export const CANVAS_MOMENTS = ["baseline", "canvas-moon", "onboarding", "conflict", "funding", "season"] as const;
export type CanvasMoment = (typeof CANVAS_MOMENTS)[number];

export const MOMENT_LABELS: Record<CanvasMoment, string> = {
  baseline: "Baseline",
  "canvas-moon": "Canvas moon",
  onboarding: "Onboarding",
  conflict: "After a conflict",
  funding: "Funding",
  season: "Season review",
};

/** The one-sentence reason a reading carries. */
export const CANVAS_SENTENCE_MAX = 500;

/**
 * THE CREDIT, shown wherever a block is rendered. The four names are the
 * authors the canvas itself names; the link is where it was published.
 */
export const CANVAS_CREDIT = {
  text:
    "Governance Canvas by the Bioregional Weaving Labs Collective and Commonland " +
    "(Tijn Tjoelker, Ernestien Idenburg, Noa Lodeizen, Zlatina Tsvetkova)",
  url: "https://tijntjoelker.substack.com/p/governance-canvas",
} as const;

export function isCanvasBlockId(value: unknown): value is CanvasBlockId {
  return typeof value === "string" && (CANVAS_BLOCK_IDS as readonly string[]).includes(value);
}

/** An integer from one to five, as a number. The string "3" is not a level. */
export function isCanvasLevel(value: unknown): value is CanvasLevel {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function isCanvasMoment(value: unknown): value is CanvasMoment {
  return typeof value === "string" && (CANVAS_MOMENTS as readonly string[]).includes(value);
}

export interface CanvasReadingInput {
  blockId: CanvasBlockId;
  level: CanvasLevel;
  sentence: string;
  moment: CanvasMoment;
}

/**
 * THE ONE VALIDATOR, for the route and for the form.
 *
 * Returns the reading ready to store, or the sentence that refuses it. The
 * route answers 400 with that sentence and the form shows the same words
 * before anything is sent, so a person never meets two different refusals
 * for one mistake. `moment` defaults to the baseline when it is left out.
 */
export function parseCanvasReading(body: unknown): { ok: true; reading: CanvasReadingInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isCanvasBlockId(b.blockId)) {
    return { ok: false, error: "That is not one of the twelve canvas blocks." };
  }
  if (!isCanvasLevel(b.level)) {
    return { ok: false, error: "A reading takes a level from 1 (Absent) to 5 (Thriving), as a whole number." };
  }
  const sentence = typeof b.sentence === "string" ? b.sentence.trim() : "";
  if (!sentence) {
    return { ok: false, error: "Say in one sentence why the block reads at this level." };
  }
  if (sentence.length > CANVAS_SENTENCE_MAX) {
    return { ok: false, error: `Keep the sentence to ${CANVAS_SENTENCE_MAX} characters.` };
  }
  const moment = b.moment === undefined || b.moment === null || b.moment === "" ? "baseline" : b.moment;
  if (!isCanvasMoment(moment)) {
    return { ok: false, error: "That is not a moment a canvas reading can be taken on." };
  }
  return { ok: true, reading: { blockId: b.blockId, level: b.level, sentence, moment } };
}
