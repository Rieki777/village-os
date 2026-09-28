/**
 * WHICH CANVAS BLOCK A RESOURCE BELONGS UNDER (plan 5.2, 2026-09-28).
 *
 * The Governance Canvas Database has no building-block column, so the blocks
 * come from three layers, and the first one present wins:
 *
 *   1. THE VILLAGE'S OWN PLACING. The canvas pen (whoever holds `story.tell`)
 *      may say where a resource shows in this village, including nowhere. It
 *      is stored on the row (`tags_local`, server/repos/canvasResources.ts)
 *      and no other village sees it.
 *   2. THE PLATFORM'S MAP, `CONFIRMED_BLOCK_TAGS` below: every row the
 *      database held on 2026-09-28, placed by hand, keyed by the name's slug
 *      (`nameSlug`, shared/canvasResources.ts). Written by this platform and
 *      NOT YET REVIEWED WITH the Bioregional Weaving Labs Collective; the plan
 *      offers it to them as the block column their sheet lacks (plan 5.3).
 *   3. A SUGGESTION from the row's own keywords (`suggestBlocks`), which says
 *      which keyword matched, so a member can see why it is there. This is
 *      what a row added upstream after 2026-09-28 shows until somebody maps
 *      it. A row with no keywords is under no block until then.
 *
 * shared/canvasResourceTags.test.ts holds the map to the shipped snapshot
 * (server/seeds/canvas-resources.json): every row is mapped, and no key names
 * a row that is not there.
 *
 * ── NEVER NVC ON A SAFETY SURFACE ──────────────────────────────────────────
 *
 * Nonviolent Communication asks the people in a conflict to meet, hear each
 * other's needs and make requests. That is right for a disagreement and wrong
 * for somebody who may not be safe, where meeting the other person is the
 * danger (design_conflict-evolution.md: the safety door routes to the
 * agreement's safety contacts, never to mediation). So `safetyExcluded` names
 * the NVC rows, and GET /api/canvas/resources leaves them out of any
 * `surface=safety` answer whatever block is asked for. The Learn frame of the
 * Conflict block is not a safety surface and shows them.
 */
import { CANVAS_BLOCK_IDS, type CanvasBlockId } from "./governanceCanvas";
import type { ResourcePlacing } from "./canvasResources";

/**
 * Keywords that suggest a block, matched WHOLE against a row's keywords in
 * lower case, never as a substring: "power" must not match "empowerment".
 * Built from the vocabulary the database actually uses (2026-09-28).
 */
export const KEYWORD_BLOCKS: Record<CanvasBlockId, readonly string[]> = {
  purpose: ["purpose", "shared purpose", "shared vision", "strategic planning", "backcasting", "strategy", "sustainability principles"],
  team: ["team", "team agreements", "team health", "weaving team", "membership", "values", "community building", "kick-off", "alignment", "mobilisation"],
  roles: ["roles", "responsibilities", "domain", "authority", "self-management", "organisational design"],
  meetings: ["meetings", "facilitation", "hosting", "rituals"],
  stakeholders: ["stakeholders", "multi-stakeholder", "multi-stakeholder platforms", "representation", "rights of nature", "participation", "inclusion", "inclusive", "community", "advocacy", "guardianship"],
  coordination: ["coordination", "communication", "collaboration", "co-creation", "tools", "templates", "network", "multi-scale governance", "multi-level governance", "subsidiarity", "process design", "weaving", "mapping"],
  power: ["decision making", "consent", "consensus", "voting", "advice process", "objections", "power", "distributed power", "power and influence", "sociocracy", "circles", "self-governance"],
  conflict: ["conflict navigation", "conflict", "nvc", "empathy", "reconciliation"],
  learning: ["learning", "feedback", "performance review", "learning journey", "training", "capacity building", "self-assessment", "assessment", "adaptive governance", "governance experiments", "reading list", "gap analysis", "maturity", "readiness", "accountability"],
  resourcing: ["resourcing", "blended finance", "catalytic capital", "landscape finance", "funding models", "investment readiness", "bioregional finance", "financial governance", "capital allocation", "risk sharing", "bff", "shared resources"],
  legal: ["legal structure", "entity design", "contracts", "agreements", "ownership", "stewardship", "land rights", "board"],
  impact: ["impact", "monitoring", "4 returns", "what works", "biodiversity", "restoration principles", "holistic landscape restoration"],
};

/** One suggested block, with the keyword that suggested it. */
export interface SuggestedBlock {
  block: CanvasBlockId;
  keyword: string;
}

/**
 * The blocks a row's keywords suggest, in canvas order, each with the first
 * keyword (in the row's own order and spelling) that matched it.
 */
export function suggestBlocks(keywords: readonly string[]): SuggestedBlock[] {
  const out: SuggestedBlock[] = [];
  for (const block of CANVAS_BLOCK_IDS) {
    const terms = new Set(KEYWORD_BLOCKS[block]);
    const hit = keywords.find((k) => terms.has(k.trim().toLowerCase()));
    if (hit) out.push({ block, keyword: hit.trim() });
  }
  return out;
}

const ALL_BLOCKS: readonly CanvasBlockId[] = CANVAS_BLOCK_IDS;

/**
 * The platform's hand-made map, one entry per row of the database as it stood
 * on 2026-09-28 (58 rows), keyed by `nameSlug` of the row's name. The comment
 * on each line is the name as the database writes it.
 */
export const CONFIRMED_BLOCK_TAGS: Readonly<Record<string, readonly CanvasBlockId[]>> = {
  "4-returns-finance-assessment-4rfa": ["resourcing"], // 4 Returns Finance Assessment (4RFA)
  "abcd-process-backcasting-from-sustainability-principles": ["purpose"], // ABCD Process, Backcasting from sustainability principles
  "beyond-the-rules": ["power"], // Beyond The Rules
  "blended-finance-and-catalytic-capital-in-bioregional-financing-facilities": ["resourcing"],
  "capital-allocation-governance-in-bioregional-financing-facilities": ["power", "resourcing"],
  "circular-cross-scalar-governance-spiral": ["coordination"],
  "company-culture-iceberg": ["team"],
  "consent-decision-making": ["power"],
  "decision-making-methods-a-comparison": ["power"],
  "governance-for-complexity": ["power", "learning"],
  "governance-model-voor-living-delta-bff": ["resourcing", "legal"],
  "how-you-can-use-the-nvc-process": ["conflict"],
  "key-facts-about-nonviolent-communication-nvc": ["conflict"],
  "many-to-many-agreement-example": ["legal"],
  "ostrom-didn-t-say-that": ["power", "resourcing"], // Ostrom Didn't Say That (a curly apostrophe upstream)
  "peer-feedback-process": ["learning"],
  "sociocracy-basic-concepts-and-principles": ["roles", "power"], // Sociocracy, basic concepts and principles (an en dash upstream)
  "sociocracy-and-nonviolent-communication-nvc": ["meetings", "conflict"],
  "whitepaper-cocratie": ["power"],
  "beginning-anew": ["conflict"],
  "bioregional-financing-facilities": ["resourcing", "legal"],
  "sociocracy-books": ["power"],
  "commons-canvas": ["stakeholders", "resourcing"],
  "community-canvas-guidebook": ["purpose", "team"],
  // The canvas itself speaks to every block.
  "governance-canvas": ALL_BLOCKS,
  "operating-system-os-canvas": ["roles", "meetings"],
  "power-mapping-template": ["stakeholders", "power"],
  "sociocracy-team-canvas": ["team", "roles"],
  "team-canvas": ["purpose", "team"],
  "regenerative-community-design-canvas": ["purpose", "stakeholders"],
  "bioregional-governance-training-guide": ["learning"],
  "bwl-strategy-3-0": ["purpose"],
  "guide-for-initiating-a-landscape-leadership-lab": ["stakeholders", "learning"],
  "landscape-governance-assessment-tool-lgat": ["impact"],
  "landscape-governance-workbook": ["stakeholders", "learning"],
  "legal-system-architecture-experiment-log": ["legal"],
  "many-to-many-systems": ["roles", "legal"],
  "mobiliseren-van-een-gebiedsteam": ["team", "stakeholders"],
  "the-msp-guide-how-to-design-and-facilitate-multi-stakeholder-partnerships": ["stakeholders", "coordination"],
  "wegwijzer-rechten-van-de-natuur": ["stakeholders", "legal"],
  "assessing-landscape-governance-a-participatory-approach": ["stakeholders", "impact"],
  "equitable-and-inclusive-landscape-restoration-planning-learning-from-a-restoration-opportunity-assessment-in-india": ["stakeholders", "power"],
  "governance-and-management-dynamics-of-landscape-restoration-at-multiple-scales-learning-from-successful-environmental-managers-in-sweden": ["coordination"],
  "scale-sensitive-governance-in-forest-and-landscape-restoration-a-systematic-review": ["coordination"],
  "the-political-ecology-playbook-for-ecosystem-restoration-principles-for-effective-equitable-and-transformative-landscapes": ["power", "impact"],
  "toward-viable-landscape-governance-systems-what-works": ["stakeholders", "coordination"],
  "transformative-governance-of-biodiversity-insights-for-sustainable-development": ["impact"],
  "prosocial-core-design-principles": ["power", "conflict", "learning"],
  "self-assessment-framework-for-bioregional-organizing-teams": ["team", "learning"],
  "stocktake-and-gap-analysis": ["learning"],
  "weaving-team-self-assessment": ["team", "learning"],
  "4-returns-guidebook": ["purpose", "impact"],
  "cocreative-tools-for-collaborative-innovation": ["meetings"],
  "community-weaving": ["stakeholders", "coordination"],
  "contractual-role-cards": ["roles", "legal"],
  "onboarding-nature-toolkit": ["stakeholders"],
  "sociocracy-resources": ["power"],
  "circular-value-flower": ["impact"],
};

/** The platform's blocks for a row, or null when the map has no entry for it. */
export function confirmedBlocksFor(slug: string): readonly CanvasBlockId[] | null {
  return Object.prototype.hasOwnProperty.call(CONFIRMED_BLOCK_TAGS, slug) ? CONFIRMED_BLOCK_TAGS[slug] : null;
}

/** Where a resource shows in this village, and which layer said so. */
export interface Placing {
  by: ResourcePlacing;
  blocks: CanvasBlockId[];
  /** For a suggestion only: each block's matching keyword. */
  keywords: Partial<Record<CanvasBlockId, string>>;
}

/**
 * The layer that decides, in order: the village's own placing when it has
 * one (an empty list is a placing: shown under no block), then the platform's
 * map, then the keywords. Blocks come back in canvas order, once each.
 */
export function placingOf(row: {
  nameSlug: string;
  local: readonly string[] | null;
  keywords: readonly string[];
}): Placing {
  const inOrder = (ids: readonly string[]) => CANVAS_BLOCK_IDS.filter((b) => ids.includes(b));
  if (row.local) return { by: "village", blocks: inOrder(row.local), keywords: {} };
  const confirmed = confirmedBlocksFor(row.nameSlug);
  if (confirmed) return { by: "platform", blocks: inOrder(confirmed), keywords: {} };
  const suggested = suggestBlocks(row.keywords);
  return {
    by: "suggested",
    blocks: suggested.map((s) => s.block),
    keywords: Object.fromEntries(suggested.map((s) => [s.block, s.keyword])),
  };
}

/** A list of block ids from a request, checked: known ids only, once each, in canvas order. Null when it is not a list. */
export function parseBlockList(value: unknown): CanvasBlockId[] | null {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return null;
  if (value.some((v) => !(CANVAS_BLOCK_IDS as readonly string[]).includes(v as string))) return null;
  return CANVAS_BLOCK_IDS.filter((b) => value.includes(b));
}

const NVC = /\bnvc\b|non-?violent communication/i;

/**
 * True for a resource that must never be offered on a safety surface: the
 * Nonviolent Communication rows, found by name, keyword or description so a
 * row renamed upstream is still caught.
 */
export function safetyExcluded(row: { name: string; description: string; keywords: readonly string[] }): boolean {
  return NVC.test(row.name) || NVC.test(row.description) || row.keywords.some((k) => NVC.test(k));
}
