/**
 * The way OUT of a draft that cannot publish.
 *
 * THE DEFECT THIS GUARDS. Before `withdrawDraft`, the only status writes on
 * `org_drafts` were open to published and published to reverted. `publishDraft`
 * refuses a draft with any blocked line, no change can be removed from an open
 * draft, and nothing could close one. So a blocked draft was unpublishable AND
 * unclosable, and it held one of the `openDraftCap` slots forever.
 *
 * It is reached by the ordinary path, not an exotic one: a machine batch larger
 * than `draftChangeCap`, or a seat naming a circle that does not exist yet,
 * which is what a vendor's first org import looks like.
 *
 * The tests below are written against the BEHAVIOUR, so they still mean
 * something if the implementation moves: a blocked draft refuses to publish, it
 * can be withdrawn, withdrawing frees the slot, and the proposals that went
 * into it come back to the queue instead of being stranded as accepted against
 * a draft that will never apply.
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
  listDrafts,
  previewDraft,
  publishDraft,
  withdrawDraft,
} from "./orgDrafts";
import { landProposal, markProposalDecided, proposalQueue, reopenProposalsFor } from "./externalProposals";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

/** A draft holding more seats than the cap allows, which is the vendor case. */
async function overCapDraft(cap: number) {
  const made = await createDraft(pool, {
    title: "The land circle, as the meetings describe it",
    createdBy: "u-steward",
    sourceKind: "agent",
    sourceModuleId: "saberra",
    openCap: 99,
  });
  if (!made.ok) throw new Error(made.error);
  for (let i = 0; i < cap + 4; i += 1) {
    const r = await addChange(pool, made.id, {
      op: "create_seat",
      orgRoleId: `seat-${i}`,
      payload: { name: `Proposed Seat ${i}`, seats: 1 },
    });
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
  }
  return made.id;
}

describe.skipIf(!configured)("a draft that cannot publish can still be closed", () => {
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
    await pool.query("DELETE FROM external_proposals"); // module-review-ok: same
  });

  it("adds every change a machine sends, because addChange applies no cap", async () => {
    // Documenting the shape rather than approving of it. The cap lives in
    // previewDraft, so the rows are already written by the time anything
    // objects, which is exactly why a way out is needed.
    const cap = draftChangeCap(2);
    const id = await overCapDraft(cap);
    const [[n]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM org_draft_changes WHERE draft_id = ?", [id],
    );
    expect(Number(n.n)).toBe(cap + 4);
  });

  it("blocks the lines past the cap and refuses to publish", async () => {
    const cap = draftChangeCap(2);
    const id = await overCapDraft(cap);
    const preview = await previewDraft(pool, id, cap);
    expect(preview.blocked).toBeGreaterThan(0);
    const r = await publishDraft(pool, id, "u-steward", cap);
    expect(r.ok).toBe(false);
  });

  it("withdraws it, which is the transition that did not exist", async () => {
    const cap = draftChangeCap(2);
    const id = await overCapDraft(cap);
    const w = await withdrawDraft(pool, id);
    expect(w.ok, !w.ok ? w.error : "").toBe(true);
    const [[d]] = await pool.query<any[]>("SELECT status FROM org_drafts WHERE id = ?", [id]);
    expect(d.status).toBe("withdrawn");
  });

  it("frees the open-draft slot, which is the harm that compounds", async () => {
    const cap = draftChangeCap(2);
    const id = await overCapDraft(cap);
    const openNow = async () => {
      const [[r]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_drafts WHERE status = 'open'");
      return Number(r.n);
    };
    expect(await openNow()).toBe(1);
    await withdrawDraft(pool, id);
    expect(await openNow()).toBe(0);
  });

  it("keeps the withdrawn draft rather than deleting it", async () => {
    const id = await overCapDraft(draftChangeCap(2));
    await withdrawDraft(pool, id);
    expect((await listDrafts(pool)).some((d) => d.id === id)).toBe(true);
  });

  it("refuses to withdraw anything that is not open, and says which", async () => {
    const id = await overCapDraft(draftChangeCap(2));
    await withdrawDraft(pool, id);
    const again = await withdrawDraft(pool, id);
    expect(again.ok).toBe(false);
    expect(!again.ok && again.error).toContain("withdrawn");
    const missing = await withdrawDraft(pool, "no-such-draft");
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error).toContain("No such draft");
  });

  it("puts the proposals back in the queue instead of stranding them", async () => {
    // The half that matters to a vendor: accepted-and-stranded looks like
    // success from their side, so they never resend.
    const landed = await landProposal(pool, {
      villageId: "local",
      moduleId: "saberra",
      batchId: "b-1",
      kind: "role.proposed",
      payload: { name: "Water Steward" },
      quote: "The well needs one person answerable for it.",
      sourceRef: "meeting-2026-08-14#42",
    });
    expect(landed.ok, !landed.ok ? landed.message : "").toBe(true);

    const id = await overCapDraft(draftChangeCap(2));
    const [row] = await proposalQueue(pool);
    await markProposalDecided(pool, {
      id: row.id, status: "accepted", decidedBy: "u-steward", createdRef: id,
    });
    expect(await proposalQueue(pool)).toHaveLength(0);

    await withdrawDraft(pool, id);
    const reopened = await reopenProposalsFor(pool, id);
    expect(reopened).toBe(1);

    const queue = await proposalQueue(pool);
    expect(queue).toHaveLength(1);
    expect(queue[0].createdRef).toBeNull();
  });

  it("leaves a rejected proposal alone when a draft is withdrawn", async () => {
    // Scoped to 'accepted' on purpose: a steward's rejection is a decision, and
    // withdrawing an unrelated draft must not undo it.
    await landProposal(pool, {
      villageId: "local", moduleId: "saberra", batchId: "b-2", kind: "role.proposed",
      payload: { name: "Orchard Keeper" }, quote: "Somebody has to prune.", sourceRef: "m#7",
    });
    const [row] = await proposalQueue(pool);
    const id = await overCapDraft(draftChangeCap(2));
    await markProposalDecided(pool, { id: row.id, status: "rejected", decidedBy: "u-steward", createdRef: id });
    await withdrawDraft(pool, id);
    expect(await reopenProposalsFor(pool, id)).toBe(0);
    expect(await proposalQueue(pool)).toHaveLength(0);
  });
});
