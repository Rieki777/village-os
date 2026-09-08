/**
 * WHAT A VILLAGE DOES WITH A CIRCLE'S TREASURY, THROUGH DOORS A PERSON USES.
 *
 *   POST   /api/admin/resources/budgets/:id/mode     queue a mode change
 *   DELETE /api/admin/resources/budgets/:id/mode     withdraw a queued change
 *   POST   /api/admin/resources/budgets/:id/fund     mint into the treasury
 *   POST   /api/admin/resources/budgets/:id/spend    pay somebody from it
 *   POST   /api/admin/resources/budgets/:id/return   hand it back to the village
 *   GET    /api/admin/resources/budgets/:id/bonus    what a cap circle is owed
 *   POST   /api/admin/resources/budgets/:id/bonus    pay it
 *   GET    /api/admin/resources/treasuries           what each budget holds
 *   GET    /api/resources/treasuries                 what every circle holds
 *
 * THE TWO BONUS DOORS ARE HERE AND NOT IN A MODULE OF THEIR OWN, and the
 * reason is measured rather than aesthetic: the `server/index.ts` ratchet had
 * ZERO slack when they landed (27893 of 27893 lines), so a new route module
 * could not be registered from that file at all. They also belong here on
 * their own merits, because paying a bonus mints into `sys:circle:<id>`, which
 * is the account every other door in this file moves.
 *
 * All nine mount behind `requireModule("resources")`, which server/index.ts
 * installs on both prefixes before this module's `register()` is called. The
 * module ships OFF and while it is off every one of these is a 404.
 *
 * ── THIS FILE DECIDES NOTHING ABOUT WHO ────────────────────────────────────
 *
 * A village-wide treasury badge and a circle-scoped treasury role are held
 * pending a ruling and belong to another lane. So permission arrives as two
 * injected pieces that `permitFor` below composes into a `TreasuryPermit`:
 *
 *     (action: TreasuryAction, circleId: string) => Promise<string | null> | string | null
 *
 * Null means allowed; a string is the refusal a person reads. It is built
 * today from the declare gate the budget writes beside it already use, which
 * means admin, `org.declare`, or the circle's own speaking seat, with the
 * break-glass hatch carried through. Setting a circle's caps and minting its
 * treasury are the same decision about the same circle's money, so shipping
 * them under different rights would be inventing a permission model in a lane
 * that was told not to. When the badge lands, `permitFor` is the whole change
 * and nothing in `server/lib/circleTreasury.ts` moves.
 *
 * ── SIGNED IN ONLY, AND THE READ IS TIGHTER THAN THE DECLARATION ───────────
 *
 * `GET /api/resources` serves strangers a public tier when
 * `map.public_structure` is on, and that tier carries no budgets. What a
 * circle HOLDS is a tighter fact than what it declared it may spend, so the
 * treasuries read has no public tier at all.
 *
 * ── EVERY MOVEMENT IS IDEMPOTENT AND THE KEY COMES FROM THE CALLER ─────────
 *
 * A funding is issuance. A double-clicked button that minted twice would be a
 * village issuing tokens nobody decided on, and the cap would count both. So
 * every write takes a `requestId` and builds the ledger key from it. Without
 * one the route makes a key from the clock, which protects a retry within the
 * same request and nothing else, and that is stated rather than implied.
 */
import type { Express, Request } from "express";
import type { AppDeps } from "../lib/appDeps";
import {
  budgetTreasuries,
  circleFundingClause,
  circleFundingSince,
  dormantHoldings,
  dormantSentence,
  fundTreasury,
  queueModeChange,
  cancelModeChange,
  returnTreasury,
  spendTreasury,
  treasuryHoldings,
  circleStatusReader,
  treasuryStandings,
  treasuryTokenFor,
  villageTreasuryTotal,
  type TreasuryAction,
  type TreasuryPermit,
} from "../lib/circleTreasury";
import type { DeclareContext } from "../lib/orgChart";
import { cycleWindowAt, seasonWindowAt, type SeasonSpan } from "../lib/circleBurn";
import {
  modeAt,
  modeChangeProblem,
  modeChangeSchedule,
  modeChangeSentence,
  treasuryTotalSentence,
  type BudgetMode,
} from "../../shared/circleTreasury";
import type { CircleStatus } from "../../shared/draftKinds";
import { amountWords, listBudgets, type CircleBudgetRow } from "../lib/resources";
import { fromLedgerUnits, toLedgerUnits } from "../lib/economy";
import { tokenDef } from "../lib/ledger";
import { mintCycleStart } from "../lib/mintCap";
import { bonusGateFor, clockModeNow } from "../lib/circleBonusGate";
import { payCircleBonus, vetoVerdictFor } from "../lib/circleBonus";
import { bonusFor, bonusSentence, type BonusWords } from "../../shared/circleBonus";
import { burnFor, type CircleEnvelope } from "../lib/circleBurn";
import { NO_COMMITMENT_STORE, noCommitmentOnRecord } from "./circleBonusGate";
import { BLIND_SPOT } from "../../shared/circleBonusGate";
import { numberVar } from "../lib/variables";
import { BONUS_PCT_KEY } from "../../shared/circleBonus";

type Deps = Pick<AppDeps, "getPool" | "authedUser"> & {
  /** The village's circles, for names and status. Read, never written here. */
  circlesRepo: { all(): unknown[] };
  /** The dated season calendar and the zone it turns in. */
  seasonState(): { seasons?: unknown[]; timezone?: string };
  /**
   * THE PERMISSION SEAM, IN TWO PARTS, AND NEITHER OF THEM IS A RULE.
   *
   * `declareCtxFor` hands over the declare context for a WRITE, which is the
   * closure `server/index.ts` already builds for every resources write, break
   * glass and all. `mayDeclare` is the gate itself, straight out of
   * server/lib/orgChart.ts.
   *
   * This module composes them into a `TreasuryPermit` and calls it. It decides
   * nothing: when the treasury badge and the circle-scoped role are ruled on,
   * `permitFrom` below is the whole change, and neither
   * `server/lib/circleTreasury.ts` nor any handler here moves.
   */
  declareCtxFor(req: Request): Promise<DeclareContext>;
  mayDeclare(target: string, ctx: DeclareContext): boolean;
};

export function register(app: Express, deps: Deps): void {
  const { getPool, authedUser, circlesRepo, seasonState } = deps;

  /**
   * The permit for one request. `action` is unused today ON PURPOSE: setting a
   * circle's caps and minting its treasury are the same decision about the
   * same circle's money, so both ship under the right that already sets a cap.
   * A ruling that separates funding from spending branches HERE.
   */
  const permitFor = async (req: Request): Promise<TreasuryPermit> => {
    const ctx = await deps.declareCtxFor(req);
    return (_action: TreasuryAction, circleId: string): string | null =>
      deps.mayDeclare(circleId, ctx)
        ? null
        : "Moving a circle's money takes admin, org.declare, or this circle's speaking seat";
  };

  const circleName = (id: string): string => {
    const circles = circlesRepo.all() as Array<{ id?: string; name?: string }>;
    return String(circles.find((c) => c?.id === id)?.name ?? id);
  };

  /** A circle's lifecycle. One definition, in the library, for three routes. */
  const statusOf = (id: string): CircleStatus => circleStatusReader(circlesRepo)(id);

  /** The budget row this request names, or null. Read fresh every time. */
  const budgetById = async (id: string): Promise<CircleBudgetRow | null> => {
    const all = await listBudgets(getPool());
    return all.find((b) => b.id === id) ?? null;
  };

  /**
   * The token a budget's unit is denominated in, with the refusal when it is
   * not one this ledger holds. A treasury in EUR has nothing to mint.
   */
  const tokenForBudget = (b: CircleBudgetRow): { slug: string } | { error: string } => {
    const slug = treasuryTokenFor(b.unit);
    if (!slug) {
      return {
        error:
          `This budget is denominated in ${b.unit}, which this ledger does not hold. A ` +
          "treasury is real tokens, so it can only be funded in a token this village issues",
      };
    }
    return { slug };
  };

  /** Both windows at one instant, from the same definitions the meter uses. */
  const windowsNow = (at: Date) => {
    const season = seasonState();
    const seasons = (Array.isArray(season.seasons) ? season.seasons : []) as SeasonSpan[];
    const timeZone = String(season.timezone || "UTC");
    return {
      /*
       * `clockModeNow` AND NOT `stringVar("cycle.mode")`.
       *
       * `cycle.mode` is named in CYCLE_SETTING_READERS as the key the rhythm
       * dial publishes, and `shared/gameVariables.ts` does not declare it on
       * this tree. `variable()` throws on a key it does not know, so the bare
       * read turned every request into an unhandled rejection that never
       * answered. The burn route shipped with exactly that defect and a
       * sibling lane closed it; this route was written from the same shape and
       * inherited it. Found here by an end-to-end drive, which is the only
       * thing that had ever called this handler.
       */
      cycle: cycleWindowAt(at, clockModeNow()),
      season: seasonWindowAt(at, seasons, timeZone),
    };
  };

  // ── The mode, queued for a boundary ───────────────────────────────────────

  app.post("/api/admin/resources/budgets/:id/mode", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const budget = await budgetById(String(req.params.id));
    if (!budget) return res.status(404).json({ error: "No such budget" });

    const permit = await permitFor(req);
    const refused = await permit("set_mode", budget.circleId);
    if (refused) return res.status(401).json({ error: "auth_required", message: refused });

    const at = new Date();
    /*
     * THE MODE IN FORCE, AND NOT THE COLUMN. A steward queueing a second
     * change has to be answered about the model the circle is actually
     * running, which is what `modeAt` says. Comparing against the column
     * would let somebody queue a change back to the mode a queued change is
     * already heading for.
     */
    const running: BudgetMode = modeAt(budget.mode, budget.pending, at);
    const problem = modeChangeProblem(req.body?.mode, running);
    if (problem) return res.status(400).json({ error: problem });
    const asked = String(req.body.mode) as BudgetMode;

    const { cycle, season } = windowsNow(at);
    const schedule = modeChangeSchedule(season, cycle);
    const landed = await queueModeChange(
      getPool(), budget.id, asked, new Date(schedule.from), user.id ?? null,
    );
    if (!landed) return res.status(404).json({ error: "No such budget" });

    res.json({
      success: true,
      queued: { mode: asked, from: schedule.from, boundary: schedule.boundary },
      running,
      message: modeChangeSentence(circleName(budget.circleId), running, asked, schedule),
    });
  });

  app.delete("/api/admin/resources/budgets/:id/mode", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const budget = await budgetById(String(req.params.id));
    if (!budget) return res.status(404).json({ error: "No such budget" });
    const permit = await permitFor(req);
    const refused = await permit("set_mode", budget.circleId);
    if (refused) return res.status(401).json({ error: "auth_required", message: refused });
    const cleared = await cancelModeChange(getPool(), budget.id);
    if (!cleared) return res.status(409).json({ error: "Nothing is queued on this budget" });
    res.json({ success: true });
  });

  // ── Funding: this is issuance, and the village cap binds ──────────────────

  app.post("/api/admin/resources/budgets/:id/fund", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const budget = await budgetById(String(req.params.id));
    if (!budget) return res.status(404).json({ error: "No such budget" });

    const at = new Date();
    if (modeAt(budget.mode, budget.pending, at) !== "treasury") {
      return res.status(409).json({
        error:
          `${circleName(budget.circleId)} runs on a spending cap this period, so there is no ` +
          "treasury to fund. A cap bounds what a circle may issue and holds nothing",
      });
    }
    const token = tokenForBudget(budget);
    if ("error" in token) return res.status(400).json({ error: token.error });

    const amountMinor = Math.trunc(Number(req.body?.amountMinor ?? 0) || 0);
    if (amountMinor <= 0) {
      return res.status(400).json({ error: "amountMinor is a positive whole number of minor units" });
    }
    const note = String(req.body?.note ?? "").trim();
    if (!note) {
      return res.status(400).json({ error: "A reason is required. Minting into a treasury has to explain itself" });
    }

    const permit = await permitFor(req);
    const result = await fundTreasury(getPool(), {
      circleId: budget.circleId,
      circleName: circleName(budget.circleId),
      circleStatus: statusOf(budget.circleId),
      tokenSlug: token.slug,
      amountMinor,
      actorId: user.id ?? null,
      note,
      idempotencyKey: movementKey("fund", budget.id, req),
      permit,
    });

    if (!result.ok) {
      const error = String(result.error ?? "");
      /*
       * THE CAP'S REFUSAL, PLUS THE HALF IT CANNOT KNOW.
       *
       * `capRefusal` names the doors. Here the door is obvious and the circles
       * are not, so the ledger is read for the same window the guard read and
       * the circles that used the room are named. `mint cap` stays first in
       * the string, because three other routes map that substring to a 409.
       */
      if (error.includes("mint cap")) {
        const funding = await circleFundingSince(getPool(), token.slug, mintCycleStart());
        return res.status(409).json({
          error: error + circleFundingClause(funding, token.slug, circleName),
          circles: funding.map((f) => ({
            circleId: f.circleId,
            name: circleName(f.circleId),
            funded: fromLedgerUnits(token.slug, f.fundedMinor),
          })),
        });
      }
      return res.status(error.includes("dormant") ? 409 : 400).json({ error });
    }

    const held = await treasuryHoldings(getPool(), budget.circleId, token.slug);
    res.json({
      success: true,
      duplicate: !!result.duplicate,
      account: held.account,
      balanceMinor: held.balanceMinor,
      balance: fromLedgerUnits(token.slug, held.balanceMinor),
    });
  });

  // ── Spending: this is NOT issuance and the cap does not move ──────────────

  app.post("/api/admin/resources/budgets/:id/spend", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const budget = await budgetById(String(req.params.id));
    if (!budget) return res.status(404).json({ error: "No such budget" });

    const at = new Date();
    if (modeAt(budget.mode, budget.pending, at) !== "treasury") {
      return res.status(409).json({
        error:
          `${circleName(budget.circleId)} runs on a spending cap this period, so it has no ` +
          "treasury to spend from",
      });
    }
    const token = tokenForBudget(budget);
    if ("error" in token) return res.status(400).json({ error: token.error });

    const amountMinor = Math.trunc(Number(req.body?.amountMinor ?? 0) || 0);
    if (amountMinor <= 0) {
      return res.status(400).json({ error: "amountMinor is a positive whole number of minor units" });
    }

    const permit = await permitFor(req);
    const result = await spendTreasury(getPool(), {
      circleId: budget.circleId,
      circleStatus: statusOf(budget.circleId),
      tokenSlug: token.slug,
      toUserId: String(req.body?.toUserId ?? ""),
      amountMinor,
      actorId: user.id ?? null,
      note: String(req.body?.note ?? "").trim(),
      idempotencyKey: movementKey("spend", budget.id, req),
      permit,
    });
    if (!result.ok) {
      const error = String(result.error ?? "");
      return res.status(error.includes("dormant") || error.includes("insufficient") ? 409 : 400).json({ error });
    }

    const held = await treasuryHoldings(getPool(), budget.circleId, token.slug);
    res.json({
      success: true,
      duplicate: !!result.duplicate,
      balanceMinor: held.balanceMinor,
      balance: fromLedgerUnits(token.slug, held.balanceMinor),
    });
  });

  // ── Returning: the lever a dormant circle's treasury needs ────────────────

  app.post("/api/admin/resources/budgets/:id/return", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const budget = await budgetById(String(req.params.id));
    if (!budget) return res.status(404).json({ error: "No such budget" });
    const token = tokenForBudget(budget);
    if ("error" in token) return res.status(400).json({ error: token.error });

    /*
     * NO MODE CHECK AND NO DORMANCY CHECK, DELIBERATELY.
     *
     * A circle moved back to a cap, or gone dormant, is exactly when the
     * tokens it still holds need a way out. Refusing here is how an account
     * becomes the stranded pile `sys:event-escrow` already is.
     */
    const held = await treasuryHoldings(getPool(), budget.circleId, token.slug);
    const asked = req.body?.amountMinor === undefined || req.body?.amountMinor === null
      ? held.balanceMinor
      : Math.trunc(Number(req.body.amountMinor) || 0);
    if (asked <= 0) {
      return res.status(409).json({
        error: `${circleName(budget.circleId)} holds nothing in ${token.slug}, so there is nothing to hand back`,
      });
    }

    const permit = await permitFor(req);
    const result = await returnTreasury(getPool(), {
      circleId: budget.circleId,
      tokenSlug: token.slug,
      amountMinor: asked,
      actorId: user.id ?? null,
      note: String(req.body?.note ?? "").trim(),
      idempotencyKey: movementKey("return", budget.id, req),
      permit,
    });
    if (!result.ok) {
      const error = String(result.error ?? "");
      return res.status(error.includes("insufficient") ? 409 : 400).json({ error });
    }

    const after = await treasuryHoldings(getPool(), budget.circleId, token.slug);
    res.json({
      success: true,
      duplicate: !!result.duplicate,
      returnedMinor: asked,
      balanceMinor: after.balanceMinor,
      message:
        `${fromLedgerUnits(token.slug, asked)} ${token.slug} went back to the village faucet. ` +
        "That returns the issuance room with it, so the village can mint it somewhere else " +
        "this cycle.",
    });
  });

  // The bonus for room a capped circle did not use

  /**
   * WHAT A CIRCLE IS OWED, AND EVERY REASON IT MIGHT BE OWED NOTHING.
   *
   * A read. It moves nothing, opens no ballot and writes no row, so a steward
   * can see the figure before anybody decides to pay it. Everything it reports
   * comes from `bonusFor` in shared/circleBonus.ts, which asks the completion
   * gate, the veto and the one difference between the two budget modes.
   */
  const bonusStanding = async (req: Request, budget: CircleBudgetRow, at: Date) => {
    const pool = getPool();
    const budgets = await listBudgets(pool);
    const envelopes: CircleEnvelope[] = budgets.map((b) => ({
      circleId: b.circleId,
      unit: b.unit,
      seasonCapMinor: b.amountMinor,
      cycleCapMinor: b.cycleAmountMinor,
      seasonId: b.seasonId,
      mode: b.mode,
      pending: b.pending,
      dormant: b.dormant,
    }));
    const season = seasonState();
    const seasons = (Array.isArray(season.seasons) ? season.seasons : []) as SeasonSpan[];
    const timeZone = String(season.timezone || "UTC");
    const clockMode = clockModeNow();

    const periodId = String(req.query.periodId ?? req.body?.periodId ?? "").trim();
    if (!periodId) return { error: "periodId names the period this answers about" };

    const gate = await bonusGateFor(
      { circleId: budget.circleId, periodId, at },
      {
        conn: pool,
        /*
         * THE SAME STUB THE COMPLETION ROUTE USES, IMPORTED AND NEVER COPIED.
         * No table in this schema records what a circle took on, so every
         * reading refuses by name until one exists. A second stub here would
         * be a second place to change on the day a store lands, which is the
         * shape that leaves one twin unfixed.
         */
        commitmentFor: noCommitmentOnRecord,
        burnFor: (id, instant) =>
          burnFor(
            { circleId: id, at: instant },
            {
              conn: pool, moduleOn: true, envelopes, clockMode, seasons, timeZone,
              tokenTypeFor: treasuryTokenFor,
              circleStatusFor: statusOf,
            },
          ),
        electorate: "village",
      },
    );

    /*
     * THE VETO, READ BESIDE THE GATE BECAUSE THE GATE DOES NOT CARRY IT.
     * `VoteComponent` has no member for a veto and `voteStateOf` builds its
     * state from `ballots.status`, which a veto never changes. See the header
     * of server/lib/circleBonus.ts.
     */
    const veto = await vetoVerdictFor(pool, gate.vote.ballotId);
    const mode = modeAt(budget.mode, budget.pending, at);
    const outcome = bonusFor({ gate, mode, pct: numberVar(BONUS_PCT_KEY), veto });
    return { gate, outcome, veto, mode, periodId };
  };

  /** How a bonus sentence names a circle and spells an amount. */
  const bonusWords = (): BonusWords => ({
    circleName,
    amount: (minor: number, unit: string) =>
      amountWords(minor, unit, (slug: string) => {
        const d = tokenDef(slug);
        return d ? { name: d.name, decimals: d.decimals } : undefined;
      }),
  });

  app.get("/api/admin/resources/budgets/:id/bonus", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const budget = await budgetById(String(req.params.id));
    if (!budget) return res.status(404).json({ error: "No such budget" });

    const at = parseInstant(req.query.at);
    if (!at) return res.status(400).json({ error: "at must be an ISO instant" });

    const standing = await bonusStanding(req, budget, at);
    if ("error" in standing) return res.status(400).json({ error: standing.error });
    res.json({
      ...standing,
      sentence: bonusSentence(standing.outcome, bonusWords(), budget.circleId),
      /*
       * BOTH RIDE EVERY RESPONSE AND NEITHER IS CONDITIONAL, the same rule the
       * completion route keeps. The blind spot is what this reading cannot see
       * about a circle whose work is care; the other is what this build cannot
       * see about any circle at all.
       */
      blindSpot: BLIND_SPOT,
      noCommitmentStore: NO_COMMITMENT_STORE,
    });
  });

  /**
   * PAY IT. ISSUANCE, SO THE VILLAGE-WIDE CAP BINDS.
   *
   * The amount is `bonusFor`'s and the verdict is the village's. This handler
   * decides neither: it refuses whenever the outcome is anything other than
   * `payable`, and hands the award straight to `payCircleBonus`.
   */
  app.post("/api/admin/resources/budgets/:id/bonus", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const budget = await budgetById(String(req.params.id));
    if (!budget) return res.status(404).json({ error: "No such budget" });

    const at = parseInstant(req.body?.at);
    if (!at) return res.status(400).json({ error: "at must be an ISO instant" });

    const token = tokenForBudget(budget);
    if ("error" in token) return res.status(400).json({ error: token.error });

    const standing = await bonusStanding(req, budget, at);
    if ("error" in standing) return res.status(400).json({ error: standing.error });

    const words = bonusWords();
    if (standing.outcome.kind !== "payable") {
      return res.status(409).json({
        error: bonusSentence(standing.outcome, words, budget.circleId),
        outcome: standing.outcome,
        gate: standing.gate,
        noCommitmentStore: NO_COMMITMENT_STORE,
      });
    }

    const recordId = standing.gate.commitment.recordId;
    if (!recordId) {
      /*
       * UNREACHABLE THROUGH `bonusFor`, WHICH BLOCKS ON A MISSING COMMITMENT,
       * and kept because the idempotency key is built from this id. A payment
       * whose key came from a fallback would pay twice on a retry, so the
       * refusal is here instead of a default.
       */
      return res.status(409).json({ error: NO_COMMITMENT_STORE });
    }

    const permit = await permitFor(req);
    const result = await payCircleBonus(getPool(), {
      circleId: budget.circleId,
      circleName: circleName(budget.circleId),
      circleStatus: statusOf(budget.circleId),
      tokenSlug: token.slug,
      award: standing.outcome.award,
      recordId,
      actorId: user.id ?? null,
      note: String(req.body?.note ?? "").trim() || "bonus for room this circle did not use",
      permit,
    });

    if (!result.ok) {
      const error = String(result.error ?? "");
      if (error.includes("mint cap")) {
        const funding = await circleFundingSince(getPool(), token.slug, mintCycleStart());
        return res.status(409).json({ error: error + circleFundingClause(funding, token.slug, circleName) });
      }
      return res.status(error.includes("dormant") ? 409 : 400).json({ error });
    }

    const held = await treasuryHoldings(getPool(), budget.circleId, token.slug);
    res.json({
      success: true,
      duplicate: !!result.duplicate,
      award: standing.outcome.award,
      sentence: bonusSentence(standing.outcome, words, budget.circleId),
      balanceMinor: held.balanceMinor,
      balance: fromLedgerUnits(token.slug, held.balanceMinor),
    });
  });

  /**
   * WHAT EACH BUDGET'S TREASURY HOLDS, FOR THE PANEL THAT DECLARES IT.
   *
   * The admin desk is where a steward funds and spends, so it needs the
   * balance beside the row. It is its own route rather than a field bolted
   * onto `GET /api/admin/resources`, because the balance belongs to this
   * domain and the declaration payload belongs to the resources module: one
   * owner per surface is what stops a lane widening somebody else's response.
   */
  app.get("/api/admin/resources/treasuries", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const budgets = await listBudgets(getPool());
    res.json({ treasuries: await budgetTreasuries(getPool(), budgets) });
  });

  // ── What every circle holds, dormant ones named ───────────────────────────

  app.get("/api/resources/treasuries", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to read what a circle holds" });

    const at = new Date();
    const budgets = await listBudgets(getPool());
    /*
     * THE MODE IN FORCE, so a circle whose move to a treasury is queued for
     * next season does not appear here holding an empty account today.
     */
    const running = budgets.map((b) => ({
      circleId: b.circleId,
      unit: b.unit,
      mode: modeAt(b.mode, b.pending, at),
    }));
    const standings = await treasuryStandings(getPool(), running, treasuryTokenFor, statusOf);
    const dormant = dormantHoldings(standings);

    /*
     * THE VILLAGE-WIDE FIGURE, PER TOKEN, WITH THE STATE THAT SAYS WHAT A ZERO
     * MEANS (Rye's ruling).
     *
     * Per token and never one scalar: adding a token held in whole units to a
     * token held in thousandths would be a number nobody could read back off
     * anything. The module is on here by construction, since this route mounts
     * behind `requireModule("resources")`, so `module_off` is unreachable from
     * this door and the zero states below are the measured ones.
     */
    const slugs = Array.from(new Set(standings.map((s) => s.tokenSlug)));
    const totals: Record<string, unknown> = {};
    for (const slug of slugs) {
      const total = await villageTreasuryTotal(getPool(), {
        moduleOn: true,
        slug,
        budgetsOnTreasury: running.filter(
          (b) => b.mode === "treasury" && treasuryTokenFor(b.unit) === slug,
        ).length,
      });
      totals[slug] = {
        ...total,
        message: treasuryTotalSentence(total, (minor) =>
          amountWords(minor, `token:${slug}`, (s: string) => {
            const d = tokenDef(s);
            return d ? { name: d.name, decimals: d.decimals } : undefined;
          }),
        ),
      };
    }

    res.json({
      at: at.toISOString(),
      /** Issued, still in existence, not spent, committed to a circle. */
      unspentByToken: totals,
      treasuries: standings.map((s) => ({
        circleId: s.circleId,
        name: circleName(s.circleId),
        unit: s.unit,
        account: s.account,
        balanceMinor: s.balanceMinor,
        balance: amountWords(s.balanceMinor, s.unit, (slug: string) => {
          const d = tokenDef(slug);
          return d ? { name: d.name, decimals: d.decimals } : undefined;
        }),
        status: s.circleStatus,
      })),
      /*
       * THE ANTI-STRANDING REPORT. Value held by a circle that has stopped,
       * named out loud so it cannot go quiet. It is a report and never a
       * refusal: tokens a circle owns are the village's own decision, and a
       * boot that failed on them would be refusing to start over one.
       */
      dormant: dormant.map((s) => ({
        circleId: s.circleId,
        balanceMinor: s.balanceMinor,
        message: dormantSentence(s, circleName(s.circleId)),
      })),
    });
  });
}

/**
 * The ledger key for one movement.
 *
 * A `requestId` from the caller is what makes a retry safe across requests. A
 * key built from the clock protects nothing beyond this process, and saying so
 * here is better than a route that looks idempotent and is not.
 */
/**
 * An ISO instant, or now when none was asked for, or null when it is junk.
 *
 * THE INSTANT IS A PARAMETER AND THE DEFAULT IS ONLY A DEFAULT, the same rule
 * the burn and completion routes keep. A bonus is about a period that has
 * ENDED, so the instant a caller wants is almost never now.
 */
function parseInstant(raw: unknown): Date | null {
  if (raw === undefined || raw === null || String(raw) === "") return new Date();
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function movementKey(kind: string, budgetId: string, req: Request): string {
  const asked = String((req.body as any)?.requestId ?? "").trim();
  const tail = asked
    ? asked.slice(0, 60)
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `circle_treasury:${kind}:${budgetId.slice(0, 40)}:${tail}`;
}

/** Exported so a caller converting a human amount uses the ledger's own scale. */
export { toLedgerUnits };

/**
 * THE TWO PLACES THE MONOLITH REACHES THIS DOMAIN, RE-EXPORTED HERE ON PURPOSE.
 *
 * `server/index.ts` needs exactly two things from the treasury: what happens to
 * a circle's money when its status changes, and the third supply figure the
 * admin token panel prints beside issued and retired. Both are implemented in
 * `server/lib/circleTreasury.ts`, which is where their reasoning lives.
 *
 * They come out through this file because this file IS the domain's entry
 * point: the monolith already imports `register` from here, and one import
 * line for one domain is the shape `docs/ARCHITECTURE.md` asks for. It also
 * keeps the monolith's dependency on this domain to a single named surface, so
 * a reader of `server/index.ts` has one file to open rather than two.
 */
export { onCircleStatusChange, treasuryFacts } from "../lib/circleTreasury";
