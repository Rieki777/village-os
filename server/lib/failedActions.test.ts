/**
 * The failed-actions report's judgement, without a database: which deletions
 * it may finish on its own, when a job counts as late, how payments are
 * grouped, what the notice says, and the rule that nothing it writes names a
 * person.
 *
 * Every claim about SQL (the reconcile, the reads, the lock, the daily notice,
 * the real resume) is proved against a real database in
 * server/failedActions.test.ts.
 */
import { describe, expect, it } from "vitest";
import { scrubPersonal } from "../repos/failedActionItems";
import type { SettleErrorGroup } from "../repos/failureSources";
import { isReleaseFailure, releaseFailureNote } from "../repos/governanceExecutorPending";
import {
  BLIND_SPOTS,
  calendarFindings,
  FAILED_ACTIONS_JOB,
  GIVE_UP_AFTER_ATTEMPTS,
  SOURCE_LABELS,
  cadencePhrase,
  defaultSources,
  erasureBackoffSeconds,
  erasureFindings,
  erasureStanding,
  failedReleases,
  jobFindings,
  labelFor,
  landingFindings,
  mayResumeUnattended,
  noticeTitle,
  peerFindings,
  quarantineFindings,
  readableDuration,
  refusalFindings,
  releaseFindings,
  seatFeeFindings,
  settleFindings,
  stillOwedLandings,
  type ErasureRowForReport,
} from "./failedActions";
import { TICK_MS } from "./scheduler";

const HOUR = 60 * 60;

const erasure = (over: Partial<ErasureRowForReport> = {}): ErasureRowForReport => ({
  userId: "usr-wren-halloway",
  attempts: 1,
  stepsDone: ["role-holdings", "tombstone"],
  failedStep: "portraits",
  sinceLastAttemptSeconds: 3 * HOUR,
  ...over,
});

describe("what is scrubbed before anything is kept", () => {
  it("takes email addresses and member ids out of copied text, and leaves the rest alone", () => {
    expect(scrubPersonal("SMTP RCPT TO:<wren@example.org> refused for usr-1784000000000-a1b2")).toBe(
      "SMTP RCPT TO:<(an email address)> refused for (a member)",
    );
    expect(scrubPersonal("503: Service Unavailable")).toBe("503: Service Unavailable");
  });

  it("takes out the id registration mints too, which is every ordinary member's, and leaves a user-agent alone", () => {
    // Registration and Google sign-in mint `user-<epoch>-<rand>`; only bootstrap
    // mints `usr-`. The redemption closer's error names the member this way.
    expect(scrubPersonal("redemption red-1 for member user-1784000000000-9f8e7d6c could not be released")).toBe(
      "redemption red-1 for member (a member) could not be released",
    );
    expect(scrubPersonal("the user-agent header was refused")).toBe("the user-agent header was refused");
  });
});

describe("reading a duration", () => {
  it.each([
    [0, "1 minute"],
    [59, "1 minute"],
    [120, "2 minutes"],
    [HOUR, "1 hour"],
    [5 * HOUR, "5 hours"],
    [24 * HOUR, "1 day"],
    [3 * 24 * HOUR + 5, "3 days"],
  ])("%i seconds reads as %s", (seconds, text) => {
    expect(readableDuration(seconds)).toBe(text);
  });

  it("says every hour and every day, never every 1 hour", () => {
    expect(cadencePhrase(HOUR)).toBe("hour");
    expect(cadencePhrase(24 * HOUR)).toBe("day");
    expect(cadencePhrase(6 * HOUR)).toBe("6 hours");
    expect(cadencePhrase(5 * 60)).toBe("5 minutes");
  });
});

describe("where an unfinished deletion stands", () => {
  it("is still open before the tombstone step, whatever else ran and however often", () => {
    expect(erasureStanding(erasure({ stepsDone: ["role-holdings"] }))).toBe("before-close");
    expect(erasureStanding(erasure({ stepsDone: [], attempts: 50 }))).toBe("before-close");
  });

  it("is closed after it, and needs a person after ten attempts or a missing record", () => {
    expect(erasureStanding(erasure())).toBe("after-close");
    expect(erasureStanding(erasure({ attempts: GIVE_UP_AFTER_ATTEMPTS - 1 }))).toBe("after-close");
    expect(erasureStanding(erasure({ attempts: GIVE_UP_AFTER_ATTEMPTS }))).toBe("needs-a-person");
    expect(erasureStanding(erasure({ failedStep: "load-member" }))).toBe("needs-a-person");
  });

  it("leaves alone a sweep that may still be running: no failing step, begun under ten minutes ago", () => {
    const live = erasure({ failedStep: null, sinceLastAttemptSeconds: 60 });
    expect(erasureStanding(live)).toBe("running");
    expect(mayResumeUnattended(live)).toBe(false);
    expect(erasureFindings([live])).toEqual([]);
    expect(erasureStanding(erasure({ failedStep: null, sinceLastAttemptSeconds: 11 * 60 }))).toBe("after-close");
    // A recorded failure is a failure however recent it is.
    expect(erasureStanding(erasure({ failedStep: "portraits", sinceLastAttemptSeconds: 60 }))).toBe("after-close");
  });

  it("dates each standing from the oldest deletion in it", () => {
    const out = erasureFindings([
      erasure({ userId: "usr-older", sinceStartSeconds: 3 * 24 * HOUR }),
      erasure({ userId: "usr-newer", sinceStartSeconds: HOUR }),
    ]);
    expect(out).toEqual([expect.objectContaining({ key: "after-close", failingForSeconds: 3 * 24 * HOUR })]);
  });
});

describe("when the job may finish a deletion on its own", () => {
  it("waits two hours after the first attempt, doubling, never more than a day", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => erasureBackoffSeconds(n) / HOUR)).toEqual([2, 2, 4, 8, 16, 24, 24]);
  });

  it("finishes only a closed account whose wait is over", () => {
    expect(mayResumeUnattended(erasure({ sinceLastAttemptSeconds: 3 * HOUR }))).toBe(true);
    expect(mayResumeUnattended(erasure({ sinceLastAttemptSeconds: HOUR }))).toBe(false);
    expect(mayResumeUnattended(erasure({ attempts: 3, sinceLastAttemptSeconds: 7 * HOUR }))).toBe(false);
    expect(mayResumeUnattended(erasure({ attempts: 3, sinceLastAttemptSeconds: 8 * HOUR }))).toBe(true);
    expect(mayResumeUnattended(erasure({ sinceLastAttemptSeconds: null }))).toBe(true);
  });

  it("never finishes an account that still works, or one the retries gave up on", () => {
    const long = 99 * HOUR;
    expect(mayResumeUnattended(erasure({ stepsDone: ["role-holdings"], sinceLastAttemptSeconds: long }))).toBe(false);
    expect(mayResumeUnattended(erasure({ attempts: GIVE_UP_AFTER_ATTEMPTS, sinceLastAttemptSeconds: long }))).toBe(false);
    expect(mayResumeUnattended(erasure({ failedStep: "load-member", sinceLastAttemptSeconds: long }))).toBe(false);
  });
});

describe("what the report says about deletions", () => {
  const rows = [
    erasure({ userId: "usr-wren-before", stepsDone: ["role-holdings"], failedStep: "portraits" }),
    erasure({ userId: "usr-ash-before", stepsDone: ["role-holdings"], failedStep: null }),
    erasure({ userId: "usr-rowan-after" }),
    erasure({ userId: "usr-sage-stuck", attempts: GIVE_UP_AFTER_ATTEMPTS }),
    erasure({ userId: "usr-fern-after", failedStep: "audit" }),
  ];

  it("counts each standing and tallies where each stopped", () => {
    const out = erasureFindings(rows);
    expect(out.map((f) => f.key)).toEqual(["before-close", "after-close", "needs-a-person"]);
    expect(out[0].title).toBe("2 account deletions stopped before the account was closed");
    expect(out[0].lastError).toBe("stopped at portraits (1), stopped without recording a step (1)");
    expect(out[1]).toMatchObject({
      title: "2 closed accounts still have records waiting to be removed",
      lastError: "stopped at portraits (1), stopped at audit (1)",
      quietHours: 24,
    });
    expect(out[2].advice).toContain("Pressing Finish them on the review queue (/review) tries once more.");
  });

  it("names nobody, anywhere in what it writes", () => {
    const text = JSON.stringify(erasureFindings(rows));
    for (const r of rows) expect(text).not.toContain(r.userId);
  });

  it("says when there were more than it read, instead of passing off a page as the total", () => {
    const out = erasureFindings(rows.slice(0, 2), 1400);
    expect(out[out.length - 1]).toMatchObject({
      key: "unread",
      title: "1400 account deletions are unfinished, and this report read the oldest 2",
    });
  });

  it("says nothing when nothing is unfinished", () => {
    expect(erasureFindings([])).toEqual([]);
  });
});

describe("scheduled jobs", () => {
  const hourly = { name: "stay-nightly", everyMs: HOUR * 1000 };
  const allowed = (2 * hourly.everyMs + TICK_MS) / 1000;

  it("reports a job whose last run threw, with what it said", () => {
    const out = jobFindings([{ job: "stay-nightly", lastResult: "FAILED: connection lost", sinceLastRunSeconds: 60 }], [hourly], 10_000);
    expect(out).toEqual([expect.objectContaining({ key: "stay-nightly:failed", lastError: "FAILED: connection lost" })]);
  });

  it("calls a job late past twice its cadence and a tick, and not a second before", () => {
    expect(jobFindings([{ job: "stay-nightly", lastResult: "ok", sinceLastRunSeconds: allowed }], [hourly], 1e9)).toEqual([]);
    const late = jobFindings([{ job: "stay-nightly", lastResult: "ok", sinceLastRunSeconds: allowed + 1 }], [hourly], 1e9);
    expect(late.map((f) => f.key)).toEqual(["stay-nightly:overdue"]);
    expect(late[0].advice).toContain("It should run every hour.");
  });

  it("gives a job that never ran its first turn before calling it late", () => {
    expect(jobFindings([], [hourly], allowed)).toEqual([]);
    expect(jobFindings([], [hourly], allowed + 1).map((f) => f.title)).toEqual(["The stay-nightly job has never run"]);
  });

  it("leaves its own health to the tab, which reads the scheduler row directly", () => {
    const self = { name: FAILED_ACTIONS_JOB, everyMs: HOUR * 1000 };
    expect(jobFindings([{ job: FAILED_ACTIONS_JOB, lastResult: "FAILED: x", sinceLastRunSeconds: 1e7 }], [self], 1e9)).toEqual([]);
  });
});

describe("decisions taking effect", () => {
  it("says a landing that wrote no error most likely met a restart", () => {
    const [f] = landingFindings([{ ballotId: "bal-1", attempts: 1, lastError: null }], new Set());
    expect(f.key).toBe("bal-1");
    expect(f.lastError).toContain("restarted");
  });

  it("lists a landing only while it is still owed: it can still land, or it took effect at close and gets no second try", () => {
    const rows = ["b-pending", "b-applying", "b-stalled", "b-at-close", "b-applied", "b-vetoed", "b-expired", "b-deleted"].map(
      (ballotId) => ({ ballotId, attempts: 1, lastError: "the executor threw" }),
    );
    const statuses = new Map([
      ["b-pending", "pending"],
      ["b-applying", "applying"],
      ["b-stalled", "stalled"],
      ["b-at-close", "not_applicable"],
      ["b-applied", "applied"],
      ["b-vetoed", "vetoed"],
      ["b-expired", "expired"],
    ]);
    expect(stillOwedLandings(rows, statuses).map((r) => r.ballotId)).toEqual(["b-pending", "b-applying", "b-stalled", "b-at-close"]);
  });

  it("says the landing job tries again only a decision with a landing time, whatever its status", () => {
    // The two shapes a release may park an at-close failure in: kept with a
    // landing time so the job retries it, or left without one. Status alone
    // cannot tell them apart, and the job selects on the landing time.
    const rows = ["b-retrying", "b-left"].map((ballotId) => ({ ballotId, attempts: 2, lastError: "the executor threw" }));
    const [retrying, left] = landingFindings(rows, new Set(["b-retrying"]));
    expect(retrying.advice).toContain("the landing job tries it again every few minutes while automatic landing is on");
    expect(left.advice).toContain("nothing tries it again");
    expect(retrying.advice).not.toContain("nothing tries it again");
    expect(left.advice).not.toContain("every few minutes");
  });

  it("lists a stopped decision only when giving back what it held failed, never a landing that failed before it was stopped", () => {
    const released = (reason: "vetoed" | "written_off") => releaseFailureNote(reason, "the ledger refused the release");
    const rows = [
      { ballotId: "b-vetoed-give-back", attempts: 1, lastError: released("vetoed") },
      { ballotId: "b-expired-give-back", attempts: 4, lastError: released("written_off") },
      // A scheduled landing that kept failing and was then written off: the same
      // row shape, and no give-back failed. It stays governance's own record.
      { ballotId: "b-expired-landing", attempts: 4, lastError: "the executor threw" },
      // Open with nothing written: no failure recorded, so nothing to list.
      { ballotId: "b-vetoed-silent", attempts: 1, lastError: null },
      // The note on a decision that is still owed, or that landed, is not this list's.
      { ballotId: "b-pending", attempts: 1, lastError: released("vetoed") },
      { ballotId: "b-applied", attempts: 1, lastError: released("vetoed") },
      { ballotId: "b-deleted", attempts: 1, lastError: released("vetoed") },
    ];
    const statuses = new Map([
      ["b-vetoed-give-back", "vetoed"],
      ["b-expired-give-back", "expired"],
      ["b-expired-landing", "expired"],
      ["b-vetoed-silent", "vetoed"],
      ["b-pending", "pending"],
      ["b-applied", "applied"],
    ]);

    expect(failedReleases(rows, statuses).map((r) => [r.ballotId, r.stoppedAs])).toEqual([
      ["b-vetoed-give-back", "vetoed"],
      ["b-expired-give-back", "expired"],
    ]);
    // #247's list is untouched, and the two never claim the same ballot.
    expect(stillOwedLandings(rows, statuses).map((r) => r.ballotId)).toEqual(["b-pending"]);
    expect(isReleaseFailure("the executor threw")).toBe(false);
    expect(isReleaseFailure(null)).toBe(false);
  });

  it("says a failed give-back was stopped or written off, that nothing retries it, and names nobody", () => {
    const lastError = releaseFailureNote("vetoed", "redemption red-1 for member user-1784000000000-9f8e7d6c could not be released");
    const [vetoed, written] = releaseFindings([
      { ballotId: "bal-1784000000000-abc123", attempts: 1, lastError, stoppedAs: "vetoed" },
      { ballotId: "bal-1784000000001-def456", attempts: 4, lastError, stoppedAs: "expired" },
    ]);

    expect(vetoed.title).toBe(
      "A decision the village carried was stopped before it took effect, and giving back what it held failed (ballot bal-1784000000000-abc123)",
    );
    expect(written.title).toBe(
      "A decision the village carried was written off before it took effect, and giving back what it held failed (ballot bal-1784000000001-def456)",
    );
    expect(vetoed.advice).toContain("It was stopped inside its landing window");
    expect(written.advice).toContain("sat unlanded through too many cycles and was written off");
    for (const f of [vetoed, written]) {
      expect(f.key).toMatch(/^give-back:bal-/);
      expect(f.advice).toContain("nothing tries it again");
      expect(f.advice).toContain("finishes it by hand");
      expect(f.advice).toContain("close the open attempt on the decision's landing record");
      // #247's landing sentences belong to decisions still owed a landing.
      expect(f.advice).not.toContain("every few minutes");
      // Whole, never clipped by the columns they are written to.
      expect(f.title.length).toBeLessThanOrEqual(255);
      expect(f.advice.length).toBeLessThanOrEqual(600);
      // The member rides in the error alone, which is scrubbed on the way in.
      expect(`${f.key} ${f.title} ${f.advice}`).not.toMatch(/usr-|user-\d|@/);
      expect(f.lastError).toBe(lastError);
    }
  });
});

describe("payments", () => {
  const group = (over: Partial<SettleErrorGroup> = {}): SettleErrorGroup => ({
    module: "stays",
    orderId: "ord-1",
    errors: 1,
    oldestAgeSeconds: 7200,
    latestDetail: "refused",
    ...over,
  });

  it("lists an order once, dated from its first failed delivery, with the latest error and six quiet hours", () => {
    const out = settleFindings([
      group({ errors: 3, latestDetail: "third try" }),
      group({ module: "exchange", orderId: "ord-2", oldestAgeSeconds: 60, latestDetail: "other" }),
    ]);
    expect(out.map((f) => [f.key, f.lastError, f.quietHours, f.failingForSeconds])).toEqual([
      ["stays:ord-1", "third try", 6, 7200],
      ["exchange:ord-2", "other", 6, 60],
    ]);
    expect(out[0].advice).toContain("30 days after its last failed delivery, fixed or not");
  });

  it("gathers the failures that named no order into one item, and promises no heal for it", () => {
    const out = settleFindings([group({ module: null, orderId: null, errors: 4, oldestAgeSeconds: 9000, latestDetail: "invoice renewal refused" })]);
    expect(out).toEqual([
      expect.objectContaining({
        key: "no-order",
        title: "4 payment deliveries that named no order failed to settle in the last 30 days",
        failingForSeconds: 9000,
        lastError: "invoice renewal refused",
      }),
    ]);
    expect(out[0].advice).not.toContain("clears when a delivery settles");
  });

  it("says it listed only the oldest orders when there were more", () => {
    const out = settleFindings([group()], true);
    expect(out[out.length - 1]).toMatchObject({
      key: "unread",
      title: "More orders failed to settle than this report reads, so it listed the oldest 1",
    });
  });

  it("needs three bad signatures in a day, and one payment for a missing module or order", () => {
    expect(refusalFindings({ sig_fail: 2 })).toEqual([]);
    expect(refusalFindings({ sig_fail: 3, no_handler: 1, no_order: 1 }).map((f) => f.key)).toEqual(["sig_fail", "no_handler", "no_order"]);
    expect(refusalFindings({})).toEqual([]);
  });
});

describe("the other areas", () => {
  it("lists a kept seat fee that never reached the treasury, dated from when it was kept, naming nobody", () => {
    const charge = {
      id: "sc-2",
      eventId: "ev-1",
      userId: "usr-seat-holder",
      occurrenceKey: "",
      chargeSeq: 2,
      tokenType: "seat-credit",
      amount: 5,
      settledAgeSeconds: 7200,
    };
    const out = seatFeeFindings([charge]);
    expect(out.map((f) => [f.key, f.failingForSeconds])).toEqual([["sc-2", 7200]]);
    expect(JSON.stringify(out)).not.toContain("usr-seat-holder");
  });

  it("says how far it looked when the paging cap stopped it", () => {
    expect(seatFeeFindings([], 10000)).toEqual([
      expect.objectContaining({ key: "unread", title: "This report checked the newest 10000 kept seat fees and stopped there" }),
    ]);
  });

  it("treats a paused link as a person's job at once, and a stale one after a quiet day", () => {
    const out = peerFindings([
      { id: "p1", name: "Northfield", status: "paused", lastError: null, sinceSyncSeconds: 10 },
      { id: "p2", name: "Southmere", status: "active", lastError: "timeout", sinceSyncSeconds: 3 * 24 * HOUR },
    ]);
    expect(out[0].quietHours).toBeUndefined();
    expect(out[1]).toMatchObject({ title: "Southmere has not synced for 3 days", quietHours: 24, failingForSeconds: 3 * 24 * HOUR });
  });

  it("keys a startup check on what was checked, so a restart never reopens it as new, and copies none of its text", () => {
    const out = quarantineFindings([
      { id: "evt-after-restart", entityType: "module", entityRef: "library" },
      { id: "evt-before-restart", entityType: "module", entityRef: "library" },
      { id: "evt-holdings", entityType: "village", entityRef: "capability_holding" },
    ]);
    expect(out.map((f) => f.key)).toEqual(["module:library", "village:capability_holding"]);
    expect(out[0]).toMatchObject({ title: "A module was switched off when the village started", lastError: "Module: library" });
    expect(out[1]).toMatchObject({ title: "A startup check found records that do not add up", lastError: "Check: capability_holding" });
    expect(out[1].advice).not.toContain("switched off");
  });

  it("keeps an admin-typed feed name out of the title, which outlives the failure", () => {
    const [f] = calendarFindings([{ id: "cal-1", name: "Wren Halloway, private sessions", lastError: "HTTP 404" }]);
    expect(f.title).toBe("A calendar feed is failing");
    expect(f.lastError).toBe("Wren Halloway, private sessions: HTTP 404");
  });

  it("reads the areas in the order the tab lists them", () => {
    const keys = defaultSources({} as any).map((s) => s.key);
    expect(Object.keys(SOURCE_LABELS).filter((k) => k !== "report")).toEqual(keys);
  });

  it("names every area it reads, once each", () => {
    const keys = defaultSources({} as any).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(SOURCE_LABELS[key], key).toBeTruthy();
    expect(labelFor("report")).toBe("This report");
    expect(BLIND_SPOTS.length).toBeGreaterThan(0);
  });
});

describe("the notice", () => {
  it("says what is new, and how much is failing in all", () => {
    expect(noticeTitle(1, 1)).toBe("1 thing is failing in the village. The report says what to do about it.");
    expect(noticeTitle(3, 3)).toBe("3 things are failing in the village. The report says what to do about each.");
    expect(noticeTitle(2, 5)).toBe("2 new failures in the village, 5 in all. The report says what to do about each.");
    expect(noticeTitle(1, 5)).toBe("1 new failure in the village, 5 in all. The report says what to do about each.");
    expect(noticeTitle(0, 4)).toBe("4 things are still failing in the village. The report says what to do about each.");
    expect(noticeTitle(0, 1)).toBe("1 thing is still failing in the village. The report says what to do about it.");
  });
});
