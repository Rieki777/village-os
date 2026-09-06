/**
 * How power is held, as words (round 4, lane L2).
 *
 * The power map's vocabulary: the shapes a village can say it is, the ways a
 * circle can decide, the four domains a circle may decide differently about,
 * and the ways a seat's next holder is chosen. Every entry carries a one-line
 * gloss the legend shows, because a chart that says "do-ocracy" without saying
 * what that means is jargon wearing a diagram.
 *
 * IDS ARE CLOSED. A village that wants a word of its own picks `other` and
 * writes the word in the gloss, which the legend then shows. That keeps the
 * map able to DRAW every shape it knows (each id has a layout) while refusing
 * to flatten a village's own language into the nearest platform word.
 *
 * PURE, both ways: no imports, no state, so the same validation runs on the
 * client before a save is attempted and on the server when one arrives, and
 * check-voice can read every gloss a member will.
 */

export type ShapeId = "circle" | "pyramid" | "council" | "flat" | "steward" | "network" | "other";

export type DecidesById =
  | "consent"
  | "consensus"
  | "majority"
  | "lead_decides"
  | "elders_decide"
  | "founder_decides"
  | "do_ocracy"
  | "delegated"
  | "hypha"
  | "other";

export type DomainId = "money" | "people" | "space_land" | "rules";

export type HowChosenId =
  | "appointed_by_lead"
  | "elected_by_circle"
  | "rotates"
  | "volunteers"
  | "founder_appoints"
  | "other";

export interface ShapeDef {
  id: ShapeId;
  label: string;
  /** One plain line the legend shows on tap. */
  gloss: string;
  /**
   * Where this shape sits on the strip from "one holds it" (0) to "all hold
   * it" (1). The legend draws the strip once for the whole village and places
   * the village's marker on it: the pyramid-to-circle line, drawn honestly.
   */
  spectrum: number;
}

export interface DecidesByDef {
  id: DecidesById;
  label: string;
  gloss: string;
}

export interface DomainDef {
  id: DomainId;
  label: string;
  /** The question a member is really asking when they pick this chip. */
  gloss: string;
}

export interface HowChosenDef {
  id: HowChosenId;
  label: string;
  gloss: string;
}

/**
 * The shapes, ordered along the spectrum. `other` sits mid-strip because the
 * platform does not know where a village's own word belongs; the village's
 * gloss says what it is.
 */
export const SHAPES: ShapeDef[] = [
  { id: "steward", label: "Steward", gloss: "One person holds it as a trust for everyone.", spectrum: 0 },
  { id: "pyramid", label: "Pyramid", gloss: "A head at the top, and layers that report up.", spectrum: 0.2 },
  { id: "council", label: "Council", gloss: "A small council holds it together for the rest.", spectrum: 0.4 },
  { id: "other", label: "Other", gloss: "A shape of this village's own, said in its own line.", spectrum: 0.5 },
  { id: "circle", label: "Circle", gloss: "Peers in a ring, with a lead who facilitates.", spectrum: 0.7 },
  { id: "network", label: "Network", gloss: "Autonomous groups, with agreements between them.", spectrum: 0.85 },
  { id: "flat", label: "Flat", gloss: "No head. Everyone holds it together.", spectrum: 1 },
];

/** The ways a circle can decide. Each gloss is the sentence the chip shows. */
export const DECIDES_BY: DecidesByDef[] = [
  { id: "consent", label: "Consent", gloss: "A decision passes when nobody has a reasoned objection." },
  { id: "consensus", label: "Consensus", gloss: "A decision passes when everyone agrees." },
  { id: "majority", label: "Majority", gloss: "A vote. More than half carries it." },
  { id: "lead_decides", label: "Lead decides", gloss: "The circle's lead makes the call." },
  { id: "elders_decide", label: "Elders decide", gloss: "The elders make the call." },
  { id: "founder_decides", label: "Founder decides", gloss: "The founder makes the call." },
  { id: "do_ocracy", label: "Do-ocracy", gloss: "Whoever does the work decides how it is done." },
  // `delegated` had an engine behind it from 0174. A member hands their voice
  // to another member, the choice is COPIED into the delegator's own ballot
  // row and the weight never moves, chains are transitive, and a cycle is
  // refused when the delegation is given. The rule lives in
  // server/lib/delegation.ts and the surfaces are under
  // /api/governance/delegation. This gloss is the sentence the chip shows and
  // is now a description of what happens rather than a word for it.
  { id: "delegated", label: "Delegated", gloss: "You hand your voice to someone you choose." },
  { id: "hypha", label: "Hypha", gloss: "Decided and recorded on the village's Hypha DHO." },
  { id: "other", label: "Other", gloss: "A way of this village's own, said in its own line." },
];

/**
 * The four domains a circle may decide differently about (P2). Exactly four:
 * a per-domain override is a lens over the circle's one method, and a list
 * that grows becomes a matrix nobody fills in.
 */
export const DOMAINS: DomainDef[] = [
  { id: "money", label: "Money", gloss: "Who decides about spending and budgets here." },
  { id: "people", label: "People", gloss: "Who decides about seats, joining and leaving here." },
  { id: "space_land", label: "Space and land", gloss: "Who decides about buildings, ground and use of space here." },
  { id: "rules", label: "Rules", gloss: "Who decides about agreements and how they change here." },
];

/** How a seat's next holder is chosen (P6): the heart of how power is held. */
export const HOW_CHOSEN: HowChosenDef[] = [
  { id: "appointed_by_lead", label: "Appointed by the lead", gloss: "The circle's lead names the next holder." },
  { id: "elected_by_circle", label: "Elected by the circle", gloss: "The circle chooses its next holder together." },
  { id: "rotates", label: "Rotates", gloss: "The seat passes around the circle on a rhythm." },
  { id: "volunteers", label: "Volunteers", gloss: "Whoever raises a hand and is welcomed takes it up." },
  { id: "founder_appoints", label: "Founder appoints", gloss: "The founder names the next holder." },
  { id: "other", label: "Other", gloss: "A way of this village's own, said in its own line." },
];

/** The longest gloss a village may write. Matches the varchar(160) columns. */
export const GLOSS_MAX = 160;

const SHAPE_IDS = new Set<string>(SHAPES.map((s) => s.id));
const DECIDES_BY_IDS = new Set<string>(DECIDES_BY.map((d) => d.id));
const DOMAIN_IDS = new Set<string>(DOMAINS.map((d) => d.id));
const HOW_CHOSEN_IDS = new Set<string>(HOW_CHOSEN.map((h) => h.id));

export function shapeById(id: string | null | undefined): ShapeDef | null {
  return SHAPES.find((s) => s.id === id) ?? null;
}

export function decidesByById(id: string | null | undefined): DecidesByDef | null {
  return DECIDES_BY.find((d) => d.id === id) ?? null;
}

export function howChosenById(id: string | null | undefined): HowChosenDef | null {
  return HOW_CHOSEN.find((h) => h.id === id) ?? null;
}

/**
 * The one gloss rule, shared by all three vocabularies: `other` MUST come
 * with a line of the village's own words, because "Other" alone on a legend
 * is a shrug. Any entry MAY carry a gloss; it just has to fit the column.
 */
function glossProblem(id: string, gloss: unknown, what: string): string | null {
  const text = gloss === null || gloss === undefined ? "" : String(gloss).trim();
  if (id === "other" && !text) {
    return `"Other" needs one line saying what this ${what} is, so the legend can show it`;
  }
  if (text.length > GLOSS_MAX) {
    return `That line is too long. ${GLOSS_MAX} characters is the room the legend has`;
  }
  return null;
}

/**
 * What is wrong with a proposed shape, in the words somebody would use.
 * Null means it is fine. Pure, so the same sentence shows before a save is
 * attempted and returns when one is refused.
 */
export function shapeProblem(shape: unknown, gloss?: unknown): string | null {
  const id = String(shape ?? "");
  if (!SHAPE_IDS.has(id)) {
    return `A shape must be one of: ${SHAPES.map((s) => s.id).join(", ")}`;
  }
  return glossProblem(id, gloss, "shape");
}

/** Same contract as `shapeProblem`, for the ways a circle decides. */
export function decidesByProblem(v: unknown, gloss?: unknown): string | null {
  const id = String(v ?? "");
  if (!DECIDES_BY_IDS.has(id)) {
    return `A way of deciding must be one of: ${DECIDES_BY.map((d) => d.id).join(", ")}`;
  }
  return glossProblem(id, gloss, "way of deciding");
}

/** Same contract again, for how a seat's next holder is chosen. */
export function howChosenProblem(v: unknown, gloss?: unknown): string | null {
  const id = String(v ?? "");
  if (!HOW_CHOSEN_IDS.has(id)) {
    return `How a holder is chosen must be one of: ${HOW_CHOSEN.map((h) => h.id).join(", ")}`;
  }
  return glossProblem(id, gloss, "way of choosing");
}

/**
 * A circle's per-domain overrides: `{money?, people?, space_land?, rules?}`,
 * each `{method, gloss?}`. The override is a LENS over the circle's one
 * method, so an empty object is fine and an unknown domain key is refused by
 * name instead of silently dropped.
 */
export interface DomainOverride {
  method: DecidesById;
  gloss?: string;
}

export type DecidesByDomains = Partial<Record<DomainId, DomainOverride>>;

export function domainsProblem(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) {
    return "Domain overrides are an object keyed by domain";
  }
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!DOMAIN_IDS.has(key)) {
      return `"${key}" is a domain the map does not know. The domains are: ${DOMAINS.map((d) => d.id).join(", ")}`;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return `The ${key} override needs a method`;
    }
    const o = raw as Record<string, unknown>;
    const problem = decidesByProblem(o.method, o.gloss);
    if (problem) return problem;
  }
  return null;
}
