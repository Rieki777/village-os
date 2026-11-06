/**
 * THE CANVAS'S FIVE FRAMES, THE SERVER HALF'S VOCABULARY (plan 2.3; Wave 3a,
 * 2026-09-28).
 *
 * Each canvas block is walked in five frames: Sense (a reading), See (what the
 * live system already shows), Learn, Say (the answer in the village's words)
 * and Adopt (the pen adopts or declines). This file is what Say and Adopt need
 * to agree on between the client and the server: what a suggestion may aim
 * at, which pen covers each aim, which settings a block's answer can write,
 * and when a suggestion carries a line on how it serves the purpose.
 *
 * Isomorphic and pure, built like shared/governanceCanvas.ts, so the form and
 * the route refuse the same mistake in the same words.
 *
 * ── WHAT A SUGGESTION CAN AIM AT ───────────────────────────────────────────
 *
 *   words    a brief section the block draws on (`CANVAS_BLOCKS[b].briefSections`)
 *   purpose  the governing purpose statement, on the Purpose block only
 *   setting  a setting the block maps to, through a door below
 *   matrix   a new human row of the Decision Matrix, on the Power block only
 *
 * ── THE DOORS ARE "MAKE IT REAL", AND ONLY THE WIRED ONES ARE HERE ─────────
 *
 * Plan 2.3's table maps seven blocks to settings. A door in `CANVAS_DOORS` is
 * one the adopt route can write by CALLING that setting's own logic, with its
 * own guard: the dial write behind `PUT /api/admin/variables/:key`, the
 * exit-policy save behind `PUT /api/admin/exit-policy`, and the module
 * lifecycle write behind `PUT /api/admin/modules/:id/lifecycle`. The two
 * settings whose logic is not callable from here yet (seat terms and the
 * season's dates) are `UNWIRED_DOORS`: the page links to their own controls, a
 * suggestion cannot carry a value for them, and the report that shipped this
 * file says so. A door is never simulated.
 */
import { ALIGNMENT_MAX_CHARS, ALIGNMENT_MIN_WORDS, countWords, purposeStatementProblem } from "./governingPurpose";
import { CANVAS_BLOCKS, isCanvasBlockId, type CanvasBlockId } from "./governanceCanvas";
import { ISSUANCE_CAP_KEY } from "./issuanceCap";
import type { CanvasPen } from "./powerHands";
import type { BriefSectionId } from "./villageBrief";

export const PROPOSAL_TARGETS = ["words", "purpose", "setting", "matrix"] as const;
export type ProposalTarget = (typeof PROPOSAL_TARGETS)[number];

export const PROPOSAL_SOURCES = ["member", "derived", "import"] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];

export const PROPOSAL_STATUSES = ["open", "adopted", "declined"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * The brief sections that stay with administrators for reading AND writing,
 * whatever their audience column says (plan 2.3, the canvas prose pen). They
 * name people, title holders, land and red lines.
 */
export const ADMIN_ONLY_SECTIONS: readonly BriefSectionId[] = ["people", "legal", "land", "constraints"];

export function isAdminOnlySection(section: string): boolean {
  return (ADMIN_ONLY_SECTIONS as readonly string[]).includes(section);
}

/** The setting doors the adopt route can write, keyed by id. */
export const CANVAS_DOOR_IDS = [
  "dial:membership.vouches_required",
  "exit:terms",
  "dial:governance.default_method",
  "exit:restorative",
  "dial:ledger.admin_mint_cycle_cap",
  "module:governance",
] as const;
export type CanvasDoorId = (typeof CANVAS_DOOR_IDS)[number];

export interface CanvasDoor {
  id: CanvasDoorId;
  block: CanvasBlockId;
  kind: "dial" | "exit-policy" | "module";
  /** What the door changes, as a member reads it. */
  label: string;
  /** The dial's key, on a dial door. */
  dialKey?: string;
  /** The module's id, on a module door. */
  moduleId?: string;
  /** The setting's own control, for a person who wants to see it there. */
  href: string;
}

export const CANVAS_DOORS: Record<CanvasDoorId, CanvasDoor> = {
  "dial:membership.vouches_required": {
    id: "dial:membership.vouches_required",
    block: "team",
    kind: "dial",
    label: "How many vouches admit a new member",
    dialKey: "membership.vouches_required",
    href: "/game-mechanics",
  },
  "exit:terms": {
    id: "exit:terms",
    block: "team",
    kind: "exit-policy",
    label: "How somebody leaves: the notice, the steps and how their contribution is honoured",
    href: "/exit-policy",
  },
  "dial:governance.default_method": {
    id: "dial:governance.default_method",
    block: "power",
    kind: "dial",
    label: "How village-wide ballots decide",
    dialKey: "governance.default_method",
    href: "/game-mechanics",
  },
  "exit:restorative": {
    id: "exit:restorative",
    block: "conflict",
    kind: "exit-policy",
    label: "The restorative steps, the care role, its cover and the promised reply time",
    href: "/exit-policy",
  },
  "dial:ledger.admin_mint_cycle_cap": {
    id: "dial:ledger.admin_mint_cycle_cap",
    block: "resourcing",
    kind: "dial",
    label: "The issuance cap per lunar cycle",
    dialKey: ISSUANCE_CAP_KEY,
    href: "/game-mechanics",
  },
  "module:governance": {
    id: "module:governance",
    block: "power",
    kind: "module",
    // The setting's NAME, never a state. It read "Governance switched on for
    // members", and under a See fact saying governance was off (the default)
    // that told a member the opposite (audit of Wave 3b, 2026-09-28).
    label: "How widely governance is switched on",
    moduleId: "governance",
    href: "/admin?tab=modules&module=governance",
  },
};

export function isCanvasDoorId(value: unknown): value is CanvasDoorId {
  return typeof value === "string" && (CANVAS_DOOR_IDS as readonly string[]).includes(value);
}

/**
 * The settings plan 2.3 maps a block to that this build cannot write from the
 * canvas yet. Each names its own control, and nothing pretends to adopt it.
 */
export const UNWIRED_DOORS: ReadonlyArray<{ block: CanvasBlockId; label: string; href: string; why: string }> = [
  {
    block: "roles",
    label: "The term on each seat",
    href: "/roles",
    why: "Seat terms are set on each seat, where the seat is filled.",
  },
  {
    block: "meetings",
    label: "The season's dates",
    href: "/admin?tab=season",
    why: "The season's dates are set on the season list.",
  },
];

/** The doors a block's answer can write, in canvas order. */
export function doorsForBlock(block: CanvasBlockId): CanvasDoor[] {
  return CANVAS_DOOR_IDS.map((id) => CANVAS_DOORS[id]).filter((d) => d.block === block);
}

/**
 * ── THE PURPOSE LINE, SCOPED (GPS ruling 1) ────────────────────────────────
 *
 * A suggestion to the Power, Conflict, Roles or Resourcing answer, or to the
 * Decision Matrix, changes how the village works, so its proposer writes one
 * line on how it serves the governing purpose. Every other suggestion is about
 * wording, and the field does not exist on it: the ruling scoped it so a line
 * on everything does not become a ritual.
 */
export const SERVES_PURPOSE_BLOCKS: readonly CanvasBlockId[] = ["power", "conflict", "roles", "resourcing"];

export function servesPurposeScoped(block: CanvasBlockId, target: ProposalTarget): boolean {
  return target === "matrix" || (SERVES_PURPOSE_BLOCKS as readonly string[]).includes(block);
}

/**
 * Why this purpose line will not do, or null.
 *
 * `hasStatement` is whether the village has written its governing purpose
 * statement. A line answers to a statement, so with none written the line is
 * welcome and not demanded, the same rule `purposeAlignmentRefusal` applies to
 * a ballot (server/lib/governingPurpose.ts). The floor and the ceiling are the
 * ballot's own numbers, so a proposer meets one standard in both places.
 */
export function servesPurposeProblem(scoped: boolean, raw: unknown, hasStatement: boolean): string | null {
  const text = typeof raw === "string" ? raw.trim() : raw === undefined || raw === null ? "" : String(raw).trim();
  if (!scoped) {
    return text
      ? "This suggestion changes wording only, so it carries no line about the purpose. Leave that box out."
      : null;
  }
  if (!text) {
    return hasStatement
      ? "This one changes how the village works, so say in a line how it serves the governing purpose. Everyone reads it beside the suggestion."
      : null;
  }
  if (text.length > ALIGNMENT_MAX_CHARS) {
    return `The purpose line stops at ${ALIGNMENT_MAX_CHARS} characters. This one is ${text.length}.`;
  }
  if (countWords(text) < ALIGNMENT_MIN_WORDS) {
    return `Say what this changes and which part of the purpose it serves. That takes at least ${ALIGNMENT_MIN_WORDS} words, and this one is ${countWords(text)}.`;
  }
  return null;
}

/** The pen a suggestion's adoption needs. */
export function penForProposal(p: { target: ProposalTarget; sectionId?: string | null; door?: string | null }): CanvasPen {
  if (p.target === "purpose") return "purpose";
  if (p.target === "matrix") return "consequence";
  if (p.target === "setting") {
    const kind = p.door && isCanvasDoorId(p.door) ? CANVAS_DOORS[p.door].kind : null;
    return kind === "dial" ? "dial" : kind === "module" ? "module" : "consequence";
  }
  return isAdminOnlySection(String(p.sectionId ?? "")) ? "admin" : "prose";
}

/* ── The changes a suggestion can carry ─────────────────────────────────── */

/** A dial door's new value, as the dial write takes it. */
export interface DialChange {
  value: string;
}

/** The lifecycles a module door can move a module to, in the module registry's words. */
export const MODULE_DOOR_LIFECYCLES = ["off", "preview", "members", "public"] as const;

/** A module door's new lifecycle. */
export interface ModuleChange {
  to: (typeof MODULE_DOOR_LIFECYCLES)[number];
}

/** The words a module lifecycle is said in, on the page and in the adopt route's answer alike. */
export const MODULE_LIFECYCLE_WORDS: Record<ModuleChange["to"], string> = {
  off: "off",
  preview: "on for the administrators only",
  members: "on for members",
  public: "on for everybody, visitors included",
};

/** The exit terms a Team suggestion can set. Every field optional; at least one present. */
export interface ExitTermsChange {
  noticePeriodDays?: number;
  valuationMethod?: string;
  unwindSteps?: string[];
  involuntaryProcess?: string;
}

/** The restorative path a Conflict suggestion can set. Every field optional; at least one present. */
export interface RestorativeChange {
  steps?: string[];
  intakeContactRole?: string;
  coverRole?: string;
  replyHours?: number | null;
}

/**
 * One human row of the Decision Matrix. `rowId` present means "change this
 * row", which only the pen's own write sends (PUT .../rows/:id). A member's
 * suggestion always proposes a new row: `parseCanvasProposal` refuses a
 * `rowId`, because the Adopt card cannot show which row it would overwrite
 * and the overwrite keeps no copy (audit of Wave 3b, 2026-09-28).
 */
export interface MatrixRowChange {
  rowId?: number;
  subject: string;
  approval: string;
  consultation: string;
  information: string;
  method: string;
  riskTags: string[];
}

export const MATRIX_SUBJECT_MAX = 200;
export const MATRIX_CELL_MAX = 2000;
export const MATRIX_METHOD_MAX = 200;
export const MATRIX_TAGS_MAX = 12;
export const MATRIX_TAG_MAX = 40;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const lines = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.map((s) => str(s)).filter((s) => s.length > 0) : null;

/**
 * A matrix row as the page sends it, or the sentence that refuses it. Used by
 * a matrix suggestion and by the direct row write, so both refuse alike.
 */
export function parseMatrixRow(raw: unknown): { ok: true; row: MatrixRowChange } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const subject = str(b.subject);
  if (!subject) return { ok: false, error: "Name the kind of decision this row is about." };
  if (subject.length > MATRIX_SUBJECT_MAX) return { ok: false, error: `Keep the kind of decision to ${MATRIX_SUBJECT_MAX} characters.` };
  const cells: Array<[keyof MatrixRowChange, string]> = [
    ["approval", "who approves it"],
    ["consultation", "who is asked first"],
    ["information", "who is told"],
  ];
  const out: Record<string, string> = {};
  for (const [key, said] of cells) {
    const v = str(b[key]);
    if (!v) return { ok: false, error: `Say ${said}. "Nobody yet" is an answer.` };
    if (v.length > MATRIX_CELL_MAX) return { ok: false, error: `Keep ${said} to ${MATRIX_CELL_MAX} characters.` };
    out[key] = v;
  }
  const method = str(b.method);
  if (method.length > MATRIX_METHOD_MAX) return { ok: false, error: `Keep the method to ${MATRIX_METHOD_MAX} characters.` };
  const tags = lines(b.riskTags) ?? [];
  if (tags.length > MATRIX_TAGS_MAX) return { ok: false, error: `A row carries at most ${MATRIX_TAGS_MAX} risk tags.` };
  if (tags.some((t) => t.length > MATRIX_TAG_MAX || t.includes(","))) {
    return { ok: false, error: `A risk tag is a short word or phrase, up to ${MATRIX_TAG_MAX} characters, with no commas.` };
  }
  let rowId: number | undefined;
  if (b.rowId !== undefined && b.rowId !== null && b.rowId !== "") {
    const n = Number(b.rowId);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "That is not a row of this village's matrix." };
    rowId = n;
  }
  return {
    ok: true,
    row: {
      ...(rowId ? { rowId } : {}),
      subject,
      approval: out.approval,
      consultation: out.consultation,
      information: out.information,
      method,
      riskTags: Array.from(new Set(tags)),
    },
  };
}

function parseExitTerms(raw: unknown): { ok: true; change: ExitTermsChange } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const change: ExitTermsChange = {};
  if (b.noticePeriodDays !== undefined) {
    const n = Number(b.noticePeriodDays);
    if (!Number.isInteger(n) || n < 0 || n > 3650) return { ok: false, error: "The notice period is a whole number of days." };
    change.noticePeriodDays = n;
  }
  for (const key of ["valuationMethod", "involuntaryProcess"] as const) {
    if (b[key] === undefined) continue;
    const v = str(b[key]);
    if (!v) return { ok: false, error: "A term cannot be left empty. Leave the field out to keep what is there." };
    if (v.length > 4000) return { ok: false, error: "Keep each term to 4000 characters." };
    change[key] = v;
  }
  if (b.unwindSteps !== undefined) {
    const steps = lines(b.unwindSteps);
    if (!steps || !steps.length) return { ok: false, error: "Give at least one step of a departure." };
    change.unwindSteps = steps;
  }
  if (!Object.keys(change).length) return { ok: false, error: "Say which exit term this changes." };
  return { ok: true, change };
}

function parseRestorative(raw: unknown): { ok: true; change: RestorativeChange } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const change: RestorativeChange = {};
  if (b.steps !== undefined) {
    const steps = lines(b.steps);
    if (!steps || !steps.length) return { ok: false, error: "Give at least one restorative step." };
    change.steps = steps;
  }
  for (const key of ["intakeContactRole", "coverRole"] as const) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== "string") return { ok: false, error: "Name a role by its id, or leave it empty." };
    change[key] = str(b[key]);
  }
  if (b.replyHours !== undefined) {
    if (b.replyHours === null) change.replyHours = null;
    else {
      const n = Number(b.replyHours);
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: "The promised reply time is a whole number of hours." };
      change.replyHours = n;
    }
  }
  if (!Object.keys(change).length) return { ok: false, error: "Say which part of the restorative path this changes." };
  return { ok: true, change };
}

/** A suggestion, validated and ready to store. */
export interface CanvasProposalInput {
  blockId: CanvasBlockId;
  target: ProposalTarget;
  sectionId: BriefSectionId | null;
  door: CanvasDoorId | null;
  change: DialChange | ModuleChange | ExitTermsChange | RestorativeChange | MatrixRowChange | null;
  body: string;
  source: ProposalSource;
}

/** The longest suggestion. The brief keeps a section up to this length too. */
export const PROPOSAL_BODY_MAX = 40000;

/**
 * THE ONE VALIDATOR for a suggestion's shape, for the route and for the form.
 *
 * It does not judge the purpose line (the route asks `servesPurposeProblem`
 * once it knows whether the village has a statement) and it does not judge a
 * setting's value against the setting's own rules: those are checked by the
 * setting's own logic when the suggestion is adopted, which is the point of
 * calling that logic. What it does refuse is a suggestion that could never be
 * adopted by anybody, so nobody spends a vote on one.
 */
export function parseCanvasProposal(body: unknown): { ok: true; proposal: CanvasProposalInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isCanvasBlockId(b.blockId)) return { ok: false, error: "That is not one of the twelve canvas blocks." };
  const blockId = b.blockId;
  const block = CANVAS_BLOCKS[blockId];
  const target = b.target === undefined || b.target === null || b.target === "" ? "words" : b.target;
  if (!(PROPOSAL_TARGETS as readonly unknown[]).includes(target)) {
    return { ok: false, error: "A suggestion changes words, the purpose statement, a setting or a row of the matrix." };
  }
  const source = b.source === undefined || b.source === null || b.source === "" ? "member" : b.source;
  if (!(PROPOSAL_SOURCES as readonly unknown[]).includes(source)) {
    return { ok: false, error: "A suggestion comes from a member, is drafted from the live system, or is imported." };
  }
  const text = str(b.body);
  if (text.length < 2) return { ok: false, error: "Write the suggestion in a sentence or more." };
  if (text.length > PROPOSAL_BODY_MAX) return { ok: false, error: `Keep a suggestion to ${PROPOSAL_BODY_MAX} characters.` };

  const base = { blockId, body: text, source: source as ProposalSource };
  if (target === "words") {
    const section = str(b.sectionId);
    if (!section) {
      if (!block.briefSections.length) {
        return { ok: false, error: `${block.name} has no section of words to suggest into yet. ${block.elsewhere?.note ?? ""}`.trim() };
      }
      return { ok: false, error: `Say which part of ${block.name} these words are for.` };
    }
    if (!(block.briefSections as readonly string[]).includes(section)) {
      return { ok: false, error: `${block.name} does not draw on that section.` };
    }
    return { ok: true, proposal: { ...base, target, sectionId: section as BriefSectionId, door: null, change: null } };
  }
  if (target === "purpose") {
    if (blockId !== "purpose") return { ok: false, error: "The purpose statement is suggested on the Purpose block." };
    // The statement's one validator, so a suggestion nobody could adopt is
    // refused before anybody reads it.
    const problem = purposeStatementProblem(text);
    if (problem) return { ok: false, error: problem };
    return { ok: true, proposal: { ...base, target, sectionId: null, door: null, change: null } };
  }
  if (target === "matrix") {
    if (blockId !== "power") return { ok: false, error: "The Decision Matrix is suggested on the Power block." };
    const row = parseMatrixRow(b.change);
    if (!row.ok) return row;
    if (row.row.rowId !== undefined) {
      return {
        ok: false,
        error: "A suggestion adds a new row to the Decision Matrix. To change a row, suggest it as it should read and say in your reason which row it replaces.",
      };
    }
    return { ok: true, proposal: { ...base, target, sectionId: null, door: null, change: row.row } };
  }
  // target === "setting"
  if (!isCanvasDoorId(b.door)) {
    const unwired = UNWIRED_DOORS.filter((d) => d.block === blockId);
    const open = doorsForBlock(blockId);
    if (!open.length) {
      return {
        ok: false,
        error: unwired.length
          ? `${unwired.map((d) => d.why).join(" ")} Suggest the words here, and change the setting there.`
          : `${block.name} has no setting behind it. Suggest the words instead.`,
      };
    }
    return { ok: false, error: `Say which of ${block.name}'s settings this changes.` };
  }
  const door = CANVAS_DOORS[b.door];
  if (door.block !== blockId) return { ok: false, error: `That setting belongs to the ${CANVAS_BLOCKS[door.block].name} block.` };
  if (door.kind === "dial") {
    const c = (b.change ?? {}) as Record<string, unknown>;
    const value = typeof c.value === "number" ? String(c.value) : str(c.value);
    if (!value) return { ok: false, error: "Say what the setting should be." };
    if (value.length > 255) return { ok: false, error: "A setting's value is at most 255 characters." };
    return { ok: true, proposal: { ...base, target: "setting", sectionId: null, door: door.id, change: { value } } };
  }
  if (door.kind === "module") {
    const to = str((b.change as Record<string, unknown> | undefined)?.to);
    if (!(MODULE_DOOR_LIFECYCLES as readonly string[]).includes(to)) {
      return { ok: false, error: "Say how widely the module should be switched on: off, preview, members or public." };
    }
    return { ok: true, proposal: { ...base, target: "setting", sectionId: null, door: door.id, change: { to: to as ModuleChange["to"] } } };
  }
  const parsed = door.id === "exit:terms" ? parseExitTerms(b.change) : parseRestorative(b.change);
  if (!parsed.ok) return parsed;
  return { ok: true, proposal: { ...base, target: "setting", sectionId: null, door: door.id, change: parsed.change } };
}
