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
 *
 * A refusal from the setting is answered as it came, and the suggestion stays
 * open: nothing is recorded as adopted that did not happen.
 *
 * After the Birthing, a dial door files a mechanics proposal through
 * `openMechanicsProposal` (server/lib/mechanicsPropose.ts), the body of
 * `POST /api/game/mechanics/proposals`, and the village decides it. The
 * consequence pen's vote (the exit terms, the care door and the matrix, at the
 * structural tier) has no machinery yet, so those answer 409 and say so; the
 * purpose statement's vote already has its own route and the answer names it.
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
  isAdminOnlySection,
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
import { openMechanicsProposal, type MechanicsProposeDeps } from "../lib/mechanicsPropose";
import type { IntakeHolding } from "../lib/restorativeIntake";
import { briefAll, briefWrite, type BriefRow } from "../lib/villageBrain";
import { allCanvasReadings, type CanvasReadingRow } from "../repos/canvasReadings";
import {
  canvasProposalById,
  decideCanvasProposal,
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

export interface CanvasFrameDeps
  extends Pick<
    AppDeps,
    "authedUser" | "isAdmin" | "hasMembership" | "guardCapability" | "capabilityCtx" | "getPool" | "firstName" | "loadRoles"
  > {
  /** Every role_holders row, for the See frame's care role and seat terms. */
  roleHolders(): ReadonlyArray<IntakeHolding>;
  /** The exit-policy save's own collaborators, handed to `saveExitPolicy` whole. */
  exitPolicy: ExitPolicySaveDeps;
  /** The dial write's collaborators, handed to `writeDial` whole. */
  dialWrite: DialWriteDeps;
  /** The mechanics proposal's collaborators, handed to `openMechanicsProposal` whole. */
  mechanicsPropose: MechanicsProposeDeps;
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
  admin: "This section stays with the administrators. You can suggest words, and they decide.",
};

/** The consequence pen's vote, which nothing builds yet. */
export const CONSEQUENCE_VOTE_NOT_BUILT =
  "The Game has started, so this goes to a vote of the whole village at the structural tier. " +
  "That vote is not built yet, so this suggestion stays open until it is.";

/** A suggestion somebody else is deciding at this moment. */
export const BEING_DECIDED = "Somebody is deciding this suggestion right now. Look again in a moment.";

/** The purpose statement's vote has its own door. */
export const PURPOSE_CHANGE_DOOR = "/api/governance/purpose-changes";

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

export function register(app: Express, deps: CanvasFrameDeps): void {
  const { authedUser, isAdmin, capabilityCtx, getPool, firstName, guardCapability } = deps;

  /** The Birthing and the handover, read live every time a pen is asked. */
  const penFacts = async (): Promise<CanvasPenFacts> => {
    const pool = getPool();
    const [start, handover] = await Promise.all([readGameStart(pool), villageHandoverState(pool)]);
    return { birthed: start.started, handoverComplete: handover.complete };
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

  const penView = async (req: Request, user: any, rule: CanvasAdoptionRule) => {
    const ballotBuilt = rule.how === "act" || rule.pen === "dial" || rule.pen === "purpose";
    return {
      pen: rule.pen,
      how: rule.how,
      who: rule.who,
      sentence: canvasPenSentence(rule),
      ballotBuilt,
      youMayAdopt: ballotBuilt && (await mayTake(req, user, rule)),
    };
  };

  /** A suggestion as the page renders it. The purpose line is absent where the field does not exist. */
  const proposalView = async (req: Request, user: any, p: CanvasProposalRow, facts: CanvasPenFacts) => {
    const rule = whoAdoptsCanvasAnswer(penForProposal(p), facts);
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
        ? { decidedBy: p.decidedBy, decisionNote: p.decisionNote, decidedAt: p.decidedAt, outcome: p.outcome }
        : {}),
      pen: await penView(req, user, rule),
      youProposedIt: String(user.id) === p.proposedBy,
    };
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

    // ADOPT: the open suggestions, each with its pen. A suggestion for a
    // section only administrators read is shown to administrators and to the
    // member who wrote it.
    const facts = await penFacts();
    const open = (await openProposalsForBlock(pool, id)).filter(
      (p) => admin || p.target !== "words" || !isAdminOnlySection(String(p.sectionId ?? "")) || p.proposedBy === String(user.id),
    );
    const proposals = [];
    for (const p of open) proposals.push(await proposalView(req, user, p, facts));

    const doors = [
      ...doorsForBlock(id).map((d) => ({ id: d.id, label: d.label, href: d.href, kind: d.kind, wired: true })),
      ...UNWIRED_DOORS.filter((d) => d.block === id).map((d) => ({ label: d.label, href: d.href, why: d.why, wired: false })),
    ];

    const pens: Record<string, unknown> = {};
    if (block.briefSections.some((s) => !isAdminOnlySection(s))) pens.words = await penView(req, user, whoAdoptsCanvasAnswer("prose", facts));
    if (block.briefSections.some((s) => isAdminOnlySection(s))) pens.adminWords = await penView(req, user, whoAdoptsCanvasAnswer("admin", facts));
    if (id === "purpose") pens.purpose = await penView(req, user, whoAdoptsCanvasAnswer("purpose", facts));
    if (doorsForBlock(id).some((d) => d.kind === "dial")) pens.dial = await penView(req, user, whoAdoptsCanvasAnswer("dial", facts));
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
      doors,
      pens,
      birthed: facts.birthed,
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

  type Effect = { ok: true; outcome: Record<string, unknown>; message: string } | { ok: false; status: number; body: Record<string, unknown> };

  /**
   * Carry out one adoption. Every refusal comes back as `ok: false` with the
   * status and body the person hears, and nothing has changed.
   */
  const adopt = async (req: Request, res: Response, user: any, p: CanvasProposalRow): Promise<Effect | "answered"> => {
    const pool = getPool();
    const facts = await penFacts();
    const pen = penForProposal(p);
    const rule = whoAdoptsCanvasAnswer(pen, facts);
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
      // After the Birthing: the proposal that would change it, filed by the adopter.
      const rationale = [p.body, p.servesPurpose ? `How it serves the purpose: ${p.servesPurpose}` : "", `Suggested on the canvas's ${block.name} block.`]
        .filter(Boolean)
        .join("\n\n");
      const filed = await openMechanicsProposal(deps.mechanicsPropose, user, {
        title: `${block.name}: ${door.label}`.slice(0, 200),
        rationale,
        changes: [{ key: door.dialKey, to: value }],
      });
      if (filed.status !== 200) return { ok: false, status: filed.status, body: filed.body };
      return {
        ok: true,
        outcome: { filed: "mechanics-proposal", id: filed.body.id, status: filed.body.status },
        message: "Filed as a proposal to change the Game's rules. The village decides it.",
      };
    }

    // The consequence pen: the exit terms, the care door and the matrix.
    if (rule.how === "ballot") return { ok: false, status: 409, body: { error: CONSEQUENCE_VOTE_NOT_BUILT } };
    if (!(await isAdmin(req))) return { ok: false, status: 403, body: { error: PEN_REFUSALS.consequence } };
    if (p.target === "matrix") {
      const parsed = parseMatrixRow(p.change);
      if (!parsed.ok) return { ok: false, status: 400, body: { error: parsed.error } };
      const rowId = await writeDecisionMatrixRow(pool, parsed.row as MatrixRowChange, String(user.id));
      if (!rowId) return { ok: false, status: 404, body: { error: "The matrix row this suggestion changes is no longer there." } };
      return { ok: true, outcome: { wrote: "matrix-row", rowId }, message: "Adopted. The Decision Matrix carries this row." };
    }
    const answer = await saveExitPolicy(deps.exitPolicy, req, exitBodyWith(String(p.door), p.change ?? {}));
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
        const rule = whoAdoptsCanvasAnswer(penForProposal(p), await penFacts());
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
        note: withdrawing ? note || "Withdrawn by the member who suggested it." : note,
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
