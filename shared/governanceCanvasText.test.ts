/**
 * The Governance Canvas's own words, pinned (2026-09-25).
 *
 * shared/governanceCanvasText.ts quotes four named authors. A quotation that
 * drifts is a misquotation, so every string is pinned here exactly, keyed by
 * every `CanvasBlockId`, foundation and level, and the credit is pinned with
 * them. A change to any of these strings has to change this file too, which
 * is the point: nobody rewords the canvas by accident, and nobody "fixes" an
 * em dash in it to please our own style guide.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  CANVAS_BLOCK_IDS,
  CANVAS_CREDIT as REGISTRY_CREDIT,
  CANVAS_FOUNDATIONS,
  CANVAS_LEVELS,
  LEVEL_WORDS,
} from "./governanceCanvas";
import {
  CANVAS_BLOCK_TEXT,
  CANVAS_CREDIT,
  CANVAS_DECISION_MATRIX_COLUMNS,
  CANVAS_FOUNDATION_TEXT,
  CANVAS_KEY_MOMENTS,
  CANVAS_SCALE_TEXT,
  CANVAS_SOURCE_URL,
} from "./governanceCanvasText";

const BLOCKS = {
  purpose: [
    "What is our shared mission and vision?",
    "Define the ecological and social purpose that brings your organisation into being. A clear, co-created purpose anchors every governance decision and gives all stakeholders a common north star.",
  ],
  team: [
    "Who are we and what are our core values and guiding principles?",
    "Clarify who belongs to the core group, how people join or leave, and what values guide how you work together. Shared values translate abstract purpose into daily behaviour.",
  ],
  roles: [
    "How do we organize our roles and responsibilities?",
    "Map out who does what, who decides what, and who is accountable for which outcomes. Clear roles prevent duplication and gaps as the organisation matures.",
  ],
  meetings: [
    "When, where and how do we meet?",
    "Design rhythms and spaces for the group to gather, sense-make, and decide together. Intentional meeting practices keep governance alive rather than bureaucratic.",
  ],
  stakeholders: [
    "How do we map and manage our relational commons?",
    "Identify all people with a stake in your landscape. Think of stakeholder relationships as a commons to be tended with care and reciprocity — not a list to manage.",
  ],
  coordination: [
    "Where and how do we coordinate with our stakeholders?",
    "Choose tools, platforms, and practices through which information flows across your network. Simple systems that people actually use are far more valuable than elaborate ones.",
  ],
  power: [
    "How do we make fair and inclusive decisions?",
    "Agree on which decisions require which level of consent and ensure all voices participate meaningfully. Document your decision-making protocols so they are transparent and open to challenge.",
  ],
  conflict: [
    "How do we resolve conflicts in a fair and fast way?",
    "Establish clear, agreed pathways for surfacing and resolving tensions before they fracture relationships. Name your conflict resolution process before conflict arises.",
  ],
  learning: [
    "How do we learn and evolve together, provide feedback and keep each other accountable?",
    "Build in regular cycles of reflection, peer feedback, and adaptation. Accountability here is understood as mutual care rather than hierarchical control.",
  ],
  resourcing: [
    "How are resources, risks and rewards equitably and transparently allocated?",
    "Clarify how money, land, labour, and risk are distributed, by whom, and on what basis. Resourcing decisions are also power decisions — make them visible and participatory.",
  ],
  legal: [
    "What legal structure safeguards and enables our purpose?",
    "If you have a legal structure, it dictates some governance principles. If not, choose the legal form — foundation, cooperative, community interest company — that best protects your purpose over time.",
  ],
  impact: [
    "How do we holistically monitor our impact & performance?",
    "Define what success looks like across ecological, social, and financial dimensions. Go beyond compliance metrics: measure what your bioregion actually needs to thrive.",
  ],
} as const;

describe("the twelve blocks, in the canvas's own words", () => {
  it("carry a question and a description for every CanvasBlockId and for nothing else", () => {
    expect(Object.keys(CANVAS_BLOCK_TEXT)).toEqual([...CANVAS_BLOCK_IDS]);
    expect(CANVAS_BLOCK_IDS).toHaveLength(12);
    for (const id of CANVAS_BLOCK_IDS) {
      expect(Object.keys(CANVAS_BLOCK_TEXT[id]).sort(), id).toEqual(["description", "question"]);
    }
  });

  it("quote each block exactly", () => {
    expect(Object.keys(BLOCKS)).toEqual([...CANVAS_BLOCK_IDS]);
    for (const id of CANVAS_BLOCK_IDS) {
      expect(CANVAS_BLOCK_TEXT[id].question, id).toBe(BLOCKS[id][0]);
      expect(CANVAS_BLOCK_TEXT[id].description, id).toBe(BLOCKS[id][1]);
    }
  });

  it("keep the canvas's em dashes, which our style guide would otherwise strip", () => {
    expect(CANVAS_BLOCK_TEXT.stakeholders.description).toContain("reciprocity — not a list");
    expect(CANVAS_BLOCK_TEXT.legal.description.match(/—/g)).toHaveLength(2);
  });
});

describe("the four foundations", () => {
  it("are named and described for every foundation, exactly", () => {
    expect(Object.keys(CANVAS_FOUNDATION_TEXT)).toEqual([...CANVAS_FOUNDATIONS]);
    expect(CANVAS_FOUNDATION_TEXT).toEqual({
      "legal-framework": {
        name: "Legal Framework",
        description:
          "sets the outer boundaries — the statutory duties, corporate structure, and accountability obligations that any organisation must honour",
      },
      "internal-rules": {
        name: "Internal Rules & Regulations",
        description:
          "translate legal obligations into operational policies: bylaws, decision-making protocols, and codes of conduct that guide day-to-day choices",
      },
      culture: {
        name: "Organisational Culture",
        description:
          "the living layer — the shared values, norms, and stories that determine how people actually behave when no one is watching",
      },
      "personal-leadership": {
        name: "Personal Leadership",
        // The deck's sentence whole. This pin used to hold a copy with
        // "board member, staff, or community partner" cut from the middle,
        // which matched neither published source.
        description:
          "the human heartbeat of governance. Every stakeholder — board member, staff, or community partner — brings their own integrity, awareness, and commitment to the whole",
      },
    });
  });

  it("drops no words from the middle: each description is the end of the deck's sentence, whole", () => {
    // The deck's four foundation sentences as its text export prints them,
    // read on 2026-09-27. A description may begin inside the sentence (after
    // "X is" or "The X") and leaves off the closing stop; everything from
    // where it begins to the stop must be there, in order.
    const deck: Record<keyof typeof CANVAS_FOUNDATION_TEXT, string> = {
      "legal-framework":
        "The Legal Framework sets the outer boundaries — the statutory duties, corporate structure, and accountability obligations that any organisation must honour.",
      "internal-rules":
        "Internal Rules & Regulations translate legal obligations into operational policies: bylaws, decision-making protocols, and codes of conduct that guide day-to-day choices.",
      culture:
        "Organisational Culture is the living layer — the shared values, norms, and stories that determine how people actually behave when no one is watching.",
      "personal-leadership":
        "Personal Leadership is the human heartbeat of governance. Every stakeholder — board member, staff, or community partner — brings their own integrity, awareness, and commitment to the whole.",
    };
    for (const f of CANVAS_FOUNDATIONS) {
      expect(deck[f].endsWith(` ${CANVAS_FOUNDATION_TEXT[f].description}.`), f).toBe(true);
    }
    // The phrase the misquote dropped, held on its own so a later trim of it is caught by name.
    expect(CANVAS_FOUNDATION_TEXT["personal-leadership"].description).toContain(
      "Every stakeholder — board member, staff, or community partner — brings their own integrity"
    );
  });
});

describe("the scale, the key moments and the Decision Matrix", () => {
  it("reads the five levels in the canvas's words, and the words agree with the registry's", () => {
    expect(CANVAS_SCALE_TEXT).toEqual({
      1: { word: "Absent", meaning: "Not yet addressed" },
      2: { word: "Forming", meaning: "Unclear or fragile" },
      3: { word: "Emerging", meaning: "Taking shape" },
      4: { word: "Growing", meaning: "Mostly in place" },
      5: { word: "Thriving", meaning: "Working well & alive" },
    });
    for (const level of CANVAS_LEVELS) expect(CANVAS_SCALE_TEXT[level].word, String(level)).toBe(LEVEL_WORDS[level]);
  });

  it("names the four key moments", () => {
    expect([...CANVAS_KEY_MOMENTS]).toEqual([
      "Starting a collaboration",
      "Onboarding new partners",
      "Navigating conflict",
      "Preparing for funding or formalisation",
    ]);
  });

  it("gives the Decision Matrix its five columns, in order", () => {
    expect([...CANVAS_DECISION_MATRIX_COLUMNS]).toEqual(["Subject / Decision", "Approval", "Consultation", "Information", "Method"]);
  });
});

describe("the credit", () => {
  it("names the collective, Commonland and the four authors, and links where the canvas was published", () => {
    expect(CANVAS_CREDIT.text).toBe(
      "Governance Canvas by the Bioregional Weaving Labs Collective and Commonland (Tijn Tjoelker, Ernestien Idenburg, Noa Lodeizen, Zlatina Tsvetkova)",
    );
    expect(CANVAS_SOURCE_URL).toBe("https://tijntjoelker.substack.com/p/governance-canvas");
    expect(CANVAS_CREDIT.url).toBe(CANVAS_SOURCE_URL);
  });

  it("is the one credit the registry hands out too", () => {
    expect(REGISTRY_CREDIT).toBe(CANVAS_CREDIT);
  });
});

/**
 * The repository is MIT, and this text is not ours to license. The carve-out
 * lives in two places a reader might start from: the quoting file's own header
 * and THIRD_PARTY_NOTICES.md at the root. These read both and hold them to the
 * credit, so neither can be dropped, or drift from the credit the surfaces
 * show, without this file going red.
 */
describe("the licence notice", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8").replace(/\r/g, "");
  const oneLine = (s: string) => s.replace(/\s*\n\s*(\*\s*)?/g, " ");

  it("says in the quoting file's header that the text is not under the MIT licence, and points at the notice", () => {
    const src = read("shared/governanceCanvasText.ts");
    const header = oneLine(src.slice(0, src.indexOf("*/")));
    expect(header).toContain("LICENCE: THE TEXT IN THIS FILE IS NOT MIT");
    expect(header).toContain("It does NOT cover this text, which is not ours to license");
    expect(header).toContain("THIRD_PARTY_NOTICES.md at the repository root points here");
  });

  it("is carried at the root by THIRD_PARTY_NOTICES.md, with the file, the exact credit and the source", () => {
    const notice = oneLine(read("THIRD_PARTY_NOTICES.md"));
    expect(notice).toContain("The MIT licence in `LICENSE` covers this platform's own code and words. It does not cover the text listed here.");
    expect(notice).toContain("`shared/governanceCanvasText.ts`");
    expect(notice).toContain(CANVAS_CREDIT.text);
    expect(notice).toContain(CANVAS_SOURCE_URL);
  });
});
