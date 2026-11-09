/**
 * THE CASH BUDGET (budgets spec v0.2; tables in 0347). The one write path, the
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
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  BY_VILLAGE_VOTE,
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
  rateDrift,
  rateUnits,
  readAmount,
  readCategory,
  resolvePeriod,
  shareMoved,
  shareState,
  sharedDays,
  whyNotCounted,
  type BudgetCategory,
  type BudgetSource,
  type CashBudgetLeft,
  type CommittedParts,
  type FigureLine,
  type LineStatus,
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
import { currentCycle } from "./gratitude-cycles";
import { villageTimezone } from "./villageReaders";

export { BY_VILLAGE_VOTE };

// ── The environment the figure is read in ───────────────────────────────────

/**
 * THE CASH ON WORK SET THIS MOON THAT HAS NO `cash_owed` ROW YET (R7, the
 * third committed part). INJECTABLE, AND STUBBED TO 0 TODAY.
 *
 * The valuation lane owns the records this reads (its setting records, 0336),
 * and the interface is being agreed with it. Until it lands, the default
 * answers 0 and says so by its name, and the figure's working shows the part
 * as 0. The valuation lane replaces it with `configureBudgets({
 * committedFromSettings })` at boot, and `budgets.test.ts` pins that the hook
 * is what the figure reads.
 */
export type CommittedFromSettings = (db: Pool | PoolConnection, moonId: string) => Promise<{ minor: number }>;

export const committedFromSettingsNotYetAgreed: CommittedFromSettings = async () => ({ minor: 0 });

export interface BudgetEnv {
  /** The village's currency as configured, "" when it is not set (R8: then nothing counts). */
  currency(): string;
  timezone(): string;
  seasons(): readonly SeasonLike[];
  /** The moon a write's share before and after is shown for (R10). */
  currentMoonId(): string;
  committedFromSettings: CommittedFromSettings;
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
  committedFromSettings: committedFromSettingsNotYetAgreed,
  baseToSet: async () => null,
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
}

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
  };
}

const digest = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

/** The fields whose change is a change to the budget. Who changed it, and when, are not. */
const valueOf = (l: StoredLine) => [
  l.id, l.lineKey, l.source, l.sourceRef, l.sourceChangedAt, l.periodKind, l.periodKey, l.startsOn, l.endsOn, l.circleId, l.roleId,
  l.matched, l.category, l.plannedMinor, l.spentMinor, l.currency, l.label, l.sourceLabel, l.note, l.status, l.adoptedAt,
  l.fxRate ?? null, l.fxSource ?? null, l.fxAsOf ?? null,
];

/** The budget as it stands, as one digest: what the figure names as its `revision` (R7). */
export function stateRevision(lines: readonly StoredLine[]): string {
  return digest([...lines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(valueOf));
}

// ── The key (R2) ────────────────────────────────────────────────────────────

/** The label as the key reads it: trimmed, case-folded, NFC. */
export const foldLabel = (label: string): string => label.normalize("NFC").trim().toLowerCase().normalize("NFC");

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
  action?: "withdraw" | "restore" | "lock";
  use?: "provider";
  rate?: string | number;
  sourceNote?: string;
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

export interface BudgetChart {
  circles: Array<{ id: string; name: string; isExample: boolean }>;
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

export type FlagKind = "formula" | "overlap" | "kept_last_good" | "becomes_manual" | "adoption_cleared" | "rate_unlocked";

export interface Flag {
  row: number | null;
  cell: string;
  kind: FlagKind;
  message: string;
  ids?: string[];
}

export interface PlanWrite {
  op: "add" | "change" | "withdraw" | "restore" | "lock";
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
}

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

  const category = !base || has(row.category) ? readCategory(row.category) : base.category;
  if (!category) refuse("category", "category", "The category is one of role_pay, quest_pay, materials or other.");

  // Words (R13 keeps a formula as text and flags it; R15 checks names, for every source).
  const label = !base || has(row.label) ? clean(row.label) : base.label;
  if (!label) refuse("label", "label", "Give the line a label, like \"Garden crew pay\".");
  else if (Array.from(label).length > LABEL_MAX) refuse("label", "label", `Keep the label to ${LABEL_MAX} characters.`);
  const note = sera ? null : !base || has(row.note) ? clean(row.note) || null : base.note;
  if (note && Array.from(note).length > NOTE_MAX) refuse("note", "note", `Keep the note to ${NOTE_MAX} characters.`);
  const sourceLabel = sera ? clean(row.sourceLabel).slice(0, LABEL_MAX) || null : base?.sourceLabel ?? null;
  for (const [cell, text] of [["label", label], ["note", note], ["source_label", sourceLabel]] as const) {
    if (!text) continue;
    const raw = cell === "label" ? row.label : cell === "note" ? row.note : row.sourceLabel;
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

  // Scope. The library hands ids it already matched (R17), and says when it could not.
  let circleId = base?.circleId ?? null;
  let roleId = base?.roleId ?? null;
  let matched = base?.matched ?? true;
  if (sera) {
    circleId = clean(row.circleId) || null;
    roleId = clean(row.roleId) || null;
    matched = row.matched !== false;
  } else if (!base || has(row.circle) || has(row.role) || has(row.circleId) || has(row.roleId)) {
    const circleText = has(row.circleId) ? row.circleId : has(row.circle) ? row.circle : base?.circleId ?? null;
    const roleText = has(row.roleId) ? row.roleId : has(row.role) ? row.role : base?.roleId ?? null;
    const s = matchScope(circleText, roleText, input.chart);
    if (s.ok) {
      circleId = s.circleId;
      roleId = s.roleId;
    } else refuse(s.cell, "scope", s.message);
  }

  const sourceRef = sera ? clean(row.sourceRef) : base?.sourceRef ?? null;
  if (sera && (!sourceRef || sourceRef.length > 128 || /^[a-z]+:\/\//i.test(sourceRef))) refuse("source_ref", "source_ref", "A library line names the record's own id, never a link.");
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
      fxRate: base?.fxRate ?? null,
      fxSource: base?.fxSource ?? null,
      fxAsOf: base?.fxAsOf ?? null,
      fxLockedBy: base?.fxLockedBy ?? null,
      fxLockedAt: base?.fxLockedAt ?? null,
    },
  };
}

const UNLOCKED: Pick<StoredLine, "fxRate" | "fxSource" | "fxAsOf" | "fxLockedBy" | "fxLockedAt"> = { fxRate: null, fxSource: null, fxAsOf: null, fxLockedBy: null, fxLockedAt: null };
const keptLock = (t: StoredLine): Pick<StoredLine, "fxRate" | "fxSource" | "fxAsOf" | "fxLockedBy" | "fxLockedAt"> => ({
  fxRate: t.fxRate ?? null,
  fxSource: t.fxSource ?? null,
  fxAsOf: t.fxAsOf ?? null,
  fxLockedBy: t.fxLockedBy ?? null,
  fxLockedAt: t.fxLockedAt ?? null,
});
const RATE_UNLOCKED = "This line's currency or amount changed, so the rate locked on it no longer applies. Lock a rate again for it to count.";

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
  const find = input.names(note);
  if (find?.kind === "refused") return refuse("source_note", `name_${find.what}`, nameFindWords(find));
  if (find?.kind === "held") return { ok: false, held: { row: n, cell: "source_note", message: nameFindWords(find) } };
  return { ok: true, rate: (Number(units) / 10 ** RATE_DIGITS).toFixed(RATE_DIGITS), source: `typed: ${note}`.slice(0, 120), asOf: input.today };
}

/** Whether two lines say the same thing to the budget, whatever their id, key and source. */
const sameValues = (a: StoredLine, b: StoredLine): boolean => JSON.stringify(valueOf(a).slice(3)) === JSON.stringify(valueOf(b).slice(3));

/** What, if it changes on an adopted library line, means a person must adopt it again (R18). */
const adoptionFacts = (l: StoredLine) => JSON.stringify([l.plannedMinor, l.currency, l.periodKind, l.periodKey, l.startsOn, l.endsOn, l.circleId, l.roleId, l.matched, l.category, l.status]);

const NOT_IN_LIBRARY = "This line came from the knowledge library, so it changes there. Withdraw it here, or add a line of your own beside it.";
const CLOSED = "This line belongs to a closed moon, and a closed moon's lines are never edited. Add a correction as a new line in the current moon.";

/**
 * THE PLAN, pure: what one import does to the budget, row by row, and what it
 * withdraws (R2, R3). Nothing here reads or writes the database.
 */
export function planImport(input: PlanInput): ImportPlan {
  const plan: ImportPlan = { writes: [], unchanged: [], kept: [], refused: [], held: [], flags: [], withdrawSkipped: null };
  const byId = new Map(input.existing.map((l) => [l.id, l]));
  const byKey = new Map(input.existing.map((l) => [l.lineKey, l]));

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
      // A library record that refused still names itself, so it counts as listed (R3).
      const ref = input.source === "sera" ? clean(row?.sourceRef) : "";
      return { n, row, key: ref ? `sera:${ref}` : null, cells, target: ref ? byKey.get(`sera:${ref}`) ?? null : null };
    }
    const key = budgetLineKey({ ...cells.line, source: input.source });
    return { n, row, key, cells, target: byKey.get(key) ?? null };
  });

  // Duplicate keys within one import are refused, every row that shares one (R2).
  const rowsByKey = new Map<string, number[]>();
  for (const r of reads) if (r.key) rowsByKey.set(r.key, [...(rowsByKey.get(r.key) ?? []), r.n]);
  const duplicate = (r: Read) => !!r.key && (rowsByKey.get(r.key)?.length ?? 0) > 1;

  for (const r of reads) {
    if (duplicate(r)) {
      const others = rowsByKey.get(r.key!)!.filter((x) => x !== r.n);
      plan.refused.push({ row: r.n, cell: "row", reason: "duplicate", message: `This row is the same line as row ${others.join(", row ")}. Keep one of them.` });
      continue;
    }
    // A withdraw, a restore or a hand edit of one line by its id.
    if (r.row && r.row.id) {
      const t = r.target;
      if (!t) {
        plan.refused.push({ row: r.n, cell: "id", reason: "no_line", message: "There is no budget line with that id." });
        continue;
      }
      if (r.row.action === "lock") {
        if (t.status === "closed") {
          plan.refused.push({ row: r.n, cell: "status", reason: "closed", message: CLOSED });
          continue;
        }
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
        if (t.fxRate === fx.rate && t.fxSource === fx.source && t.fxAsOf === fx.asOf) {
          plan.unchanged.push({ row: r.n, id: t.id });
          continue;
        }
        const line: StoredLine = { ...t, fxRate: fx.rate, fxSource: fx.source, fxAsOf: fx.asOf };
        plan.writes.push({ op: "lock", row: r.n, line, before: t, plannedCell: null, becomesManual: false, adoptionCleared: false });
        continue;
      }
      if (r.row.action === "withdraw" || r.row.action === "restore") {
        const restoring = r.row.action === "restore";
        if (t.status === "closed") {
          plan.refused.push({ row: r.n, cell: "status", reason: "closed", message: CLOSED });
          continue;
        }
        if ((t.status === "withdrawn") !== restoring) {
          plan.unchanged.push({ row: r.n, id: t.id });
          continue;
        }
        const cleared = t.source === "sera" && !!t.adoptedAt;
        const line: StoredLine = { ...t, status: restoring ? "approved" : "withdrawn", ...(cleared && restoring ? { adoptedAt: null, adoptedAs: null } : {}) };
        plan.writes.push({ op: r.row.action, row: r.n, line, before: t, plannedCell: null, becomesManual: false, adoptionCleared: cleared && restoring });
        continue;
      }
      if (t.source === "sera") {
        plan.refused.push({ row: r.n, cell: "row", reason: "library_line", message: NOT_IN_LIBRARY });
        continue;
      }
      if (t.status === "closed") {
        plan.refused.push({ row: r.n, cell: "row", reason: "closed", message: CLOSED });
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
      // A writer here keeps the lock on a new amount (the preview shows the new converted figure); a new currency drops it.
      if (t.fxRate && line.currency !== t.currency) {
        Object.assign(line, UNLOCKED);
        plan.flags.push({ row: r.n, cell: "currency", kind: "rate_unlocked", message: RATE_UNLOCKED, ids: [t.id] });
      }
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
      if (input.source === "sera" && r.target) {
        plan.flags.push({ row: r.n, cell: "row", kind: "kept_last_good", message: "This record was refused, so its last good version stays as it was.", ids: [r.target.id] });
      }
      continue;
    }
    plan.flags.push(...cells.flags);
    if (cells.held.length) {
      plan.held.push(...cells.held);
      continue;
    }
    const t = r.target;
    const line: StoredLine = { ...cells.line, lineKey: r.key! };
    if (!t) {
      plan.writes.push({ op: "add", row: r.n, line, before: null, plannedCell: cells.plannedCell, becomesManual: false, adoptionCleared: false });
      continue;
    }
    if (input.source === "upload" && t.source === "manual") {
      plan.kept.push({ row: r.n, id: t.id, label: t.label });
      continue;
    }
    if (t.status === "closed") {
      plan.refused.push({ row: r.n, cell: "row", reason: "closed", message: CLOSED });
      if (input.source === "sera") plan.flags.push({ row: r.n, cell: "row", kind: "kept_last_good", message: "This record was refused, so its last good version stays as it was.", ids: [t.id] });
      continue;
    }
    const next: StoredLine = { ...line, id: t.id, lineKey: t.lineKey, source: t.source, adoptedAt: t.adoptedAt, adoptedAs: t.adoptedAs, status: input.source === "sera" ? line.status : "approved" };
    // The lock: the library changing the amount or the currency drops it; a writer here keeps it unless the currency moved.
    const lockStays = !!t.fxRate && next.currency === t.currency && !(input.source === "sera" && next.plannedMinor !== t.plannedMinor);
    Object.assign(next, lockStays ? keptLock(t) : UNLOCKED);
    if (t.fxRate && !lockStays) plan.flags.push({ row: r.n, cell: "row", kind: "rate_unlocked", message: RATE_UNLOCKED, ids: [t.id] });
    const cleared = input.source === "sera" && !!t.adoptedAt && adoptionFacts(next) !== adoptionFacts(t);
    if (cleared) {
      next.adoptedAt = null;
      next.adoptedAs = null;
      plan.flags.push({ row: r.n, cell: "row", kind: "adoption_cleared", message: "The library changed a line the village had adopted, so it stops counting until somebody adopts it again.", ids: [t.id] });
    }
    if (sameValues(next, t)) {
      plan.unchanged.push({ row: r.n, id: t.id });
      continue;
    }
    plan.writes.push({ op: t.status === "withdrawn" ? "restore" : "change", row: r.n, line: next, before: t, plannedCell: cells.plannedCell, becomesManual: false, adoptionCleared: cleared });
  }

  withdrawByScope(input, reads.map((r) => r.key).filter((k): k is string => !!k), plan);
  return plan;
}

/**
 * WITHDRAWAL BY SCOPE (R3). An upload ticked as the whole budget for its
 * periods withdraws the uploaded lines in that scope it no longer lists. A
 * whole library read withdraws the library lines it no longer lists, except
 * in periods older than the oldest one it sent. Either way, an import with any
 * refused or held row withdraws nothing.
 */
function withdrawByScope(input: PlanInput, listedKeys: string[], plan: ImportPlan): void {
  if (!input.scope?.whole || input.source === "manual") return;
  if (input.source === "sera" && input.rows.length === 0) {
    plan.withdrawSkipped = "empty_read";
    return;
  }
  if (plan.refused.length || plan.held.length) {
    // A library record refused under R15 counts as listed, so a refused read still withdraws nothing it named.
    plan.withdrawSkipped = "refused_rows";
    return;
  }
  const listed = new Set(listedKeys);
  const touched = new Set(plan.writes.map((w) => w.line.lineKey).concat(plan.kept.map((k) => byIdKey(input, k.id)), plan.unchanged.map((u) => byIdKey(input, u.id))));
  const live = (l: StoredLine) => l.status === "approved" || l.status === "draft";

  if (input.source === "sera") {
    const oldest = plan.writes.map((w) => w.line.startsOn).concat(input.existing.filter((l) => listed.has(l.lineKey)).map((l) => l.startsOn)).sort()[0];
    for (const l of input.existing) {
      if (l.source !== "sera" || !live(l) || listed.has(l.lineKey) || touched.has(l.lineKey)) continue;
      if (oldest && l.endsOn < oldest) continue;
      plan.writes.push({ op: "withdraw", row: null, line: { ...l, status: "withdrawn" }, before: l, plannedCell: null, becomesManual: false, adoptionCleared: false });
    }
    return;
  }

  // An upload: its scope, named or read off its rows.
  const rowPeriods = plan.writes.map((w) => `${w.line.periodKind}|${w.line.periodKey}`).concat(
    input.existing.filter((l) => touched.has(l.lineKey)).map((l) => `${l.periodKind}|${l.periodKey}`),
  );
  const rowCircles = plan.writes.map((w) => w.line.circleId).concat(input.existing.filter((l) => touched.has(l.lineKey)).map((l) => l.circleId));
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
    plan.writes.push({ op: "withdraw", row: null, line: { ...l, status: "withdrawn" }, before: l, plannedCell: null, becomesManual: false, adoptionCleared: false });
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
export async function committedFor(db: Pool | PoolConnection, moonId: string, e: BudgetEnv = env): Promise<CommittedParts> {
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
    if (r.work_kind === "role") {
      const k = decodeRoleKey(String(r.occurrence_key));
      if (!k || k.cycle !== moonId) continue;
      if (k.allowance) out.materialsMinor += amount;
      else out.roleMinor += amount;
    } else if (r.work_kind === "quest") out.questMinor += amount;
    else if (r.work_kind === "proposal") out.proposalMinor += amount;
  }
  const set = await e.committedFromSettings(db, moonId);
  out.settingsMinor = Math.max(0, Math.floor(Number(set?.minor) || 0));
  return out;
}

// ── The figure (R7) ─────────────────────────────────────────────────────────

function figureFor(lines: readonly StoredLine[], moonId: string, committed: CommittedParts, e: BudgetEnv): CashBudgetLeft | null {
  const moon = moonPeriod(moonId, e.timezone());
  if (!moon) return null;
  return budgetFigure(lines, { id: moonId, startsOn: moon.startsOn, endsOn: moon.endsOn, days: moon.days }, e.currency() || null, committed, stateRevision(lines));
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

/** Every line, as stored, for the read route. */
export async function budgetLines(pool: Pool): Promise<StoredLine[]> {
  return (await repo.budgetLineRows(pool)).map(rowToLine);
}

/**
 * The newest import per source (R5). Two imports in the same second tie on
 * `at`, so the id breaks the tie: ids lead with the time they were made.
 */
export async function latestSyncs(pool: Pool): Promise<Array<{ source: string; at: string; ok: boolean; lines: number }>> {
  const newest = new Map<string, RowDataPacket>();
  for (const r of await repo.latestBudgetSyncs(pool)) {
    const seen = newest.get(String(r.source));
    if (!seen || String(r.id) > String(seen.id)) newest.set(String(r.source), r);
  }
  return Array.from(newest.values())
    .sort((a, b) => (String(a.source) < String(b.source) ? -1 : 1))
    .map((r) => ({ source: String(r.source), at: iso(r.at)!, ok: Number(r.ok) === 1, lines: Number(r.lines) }));
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
  op: "change" | "restore" | "withdraw" | "lock";
  before: PreviewLine;
  becomesManual: boolean;
  adoptionCleared: boolean;
}

export interface ImportResult {
  ok: boolean;
  /** 200 for a preview or a write, 400 for an import that cannot be confirmed as sent, 409 for a stale or busy one. */
  status: 200 | 400 | 409;
  code: null | "stale" | "names_held" | "too_many_rows" | "revision_required" | "bad_source" | "busy";
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
  shareBefore: ShareState;
  shareAfter: ShareState;
  syncId: string | null;
  /** The ids written, an added line's included. */
  lineIds: string[];
}

const preview = (l: StoredLine, row: number | null, plannedCell: string | null, village: string): PreviewLine => ({
  row,
  convertedMinor: village ? inVillageCurrency(l, village) : null,
  fx: l.fxRate ? { rate: l.fxRate, source: l.fxSource ?? null, asOf: l.fxAsOf ?? null } : null,
  id: l.id || null,
  label: l.label,
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

/** A row as the plan's digest reads it: what it does, never an id that does not exist yet. */
const planDigest = (plan: ImportPlan) =>
  digest({
    w: plan.writes.map((w) => [w.op, w.row, w.line.lineKey, valueOf(w.line).slice(2), w.becomesManual, w.adoptionCleared]),
    u: plan.unchanged,
    k: plan.kept,
    r: plan.refused,
    h: plan.held,
    s: plan.withdrawSkipped,
  });

interface Prepared {
  village: string;
  existing: StoredLine[];
  plan: ImportPlan;
  after: StoredLine[];
  stateRevision: string;
  revision: string;
  shareBefore: ShareState;
  shareAfter: ShareState;
}

async function prepare(db: Pool | PoolConnection, input: ImportInput, e: BudgetEnv): Promise<Prepared> {
  const existing = (await repo.budgetLineRows(db)).map(rowToLine);
  const chartRows = await repo.budgetChartRows(db);
  const chart: BudgetChart = {
    circles: chartRows.circles.map((c) => ({ id: String(c.id), name: String(c.name ?? ""), isExample: Number(c.is_example) === 1 })),
    roles: chartRows.roles.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), circleId: str(r.circle_id), active: Number(r.active) === 1, isExample: Number(r.is_example) === 1 })),
  };
  const names = budgetNameCheck(await rosterRows(db as Pool));
  const villageCurrency = e.currency();
  const today = civilDateKey(new Date(), e.timezone());
  const rates = input.lines.some((r) => r && r.action === "lock" && r.use === "provider") ? await providerRates(db, existing, villageCurrency) : undefined;
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
  });
  const after = applyPlan(existing, plan.writes);
  plan.flags.push(...overlapFlags(after, plan.writes, villageCurrency));
  const moonId = e.currentMoonId();
  const committed = await committedFor(db, moonId, e);
  const base = await e.baseToSet(db, moonId);
  const state = stateRevision(existing);
  return {
    village: villageCurrency,
    existing,
    plan,
    after,
    stateRevision: state,
    revision: digest([state, planDigest(plan)]),
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
    shareBefore: p.shareBefore,
    shareAfter: p.shareAfter,
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
    kept: [], refused: [], held: [], flags: [], withdrawSkipped: null, shareBefore: empty, shareAfter: empty, syncId: null, lineIds: [],
  };
};

const VERB: Record<PlanWrite["op"], string> = { add: "added", change: "changed", withdraw: "withdrawn", restore: "restored", lock: "rate-locked" };

/** The members-visible line a write that moves the share records (R10). Fixed words, no figure, nobody named. */
export const SHARE_MOVED_EVENT = "This moon's cash budget changed, and with it the share of work paid in cash.";

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
  if (input.dryRun) return result(await prepare(pool, input, e), {});

  if (!input.revision && !input.stateRevision) {
    const p = await prepare(pool, input, e);
    return refusal(400, "revision_required", "Preview the import first, then confirm the preview you read.", p);
  }

  const conn = await pool.getConnection();
  let locked = false;
  try {
    locked = await repo.takeBudgetLock(conn, 10);
    if (!locked) return refusal(409, "busy", "Somebody else is changing the budget right now. Preview again in a moment.");
    await conn.beginTransaction();
    const p = await prepare(conn, input, e);
    const stale = input.revision ? input.revision !== p.revision : input.stateRevision !== p.stateRevision;
    const sync = (ok: boolean, error: string | null): repo.BudgetSyncRow => ({
      id: timeOrderedId("bsync"),
      source: input.source,
      by: input.by,
      byAs: input.byAs,
      scope: input.scope ?? null,
      whole: !!input.scope?.whole,
      lines: input.lines.length,
      added: ok ? p.plan.writes.filter((w) => w.op === "add").length : 0,
      changed: ok ? p.plan.writes.filter((w) => w.op === "change" || w.op === "restore").length : 0,
      withdrawn: ok ? p.plan.writes.filter((w) => w.op === "withdraw").length : 0,
      refused: p.plan.refused.length + p.plan.held.length,
      ok,
      error,
    });
    if (stale) {
      await repo.insertBudgetSync(conn, sync(false, "stale"));
      await conn.commit();
      return refusal(409, "stale", "The budget changed since this preview. Read the fresh preview, then confirm again.", p);
    }
    if (p.plan.held.length) {
      await repo.insertBudgetSync(conn, sync(false, "names_held"));
      await conn.commit();
      return refusal(400, "names_held", "Some words may name a member. Reword them, then preview again.", p);
    }
    const ids: string[] = [];
    const written: Array<{ op: PlanWrite["op"]; id: string }> = [];
    for (const w of p.plan.writes) {
      const line = { ...w.line, changedBy: input.by, changedAs: input.byAs, ...(w.op === "lock" ? { fxLockedBy: input.by, fxLockedAt: new Date().toISOString() } : {}) };
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
      };
      if (w.op === "add") await repo.insertBudgetLine(conn, row);
      else await repo.updateBudgetLine(conn, row);
      ids.push(row.id);
      written.push({ op: w.op, id: row.id });
    }
    const s = sync(true, null);
    await repo.insertBudgetSync(conn, s);
    await conn.commit();
    for (const w of written) {
      void recordEvent(pool, { kind: "audit", text: `budget:${VERB[w.op]}:${w.id}`, actorUserId: input.by, entityType: "budget_line", entityRef: w.id, audience: "admin" });
    }
    if (written.length && shareMoved(p.shareBefore, p.shareAfter)) {
      void recordEvent(pool, { kind: "budget", text: SHARE_MOVED_EVENT, entityType: "budget", entityRef: p.shareAfter.moonId, audience: "public" });
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
  const locked = (await budgetLines(pool)).filter((l) => l.fxRate && l.status !== "withdrawn" && l.currency.toUpperCase() !== village);
  if (!locked.length) return [];
  const table = await latestRates(pool);
  return locked.map((l) => rateDrift(l, village, crossRate(table.rates, l.currency.toUpperCase(), village)));
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
