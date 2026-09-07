/**
 * How resources flow (0084, round 4, lane L3): a map of rules, never a wallet.
 *
 * A village DECLARES who may spend what, with whose approval, paid from
 * where, and where the money comes from. Everything here reads and writes
 * three tables of declarations (spending_rules, funding_sources,
 * circle_budgets) and NOTHING else: the measured side of the picture is
 * SELECT only over fiat_charges and token_ledger, counts and totals with no
 * user ids, and no function in this file can move a unit of anything.
 * A unit test reads this file and holds it to that sentence.
 *
 * Amounts are minor units plus a unit code (the ModulePricing rule): an
 * uppercase ISO 4217 code, or `token:<slug>` checked against the token
 * registry by the lookup the caller passes. Sentences come out of
 * `answerFourQuestions` as zero-token templates: the four questions a
 * member actually asks, answered from the declarations alone.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { formatMoney } from "../../shared/money";
import { BUDGET_MODES, isBudgetMode, type BudgetMode, type PendingModeChange } from "../../shared/circleTreasury";
import { moduleActivity } from "./modules";

// ── Vocabulary ──────────────────────────────────────────────────────────────
// Every list carries `other` (R28): a village's own way is a real answer,
// and the note that says what `other` means here is REQUIRED with it, the
// same way a gloss rides `other` in shared/power.ts.

export const APPROVALS = ["none", "circle-consent", "lead", "founders", "treasury", "hypha", "other"] as const;
export type Approval = (typeof APPROVALS)[number];

export const PAID_FROM = ["treasury", "circle-budget", "member", "grant", "sponsor", "other"] as const;
export type PaidFrom = (typeof PAID_FROM)[number];

export const SOURCE_KINDS = [
  "donations",
  "memberships",
  "stays",
  "grants",
  "sales",
  "land-or-lease",
  "investors",
  "other",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Platform wording for each id. A village overrides through config.labels
 *  (R29 P4), applied in `vocabulary` below; ids never change. */
const APPROVAL_LABELS: Record<Approval, string> = {
  none: "No approval needed",
  "circle-consent": "Circle consent",
  lead: "The circle lead",
  founders: "The founders",
  treasury: "The treasury",
  hypha: "Decided on Hypha",
  other: "Another way, named in the note",
};

const PAID_FROM_LABELS: Record<PaidFrom, string> = {
  treasury: "The village treasury",
  "circle-budget": "The circle budget",
  member: "A member's own pocket",
  grant: "A grant",
  sponsor: "A sponsor",
  other: "Another pot, named in the note",
};

const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  donations: "Donations",
  memberships: "Memberships",
  stays: "Stays",
  grants: "Grants",
  sales: "Sales",
  "land-or-lease": "Land and leases",
  investors: "Investors",
  other: "Another kind, named in the note",
};

export interface VocabEntry {
  id: string;
  label: string;
}

/**
 * The three lists as the client should say them: platform wording with the
 * village's own `config.labels` overrides applied. Override keys are
 * namespaced `approval.<id>`, `paidFrom.<id>`, `sourceKind.<id>`.
 */
export function vocabulary(labels: Record<string, string> | null | undefined): {
  approvals: VocabEntry[];
  paidFrom: VocabEntry[];
  sourceKinds: VocabEntry[];
} {
  const over = labels ?? {};
  const say = (ns: string, id: string, fallback: string) => {
    const v = over[`${ns}.${id}`];
    return typeof v === "string" && v.trim() ? v.trim() : fallback;
  };
  return {
    approvals: APPROVALS.map((id) => ({ id, label: say("approval", id, APPROVAL_LABELS[id]) })),
    paidFrom: PAID_FROM.map((id) => ({ id, label: say("paidFrom", id, PAID_FROM_LABELS[id]) })),
    sourceKinds: SOURCE_KINDS.map((id) => ({ id, label: say("sourceKind", id, SOURCE_KIND_LABELS[id]) })),
  };
}

// ── Rows ────────────────────────────────────────────────────────────────────

export interface SpendingRuleRow {
  id: string;
  scope: "circle" | "role";
  scopeId: string;
  amountMinor: number;
  unit: string;
  approval: Approval;
  approvalNote: string | null;
  paidFrom: PaidFrom;
  visibility: "village" | "holders";
  note: string | null;
  createdBy: string | null;
  isExample: boolean;
}

export interface FundingSourceRow {
  id: string;
  name: string;
  kind: SourceKind;
  sharePct: number | null;
  amountMinorPerYear: number | null;
  unit: string | null;
  note: string | null;
  sortOrder: number;
  isExample: boolean;
}

export interface CircleBudgetRow {
  id: string;
  circleId: string;
  seasonId: string | null;
  /** The SEASON cap. 0084's original column, meaning unchanged. */
  amountMinor: number;
  /**
   * The CYCLE cap (0168). Null means the village set none, which is every
   * village until it sets one and is why the column is nullable. Zero is a
   * real value and means zero: a circle with a cycle cap of 0 may issue
   * nothing this cycle, the same way every other cap in this build fails
   * closed.
   */
  cycleAmountMinor: number | null;
  /**
   * WHICH MODEL THIS CIRCLE RUNS ON (0181), and it is per circle by ruling.
   *
   * `cap` is every row that existed before 0181 and is the column's default:
   * the two caps above bound a right to ISSUE and nothing is held. `treasury`
   * means real tokens in `sys:circle:<circleId>`, which persist across a
   * period and are read from the ledger, never from this table.
   */
  mode: BudgetMode;
  /**
   * A queued change to that model, or null.
   *
   * It has NOT happened. `modeAt` in shared/circleTreasury.ts decides which
   * model is running at an instant; this is the schedule, not the state.
   */
  pending: PendingModeChange | null;
  /**
   * WHAT THIS TREASURY HELD WHEN ITS CIRCLE WENT DORMANT, and where it went.
   *
   * Null means the circle has never gone dormant under this budget. That is
   * the distinction Rye's ruling forces: a circle that never had a treasury, a
   * circle whose treasury was swept when it went dormant, and a circle awake
   * with a treasury of zero all read zero, and all three mean something
   * different. This column is what tells the middle one apart.
   */
  dormant: { heldMinor: number; at: string; destination: string } | null;
  unit: string;
  note: string | null;
  isExample: boolean;
}

/**
 * Who is looking, built by the route (the structureRead pattern): the lib
 * never reads a session. `heldRoleIds` and `circleIds` come from LIVE org
 * seatings; `canDeclare` is admin, org.declare, or a represents_circle seat
 * (R29 P10); `canRequest` is proposal.open while the forum is on.
 */
export interface ResourcesViewer {
  userId: string | null;
  isAdmin: boolean;
  canDeclare: boolean;
  canRequest: boolean;
  heldRoleIds: string[];
  circleIds: string[];
}

// ── Validation, as sentences ────────────────────────────────────────────────

const ISO_UNIT = /^[A-Z]{3}$/;
const TOKEN_UNIT = /^token:([a-z0-9][a-z0-9-]{0,30})$/;

/**
 * A unit is an uppercase ISO 4217 code or `token:<slug>` where the slug is
 * a token this deployment's registry knows. `tokenExists` is the caller's
 * lookup (ledger.tokenDef under the routes; a plain map in tests).
 */
export function unitProblem(unit: unknown, tokenExists: (slug: string) => boolean): string | null {
  const u = String(unit ?? "");
  if (ISO_UNIT.test(u)) return null;
  const m = TOKEN_UNIT.exec(u);
  if (!m) return "A unit is a three letter currency code like CHF, or token:<slug> for a village token";
  if (!tokenExists(m[1])) return `No token called "${m[1]}" exists here`;
  return null;
}

function amountProblem(v: unknown, what: string): string | null {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) return `${what} must be a whole number of minor units, above zero`;
  return null;
}

export function ruleProblem(body: any, tokenExists: (slug: string) => boolean): string | null {
  if (!body || typeof body !== "object") return "A rule must be an object";
  if (!["circle", "role"].includes(String(body.scope))) return "scope must be circle or role";
  if (!String(body.scopeId ?? "").trim()) return "scopeId must name a circle or a seat";
  const amount = amountProblem(body.amountMinor, "amountMinor");
  if (amount) return amount;
  const unit = unitProblem(body.unit, tokenExists);
  if (unit) return unit;
  if (!APPROVALS.includes(body.approval)) return `approval must be one of: ${APPROVALS.join(", ")}`;
  if (body.approval === "other" && !String(body.approvalNote ?? "").trim()) {
    return "approval other needs approvalNote: say in your own words who says yes";
  }
  if (!PAID_FROM.includes(body.paidFrom)) return `paidFrom must be one of: ${PAID_FROM.join(", ")}`;
  if (body.paidFrom === "other" && !String(body.note ?? "").trim()) {
    return "paidFrom other needs a note: say in your own words which pot this draws on";
  }
  if (body.visibility !== undefined && !["village", "holders"].includes(String(body.visibility))) {
    return "visibility must be village or holders";
  }
  return null;
}

export function sourceProblem(body: any, tokenExists: (slug: string) => boolean): string | null {
  if (!body || typeof body !== "object") return "A funding source must be an object";
  if (!String(body.name ?? "").trim()) return "A funding source needs a name";
  if (!SOURCE_KINDS.includes(body.kind)) return `kind must be one of: ${SOURCE_KINDS.join(", ")}`;
  if (body.kind === "other" && !String(body.note ?? "").trim()) {
    return "kind other needs a note: say in your own words what this source is";
  }
  if (body.sharePct !== undefined && body.sharePct !== null) {
    const p = Number(body.sharePct);
    if (!Number.isFinite(p) || p < 0 || p > 100) return "sharePct is a percentage between 0 and 100";
  }
  if (body.amountMinorPerYear !== undefined && body.amountMinorPerYear !== null) {
    const a = amountProblem(body.amountMinorPerYear, "amountMinorPerYear");
    if (a) return a;
    const unit = unitProblem(body.unit, tokenExists);
    if (unit) return unit;
  }
  return null;
}

export function budgetProblem(body: any, tokenExists: (slug: string) => boolean): string | null {
  if (!body || typeof body !== "object") return "A budget must be an object";
  if (!String(body.circleId ?? "").trim()) return "A budget names a circle";
  const amount = amountProblem(body.amountMinor, "amountMinor");
  if (amount) return amount;
  const unit = unitProblem(body.unit, tokenExists);
  if (unit) return unit;
  if (body.seasonId !== undefined && body.seasonId !== null && !String(body.seasonId).trim()) {
    return "seasonId is a season id, or leave it out for a standing budget";
  }
  /*
   * THE CYCLE CAP ADMITS ZERO AND THE SEASON CAP DOES NOT, which looks like an
   * inconsistency and is a decision. `amountProblem` refuses zero because a
   * season envelope of nothing is a row nobody meant to write. A CYCLE cap of
   * zero is a real instruction: it holds a circle still for this cycle while
   * its season envelope stays intact, and it is the only way to say that
   * without deleting the row. Caps fail closed everywhere else in this build,
   * so zero has to mean zero here too.
   */
  if (body.cycleAmountMinor !== undefined && body.cycleAmountMinor !== null) {
    const n = Number(body.cycleAmountMinor);
    if (!Number.isSafeInteger(n) || n < 0) {
      return "cycleAmountMinor must be a whole number of minor units, zero or above";
    }
  }
  /*
   * A MODE IS OPTIONAL AND, WHEN GIVEN, IT IS ONE OF TWO WORDS (0181).
   *
   * It only reaches the INSERT. `upsertBudget`'s UPDATE never names `mode`, so
   * a mode sent with an edit is ignored on purpose: switching models is a
   * scheduled act at a period boundary and not a side effect of changing an
   * amount. Both caps above stay required by the table and stop being read the
   * moment a row runs on a treasury, because a treasury has a balance and no
   * ceiling.
   */
  if (body.mode !== undefined && body.mode !== null && !isBudgetMode(body.mode)) {
    return `mode must be ${BUDGET_MODES.join(" or ")}`;
  }
  return null;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listRules(pool: Pool): Promise<SpendingRuleRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
    "SELECT id, scope, scope_id, amount_minor, unit, approval, approval_note, paid_from, visibility, note, created_by, is_example FROM spending_rules ORDER BY scope, scope_id, approval",
  );
  return (rows as any[]).map((r) => ({
    id: String(r.id),
    scope: r.scope === "role" ? "role" : "circle",
    scopeId: String(r.scope_id),
    amountMinor: Number(r.amount_minor),
    unit: String(r.unit),
    approval: r.approval as Approval,
    approvalNote: r.approval_note ?? null,
    paidFrom: r.paid_from as PaidFrom,
    visibility: r.visibility === "holders" ? "holders" : "village",
    note: r.note ?? null,
    createdBy: r.created_by ?? null,
    isExample: Number(r.is_example ?? 0) === 1,
  }));
}

export async function listSources(pool: Pool): Promise<FundingSourceRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
    "SELECT id, name, kind, share_pct, amount_minor_per_year, unit, note, sort_order, is_example FROM funding_sources ORDER BY sort_order, name",
  );
  return (rows as any[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as SourceKind,
    sharePct: r.share_pct === null || r.share_pct === undefined ? null : Number(r.share_pct),
    amountMinorPerYear:
      r.amount_minor_per_year === null || r.amount_minor_per_year === undefined ? null : Number(r.amount_minor_per_year),
    unit: r.unit ?? null,
    note: r.note ?? null,
    sortOrder: Number(r.sort_order ?? 0),
    isExample: Number(r.is_example ?? 0) === 1,
  }));
}

export async function listBudgets(pool: Pool): Promise<CircleBudgetRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
    "SELECT id, circle_id, season_id, amount_minor, cycle_amount_minor, mode, pending_mode, " +
      "pending_from, pending_by, pending_at, dormant_held_minor, dormant_at, dormant_to, " +
      "unit, note, is_example FROM circle_budgets ORDER BY circle_id, season_id",
  );
  return (rows as any[]).map((r) => ({
    id: String(r.id),
    circleId: String(r.circle_id),
    seasonId: r.season_id ?? null,
    amountMinor: Number(r.amount_minor),
    // NULL and 0 are different answers here, so the coercion keeps them apart.
    cycleAmountMinor: r.cycle_amount_minor === null || r.cycle_amount_minor === undefined
      ? null
      : Number(r.cycle_amount_minor),
    /*
     * ANYTHING THIS COLUMN DOES NOT RECOGNISE READS AS `cap`, which is the
     * conservative direction: a cap holds no tokens, so a misread cannot
     * invent a balance. The reverse default would show every circle an empty
     * treasury, which reads as a circle that has spent everything.
     */
    mode: isBudgetMode(r.mode) ? r.mode : "cap",
    // `pending_from` alone says whether a change is queued, the same way
    // `pending_from_cycle` does on mint_rules. Half a pending row is no row.
    pending: isBudgetMode(r.pending_mode) && r.pending_from
      ? {
          mode: r.pending_mode as BudgetMode,
          from: new Date(r.pending_from).toISOString(),
          by: r.pending_by ?? null,
          at: r.pending_at ? new Date(r.pending_at).toISOString() : null,
        }
      : null,
    // `dormant_at` alone says a sweep happened. A held figure of 0 with a date
    // is a real answer: the circle went dormant holding nothing.
    dormant: r.dormant_at
      ? {
          heldMinor: Number(r.dormant_held_minor ?? 0),
          at: new Date(r.dormant_at).toISOString(),
          destination: String(r.dormant_to ?? ""),
        }
      : null,
    unit: String(r.unit),
    note: r.note ?? null,
    isExample: Number(r.is_example ?? 0) === 1,
  }));
}

/** Does this rule name a seat the viewer holds, or a circle they hold a seat in? */
export function ruleAppliesTo(rule: SpendingRuleRow, viewer: ResourcesViewer): boolean {
  if (rule.scope === "role") return viewer.heldRoleIds.includes(rule.scopeId);
  return viewer.circleIds.includes(rule.scopeId);
}

/**
 * The member tier (harm metric c): admins and declarers see every rule;
 * a member sees `village` rules plus `holders` rules for a seat they hold
 * or a circle they hold a seat in; a stranger sees none at all.
 */
export function visibleRules(rules: SpendingRuleRow[], viewer: ResourcesViewer): SpendingRuleRow[] {
  if (viewer.isAdmin || viewer.canDeclare) return rules;
  if (!viewer.userId) return [];
  return rules.filter((r) => r.visibility === "village" || ruleAppliesTo(r, viewer));
}

/** The stranger tier: name and kind only, no amounts, no notes, no rules. */
export function publicSources(sources: FundingSourceRow[]): Array<{ name: string; kind: SourceKind }> {
  return sources.map((s) => ({ name: s.name, kind: s.kind }));
}

// ── Measured inflows: SELECT only, counts and totals, never a user id ───────

/** The four system accounts the measured read is restricted to. Anything
 *  else in the ledger names a member and stays out of this payload. */
export const MEASURED_ACCOUNTS = ["sys:treasury", "sys:mint", "sys:gratitude-pool", "sys:cycle-pool"] as const;

export interface MeasuredFiatRow {
  module: string;
  currency: string;
  count: number;
  totalMinor: number;
}

export interface MeasuredTokenRow {
  account: string;
  tokenType: string;
  direction: "in" | "out";
  count: number;
  total: number;
}

export interface MeasuredInflows {
  fiat: MeasuredFiatRow[];
  tokens: MeasuredTokenRow[];
}

export async function measuredInflows(pool: Pool): Promise<MeasuredInflows> {
  const [fiatRows] = await pool.query<RowDataPacket[]>( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
    "SELECT module, currency, COUNT(*) AS n, COALESCE(SUM(amount_minor), 0) AS total FROM fiat_charges WHERE status = 'paid' GROUP BY module, currency",
  );
  const accounts = [...MEASURED_ACCOUNTS];
  const marks = accounts.map(() => "?").join(",");
  const [inRows] = await pool.query<RowDataPacket[]>( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
    `SELECT to_account AS account, token_type, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM token_ledger WHERE to_account IN (${marks}) GROUP BY to_account, token_type`,
    accounts,
  );
  const [outRows] = await pool.query<RowDataPacket[]>( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
    `SELECT from_account AS account, token_type, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM token_ledger WHERE from_account IN (${marks}) GROUP BY from_account, token_type`,
    accounts,
  );
  const tokenRow = (r: any, direction: "in" | "out"): MeasuredTokenRow => ({
    account: String(r.account),
    tokenType: String(r.token_type),
    direction,
    count: Number(r.n),
    total: Number(r.total),
  });
  return {
    fiat: (fiatRows as any[]).map((r) => ({
      module: String(r.module),
      currency: String(r.currency).toUpperCase(),
      count: Number(r.n),
      totalMinor: Number(r.total),
    })),
    tokens: [
      ...(inRows as any[]).map((r) => tokenRow(r, "in")),
      ...(outRows as any[]).map((r) => tokenRow(r, "out")),
    ],
  };
}

// ── Amounts and sentences ───────────────────────────────────────────────────

export interface TokenWords {
  name: string;
  decimals: number;
}

/** Minor units and a unit code, as words. Tokens divide by their own
 *  decimals and wear their registry name; unknown slugs stay honest. */
export function amountWords(
  amountMinor: number,
  unit: string,
  tokenWords?: (slug: string) => TokenWords | undefined,
): string {
  const m = TOKEN_UNIT.exec(unit);
  if (!m) return formatMoney(amountMinor, unit);
  const def = tokenWords?.(m[1]);
  const decimals = def?.decimals ?? 0;
  const major = decimals > 0 ? amountMinor / Math.pow(10, decimals) : amountMinor;
  return `${major} ${def?.name ?? m[1]}`;
}

interface SentenceContext {
  circleName: (id: string) => string;
  roleName: (id: string) => string;
  /** L2's decides_by for the money domain, when the circle declared one. */
  moneyMethod?: (circleId: string) => string | null;
  tokenWords?: (slug: string) => TokenWords | undefined;
}

function paidFromWords(rule: SpendingRuleRow, ctx: SentenceContext): string {
  const circleFor = rule.scope === "circle" ? ctx.circleName(rule.scopeId) : null;
  switch (rule.paidFrom) {
    case "treasury":
      return "from the village treasury";
    case "circle-budget":
      return circleFor ? `from the ${circleFor} budget` : "from the circle budget";
    case "member":
      return "from your own pocket";
    case "grant":
      return "from a grant";
    case "sponsor":
      return "from a sponsor";
    case "other":
      return rule.note ? `from ${rule.note}` : "from another pot";
  }
}

function approvalWords(rule: SpendingRuleRow, ctx: SentenceContext): string {
  const circleFor = rule.scope === "circle" ? ctx.circleName(rule.scopeId) : null;
  switch (rule.approval) {
    case "none":
      return "without asking";
    case "circle-consent":
      return circleFor ? `with ${circleFor} consent` : "with the circle's consent";
    case "lead":
      return "with the circle lead's yes";
    case "founders":
      return "with the founders' yes";
    case "treasury":
      return "with the treasury's yes";
    case "hypha":
      return "with a decision on the village's Hypha space";
    case "other":
      return rule.approvalNote ? `with ${rule.approvalNote}` : "with an approval of the village's own";
  }
}

export function scopeWords(rule: SpendingRuleRow, ctx: SentenceContext): string {
  return rule.scope === "role" ? `the ${ctx.roleName(rule.scopeId)} seat` : `the ${ctx.circleName(rule.scopeId)} circle`;
}

export interface FourAnswers {
  /** What you can spend without asking. */
  alone: string[];
  /** What needs whose yes. */
  withApproval: string[];
  /** Which pots exist: budgets by circle and season. */
  paidFrom: string[];
  /** Where the money comes from. */
  comesFrom: string[];
}

/**
 * The four questions (proposal, card B), answered as template sentences at
 * zero tokens. Only rules that APPLY to the viewer land in the first two
 * lists; the pots and the sources are the village's shared story.
 */
export function answerFourQuestions(
  view: {
    rules: SpendingRuleRow[];
    budgets: CircleBudgetRow[];
    sources: FundingSourceRow[];
  },
  viewer: ResourcesViewer,
  ctx: SentenceContext,
): FourAnswers {
  const mine = view.rules.filter((r) => ruleAppliesTo(r, viewer));
  const alone: string[] = [];
  const withApproval: string[] = [];
  for (const rule of mine) {
    const amount = amountWords(rule.amountMinor, rule.unit, ctx.tokenWords);
    const where = paidFromWords(rule, ctx);
    if (rule.approval === "none") {
      alone.push(`You can spend up to ${amount} ${where} without asking, as ${scopeWords(rule, ctx)}.`);
    } else {
      withApproval.push(`Up to ${amount} ${where}, ${approvalWords(rule, ctx)}, as ${scopeWords(rule, ctx)}.`);
    }
  }
  // How the circle decides about money (L2's domain lens), where declared.
  if (ctx.moneyMethod) {
    const seen = new Set<string>();
    for (const rule of mine) {
      if (rule.scope !== "circle" || seen.has(rule.scopeId)) continue;
      seen.add(rule.scopeId);
      const method = ctx.moneyMethod(rule.scopeId);
      if (method) withApproval.push(`About money, ${ctx.circleName(rule.scopeId)} decides by ${method}.`);
    }
  }
  if (!mine.length) {
    alone.push("No spending rule names a seat you hold yet. The village rules below still apply to everyone.");
  }
  const paidFrom = view.budgets.map((b) => {
    const amount = amountWords(b.amountMinor, b.unit, ctx.tokenWords);
    const when = b.seasonId ? `for season ${b.seasonId}` : "as a standing envelope";
    return `${ctx.circleName(b.circleId)} holds ${amount} ${when}.`;
  });
  const comesFrom = view.sources.map((s) => {
    const kind = SOURCE_KIND_LABELS[s.kind] ?? s.kind;
    if (s.sharePct !== null) return `${s.name}: about ${s.sharePct}% of the whole.`;
    if (s.amountMinorPerYear !== null && s.unit) {
      return `${s.name}: about ${amountWords(s.amountMinorPerYear, s.unit, ctx.tokenWords)} a year.`;
    }
    return s.kind === "other" && s.note ? `${s.name}: ${s.note}.` : `${s.name}: ${kind.toLowerCase()}.`;
  });
  if (!comesFrom.length) comesFrom.push("No funding source is written down yet.");
  return { alone, withApproval, paidFrom, comesFrom };
}

// ── The approval request: a pre-fill for the EXISTING decision primitive ────

export interface ApprovalRequestPrefill {
  category: string;
  kind: "decision";
  title: string;
  body: string;
  meta: {
    resourcesRequest: {
      ruleId: string;
      scope: "circle" | "role";
      scopeId: string;
      amountMinor: number;
      unit: string;
      approval: Approval;
      paidFrom: PaidFrom;
      requestKey: string;
    };
  };
}

/** Same rule, same amount, same author while open reads as the same ask. */
export function requestKeyFor(ruleId: string, amountMinor: number): string {
  return `${ruleId}:${amountMinor}`;
}

/**
 * Build the forum pre-fill for "Request approval". The caller has already
 * checked the rule applies, the approval is not `none`, and the amount fits
 * under the rule's ceiling. Nothing here posts anything: the client hands
 * this to POST /api/forum/threads, the one decision primitive.
 */
export function buildApprovalRequest(
  rule: SpendingRuleRow,
  amountMinor: number,
  purpose: string,
  ctx: SentenceContext,
  forumCategories: Array<{ id: string }>,
  requestCategory: string,
): ApprovalRequestPrefill {
  const category = forumCategories.some((c) => c.id === requestCategory)
    ? requestCategory
    : String(forumCategories[0]?.id ?? requestCategory);
  const amount = amountWords(amountMinor, rule.unit, ctx.tokenWords);
  const ceiling = amountWords(rule.amountMinor, rule.unit, ctx.tokenWords);
  const cleanPurpose = purpose.trim().slice(0, 500);
  const title = `Spending approval: ${amount} for ${cleanPurpose.slice(0, 80)}`;
  const body = [
    `I am asking to spend ${amount} ${paidFromWords(rule, ctx)}, under the rule for ${scopeWords(rule, ctx)}.`,
    `Purpose: ${cleanPurpose}`,
    `The rule allows up to ${ceiling} ${approvalWords(rule, ctx)}.`,
    "Raised from the resources map.",
  ].join("\n\n");
  return {
    category,
    kind: "decision",
    title,
    body,
    meta: {
      resourcesRequest: {
        ruleId: rule.id,
        scope: rule.scope,
        scopeId: rule.scopeId,
        amountMinor,
        unit: rule.unit,
        approval: rule.approval,
        paidFrom: rule.paidFrom,
        requestKey: requestKeyFor(rule.id, amountMinor),
      },
    },
  };
}

// ── Writes: three tables, nothing else ──────────────────────────────────────

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function upsertRule(pool: Pool, body: any, actorId: string | null): Promise<string> {
  const id = String(body.id ?? "").trim() || newId("rule");
  const params = [
    body.scope,
    String(body.scopeId),
    Number(body.amountMinor),
    String(body.unit),
    body.approval,
    body.approvalNote ? String(body.approvalNote).slice(0, 160) : null,
    body.paidFrom,
    body.visibility === "holders" ? "holders" : "village",
    body.note ? String(body.note).slice(0, 500) : null,
  ];
  const [result]: any = await pool.query( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
    "UPDATE spending_rules SET scope = ?, scope_id = ?, amount_minor = ?, unit = ?, approval = ?, approval_note = ?, paid_from = ?, visibility = ?, note = ? WHERE id = ?",
    [...params, id],
  );
  if (!result.affectedRows) {
    await pool.query( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
      "INSERT INTO spending_rules (id, scope, scope_id, amount_minor, unit, approval, approval_note, paid_from, visibility, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [id, ...params, actorId],
    );
  }
  await moduleActivity("resources", "resources", "The spending rules changed", {
    actorUserId: actorId,
    entityType: "spending_rule",
    entityRef: id,
  });
  return id;
}

export async function deleteRule(pool: Pool, id: string, actorId: string | null): Promise<boolean> {
  const [result]: any = await pool.query("DELETE FROM spending_rules WHERE id = ?", [id]); // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
  if (result.affectedRows) {
    await moduleActivity("resources", "resources", "A spending rule was removed", {
      actorUserId: actorId,
      entityType: "spending_rule",
      entityRef: id,
    });
  }
  return !!result.affectedRows;
}

export async function upsertSource(pool: Pool, body: any, actorId: string | null): Promise<string> {
  const id = String(body.id ?? "").trim() || newId("src");
  const params = [
    String(body.name).trim().slice(0, 120),
    body.kind,
    body.sharePct === null || body.sharePct === undefined ? null : Number(body.sharePct),
    body.amountMinorPerYear === null || body.amountMinorPerYear === undefined ? null : Number(body.amountMinorPerYear),
    body.unit ? String(body.unit) : null,
    body.note ? String(body.note).slice(0, 500) : null,
    Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
  ];
  const [result]: any = await pool.query( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
    "UPDATE funding_sources SET name = ?, kind = ?, share_pct = ?, amount_minor_per_year = ?, unit = ?, note = ?, sort_order = ? WHERE id = ?",
    [...params, id],
  );
  if (!result.affectedRows) {
    await pool.query( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
      "INSERT INTO funding_sources (id, name, kind, share_pct, amount_minor_per_year, unit, note, sort_order) VALUES (?,?,?,?,?,?,?,?)",
      [id, ...params],
    );
  }
  await moduleActivity("resources", "resources", "The funding sources changed", {
    actorUserId: actorId,
    entityType: "funding_source",
    entityRef: id,
  });
  return id;
}

export async function deleteSource(pool: Pool, id: string, actorId: string | null): Promise<boolean> {
  const [result]: any = await pool.query("DELETE FROM funding_sources WHERE id = ?", [id]); // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
  if (result.affectedRows) {
    await moduleActivity("resources", "resources", "A funding source was removed", {
      actorUserId: actorId,
      entityType: "funding_source",
      entityRef: id,
    });
  }
  return !!result.affectedRows;
}

/**
 * One budget per (circle, season, unit). The table's unique key holds for
 * dated seasons; the no-season case dedupes HERE because MySQL unique keys
 * treat NULLs as always distinct (0084's header).
 */
export async function upsertBudget(pool: Pool, body: any, actorId: string | null): Promise<string> {
  const circleId = String(body.circleId);
  const seasonId = body.seasonId ? String(body.seasonId).slice(0, 64) : null;
  const unit = String(body.unit);
  const amount = Number(body.amountMinor);
  // Absent and null both mean "no cycle cap"; 0 means a cap of zero (0168).
  const cycleAmount =
    body.cycleAmountMinor === undefined || body.cycleAmountMinor === null
      ? null
      : Number(body.cycleAmountMinor);
  const note = body.note ? String(body.note).slice(0, 500) : null;
  /*
   * THE MODE IS SETTABLE AT CREATION AND NEVER ON AN EDIT (0181).
   *
   * A budget being written for the first time has no period to finish, so a
   * village saying "this circle runs on a treasury" is a starting condition
   * and not a switch. Once the row exists, Rye's ruling binds: a change to the
   * model waits for the period boundary, and it goes through `queueModeChange`
   * in server/lib/circleTreasury.ts. So the UPDATE below deliberately does not
   * name `mode`, which means editing an amount cannot flip the model even if
   * a caller sends one, and a queued change survives an amount edit.
   */
  const mode: BudgetMode = isBudgetMode(body.mode) ? body.mode : "cap";
  const [updated]: any = await pool.query( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
    "UPDATE circle_budgets SET amount_minor = ?, cycle_amount_minor = ?, note = ? WHERE circle_id = ? AND unit = ? AND ((season_id IS NULL AND ? IS NULL) OR season_id = ?)",
    [amount, cycleAmount, note, circleId, unit, seasonId, seasonId],
  );
  let id = String(body.id ?? "").trim();
  if (!updated.affectedRows) {
    id = id || newId("budget");
    await pool.query( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
      "INSERT INTO circle_budgets (id, circle_id, season_id, amount_minor, cycle_amount_minor, mode, unit, note) VALUES (?,?,?,?,?,?,?,?)",
      [id, circleId, seasonId, amount, cycleAmount, mode, unit, note],
    );
  } else if (!id) {
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
      "SELECT id FROM circle_budgets WHERE circle_id = ? AND unit = ? AND ((season_id IS NULL AND ? IS NULL) OR season_id = ?) LIMIT 1",
      [circleId, unit, seasonId, seasonId],
    );
    id = String((rows as any[])[0]?.id ?? "");
  }
  await moduleActivity("resources", "resources", "The circle budgets changed", {
    actorUserId: actorId,
    entityType: "circle_budget",
    entityRef: id,
  });
  return id;
}

export async function deleteBudget(pool: Pool, id: string, actorId: string | null): Promise<boolean> {
  const [result]: any = await pool.query("DELETE FROM circle_budgets WHERE id = ?", [id]); // module-review-ok: the declaration tables' one enumerable home (the structureRead pattern); no cache sits above these three tables
  if (result.affectedRows) {
    await moduleActivity("resources", "resources", "A circle budget was removed", {
      actorUserId: actorId,
      entityType: "circle_budget",
      entityRef: id,
    });
  }
  return !!result.affectedRows;
}
