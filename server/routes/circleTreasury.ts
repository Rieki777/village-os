/**
 * WHAT A VILLAGE DOES WITH A CIRCLE'S TREASURY, THROUGH DOORS A PERSON USES.
 *
 *   POST   /api/admin/resources/budgets/:id/mode     queue a mode change
 *   DELETE /api/admin/resources/budgets/:id/mode     withdraw a queued change
 *   POST   /api/admin/resources/budgets/:id/fund     mint into the treasury
 *   POST   /api/admin/resources/budgets/:id/spend    pay somebody from it
 *   POST   /api/admin/resources/budgets/:id/return   hand it back to the village
 *   GET    /api/resources/treasuries                 what every circle holds
 *
 * All six mount behind `requireModule("resources")`, which server/index.ts
 * installs on both prefixes before this module's `register()` is called. The
 * module ships OFF and while it is off every one of these is a 404.
 *
 * ── THIS FILE DECIDES NOTHING ABOUT WHO ────────────────────────────────────
 *
 * A village-wide treasury badge and a circle-scoped treasury role are held
 * pending a ruling and belong to another lane. So permission arrives as a
 * function, `deps.permitFor(req)`, which answers a `TreasuryPermit`:
 *
 *     (action: TreasuryAction, circleId: string) => Promise<string | null> | string | null
 *
 * Null means allowed; a string is the refusal a person reads. server/index.ts
 * builds it today from `mayDeclareResources`, which is the same gate the
 * budget writes beside it already use. When the badge lands, that one closure
 * changes and nothing in `server/lib/circleTreasury.ts` or in this file moves.
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
  treasuryStandings,
  villageTreasuryTotal,
  type TreasuryPermit,
} from "../lib/circleTreasury";
import { cycleWindowAt, seasonWindowAt, type SeasonSpan } from "../lib/circleBurn";
import {
  modeAt,
  modeChangeProblem,
  modeChangeSchedule,
  modeChangeSentence,
  treasuryTotalSentence,
  type BudgetMode,
} from "../../shared/circleTreasury";
import { CIRCLE_STATUSES, type CircleStatus } from "../../shared/draftKinds";
import { amountWords, listBudgets, type CircleBudgetRow } from "../lib/resources";
import { fromLedgerUnits, toLedgerUnits } from "../lib/economy";
import { tokenDef } from "../lib/ledger";
import { mintCycleStart } from "../lib/mintCap";
import { stringVar } from "../lib/variables";
import { tokenTypeFor } from "./circleBurn";

type Deps = Pick<AppDeps, "getPool" | "authedUser"> & {
  /** The village's circles, for names and status. Read, never written here. */
  circlesRepo: { all(): unknown[] };
  /** The dated season calendar and the zone it turns in. */
  seasonState(): { seasons?: unknown[]; timezone?: string };
  /**
   * THE PERMISSION SEAM. See the header: this module never decides who.
   * server/index.ts supplies it, because that is where the capability gate,
   * the break-glass hatch and the declare context live.
   */
  permitFor(req: Request): Promise<TreasuryPermit>;
};

export function register(app: Express, deps: Deps): void {
  const { getPool, authedUser, circlesRepo, seasonState } = deps;

  const circleName = (id: string): string => {
    const circles = circlesRepo.all() as Array<{ id?: string; name?: string }>;
    return String(circles.find((c) => c?.id === id)?.name ?? id);
  };

  /** A circle's lifecycle. An unknown circle reads dormant, never active. */
  const statusOf = (id: string): CircleStatus => {
    const circles = circlesRepo.all() as Array<{ id?: string; status?: string }>;
    const found = circles.find((c) => c?.id === id);
    return CIRCLE_STATUSES.includes(found?.status as CircleStatus)
      ? (found!.status as CircleStatus)
      : "dormant";
  };

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
    const slug = tokenTypeFor(b.unit);
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
      cycle: cycleWindowAt(at, stringVar("cycle.mode")),
      season: seasonWindowAt(at, seasons, timeZone),
    };
  };

  // ── The mode, queued for a boundary ───────────────────────────────────────

  app.post("/api/admin/resources/budgets/:id/mode", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const budget = await budgetById(String(req.params.id));
    if (!budget) return res.status(404).json({ error: "No such budget" });

    const permit = await deps.permitFor(req);
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
    const permit = await deps.permitFor(req);
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

    const permit = await deps.permitFor(req);
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

    const permit = await deps.permitFor(req);
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

    const permit = await deps.permitFor(req);
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
    const standings = await treasuryStandings(getPool(), running, tokenTypeFor, statusOf);
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
          (b) => b.mode === "treasury" && tokenTypeFor(b.unit) === slug,
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
function movementKey(kind: string, budgetId: string, req: Request): string {
  const asked = String((req.body as any)?.requestId ?? "").trim();
  const tail = asked
    ? asked.slice(0, 60)
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `circle_treasury:${kind}:${budgetId.slice(0, 40)}:${tail}`;
}

/** Exported so a caller converting a human amount uses the ledger's own scale. */
export { toLedgerUnits };
