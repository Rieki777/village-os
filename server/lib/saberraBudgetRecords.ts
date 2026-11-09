/**
 * SERA'S BUDGET LINES, READ INTO IMPORT ROWS (budgets spec R6, R15 to R17, R20).
 * The pure half of the budget puller; `server/lib/saberraBudgets.ts` is the
 * half that calls the service and writes.
 *
 * ── THE FORMAT LIVES HERE, AND ONLY HERE ─────────────────────────────────
 *
 * The contract sent to the vendor on 2026-11-08 (the operations repository's
 * SERA_BUDGETS_CONTRACT) names twelve fields. The vendor has not answered with
 * its own format yet, so this is built to the contract, and every name the
 * format decides sits in this file: the kind's name, the fields that cross,
 * the category table, how a page of the answer is read. A format change is an
 * edit to this file and its test.
 *
 * ── A KIND OF ITS OWN (R16) ──────────────────────────────────────────────
 *
 * `budget` is never one of `HELD_KINDS`, so the structure sync, its
 * fingerprint, its facts and its withdrawals never see a budget line. Its plan
 * is made here from the same `tools/list` answer by the same argument rule
 * (`kindArgumentFor`). The contract asks the vendor to list `budget` in
 * `list_records`' enum; until it does, the kind is not offered, which is a
 * named state and never an error.
 *
 * ── REFUSED AND COUNTED, NEVER DROPPED (R15) ─────────────────────────────
 *
 * A fractional or negative amount, a currency no ISO list knows, an id that is
 * not an id, a status the contract does not name, two dates that make no
 * period: each becomes a refusal on the record's row, which the import counts,
 * flags as "its last good version stays" and lets withdraw nothing. Names in a
 * label are the import's to check, for every source alike (`budgetNameCheck`):
 * a full name, a handle or an address refuses the line, and a lone first name
 * holds it, stored unadopted and hidden until a holder renames it.
 *
 * ── PAGE IDS, THROUGH THE STORED MATCH ONLY (R17) ────────────────────────
 *
 * A line's circle and role are page ids. They map through the match the
 * newest snapshot stored for each record (#989): the structure read's own
 * answer to "which of ours is this page". A page id it matched to nothing, or
 * a row kept before matches were stored, leaves the line unmatched, and an
 * unmatched line never counts. Nothing here compares a name.
 *
 * Pure: no pool, no clock, no network. The caller hands in what it read.
 */
import type { ToolInfo } from "./saberraClient";
import { comparableKindName, kindArgumentFor } from "./saberraKinds";
import { idShapeOk, normaliseId, pageIdOf } from "./saberraRelations";
import type { ImportRow } from "./budgets";
import { LABEL_MAX, type BudgetCategory, type PeriodEnv, type PeriodKind } from "../../shared/budgets";
import { boundsForNumber, type CycleClock } from "../../shared/cycleClock";
import { hasDailyRate } from "../../shared/money";
import { addDays, moonDays } from "../../shared/moonRecap";
import type { Snapshot } from "../../shared/seraDifferences";

// ── The kind (R16) ──────────────────────────────────────────────────────────

/** The kind's name, as the contract asks the vendor to list it. */
export const BUDGET_KIND = "budget";
/** The tool the kind is read with. */
export const BUDGET_TOOL = "list_records";

export type BudgetKindPlan = { offered: true; argument: string; wire: string; note: string } | { offered: false; note: string };

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const isBudget = (value: string) => comparableKindName(value) === comparableKindName(BUDGET_KIND);

/**
 * Whether the service offers the budget kind, and under which argument and
 * spelling. Only the service's own schema can say so: the contract asks for
 * `budget` in `list_records`' enum, and nothing else counts as an offer.
 */
export function planBudgetKind(tools: readonly ToolInfo[]): BudgetKindPlan {
  const tool = tools.find((t) => t.name === BUDGET_TOOL);
  if (!tool) return { offered: false, note: "The service lists no list_records tool." };
  const schema = asObject(tool.inputSchema);
  if (!schema || !asObject(schema.properties) || Object.keys(asObject(schema.properties)!).length === 0) {
    return { offered: false, note: "list_records carries no input schema, so no budget kind can be read in it." };
  }
  const hit = kindArgumentFor(schema, isBudget);
  const wire = hit?.values.find(isBudget);
  if (!hit || wire === undefined) return { offered: false, note: "list_records names no budget kind among the values it accepts." };
  return { offered: true, argument: hit.name, wire, note: `The service's schema names "${hit.name}" and accepts ${wire}.` };
}

// ── The fields that cross ───────────────────────────────────────────────────

/**
 * WHAT THIS VILLAGE READS, AND THE VENDOR'S NAME FOR EACH. The contract's
 * twelve fields, nothing more: anything else in a record is dropped before it
 * is read, and named in `dropped`. Notes, people, links and free text never
 * cross (the contract's "What crosses NOWHERE").
 */
export const SERA_BUDGET_FIELDS = {
  id: "id",
  periodStart: "periodStart",
  periodEnd: "periodEnd",
  circle: "circle",
  role: "role",
  category: "category",
  label: "label",
  currency: "currency",
  plannedMinor: "plannedMinor",
  spentMinor: "spentMinor",
  status: "status",
  changedAt: "changedAt",
} as const;

export type SeraBudgetField = keyof typeof SERA_BUDGET_FIELDS;

const BY_WIRE = new Map<string, SeraBudgetField>(Object.entries(SERA_BUDGET_FIELDS).map(([ours, wire]) => [wire, ours as SeraBudgetField]));

/** A field name that may be named in an answer: an identifier. Anything else may be somebody's words, and is counted. */
const NAMEABLE = /^[A-Za-z_$][A-Za-z0-9_$-]{0,39}$/;

/**
 * One record through the allow-list. A record may carry its fields flat, or
 * inside `fields` beside its id, the shape the structure read accepts; inside
 * wins. Answers the contract's fields under our names, and every other key,
 * named when it is shaped like a field name and counted otherwise.
 */
export function allowBudgetFields(raw: unknown): { values: Partial<Record<SeraBudgetField, unknown>>; dropped: string[] } {
  const top = asObject(raw) ?? {};
  const inner = asObject(top.fields);
  const values: Partial<Record<SeraBudgetField, unknown>> = {};
  const named = new Set<string>();
  let unnamed = 0;
  const take = (bag: Record<string, unknown>, isTop: boolean) => {
    for (const [key, value] of Object.entries(bag)) {
      if (isTop && inner && key === "fields") continue;
      const ours = BY_WIRE.get(key);
      if (ours) {
        if (!(ours in values) || !isTop) values[ours] = value;
        continue;
      }
      if (NAMEABLE.test(key)) named.add(key);
      else unnamed += 1;
    }
  };
  take(top, true);
  if (inner) take(inner, false);
  const dropped = Array.from(named).sort();
  if (unnamed) dropped.push(`${unnamed} more`);
  return { values, dropped };
}

// ── Categories (R20) ────────────────────────────────────────────────────────

/** A label as the table reads it: letters and digits, lower case. */
const foldCategory = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * SERA'S CATEGORY LABELS ONTO OUR FOUR. Our own four ids first, which the
 * contract invites Sera to send; then the labels a budget sheet commonly
 * uses for each. A label not here is `other`, and its words are kept as the
 * line's source label, never over the line's own label.
 */
const CATEGORY_TABLE: Readonly<Record<string, BudgetCategory>> = {
  rolepay: "role_pay",
  stipend: "role_pay",
  stipends: "role_pay",
  rolestipend: "role_pay",
  rolestipends: "role_pay",
  compensation: "role_pay",
  rolecompensation: "role_pay",
  salary: "role_pay",
  salaries: "role_pay",
  wages: "role_pay",
  questpay: "quest_pay",
  quest: "quest_pay",
  quests: "quest_pay",
  bounty: "quest_pay",
  bounties: "quest_pay",
  questreward: "quest_pay",
  questrewards: "quest_pay",
  materials: "materials",
  material: "materials",
  supplies: "materials",
  supply: "materials",
  equipment: "materials",
  tools: "materials",
  materialsandtools: "materials",
  materialsandsupplies: "materials",
  other: "other",
  misc: "other",
  miscellaneous: "other",
};

/** Sera's category label as ours, with the label kept when the table does not know it; null when it is not text. */
export function budgetCategoryOf(label: unknown): { category: BudgetCategory; sourceLabel: string | null } | null {
  if (typeof label !== "string") return null;
  const words = label.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!words) return null;
  const known = CATEGORY_TABLE[foldCategory(words)];
  return known ? { category: known, sourceLabel: null } : { category: "other", sourceLabel: Array.from(words).slice(0, LABEL_MAX).join("") };
}

// ── Periods (R6) ────────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (s: string): boolean => DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** The last day of the month a day falls in. */
const lastOfMonth = (day: string): string => {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return addDays(m === 12 ? `${y + 1}-01-01` : `${day.slice(0, 4)}-${String(m + 1).padStart(2, "0")}-01`, -1);
};

export type PeriodForDates = { ok: true; period: string; kind: PeriodKind } | { ok: false; message: string };

/**
 * TWO CIVIL DATES AS A PERIOD THE IMPORT READS (R6). Sera's dates are civil
 * dates in the village's zone (the contract says so), so they are compared
 * with each moon's civil days in that zone (`moonDays`). An exact moon is that
 * moon, by its id; a whole calendar month is `YYYY-MM` (and on a calendar
 * clock that month IS the moon, so the moon is asked first); a season's dates
 * are the season, its last day the day before the season calendar's end;
 * anything else is a span keyed by its two dates. Each answer is text the
 * import's `resolvePeriod` reads back to the same kind and days.
 */
export function periodForDates(startsOn: unknown, endsOn: unknown, env: PeriodEnv, clock: CycleClock): PeriodForDates {
  const a = typeof startsOn === "string" ? startsOn.trim() : "";
  const b = typeof endsOn === "string" ? endsOn.trim() : "";
  if (!realDate(a) || !realDate(b)) return { ok: false, message: "A budget line names its first and last day as real dates, like 2026-11-09." };
  if (b < a) return { ok: false, message: "This budget line's last day comes before its first day." };
  const near = clock.boundsFor(new Date(`${a}T12:00:00Z`)).cycleNumber;
  for (const n of [near - 1, near, near + 1]) {
    const bounds = boundsForNumber(n);
    const days = moonDays(bounds, env.timezone);
    if (days.firstDay === a && days.lastDay === b) return { ok: true, period: bounds.id, kind: "moon" };
  }
  if (a.endsWith("-01") && b === lastOfMonth(a)) return { ok: true, period: a.slice(0, 7), kind: "month" };
  const season = env.seasons.find((s) => s.startsOn === a && !!s.endsOn && realDate(s.endsOn) && addDays(s.endsOn, -1) === b);
  if (season) return { ok: true, period: season.id, kind: "season" };
  return { ok: true, period: `${a}..${b}`, kind: "span" };
}

// ── Currencies ──────────────────────────────────────────────────────────────

let known: Set<string> | null = null;

/** An ISO 4217 code this runtime knows; with no list from the runtime, one the daily rate source quotes. */
export function isKnownCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  if (!known) {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    try {
      known = typeof intl.supportedValuesOf === "function" ? new Set(intl.supportedValuesOf("currency")) : new Set();
    } catch {
      known = new Set();
    }
  }
  return known.size ? known.has(code) : hasDailyRate(code);
}

// ── Page ids (R17) ──────────────────────────────────────────────────────────

/** Sera's page ids to ours, from the newest snapshot's stored match. Keyed by `normaliseId`. */
export interface BudgetMatches {
  circles: ReadonlyMap<string, string>;
  /** A role, and its circle on the chart, for a role-only line and a pair the chart disagrees with. */
  roles: ReadonlyMap<string, { roleId: string; circleId: string | null }>;
}

type ChartRow = Readonly<Record<string, unknown>>;

/**
 * THE STORED MATCH, AND ONLY IT. Each record of the newest snapshot whose
 * stored match names a subject still on the chart, examples left out. A
 * record matched to nothing (`match: null`), kept before matches were stored
 * (no `match`), or matched to a subject the chart no longer has, maps nothing.
 */
export function budgetMatchesOf(snapshot: Snapshot | null, chart: { circles: readonly ChartRow[]; roles: readonly ChartRow[] }): BudgetMatches {
  const live = (r: ChartRow) => Number(r.is_example) !== 1;
  const circleIds = new Set(chart.circles.filter(live).map((c) => String(c.id)));
  const roleCircle = new Map(chart.roles.filter(live).map((r) => [String(r.id), r.circle_id ? String(r.circle_id) : null] as const));
  const circles = new Map<string, string>();
  const roles = new Map<string, { roleId: string; circleId: string | null }>();
  for (const rec of snapshot?.circles?.records ?? []) {
    const ours = rec?.match?.ourId;
    if (typeof ours === "string" && circleIds.has(ours) && typeof rec.id === "string") circles.set(normaliseId(pageIdOf(rec.id)), ours);
  }
  for (const rec of snapshot?.roles?.records ?? []) {
    const ours = rec?.match?.ourId;
    if (typeof ours === "string" && roleCircle.has(ours) && typeof rec.id === "string") roles.set(normaliseId(pageIdOf(rec.id)), { roleId: ours, circleId: roleCircle.get(ours) ?? null });
  }
  return { circles, roles };
}

// ── One record (R15) ────────────────────────────────────────────────────────

export interface BudgetRecordEnv {
  period: PeriodEnv;
  clock: CycleClock;
  /** The village's own currency, which always counts as known. "" when unset. */
  villageCurrency: string;
  matches: BudgetMatches;
}

export type SourceRefusal = NonNullable<ImportRow["refusedBySource"]>[number];

export interface SeraBudgetRow {
  /** The row the import takes: the line, or the record's id with what refused it. */
  row: ImportRow;
  refused: boolean;
  /** The keys the allow-list dropped. */
  dropped: string[];
}

const STATUSES = ["draft", "approved", "closed"] as const;

/** A page id as the stored match keys it, or null when the value is absent; "bad" when it is not an id. */
function pointer(v: unknown): string | null | "bad" {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !idShapeOk(v)) return "bad";
  return normaliseId(pageIdOf(v));
}

/** A whole number of minor units, 0 or more, or why not. */
function minorOf(v: unknown): { ok: true; minor: number } | { ok: false; reason: string } {
  if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, reason: "not_a_number" };
  if (v < 0) return { ok: false, reason: "negative" };
  if (!Number.isInteger(v)) return { ok: false, reason: "fractional" };
  if (!Number.isSafeInteger(v)) return { ok: false, reason: "too_large" };
  return { ok: true, minor: v };
}

const AMOUNT_WORDS: Record<string, string> = {
  not_a_number: "is not a number of minor units",
  negative: "is below 0",
  fractional: "has a fraction of a minor unit",
  too_large: "is too large to hold exactly",
};

/**
 * ONE RECORD INTO ONE IMPORT ROW. A record with nothing wrong becomes the
 * line the import takes, with the ids already matched (R17) and the amounts
 * already in minor units. A record with anything wrong becomes its id and
 * every reason it was refused, so the import counts it as listed and keeps its
 * last good version (R3); an id that is not an id is never stored as one.
 */
export function seraBudgetRow(raw: unknown, env: BudgetRecordEnv): SeraBudgetRow {
  const { values: f, dropped } = allowBudgetFields(raw);
  const refused: SourceRefusal[] = [];
  const refuse = (cell: string, reason: string, message: string) => refused.push({ cell, reason, message });

  const sentId = typeof f.id === "string" ? f.id.trim() : "";
  const idOk = sentId !== "" && idShapeOk(sentId);
  if (!idOk) refuse("source_ref", "not_an_id", "This budget line's id is not shaped like a record id. A page address, or any text with spaces, slashes or colons, is refused.");
  const sourceRef = idOk ? pageIdOf(sentId) : "";

  const period = periodForDates(f.periodStart, f.periodEnd, env.period, env.clock);
  if (!period.ok) refuse("period", "period", period.message);

  const circle = pointer(f.circle);
  if (circle === "bad") refuse("circle", "not_an_id", "This budget line names its circle by something other than the circle's page id.");
  const role = pointer(f.role);
  if (role === "bad") refuse("role", "not_an_id", "This budget line names its role by something other than the role's page id.");

  const category = budgetCategoryOf(f.category);
  if (!category) refuse("category", "category", "This budget line carries no category.");

  if (typeof f.label !== "string") refuse("label", "label", "This budget line's label is not text.");

  const currency = typeof f.currency === "string" ? f.currency.trim().toUpperCase() : "";
  const village = env.villageCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || !(isKnownCurrency(currency) || currency === village)) {
    refuse("currency", "unknown_currency", "This budget line's currency is not a currency code any list here knows, like CRC or USD.");
  }

  const planned = minorOf(f.plannedMinor);
  if (!planned.ok) refuse("planned", planned.reason, `This budget line's planned amount ${AMOUNT_WORDS[planned.reason]}. It is a whole number of minor units, 0 or more.`);
  let spentMinor: number | null = null;
  if (f.spentMinor !== null && f.spentMinor !== undefined) {
    const spent = minorOf(f.spentMinor);
    if (spent.ok) spentMinor = spent.minor;
    else refuse("spent", spent.reason, `This budget line's spent amount ${AMOUNT_WORDS[spent.reason]}. It is a whole number of minor units, 0 or more, or empty.`);
  }

  const status = typeof f.status === "string" ? f.status.trim().toLowerCase() : "";
  if (!(STATUSES as readonly string[]).includes(status)) refuse("status", "status", "This budget line's status is not one of draft, approved or closed.");

  if (refused.length) return { row: { sourceRef, refusedBySource: refused }, refused: true, dropped };

  // The ids through the stored match only (R17). Unmatched is a state the line keeps, and it never counts.
  let circleId: string | null = null;
  let roleId: string | null = null;
  let matched = true;
  if (circle) {
    circleId = env.matches.circles.get(circle) ?? null;
    if (!circleId) matched = false;
  }
  if (role) {
    const r = env.matches.roles.get(role);
    if (!r) matched = false;
    else {
      roleId = r.roleId;
      // Sera places the role in one circle and the chart in another: nobody guesses which is right.
      if (circleId && r.circleId !== circleId) matched = false;
    }
  }

  const changed = typeof f.changedAt === "string" ? Date.parse(f.changedAt) : NaN;
  return {
    row: {
      sourceRef,
      sourceChangedAt: Number.isFinite(changed) ? new Date(changed).toISOString() : null,
      period: (period as Extract<PeriodForDates, { ok: true }>).period,
      circleId,
      roleId,
      matched,
      category: category!.category,
      sourceLabel: category!.sourceLabel,
      label: f.label as string,
      plannedMinor: (planned as { ok: true; minor: number }).minor,
      spentMinor,
      currency,
      status,
    },
    refused: false,
    dropped,
  };
}

// ── One page of the answer ──────────────────────────────────────────────────

/**
 * One page of a `list_records` answer, in either shape the bridge has met:
 * `{ results, has_more, next_cursor }`, or `{ records, cursor }` (also
 * `items` or `data`, and `nextCursor`), or a bare list. Null for anything
 * else, prose included: an answer this cannot read is a failed read, never an
 * empty one. `stuck` is a page that says more follows and gives no cursor to
 * read it by, so the read cannot be whole.
 */
export function budgetPageOf(value: unknown): { records: unknown[]; next: string | null; stuck?: true } | null {
  if (Array.isArray(value)) return { records: value, next: null };
  const v = asObject(value);
  if (!v) return null;
  const list = [v.results, v.records, v.items, v.data].find((x) => Array.isArray(x)) as unknown[] | undefined;
  if (!list) return null;
  const cursor = [v.next_cursor, v.nextCursor, v.cursor].find((x) => typeof x === "string" && x.trim() !== "") as string | undefined;
  if (v.has_more === false) return { records: list, next: null };
  if (v.has_more === true && !cursor) return { records: list, next: null, stuck: true };
  return { records: list, next: cursor ?? null };
}
