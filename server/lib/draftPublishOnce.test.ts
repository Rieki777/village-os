/**
 * Publishing a draft twice, which used to answer ok twice for one publish.
 *
 * THE DEFECT. `publishDraft` read the draft on the POOL, checked its status
 * was `open`, and only then opened a transaction. The UPDATE inside carried
 * `AND status = 'open'`, which is the right clause, and its result was thrown
 * away, so a call that matched ZERO rows still committed and still returned
 * `{ ok: true }`. `revertDraft` threw away the same count for the same reason.
 *
 * WHAT THE CONTROL ACTUALLY SHOWED, which is narrower than it first looked and
 * is the reason these tests are shaped the way they are.
 *
 * Written SEQUENTIALLY, every one of them passed against the unfixed code. The
 * second call reads `status` after the first has committed, so the check
 * outside the transaction catches it and the guarded UPDATE is never reached.
 * A sequential suite here would have been a green that proved nothing and read
 * exactly like proof.
 *
 * The defect needs two calls IN FLIGHT at once, which is one steward
 * double-clicking Publish. Then both read `open` before either commits, both
 * run every write, and both report success. Reproduced three times out of
 * three against the unfixed tree: `expected 2 to be 1`, for publish and for
 * revert alike.
 *
 * So the harm these prove is a RESPONSE THAT LIES: two callers are told they
 * published, one of them did nothing, and the second transaction re-ran every
 * write in the draft. Some of those writes are idempotent and some are caught
 * by a unique index; that is the database rescuing the code, not the code
 * being right.
 *
 * There is a narrower interleaving where the losing call captures `before_json`
 * AFTER the winner commits, which would overwrite the revert data with the
 * already-published state. The fix closes it, by reading the draft inside the
 * transaction; this suite does not reproduce it deterministically and does not
 * claim to. The `before_json` assertion below is regression cover, not proof.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { addChange, createDraft, listDrafts, publishDraft, revertDraft } from "./orgDrafts";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

/** A seat that exists, and a draft that renames it. */
async function seatAndDraft() {
  await pool.query(
    "INSERT INTO org_roles (id, name, seats, active) VALUES ('keeper', 'Water Keeper', 1, 1)",
  );
  const made = await createDraft(pool, {
    title: "Rename the water seat",
    createdBy: "u-steward",
    sourceKind: "human",
    openCap: 99,
  });
  if (!made.ok) throw new Error(made.error);
  const r = await addChange(pool, made.id, {
    op: "update_seat",
    orgRoleId: "keeper",
    payload: { name: "Water Steward" },
  });
  expect(r.ok, !r.ok ? r.error : "").toBe(true);
  return made.id;
}

const seatName = async () => {
  const [[row]] = await pool.query<any[]>("SELECT name FROM org_roles WHERE id = 'keeper'");
  return String(row?.name ?? "");
};

describe.skipIf(!configured)("a draft publishes exactly once", () => {
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
    await pool.query("DELETE FROM org_role_assignments"); // module-review-ok: same
    await pool.query("DELETE FROM org_roles"); // module-review-ok: same
  });

  it("applies the change and marks the draft published", async () => {
    const id = await seatAndDraft();
    const first = await publishDraft(pool, id, "u-steward");
    expect(first.ok, !first.ok ? first.error : "").toBe(true);
    expect(await seatName()).toBe("Water Steward");
  });

  it("refuses a SEQUENTIAL second publish (the outside check already did)", async () => {
    // Kept because it is the common shape, and stated as what it is: this
    // one passed before the fix too. It proves nothing about the race.
    const id = await seatAndDraft();
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(false);
  });

  it("lets exactly ONE of two publishes in flight succeed", async () => {
    const id = await seatAndDraft();
    const [a, b] = await Promise.all([
      publishDraft(pool, id, "u-steward"),
      publishDraft(pool, id, "u-steward"),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
  });

  it("keeps before_json describing the world BEFORE the publish", async () => {
    // Regression cover, and labelled as such: in the racing shape above both
    // calls capture `before_json` before either applies, so this held even
    // on the unfixed tree. It guards the narrow interleaving where the
    // loser captures after the winner has committed.
    const id = await seatAndDraft();
    await Promise.all([publishDraft(pool, id, "u-steward"), publishDraft(pool, id, "u-steward")]);
    const [[row]] = await pool.query<any[]>(
      "SELECT before_json FROM org_draft_changes WHERE draft_id = ?", [id],
    );
    const before = typeof row.before_json === "string" ? JSON.parse(row.before_json) : row.before_json;
    expect(before.name).toBe("Water Keeper");
  });

  it("still reverts to the original name after a contested publish", async () => {
    // The user-visible consequence of the test above, stated as behaviour.
    const id = await seatAndDraft();
    await Promise.all([publishDraft(pool, id, "u-steward"), publishDraft(pool, id, "u-steward")]);
    const r = await revertDraft(pool, id);
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    expect(await seatName()).toBe("Water Keeper");
  });

  it("lets exactly ONE of two reverts in flight succeed", async () => {
    const id = await seatAndDraft();
    await publishDraft(pool, id, "u-steward");
    const [a, b] = await Promise.all([revertDraft(pool, id), revertDraft(pool, id)]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    const [d] = await listDrafts(pool);
    expect(d.status).toBe("reverted");
  });
});

describe.skipIf(!configured)("a seating written by a draft uses the same key as the route", () => {
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
    await pool.query("DELETE FROM org_role_assignments"); // module-review-ok: same
    await pool.query("DELETE FROM org_roles"); // module-review-ok: same
  });

  /** A name whose slug the two implementations disagreed about. */
  const TRAILING_SPACE = "Alex ";

  async function draftSeating(name: string) {
    await pool.query("INSERT INTO org_roles (id, name, seats, active) VALUES ('keeper', 'Water Keeper', 2, 1)");
    const made = await createDraft(pool, { title: "Seat Alex", createdBy: "u-steward", sourceKind: "human", openCap: 99 });
    if (!made.ok) throw new Error(made.error);
    const r = await addChange(pool, made.id, { op: "seat_holder", orgRoleId: "keeper", payload: { displayName: name } });
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    return made.id;
  }

  it("trims the trailing dash the inline slug left on", async () => {
    // `doc:alex-` through a draft, `doc:alex` through the seating route. The
    // unique index on the active holder key could not see they were one
    // person, so the same human could be seated twice in one seat.
    const id = await draftSeating(TRAILING_SPACE);
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    const [[row]] = await pool.query<any[]>("SELECT holder_key FROM org_role_assignments WHERE org_role_id = 'keeper'");
    expect(row.holder_key).toBe("doc:alex");
  });

  it("refuses a documented holder with no name, in words", async () => {
    // seatHolder's own refusal, which the inline INSERT skipped entirely: it
    // wrote `doc:unnamed` and called that a person.
    await pool.query("INSERT INTO org_roles (id, name, seats, active) VALUES ('keeper', 'Water Keeper', 2, 1)");
    const made = await createDraft(pool, { title: "Seat nobody", createdBy: "u-steward", sourceKind: "human", openCap: 99 });
    if (!made.ok) throw new Error(made.error);
    await addChange(pool, made.id, { op: "seat_holder", orgRoleId: "keeper", payload: {} });
    const r = await publishDraft(pool, made.id, "u-steward");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("name");
  });

  it("reverts that seating, which needs the key to match on the way back", async () => {
    const id = await draftSeating(TRAILING_SPACE);
    await publishDraft(pool, id, "u-steward");
    expect((await revertDraft(pool, id)).ok).toBe(true);
    const [[live]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM org_role_assignments WHERE org_role_id = 'keeper' AND ended_at IS NULL",
    );
    expect(Number(live.n)).toBe(0);
  });
});
