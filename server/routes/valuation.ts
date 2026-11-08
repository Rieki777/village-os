/**
 * THE VALUATION ENGINE'S ROUTES (0336): the model, a suggestion, and setting a
 * role's pay with the Treasurer AND the algorithm (Rye, 2026-11-06).
 *
 *   GET  /api/valuation/model              every signed-in member reads the model (constitution I.3)
 *   POST /api/valuation/suggest            a suggestion for a piece of work, nothing written
 *   PUT  /api/org/roles/:id/pay            a role.pay holder sets a role's pay beside the suggestion
 *   GET  /api/org/roles/:id/pay/settings   the record of every figure set for a role, members only
 *   POST /api/valuation/settings/:id/sign  a second, different signer signs a figure outside the band
 *
 * THE RULE (shared/valuationSetting.ts, Rye's answers C1, C3, C10). The setter
 * gives the inputs and the figure; the server prices the inputs itself, so the
 * suggestion is never taken from the body. Inside the no-sign band the setter's
 * word stands and the role's pay is written. Outside it, a written reason, and
 * the figure waits for a second signer: a different holder of role.pay or
 * steward.veto, not paid by the role, whose own pay the setter did not set this
 * season. With nobody eligible, or a role that pays the setter, the vote path is
 * named: an org draft carrying the change, put to the village. Nothing is ever
 * refused for its size (II.6).
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { EXAMPLE_REFUSAL_BODY } from "../lib/examples";
import { listOrgAssignments, listOrgRoles, updateOrgRole } from "../lib/orgChart";
import { calibrationRecords, currentModel, payeesSetBy, settingById, settingsForWork, signSetting, writeSetting } from "../lib/valuationStore";
import { payLineProblem, rolePayRules } from "../lib/workPay";
import { defaultDisplayCurrency } from "../../shared/money";
import type { WorkInputs } from "../../shared/valuation";
import { suggestValuation, type PayeeSuggestion } from "../../shared/valuationEngine";
import { calibrate, combineSetting, settingRecord, storedPayFor, topUpProblem, widenRange, type InputChange } from "../../shared/valuationSetting";
import { addChange, createDraft } from "../lib/orgDrafts";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "guardCapability" | "overLimit"> & {
  /** Who holds a power through a role or a badge, admins left out (`liveHoldersOf`, server/index.ts). */
  liveHoldersOf: (capability: string) => Promise<string[]>;
  /** The village's currency (`project.fiatCurrency`). */
  projectCurrency: () => string;
  /** Whether the village has written what Earned Equity is a share of (#892). */
  eeMeaningWritten: () => boolean;
  /** A token's live display name, so a rename reaches the receipt (II.17). Defaults to the slug. */
  tokenName?: (slug: string) => string;
  /** Why a pay line cannot be stored, or null. Defaults to the admin door's own check (`payLineProblem`). */
  payLineCheck?: (rules: Awaited<ReturnType<typeof rolePayRules>>, token: string) => string | null;
};

/** Where a figure goes when no second signer can sign it: the village, by an org draft (constitution 0.3, 0.4). */
export const ROLE_PAY_VOTE_PATH = "/api/org/drafts/:id/put-to-village";

const SEASON_MS = 91 * 24 * 60 * 60 * 1000;

const readInputs = (raw: unknown): WorkInputs | null => {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Partial<WorkInputs>;
  if (!Array.isArray(w.lines)) return null;
  return { ...w, kind: "role", lines: w.lines } as WorkInputs;
};

const readChanges = (raw: unknown): InputChange[] =>
  Array.isArray(raw)
    ? raw
        .filter((c) => c && typeof c === "object")
        .slice(0, 20)
        .map((c: any) => ({ field: String(c.field ?? "").slice(0, 60), from: String(c.from ?? "").slice(0, 120), to: String(c.to ?? "").slice(0, 120) }))
    : [];

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, guardCapability, overLimit, liveHoldersOf, projectCurrency, eeMeaningWritten } = deps;
  const payLineCheck = deps.payLineCheck ?? payLineProblem;
  const currency = () => defaultDisplayCurrency({ fiatCurrency: projectCurrency() });

  app.get("/api/valuation/model", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "auth_required" });
    const model = await currentModel(getPool(), currency());
    const name = deps.tokenName ?? ((s: string) => s);
    res.json({
      model,
      eeMeaningWritten: eeMeaningWritten(),
      tokenNames: { [model.tokens.credits]: name(model.tokens.credits), [model.tokens.equity]: name(model.tokens.equity), [model.tokens.voice]: name(model.tokens.voice) },
    });
  });

  app.post("/api/valuation/suggest", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`valuation-suggest:${user.id}`, 120, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many suggestions in an hour. Try again shortly." });
    const raw = req.body?.work;
    const work = raw && typeof raw === "object" && Array.isArray(raw.lines) ? ({ ...raw, kind: raw.kind === "role" ? "role" : "quest" } as WorkInputs) : null;
    if (!work) return res.status(400).json({ error: "Send the work's effort lines to price." });
    const model = await currentModel(getPool(), currency());
    const s = suggestValuation(model, work, { eeMeaningWritten: eeMeaningWritten() });
    if (!s.ok) return res.status(400).json({ refusals: s.refusals });
    res.json(s);
  });

  /** What a figure stores on the role, or the reason a pay line cannot be stored (the admin door's own check). */
  /*
   * NO VOICE LINE BEFORE THE VILLAGE ADOPTS ITS OWN SCALE (economics lane,
   * 2026-11-08). The platform default model pays 1 Voice per currency unit, so a
   * role set at 200,000 colones on a village that never adopted a model would
   * store 200,000 Voice, and the role.cycle Voice rule (enabled, amount blank)
   * pays whatever the role names. Rye set Amora's scale at 1 Voice per 1,000
   * colones; until a village saves a model of its own (version 0 is the platform
   * default), every write path here stores no Voice line, and says so.
   */
  const rolePayFor = async (figure: number, cashPct: number | undefined, eeHeld: boolean) => {
    const model = await currentModel(getPool(), currency());
    const stored = storedPayFor(model, figure, { cashPct, eeHeld });
    const voiceHeld = model.version === 0;
    const pay = voiceHeld ? { ...stored, valueTokens: stored.valueTokens.filter((t) => t.token !== model.tokens.voice) } : stored;
    const rules = await rolePayRules(getPool());
    for (const t of pay.valueTokens) {
      const problem = payLineCheck(rules, t.token);
      if (problem) return { problem, pay, voiceHeld };
    }
    return { problem: null, pay, voiceHeld };
  };

  /**
   * Open an org draft carrying a role's pay (B3: a draft may carry it), so the
   * village decides it through the draft's own put-to-village vote, at that
   * door's own tier and rules. Returns the draft id, or a problem.
   */
  const openRolePayDraft = async (role: { id: string; name: string }, figure: number, eeHeld: boolean, by: string, title: string): Promise<{ draftId: string } | { problem: string }> => {
    const { problem, pay } = await rolePayFor(figure, undefined, eeHeld);
    if (problem) return { problem };
    const made = await createDraft(getPool(), { title: title.slice(0, 180), createdBy: by, sourceKind: "human", sourceModuleId: null, openCap: null });
    if (!made.ok) return { problem: made.error };
    const added = await addChange(getPool(), made.id, {
      op: "update_seat",
      orgRoleId: role.id,
      payload: { valueMinor: pay.valueMinor, valueTokens: pay.valueTokens, cashMinor: pay.cashMinor },
    });
    if (!added.ok) return { problem: added.error };
    return { draftId: made.id };
  };
  const putToVillage = (draftId: string) => `/api/org/drafts/${draftId}/put-to-village`;

  /** Write a set figure onto the role. Returns a problem, or null. */
  const writeRolePay = async (roleId: string, figure: number, cashPct: number | undefined, eeHeld: boolean): Promise<string | null> => {
    const { problem, pay } = await rolePayFor(figure, cashPct, eeHeld);
    if (problem) return problem;
    const cur = currency();
    await updateOrgRole(getPool(), roleId, {}, {
      valueMinor: pay.valueMinor,
      valueCurrency: cur,
      valueTokens: pay.valueTokens,
      cashMinor: pay.cashMinor,
      cashCurrency: pay.cashMinor === null ? null : cur,
    });
    return null;
  };

  app.put("/api/org/roles/:id/pay", async (req, res) => {
    if (!(await guardCapability(req, res, "role.pay"))) return;
    const actor = await authedUser(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    const role = (await listOrgRoles(getPool())).find((r) => r.id === req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.isExample) return res.status(409).json(EXAMPLE_REFUSAL_BODY);

    const body = req.body ?? {};
    const inputs = readInputs(body.work);
    const figure = Number(body.set?.totalMinor);
    if (!inputs) return res.status(400).json({ error: "Send the role's effort estimate, so the figure is set beside a suggestion." });
    if (!Number.isFinite(figure) || figure < 0) return res.status(400).json({ error: "Say the figure you are setting." });

    const model = await currentModel(getPool(), currency());
    const ee = eeMeaningWritten();
    const s = suggestValuation(model, inputs, { eeMeaningWritten: ee });
    if (!s.ok) return res.status(400).json({ refusals: s.refusals });
    const first: PayeeSuggestion = s.payees[0];

    const payeeIds = (await listOrgAssignments(getPool())).filter((a) => a.orgRoleId === role.id && a.userId).map((a) => String(a.userId));
    const signerPool = Array.from(new Set([...(await liveHoldersOf("role.pay")), ...(await liveHoldersOf("steward.veto"))]));
    const ctx = {
      setterId: String(actor.id),
      payeeIds,
      secondSigners: signerPool,
      setterSetPayOf: await payeesSetBy(getPool(), String(actor.id), new Date(Date.now() - SEASON_MS)),
    };
    const opts = {
      reason: typeof body.reason === "string" ? body.reason : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
      ownNumberFirst: Number.isFinite(Number(body.ownNumberFirst)) && body.ownNumberFirst !== null && body.ownNumberFirst !== undefined ? Number(body.ownNumberFirst) : undefined,
      inputChanges: readChanges(body.inputChanges),
    };
    const decision = combineSetting(first, { totalMinor: figure }, ctx, opts);
    if (decision.missing.length) return res.status(400).json({ error: "This figure is outside the suggestion's band, so give a reason for it.", decision });

    const cashPct = Number.isFinite(Number(body.cashPct)) ? Number(body.cashPct) : undefined;
    // Checked now, whatever the figure needs, so a figure that waits for a signer can be written when it is signed.
    const check = await rolePayFor(figure, cashPct, first.expected.earnedEquityHeld > 0);
    if (check.problem) return res.status(400).json({ error: check.problem });
    if (decision.needs === "none") {
      const problem = await writeRolePay(role.id, figure, cashPct, first.expected.earnedEquityHeld > 0);
      if (problem) return res.status(400).json({ error: problem });
    }
    // With no second signer, the village decides: the draft is opened now, so the vote path is one press away (0.4).
    let draftId: string | null = null;
    if (decision.needs === "vote") {
      const opened = await openRolePayDraft(role, figure, first.expected.earnedEquityHeld > 0, String(actor.id), `Pay for ${role.name}`);
      if ("problem" in opened) return res.status(400).json({ error: opened.problem });
      draftId = opened.draftId;
    }
    const rec = settingRecord({ workKind: "role", workId: 0, category: `role:${inputs.lines[0]?.band ?? "none"}`, first, set: { totalMinor: figure }, ctx, opts, at: new Date().toISOString() });
    const state = decision.needs === "none" ? "set" : decision.needs === "second" ? "awaiting_second" : "awaiting_vote";
    const settingId = await writeSetting(getPool(), rec, { workRef: role.id, state, modelVersion: model.version, currency: model.currency, inputs, suggestion: first, payeeIds, setterId: String(actor.id) });
    await recordEvent(getPool(), {
      kind: "org",
      text: state === "set" ? `${role.name}: pay set beside the valuation engine's suggestion` : `${role.name}: a pay figure waits for ${state === "awaiting_second" ? "a second signer" : "the village"}`,
      actorUserId: String(actor.id),
      entityType: "org_role",
      entityRef: role.id,
      audience: "public", // names nobody, so a member reads it in the seat's journal (R103)
    });
    res.json({
      success: true,
      settingId,
      state,
      decision,
      suggestion: first,
      ...(decision.needs === "vote" ? { proposeInstead: ROLE_PAY_VOTE_PATH, draftId, putToVillage: putToVillage(draftId!) } : {}),
      ...(decision.needs === "second" ? { voteAfterDays: decision.voteAfterDays, proposeInstead: ROLE_PAY_VOTE_PATH } : {}),
    });
  });

  /*
   * P4, THE RETRO TOP-UP (Rye's pick, 2026-11-06). After delivery any member may
   * propose to RAISE a role's set figure, never lower it; the village decides
   * through the existing vote path and tier: an org draft carrying the raise,
   * put to the village. Nothing is written to the role here, and the original
   * record is untouched: the raise is its own record and its own draft.
   */
  app.post("/api/org/roles/:id/pay/top-up", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`valuation-top-up:${user.id}`, 10, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many top-ups proposed in an hour. Try again shortly." });
    const role = (await listOrgRoles(getPool())).find((r) => r.id === req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.isExample) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    const proposed = Number(req.body?.totalMinor);
    const outcome = String(req.body?.outcome ?? "").trim().slice(0, 500);
    const current = (role as { valueMinor?: number | null }).valueMinor ?? null;
    const problem = topUpProblem(current, proposed, outcome);
    if (problem) return res.status(409).json({ error: problem, proposeInstead: ROLE_PAY_VOTE_PATH });
    const ee = eeMeaningWritten();
    const opened = await openRolePayDraft(role, proposed, !ee, String(user.id), `A top-up for ${role.name}: ${outcome}`);
    if ("problem" in opened) return res.status(400).json({ error: opened.problem });
    const voiceHeld = (await currentModel(getPool(), currency())).version === 0;
    const latest = (await settingsForWork(getPool(), "role", role.id)).find((s) => s.state === "set");
    if (latest) {
      const payeeIds = (await listOrgAssignments(getPool())).filter((a) => a.orgRoleId === role.id && a.userId).map((a) => String(a.userId));
      const rec = settingRecord({
        workKind: "role",
        workId: 0,
        category: latest.category,
        first: latest.suggestion,
        set: { totalMinor: proposed },
        ctx: { setterId: String(user.id), payeeIds, secondSigners: [], setterSetPayOf: [] },
        opts: { reason: "Retro top-up", note: outcome },
        at: new Date().toISOString(),
      });
      await writeSetting(getPool(), rec, { workRef: role.id, state: "awaiting_vote", modelVersion: latest.modelVersion, currency: latest.currency, inputs: latest.inputs, suggestion: latest.suggestion, payeeIds, setterId: String(user.id) });
    }
    res.json({
      success: true,
      draftId: opened.draftId,
      putToVillage: putToVillage(opened.draftId),
      ...(voiceHeld ? { voiceHeld: true, voiceNote: "Voice starts when the village adopts its own pay settings." } : {}),
    });
  });

  app.get("/api/org/roles/:id/pay/settings", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "auth_required" });
    const settings = await settingsForWork(getPool(), "role", String(req.params.id));
    const latest = settings[0];
    const cal = latest ? calibrate(await calibrationRecords(getPool(), latest.category)).find((c) => c.category === latest.category && !c.eeHeld) : undefined;
    res.json({ settings, range: latest?.suggestion ? widenRange(latest.suggestion, cal) : null, calibration: cal ?? null });
  });

  app.post("/api/valuation/settings/:id/sign", async (req, res) => {
    const actor = await authedUser(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    const s = await settingById(getPool(), String(req.params.id));
    if (!s) return res.status(404).json({ error: "No such figure." });
    if (s.state !== "awaiting_second") return res.status(409).json({ error: "This figure is not waiting for a second signer." });
    const me = String(actor.id);
    const eligible = Array.from(new Set([...(await liveHoldersOf("role.pay")), ...(await liveHoldersOf("steward.veto"))]));
    const setterSet = await payeesSetBy(getPool(), s.setterId, new Date(Date.now() - SEASON_MS), s.id);
    const refused =
      me === s.setterId ? "The person who set a figure cannot also sign it." :
      s.payeeIds.includes(me) ? "This role pays you, so its figure is not yours to sign." :
      setterSet.includes(me) ? "The setter set your own pay this season, so you cannot sign theirs." :
      !eligible.includes(me) ? "A second signer holds role.pay or steward.veto." : null;
    if (refused) return res.status(403).json({ error: refused, proposeInstead: ROLE_PAY_VOTE_PATH });
    // Claimed first (compare-and-set), so two signers can never both write the pay.
    if (!(await signSetting(getPool(), s.id, me))) return res.status(409).json({ error: "Someone signed this figure a moment ago." });
    const problem = s.workKind === "role" ? await writeRolePay(s.workRef, s.setMinor, undefined, s.eeHeld) : null;
    if (problem) return res.status(400).json({ error: problem });
    await recordEvent(getPool(), {
      kind: "org",
      text: "a role's pay figure was signed by a second signer",
      actorUserId: me,
      entityType: "org_role",
      entityRef: s.workRef,
      audience: "public",
    });
    res.json({ success: true });
  });
}
