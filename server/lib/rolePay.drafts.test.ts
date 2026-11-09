/**
 * A ROLE'S PAY CAN GO TO THE VILLAGE IN AN ORG DRAFT (constitution 0.3, 0.4).
 *
 * The valuation engine's role pay door (`PUT /api/org/roles/:id/pay`) sends a
 * figure to the village when nobody else may sign it, through an org draft put
 * to a vote. Until this, an org draft's role edit could not carry pay at all,
 * so that vote path changed nothing. Now:
 *
 *   1. A person's draft that edits a role's worth, tokens and cash previews
 *      clean, publishes, and writes them, stamped with the village's currency.
 *   2. Pay alone is a real change, never "names no field".
 *   3. The preview refuses what the admin door refuses: Gratitude by name, a
 *      negative amount.
 *   4. A machine's draft (Sera, a vendor) carrying pay is blocked: a pay
 *      package lands through a person's set step (II.14).
 *   5. A revert puts the old pay back.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole, listOrgRoles } from "./orgChart";
import { addChange, createDraft, previewDraft, publishDraft, revertDraft } from "./orgDrafts";
import { orgDraftCloser, putDraftToVillage } from "./orgDraftDecide";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

async function draftWith(sourceKind: string, orgRoleId: string, payload: Record<string, unknown>) {
  const made = await createDraft(pool, {
    title: "A role's pay, in a test",
    createdBy: "u-author",
    sourceKind,
    sourceModuleId: sourceKind === "human" ? null : "vendor",
    openCap: sourceKind === "human" ? null : 99,
  });
  if (!made.ok) throw new Error(made.error);
  const added = await addChange(pool, made.id, { op: "update_seat", orgRoleId, payload });
  if (!added.ok) throw new Error(added.error);
  return made.id;
}
const roleOf = async (id: string): Promise<any> => (await listOrgRoles(pool)).find((r) => r.id === id) ?? null;

describe.skipIf(!configured)("a role's pay rides an org draft a member wrote", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    for (const name of ["Pay Human Seat", "Pay Vendor Seat", "Pay Bad Seat", "Pay Revert Seat", "Pay Vote Seat"]) await createOrgRole(pool, { name });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("goes to the village: put to a vote, carried, and the role's value_minor changes (the vote path the engine names, 0.4)", async () => {
    const id = await draftWith("human", "pay-vote-seat", { valueMinor: 4321000, valueTokens: [] });
    const opened = await putDraftToVillage(pool, {
      draftId: id,
      openedBy: "u-member",
      why: "village" as any,
      setup: { method: "majority", dials: { unityPct: 50, quorumPct: 0 }, snapshot: { mode: "equal", token: null } as any, tokenProblem: null, electorate: [{ userId: "u-member", weight: 1 }], durationDays: 7 },
    });
    expect(opened.ok, !opened.ok ? JSON.stringify(opened.body) : "").toBe(true);
    if (!opened.ok) return;
    // What a carried org_draft vote runs at its close.
    const closer = orgDraftCloser({ pool, reloadCircles: async () => {}, notify: async () => {}, seasonState: () => ({ current: null, seasons: [], timezone: "UTC" }) });
    expect(closer.execute, "an org_draft vote executes at its close").toBeTypeOf("function");
    const done = await closer.execute!(opened.ballot, "u-member");
    expect(done.held, String(done.held)).toBeNull();
    expect(done.applied).toEqual([`org_draft:${id}`]);
    expect((await roleOf("pay-vote-seat")).valueMinor).toBe(4321000);
  });

  it("previews clean, publishes, and writes the role's worth, tokens and cash in the village's currency", async () => {
    const id = await draftWith("human", "pay-human-seat", { valueMinor: 7182000, valueTokens: [], cashMinor: 1000000 });
    const preview = await previewDraft(pool, id);
    expect(preview.blocked, JSON.stringify(preview.lines)).toBe(0);
    expect(preview.lines[0].reads).toMatch(/pay/);
    const r = await publishDraft(pool, id, "u-publisher");
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    const seat = await roleOf("pay-human-seat");
    expect(seat.valueMinor).toBe(7182000);
    expect(seat.valueCurrency).toMatch(/^[A-Z]{3}$/);
    expect(seat.valueTokens).toEqual([]);
    expect(seat.cashMinor).toBe(1000000);
  });

  it("blocks what the admin door refuses: Gratitude by name, and a negative amount", async () => {
    const grat = await draftWith("human", "pay-bad-seat", { valueTokens: [{ token: "gratitude", amount: 5 }] });
    expect((await previewDraft(pool, grat)).lines[0].blocked).toMatch(/Gratitude/);
    expect((await publishDraft(pool, grat, "u-publisher")).ok).toBe(false);
    const neg = await draftWith("human", "pay-bad-seat", { valueMinor: -5 });
    expect((await previewDraft(pool, neg)).blocked).toBe(1);
    expect((await roleOf("pay-bad-seat")).valueMinor ?? null).toBeNull();
  });

  it("blocks a machine's draft carrying pay: a pay package lands through a person (II.14)", async () => {
    const id = await draftWith("vendor", "pay-vendor-seat", { valueMinor: 100000 });
    const preview = await previewDraft(pool, id, 99);
    expect(preview.blocked).toBe(1);
    expect(preview.lines[0].blocked).toMatch(/person/);
    expect((await publishDraft(pool, id, "u-steward", 99)).ok).toBe(false);
  });

  it("puts the old pay back on a revert", async () => {
    const first = await draftWith("human", "pay-revert-seat", { valueMinor: 500000 });
    expect((await publishDraft(pool, first, "u-publisher")).ok).toBe(true);
    const second = await draftWith("human", "pay-revert-seat", { valueMinor: 900000 });
    expect((await publishDraft(pool, second, "u-publisher")).ok).toBe(true);
    expect((await roleOf("pay-revert-seat")).valueMinor).toBe(900000);
    const back = await revertDraft(pool, second);
    expect(back.ok, !back.ok ? back.error : "").toBe(true);
    expect((await roleOf("pay-revert-seat")).valueMinor).toBe(500000);
  });
});
