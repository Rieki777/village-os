/**
 * The derivation and the reader, against a real schema.
 *
 * The lane's other two test files are pure and pass with no database at all,
 * which means a session could watch its own new tests go green having never
 * once exercised the job, the dedupe or the SQL. This file is the answer to
 * that: every claim here needs the migration to have run.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { decidedThreadsToDerive, deriveDecisions } from "./villageBrain";
import { READERS, callReader, wireReaders, type ReaderViewer } from "./villageReaders";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let n = 0;

interface ThreadOpts {
  title?: string | null;
  body?: string;
  meta?: any;
  locked?: boolean;
  hidden?: boolean;
  isExample?: boolean;
  kind?: string;
  createdAt?: string;
}

/** One forum thread, exactly as the routes write them. */
async function thread(o: ThreadOpts = {}): Promise<string> {
  const id = `thr-test-${++n}`;
  await pool.query(
    "INSERT INTO forum_threads (id, category, author_id, title, body, kind, meta, locked_at, hidden_at, is_example, created_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      "governance",
      "u-author",
      o.title === undefined ? `Decision ${n}` : o.title,
      o.body ?? "The case that was made.",
      o.kind ?? "decision",
      JSON.stringify(o.meta === undefined ? { status: "decided", outcome: `Outcome ${n}` } : o.meta),
      o.locked === false ? null : new Date("2026-03-01T10:00:00Z"),
      o.hidden ? new Date("2026-03-02T10:00:00Z") : null,
      o.isExample ? 1 : 0,
      new Date(o.createdAt ?? "2026-03-01T10:00:00Z"),
    ],
  );
  return id;
}

const recordRows = async () => {
  const [rows] = await pool.query<any[]>(
    "SELECT id, slug, title, body, occurred_at, source, source_ref, section, is_example FROM village_record ORDER BY created_at, id",
  );
  return rows;
};

const member: ReaderViewer = { id: "u-member", isAdmin: false, holds: () => false };

describe.skipIf(!configured)("deriving decisions into the village record (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 });
    wireReaders({ moduleIsOn: () => true, boolVar: () => true });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("reads only threads that a decide route could have produced", async () => {
    const good = await thread({ title: "Quiet hours" });
    // Every one of these is a thread that LOOKS decided and is not.
    await thread({ title: "Forged", locked: false }); // create route sets no locked_at
    await thread({ title: "Hidden", hidden: true });
    await thread({ title: "A fixture", isExample: true });
    await thread({ title: "Still open", meta: { status: "open" } });
    await thread({ title: "Just a chat", kind: "discussion" });

    const found = await decidedThreadsToDerive(pool);
    expect(found.map((t) => t.id)).toEqual([good]);
  });

  it("files each decision once, and a rerun changes nothing", async () => {
    // The whole reason the job can run daily: it WILL see the same decision
    // again, and the second sighting must be a no-op rather than a second copy
    // of the village's history.
    const first = await deriveDecisions(pool);
    expect(first.scanned).toBe(1);
    expect(first.created).toBe(1);
    expect(first.alreadyDerived).toBe(0);
    expect(first.lost).toBe(0);

    const afterOne = await recordRows();
    const second = await deriveDecisions(pool);
    expect(second.scanned).toBe(1);
    expect(second.created).toBe(0);
    expect(second.alreadyDerived).toBe(1);
    expect(second.lost).toBe(0);
    expect(await recordRows()).toHaveLength(afterOne.length);
  });

  it("files it as a decision, dated from the thread, keyed to it", async () => {
    const [row] = await recordRows();
    expect(row.section).toBe("decisions");
    expect(row.source).toBe("decision");
    expect(row.source_ref).toBeTruthy();
    expect(String(row.title)).toBe("Quiet hours");
    expect(String(row.body)).toContain("Outcome");
    expect(new Date(row.occurred_at).toISOString()).toBe("2026-03-01T10:00:00.000Z");
    expect(Number(row.is_example)).toBe(0);
  });

  it("never derives an example thread, whatever its meta says", async () => {
    // A fixture cited as what THIS village decided is the single thing the
    // brain must never do.
    const rows = await recordRows();
    expect(rows.map((r) => String(r.title))).not.toContain("A fixture");
  });

  it("walks the backlog oldest first, so nothing is stranded behind a limit", async () => {
    await thread({ title: "Older", createdAt: "2025-01-01T00:00:00Z" });
    await thread({ title: "Newer", createdAt: "2026-08-01T00:00:00Z" });
    const found = await decidedThreadsToDerive(pool);
    const titles = found.map((t) => t.title);
    expect(titles.indexOf("Older")).toBeLessThan(titles.indexOf("Newer"));
  });

  it("counts a slug collision as lost rather than as already filed", async () => {
    // The slug is <date>-<source>-<title> with no id in it, against a UNIQUE
    // key. Two decisions with one title on one day collide, recordAppend's
    // catch hands back a slug belonging to a DIFFERENT decision, and from the
    // outside that is indistinguishable from "already derived". It is not.
    await thread({ title: "Same day same name", createdAt: "2026-05-05T09:00:00Z" });
    await thread({ title: "Same day same name", createdAt: "2026-05-05T17:00:00Z" });
    const r = await deriveDecisions(pool);
    expect(r.lost).toBe(1);
    expect(r.created).toBe(3); // Older, Newer, and the first of the pair
  });
});

describe.skipIf(!configured)("the record.decisions reader (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 });
    wireReaders({ moduleIsOn: () => true, boolVar: () => true });
    await pool.query(
      "INSERT INTO village_record (id, section, slug, title, body, occurred_at, source, source_ref, is_example) VALUES " +
        "(?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?)",
      [
        "rec-a", "decisions", "a-decision-old", "Water rights", "We settled the well.", new Date("2026-01-05T00:00:00Z"), "decision", "thr-a", 0,
        "rec-b", "decisions", "a-decision-new", "Quiet hours", "Adopted for a season.", new Date("2026-07-20T00:00:00Z"), "decision", "thr-b", 0,
        "rec-x", "decisions", "a-decision-fixture", "A shipped example", "Never this village.", new Date("2026-07-21T00:00:00Z"), "decision", "thr-x", 1,
      ],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("answers a member, newest first, without the fixtures", async () => {
    const out = await callReader("record.decisions", { pool, viewer: member });
    expect(out.ok).toBe(true);
    const rows = (out as any).data as any[];
    expect(rows.map((r) => r.title)).toEqual(["Quiet hours", "Water rights"]);
    expect(JSON.stringify(rows)).not.toContain("A shipped example");
    expect(rows[0].decidedOn).toBe("2026-07-20");
    expect(rows[0].summary).toContain("Adopted for a season");
  });

  it("reads nothing from another section", async () => {
    await pool.query(
      "INSERT INTO village_record (id, section, slug, title, body, source, is_example) VALUES (?,?,?,?,?,?,?)",
      ["rec-c", "calls", "a-call", "A call happened", "Notes.", "call", 0],
    );
    const out = await callReader("record.decisions", { pool, viewer: member });
    expect(JSON.stringify((out as any).data)).not.toContain("A call happened");
  });

  it("stays inside its own token cap", async () => {
    const reader = READERS.find((r) => r.key === "record.decisions")!;
    const out = await callReader("record.decisions", { pool, viewer: member });
    expect(JSON.stringify((out as any).data).length).toBeLessThanOrEqual(reader.maxTokens * 4);
  });
});
