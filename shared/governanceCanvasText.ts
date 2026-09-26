/**
 * THE GOVERNANCE CANVAS IN ITS OWN WORDS (2026-09-25).
 *
 * Everything in this file is quoted. The questions, the descriptions, the
 * four foundations, the five-level scale, the four key moments and the
 * Decision Matrix columns are the canvas's text, taken from the canvas deck,
 * and they are credited on every surface that shows them:
 *
 *   Governance Canvas by the Bioregional Weaving Labs Collective and
 *   Commonland (Tijn Tjoelker, Ernestien Idenburg, Noa Lodeizen, Zlatina
 *   Tsvetkova), https://tijntjoelker.substack.com/p/governance-canvas
 *
 * Rye ruled that the Governance Canvas pieces, its own wording and the credit
 * among them, are built AND switched on. So this text renders today, on the
 * Canvas view of Journey to Launch and in the printable workbook at
 * /canvas/workbook, always beside `CANVAS_CREDIT`.
 *
 * ── WHY IT IS ITS OWN FILE ─────────────────────────────────────────────────
 *
 * shared/governanceCanvas.ts is the registry: the twelve block ids, the
 * levels, the brief mapping, and prompts written in this platform's own
 * words. Those prompts stay ours and are shown AS ours, under "Our questions
 * to talk through". Keeping the canvas's words apart means one file holds
 * somebody else's text, one header says whose it is, and anyone asked "what
 * of theirs do we ship?" can answer by reading one file.
 *
 * ── VERBATIM, AND THE HOUSE VOICE DOES NOT APPLY ───────────────────────────
 *
 * scripts/check-voice.mjs holds OUR copy to the house writing rules (no em
 * dashes, no "rather than"). This is not our copy. Rewording a quotation to
 * pass our style guide would misquote four named authors, so each line the
 * guard would flag carries a `voice-ok:` waiver saying it is quoted, and
 * shared/governanceCanvasText.test.ts pins every string exactly. The scale's
 * words and meanings are stored apart (the deck sets them as
 * "5 Thriving – Working well & alive"), so the dash there is layout and the
 * surfaces choose their own separator.
 *
 * Every map is keyed by the union it describes, so a block, foundation or
 * level added to the registry and forgotten here is a compile error and never
 * a blank line on a card.
 */
import type { CanvasBlockId, CanvasFoundation, CanvasLevel } from "./governanceCanvas";

/** Where the canvas was published. The credit links here. */
export const CANVAS_SOURCE_URL = "https://tijntjoelker.substack.com/p/governance-canvas";

/**
 * THE CREDIT, shown wherever the canvas's words or its blocks render. The four
 * names are the authors the canvas itself names. shared/governanceCanvas.ts
 * re-exports this under the same name, so the registry's importers never had
 * to move.
 */
export const CANVAS_CREDIT = {
  text:
    "Governance Canvas by the Bioregional Weaving Labs Collective and Commonland " +
    "(Tijn Tjoelker, Ernestien Idenburg, Noa Lodeizen, Zlatina Tsvetkova)",
  url: CANVAS_SOURCE_URL,
} as const;

export interface CanvasBlockText {
  /** The canvas's question for the block. */
  question: string;
  /** The canvas's description of what the block asks a group to settle. */
  description: string;
}

/** The canvas's own question and description for each of the twelve blocks. */
export const CANVAS_BLOCK_TEXT: Record<CanvasBlockId, CanvasBlockText> = {
  purpose: {
    question: "What is our shared mission and vision?",
    description:
      "Define the ecological and social purpose that brings your organisation into being. A clear, co-created purpose anchors every governance decision and gives all stakeholders a common north star.",
  },
  team: {
    question: "Who are we and what are our core values and guiding principles?",
    description:
      "Clarify who belongs to the core group, how people join or leave, and what values guide how you work together. Shared values translate abstract purpose into daily behaviour.",
  },
  roles: {
    question: "How do we organize our roles and responsibilities?",
    description:
      "Map out who does what, who decides what, and who is accountable for which outcomes. Clear roles prevent duplication and gaps as the organisation matures.",
  },
  meetings: {
    question: "When, where and how do we meet?",
    description:
      "Design rhythms and spaces for the group to gather, sense-make, and decide together. Intentional meeting practices keep governance alive rather than bureaucratic.", // voice-ok: quoted from the Governance Canvas, verbatim
  },
  stakeholders: {
    question: "How do we map and manage our relational commons?",
    description:
      "Identify all people with a stake in your landscape. Think of stakeholder relationships as a commons to be tended with care and reciprocity — not a list to manage.", // voice-ok: quoted from the Governance Canvas, verbatim
  },
  coordination: {
    question: "Where and how do we coordinate with our stakeholders?",
    description:
      "Choose tools, platforms, and practices through which information flows across your network. Simple systems that people actually use are far more valuable than elaborate ones.",
  },
  power: {
    question: "How do we make fair and inclusive decisions?",
    description:
      "Agree on which decisions require which level of consent and ensure all voices participate meaningfully. Document your decision-making protocols so they are transparent and open to challenge.",
  },
  conflict: {
    question: "How do we resolve conflicts in a fair and fast way?",
    description:
      "Establish clear, agreed pathways for surfacing and resolving tensions before they fracture relationships. Name your conflict resolution process before conflict arises.",
  },
  learning: {
    question: "How do we learn and evolve together, provide feedback and keep each other accountable?",
    description:
      "Build in regular cycles of reflection, peer feedback, and adaptation. Accountability here is understood as mutual care rather than hierarchical control.", // voice-ok: quoted from the Governance Canvas, verbatim
  },
  resourcing: {
    question: "How are resources, risks and rewards equitably and transparently allocated?",
    description:
      "Clarify how money, land, labour, and risk are distributed, by whom, and on what basis. Resourcing decisions are also power decisions — make them visible and participatory.", // voice-ok: quoted from the Governance Canvas, verbatim
  },
  legal: {
    question: "What legal structure safeguards and enables our purpose?",
    description:
      "If you have a legal structure, it dictates some governance principles. If not, choose the legal form — foundation, cooperative, community interest company — that best protects your purpose over time.", // voice-ok: quoted from the Governance Canvas, verbatim
  },
  impact: {
    question: "How do we holistically monitor our impact & performance?",
    description:
      "Define what success looks like across ecological, social, and financial dimensions. Go beyond compliance metrics: measure what your bioregion actually needs to thrive.",
  },
};

export interface CanvasFoundationText {
  /** The foundation's name as the canvas sets it. */
  name: string;
  /**
   * The canvas's description, as the phrase that follows the name. It starts
   * in lower case and carries no closing stop because it continues the name:
   * "Legal Framework sets the outer boundaries ...".
   */
  description: string;
}

/** The four foundations the canvas rests on, in the canvas's words. */
export const CANVAS_FOUNDATION_TEXT: Record<CanvasFoundation, CanvasFoundationText> = {
  "legal-framework": {
    name: "Legal Framework",
    description:
      "sets the outer boundaries — the statutory duties, corporate structure, and accountability obligations that any organisation must honour", // voice-ok: quoted from the Governance Canvas, verbatim
  },
  "internal-rules": {
    name: "Internal Rules & Regulations",
    description:
      "translate legal obligations into operational policies: bylaws, decision-making protocols, and codes of conduct that guide day-to-day choices",
  },
  culture: {
    name: "Organisational Culture",
    description:
      "the living layer — the shared values, norms, and stories that determine how people actually behave when no one is watching", // voice-ok: quoted from the Governance Canvas, verbatim
  },
  "personal-leadership": {
    name: "Personal Leadership",
    description:
      "the human heartbeat of governance. Every stakeholder brings their own integrity, awareness, and commitment to the whole",
  },
};

/**
 * The canvas's five-level scale. The words are the same five the registry's
 * `LEVEL_WORDS` uses, and a test holds the two together; the meanings are the
 * canvas's own. Each level stands alone: nothing on any surface adds them up.
 */
export const CANVAS_SCALE_TEXT: Record<CanvasLevel, { word: string; meaning: string }> = {
  1: { word: "Absent", meaning: "Not yet addressed" },
  2: { word: "Forming", meaning: "Unclear or fragile" },
  3: { word: "Emerging", meaning: "Taking shape" },
  4: { word: "Growing", meaning: "Mostly in place" },
  5: { word: "Thriving", meaning: "Working well & alive" },
};

/** The four moments the canvas says to come back to it. */
export const CANVAS_KEY_MOMENTS = [
  "Starting a collaboration",
  "Onboarding new partners",
  "Navigating conflict",
  "Preparing for funding or formalisation",
] as const;

/** The Decision Matrix's columns, in the canvas's order. */
export const CANVAS_DECISION_MATRIX_COLUMNS = [
  "Subject / Decision",
  "Approval",
  "Consultation",
  "Information",
  "Method",
] as const;
