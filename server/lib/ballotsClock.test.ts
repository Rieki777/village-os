/**
 * WHEN A BALLOT CLOSES, ON A DATABASE IN ANY ZONE.
 *
 * `ballots.test.ts` pins the snapshot law and says nothing about the clock,
 * because until now there was nothing to say: `opens_at` and `closes_at` were
 * written by `NOW()` and read back against `Date.now()`, and that pair was
 * correct only because `server/db/pool.ts` runs `SET time_zone = '+00:00'` on
 * every connection. Nothing at any of the five comparison sites could see that
 * setting, and no test asserted the connection between them. A ballot whose
 * close time moves with a server's configuration closes early or late, and
 * both of those are a decision the village did not make.
 *
 * So this file provisions ONE scratch schema and opens ballots through pools
 * whose MySQL session sits four hours behind UTC and two hours ahead of it, in
 * the production `on("connection")` shape. That is the real mechanism and not
 * a stub of it. It matters that both are here: CI's MySQL runs UTC and the
 * developer machines here do not, so a test that leaned on either would be
 * green in exactly the place it needed to be red.
 *
 * This sentence used to name the local zone as America/New_York. It was
 * measured at UTC-7 on 2026-09-23, which is neither of that zone's offsets, so
 * the name was either wrong or has gone stale. A zone named in a comment is a
 * claim about one machine on one day, and nothing checks it. The point the
 * sentence is making holds without it: the two environments are blind to
 * opposite halves of this, and `@@session.time_zone` reports `SYSTEM` on both,
 * so anything that needs the real answer MEASURES the offset with
 * `TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW())`.
 *
 * The assertions are about WHEN, never merely about difference. A one-day
 * ballot must close twenty-four hours from now as this process measures now,
 * not twenty or twenty-eight.
 *
 * Nothing here closes a ballot on a timer. Closing stays a human act; what is
 * under test is the instant the window ends and who is allowed to act on it.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  ballotById,
  ballotsNeedingAttention,
  castVote,
  closeBallot,
  openBallot,
  type OpenBallotInput,
} from "./ballots";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[ballotsClock.test] TEST_DATABASE_URL not set — the ballot clock is UNCHECKED here.");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The session zones a fork's MySQL actually turns up in, plus the happy one. */
const ZONES: Array<[string, string]> = [
  ["four hours behind UTC", "-04:00"],
  ["two hours ahead of UTC", "+02:00"],
  ["UTC", "+00:00"],
];

describe.skipIf(!configured)("the ballot window, on a database in any zone", () => {
  let db: TestDb;
  const pools = new Map<string, mysql.Pool>();
  let n = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    for (const [, offset] of ZONES) {
      const p = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 2 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape. test-pool-ok: pinned to a deliberate non-UTC offset below, which is what the file measures
      p.on("connection", (c) => {
        c.query(`SET time_zone = '${offset}'`); // module-review-ok: the session pin is the thing under test, on the S5 scratch schema
      });
      pools.set(offset, p);
    }
  }, 120_000);

  afterAll(async () => {
    await Promise.all(Array.from(pools.values()).map((p) => p.end()));
    await db?.drop();
  });

  const open = async (pool: mysql.Pool, over: Partial<OpenBallotInput> = {}) =>
    openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: `clock-${++n}`,
      title: `Ballot ${n}`,
      docMarkdown: "# The document as checked",
      method: "custom",
      weightMode: "equal",
      unityPct: 80,
      quorumPct: 20,
      durationDays: 1,
      openedBy: "u-proposer",
      electorate: [
        { userId: "u-a", weight: 1 },
        { userId: "u-b", weight: 1 },
        { userId: "u-c", weight: 1 },
      ],
      ...over,
    });

  it.each(ZONES)("a one-day ballot opened against a session %s closes one day from now", async (_label, offset) => {
    const pool = pools.get(offset)!;
    const before = Date.now();
    const res = await open(pool);
    const after = Date.now();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    /*
     * THE ASSERTION. Not "the two zones differ" and not "a date came back":
     * the window is one day wide, measured by this process, to the second.
     * A session offset would show up here as four hours or two, which is
     * 14400000 or 7200000 milliseconds against a tolerance of two.
     */
    const opensAt = Date.parse(res.ballot.opensAt);
    const closesAt = Date.parse(res.ballot.closesAt);
    expect(opensAt).toBeGreaterThanOrEqual(before - 1_000);
    expect(opensAt).toBeLessThanOrEqual(after);
    expect(closesAt - opensAt).toBe(DAY_MS);
    expect(Math.abs(closesAt - (before + DAY_MS))).toBeLessThan(2_000);

    // And the row survives a round trip through the same shifted session.
    const reread = await ballotById(pool, res.ballot.id);
    expect(reread!.closesAt).toBe(res.ballot.closesAt);
  });

  it.each(ZONES)("the window is OPEN for a vote and CLOSED after it, against a session %s", async (_label, offset) => {
    const pool = pools.get(offset)!;
    const res = await open(pool);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Inside the window, a vote is taken.
    const accepted = await castVote(pool, res.ballot.id, "u-a", "yes");
    expect(accepted.ok).toBe(true);

    /*
     * Push the close time one second into the past, bound from this process,
     * which is the same discipline `openBallot` writes under. A `NOW()`-based
     * fixture would move it by the session's offset as well, and then this
     * assertion would be about the fixture rather than about the rule.
     */
    const justPast = new Date(Math.floor((Date.now() - 1_000) / 1000) * 1000);
    await pool.query("UPDATE ballots SET closes_at = ? WHERE id = ?", [justPast, res.ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

    const refused = await castVote(pool, res.ballot.id, "u-b", "yes");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("voting period has ended");

    /*
     * ONE SECOND, not four hours. The point of the tight margin is that only a
     * correct clock can tell these two ballots apart; an offset in either
     * direction would make the whole set read the same way.
     */
    const stillOpen = await open(pool);
    expect(stillOpen.ok).toBe(true);
    if (!stillOpen.ok) return;
    const oneSecondLeft = new Date(Math.floor((Date.now() + 1_000) / 1000) * 1000 + 1000);
    await pool.query("UPDATE ballots SET closes_at = ? WHERE id = ?", [oneSecondLeft, stillOpen.ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const lateButValid = await castVote(pool, stillOpen.ballot.id, "u-c", "yes");
    expect(lateButValid.ok).toBe(true);
  });

  it.each(ZONES)("closing early is refused while the window runs, against a session %s", async (_label, offset) => {
    const pool = pools.get(offset)!;
    const res = await open(pool);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // The window has a day left, so a closer without the early right is told so.
    const tooSoon = await closeBallot(pool, {
      ballotId: res.ballot.id,
      outcomeNote: "Trying to close before the village has had its say",
      closedBy: "u-proposer",
      closerMayCloseEarly: false, // a plain proposer, so only the clock can open this door
    });
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) expect(tooSoon.error).toContain("still running");

    // Past the close time it becomes their act to take. Closing stays human:
    // nothing above closed this ballot on its own.
    const past = new Date(Math.floor((Date.now() - 60_000) / 1000) * 1000);
    await pool.query("UPDATE ballots SET closes_at = ? WHERE id = ?", [past, res.ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const now = await closeBallot(pool, {
      ballotId: res.ballot.id,
      outcomeNote: "The window ended and a person closed it",
      closedBy: "u-proposer",
      closerMayCloseEarly: false, // still no early right; the window really did end
    });
    expect(now.ok).toBe(true);
  });

  it.each(ZONES)("the prefilter and the split it feeds agree, against a session %s", async (_label, offset) => {
    const pool = pools.get(offset)!;
    /*
     * `ballotsNeedingAttention` asks SQL for everything closing inside a
     * horizon, then splits the answer in JS. Those were two different clocks:
     * the prefilter asked the database and the split asked this process. On a
     * shifted session an entire offset's worth of ballots fell out of the
     * prefilter, and because the function's job IS to tell a steward what
     * needs them, the failure was a message nobody received.
     */
    /*
     * THE BALLOTS STRADDLE THE HORIZON, and that is the whole design of this
     * case. A first version put them a day and thirty days out against a
     * forty-eight hour horizon, and reverting the prefilter to `NOW() +
     * INTERVAL ? HOUR` left it GREEN: a four hour shift cannot move
     * twenty-four past forty-eight, so the test could not tell a correct
     * prefilter from a broken one. These two sit one hour either side of the
     * boundary, which is inside every offset a real deployment produces.
     */
    const HOUR = 3_600_000;
    const at = (ms: number) => new Date(Math.floor((Date.now() + ms) / 1000) * 1000);
    const setClose = (id: string, when: Date) =>
      pool.query("UPDATE ballots SET closes_at = ? WHERE id = ?", [when, id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

    const justInside = await open(pool, { durationDays: 7 });
    const justOutside = await open(pool, { durationDays: 7 });
    const expired = await open(pool, { durationDays: 7 });
    expect(justInside.ok && justOutside.ok && expired.ok).toBe(true);
    if (!justInside.ok || !justOutside.ok || !expired.ok) return;

    await setClose(justInside.ballot.id, at(47 * HOUR));
    await setClose(justOutside.ballot.id, at(49 * HOUR));
    await setClose(expired.ballot.id, at(-1 * HOUR));

    const attention = await ballotsNeedingAttention(pool, 48);
    const soonIds = attention.closingSoon.map((b) => b.id);
    const pastIds = attention.pastWindow.map((b) => b.id);

    // Forty-seven hours out is inside a forty-eight hour horizon. A database
    // clock behind UTC drops it from the prefilter and the steward is never
    // told about a ballot closing tomorrow.
    expect(soonIds).toContain(justInside.ballot.id);
    // Forty-nine hours out is beyond it. A database clock ahead of UTC pulls
    // it in and the steward is chased about a ballot with two days to run.
    expect(soonIds).not.toContain(justOutside.ballot.id);
    expect(pastIds).not.toContain(justOutside.ballot.id);
    // And a window that has already shut is a person's to answer, not a miss.
    expect(pastIds).toContain(expired.ballot.id);
    // Nothing lands in both buckets.
    expect(soonIds.filter((id) => pastIds.includes(id))).toEqual([]);
  });
});
