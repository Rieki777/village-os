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
 * It is now measured, and the answer has a boundary in it that a steward can
 * hit by accident:
 *
 *   a batch of N seats needs a counted roster of at least ceil(N / 3)
 *   forty seats therefore needs FOURTEEN, because draftChangeCap is
 *   max(3, activeMembers * 3) and 13 * 3 is 39
 *
 * At thirteen the fortieth line is blocked, publish refuses the whole draft,
 * and the batch has to be withdrawn. At fourteen it publishes and forty seats
 * go live. One member either side of that line is the difference between a
 * demo and a debugging session.
 *
 * ── WHAT THIS PINS, AND WHY IT IS WORTH THE SECONDS ──────────────────────
 *
 * Anybody tuning `draftChangeCap` is tuning the largest import this platform
 * can accept, and that relationship is invisible from the function. This test
 * is where it becomes visible: change the cap and the boundary case fails by
 * name, with the roster figure in the message.
 *
 * Every seat carries a distinct name, no circle, and no seats or criticality
 * field, so the only thing that can block a line is the volume cap. A seat
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

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

/** The size named in the invitation. */
const SEATS = 40;

async function acceptBatchOf(seats: number, roster: number) {
  const made = await createDraft(pool, {
    title: `A batch of ${seats}`,
    sourceKind: "agent",
    sourceModuleId: "saberra",
    openCap: openDraftCap(roster),
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

  const preview = await previewDraft(pool, draftId, draftChangeCap(roster));
  const published = await publishDraft(pool, draftId, "steward", draftChangeCap(roster));
  return { draftId, blocked: preview.blocked, published };
}

describe.skipIf(!configured)("the batch size we invited", () => {
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
    await pool.query("DELETE FROM org_roles"); // module-review-ok: same
  });

  it("forty seats publish at a roster of fourteen, and all forty go live", async () => {
    const { blocked, published } = await acceptBatchOf(SEATS, 14);

    expect(blocked).toBe(0);
    expect(published.ok).toBe(true);

    const [[n]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_roles"); // module-review-ok: reading back the scratch schema this suite provisioned
    expect(Number(n.n)).toBe(SEATS);
  });

  it("at THIRTEEN the same batch is refused whole, and the refusal names the limit", async () => {
    // One member fewer. draftChangeCap(13) is 39, so the fortieth line blocks
    // and publishDraft refuses the draft entire rather than applying 39 of it.
    // Partial application would be the worse failure: a village holding most
    // of a reorganisation nobody decided to make.
    const { blocked, published } = await acceptBatchOf(SEATS, 13);

    expect(blocked).toBe(1);
    expect(published.ok).toBe(false);
    expect((published as { error: string }).error).toContain("39 changes in one reorganisation");

    const [[n]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_roles"); // module-review-ok: same
    expect(Number(n.n)).toBe(0);
  });

  it("and the jammed batch can be withdrawn, which frees the slot it holds", async () => {
    // Without this, an over-cap batch is a draft that can neither publish nor
    // close, holding one of openDraftCap(roster) machine-draft slots forever.
    const { draftId, published } = await acceptBatchOf(SEATS, 13);
    expect(published.ok).toBe(false);

    expect(await withdrawDraft(pool, draftId)).toEqual({ ok: true });

    const [[d]] = await pool.query<any[]>("SELECT status FROM org_drafts WHERE id = ?", [draftId]); // module-review-ok: same
    expect(d.status).toBe("withdrawn");
  });

  it("states the general rule, so the next size does not need a new test", () => {
    // A batch of N needs a roster of at least ceil(N / 3).
    for (const [n, roster] of [[12, 4], [20, 7], [30, 10], [40, 14], [60, 20]]) {
      expect(draftChangeCap(roster), `${n} seats at roster ${roster}`).toBeGreaterThanOrEqual(n);
      expect(draftChangeCap(roster - 1), `${n} seats at roster ${roster - 1}`).toBeLessThan(n);
    }
  });
});
