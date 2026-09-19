/**
 * The lost update `replaceAll` used to have, reproduced against a real MySQL
 * and then held closed.
 *
 * WHAT THIS IS ABOUT. `dbCollection.replaceAll` is a DELETE of the whole table
 * plus a re-INSERT of a snapshot the caller took with `all()`. Every caller in
 * server/index.ts is a read-modify-write with `await` points in the gap, and
 * before 0122 nothing checked whether the snapshot was still current, so the
 * second writer to commit erased everything the first one did and both
 * requests answered 200.
 *
 * The two cases below are the ones that were REPRODUCED before anything was
 * changed, on the code as it stood, with this exact timing:
 *
 *   RACE 1  steward's rename ERASED, job's lastCheckedAt survived, no error
 *   RACE 2  steward's newly created tool ERASED outright, no error
 *
 * They are written against the real `tools` table and the real tools spec
 * because `tools` is where it was caught: `tools-link-check` runs on the
 * scheduler and `PUT /api/admin/tools/:id` runs on a steward's click, and they
 * write the same rows.
 *
 * The timings are deliberate rather than incidental. Writer A reads first and
 * commits last, which is the shape of a background job that reads, spends time
 * on HTTP round trips, and only then writes back. Shortening either sleep
 * narrows the window; it does not change what is being asserted.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { circlesOnCycles, loopedCirclesRefusal } from "../../shared/circleView";
import {
  dbCollection,
  MergeRefusedError,
  snapshotVersionOf,
  StaleSnapshotError,
  type CollectionSpec,
} from "./store-db";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[storeDbConcurrency.test] TEST_DATABASE_URL not set, so DB-backed tests are SKIPPED.");
}

/** The tools spec from server/index.ts, copied so a change there fails here loudly. */
const TOOLS_SPEC: CollectionSpec = {
  table: "tools",
  orderBy: "`sort_order`, `name`",
  columns: [
    { js: "id", db: "id" },
    { js: "name", db: "name" },
    { js: "purpose", db: "purpose" },
    { js: "description", db: "description" },
    { js: "url", db: "url" },
    { js: "ctaLabel", db: "cta_label" },
    { js: "category", db: "category" },
    { js: "iconKind", db: "icon_kind" },
    { js: "icon", db: "icon" },
    { js: "visibility", db: "visibility" },
    { js: "roleIds", db: "role_ids", kind: "json" },
    { js: "gettingStarted", db: "getting_started" },
    { js: "order", db: "sort_order", kind: "int" },
    { js: "enabled", db: "enabled", kind: "bool" },
    { js: "lastCheckedAt", db: "last_checked_at", kind: "time" },
    { js: "lastCheckStatus", db: "last_check_status", kind: "int" },
    { js: "createdAt", db: "created_at", kind: "time", defaultNow: true },
    { js: "isExample", db: "is_example", kind: "bool" },
  ],
};

/** The submissions spec from server/index.ts, copied for the same reason. */
const SUBMISSIONS_SPEC: CollectionSpec = {
  table: "submissions",
  orderBy: "`submitted_at`, `id`",
  columns: [
    { js: "id", db: "id" },
    { js: "type", db: "type" },
    { js: "status", db: "status" },
    { js: "data", db: "data", kind: "json" },
    { js: "rewarded", db: "rewarded", kind: "bool" },
    { js: "userId", db: "user_id" },
    { js: "userName", db: "user_name" },
    { js: "submittedAt", db: "submitted_at", kind: "time" },
  ],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!configured)("replaceAll under two concurrent writers", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 });
    await pool.query("SET time_zone = '+00:00'");
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM tools");
    await pool.query("DELETE FROM collection_versions WHERE collection = 'tools'");
    for (const [id, name] of [["t1", "Village Site"], ["t2", "Member Chat"], ["t3", "Founders Vault"]]) {
      await pool.query(
        "INSERT INTO tools (id, name, purpose, url, cta_label, category, icon_kind, visibility, sort_order, enabled) " +
          "VALUES (?,?,?,?,?,?,?,?,?,1)",
        [id, name, "seeded", "https://example.org", "Open", "communication", "slug", "members", 1],
      );
    }
  });

  const freshRepo = async () => {
    const repo = dbCollection(pool, TOOLS_SPEC);
    await repo.load();
    return repo;
  };

  const toolRow = async (id: string) => {
    const [rows] = await pool.query<any[]>(
      "SELECT name, url, last_checked_at, last_check_status FROM tools WHERE id = ?",
      [id],
    );
    return rows[0] ?? null;
  };

  it("keeps a steward's rename that a background job's stale snapshot used to erase", async () => {
    const repo = await freshRepo();

    // WRITER A: the tools-link-check job (server/index.ts). Reads everything,
    // spends time on the link fetches, stamps its results, writes back.
    const job = (async () => {
      const all = repo.all() as any[];
      const due = all.filter((t) => !t.isExample && t.enabled !== false && !t.lastCheckedAt);
      await sleep(400);
      for (const t of due) {
        t.lastCheckedAt = new Date().toISOString();
        t.lastCheckStatus = 200;
      }
      await repo.replaceAll(all);
    })();

    // WRITER B: PUT /api/admin/tools/:id. A steward renames one tool while the
    // job is mid-flight, and their write commits FIRST.
    const steward = (async () => {
      const all = repo.all() as any[];
      await sleep(100);
      const idx = all.findIndex((t) => t.id === "t1");
      all[idx] = { ...all[idx], name: "The Steward Renamed This" };
      await repo.replaceAll(all);
    })();

    // Neither writer is refused. Both answers are true.
    await expect(Promise.all([job, steward])).resolves.toBeDefined();

    const t1 = await toolRow("t1");
    expect(t1.name, "the steward's rename must survive the job's stale snapshot").toBe(
      "The Steward Renamed This",
    );
    expect(t1.last_checked_at, "and the job's own field must land too").toBeTruthy();
    expect(Number(t1.last_check_status)).toBe(200);
    // The rows the job checked and nobody renamed are stamped as well.
    expect((await toolRow("t2")).last_checked_at).toBeTruthy();
  });

  it("keeps a tool created mid-flight that a stale whole-table write used to delete", async () => {
    const repo = await freshRepo();

    const job = (async () => {
      const all = repo.all() as any[];
      await sleep(400);
      await repo.replaceAll(all);
    })();

    const steward = (async () => {
      await sleep(100);
      await repo.insert({
        id: "t4",
        name: "Added Mid-Flight",
        purpose: "created while the job held a snapshot that predates it",
        url: "https://example.org/new",
        ctaLabel: "Open",
        category: "communication",
        iconKind: "slug",
        visibility: "members",
        order: 4,
        enabled: true,
      } as any);
    })();

    await Promise.all([job, steward]);

    const [rows] = await pool.query<any[]>("SELECT id FROM tools ORDER BY id");
    expect(rows.map((r) => r.id), "the DELETE-all must not take a row it never saw").toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
    ]);
    expect(repo.all().map((r: any) => r.id).sort()).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("still deletes what a writer meant to delete, even when somebody else wrote first", async () => {
    const repo = await freshRepo();

    // The steward deletes t2 from a snapshot taken before the job's write.
    const stale = repo.all().filter((t: any) => t.id !== "t2");
    // Meanwhile the job stamps every row and commits.
    const jobRows = repo.all() as any[];
    for (const t of jobRows) t.lastCheckStatus = 404;
    await repo.replaceAll(jobRows);

    await repo.replaceAll(stale);

    const [rows] = await pool.query<any[]>("SELECT id, last_check_status FROM tools ORDER BY id");
    expect(rows.map((r) => r.id), "the delete still happens").toEqual(["t1", "t3"]);
    expect(Number(rows[0].last_check_status), "and the other writer's field is kept").toBe(404);
  });

  it("does not resurrect rows a raw DELETE removed, once the cache has been reloaded", async () => {
    // This is `retireExamples` (server/lib/examples.ts): raw SQL removes the
    // example rows, then `wireExampleCaches` calls load() because the cache
    // would otherwise keep serving rows the database no longer has. It fires
    // from `onRealItemPublished`, which POST /api/admin/circles calls WITHOUT
    // awaiting, so a steward can be retiring examples at the same moment
    // another writer is holding a snapshot that still lists them.
    const repo = await freshRepo();
    const inFlight = repo.all() as any[]; // holds t1, t2, t3

    await pool.query("DELETE FROM tools WHERE id IN ('t2','t3')");
    await repo.load(); // the reload the raw deleter is required to do

    // The stale writer edits the row it still legitimately holds and writes back.
    inFlight[inFlight.findIndex((t) => t.id === "t1")].purpose = "edited while examples retired";
    await repo.replaceAll(inFlight);

    const [rows] = await pool.query<any[]>("SELECT id, purpose FROM tools ORDER BY id");
    expect(rows.map((r) => r.id), "the retired rows must stay retired").toEqual(["t1"]);
    expect(rows[0].purpose, "and the stale writer's own edit still lands").toBe(
      "edited while examples retired",
    );
  });

  it("names the fields two writers both changed instead of losing them quietly", async () => {
    const repo = await freshRepo();
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
    try {
      const mine = repo.all() as any[];
      const theirs = repo.all() as any[];
      theirs[theirs.findIndex((t) => t.id === "t1")].url = "https://example.org/theirs";
      await repo.replaceAll(theirs);

      mine[mine.findIndex((t) => t.id === "t1")].url = "https://example.org/mine";
      await repo.replaceAll(mine);
    } finally {
      console.warn = realWarn;
    }

    expect((await toolRow("t1")).url, "the later writer wins the field").toBe("https://example.org/mine");
    expect(warnings.join("\n")).toContain("t1.url");
    expect(warnings.join("\n")).toContain("merged a write read at version");
  });

  it("refuses, rather than guessing, when the snapshot is older than the retained history", async () => {
    const repo = await freshRepo();
    const ancient = repo.all();
    // Nine writes, one more than HISTORY_DEPTH, so the baseline for `ancient`
    // is gone and there is nothing honest to rebase onto.
    for (let i = 0; i < 9; i++) {
      const rows = repo.all() as any[];
      rows[0].purpose = `pass ${i}`;
      await repo.replaceAll(rows);
    }
    await expect(repo.replaceAll(ancient)).rejects.toBeInstanceOf(StaleSnapshotError);
    // Nothing was written: the ninth pass is still what the table says.
    expect((await toolRow("t1")).name).toBe("Village Site");
    const [rows] = await pool.query<any[]>("SELECT purpose FROM tools ORDER BY sort_order, name");
    expect(rows.some((r) => r.purpose === "pass 8")).toBe(true);
  });
});

/**
 * THE EMPTY PAYLOAD, which the version counter above cannot see.
 *
 * `replaceAll` decides whether a snapshot is stale from stamps carried ON THE
 * ROWS it is handed. An array with no rows carries no stamp, so `payloadSnapshot`
 * answers undefined, which is the signature of the boot seeding path: built from
 * scratch, never read, unguarded on purpose. The write therefore skips the stale
 * check and the rebase and runs `DELETE FROM <table>` against whatever the table
 * holds NOW.
 *
 * The removal idiom every admin delete uses, `replaceAll(all().filter(...))`,
 * produces exactly that array the moment it removes the LAST row. The reachable
 * case is `DELETE /api/admin/submissions/:id` in a village whose queue holds one
 * item, while a member raises a hand (`POST /api/map/roles/:id/raise-hand`) or a
 * stranger posts the public form. Both requests answer 200 and the new row is
 * gone, which is the same lost update 0122 closed, through the one door it left
 * open.
 *
 * Written against the real `submissions` spec for the same reason the block
 * above is written against the real `tools` spec: that is where it is reachable.
 */
describe.skipIf(!configured)("replaceAll when the payload came back empty", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 });
    await pool.query("SET time_zone = '+00:00'");
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM submissions");
    await pool.query("DELETE FROM collection_versions WHERE collection = 'submissions'");
    await pool.query(
      "INSERT INTO submissions (id, type, status, data, submitted_at) VALUES (?,?,?,?,?)",
      ["s1", "work-with-us", "new", JSON.stringify({ note: "the one already in the queue" }), "2026-09-01 10:00:00"],
    );
  });

  const freshRepo = async () => {
    const repo = dbCollection(pool, SUBMISSIONS_SPEC);
    await repo.load();
    return repo;
  };

  const idsInTable = async () => {
    const [rows] = await pool.query<any[]>("SELECT id FROM submissions ORDER BY id");
    return rows.map((r) => String(r.id));
  };

  /** What POST /api/map/roles/:id/raise-hand inserts. */
  const raisedHand = (id: string) =>
    ({
      id,
      type: "role-interest",
      status: "new",
      data: { roleId: "r1" },
      userId: "u9",
      userName: "A Member",
      submittedAt: new Date().toISOString(),
    }) as any;

  it("keeps a submission that arrived while an admin was deleting the last one", async () => {
    const repo = await freshRepo();

    // DELETE /api/admin/submissions/:id reads the whole table...
    const snapshot: any[] = repo.all();
    // ...and a raised hand lands in the gap before it writes back.
    await repo.insert(raisedHand("s2"));

    const filtered = snapshot.filter((s) => s.id !== "s1");
    expect(filtered, "removing the last row a caller saw leaves nothing to stamp").toHaveLength(0);

    const outcome = await repo.replaceAll(filtered).then(() => "written", (e) => e);

    expect(await idsInTable(), "nothing is written, so the hand that landed mid-flight survives").toEqual([
      "s1",
      "s2",
    ]);
    expect(outcome, "and an emptied payload is refused, never honoured blind").not.toBe("written");
    expect((outcome as any).code).toBe("empty_payload");
  });

  it("removes only the row it was handed, keeping one that arrived after the read", async () => {
    const repo = await freshRepo();
    const snapshot: any[] = repo.all();
    await repo.insert(raisedHand("s2"));

    const gone = snapshot.filter((s) => s.id === "s1").map((s) => String(s.id));
    expect(await repo.remove(gone), "it says how many rows it took").toBe(1);

    expect(await idsInTable(), "the admin's delete lands and the new hand stays").toEqual(["s2"]);
    expect(repo.all().map((r: any) => r.id), "and the cache says the same").toEqual(["s2"]);
  });

  it("stales every outstanding snapshot, so a removed row is not put back", async () => {
    const repo = await freshRepo();
    await repo.insert(raisedHand("s2"));
    const inFlight: any[] = repo.all(); // holds s1 and s2

    await repo.remove(["s2"]);

    inFlight[inFlight.findIndex((s) => s.id === "s1")].status = "reviewing";
    await repo.replaceAll(inFlight);

    expect(await idsInTable(), "the removed row stays removed").toEqual(["s1"]);
    const [rows] = await pool.query<any[]>("SELECT status FROM submissions WHERE id = 's1'");
    expect(rows[0].status, "and the stale writer's own edit still lands").toBe("reviewing");
  });

  it("takes no version and writes nothing when asked to remove ids that are not there", async () => {
    const repo = await freshRepo();
    const before: any[] = repo.all();
    expect(await repo.remove(["nope", "also-nope"])).toBe(0);
    expect(await idsInTable()).toEqual(["s1"]);
    // The snapshot taken before the no-op is still current, so writing it back
    // is the plain path and not a rebase.
    before[0].status = "reviewing";
    await repo.replaceAll(before);
    const [rows] = await pool.query<any[]>("SELECT status FROM submissions WHERE id = 's1'");
    expect(rows[0].status).toBe("reviewing");
  });

  it("still accepts an empty payload against an empty table, which is what a seed of nothing is", async () => {
    const repo = await freshRepo();
    await pool.query("DELETE FROM submissions");
    await repo.load();
    await expect(repo.replaceAll([]), "there is no row here to lose").resolves.toBeUndefined();
    expect(await idsInTable()).toEqual([]);
  });

  /**
   * PINNING THE REBASE, because a removal is the shape that exercises it and
   * nothing asserted this half before. This is what the code DOES; whether it
   * is what a reader wants is argued in the PR body, not changed here.
   */
  it("lets a removal prepared first delete a row somebody else has since moved along", async () => {
    const repo = await freshRepo();
    await repo.insert(raisedHand("s2"));

    // The admin reads the queue and decides to drop s1. The payload keeps s2,
    // so it is NOT empty and the stale check above does fire.
    const adminPayload: any[] = repo.all().filter((s: any) => s.id !== "s1");

    // A steward moves s1 along the pipeline and commits first.
    const steward: any[] = repo.all();
    steward[steward.findIndex((s) => s.id === "s1")].status = "in-conversation";
    await repo.replaceAll(steward);

    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
    try {
      await repo.replaceAll(adminPayload);
    } finally {
      console.warn = realWarn;
    }

    // A row present in the baseline and absent from the payload reads as one
    // the caller deleted, so the delete wins and the status change goes with
    // the row it was made on.
    expect(await idsInTable(), "freshly changed or not, the dropped row is deleted").toEqual(["s2"]);
    expect(warnings.join("\n"), "the merge is announced").toContain("merged a write read at version");
    expect(
      warnings.join("\n"),
      "and the change that went with the row is named nowhere: conflicts only cover surviving rows",
    ).not.toContain("s1.status");
  });
});

describe.skipIf(!configured)("the snapshot stamp itself", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
    await pool.query("SET time_zone = '+00:00'");
    await pool.query(
      "INSERT INTO tools (id, name, purpose, url, cta_label, category, icon_kind, visibility, sort_order, enabled) " +
        "VALUES ('s1','Stamped','seeded','https://example.org','Open','communication','slug','members',1,1)",
    );
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("rides through the spreads every caller builds its payload with", async () => {
    const repo = dbCollection(pool, TOOLS_SPEC);
    await repo.load();
    const row = repo.all()[0];
    const v = snapshotVersionOf(row);
    expect(typeof v).toBe("number");

    // PUT /api/admin/tools/:id builds `{ ...all[idx], ...req.body, id, isExample }`,
    // and PUT /api/admin/tools/order builds `{ ...t, order }`. A plain field
    // would survive these too; the point is that a SYMBOL does, which is what
    // lets the stamp stay out of everything below.
    expect(snapshotVersionOf({ ...row, ...JSON.parse('{"name":"Renamed"}') })).toBe(v);
    expect(snapshotVersionOf({ ...row, order: 3 })).toBe(v);
    expect(snapshotVersionOf(Object.assign({}, row))).toBe(v);
  });

  it("is invisible to JSON, to Object.keys, and to the database", async () => {
    const repo = dbCollection(pool, TOOLS_SPEC);
    await repo.load();
    const row = repo.all()[0];

    // An API response is JSON.stringify of exactly these objects.
    expect(JSON.parse(JSON.stringify(row))).not.toHaveProperty("snapshotVersion");
    expect(JSON.stringify(row)).not.toContain("snapshot");
    expect(Object.keys(row).some((k) => k.toLowerCase().includes("version"))).toBe(false);
    // A round trip through the writer must not invent a column either.
    await repo.replaceAll(repo.all());
    const [cols] = await pool.query<any[]>(
      "SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tools'",
    );
    expect(cols.map((r: any) => String(r.c)).some((c: string) => c.includes("snapshot"))).toBe(false);
  });

  it("hands out copies, so one caller's edits cannot reach the cache or another caller", async () => {
    const repo = dbCollection(pool, TOOLS_SPEC);
    await repo.load();
    const mine = repo.all()[0] as any;
    const yours = repo.all()[0] as any;
    mine.name = "Only Mine";
    expect(yours.name).toBe("Stamped");
    expect((repo.all()[0] as any).name).toBe("Stamped");
  });

  it("leaves a payload built from scratch unguarded, which is how boot seeding works", async () => {
    const repo = dbCollection(pool, TOOLS_SPEC);
    await repo.load();
    // Bump the version so a guarded write with the old stamp would rebase.
    await repo.replaceAll(repo.all());
    const seed = [
      {
        id: "seeded-only",
        name: "Seeded",
        purpose: "written by a boot seeder, never read first",
        url: "https://example.org/seed",
        ctaLabel: "Open",
        category: "communication",
        iconKind: "slug",
        visibility: "members",
        order: 1,
        enabled: true,
      },
    ];
    expect(snapshotVersionOf(seed[0])).toBeUndefined();
    await repo.replaceAll(seed as any);
    const [rows] = await pool.query<any[]>("SELECT id FROM tools");
    expect(rows.map((r) => r.id)).toEqual(["seeded-only"]);
  });
});

/**
 * THE LOOP TWO SAVES CAN MAKE, which neither writer could have made alone.
 *
 * `PUT /api/admin/circles/:id` checks the parenting it is handed against the
 * rows it read (`parentingRefusal`), and `replaceAll` then merges a stale
 * snapshot field by field. So two stewards saving at the same moment can each
 * be right and still leave Finance inside Business inside Finance: the merged
 * state is one neither request could have seen, so no row-by-row check in
 * either of them was ever going to catch it.
 *
 * The first test is the CONTROL. It runs the same two saves against a spec with
 * no `mergeRefusal` and asserts the loop lands, which is what the store did
 * before this change. Without it, the test below would pass just as happily
 * against a hook that never ran.
 */
const CIRCLE_COLUMNS: CollectionSpec["columns"] = [
  { js: "id", db: "id" },
  { js: "name", db: "name" },
  { js: "parentCircleId", db: "parent_circle_id" },
  { js: "order", db: "sort_order", kind: "int" },
];

const CIRCLES_UNGUARDED: CollectionSpec = {
  table: "circles",
  orderBy: "`sort_order`, `id`",
  columns: CIRCLE_COLUMNS,
};

const CIRCLES_GUARDED: CollectionSpec = {
  ...CIRCLES_UNGUARDED,
  mergeRefusal: (rows) => loopedCirclesRefusal(rows as any[]),
};

describe.skipIf(!configured)("a rebase that would merge a loop into the circles", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 });
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM circles");
    await pool.query("DELETE FROM collection_versions WHERE collection = 'circles'");
    for (const [id, name] of [["finance", "Finance Circle"], ["business", "Business Council"]]) {
      await pool.query("INSERT INTO circles (id, name, sort_order) VALUES (?,?,1)", [id, name]);
    }
  });

  /** Where every circle sits, as the table says it, which is the only honest reading. */
  const parents = async () => {
    const [rows] = await pool.query<any[]>("SELECT id, parent_circle_id FROM circles ORDER BY id");
    return Object.fromEntries(rows.map((r) => [String(r.id), r.parent_circle_id ?? null]));
  };

  /**
   * Two stewards read the same version. B commits Business inside Finance, then
   * A writes Finance inside Business from the snapshot that predates it.
   */
  const twoStewards = async (spec: CollectionSpec) => {
    const repo = dbCollection(pool, spec);
    await repo.load();
    const mine = repo.all() as any[];
    const theirs = repo.all() as any[];

    theirs[theirs.findIndex((c) => c.id === "business")].parentCircleId = "finance";
    await repo.replaceAll(theirs);

    mine[mine.findIndex((c) => c.id === "finance")].parentCircleId = "business";
    return () => repo.replaceAll(mine);
  };

  it("merges the loop when the collection says nothing, which is the defect", async () => {
    const realWarn = console.warn;
    console.warn = () => {};
    try {
      await (await twoStewards(CIRCLES_UNGUARDED))();
    } finally {
      console.warn = realWarn;
    }
    const after = await parents();
    expect(after, "each writer's own field survived, and together they are a loop").toEqual({
      business: "finance",
      finance: "business",
    });
    const links = Object.entries(after).map(([id, parentCircleId]) => ({ id, parentCircleId }));
    expect(circlesOnCycles(links), "and the shared rule agrees that is a loop").toEqual([
      "business",
      "finance",
    ]);
  });

  it("refuses the whole write when the collection carries the containment rule", async () => {
    const write = await twoStewards(CIRCLES_GUARDED);
    await expect(write()).rejects.toBeInstanceOf(MergeRefusedError);
    expect(await parents(), "nothing was written, so the earlier save stands alone").toEqual({
      business: "finance",
      finance: null,
    });
  });

  it("says which circles, in words a steward can act on", async () => {
    const write = await twoStewards(CIRCLES_GUARDED);
    const err: any = await write().catch((e) => e);
    expect(err).toBeInstanceOf(MergeRefusedError);
    expect(String(err.refusal)).toContain("Business Council");
    expect(String(err.refusal)).toContain("Finance Circle");
    expect(String(err.table)).toBe("circles");
  });

  it("lets an ordinary rebase through, so this is not a second stale-snapshot refusal", async () => {
    const repo = dbCollection(pool, CIRCLES_GUARDED);
    await repo.load();
    const mine = repo.all() as any[];
    const theirs = repo.all() as any[];

    theirs[theirs.findIndex((c) => c.id === "business")].name = "Business and Finance Council";
    await repo.replaceAll(theirs);

    mine[mine.findIndex((c) => c.id === "finance")].parentCircleId = "business";
    await repo.replaceAll(mine);

    expect(await parents(), "one steward renamed, the other nested, and both landed").toEqual({
      business: null,
      finance: "business",
    });
  });
});
