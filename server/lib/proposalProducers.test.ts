/**
 * WHO IS ALLOWED TO PROPOSE.
 *
 * Rye's ruling, 2026-09-23: "it should be quest.proposed can come from saberra
 * or users directly or other channels so it needs to be flexible and built into
 * this flow."
 *
 * The inbox reads vendor-shaped — `moduleId`, `originModuleId`, routes behind
 * `requireModule` — and that spelling invites somebody to make it true by
 * adding a registry check, at which point a member submitting a quest has no
 * way in that does not pretend to be a vendor with a module. Nothing in the
 * write path does that today: `moduleId` is a 64-character string used for the
 * dedupe key, the identity key and drop counting, and it is checked for length
 * and nothing else.
 *
 * So this file pins the property rather than the spelling. It is a guard
 * against a future narrowing, and it fails loudly if somebody adds that check.
 *
 * The second case is the one that would be discovered late and hurt: dedupe
 * covers the producer, so two channels proposing the same thing are two
 * proposals. If the producer were dropped from that key, whichever channel
 * posted second would be silently swallowed, and a member would be told their
 * quest was received while a steward never saw it.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { dedupeKeyFor, landProposal, proposalQueue } from "./externalProposals";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const quest = {
  villageId: "v1",
  batchId: "b1",
  kind: "quest.proposed",
  payload: { title: "Clear the intake line", aim: "Water reaches the tanks again" },
  quote: "The line has been blocked since the storm.",
  sourceRef: "meeting-2026-09-23#7",
  trustTier: "extracted_unreviewed",
};

describe.skipIf(!configured)("who is allowed to propose", () => {
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
    await pool.query("DELETE FROM health_events"); // module-review-ok: same
  });

  it("takes a quest from a producer that is not a module at all", async () => {
    // No module named `member` exists or ever will. If somebody adds a registry
    // check to the write path, this is the test that goes red, and the comment
    // above says why that would be wrong.
    const r = await landProposal(pool, { ...quest, moduleId: "member" });
    expect(r.ok).toBe(true);
    const queue = await proposalQueue(pool);
    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe("quest.proposed");
  });

  it("KEEPS BOTH when two channels propose the same thing, instead of swallowing the second", async () => {
    const a = await landProposal(pool, { ...quest, moduleId: "saberra" });
    const b = await landProposal(pool, { ...quest, moduleId: "member" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const queue = await proposalQueue(pool);
    expect(queue).toHaveLength(2);
    // The reason it works: the producer is part of the dedupe key.
    expect(dedupeKeyFor({ ...quest, moduleId: "saberra" })).not.toBe(
      dedupeKeyFor({ ...quest, moduleId: "member" }),
    );
  });

  it("still deduplicates within one channel, so a retry is not a second proposal", async () => {
    await landProposal(pool, { ...quest, moduleId: "member" });
    await landProposal(pool, { ...quest, moduleId: "member" });
    expect(await proposalQueue(pool)).toHaveLength(1);
  });

  it("applies the same refusals to every producer, with no privileged channel", async () => {
    // A direct submission is not more trusted than a vendor's. The email
    // refusal is the one that matters most and the one a new intake route
    // would be most tempted to skip.
    const r = await landProposal(pool, {
      ...quest,
      moduleId: "member",
      payload: { title: "Clear the line", note: "reach me at ada@example.org" },
    });
    expect(r.ok).toBe(false);
    expect(await proposalQueue(pool)).toHaveLength(0);
  });
});
