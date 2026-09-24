/**
 * THE SLATE IS PART OF THE PROPOSAL, AND EACH PERSON ON IT ANSWERS FOR
 * THEMSELVES. The controls for 0220, one per rule.
 *
 * Rye, 2026-09-24, choosing between two designs: "is whoever is clicking the
 * 'launch village' button then selects from a list of members in the proposal
 * to carry the steward role so then it's there in the proposal to be voted on.
 * I like this second route better." And: "founders only for this first season
 * (after that anyone can raise their hand for a steward role and fill it if
 * voted in), and show the declines".
 *
 * ── WHAT THIS FILE IS FOR, WHICH IS NOT COVERAGE ──────────────────────────
 *
 * Every test here breaks ONE rule and watches this file go red. The rules and
 * the tests that own them:
 *
 *   on the slate      "seats nobody the proposal did not name, however
 *                      loudly the acceptance flag is set"
 *   accepted          "does not seat somebody who has not accepted"
 *   not declined      "does not seat somebody who declined"
 *   still a founder   "does not seat somebody who is no longer a founder"
 *   the crossing      "moves all nineteen once one person holds the seat"
 *                     and "moves nothing at all when the slate is empty"
 *   founders only     `launchSlateProblem` refuses a slate naming a member
 *
 * THE FIRST ONE IS THE ONE THAT WAS NOT PROVABLE BEFORE. `stands_for_steward`
 * sits on `ballot_votes` and any member on a roll can set it by sending one
 * field with their vote. Before the slate it MEANT "seat me"; it now means "I
 * accept the nomination this proposal made of me", and an acceptance nobody
 * asked for has to seat nobody. `flaggedNotOnSlate` is how that is provable
 * and not merely true.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { HANDOVER_SET } from "../shared/capabilities";
import { loadVariables } from "./lib/variables";
import { seatCatalystsAsStewards, STEWARD_ROLE_ID } from "./lib/stewardship";
import { answerNomination, awaitingAnswer, insertSlate, slateFor } from "./repos/stewardSlate";
import { launchSlateProblem } from "./lib/launchProposal";

const configured = testDbConfigured();
const LAUNCH_BALLOT = "bal-birthing";
/** A running season that ends forty days out, in whole seconds like the column. */
const SEASON = {
  currentSeasonId: "rooting-2026",
  seasonEndsAt: new Date(Math.floor((Date.now() + 40 * 86400000) / 1000) * 1000),
};

let db: TestDb;
let pool: Pool;

async function member(id: string, name: string, role: string): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
    "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
    [id, name, `${id}@example.invalid`, "x", role],
  );
}

/** The proposal names these people, through the same write the route makes. */
async function slate(userIds: string[], proposedBy = "cat-1"): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await insertSlate(conn, LAUNCH_BALLOT, userIds, proposedBy);
  } finally {
    conn.release();
  }
}

/** A vote row carrying the acceptance, which is where a yes lives (0218/0220). */
async function votes(userId: string, accepts: boolean): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
    "INSERT INTO ballot_votes (ballot_id, user_id, choice, stands_for_steward) VALUES (?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE stands_for_steward = VALUES(stands_for_steward)",
    [LAUNCH_BALLOT, userId, "yes", accepts ? 1 : 0],
  );
}

async function seatedIds(): Promise<string[]> {
  const [rows]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
    "SELECT user_id FROM role_holders WHERE role_id = ? ORDER BY user_id",
    [STEWARD_ROLE_ID],
  );
  return rows.map((r: any) => String(r.user_id));
}

async function crossed(): Promise<string[]> {
  const [rows]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
    "SELECT capability FROM capability_holding ORDER BY capability",
  );
  return rows.map((r: any) => String(r.capability));
}

describe.skipIf(!configured)("the slate a launch proposal names", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    await loadVariables(pool);
    await member("cat-1", "Wren Alder", "founder");
    await member("cat-2", "Iris Fenn", "founder");
    await member("cat-3", "Ash Quill", "founder");
    await member("cat-4", "Fern Dale", "founder");
    await member("cat-5", "Sorrel Vane", "founder");
    await member("mem-1", "Rook Salt", "member");

    /*
     * THE FIXTURE IS THE WHOLE EXPERIMENT, so it is worth reading as one:
     *
     *   cat-1  named, accepted                    -> seated
     *   cat-2  named, accepted, then DECLINED       -> not seated
     *   cat-3  named, never answered                -> not seated
     *   cat-4  NOT named, acceptance set            -> not seated
     *   cat-5  named, DECLINED, flag still set      -> not seated
     *   mem-1  named, accepted, no longer a founder -> not seated
     *
     * Five ways to fail and one way to be seated, in one run, so no test here
     * can pass because the seating did nothing at all.
     */
    await slate(["cat-1", "cat-2", "cat-3", "cat-5", "mem-1"]);
    await votes("cat-1", true);
    await votes("cat-2", true);
    await votes("cat-3", false);
    await votes("cat-4", true);
    await votes("cat-5", true);
    await votes("mem-1", true);
    await answerNomination(pool, LAUNCH_BALLOT, "cat-2", false);
    /*
     * `cat-5` IS THE STATE THE TWO COLUMNS ARE NEVER SUPPOSED TO BE IN, built
     * by hand because `answerNomination` cannot produce it: declining clears
     * the acceptance in the same call, so a decline given through the product
     * always leaves the flag at zero.
     *
     * Which is exactly why this row has to exist. Without it, deleting the
     * decline test from the seating changes NOTHING and every test here stays
     * green, so the guard would be defended by a condition that never fires.
     * Measured: with only `cat-2` in the fixture, removing `!declined.has(id)`
     * from the seating left all thirteen tests passing.
     */
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
      "UPDATE ballot_steward_slate SET declined_at = NOW() WHERE ballot_id = ? AND user_id = ?",
      [LAUNCH_BALLOT, "cat-5"],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("reads the slate back with each person's answer, and the declines are in it", async () => {
    const rows = await slateFor(pool, LAUNCH_BALLOT);
    expect(rows.map((r) => r.userId), "ordered, so two page loads agree").toEqual([
      "cat-1",
      "cat-2",
      "cat-3",
      "cat-5",
      "mem-1",
    ]);
    expect(rows.every((r) => r.proposedBy === "cat-1"), "one person chose this list").toBe(true);
    const cat2 = rows.find((r) => r.userId === "cat-2")!;
    // A DECLINE IS A FACT WITH A TIME ON IT, and it survives the acceptance
    // that came before it: `answerNomination` cleared the flag in the same call.
    expect(cat2.declinedAt, "the decline is recorded").not.toBeNull();
    expect(cat2.accepted, "and the acceptance it replaced is gone").toBe(false);
    expect(awaitingAnswer(rows).map((r) => r.userId), "only the one who never answered").toEqual(["cat-3"]);
    const cat5 = rows.find((r) => r.userId === "cat-5")!;
    expect(cat5.declinedAt, "the hand-built disagreeing row is here").not.toBeNull();
    expect(cat5.accepted, "with its acceptance flag still standing").toBe(true);
  });

  it("refuses an answer from somebody the proposal did not name", async () => {
    // The route's early refusal, asked of the repo it delegates to. `cat-4`
    // has a vote row and the acceptance flag, and still has no nomination.
    expect(await answerNomination(pool, LAUNCH_BALLOT, "cat-4", false)).toBeNull();
    expect(
      (await slateFor(pool, LAUNCH_BALLOT)).map((r) => r.userId),
      "and nothing was written to the slate on the way out",
    ).not.toContain("cat-4");
  });

  it("seats NOBODY the proposal did not name, however loudly the flag is set", async () => {
    const r = await seatCatalystsAsStewards(pool, LAUNCH_BALLOT, SEASON);
    expect(r.ok).toBe(true);
    /*
     * THE CONTROL. `cat-4` is a founder, is on no slate, and carries
     * `stands_for_steward = 1`, which under 0218's meaning would have seated
     * them. The known positive is `cat-1` in the same call, so this is the
     * rule working and not an empty query answering nothing.
     */
    expect(r.flaggedNotOnSlate, "and the fact is reported, never merely true").toEqual(["cat-4"]);
    expect(r.seated, "one seat, and it is the one person who was named and accepted").toEqual(["cat-1"]);
    expect(await seatedIds()).toEqual(["cat-1"]);
  });

  it("does not seat somebody who DECLINED, and the decline is in the report", async () => {
    const r = await seatCatalystsAsStewards(pool, LAUNCH_BALLOT, SEASON);
    expect(r.declined, "Rye asked for these to be shown, so they are carried out of the seating").toEqual([
      "cat-2",
      "cat-5",
    ]);
    expect(r.accepted, "and a decline is not an acceptance").not.toContain("cat-2");
    expect(await seatedIds()).not.toContain("cat-2");
  });

  it("does not seat a decline whose acceptance flag was never cleared", async () => {
    /*
     * THE FAIL-SAFE DIRECTION, and the only test that can see it. `cat-5` is a
     * founder, is named, and carries BOTH a decline and a live acceptance
     * flag. One of the two has to win and it is the decline, because seating
     * somebody who said no out loud is conscription into nineteen powers and
     * the opposite mistake merely leaves a seat empty.
     *
     * The known positive is `cat-1`, seated in the same call.
     */
    const r = await seatCatalystsAsStewards(pool, LAUNCH_BALLOT, SEASON);
    expect(r.slate, "named").toContain("cat-5");
    expect(r.declined, "and said no").toContain("cat-5");
    expect(r.accepted, "so the acceptance beneath it counts for nothing").not.toContain("cat-5");
    expect(await seatedIds(), "and the only seat is the one person who really accepted").toEqual(["cat-1"]);
  });

  it("does not seat somebody who has not answered", async () => {
    const r = await seatCatalystsAsStewards(pool, LAUNCH_BALLOT, SEASON);
    expect(r.slate, "cat-3 was named").toContain("cat-3");
    expect(r.accepted, "and never accepted").not.toContain("cat-3");
    expect(await seatedIds()).not.toContain("cat-3");
  });

  it("does not seat somebody who is no longer a founder at the CLOSE", async () => {
    /*
     * `users.role` can move between a vote opening and carrying, so the
     * founder test is asked at the close and not when the slate was chosen.
     * `mem-1` is named, accepted, and is a member, which is exactly that state.
     */
    const r = await seatCatalystsAsStewards(pool, LAUNCH_BALLOT, SEASON);
    expect(r.accepted, "they did everything asked of them").toContain("mem-1");
    expect(r.acceptedNotFounding, "and the close is where it stops").toEqual(["mem-1"]);
    expect(await seatedIds()).not.toContain("mem-1");
  });

  it("seats the one who accepted with a term ending at the season's end", async () => {
    const [rows]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
      "SELECT user_id, UNIX_TIMESTAMP(term_ends_at) AS ends, season_id, granted_by FROM role_holders WHERE role_id = ?",
      [STEWARD_ROLE_ID],
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0].user_id)).toBe("cat-1");
    // Read through UNIX_TIMESTAMP, because a driver read of a TIMESTAMP shifts
    // by the database host's offset. NOT "has a term": the term is the
    // season's end to the second, which is the cap of ruling 2026-09-14.
    expect(Number(rows[0].ends) * 1000).toBe(SEASON.seasonEndsAt.getTime());
    expect(String(rows[0].season_id)).toBe("rooting-2026");
    expect(String(rows[0].granted_by), "the village put them here").toBe(LAUNCH_BALLOT);
  });

  it("moves ALL NINETEEN powers once one person holds the seat", async () => {
    // Compared as whole sets: `toContain` on one key passes on a seat carrying
    // eighteen, and eighteen is the defect.
    expect(await crossed()).toEqual([...HANDOVER_SET].sort());
  });
});

describe.skipIf(!configured)("a launch proposal that names nobody", () => {
  let emptyDb: TestDb;
  let emptyPool: Pool;

  beforeAll(async () => {
    emptyDb = await provisionTestDb();
    emptyPool = testPool(emptyDb, { connectionLimit: 4 });
    await loadVariables(emptyPool);
    await emptyPool.query( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
      ["cat-1", "Wren Alder", "cat-1@example.invalid", "x", "founder"],
    );
    /*
     * The acceptance flag is SET and the slate is empty, which is the sharpest
     * version of the first control: with nobody named, a founder who did
     * everything 0218 asked of them is still seated by nobody.
     */
    await emptyPool.query( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO ballot_votes (ballot_id, user_id, choice, stands_for_steward) VALUES (?,?,?,?)",
      [LAUNCH_BALLOT, "cat-1", "yes", 1],
    );
  });

  afterAll(async () => {
    await emptyPool?.end();
    await emptyDb?.drop();
  });

  it("seats nobody and moves NOT ONE of the nineteen", async () => {
    const r = await seatCatalystsAsStewards(emptyPool, LAUNCH_BALLOT, SEASON);
    expect(r.ok, "the writes it had to run, ran").toBe(true);
    expect(r.slate).toEqual([]);
    expect(r.seated).toEqual([]);
    expect(r.flaggedNotOnSlate, "and the flag that seated nobody is on the record").toEqual(["cat-1"]);
    /*
     * THE CROSSING WAITS FOR A HOLDER, and this is why. Entrusting nineteen
     * powers to an empty seat takes every one of them away from the admin
     * panel and shuts the break-glass in the same breath, with nobody able to
     * act and no way back through the product.
     */
    expect(r.holdingMoved).toBe(false);
    expect(String(r.holdingHeld)).toContain("Nobody holds the steward's seat");
    const [rows]: any = await emptyPool.query("SELECT COUNT(*) AS n FROM capability_holding"); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(Number(rows[0].n), "not one power crossed to the village").toBe(0);
    // The role still exists carrying all nineteen, which is what the village
    // votes somebody into later.
    const [roles]: any = await emptyPool.query("SELECT capabilities FROM roles WHERE id = ?", [STEWARD_ROLE_ID]); // module-review-ok: fixture SQL against the S5 scratch schema
    const caps = typeof roles[0].capabilities === "string" ? JSON.parse(roles[0].capabilities) : roles[0].capabilities;
    expect([...caps].sort()).toEqual([...HANDOVER_SET].sort());
  });
});

describe.skipIf(!configured)("who a proposal may put on its slate", () => {
  let rulesDb: TestDb;
  let rulesPool: Pool;
  const roll = [{ userId: "cat-1" }, { userId: "cat-2" }, { userId: "mem-1" }];
  const shortName = (n: string) => String(n).split(/\s+/)[0] ?? "";

  beforeAll(async () => {
    rulesDb = await provisionTestDb();
    rulesPool = testPool(rulesDb, { connectionLimit: 4 });
    for (const [id, name, role] of [
      ["cat-1", "Wren Alder", "founder"],
      ["cat-2", "Iris Fenn", "founder"],
      ["mem-1", "Rook Salt", "member"],
      ["cat-off", "Ash Quill", "founder"],
    ] as const) {
      await rulesPool.query( // module-review-ok: fixture SQL against the S5 scratch schema
        "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
        [id, name, `${id}@example.invalid`, "x", role],
      );
    }
  });

  afterAll(async () => {
    await rulesPool?.end();
    await rulesDb?.drop();
  });

  it("REFUSES a slate naming somebody who is not a founding member", async () => {
    const bad = await launchSlateProblem(rulesPool, ["cat-1", "mem-1"], roll, shortName);
    expect(bad.ok).toBe(false);
    expect(bad.ok ? "" : bad.error).toContain("Only founding members");
    // The known positive, so the refusal above is the rule and not a broken query.
    const good = await launchSlateProblem(rulesPool, ["cat-1", "cat-2"], roll, shortName);
    expect(good.ok).toBe(true);
    expect(good.ok ? good.members : []).toEqual([
      { id: "cat-1", name: "Wren" },
      { id: "cat-2", name: "Iris" },
    ]);
  });

  it("REFUSES a founder who is not on this vote's roll", async () => {
    // Accepting rides on the vote row, so naming somebody who cannot vote here
    // would name somebody guaranteed not to be seated with nothing on any
    // screen explaining why.
    const off = await launchSlateProblem(rulesPool, ["cat-1", "cat-off"], roll, shortName);
    expect(off.ok).toBe(false);
    expect(off.ok ? "" : off.error).toContain("on this vote's roll");
  });

  it("REFUSES the same member twice, before the primary key does", async () => {
    const twice = await launchSlateProblem(rulesPool, ["cat-1", "cat-1"], roll, shortName);
    expect(twice.ok).toBe(false);
    expect(twice.ok ? "" : twice.error).toContain("twice");
  });

  it("ACCEPTS an empty slate, because a village may name nobody", async () => {
    for (const raw of [undefined, null, []]) {
      const verdict = await launchSlateProblem(rulesPool, raw, roll, shortName);
      expect(verdict.ok, `${JSON.stringify(raw)} is a legal slate`).toBe(true);
      expect(verdict.ok ? verdict.members : null).toEqual([]);
    }
  });
});
