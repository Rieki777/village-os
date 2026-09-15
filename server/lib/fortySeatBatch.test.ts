/**
 * The batch size we invited an outside team to send, proven end to end.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * Saberra has been told to send a whole organisation in one batch, and the
 * figure that went out in writing was twelve to forty seats. Nobody had run
 * one. The shipped example carries TWO seats, and the largest the accept path
 * had been exercised with was ten, in a test written to prove withdrawal
 * rather than volume. So the number in the invitation was a hope.
 *
 * ── WHERE THE BOUNDARY USED TO BE, AND WHERE IT IS NOW ───────────────────
 *
 * This file first measured a boundary that sat in the ROSTER:
 * `draftChangeCap` was max(3, activeMembers * 3), so forty seats needed a
 * counted roster of fourteen, and a village of two accounts could take six.
 * Rye ruled on 2026-09-14 that a limit per account was broken, because a
 * village's beginning is exactly one of these large imports. The limit is now
 * the village's own setting, `org.proposal_change_limit`, shipping at 500.
 *
 * So the boundary moved to a place a village can see and change:
 *
 *   forty seats publish in a village of two accounts under the shipped limit
 *   a village that tunes its limit to 39 has the fortieth line blocked
 *
 * ── WHAT THIS PINS, AND WHY IT IS WORTH THE SECONDS ──────────────────────
 *
 * Anybody lowering the shipped default is lowering the largest import this
 * platform accepts out of the box, and the first case fails by name. Anybody
 * who puts a roster back into the limit fails it too, because the roster here
 * is two.
 *
 * Every seat carries a distinct name, no circle, and no seats or criticality
 * field, so the only thing that can block a line is the change limit. A seat
 * blocked for a shape reason would be answering a different question.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  addChange,
  createDraft,
  draftChangeCap,
  openDraftCap,
  previewDraft,
  publishDraft,
  withdrawDraft,
} from "./orgDrafts";
import { loadVariables, setVariable } from "./variables";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

/** The size named in the invitation. */
const SEATS = 40;
/** The live village the old limit was found on. */
const ROSTER = 2;
const LIMIT_KEY = "org.proposal_change_limit";

async function tuneLimit(value: string) {
  const r = await setVariable(pool, LIMIT_KEY, value);
  expect(r.ok, r.error).toBe(true);
}

async function acceptBatchOf(seats: number) {
  const made = await createDraft(pool, {
    title: `A batch of ${seats}`,
    sourceKind: "agent",
    sourceModuleId: "saberra",
    openCap: openDraftCap(ROSTER),
  });
  expect(made.ok, "the draft was created").toBe(true);
  const draftId = (made as { ok: true; id: string }).id;

  for (let i = 1; i <= seats; i += 1) {
    const r = await addChange(pool, draftId, {
      op: "create_seat",
      orgRoleId: `orgrole-batch-${i}`,
      payload: { name: `Proposed seat ${i}` },
    });
    expect(r.ok, `seat ${i} was added`).toBe(true);
  }

  const preview = await previewDraft(pool, draftId, draftChangeCap());
  const published = await publishDraft(pool, draftId, "steward", draftChangeCap());
  return { draftId, blocked: preview.blocked, published };
}

describe.skipIf(!configured)("the batch size we invited", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await loadVariables(pool);
  });
  afterAll(async () => {
    if (pool) await setVariable(pool, LIMIT_KEY, VARIABLES_BY_KEY[LIMIT_KEY].default);
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM org_draft_changes"); // module-review-ok: resetting the scratch schema this suite provisioned
    await pool.query("DELETE FROM org_drafts"); // module-review-ok: same
    await pool.query("DELETE FROM org_roles"); // module-review-ok: same
    await tuneLimit(VARIABLES_BY_KEY[LIMIT_KEY].default);
  });

  it("forty seats publish in a village of two accounts under the shipped limit, and all forty go live", async () => {
    const { blocked, published } = await acceptBatchOf(SEATS);

    expect(blocked).toBe(0);
    expect(published.ok).toBe(true);

    const [[n]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_roles"); // module-review-ok: reading back the scratch schema this suite provisioned
    expect(Number(n.n)).toBe(SEATS);
  });

  it("at a tuned limit of THIRTY-NINE the same batch is refused whole, and the refusal names the limit", async () => {
    // One below the batch. The fortieth line blocks and publishDraft refuses
    // the draft entire instead of applying 39 of it. Partial application
    // would be the worse failure: a village holding most of a reorganisation
    // nobody decided to make.
    await tuneLimit("39");
    const { blocked, published } = await acceptBatchOf(SEATS);

    expect(blocked).toBe(1);
    expect(published.ok).toBe(false);
    expect((published as { error: string }).error).toContain("39 changes in one reorganisation");

    const [[n]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_roles"); // module-review-ok: same
    expect(Number(n.n)).toBe(0);
  });

  it("and the jammed batch can be withdrawn, which frees the slot it holds", async () => {
    // Without this, an over-limit batch is a draft that can neither publish
    // nor close, holding one of openDraftCap(roster) machine-draft slots forever.
    await tuneLimit("39");
    const { draftId, published } = await acceptBatchOf(SEATS);
    expect(published.ok).toBe(false);

    expect(await withdrawDraft(pool, draftId)).toEqual({ ok: true });

    const [[d]] = await pool.query<any[]>("SELECT status FROM org_drafts WHERE id = ?", [draftId]); // module-review-ok: same
    expect(d.status).toBe("withdrawn");
  });

  it("states the general rule, so the next size does not need a new test", async () => {
    // Every size in the invitation, and past it, fits the shipped limit with
    // no roster in the sum. A batch of N fits a limit of N and not of N - 1.
    for (const n of [12, 20, 30, 40, 60]) {
      expect(draftChangeCap(), `${n} seats under the shipped limit`).toBeGreaterThanOrEqual(n);
    }
    for (const n of [12, 40]) {
      await tuneLimit(String(n));
      expect(draftChangeCap(), `${n} seats at a limit of ${n}`).toBeGreaterThanOrEqual(n);
      await tuneLimit(String(n - 1));
      expect(draftChangeCap(), `${n} seats at a limit of ${n - 1}`).toBeLessThan(n);
    }
  });
});
