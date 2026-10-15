/**
 * Pressing "Sync now" again, against a real schema.
 *
 * Production on 2026-10-09 holds a structure whose 56 seats carry only an id
 * and a name, beside 18 circle proposals. Nothing stored can be repaired: the
 * circle relation was never kept. The recovery is a second read, and this
 * suite holds what that second read must do to the queue:
 *
 *   - the waiting structure is SUPERSEDED by the new one (a changed claim
 *     about the same thing, `landProposal`'s identity key);
 *   - a circle proposal that did not change is MOVED into the new delivery
 *     (`rebatchWaiting`), so the new batch is one a steward can review whole;
 *   - anything a steward already decided stays exactly as it is;
 *   - and the new batch, read by the structure review, places its seats.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { landProposal, markProposalDecided, proposalsInBatch } from "./externalProposals";
import { proposeStructure, type VendorRecord } from "./saberraProposals";
import { splitStreams } from "./saberraStreams";
import { readStructure } from "./structureReview";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const LAND = "3ed0a88e-f36a-8104-80fa-cd2bfe15c001";
const MONEY = "3ed0a88e-f36a-8104-80fa-cd2bfe15c002";
const OLD = "3ed0a88e-f36a-8104-80fa-cd2bfe15c003";

/** The service's read, in the shape it sends: circles, and roles naming them by page id. */
const READ: VendorRecord[] = [
  { id: LAND, kind: "circle", fields: { "Circle Name": "Resync Land Circle", Status: "Active" } },
  { id: MONEY, kind: "circle", fields: { "Circle Name": "Resync Money Circle", Status: "Proposed" } },
  { id: OLD, kind: "circle", fields: { "Circle Name": "Resync Old Circle", Status: "Archived" } },
  { id: "r-water", kind: "role", fields: { "Role Name": "Resync Water Steward", Circle: [LAND], Status: "Active" } },
  { id: "r-purse", kind: "role", fields: { "Role Name": "Resync Purse Keeper", Circle: [{ id: MONEY }], Status: "Vacant" } },
  { id: "r-cook", kind: "role", fields: { "Role Name": "Resync Cook", Circle: [OLD], Status: "Active" } },
];

/** One sync, the way the route lands it. */
async function sync(batchId: string, opts: { storedShape?: boolean } = {}) {
  const structure = proposeStructure(READ, { sourceName: "the service" });
  const payload = opts.storedShape
    ? {
        ...structure.payload,
        // What production stored: every seat an id and a name, and nothing else.
        seats: structure.payload.seats.map((s) => ({ id: s.id, name: s.name })),
      }
    : structure.payload;
  const results = [
    await landProposal(pool, {
      villageId: "v1", moduleId: "saberra", batchId, kind: "org.proposed", payload,
      trustTier: "extracted_unreviewed", rebatchWaiting: true,
    }),
  ];
  const reading = splitStreams(READ);
  for (const group of reading.structure) {
    if (group.kind === "org.proposed") continue;
    for (const rec of group.records) {
      const fact = reading.facts.find((f) => f.vendorRecordId === rec.id);
      results.push(
        await landProposal(pool, {
          villageId: "v1", moduleId: "saberra", batchId, kind: group.kind,
          payload: { ...(fact?.fields ?? {}), vendorRecordId: rec.id }, sourceRef: rec.id,
          trustTier: "extracted_unreviewed", rebatchWaiting: true,
        }),
      );
    }
  }
  return results;
}

describe.skipIf(!configured)("pressing Sync now again", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM external_proposals"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
  });

  it("REPLACES THE WAITING STRUCTURE AND CARRIES THE UNCHANGED CIRCLES FORWARD", async () => {
    await sync("sync-old", { storedShape: true });
    const before = await proposalsInBatch(pool, "sync-old");
    expect(before.filter((p) => p.status === "proposed")).toHaveLength(4);

    const second = await sync("sync-new");
    expect(second[0]).toMatchObject({ ok: true, outcome: "stored", superseded: 1 });
    for (const r of second.slice(1)) expect(r).toMatchObject({ ok: true, outcome: "duplicate", rebatched: true });

    const old = await proposalsInBatch(pool, "sync-old");
    expect(old.map((p) => p.status)).toEqual(["superseded"]);
    const fresh = await proposalsInBatch(pool, "sync-new");
    expect(fresh.filter((p) => p.status === "proposed").map((p) => p.kind).sort()).toEqual([
      "circle.proposed",
      "circle.proposed",
      "circle.proposed",
      "org.proposed",
    ]);
  });

  it("LEAVES A DECIDED PROPOSAL EXACTLY WHERE IT WAS", async () => {
    await sync("sync-old", { storedShape: true });
    const rejected = (await proposalsInBatch(pool, "sync-old")).find((p) => p.kind === "circle.proposed")!;
    expect(await markProposalDecided(pool, { id: rejected.id, status: "rejected", decidedBy: "steward-1" })).toBe(true);

    const second = await sync("sync-new");
    const again = second.find((r) => r.ok && r.id === rejected.id);
    expect(again).toMatchObject({ outcome: "duplicate" });
    expect(again).not.toHaveProperty("rebatched");

    const old = await proposalsInBatch(pool, "sync-old");
    expect(old.find((p) => p.id === rejected.id)?.status).toBe("rejected");
  });

  it("is a no-op the second time the same read arrives, beyond moving it into the newest batch", async () => {
    await sync("sync-a");
    const again = await sync("sync-b");
    for (const r of again) expect(r).toMatchObject({ ok: true, outcome: "duplicate", superseded: 0, rebatched: true });
    expect(await proposalsInBatch(pool, "sync-a")).toEqual([]);
    expect((await proposalsInBatch(pool, "sync-b")).every((p) => p.status === "proposed")).toBe(true);
  });

  it("A VENDOR REDELIVERY WITHOUT THE OPTION STILL LEAVES A DUPLICATE WHERE IT LANDED", async () => {
    await sync("sync-a");
    const r = await landProposal(pool, {
      villageId: "v1", moduleId: "saberra", batchId: "redelivery", kind: "circle.proposed",
      payload: { "Circle Name": "Resync Land Circle", Status: "Active", vendorRecordId: LAND }, sourceRef: LAND,
      trustTier: "extracted_unreviewed",
    });
    expect(r).toMatchObject({ ok: true, outcome: "duplicate" });
    expect(await proposalsInBatch(pool, "redelivery")).toEqual([]);
  });

  it("GIVES THE STRUCTURE REVIEW A BATCH WHOSE SEATS SIT IN THEIR CIRCLES, archived apart", async () => {
    await sync("sync-old", { storedShape: true });
    await sync("sync-new");
    const read = await readStructure(pool, [], "sync-new");
    expect(read).not.toBeNull();
    const plan = read!.plan;
    const by = (n: string) => plan.seats.find((s) => s.name === n);
    expect(by("Resync Water Steward")).toMatchObject({ circleId: "resync-land-circle", circleProblem: null, sourceStatus: "active" });
    expect(by("Resync Purse Keeper")).toMatchObject({ circleId: "resync-money-circle", sourceStatus: "vacant" });
    expect(plan.circles.map((c) => c.name).sort()).toEqual(["Resync Land Circle", "Resync Money Circle"]);
    expect(plan.archived.map((a) => [a.kind, a.name, a.reason]).sort()).toEqual([
      ["circle", "Resync Old Circle", "archived"],
      ["seat", "Resync Cook", "circle-archived"],
    ]);
    // And the old batch has nothing left waiting to review.
    expect(await readStructure(pool, [], "sync-old")).toBeNull();
  });
});
