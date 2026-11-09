/**
 * THE CASH BUDGET (budgets spec v0.2; tables in 0360). The one write path, the
 * moon's figure, and the registry a library source plugs into.
 *
 *   importBudgetLines(pool, input)   R2, R3, R4's flags, R5, R14: every write
 *                                    to a budget line goes through here, the
 *                                    upload, a hand edit, an accepted
 *                                    suggestion and the library alike
 *   cashBudgetLeft(pool, moonId)     R6 to R8: the one figure the valuation
 *                                    engine reads for a moon, or null
 *   registerBudgetSource(name, pull) the registry a puller plugs into (the
 *                                    knowledge library's puller is PR 2)
 *
 * Who may write is the route's (server/routes/budgets.ts, the R21 door). The
 * SQL is server/repos/budgets.ts. The pure arithmetic is shared/budgets.ts.
 *
 * ── THE BINDING PREVIEW (R14, I.21) ────────────────────────────────────────
 *
 * A preview writes nothing and returns `revision`: a digest of the budget as
 * it stood AND of exactly what this import would do to it. A confirm
 * recomputes both under the budget's lock and writes only when the digest is
 * the one the person saw. Anything else answers 409 with the fresh preview,
 * so nobody confirms a change they were never shown.
 *
 * ── A LINE'S KEY NEVER CHANGES ─────────────────────────────────────────────
 *
 * `line_key` is computed once, when the line is made, and never rewritten. A
 * hand edit to an uploaded line turns it into a hand line (source `manual`)
 * and keeps the key, so the next upload of the same sheet finds it, sees it
 * was edited by hand, and leaves it alone (R2). The preview says so.
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  ADMIN_BEFORE_LAUNCH,
  ADMIN_NO_STEWARD,
  BREAK_GLASS,
  BUDGET_CATEGORIES,
  BY_VILLAGE_VOTE,
  VILLAGE_WIDE,
  IMPORT_ROWS_MAX,
  LABEL_MAX,
  NOTE_MAX,
  NO_COMMITMENTS,
  PROVIDER_RATE_MAX_DAYS,
  RATE_DIGITS,
  budgetFigure,
  inVillageCurrency,
  isBudgetSource,
  isFormulaCell,
  moonPeriod,
  moonPlan,
  rateDrift,
  rateUnits,
  readAmount,
  readCategory,
  resolvePeriod,
  shareMoved,
  shareState,
  lineShareOfMoon,
  sharedDays,
  whyNotCounted,
  type BudgetCategory,
  type BudgetSource,
  type CashBudgetLeft,
  type CommittedParts,
  committedTotal,
  type FigureLine,
  type LineStatus,
  type MoonPlan,
  type NumberFormatChoice,
  type PeriodEnv,
  type PeriodKind,
  type RateDrift,
  type SeasonLike,
  type ShareState,
} from "../../shared/budgets";
import { boundsForNumber, parseId } from "../../shared/cycleClock";
import { civilDateKey } from "../../shared/lunar";
import { FX_BASE, crossRate } from "../../shared/money";
import { daysInclusive } from "../../shared/moonRecap";
import * as repo from "../repos/budgets";
import { rosterRows } from "../repos/peopleRoster";
import { budgetNameCheck, nameFindWords, type NameCheck } from "./budgetNames";
import { cashKeys } from "./cashOwed";
import { recordEvent } from "./events";
import { dailyRatesUrl, latestRates } from "./fxRates";
import { activeClock, currentCycle } from "./gratitude-cycles";
import { launchedByVote } from "./orgDraftDecide";
import { stringVar } from "./variables";
import { villageTimezone } from "./villageReaders";

export { BY_VILLAGE_VOTE };

// ── The environment the figure is read in ───────────────────────────────────

/**
 * THE CASH ON WORK SET THIS MOON THAT HAS NO `cash_owed` ROW YET (R7, the
 * third committed part). INJECTABLE, AND STUBBED TO 0 TODAY.
 *
 * The valuation lane owns the records this reads, and the interface is agreed
 * (9 Nov): `cashSetThisMoonUnowed(pool, moonId)` exported from
 * server/lib/valuationStore.ts, over new `cash_minor`, `budget_revision` and
 * `moon_id` columns on `valuation_settings`, in that lane's next pull request.
 * It is not on main yet, so the default below answers 0 rows in the village's
 * currency and says so by its name. Wiring it later is one line at boot:
 * `configureBudgets({ cashSetThisMoonUnowed })`. `budgets.test.ts` pins that
 * the figure reads the hook, and that an answer in another currency is left
 * out and flagged, never summed.
 */
export type CashSetThisMoonUnowed = (pool: Pool, moonId: string) => Promise<{ minor: number; currency: string; rows: number }>;

export const cashSetThisMoonUnowedNotYetAgreed: CashSetThisMoonUnowed = async () => ({ minor: 0, currency: env.currency(), rows: 0 });

export interface BudgetEnv {
  /** The village's currency as configured, "" when it is not set (R8: then nothing counts). */
  currency(): string;
  timezone(): string;
  seasons(): readonly SeasonLike[];
  /** The moon a write's share before and after is shown for (R10). */
  currentMoonId(): string;
  cashSetThisMoonUnowed: CashSetThisMoonUnowed;
  /** Who holds `role.pay` now, the deny-aware live count (`liveHoldersOf`). For the switch's re-check (R18, P1). */
  rolePayHolders(): Promise<string[]>;
  /** Does this account hold `role.pay` now. Defaults to reading `rolePayHolders`. */
  holdsRolePay(userId: string): Promise<boolean>;
  /** Who sits in the steward's seat now (`liveHoldersOf(BREAK_GLASS_SEAT)`), for an admin's or a broken glass's switch. */
  stewardHolders(): Promise<string[]>;
  /** The org roles this account is seated in: a line naming one of the setter's never lands adopted under their switch (P1). */
  seatedRoleIds(userId: string): Promise<string[]>;
  /** Has the launch vote carried (`launchedByVote`). For `recheckSource`. */
  launched(pool: Pool): Promise<boolean>;
  /** The `budgets.village_circle_id` setting (a game variable), "" when it is not set (R34). */
  villageCircleSetting(): string;
  /** The server's secret every revision is keyed under (V7); "" keys them under one random key per boot. */
  revisionSecret(): string;
  /**
   * The base still to set this moon, for the share in percent (R10). The
   * valuation lane owns it too; null until handed in, and then the preview
   * shows the budget left before and after without a percentage.
   */
  baseToSet(db: Pool | PoolConnection, moonId: string): Promise<number | null>;
}

const DEFAULT_ENV: BudgetEnv = {
  currency: () => "",
  timezone: () => villageTimezone(),
  seasons: () => [],
  currentMoonId: () => currentCycle().id,
  cashSetThisMoonUnowed: cashSetThisMoonUnowedNotYetAgreed,
  // Fails closed: with nothing wired, nobody holds the power, so a re-check turns a source off.
  rolePayHolders: async () => [],
  holdsRolePay: async (userId) => (await env.rolePayHolders()).includes(userId),
  // Fails closed: with nothing wired, a steward is taken to sit, so an admin's switch after launch turns off.
  stewardHolders: async () => ["(not wired)"],
  seatedRoleIds: async () => [],
  launched: (pool) => launchedByVote(pool),
  villageCircleSetting: () => {
    try {
      return stringVar("budgets.village_circle_id");
    } catch {
      return "";
    }
  },
  baseToSet: async () => null,
  revisionSecret: () => "",
};

let env: BudgetEnv = { ...DEFAULT_ENV };

/** Called once at boot by the routes (server/routes/budgets.ts), and by a suite. */
export function configureBudgets(partial: Partial<BudgetEnv>): void {
  env = { ...env, ...partial };
}

/** Back to the defaults, for a suite. */
export function resetBudgetEnv(): void {
  env = { ...DEFAULT_ENV };
}

const periodEnvOf = (e: BudgetEnv): PeriodEnv => ({ timezone: e.timezone(), seasons: e.seasons() });

// ── A stored line ───────────────────────────────────────────────────────────

export interface StoredLine extends FigureLine {
  lineKey: string;
  sourceRef: string | null;
  sourceChangedAt: string | null;
  spentMinor: number | null;
  sourceLabel: string | null;
  note: string | null;
  adoptedAs: string | null;
  changedAt: string | null;
  changedBy: string | null;
  changedAs: string | null;
  /** The amount before the last change, and when that amount was written (R18). */
  prevPlannedMinor?: number | null;
  prevSeenAt?: string | null;
  /** The role a rate was locked as, kept as written (S10). */
  fxLockedAs?: string | null;
  /** An import withdrew it, so an import may restore it; a person's withdrawal sticks (M7). */
  withdrawnBySource?: boolean;
  /** A holder's rename of a source's line, which the name check passed (M9). */
  labelOverride?: string | null;
  /** Which of a source's words hold it, comma-separated: `label`, `source_label`, `note` (V5). */
  nameHeldCell?: string | null;
  /** A holder's rename of the source's own label for a line (V5). */
  sourceLabelOverride?: string | null;
}

/** What a line is called where people read it: a holder's rename, or its own label. */
export const displayLabel = (l: Pick<StoredLine, "label" | "labelOverride">): string => l.labelOverride ?? l.label;

/** The source label people read: a holder's rename, or the source's own words. */
export const displaySourceLabel = (l: Pick<StoredLine, "sourceLabel" | "sourceLabelOverride">): string | null => (l.sourceLabelOverride ?? l.sourceLabel) || null;

/** The cells a hold sits on (V5). A hold with no cell named is the label's. */
const heldCellsOf = (l: Pick<StoredLine, "nameHeld" | "nameHeldCell">): string[] =>
  l.nameHeldCell ? l.nameHeldCell.split(",").filter(Boolean) : l.nameHeld ? ["label"] : [];

/** A cell a holder renamed no longer holds the line (V5). */
const cellRenamed = (l: Pick<StoredLine, "labelOverride" | "sourceLabelOverride">, cell: string): boolean =>
  cell === "label" ? !!l.labelOverride : cell === "source_label" ? l.sourceLabelOverride !== null && l.sourceLabelOverride !== undefined : false;

/** Is the line held: some cell its source's words hold it on is not renamed yet (V5). */
export const stillHeld = (l: Pick<StoredLine, "nameHeld" | "nameHeldCell" | "labelOverride" | "sourceLabelOverride">): boolean => heldCellsOf(l).some((c) => !cellRenamed(l, c));

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function rowToLine(r: RowDataPacket): StoredLine {
  return {
    id: String(r.id),
    lineKey: String(r.line_key),
    source: r.source,
    sourceRef: str(r.source_ref),
    sourceChangedAt: iso(r.source_changed_at),
    periodKind: r.period_kind,
    periodKey: String(r.period_key),
    startsOn: String(r.starts_on_text ?? r.starts_on).slice(0, 10),
    endsOn: String(r.ends_on_text ?? r.ends_on).slice(0, 10),
    circleId: str(r.circle_id),
    roleId: str(r.role_id),
    matched: Number(r.matched) === 1,
    category: r.category,
    plannedMinor: Number(r.planned_minor),
    spentMinor: r.spent_minor === null || r.spent_minor === undefined ? null : Number(r.spent_minor),
    currency: String(r.currency),
    label: String(r.label),
    sourceLabel: str(r.source_label),
    note: str(r.note),
    status: r.status,
    adoptedAt: iso(r.adopted_at),
    adoptedAs: str(r.adopted_as),
    changedAt: iso(r.changed_at),
    changedBy: str(r.changed_by),
    changedAs: str(r.changed_as),
    fxRate: str(r.fx_rate),
    fxSource: str(r.fx_source),
    fxAsOf: r.fx_as_of_text ? String(r.fx_as_of_text) : null,
    fxLockedBy: str(r.fx_locked_by),
    fxLockedAt: iso(r.fx_locked_at),
    sourceVillageWide: Number(r.source_village_wide) === 1,
    prevPlannedMinor: r.prev_planned_minor === null || r.prev_planned_minor === undefined ? null : Number(r.prev_planned_minor),
    prevSeenAt: iso(r.prev_seen_at),
    fxInto: str(r.fx_into),
    fxLockedAs: str(r.fx_locked_as),
    withdrawnBySource: Number(r.withdrawn_by_source) === 1,
    nameHeld: Number(r.name_held) === 1,
    labelOverride: str(r.label_override),
    nameHeldCell: str(r.name_held_cell),
    sourceLabelOverride: r.source_label_override === null || r.source_label_override === undefined ? null : String(r.source_label_override),
  };
}

const digest = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

/** The key revisions fall back to when the server hands in no secret: one per boot (V7). */
const BOOT_REVISION_KEY = randomBytes(32);

/**
 * A REVISION, KEYED (V7). Every revision a reader is handed (`revision`,
 * `touchedRevision`, `stateRevision` and the versions a suggestion binds to)
 * is an HMAC under the server's secret, never a bare digest: the values it
 * covers include figures some readers may not see (spent, held words), and a
 * bare digest of a one-line preview could be matched against guesses. A line's
 * key is a plain digest, because it is stored and must read the same forever.
 */
const revisionOf = (v: unknown): string => {
  const secret = env.revisionSecret();
  const key = secret ? createHash("sha256").update(`budget-revisions:${secret}`).digest() : BOOT_REVISION_KEY;
  return createHmac("sha256", key).update(JSON.stringify(v)).digest("hex").slice(0, 32);
};

/** The fields whose change is a change to the budget. Who changed it, and when, are not. */
const valueOf = (l: StoredLine) => [
  l.id, l.lineKey, l.source, l.sourceRef, l.sourceChangedAt, l.periodKind, l.periodKey, l.startsOn, l.endsOn, l.circleId, l.roleId,
  l.matched, l.category, l.plannedMinor, l.spentMinor, l.currency, l.label, l.sourceLabel, l.note, l.status, l.adoptedAt,
  l.fxRate ?? null, l.fxSource ?? null, l.fxAsOf ?? null, !!l.sourceVillageWide, l.fxInto ?? null, !!l.withdrawnBySource, !!l.nameHeld, l.labelOverride ?? null,
  l.nameHeldCell ?? null, l.sourceLabelOverride ?? null,
];

/** The budget as it stands, as one digest: what the figure names as its `revision` (R7). */
export function stateRevision(lines: readonly StoredLine[]): string {
  return revisionOf([...lines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(valueOf));
}

// ── The key (R2) ────────────────────────────────────────────────────────────

/**
 * The label as the key reads it: NFC, trimmed, and fully case-folded, so "Straße"
 * and "STRASSE" are one key (upper then lower case folds the letters plain
 * lower case leaves alone).
 */
export const foldLabel = (label: string): string => label.normalize("NFC").trim().toUpperCase().toLowerCase().normalize("NFC");

export interface KeyMaterial {
  source: BudgetSource;
  periodKind: PeriodKind;
  periodKey: string;
  circleId: string | null;
  roleId: string | null;
  category: BudgetCategory;
  label: string;
  sourceRef?: string | null;
}

/**
 * A line's identity across imports. A library line is `sera:<source_ref>`.
 * Any other is its source and a digest of what it is, so the key stays under
 * the 191 characters a UNIQUE index on utf8mb4 holds whatever the label is.
 */
export function budgetLineKey(m: KeyMaterial): string {
  if (m.source === "sera") return `sera:${String(m.sourceRef ?? "")}`;
  return `${m.source}:${digest([m.source, m.periodKind, m.periodKey, m.circleId ?? "", m.roleId ?? "", m.category, foldLabel(m.label)])}`;
}

// ── What one import asks for ────────────────────────────────────────────────

/**
 * One row of an import. An upload sends a sheet's cells; a hand add sends one
 * row; a hand edit names the line's `id` and the cells it changes; a withdraw
 * or restore names the `id` and the action. A library puller sends ids it has
 * already matched, and `plannedMinor` it has already converted.
 */
export interface ImportRow {
  id?: string;
  /**
   * `lock` puts a rate on a line in another currency (spec 5a, option b):
   * `use: "provider"` locks the newest stored daily rate, read on the server;
   * otherwise `rate` and `sourceNote` are a rate a person typed. Locking a
   * locked line again re-locks it.
   */
  action?: "withdraw" | "restore" | "lock" | "adopt";
  use?: "provider";
  rate?: string | number;
  sourceNote?: string;
  /** For an adoption: what `adopted_as` says, "standing: <role>" under a source's switch. Defaults to the writer's role. */
  adoptedAs?: string;
  period?: string;
  circle?: string | null;
  role?: string | null;
  circleId?: string | null;
  roleId?: string | null;
  category?: string;
  label?: string;
  planned?: string | number;
  plannedMinor?: number;
  spent?: string | number | null;
  spentMinor?: number | null;
  currency?: string;
  note?: string | null;
  sourceRef?: string;
  sourceChangedAt?: string | null;
  sourceLabel?: string | null;
  matched?: boolean;
  status?: string;
}

/**
 * What an upload covers (R3). `whole` is the tick "this is the whole budget
 * for these periods", off by default: only then does the upload withdraw the
 * uploaded lines it no longer lists. Periods and circles default to the ones
 * its rows name; a circle of null is the village-wide lines.
 */
export interface ImportScope {
  periods?: string[];
  circles?: Array<string | null>;
  whole?: boolean;
}

export interface ChartCircle {
  id: string;
  name: string;
  isExample: boolean;
  status: string;
  layer: string | null;
  parentCircleId: string | null;
  sortOrder: number;
}

export interface BudgetChart {
  circles: ChartCircle[];
  roles: Array<{ id: string; name: string; circleId: string | null; active: boolean; isExample: boolean }>;
}

export interface Refused {
  /** The row of the import, counting from 1. 0 is the import's scope. */
  row: number;
  cell: string;
  reason: string;
  message: string;
}

export interface Held {
  row: number;
  cell: string;
  message: string;
}

export type FlagKind = "formula" | "overlap" | "kept_last_good" | "becomes_manual" | "adoption_cleared" | "rate_unlocked" | "name_held";

export interface Flag {
  row: number | null;
  cell: string;
  kind: FlagKind;
  message: string;
  ids?: string[];
}

export interface PlanWrite {
  op: "add" | "change" | "withdraw" | "restore" | "lock" | "adopt";
  row: number | null;
  /** The line after the write. An added line's id is "" until it is written. */
  line: StoredLine;
  before: StoredLine | null;
  /** The cell text of the amount, shown beside the parsed figure (R12). */
  plannedCell: string | null;
  becomesManual: boolean;
  adoptionCleared: boolean;
}

export interface ImportPlan {
  writes: PlanWrite[];
  unchanged: Array<{ row: number; id: string }>;
  /** Upload rows that land on a line edited by hand, which the upload leaves alone. */
  kept: Array<{ row: number; id: string; label: string }>;
  /** Upload rows that land on a line a person withdrew: "withdrawn by hand, left as it is" (M7). */
  keptWithdrawn: Array<{ row: number; id: string; label: string }>;
  /** A source's rows that list a line a person withdrew: "the source still lists this line" (M7). */
  stillListed: Array<{ row: number; id: string; label: string }>;
  /** A source's rows for a moon that has ended: listed, and left alone (M8). */
  ended: Array<{ row: number; label: string }>;
  refused: Refused[];
  held: Held[];
  flags: Flag[];
  withdrawSkipped: null | "refused_rows" | "empty_read";
}

export interface PlanInput {
  source: BudgetSource;
  rows: readonly ImportRow[];
  scope: ImportScope | null;
  format: NumberFormatChoice;
  existing: readonly StoredLine[];
  chart: BudgetChart;
  /** The village currency, "" when unset. */
  villageCurrency: string;
  periodEnv: PeriodEnv;
  names: NameCheck;
  /** The village's civil day, for a typed rate's date and a stored rate's age. */
  today: string;
  /** The newest stored rate from a currency into the village's, read on the server. Absent when no lock asks for one. */
  rates?: (from: string) => ProviderRate | null;
  /**
   * A source's standing switch (R18): `auto` lands its lines adopted at the
   * read time as `adoptedAs`; `review` (and a source that is off) lands them
   * waiting. Absent for the village's own imports.
   */
  standing?: { mode: "auto" | "review"; adoptedAs: string; setterRoleIds?: string[] } | null;
  /** When this import read its source, for `adopted_at` under the standing switch, and for an adoption. */
  readAt: string;
  /** The role the writer acts through, for an adoption's `adopted_as`. */
  byAs: string | null;
  /** The village's own circle (R34), which the circles view places village-wide lines on; null when none resolves. */
  villageCircleId: string | null;
  /** The first day of the moon in force: a period that ends before it is closed (M8). */
  currentMoonStartsOn: string | null;
}

/** Where the village's circle came from, for the page to say so (R34). */
export type VillageCircleFrom = "setting" | "link" | "lead" | "root";

/**
 * THE VILLAGE'S OWN CIRCLE (R34): the `budgets.village_circle_id` setting when
 * it names a circle that is not dormant, else the active circle whose
 * governance layer is `link`, else `lead`, else the only circle with no
 * parent. Null when none of those resolves. Example circles never count.
 */
export function villageCircleOf(circles: readonly ChartCircle[], setting: string): { id: string; from: VillageCircleFrom } | null {
  const live = circles.filter((c) => !c.isExample);
  const named = setting.trim() ? live.find((c) => c.id === setting.trim() && c.status !== "dormant") : undefined;
  if (named) return { id: named.id, from: "setting" };
  const active = live.filter((c) => c.status === "active");
  const link = active.find((c) => c.layer === "link");
  if (link) return { id: link.id, from: "link" };
  const lead = active.find((c) => c.layer === "lead");
  if (lead) return { id: lead.id, from: "lead" };
  const roots = live.filter((c) => !c.parentCircleId);
  return roots.length === 1 ? { id: roots[0].id, from: "root" } : null;
}

const NO_VILLAGE_CIRCLE =
  "This row names no circle, and the village has no circle of its own to put it on. Name the circle, or set the village's circle (the budgets.village_circle_id setting, under Village in the game's settings).";

/** A stored daily rate as a lock reads it: the rate (null past 14 days), its day and where it came from. */
export interface ProviderRate {
  rate: number | null;
  asOf: string | null;
  source: string;
}

const clean = (v: unknown): string => (typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim() : "");
const has = (v: unknown) => v !== undefined;

type Scope = { ok: true; circleId: string | null; roleId: string | null } | { ok: false; cell: string; message: string };

/** A circle by id or exact name, and a role by id or by name within the row's circle, active and no example (R11). */
export function matchScope(circleText: unknown, roleText: unknown, chart: BudgetChart): Scope {
  const c = clean(circleText);
  let circleId: string | null = null;
  if (c) {
    const circles = chart.circles.filter((x) => !x.isExample);
    const byId = circles.find((x) => x.id === c);
    const named = byId ? [byId] : circles.filter((x) => clean(x.name) === c);
    if (named.length > 1) return { ok: false, cell: "circle", message: `Two circles here are called "${c.slice(0, 60)}". Use the circle's id.` };
    if (!named.length) return { ok: false, cell: "circle", message: `No circle here is called "${c.slice(0, 60)}".` };
    circleId = named[0].id;
  }
  const r = clean(roleText);
  if (!r) return { ok: true, circleId, roleId: null };
  const roles = chart.roles.filter((x) => x.active && !x.isExample);
  const byId = roles.find((x) => x.id === r);
  const named = byId ? [byId] : roles.filter((x) => clean(x.name) === r && (circleId === null || x.circleId === circleId));
  if (named.length > 1) return { ok: false, cell: "role", message: `Two roles are called "${r.slice(0, 60)}"${circleId ? " in that circle" : ""}. Name the circle, or use the role's id.` };
  if (!named.length) return { ok: false, cell: "role", message: `No active role here is called "${r.slice(0, 60)}"${circleId ? " in that circle" : ""}.` };
  const role = named[0];
  if (circleId !== null && role.circleId !== circleId) return { ok: false, cell: "role", message: "This role sits in another circle. Name its own circle, or leave the circle empty." };
  return { ok: true, circleId: circleId ?? role.circleId, roleId: role.id };
}

type Cells = { ok: true; line: StoredLine; plannedCell: string | null; flags: Flag[]; held: Held[] } | { ok: false; refused: Refused[]; held: Held[] };

/** Every cell of one row read into a line, or every cell that refused (R11 to R13, R15). */
/** Format characters (zero-width joiners, direction marks) hide a name from the check; budget words never carry them (S6). */
const FORMAT_CHARS = new RegExp(String.raw`\p{Cf}`, "u");

function readCells(n: number, row: ImportRow, base: StoredLine | null, input: PlanInput): Cells {
  const refused: Refused[] = [];
  const held: Held[] = [];
  const flags: Flag[] = [];
  const refuse = (cell: string, reason: string, message: string) => refused.push({ row: n, cell, reason, message });
  const sera = input.source === "sera";

  // Period.
  let period = base ? { kind: base.periodKind, key: base.periodKey, startsOn: base.startsOn, endsOn: base.endsOn } : null;
  if (!base || has(row.period)) {
    const p = resolvePeriod(row.period, input.periodEnv);
    if (p.ok) period = p.period;
    else refuse("period", "period", p.message);
  }

  // Currency, then the amounts in it.
  const currencyText = clean(row.currency).toUpperCase();
  const currency = currencyText || base?.currency || input.villageCurrency.toUpperCase();
  if (!currency) refuse("currency", "currency", "This village has no currency set yet, so name the currency on the line, or set the village's currency first.");
  else if (!/^[A-Z]{3}$/.test(currency)) refuse("currency", "currency", "Write the currency as its three-letter code, like CRC or USD.");
  // A stored figure is minor units of its own currency: a new currency needs its amounts written again in it (M3).
  if (base && currencyText && currencyText !== base.currency) {
    const plannedSent = typeof row.plannedMinor === "number" || has(row.planned);
    const spentSent = typeof row.spentMinor === "number" || row.spentMinor === null || has(row.spent);
    if (!plannedSent || (base.spentMinor !== null && !spentSent)) {
      refuse("currency", "currency_needs_amount", "A new currency needs its amounts written again in it, so a stored figure is never read in another currency's units. Send the planned amount, and the spent amount if the line has one, with the currency.");
    }
  }

  const category = !base || has(row.category) ? readCategory(row.category) : base.category;
  if (!category) refuse("category", "category", "The category is one of role_pay, quest_pay, materials or other.");

  // Words (R13 keeps a formula as text and flags it; R15 checks names, for every source; S6 refuses hidden characters).
  const label = !base || has(row.label) ? clean(row.label) : base.label;
  if (!label) refuse("label", "label", "Give the line a label, like \"Garden crew pay\".");
  else if (Array.from(label).length > LABEL_MAX) refuse("label", "label", `Keep the label to ${LABEL_MAX} characters.`);
  const note = sera ? null : !base || has(row.note) ? clean(row.note) || null : base.note;
  if (note && Array.from(note).length > NOTE_MAX) refuse("note", "note", `Keep the note to ${NOTE_MAX} characters.`);
  const sourceLabel = sera ? clean(row.sourceLabel).slice(0, LABEL_MAX) || null : base?.sourceLabel ?? null;
  for (const [cell, text] of [["label", label], ["note", note], ["source_label", sourceLabel]] as const) {
    if (!text) continue;
    const raw = cell === "label" ? row.label : cell === "note" ? row.note : row.sourceLabel;
    if (FORMAT_CHARS.test(typeof raw === "string" ? raw : text)) {
      refuse(cell, "hidden_characters", "This cell carries invisible characters. Type it again as plain text.");
      continue;
    }
    if (isFormulaCell(typeof raw === "string" ? raw : text)) flags.push({ row: n, cell, kind: "formula", message: "This cell starts like a formula. It is kept as text, and an export marks it so a spreadsheet never runs it." });
    const find = input.names(text);
    if (find?.kind === "refused") refuse(cell, `name_${find.what}`, nameFindWords(find));
    else if (find?.kind === "held") held.push({ row: n, cell, message: nameFindWords(find) });
  }

  let plannedMinor = base?.plannedMinor ?? 0;
  let plannedCell: string | null = null;
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    if (typeof row.plannedMinor === "number") {
      if (!Number.isSafeInteger(row.plannedMinor) || row.plannedMinor < 0) refuse("planned", "planned", "The planned amount is a whole number of minor units, 0 or more.");
      else plannedMinor = row.plannedMinor;
    } else if (!base || has(row.planned)) {
      const a = readAmount(row.planned, currency, input.format);
      if (a.ok) {
        plannedMinor = a.minor;
        plannedCell = a.cell;
      } else refuse("planned", a.reason, a.message);
    }
  }
  let spentMinor = base?.spentMinor ?? null;
  if (typeof row.spentMinor === "number" || row.spentMinor === null) {
    if (row.spentMinor !== null && (!Number.isSafeInteger(row.spentMinor) || row.spentMinor < 0)) refuse("spent", "spent", "The spent amount is a whole number of minor units, 0 or more.");
    else spentMinor = row.spentMinor;
  } else if (has(row.spent)) {
    if (row.spent === null || String(row.spent).trim() === "") spentMinor = null;
    else if (currency && /^[A-Z]{3}$/.test(currency)) {
      const a = readAmount(row.spent, currency, input.format);
      if (a.ok) spentMinor = a.minor;
      else refuse("spent", a.reason, a.message);
    }
  }

  // Scope. A source hands ids it already matched (R17), and says when it could not.
  let circleId = base?.circleId ?? null;
  let roleId = base?.roleId ?? null;
  let matched = base?.matched ?? true;
  let sourceVillageWide = base?.sourceVillageWide ?? false;
  if (sera) {
    circleId = clean(row.circleId) || null;
    roleId = clean(row.roleId) || null;
    matched = row.matched !== false;
    sourceVillageWide = false;
    if (matched && roleId && !circleId) {
      // A role-only line takes its circle from the role on the chart, or cannot count (M10).
      const role = input.chart.roles.find((x) => x.id === roleId && x.active && !x.isExample);
      if (role?.circleId) circleId = role.circleId;
      else matched = false;
    } else if (matched && !circleId && !roleId) {
      // A line that names no circle is village-wide, marked so (R34, M2).
      circleId = VILLAGE_WIDE;
      sourceVillageWide = true;
    }
  } else if (!base || has(row.circle) || has(row.role) || has(row.circleId) || has(row.roleId)) {
    const circleText = has(row.circleId) ? row.circleId : has(row.circle) ? row.circle : base?.circleId === VILLAGE_WIDE ? null : base?.circleId ?? null;
    const roleText = has(row.roleId) ? row.roleId : has(row.role) ? row.role : base?.roleId ?? null;
    const s = matchScope(circleText, roleText, input.chart);
    if (s.ok) {
      circleId = s.circleId;
      roleId = s.roleId;
    } else refuse(s.cell, "scope", s.message);
  }
  // The village's own circle, named by name or id, is the village-wide scope: one key with a blank circle (V2).
  if (circleId !== null && circleId !== VILLAGE_WIDE && roleId === null && input.villageCircleId && circleId === input.villageCircleId) circleId = VILLAGE_WIDE;
  // Every line that counts names a circle or the village-wide scope (R34, M2): the fixed marker, never the dial's circle.
  if (!sera && circleId === null && !refused.some((r) => r.cell === "circle" || r.cell === "role")) {
    if (input.villageCircleId) circleId = VILLAGE_WIDE;
    else refuse("circle", "no_village_circle", NO_VILLAGE_CIRCLE);
  }

  const sourceRef = sera ? clean(row.sourceRef) : base?.sourceRef ?? null;
  if (sera && (!sourceRef || sourceRef.length > 128 || /^[a-z]+:\/\//i.test(sourceRef))) refuse("source_ref", "source_ref", "A library line names its record by the record's own id. Send the id alone, with no link.");
  const sourceChangedAt = sera ? (row.sourceChangedAt && !Number.isNaN(Date.parse(row.sourceChangedAt)) ? new Date(row.sourceChangedAt).toISOString() : null) : base?.sourceChangedAt ?? null;
  const status: LineStatus = sera ? (["approved", "draft", "closed"].includes(String(row.status)) ? (row.status as LineStatus) : "approved") : base?.status ?? "approved";

  if (refused.length || !period || !category) return { ok: false, refused, held };
  return {
    ok: true,
    plannedCell,
    flags,
    held,
    line: {
      id: base?.id ?? "",
      lineKey: base?.lineKey ?? "",
      source: input.source,
      sourceRef: sourceRef || null,
      sourceChangedAt,
      periodKind: period.kind,
      periodKey: period.key,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      circleId,
      roleId,
      matched,
      sourceVillageWide,
      category,
      plannedMinor,
      spentMinor,
      currency,
      label,
      sourceLabel,
      note,
      status,
      adoptedAt: base?.adoptedAt ?? null,
      adoptedAs: base?.adoptedAs ?? null,
      changedAt: base?.changedAt ?? null,
      changedBy: base?.changedBy ?? null,
      changedAs: base?.changedAs ?? null,
      ...(base ? keptLock(base) : UNLOCKED),
      withdrawnBySource: base?.withdrawnBySource ?? false,
      nameHeld: base?.nameHeld ?? false,
      labelOverride: base?.labelOverride ?? null,
      nameHeldCell: base?.nameHeldCell ?? null,
      sourceLabelOverride: base?.sourceLabelOverride ?? null,
    },
  };
}

type LockFields = Pick<StoredLine, "fxRate" | "fxSource" | "fxAsOf" | "fxLockedBy" | "fxLockedAt" | "fxInto" | "fxLockedAs">;
const UNLOCKED: LockFields = { fxRate: null, fxSource: null, fxAsOf: null, fxLockedBy: null, fxLockedAt: null, fxInto: null, fxLockedAs: null };
const keptLock = (t: StoredLine): LockFields => ({
  fxRate: t.fxRate ?? null,
  fxSource: t.fxSource ?? null,
  fxAsOf: t.fxAsOf ?? null,
  fxLockedBy: t.fxLockedBy ?? null,
  fxLockedAt: t.fxLockedAt ?? null,
  fxInto: t.fxInto ?? null,
  fxLockedAs: t.fxLockedAs ?? null,
});
/**
 * The amount before a change and when that amount was written (R18), kept
 * for "was X at the last sync": set when the planned amount moves, and
 * carried unchanged otherwise.
 */
function previousOf(t: StoredLine, next: StoredLine): Pick<StoredLine, "prevPlannedMinor" | "prevSeenAt"> {
  if (next.plannedMinor !== t.plannedMinor) return { prevPlannedMinor: t.plannedMinor, prevSeenAt: t.changedAt };
  return { prevPlannedMinor: t.prevPlannedMinor ?? null, prevSeenAt: t.prevSeenAt ?? null };
}

const RATE_UNLOCKED = "This line's currency changed, so the rate locked on it no longer applies. Lock a rate again for it to count.";

/** A typed rate: a plain decimal, above 0, at most 8 digits after the point. */
const TYPED_RATE = /^\d{1,10}(?:\.\d{1,8})?$/;

/** The rate one lock row asks for, or why it cannot be had (spec 5a, guard 1). */
function lockFor(n: number, row: ImportRow, t: StoredLine, input: PlanInput): { ok: true; rate: string; source: string; asOf: string } | { ok: false; refused?: Refused; held?: Held } {
  const refuse = (cell: string, reason: string, message: string) => ({ ok: false as const, refused: { row: n, cell, reason, message } });
  if (row.use === "provider") {
    const r = input.rates?.(t.currency) ?? null;
    const age = r?.asOf ? daysInclusive(r.asOf, input.today) - 1 : null;
    if (r?.asOf && age !== null && age > PROVIDER_RATE_MAX_DAYS) {
      return refuse("rate", "stale_rate", `The newest stored rate for ${t.currency} is from ${r.asOf}, more than ${PROVIDER_RATE_MAX_DAYS} days ago. Type a rate with its source instead.`);
    }
    if (!r || r.rate === null || !r.asOf || rateUnits(r.rate) === null) {
      return refuse("rate", "no_rate", `There is no stored rate for ${t.currency} from the last ${PROVIDER_RATE_MAX_DAYS} days. Type a rate with its source instead.`);
    }
    return { ok: true, rate: r.rate.toFixed(RATE_DIGITS), source: r.source.slice(0, 120), asOf: r.asOf };
  }
  const text = typeof row.rate === "number" ? String(row.rate) : clean(row.rate);
  const units = TYPED_RATE.test(text) ? rateUnits(text) : null;
  if (units === null || Number(text) > 1e9) return refuse("rate", "rate", `Type the rate as ${input.villageCurrency.toUpperCase()} per one ${t.currency}, a number above 0 with at most ${RATE_DIGITS} digits after the point.`);
  const note = clean(row.sourceNote);
  if (Array.from(note).length < 3 || Array.from(note).length > 100) return refuse("source_note", "source_note", "Say where this rate comes from, in a few words, so everyone reading the budget can check it.");
  if (FORMAT_CHARS.test(String(row.sourceNote ?? ""))) return refuse("source_note", "hidden_characters", "This note carries invisible characters. Type it again as plain text.");
  const find = input.names(note);
  if (find?.kind === "refused") return refuse("source_note", `name_${find.what}`, nameFindWords(find));
  if (find?.kind === "held") return { ok: false, held: { row: n, cell: "source_note", message: nameFindWords(find) } };
  return { ok: true, rate: (Number(units) / 10 ** RATE_DIGITS).toFixed(RATE_DIGITS), source: `typed: ${note}`.slice(0, 120), asOf: input.today };
}

/** Whether two lines say the same thing to the budget, whatever their id, key and source. */
const sameValues = (a: StoredLine, b: StoredLine): boolean => JSON.stringify(valueOf(a).slice(3)) === JSON.stringify(valueOf(b).slice(3));

/** What, if it changes on an adopted line a source sent, means a person must adopt it again (R18). */
const adoptionFacts = (l: StoredLine) => JSON.stringify([l.plannedMinor, l.currency, l.periodKind, l.periodKey, l.startsOn, l.endsOn, l.circleId, l.roleId, l.matched, l.category, l.status]);

const NOT_IN_LIBRARY = "This line came from the knowledge library, so it changes there. Rename it here if its words need it, withdraw it, or add a line of your own beside it.";
const CLOSED = "This line's period lies in a moon that has ended, and an ended moon's lines are never changed. Add a correction as a new line in the current moon.";

/** The fallback a role-shaped record says when the writer's role cannot be named: never the machine key. */
export const BUDGET_KEEPER = "a keeper of the cash budget";

/**
 * THE PLAN, pure: what one import does to the budget, row by row, and what it
 * withdraws (R2, R3). Nothing here reads or writes the database.
 */
export function planImport(input: PlanInput): ImportPlan {
  const plan: ImportPlan = { writes: [], unchanged: [], kept: [], keptWithdrawn: [], stillListed: [], ended: [], refused: [], held: [], flags: [], withdrawSkipped: null };
  const byId = new Map(input.existing.map((l) => [l.id, l]));
  const byKey = new Map(input.existing.map((l) => [l.lineKey, l]));
  /** A period that lies wholly in a moon that has ended: closed to every write (M8). */
  // A line whose days reach into a moon that has ended (V3): any day before the current moon starts. A write to
  // one, before or after, is refused; a correction goes on a new line in the current moon.
  const ended = (l: Pick<StoredLine, "startsOn">) => !!input.currentMoonStartsOn && l.startsOn < input.currentMoonStartsOn;
  const sera = input.source === "sera";
  const auto = sera && input.standing?.mode === "auto";
  const setterRoles = new Set(input.standing?.setterRoleIds ?? []);
  /** Under the standing switch a line counts at once, unless its words are held or it names a role the setter holds (P1). */
  const mayAutoAdopt = (l: StoredLine) => auto && !stillHeld(l) && !(l.roleId && setterRoles.has(l.roleId));

  // First pass: read every row and give it its key.
  type Read = { n: number; row: ImportRow; key: string | null; cells: Cells | null; target: StoredLine | null };
  const reads: Read[] = input.rows.map((row, i) => {
    const n = i + 1;
    if (row && typeof row === "object" && row.id) {
      const target = byId.get(String(row.id)) ?? null;
      return { n, row, key: target ? `id:${target.id}` : `id:${String(row.id)}`, cells: null, target };
    }
    const cells = readCells(n, row ?? {}, null, input);
    if (!cells.ok) {
      // A source's record that refused still names itself, so it counts as listed (R3).
      const ref = sera ? clean(row?.sourceRef) : "";
      return { n, row, key: ref ? `sera:${ref}` : null, cells, target: ref ? byKey.get(`sera:${ref}`) ?? null : null };
    }
    const key = budgetLineKey({ ...cells.line, source: input.source });
    return { n, row, key, cells, target: byKey.get(key) ?? null };
  });

  // Duplicate keys within one import are refused, every row that shares one (R2).
  const rowsByKey = new Map<string, number[]>();
  for (const r of reads) if (r.key) rowsByKey.set(r.key, [...(rowsByKey.get(r.key) ?? []), r.n]);
  const duplicate = (r: Read) => !!r.key && (rowsByKey.get(r.key)?.length ?? 0) > 1;
  const refuseClosed = (n: number, cell = "row") => plan.refused.push({ row: n, cell, reason: "closed", message: CLOSED });

  for (const r of reads) {
    if (duplicate(r)) {
      const others = rowsByKey.get(r.key!)!.filter((x) => x !== r.n);
      plan.refused.push({ row: r.n, cell: "row", reason: "duplicate", message: `This row is the same line as row ${others.join(", row ")}. Keep one of them.` });
      continue;
    }
    // A withdraw, a restore, an adoption, a lock or a hand edit of one line by its id.
    if (r.row && r.row.id) {
      const t = r.target;
      if (!t) {
        plan.refused.push({ row: r.n, cell: "id", reason: "no_line", message: "There is no budget line with that id." });
        continue;
      }
      // A line in a moon that has ended is history (M8, V3). One its source closed this moon may still be renamed,
      // locked or withdrawn, and never adopted.
      if (ended(t)) {
        refuseClosed(r.n);
        continue;
      }
      if (r.row.action === "adopt") {
        if (t.source !== "sera") {
          plan.refused.push({ row: r.n, cell: "row", reason: "not_synced", message: "Only a line a source sent waits to be adopted. The village's own lines count as they are written." });
          continue;
        }
        if (t.status === "withdrawn") {
          plan.refused.push({ row: r.n, cell: "status", reason: "withdrawn", message: "Restore this line before adopting it." });
          continue;
        }
        if (t.status === "closed") {
          refuseClosed(r.n, "status");
          continue;
        }
        if (stillHeld(t)) {
          plan.refused.push({ row: r.n, cell: "label", reason: "name_held", message: "This line's words may name a member. Rename it, then adopt it." });
          continue;
        }
        if (t.adoptedAt) {
          plan.unchanged.push({ row: r.n, id: t.id });
          continue;
        }
        const adoptedAs = (clean(r.row.adoptedAs) || input.byAs || BUDGET_KEEPER).slice(0, 120);
        plan.writes.push({ op: "adopt", row: r.n, line: { ...t, adoptedAt: input.readAt, adoptedAs }, before: t, plannedCell: null, becomesManual: false, adoptionCleared: false });
        continue;
      }
      if (r.row.action === "lock") {
        const village = input.villageCurrency.toUpperCase();
        if (!village) {
          plan.refused.push({ row: r.n, cell: "currency", reason: "no_currency", message: "This village has no currency set yet, so there is nothing to lock a rate into." });
          continue;
        }
        if (t.currency.toUpperCase() === village) {
          plan.refused.push({ row: r.n, cell: "currency", reason: "same_currency", message: "This line is already in the village's currency, so it needs no rate." });
          continue;
        }
        const fx = lockFor(r.n, r.row, t, input);
        if (!fx.ok) {
          if (fx.refused) plan.refused.push(fx.refused);
          if (fx.held) plan.held.push(fx.held);
          continue;
        }
        if (t.fxRate === fx.rate && t.fxSource === fx.source && t.fxAsOf === fx.asOf && t.fxInto === village) {
          plan.unchanged.push({ row: r.n, id: t.id });
          continue;
        }
        // The rate converts into the village's currency as it is now, and the role it was locked as is kept as written (M4, S10).
        const line: StoredLine = { ...t, fxRate: fx.rate, fxSource: fx.source, fxAsOf: fx.asOf, fxInto: village, fxLockedAs: (input.byAs || BUDGET_KEEPER).slice(0, 120) };
        plan.writes.push({ op: "lock", row: r.n, line, before: t, plannedCell: null, becomesManual: false, adoptionCleared: false });
        continue;
      }
      if (r.row.action === "withdraw" || r.row.action === "restore") {
        const restoring = r.row.action === "restore";
        const already = (t.status === "withdrawn") !== restoring;
        // Withdrawing a line its source withdrew makes the withdrawal the person's, so no import undoes it (M7).
        if (already && (restoring || !t.withdrawnBySource)) {
          plan.unchanged.push({ row: r.n, id: t.id });
          continue;
        }
        const cleared = t.source === "sera" && !!t.adoptedAt;
        // A person's withdrawal is theirs: no import undoes it (M7).
        const line: StoredLine = { ...t, status: restoring ? "approved" : "withdrawn", withdrawnBySource: false, ...(cleared && restoring ? { adoptedAt: null, adoptedAs: null } : {}) };
        plan.writes.push({ op: r.row.action, row: r.n, line, before: t, plannedCell: null, becomesManual: false, adoptionCleared: cleared && restoring });
        continue;
      }
      if (t.source === "sera") {
        // A source's line stays read-only here, except its words: a holder may rename its label or its source label (M9, V5).
        const asked = Object.keys(r.row).filter((k) => k !== "id" && r.row[k as keyof ImportRow] !== undefined);
        if (!asked.length || asked.some((k) => k !== "label" && k !== "sourceLabel")) {
          plan.refused.push({ row: r.n, cell: "row", reason: "library_line", message: NOT_IN_LIBRARY });
          continue;
        }
        const renames: Partial<Pick<StoredLine, "labelOverride" | "sourceLabelOverride">> = {};
        let problem = false;
        for (const [key, cell] of [["label", "label"], ["sourceLabel", "source_label"]] as const) {
          if (r.row[key] === undefined) continue;
          const override = clean(r.row[key]);
          if ((key === "label" && !override) || Array.from(override).length > LABEL_MAX) {
            plan.refused.push({ row: r.n, cell, reason: cell, message: `Give the line ${key === "label" ? "a label" : "a source label"} of at most ${LABEL_MAX} characters.` });
            problem = true;
            continue;
          }
          if (FORMAT_CHARS.test(String(r.row[key] ?? ""))) {
            plan.refused.push({ row: r.n, cell, reason: "hidden_characters", message: "These words carry invisible characters. Type them again as plain text." });
            problem = true;
            continue;
          }
          const find = override ? input.names(override) : null;
          if (find?.kind === "refused") {
            plan.refused.push({ row: r.n, cell, reason: `name_${find.what}`, message: nameFindWords(find) });
            problem = true;
            continue;
          }
          if (find?.kind === "held") {
            plan.held.push({ row: r.n, cell, message: nameFindWords(find) });
            problem = true;
            continue;
          }
          // The source's own words again are no rename at all; an empty source label hides the source's.
          if (key === "label") renames.labelOverride = override === t.label ? null : override;
          else renames.sourceLabelOverride = override === (t.sourceLabel ?? "") ? null : override;
        }
        if (problem) continue;
        const renamed: StoredLine = { ...t, ...renames };
        // A hold clears only once every cell it sits on is renamed (V5).
        const line: StoredLine = { ...renamed, nameHeld: stillHeld(renamed) };
        if (sameValues(line, t)) {
          plan.unchanged.push({ row: r.n, id: t.id });
          continue;
        }
        plan.writes.push({ op: "change", row: r.n, line, before: t, plannedCell: null, becomesManual: false, adoptionCleared: false });
        continue;
      }
      const cells = readCells(r.n, r.row, t, { ...input, source: "manual" });
      if (!cells.ok) {
        plan.refused.push(...cells.refused);
        plan.held.push(...cells.held);
        continue;
      }
      plan.flags.push(...cells.flags);
      if (cells.held.length) {
        plan.held.push(...cells.held);
        continue;
      }
      const line: StoredLine = { ...cells.line, id: t.id, lineKey: t.lineKey, source: "manual" };
      if (ended(line)) {
        refuseClosed(r.n, "period");
        continue;
      }
      // A writer here keeps the lock on a new amount (the preview shows the new converted figure); a new currency drops it.
      if (t.fxRate && line.currency !== t.currency) {
        Object.assign(line, UNLOCKED);
        plan.flags.push({ row: r.n, cell: "currency", kind: "rate_unlocked", message: RATE_UNLOCKED, ids: [t.id] });
      }
      Object.assign(line, previousOf(t, line));
      if (sameValues(line, t)) {
        plan.unchanged.push({ row: r.n, id: t.id });
        continue;
      }
      const becomesManual = t.source === "upload";
      if (becomesManual) {
        plan.flags.push({ row: r.n, cell: "row", kind: "becomes_manual", message: "Editing this uploaded line by hand makes it a hand-kept line, so the next upload of the same sheet leaves it as it is.", ids: [t.id] });
      }
      plan.writes.push({ op: "change", row: r.n, line, before: t, plannedCell: cells.plannedCell, becomesManual, adoptionCleared: false });
      continue;
    }

    const cells = r.cells!;
    if (!cells.ok) {
      plan.refused.push(...cells.refused);
      plan.held.push(...cells.held);
      if (sera && r.target) {
        plan.flags.push({ row: r.n, cell: "row", kind: "kept_last_good", message: "This record was refused, so its last good version stays as it was.", ids: [r.target.id] });
      }
      continue;
    }
    plan.flags.push(...cells.flags);
    // A held word blocks a person's confirm; a source's line is stored waiting and hidden instead, with the cells that hold it (M9, V5).
    const heldCells = Array.from(new Set(cells.held.map((h) => h.cell)));
    if (heldCells.length && !sera) {
      plan.held.push(...cells.held);
      continue;
    }
    const t = r.target;
    const line: StoredLine = { ...cells.line, lineKey: r.key!, nameHeld: heldCells.length > 0, nameHeldCell: heldCells.join(",") || null, labelOverride: null, sourceLabelOverride: null };
    if (ended(line) || (t && ended(t))) {
      // A source re-sending history is listed and left alone; a person's row is refused (M8, V3).
      const kept = t && { ...line, id: t.id, lineKey: t.lineKey, source: t.source, adoptedAt: t.adoptedAt, adoptedAs: t.adoptedAs, ...keptLock(t), withdrawnBySource: t.withdrawnBySource, labelOverride: t.labelOverride, sourceLabelOverride: t.sourceLabelOverride, nameHeld: t.nameHeld, nameHeldCell: t.nameHeldCell };
      if (t && kept && sameValues(kept, t)) {
        plan.unchanged.push({ row: r.n, id: t.id });
      } else if (sera) {
        plan.ended.push({ row: r.n, label: line.label });
      } else refuseClosed(r.n, "period");
      continue;
    }
    if (!t && line.nameHeld) {
      plan.flags.push({ row: r.n, cell: heldCells[0] ?? "label", kind: "name_held", message: "This line's words may name a member, so it is kept out of the budget and the members' view until a holder renames them." });
    }
    if (!t) {
      // Under a source's standing switch in auto mode, a synced line counts as soon as it lands (R18).
      if (mayAutoAdopt(line)) Object.assign(line, { adoptedAt: input.readAt, adoptedAs: input.standing!.adoptedAs });
      plan.writes.push({ op: "add", row: r.n, line, before: null, plannedCell: cells.plannedCell, becomesManual: false, adoptionCleared: false });
      continue;
    }
    if (input.source === "upload" && t.source === "manual") {
      plan.kept.push({ row: r.n, id: t.id, label: t.label });
      continue;
    }
    if (t.status === "withdrawn" && !t.withdrawnBySource) {
      // A person withdrew it: an import never restores it (M7). The read says so, and a holder may restore it.
      if (sera) plan.stillListed.push({ row: r.n, id: t.id, label: t.labelOverride ?? t.label });
      else plan.keptWithdrawn.push({ row: r.n, id: t.id, label: t.label });
      continue;
    }
    const next: StoredLine = {
      ...line,
      id: t.id,
      lineKey: t.lineKey,
      source: t.source,
      adoptedAt: t.adoptedAt,
      adoptedAs: t.adoptedAs,
      status: sera ? line.status : "approved",
      withdrawnBySource: false,
      // A source's new words void a holder's rename of them; the same words keep it (M9, V5).
      labelOverride: sera && line.label === t.label ? t.labelOverride ?? null : null,
      sourceLabelOverride: sera && line.sourceLabel === t.sourceLabel ? t.sourceLabelOverride ?? null : null,
    };
    // Held while any cell the source's words hold it on is not renamed (V5).
    next.nameHeld = sera ? stillHeld(next) : false;
    if (sera && next.nameHeld) {
      plan.flags.push({ row: r.n, cell: heldCellsOf(next)[0] ?? "label", kind: "name_held", message: "This line's words may name a member, so it is kept out of the budget and the members' view until a holder renames them." });
    }
    // The lock (spec 5a, guard 2): a new amount converts at the SAME locked rate, from a source or a writer here alike; a new currency drops it.
    const lockStays = !!t.fxRate && next.currency === t.currency;
    Object.assign(next, lockStays ? keptLock(t) : UNLOCKED, previousOf(t, next));
    if (t.fxRate && !lockStays) plan.flags.push({ row: r.n, cell: "row", kind: "rate_unlocked", message: RATE_UNLOCKED, ids: [t.id] });
    const moved = adoptionFacts(next) !== adoptionFacts(t);
    let cleared = false;
    if (sera) {
      if (mayAutoAdopt(next)) {
        // Auto mode (R18): a changed line counts at its new values at once, and a line that waited is adopted now.
        if (moved || !t.adoptedAt) Object.assign(next, { adoptedAt: input.readAt, adoptedAs: input.standing!.adoptedAs });
      } else if (t.adoptedAt && (moved || next.nameHeld)) {
        // Review mode, a source that is off, held words, or the setter's own role: it stops counting until a person adopts it.
        next.adoptedAt = null;
        next.adoptedAs = null;
        cleared = true;
        plan.flags.push({ row: r.n, cell: "row", kind: "adoption_cleared", message: "The library changed a line the village had adopted, so it stops counting until somebody adopts it again.", ids: [t.id] });
      }
    }
    if (sameValues(next, t)) {
      plan.unchanged.push({ row: r.n, id: t.id });
      continue;
    }
    plan.writes.push({ op: t.status === "withdrawn" ? "restore" : "change", row: r.n, line: next, before: t, plannedCell: cells.plannedCell, becomesManual: false, adoptionCleared: cleared });
  }

  // An upload's own rows, read: its default withdrawal scope, never a line it names by id, keeps, or finds withdrawn.
  const ownRows = reads.filter((r) => !r.row?.id && r.cells?.ok).map((r) => (r.cells as Extract<Cells, { ok: true }>).line);
  withdrawByScope(input, reads.map((r) => r.key).filter((k): k is string => !!k), plan, ended, ownRows);
  return plan;
}

/**
 * WITHDRAWAL BY SCOPE (R3). An upload ticked as the whole budget for its
 * periods withdraws the uploaded lines in that scope it no longer lists. A
 * whole read from a source withdraws that source's lines it no longer lists,
 * except in periods older than the oldest one it sent. Either way, an import
 * with any refused or held row withdraws nothing, an ended moon's line is
 * never withdrawn, and the withdrawal is marked an import's, which a later
 * import may undo (M7).
 */
function withdrawByScope(input: PlanInput, listedKeys: string[], plan: ImportPlan, ended: (l: StoredLine) => boolean, ownRows: readonly StoredLine[]): void {
  if (!input.scope?.whole || input.source === "manual") return;
  if (input.source === "sera" && input.rows.length === 0) {
    plan.withdrawSkipped = "empty_read";
    return;
  }
  if (plan.refused.length || plan.held.length) {
    // A source's record refused under R15 counts as listed, so a refused read still withdraws nothing it named.
    plan.withdrawSkipped = "refused_rows";
    return;
  }
  const listed = new Set(listedKeys);
  const touched = new Set(
    plan.writes
      .map((w) => w.line.lineKey)
      .concat(
        plan.kept.map((k) => byIdKey(input, k.id)),
        plan.unchanged.map((u) => byIdKey(input, u.id)),
        plan.keptWithdrawn.map((k) => byIdKey(input, k.id)),
        plan.stillListed.map((k) => byIdKey(input, k.id)),
      ),
  );
  const live = (l: StoredLine) => (l.status === "approved" || l.status === "draft") && !ended(l);
  const withdraw = (l: StoredLine) =>
    plan.writes.push({ op: "withdraw", row: null, line: { ...l, status: "withdrawn", withdrawnBySource: true }, before: l, plannedCell: null, becomesManual: false, adoptionCleared: false });

  if (input.source === "sera") {
    const oldest = plan.writes.map((w) => w.line.startsOn).concat(input.existing.filter((l) => listed.has(l.lineKey)).map((l) => l.startsOn)).sort()[0];
    for (const l of input.existing) {
      if (l.source !== "sera" || !live(l) || listed.has(l.lineKey) || touched.has(l.lineKey)) continue;
      if (oldest && l.endsOn < oldest) continue;
      withdraw(l);
    }
    return;
  }

  // An upload: its scope, named, or read off its own rows (never off a line it names by id, keeps, or finds withdrawn).
  const rowPeriods = ownRows.map((l) => `${l.periodKind}|${l.periodKey}`);
  const rowCircles = ownRows.map((l) => l.circleId);
  let periods = new Set(rowPeriods);
  let circles = new Set<string | null>(rowCircles);
  if (input.scope.periods?.length) {
    periods = new Set();
    for (const p of input.scope.periods) {
      const r = resolvePeriod(p, input.periodEnv);
      if (!r.ok) {
        plan.refused.push({ row: 0, cell: "scope", reason: "period", message: r.message });
        plan.withdrawSkipped = "refused_rows";
        return;
      }
      periods.add(`${r.period.kind}|${r.period.key}`);
    }
  }
  if (input.scope.circles?.length) {
    circles = new Set();
    for (const c of input.scope.circles) {
      if (c === null || clean(c) === "") {
        // Village-wide is its own scope (R34, M2): the fixed marker, and a line written the old way with no circle.
        circles.add(VILLAGE_WIDE);
        circles.add(null);
        continue;
      }
      const s = matchScope(c, null, input.chart);
      if (!s.ok) {
        plan.refused.push({ row: 0, cell: "scope", reason: "scope", message: s.message });
        plan.withdrawSkipped = "refused_rows";
        return;
      }
      circles.add(s.circleId);
    }
  }
  for (const l of input.existing) {
    if (l.source !== "upload" || !live(l) || touched.has(l.lineKey) || listed.has(l.lineKey)) continue;
    if (!periods.has(`${l.periodKind}|${l.periodKey}`) || !circles.has(l.circleId)) continue;
    withdraw(l);
  }
}

function byIdKey(input: PlanInput, id: string): string {
  return input.existing.find((l) => l.id === id)?.lineKey ?? "";
}

/** The budget after a plan's writes, in memory, for the share after and the overlap flags. */
export function applyPlan(existing: readonly StoredLine[], writes: readonly PlanWrite[]): StoredLine[] {
  const out = new Map(existing.map((l) => [l.lineKey, l]));
  writes.forEach((w, i) => out.set(w.line.lineKey, { ...w.line, id: w.line.id || `planned-${i}` }));
  return Array.from(out.values());
}

/**
 * R4's flag: two counting lines from one source, of one scope and category,
 * whose periods overlap. Both count; the preview says so, so a person sees a
 * line they may have meant to replace.
 */
export function overlapFlags(after: readonly StoredLine[], writes: readonly PlanWrite[], villageCurrency: string): Flag[] {
  const counting = after.filter((l) => whyNotCounted(l, villageCurrency || null) === null);
  const touched = new Set(writes.filter((w) => w.op !== "withdraw").map((w) => w.line.lineKey));
  const seen = new Set<string>();
  const flags: Flag[] = [];
  for (const a of counting) {
    if (!touched.has(a.lineKey)) continue;
    for (const b of counting) {
      if (a.lineKey === b.lineKey || a.source !== b.source || a.category !== b.category || a.circleId !== b.circleId || a.roleId !== b.roleId) continue;
      if (sharedDays(a, b) <= 0) continue;
      const pair = [a.lineKey, b.lineKey].sort().join("|");
      if (seen.has(pair)) continue;
      seen.add(pair);
      const row = writes.find((w) => w.line.lineKey === a.lineKey)?.row ?? null;
      flags.push({ row, cell: "period", kind: "overlap", message: `"${a.label}" and "${b.label}" cover the same days for the same scope and category, and both count.`, ids: [a.id, b.id] });
    }
  }
  return flags;
}

// ── The committed part (R7) ─────────────────────────────────────────────────

/**
 * A role row's cycle, read back off its `cash_owed` key, and whether it is an
 * allowance. The key is `cashKeys.role(cycle, seat, user)` with each segment
 * encoded; an allowance names its seat with ":allowance" after it
 * (`moonLineCashKey`). The test round-trips both writers, so a change to the
 * encoding there breaks here loudly.
 */
export function decodeRoleKey(key: string): { cycle: string; allowance: boolean } | null {
  const parts = String(key).split(":");
  if (parts.length !== 4 || parts[0] !== "role") return null;
  try {
    const cycle = decodeURIComponent(parts[1]);
    const seat = decodeURIComponent(parts[2]);
    return { cycle, allowance: seat.endsWith(":allowance") };
  } catch {
    return null;
  }
}

/** The moon's instants, for the rows placed by `owed_at` (G-B2). */
function moonInstants(moonId: string): { startsAt: Date; endsAt: Date } | null {
  const parsed = parseId(moonId);
  if (!parsed || parsed.cycleNumber === null || parsed.clock === "legacy_month") return null;
  const b = boundsForNumber(parsed.cycleNumber);
  return { startsAt: b.startsAt, endsAt: b.endsAt };
}

/**
 * THE CASH COMMITTED TO THIS MOON'S WORK (R7): role rows of `cash_owed` whose
 * decoded cycle is this moon; quest and proposal rows owed inside the moon;
 * and the cash on work set this moon with no row yet, from the injected
 * reader. Allowances count against materials, never role pay (P3). A deficit
 * carried as money owed is a role row keyed on the moon it is carried to, so
 * it lands there by the same decode.
 */
export async function committedFor(db: Pool | PoolConnection, moonId: string, e: BudgetEnv = env, pool: Pool = db as Pool): Promise<CommittedParts> {
  const at = moonInstants(moonId);
  if (!at) return { ...NO_COMMITMENTS };
  const out: CommittedParts = { ...NO_COMMITMENTS };
  const village = e.currency().toUpperCase();
  const prefix = cashKeys.role(moonId, "", "").slice(0, -1);
  for (const r of await repo.cashOwedForMoon(db, prefix, at.startsAt, at.endsAt)) {
    const amount = Number(r.amount_minor);
    if (!village || String(r.currency).toUpperCase() !== village) {
      out.otherCurrencyRows += 1;
      continue;
    }
    const fed = () => {
      const at = r.owed_at ? new Date(r.owed_at).toISOString() : null;
      if (at && (!out.asOf || at > out.asOf)) out.asOf = at;
    };
    if (r.work_kind === "role") {
      const k = decodeRoleKey(String(r.occurrence_key));
      if (!k || k.cycle !== moonId) continue;
      if (k.allowance) out.materialsMinor += amount;
      else {
        out.roleMinor += amount;
        fed();
      }
    } else if (r.work_kind === "quest") {
      out.questMinor += amount;
      fed();
    } else if (r.work_kind === "proposal") {
      out.proposalMinor += amount;
      fed();
    }
  }
  // TODO(spec R7): a deficit carried as money owed counts in the moon it is
  // carried TO. Role rows already land there by their cycle key; the carried
  // rows will name their target moon in a field the valuation lane is agreeing
  // with invoice-rails, and this read follows that field once it exists.
  const set = await e.cashSetThisMoonUnowed(pool, moonId);
  const setMinor = Math.max(0, Math.floor(Number(set?.minor) || 0));
  if (setMinor > 0 && String(set?.currency ?? "").toUpperCase() !== village) {
    // Never summed across currencies: left out, and the working says so.
    out.settingsCurrencyIgnored = { currency: String(set?.currency ?? ""), minor: setMinor, rows: Number(set?.rows) || 0 };
  } else {
    out.settingsMinor = setMinor;
  }
  return out;
}

// ── The figure (R7) ─────────────────────────────────────────────────────────

function figureFor(lines: readonly StoredLine[], moonId: string, committed: CommittedParts, e: BudgetEnv): CashBudgetLeft | null {
  const moon = moonPeriod(moonId, e.timezone());
  if (!moon) return null;
  const named = lines.map((l) => (l.labelOverride ? { ...l, label: l.labelOverride } : l));
  return budgetFigure(named, { id: moonId, startsOn: moon.startsOn, endsOn: moon.endsOn, days: moon.days }, e.currency() || null, committed, stateRevision(lines));
}

const chartCircleOf = (c: RowDataPacket): ChartCircle => ({
  id: String(c.id),
  name: String(c.name ?? ""),
  isExample: Number(c.is_example) === 1,
  status: String(c.status ?? "active"),
  layer: str(c.layer),
  parentCircleId: str(c.parent_circle_id),
  sortOrder: Number(c.sort_order) || 0,
});

/** The village's circle as the chart and the setting say today (R34). */
export async function budgetVillageCircle(pool: Pool | PoolConnection, over: Partial<BudgetEnv> = {}): Promise<{ id: string; from: VillageCircleFrom } | null> {
  const e = { ...env, ...over };
  return villageCircleOf((await repo.budgetChartRows(pool)).circles.map(chartCircleOf), e.villageCircleSetting());
}

/**
 * THE ONE FIGURE THE ENGINE READS FOR A MOON (R7), or null when no line that
 * counts touches it. Callers pass `cycleCashShare(left?.leftMinor ?? null,
 * baseToSet)` and `budgetSet: left !== null` (shared/budgets.ts
 * `moonCashTerms` does both). `over` exists for a suite; the server reads the
 * environment `configureBudgets` set at boot.
 */
export async function cashBudgetLeft(pool: Pool, moonId: string, over: Partial<BudgetEnv> = {}): Promise<CashBudgetLeft | null> {
  const e = { ...env, ...over };
  if (!moonPeriod(moonId, e.timezone())) return null;
  const lines = (await repo.budgetLineRows(pool)).map(rowToLine);
  return figureFor(lines, moonId, await committedFor(pool, moonId, e), e);
}

/** Each circle's name by id, for the moon's plan per circle (R31). */
export async function budgetCircleNames(pool: Pool): Promise<Map<string, string>> {
  const { circles } = await repo.budgetChartRows(pool);
  return new Map(circles.map((c) => [String(c.id), String(c.name ?? "")]));
}

/** The chart's role names by id, for words a ballot reads (names, never ids). */
export async function budgetRoleNames(pool: Pool): Promise<Map<string, string>> {
  const { roles } = await repo.budgetChartRows(pool);
  return new Map(roles.map((r) => [String(r.id), String(r.name ?? "")]));
}

/** Every line, as stored, for the read route. */
export async function budgetLines(pool: Pool): Promise<StoredLine[]> {
  return (await repo.budgetLineRows(pool)).map(rowToLine);
}

/**
 * The newest import per source (R5). Two imports in the same second tie on
 * `at`, so the id breaks the tie: ids lead with the time they were made.
 */
export async function latestSyncs(pool: Pool): Promise<Array<{ source: string; at: string; ok: boolean; lines: number; sourceLabel: string | null; sourceLink: string | null }>> {
  const newest = new Map<string, RowDataPacket>();
  for (const r of await repo.latestBudgetSyncs(pool)) {
    const seen = newest.get(String(r.source));
    if (!seen || String(r.id) > String(seen.id)) newest.set(String(r.source), r);
  }
  return Array.from(newest.values())
    .sort((a, b) => (String(a.source) < String(b.source) ? -1 : 1))
    .map((r) => ({ source: String(r.source), at: iso(r.at)!, ok: Number(r.ok) === 1, lines: Number(r.lines), sourceLabel: str(r.source_label), sourceLink: str(r.source_link) }));
}

/** An id that sorts in the order it was made: the time in base 36, then a random tail. */
const timeOrderedId = (prefix: string) => `${prefix}-${Date.now().toString(36).padStart(9, "0")}-${randomUUID().slice(0, 8)}`;

// ── The one write path (R2, R3, R5, R14) ───────────────────────────────────

export interface ImportInput {
  source: BudgetSource;
  scope?: ImportScope | null;
  lines: readonly ImportRow[];
  /** The writer's account id, or null for a vote or a background read. */
  by: string | null;
  /** The role they acted through, "admin, before launch", or "the village, by a vote". */
  byAs: string | null;
  dryRun: boolean;
  /** A confirm names the preview's revision (R14). */
  revision?: string | null;
  /** An accepted suggestion names the state it was made on instead (R22). */
  stateRevision?: string | null;
  format?: NumberFormatChoice;
  /** What this import is, in the holder's words, like "November budget sheet" (R29). Checked for names. */
  sourceLabel?: string | null;
  /** An optional https address of the sheet (R29). Read back only by the door and cash.pay holders. */
  sourceLink?: string | null;
  /**
   * Run inside the confirm's lock and transaction, after its own checks and
   * before its writes, on the same connection: the source switch re-reads and
   * writes its row here, so the switch and its adoptions land together or not
   * at all. A message refuses the confirm as stale and writes nothing.
   */
  withinLock?: (conn: PoolConnection) => Promise<string | null>;
  /** False for a write that is not an import (a source's switch adopting what it sent): no `budget_syncs` row (R5). */
  recordSync?: boolean;
}

/** An import's scope, held to a shape and a size before it is used or stored (nit). */
function scopeOf(raw: ImportScope | null | undefined): ImportScope | null {
  if (!raw || typeof raw !== "object") return null;
  const periods = Array.isArray(raw.periods) ? raw.periods.filter((x) => typeof x === "string").slice(0, 50).map((x) => x.slice(0, 64)) : undefined;
  const circles = Array.isArray(raw.circles) ? raw.circles.filter((x) => x === null || typeof x === "string").slice(0, 200).map((x) => (x === null ? null : x.slice(0, 64))) : undefined;
  return { ...(periods ? { periods } : {}), ...(circles ? { circles } : {}), whole: raw.whole === true };
}

/** An import's own words about itself (R29): its label, at most 120 characters and checked for names, and an https link. */
function sourceProblems(input: ImportInput, names: NameCheck): { refused: Refused[]; held: Held[]; label: string | null; link: string | null } {
  const refused: Refused[] = [];
  const held: Held[] = [];
  const label = clean(input.sourceLabel) || null;
  if (label) {
    if (Array.from(label).length > LABEL_MAX) refused.push({ row: 0, cell: "source_label", reason: "source_label", message: `Keep the name of what you imported to ${LABEL_MAX} characters.` });
    const find = names(label);
    if (find?.kind === "refused") refused.push({ row: 0, cell: "source_label", reason: `name_${find.what}`, message: nameFindWords(find) });
    else if (find?.kind === "held") held.push({ row: 0, cell: "source_label", message: nameFindWords(find) });
  }
  const raw = String(input.sourceLink ?? "").trim();
  let link: string | null = null;
  if (raw) {
    let ok = false;
    try {
      const u = new URL(raw);
      ok = u.protocol === "https:" && !u.username && !u.password && raw.length <= 500;
    } catch {
      ok = false;
    }
    if (ok) link = raw;
    else refused.push({ row: 0, cell: "source_link", reason: "source_link", message: "A link to the sheet starts with https://, carries no password, and is at most 500 characters." });
  }
  return { refused, held, label, link };
}

export interface PreviewLine {
  row: number | null;
  /** The planned amount in the village's currency: itself, or converted at the locked rate; null when not counted yet. */
  convertedMinor: number | null;
  fx: { rate: string; source: string | null; asOf: string | null } | null;
  id: string | null;
  label: string;
  category: BudgetCategory;
  periodKind: PeriodKind;
  periodKey: string;
  startsOn: string;
  endsOn: string;
  circleId: string | null;
  roleId: string | null;
  plannedMinor: number;
  plannedCell: string | null;
  spentMinor: number | null;
  currency: string;
  status: LineStatus;
}

export interface PreviewChange extends PreviewLine {
  op: "change" | "restore" | "withdraw" | "lock" | "adopt";
  before: PreviewLine;
  becomesManual: boolean;
  adoptionCleared: boolean;
}

export interface ImportResult {
  ok: boolean;
  /** 200 for a preview or a write, 400 for an import that cannot be confirmed as sent, 409 for a stale or busy one. */
  status: 200 | 400 | 409;
  code: null | "stale" | "names_held" | "source_refused" | "all_refused" | "too_many_rows" | "revision_required" | "bad_source" | "busy" | "payee_conflict";
  message: string | null;
  written: boolean;
  revision: string;
  stateRevision: string;
  added: PreviewLine[];
  changed: PreviewChange[];
  /** The labels of every line this withdraws, by name (R3). */
  withdrawn: string[];
  withdrawnLines: Array<{ id: string; label: string }>;
  unchanged: number;
  kept: ImportPlan["kept"];
  refused: Refused[];
  held: Held[];
  flags: Flag[];
  withdrawSkipped: ImportPlan["withdrawSkipped"];
  keptWithdrawn: ImportPlan["keptWithdrawn"];
  stillListed: ImportPlan["stillListed"];
  ended: ImportPlan["ended"];
  /** The digest of the lines this import touches and what it does to them: a suggestion binds to it (S7). */
  touchedRevision: string;
  shareBefore: ShareState;
  shareAfter: ShareState;
  /** Each line whose planned amount moves, and by how much (R18). */
  lineChanges: LineChange[];
  /** Each moon whose counted total moves, and by how much (R18). */
  moonChanges: MoonChange[];
  /** A line or a moon moves more than 20%: a warning in the header, never a block (R18). */
  swing: boolean;
  syncId: string | null;
  /** The ids written, an added line's included. */
  lineIds: string[];
}

const preview = (l: StoredLine, row: number | null, plannedCell: string | null, village: string): PreviewLine => ({
  row,
  label: displayLabel(l),
  convertedMinor: village ? inVillageCurrency(l, village) : null,
  fx: l.fxRate ? { rate: l.fxRate, source: l.fxSource ?? null, asOf: l.fxAsOf ?? null } : null,
  id: l.id || null,
  category: l.category,
  periodKind: l.periodKind,
  periodKey: l.periodKey,
  startsOn: l.startsOn,
  endsOn: l.endsOn,
  circleId: l.circleId,
  roleId: l.roleId,
  plannedMinor: l.plannedMinor,
  plannedCell,
  spentMinor: l.spentMinor,
  currency: l.currency,
  status: l.status,
});

/**
 * A row as the plan's digest reads it: what it does, never an id that does not
 * exist yet, and the read time as one marker, so a preview and its confirm a
 * moment later digest alike when the standing switch adopts at read time.
 */
const planDigest = (plan: ImportPlan, readAt: string) =>
  digest({
    w: plan.writes.map((w) => [w.op, w.row, w.line.lineKey, valueOf(w.line).slice(2).map((v) => (v === readAt ? "@read" : v)), w.becomesManual, w.adoptionCleared]),
    u: plan.unchanged,
    k: plan.kept,
    kw: plan.keptWithdrawn,
    sl: plan.stillListed,
    e: plan.ended,
    r: plan.refused,
    h: plan.held,
    s: plan.withdrawSkipped,
  });

export interface LineChange {
  row: number | null;
  id: string | null;
  label: string;
  currency: string;
  prevMinor: number;
  nextMinor: number;
  /** Percent from the amount before, one decimal; null when it was 0. */
  pct: number | null;
  swing: boolean;
}

export interface MoonChange {
  moonId: string;
  beforeMinor: number;
  afterMinor: number;
  pct: number | null;
  swing: boolean;
}

/** A move past this, either way, in one import, is a swing (R18). */
export const SWING_PCT = 20;

const pctOf = (before: number, after: number): number | null => (before > 0 ? Math.round(((after - before) / before) * 1000) / 10 : null);
const swingOf = (before: number, after: number): boolean => {
  const pct = pctOf(before, after);
  return pct === null ? after !== before : Math.abs(pct) > SWING_PCT;
};

/** The moons a line's days cross, on the village's clock, at most 24. */
function moonsOf(l: Pick<StoredLine, "startsOn" | "endsOn">): string[] {
  const clock = activeClock();
  const first = clock.boundsFor(new Date(`${l.startsOn}T12:00:00Z`)).cycleNumber;
  const last = clock.boundsFor(new Date(`${l.endsOn}T12:00:00Z`)).cycleNumber;
  const out: string[] = [];
  for (let n = first; n <= last && out.length < 24; n++) out.push(boundsForNumber(n).id);
  return out;
}

/** What an import moves (R18): each line's planned amount and each touched moon's counted total, before and after. */
function changesOf(p: { existing: StoredLine[]; after: StoredLine[]; plan: ImportPlan; villageCircleId: string | null }, village: string, timezone: string): { lineChanges: LineChange[]; moonChanges: MoonChange[]; swing: boolean } {
  const lineChanges: LineChange[] = p.plan.writes
    .filter((w) => w.before && w.op !== "withdraw" && w.before.plannedMinor !== w.line.plannedMinor)
    .map((w) => ({
      row: w.row,
      id: w.line.id || null,
      label: w.line.label,
      currency: w.line.currency,
      prevMinor: w.before!.plannedMinor,
      nextMinor: w.line.plannedMinor,
      pct: pctOf(w.before!.plannedMinor, w.line.plannedMinor),
      swing: swingOf(w.before!.plannedMinor, w.line.plannedMinor),
    }));
  const ids = new Set<string>();
  for (const w of p.plan.writes) {
    for (const id of moonsOf(w.line)) ids.add(id);
    if (w.before) for (const id of moonsOf(w.before)) ids.add(id);
    if (ids.size > 60) break;
  }
  const moonChanges: MoonChange[] = [];
  Array.from(ids)
    .sort()
    .forEach((id) => {
      const m = moonPeriod(id, timezone);
      if (!m) return;
      const span = { id, startsOn: m.startsOn, endsOn: m.endsOn, days: m.days };
      // The moon's CASH figure (M12): role pay and quest pay, added and removed lines included.
      const beforeMinor = moonPlan(p.existing, span, village || null).cashPlannedMinor;
      const afterMinor = moonPlan(p.after, span, village || null).cashPlannedMinor;
      if (beforeMinor === afterMinor) return;
      moonChanges.push({ moonId: id, beforeMinor, afterMinor, pct: pctOf(beforeMinor, afterMinor), swing: swingOf(beforeMinor, afterMinor) });
    });
  return { lineChanges, moonChanges, swing: lineChanges.some((c) => c.swing) || moonChanges.some((c) => c.swing) };
}

interface Prepared {
  /** The standing switch's setter no longer may: the confirm turns the source off with this reason (P1). */
  turnOff: string | null;
  touchedRevision: string;
  timezone: string;
  villageCircleId: string | null;
  village: string;
  sourceLabel: string | null;
  sourceLink: string | null;
  existing: StoredLine[];
  plan: ImportPlan;
  after: StoredLine[];
  stateRevision: string;
  revision: string;
  shareBefore: ShareState;
  shareAfter: ShareState;
}

/** The names on the chart, roles and circles: words the name check never holds (V4). */
function chartWordsOf(chart: BudgetChart): string[] {
  return [...chart.circles.filter((c) => !c.isExample).map((c) => c.name), ...chart.roles.filter((r) => !r.isExample).map((r) => r.name)];
}

async function chartWordsFor(db: Pool | PoolConnection): Promise<string[]> {
  const rows = await repo.budgetChartRows(db);
  return [...rows.circles.filter((c) => Number(c.is_example) !== 1).map((c) => String(c.name ?? "")), ...rows.roles.filter((r) => Number(r.is_example) !== 1).map((r) => String(r.name ?? ""))];
}

async function prepare(db: Pool | PoolConnection, input: ImportInput, e: BudgetEnv, pool: Pool = db as Pool): Promise<Prepared> {
  const existing = (await repo.budgetLineRows(db)).map(rowToLine);
  const chartRows = await repo.budgetChartRows(db);
  const chart: BudgetChart = {
    circles: chartRows.circles.map(chartCircleOf),
    roles: chartRows.roles.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), circleId: str(r.circle_id), active: Number(r.active) === 1, isExample: Number(r.is_example) === 1 })),
  };
  const names = budgetNameCheck(await rosterRows(db as Pool), { chartWords: chartWordsOf(chart) });
  const villageCircleId = villageCircleOf(chart.circles, e.villageCircleSetting())?.id ?? null;
  const villageCurrency = e.currency();
  const readAt = new Date().toISOString();
  const today = civilDateKey(new Date(), e.timezone());
  const rates = input.lines.some((r) => r && r.action === "lock" && r.use === "provider") ? await providerRates(db, existing, villageCurrency) : undefined;
  // A source's standing switch (R18), re-checked on every apply (P1): only an `on` source in `auto`
  // mode, whose setter still may, lands its lines counting.
  let standing: PlanInput["standing"] = null;
  let turnOff: string | null = null;
  if (input.source === "sera") {
    const s = sourceOf(input.source, await repo.budgetSourceRow(db, input.source));
    turnOff = s.on ? await switchOffReason(s, e, pool) : null;
    standing = s.on && !turnOff
      ? { mode: s.mode, adoptedAs: `standing: ${s.setAs ?? BUDGET_KEEPER}`.slice(0, 120), setterRoleIds: s.setBy ? await e.seatedRoleIds(s.setBy) : [] }
      : { mode: "review", adoptedAs: "" };
  }
  const current = moonPeriod(e.currentMoonId(), e.timezone());
  const plan = planImport({
    source: input.source,
    rows: input.lines,
    scope: input.scope ?? null,
    format: input.format ?? { locale: "en", chosen: false },
    existing,
    chart,
    villageCurrency,
    periodEnv: periodEnvOf(e),
    names,
    today,
    rates,
    standing,
    readAt,
    byAs: input.byAs,
    villageCircleId,
    currentMoonStartsOn: current?.startsOn ?? null,
  });
  const own = sourceProblems(input, names);
  plan.refused.unshift(...own.refused);
  plan.held.unshift(...own.held);
  const after = applyPlan(existing, plan.writes);
  plan.flags.push(...overlapFlags(after, plan.writes, villageCurrency));
  const moonId = e.currentMoonId();
  const committed = await committedFor(db, moonId, e, pool);
  const base = await e.baseToSet(db, moonId);
  const state = stateRevision(existing);
  // The lines this import touches, and what it does to them (S7): what a suggestion binds to, never the whole budget.
  const touchedIds = new Set(
    plan.writes.filter((w) => w.before).map((w) => w.before!.id)
      .concat(plan.unchanged.map((u) => u.id), plan.kept.map((k) => k.id), plan.keptWithdrawn.map((k) => k.id), plan.stillListed.map((k) => k.id)),
  );
  const touched = existing.filter((l) => touchedIds.has(l.id)).sort((a, b) => (a.id < b.id ? -1 : 1)).map(valueOf);
  return {
    turnOff,
    touchedRevision: revisionOf([touched, planDigest(plan, readAt)]),
    timezone: e.timezone(),
    villageCircleId,
    village: villageCurrency,
    sourceLabel: own.label,
    sourceLink: own.link,
    existing,
    plan,
    after,
    stateRevision: state,
    revision: revisionOf([state, planDigest(plan, readAt)]),
    shareBefore: shareState(moonId, figureFor(existing, moonId, committed, e), base),
    shareAfter: shareState(moonId, figureFor(after, moonId, committed, e), base),
  };
}

function result(p: Prepared, over: Partial<ImportResult>): ImportResult {
  const { plan } = p;
  const withdrawnLines = plan.writes.filter((w) => w.op === "withdraw").map((w) => ({ id: w.line.id, label: w.line.label }));
  return {
    ok: true,
    status: 200,
    code: null,
    message: null,
    written: false,
    revision: p.revision,
    stateRevision: p.stateRevision,
    added: plan.writes.filter((w) => w.op === "add").map((w) => preview(w.line, w.row, w.plannedCell, p.village)),
    changed: plan.writes
      .filter((w) => w.op !== "add")
      .map((w) => ({ ...preview(w.line, w.row, w.plannedCell, p.village), op: w.op as PreviewChange["op"], before: preview(w.before!, w.row, null, p.village), becomesManual: w.becomesManual, adoptionCleared: w.adoptionCleared })),
    withdrawn: withdrawnLines.map((l) => l.label),
    withdrawnLines,
    unchanged: plan.unchanged.length,
    kept: plan.kept,
    refused: plan.refused,
    held: plan.held,
    flags: plan.flags,
    withdrawSkipped: plan.withdrawSkipped,
    keptWithdrawn: plan.keptWithdrawn,
    stillListed: plan.stillListed,
    ended: plan.ended,
    touchedRevision: p.touchedRevision,
    shareBefore: p.shareBefore,
    shareAfter: p.shareAfter,
    ...changesOf(p, p.village, p.timezone),
    syncId: null,
    lineIds: [],
    ...over,
  };
}

const refusal = (status: 400 | 409, code: ImportResult["code"], message: string, p?: Prepared): ImportResult => {
  const empty: ShareState = { moonId: "", set: false, leftMinor: null, sharePct: null };
  if (p) return result(p, { ok: false, status, code, message });
  return {
    ok: false, status, code, message, written: false, revision: "", stateRevision: "", added: [], changed: [], withdrawn: [], withdrawnLines: [], unchanged: 0,
    kept: [], refused: [], held: [], flags: [], withdrawSkipped: null, keptWithdrawn: [], stillListed: [], ended: [], touchedRevision: "", shareBefore: empty, shareAfter: empty, lineChanges: [], moonChanges: [], swing: false, syncId: null, lineIds: [],
  };
};

const VERB: Record<PlanWrite["op"], string> = { add: "added", change: "changed", withdraw: "withdrawn", restore: "restored", lock: "rate-locked", adopt: "adopted" };

/** The line a write that moves the share records (R10). Fixed words, no figure, nobody named. Admin audience; members read it in the budget (S5). */
export const SHARE_MOVED_EVENT = "This moon's cash budget changed, and with it the share of work paid in cash.";

/** The moon's share moving, newest first, for the member-gated read (S5): fixed words, the moon, the time. */
export async function budgetShareHistory(pool: Pool, limit = 20): Promise<Array<{ at: string; moonId: string; text: string }>> {
  return (await repo.budgetShareEvents(pool, SHARE_MOVED_EVENT, limit)).map((r) => ({ at: iso(r.at)!, moonId: String(r.entity_ref ?? ""), text: SHARE_MOVED_EVENT }));
}

/**
 * THE ONE WRITE PATH (R2). A preview (`dryRun`) writes nothing and returns
 * the revision; a confirm writes only against that revision, under the
 * budget's lock, and records one `budget_syncs` row (R5) and one audit event
 * per line (R25). The caller has already passed the R21 door.
 */
export async function importBudgetLines(pool: Pool, input: ImportInput): Promise<ImportResult> {
  if (!isBudgetSource(input.source)) return refusal(400, "bad_source", "An import names its source: upload, sera or manual.");
  if (!Array.isArray(input.lines)) return refusal(400, "bad_source", "Send the lines to import.");
  if (input.lines.length > IMPORT_ROWS_MAX) {
    return refusal(400, "too_many_rows", `One import carries at most ${IMPORT_ROWS_MAX} lines. Split the sheet by period and import each part.`);
  }
  const e = env;
  input = { ...input, scope: scopeOf(input.scope) };
  if (input.dryRun) return result(await prepare(pool, input, e), {});

  /** One `budget_syncs` row for every confirm (R5, M13). A name or link is stored only for an import that landed (S4). */
  const syncRow = (p: Prepared | null, ok: boolean, error: string | null): repo.BudgetSyncRow => ({
    id: timeOrderedId("bsync"),
    source: input.source,
    by: input.by,
    byAs: input.byAs,
    scope: input.scope ?? null,
    whole: !!input.scope?.whole,
    lines: input.lines.length,
    added: ok && p ? p.plan.writes.filter((w) => w.op === "add").length : 0,
    changed: ok && p ? p.plan.writes.filter((w) => w.op === "change" || w.op === "restore").length : 0,
    withdrawn: ok && p ? p.plan.writes.filter((w) => w.op === "withdraw").length : 0,
    refused: p ? p.plan.refused.length + p.plan.held.length : 0,
    ok,
    error,
    sourceLabel: ok && p ? p.sourceLabel : null,
    sourceLink: ok && p ? p.sourceLink : null,
  });

  const insertSync = (db: Pool | PoolConnection, row: repo.BudgetSyncRow) => (input.recordSync === false ? Promise.resolve() : repo.insertBudgetSync(db, row).then(() => undefined));

  if (!input.revision && !input.stateRevision) {
    const p = await prepare(pool, input, e);
    await insertSync(pool, syncRow(p, false, "revision_required"));
    return refusal(400, "revision_required", "Preview the import first, then confirm the preview you read.", p);
  }

  const conn = await pool.getConnection();
  let locked = false;
  try {
    locked = await repo.takeBudgetLock(conn, 10);
    if (!locked) {
      await insertSync(pool, syncRow(null, false, "busy"));
      return refusal(409, "busy", "Somebody else is changing the budget right now. Preview again in a moment.");
    }
    await conn.beginTransaction();
    const p = await prepare(conn, input, e, pool);
    const stale = input.revision ? input.revision !== p.revision : input.stateRevision !== p.stateRevision;
    const sync = (ok: boolean, error: string | null) => syncRow(p, ok, error);
    if (stale) {
      await insertSync(conn, sync(false, "stale"));
      await conn.commit();
      return refusal(409, "stale", "The budget changed since this preview. Read the fresh preview, then confirm again.", p);
    }
    if (p.plan.refused.some((r) => r.row === 0)) {
      await insertSync(conn, sync(false, "source_refused"));
      await conn.commit();
      return refusal(400, "source_refused", "The import's own name, link or scope cannot be used as written. Fix it, then preview again.", p);
    }
    if (p.plan.held.length) {
      await insertSync(conn, sync(false, "names_held"));
      await conn.commit();
      return refusal(400, "names_held", "Some words may name a member. Reword them, then preview again.", p);
    }
    const refusedRows = new Set(p.plan.refused.map((r) => r.row).filter((n) => n > 0));
    if (input.lines.length > 0 && refusedRows.size === input.lines.length) {
      await insertSync(conn, sync(false, "all_refused"));
      await conn.commit();
      return refusal(400, "all_refused", "Every row of this import was refused, so nothing was written. Read the reasons, fix the rows, then preview again.", p);
    }
    if (input.withinLock) {
      const stop = await input.withinLock(conn);
      if (stop) {
        await conn.rollback();
        await insertSync(pool, sync(false, "stale"));
        return refusal(409, "stale", stop, p);
      }
    }
    const ids: string[] = [];
    const written: Array<{ op: PlanWrite["op"]; id: string }> = [];
    for (const w of p.plan.writes) {
      const line = { ...w.line, changedBy: input.by, changedAs: input.byAs ?? (input.by ? BUDGET_KEEPER : null), ...(w.op === "lock" ? { fxLockedBy: input.by, fxLockedAt: new Date().toISOString() } : {}) };
      const row: repo.BudgetLineRow = {
        ...line,
        id: line.id || `bl-${randomUUID()}`,
        sourceChangedAt: line.sourceChangedAt ? new Date(line.sourceChangedAt) : null,
        adoptedAt: line.adoptedAt ? new Date(line.adoptedAt) : null,
        fxRate: line.fxRate ?? null,
        fxSource: line.fxSource ?? null,
        fxAsOf: line.fxAsOf ?? null,
        fxLockedBy: line.fxLockedBy ?? null,
        fxLockedAt: line.fxLockedAt ? new Date(line.fxLockedAt) : null,
        prevPlannedMinor: line.prevPlannedMinor ?? null,
        prevSeenAt: line.prevSeenAt ? new Date(line.prevSeenAt) : null,
        sourceVillageWide: !!line.sourceVillageWide,
        fxInto: line.fxInto ?? null,
        fxLockedAs: line.fxLockedAs ?? null,
        withdrawnBySource: !!line.withdrawnBySource,
        nameHeld: !!line.nameHeld,
        labelOverride: line.labelOverride ?? null,
        nameHeldCell: line.nameHeldCell ?? null,
        sourceLabelOverride: line.sourceLabelOverride ?? null,
      };
      if (w.op === "add") await repo.insertBudgetLine(conn, row);
      else await repo.updateBudgetLine(conn, row);
      ids.push(row.id);
      written.push({ op: w.op, id: row.id });
    }
    const s = sync(true, null);
    await insertSync(conn, s);
    await conn.commit();
    for (const w of written) {
      void recordEvent(pool, { kind: "audit", text: `budget:${VERB[w.op]}:${w.id}`, actorUserId: input.by, entityType: "budget_line", entityRef: w.id, audience: "admin" });
    }
    // Never the public pulse (S5): members read it through the member-gated budget read (`budgetShareHistory`).
    if (written.length && shareMoved(p.shareBefore, p.shareAfter)) {
      void recordEvent(pool, { kind: "budget", text: SHARE_MOVED_EVENT, entityType: "budget", entityRef: p.shareAfter.moonId, audience: "admin" });
    }
    if (p.turnOff && (await repo.turnBudgetSourceOff(pool, input.source, p.turnOff))) {
      void recordEvent(pool, { kind: "audit", text: `budget:source:${input.source}:turned-off`, entityType: "budget_source", entityRef: input.source, audience: "admin" });
    }
    return result(p, { written: true, syncId: s.id, lineIds: ids });
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    if (locked) await repo.releaseBudgetLock(conn).catch(() => undefined);
    conn.release();
  }
}

// ── Moons ahead (R30) and period notes (R32) ────────────────────────────────

export interface PeriodNote {
  periodKey: string;
  note: string;
  changedAt: string | null;
  /** An account id. The read route names `changedAs` and never this. */
  changedBy: string | null;
  changedAs: string | null;
}

const noteOf = (r: RowDataPacket): PeriodNote => ({ periodKey: String(r.period_key), note: String(r.note), changedAt: iso(r.changed_at), changedBy: str(r.changed_by), changedAs: str(r.changed_as) });

/** The longest period note (R32). */
export const PERIOD_NOTE_MAX = 1000;

export async function periodNote(pool: Pool, periodKey: string): Promise<PeriodNote | null> {
  const [r] = await repo.periodNoteRows(pool, [periodKey]);
  return r ? noteOf(r) : null;
}

/**
 * HOW TO READ A PERIOD (R32): one note per period, checked for names like
 * every budget word (R15), at most 1000 characters, recorded. An empty note
 * clears it. The caller has already passed the R21 door.
 */
const noteVersionOf = (periodKey: string, note: string | null): string => revisionOf(["note", periodKey, note]);

export async function setPeriodNote(
  pool: Pool,
  input: { period: string; note: string; by: string | null; byAs: string | null; dryRun?: boolean; expectVersion?: string | null },
): Promise<{ ok: true; periodKey: string; cleared: boolean } | { ok: false; status: 400 | 409; code: string; message: string }> {
  const p = resolvePeriod(input.period, periodEnvOf(env));
  if (!p.ok) return { ok: false, status: 400, code: "period", message: p.message };
  const note = String(input.note ?? "").normalize("NFC").trim();
  if (Array.from(note).length > PERIOD_NOTE_MAX) return { ok: false, status: 400, code: "too_long", message: `Keep the note to ${PERIOD_NOTE_MAX} characters.` };
  if (FORMAT_CHARS.test(note)) return { ok: false, status: 400, code: "hidden_characters", message: "This note carries invisible characters. Type it again as plain text." };
  if (note) {
    const find = budgetNameCheck(await rosterRows(pool), { chartWords: await chartWordsFor(pool) })(note);
    if (find?.kind === "refused") return { ok: false, status: 400, code: `name_${find.what}`, message: nameFindWords(find) };
    if (find?.kind === "held") return { ok: false, status: 400, code: "names_held", message: nameFindWords(find) };
  }
  if (input.dryRun) return { ok: true, periodKey: p.period.key, cleared: !note };
  // Under the budget lock, in one transaction, with the version a suggestion was made on checked there.
  const conn = await pool.getConnection();
  let locked = false;
  try {
    locked = await repo.takeBudgetLock(conn, 10);
    if (!locked) return { ok: false, status: 409, code: "busy", message: "Somebody else is changing the budget right now. Try again in a moment." };
    await conn.beginTransaction();
    if (input.expectVersion) {
      const [row] = await repo.periodNoteRows(conn, [p.period.key]);
      if (noteVersionOf(p.period.key, row ? String(row.note) : null) !== input.expectVersion) {
        await conn.rollback();
        return { ok: false, status: 409, code: "stale", message: "This note changed since the suggestion was made. Suggest it again." };
      }
    }
    if (note) {
      await repo.upsertPeriodNote(conn, { periodKey: p.period.key, note, changedBy: input.by, changedAs: input.byAs ?? BUDGET_KEEPER });
    } else {
      await repo.deletePeriodNote(conn, p.period.key);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    if (locked) await repo.releaseBudgetLock(conn).catch(() => undefined);
    conn.release();
  }
  void recordEvent(pool, { kind: "audit", text: `budget:note:${p.period.key}`, actorUserId: input.by, entityType: "budget_period_note", entityRef: p.period.key, audience: "admin" });
  return { ok: true, periodKey: p.period.key, cleared: !note };
}

export interface AheadMoon extends MoonPlan {
  startsOn: string;
  endsOn: string;
  days: number;
  /** Committed only for the current moon; null for every other (R30). */
  committedMinor: number | null;
  /** The newest change to a line that gave this moon something (R29). */
  plannedAsOf: string | null;
  note: Omit<PeriodNote, "changedBy"> | null;
}

/**
 * MOONS AHEAD (R30): from one moon, `count` moons on (1 to 12), each with what
 * it plans per category and in all, by circle, from the lines that count,
 * and committed only for the current moon. Null for a moon id no clock reads.
 */
export async function budgetAhead(pool: Pool, fromMoonId: string, count: number, over: Partial<BudgetEnv> = {}): Promise<{ currentMoonId: string; villageCurrency: string | null; moons: AheadMoon[] } | null> {
  const e = { ...env, ...over };
  const parsed = parseId(fromMoonId);
  if (!parsed || parsed.cycleNumber === null || parsed.clock === "legacy_month") return null;
  const n = Math.max(1, Math.min(12, Math.floor(count)));
  const lines = (await repo.budgetLineRows(pool)).map(rowToLine);
  const changedAt = new Map(lines.map((l) => [l.id, l.changedAt]));
  const village = e.currency().toUpperCase() || null;
  const current = e.currentMoonId();
  const ids = Array.from({ length: n }, (_, i) => boundsForNumber(parsed.cycleNumber! + i).id);
  const notes = new Map((await repo.periodNoteRows(pool, ids)).map((r) => [String(r.period_key), noteOf(r)]));
  const moons: AheadMoon[] = [];
  for (const id of ids) {
    const m = moonPeriod(id, e.timezone());
    if (!m) continue;
    const plan = moonPlan(lines, { id, startsOn: m.startsOn, endsOn: m.endsOn, days: m.days }, village);
    const plannedAsOf = plan.lineIds.map((x) => changedAt.get(x) ?? null).filter((x): x is string => !!x).sort().pop() ?? null;
    const note = notes.get(id);
    moons.push({
      ...plan,
      startsOn: m.startsOn,
      endsOn: m.endsOn,
      days: m.days,
      committedMinor: id === current ? committedTotal(await committedFor(pool, id, e)) : null,
      plannedAsOf,
      note: note ? { periodKey: note.periodKey, note: note.note, changedAt: note.changedAt, changedAs: note.changedAs } : null,
    });
  }
  return { currentMoonId: current, villageCurrency: village, moons };
}

// ── A circle's envelope (R35) and the circles view (R31) ────────────────────

export interface BudgetEnvelope {
  circleId: string;
  periodKind: PeriodKind;
  periodKey: string;
  startsOn: string;
  endsOn: string;
  plannedMinor: number;
  currency: string;
  goalNote: string | null;
  changedAt: string | null;
  /** An account id. The read route names `changedAs` and never this. */
  changedBy: string | null;
  changedAs: string | null;
}

const envelopeOf = (r: RowDataPacket): BudgetEnvelope => ({
  circleId: String(r.circle_id),
  periodKind: r.period_kind,
  periodKey: String(r.period_key),
  startsOn: String(r.starts_on_text ?? r.starts_on).slice(0, 10),
  endsOn: String(r.ends_on_text ?? r.ends_on).slice(0, 10),
  plannedMinor: Number(r.planned_minor),
  currency: String(r.currency),
  goalNote: str(r.goal_note),
  changedAt: iso(r.changed_at),
  changedBy: str(r.changed_by),
  changedAs: str(r.changed_as),
});

export async function budgetEnvelopes(pool: Pool): Promise<BudgetEnvelope[]> {
  return (await repo.budgetEnvelopeRows(pool)).map(envelopeOf);
}

/** The longest goal note an envelope keeps (R35). */
export const GOAL_NOTE_MAX = 500;

/** What an envelope allows over a span: whole for its own period, else floored by the days they share, the way a line is. */
export function envelopeShare(env_: Pick<BudgetEnvelope, "periodKind" | "periodKey" | "startsOn" | "endsOn" | "plannedMinor">, span: { id: string; startsOn: string; endsOn: string; days: number }): number {
  return lineShareOfMoon(env_, span).countedMinor;
}

export type EnvelopeResult =
  | {
      ok: true;
      written: boolean;
      revision: string;
      before: Omit<BudgetEnvelope, "changedBy"> | null;
      after: Pick<BudgetEnvelope, "circleId" | "periodKind" | "periodKey" | "startsOn" | "endsOn" | "plannedMinor" | "currency" | "goalNote">;
      /** What the circle's lines that count plan over the envelope's period (all categories). */
      circlePlannedMinor: number;
      /** The lines pass the envelope: a warning, never a block (R35). */
      over: boolean;
      /** The envelope's version as it stands, the one a suggestion binds to. */
      version: string;
    }
  | { ok: false; status: 400 | 404 | 409; code: string; message: string };

/**
 * A CIRCLE'S ENVELOPE (R35): what a circle may plan for a period, in the
 * village's currency, with a goal note checked for names (R15). Set through
 * the R21 door, which the caller has already passed; previewed with the
 * circle's lines measured against it, bound by revision, recorded. The moon's
 * figure still counts lines, never envelopes.
 */
/** A circle's planned amount over a span: its own lines, and the village-wide scope's when it is the village's circle (M2). */
function circlePlanned(plan: MoonPlan, circleId: string, villageCircleId: string | null): { total: number; byCategory: Record<BudgetCategory, number> } {
  const own = plan.byCircle.filter((c) => c.circleId === circleId || (circleId === villageCircleId && (c.circleId === VILLAGE_WIDE || c.circleId === null)));
  const byCategory = { role_pay: 0, quest_pay: 0, materials: 0, other: 0 };
  for (const c of own) for (const k of BUDGET_CATEGORIES) byCategory[k] += c.byCategory[k];
  return { total: own.reduce((n, c) => n + c.totalMinor, 0), byCategory };
}

type EnvelopeInput = {
  circleId: string;
  period: string;
  planned: string | number;
  goalNote: string | null;
  format?: NumberFormatChoice;
  by: string | null;
  byAs: string | null;
  dryRun: boolean;
  revision?: string | null;
  /** The envelope's version a suggestion was made on, checked inside the budget lock. */
  expectVersion?: string | null;
};

const envelopeVersionOf = (circleId: string, periodKey: string, row: Pick<BudgetEnvelope, "plannedMinor" | "currency" | "goalNote" | "startsOn" | "endsOn"> | null): string =>
  revisionOf(["envelope", circleId, periodKey, row ? [row.plannedMinor, row.currency, row.goalNote, row.startsOn, row.endsOn] : null]);

async function envelopeView(db: Pool | PoolConnection, input: EnvelopeInput, e: BudgetEnv): Promise<EnvelopeResult> {
  const chart = await repo.budgetChartRows(db);
  const circles = chart.circles.map(chartCircleOf);
  const circle = circles.find((c) => c.id === input.circleId && !c.isExample);
  if (!circle) return { ok: false, status: 404, code: "no_circle", message: "There is no circle by that id on the chart." };
  const p = resolvePeriod(input.period, periodEnvOf(e));
  if (!p.ok) return { ok: false, status: 400, code: "period", message: p.message };
  const village = e.currency().toUpperCase();
  if (!village) return { ok: false, status: 400, code: "no_currency", message: "This village has no currency set yet, and an envelope is set in it." };
  const amount = readAmount(input.planned, village, input.format ?? { locale: "en", chosen: false });
  if (!amount.ok) return { ok: false, status: 400, code: amount.reason, message: amount.message };
  const goalNote = String(input.goalNote ?? "").normalize("NFC").trim() || null;
  if (goalNote && Array.from(goalNote).length > GOAL_NOTE_MAX) return { ok: false, status: 400, code: "too_long", message: `Keep what this budget is for to ${GOAL_NOTE_MAX} characters.` };
  if (goalNote && FORMAT_CHARS.test(goalNote)) return { ok: false, status: 400, code: "hidden_characters", message: "This note carries invisible characters. Type it again as plain text." };
  if (goalNote) {
    const find = budgetNameCheck(await rosterRows(db as Pool), { chartWords: chartWordsOf({ circles: chart.circles.map(chartCircleOf), roles: chart.roles.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), circleId: str(r.circle_id), active: Number(r.active) === 1, isExample: Number(r.is_example) === 1 })) }) })(goalNote);
    if (find?.kind === "refused") return { ok: false, status: 400, code: `name_${find.what}`, message: nameFindWords(find) };
    if (find?.kind === "held") return { ok: false, status: 400, code: "names_held", message: nameFindWords(find) };
  }
  const existing = (await repo.budgetEnvelopeRows(db)).map(envelopeOf).find((x) => x.circleId === circle.id && x.periodKey === p.period.key) ?? null;
  const after = { circleId: circle.id, periodKind: p.period.kind, periodKey: p.period.key, startsOn: p.period.startsOn, endsOn: p.period.endsOn, plannedMinor: amount.minor, currency: village, goalNote };
  const lines = (await repo.budgetLineRows(db)).map(rowToLine);
  const span = { id: p.period.key, startsOn: p.period.startsOn, endsOn: p.period.endsOn, days: daysInclusive(p.period.startsOn, p.period.endsOn) };
  const villageCircleId = villageCircleOf(circles, e.villageCircleSetting())?.id ?? null;
  const circlePlannedMinor = circlePlanned(moonPlan(lines, span, village), circle.id, villageCircleId).total;
  const before = existing ? (({ changedBy: _changedBy, ...rest }) => rest)(existing) : null;
  const revision = revisionOf([before, after, stateRevision(lines)]);
  return { ok: true, written: false, revision, before, after, circlePlannedMinor, over: circlePlannedMinor > amount.minor, version: envelopeVersionOf(circle.id, p.period.key, existing) };
}

/**
 * A CIRCLE'S ENVELOPE (R35): what a circle may plan for a period, in the
 * village's currency, with a goal note checked for names (R15). Set through
 * the R21 door, which the caller has already passed; previewed with the
 * circle's lines measured against it, bound by revision, and written inside
 * the budget's lock and a transaction, where the revision is checked again.
 * The moon's figure still counts lines, never envelopes.
 */
export async function setEnvelope(pool: Pool, input: EnvelopeInput): Promise<EnvelopeResult> {
  const e = env;
  const first = await envelopeView(pool, input, e);
  if (!first.ok || input.dryRun) return first;
  const STALE = { ok: false as const, status: 409 as const, code: "stale", message: "The envelope or the circle's lines changed since this preview. Read the fresh preview, then confirm again." };
  if (input.revision !== first.revision) return STALE;
  const conn = await pool.getConnection();
  let locked = false;
  try {
    locked = await repo.takeBudgetLock(conn, 10);
    if (!locked) return { ok: false, status: 409, code: "busy", message: "Somebody else is changing the budget right now. Preview again in a moment." };
    await conn.beginTransaction();
    const now = await envelopeView(conn, input, e);
    if (!now.ok || now.revision !== input.revision || (input.expectVersion && now.version !== input.expectVersion)) {
      await conn.rollback();
      return now.ok ? STALE : now;
    }
    await repo.upsertBudgetEnvelope(conn, { ...now.after, changedBy: input.by, changedAs: input.byAs ?? BUDGET_KEEPER });
    await conn.commit();
    void recordEvent(pool, { kind: "audit", text: `budget:envelope:${now.after.circleId}:${now.after.periodKey}`, actorUserId: input.by, entityType: "budget_envelope", entityRef: `${now.after.circleId}:${now.after.periodKey}`, audience: "admin" });
    return { ...now, written: true };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    if (locked) await repo.releaseBudgetLock(conn).catch(() => undefined);
    conn.release();
  }
}

export interface CircleView {
  id: string;
  name: string;
  parentCircleId: string | null;
  sortOrder: number;
  status: string;
  layer: string | null;
  /** A dormant circle holds nothing; the page folds it under "Dormant circles" (R31). */
  dormant: boolean;
  /** The village's own circle (R34). */
  village: boolean;
  /** All categories, from the lines that count, for the moon. */
  plannedMinor: number;
  byCategory: Record<BudgetCategory, number>;
  /** The circle's envelope for this moon, the most specific period winning: whole for the moon's own, else floored by shared days. */
  envelope: (Omit<BudgetEnvelope, "changedBy"> & { forMoonMinor: number }) | null;
  /** More than one envelope of this circle touches the moon (a month's and the moon's own): the most specific counts, flagged. */
  envelopeOverlap: boolean;
  /** The lines pass the envelope: a warning only (R35). Null with no envelope. */
  over: boolean | null;
  /** Cash owed for this moon's work in this circle. The route shows it only to cash.pay holders (R23). */
  committedMinor: number;
}

/**
 * THE CIRCLES VIEW (R31): every circle the chart carries, examples left out,
 * in `sort_order` with its parent so the page nests it like the chart; each
 * with what its lines that count plan this moon, its envelope, whether the
 * lines pass it, and the cash owed for its work this moon (role rows by their
 * role's or seat's circle; a quest or proposal row names no circle and is
 * counted apart as `unplacedCommittedMinor`).
 */
export async function budgetCircles(pool: Pool, moonId: string, over: Partial<BudgetEnv> = {}): Promise<{ moonId: string; villageCircleId: string | null; circles: CircleView[]; unplacedCommittedMinor: number } | null> {
  const e = { ...env, ...over };
  const m = moonPeriod(moonId, e.timezone());
  if (!m) return null;
  const span = { id: moonId, startsOn: m.startsOn, endsOn: m.endsOn, days: m.days };
  const chart = await repo.budgetChartRows(pool);
  const circles = chart.circles.map(chartCircleOf).filter((c) => !c.isExample);
  const villageCircleId = villageCircleOf(circles, e.villageCircleSetting())?.id ?? null;
  const village = e.currency().toUpperCase() || null;
  // Village-wide lines are placed on the village's circle here, when the view is read, and only here (M2).
  const plan = moonPlan((await repo.budgetLineRows(pool)).map(rowToLine), span, village);
  const envelopes = (await budgetEnvelopes(pool)).filter((x) => sharedDays(x, span) > 0);
  // Cash owed this moon, placed on a circle through the role or the seat it was owed against.
  const roleCircle = new Map(chart.roles.map((r) => [String(r.id), str(r.circle_id)]));
  const seatRole = new Map(chart.seatings.map((s) => [String(s.id), String(s.org_role_id)]));
  const committed = new Map<string, number>();
  let unplacedCommittedMinor = 0;
  const at = moonInstants(moonId);
  if (at && village) {
    for (const r of await repo.cashOwedForMoon(pool, cashKeys.role(moonId, "", "").slice(0, -1), at.startsAt, at.endsAt)) {
      if (String(r.currency).toUpperCase() !== village) continue;
      if (r.work_kind === "role") {
        const k = decodeRoleKey(String(r.occurrence_key));
        // Allowances count against materials, never against role pay, as in the village's figure (P3).
        if (!k || k.cycle !== moonId || k.allowance) continue;
        const ref = String(r.work_ref);
        const circle = roleCircle.get(ref) ?? roleCircle.get(seatRole.get(ref) ?? "") ?? null;
        if (circle) committed.set(circle, (committed.get(circle) ?? 0) + Number(r.amount_minor));
        else unplacedCommittedMinor += Number(r.amount_minor);
      } else unplacedCommittedMinor += Number(r.amount_minor);
    }
  }
  return {
    moonId,
    villageCircleId,
    unplacedCommittedMinor,
    circles: circles.map((c) => {
      const p = circlePlanned(plan, c.id, villageCircleId);
      // The most specific envelope wins: the moon's own, else the one with the fewest days.
      const mine = envelopes
        .filter((x) => x.circleId === c.id)
        .sort((a, b) => (a.periodKey === moonId ? -1 : b.periodKey === moonId ? 1 : daysInclusive(a.startsOn, a.endsOn) - daysInclusive(b.startsOn, b.endsOn)));
      const own = mine[0] ?? null;
      const envelope = own ? (({ changedBy: _changedBy, ...rest }) => ({ ...rest, forMoonMinor: envelopeShare(own, span) }))(own) : null;
      const plannedMinor = p.total;
      return {
        id: c.id,
        name: c.name,
        parentCircleId: c.parentCircleId,
        sortOrder: c.sortOrder,
        status: c.status,
        layer: c.layer,
        dormant: c.status === "dormant",
        village: c.id === villageCircleId,
        plannedMinor,
        byCategory: p.byCategory,
        envelope,
        envelopeOverlap: mine.length > 1,
        over: envelope ? plannedMinor > envelope.forMoonMinor : null,
        committedMinor: committed.get(c.id) ?? 0,
      };
    }),
  };
}

// ── A source's standing switch (v0.4, R18) ─────────────────────────────────

export type SourceMode = "auto" | "review";
export type SourceSchedule = "daily" | "hourly" | "off";

export interface BudgetSourceState {
  source: string;
  on: boolean;
  mode: SourceMode;
  schedule: SourceSchedule;
  /** An account id. The read route names `setAs` and never this. */
  setBy: string | null;
  setAs: string | null;
  setAt: string | null;
  offReason: string | null;
}

/** The sources a switch may name: every source a person does not write by hand. */
const SWITCHABLE = ["sera"] as const;

const sourceOf = (source: string, r: RowDataPacket | null): BudgetSourceState => ({
  source,
  on: !!r && Number(r.on) === 1,
  mode: r?.mode === "review" ? "review" : "auto",
  schedule: r?.schedule === "hourly" ? "hourly" : r?.schedule === "off" ? "off" : "daily",
  setBy: r ? str(r.set_by) : null,
  setAs: r ? str(r.set_as) : null,
  setAt: r ? iso(r.set_at) : null,
  offReason: r ? str(r.off_reason) : null,
});

/**
 * What a suggestion on an envelope, a period note or a source switch binds to
 * (B3, S7): that one row as it stands, never the whole budget. A suggestion
 * whose row moved since it was made is stale.
 */
export async function envelopeVersion(pool: Pool, circleId: string, period: string): Promise<string> {
  const p = resolvePeriod(period, periodEnvOf(env));
  const row = p.ok ? (await budgetEnvelopes(pool)).find((x) => x.circleId === circleId && x.periodKey === p.period.key) ?? null : null;
  return envelopeVersionOf(circleId, p.ok ? p.period.key : String(period), row);
}

export async function periodNoteVersion(pool: Pool, period: string): Promise<string> {
  const p = resolvePeriod(period, periodEnvOf(env));
  const row = p.ok ? await periodNote(pool, p.period.key) : null;
  return noteVersionOf(p.ok ? p.period.key : String(period), row ? row.note : null);
}

export async function sourceVersion(pool: Pool, source: string): Promise<string> {
  const s = await budgetSourceState(pool, source);
  return revisionOf(["source", source, s.on, s.mode, s.schedule, s.setAs, s.offReason]);
}

/** One source's switch, or the default for one never switched: off, auto, daily. */
export async function budgetSourceState(pool: Pool, source: string): Promise<BudgetSourceState> {
  return sourceOf(source, await repo.budgetSourceRow(pool, source));
}

export async function budgetSourceStates(pool: Pool): Promise<BudgetSourceState[]> {
  const rows = new Map((await repo.budgetSourceRows(pool)).map((r) => [String(r.source), r]));
  return SWITCHABLE.map((s) => sourceOf(s, rows.get(s) ?? null));
}

export interface SwitchInput {
  source: string;
  on: boolean;
  mode: SourceMode;
  schedule: SourceSchedule;
  by: string | null;
  byAs: string | null;
  dryRun: boolean;
  revision?: string | null;
  /** The org roles the person switching is seated in: adopting a line naming one is a payee conflict (R21, B1). */
  seatedRoleIds?: readonly string[];
}

export type SwitchResult =
  | {
      ok: true;
      written: boolean;
      revision: string;
      before: BudgetSourceState;
      after: Omit<BudgetSourceState, "setBy" | "setAt" | "offReason">;
      /** How many lines the source already sent that count from now (auto, turned on). */
      adopts: number;
      /** The roles those lines pay: who holds one of them may not decide the switch (V10). */
      rolesPaid: string[];
      shareBefore: ShareState;
      shareAfter: ShareState;
    }
  | { ok: false; status: 400 | 404 | 409; code: string; message: string };

const SWITCH_PAYEE_CONFLICT =
  "Turning this source on would make a budget line count for a role you hold, so you cannot do it yourself. Suggest it: it goes to the holders who hold no role it pays, or to a village vote when every holder holds one.";

/**
 * TURNING A SOURCE ON, OFF, OR BETWEEN MODES (R18): an act of the R21 door,
 * which the caller has already passed. Previewed with the share before and
 * after, bound by revision, logged. Turning it on in `auto` adopts what the
 * source already sent, through `importBudgetLines` (an adoption is a budget
 * write like any other), as "standing: <role>", never a line in an ended moon,
 * one marked closed, or one held for its words. A payee conflict, a line the
 * switch would adopt naming a role the switcher is seated in, is refused
 * before anything is written (B1). The source's row is written inside the
 * adoption's own lock and transaction, so the two land together or not at
 * all. Turning it off removes nothing: lines already counted keep counting.
 */
export async function switchBudgetSource(pool: Pool, input: SwitchInput): Promise<SwitchResult> {
  if (!(SWITCHABLE as readonly string[]).includes(input.source)) return { ok: false, status: 404, code: "unknown_source", message: "There is no budget source by that name." };
  if (input.mode !== "auto" && input.mode !== "review") return { ok: false, status: 400, code: "mode", message: "A source applies its lines at once (auto) or waits for review (review)." };
  if (!["daily", "hourly", "off"].includes(input.schedule)) return { ok: false, status: 400, code: "schedule", message: "A source is read daily, hourly, or only when somebody presses Sync." };
  const e = env;
  const before = await budgetSourceState(pool, input.source);
  const byAs = input.byAs ?? BUDGET_KEEPER;
  const adoptedAs = `standing: ${byAs}`.slice(0, 120);
  const current = moonPeriod(e.currentMoonId(), e.timezone());
  const pending = input.on && input.mode === "auto"
    ? (await budgetLines(pool)).filter((l) => l.source === input.source && !l.adoptedAt && l.status === "approved" && !stillHeld(l) && !(current && l.startsOn < current.startsOn))
    : [];
  const seated = new Set(input.seatedRoleIds ?? []);
  if (pending.some((l) => l.roleId && seated.has(l.roleId))) return { ok: false, status: 409, code: "payee_conflict", message: SWITCH_PAYEE_CONFLICT };
  const rows: ImportRow[] = pending.map((l) => ({ id: l.id, action: "adopt", adoptedAs }));
  const base: ImportInput = { source: "manual", lines: rows, by: input.by, byAs, dryRun: true, recordSync: false };
  const p = await importBudgetLines(pool, base);
  const after = { source: input.source, on: input.on, mode: input.mode, schedule: input.schedule, setAs: byAs };
  const stateOf = (x: BudgetSourceState) => [x.on, x.mode, x.schedule, x.setBy, x.setAs, x.offReason];
  const revision = revisionOf([p.revision, stateOf(before), after]);
  const rolesPaid = Array.from(new Set(pending.map((l) => l.roleId).filter((x): x is string => !!x))).sort();
  const out = { ok: true as const, written: false, revision, before, after, adopts: p.changed.length, rolesPaid, shareBefore: p.shareBefore, shareAfter: p.shareAfter };
  if (input.dryRun) return out;
  const STALE = "The budget or the source changed since this preview. Read the fresh preview, then confirm again.";
  if (input.revision !== revision) return { ok: false, status: 409, code: "stale", message: STALE };
  const done = await importBudgetLines(pool, {
    ...base,
    dryRun: false,
    revision: p.revision,
    withinLock: async (conn) => {
      const now = sourceOf(input.source, await repo.budgetSourceRow(conn, input.source));
      if (JSON.stringify(stateOf(now)) !== JSON.stringify(stateOf(before))) return STALE;
      await repo.upsertBudgetSource(conn, { source: input.source, on: input.on, mode: input.mode, schedule: input.schedule, setBy: input.by, setAs: byAs });
      return null;
    },
  });
  if (!done.ok) return { ok: false, status: done.status === 200 ? 409 : done.status, code: done.code ?? "refused", message: done.message ?? "The switch could not be written." };
  void recordEvent(pool, { kind: "audit", text: `budget:source:${input.source}:${input.on ? "on" : "off"}:${input.mode}`, actorUserId: input.by, entityType: "budget_source", entityRef: input.source, audience: "admin" });
  return { ...out, written: true };
}

/**
 * Why a switch that is on should be off, or null (R18, P1): its setter has
 * left; an admin set it and a launch vote has since carried, or somebody now
 * holds the power; or its setter no longer holds it. Read only.
 */
async function switchOffReason(s: BudgetSourceState, e: BudgetEnv, pool: Pool): Promise<string | null> {
  // A switch the village voted on is the village's standing act: no one person's power ends it (R22).
  if (s.setAs === BY_VILLAGE_VOTE) return null;
  if (!s.setBy) return "The person who turned this source on has left the village. A holder of the budget power turns it on again.";
  // An admin's switch stands while an admin's door stands (`holderDoor`): before the
  // launch vote, and after it while nobody sits in the steward's seat.
  if (s.setAs === ADMIN_BEFORE_LAUNCH || s.setAs === ADMIN_NO_STEWARD) {
    if ((await e.launched(pool)) && (await e.stewardHolders()).length > 0) {
      return "An admin turned this source on, and since then the launch vote has carried with a steward seated. A holder of the budget power turns it on again.";
    }
    return null;
  }
  if (s.setAs === BREAK_GLASS) {
    if (!(await e.stewardHolders()).includes(s.setBy)) return "The steward who broke the glass to turn this source on no longer sits in the steward's seat. A holder of the budget power turns it on again.";
    return null;
  }
  if (!(await e.holdsRolePay(s.setBy))) return "The person who turned this source on no longer holds the budget power. A holder turns it on again.";
  return null;
}

export async function recheckSource(pool: Pool, source: string, over: Partial<BudgetEnv> = {}): Promise<{ on: boolean; mode: SourceMode; offReason: string | null; turnedOff: boolean }> {
  const e = { ...env, ...over };
  const s = await budgetSourceState(pool, source);
  if (!s.on) return { on: false, mode: s.mode, offReason: s.offReason, turnedOff: false };
  const reason = await switchOffReason(s, e, pool);
  if (!reason) return { on: true, mode: s.mode, offReason: null, turnedOff: false };
  const turnedOff = await repo.turnBudgetSourceOff(pool, source, reason);
  if (turnedOff) void recordEvent(pool, { kind: "audit", text: `budget:source:${source}:turned-off`, entityType: "budget_source", entityRef: source, audience: "admin" });
  return { on: false, mode: s.mode, offReason: reason, turnedOff };
}

// ── Stored rates, read on the server (spec 5a) ──────────────────────────────

/** What a stored rate's source says on the line: the daily provider, or a row typed into the rate table by hand. */
function providerName(sources: readonly string[]): string {
  if (sources.some((s) => s === "manual")) return "the rate table, a rate typed there by hand";
  let host = "the daily rate provider";
  try {
    host = new URL(dailyRatesUrl()).host;
  } catch {
    // The URL is a literal; a parse failure keeps the generic name.
  }
  return `daily rate, ${host}`;
}

/**
 * The newest stored rate from each line currency into the village's, for a
 * lock that asks for one. The rate comes through `latestRates` and
 * `crossRate`, which keep 14 days; its day and source come from the rows it
 * was made of. Rates are read here, on the server, and never by the client.
 */
async function providerRates(db: Pool | PoolConnection, lines: readonly StoredLine[], village: string): Promise<(from: string) => ProviderRate | null> {
  const to = village.toUpperCase();
  if (!to) return () => null;
  const table = await latestRates(db as Pool);
  const quotes = Array.from(new Set(lines.map((l) => l.currency.toUpperCase()).concat(to))).filter((q) => q !== FX_BASE);
  const days = new Map((await repo.fxQuoteDays(db, quotes)).map((r) => [String(r.quote), { asOf: String(r.as_of), source: String(r.source) }]));
  return (from: string) => {
    const used = Array.from(new Set([from.toUpperCase(), to])).filter((q) => q !== FX_BASE);
    const dated = used.map((q) => days.get(q));
    if (dated.some((d) => !d)) return null;
    const asOf = dated.map((d) => d!.asOf).sort()[0] ?? null;
    return { rate: crossRate(table.rates, from.toUpperCase(), to), asOf, source: providerName(dated.map((d) => d!.source)) };
  };
}

/**
 * DRIFT, DISPLAY ONLY (spec 5a, guard 2): each locked line's figure at
 * today's stored rate beside the figure at its locked rate, and the percent
 * between them. Nothing here moves a figure or a lock; over 5% feeds the
 * members-only Health warning (wired with the page, PR 1c).
 */
export async function budgetRateDrift(pool: Pool, over: Partial<BudgetEnv> = {}): Promise<RateDrift[]> {
  const e = { ...env, ...over };
  const village = e.currency().toUpperCase();
  if (!village) return [];
  // Only a rate locked into the village's currency drifts against it (M4, V6).
  const locked = (await budgetLines(pool)).filter((l) => l.fxRate && l.status !== "withdrawn" && l.currency.toUpperCase() !== village && String(l.fxInto ?? "").toUpperCase() === village);
  if (!locked.length) return [];
  const table = await latestRates(pool);
  // The label members read: a holder's rename, never a source's words held for a name (V6).
  return locked.map((l) => rateDrift({ ...l, label: displayLabel(l) }, village, crossRate(table.rates, l.currency.toUpperCase(), village)));
}

// ── The sources a puller plugs into ─────────────────────────────────────────

/**
 * A puller: reads its source and hands what it read to `importBudgetLines`
 * itself, with its own scope and `whole` flag. It never adopts (R19).
 */
export type BudgetPull = (ctx: { pool: Pool; by: string | null }) => Promise<{ ok: boolean; state?: string; message?: string }>;

const SOURCES = new Map<string, BudgetPull>();

/** The registry only (PR 1a). The knowledge library's puller registers itself here in PR 2. */
export function registerBudgetSource(source: string, pull: BudgetPull): void {
  if (source === "upload" || source === "manual") throw new Error(`"${source}" is written by people, never pulled.`);
  SOURCES.set(source, pull);
}

export function budgetSource(source: string): BudgetPull | null {
  return SOURCES.get(source) ?? null;
}

export function budgetSourceNames(): string[] {
  return Array.from(SOURCES.keys()).sort();
}
