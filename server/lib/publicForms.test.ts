/**
 * A quest idea from the public form reaches the review queue, and nothing about
 * the person comes with it (Rye, 2026-09-14: people should be able to propose
 * quests).
 *
 * The submission is the record and the proposal is derived, so every case
 * checks both: that the submission was stored, and whether a proposal was. The
 * submissions repository is a recorder, because what it does with a row is not
 * this file's subject. `quest_proposals` and `external_proposal_drops` are the
 * real tables, read back the way /review reads them.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { forgetProposer } from "../repos/questProposals";
import { recentDrops } from "./externalProposals";
import {
  ideasProposedBy,
  landPublicSubmission,
  OPEN_IDEAS_PER_MEMBER,
  OPEN_VISITOR_IDEAS,
  titleFrom,
} from "./publicForms";
import { questProposalQueue } from "./questProposals";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let stored: Array<Record<string, unknown>> = [];
const submissionsRepo = {
  insert: async (entry: Record<string, unknown>) => {
    stored.push(entry);
  },
};

const IDEA = {
  title: "Build a seed library shelf",
  name: "Ada Wren",
  email: "ada@example.test",
  whatYouWantToDo: "Turn the old bookcase by the gate into a seed library.",
  resourcesBringing: "Two afternoons and my own seeds",
  resourcesNeeded: "Some jars and labels",
  compensation: "Nothing, it is for the village",
  timelineMilestones: "Shelf up by the next moon",
};

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({
  id: `sub-${++n}`,
  type: "quest-proposal",
  data: { ...IDEA },
  status: "new",
  rewarded: false,
  submittedAt: new Date().toISOString(),
  ...over,
});

/** Every proposal derived from this submission, straight from the table. */
const proposalsFor = async (submissionId: string) => {
  const [rows]: any = await pool.query( // module-review-ok: reading back what the lib wrote, on the S5 scratch schema this suite provisioned
    "SELECT * FROM quest_proposals WHERE source_ref = ?",
    [`submission:${submissionId}`],
  );
  return rows as Array<Record<string, any>>;
};

/** Land ideas one after another, and return their submission ids in order. */
const landMany = async (count: number, over: (i: number) => Record<string, unknown>) => {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const e = entry(over(i));
    await landPublicSubmission(submissionsRepo, pool, e);
    ids.push(e.id);
  }
  return ids;
};

describe.skipIf(!configured)("a quest idea from the public form reaches the review queue", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    // Room for a burst to hold its own connections at once, and warmed, so the
    // burst case below races the code and not the driver opening sockets.
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 12 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    const warm = await Promise.all(Array.from({ length: 8 }, () => pool.getConnection()));
    warm.forEach((c) => c.release());
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    stored = [];
    await pool.query("DELETE FROM quest_proposals"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("DELETE FROM external_proposal_drops"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
  });

  it("stores the submission and queues the idea for a steward, with the idea and without the person", async () => {
    const e = entry({ userId: "u-ada", userName: "Ada Wren" });
    const { proposal } = await landPublicSubmission(submissionsRepo, pool, e);
    expect(proposal?.ok).toBe(true);
    expect(stored).toHaveLength(1);

    const [row, ...more] = await proposalsFor(e.id);
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({
      title: "Build a seed library shelf",
      description: "Turn the old bookcase by the gate into a seed library.",
      module_id: "propose-quest",
      proposed_by: "u-ada",
      proposed_by_kind: "human",
      status: "proposed",
      // The batch names the submission. Nothing on the row but proposed_by is made from the member.
      batch_id: `propose-quest:member:${e.id}`,
    });
    expect(String(row.rationale)).toBe(
      [
        "What they bring: Two afternoons and my own seeds",
        "What they need: Some jars and labels",
        "What they ask in return: Nothing, it is for the village",
        "Timeline: Shelf up by the next moon",
      ].join("\n"),
    );
    // Who they are stays in the submission.
    expect(JSON.stringify(row)).not.toContain("ada@example.test");
    expect(JSON.stringify(row)).not.toContain("Ada Wren");

    // And it is what /review reads.
    const queue = await questProposalQueue(pool, "proposed");
    expect(queue.map((q) => q.sourceRef)).toContain(`submission:${e.id}`);
  });

  it("queues a visitor's idea with no author", async () => {
    const e = entry();
    await landPublicSubmission(submissionsRepo, pool, e);
    const [row] = await proposalsFor(e.id);
    expect(row).toMatchObject({ proposed_by: null, proposed_by_kind: "human", batch_id: `propose-quest:visitor:${e.id}` });
  });

  it("titles an idea with no title from the first line of what the person wants to do", async () => {
    expect(titleFrom({ whatYouWantToDo: "Paint the pump house\nwith the kids on Saturday" })).toBe("Paint the pump house");
    const long = "Organise a monthly repair cafe in the barn where neighbours bring broken tools and leave with working ones";
    const title = titleFrom({ whatYouWantToDo: long });
    expect(title.length).toBeLessThanOrEqual(80);
    expect(long.startsWith(title)).toBe(true);

    const e = entry({ data: { ...IDEA, title: "  " } });
    await landPublicSubmission(submissionsRepo, pool, e);
    const [row] = await proposalsFor(e.id);
    expect(row.title).toBe("Turn the old bookcase by the gate into a seed library.");
  });

  it("keeps an idea with an email address in its answers out of the queue, and the submission still stands", async () => {
    const e = entry({ data: { ...IDEA, resourcesNeeded: "Jars. Write to me at ada@example.test" } });
    const { proposal } = await landPublicSubmission(submissionsRepo, pool, e);
    expect(proposal).toMatchObject({ ok: false, heldBack: "contained_an_email" });
    expect(stored).toHaveLength(1);
    expect(await proposalsFor(e.id)).toHaveLength(0);
  });

  it("queues nothing for any other form, and still stores it", async () => {
    const e = entry({ type: "work-with-us" });
    const { proposal } = await landPublicSubmission(submissionsRepo, pool, e);
    expect(proposal).toBeNull();
    expect(stored).toHaveLength(1);
    expect(await proposalsFor(e.id)).toHaveLength(0);
  });

  it("keeps a member's idea past their allowance in the inbox only, and a decision opens a place", async () => {
    const ids = await landMany(OPEN_IDEAS_PER_MEMBER + 1, (i) => ({ userId: "u-busy", data: { ...IDEA, title: `Idea ${i}` } }));
    expect(stored).toHaveLength(OPEN_IDEAS_PER_MEMBER + 1);
    for (const id of ids.slice(0, OPEN_IDEAS_PER_MEMBER)) expect(await proposalsFor(id)).toHaveLength(1);
    expect(await proposalsFor(ids[OPEN_IDEAS_PER_MEMBER])).toHaveLength(0);

    // Another member is not held back by this one.
    const [other] = await landMany(1, () => ({ userId: "u-other" }));
    expect(await proposalsFor(other)).toHaveLength(1);

    // The allowance counts open ideas: once a steward decides one, the member can propose again.
    await pool.query( // module-review-ok: standing in for a steward's rejection on the scratch schema this suite provisioned
      "UPDATE quest_proposals SET status = 'rejected' WHERE source_ref = ?",
      [`submission:${ids[0]}`],
    );
    const [again] = await landMany(1, () => ({ userId: "u-busy", data: { ...IDEA, title: "Idea again" } }));
    expect(await proposalsFor(again)).toHaveLength(1);
  });

  it("keeps visitors' ideas past their shared allowance in the inbox only, and members count apart", async () => {
    const ids = await landMany(OPEN_VISITOR_IDEAS + 1, (i) => ({ data: { ...IDEA, title: `Visitor idea ${i}` } }));
    expect(stored).toHaveLength(OPEN_VISITOR_IDEAS + 1);
    for (const id of ids.slice(0, OPEN_VISITOR_IDEAS)) expect(await proposalsFor(id)).toHaveLength(1);
    expect(await proposalsFor(ids[OPEN_VISITOR_IDEAS])).toHaveLength(0);

    const [member] = await landMany(1, () => ({ userId: "u-member" }));
    expect(await proposalsFor(member)).toHaveLength(1);
  });

  it("keeps both allowances when ideas arrive together", async () => {
    const burst = (count: number, over: (i: number) => Record<string, unknown>) =>
      Promise.all(Array.from({ length: count }, (_, i) => landPublicSubmission(submissionsRepo, pool, entry(over(i)))));
    await Promise.all([
      burst(OPEN_IDEAS_PER_MEMBER + 5, (i) => ({ userId: "u-burst", data: { ...IDEA, title: `Burst ${i}` } })),
      burst(OPEN_VISITOR_IDEAS + 5, (i) => ({ data: { ...IDEA, title: `Crowd ${i}` } })),
    ]);
    const [rows]: any = await pool.query( // module-review-ok: reading back what the lib wrote, on the S5 scratch schema this suite provisioned
      "SELECT proposed_by, COUNT(*) AS n FROM quest_proposals GROUP BY proposed_by",
    );
    const counts = Object.fromEntries(rows.map((r: any) => [String(r.proposed_by), Number(r.n)]));
    expect(counts).toEqual({ "u-burst": OPEN_IDEAS_PER_MEMBER, null: OPEN_VISITOR_IDEAS });
  });

  it("counts every idea it holds back where /review reads refusals", async () => {
    await landPublicSubmission(submissionsRepo, pool, entry({ data: { ...IDEA, compensation: "Write to ada@example.test" } }));
    await landPublicSubmission(submissionsRepo, pool, entry({ data: { name: "Ada Wren", email: "ada@example.test" } }));
    await landMany(OPEN_IDEAS_PER_MEMBER + 1, (i) => ({ userId: "u-full", data: { ...IDEA, title: `Full ${i}` } }));

    const drops = await recentDrops(pool);
    expect(drops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ moduleId: "propose-quest", reason: "contained_an_email", dropped: 1 }),
        expect.objectContaining({ moduleId: "propose-quest", reason: "empty_payload", dropped: 1 }),
        expect.objectContaining({ moduleId: "propose-quest", reason: "over_allowance", dropped: 1 }),
      ]),
    );
    expect(drops.reduce((total, d) => total + d.dropped, 0)).toBe(3);
  });

  it("cuts an idea to what the table keeps before reading it, so a megabyte cannot stall the form", async () => {
    const huge = "a".repeat(1_000_000);
    const started = Date.now();
    const e = entry({ data: { ...IDEA, title: huge, whatYouWantToDo: huge, resourcesNeeded: huge } });
    const { proposal } = await landPublicSubmission(submissionsRepo, pool, e);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(proposal?.ok).toBe(true);
    const [row] = await proposalsFor(e.id);
    expect(String(row.title)).toHaveLength(200);
    expect(String(row.description)).toHaveLength(8000);
    expect(String(row.rationale).length).toBeLessThanOrEqual(8000);

    // What the screen reads is what the table keeps: an address past the kept width is cut away, never stored.
    const tail = entry({ data: { ...IDEA, whatYouWantToDo: `${"b".repeat(9000)} ada@example.test` } });
    expect((await landPublicSubmission(submissionsRepo, pool, tail)).proposal?.ok).toBe(true);
    const [kept] = await proposalsFor(tail.id);
    expect(String(kept.description)).not.toContain("@");
  });

  it("lists a member's ideas for their own export, and nobody else's", async () => {
    await landPublicSubmission(submissionsRepo, pool, entry({ userId: "u-export", data: { ...IDEA, title: "Mine" } }));
    await landPublicSubmission(submissionsRepo, pool, entry({ userId: "u-else", data: { ...IDEA, title: "Theirs" } }));
    const listed = await ideasProposedBy(pool, "u-export");
    expect(listed.map((i) => i.title)).toEqual(["Mine"]);
    expect(listed[0]).toMatchObject({ status: "proposed", rationale: expect.stringContaining("What they bring") });
    expect(Object.keys(listed[0])).not.toContain("decided_by");
  });

  it("erasure clears the author and keeps the idea", async () => {
    const e = entry({ userId: "u-leaving" });
    await landPublicSubmission(submissionsRepo, pool, e);
    expect(await forgetProposer(pool, "u-leaving")).toBe(1);
    const [row] = await proposalsFor(e.id);
    expect(row).toMatchObject({ proposed_by: null, title: "Build a seed library shelf" });
    expect(await ideasProposedBy(pool, "u-leaving")).toHaveLength(0);
  });
});
