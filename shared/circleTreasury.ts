/**
 * TWO WAYS A CIRCLE CAN BE GIVEN MONEY, AND THEY ARE DIFFERENT ON PURPOSE.
 *
 * Rye's ruling, in his words: "The mode is chosen per circle (the village can
 * set treasuries or spending caps on a circle-by-circle basis) as a general
 * rule we want to give a lot of freedom to circles to govern in unique ways
 * that are specific to the type of work they're doing."
 *
 * So one village runs both at once. A kitchen circle can hold a treasury while
 * the events circle runs on a cap, in the same season, and neither mode is a
 * setting of the village.
 *
 * ── WHAT EACH MODE IS ──────────────────────────────────────────────────────
 *
 *   CAP. A right to ISSUE, bounded per cycle and per season, measured off the
 *   ledger at the instant somebody asks (`shared/circleBurn.ts`). Nothing is
 *   held. Room resets when the window turns, and whatever the circle did not
 *   issue is gone.
 *
 *   TREASURY. Real tokens, minted up front into an account the circle holds.
 *   Nothing resets. What the circle does not spend, it still has next season.
 *
 * Rye again, and this is the design and not a footnote: "This way they behave
 * different minting a whole treasury up front where they can underspend and
 * save it, gives an incentive to save. While a spending cap creates an
 * incentive to spend the whole cap."
 *
 * ── A MODE CHANGE IS SCHEDULED, NEVER APPLIED ──────────────────────────────
 *
 * "As a default rule we don't switch between treasury or cap modes between
 * cycles, these changes take place at the start of a new cycle (in this case
 * the default would be each season) So this way we don't have this issue and
 * they just finish out the season with the current model and upgrade/change
 * for the next season how to run."
 *
 * A circle finishes its period under the model it started with. That makes a
 * mode change the same shape as a mint-rule change: queued now, promoted at a
 * boundary. `queueRuleChange` and `applyPendingRules` in server/lib/economy.ts
 * are the pattern this follows, deliberately, so there is one idea of a
 * deferred change in this codebase instead of two.
 *
 * ONE DIFFERENCE FROM THAT PATTERN, AND IT IS FORCED. A mint rule defers to a
 * CYCLE NUMBER, which is an integer the clock hands out. A season has no
 * number: it is a dated civil span in the village's own zone, and its id is a
 * slug somebody typed. So the deferral is stored as the INSTANT the next
 * period begins. An instant is orderable the way a cycle number is, it survives
 * the season calendar being re-edited under it, and it is the same unit the
 * burn meter already converts both boundaries into.
 *
 * ── WHY THE MODE IN FORCE IS COMPUTED AND NEVER STORED ─────────────────────
 *
 * `modeAt` takes the stored mode, the queued change and an instant, and says
 * which model is running. Nothing has to sweep the table for a reading to be
 * right, so a village whose scheduler is off does not silently keep running
 * last season's model. `applyPendingModes` still exists and still runs, because
 * a queued change that has landed should stop being pending, and because a
 * reader that has to reconstruct the past forever is a reader that will
 * eventually disagree with itself. The promotion is a tidy-up of a fact
 * `modeAt` already knows.
 */

/** The two models. Frozen, and the union every mode field is keyed by. */
export const BUDGET_MODES = ["cap", "treasury"] as const;
export type BudgetMode = (typeof BUDGET_MODES)[number];

/** True for a value a village may actually store in the mode column. */
export function isBudgetMode(v: unknown): v is BudgetMode {
  return typeof v === "string" && (BUDGET_MODES as readonly string[]).includes(v);
}

/**
 * A queued change, and the instant it lands.
 *
 * `from` is an ISO instant and never a cycle number or a season id. See the
 * header: a season has no ordinal, so an instant is the only thing both
 * boundaries can be expressed in.
 */
export interface PendingModeChange {
  mode: BudgetMode;
  from: string;
  by: string | null;
  at: string | null;
}

/** A dated window, as instants. Same shape the burn meter uses for a window. */
export interface PeriodBounds {
  id: string;
  startsAt: string;
  endsAt: string;
}

/**
 * WHICH MODEL IS RUNNING AT AN INSTANT.
 *
 * The whole of the deferral rule is this function. A queued change whose
 * instant has not arrived changes nothing, so a circle mid-season is read
 * under the model it began the season with, whatever a steward queued
 * yesterday.
 *
 * A pending row with an unparseable instant is ignored and the stored mode
 * stands. Treating junk as "land it now" would apply a change the village
 * scheduled for later, which is the one failure this whole file exists to
 * prevent.
 */
export function modeAt(
  stored: BudgetMode,
  pending: PendingModeChange | null | undefined,
  at: Date,
): BudgetMode {
  if (!pending) return stored;
  const lands = Date.parse(pending.from);
  if (!Number.isFinite(lands)) return stored;
  return at.getTime() >= lands ? pending.mode : stored;
}

/** Which boundary a queued change was measured against, for the sentence. */
export type ModeBoundary = "season" | "cycle";

export interface ModeSchedule {
  /** The instant the change lands, ISO. */
  from: string;
  boundary: ModeBoundary;
}

/**
 * WHEN A CHANGE QUEUED NOW WOULD LAND.
 *
 * The season is the default period, because that is what Rye named. A village
 * with no season covering the instant has no season boundary to land on, so
 * the change takes the next CYCLE boundary instead. That fallback is stated
 * out loud in the sentence a steward reads, because "next season" and "next
 * moon" are different promises and a surface that said the first while doing
 * the second would be lying about a schedule.
 *
 * Both windows are already computed by the burn meter for the same instant, so
 * this takes them as arguments and derives nothing itself. That keeps one
 * definition of a cycle and one of a season in this codebase.
 */
export function modeChangeSchedule(
  season: PeriodBounds | null,
  cycle: PeriodBounds,
): ModeSchedule {
  if (season) {
    const ends = Date.parse(season.endsAt);
    if (Number.isFinite(ends)) return { from: season.endsAt, boundary: "season" };
  }
  return { from: cycle.endsAt, boundary: "cycle" };
}

/**
 * Why this mode change cannot be queued, in words, or null when it can.
 *
 * Queueing the mode a circle is already running is refused rather than stored
 * as a no-op. A pending row that changes nothing still reads as a scheduled
 * change on every surface that prints one, and a steward would be shown a
 * season boundary where nothing is going to happen.
 */
export function modeChangeProblem(asked: unknown, running: BudgetMode): string | null {
  if (!isBudgetMode(asked)) {
    return `A budget runs on one of ${BUDGET_MODES.join(" or ")}, and ${JSON.stringify(String(asked))} is neither`;
  }
  if (asked === running) {
    return `This circle already runs on a ${running}, so there is nothing to schedule`;
  }
  return null;
}

/**
 * ── THE VILLAGE-WIDE FIGURE, AND WHY IT IS A THIRD FACT ────────────────────
 *
 * Cap mode issues nothing; it permits. Treasury mode MINTS UP FRONT, and Rye's
 * design intent is that a circle can underspend and save, which is the
 * incentive he wants. So unspent treasuries persist across periods and
 * ACCUMULATE. Over several seasons that is committed supply nobody is
 * watching, and one number says whether it has happened.
 *
 * IT SITS BESIDE ISSUED AND RETIRED AND IS NEVER NETTED INTO EITHER. The admin
 * tokens surface already prints issued beside retired and refuses to net them,
 * because netting silently changes what a word means. Treasury-held is the
 * third: issued, still in existence, not yet spent, and committed to a circle.
 * A founder reading issuance alone now overstates what is loose in the
 * village, which is the same shape as the stay-credit outstanding figure that
 * went one term short.
 *
 * IT IS A SUM OF REAL BALANCES AND NEVER OF FUNDED MINUS SPENT. That
 * subtraction is a second copy of an answer `token_balances` already holds,
 * and a second copy is what produced the guard reading 600 beside a panel
 * reading 300 on the same table at the same instant.
 */
export type TreasuryTotalState =
  /**
   * The module is off and no circle account holds anything. An ABSENCE: this
   * village is not running circle treasuries at all.
   */
  | "module_off"
  /**
   * Circle budgets exist and none of them runs on a treasury at this instant.
   * A REAL ZERO. Nothing is held because nobody chose to hold anything, which
   * is a different fact from the module being off, and both are different from
   * a treasury that has been emptied.
   */
  | "none_on_treasury"
  /** Treasuries exist and every one of them is empty. A real zero, and its own. */
  | "all_empty"
  /** At least one treasury holds tokens. The figure means something. */
  | "held";

export interface TreasuryTotal {
  state: TreasuryTotalState;
  /**
   * Minor units held across every circle treasury in this token.
   *
   * NULL ONLY FOR `module_off`, where the honest answer is that this village
   * does not do this. Every other state carries a number, and a zero in
   * `none_on_treasury` or `all_empty` is a measured zero.
   */
  heldMinor: number | null;
  /** How many circle accounts carry a nonzero balance. */
  accountsHolding: number;
  /** How many budget rows run on a treasury at the instant this was read. */
  budgetsOnTreasury: number;
}

/**
 * WHICH OF THE FOUR THIS VILLAGE IS IN, FROM MEASURED FACTS ONLY.
 *
 * `held` wins over everything, INCLUDING the module being off. A village that
 * turned the resources module off while circles still held tokens must not be
 * told it has no treasuries: the tokens are real, they are in the ledger, and
 * hiding them behind a lifecycle flag is exactly the empty-state confusion
 * this union exists to prevent.
 */
export function treasuryTotalState(
  moduleOn: boolean,
  accountsHolding: number,
  budgetsOnTreasury: number,
): TreasuryTotalState {
  if (accountsHolding > 0) return "held";
  if (budgetsOnTreasury > 0) return "all_empty";
  return moduleOn ? "none_on_treasury" : "module_off";
}

/** The sentence a founder reads beside issued and retired. Four, never one. */
export function treasuryTotalSentence(
  total: TreasuryTotal,
  amount: (minor: number) => string,
): string {
  switch (total.state) {
    case "module_off":
      return (
        "This village is not running circle treasuries. Nothing is held, and nothing here " +
        "is committed to a circle."
      );
    case "none_on_treasury":
      return (
        "Every circle here runs on a spending cap, so nothing is held in a treasury. This " +
        "is a measured zero and it will change the moment a circle moves to a treasury."
      );
    case "all_empty":
      return (
        `${total.budgetsOnTreasury} circle treasuries exist and all of them are empty. ` +
        "Nothing has been minted into them yet, and an empty treasury is not a spent one."
      );
    case "held":
      return (
        `${amount(total.heldMinor ?? 0)} sits unspent across ${total.accountsHolding} circle ` +
        "treasuries. It was issued, it still exists, and it is committed to a circle, so a " +
        "figure for what this village has issued overstates what is loose in it by this much."
      );
    default:
      return assertNoOtherTotal(total.state);
  }
}

/** The same compile-time gate the reading union has, for this smaller union. */
export function assertNoOtherTotal(s: never): never {
  throw new Error(`unhandled treasury total state: ${JSON.stringify(s)}`);
}

/** The word a member reads for a mode. Kept here so one file spells them. */
export const MODE_WORD: Readonly<Record<BudgetMode, string>> = {
  cap: "spending cap",
  treasury: "treasury",
};

/**
 * What a steward is told after queueing, and the sentence is deliberately
 * about a DATE the village keeps rather than a mode id.
 */
export function modeChangeSentence(
  circleName: string,
  running: BudgetMode,
  asked: BudgetMode,
  schedule: ModeSchedule,
): string {
  const when = schedule.boundary === "season"
    ? "at the start of the next season"
    : "at the next cycle boundary, because no season covers this village today";
  return (
    `${circleName} finishes this period on its ${MODE_WORD[running]} and moves to a ` +
    `${MODE_WORD[asked]} ${when}, on ${schedule.from.slice(0, 10)}.`
  );
}

// ── THE ONE DIFFERENCE, NAMED ONCE ──────────────────────────────────────────

/**
 * WHAT A PERIOD BOUNDARY DOES TO WHAT A CIRCLE HAS.
 *
 * Rye settled this while answering a question about it, and the answer is the
 * whole reason two modes exist:
 *
 *   "A treasury can also roll over to the next cycle to continue to be used
 *   (what sets it apart from the other option of just having a cap you can
 *   issue to). So, Actually thinking this out further with you and it doesn't
 *   make sense to send it back... If they're choosing the treasury route where
 *   they issue up front then those stay issued and can roll over to the next
 *   cycle."
 *
 * SO THERE IS NO DE-ISSUING AT A PERIOD BOUNDARY. A treasury that a circle did
 * not spend stays issued, stays in `sys:circle:<id>`, and is still there when
 * the season turns. The village's issued total does not fall, because nothing
 * moved. Dormancy is the OTHER event and it does de-issue, which is Rye's
 * earlier ruling and `sweepDormantCircle` in server/lib/circleTreasury.ts.
 *
 * ── WHY THIS IS A MAP AND NOT TWO PIECES OF ARITHMETIC ─────────────────────
 *
 * The difference already existed in the code before this constant did, and it
 * existed as an absence in two places: `readCap` in shared/circleBurn.ts sums
 * over a window, and `treasuryHoldings` in server/lib/circleTreasury.ts sums
 * over the whole life of the account. Two functions, one idea, and nothing
 * anywhere saying they are the same idea pointing in opposite directions.
 *
 * That is enough while both mechanisms are only READ. It stopped being enough
 * the moment a bonus had to be paid to one mode and refused to the other,
 * because "which mode gets the bonus" is not a third fact: it is this one.
 * Room that evaporates is worth compensating and a balance that persists is
 * not, so `shared/circleBonus.ts` asks THIS function and never asks the mode.
 * A third mode added later answers one question here instead of being pattern
 * matched in every consumer.
 */
export type PeriodBoundaryEffect =
  /** Unspent room evaporates and the window starts full. The cap model. */
  | "resets"
  /** Unspent value stays issued and stays held. The treasury model. */
  | "carries";

/** The one difference between the two models, as data. */
export const PERIOD_BOUNDARY: Readonly<Record<BudgetMode, PeriodBoundaryEffect>> = {
  cap: "resets",
  treasury: "carries",
};

/** What the boundary does to this mode. One call, one answer, one home. */
export function boundaryEffect(mode: BudgetMode): PeriodBoundaryEffect {
  return PERIOD_BOUNDARY[mode];
}

/**
 * The sentence a member reads about what the turn of a period will do.
 *
 * Written apart for each effect, because "your room comes back" and "you keep
 * what you have" are opposite incentives and one sentence covering both would
 * be the empty-state conflation this module was built to avoid, one layer up.
 */
export function boundarySentence(mode: BudgetMode): string {
  if (boundaryEffect(mode) === "carries") {
    return (
      "A treasury carries over. What this circle does not spend, it still holds when the " +
      "period turns, so nothing is de-issued at a boundary and saving is worth something."
    );
  }
  return (
    "A spending cap resets. Room this circle does not use is gone when the period turns, so " +
    "the village pays a share of it back as a bonus when the work was voted complete."
  );
}
