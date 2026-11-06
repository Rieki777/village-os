/**
 * THE CANVAS'S FIVE FRAMES, SERVED (plan 2.3: "Five frames", "Make it real",
 * "Text-bearing objects", "Three pens"; Wave 3a, 2026-09-28).
 *
 *   GET    /api/canvas/blocks/:id                   one block, all five frames' data
 *   POST   /api/canvas/proposals                    any member suggests an answer
 *   POST   /api/canvas/proposals/:id/adopt          the pen adopts it
 *   POST   /api/canvas/proposals/:id/decline        the pen declines it, or its proposer withdraws it
 *   GET    /api/canvas/decision-matrix/rows         the matrix's human rows
 *   POST   /api/canvas/decision-matrix/rows         a new row, under the consequence pen
 *   PUT    /api/canvas/decision-matrix/rows/:id     a changed row, under the consequence pen
 *   DELETE /api/canvas/decision-matrix/rows/:id     a row removed, under the consequence pen
 *
 * The request and response shapes are written down for the UI lane in
 * docs/canvas-api.md. That file and this one change together.
 *
 * ── CORE, LIKE THE CANVAS ──────────────────────────────────────────────────
 *
 * No `requireModule` stands in front of any of these, for the reason
 * server/routes/canvas.ts gives: every block has to be on record before the
 * Birthing, so nothing a village can switch off may stand between it and the
 * canvas. Reading and suggesting are for the village's admitted members and
 * its admins (`mayReadCanvas`), never the public.
 *
 * ── PROPOSE FREELY, ADOPT BY POWER ─────────────────────────────────────────
 *
 * Rye, 2026-09-24 and 2026-09-25: anybody in the village may suggest anything,
 * including a change to any dial, from day one; a human or a full vote,
 * depending on who holds the power, adopts it. So `POST /api/canvas/proposals`
 * asks only whether the person is in the village, and every question of power
 * is asked at adoption, through ONE predicate: `whoAdoptsCanvasAnswer` in
 * shared/powerHands.ts, which is `whoMayPutHandToVillage` asked for each pen.
 * The pen decides who may adopt; it never decides who may read or suggest.
 *
 * ── ADOPTING CALLS THE SETTING'S OWN LOGIC ─────────────────────────────────
 *
 * Before the Birthing, adopting an answer that names a setting writes it, and
 * it writes it through that setting's own function with the request in hand,
 * so the setting keeps its own guard and its own refusals:
 *
 *   a dial      `writeDial` (server/lib/dialWrite.ts), the body of
 *               `PUT /api/admin/variables/:key`: `dial.set` asked of the gate,
 *               the ring floor, the override hatch
 *   exit terms, `saveExitPolicy` (server/routes/exits.ts), the body of
 *   the care    `PUT /api/admin/exit-policy`: admins, the door checks, the
 *   door        blank-term and platform-wording refusals
 *   prose       `briefWrite` (server/lib/villageBrain.ts), after `story.tell`
 *               is asked of the gate (or `isAdmin` for the four admin sections);
 *               the audience is never passed, so it stays where it was
 *   the purpose `writeGoverningPurpose`, after `founderPenRefusal`, behind the
 *   statement   same `isAdmin` test `PUT /api/admin/purpose` applies
 *   a matrix    `writeDecisionMatrixRow`, behind the consequence pen
 *   row
 *   a module    `setModuleLifecycle` (server/lib/modules.ts), the write behind
 *               `PUT /api/admin/modules/:id/lifecycle`, behind that route's
 *               own `isAdmin` and its shared-password posture. The route's
 *               courtesy of seeding example content on a first enable is not
 *               taken: a canvas adoption is the village's own words, and the
 *               route's own `examples: false` is the same choice
 *
 * A refusal from the setting is answered as it came, and the suggestion stays
 * open: nothing is recorded as adopted that did not happen.
 *
 * After the Birthing, a dial or module door files a mechanics proposal through
 * `openMechanicsProposal` (server/lib/mechanicsPropose.ts), the body of
 * `POST /api/game/mechanics/proposals`, and the village decides it. Only the
 * suggestion's author presses that Adopt (`FILED_BY_PROPOSER`): the proposal
 * carries its filer's name, standing and per-cycle count, and a member who
 * filed somebody else's words could then withdraw them, leaving the canvas
 * saying "adopted" for a change nobody voted on. The
 * consequence pen's vote (the exit terms, the care door and the matrix, at the
 * structural tier) has no machinery yet, so those answer 409 and say so; the
 * purpose statement's vote already has its own route and the answer names it.
 *
 * ── A DECISION IS READ BACK ────────────────────────────────────────────────
 *
 * The pen's note is public (Rye, 2026-09-23). GET /api/canvas/blocks/:id lists
 * the block's decided suggestions (`decided`) beside the open ones, each with
 * who decided it, when, and the note, under the same reading rule as the open
 * list; and the member who made a suggestion is told when somebody else
 * decides it (a `governance` notice, one per suggestion and outcome). Until
 * this existed a decided suggestion left the only list there was, and the page
 * promised a note nobody could read (audit of Wave 3b, 2026-09-28).
 *
 * ── ONE DECISION AT A TIME ─────────────────────────────────────────────────
 *
 * Adopting and declining run under a named lock on the suggestion, so two pens
 * pressing at once cannot both write the setting. The second is told somebody
 * is deciding it now.
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import { capabilityDecision, type Capability } from "../../shared/capabilities";
import {
  CANVAS_DOORS,
  doorsForBlock,
  isCanvasDoorId,
  isAdminOnlySection,
  MODULE_LIFECYCLE_WORDS,
  parseCanvasProposal,
  parseMatrixRow,
  penForProposal,
  servesPurposeProblem,
  servesPurposeScoped,
  UNWIRED_DOORS,
  type ExitTermsChange,
  type MatrixRowChange,
  type RestorativeChange,
} from "../../shared/canvasFrames";
import { validateVariable, VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { CANVAS_BLOCKS, isCanvasBlockId, LEVEL_WORDS, MOMENT_LABELS, type CanvasBlockId } from "../../shared/governanceCanvas";
import { CANVAS_BLOCK_TEXT, CANVAS_CREDIT } from "../../shared/governanceCanvasText";
import { hasGoverningPurpose } from "../../shared/governingPurpose";
import {
  canvasPenSentence,
  NOTE_IS_PUBLIC,
  whoAdoptsCanvasAnswer,
  type CanvasAdoptionRule,
  type CanvasPen,
  type CanvasPenFacts,
} from "../../shared/powerHands";
import { BRIEF_BY_ID } from "../../shared/villageBrief";
import { observedFacts, type ObservedDeps } from "../lib/canvasObserved";
import { villageHandoverState } from "../lib/capabilityHolding";
import { writeDial, type DialWriteDeps } from "../lib/dialWrite";
import { recordEvent } from "../lib/events";
import { readGameStart } from "../lib/gameStart";
import { founderPenRefusal, governingPurpose, writeGoverningPurpose } from "../lib/governingPurpose";
import { NEVER_BY_CHANGESET } from "../lib/changeset";
import { EXECUTABLE_ITEM_KINDS } from "../lib/mechanics";
import { openMechanicsProposal, type MechanicsProposeDeps } from "../lib/mechanicsPropose";
import { setModuleLifecycle } from "../lib/modules";
import type { IntakeHolding } from "../lib/restorativeIntake";
import { rawValue } from "../lib/variables";
import { briefAll, briefWrite, type BriefRow } from "../lib/villageBrain";
import { allCanvasReadings, type CanvasReadingRow } from "../repos/canvasReadings";
import {
  canvasProposalById,
  decideCanvasProposal,
  decidedProposalsForBlock,
  insertCanvasProposal,
  openProposalCountBy,
  openProposalsForBlock,
  type CanvasProposalRow,
} from "../repos/canvasProposals";
import {
  allDecisionMatrixRows,
  decisionMatrixRowById,
  removeDecisionMatrixRow,
  writeDecisionMatrixRow,
  type DecisionMatrixRow,
} from "../repos/decisionMatrixRows";
import { withNamedLock } from "../repos/namedLock";
import { CANVAS_MEMBERS_ONLY, mayReadCanvas } from "./canvas";
import { saveExitPolicy, type ExitPolicySaveDeps } from "./exits";
import { raiseCanvasRevisitForLifecycle } from "../lib/canvasRevisit";

export interface CanvasFrameDeps
  extends Pick<
    AppDeps,
    "authedUser" | "isAdmin" | "hasMembership" | "guardCapability" | "capabilityCtx" | "getPool" | "firstName" | "loadRoles" | "notify"
  > {
  /** Every role_holders row, for the See frame's care role and seat terms. */
  roleHolders(): ReadonlyArray<IntakeHolding>;
  /** The exit-policy save's own collaborators, handed to `saveExitPolicy` whole. */
  exitPolicy: ExitPolicySaveDeps;
  /** The dial write's collaborators, handed to `writeDial` whole. */
  dialWrite: DialWriteDeps;
  /** The mechanics proposal's collaborators, handed to `openMechanicsProposal` whole. */
  mechanicsPropose: MechanicsProposeDeps;
  /** The lifecycle route's own posture check: true while no admin has a real credential. */
  sharedPasswordPosture(): Promise<boolean>;
  addActivity(
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ): Promise<unknown>;
  /** For the See frame: collections and documents server/index.ts already holds. */
  tools: ObservedDeps["tools"];
  submissions: ObservedDeps["submissions"];
  legalEntityLabel: ObservedDeps["legalEntityLabel"];
  seasonNow: ObservedDeps["seasonNow"];
}

/** How many suggestions one member may have open at once, across the canvas. */
export const OPEN_PROPOSALS_PER_MEMBER = 20;

/** Said to a member who does not hold the pen a suggestion needs. */
export const PEN_REFUSALS: Record<CanvasPen, string> = {
  purpose: "The founders keep the purpose statement until every power is handed to the village. You can suggest words, and they adopt them.",
  prose: "Adopting canvas words is for whoever holds the village's story. You can suggest words, and they adopt them.",
  consequence: "The founders adopt this before the Game starts. You can suggest it, and they decide.",
  dial: "Adopting this changes one of the village's dials, which is for whoever may turn them. You can suggest it, and they decide.",
  module: "Switching a part of the Game on or off is for the founders before the Game starts. You can suggest it, and they decide.",
  admin: "This section stays with the administrators. You can suggest words, and they decide.",
};

/** The consequence pen's vote for the exit terms and the matrix, which nothing builds yet. */
export const CONSEQUENCE_VOTE_NOT_BUILT =
  "The Game has started, so this goes to a vote of the whole village at the structural tier. " +
  "That vote is not built yet, so this suggestion stays open until it is.";

/**
 * The care door's vote IS built: it is the conflict agreement's change vote
 * (POST /api/governance/conflict-agreement-changes), which carries the whole
 * agreement and not one field of it, so a canvas suggestion cannot go to it
 * as it stands. Saying "not built yet" here promised a pick-up that would
 * never come (Wave 3a audit, 2026-09-28).
 */
export const CARE_DOOR_IS_THE_AGREEMENT_VOTE =
  "The Game has started, so the care door changes only by a vote on the village's conflict agreement. " +
  "A member who can open votes opens it from the agreement on the governance page, /governance#conflict-agreement. " +
  "That vote carries the whole agreement, so this suggestion cannot go to it as it stands.";

/** Before the Birthing, once an agreement is stored, the care door's words live in it. */
export const CARE_DOOR_IN_AGREEMENT =
  "Nothing was adopted. The care door now comes from the village's conflict agreement, so change it there, on the governance page, /governance#conflict-agreement.";

/**
 * Said on a care-door suggestion's card, before the Birthing, while the
 * village's conflict agreement holds the restorative block: `saveExitPolicy`
 * refuses the write, so the card says so and offers no Adopt that is certain
 * to be refused. The pen can still decline it with a note (audit of Wave 3b,
 * 2026-09-28).
 */
export const CARE_DOOR_HELD_BY_AGREEMENT =
  "The village's conflict agreement holds the care door now, so adopting cannot write this into the exit policy. The change belongs in the agreement, under Say on this block.";

/** The note a withdrawal carries when its author wrote none. Not listed back: "Withdrawn" already says it. */
const WITHDRAWN_NOTE = "Withdrawn by the member who suggested it.";

/** A suggestion somebody else is deciding at this moment. */
export const BEING_DECIDED = "Somebody is deciding this suggestion right now. Look again in a moment.";

/** The purpose statement's vote has its own door. */
export const PURPOSE_CHANGE_DOOR = "/api/governance/purpose-changes";

/**
 * Said to anybody but its author who presses Adopt on a suggestion that files
 * a mechanics proposal. The proposal carries its filer's name, standing and
 * per-cycle count, so it is filed by the member whose words it is.
 */
export const FILED_BY_PROPOSER =
  "The Game has started, so this is filed as a proposal in the name of the member who suggested it, and only they can file it. " +
  "You can suggest your own version.";

/** A pen whose adoption files a mechanics proposal in the adopter's name. */
const filesAProposal = (rule: CanvasAdoptionRule): boolean => rule.how === "ballot" && (rule.pen === "dial" || rule.pen === "module");

function blockView(id: CanvasBlockId) {
  const b = CANVAS_BLOCKS[id];
  return {
    id: b.id,
    number: b.number,
    name: b.name,
    question: b.question,
    prompts: b.prompts,
    foundations: b.foundations,
    briefSections: b.briefSections,
    seasonWeeks: b.seasonWeeks,
    ...(b.elsewhere ? { elsewhere: b.elsewhere } : {}),
    canvasText: CANVAS_BLOCK_TEXT[id],
    credit: CANVAS_CREDIT,
  };
}

function readingView(r: CanvasReadingRow, firstName: (n: string) => string) {
  return {
    id: r.id,
    level: r.level,
    word: LEVEL_WORDS[r.level],
    sentence: r.sentence,
    moment: r.moment,
    momentLabel: MOMENT_LABELS[r.moment],
    recordedBy: { id: r.recordedBy, name: firstName(r.recorderName ?? "") },
    recordedAt: r.recordedAt,
  };
}

function matrixRowView(r: DecisionMatrixRow, firstName: (n: string) => string) {
  return {
    id: r.id,
    subject: r.subject,
    approval: r.approval,
    consultation: r.consultation,
    information: r.information,
    method: r.method,
    riskTags: r.riskTags,
    updatedBy: { id: r.updatedBy, name: firstName(r.updatedByName ?? "") },
    updatedAt: r.updatedAt,
  };
}

/**
 * A dial door's dial, from the registry and the live value, for the
 * suggestion box: its label, what it takes and what it reads today. Served
 * here WHATEVER the owning module's lifecycle (the ruling of 2026-09-25:
 * villagers see every dial and may propose a change to any of them). The box
 * used to read these from GET /api/game/mechanics, which hides the dials of a
 * module below members, so on a new fork the Power block's only dial became a
 * blank text box whose every answer the dial refused (audit of Wave 3b,
 * 2026-09-28).
 */
function dialFacts(key: string) {
  const def = VARIABLES_BY_KEY[key];
  if (!def) return null;
  return {
    key: def.key,
    label: def.label,
    type: def.type,
    unit: def.unit ?? null,
    min: def.min ?? null,
    max: def.max ?? null,
    choices: def.choices ? def.choices.map((c) => ({ value: c.value, label: c.label, ...(c.hint ? { hint: c.hint } : {}) })) : null,
    value: rawValue(key),
  };
}

/**
 * Why a dial will never take this value, in the dial's own terms, or null. A
 * choice is named by its label, never its code, since the box offers labels.
 */
function dialValueProblem(key: string, value: string): string | null {
  const def = VARIABLES_BY_KEY[key];
  if (!def) return null;
  const problem = validateVariable(def, value);
  if (!problem) return null;
  if (def.type === "choice" && def.choices) {
    return `${def.label} takes one of these: ${def.choices.map((c) => c.label).join(", ")}.`;
  }
  return `${def.label}: ${problem}`;
}

/**
 * Who reads a suggestion. Every suggestion is read by the village's readers,
 * except one to the four administrators' sections (plan 2.3), which is read by
 * the administrators and the member who wrote it. The same rule for the open
 * list and the decided one.
 */
function readableSuggestion(p: CanvasProposalRow, admin: boolean, userId: string): boolean {
  return admin || p.target !== "words" || !isAdminOnlySection(String(p.sectionId ?? "")) || p.proposedBy === userId;
}

export function register(app: Express, deps: CanvasFrameDeps): void {
  const { authedUser, isAdmin, capabilityCtx, getPool, firstName, guardCapability } = deps;

  /** The Birthing and the handover, read live every time a pen is asked. */
  const penFacts = async (): Promise<CanvasPenFacts> => {
    const pool = getPool();
    const [start, handover] = await Promise.all([readGameStart(pool), villageHandoverState(pool)]);
    return { birthed: start.started, handoverComplete: handover.complete };
  };

  /**
   * The pen a suggestion needs, asked of the one predicate. A module door adds
   * whether a vote could carry it at all: the module the vote runs on is never
   * moved by a change set, so it stays with the administrators.
   */
  const ruleFor = (p: { target: CanvasProposalRow["target"]; sectionId?: string | null; door?: string | null }, facts: CanvasPenFacts) => {
    const door = p.door && isCanvasDoorId(p.door) ? CANVAS_DOORS[p.door] : null;
    const withVote = door?.kind === "module" ? { ...facts, votable: !NEVER_BY_CHANGESET.has(String(door.moduleId)) } : facts;
    return whoAdoptsCanvasAnswer(penForProposal(p), withVote);
  };

  /**
   * Whether this person may take the step the rule names, asked without the
   * request's side effects: the page uses it to offer a button, and the write
   * still asks the real guard. The same shape as `mayRecord` in
   * server/routes/canvas.ts.
   */
  const mayTake = async (req: Request, user: any, rule: CanvasAdoptionRule): Promise<boolean> => {
    if (rule.who === "the-gate" && rule.capability) {
      return capabilityDecision(rule.capability as Capability, await capabilityCtx(user)).allowed;
    }
    if (rule.who === "admins" || rule.who === "founders") return isAdmin(req);
    if (rule.who === "any-member") return mayReadCanvas(deps, req, user);
    return false;
  };

  /**
   * `proposedBy` is given when the view is of one suggestion. Where adopting
   * files a mechanics proposal, only that suggestion's author may press it
   * (`FILED_BY_PROPOSER`); on a block's own pens it is absent, and the answer
   * is whether this person may file suggestions of their own.
   */
  const penView = async (req: Request, user: any, rule: CanvasAdoptionRule, proposedBy?: string) => {
    // A vote is "built" when the machinery it files into can carry it out:
    // a dial through a mechanics proposal, the purpose statement through its
    // own change vote, and a module only once the mechanics executor carries a
    // lifecycle change (`EXECUTABLE_ITEM_KINDS`), which it does not today.
    const ballotBuilt =
      rule.how === "act" ||
      rule.pen === "dial" ||
      rule.pen === "purpose" ||
      (rule.pen === "module" && EXECUTABLE_ITEM_KINDS.has("module_lifecycle"));
    return {
      pen: rule.pen,
      how: rule.how,
      who: rule.who,
      sentence: canvasPenSentence(rule),
      ballotBuilt,
      youMayAdopt:
        ballotBuilt &&
        (proposedBy !== undefined && filesAProposal(rule) ? String(user.id) === proposedBy : await mayTake(req, user, rule)),
    };
  };

  /** A suggestion as the page renders it. The purpose line is absent where the field does not exist. */
  const proposalView = async (req: Request, user: any, p: CanvasProposalRow, facts: CanvasPenFacts) => {
    const rule = ruleFor(p, facts);
    // Before the Birthing the care door is written by the exit-policy save,
    // which refuses it outright while a conflict agreement is stored.
    const careDoorHeld = p.status === "open" && p.door === "exit:restorative" && rule.how === "act" && deps.exitPolicy.agreementStored();
    return {
      id: p.id,
      blockId: p.blockId,
      target: p.target,
      sectionId: p.sectionId,
      door: p.door,
      change: p.change,
      body: p.body,
      ...(servesPurposeScoped(p.blockId, p.target) ? { servesPurpose: p.servesPurpose } : {}),
      source: p.source,
      proposedBy: { id: p.proposedBy, name: firstName(p.proposerName ?? "") },
      createdAt: p.createdAt,
      status: p.status,
      ...(p.status !== "open"
        ? {
            decidedBy: p.decidedBy,
            decidedByName: firstName(p.deciderName ?? ""),
            decisionNote: p.decisionNote,
            decidedAt: p.decidedAt,
            outcome: p.outcome,
          }
        : {}),
      ...(careDoorHeld ? { cannotAdopt: CARE_DOOR_HELD_BY_AGREEMENT } : {}),
      pen: await penView(req, user, rule, p.proposedBy),
      youProposedIt: String(user.id) === p.proposedBy,
    };
  };

  /**
   * A decided suggestion as Adopt lists it under "Decided lately": what it
   * said, who decided and when, how, and the note. No pen, since nothing is
   * left to press.
   */
  const decidedView = (user: any, p: CanvasProposalRow) => ({
    id: p.id,
    blockId: p.blockId,
    target: p.target,
    sectionId: p.sectionId,
    door: p.door,
    change: p.change,
    body: p.body,
    ...(servesPurposeScoped(p.blockId, p.target) ? { servesPurpose: p.servesPurpose } : {}),
    source: p.source,
    proposedBy: { id: p.proposedBy, name: firstName(p.proposerName ?? "") },
    createdAt: p.createdAt,
    status: p.status,
    withdrawn: p.outcome?.withdrawn === true,
    filed: p.outcome?.filed === "mechanics-proposal",
    decidedBy: { id: p.decidedBy ?? "", name: firstName(p.deciderName ?? "") },
    decisionNote: p.outcome?.withdrawn === true && p.decisionNote === WITHDRAWN_NOTE ? null : p.decisionNote,
    decidedAt: p.decidedAt,
    youProposedIt: String(user.id) === p.proposedBy,
  });

  /**
   * Tell the member who made a suggestion that it was decided, and how, once
   * per suggestion and outcome. Nobody is told of their own act: a withdrawal,
   * or an author filing their own suggestion as a proposal, which only the
   * author may do. The pen's note travels with it, except on a suggestion to
   * the four administrators' sections, whose words stay in the app. A notice
   * is a trace and never the deed: a failure here changes nothing already
   * decided.
   */
  const tellAuthor = async (p: CanvasProposalRow, outcome: "adopted" | "declined", deciderId: string, note: string) => {
    if (p.proposedBy === deciderId) return;
    const title = `Your suggestion on the canvas's ${CANVAS_BLOCKS[p.blockId].name} block was ${outcome}`;
    const kept = p.target === "words" && isAdminOnlySection(String(p.sectionId ?? ""));
    const body = !note
      ? "It is listed under Decided lately on the block's Adopt frame."
      : kept
        ? "Its note is under Decided lately on the block's Adopt frame."
        : `The note with it: ${note}`;
    try {
      await deps.notify({
        userId: p.proposedBy,
        type: "governance",
        title,
        body,
        link: "/journey-to-launch?view=canvas",
        actorUserId: deciderId,
        dedupeKey: `canvas-proposal:${p.id}:${outcome}`,
      });
    } catch {
      // The spine never throws into a producer; this guards a host that might.
    }
  };

  /** Signed in and in the village, or the answer that says why not. Null means carry on. */
  const refuseReader = async (req: Request, res: Response): Promise<any | null> => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    if (!(await mayReadCanvas(deps, req, user))) {
      res.status(403).json({ error: CANVAS_MEMBERS_ONLY });
      return null;
    }
    return user;
  };

  // ── GET /api/canvas/blocks/:id ─────────────────────────────────────────────
  app.get("/api/canvas/blocks/:id", async (req, res) => {
    const user = await refuseReader(req, res);
    if (!user) return;
    const id = String(req.params.id);
    if (!isCanvasBlockId(id)) return res.status(404).json({ error: "That is not one of the twelve canvas blocks." });
    const pool = getPool();
    const admin = await isAdmin(req);
    const ctx = await capabilityCtx(user);
    const block = CANVAS_BLOCKS[id];

    // SAY: the adopted words, per section. An admin reads every row; a member
    // reads the rows the brief opened to members, and never the four sections
    // plan 2.3 keeps with administrators, whatever their audience column says.
    // A row that exists and is not opened to members says so ("not-shared")
    // instead of reading as blank, so a member is never told nothing is written
    // where something is.
    const rows = await briefAll(pool, "admin");
    const byId = new Map<string, BriefRow>(rows.map((r) => [r.section, r]));
    const sections = block.briefSections.map((section) => {
      const spec = BRIEF_BY_ID[section];
      const stored = byId.get(section);
      const adminOnly = isAdminOnlySection(section);
      const readable = admin || (!adminOnly && (!stored || stored.audience === "member"));
      const row = readable ? stored : undefined;
      return {
        id: section,
        title: spec?.title ?? section,
        readable,
        status: row ? row.status : readable ? "blank" : adminOnly ? "admin-only" : "not-shared",
        ...(row ? { body: row.body, audience: row.audience, updatedAt: row.updatedAt, revision: row.revision } : {}),
      };
    });
    const purposeDoc = id === "purpose" ? await governingPurpose(pool) : null;

    // SENSE: this block's newest reading, the same row GET /api/canvas serves.
    const latest = (await allCanvasReadings(pool)).find((r) => r.blockId === id) ?? null;

    // SEE: plain facts from the live system, each with its control.
    const observed = await observedFacts(id, {
      pool,
      viewer: {
        id: String(user.id),
        isAdmin: admin,
        holds: (cap) => capabilityDecision(cap, ctx).allowed,
      },
      readExitPolicy: deps.exitPolicy.readExitPolicy,
      loadRoles: deps.loadRoles,
      roleHolders: deps.roleHolders,
      tools: deps.tools,
      submissions: deps.submissions,
      legalEntityLabel: deps.legalEntityLabel,
      seasonNow: deps.seasonNow,
    });

    // ADOPT: the open suggestions, each with its pen, and the decided ones
    // with their notes. A suggestion for a section only administrators read
    // is shown to administrators and to the member who wrote it.
    const facts = await penFacts();
    const viewer = String(user.id);
    const open = (await openProposalsForBlock(pool, id)).filter((p) => readableSuggestion(p, admin, viewer));
    const proposals = [];
    for (const p of open) proposals.push(await proposalView(req, user, p, facts));
    const decided = (await decidedProposalsForBlock(pool, id)).filter((p) => readableSuggestion(p, admin, viewer)).map((p) => decidedView(user, p));

    const doors = [
      ...doorsForBlock(id).map((d) => ({
        id: d.id,
        label: d.label,
        href: d.href,
        kind: d.kind,
        wired: true,
        ...(d.kind === "dial" && d.dialKey ? { dial: dialFacts(d.dialKey) } : {}),
      })),
      ...UNWIRED_DOORS.filter((d) => d.block === id).map((d) => ({ label: d.label, href: d.href, why: d.why, wired: false })),
    ];

    const pens: Record<string, unknown> = {};
    if (block.briefSections.some((s) => !isAdminOnlySection(s))) pens.words = await penView(req, user, whoAdoptsCanvasAnswer("prose", facts));
    if (block.briefSections.some((s) => isAdminOnlySection(s))) pens.adminWords = await penView(req, user, whoAdoptsCanvasAnswer("admin", facts));
    if (id === "purpose") pens.purpose = await penView(req, user, whoAdoptsCanvasAnswer("purpose", facts));
    if (doorsForBlock(id).some((d) => d.kind === "dial")) pens.dial = await penView(req, user, whoAdoptsCanvasAnswer("dial", facts));
    for (const d of doorsForBlock(id).filter((x) => x.kind === "module")) {
      pens.module = await penView(req, user, ruleFor({ target: "setting", door: d.id }, facts));
    }
    if (id === "power" || doorsForBlock(id).some((d) => d.kind === "exit-policy")) {
      pens.consequence = await penView(req, user, whoAdoptsCanvasAnswer("consequence", facts));
    }

    const hasStatement = hasGoverningPurpose(purposeDoc ?? (await governingPurpose(pool)));
    res.json({
      block: blockView(id),
      answer: {
        sections,
        ...(purposeDoc
          ? { purposeStatement: hasGoverningPurpose(purposeDoc) ? { statement: purposeDoc.statement, writtenAt: purposeDoc.writtenAt } : null }
          : {}),
      },
      reading: latest ? readingView(latest, firstName) : null,
      observed,
      proposals,
      decided,
      doors,
      pens,
      birthed: facts.birthed,
      // Before the Birthing, a stored conflict agreement holds the care door,
      // and the exit-policy save refuses a canvas write to it.
      careDoorInAgreement: !facts.birthed && doorsForBlock(id).some((d) => d.id === "exit:restorative") && deps.exitPolicy.agreementStored(),
      servesPurpose: {
        scoped: servesPurposeScoped(id, "words"),
        matrixScoped: id === "power",
        requiredToday: hasStatement,
      },
      notesArePublic: NOTE_IS_PUBLIC,
    });
  });

  // ── POST /api/canvas/proposals ─────────────────────────────────────────────
  app.post("/api/canvas/proposals", async (req, res) => {
    const user = await refuseReader(req, res);
    if (!user) return;
    const parsed = parseCanvasProposal(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const input = parsed.proposal;
    const pool = getPool();
    // A member writes as a member. Marking a suggestion as drafted from the
    // live system or imported is an administrator's act, so a member cannot
    // make their own words look like a machine's.
    if (input.source !== "member" && !(await isAdmin(req))) {
      return res.status(403).json({ error: "A member's suggestion is marked as theirs. Only an administrator marks one as drafted or imported." });
    }
    const scoped = servesPurposeScoped(input.blockId, input.target);
    const hasStatement = hasGoverningPurpose(await governingPurpose(pool));
    const lineProblem = servesPurposeProblem(scoped, req.body?.servesPurpose, hasStatement);
    if (lineProblem) return res.status(400).json({ error: lineProblem });
    // A dial value the dial itself will never take is refused now, in the
    // dial's own terms, so nobody files a suggestion that no pen can adopt.
    // Whether the value may be written TODAY (the gate, the ring floor) is
    // still the dial write's question, asked at adoption.
    if (input.target === "setting" && input.door && CANVAS_DOORS[input.door].kind === "dial") {
      const problem = dialValueProblem(String(CANVAS_DOORS[input.door].dialKey), String((input.change as { value?: unknown } | null)?.value ?? ""));
      if (problem) return res.status(400).json({ error: problem });
    }
    if ((await openProposalCountBy(pool, String(user.id))) >= OPEN_PROPOSALS_PER_MEMBER) {
      return res.status(429).json({
        error: `You have ${OPEN_PROPOSALS_PER_MEMBER} suggestions open already. Once some are adopted or declined you can add more.`,
      });
    }
    const line = typeof req.body?.servesPurpose === "string" ? req.body.servesPurpose.trim() : "";
    const newId = await insertCanvasProposal(pool, {
      ...input,
      proposedBy: String(user.id),
      servesPurpose: scoped && line ? line : null,
    });
    const saved = await canvasProposalById(pool, newId);
    if (!saved) return res.status(500).json({ error: "The suggestion was written and could not be read back." });
    res.status(201).json({ proposal: await proposalView(req, user, saved, await penFacts()) });
  });

  /** A suggestion by its id in the path, or the answer that says why not. */
  const proposalFromPath = async (req: Request, res: Response): Promise<CanvasProposalRow | null> => {
    const id = Number(req.params.id);
    const p = Number.isInteger(id) && id > 0 ? await canvasProposalById(getPool(), id) : null;
    if (!p) {
      res.status(404).json({ error: "There is no suggestion by that number." });
      return null;
    }
    if (p.status !== "open") {
      res.status(409).json({ error: `This suggestion was already ${p.status}.`, status: p.status });
      return null;
    }
    return p;
  };

  /**
   * The exit-policy body a Team or Conflict suggestion would save: the policy
   * as every reader sees it, with the suggestion's fields laid over it. The
   * save itself reads the stored document for the closing section, so nothing
   * it owns is carried from here.
   */
  const exitBodyWith = (door: string, change: Record<string, unknown>) => {
    const current: any = deps.exitPolicy.readExitPolicy() ?? {};
    const body: any = {
      placeholder: current.placeholder === true,
      voluntary: { ...(current.voluntary ?? {}) },
      involuntary: { ...(current.involuntary ?? {}) },
      restorative: { ...(current.restorative ?? {}) },
    };
    if (door === "exit:terms") {
      const c = change as ExitTermsChange;
      if (c.noticePeriodDays !== undefined) body.voluntary.noticePeriodDays = c.noticePeriodDays;
      if (c.valuationMethod !== undefined) body.voluntary.valuationMethod = c.valuationMethod;
      if (c.unwindSteps !== undefined) body.voluntary.unwindSteps = c.unwindSteps;
      if (c.involuntaryProcess !== undefined) body.involuntary.process = c.involuntaryProcess;
    } else {
      const c = change as RestorativeChange;
      if (c.steps !== undefined) body.restorative.steps = c.steps;
      if (c.intakeContactRole !== undefined) body.restorative.intakeContactRole = c.intakeContactRole;
      if (c.coverRole !== undefined) body.restorative.coverRole = c.coverRole;
      if (c.replyHours !== undefined) body.restorative.replyHours = c.replyHours;
    }
    return body;
  };

  /** What a filed mechanics proposal says for itself: the suggestion, its purpose line, and where it came from. */
  const rationaleFor = (p: CanvasProposalRow): string =>
    [p.body, p.servesPurpose ? `How it serves the purpose: ${p.servesPurpose}` : "", `Suggested on the canvas's ${CANVAS_BLOCKS[p.blockId].name} block.`]
      .filter(Boolean)
      .join("\n\n");

  /**
   * What a filing says. An open proposal goes to the village; a draft (its
   * author is below the proposer bar) waits for a sponsor, and the mechanics
   * door's own sentence says so.
   */
  const filedMessage = (body: Record<string, unknown>): string =>
    body.status === "open"
      ? "Filed as a proposal to change the Game's rules. The village decides it."
      : String(body.message ?? "Filed as a draft proposal. It opens once a qualified member sponsors it.");

  type Effect = { ok: true; outcome: Record<string, unknown>; message: string } | { ok: false; status: number; body: Record<string, unknown> };

  /**
   * Carry out one adoption. Every refusal comes back as `ok: false` with the
   * status and body the person hears, and nothing has changed.
   */
  const adopt = async (req: Request, res: Response, user: any, p: CanvasProposalRow): Promise<Effect | "answered"> => {
    const pool = getPool();
    const facts = await penFacts();
    const pen = penForProposal(p);
    const rule = ruleFor(p, facts);
    const block = CANVAS_BLOCKS[p.blockId];

    if (pen === "prose" || pen === "admin") {
      if (pen === "prose") {
        // The ONE gate, with its own override hatch. A refusal is written by the guard.
        if (!(await guardCapability(req, res, "story.tell", { status: 403, body: { error: PEN_REFUSALS.prose } }))) return "answered";
      } else if (!(await isAdmin(req))) {
        return { ok: false, status: 403, body: { error: PEN_REFUSALS.admin } };
      }
      const row = await briefWrite(pool, { section: String(p.sectionId), body: p.body, source: "admin", confirmedBy: String(user.id) });
      void recordEvent(pool, {
        kind: "audit", text: `brain:write:${row.section}:r${row.revision}:${row.audience}:canvas-${p.id}`, actorUserId: String(user.id),
        entityType: "brain", entityRef: row.section, audience: "admin",
      });
      return {
        ok: true,
        outcome: { wrote: "brief-section", section: row.section, revision: row.revision },
        message: `Adopted. ${BRIEF_BY_ID[row.section]?.title ?? row.section} now reads as suggested.`,
      };
    }

    if (pen === "purpose") {
      if (rule.how === "ballot") {
        return {
          ok: false,
          status: 409,
          body: { error: canvasPenSentence(rule), door: PURPOSE_CHANGE_DOOR },
        };
      }
      // The same test PUT /api/admin/purpose applies, then its own refusal.
      if (!(await isAdmin(req))) return { ok: false, status: 403, body: { error: PEN_REFUSALS.purpose } };
      const penGone = await founderPenRefusal(pool);
      if (penGone) return { ok: false, status: 409, body: { error: penGone, door: PURPOSE_CHANGE_DOOR } };
      const written = await writeGoverningPurpose(pool, { statement: p.body, writtenBy: String(user.id) });
      if (!written.ok) return { ok: false, status: 400, body: { error: written.error } };
      await deps.addActivity("governance", "This village wrote down what it is for.", {
        actorUserId: String(user.id), entityType: "app_config", entityRef: "gps",
      });
      return { ok: true, outcome: { wrote: "purpose-statement", writtenAt: written.doc.writtenAt }, message: "Adopted. The governing purpose statement now reads as suggested." };
    }

    if (pen === "dial") {
      const door = CANVAS_DOORS[p.door!];
      const value = String((p.change as { value?: unknown } | null)?.value ?? "");
      if (rule.how === "act") {
        // Before the Birthing: the dial write, with the request in hand.
        const answer = await writeDial(deps.dialWrite, req, String(door.dialKey), value);
        // The dial write answers 401 to anybody the gate refuses without a
        // hatch, because its own door is an admin panel. Here the person is
        // signed in and in the village, so the same refusal is said as what it
        // is: the pen is somebody else's. Every other answer passes through.
        if (answer.status === 401) return { ok: false, status: 403, body: { error: PEN_REFUSALS.dial } };
        if (answer.status !== 200) return { ok: false, status: answer.status, body: answer.body };
        return {
          ok: true,
          outcome: { wrote: "dial", key: door.dialKey, value: answer.body.value ?? value, previous: answer.body.previous ?? null },
          message: `Adopted. ${door.label} is now set as suggested.`,
        };
      }
      // After the Birthing: the proposal that would change it, filed by the
      // member who wrote the suggestion and by nobody else.
      if (p.proposedBy !== String(user.id)) return { ok: false, status: 403, body: { error: FILED_BY_PROPOSER } };
      const rationale = rationaleFor(p);
      const filed = await openMechanicsProposal(deps.mechanicsPropose, user, {
        title: `${block.name}: ${door.label}`.slice(0, 200),
        rationale,
        changes: [{ key: door.dialKey, to: value }],
      });
      if (filed.status !== 200) return { ok: false, status: filed.status, body: filed.body };
      return {
        ok: true,
        outcome: { filed: "mechanics-proposal", id: filed.body.id, status: filed.body.status },
        message: filedMessage(filed.body),
      };
    }

    if (pen === "module") {
      const door = CANVAS_DOORS[p.door!];
      const to = String((p.change as { to?: unknown } | null)?.to ?? "");
      if (rule.how === "act") {
        // Before the Birthing: the lifecycle route's own guard, then its write.
        if (!(await isAdmin(req))) return { ok: false, status: 403, body: { error: PEN_REFUSALS.module } };
        const sharedOnly = await deps.sharedPasswordPosture();
        const result = await setModuleLifecycle(String(door.moduleId), to as any, String(user.id), { sharedPasswordPosture: () => sharedOnly });
        if (!result.ok) {
          const { status, ...body } = result as { ok: false; status: number } & Record<string, unknown>;
          return { ok: false, status, body };
        }
        // Governance reaching members is a funding moment (plan 4.2). Fire and forget.
        raiseCanvasRevisitForLifecycle(deps.getPool(), String(door.moduleId));
        return {
          ok: true,
          outcome: { wrote: "module-lifecycle", module: door.moduleId, lifecycle: result.lifecycle },
          // In the lifecycle's words, never its code ("preview" is nowhere on the page).
          message: `Adopted. ${door.label}: ${MODULE_LIFECYCLE_WORDS[result.lifecycle as keyof typeof MODULE_LIFECYCLE_WORDS] ?? result.lifecycle}.`,
        };
      }
      // After the Birthing: the proposal that would change it, filed by its
      // author, as for a dial. The mechanics validator answers for itself
      // whether this build can carry it out.
      if (p.proposedBy !== String(user.id)) return { ok: false, status: 403, body: { error: FILED_BY_PROPOSER } };
      const filed = await openMechanicsProposal(deps.mechanicsPropose, user, {
        title: `${block.name}: ${door.label}`.slice(0, 200),
        rationale: rationaleFor(p),
        changes: [{ kind: "module_lifecycle", moduleId: door.moduleId, to }],
      });
      if (filed.status !== 200) return { ok: false, status: filed.status, body: filed.body };
      return {
        ok: true,
        outcome: { filed: "mechanics-proposal", id: filed.body.id, status: filed.body.status },
        message: filedMessage(filed.body),
      };
    }

    // The consequence pen: the exit terms, the care door and the matrix.
    if (rule.how === "ballot") {
      return { ok: false, status: 409, body: { error: p.door === "exit:restorative" ? CARE_DOOR_IS_THE_AGREEMENT_VOTE : CONSEQUENCE_VOTE_NOT_BUILT } };
    }
    if (!(await isAdmin(req))) return { ok: false, status: 403, body: { error: PEN_REFUSALS.consequence } };
    if (p.target === "matrix") {
      const parsed = parseMatrixRow(p.change);
      if (!parsed.ok) return { ok: false, status: 400, body: { error: parsed.error } };
      // A suggestion only ever adds a row: `parseCanvasProposal` refuses a
      // `rowId`, and one on a stored row is not honoured, because the card
      // never showed which row it would overwrite.
      const { rowId: _notHonoured, ...row } = parsed.row;
      const rowId = await writeDecisionMatrixRow(pool, row as MatrixRowChange, String(user.id));
      if (!rowId) return { ok: false, status: 500, body: { error: "The row could not be written." } };
      return { ok: true, outcome: { wrote: "matrix-row", rowId }, message: "Adopted. The Decision Matrix carries this row." };
    }
    const answer = await saveExitPolicy(deps.exitPolicy, req, exitBodyWith(String(p.door), p.change ?? {}));
    // The save's own sentence speaks to the Departures editor ("reload this
    // page to edit the rest of the policy"), which is not where this is.
    if (answer.status === 409 && answer.body.error === "restorative_in_agreement") {
      return { ok: false, status: 409, body: { error: "restorative_in_agreement", message: CARE_DOOR_IN_AGREEMENT } };
    }
    if (answer.status !== 200) return { ok: false, status: answer.status, body: answer.body };
    return {
      ok: true,
      outcome: { wrote: "exit-policy", door: p.door, fields: Object.keys(p.change ?? {}) },
      message: `Adopted. ${CANVAS_DOORS[p.door!].label} now reads as suggested.`,
    };
  };

  // ── POST /api/canvas/proposals/:id/adopt ───────────────────────────────────
  app.post("/api/canvas/proposals/:id/adopt", async (req, res) => {
    const user = await refuseReader(req, res);
    if (!user) return;
    const first = await proposalFromPath(req, res);
    if (!first) return;
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
    const pool = getPool();
    const run = await withNamedLock(pool, `canvas-proposal:${first.id}`, async () => {
      const p = await canvasProposalById(pool, first.id);
      if (!p || p.status !== "open") return { status: 409, body: { error: `This suggestion was already ${p?.status ?? "removed"}.` } };
      const effect = await adopt(req, res, user, p);
      if (effect === "answered") return "answered" as const;
      if (!effect.ok) return { status: effect.status, body: effect.body };
      const moved = await decideCanvasProposal(pool, {
        id: p.id, status: "adopted", decidedBy: String(user.id), note: note || null, outcome: effect.outcome,
      });
      if (!moved) return { status: 409, body: { error: "This suggestion was decided by somebody else at the same moment." } };
      void recordEvent(pool, {
        kind: "audit", text: `canvas:adopt:${p.id}:${penForProposal(p)}`, actorUserId: String(user.id),
        entityType: "canvas_proposal", entityRef: String(p.id), audience: "admin",
      });
      const saved = await canvasProposalById(pool, p.id);
      return {
        status: 200,
        body: { proposal: saved ? await proposalView(req, user, saved, await penFacts()) : null, outcome: effect.outcome, message: effect.message },
      };
    });
    if (!run.ran) return res.status(409).json({ error: BEING_DECIDED });
    if (run.value === "answered") return;
    // Told once the lock is released, so a slow mailer never holds it.
    if (run.value.status === 200) await tellAuthor(first, "adopted", String(user.id), note);
    res.status(run.value.status).json(run.value.body);
  });

  // ── POST /api/canvas/proposals/:id/decline ─────────────────────────────────
  app.post("/api/canvas/proposals/:id/decline", async (req, res) => {
    const user = await refuseReader(req, res);
    if (!user) return;
    const first = await proposalFromPath(req, res);
    if (!first) return;
    const pool = getPool();
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
    const withdrawing = first.proposedBy === String(user.id);
    const run = await withNamedLock(pool, `canvas-proposal:${first.id}`, async () => {
      const p = await canvasProposalById(pool, first.id);
      if (!p || p.status !== "open") return { status: 409, body: { error: `This suggestion was already ${p?.status ?? "removed"}.` } };
      if (!withdrawing) {
        // The pen declines, and says why. A vote cannot be declined by one
        // person, so where the pen is the village's vote only the proposer
        // can take a suggestion back.
        if (note.length < 2) return { status: 400, body: { error: "Say in a sentence why this is declined. The note is public, like the suggestion." } };
        const rule = ruleFor(p, await penFacts());
        if (rule.how === "ballot") {
          return { status: 409, body: { error: "The village decides this by vote, so nobody declines it alone. The member who suggested it can withdraw it." } };
        }
        if (rule.who === "the-gate" && rule.capability) {
          const refusal = rule.capability === "story.tell" ? PEN_REFUSALS.prose : PEN_REFUSALS.dial;
          if (!(await guardCapability(req, res, rule.capability, { status: 403, body: { error: refusal } }))) return "answered" as const;
        } else if (!(await isAdmin(req))) {
          return { status: 403, body: { error: PEN_REFUSALS[rule.pen] } };
        }
      }
      const moved = await decideCanvasProposal(pool, {
        id: p.id,
        status: "declined",
        decidedBy: String(user.id),
        note: withdrawing ? note || WITHDRAWN_NOTE : note,
        outcome: withdrawing ? { withdrawn: true } : null,
      });
      if (!moved) return { status: 409, body: { error: "This suggestion was decided by somebody else at the same moment." } };
      void recordEvent(pool, {
        kind: "audit", text: `canvas:${withdrawing ? "withdraw" : "decline"}:${p.id}`, actorUserId: String(user.id),
        entityType: "canvas_proposal", entityRef: String(p.id), audience: "admin",
      });
      const saved = await canvasProposalById(pool, p.id);
      return { status: 200, body: { proposal: saved ? await proposalView(req, user, saved, await penFacts()) : null } };
    });
    if (!run.ran) return res.status(409).json({ error: BEING_DECIDED });
    if (run.value === "answered") return;
    // A withdrawal is the author's own act, and `tellAuthor` skips it.
    if (run.value.status === 200) await tellAuthor(first, "declined", String(user.id), note);
    res.status(run.value.status).json(run.value.body);
  });

  // ── The Decision Matrix's human rows ───────────────────────────────────────

  /** Who writes a row today, and whether this person may. Null means carry on. */
  const refuseMatrixWriter = async (req: Request, res: Response): Promise<any | null> => {
    const user = await refuseReader(req, res);
    if (!user) return null;
    const rule = whoAdoptsCanvasAnswer("consequence", await penFacts());
    if (rule.how === "ballot") {
      res.status(409).json({
        error: `${CONSEQUENCE_VOTE_NOT_BUILT} Suggest the row on the Power block in the meantime.`,
      });
      return null;
    }
    if (!(await isAdmin(req))) {
      res.status(403).json({ error: PEN_REFUSALS.consequence });
      return null;
    }
    return user;
  };

  app.get("/api/canvas/decision-matrix/rows", async (req, res) => {
    const user = await refuseReader(req, res);
    if (!user) return;
    const rows = await allDecisionMatrixRows(getPool());
    res.json({
      rows: rows.map((r) => matrixRowView(r, firstName)),
      pen: await penView(req, user, whoAdoptsCanvasAnswer("consequence", await penFacts())),
      riskTagsAreInformation: "Risk tags are information. None of them changes who decides or how.",
    });
  });

  /** The write itself, once the handler has asked the consequence pen. */
  const writeRow = async (req: Request, res: Response, user: any, rowId?: number) => {
    const parsed = parseMatrixRow({ ...(req.body ?? {}), rowId });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const pool = getPool();
    const id = await writeDecisionMatrixRow(pool, parsed.row, String(user.id));
    if (!id) return res.status(404).json({ error: "There is no matrix row by that number." });
    void recordEvent(pool, {
      kind: "audit", text: `canvas:matrix-row:${rowId ? "update" : "create"}:${id}`, actorUserId: String(user.id),
      entityType: "decision_matrix_row", entityRef: String(id), audience: "admin",
    });
    const saved = await decisionMatrixRowById(pool, id);
    res.status(rowId ? 200 : 201).json({ row: saved ? matrixRowView(saved, firstName) : null });
  };

  app.post("/api/canvas/decision-matrix/rows", async (req, res) => {
    const user = await refuseMatrixWriter(req, res);
    if (!user) return;
    return writeRow(req, res, user);
  });

  app.put("/api/canvas/decision-matrix/rows/:id", async (req, res) => {
    const id = Number(req.params.id);
    const user = await refuseMatrixWriter(req, res);
    if (!user) return;
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: "There is no matrix row by that number." });
    return writeRow(req, res, user, id);
  });

  app.delete("/api/canvas/decision-matrix/rows/:id", async (req, res) => {
    const user = await refuseMatrixWriter(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    const pool = getPool();
    if (!Number.isInteger(id) || id <= 0 || !(await removeDecisionMatrixRow(pool, id))) {
      return res.status(404).json({ error: "There is no matrix row by that number." });
    }
    void recordEvent(pool, {
      kind: "audit", text: `canvas:matrix-row:remove:${id}`, actorUserId: String(user.id),
      entityType: "decision_matrix_row", entityRef: String(id), audience: "admin",
    });
    res.json({ removed: id });
  });
}
