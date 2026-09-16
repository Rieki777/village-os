/**
 * A DECISION THAT CARRIED AND WILL NEVER TAKE EFFECT.
 *
 * `SubjectCloser.onUnlanded` is the only hook that hears about that ending, and
 * the gap it closes is value held while a vote runs: a redemption's closer
 * holds tokens from the moment the ballot opens, burns them on a pass and
 * returns them on a fail, and before this there was no call at all on the two
 * paths where a PASSED decision is stopped before it lands. The tokens would
 * have sat held forever, with no row anywhere saying so.
 *
 * What is pinned here, against a real MySQL (the S5 harness) and a stub closer:
 *
 *  - a passed ballot vetoed inside its window calls `onUnlanded(b, "vetoed")`
 *    exactly once, through the lib and through the veto route a steward
 *    actually presses, with the council majority as its own case;
 *  - a passed ballot written off after too many boundaries calls
 *    `onUnlanded(b, "written_off")` exactly once;
 *  - a decision that lands, fails at the vote, fails on a seated steward's no
 *    at the close, is withdrawn, or has no hook calls nothing;
 *  - a throwing hook leaves the veto or the write-off STANDING, records the
 *    error on an open `governance_executor_pending` attempt for a person, and
 *    is never tried again by a tick or by a second veto;
 *  - a veto and a write-off racing each other call it once between them,
 *    because both are gated on their own statement's affected-rows count.
 *
 * THE CLOCK IS FIXED. Every instant below is a literal, and the engine reads
 * `deps.now`. The two exceptions are named where they are spent: `castVote`
 * refuses a vote after `closes_at` against `Date.now()`, so votes are cast
 * before the window is moved, and the veto ROUTE carries no clock of its own,
 * so its cases land in 2036 and the only thing the real clock decides is that
 * today is earlier than that.
 *
 * No TEST_DATABASE_URL: the database cases skip, and an unfiltered run fails on
 * the way out (house rule). A skip is not a pass.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { castVote, closeBallot, openBallot, withdrawBallot, type BallotRow, type OpenBallotInput } from "./ballots";
import {
  applyDueGovernance,
  landingRow,
  recordVeto,
  routeOutcome,
  type CloseRouting,
  type LandingDeps,
  type SubjectCloser,
} from "./applyDue";
import { STEWARD_COUNCIL_KEY, STEWARD_SUBJECTS_KEY, STEWARD_VETO } from "./stewardship";
import { loadVariables, setVariable } from "./variables";
import { register as registerVetoRoutes } from "../routes/governanceVetoes";

const configured = testDbConfigured();
if (!configured) {
  console.warn("[applyDue.unlanded] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** The instant every vote in this file closed at. */
const CLOSED_AT = new Date("2026-03-01T00:00:00.000Z");
/** What the engine is told "now" is: a minute after the close. */
const NOW = new Date(CLOSED_AT.getTime() + 60_000);
/** The boundary the stub clock hands back: twenty days on. */
const MOON = 20 * DAY;
/** The boundary the route cases land on, so a real-clock veto is in time. */
const FAR = new Date("2036-01-01T00:00:00.000Z");

let db: TestDb;
let pool: mysql.Pool;
let n = 0;

/** Every `onUnlanded` call, as reason, ballot, and the status the hook was shown. */
let unlanded: string[] = [];
/** Every settle, so a steward's no at the close is visibly a settle and not this. */
let settled: string[] = [];
/** Every execute, so "it landed" is a count. */
let executed: string[] = [];
/** True while the stub hook refuses, the way a ledger call can. */
let hookThrows = false;

const RELEASE_REFUSED = "the ledger refused the release";

const settle = async (b: BallotRow, outcome: string): Promise<CloseRouting> => {
  settled.push(`${outcome}:${b.id}`);
  return { applied: [], held: null, proposerTold: null };
};

const execute = async (b: BallotRow): Promise<CloseRouting> => {
  executed.push(b.id);
  return { applied: [], held: null, proposerTold: null };
};

const onUnlanded = async (b: BallotRow, reason: "vetoed" | "written_off"): Promise<void> => {
  unlanded.push(`${reason}:${b.id}:${b.status}`);
  if (hookThrows) throw new Error(RELEASE_REFUSED);
};

/** A subject that holds something while its vote runs, as the redemption closer will. */
const holds: SubjectCloser = { settle, execute, onUnlanded };
const HOOKED: Record<string, SubjectCloser> = { mechanics: holds, mint_rule: holds, token_send: holds };

/** The shape every closer on this build has today: the three older hooks and no fourth. */
const nothingHeld: SubjectCloser = { settle, execute };
const HOOKLESS: Record<string, SubjectCloser> = {
  mechanics: nothingHeld,
  mint_rule: nothingHeld,
  token_send: nothingHeld,
};

const deps = (over: Partial<LandingDeps> = {}): LandingDeps => ({
  pool,
  now: () => NOW,
  vetoHours: () => 72,
  autoApplyEnabled: () => true,
  stewardCouncil: () => false,
  stewardVetoTiers: () => "all",
  nextBoundaryAfter: (after: Date) => new Date(after.getTime() + MOON),
  cycleNumberAt: () => 1,
  landingExpiryCycles: () => 3,
  closerFor: (subjectType: string) => HOOKED[subjectType],
  notify: async () => {},
  endedUnclosedCycle: async () => false,
  waitsForCycleClose: () => false,
  snapsToBoundary: () => false,
  ...over,
});

/**
 * A village whose moon ended with nobody closing it, which is what keeps a
 * cycle-timed decision from ever landing. It is the honest way to reach the
 * write-off with no executor failure in the way, so the attempt rows this file
 * counts are the hook's own and nothing else's.
 */
const unlandable = (over: Partial<LandingDeps> = {}) => deps({ endedUnclosedCycle: async () => true, ...over });

/** Long enough past the landing instant that three twenty-day boundaries have gone. */
const writeOffAt = (landsAt: Date) => new Date(landsAt.getTime() + 200 * DAY);

const openOne = async (over: Partial<OpenBallotInput> = {}): Promise<BallotRow> => {
  n += 1;
  const opened = await openBallot(pool, {
    subjectType: "mechanics",
    subjectRef: `unlanded-${n}`,
    title: `Unlanded ${n}`,
    docMarkdown: "# What the village is deciding",
    method: "custom",
    weightMode: "equal",
    unityPct: 60,
    quorumPct: 20,
    durationDays: 7,
    openedBy: "u-proposer",
    electorate: [
      { userId: "u-a", weight: 1 },
      { userId: "u-b", weight: 1 },
      { userId: "u-st1", weight: 1 },
      { userId: "u-st2", weight: 1 },
      { userId: "u-st3", weight: 1 },
    ],
    ...over,
  });
  if (!opened.ok) throw new Error(`ballot refused to open: ${opened.error}`);
  return opened.ballot;
};

/**
 * Cast the votes, THEN move the window to the fixed close, then close it.
 *
 * That order is the one thing the real clock decides here: `castVote` refuses
 * once `closes_at` is behind `Date.now()`, so a window moved first takes every
 * vote with it.
 */
const carry = async (b: BallotRow, votes: Array<[string, "yes" | "no", string?]> = [["u-a", "yes"], ["u-b", "yes"]]) => {
  for (const [userId, choice, reason] of votes) {
    const v = await castVote(pool, b.id, userId, choice, reason);
    if (!v.ok) throw new Error(`vote refused: ${v.error}`);
  }
  await pool.query("UPDATE ballots SET closes_at = ? WHERE id = ?", [CLOSED_AT, b.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const closed = await closeBallot(pool, {
    ballotId: b.id,
    closedBy: "governance",
    outcomeNote: "The window ended and the engine read the result.",
    closerMayCloseEarly: false,
  });
  if (!closed.ok || !closed.ballot) throw new Error(`close refused: ${JSON.stringify(closed)}`);
  return closed;
};

/** Carried and stamped with its landing instant, the way the close route leaves it. */
const stamped = async (over: Partial<OpenBallotInput> = {}, landing: LandingDeps = deps()): Promise<string> => {
  const b = await openOne(over);
  const closed = await carry(b);
  if (closed.outcome !== "passed") throw new Error(`the fixture did not carry: ${closed.outcome}`);
  await routeOutcome(landing, closed.ballot!, "passed", "The village carried it.", "u-a");
  return b.id;
};

/** A carried cycle-timed decision, which is the one that can sit unlanded. */
const stampedCycleTimed = async (): Promise<string> =>
  stamped({ subjectType: "mint_rule", subjectRef: `mint-${++n}` }, unlandable());

const attemptsOf = async (ballotId: string) => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT last_error, cleared_at IS NULL AS still_open FROM governance_executor_pending WHERE ballot_id = ? ORDER BY id",
    [ballotId],
  );
  return rows.map((r) => ({
    lastError: r.last_error == null ? null : String(r.last_error),
    open: Number(r.still_open) === 1,
  }));
};

/** Seat somebody as a steward: a role carrying the capability, and a holding. */
const seatSteward = async (userId: string) => {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO roles (id, name, capabilities) VALUES ('steward','Steward',?) ON DUPLICATE KEY UPDATE capabilities = VALUES(capabilities)",
    [JSON.stringify([STEWARD_VETO])],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO role_holders (id, role_id, user_id, granted_by, term_ends_at) VALUES (?,?,?,?,NULL) " +
      "ON DUPLICATE KEY UPDATE term_ends_at = VALUES(term_ends_at)",
    [`rh-${userId}`, "steward", userId, "test"],
  );
};

const unseatEveryone = async () => {
  await pool.query("DELETE FROM role_holders WHERE role_id = 'steward'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

/** Every hook call about ONE ballot, so another test's leftovers cannot answer for it. */
const callsFor = (ballotId: string) => unlanded.filter((c) => c.includes(`:${ballotId}:`));

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  // The app pool's timezone discipline: without it a DATETIME comes back parsed
  // in the machine's own zone and every landing instant is hours out.
  pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the applyDue.test.ts shape
  await loadVariables(pool);
  await setVariable(pool, STEWARD_SUBJECTS_KEY, "all");
}, 300000);

afterAll(async () => {
  if (pool) await pool.end();
  if (db) await db.drop();
});

beforeEach(async () => {
  if (!configured) return;
  unlanded = [];
  settled = [];
  executed = [];
  hookThrows = false;
  await unseatEveryone();
});

describe.skipIf(!configured)("a carried decision that will never land tells its subject", () => {
  it("calls onUnlanded once when a steward stops it inside the window", async () => {
    const id = await stamped();
    const stop = await recordVeto(deps(), {
      ballotId: id,
      stewardId: "u-st1",
      reason: "The village has not heard the water budget yet, and this spends against it.",
    });
    expect(stop.ok, JSON.stringify(stop)).toBe(true);
    const row = await landingRow(pool, id);
    expect(row?.landingStatus).toBe("vetoed");
    // The hook is shown the ballot AS IT NOW STANDS, which is failed.
    expect(callsFor(id)).toEqual([`vetoed:${id}:failed`]);
    expect(await attemptsOf(id), "nothing failed, so nothing is waiting for a person").toEqual([]);
  });

  it("calls onUnlanded once when a passed row is written off", async () => {
    const id = await stampedCycleTimed();
    const landsAt = (await landingRow(pool, id))!.landsAt!;
    const report = await applyDueGovernance(unlandable(), writeOffAt(landsAt));
    expect(report.ran && report.expired, JSON.stringify(report)).toBeGreaterThanOrEqual(1);
    expect((await landingRow(pool, id))?.landingStatus).toBe("expired");
    expect(callsFor(id)).toEqual([`written_off:${id}:passed`]);
    expect(await attemptsOf(id)).toEqual([]);
  });

  it("calls nothing when the decision lands", async () => {
    const id = await stamped();
    const landsAt = (await landingRow(pool, id))!.landsAt!;
    await applyDueGovernance(deps(), new Date(landsAt.getTime() + HOUR));
    expect((await landingRow(pool, id))?.landingStatus).toBe("applied");
    expect(executed).toContain(id);
    expect(callsFor(id)).toEqual([]);
  });

  it("calls nothing when the vote fails, because settle already said so", async () => {
    const b = await openOne();
    const closed = await carry(b, [["u-a", "no"], ["u-b", "no"]]);
    expect(closed.outcome).not.toBe("passed");
    await routeOutcome(deps(), closed.ballot!, closed.outcome!, "It did not carry.", "u-a");
    expect(settled).toContain(`${closed.outcome}:${b.id}`);
    expect(callsFor(b.id)).toEqual([]);
  });

  it("calls nothing when a seated steward's no fails it at the close, which also writes vetoed", async () => {
    /*
     * `failByStewardNo` is the OTHER writer of `landing_status = 'vetoed'`, and
     * it must not reach this hook: the ballot never carried in effect, and
     * `settle("failed")` is the call its subject already gets.
     */
    await seatSteward("u-st1");
    const b = await openOne({ subjectType: "token_send", timing: "at_acceptance", subjectRef: `ts-${++n}` });
    const closed = await carry(b, [["u-a", "yes"], ["u-b", "yes"], ["u-st1", "no", "This pays one household twice."]]);
    const routing = await routeOutcome(deps(), closed.ballot!, closed.outcome!, "carried", "u-a");
    expect(routing.outcome).toBe("failed");
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("vetoed");
    expect(settled, "the subject heard it as a failed settle").toContain(`failed:${b.id}`);
    expect(callsFor(b.id)).toEqual([]);
    await applyDueGovernance(deps(), new Date(CLOSED_AT.getTime() + 400 * DAY));
    expect(callsFor(b.id), "and no later tick finds it either").toEqual([]);
  });

  it("calls nothing when a ballot is withdrawn, which is onWithdraw's ending", async () => {
    const b = await openOne();
    const out = await withdrawBallot(pool, {
      ballotId: b.id,
      withdrawnBy: "u-proposer",
      reason: "Opened in error, and the village asked for it to be written again.",
      withdrawerMayDiscardVotes: false,
    });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    await applyDueGovernance(deps(), new Date(CLOSED_AT.getTime() + 400 * DAY));
    const stop = await recordVeto(deps(), {
      ballotId: b.id,
      stewardId: "u-st1",
      reason: "Stopping one that was already called off.",
    });
    expect(stop.ok).toBe(false);
    expect(callsFor(b.id)).toEqual([]);
  });

  it("changes nothing for a subject with no hook, which is every closer on this build", async () => {
    const hookless = (over: Partial<LandingDeps> = {}) => deps({ closerFor: (t: string) => HOOKLESS[t], ...over });

    const vetoed = await stamped();
    const stop = await recordVeto(hookless(), {
      ballotId: vetoed,
      stewardId: "u-st1",
      reason: "A steward stops one whose subject holds nothing at all.",
    });
    expect(stop.ok, JSON.stringify(stop)).toBe(true);
    expect((await landingRow(pool, vetoed))?.landingStatus).toBe("vetoed");

    const written = await stamped({ subjectType: "mint_rule", subjectRef: `mint-${++n}` }, hookless({ endedUnclosedCycle: async () => true }));
    const landsAt = (await landingRow(pool, written))!.landsAt!;
    await applyDueGovernance(hookless({ endedUnclosedCycle: async () => true }), writeOffAt(landsAt));
    expect((await landingRow(pool, written))?.landingStatus).toBe("expired");

    expect(unlanded, "no hook, no call").toEqual([]);
    expect(await attemptsOf(vetoed)).toEqual([]);
    expect(await attemptsOf(written)).toEqual([]);
  });
});

describe.skipIf(!configured)("a hook that throws", () => {
  it("leaves the veto standing, records the error, and is never tried again", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      hookThrows = true;
      const id = await stamped();
      const stop = await recordVeto(deps(), {
        ballotId: id,
        stewardId: "u-st1",
        reason: "The village has not answered the objection this raises.",
      });
      expect(stop.ok, "the veto stands whatever the release did").toBe(true);
      const row = await landingRow(pool, id);
      expect(row?.landingStatus).toBe("vetoed");
      expect(row?.status).toBe("failed");

      const attempts = await attemptsOf(id);
      expect(attempts.length).toBe(1);
      expect(attempts[0].open, "open, so a person is shown it").toBe(true);
      expect(attempts[0].lastError).toContain("onUnlanded(vetoed) threw");
      expect(attempts[0].lastError).toContain(RELEASE_REFUSED);
      expect(logged).toHaveBeenCalled();

      // Not retried: not on the next tick, and not by a second steward pressing it.
      await applyDueGovernance(deps(), new Date(row!.landsAt!.getTime() + 400 * DAY));
      const second = await recordVeto(deps(), {
        ballotId: id,
        stewardId: "u-st2",
        reason: "Saying it again does not stop it twice.",
      });
      expect(second.ok).toBe(false);
      expect(callsFor(id).length, "once, and only once").toBe(1);
      expect((await attemptsOf(id)).length).toBe(1);
    } finally {
      logged.mockRestore();
    }
  });

  it("leaves the write-off standing, records the error, and is never tried again", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      hookThrows = true;
      const id = await stampedCycleTimed();
      const landsAt = (await landingRow(pool, id))!.landsAt!;
      const at = writeOffAt(landsAt);
      const report = await applyDueGovernance(unlandable(), at);
      expect(report.ran && report.expired, JSON.stringify(report)).toBeGreaterThanOrEqual(1);
      expect((await landingRow(pool, id))?.landingStatus, "the write-off stands").toBe("expired");
      expect(report.ran && report.notes.join(" ")).toContain("giving back what it held failed");

      const attempts = await attemptsOf(id);
      expect(attempts.length).toBe(1);
      expect(attempts[0].open).toBe(true);
      expect(attempts[0].lastError).toContain("onUnlanded(written_off) threw");
      expect(logged).toHaveBeenCalled();

      await applyDueGovernance(unlandable(), new Date(at.getTime() + 200 * DAY));
      expect(callsFor(id).length, "once, and only once").toBe(1);
      expect((await attemptsOf(id)).length).toBe(1);
    } finally {
      logged.mockRestore();
    }
  });
});

describe.skipIf(!configured)("a veto and a write-off reaching for the same row", () => {
  it("calls the hook once between them, whichever of the two moved the row", async () => {
    // Written off first: the veto's own UPDATE finds nothing left to move.
    const first = await stampedCycleTimed();
    const firstLands = (await landingRow(pool, first))!.landsAt!;
    await applyDueGovernance(unlandable(), writeOffAt(firstLands));
    const late = await recordVeto(deps(), {
      ballotId: first,
      stewardId: "u-st1",
      reason: "Stopping one that has already been closed.",
    });
    expect(late.ok).toBe(false);
    expect(callsFor(first)).toEqual([`written_off:${first}:passed`]);

    // Vetoed first: no later tick can write it off.
    const second = await stampedCycleTimed();
    const secondLands = (await landingRow(pool, second))!.landsAt!;
    const stop = await recordVeto(deps(), {
      ballotId: second,
      stewardId: "u-st1",
      reason: "Stopping this one while its window is still open.",
    });
    expect(stop.ok, JSON.stringify(stop)).toBe(true);
    await applyDueGovernance(unlandable(), writeOffAt(secondLands));
    expect((await landingRow(pool, second))?.landingStatus).toBe("vetoed");
    expect(callsFor(second)).toEqual([`vetoed:${second}:failed`]);
  });
});

/**
 * THE ROUTE A STEWARD ACTUALLY PRESSES.
 *
 * `register` runs against a fake Express that keeps the handlers, the shape
 * `server/routes/circleBonusGate.test.ts` uses, so what runs is the real
 * registration and the real handler body over a real schema. It proves the two
 * things the lib cases cannot: that the route hands the closer table down, and
 * that under a council the hook fires on the veto that carries the majority
 * rather than on the first one recorded.
 */
type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") },
    handlers,
  };
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

describe.skipIf(!configured)("the veto route, pressed by a steward", () => {
  let handlers: Map<string, Handler>;

  /** The route reads the real clock, so these land in 2036 and are always in time. */
  const routeDeps = () => deps({ nextBoundaryAfter: () => FAR });
  const stampedForRoute = () => stamped({}, routeDeps());

  const post = async (ballotId: string, userId: string, reason: string) => {
    const handler = handlers.get("POST /api/governance/ballots/:id/veto");
    if (!handler) throw new Error("the veto route did not register");
    const { res, out } = makeRes();
    await handler({ params: { id: ballotId }, body: { reason }, userId }, res);
    return out;
  };

  beforeAll(() => {
    const { app, handlers: h } = collect();
    handlers = h;
    registerVetoRoutes(app, {
      authedUser: async (req: any) => ({ id: req.userId, name: "A steward" }),
      mayAct: async () => ({
        ok: true,
        reachedPast: false,
        villageHolds: false,
        source: "test",
        message: "",
        needsOverride: false,
        holderName: null,
      }),
      isAdmin: async () => false,
      getPool: () => pool,
      members: { byId: async () => null },
      firstName: (name: string) => name,
      notify: async () => ({ sent: false }),
      closerFor: (subjectType: string) => HOOKED[subjectType],
    } as any);
  });

  it("tells the subject once when one steward stops it, and never again", async () => {
    await seatSteward("u-st1");
    const id = await stampedForRoute();

    const first = await post(id, "u-st1", "The water budget is not answered, and this spends against it.");
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.stopped).toBe(true);
    expect((await landingRow(pool, id))?.landingStatus).toBe("vetoed");
    expect(callsFor(id)).toEqual([`vetoed:${id}:failed`]);

    const again = await post(id, "u-st1", "Pressing it a second time changes nothing.");
    expect(again.status, "a stopped decision has nothing to stop").toBe(409);
    expect(callsFor(id).length).toBe(1);
  });

  it("tells the subject on the veto that carries a council majority, and not before", async () => {
    await seatSteward("u-st1");
    await seatSteward("u-st2");
    await seatSteward("u-st3");
    await setVariable(pool, STEWARD_COUNCIL_KEY, "true");
    try {
      const id = await stampedForRoute();

      const one = await post(id, "u-st1", "One of us objects, and here is the whole of why.");
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body.stands, "one voice out of three is not a majority").toBe(false);
      expect(one.body.stopped).toBe(false);
      expect((await landingRow(pool, id))?.landingStatus).toBe("pending");
      expect(callsFor(id), "it still lands, so nothing is given back").toEqual([]);

      const two = await post(id, "u-st2", "So does the second, which is the majority a council needs.");
      expect(two.status, JSON.stringify(two.body)).toBe(200);
      expect(two.body.stopped).toBe(true);
      expect((await landingRow(pool, id))?.landingStatus).toBe("vetoed");
      expect(callsFor(id)).toEqual([`vetoed:${id}:failed`]);

      const three = await post(id, "u-st3", "And the third, after it has already been stopped.");
      expect(three.status).toBe(409);
      expect(callsFor(id).length, "once for the decision, not once per steward").toBe(1);
    } finally {
      await setVariable(pool, STEWARD_COUNCIL_KEY, "false");
    }
  });
});
