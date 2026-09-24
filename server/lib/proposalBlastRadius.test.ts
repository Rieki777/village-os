/**
 * HOW FAR A VENDOR'S CLAIM CAN REACH, which is now carrying a decision.
 *
 * Rye handed the question of what counts as a significant tension to the
 * vendor, 2026-09-24, and his reasoning was containment: they can only
 * influence how their own module is received, they cannot reach the rest of
 * the village, and a village that dislikes their judgement turns the module
 * off. That is a good argument and it rests entirely on a property of this
 * code.
 *
 * So the property stops being tidiness and becomes load-bearing. If a
 * vendor-sent tension can raise a notification, land in a digest, or appear in
 * the public pulse, then "they can only influence their own module" is false
 * and the decision behind it was made on a premise that did not hold.
 *
 * Traced before these were written, so the tests pin what is true rather than
 * what was hoped: no client file reads `external_proposals` at all, `landProposal`
 * makes no notification, and the health event it records is `audience: "admin"`
 * while the public pulse reads `audience = "public"`.
 *
 * ── THE CRACK THESE ARE REALLY HERE FOR ──────────────────────────────────
 *
 * A proposal ROW carries its own `audience`, and a vendor may ask for
 * `member`. Nothing consumes that field today. So the containment is true by
 * the absence of a reader, and an absence is the weakest kind of guarantee:
 * the day somebody builds a member-facing surface on that field, this breaks
 * silently and nothing in the tree says it was ever a promise. The second case
 * below is the one that goes red.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { landProposal } from "./externalProposals";
import { recentEvents } from "./events";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const tension = {
  villageId: "v1",
  moduleId: "saberra",
  batchId: "b1",
  kind: "tension.observed",
  payload: { tension: "Two circles both think they own the buyer list" },
  quote: "Both leads said it in the same meeting.",
  sourceRef: "meeting-2026-09-24#3",
  trustTier: "extracted_unreviewed",
};

/** `recordEvent` is fire and forget, so this waits instead of guessing a sleep. */
async function adminEvents(tries = 40): Promise<{ kind: string; text: string }[]> {
  for (let i = 0; i < tries; i += 1) {
    const rows = await recentEvents(pool, "admin", 50);
    if (rows.length > 0) return rows.map((r) => ({ kind: r.kind, text: r.text }));
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

describe.skipIf(!configured)("how far a vendor's claim reaches", () => {
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

  it("records a landing where a steward can see it", async () => {
    const r = await landProposal(pool, tension);
    expect(r.ok).toBe(true);
    const admin = await adminEvents();
    expect(admin.some((e) => e.kind === "external_proposal")).toBe(true);
  });

  it("KEEPS A VENDOR'S TENSION OUT OF THE PUBLIC PULSE, which is the claim the ruling rests on", async () => {
    await landProposal(pool, tension);
    await adminEvents(); // wait for the write, then read the other audience
    const pulse = await recentEvents(pool, "public", 50);
    expect(pulse).toEqual([]);
  });

  it("KEEPS IT OUT EVEN WHERE THE VENDOR ASKED FOR A MEMBER AUDIENCE", async () => {
    // The proposal row may carry `audience: "member"`, and this one does: it
    // has a verbatim quote, which is what earns that audience. The reach of the
    // EVENT is a separate decision and it stays with the stewards. If somebody
    // later builds a member surface from the proposal's own audience field,
    // this case is the one that should stop them and ask.
    const r = await landProposal(pool, { ...tension, audience: "member" });
    expect(r.ok).toBe(true);
    await adminEvents();
    expect(await recentEvents(pool, "public", 50)).toEqual([]);
  });

  it("keeps a risk out too, since a warning is the loudest thing they send", async () => {
    await landProposal(pool, {
      ...tension,
      kind: "risk.observed",
      payload: { risk: "Surveys expire before the subdivision lands" },
    });
    await adminEvents();
    expect(await recentEvents(pool, "public", 50)).toEqual([]);
  });

  it("stays quiet across a whole batch, so volume cannot leak what one record does not", async () => {
    for (let i = 0; i < 5; i += 1) {
      await landProposal(pool, {
        ...tension,
        sourceRef: `meeting-2026-09-24#${i}`,
        payload: { tension: `Tension number ${i}` },
      });
    }
    await adminEvents();
    expect(await recentEvents(pool, "public", 50)).toEqual([]);
  });
});
