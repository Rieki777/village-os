/**
 * OBJECTION LINEAGE, AND THE WORD THAT MEANS ITS OPPOSITE (0102).
 *
 * Two things are proven here against a real MySQL, and the first one matters
 * more than the feature it sits under.
 *
 * ── 1. `integrated` BLOCKS ────────────────────────────────────────────────
 *
 * `OBJECTION_RULINGS` is `["integrated", "concern", "withdrawn"]`, and
 * `standingObjectionCount` counts `open` AND `integrated` as standing in the
 * way. `integrated` means the objection STANDS and the proposal must change.
 * Every everyday reading of the word says the opposite: integrated sounds like
 * folded in, dealt with, resolved. So the next person to touch this code will
 * read the blocking set as a bug and helpfully remove `integrated` from it,
 * and consent will start carrying decisions the village objected to. That is
 * a village's decision being wrong, which is the thing this whole engine is
 * for. This file drives it end to end: a consent ballot everybody voted yes
 * on, carrying one integrated objection, closes as FAILED.
 *
 * `server/lib/objectionLineageShape.test.ts` pins the same rule at the source
 * level so it fails even with no database configured. This is the behaviour.
 *
 * ── 2. THE LINEAGE EDGE ───────────────────────────────────────────────────
 *
 * `ballot_objections.led_to_ballot_id` is one nullable pointer from an
 * objection to the ballot the amended proposal ran as. It is written once, at
 * the successor's open, guarded on `IS NULL` so the record keeps the first
 * answer and a second claim changes nothing. Provisioning this schema at all
 * is what proves 0102 applies, since the harness runs every migration through
 * the same engine production uses.
 *
 * No TEST_DATABASE_URL: skips loudly, never passes hollowly (house rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  ballotById,
  castVote,
  closeBallot,
  fileObjection,
  objectionsFor,
  openBallot,
  ruleObjection,
  standingObjectionCount,
  type OpenBallotInput,
} from "./ballots";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let n = 0;

const ROLL = [
  { userId: "u-ada", weight: 1 },
  { userId: "u-ben", weight: 1 },
  { userId: "u-cara", weight: 1 },
];

/** A consent ballot on its own subject, so open_key never collides. */
const openConsent = async (over: Partial<OpenBallotInput> = {}) =>
  openBallot(pool, {
    subjectType: "mechanics",
    subjectRef: `gmp-lineage-${++n}`,
    title: `Widen the track before the wet season ${n}`,
    docMarkdown: "# The document as checked",
    method: "consent",
    weightMode: "equal",
    unityPct: 0,
    quorumPct: 20,
    durationDays: 7,
    openedBy: "u-ada",
    electorate: ROLL,
    ...over,
  });

const expire = async (ballotId: string) => {
  await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

const ledTo = async (objectionId: string): Promise<string | null> => {
  const [rows] = await pool.query<any[]>("SELECT led_to_ballot_id FROM ballot_objections WHERE id = ?", [ // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    objectionId,
  ]);
  return rows[0]?.led_to_ballot_id ?? null;
};

/** The write the open-ballot route performs, in the shape the route performs it. */
const claimLineage = async (objectionId: string, ballotId: string): Promise<number> => {
  const [r] = await pool.query<any>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "UPDATE ballot_objections SET led_to_ballot_id = ? WHERE id = ? AND led_to_ballot_id IS NULL",
    [ballotId, objectionId],
  );
  return Number(r.affectedRows);
};

describe.skipIf(!configured)("objection lineage (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("0102 applied: the objections table carries a nullable led_to_ballot_id", async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL reading the scratch schema's own shape
      "SELECT COLUMN_NAME, IS_NULLABLE, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS " +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ballot_objections' AND COLUMN_NAME = 'led_to_ballot_id'",
    );
    expect(rows.length, "0102 must have applied to this scratch schema").toBe(1);
    expect(String(rows[0].IS_NULLABLE)).toBe("YES");
    expect(String(rows[0].DATA_TYPE)).toBe("varchar");
    expect(Number(rows[0].CHARACTER_MAXIMUM_LENGTH)).toBe(40);
  });

  it("an objection opens standing, and INTEGRATED leaves it standing", async () => {
    const opened = await openConsent();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const filed = await fileObjection(pool, opened.ballot.id, "u-ben", "The track will not carry the load in the wet.");
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;

    expect(await standingObjectionCount(pool, opened.ballot.id)).toBe(1);

    const ruled = await ruleObjection(pool, {
      objectionId: filed.id,
      ruling: "integrated",
      ruledBy: "u-ada",
      note: "It stands. The proposal has to change and come back.",
    });
    expect(ruled.ok).toBe(true);

    // THE WHOLE POINT OF THIS FILE. Integrated does not clear the path.
    expect(
      await standingObjectionCount(pool, opened.ballot.id),
      "integrated means the objection STANDS and the proposal must change",
    ).toBe(1);
  });

  it("only concern and withdrawn clear the path", async () => {
    for (const ruling of ["concern", "withdrawn"] as const) {
      const opened = await openConsent();
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const filed = await fileObjection(pool, opened.ballot.id, "u-ben", `Raised so it can be ${ruling}.`);
      expect(filed.ok).toBe(true);
      if (!filed.ok) return;
      expect(await standingObjectionCount(pool, opened.ballot.id)).toBe(1);
      const ruled = await ruleObjection(pool, {
        objectionId: filed.id,
        ruling,
        ruledBy: ruling === "withdrawn" ? "u-ben" : "u-ada",
        note: "The reasoning, for the record.",
      });
      expect(ruled.ok).toBe(true);
      expect(await standingObjectionCount(pool, opened.ballot.id), `${ruling} clears the path`).toBe(0);
    }
  });

  it("a unanimous consent ballot carrying an integrated objection closes as FAILED", async () => {
    const opened = await openConsent();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    for (const who of ROLL) {
      const cast = await castVote(pool, opened.ballot.id, who.userId, "yes");
      expect(cast.ok).toBe(true);
    }
    const filed = await fileObjection(pool, opened.ballot.id, "u-cara", "The deliveries stop if the track goes.");
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    await ruleObjection(pool, {
      objectionId: filed.id,
      ruling: "integrated",
      ruledBy: "u-ada",
      note: "It stands.",
    });
    await expire(opened.ballot.id);

    const closed = await closeBallot(pool, {
      ballotId: opened.ballot.id,
      closedBy: "u-ada",
      outcomeNote: "The objection stands, so the proposal goes back to be changed.",
      closerMayCloseEarly: true,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    // Everybody said yes. It still does not carry, and that is consent.
    expect(closed.tallies.yesW).toBe(3);
    expect(closed.tallies.noW).toBe(0);
    expect(closed.outcome, "an integrated objection fails the ballot").toBe("failed");
    expect((await ballotById(pool, opened.ballot.id))?.status).toBe("failed");
  });

  it("the lineage edge is written once and the record keeps the first answer", async () => {
    const first = await openConsent();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const filed = await fileObjection(pool, first.ballot.id, "u-ben", "The wet season is the problem.");
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    await ruleObjection(pool, {
      objectionId: filed.id,
      ruling: "integrated",
      ruledBy: "u-ada",
      note: "It stands.",
    });
    await expire(first.ballot.id);
    await closeBallot(pool, {
      ballotId: first.ballot.id,
      closedBy: "u-ada",
      outcomeNote: "Back to be changed.",
      closerMayCloseEarly: true,
    });

    expect(await ledTo(filed.id), "an objection points nowhere until somebody names it").toBe(null);

    const successor = await openConsent();
    expect(successor.ok).toBe(true);
    if (!successor.ok) return;
    expect(await claimLineage(filed.id, successor.ballot.id)).toBe(1);
    expect(await ledTo(filed.id)).toBe(successor.ballot.id);

    // A second claim, on any other ballot, changes nothing. One shot.
    const other = await openConsent();
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(await claimLineage(filed.id, other.ballot.id), "IS NULL makes the write one shot").toBe(0);
    expect(await ledTo(filed.id)).toBe(successor.ballot.id);
  });

  it("lineage changes nothing about the objection the village already read", async () => {
    const opened = await openConsent();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const filed = await fileObjection(pool, opened.ballot.id, "u-ben", "Say what you see, on the record.");
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    await ruleObjection(pool, {
      objectionId: filed.id,
      ruling: "concern",
      ruledBy: "u-ada",
      note: "Heard and kept. It travels with the decision.",
    });
    const before = (await objectionsFor(pool, opened.ballot.id))[0];

    const successor = await openConsent();
    expect(successor.ok).toBe(true);
    if (!successor.ok) return;
    await claimLineage(filed.id, successor.ballot.id);

    const after = (await objectionsFor(pool, opened.ballot.id))[0];
    expect(after).toEqual(before);
    // And the count the evaluator reads is untouched by the edge.
    expect(await standingObjectionCount(pool, opened.ballot.id)).toBe(0);
  });
});
