/**
 * WHAT THE VILLAGE HEARS, AND WHAT A STEWARD READS, ABOUT A LANDING THAT FAILED
 * AT THE CLOSE.
 *
 * Pins the two defects PR #266 left, against the real landing path on the S5
 * harness:
 *
 *  - the pulse line, the roll and the proposer are told the vote carried and the
 *    decision has not taken effect yet, with the routing's own sentence, and
 *    nobody is sent `ballot_carried`, on both shapes (`closeActivityLine` and
 *    `tellRollTheOutcome` in server/lib/ballotNotices.ts, which the close route
 *    calls);
 *  - when the landing job lands a parked row, the roll and the proposer hear
 *    `ballot_carried` once, and an ordinary landing through the same job, even
 *    one that failed first, adds nothing;
 *  - a veto on either shape is refused with a sentence true of that shape, by
 *    `recordVeto` and by the window check the veto route asks, and a window the
 *    brake handed back on a row with a failed attempt stays open.
 *
 * The clock is one instant taken at load and passed in everywhere. No
 * TEST_DATABASE_URL: the database cases skip, and an unfiltered run fails on the
 * way out (house rule).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { castVote, closeBallot, openBallot, type BallotRow } from "./ballots";
import {
  applyDueGovernance,
  landingRow,
  recordVeto,
  routeOutcome,
  vetoWindowOn,
  type CloseRouting,
  type LandingDeps,
  type SubjectCloser,
} from "./applyDue";
import {
  AT_CLOSE_RETRY_SAFE_SUBJECTS,
  NOT_YET_NEEDS_A_PERSON,
  NOT_YET_RETRYING,
  TOOK_EFFECT_BODY,
  VETO_REFUSED_NEEDS_A_PERSON,
  VETO_REFUSED_RETRYING,
  notYetInEffectVetoRefusal,
} from "./atCloseLanding";
import { closeActivityLine, tellRollTheOutcome } from "./ballotNotices";
import { sqlInstant } from "../repos/ballotLandings";
import { VILLAGE_LAUNCH } from "../../shared/ballotSubjects";
import { executesAtPassWithNoWindow } from "../../shared/governanceKinds";
import { NOTIFICATION_KINDS } from "../../shared/notificationKinds";

const configured = testDbConfigured();
if (!configured) {
  console.warn("[atCloseNotice] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");
}

const HOUR = 60 * 60 * 1000;
/** The one instant this file reads, whole minutes, so a TIMESTAMP round trip loses nothing. */
const T0 = new Date(Math.floor(Date.now() / 60_000) * 60_000);
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const NOTE = "The window ended and the village carried it.";

let db: TestDb;
let pool: mysql.Pool;
let n = 0;

const executes = new Map<string, number>();
const failing = new Set<string>();

interface Notice {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  dedupeKey: string;
}
/** Every notify call, in order. */
const attempts: Notice[] = [];
/** The notifications table's unique key, kept in memory: a second insert on one key is a no-op. */
const bell = new Map<string, Notice>();
const notify = async (x: Notice): Promise<void> => {
  attempts.push(x);
  if (!bell.has(x.dedupeKey)) bell.set(x.dedupeKey, x);
};
const heardAbout = (ballotId: string): Notice[] => [...bell.values()].filter((x) => x.dedupeKey.startsWith(`bal:${ballotId}:`));
const rollDeps = () => ({ pool, notify, link: (b: { id: string }) => `/decisions/${b.id}` });

const quietSettle = async (): Promise<CloseRouting> => ({ applied: [], held: null, proposerTold: null });
const executor = (why: string): SubjectCloser["execute"] => async (b) => {
  executes.set(b.id, (executes.get(b.id) ?? 0) + 1);
  if (failing.has(b.id)) throw new Error(why);
  return { applied: [], held: null, proposerTold: null };
};

const CLOSERS: Record<string, SubjectCloser> = {
  [VILLAGE_LAUNCH]: { settle: quietSettle, execute: executor("the launch record could not be written") },
  token_send: { settle: quietSettle, execute: executor("the ledger refused the send") },
  mechanics: { settle: quietSettle, execute: executor("the dial write failed") },
};

const deps = (over: Partial<LandingDeps> = {}): LandingDeps => ({
  pool,
  now: () => T0,
  vetoHours: () => 72,
  autoApplyEnabled: () => true,
  stewardCouncil: () => false,
  stewardVetoTiers: () => "all",
  nextBoundaryAfter: (after: Date) => new Date(after.getTime() + 20 * 24 * HOUR),
  cycleNumberAt: () => 1,
  landingExpiryCycles: () => 3,
  closerFor: (subjectType: string) => CLOSERS[subjectType],
  notify,
  endedUnclosedCycle: async () => false,
  waitsForCycleClose: () => false,
  snapsToBoundary: () => false,
  ...over,
});

/** Open, everyone on the roll votes yes, the window moves behind T0, and a member closes it. */
const carried = async (
  subjectType: string,
  opts: { timing?: "at_acceptance"; fails?: boolean } = {},
): Promise<BallotRow> => {
  n += 1;
  const opened = await openBallot(pool, {
    subjectType,
    subjectRef: `${subjectType}-notice-${n}`,
    title: `Failed landing notice ${n}`,
    docMarkdown: "# What the village is deciding",
    method: "custom",
    weightMode: "equal",
    unityPct: 60,
    quorumPct: 20,
    durationDays: 7,
    openedBy: "u-proposer",
    ...(opts.timing ? { timing: opts.timing } : {}),
    electorate: [
      { userId: "u-a", weight: 1 },
      { userId: "u-b", weight: 1 },
      { userId: "u-c", weight: 1 },
    ],
  });
  if (!opened.ok) throw new Error(`ballot refused to open: ${opened.error}`);
  for (const voter of ["u-a", "u-b", "u-c"]) {
    const v = await castVote(pool, opened.ballot.id, voter, "yes");
    if (!v.ok) throw new Error(`vote refused: ${v.error}`);
  }
  await pool.query("UPDATE ballots SET closes_at = ? WHERE id = ?", [sqlInstant(at(-60_000)), opened.ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  if (opts.fails !== false) failing.add(opened.ballot.id);
  const closed = await closeBallot(pool, { ballotId: opened.ballot.id, closedBy: "u-a", outcomeNote: NOTE, closerMayCloseEarly: false });
  if (!closed.ok || !closed.ballot || closed.outcome !== "passed") throw new Error(`close refused: ${JSON.stringify(closed)}`);
  return closed.ballot;
};

/** Move a row's instant, as the window running out or a window handed back would. */
const setLandsAt = async (ballotId: string, when: Date) => {
  await pool.query("UPDATE ballots SET lands_at = ?, veto_closes_at = ? WHERE id = ?", [sqlInstant(when), sqlInstant(when), ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

describe("the sentences, decided from the row", () => {
  it("retries from the close only subjects with no window, which is what names a parked row", () => {
    expect(AT_CLOSE_RETRY_SAFE_SUBJECTS.size).toBeGreaterThan(0);
    for (const s of AT_CLOSE_RETRY_SAFE_SUBJECTS) expect(executesAtPassWithNoWindow(s), s).toBe(true);
  });

  it("refuses a veto on each shape with its own sentence, and leaves a handed-back window alone", () => {
    const failed = { lastError: "it broke", cleared: false };
    const now = new Date("2026-09-15T12:00:00Z");
    const earlier = new Date(now.getTime() - HOUR);
    const later = new Date(now.getTime() + HOUR);
    const refusal = (landingStatus: string, landsAt: Date | null, newestAttempt: typeof failed | null) =>
      notYetInEffectVetoRefusal({ status: "passed", landingStatus, landsAt, newestAttempt }, now);

    expect(refusal("stalled", null, failed)).toBe(VETO_REFUSED_NEEDS_A_PERSON);
    expect(refusal("pending", earlier, failed)).toBe(VETO_REFUSED_RETRYING);
    expect(refusal("pending", now, failed), "the instant itself is past, as the late refusal reads it").toBe(VETO_REFUSED_RETRYING);
    expect(refusal("pending", later, failed), "a window handed back is open").toBeNull();
    expect(refusal("stalled", earlier, failed), "the brake's stall is not this shape").toBeNull();
    expect(refusal("pending", earlier, null)).toBeNull();
    expect(refusal("pending", earlier, { lastError: "it broke", cleared: true })).toBeNull();
    expect(notYetInEffectVetoRefusal({ status: "failed", landingStatus: "stalled", landsAt: null, newestAttempt: failed }, now)).toBeNull();
    for (const s of [VETO_REFUSED_NEEDS_A_PERSON, VETO_REFUSED_RETRYING]) {
      expect(s).toContain("has not taken effect yet");
      expect(s).not.toContain("took effect the moment it carried");
      expect(s).not.toContain("what a steward may stop");
    }
  });

  it("gives a carried vote that has not taken effect its own quiet kind and pulse line", () => {
    expect(NOTIFICATION_KINDS.ballot_not_yet_in_effect?.celebrate).toBe(false);
    expect(closeActivityLine("Start", "passed", "retrying")).toBe("A village vote carried and has not taken effect yet: Start");
    expect(closeActivityLine("Start", "passed", "stalled")).toBe("A village vote carried and has not taken effect yet: Start");
    expect(closeActivityLine("Start", "passed")).toBe("A village vote carried: Start");
    expect(closeActivityLine("Start", "failed")).toBe("A village vote closed without passing: Start");
  });
});

describe.skipIf(!configured)("a landing that failed at the close, told and refused honestly", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool
  }, 300000);
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(() => {
    executes.clear();
    failing.clear();
    attempts.length = 0;
    bell.clear();
  });

  const closeAndTell = async (b: BallotRow, proposerId: string | null = "u-proposer") => {
    const routing = await routeOutcome(deps(), b, "passed", NOTE, "u-a");
    await tellRollTheOutcome(rollDeps(), { ballot: b, outcome: routing.outcome!, binds: true, outcomeNote: NOTE, routing, proposerId });
    return routing;
  };

  it("a retrying village_launch: the pulse, the roll and the proposer hear it has not taken effect", async () => {
    const b = await carried(VILLAGE_LAUNCH);
    const routing = await closeAndTell(b);
    expect(routing.landingFailed).toBe("retrying");
    expect(closeActivityLine(b.title, routing.outcome!, routing.landingFailed)).toBe(
      `A village vote carried and has not taken effect yet: ${b.title}`,
    );

    const heard = heardAbout(b.id);
    expect(heard.filter((x) => x.type === "ballot_carried"), "nobody is told it carried and applies").toEqual([]);
    expect(heard.map((x) => x.userId).sort(), "the roll and the proposer off it").toEqual(["u-a", "u-b", "u-c", "u-proposer"]);
    for (const x of heard) {
      expect(x.type).toBe("ballot_not_yet_in_effect");
      expect(x.title).toBe(`Carried, not yet in effect: ${b.title}`);
      expect(x.body).toContain(NOT_YET_RETRYING);
      expect(x.body).toContain(NOTE);
      expect(x.dedupeKey).toBe(`bal:${b.id}:outcome:u${x.userId}`);
    }
  });

  it("a stalled token send: the roll and the proposer hear it waits for a person", async () => {
    const b = await carried("token_send", { timing: "at_acceptance" });
    const routing = await closeAndTell(b);
    expect(routing.landingFailed).toBe("stalled");
    const heard = heardAbout(b.id);
    expect(heard.map((x) => x.userId).sort()).toEqual(["u-a", "u-b", "u-c", "u-proposer"]);
    for (const x of heard) {
      expect(x.type).toBe("ballot_not_yet_in_effect");
      expect(x.body).toContain(NOT_YET_NEEDS_A_PERSON);
    }
  });

  it("a proposer who is also on the roll gets one row, because both sends use one key", async () => {
    const b = await carried(VILLAGE_LAUNCH);
    await closeAndTell(b, "u-a");
    const toProposer = attempts.filter((x) => x.userId === "u-a" && x.dedupeKey.startsWith(`bal:${b.id}:`));
    expect(toProposer.length, "the roll and the proposer send both reached u-a").toBe(2);
    expect(new Set(toProposer.map((x) => x.dedupeKey)).size, "on one key, so the second is a no-op").toBe(1);
    expect(heardAbout(b.id).filter((x) => x.userId === "u-a")).toHaveLength(1);
  });

  it("a launch that lands at the close still tells the roll it carried, and nobody else", async () => {
    const b = await carried(VILLAGE_LAUNCH, { fails: false });
    const routing = await closeAndTell(b);
    expect(routing.landingFailed).toBeUndefined();
    expect(closeActivityLine(b.title, routing.outcome!, routing.landingFailed)).toBe(`A village vote carried: ${b.title}`);
    const heard = heardAbout(b.id);
    expect(heard.map((x) => x.userId).sort()).toEqual(["u-a", "u-b", "u-c"]);
    for (const x of heard) {
      expect(x.type).toBe("ballot_carried");
      expect(x.title).toBe(`Carried: ${b.title}`);
    }
  });

  it("when the landing job lands a parked one, the roll and the proposer hear ballot_carried once", async () => {
    const b = await carried(VILLAGE_LAUNCH);
    await closeAndTell(b);
    failing.delete(b.id);
    await applyDueGovernance(deps(), at(5 * 60_000));
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("applied");

    const tookEffect = heardAbout(b.id).filter((x) => x.dedupeKey.includes(":took-effect:"));
    expect(tookEffect.map((x) => x.userId).sort()).toEqual(["u-a", "u-b", "u-c", "u-proposer"]);
    for (const x of tookEffect) {
      expect(x.type).toBe("ballot_carried");
      expect(x.title).toBe(`Now in effect: ${b.title}`);
      expect(x.body).toBe(TOOK_EFFECT_BODY);
      expect(x.link).toBe(`/decisions/${b.id}`);
      expect(x.dedupeKey).toBe(`bal:${b.id}:took-effect:u${x.userId}`);
    }

    const sent = attempts.filter((x) => x.dedupeKey.startsWith(`bal:${b.id}:`)).length;
    await applyDueGovernance(deps(), at(10 * 60_000));
    expect(attempts.filter((x) => x.dedupeKey.startsWith(`bal:${b.id}:`)).length, "a landed row is never told again").toBe(sent);
  });

  it("an ordinary Game change landing through the same job, even after a failed try, tells the roll nothing", async () => {
    const b = await carried("mechanics");
    const routing = await routeOutcome(deps(), b, "passed", NOTE, "u-a");
    expect(routing.landingFailed).toBeUndefined();
    await setLandsAt(b.id, at(-HOUR));
    await applyDueGovernance(deps(), T0);
    expect(executes.get(b.id), "the job tried it and it threw").toBe(1);
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("pending");

    failing.delete(b.id);
    await applyDueGovernance(deps(), at(5 * 60_000));
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("applied");
    expect(heardAbout(b.id).filter((x) => x.type === "ballot_carried")).toEqual([]);
  });

  it("a veto on a stalled one is refused saying it has not taken effect and waits for a person", async () => {
    const b = await carried("token_send", { timing: "at_acceptance" });
    await routeOutcome(deps(), b, "passed", NOTE, "u-a");
    const later = at(HOUR);
    const refused = await recordVeto(deps({ now: () => later }), { ballotId: b.id, stewardId: "u-steward", reason: "stop it" });
    expect(refused).toEqual({ ok: false, error: VETO_REFUSED_NEEDS_A_PERSON });
    expect(await vetoWindowOn(pool, b.id, later)).toEqual({ open: false, known: true, error: VETO_REFUSED_NEEDS_A_PERSON });
    expect((await landingRow(pool, b.id))?.vetoedAt, "and nothing was stopped").toBeNull();
  });

  it("a veto on a retrying village_launch is refused saying it has not taken effect and is being tried again", async () => {
    const b = await carried(VILLAGE_LAUNCH);
    await routeOutcome(deps(), b, "passed", NOTE, "u-a");
    expect((await landingRow(pool, b.id))?.vetoLocked, "the lock that used to pick the steward-limits sentence").toBe(true);
    const later = at(HOUR);
    const refused = await recordVeto(deps({ now: () => later }), { ballotId: b.id, stewardId: "u-steward", reason: "stop it" });
    expect(refused).toEqual({ ok: false, error: VETO_REFUSED_RETRYING });
    expect(await vetoWindowOn(pool, b.id, later)).toEqual({ open: false, known: true, error: VETO_REFUSED_RETRYING });

    failing.delete(b.id);
    await applyDueGovernance(deps(), at(5 * 60_000));
    const afterLanding = await recordVeto(deps({ now: () => later }), { ballotId: b.id, stewardId: "u-steward", reason: "stop it" });
    expect(afterLanding.ok === false && afterLanding.error, "once it lands, the landed refusal applies").toContain("already landed");
  });

  it("a window handed back on a row with a failed attempt stays open to a steward", async () => {
    const b = await carried("mechanics");
    await routeOutcome(deps(), b, "passed", NOTE, "u-a");
    await setLandsAt(b.id, at(-HOUR));
    await applyDueGovernance(deps(), T0);
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("pending");
    await setLandsAt(b.id, at(72 * HOUR));
    expect(await vetoWindowOn(pool, b.id, at(HOUR))).toEqual({ open: true, known: true });
  });
});
