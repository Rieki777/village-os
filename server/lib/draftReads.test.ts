/**
 * Reading drafts by what the caller asked for, instead of everything.
 *
 * THE DEFECT THIS GUARDS. `listDrafts` read `org_drafts` and
 * `org_draft_changes` whole on every call. `/api/org/vision`, which answers
 * signed-out readers when `map.public_structure` is on, only ever used the open
 * drafts. `publishDraft` read both tables twice inside its transaction, holding
 * the circles counter, to find one draft. And every Publish on the living map
 * is a draft of its own (0208), so that read grew with every arrangement
 * anybody had ever published.
 *
 * The assertions look at WHICH ROWS the database handed back, at the repo read
 * as well as through the `Draft` mapping. A filter applied in JavaScript after
 * reading everything would pass a test that only looked at the mapped result,
 * and the cost this closes is the reading, not the result.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { addChange, createDraft, getDraft, listDrafts, withdrawDraft } from "./orgDrafts";
import { readDraftBodies } from "../repos/orgDrafts";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

/** An open draft proposing one new seat per name, in that order. */
async function draftWith(title: string, seatNames: string[]) {
  const made = await createDraft(pool, { title, createdBy: "u-steward" });
  if (!made.ok) throw new Error(made.error);
  for (const name of seatNames) {
    const r = await addChange(pool, made.id, {
      op: "create_seat",
      orgRoleId: `seat-${name}`,
      payload: { name, seats: 1 },
    });
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
  }
  return made.id;
}

describe.skipIf(!configured)("reading drafts by what the caller asked for", () => {
  let openA = "";
  let withdrawn = "";
  let openC = "";

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
    openA = await draftWith("Two new seats", ["Keeper", "Scribe"]);
    withdrawn = await draftWith("A seat nobody wanted", ["Herald"]);
    const w = await withdrawDraft(pool, withdrawn);
    expect(w.ok, !w.ok ? w.error : "").toBe(true);
    openC = await draftWith("One more seat", ["Gardener"]);
  });

  it("getDraft reads one draft with its own changes, in order", async () => {
    const d = await getDraft(pool, openA);
    expect(d?.title).toBe("Two new seats");
    expect(d?.changes.map((c) => c.orgRoleId)).toEqual(["seat-Keeper", "seat-Scribe"]);
    expect(d?.changes.every((c) => c.draftId === openA)).toBe(true);
  });

  it("getDraft answers null for a draft that is not there", async () => {
    expect(await getDraft(pool, "no-such-draft")).toBeNull();
  });

  it("asks the database for one draft's rows when it wants one draft", async () => {
    const rows = await readDraftBodies(pool, { id: openA });
    expect(rows.drafts.map((d) => d.id)).toEqual([openA]);
    expect(rows.changes).toHaveLength(2);
    expect(new Set(rows.changes.map((c) => c.draft_id))).toEqual(new Set([openA]));
  });

  it("asks for the open drafts' changes only, never a closed draft's", async () => {
    const rows = await readDraftBodies(pool, { status: "open" });
    expect(new Set(rows.drafts.map((d) => d.id))).toEqual(new Set([openA, openC]));
    expect(rows.changes).toHaveLength(3);
    expect(rows.changes.some((c) => c.draft_id === withdrawn)).toBe(false);
  });

  it("maps a status read into drafts that each carry only their own changes", async () => {
    const open = await listDrafts(pool, { status: "open" });
    expect(open.map((d) => d.id).sort()).toEqual([openA, openC].sort());
    for (const d of open) expect(d.changes.every((c) => c.draftId === d.id)).toBe(true);
    const closed = await listDrafts(pool, { status: "withdrawn" });
    expect(closed.map((d) => d.id)).toEqual([withdrawn]);
    expect(closed[0].changes).toHaveLength(1);
  });

  it("still lists every draft when no status is given, which the admin list relies on", async () => {
    const all = await listDrafts(pool);
    expect(all.map((d) => d.id).sort()).toEqual([openA, withdrawn, openC].sort());
    const counts = Object.fromEntries(all.map((d) => [d.id, d.changes.length]));
    expect(counts).toEqual({ [openA]: 2, [withdrawn]: 1, [openC]: 1 });
  });

  it("answers an empty read for a status no draft is in", async () => {
    expect(await readDraftBodies(pool, { status: "published" })).toEqual({ drafts: [], changes: [] });
  });
});
