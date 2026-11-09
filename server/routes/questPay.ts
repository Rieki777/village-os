/**
 * A QUEST'S PAY, SET BY THE TREASURER BESIDE THE ENGINE (quest re-price Q2;
 * Rye, 2026-11-09: "the Treasurer re-prices per quest after the model vote").
 *
 * The same set rule as a role's pay (`PUT /api/org/roles/:id/pay`):
 *
 *   - inside the suggestion's band, the role.pay holder's word sets it;
 *   - outside it, a written reason, then a second, different signer (role.pay
 *     or steward.veto) before anything is written;
 *   - with no second signer, the figure waits for the village.
 *
 * Nobody prices a quest they hold an open claim on (the conflict rule), and a
 * claim already taken keeps the terms it was taken at (0342, C8): a new price
 * reaches it only when its worker takes it (`take-current-price`).
 *
 * Every figure is recorded beside its suggestion (`valuation_settings`, 0336),
 * so the gap feeds calibration and the Treasurer's desk shows past prices.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { EXAMPLE_REFUSAL_BODY } from "../lib/examples";
import { currentModel, payeesSetBy, settingsForWork, writeSetting } from "../lib/valuationStore";
import { payLineProblem, questPay, questPayRules } from "../lib/workPay";
import type { ClaimsRepo, QuestsRepo } from "../repos/quests";
import type { WorkInputs } from "../../shared/valuation";
import { suggestValuation, type PayeeSuggestion } from "../../shared/valuationEngine";
import { combineSetting, settingRecord, storedPayFor, type InputChange } from "../../shared/valuationSetting";
import { holderDoor, holderStanding } from "../lib/holderDoor";

export interface QuestPayDeps extends Pick<AppDeps, "authedUser" | "getPool" | "guardCapability" | "overLimit" | "capabilityCtx"> {
  /** Whether the launch vote has carried (`launchedByVote`). Defaults to the pool's own read; a test seam. */
  launchedByVote?: () => Promise<boolean>;
  liveHoldersOf: (capability: string) => Promise<string[]>;
  eeMeaningWritten: () => boolean;
  currency: () => string;
  quests: QuestsRepo;
  claims: ClaimsRepo;
  payLineCheck?: (rules: Awaited<ReturnType<typeof questPayRules>>, token: string) => string | null;
  /**
   * The cash budget left this moon, in minor units, or null when the village
   * has none. Null means the desk prices with no cash (Rye, 2026-11-09: "the
   * cash share is 0% until a budget exists"). Absent: no budget reader yet.
   */
  cashBudgetLeft?: () => Promise<{ minor: number; currency: string } | null>;
}

/** Statuses a quest is still offered in. A retired quest has nothing to price. */
const PRICEABLE = new Set(["Open", "Seasonal", "Ongoing", "Paused"]);

const SEASON_MS = 91 * 24 * 60 * 60 * 1000;

const readChanges = (raw: unknown): InputChange[] =>
  Array.isArray(raw)
    ? raw
        .filter((c) => c && typeof c === "object")
        .slice(0, 20)
        .map((c: any) => ({ field: String(c.field ?? "").slice(0, 60), from: String(c.from ?? "").slice(0, 120), to: String(c.to ?? "").slice(0, 120) }))
    : [];

/** Write a set figure onto the quest, or say why its pay cannot be stored. */
export async function writeQuestPay(
  deps: Pick<QuestPayDeps, "getPool" | "quests" | "currency" | "payLineCheck">,
  questId: string,
  figure: number,
  opts: { cashPct?: number; eeHeld: boolean },
): Promise<{ problem: string | null; voiceHeld: boolean }> {
  const pool = deps.getPool();
  const model = await currentModel(pool, deps.currency());
  const stored = storedPayFor(model, figure, opts);
  // No Voice line before the village adopts its own model (the #995 guard, the same here).
  const voiceHeld = model.version === 0;
  const tokens = voiceHeld ? stored.valueTokens.filter((t) => t.token !== model.tokens.voice) : stored.valueTokens;
  const rules = await questPayRules(pool);
  const check = deps.payLineCheck ?? payLineProblem;
  for (const t of tokens) {
    const problem = check(rules, t.token);
    if (problem) return { problem, voiceHeld };
  }
  const cur = deps.currency();
  const updated = await deps.quests.update(questId, (q: any) => {
    q.valueMinor = stored.valueMinor;
    q.valueCurrency = cur;
    q.valueTokens = tokens;
    q.cashMinor = stored.cashMinor;
    q.cashCurrency = stored.cashMinor === null ? null : cur;
  });
  return { problem: updated ? null : "Quest not found", voiceHeld };
}

export function registerQuestPay(app: Express, deps: QuestPayDeps): void {
  const { authedUser, getPool, guardCapability, overLimit, liveHoldersOf, eeMeaningWritten, currency, quests, claims } = deps;

  app.put("/api/quests/:id/pay", async (req, res) => {
    if (!(await holderDoor(req, res, deps, "role.pay"))) return;
    const actor = await authedUser(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    const quest: any = await quests.byId(String(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    if (quest.isExample) return res.status(409).json(EXAMPLE_REFUSAL_BODY);

    const body = req.body ?? {};
    const raw = body.work;
    const inputs: WorkInputs | null = raw && typeof raw === "object" && Array.isArray(raw.lines) ? ({ ...raw, kind: "quest" } as WorkInputs) : null;
    const figure = Number(body.set?.totalMinor);
    if (!inputs) return res.status(400).json({ error: "Send the quest's effort estimate, so the figure is set beside a suggestion." });
    if (!Number.isFinite(figure) || figure < 0) return res.status(400).json({ error: "Say the figure you are setting." });

    const model = await currentModel(getPool(), currency());
    const ee = eeMeaningWritten();
    const s = suggestValuation(model, inputs, { eeMeaningWritten: ee });
    if (!s.ok) return res.status(400).json({ refusals: s.refusals });
    const first: PayeeSuggestion = s.payees[0];

    const payeeIds = await claims.openClaimantsOf(quest.id);
    const ctx = {
      setterId: String(actor.id),
      payeeIds,
      secondSigners: Array.from(new Set([...(await liveHoldersOf("role.pay")), ...(await liveHoldersOf("steward.veto"))])),
      setterSetPayOf: await payeesSetBy(getPool(), String(actor.id), new Date(Date.now() - SEASON_MS)),
    };
    const opts = {
      reason: typeof body.reason === "string" ? body.reason : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
      inputChanges: readChanges(body.inputChanges),
    };
    const decision = combineSetting(first, { totalMinor: figure }, ctx, opts);
    if (decision.missing.length) return res.status(400).json({ error: "This figure is outside the suggestion's band, so give a reason for it.", decision });

    const cashPct = Number.isFinite(Number(body.cashPct)) ? Number(body.cashPct) : undefined;
    const eeHeld = first.expected.earnedEquityHeld > 0;
    let voiceHeld = model.version === 0;
    if (decision.needs === "none") {
      const wrote = await writeQuestPay(deps, quest.id, figure, { cashPct, eeHeld });
      if (wrote.problem) return res.status(400).json({ error: wrote.problem });
      voiceHeld = wrote.voiceHeld;
    }
    const rec = settingRecord({ workKind: "quest", workId: 0, category: `quest:${inputs.lines[0]?.band ?? "none"}`, first, set: { totalMinor: figure }, ctx, opts, at: new Date().toISOString() });
    const state = decision.needs === "none" ? "set" : decision.needs === "second" ? "awaiting_second" : "awaiting_vote";
    const settingId = await writeSetting(getPool(), rec, { workRef: quest.id, state, modelVersion: model.version, currency: model.currency, inputs, suggestion: first, payeeIds, setterId: String(actor.id) });
    await recordEvent(getPool(), {
      kind: "quest",
      text: state === "set" ? `${quest.title}: price set beside the valuation engine's suggestion` : `${quest.title}: a price waits for ${state === "awaiting_second" ? "a second signer" : "the village"}`,
      actorUserId: String(actor.id),
      entityType: "quest",
      entityRef: quest.id,
      audience: "public", // names nobody
    });
    res.json({
      success: true,
      settingId,
      state,
      decision,
      suggestion: first,
      openClaims: payeeIds.length,
      ...(voiceHeld ? { voiceHeld: true, voiceNote: "Voice starts when the village adopts its own pay settings." } : {}),
      ...(decision.needs === "second" ? { voteAfterDays: decision.voteAfterDays } : {}),
    });
  });

  /*
   * THE PRICING DESK (quest re-price Q3; approved mockup 2026-11-09). Every
   * quest still offered, what it pays today, its last figure with the inputs
   * and suggestion it was set beside, and its open claims; plus the model and
   * the Treasurer's path (EE meaning, model adopted). The browser prices each
   * row with the same pure engine (`shared/valuationEngine.ts`); the write
   * door above prices again on the server, so the desk can never set a figure
   * the server did not suggest.
   */
  app.get("/api/quests/pricing-desk", async (req, res) => {
    if (!(await holderDoor(req, res, deps, "role.pay"))) return;
    const reader = await authedUser(req);
    if (!reader) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const payDoor = await holderStanding(deps, { id: reader.id, isAdmin: !!(await deps.capabilityCtx(reader)).isAdmin }, "role.pay");
    const model = await currentModel(pool, currency());
    const rules = await questPayRules(pool);
    const all = (await quests.all()).filter((q: any) => !q.isExample && PRICEABLE.has(String(q.status ?? "Open")));
    const rows = [];
    for (const q of all as any[]) {
      const settings = await settingsForWork(pool, "quest", q.id);
      const latest = settings[0] ?? null;
      rows.push({
        id: q.id,
        title: q.title,
        circle: q.circle ?? null,
        duration: q.duration ?? null,
        difficulty: q.difficulty ?? null,
        status: q.status ?? "Open",
        valueMinor: q.valueMinor ?? null,
        valueCurrency: q.valueCurrency ?? null,
        pay: questPay(q, rules),
        latest: latest
          ? { id: latest.id, state: latest.state, setMinor: latest.setMinor, inputs: latest.inputs, suggestedMinor: latest.suggestedMinor, at: latest.createdAt }
          : null,
        pastPrices: settings.filter((x) => x.state === "set").map((x) => ({ setMinor: x.setMinor, at: x.createdAt })).slice(0, 5),
        openClaims: (await claims.openClaimantsOf(q.id)).length,
      });
    }
    let cash: { minor: number; currency: string } | null = null;
    try {
      cash = deps.cashBudgetLeft ? await deps.cashBudgetLeft() : null;
    } catch {
      cash = null;
    }
    res.json({ model, payDoor, eeMeaningWritten: eeMeaningWritten(), modelAdopted: model.version > 0, cashBudgetLeft: cash, quests: rows });
  });

  app.get("/api/quests/:id/pay/settings", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "auth_required" });
    res.json({ settings: await settingsForWork(getPool(), "quest", String(req.params.id)) });
  });

  /*
   * THE WORKER TAKES THE NEW PRICE (C8: only the worker's agreement or a vote
   * changes a claimed quest's price). On their own open claim only.
   */
  app.post("/api/game/quest-claims/:id/take-current-price", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`quest-take-price:${user.id}`, 30, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many tries in an hour. Try again shortly." });
    const out = await claims.takeCurrentPrice(String(req.params.id), String(user.id));
    if (out.ok) return res.json({ success: true, payTerms: out.claim.payTerms });
    if (out.reason === "missing") return res.status(404).json({ error: "Not found" });
    if (out.reason === "not_yours") return res.status(403).json({ error: "Only the person doing the quest can take its new price." });
    return res.status(409).json({ error: "This claim is resolved, so its price is final.", status: out.status });
  });
}
