/**
 * The landing path, proven against a real MySQL (the S5 harness).
 *
 * What is pinned here is every rule the 2026-09-03 ruling turned on:
 *
 *  - a token send chosen at_acceptance EXECUTES at the close, and a seated
 *    steward's no vote FAILS it there with the steward named;
 *  - a token send chosen next_moon is stamped, waits, and can be vetoed;
 *  - a Game change never executes at close, and lands at its instant;
 *  - under steward_council one steward's no does not stop a change and a
 *    majority's does;
 *  - a veto inside the window stops it and records name, reason and time;
 *  - a veto after lands_at is refused naming the instant;
 *  - two concurrent applyDueGovernance calls on one due row produce exactly one
 *    set of writes;
 *  - a row lands through the job and through the press and never twice;
 *  - the brake marks a row stalled and reopens its window when applying resumes;
 *  - "nothing due" and "did not run" are different answers.
 *
 * No TEST_DATABASE_URL: the database cases skip, the run fails on the way out
 * (house rule). Nothing here passes hollowly.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { castVote, closeBallot, openBallot, setSubjectCloserCheck, type BallotRow, type OpenBallotInput } from "./ballots";
import {
  applyDueGovernance,
  autoSettleExpired,
  ballotPricedAtOrAbove,
  claimDue,
  isOverride,
  supersedesRefusal,
  vetoDisplayFor,
  wasVetoed,
  landingOf,
  landingRow,
  runVetoWatch,
  recordVeto,
  routeOutcome,
  stampLanding,
  stewardNoVote,
  unfinishedLandings,
  type CloseRouting,
  type LandingDeps,
  type SubjectCloser,
} from "./applyDue";
import { STEWARD_VETO, VETO_WATCH_NOTICE_TYPES, keyIsVetoLocked, stewardVetoStands, tierIsInStewardReach, vetoWatchMarksDue, vetoesFor } from "./stewardship";
import { VARIABLES_BY_KEY, criticalityOf } from "../../shared/gameVariables";
import { floorForCriticality, thresholdSettingsFrom } from "../../shared/ballotSubjects";
import { MOMENT_TYPE } from "./applyDue";

describe("the window notices this job sends", () => {
  it("names the three types the stewardship module owns, and no others", () => {
    /*
     * The strings are written out in `MOMENT_TYPE` so the notification
     * catalogue's guard can see what the server sends, and that duplication is
     * the whole reason for this test. All FIVE moments are covered: a reopened
     * window and a late settle are both the carry notice arriving again, on a
     * window the steward can still act inside, so they take the carry type and
     * `MOMENT_TITLE` is where the three read differently.
     */
    expect(MOMENT_TYPE.carry).toBe(VETO_WATCH_NOTICE_TYPES.carried);
    expect(MOMENT_TYPE.halfway).toBe(VETO_WATCH_NOTICE_TYPES.halfway);
    expect(MOMENT_TYPE.two_hours).toBe(VETO_WATCH_NOTICE_TYPES["two-hours-left"]);
    expect(MOMENT_TYPE.reopened).toBe(VETO_WATCH_NOTICE_TYPES.carried);
    expect(MOMENT_TYPE.late_settled).toBe(VETO_WATCH_NOTICE_TYPES.carried);
    expect(new Set(Object.values(MOMENT_TYPE))).toEqual(new Set(Object.values(VETO_WATCH_NOTICE_TYPES)));
  });

  it("sends none of them as the generic governance type, which resolves to a daily digest", () => {
    // The defect this closes: the last warning before a Game change landed
    // arrived hours after it had landed.
    expect(Object.values(MOMENT_TYPE)).not.toContain("governance");
  });
});

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;
let n = 0;

const HOUR = 60 * 60 * 1000;

/** A far new moon, so the 72 hours is never the later of the two. */
const FAR_MOON_DAYS = 20;

/** What the executors did, so a test can count writes rather than guess. */
let writes: string[] = [];
let council = false;
let vetoTiers = "all";
let brakeOff = true;
let throwOnExecute = false;

const deps = (over: Partial<LandingDeps> = {}): LandingDeps => ({
  pool,
  vetoHours: () => 72,
  autoApplyEnabled: () => brakeOff,
  stewardCouncil: () => council,
  // "all" keeps every case in this file asserting what it asserted before the
  // tier reach existed. The SHIPPED default is "constitutional", and the cases
  // that prove the new rule set it explicitly, so neither reading is assumed.
  stewardVetoTiers: () => vetoTiers,
  nextBoundaryAfter: (after: Date) => new Date(after.getTime() + FAR_MOON_DAYS * 24 * HOUR),
  cycleNumberAt: () => 1,
  closerFor: (subjectType: string) => CLOSERS[subjectType],
  notify: async () => {},
  endedUnclosedCycle: async () => false,
  waitsForCycleClose: () => false,
  snapsToBoundary: () => false,
  landingExpiryCycles: () => 3,
  ...over,
});

/**
 * Two subjects and nothing else: one that changes the Game and one that sends
 * tokens. Both record what they wrote into `writes`, so "exactly one set of
 * writes" is a count and not a belief.
 */
const CLOSERS: Record<string, SubjectCloser> = {
  mechanics: {
    settle: async () => ({ applied: [], held: null, proposerTold: null }) as CloseRouting,
    execute: async (b) => {
      if (throwOnExecute) throw new Error("the executor fell over");
      writes.push(`landed:${b.id}`);
      return { applied: ["a.dial"], held: null, proposerTold: null };
    },
  },
  token_send: {
    settle: async () => ({ applied: [], held: null, proposerTold: null }) as CloseRouting,
    execute: async (b) => {
      writes.push(`paid:${b.id}`);
      return { applied: ["payout"], held: null, proposerTold: null };
    },
  },
  // A minting rule is cycle-timed by definition, which is the case the
  // ended-unclosed-cycle refusal exists for.
  mint_rule: {
    settle: async () => ({ applied: [], held: null, proposerTold: null }) as CloseRouting,
    execute: async (b) => {
      writes.push(`queued:${b.id}`);
      return { applied: [], held: "queued for the next moon", proposerTold: null };
    },
  },
};

const openOne = async (over: Partial<OpenBallotInput> = {}): Promise<BallotRow> => {
  const result = await openBallot(pool, {
    subjectType: "mechanics",
    subjectRef: `landing-test-${++n}`,
    title: `Ballot ${n}`,
    docMarkdown: "# The document as checked",
    method: "custom",
    weightMode: "equal",
    unityPct: 60,
    quorumPct: 20,
    durationDays: 7,
    openedBy: "u-proposer",
    electorate: [
      { userId: "u-a", weight: 1 },
      { userId: "u-b", weight: 1 },
      { userId: "u-steward", weight: 1 },
      { userId: "u-steward2", weight: 1 },
      { userId: "u-steward3", weight: 1 },
    ],
    ...over,
  });
  if (!result.ok) throw new Error(`ballot refused to open: ${result.error}`);
  return result.ballot;
};

/** Move a ballot's frozen window into the past so it can be closed honestly. */
const expire = async (b: BallotRow, agoMs = 60_000) => {
  const at = new Date(Date.now() - agoMs);
  await pool.query("UPDATE ballots SET closes_at = ? WHERE id = ?", [at, b.id]);
  return (await reload(b.id))!;
};

const reload = async (id: string): Promise<BallotRow | null> => {
  const { ballotById } = await import("./ballots");
  return ballotById(pool, id);
};

/** Carry a ballot: three yes votes, window expired, closed by the engine. */
const carry = async (
  b: BallotRow,
  votes: Array<[string, "yes" | "no", string?]> = [["u-a", "yes"], ["u-b", "yes"]],
  /** How long ago the window ended, so a close read late can be staged. */
  endedAgoMs = 60_000,
) => {
  for (const [userId, choice, reason] of votes) {
    const r = await castVote(pool, b.id, userId, choice, reason);
    if (!r.ok) throw new Error(`vote refused: ${r.error}`);
  }
  const expired = await expire(b, endedAgoMs);
  const closed = await closeBallot(pool, {
    ballotId: expired.id,
    closedBy: "governance",
    outcomeNote: "The window ended and the engine read the result.",
    closerMayCloseEarly: false,
  });
  if (!closed.ok) throw new Error(`close refused: ${closed.error}`);
  return closed;
};

/** Seat somebody as a steward: a role carrying the capability, and a holding. */
const seatSteward = async (userId: string, termEndsAt: Date | null = null) => {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO roles (id, name, capabilities) VALUES ('steward','Steward',?) ON DUPLICATE KEY UPDATE capabilities = VALUES(capabilities)",
    [JSON.stringify([STEWARD_VETO])],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO role_holders (id, role_id, user_id, granted_by, term_ends_at) VALUES (?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE term_ends_at = VALUES(term_ends_at)",
    [`rh-${userId}`, "steward", userId, "test", termEndsAt],
  );
};

const unseatEveryone = async () => {
  await pool.query("DELETE FROM role_holders WHERE role_id = 'steward'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  // Same timezone discipline as the app pool. Without it a DATETIME comes
  // back parsed in the machine's own zone and every landing instant is hours out.
  pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
}, 300000);

afterAll(async () => {
  if (pool) await pool.end();
  if (db) await db.drop();
});

beforeEach(async () => {
  if (!configured) return;
  writes = [];
  council = false;
  brakeOff = true;
  throwOnExecute = false;
  await unseatEveryone();
});

describe.skipIf(!configured)("the two clocks, at the close", () => {
  it("executes a token send chosen at_acceptance the moment the vote closes", async () => {
    const b = await openOne({ subjectType: "token_send", timing: "at_acceptance", subjectRef: `ts-${++n}` });
    const closed = await carry(b);
    expect(closed.outcome).toBe("passed");
    const routing = await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    expect(writes).toEqual([`paid:${b.id}`]);
    expect(routing.outcome).toBe("passed");
    const row = await landingRow(pool, b.id);
    expect(row?.landsAt).toBeNull();
    expect(row?.landingStatus).toBe("applied");
  });

  it("never executes a Game change at the close, and stamps the instant instead", async () => {
    const b = await openOne();
    const closed = await carry(b);
    const routing = await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    expect(writes).toEqual([]);
    expect(routing.held).toContain("lands at");
    const row = await landingRow(pool, b.id);
    expect(row?.landingStatus).toBe("pending");
    // The frozen closes_at plus the moon, never the moment of the press.
    const expected = new Date(new Date(closed.ballot!.closesAt).getTime() + FAR_MOON_DAYS * 24 * HOUR);
    expect(Math.abs((row!.landsAt!.getTime() - expected.getTime())) / 1000).toBeLessThan(2);
  });

  it("derives the landing from the ballot's frozen close and not from the press", async () => {
    const b = await openOne();
    const closed = await carry(b, [["u-a", "yes"], ["u-b", "yes"]]);
    const landing = landingOf(deps(), { ballot: closed.ballot! });
    const fromClose = new Date(new Date(closed.ballot!.closesAt).getTime() + FAR_MOON_DAYS * 24 * HOUR);
    expect(landing.landsAt!.toISOString()).toBe(fromClose.toISOString());
  });
});

describe.skipIf(!configured)("a seated steward's no vote", () => {
  it("fails a token send at the close, with the steward named and the reason recorded", async () => {
    await seatSteward("u-steward");
    const b = await openOne({ subjectType: "token_send", timing: "at_acceptance", subjectRef: `ts-${++n}` });
    const closed = await carry(b, [["u-a", "yes"], ["u-b", "yes"], ["u-steward", "no", "This pays one household twice."]]);
    const routing = await routeOutcome(deps(), closed.ballot!, closed.outcome!, "carried", "u-a");
    expect(routing.outcome).toBe("failed");
    expect(writes).toEqual([]);
    const row = await landingRow(pool, b.id);
    expect(row?.status).toBe("failed");
    expect(row?.vetoedBy).toBe("u-steward");
    expect(row?.vetoReason).toContain("one household twice");
    expect(row?.vetoedAt).not.toBeNull();

    /*
     * AND IT IS A VETO ON THE RECORD, not only a set of columns. The dashboard
     * counts blocked payouts from the acts, every surface renders them from
     * `vetoesFor`, and the redaction door reaches the words through the act.
     * Stamping the columns alone left a payment that died with a named steward
     * and a public reason and nowhere a member could read either.
     */
    const acts = await vetoesFor(pool, b.id);
    expect(acts.map((a) => a.decidedBy)).toEqual(["u-steward"]);
    expect(acts[0].act).toBe("veto");
    expect(acts[0].reason).toContain("one household twice");
    expect((await stewardVetoStands(pool, b.id)).stands).toBe(true);
  });

  /*
   * THESE THREE MOVED TO `token_send` BECAUSE THE RULE MOVED (20.11).
   *
   * They were written on the first reading of 19D, under which a seated
   * steward's no failed ANY ballot at the close. The second audit named what
   * that costs: one seat holding a silent, unappealable kill switch over every
   * decision in the village, including the `role_unseat` ballot that would
   * remove them, in a village where choices are hidden by default. The rule is
   * now token sends only, so a Game change asserted here would be asserting a
   * withdrawn model. The Game-change side is pinned in
   * server/lib/stewardship.test.ts, where the rule lives.
   */
  const payout = (over: Partial<OpenBallotInput> = {}) =>
    openOne({ subjectType: "token_send", timing: "at_acceptance", subjectRef: `ts-${++n}`, ...over });

  it("counts nothing from a steward whose term has ended", async () => {
    await seatSteward("u-steward", new Date(Date.now() - 24 * HOUR));
    const b = await payout();
    await carry(b, [["u-a", "yes"], ["u-b", "yes"], ["u-steward", "no", "gone"]]);
    expect(await stewardNoVote(deps(), (await reload(b.id))!)).toBeNull();
  });

  it("under steward_council needs a majority, so one no does not fail a payment", async () => {
    await seatSteward("u-steward");
    await seatSteward("u-steward2");
    await seatSteward("u-steward3");
    council = true;
    const one = await payout();
    await carry(one, [["u-a", "yes"], ["u-b", "yes"], ["u-steward", "no", "not this"]]);
    expect(await stewardNoVote(deps(), (await reload(one.id))!)).toBeNull();

    const two = await payout();
    await carry(two, [
      ["u-a", "yes"],
      ["u-steward", "no", "not this"],
      ["u-steward2", "no", "nor this"],
    ]);
    const veto = await stewardNoVote(deps(), (await reload(two.id))!);
    expect(veto?.stewardIds.length).toBe(2);
    expect(veto?.seated).toBe(3);
  });

  it("with the council off lets any single steward's no stop it", async () => {
    await seatSteward("u-steward");
    await seatSteward("u-steward2");
    const b = await payout();
    await carry(b, [["u-a", "yes"], ["u-b", "yes"], ["u-steward", "no", "one is enough"]]);
    const veto = await stewardNoVote(deps(), (await reload(b.id))!);
    expect(veto?.stewardIds).toEqual(["u-steward"]);
  });

  it("does NOT fail a Game change, which has a window and a veto of its own", async () => {
    await seatSteward("u-steward");
    const b = await openOne();
    const closed = await carry(b, [["u-a", "yes"], ["u-b", "yes"], ["u-steward", "no", "not this moon"]]);
    expect(await stewardNoVote(deps(), (await reload(b.id))!)).toBeNull();
    const routing = await routeOutcome(deps(), closed.ballot!, closed.outcome!, "carried", "u-a");
    expect(routing.outcome, "it carries on the numbers, and the window is where a steward stops it").toBe("passed");
    const row = await landingRow(pool, b.id);
    expect(row?.vetoedBy).toBeNull();
    expect(row?.landsAt, "and it is stamped with a landing instant like any other Game change").not.toBeNull();
  });

  it("NEVER fails a ballot the steward is the subject of", async () => {
    // The seat that cannot veto its own removal was failing it with a vote.
    await seatSteward("u-steward");
    const b = await payout({ subjectRef: "u-steward" });
    await carry(b, [["u-a", "yes"], ["u-b", "yes"], ["u-steward", "no", "I would rather keep this."]]);
    expect(await stewardNoVote(deps(), (await reload(b.id))!)).toBeNull();
  });

  it("does not fail a payment on a no with no words, because a block carries a reason", async () => {
    await seatSteward("u-steward");
    const b = await payout();
    await carry(b, [["u-a", "yes"], ["u-b", "yes"], ["u-steward", "no"]]);
    expect(await stewardNoVote(deps(), (await reload(b.id))!)).toBeNull();
  });
});

describe.skipIf(!configured)("the veto inside and outside the window", () => {
  const carriedAndStamped = async (over: Partial<OpenBallotInput> = {}) => {
    const b = await openOne(over);
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    return (await reload(b.id))!;
  };

  it("stops a decision inside its window and records the name, the reason and the time", async () => {
    await seatSteward("u-steward");
    const b = await carriedAndStamped();
    const out = await recordVeto({ pool }, { ballotId: b.id, stewardId: "u-steward", reason: "This moves the bar the same week we set it." });
    expect(out.ok).toBe(true);
    const row = await landingRow(pool, b.id);
    expect(row?.landingStatus).toBe("vetoed");
    expect(row?.vetoedBy).toBe("u-steward");
    expect(row?.vetoReason).toContain("same week");
    expect(row?.vetoedAt).not.toBeNull();
  });

  it("refuses a veto with no reason", async () => {
    const b = await carriedAndStamped();
    const out = await recordVeto({ pool }, { ballotId: b.id, stewardId: "u-steward", reason: "   " });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toContain("carries a reason");
  });

  it("refuses a veto after the instant, naming it", async () => {
    const b = await carriedAndStamped();
    const row = await landingRow(pool, b.id);
    const after = new Date(row!.landsAt!.getTime() + 1000);
    const out = await recordVeto({ pool, now: () => after }, { ballotId: b.id, stewardId: "u-steward", reason: "too late" });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toContain(row!.landsAt!.toISOString());
  });

  it("stops the landing job from applying a vetoed row", async () => {
    await seatSteward("u-steward");
    const b = await carriedAndStamped();
    await recordVeto({ pool }, { ballotId: b.id, stewardId: "u-steward", reason: "not yet" });
    await pool.query("UPDATE ballots SET lands_at = ? WHERE id = ?", [new Date(Date.now() - HOUR), b.id]);
    const report = await applyDueGovernance(deps());
    expect(report.ran).toBe(true);
    expect(report.ran === true && report.landed).toBe(0);
    expect(writes).toEqual([]);
  });

  /*
   * REWRITTEN 2026-09-03, because the rule it pinned changed twice.
   *
   * It used to build the stopped proposal by writing `vetoed_at` onto the
   * PROPOSAL row and to claim the override from `supersedes_proposal_id`
   * alone. Section 20.11 moved the veto onto the ballot (so a proposal passed
   * again can land) and made the relation explicit (so a renewal and a
   * withdraw-and-rewrite clone do not inherit steward-proof landing). The
   * property under test is unchanged: an override cannot be stopped a second
   * time, and it lands.
   */
  it("refuses a veto on an override, and lets it land", async () => {
    await seatSteward("u-steward");
    // The original, stopped by a steward, on its own ballot.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, change_set, proposer_user_id, status) " +
        "VALUES ('gmp-vetoed-1','The first ask','because','[]','u-proposer','onsite_vote')",
    );
    const first = await openOne({ subjectRef: "gmp-vetoed-1" });
    const closedFirst = await carry(first);
    await routeOutcome(deps(), closedFirst.ballot!, "passed", "carried", "u-a");
    const firstStopped = await recordVeto(deps(), {
      ballotId: first.id, stewardId: "u-steward", reason: "The village had not been shown the numbers yet.",
    });
    expect(firstStopped.ok, JSON.stringify(firstStopped)).toBe(true);
    // The resubmission, pointing at it as an OVERRIDE, passed again at the highest bar.
    const again = await openOne({ subjectRef: "gmp-override-1" });
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, change_set, proposer_user_id, status, supersedes_proposal_id, supersedes_relation) " +
        "VALUES ('gmp-override-1','The same ask, again','because','[]','u-proposer','onsite_vote','gmp-vetoed-1','overrides')",
    );
    const closedAgain = await carry(again);
    await routeOutcome(deps(), closedAgain.ballot!, "passed", "carried", "u-a");

    const stopped = await recordVeto({ pool }, { ballotId: again.id, stewardId: "u-steward", reason: "still no" });
    expect(stopped.ok).toBe(false);
    expect(stopped.ok === false && stopped.error).toContain("highest bar");

    await pool.query("UPDATE ballots SET lands_at = ? WHERE id = ?", [new Date(Date.now() - HOUR), again.id]);
    await applyDueGovernance(deps());
    expect(writes).toContain(`landed:${again.id}`);
  });

  it("refuses a veto on something that took effect the moment it carried", async () => {
    const b = await openOne({ subjectType: "token_send", timing: "at_acceptance", subjectRef: `ts-${++n}` });
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    const out = await recordVeto({ pool }, { ballotId: b.id, stewardId: "u-steward", reason: "undo it" });
    expect(out.ok).toBe(false);
  });
});

describe.skipIf(!configured)("the election, and landing exactly once", () => {
  const due = async () => {
    const b = await openOne();
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    await pool.query("UPDATE ballots SET lands_at = ? WHERE id = ?", [new Date(Date.now() - HOUR), b.id]);
    return b;
  };

  it("lets exactly one of two concurrent claims through", async () => {
    const b = await due();
    const at = new Date();
    const [one, two] = await Promise.all([claimDue(pool, b.id, at), claimDue(pool, b.id, at)]);
    expect([one, two].filter(Boolean).length).toBe(1);
  });

  it("produces exactly one set of writes from two concurrent runs on one due row", async () => {
    const b = await due();
    const [a, c] = await Promise.all([applyDueGovernance(deps()), applyDueGovernance(deps())]);
    expect(writes).toEqual([`landed:${b.id}`]);
    const landedTotal = (a.ran ? a.landed : 0) + (c.ran ? c.landed : 0);
    expect(landedTotal).toBe(1);
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("applied");
  });

  it("never lands the same row twice across the job and a second press", async () => {
    const b = await due();
    await applyDueGovernance(deps());
    await applyDueGovernance(deps());
    expect(writes).toEqual([`landed:${b.id}`]);
  });

  it("leaves the executor-pending row behind when the executor throws", async () => {
    const b = await due();
    throwOnExecute = true;
    const report = await applyDueGovernance(deps());
    expect(report.ran === true && report.failed).toBe(1);
    const [rows] = await pool.query<any[]>("SELECT * FROM governance_executor_pending WHERE ballot_id = ?", [b.id]);
    expect(rows.length).toBe(1);
    expect(rows[0].cleared_at).toBeNull();
    expect(String(rows[0].last_error)).toContain("fell over");
    // Back to pending, so the next tick tries again rather than losing it.
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("pending");
    expect(await unfinishedLandings(pool, 0)).toContain(b.id);
    // And the retry lands it, once.
    throwOnExecute = false;
    await applyDueGovernance(deps());
    expect(writes).toEqual([`landed:${b.id}`]);
  });
});

describe.skipIf(!configured)("nothing due, did not run, and the brake", () => {
  it("says nothing was due, distinctly from not having run", async () => {
    const report = await applyDueGovernance(deps());
    expect(report.ran).toBe(true);
    expect(report.ran === true && report.due).toBe(0);
    expect(report.ran === true && report.notes[0]).toContain("Nothing was due");
  });

  it("marks a row stalled while applying is off, and reopens its window when it comes back", async () => {
    const b = await openOne();
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    await pool.query("UPDATE ballots SET lands_at = ? WHERE id = ?", [new Date(Date.now() - HOUR), b.id]);

    brakeOff = false;
    const held = await applyDueGovernance(deps());
    expect(held.ran === true && held.stalled).toBe(1);
    expect(writes).toEqual([]);
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("stalled");

    brakeOff = true;
    const resumed = await applyDueGovernance(deps());
    // The window reopens rather than the backlog landing in one sweep.
    expect(resumed.ran === true && resumed.stalled).toBe(1);
    expect(writes).toEqual([]);
    const row = await landingRow(pool, b.id);
    expect(row?.landingStatus).toBe("pending");
    expect(row!.landsAt!.getTime()).toBeGreaterThan(Date.now() + 71 * HOUR);
  });

  it("holds a cycle-timed decision back while a moon that ended is unclosed", async () => {
    const b = await openOne({ subjectType: "mint_rule", subjectRef: `mr-${++n}` });
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    await pool.query("UPDATE ballots SET lands_at = ? WHERE id = ?", [new Date(Date.now() - HOUR), b.id]);
    const report = await applyDueGovernance(
      deps({ endedUnclosedCycle: async () => true, waitsForCycleClose: () => true }),
    );
    expect(report.ran === true && report.deferred).toBe(1);
    expect(writes).toEqual([]);
  });
});

describe.skipIf(!configured)("closing on the clock", () => {
  it("refuses an early close on a custom-method ballot, so nobody picks the steward's days", async () => {
    const b = await openOne();
    await castVote(pool, b.id, "u-a", "yes");
    await castVote(pool, b.id, "u-b", "yes");
    const early = await closeBallot(pool, {
      ballotId: b.id,
      closedBy: "u-facilitator",
      outcomeNote: "closing it now",
      closerMayCloseEarly: true,
    });
    expect(early.ok).toBe(false);
    expect(early.ok === false && early.error).toContain("window ends");
  });

  it("closes an expired ballot through the settlement path and stamps its landing", async () => {
    const b = await openOne();
    await castVote(pool, b.id, "u-a", "yes");
    await castVote(pool, b.id, "u-b", "yes");
    await expire(b);
    const report = await autoSettleExpired(deps(), closeBallot as any);
    expect(report.closed).toBeGreaterThanOrEqual(1);
    const row = await landingRow(pool, b.id);
    expect(row?.status).toBe("passed");
    expect(row?.landingStatus).toBe("pending");
    expect(row?.landsAt).not.toBeNull();
  });

  it("says so when no ballot's window had ended", async () => {
    const report = await autoSettleExpired(deps(), closeBallot as any);
    expect(report.ran).toBe(true);
    expect(report.notes.join(" ")).toContain("No ballot");
  });
});

describe.skipIf(!configured)("stamping is idempotent and honest about what never lands", () => {
  it("marks a failed vote as never landing rather than as waiting", async () => {
    const b = await openOne();
    const closed = await carry(b, [["u-a", "no"], ["u-b", "no"]]);
    expect(closed.outcome).toBe("failed");
    await routeOutcome(deps(), closed.ballot!, closed.outcome!, "did not pass", "u-a");
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("not_applicable");
  });

  it("writes the same instant to the ballot twice without moving it", async () => {
    const b = await openOne();
    const closed = await carry(b);
    const landing = landingOf(deps(), { ballot: closed.ballot! });
    await stampLanding(deps(), closed.ballot!, landing);
    const first = (await landingRow(pool, b.id))!.landsAt!.toISOString();
    await stampLanding(deps(), closed.ballot!, landing);
    expect((await landingRow(pool, b.id))!.landsAt!.toISOString()).toBe(first);
  });
});

/**
 * ── THE FIX WAVE OF 2026-09-03 ─────────────────────────────────────────────
 *
 * Everything the second audit found still standing after the dispatcher lane's
 * first pass. Each block names the failure it pins.
 */
describe.skipIf(!configured)("a row that reaches passed with its instant already behind it", () => {
  it("restamps the window from now, marks it late-settled and tells every steward", async () => {
    /*
     * THE FAILURE: `lands_at` is frozen from `closes_at`, so any delay longer
     * than the window between the window ending and the close being read
     * produced a row whose window was already over at the moment stewards were
     * told it had begun. The change landed within five minutes of carrying and
     * the record reported the window as honoured.
     */
    await seatSteward("u-steward");
    const told: string[] = [];
    const b = await openOne({ subjectRef: `late-${++n}`, timing: "at_acceptance" });
    // The votes are cast while the window is open, and then nobody reads the
    // close for ten days: a scheduler outage, or a village that went quiet.
    // The window it was promised (72 hours from the close) ran out on day three.
    const closed = await carry(b, [["u-a", "yes"], ["u-b", "yes"]], 10 * 24 * HOUR);
    const at = new Date();
    const routing = await routeOutcome(
      deps({ now: () => at, notify: async (i) => { told.push(i.type); } }),
      closed.ballot!, "passed", "carried", "u-a",
    );
    const row = await landingRow(pool, b.id);
    expect(row?.lateSettledAt, "the row says it was settled late").not.toBeNull();
    expect(row?.landsAt!.getTime()).toBeGreaterThan(at.getTime() + 71 * HOUR);
    expect(routing.held).toContain("counted from now instead");
    expect(told).toContain(MOMENT_TYPE.late_settled);
    expect(writes, "and it did not land in the meantime").toEqual([]);
  });
});

describe.skipIf(!configured)("the claim runs against a real resting row", () => {
  it("claims a proposal that was parked at passed_verified exactly once under two callers", async () => {
    /*
     * THE FAILURE: the inline cycle-close block that used to apply
     * `passed_verified` and `passed_onsite` rows is gone, and those rows carry
     * a NULL `lands_at`, so the new landing gate could not see them at all.
     * Migration 0144 backfills them. This proves the backfilled shape is one
     * the loop can actually claim, and claims it once.
     */
    const b = await openOne({ subjectRef: `verified-${++n}` });
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, status, proposer_user_id, change_set) VALUES (?,?,?,?,?,?)",
      [b.subjectRef, "A parked proposal", "why the village was asked", "passed_verified", "u-a", JSON.stringify([])],
    );
    const due = new Date(Date.now() + 40 * 24 * HOUR);
    await Promise.all([applyDueGovernance(deps(), due), applyDueGovernance(deps(), due)]);
    /*
     * Counted on THIS row rather than on the report's totals: other rows from
     * earlier cases in this file are due at the same instant, and a total would
     * pass while this one landed twice.
     */
    expect(writes.filter((w) => w === `landed:${b.id}`).length, "exactly one executor").toBe(1);
    const [claims] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM governance_executor_pending WHERE ballot_id = ?",
      [b.id],
    );
    expect(Number(claims[0].n), "one election, one attempt row").toBe(1);
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("applied");
  });
});

describe.skipIf(!configured)("the veto lives on the ballot and nowhere else", () => {
  it("lets a vetoed proposal be passed again and land, which it never could before", async () => {
    /*
     * THE FAILURE: the veto was stamped onto `mechanics_proposals` too, and
     * nobody ever cleared it. Every landing predicate reads `vetoed_at IS
     * NULL`, so a village that answered its steward and passed the same
     * proposal again was skipped forever.
     */
    await seatSteward("u-steward");
    const ref = `reopen-${++n}`;
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, status, proposer_user_id, change_set) VALUES (?,?,?,?,?,?)",
      [ref, "The proposal that came back", "why the village was asked", "onsite_vote", "u-a", JSON.stringify([])],
    );
    const first = await openOne({ subjectRef: ref });
    const closedFirst = await carry(first);
    await routeOutcome(deps(), closedFirst.ballot!, "passed", "carried", "u-a");
    const stopped = await recordVeto(deps(), {
      ballotId: first.id, stewardId: "u-steward", reason: "The village had not heard the lending circle yet.",
    });
    expect(stopped.ok, JSON.stringify(stopped)).toBe(true);

    const [proposal] = await pool.query<any[]>("SELECT status FROM mechanics_proposals WHERE id = ?", [ref]);
    expect(String(proposal[0].status), "back with its proposer").toBe("open");
    const display = await vetoDisplayFor(pool, "mechanics", ref);
    expect(display?.reason).toContain("lending circle");

    // The village answers the objection and passes it again.
    await pool.query("UPDATE mechanics_proposals SET status = 'onsite_vote' WHERE id = ?", [ref]);
    const second = await openOne({ subjectRef: ref });
    const closedSecond = await carry(second);
    await routeOutcome(deps(), closedSecond.ballot!, "passed", "carried", "u-a");
    await applyDueGovernance(deps(), new Date(Date.now() + 40 * 24 * HOUR));
    expect(writes, "the second pass lands").toContain(`landed:${second.id}`);
    // And the first ballot keeps its veto, so the record still reads honestly.
    expect((await landingRow(pool, first.id))?.vetoedAt).not.toBeNull();
    expect(await vetoDisplayFor(pool, "mechanics", ref), "the display follows the current ballot").toBeNull();
  });
});

describe.skipIf(!configured)("a decision about what a steward may stop", () => {
  it("waits its window like any Game change and refuses every veto inside it", async () => {
    await seatSteward("u-steward");
    const ref = `locked-${++n}`;
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, status, proposer_user_id, change_set) VALUES (?,?,?,?,?,?)",
      [ref, "Who may stop what", "why the village was asked", "onsite_vote", "u-a",
        JSON.stringify([{ kind: "dial", key: "governance.steward_subjects", to: "mechanics" }])],
    );
    const b = await openOne({ subjectRef: ref });
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a", ["dial"]);
    const row = await landingRow(pool, b.id);
    expect(row?.landsAt, "it still waits, which the first pass took away").not.toBeNull();
    expect(row?.vetoLocked).toBe(true);
    const stopped = await recordVeto(deps(), {
      ballotId: b.id, stewardId: "u-steward", reason: "I would rather keep the reach I have.",
    });
    expect(stopped.ok).toBe(false);
    if (stopped.ok) return;
    expect(stopped.error).toContain("no steward may stop it");
  });
});

describe.skipIf(!configured)("a passed row that never lands", () => {
  it("is written off after the village's expiry in cycles, with one door back", async () => {
    const b = await openOne({ subjectRef: `expiry-${++n}` });
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    const landsAt = (await landingRow(pool, b.id))!.landsAt!;
    /*
     * The executor keeps falling over, so the row is claimed, fails, and goes
     * back to `pending` on every tick. That is the shape that used to wait
     * forever with a countdown a member could read and nothing behind it.
     */
    throwOnExecute = true;
    await applyDueGovernance(deps(), new Date(landsAt.getTime() + HOUR));
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("pending");
    const wayLater = new Date(landsAt.getTime() + 200 * 24 * HOUR);
    const report = await applyDueGovernance(deps(), wayLater);
    expect(report.ran && report.expired, JSON.stringify(report)).toBeGreaterThanOrEqual(1);
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("expired");
    expect(report.ran && report.notes.join(" ")).toContain("Withdraw and rewrite");
    expect(writes, "and nothing landed on its way out").toEqual([]);
  });

  it("gives a stalled row its window back once, and never twice", async () => {
    const b = await openOne({ subjectRef: `stall-${++n}` });
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    const landsAt = (await landingRow(pool, b.id))!.landsAt!;
    brakeOff = false;
    await applyDueGovernance(deps(), new Date(landsAt.getTime() + HOUR));
    brakeOff = true;
    const first = await applyDueGovernance(deps(), new Date(landsAt.getTime() + 2 * HOUR));
    expect(first.ran && first.stalled, "the window is reopened once").toBe(1);
    const reopened = (await landingRow(pool, b.id))!.landsAt!;
    brakeOff = false;
    await applyDueGovernance(deps(), new Date(reopened.getTime() + HOUR));
    brakeOff = true;
    const second = await applyDueGovernance(deps(), new Date(reopened.getTime() + 2 * HOUR));
    expect(second.ran && second.stalled, "and never a second time").toBe(0);
    expect(second.ran && second.notes.join(" ")).toContain("already reopened once");
  });
});

describe.skipIf(!configured)("the report tells nothing-to-do from could-not-tell", () => {
  it("says so in words on a quiet tick, and names the digest's own answer", async () => {
    const report = await applyDueGovernance(deps(), new Date());
    expect(report.ran).toBe(true);
    if (!report.ran) return;
    expect(report.due).toBe(0);
    expect(report.notes.join(" ")).toContain("Nothing was due");
    expect(report.digest, "no composer wired means not asked, never 'empty'").toBe("not_asked");
  });
});

describe.skipIf(!configured)("the override is decided by the tier the resubmission carried at", () => {
  it("is not conferred by the pointer alone: a renewal and a rewrite are not overrides", async () => {
    /*
     * THE FAILURE: `supersedes_proposal_id` alone conferred steward-proof
     * landing, and three writers set that column. A 21.2 renewal and the
     * withdraw-and-rewrite clone would both have landed regardless of any
     * steward at whatever tier they happened to be priced at.
     */
    const vetoedRef = `orig-${++n}`;
    const backRef = `back-${++n}`;
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, status, proposer_user_id, change_set) VALUES (?,?,?,?,?,?)",
      [vetoedRef, "The one that was stopped", "why the village was asked", "open", "u-a", JSON.stringify([])],
    );
    const first = await openOne({ subjectRef: vetoedRef });
    const closed = await carry(first);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    await seatSteward("u-steward");
    await recordVeto(deps(), { ballotId: first.id, stewardId: "u-steward", reason: "Not yet, and here is why in full." });
    expect(await wasVetoed(pool, vetoedRef)).toBe(true);

    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, status, proposer_user_id, change_set, supersedes_proposal_id, supersedes_relation) " +
        "VALUES (?,?,?,?,?,?,?,?)",
      [backRef, "The one that came back", "why the village was asked", "open", "u-a", JSON.stringify([]), vetoedRef, "replaces"],
    );
    expect(await isOverride(pool, "mechanics", backRef), "a replacement is not an override").toBeNull();
    await pool.query("UPDATE mechanics_proposals SET supersedes_relation = 'overrides' WHERE id = ?", [backRef]);
    expect((await isOverride(pool, "mechanics", backRef))?.of).toBe(vetoedRef);
  });

  it("refuses a renewal that points at a stopped decision, naming the door that is open", async () => {
    const ref = `renew-target-${++n}`;
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, status, proposer_user_id, change_set) VALUES (?,?,?,?,?,?)",
      [ref, "The one that was stopped", "why the village was asked", "open", "u-a", JSON.stringify([])],
    );
    const b = await openOne({ subjectRef: ref });
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    await seatSteward("u-steward");
    await recordVeto(deps(), { ballotId: b.id, stewardId: "u-steward", reason: "The village has not heard this one out." });
    const refusal = await supersedesRefusal(pool, "renews", ref);
    expect(refusal).toContain("cannot be renewed");
    expect(refusal).toContain("override");
    expect(await supersedesRefusal(pool, "overrides", ref), "an override may point at it").toBeNull();
  });

  it("reads the tier the ballot actually froze, never the one the proposer meant", () => {
    const settings = thresholdSettingsFrom(() => Number.NaN);
    const floor = floorForCriticality("constitutional", settings);
    expect(ballotPricedAtOrAbove({ unityPct: floor.unityPct, quorumPct: floor.quorumPct }, "constitutional", settings)).toBe(true);
    expect(ballotPricedAtOrAbove({ unityPct: floor.unityPct - 1, quorumPct: floor.quorumPct }, "constitutional", settings)).toBe(false);
  });
});

describe.skipIf(!configured)("a binding ballot cannot open on a subject nobody can close", () => {
  afterAll(() => setSubjectCloserCheck(null));

  it("refuses at the door, names the subject, and points at the practice-vote door", async () => {
    /*
     * PLAN_TO_A item 3. The close dispatcher runs the closer for a ballot's
     * subject type and does nothing at all when there is none, and nobody was
     * told: the village voted, the vote carried, and the thing it decided
     * never happened.
     */
    setSubjectCloserCheck((t: string) => Object.prototype.hasOwnProperty.call(CLOSERS, t));
    const result = await openBallot(pool, {
      subjectType: "weather_forecast",
      subjectRef: `nocloser-${++n}`,
      title: "Should it rain",
      docMarkdown: "# A question nothing can carry out",
      method: "custom",
      weightMode: "equal",
      unityPct: 60,
      quorumPct: 20,
      durationDays: 7,
      openedBy: "u-proposer",
      electorate: [{ userId: "u-a", weight: 1 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("weather_forecast");
    expect(result.error).toContain("advisory");
  });

  it("lets an advisory vote through, and every subject that does have a closer", async () => {
    setSubjectCloserCheck((t: string) => Object.prototype.hasOwnProperty.call(CLOSERS, t));
    const advisory = await openBallot(pool, {
      subjectType: "advisory",
      subjectRef: `advisory-${++n}`,
      title: "What the village thinks",
      docMarkdown: "# A practice vote on the real engine",
      method: "custom",
      weightMode: "equal",
      unityPct: 60,
      quorumPct: 20,
      durationDays: 7,
      openedBy: "u-proposer",
      electorate: [{ userId: "u-a", weight: 1 }],
    });
    expect(advisory.ok, advisory.ok ? "" : advisory.error).toBe(true);
    const real = await openOne({ subjectRef: `hascloser-${++n}` });
    expect(real.id).toBeTruthy();
  });
});

describe.skipIf(!configured)("the timing a ballot freezes when nobody chose one", () => {
  it("gives a token send at acceptance and a Game change the next boundary", async () => {
    const send = await openOne({ subjectType: "token_send", subjectRef: `timing-send-${++n}` });
    expect(send.timing, "a payout for finished work does not wait a moon").toBe("at_acceptance");
    const change = await openOne({ subjectRef: `timing-change-${++n}` });
    expect(change.timing).toBe("next_moon");
  });
});

describe.skipIf(!configured)("the three window notices", () => {
  it("come from stewardship's own marks, each with its own notification type", async () => {
    /*
     * THE FAILURE: the job did the halfway arithmetic itself, so it could
     * drift from the countdown a steward reads, and all three notices went out
     * as one type that resolves to a DAILY mail digest. The last warning before
     * a Game change lands used to arrive hours after it landed.
     */
    await seatSteward("u-steward");
    const b = await openOne({ subjectRef: `watch-${++n}` });
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    const landsAt = (await landingRow(pool, b.id))!.landsAt!;
    const closesAt = new Date(closed.ballot!.closesAt);

    const typesAt = async (at: Date): Promise<string[]> => {
      const seen: string[] = [];
      await runVetoWatch(deps({ notify: async (i) => { seen.push(i.type); } }), at);
      return seen;
    };

    const half = new Date((closesAt.getTime() + landsAt.getTime()) / 2 + 1000);
    expect(vetoWatchMarksDue({ carriedAt: closesAt, landsAt }, half)).toContain("halfway");
    expect(await typesAt(half)).toContain(MOMENT_TYPE.halfway);

    const nearly = new Date(landsAt.getTime() - 30 * 60 * 1000);
    expect(await typesAt(nearly)).toContain(MOMENT_TYPE.two_hours);

    // A tick early in the window sends neither: only "carried" is due, and the
    // close path already sent that one.
    const early = new Date(closesAt.getTime() + 60_000);
    expect((await typesAt(early)).filter((t) => t !== MOMENT_TYPE.two_hours)).toEqual([]);
  });

  it("sends only the LAST mark when the job was down through two of them", async () => {
    await seatSteward("u-steward");
    const b = await openOne({ subjectRef: `watch-late-${++n}` });
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a");
    const landsAt = (await landingRow(pool, b.id))!.landsAt!;
    const seen: string[] = [];
    // One minute before it lands: halfway and two-hours-left are both behind
    // us, and telling a steward they have half a window left would be false.
    await runVetoWatch(deps({ notify: async (i) => { seen.push(i.type); } }), new Date(landsAt.getTime() - 60_000));
    // Every other row still open in this schema is in the same position, so the
    // assertion is on WHICH types went out and never on how many rows there are.
    expect(Array.from(new Set(seen))).toEqual([MOMENT_TYPE.two_hours]);
  });
});

describe.skipIf(!configured)("the window notice and the veto route give the same answer", () => {
  /**
   * THE FAILURE: the notice told every steward "unless you stop it before
   * then" while `recordVeto` refused the veto-locked rows in the same breath.
   * A steward who trusted the notice waited for a door and found out at the
   * moment they pushed it.
   *
   * The assertion is deliberately NOT that a particular sentence appears. It
   * is that the PROMISE and the ROUTE agree, checked by making the notice's
   * claim and then really attempting the veto it describes. A future change
   * that fixes one side and not the other fails here, which a string test on
   * either side alone would not catch.
   */
  const carryNotice = async (subjectRef: string, itemKinds?: readonly string[]): Promise<{ ballot: BallotRow; body: string }> => {
    const b = await openOne({ subjectRef });
    const closed = await carry(b);
    const bodies: string[] = [];
    await routeOutcome(
      deps({ notify: async (i) => { bodies.push(String(i.body)); } }),
      closed.ballot!, "passed", "carried", "u-a", itemKinds,
    );
    expect(bodies.length, "the carry notice must actually go out").toBeGreaterThan(0);
    return { ballot: b, body: bodies[0]! };
  };

  it("offers the stop only where the stop works, on both rows, in one run", async () => {
    await seatSteward("u-steward");

    // ── The ordinary Game change: the notice offers a stop, and it works.
    const plain = await carryNotice(`notice-plain-${++n}`);
    const plainOffers = /unless you stop it/.test(plain.body);
    const plainVeto = await recordVeto(deps(), {
      ballotId: plain.ballot.id, stewardId: "u-steward", reason: "This needs another look before it lands.",
    });
    expect(plainOffers, "an ordinary Game change still offers its window").toBe(true);
    expect(plainVeto.ok, "and the route still honours it").toBe(true);

    // ── The veto-locked row: the notice must not offer what the route refuses.
    const ref = `notice-locked-${++n}`;
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, status, proposer_user_id, change_set) VALUES (?,?,?,?,?,?)",
      [ref, "Who may stop what", "why the village was asked", "onsite_vote", "u-a",
        JSON.stringify([{ kind: "dial", key: "governance.steward_subjects", to: "mechanics" }])],
    );
    const locked = await carryNotice(ref, ["dial"]);
    const lockedOffers = /unless you stop it/.test(locked.body);
    const lockedVeto = await recordVeto(deps(), {
      ballotId: locked.ballot.id, stewardId: "u-steward", reason: "I would rather keep the reach I have.",
    });

    expect(lockedOffers, `the notice offered a stop the route refuses: ${locked.body}`).toBe(false);
    expect(lockedVeto.ok, "the route still refuses it, which is the behaviour being described").toBe(false);
    // It still gets a notice, and the notice still names when it lands. Saying
    // nothing would leave a steward unable to argue against the one change
    // they are barred from stopping.
    expect(locked.body).toContain("It takes effect at");
    expect(locked.body).toContain("no steward may stop it");

    // THE INVARIANT, stated once over both rows: the promise equals the route.
    expect(
      [plainOffers, lockedOffers],
      "the notice's promise and the veto route's answer must agree on every row",
    ).toEqual([plainVeto.ok, lockedVeto.ok]);
  });

  it("makes a role_seat ballot WAIT its window and lock the door, through the real landing path", async () => {
    /*
     * Rye, 2026-09-04, taking the recommendation: a seating takes the window
     * and stays un-vetoable. Proved HERE and not only in governanceKinds,
     * because the shared arithmetic knowing the rule proves nothing about
     * whether landingOf passes it: the seat e2e goes through the direct
     * role-seats route and never touches a landing at all, so the ballot path
     * for a seating had no coverage of its own.
     */
    const b = await openOne({ subjectType: "role_seat", subjectRef: `seat-land-${++n}` });
    const closed = await carry(b);
    const landing = landingOf(deps(), { ballot: closed.ballot! });
    expect(landing.executesAtClose, "it no longer carries at the close").toBe(false);
    expect(landing.landsAt, "it has an instant the village can read").not.toBeNull();
    expect(landing.vetoable, "and no steward can stop it").toBe(false);
    expect(landing.because).toContain("the seat itself");
  });
});


describe.skipIf(!configured)("which SIZES of decision the seat may stop", () => {
  /**
   * Rye, 2026-09-04: "for now as the default let's have constitutional able to
   * be vetoed but let it be a setting in admin for which of these 3 categories
   * a steward can veto".
   *
   * The rest of this file runs with the reach set to "all", which is what every
   * case here asserted before the setting existed. These cases set it
   * explicitly, so nothing below is a claim about a default it never read.
   */
  afterEach(() => { vetoTiers = "all"; });

  it("ships the founder's default, and the registry is the thing asked", () => {
    // Read from the registry rather than restated here, because a default
    // written twice is a default that drifts. This is the assertion that fails
    // if somebody widens the shipped reach without meaning to.
    expect(VARIABLES_BY_KEY["governance.steward_veto_tiers"]?.default).toBe("constitutional");
    expect(criticalityOf(VARIABLES_BY_KEY["governance.steward_veto_tiers"]!)).toBe("constitutional");
  });

  it("parses the list, and an unreadable value takes reach away instead of granting it", () => {
    expect(tierIsInStewardReach("constitutional", "constitutional")).toBe(true);
    expect(tierIsInStewardReach("routine", "constitutional")).toBe(false);
    expect(tierIsInStewardReach("routine", "all")).toBe(true);
    expect(tierIsInStewardReach("structural", "routine, structural")).toBe(true);
    // FAIL CLOSED. Empty, blank, nonsense and undefined all mean the seat
    // reaches nothing, never everything: a typo must cost the village a pause
    // it could have had, and never hand the seat a decision it was not given.
    for (const bad of ["", "   ", "everything", "CONSTITUTIONAL!", undefined, null, 7]) {
      expect(tierIsInStewardReach("constitutional", bad), `"${String(bad)}" must not grant reach`).toBe(false);
    }
    // Case and spacing are a founder typing in a box, not a syntax error.
    expect(tierIsInStewardReach("constitutional", "  Constitutional  ")).toBe(true);
  });

  it("locks the landing of a decision whose size is out of reach, and says why", async () => {
    await seatSteward("u-steward");
    vetoTiers = "constitutional";
    // A brand field is routine (CRITICALITY_FOR_ITEM_KIND), so under the
    // shipped default it is outside the seat's reach.
    const ref = `tier-routine-${++n}`;
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, status, proposer_user_id, change_set) VALUES (?,?,?,?,?,?)",
      [ref, "Rename the welcome card", "why the village was asked", "onsite_vote", "u-a",
        JSON.stringify([{ kind: "brand_field", key: "welcome_title", to: "Hello" }])],
    );
    const b = await openOne({ subjectRef: ref });
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a", ["brand_field"]);

    const row = await landingRow(pool, b.id);
    expect(row?.landsAt, "it still waits its window, so the village reads it coming").not.toBeNull();
    expect(row?.vetoLocked, "and the seat cannot stop it").toBe(true);

    const stopped = await recordVeto(deps(), {
      ballotId: b.id, stewardId: "u-steward", reason: "I would rather it stayed.",
    });
    expect(stopped.ok).toBe(false);
    if (stopped.ok) return;
    expect(stopped.error).toContain("no steward may stop it");
  });

  it("leaves a constitutional decision stoppable under that same default", async () => {
    await seatSteward("u-steward");
    vetoTiers = "constitutional";
    const ref = `tier-const-${++n}`;
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, status, proposer_user_id, change_set) VALUES (?,?,?,?,?,?)",
      [ref, "Change how votes are counted", "why the village was asked", "onsite_vote", "u-a",
        JSON.stringify([{ kind: "mode_switch", to: "one_member_one_vote" }])],
    );
    const b = await openOne({ subjectRef: ref });
    const closed = await carry(b);
    await routeOutcome(deps(), closed.ballot!, "passed", "carried", "u-a", ["mode_switch"]);

    const row = await landingRow(pool, b.id);
    expect(row?.vetoLocked, "a mode switch is constitutional, which IS in the default reach").toBe(false);
    const stopped = await recordVeto(deps(), {
      ballotId: b.id, stewardId: "u-steward", reason: "This needs another moon of talking first.",
    });
    expect(stopped.ok, "and the door the notice promises actually opens").toBe(true);
  });

  it("prices the reach setting itself out of the seat's own hands", () => {
    // The one that matters most: a seat that could veto a NARROWING of its own
    // reach would be the only seat here that sets its own limits.
    expect(keyIsVetoLocked("governance.steward_veto_tiers")).toBe(true);
  });
});
