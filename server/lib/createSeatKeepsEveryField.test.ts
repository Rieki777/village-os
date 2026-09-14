/**
 * A proposed seat arrives on the chart carrying every field the proposal was
 * allowed to carry.
 *
 * THE DEFECT THIS GUARDS. `PROPOSABLE_SEAT_FIELDS` in server/routes/review.ts
 * lets a proposal carry `recruiting`, `whyItMatters` and `criticality`, and
 * `previewDraft` even validates `criticality`. The `create_seat` branch of
 * `applyChange` then wrote only name, circle, aim, domain, accountabilities and
 * seats. So a vendor's first org import marked seven seats as recruiting, a
 * steward read "recruiting" on every card, the draft published clean, and the
 * live chart showed none of them recruiting. No refusal and no log line: the
 * value was accepted at every step and dropped at the last one.
 *
 * Found by rehearsing a real first batch end to end on a scratch schema, and
 * not by any gate. The `update_seat` branch already writes all three through
 * `SEAT_FIELDS`, so only a seat CREATED by a draft lost them.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { addChange, createDraft, previewDraft, publishDraft } from "./orgDrafts";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

async function publishOneSeat(orgRoleId: string, payload: Record<string, unknown>) {
  const made = await createDraft(pool, {
    title: "One seat, as a vendor proposed it",
    createdBy: "u-steward",
    sourceKind: "agent",
    sourceModuleId: "vendor",
    openCap: 99,
  });
  if (!made.ok) throw new Error(made.error);
  const added = await addChange(pool, made.id, { op: "create_seat", orgRoleId, payload });
  if (!added.ok) throw new Error(added.error);
  const preview = await previewDraft(pool, made.id, 99);
  expect(preview.blocked, JSON.stringify(preview.lines)).toBe(0);
  const r = await publishDraft(pool, made.id, "u-steward", 99);
  expect(r.ok, !r.ok ? r.error : "").toBe(true);
  const [[row]] = await pool.query<any[]>(
    "SELECT name, recruiting, why_it_matters, criticality, seats FROM org_roles WHERE id = ?", [orgRoleId],
  );
  return row;
}

describe.skipIf(!configured)("a seat a draft creates keeps every proposable field", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM org_draft_changes"); // module-review-ok: resetting the scratch schema this suite provisioned
    await pool.query("DELETE FROM org_drafts"); // module-review-ok: same
    await pool.query("DELETE FROM org_roles WHERE id LIKE 'keeps-%'"); // module-review-ok: same, only this suite's own seats
  });

  it("keeps recruiting, which a first import set on seven seats and lost on all seven", async () => {
    const row = await publishOneSeat("keeps-recruiting", { name: "Title Steward", recruiting: true, seats: 1 });
    expect(Number(row.recruiting)).toBe(1);
  });

  it("keeps why it matters and criticality", async () => {
    const row = await publishOneSeat("keeps-why", {
      name: "Water Keeper",
      whyItMatters: "Nobody else watches the spring through the dry months.",
      criticality: "high",
    });
    expect(row.why_it_matters).toBe("Nobody else watches the spring through the dry months.");
    expect(row.criticality).toBe("high");
  });

  it("still creates a seat that names none of them, with the column defaults", async () => {
    // The control. A fix that wrote an explicit NULL into a NOT NULL column
    // would turn a dropped field into a publish that fails, which is worse.
    const row = await publishOneSeat("keeps-plain", { name: "Plain Seat" });
    expect(row.name).toBe("Plain Seat");
    expect(Number(row.recruiting)).toBe(0);
    expect(row.criticality).toBe("normal");
    expect(Number(row.seats)).toBe(1);
  });
});
