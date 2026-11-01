/**
 * The exit-code decision for a run that touched no database.
 *
 * WHY THIS FILE EXISTS AS A UNIT TEST AND NOT AN E2E ONE. The behaviour under
 * test lives in vitest's own globalTeardown, so proving it end to end means
 * spawning a whole suite from inside a suite, twice, at about five minutes
 * each. `hollowRunVerdict` is the decision extracted as a pure function
 * precisely so the table below can be checked in milliseconds and read as a
 * table. The end-to-end proof (real `pnpm test`, real exit code, both with and
 * without a `.env`) was run by hand on 2026-09-02 and is recorded in the
 * commit message; this is what keeps the table from drifting afterwards.
 *
 * DELIBERATELY NOT DB-GATED. A test about what happens when there is no
 * database must run when there is no database.
 */
import { describe, expect, it } from "vitest";
import { hollowRunVerdict, runIsFiltered, type RunShape } from "./provisioningReport";

/** A whole run, on a machine with a database, that provisioned nothing yet. */
const base: RunShape = {
  hasUrl: true,
  provisions: 0,
  filtered: false,
  required: false,
  optedOut: false,
};

const shape = (over: Partial<RunShape>): RunShape => ({ ...base, ...over });

describe("hollowRunVerdict", () => {
  it("passes a run that actually provisioned schemas", () => {
    expect(hollowRunVerdict(shape({ provisions: 44 })).fail).toBe(false);
    // Even when the run was required to touch the database, which is CI.
    expect(hollowRunVerdict(shape({ provisions: 1, required: true })).fail).toBe(false);
  });

  it("FAILS the default local run with no TEST_DATABASE_URL", () => {
    // The defect this whole guard exists for: measured 2026-09-02, this shape
    // skipped 1,190 tests across 91 files and exited 0.
    const v = hollowRunVerdict(shape({ hasUrl: false }));
    expect(v.fail).toBe(true);
    expect(v.fail && v.reason).toBe("no-url");
  });

  it("lets an explicit opt-out through, because the smaller suite is a documented path", () => {
    // CONTRIBUTING.md: "a database is optional to start". It now costs a word.
    expect(hollowRunVerdict(shape({ hasUrl: false, optedOut: true })).fail).toBe(false);
  });

  it("does not let the opt-out override a run that DEMANDED a database", () => {
    // A blanket ALLOW_NO_TEST_DB in a shell profile or a stray workflow env
    // must not be able to silence CI or `pnpm test:full`.
    const v = hollowRunVerdict(shape({ hasUrl: false, optedOut: true, required: true }));
    expect(v.fail).toBe(true);
    expect(v.fail && v.reason).toBe("no-url");
  });

  it("leaves a filtered run alone, with no opt-out needed", () => {
    // Running one non-database file on its own provisions nothing and claims
    // nothing about the suite. Failing that would be the false red this guard
    // exists to avoid creating.
    expect(hollowRunVerdict(shape({ hasUrl: false, filtered: true })).fail).toBe(false);
    expect(hollowRunVerdict(shape({ filtered: true })).fail).toBe(false);
    expect(hollowRunVerdict(shape({ filtered: true, required: true })).fail).toBe(false);
  });

  it("still fails a required whole run whose database was set but unreachable", () => {
    // The variable is present, so the message must not send anyone hunting for
    // a missing env var. This is the pre-existing CI guard, kept.
    const v = hollowRunVerdict(shape({ required: true }));
    expect(v.fail).toBe(true);
    expect(v.fail && v.reason).toBe("no-provisions");
  });

  it("does not fail an unrequired whole run whose variable is set", () => {
    // TEST_DATABASE_URL present and nothing matched: ordinary, and unchanged.
    expect(hollowRunVerdict(base).fail).toBe(false);
  });

  it("keeps CI green: a database, schemas provisioned, nothing to say", () => {
    // The one shape that must never change behaviour. ci.yml sets both CI and
    // TEST_DATABASE_URL, and the mysql service container answers.
    expect(hollowRunVerdict({ ...base, required: true, provisions: 44 }).fail).toBe(false);
  });
});

describe("runIsFiltered", () => {
  // The argv pnpm hands vitest for each CI shard. If this ever read as a
  // filtered run, every `test (i/N)` job would stop failing when it had no
  // database, which is the hollow green the teardown exists to refuse.
  it("reads a CI shard, reporters and all, as a whole run", () => {
    expect(
      runIsFiltered([
        "run",
        "--shard=2/4",
        "--reporter=default",
        "--reporter=github-actions",
        "--reporter=json",
        "--outputFile.json=test-results/shard-2-of-4-attempt-1.json",
      ]),
    ).toBe(false);
  });

  it("reads the plain and unit runs as whole runs", () => {
    expect(runIsFiltered(["run"])).toBe(false);
    expect(runIsFiltered(["run", "--exclude", "**/*.e2e.test.ts"])).toBe(false);
  });

  it("reads a named file as a filtered run", () => {
    expect(runIsFiltered(["run", "server/ledger.test.ts"])).toBe(true);
    expect(runIsFiltered(["run", "--silent", "server/ledger.test.ts"])).toBe(true);
  });
});
