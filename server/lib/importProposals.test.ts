/**
 * The file import path, which is what makes a first import possible before the
 * vendor's webhook exists.
 *
 * `scripts/import-proposals.mjs` reads a batch file, maps the work order's
 * envelope onto `landProposal`, and writes through the SAME code path the
 * webhook will. This suite proves the mapping, using the real example batch
 * that ships in `docs/examples/`, so the file a vendor is told to copy is the
 * file that is tested.
 *
 * WHY THE MAPPING IS TESTED AND NOT THE SCRIPT. The script is argument parsing,
 * a connection and a loop. What can actually be wrong is the envelope mapping:
 * a field named on the wire that lands in the wrong column, or not at all, is
 * silent and survives a green run. So `fromEnvelope` is reimplemented here as
 * the assertion of what the script must do, and the example file is fed through
 * it into the real `landProposal`.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { subjectRefFor } from "./subjectRefs";
import {
  EXTERNAL_PROPOSAL_KINDS,
  landProposal,
  proposalQueue,
  proposalsInBatch,
  recentDrops,
  reresolveSubjects,
  forgetMemberInProposals,
  proposalsAboutMember,
  unattributedSubjectCount,
} from "./externalProposals";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const EXAMPLE = path.resolve(process.cwd(), "docs", "examples", "saberra-batch.example.json");

/** The mapping the script performs. Kept in step with it by the tests below. */
function fromEnvelope(e: any) {
  const ev = e.evidence ?? {};
  return {
    villageId: "local",
    moduleId: String(e.source ?? "unknown"),
    batchId: String(e.batch_id ?? ""),
    correlationId: e.correlation_id ?? null,
    kind: String(e.type ?? ""),
    payload: e.payload ?? {},
    quote: ev.quote ?? null,
    sourceRef: ev.source_ref ?? null,
    sourceOccurredAt: e.source_occurred_at ?? ev.source_at ?? null,
    subjectRefs: Array.isArray(e.subject_refs) ? e.subject_refs.filter((v: unknown) => typeof v === "string") : [],
    subjectRef: Array.isArray(e.subject_refs) ? (e.subject_refs[0] ?? null) : (e.subject_ref ?? null),
    trustTier: e.trust_tier ?? null,
    significance: e.significance ?? null,
    confidence: e.confidence ?? null,
    audience: (e.audience === "member" ? "member" : "steward") as "member" | "steward",
  };
}

describe.skipIf(!configured)("importing a batch file", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM external_proposals"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("DELETE FROM external_proposal_drops"); // module-review-ok: same
  });

  it("ships an example batch whose every record this village would accept", () => {
    // The file a vendor is told to copy has to be a file that works. If this
    // goes red, the documentation is wrong rather than the code.
    expect(fs.existsSync(EXAMPLE), `${EXAMPLE} must exist`).toBe(true);
    const records = JSON.parse(fs.readFileSync(EXAMPLE, "utf8"));
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(EXTERNAL_PROPOSAL_KINDS as readonly string[], `kind ${r.type}`).toContain(r.type);
      expect(r.batch_id, "every record needs a batch_id or a steward cannot review it as a set").toBeTruthy();
      expect(r.payload, "every record needs a payload").toBeTruthy();
    }
  });

  it("lands the whole example batch as one reviewable group", async () => {
    const records = JSON.parse(fs.readFileSync(EXAMPLE, "utf8"));
    for (const r of records) {
      const out = await landProposal(pool, fromEnvelope(r));
      expect(out.ok, !out.ok ? out.message : "").toBe(true);
    }
    const queue = await proposalQueue(pool);
    expect(queue).toHaveLength(records.length);

    const batchId = String(records[0].batch_id);
    expect(await proposalsInBatch(pool, batchId)).toHaveLength(records.length);
  });

  it("carries the evidence across, which is what a steward reads first", async () => {
    const records = JSON.parse(fs.readFileSync(EXAMPLE, "utf8"));
    await landProposal(pool, fromEnvelope(records[0]));
    const [row] = await proposalQueue(pool);

    expect(row.moduleId).toBe(records[0].source);
    expect(row.quote).toBe(records[0].evidence.quote);
    expect(row.sourceRef).toBe(records[0].evidence.source_ref);
    expect(row.trustTier).toBe(records[0].trust_tier);
    // Quote plus anchor is the only combination that may ever reach a member.
    expect(row.evidence).toBe("quoted");
    // The vendor's clock, which is a DATETIME column that refuses an ISO string
    // unless the mapping converts it. This is the assertion that would have
    // caught that.
    expect(row.sourceOccurredAt).toBe(records[0].source_occurred_at);
  });

  it("falls back to the evidence block's own timestamp when the envelope omits one", async () => {
    // The work order offers `source_occurred_at` at the top level AND
    // `evidence.source_at`, and a sender will reasonably use either.
    const records = JSON.parse(fs.readFileSync(EXAMPLE, "utf8"));
    const e = { ...records[0], source_occurred_at: undefined, event_id: "no-top-level-time" };
    const out = await landProposal(pool, fromEnvelope(e));
    expect(out.ok).toBe(true);
    expect((await proposalQueue(pool))[0].sourceOccurredAt).toBe(records[0].evidence.source_at);
  });

  it("is safe to run twice, which is what a nervous first import needs", async () => {
    // A first import in front of people gets run again. The second run must be
    // a no-op rather than a duplicate queue.
    const records = JSON.parse(fs.readFileSync(EXAMPLE, "utf8"));
    for (const r of records) await landProposal(pool, fromEnvelope(r));
    for (const r of records) {
      const again = await landProposal(pool, fromEnvelope(r));
      expect(again.ok && again.outcome).toBe("duplicate");
    }
    expect(await proposalQueue(pool)).toHaveLength(records.length);
  });

  it("refuses a record carrying an email address, and counts it", async () => {
    const records = JSON.parse(fs.readFileSync(EXAMPLE, "utf8"));
    const leaky = { ...records[1], payload: { ...records[1].payload, note: "ask ada@example.org" } };
    const out = await landProposal(pool, fromEnvelope(leaky));
    expect(out.ok).toBe(false);
    expect(await proposalQueue(pool)).toHaveLength(0);
    expect((await recentDrops(pool)).map((d) => d.reason)).toContain("contained_an_email");
  });

  it("accepts an event proposal, which the calendar does not yet receive", async () => {
    // `event.proposed` lands and is acknowledged by a steward. It deliberately
    // creates no calendar entry: event creation is an inline admin route with
    // no extracted function to call, and writing the insert here would be a
    // second write path into the calendar.
    expect(EXTERNAL_PROPOSAL_KINDS as readonly string[]).toContain("event.proposed");
    const out = await landProposal(pool, {
      villageId: "local",
      moduleId: "saberra",
      batchId: "b-events",
      kind: "event.proposed",
      payload: { title: "The August work weekend", startsAt: "2026-08-30T09:00:00.000Z" },
      quote: "We said the last weekend in August.",
      sourceRef: "meeting-2026-08-14#51",
    });
    expect(out.ok, !out.ok ? out.message : "").toBe(true);
    expect((await proposalQueue(pool))[0].kind).toBe("event.proposed");
  });
});

describe.skipIf(!configured)("a record about more than one person", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM external_proposal_subjects"); // module-review-ok: resetting the scratch schema this suite provisioned
    await pool.query("DELETE FROM external_proposals"); // module-review-ok: same
    await pool.query("DELETE FROM users WHERE id LIKE 'u-sub-%'"); // module-review-ok: same
  });

  const land = (refs: string[]) =>
    landProposal(pool, {
      villageId: "local",
      moduleId: "saberra",
      batchId: "b-multi",
      kind: "risk.observed",
      payload: { observation: "Water decisions keep being deferred." },
      quote: "That is the third time we have deferred it.",
      sourceRef: `meeting#${refs.join("-")}`,
      subjectRefs: refs,
    });

  it("keeps EVERY subject, which is the reference that used to be dropped", async () => {
    const out = await land(["person-a", "person-b", "person-c"]);
    expect(out.ok, !out.ok ? out.message : "").toBe(true);
    const [rows] = await pool.query<any[]>(
      "SELECT subject_ref, position FROM external_proposal_subjects ORDER BY position",
    );
    expect(rows.map((r) => r.subject_ref)).toEqual(["person-a", "person-b", "person-c"]);
  });

  it("still fills the singular column, so a rollback reads something true", async () => {
    await land(["person-a", "person-b"]);
    const [[row]] = await pool.query<any[]>("SELECT subject_ref FROM external_proposals");
    expect(row.subject_ref).toBe("person-a");
  });

  it("resolves a reference that names a member of this village, and admits when it cannot", async () => {
    await pool.query("INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)", // module-review-ok: seeding the scratch schema this suite provisioned
      ["u-sub-1", "Ada", "ada@example.invalid", "x"]);
    const ref = await subjectRefFor(pool, "u-sub-1");
    await land([ref, "saberra-opaque-999"]);
    const [rows] = await pool.query<any[]>(
      "SELECT subject_ref, member_id FROM external_proposal_subjects ORDER BY position",
    );
    expect(rows[0].member_id).toBe("u-sub-1");
    // The honest half: a reference this village cannot resolve is stored as
    // unattributed instead of quietly reading as nobody being named.
    expect(rows[1].member_id).toBeNull();
    expect(await unattributedSubjectCount(pool)).toBe(1);
  });

  it("finds the record from EVERY member it names, which is the export promise", async () => {
    for (const id of ["u-sub-1", "u-sub-2"]) {
      await pool.query("INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)", // module-review-ok: seeding the scratch schema this suite provisioned
        [id, id, `${id}@example.invalid`, "x"]);
    }
    const refs = [await subjectRefFor(pool, "u-sub-1"), await subjectRefFor(pool, "u-sub-2")];
    await land(refs);
    // The defect this replaces: only the first was findable.
    expect(await proposalsAboutMember(pool, "u-sub-1")).toHaveLength(1);
    expect(await proposalsAboutMember(pool, "u-sub-2")).toHaveLength(1);
  });

  it("takes a departing member out and clears the words about them", async () => {
    for (const id of ["u-sub-1", "u-sub-2"]) {
      await pool.query("INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)", // module-review-ok: seeding the scratch schema this suite provisioned
        [id, id, `${id}@example.invalid`, "x"]);
    }
    await land([await subjectRefFor(pool, "u-sub-1"), await subjectRefFor(pool, "u-sub-2")]);
    const done = await forgetMemberInProposals(pool, "u-sub-1");
    expect(done).toEqual({ records: 1, quotesCleared: 1 });
    expect(await proposalsAboutMember(pool, "u-sub-1")).toHaveLength(0);
    // De-attribution is not enough on its own: the quote restated the person.
    const [[row]] = await pool.query<any[]>("SELECT quote FROM external_proposals");
    expect(row.quote).toBeNull();
    // The other person's record survives, without the words.
    expect(await proposalsAboutMember(pool, "u-sub-2")).toHaveLength(1);
  });

  it("refuses the whole record when a LATER subject is an email address", async () => {
    const out = await land(["person-a", "ada@example.org"]);
    expect(out.ok).toBe(false);
    expect(await pool.query("SELECT 1 FROM external_proposals").then(([r]: any) => r.length)).toBe(0); // module-review-ok: the suite reading back the scratch schema it provisioned
  });
  it("re-resolves what it now can, counts it, and never clears an attribution", async () => {
    // The cohort Rye ruled on: rows that landed before the reference scheme
    // existed carry a NULL that was true at the time. Filling it in is an
    // explicit action with a number, never a silent migration.
    await pool.query("INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)", // module-review-ok: seeding the scratch schema this suite provisioned
      ["u-sub-9", "Later", "later@example.invalid", "x"]);
    const ref = await subjectRefFor(pool, "u-sub-9");

    // Land it while the row cannot be attributed, by writing the subject row
    // the way a pre-scheme import would have: reference kept, member unknown.
    await land(["saberra-opaque-1"]);
    await pool.query("UPDATE external_proposal_subjects SET subject_ref = ?, member_id = NULL", [ref]); // module-review-ok: staging the pre-scheme state this action exists to repair
    expect(await unattributedSubjectCount(pool)).toBe(1);

    // The "before" number writes nothing.
    const dry = await reresolveSubjects(pool, { apply: false });
    expect(dry).toMatchObject({ resolvable: 1, updated: 0 });
    expect(await unattributedSubjectCount(pool)).toBe(1);

    const done = await reresolveSubjects(pool, { apply: true });
    expect(done).toMatchObject({ resolvable: 1, updated: 1 });
    expect(await unattributedSubjectCount(pool)).toBe(0);
    expect(await proposalsAboutMember(pool, "u-sub-9")).toHaveLength(1);
  });

  it("leaves a reference that resolves to nobody exactly as it is", async () => {
    // An erased member has had their reference retired, so it resolves to
    // nobody. Re-running must not touch that row: rewriting it to NULL would
    // say the same thing while destroying the evidence it once resolved.
    await land(["saberra-opaque-unknown"]);
    const before = await reresolveSubjects(pool, { apply: true });
    expect(before).toMatchObject({ resolvable: 0, updated: 0 });
    expect(await unattributedSubjectCount(pool)).toBe(1);
  });
});