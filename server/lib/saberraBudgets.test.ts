/**
 * THE SERA BUDGET PULLER, ON A REAL SCHEMA (budgets spec R15 to R20, PR 2).
 *
 * The service is a fake MCP client handed in through `configureSeraBudgets`;
 * the budget store, the import, the snapshot's stored match, the source's
 * switch, the sync rows and the named lock are all real. Each case pins one
 * promise of the puller:
 *
 *   reads      not offered, whole, cut short, empty, failed (R3, R16)
 *   refusals   every kind, counted, the last good version kept (R15)
 *   names      a lone first name held: stored, unadopted, out of the figure
 *   mapping    page ids through the stored match only (R17); categories
 *              through the table (R20); periods from dates (R6)
 *   reads      the lock, the schedule, the on-open throttle (R16, R19)
 *   switch     the re-check before every read, auto and review, the swing (R18)
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { budgetSourceState, cashBudgetLeft, configureBudgets, latestSyncs, resetBudgetEnv } from "./budgets";
import {
  MAX_BUDGET_PAGES,
  OPEN_READ_GAP_MS,
  SERA_BUDGETS_BUSY,
  SERA_BUDGETS_LOCK,
  SERA_REPORTS_NO_BUDGETS,
  configureSeraBudgets,
  onBudgetsOpened,
  pullSeraBudgets,
  resetSeraBudgets,
  scheduledSeraBudgets,
} from "./saberraBudgets";
import { SYNC_LOCK } from "./saberraSync";
import type { ToolInfo } from "./saberraClient";
import { withNamedLock } from "../repos/namedLock";
import { insertSnapshot } from "../repos/saberraSnapshots";
import { usersRepo } from "../repos/users";
import { createOrgRole } from "./orgChart";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import { VILLAGE_WIDE, moonPeriod } from "../../shared/budgets";

const configured = testDbConfigured();
const TZ = "America/Costa_Rica";
const MOON = LUNAR_CLOCK.boundsFor(new Date()).id;
const moon = moonPeriod(MOON, TZ)!;
const HOUR = 60 * 60 * 1000;

let db: TestDb;
let pool: mysql.Pool;

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows as any[];
}

const hex = (n: number) => n.toString(16).padStart(32, "0");
const CIRCLE_PAGE = hex(1);
const ROLE_PAGE = hex(2);
const NAMESAKE_PAGE = hex(3);
const STRANGER_PAGE = hex(9);

const listRecords = (kinds: string[]): ToolInfo[] => [{ name: "list_records", inputSchema: { type: "object", properties: { kind: { type: "string", enum: kinds }, limit: { type: "number" } } } }];

/** The fake service: its tools, its pages by cursor, a failure by cursor, and every call it was asked. */
const svc = {
  tools: listRecords(["circle", "role", "budget"]) as ToolInfo[] | null,
  pages: new Map<string, { records: unknown[]; next: string | null }>(),
  fail: new Map<string, { why: "refused" | "unreadable" | "vendor-error"; detail: string }>(),
  endless: false,
  session: "s-1" as string | null,
  preflight: true,
  lifecycle: "members",
  calls: [] as Array<Record<string, unknown>>,
  now: Date.now(),
};

/** The service answers these pages, in order. */
function serves(...pages: unknown[][]) {
  svc.pages = new Map(pages.map((records, i) => [i === 0 ? "first" : `p${i}`, { records, next: i < pages.length - 1 ? `p${i + 1}` : null }]));
}

const record = (n: number, over: Record<string, unknown> = {}) => ({
  id: hex(100 + n),
  periodStart: moon.startsOn,
  periodEnd: moon.endsOn,
  circle: null,
  role: null,
  category: "role_pay",
  label: `Line ${n}`,
  currency: "CRC",
  plannedMinor: 100_000,
  spentMinor: null,
  status: "approved",
  changedAt: "2026-11-08T10:00:00Z",
  ...over,
});

const press = () => pullSeraBudgets({ pool, by: "u-treasurer", byAs: "Treasury", trigger: "press" });
const lines = () => q("SELECT source_ref, label, status, planned_minor, circle_id, role_id, matched, category, source_label, period_kind, period_key, adopted_at, adopted_as, name_held, note, line_key FROM budget_lines ORDER BY source_ref");
const syncRows = () => q("SELECT source, ok, error, whole, `lines`, refused, `by`, by_as FROM budget_syncs ORDER BY id");
const sourceOn = (mode: "auto" | "review", setBy: string | null = "u-treasurer", schedule = "daily") =>
  q(
    "INSERT INTO budget_sources (source, `on`, mode, schedule, set_by, set_as, set_at) VALUES ('sera', 1, ?, ?, ?, 'Treasury', NOW()) ON DUPLICATE KEY UPDATE `on` = 1, mode = VALUES(mode), schedule = VALUES(schedule), set_by = VALUES(set_by), set_as = VALUES(set_as), off_reason = NULL",
    [mode, schedule, setBy],
  );

describe.skipIf(!configured)("the Sera budget puller", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await usersRepo(pool).add({ id: "u-wren", name: "Wren Halloway", handle: "wrenh", email: "wren@example.test", passwordHash: "x", paths: [] } as any);
    await usersRepo(pool).add({ id: "u-ana", name: "Anabel Quintero", email: "anabel@example.test", passwordHash: "x", paths: [] } as any);
    await q("INSERT INTO circles (id, name) VALUES ('c-garden', 'Garden'), ('c-kitchen', 'Kitchen')");
    await q("INSERT INTO circles (id, name, layer) VALUES ('c-village', 'The Village', 'link')");
    await createOrgRole(pool, { id: "r-gardener", name: "Gardener", circleId: "c-garden", seats: 1 });
    // The newest structure read, with the match it stored for each record (#989).
    await insertSnapshot(pool, new Date(), {
      trigger: "by-hand",
      circles: {
        read: "whole",
        records: [
          { id: CIRCLE_PAGE, fields: { "Circle Name": "Garden" }, match: { ourId: "c-garden", via: "pageId" } },
          // Sera's own circle that happens to share our circle's name, matched to nothing: never a match here.
          { id: NAMESAKE_PAGE, fields: { "Circle Name": "Kitchen" }, match: null },
        ],
      },
      roles: { read: "whole", records: [{ id: ROLE_PAGE, fields: { "Role Name": "Gardener" }, match: { ourId: "r-gardener", via: "pageId" } }] },
    });
  }, 180_000);

  afterAll(async () => {
    resetBudgetEnv();
    resetSeraBudgets();
    await pool?.end();
    await db?.drop?.();
  });

  beforeEach(async () => {
    for (const t of ["budget_lines", "budget_syncs", "budget_sources", "health_events"]) await q(`DELETE FROM \`${t}\``);
    resetBudgetEnv();
    configureBudgets({
      currency: () => "CRC",
      timezone: () => TZ,
      seasons: () => [],
      currentMoonId: () => MOON,
      rolePayHolders: async () => ["u-treasurer"],
    });
    Object.assign(svc, { tools: listRecords(["circle", "role", "budget"]), fail: new Map(), endless: false, session: "s-1", preflight: true, lifecycle: "members", calls: [], now: Date.now() });
    serves([]);
    resetSeraBudgets();
    configureSeraBudgets({
      lifecycle: () => svc.lifecycle,
      preflight: () =>
        svc.preflight
          ? { ok: true, client: { baseUrl: "https://sera.example.test/mcp", token: "t0ken", fetchImpl: (async () => new Response("")) as never } }
          : { ok: false, gap: "no-key", body: { error: "This village has no key for the service yet.", state: "not-connected" } },
      openSession: async () => svc.session,
      listTools: async () => (svc.tools ? { ok: true, tools: svc.tools } : { ok: false, why: "unreadable", detail: "the result was empty" }),
      callToolJson: async (_c, _s, tool, args) => {
        svc.calls.push({ tool, ...args });
        const at = typeof args.cursor === "string" ? args.cursor : "first";
        const failure = svc.fail.get(at);
        if (failure) return { ok: false, ...failure };
        if (svc.endless) return { ok: true, value: { results: [record(svc.calls.length)], has_more: true, next_cursor: `p${svc.calls.length}` } };
        const page = svc.pages.get(at) ?? { records: [], next: null };
        return { ok: true, value: { results: page.records, has_more: page.next !== null, next_cursor: page.next } };
      },
      clock: () => LUNAR_CLOCK,
      now: () => svc.now,
    });
  });

  // ── Reads: not offered, whole, cut short, empty, failed (R3, R16) ──────────

  it("answers the named state 'Sera does not report budgets yet' when the service offers no budget kind, and records it as a read that did not land", async () => {
    svc.tools = listRecords(["circle", "role", "role_assignment"]);
    serves([record(1)]);
    const r = await press();
    expect(r).toMatchObject({ ok: false, state: "not_offered", message: SERA_REPORTS_NO_BUDGETS, whole: false, records: 0 });
    expect(svc.calls, "nothing is asked for a kind the service does not offer").toEqual([]);
    expect(await lines()).toEqual([]);
    expect(await syncRows()).toEqual([{ source: "sera", ok: 0, error: SERA_REPORTS_NO_BUDGETS, whole: 0, lines: 0, refused: 0, by: "u-treasurer", by_as: "Treasury" }]);
    expect(await latestSyncs(pool), "a read that did not land is no 'last synced'").toEqual([]);
  });

  it("pages to the end under the kind's own argument, lands a whole read, and a whole read that stops listing a line withdraws it", async () => {
    serves([record(1)], [record(2)]);
    const r = await press();
    expect(r).toMatchObject({ ok: true, state: "whole", whole: true, records: 2, refused: 0 });
    expect(svc.calls).toEqual([
      { tool: "list_records", kind: "budget", limit: 100 },
      { tool: "list_records", kind: "budget", limit: 100, cursor: "p1" },
    ]);
    expect((await lines()).map((l) => [l.label, l.status])).toEqual([["Line 1", "approved"], ["Line 2", "approved"]]);
    expect(await syncRows()).toEqual([expect.objectContaining({ ok: 1, whole: 1, lines: 2 })]);

    serves([record(1)]);
    const again = await press();
    expect(again.result?.withdrawn).toEqual(["Line 2"]);
    expect((await lines()).map((l) => [l.label, l.status])).toEqual([["Line 1", "approved"], ["Line 2", "withdrawn"]]);
  });

  it("stops at the page cap, and a read cut short there is not whole and withdraws nothing", async () => {
    serves([record(1)], [record(2)]);
    await press();
    svc.endless = true;
    svc.calls = [];
    const r = await press();
    expect(svc.calls).toHaveLength(MAX_BUDGET_PAGES);
    expect(r).toMatchObject({ ok: true, state: "cut_short", whole: false });
    expect(r.result?.withdrawn).toEqual([]);
    expect((await lines()).filter((l) => l.status === "withdrawn")).toEqual([]);
    expect((await syncRows()).pop()).toMatchObject({ ok: 1, whole: 0 });
  });

  it("treats an empty answer as not whole: it lands nothing and withdraws nothing", async () => {
    serves([record(1)]);
    await press();
    serves([]);
    const r = await press();
    expect(r).toMatchObject({ state: "empty", whole: false, records: 0 });
    expect((await lines()).map((l) => l.status)).toEqual(["approved"]);
    expect((await syncRows()).pop()).toMatchObject({ ok: 1, whole: 0, lines: 0 });
  });

  it("writes nothing from a read that failed part way, withdraws nothing, and records why in its own words, never the service's", async () => {
    serves([record(1)], [record(2)]);
    await press();
    serves([record(1, { plannedMinor: 999 })], [record(2)]);
    svc.fail.set("p1", { why: "vendor-error", detail: "Wren Halloway (wren@example.test) is not allowed" });
    const r = await press();
    expect(r).toMatchObject({ ok: false, state: "failed", whole: false });
    expect((await lines()).map((l) => [l.label, l.status, l.planned_minor])).toEqual([["Line 1", "approved", 100_000], ["Line 2", "approved", 100_000]]);
    const row = (await syncRows()).pop();
    expect(row).toMatchObject({ ok: 0, whole: 0 });
    expect(row.error).toContain("vendor-error");
    expect(row.error).not.toMatch(/Wren|example\.test/);
    expect(r.message).not.toMatch(/Wren|example\.test/);
  });

  it("names a service that opened no session, listed no tools, or has no key as a read that did not run, and calls nothing more", async () => {
    svc.session = null;
    expect(await press()).toMatchObject({ ok: false, state: "failed" });
    svc.session = "s-1";
    svc.tools = null;
    expect(await press()).toMatchObject({ ok: false, state: "failed" });
    svc.preflight = false;
    expect(await press()).toMatchObject({ ok: false, state: "not_connected", message: "This village has no key for the service yet." });
    expect(svc.calls).toEqual([]);
    expect((await syncRows()).map((s) => s.ok)).toEqual([0, 0, 0]);
  });

  it("reads nothing and writes nothing while the module is off", async () => {
    svc.lifecycle = "off";
    serves([record(1)]);
    expect(await press()).toMatchObject({ ok: false, state: "module_off" });
    expect(svc.calls).toEqual([]);
    expect(await syncRows()).toEqual([]);
  });

  // ── Refusals and names (R15) ───────────────────────────────────────────────

  it("refuses and counts every kind of bad record, keeps each refused line's last good version, and withdraws nothing while any is refused", async () => {
    serves([record(1), record(2), record(3)]);
    await press();
    serves([
      record(1, { plannedMinor: 1500.5 }),
      record(2, { plannedMinor: -10 }),
      record(4, { currency: "XYZ" }),
      record(5, { id: `https://sera.example.test/Pay-${hex(105)}` }),
      record(6, { label: "Pay Wren Halloway" }),
      record(7, { label: "Ask @wrenh" }),
      record(8, { label: "Invoice to wren@example.test" }),
      record(9, { status: "cancelled" }),
      record(10, { circle: "Land & Ecology" }),
      record(11),
    ]);
    const r = await press();
    expect(r).toMatchObject({ ok: true, records: 10, refused: 9 });
    expect(r.result!.refused.map((x) => x.reason).sort()).toEqual(
      ["fractional", "name_email", "name_full_name", "name_handle", "negative", "not_an_id", "not_an_id", "status", "unknown_currency"].sort(),
    );
    expect(r.result!.flags.filter((f) => f.kind === "kept_last_good")).toHaveLength(2);
    expect(r.result!.withdrawn, "line 3 is not listed, and a read with a refused record withdraws nothing").toEqual([]);
    expect(r.result!.withdrawSkipped).toBe("refused_rows");
    expect((await lines()).map((l) => [l.label, l.status, l.planned_minor])).toEqual([
      ["Line 1", "approved", 100_000],
      ["Line 2", "approved", 100_000],
      ["Line 3", "approved", 100_000],
      ["Line 11", "approved", 100_000],
    ]);
    expect((await syncRows()).pop()).toMatchObject({ ok: 1, refused: 9 });
  });

  it("holds a line whose label carries a lone first name: stored, unadopted even in auto mode, and out of the figure", async () => {
    await sourceOn("auto");
    serves([record(1, { label: "Anabel's crew" }), record(2, { label: "Garden crew", plannedMinor: 40_000 })]);
    const r = await press();
    expect(r).toMatchObject({ ok: true, refused: 0 });
    const held = (await lines()).find((l) => l.label === "Anabel's crew");
    expect(held).toMatchObject({ name_held: 1, adopted_at: null });
    expect((await cashBudgetLeft(pool, MOON))!.plannedMinor, "only the clean line counts").toBe(40_000);
  });

  it("drops every field the contract does not name before anything is stored, and keeps Sera's id, never a link, as the source ref", async () => {
    serves([record(1, { id: `Garden-Pay-${hex(77)}`, holderName: "Wren Halloway", notes: "ask Wren", url: "https://sera.example.test/Garden-Pay" })]);
    const r = await press();
    expect(r.dropped).toEqual(["holderName", "notes", "url"]);
    const [line] = await lines();
    expect(line).toMatchObject({ source_ref: hex(77), line_key: `sera:${hex(77)}`, note: null, label: "Line 1" });
    expect(JSON.stringify(line)).not.toMatch(/Wren|https/);
  });

  // ── Mapping (R6, R17, R20) ─────────────────────────────────────────────────

  it("maps page ids through the snapshot's stored match only: matched, role-only, unmatched, and a namesake of our circle never matches", async () => {
    await sourceOn("auto");
    serves([
      record(1, { circle: CIRCLE_PAGE, plannedMinor: 10_000 }),
      record(2, { role: ROLE_PAGE, plannedMinor: 20_000 }),
      record(3, { circle: STRANGER_PAGE, plannedMinor: 40_000 }),
      record(4, { circle: NAMESAKE_PAGE, plannedMinor: 80_000 }),
      record(5, { plannedMinor: 160_000 }),
    ]);
    await press();
    expect((await lines()).map((l) => [l.label, l.circle_id, l.role_id, l.matched])).toEqual([
      ["Line 1", "c-garden", null, 1],
      ["Line 2", "c-garden", "r-gardener", 1],
      ["Line 3", null, null, 0],
      ["Line 4", null, null, 0],
      // A line naming no circle is village-wide, on the fixed marker (R34).
      ["Line 5", VILLAGE_WIDE, null, 1],
    ]);
    expect((await cashBudgetLeft(pool, MOON))!.plannedMinor, "the unmatched lines never count").toBe(190_000);
  });

  it("maps categories through the fixed table, an unknown label to other with Sera's words kept as the source label", async () => {
    serves([record(1, { category: "Stipends" }), record(2, { category: "Travel" }), record(3, { category: "materials" })]);
    await press();
    expect((await lines()).map((l) => [l.label, l.category, l.source_label])).toEqual([
      ["Line 1", "role_pay", null],
      ["Line 2", "other", "Travel"],
      ["Line 3", "materials", null],
    ]);
  });

  it("names each line's period from its two dates in the village's zone: the moon, a whole month, a span", async () => {
    serves([record(1), record(2, { periodStart: "2026-12-01", periodEnd: "2026-12-31" }), record(3, { periodStart: moon.startsOn, periodEnd: moon.startsOn })]);
    await press();
    expect((await lines()).map((l) => [l.label, l.period_kind, l.period_key])).toEqual([
      ["Line 1", "moon", MOON],
      ["Line 2", "month", "2026-12"],
      ["Line 3", "span", `${moon.startsOn}..${moon.startsOn}`],
    ]);
  });

  // ── The switch: auto, review, the re-check, the swing (R18) ────────────────

  it("counts a synced line at once in auto mode, as the holder's standing act, and stores it waiting in review mode", async () => {
    await sourceOn("auto");
    serves([record(1)]);
    await press();
    expect((await lines())[0]).toMatchObject({ adopted_as: "standing: Treasury", adopted_at: expect.any(Date) });
    expect((await cashBudgetLeft(pool, MOON))!.plannedMinor).toBe(100_000);

    await sourceOn("review");
    serves([record(1), record(2)]);
    await press();
    expect((await lines()).map((l) => [l.label, l.adopted_at === null])).toEqual([["Line 1", false], ["Line 2", true]]);
    expect((await cashBudgetLeft(pool, MOON))!.plannedMinor, "the waiting line does not count").toBe(100_000);
  });

  it("reports a changed line's swing, past 20%, keeps the amount before, and in auto mode counts the new amount at once", async () => {
    await sourceOn("auto");
    serves([record(1), record(2, { plannedMinor: 1_000_000 })]);
    await press();
    serves([record(1, { plannedMinor: 150_000 }), record(2, { plannedMinor: 1_000_000 })]);
    const r = await press();
    expect(r.result!.lineChanges).toEqual([expect.objectContaining({ label: "Line 1", prevMinor: 100_000, nextMinor: 150_000, pct: 50, swing: true })]);
    expect(r.result!.swing).toBe(true);
    expect((await q("SELECT prev_planned_minor FROM budget_lines WHERE label = 'Line 1'"))[0].prev_planned_minor).toBe(100_000);
    expect((await cashBudgetLeft(pool, MOON))!.plannedMinor).toBe(1_150_000);
  });

  it("re-checks the switch before every read: a setter who lost the power turns the source off, a press still stores what it read waiting, and the schedule then reads nothing", async () => {
    await sourceOn("auto", "u-gone");
    serves([record(1)]);
    const r = await press();
    expect(r).toMatchObject({ ok: true, turnedOff: true });
    expect(await budgetSourceState(pool, "sera")).toMatchObject({ on: false, offReason: expect.stringContaining("no longer holds") });
    expect((await lines())[0]).toMatchObject({ adopted_at: null });
    expect(await cashBudgetLeft(pool, MOON)).toBeNull();
    svc.calls = [];
    svc.now = Date.now() + 48 * HOUR;
    expect(await scheduledSeraBudgets(pool)).toContain("off");
    expect(svc.calls).toEqual([]);
  });

  // ── The lock, the schedule, the on-open read (R16, R19) ────────────────────

  it("takes its own lock: a press while a budget read runs hears a budgets sentence, and the structure sync's lock never stops it", async () => {
    serves([record(1)]);
    const busy = await withNamedLock(pool, SERA_BUDGETS_LOCK, () => press());
    expect(busy.ran && busy.value).toMatchObject({ ok: false, state: "busy", message: SERA_BUDGETS_BUSY });
    expect(svc.calls).toEqual([]);
    const beside = await withNamedLock(pool, SYNC_LOCK, () => press());
    expect(beside.ran && beside.value).toMatchObject({ ok: true, state: "whole" });
  });

  it("reads on the source's own schedule only while it is on: daily by default, hourly, and never when off", async () => {
    serves([record(1)]);
    expect(await scheduledSeraBudgets(pool), "a source never turned on is never read").toContain("off");
    await sourceOn("auto");
    expect(await scheduledSeraBudgets(pool), "never read yet: due now").toMatch(/^whole/);
    svc.now = Date.now() + 2 * HOUR;
    expect(await scheduledSeraBudgets(pool), "daily: two hours on is not due").toMatch(/^next read due/);
    svc.now = Date.now() + 25 * HOUR;
    expect(await scheduledSeraBudgets(pool), "daily: a day on is due").toMatch(/^whole/);

    await sourceOn("auto", "u-treasurer", "hourly");
    svc.now = Date.now() + 30 * 60 * 1000;
    expect(await scheduledSeraBudgets(pool)).toMatch(/^next read due/);
    svc.now = Date.now() + 61 * 60 * 1000;
    expect(await scheduledSeraBudgets(pool)).toMatch(/^whole/);

    await sourceOn("auto", "u-treasurer", "off");
    svc.calls = [];
    svc.now = Date.now() + 30 * 24 * HOUR;
    expect(await scheduledSeraBudgets(pool)).toContain("schedule is off");
    expect(svc.calls).toEqual([]);
    // The schedule's reads are the village's, by nobody.
    expect((await syncRows()).every((s) => s.by === null && s.by_as === null)).toBe(true);
  });

  it("queues one read when the section opens and the last read is over five minutes old, at most once per five minutes, by nobody, and only for a source that is on", async () => {
    serves([record(1)]);
    expect(await onBudgetsOpened(pool), "a source that is off is never read on open").toMatchObject({ queued: false });
    await sourceOn("auto");
    svc.now = Date.now() + 10 * 60 * 1000;
    const first = await onBudgetsOpened(pool);
    expect(first.queued).toBe(true);
    expect(await first.read).toMatchObject({ ok: true, state: "whole" });
    expect((await syncRows()).pop()).toMatchObject({ by: null, by_as: null, ok: 1 });

    svc.now += 60 * 1000;
    expect(await onBudgetsOpened(pool), "a minute later: throttled").toMatchObject({ queued: false });
    svc.now += OPEN_READ_GAP_MS;
    const later = await onBudgetsOpened(pool);
    expect(later.queued).toBe(true);
    await later.read;

    // A press a moment ago is a read too: opening the section reads nothing more.
    await press();
    svc.now = Date.now() + 60 * 1000;
    resetSeraBudgets({ keepEnv: true });
    expect(await onBudgetsOpened(pool), "the last read, from any door, is under five minutes old").toMatchObject({ queued: false });

    svc.lifecycle = "off";
    svc.now = Date.now() + 60 * 60 * 1000;
    expect(await onBudgetsOpened(pool), "never while the module is off").toMatchObject({ queued: false });
  });
});
