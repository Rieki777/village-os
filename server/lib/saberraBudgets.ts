/**
 * THE SERA BUDGET PULLER (budgets spec R15 to R20, PR 2): Sera's budget lines,
 * read over the bridge and handed to the one write path, `importBudgetLines`.
 * What a record may say and how it is read is `saberraBudgetRecords.ts`; this
 * file calls the service, keeps the lock, and decides when a read happens.
 *
 * ── THREE WAYS A READ STARTS (R19) ───────────────────────────────────────
 *
 *   press      Sync budget, by a door holder (server/routes/budgetSync.ts).
 *              It reads Sera now, whether the source is on or off: off, what
 *              it reads lands waiting and counts for nothing.
 *   scheduled  the source's own schedule, daily by default, hourly, or off,
 *              through `registerJob`. A source that is off is never read.
 *   open       opening the Budgets section queues one read for the village
 *              when the last one is more than five minutes old, at most once
 *              per five minutes, by nobody, never holding up the page. A
 *              source that is off is never read this way either.
 *
 * Every one re-checks the source's switch first (`recheckSource`, R18): a
 * setter who no longer holds `role.pay` turns it off, with the reason, before
 * anything is read. The import re-checks again inside its own lock.
 *
 * ── ITS OWN LOCK (R16) ───────────────────────────────────────────────────
 *
 * `saberra-budgets`, beside and never inside the structure sync's
 * `saberra-sync`: a budget read and a structure read never wait on each
 * other. A press that loses the lock hears a sentence about budgets.
 *
 * ── WHAT A READ IS (R3) ──────────────────────────────────────────────────
 *
 * Paged to the end, at most `MAX_BUDGET_PAGES` pages of 100. A read is whole
 * when every page arrived and the answer is not empty; only a whole read lets
 * the import withdraw a line Sera stopped listing. A read cut short at the
 * cap, or by a page that says more follows and gives no cursor, lands what it
 * read and withdraws nothing. A read that failed part way lands nothing at
 * all, the structure sync's rule: half an answer is no change. Every read
 * writes one `budget_syncs` row (R5): the import's own when it ran, and one
 * marked not landed, with a sentence in this platform's words, when it never
 * reached the import. Nothing the service wrote is ever stored as an error.
 *
 * ── EVERYTHING HERE SITS BEHIND THE SABERRA MODULE ───────────────────────
 *
 * The press route mounts behind `requireModule("saberra")`; the schedule and
 * the on-open read ask the module's lifecycle and read nothing while it is
 * off. The credential never leaves `preflight()`.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { budgetPullEnv, budgetSourceState, importBudgetLines, recheckSource, type ImportInput, type ImportResult, type ImportRow } from "./budgets";
import { BUDGET_TOOL, budgetMatchesOf, budgetPageOf, planBudgetKind, seraBudgetRow } from "./saberraBudgetRecords";
import { callToolJson, listTools, openSession } from "./saberraClient";
import { preflight } from "./saberraSync";
import { activeClock } from "./gratitude-cycles";
import { effectiveLifecycle } from "./modules";
import { IMPORT_ROWS_MAX } from "../../shared/budgets";
import type { CycleClock } from "../../shared/cycleClock";
import { budgetChartRows, insertBudgetSync } from "../repos/budgets";
import { lastBudgetRead } from "../repos/budgetReads";
import { withNamedLock } from "../repos/namedLock";
import { recentSnapshots } from "../repos/saberraSnapshots";

const SOURCE = "sera";
const MODULE_ID = "saberra";

/** The lock every budget read runs under, pressed, scheduled or on open. Never the structure sync's. */
export const SERA_BUDGETS_LOCK = "saberra-budgets";
/** The scheduler's name for the budget reads. */
export const SERA_BUDGETS_JOB = "saberra-budgets";
/** Pages one read reads before it stops, at `PAGE_LIMIT` each: as many lines as one import holds. */
export const MAX_BUDGET_PAGES = 20;
const PAGE_LIMIT = 100;
/** The least time between two reads the section's opening queues (R19). */
export const OPEN_READ_GAP_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** What a press hears when a budget read is already running. */
export const SERA_BUDGETS_BUSY = "A Sera budget read is already running. Try again in a minute.";
/** The named state for a service that offers no budget kind (R16). Not an error. */
export const SERA_REPORTS_NO_BUDGETS = "Sera does not report budgets yet";
const MODULE_OFF = "The Sera module is off, so no budget is read from it.";
const SOURCE_OFF = "Sera is off as a budget source, so it is read only when somebody presses Sync budget.";
const NO_SESSION = "Sera did not open a session. Its address or the key may be wrong.";
const NO_TOOLS = "Sera did not list its tools, so no budget was read";
const READ_FAILED = "Sera's budget answer could not be read whole, so nothing from it was written";
const UNREADABLE_PAGE = "Sera answered a budget read in a shape this village cannot read, so nothing from it was written";
const TOO_MANY = `Sera sent more budget lines than one read holds (${IMPORT_ROWS_MAX}), so nothing from it was written.`;
const CUT_SHORT = `Sera's budget answer ran past ${MAX_BUDGET_PAGES} pages, so this read is not whole: it changed what it read and withdrew nothing.`;
const EMPTY = "Sera's budget answer was empty, so this read is not whole and withdrew nothing.";

/** The calls a read makes, handed in so a suite can stand in for the service. */
export interface SeraBudgetsEnv {
  lifecycle(): string;
  preflight: typeof preflight;
  openSession: typeof openSession;
  listTools: typeof listTools;
  callToolJson: typeof callToolJson;
  /** The village's clock, for naming a moon from two dates. */
  clock(): CycleClock;
  now(): number;
}

const DEFAULT_ENV: SeraBudgetsEnv = {
  lifecycle: () => effectiveLifecycle(MODULE_ID),
  preflight: () => preflight(),
  openSession: (o) => openSession(o),
  listTools: (o, s) => listTools(o, s),
  callToolJson: (o, s, t, a) => callToolJson(o, s, t, a),
  clock: () => activeClock(),
  now: () => Date.now(),
};

let env: SeraBudgetsEnv = { ...DEFAULT_ENV };
/** When the section's opening last queued a read in this process (R19's "at most one per 5 minutes"). */
let openedAt = Number.NEGATIVE_INFINITY;

/** For a suite: stand in for the service, its clock and the module. */
export function configureSeraBudgets(partial: Partial<SeraBudgetsEnv>): void {
  env = { ...env, ...partial };
}

/** Back to the defaults, and the on-open throttle forgotten. `keepEnv` forgets only the throttle. */
export function resetSeraBudgets(opts: { keepEnv?: boolean } = {}): void {
  openedAt = Number.NEGATIVE_INFINITY;
  if (!opts.keepEnv) env = { ...DEFAULT_ENV };
}

export type SeraBudgetState = "module_off" | "off" | "busy" | "not_connected" | "not_offered" | "failed" | "cut_short" | "empty" | "whole";

export interface SeraBudgetRead {
  /** The read landed: the import wrote it. */
  ok: boolean;
  state: SeraBudgetState;
  message: string | null;
  whole: boolean;
  /** Records Sera sent. */
  records: number;
  /** Records refused, here or by the import, each counted once. */
  refused: number;
  /** Keys the allow-list dropped, named where they are shaped like a field name. */
  dropped: string[];
  /** The re-check before this read turned the source off. */
  turnedOff: boolean;
  /** The import's own answer, when the read reached it. */
  result: ImportResult | null;
}

export type ReadTrigger = "press" | "scheduled" | "open";

export interface PullInput {
  pool: Pool;
  /** Who pressed, or null for a read the village's schedule or the section's opening made. */
  by: string | null;
  byAs?: string | null;
  trigger: ReadTrigger;
}

const blank = (state: SeraBudgetState, message: string | null): SeraBudgetRead => ({ ok: false, state, message, whole: false, records: 0, refused: 0, dropped: [], turnedOff: false, result: null });

/** An id that sorts in the order it was made, the shape every `budget_syncs` row carries. */
const syncId = () => `bsync-${Date.now().toString(36).padStart(9, "0")}-${randomUUID().slice(0, 8)}`;

/** One `budget_syncs` row for a read that never reached the import (R5), in this platform's words. */
async function unlanded(pool: Pool, input: PullInput, error: string, lines = 0): Promise<void> {
  await insertBudgetSync(pool, {
    id: syncId(),
    source: SOURCE,
    by: input.by,
    byAs: input.byAs ?? null,
    scope: null,
    whole: false,
    lines,
    added: 0,
    changed: 0,
    withdrawn: 0,
    refused: 0,
    ok: false,
    error: error.slice(0, 500),
    sourceLabel: null,
    sourceLink: null,
  });
}

/** Preview, then confirm exactly that preview, once more if somebody wrote between the two. */
async function landed(pool: Pool, input: ImportInput): Promise<ImportResult> {
  for (let attempt = 0; ; attempt++) {
    const preview = await importBudgetLines(pool, { ...input, dryRun: true });
    const done = await importBudgetLines(pool, { ...input, dryRun: false, revision: preview.revision });
    if (done.code !== "stale" || attempt >= 1) return done;
  }
}

/** Everything one read does, inside the lock. */
async function readLocked(input: PullInput): Promise<SeraBudgetRead> {
  const { pool } = input;
  const ready = env.preflight();
  if (!ready.ok) {
    await unlanded(pool, input, ready.body.error);
    return blank("not_connected", ready.body.error);
  }
  const session = await env.openSession(ready.client);
  if (!session) {
    await unlanded(pool, input, NO_SESSION);
    return blank("failed", NO_SESSION);
  }
  const tools = await env.listTools(ready.client, session);
  if (!tools.ok) {
    const message = `${NO_TOOLS} (${tools.why}).`;
    await unlanded(pool, input, message);
    return blank("failed", message);
  }
  const plan = planBudgetKind(tools.tools);
  if (!plan.offered) {
    await unlanded(pool, input, SERA_REPORTS_NO_BUDGETS);
    return blank("not_offered", SERA_REPORTS_NO_BUDGETS);
  }

  // Paged to the end, or to the cap (R16).
  const raws: unknown[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let cut = false;
  do {
    const r = await env.callToolJson(ready.client, session, BUDGET_TOOL, { [plan.argument]: plan.wire, limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
    // A failure names its kind only: the service's own words never reach the row or the screen.
    if (!r.ok) {
      const message = `${READ_FAILED} (${r.why}).`;
      await unlanded(pool, input, message, raws.length);
      return { ...blank("failed", message), records: raws.length };
    }
    const page = budgetPageOf(r.value);
    if (!page) {
      const message = `${UNREADABLE_PAGE}.`;
      await unlanded(pool, input, message, raws.length);
      return { ...blank("failed", message), records: raws.length };
    }
    raws.push(...page.records);
    pages += 1;
    cursor = page.next;
    if (page.stuck || (cursor && pages >= MAX_BUDGET_PAGES)) {
      cut = true;
      break;
    }
  } while (cursor);
  if (raws.length > IMPORT_ROWS_MAX) {
    await unlanded(pool, input, TOO_MANY, raws.length);
    return { ...blank("failed", TOO_MANY), records: raws.length };
  }

  // Each record through the allow-list and into a row, its page ids through the snapshot's stored match (R17).
  const pull = budgetPullEnv();
  const snapshot = (await recentSnapshots(pool, 1))[0]?.snapshot ?? null;
  const matches = budgetMatchesOf(snapshot, await budgetChartRows(pool));
  const recordEnv = { period: pull.period, clock: env.clock(), villageCurrency: pull.currency, matches };
  const named = new Set<string>();
  let unnamed = 0;
  const rows: ImportRow[] = [];
  const copies = new Set<string>();
  for (const raw of raws) {
    const out = seraBudgetRow(raw, recordEnv);
    for (const d of out.dropped) {
      const more = /^(\d+) more$/.exec(d);
      if (more) unnamed += Number(more[1]);
      else named.add(d);
    }
    // The same record twice, word for word (a page boundary that overlapped), is one record. Two different
    // records under one id both go to the import, which refuses them by row.
    const copy = JSON.stringify(out.row);
    if (out.row.sourceRef && copies.has(copy)) continue;
    copies.add(copy);
    rows.push(out.row);
  }
  const dropped = Array.from(named).sort();
  if (unnamed) dropped.push(`${unnamed} more`);

  const whole = !cut && raws.length > 0;
  const state: SeraBudgetState = cut ? "cut_short" : raws.length === 0 ? "empty" : "whole";
  const result = await landed(pool, { source: SOURCE, lines: rows, scope: { whole }, by: input.by, byAs: input.byAs ?? null, dryRun: true });
  const refused = new Set(result.refused.filter((x) => x.row > 0).map((x) => x.row)).size;
  return {
    ok: result.ok && result.written,
    state,
    message: !result.ok ? result.message : state === "cut_short" ? CUT_SHORT : state === "empty" ? EMPTY : null,
    whole,
    records: raws.length,
    refused,
    dropped,
    turnedOff: false,
    result,
  };
}

/**
 * ONE READ OF SERA'S BUDGET LINES, from any of the three doors. The pull
 * `registerBudgetSource("sera", ...)` holds. The caller has passed the door
 * (a press) or is the village's own schedule or the section's opening.
 */
export async function pullSeraBudgets(input: PullInput): Promise<SeraBudgetRead> {
  if (env.lifecycle() === "off") return blank("module_off", MODULE_OFF);
  // The switch is re-checked before every read (R18), so a setter who lost the power ends the standing act first.
  const check = await recheckSource(input.pool, SOURCE);
  if (input.trigger !== "press" && !check.on) return { ...blank("off", check.offReason ?? SOURCE_OFF), turnedOff: check.turnedOff };
  const run = await withNamedLock(input.pool, SERA_BUDGETS_LOCK, () => readLocked(input));
  if (!run.ran) return { ...blank("busy", SERA_BUDGETS_BUSY), turnedOff: check.turnedOff };
  return { ...run.value, turnedOff: check.turnedOff };
}

/** What the scheduler keeps as the job's last result: counts and states, never a line's words. */
const summary = (r: SeraBudgetRead): string =>
  r.state === "off" ? "the source is off: its re-check turned it off" : `${r.state}, ${r.records} records read, ${r.refused} refused${r.ok ? "" : ", nothing landed"}`;

/**
 * ONE CHECK BY THE SCHEDULER, every tick (R19). It reads only while the
 * module is on, the source is on and its schedule is not off, and only once
 * the schedule's gap (a day, or an hour) has passed since the last read of
 * any kind.
 */
export async function scheduledSeraBudgets(pool: Pool): Promise<string> {
  if (env.lifecycle() === "off") return "the module is off";
  const s = await budgetSourceState(pool, SOURCE);
  if (!s.on) return "the source is off";
  if (s.schedule === "off") return "the schedule is off";
  const every = s.schedule === "hourly" ? HOUR_MS : DAY_MS;
  const last = await lastBudgetRead(pool, SOURCE);
  if (last !== null && env.now() - last < every) return `next read due ${new Date(last + every).toISOString()}`;
  return summary(await pullSeraBudgets({ pool, by: null, byAs: null, trigger: "scheduled" }));
}

/**
 * THE SECTION WAS OPENED (R19). Queues one read for the village when the
 * source is on and the last read is more than five minutes old, at most once
 * per five minutes in this process, by nobody. The caller never waits on it:
 * the read, when queued, is handed back for a suite to wait on.
 */
export async function onBudgetsOpened(pool: Pool): Promise<{ queued: boolean; why: string; read?: Promise<SeraBudgetRead> }> {
  const now = env.now();
  if (now - openedAt < OPEN_READ_GAP_MS) return { queued: false, why: "a read was queued under five minutes ago" };
  // Taken before the first await, so two opens in one moment queue one read.
  openedAt = now;
  if (env.lifecycle() === "off") return { queued: false, why: "the module is off" };
  if (!(await budgetSourceState(pool, SOURCE)).on) return { queued: false, why: "the source is off" };
  const last = await lastBudgetRead(pool, SOURCE);
  if (last !== null && now - last < OPEN_READ_GAP_MS) return { queued: false, why: "the last read is under five minutes old" };
  const read = pullSeraBudgets({ pool, by: null, byAs: null, trigger: "open" }).catch((e: unknown) => {
    const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code: string }).code) : "unknown";
    console.warn(`[saberra] the budget read the section's opening queued did not finish (${code})`);
    return blank("failed", READ_FAILED);
  });
  return { queued: true, why: "queued", read };
}
