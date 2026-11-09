/**
 * THE CASH BUDGET'S ONE WRITE PATH AND ITS FIGURE, ON A REAL SCHEMA (0347).
 *
 *   importBudgetLines   the binding preview and its 409 (R14), the key and
 *                       its duplicates (R2), withdrawal by scope (R3), a hand
 *                       edit that the next upload leaves alone (R2), names
 *                       (R15), formula cells (R13), amounts (R12), one
 *                       `budget_syncs` row for every import made (R5), the events (R10,
 *                       R25), and the library's own withdrawal and adoption
 *                       rules the puller will lean on (R3, R18)
 *   cashBudgetLeft      null and 0 apart, committed by cycle and by `owed_at`,
 *                       allowances to materials, precedence, pro-rating, one
 *                       currency, and the injected reader for cash set this
 *                       moon with no row yet (R6 to R8)
 *
 * The pure planner and the key decode run with no database at the bottom.
 * Runs against a scratch schema with every real migration applied. No
 * TEST_DATABASE_URL and the database cases skip (harness rule).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import {
  SHARE_MOVED_EVENT,
  budgetLineKey,
  cashBudgetLeft,
  configureBudgets,
  decodeRoleKey,
  importBudgetLines,
  latestSyncs,
  registerBudgetSource,
  budgetSource,
  budgetRateDrift,
  resetBudgetEnv,
  type ImportInput,
  type ImportRow,
} from "./budgets";
import { cashKeys, moonLineCashKey } from "./cashOwed";
import { insertCashOwedRow } from "../repos/cashOwed";
import { usersRepo } from "../repos/users";
import { createOrgRole } from "./orgChart";
import { LUNAR_CLOCK, boundsForNumber, parseId } from "../../shared/cycleClock";
import { convertAtRate, moonPeriod } from "../../shared/budgets";

const configured = testDbConfigured();
const TZ = "America/Costa_Rica";
const NOW = LUNAR_CLOCK.boundsFor(new Date());
const MOON = NOW.id;
const PREV = LUNAR_CLOCK.boundsFor(new Date(NOW.startsAt.getTime() - 86_400_000)).id;
const moon = moonPeriod(MOON, TZ)!;
const EN = { locale: "en", chosen: true };

let db: TestDb;
let pool: mysql.Pool;

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows as any[];
}

const upload = (lines: ImportRow[], over: Partial<ImportInput> = {}) =>
  importBudgetLines(pool, { source: "upload", lines, by: "u-treasurer", byAs: "Treasury", dryRun: true, format: EN, ...over });

/** Preview, then confirm exactly that preview. */
async function confirm(input: Omit<Partial<ImportInput>, "lines"> & { lines: ImportRow[] }) {
  const base: ImportInput = { source: "upload", by: "u-treasurer", byAs: "Treasury", dryRun: true, format: EN, ...input };
  const p = await importBudgetLines(pool, base);
  return importBudgetLines(pool, { ...base, dryRun: false, revision: p.revision });
}

const lines = async () => q("SELECT id, label, source, status, planned_minor, period_kind, period_key, circle_id, role_id, changed_by, changed_as, adopted_at FROM budget_lines ORDER BY label");

const row = (over: ImportRow = {}): ImportRow => ({ period: MOON, category: "role_pay", label: "Garden crew pay", planned: "100,000", ...over });

describe.skipIf(!configured)("the one write path and the moon's figure", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await usersRepo(pool).add({ id: "u-wren", name: "Wren Halloway", handle: "wrenh", email: "wren@example.test", passwordHash: "x", paths: [] } as any);
    await usersRepo(pool).add({ id: "u-ana", name: "Anabel Quintero", email: "anabel@example.test", passwordHash: "x", paths: [] } as any);
    await q("INSERT INTO circles (id, name) VALUES ('c-garden', 'Garden'), ('c-kitchen', 'Kitchen'), ('c-twin-1', 'Twins'), ('c-twin-2', 'Twins')");
    await createOrgRole(pool, { id: "r-gardener", name: "Gardener", circleId: "c-garden", seats: 1 });
    await createOrgRole(pool, { id: "r-cook", name: "Cook", circleId: "c-kitchen", seats: 1 });
  }, 180_000);

  afterAll(async () => {
    resetBudgetEnv();
    await pool?.end();
    await db?.drop?.();
  });

  beforeEach(async () => {
    for (const t of ["budget_lines", "budget_syncs", "cash_owed", "health_events", "fx_rates"]) await q(`DELETE FROM \`${t}\``);
    resetBudgetEnv();
    configureBudgets({
      currency: () => "CRC",
      timezone: () => TZ,
      seasons: () => [{ id: "season-x", startsOn: moon.startsOn, endsOn: "2099-01-01" }],
      currentMoonId: () => MOON,
    });
  });

  // ── Events (R10, R25), first, so no earlier test's events can land late ──

  it("records an audit line per write with fixed text, and one members-visible line when the share moves", async () => {
    const r = await confirm({ lines: [row()] });
    expect(r.shareBefore).toMatchObject({ moonId: MOON, set: false });
    expect(r.shareAfter).toMatchObject({ moonId: MOON, set: true, leftMinor: 10_000_000 });
    await vi.waitFor(async () => expect((await q("SELECT COUNT(*) AS n FROM health_events"))[0].n).toBe(2), { timeout: 3000 });
    const events = await q("SELECT kind, text, audience, entity_type, entity_ref FROM health_events ORDER BY kind");
    expect(events).toEqual([
      { kind: "audit", text: `budget:added:${r.lineIds[0]}`, audience: "admin", entity_type: "budget_line", entity_ref: r.lineIds[0] },
      { kind: "budget", text: SHARE_MOVED_EVENT, audience: "public", entity_type: "budget", entity_ref: MOON },
    ]);
    // A write that leaves the share where it was records no public line.
    await confirm({ lines: [row({ label: "Tools", category: "materials", planned: "1,000" })] });
    await vi.waitFor(async () => expect((await q("SELECT COUNT(*) AS n FROM health_events"))[0].n).toBe(3), { timeout: 3000 });
    expect((await q("SELECT COUNT(*) AS n FROM health_events WHERE audience = 'public'"))[0].n).toBe(1);
  });

  // ── The binding preview (R14) ─────────────────────────────────────────────

  it("previews without writing, and confirms only the preview the person read", async () => {
    const p = await upload([row(), row({ label: "Quest pay", category: "quest_pay", planned: "20,000" })]);
    expect(p).toMatchObject({ ok: true, status: 200, written: false });
    expect(p.added.map((a) => [a.label, a.plannedMinor, a.plannedCell])).toEqual([["Garden crew pay", 10_000_000, "100,000"], ["Quest pay", 2_000_000, "20,000"]]);
    expect(await lines(), "a preview writes nothing").toEqual([]);

    const wrong = await upload([row(), row({ label: "Quest pay", category: "quest_pay", planned: "20,000" })], { dryRun: false, revision: "not-the-preview" });
    expect(wrong).toMatchObject({ ok: false, status: 409, code: "stale", written: false });
    expect(wrong.revision, "the 409 carries the fresh preview").toBe(p.revision);
    expect(await lines()).toEqual([]);

    const done = await upload([row(), row({ label: "Quest pay", category: "quest_pay", planned: "20,000" })], { dryRun: false, revision: p.revision });
    expect(done).toMatchObject({ ok: true, written: true });
    expect((await lines()).map((l) => [l.label, l.source, l.status, Number(l.planned_minor), l.changed_by, l.changed_as])).toEqual([
      ["Garden crew pay", "upload", "approved", 10_000_000, "u-treasurer", "Treasury"],
      ["Quest pay", "upload", "approved", 2_000_000, "u-treasurer", "Treasury"],
    ]);
    // R5: one row per import, the refused confirm included.
    const syncs = await q("SELECT source, `by`, by_as, ok, error, added, `lines` FROM budget_syncs ORDER BY ok");
    expect(syncs).toEqual([
      { source: "upload", by: "u-treasurer", by_as: "Treasury", ok: 0, error: "stale", added: 0, lines: 2 },
      { source: "upload", by: "u-treasurer", by_as: "Treasury", ok: 1, error: null, added: 2, lines: 2 },
    ]);
    expect((await latestSyncs(pool)).map((s) => [s.source, s.ok])).toEqual([["upload", true]]);
  });

  it("answers 409 with a fresh preview when the budget moved after the preview, and writes nothing", async () => {
    const p = await upload([row()]);
    await confirm({ source: "manual", lines: [row({ label: "Tools", category: "materials", planned: "5,000" })] });
    const late = await upload([row()], { dryRun: false, revision: p.revision });
    expect(late).toMatchObject({ ok: false, status: 409, code: "stale" });
    expect(late.revision).not.toBe(p.revision);
    expect(late.added.map((a) => a.label), "the fresh preview still says what it would do").toEqual(["Garden crew pay"]);
    expect((await lines()).map((l) => l.label)).toEqual(["Tools"]);
    // Confirming the fresh one works.
    expect(await upload([row()], { dryRun: false, revision: late.revision })).toMatchObject({ ok: true, written: true });
  });

  it("refuses a confirm that names no preview at all", async () => {
    const r = await upload([row()], { dryRun: false });
    expect(r).toMatchObject({ ok: false, status: 400, code: "revision_required" });
    expect(await lines()).toEqual([]);
  });

  // ── The key, duplicates and upserts (R2) ──────────────────────────────────

  it("upserts on the line key: the same sheet again changes nothing, a new amount is a change", async () => {
    await confirm({ lines: [row()] });
    const again = await upload([row()]);
    expect(again).toMatchObject({ added: [], changed: [], unchanged: 1 });
    const more = await upload([row({ planned: "120,000" })]);
    expect(more.changed.map((c) => [c.op, c.before.plannedMinor, c.plannedMinor])).toEqual([["change", 10_000_000, 12_000_000]]);
    // The label is folded for the key: case and spacing land on the same line, as a change to its words.
    const recased = await upload([row({ label: "  GARDEN crew pay " })]);
    expect(recased.added).toEqual([]);
    expect(recased.changed.map((c) => [c.before.label, c.label])).toEqual([["Garden crew pay", "GARDEN crew pay"]]);
  });

  it("refuses every row that shares a key with another row of the same import, by row", async () => {
    const r = await upload([row(), row({ label: "garden crew pay", planned: "5,000" }), row({ label: "Other", category: "other" })]);
    expect(r.refused.map((x) => [x.row, x.reason])).toEqual([[1, "duplicate"], [2, "duplicate"]]);
    expect(r.refused[0].message).toContain("row 2");
    expect(r.added.map((a) => a.label)).toEqual(["Other"]);
  });

  // ── Withdrawal (R3) ───────────────────────────────────────────────────────

  it("withdraws by name only what a whole-budget upload's scope no longer lists, and nothing on add-and-change-only", async () => {
    await confirm({
      lines: [
        row({ label: "Garden crew pay" }),
        row({ label: "Kitchen pay", circle: "Kitchen" }),
        row({ label: "Next month", period: "2099-01" }),
        row({ label: "Village quests", category: "quest_pay", planned: "1,000" }),
      ],
    });
    // Add and change only (the default): nothing unlisted is withdrawn.
    expect((await upload([row({ label: "Garden crew pay" })])).withdrawn).toEqual([]);
    // The whole budget for this moon's village-wide lines: Village quests goes, by name.
    const whole = await upload([row({ label: "Garden crew pay" })], { scope: { whole: true } });
    expect(whole.withdrawn).toEqual(["Village quests"]);
    // A named scope reaches the Kitchen's lines too, and never another period.
    const named = await upload([row({ label: "Garden crew pay" })], { scope: { whole: true, periods: [MOON], circles: [null, "Kitchen"] } });
    expect(named.withdrawn.sort()).toEqual(["Kitchen pay", "Village quests"]);
    // A scope with any refused row withdraws nothing.
    const refused = await upload([row({ label: "Garden crew pay" }), row({ label: "Bad", planned: "=1+1" })], { scope: { whole: true } });
    expect(refused.refused.map((x) => x.reason)).toEqual(["formula"]);
    expect(refused).toMatchObject({ withdrawn: [], withdrawSkipped: "refused_rows" });

    await upload([row({ label: "Garden crew pay" })], { scope: { whole: true }, dryRun: false, revision: whole.revision });
    expect((await lines()).map((l) => [l.label, l.status])).toEqual([
      ["Garden crew pay", "approved"],
      ["Kitchen pay", "approved"],
      ["Next month", "approved"],
      ["Village quests", "withdrawn"],
    ]);
  });

  it("withdraws and restores one line by id, never deletes it, and never touches a closed moon's line", async () => {
    await confirm({ lines: [row()] });
    const [{ id }] = await lines();
    expect((await confirm({ source: "manual", lines: [{ id, action: "withdraw" }] })).changed.map((c) => c.op)).toEqual(["withdraw"]);
    expect((await lines())[0].status).toBe("withdrawn");
    expect((await confirm({ source: "manual", lines: [{ id, action: "restore" }] })).changed.map((c) => c.op)).toEqual(["restore"]);
    expect((await lines())[0].status).toBe("approved");
    await q("UPDATE budget_lines SET status = 'closed' WHERE id = ?", [id]);
    const closed = await upload([{ id, action: "withdraw" }], { source: "manual" });
    expect(closed.refused.map((r) => r.reason)).toEqual(["closed"]);
    expect((await upload([{ id, planned: "1" }], { source: "manual" })).refused.map((r) => r.reason)).toEqual(["closed"]);
  });

  it("turns a hand-edited upload line into a hand line, says so, and the next upload of the sheet leaves it alone", async () => {
    await confirm({ lines: [row()] });
    const [{ id }] = await lines();
    const edit = await upload([{ id, planned: "90,000" }], { source: "manual" });
    expect(edit.flags.map((f) => f.kind)).toEqual(["becomes_manual"]);
    expect(edit.changed[0]).toMatchObject({ op: "change", becomesManual: true, plannedMinor: 9_000_000 });
    await upload([{ id, planned: "90,000" }], { source: "manual", dryRun: false, revision: edit.revision });
    expect((await lines()).map((l) => [l.source, Number(l.planned_minor)])).toEqual([["manual", 9_000_000]]);
    const reupload = await upload([row()], { scope: { whole: true } });
    expect(reupload).toMatchObject({ added: [], changed: [], withdrawn: [] });
    expect(reupload.kept.map((k) => k.id)).toEqual([id]);
  });

  // ── Cells, amounts and names (R12, R13, R15) ──────────────────────────────

  it("reads amounts under the chosen format, and refuses the ambiguous cell until a format is chosen", async () => {
    const unchosen = await upload([row({ planned: "1,234" })], { format: { locale: "en", chosen: false } });
    expect(unchosen.refused.map((r) => [r.cell, r.reason])).toEqual([["planned", "ambiguous"]]);
    const es = await upload([row({ planned: "1.234,50" })], { format: { locale: "es", chosen: true } });
    expect(es.added[0]).toMatchObject({ plannedMinor: 123_450, plannedCell: "1.234,50" });
    const negative = await upload([row({ planned: "\u22125" }), row({ label: "Precise", planned: "1.005" })]);
    expect(negative.refused.map((r) => r.reason)).toEqual(["negative", "too_precise"]);
  });

  it("keeps a formula in a label as text and flags it, and refuses one in an amount", async () => {
    const r = await upload([row({ label: "=HYPERLINK(\"x\")" }), row({ label: "Tools", planned: "=SUM(A1:A3)" })]);
    expect(r.added.map((a) => a.label)).toEqual(["=HYPERLINK(\"x\")"]);
    expect(r.flags.map((f) => [f.row, f.cell, f.kind])).toEqual([[1, "label", "formula"]]);
    expect(r.refused.map((x) => [x.row, x.cell, x.reason])).toEqual([[2, "planned", "formula"]]);
  });

  it("refuses a full name, a handle and an email in a label or note, and holds a lone first name until it is reworded", async () => {
    const r = await upload([
      row({ label: "Pay for Wren Halloway" }),
      row({ label: "Ask @wrenh", category: "other" }),
      row({ label: "Tools", category: "materials", note: "Invoice to wren@example.test" }),
      row({ label: "Seeds", category: "materials", note: "Anabel will buy them" }),
      row({ label: "Clean line", category: "quest_pay" }),
    ]);
    expect(r.refused.map((x) => [x.row, x.cell, x.reason])).toEqual([[1, "label", "name_full_name"], [2, "label", "name_handle"], [3, "note", "name_email"]]);
    expect(r.held.map((h) => [h.row, h.cell])).toEqual([[4, "note"]]);
    expect(r.added.map((a) => a.label)).toEqual(["Clean line"]);
    const p = await upload([row({ label: "Seeds", category: "materials", note: "Anabel will buy them" })]);
    const confirmHeld = await upload([row({ label: "Seeds", category: "materials", note: "Anabel will buy them" })], { dryRun: false, revision: p.revision });
    expect(confirmHeld).toMatchObject({ ok: false, status: 400, code: "names_held", written: false });
    expect(await lines()).toEqual([]);
  });

  it("matches a circle by id or exact name and a role within it, and refuses two matches or a role in another circle", async () => {
    const r = await upload([
      row({ label: "A", circle: "Garden", role: "Gardener" }),
      row({ label: "B", role: "r-cook" }),
      row({ label: "C", circle: "Twins" }),
      row({ label: "D", circle: "Garden", role: "Cook" }),
      row({ label: "E", circle: "Nowhere" }),
    ]);
    expect(r.added.map((a) => [a.label, a.circleId, a.roleId])).toEqual([["A", "c-garden", "r-gardener"], ["B", "c-kitchen", "r-cook"]]);
    expect(r.refused.map((x) => [x.row, x.cell])).toEqual([[3, "circle"], [4, "role"], [5, "circle"]]);
  });

  // ── The library's own rules, for the puller (R3, R18) ─────────────────────

  it("keeps a library line out until adopted, clears an adoption when the library changes it, and withdraws only what a whole read stops listing", async () => {
    const sera = (over: ImportRow = {}): ImportRow => ({ sourceRef: "rec-1", period: MOON, category: "role_pay", label: "Library pay", plannedMinor: 50_000, ...over });
    const read = (rows: ImportRow[], whole = true) => confirm({ source: "sera", by: null, byAs: null, scope: { whole }, lines: rows });
    await read([sera(), sera({ sourceRef: "rec-old", period: "2020-01", label: "Old" }), sera({ sourceRef: "rec-2", label: "Second" })]);
    expect(await cashBudgetLeft(pool, MOON), "nothing adopted, nothing counts").toBeNull();
    await q("UPDATE budget_lines SET adopted_at = NOW(), adopted_as = 'Treasury' WHERE source_ref = 'rec-1'");
    expect((await cashBudgetLeft(pool, MOON))!.plannedMinor).toBe(50_000);

    // The library changes the adopted amount: it stops counting until adopted again.
    const changed = await read([sera({ plannedMinor: 60_000 }), sera({ sourceRef: "rec-2", label: "Second" })]);
    expect(changed.flags.map((f) => f.kind)).toContain("adoption_cleared");
    expect(await cashBudgetLeft(pool, MOON)).toBeNull();
    // rec-old is older than anything this read sent, so it stays.
    expect((await lines()).map((l) => [l.label, l.status])).toEqual([["Library pay", "approved"], ["Old", "approved"], ["Second", "approved"]]);

    // A refused record counts as listed: its last good version stays, flagged.
    const refused = await importBudgetLines(pool, { source: "sera", by: null, byAs: null, dryRun: true, scope: { whole: true }, lines: [sera({ plannedMinor: 60_000 }), sera({ sourceRef: "rec-2", label: "Pay Wren Halloway" })] });
    expect(refused.refused.map((r) => r.reason)).toEqual(["name_full_name"]);
    expect(refused.flags.map((f) => f.kind)).toContain("kept_last_good");
    expect(refused.withdrawn).toEqual([]);

    // A whole read that drops rec-2 withdraws it.
    const dropped = await read([sera({ plannedMinor: 60_000 })]);
    expect(dropped.withdrawn).toEqual(["Second"]);
    // An empty read is never whole.
    expect((await importBudgetLines(pool, { source: "sera", by: null, byAs: null, dryRun: true, scope: { whole: true }, lines: [] })).withdrawSkipped).toBe("empty_read");
  });

  // ── The figure (R6 to R8) ─────────────────────────────────────────────────

  it("is null with no budget, and 0 left, never null, once the moon's commitments use it up", async () => {
    expect(await cashBudgetLeft(pool, MOON)).toBeNull();
    await confirm({ lines: [row({ category: "materials" })] });
    expect(await cashBudgetLeft(pool, MOON), "materials never make a figure").toBeNull();
    await confirm({ lines: [row({ planned: "500" })] });
    await insertCashOwedRow(pool, { id: "co-1", occurrenceKey: cashKeys.role(MOON, "seat-1", "u-ana"), userId: "u-ana", workKind: "role", workRef: "r-gardener", workTitle: "Gardener", amountMinor: 60_000, currency: "CRC" });
    const f = await cashBudgetLeft(pool, MOON);
    expect(f).toMatchObject({ plannedMinor: 50_000, committedMinor: 60_000, leftMinor: 0, currency: "CRC" });
    expect(await cashBudgetLeft(pool, MOON, { currency: () => "" }), "no village currency, nothing counts").toBeNull();
  });

  it("commits role rows by their decoded cycle, quest and proposal rows by owed_at, and allowances to materials", async () => {
    await confirm({ lines: [row({ planned: "10,000" })] });
    const owe = (id: string, key: string, kind: "role" | "quest" | "proposal", amount: number, currency = "CRC") =>
      insertCashOwedRow(pool, { id, occurrenceKey: key, userId: "u-ana", workKind: kind, workRef: "w", workTitle: "w", amountMinor: amount, currency });
    await owe("c-role", cashKeys.role(MOON, "seat-1", "u-ana"), "role", 1000);
    // Owed at Finance approval inside this moon, for LAST moon's work: it belongs to last moon.
    await owe("c-prev", cashKeys.role(PREV, "seat-1", "u-ana"), "role", 2000);
    await owe("c-allow", moonLineCashKey(MOON, { kind: "allowance", firstSeatId: "seat-1" }, "u-ana"), "role", 4000);
    await owe("c-quest", cashKeys.quest("claim-1"), "quest", 300);
    await owe("c-quest-old", cashKeys.quest("claim-2"), "quest", 700);
    await q("UPDATE cash_owed SET owed_at = ? WHERE id = 'c-quest-old'", [new Date(NOW.startsAt.getTime() - 3_600_000)]);
    await owe("c-prop", cashKeys.proposal("sub-1"), "proposal", 50);
    await owe("c-usd", cashKeys.quest("claim-3"), "quest", 9999, "USD");
    const f = (await cashBudgetLeft(pool, MOON))!;
    expect(f.working.committed).toEqual({ roleMinor: 1000, questMinor: 300, proposalMinor: 50, settingsMinor: 0, materialsMinor: 4000, otherCurrencyRows: 1 });
    expect(f.committedMinor).toBe(1350);
    expect(f.leftMinor).toBe(1_000_000 - 1350);
  });

  it("reads the injected reader for cash set this moon with no cash_owed row yet, and stubs it to 0", async () => {
    await confirm({ lines: [row({ planned: "10,000" })] });
    expect((await cashBudgetLeft(pool, MOON))!.working.committed.settingsMinor, "the stub answers 0 today").toBe(0);
    const asked: string[] = [];
    configureBudgets({ committedFromSettings: async (_db, moonId) => (asked.push(moonId), { minor: 7000 }) });
    const f = (await cashBudgetLeft(pool, MOON))!;
    expect(asked).toEqual([MOON]);
    expect(f.working.committed.settingsMinor).toBe(7000);
    expect(f.committedMinor).toBe(7000);
  });

  it("lets the village's own line drop the library's in its category and moon, and pro-rates a longer line by days", async () => {
    await confirm({ source: "sera", by: null, byAs: null, lines: [{ sourceRef: "rec-9", period: MOON, category: "role_pay", label: "Library", plannedMinor: 999_999 }] });
    await q("UPDATE budget_lines SET adopted_at = NOW() WHERE source = 'sera'");
    expect((await cashBudgetLeft(pool, MOON))!.plannedMinor).toBe(999_999);
    const span = `${moon.startsOn}..${new Date(Date.parse(`${moon.endsOn}T00:00:00Z`) + 9 * 86_400_000).toISOString().slice(0, 10)}`;
    await confirm({ source: "manual", lines: [row({ label: "Village pay", period: span, planned: "1,000" })] });
    const f = (await cashBudgetLeft(pool, MOON))!;
    const lineDays = moon.days + 9;
    expect(f.working.dropped.map((d) => d.by)).toEqual(["village_line"]);
    expect(f.working.lines).toHaveLength(1);
    expect(f.plannedMinor).toBe(Math.floor((100_000 * moon.days) / lineDays));
    expect(f.revision).toMatch(/^[0-9a-f]{32}$/);
  });

  // ── A rate a person locks (spec 5a, option b; R8) ─────────────────────────

  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  /** EUR-based rows, the shape the daily job stores: 1 EUR = 1.08 USD = 550.65 CRC. */
  const storeDaily = async (asOf: string, usd = 1.08, crc = 550.65) =>
    q("INSERT INTO fx_rates (quote, rate, as_of, source) VALUES ('USD', ?, ?, 'ecb'), ('CRC', ?, ?, 'ecb') ON DUPLICATE KEY UPDATE rate = VALUES(rate)", [usd, asOf, crc, asOf]);
  const usdLine = async (label = "Library dollars", planned = "1,200.00") => {
    const r = await confirm({ source: "manual", lines: [row({ label, currency: "USD", planned })] });
    return r.lineIds[0];
  };
  const fxOf = async (id: string) =>
    (await q("SELECT fx_rate, fx_source, DATE_FORMAT(fx_as_of, '%Y-%m-%d') AS fx_as_of, fx_locked_by, fx_locked_at IS NOT NULL AS locked_at_set FROM budget_lines WHERE id = ?", [id]))[0];

  it("locks the newest stored daily rate, read on the server, and counts the line converted, naming the rate, its source, its date and who locked it", async () => {
    await q("DELETE FROM fx_rates");
    await storeDaily(today());
    const id = await usdLine();
    expect(await cashBudgetLeft(pool, MOON), "not counted yet: in USD").toBeNull();
    const p = await upload([{ id, action: "lock", use: "provider" }], { source: "manual" });
    const rate = (550.65 / 1.08).toFixed(8);
    expect(p.changed[0]).toMatchObject({ op: "lock", convertedMinor: convertAtRate(120_000, "USD", "CRC", rate) });
    await upload([{ id, action: "lock", use: "provider" }], { source: "manual", dryRun: false, revision: p.revision });
    expect(await fxOf(id)).toEqual({ fx_rate: rate, fx_source: "daily rate, open.er-api.com", fx_as_of: today(), fx_locked_by: "u-treasurer", locked_at_set: 1 });
    const f = (await cashBudgetLeft(pool, MOON))!;
    expect(f.plannedMinor).toBe(convertAtRate(120_000, "USD", "CRC", rate));
    expect(f.working.lines[0].fx).toMatchObject({ rate, source: "daily rate, open.er-api.com", asOf: today(), lockedBy: "u-treasurer" });
    await vi.waitFor(async () => expect((await q("SELECT COUNT(*) AS n FROM health_events WHERE text = ?", [`budget:rate-locked:${id}`]))[0].n).toBe(1), { timeout: 3000 });
  });

  it("refuses a provider lock with no stored rate or only one older than 14 days, and a lock on a line already in the village's currency", async () => {
    await q("DELETE FROM fx_rates");
    const id = await usdLine();
    expect((await upload([{ id, action: "lock", use: "provider" }], { source: "manual" })).refused.map((r) => r.reason)).toEqual(["no_rate"]);
    await storeDaily(daysAgo(20));
    const stale = await upload([{ id, action: "lock", use: "provider" }], { source: "manual" });
    expect(stale.refused.map((r) => r.reason)).toEqual(["stale_rate"]);
    expect(stale.refused[0].message).toContain(daysAgo(20));
    const crc = (await confirm({ lines: [row({ label: "Colones" })] })).lineIds[0];
    expect((await upload([{ id: crc, action: "lock", use: "provider" }], { source: "manual" })).refused.map((r) => r.reason)).toEqual(["same_currency"]);
  });

  it("locks a typed rate with its source note, and refuses one with no note or a rate that is not a positive decimal", async () => {
    const id = await usdLine();
    const ok = await confirm({ source: "manual", lines: [{ id, action: "lock", rate: "500.5", sourceNote: "Bank transfer quote of 9 Nov" }] });
    expect(ok.written).toBe(true);
    expect(await fxOf(id)).toMatchObject({ fx_rate: "500.50000000", fx_source: "typed: Bank transfer quote of 9 Nov", fx_locked_by: "u-treasurer" });
    const bad = await upload([{ id, action: "lock", rate: "500.5" }, { id: await usdLine("Other dollars"), action: "lock", rate: "-3", sourceNote: "A typed quote" }], { source: "manual" });
    expect(bad.refused.map((r) => [r.row, r.reason])).toEqual([[1, "source_note"], [2, "rate"]]);
  });

  it("previews a bulk lock with every figure before anything is locked, and binds it by revision", async () => {
    await q("DELETE FROM fx_rates");
    await storeDaily(today());
    const a = await usdLine("A dollars", "100.00");
    const b = await usdLine("B dollars", "200.00");
    const rows: ImportRow[] = [{ id: a, action: "lock", use: "provider" }, { id: b, action: "lock", use: "provider" }];
    const p = await upload(rows, { source: "manual" });
    expect(p.changed.map((c) => [c.label, c.convertedMinor !== null])).toEqual([["A dollars", true], ["B dollars", true]]);
    expect((await fxOf(a)).fx_rate, "a preview locks nothing").toBeNull();
    expect((await upload(rows, { source: "manual", dryRun: false, revision: "old" })).code).toBe("stale");
    expect((await upload(rows, { source: "manual", dryRun: false, revision: p.revision })).written).toBe(true);
    expect([(await fxOf(a)).fx_rate, (await fxOf(b)).fx_rate].every((r) => r !== null)).toBe(true);
  });

  it("keeps the lock when a writer here changes the amount and shows the new converted figure, and drops it when the currency changes", async () => {
    const id = await usdLine();
    await confirm({ source: "manual", lines: [{ id, action: "lock", rate: "500", sourceNote: "A typed quote" }] });
    const edit = await upload([{ id, planned: "1,000.00" }], { source: "manual" });
    expect(edit.changed[0]).toMatchObject({ op: "change", plannedMinor: 100_000, convertedMinor: 50_000_000 });
    await upload([{ id, planned: "1,000.00" }], { source: "manual", dryRun: false, revision: edit.revision });
    expect((await fxOf(id)).fx_rate).toBe("500.00000000");
    expect((await cashBudgetLeft(pool, MOON))!.plannedMinor).toBe(50_000_000);
    const recurrency = await upload([{ id, currency: "EUR", planned: "900.00" }], { source: "manual" });
    expect(recurrency.flags.map((f) => f.kind)).toContain("rate_unlocked");
    await upload([{ id, currency: "EUR", planned: "900.00" }], { source: "manual", dryRun: false, revision: recurrency.revision });
    expect(await fxOf(id)).toMatchObject({ fx_rate: null, fx_source: null, fx_as_of: null, fx_locked_by: null });
  });

  it("drops the lock and the adoption when the library changes a line's amount or currency, and keeps both when it sends the line unchanged", async () => {
    const sera = (plannedMinor: number, currency = "USD"): ImportRow => ({ sourceRef: "rec-fx", period: MOON, category: "role_pay", label: "Library dollars", currency, plannedMinor });
    const read = (r: ImportRow) => confirm({ source: "sera", by: null, byAs: null, lines: [r] });
    const id = (await read(sera(120_000))).lineIds[0];
    await q("UPDATE budget_lines SET adopted_at = NOW(), adopted_as = 'Treasury' WHERE id = ?", [id]);
    await confirm({ source: "manual", lines: [{ id, action: "lock", rate: "500", sourceNote: "A typed quote" }] });
    expect((await cashBudgetLeft(pool, MOON))!.plannedMinor).toBe(60_000_000);
    expect((await read(sera(120_000))).changed, "the same line again changes nothing").toEqual([]);
    expect((await fxOf(id)).fx_rate).toBe("500.00000000");
    const moved = await read(sera(130_000));
    expect(moved.flags.map((f) => f.kind).sort()).toEqual(["adoption_cleared", "rate_unlocked"]);
    expect((await fxOf(id)).fx_rate).toBeNull();
    expect((await q("SELECT adopted_at FROM budget_lines WHERE id = ?", [id]))[0].adopted_at).toBeNull();
    expect(await cashBudgetLeft(pool, MOON), "it stops counting until adopted again").toBeNull();
  });

  it("reads each locked line's drift at today's stored rate, for display only, and flags it past 5%", async () => {
    await q("DELETE FROM fx_rates");
    await storeDaily(today(), 1, 530);
    const id = await usdLine();
    await confirm({ source: "manual", lines: [{ id, action: "lock", rate: "500", sourceNote: "A typed quote" }] });
    const before = (await cashBudgetLeft(pool, MOON))!.plannedMinor;
    const drift = await budgetRateDrift(pool);
    expect(drift).toEqual([expect.objectContaining({ id, lockedMinor: 60_000_000, todayRate: 530, todayMinor: 63_600_000, pct: 6, overThreshold: true })]);
    expect((await cashBudgetLeft(pool, MOON))!.plannedMinor, "drift never moves the figure").toBe(before);
  });

  it("refuses more than 2000 rows in one import", async () => {
    const r = await upload(Array.from({ length: 2001 }, (_, i) => row({ label: `Line ${i}` })));
    expect(r).toMatchObject({ ok: false, status: 400, code: "too_many_rows" });
  });
});

describe("the pure parts", () => {
  it("reads a role row's cycle back off the key both cash writers make, allowances included", () => {
    expect(decodeRoleKey(cashKeys.role("lunar-000321", "seat:a", "u-1"))).toEqual({ cycle: "lunar-000321", allowance: false });
    expect(decodeRoleKey(moonLineCashKey("month-2026-11", { kind: "allowance", firstSeatId: "seat-2" }, "u-1"))).toEqual({ cycle: "month-2026-11", allowance: true });
    expect(decodeRoleKey(moonLineCashKey("month-2026-11", { kind: "pay", firstSeatId: "seat-2" }, "u-1"))).toEqual({ cycle: "month-2026-11", allowance: false });
    expect(decodeRoleKey(cashKeys.quest("c-1"))).toBeNull();
  });

  it("keys a library line by its record id, and any other by what it is, under 191 characters", () => {
    expect(budgetLineKey({ source: "sera", sourceRef: "rec-1", periodKind: "moon", periodKey: "x", circleId: null, roleId: null, category: "role_pay", label: "x" })).toBe("sera:rec-1");
    const k = budgetLineKey({ source: "upload", periodKind: "moon", periodKey: "lunar-000321", circleId: "c".repeat(64), roleId: "r".repeat(64), category: "role_pay", label: "L".repeat(120) });
    expect(k.length).toBeLessThanOrEqual(191);
    expect(k.startsWith("upload:")).toBe(true);
    expect(budgetLineKey({ source: "manual", periodKind: "moon", periodKey: "lunar-000321", circleId: null, roleId: null, category: "role_pay", label: "Pay" })).not.toBe(
      budgetLineKey({ source: "upload", periodKind: "moon", periodKey: "lunar-000321", circleId: null, roleId: null, category: "role_pay", label: "Pay" }),
    );
  });

  it("keeps a source registry and refuses to register the sources people write", async () => {
    const pull = async () => ({ ok: true });
    registerBudgetSource("sera", pull);
    expect(budgetSource("sera")).toBe(pull);
    expect(() => registerBudgetSource("upload", pull)).toThrow();
    expect(budgetSource("nowhere")).toBeNull();
    // A moon id no clock reads has no figure.
    expect(parseId("lunar-000321")).not.toBeNull();
    expect(boundsForNumber(321).id).toBe("lunar-000321");
  });
});
