/**
 * The schedule's arithmetic, without a database: the fingerprint that decides
 * whether a scheduled read is a change, the gap and how failures stretch it,
 * and the log read back believing nothing.
 */
import { describe, expect, it } from "vitest";
import type { SyncRun } from "../../shared/saberraSyncLog";
import {
  KEEP_RUNS,
  RUN_SENTENCE,
  alreadySaid,
  appendRun,
  backoffFactor,
  blankRun,
  failureStreak,
  fingerprintRead,
  keptShapes,
  pollDueAt,
  readLog,
  readRun,
} from "./saberraPolling";
import type { VendorRecord } from "./saberraProposals";

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-10-15T12:00:00.000Z");

const READ: VendorRecord[] = [
  { id: "c-1", kind: "circle", fields: { "Circle Name": "Land", Status: "Active" } },
  { id: "r-1", kind: "role", fields: { "Role Name": "Water Steward", Circle: ["c-1"], Body: "Holds the water." } },
  { id: "r-2", kind: "role", fields: { "Role Name": "Purse Keeper", Status: "Vacant" }, url: "https://service.example.test/r-2" },
];

const run = (ms: number, outcome: SyncRun["outcome"], trigger: SyncRun["trigger"] = "scheduled"): SyncRun =>
  blankRun(new Date(T0 + ms), trigger, outcome, outcome === "failed" ? "no-session" : outcome === "not-run" ? "no-key" : null);

describe("the fingerprint", () => {
  it("IS THE SAME READ HOWEVER THE SERVICE ORDERED IT, records or keys", () => {
    const shuffled: VendorRecord[] = [
      { ...READ[2]!, fields: { Status: "Vacant", "Role Name": "Purse Keeper" } },
      READ[0]!,
      { ...READ[1]!, fields: { Body: "Holds the water.", Circle: ["c-1"], "Role Name": "Water Steward" } },
    ];
    expect(fingerprintRead(shuffled)).toBe(fingerprintRead(READ));
    expect(fingerprintRead(READ)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("CHANGES WHEN A FIELD THIS VILLAGE TAKES CHANGES, and when a record comes or goes", () => {
    const base = fingerprintRead(READ);
    const aim = READ.map((r) => (r.id === "r-1" ? { ...r, fields: { ...r.fields, Body: "Holds the wells." } } : r));
    expect(fingerprintRead(aim)).not.toBe(base);
    expect(fingerprintRead(READ.slice(1))).not.toBe(base);
    const link = READ.map((r) => (r.id === "r-2" ? { ...r, url: "https://service.example.test/r-2b" } : r));
    expect(fingerprintRead(link)).not.toBe(base);
    // A relation reordered names a different first circle, which is the one a
    // seat is placed in, so it is a change.
    const circles = (ids: string[]) => READ.map((r) => (r.id === "r-1" ? { ...r, fields: { ...r.fields, Circle: ids } } : r));
    expect(fingerprintRead(circles(["c-2", "c-1"]))).not.toBe(fingerprintRead(circles(["c-1", "c-2"])));
  });

  it("DOES NOT CHANGE WHEN ONLY A FIELD THE BOUNDARY DROPS CHANGES", () => {
    const base = fingerprintRead(READ);
    const holders = READ.map((r) => (r.id === "r-1" ? { ...r, fields: { ...r.fields, "Active Holders": ["p-9"] } } : r));
    expect(fingerprintRead(holders)).toBe(base);
    const unknown = READ.map((r) => (r.id === "c-1" ? { ...r, fields: { ...r.fields, "A New Field": "x" } } : r));
    expect(fingerprintRead(unknown)).toBe(base);
  });

  it("treats an empty read as a read, with its own fingerprint", () => {
    expect(fingerprintRead([])).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintRead([])).not.toBe(fingerprintRead(READ));
  });
});

describe("the gap", () => {
  it("is never for off, at once for a schedule that has never called, and the schedule's own after a success", () => {
    expect(pollDueAt("off", [run(0, "landed")])).toBeNull();
    expect(pollDueAt("daily", [])).toBe(0);
    expect(pollDueAt("daily", [run(0, "not-run")])).toBe(0);
    expect(pollDueAt("every-6-hours", [run(0, "no-change")])).toBe(T0 + 6 * HOUR);
    expect(pollDueAt("daily", [run(0, "landed", "by-hand")])).toBe(T0 + 24 * HOUR);
  });

  it("COUNTS FROM THE LAST RUN THAT CALLED THE SERVICE, passing over runs that never did", () => {
    expect(pollDueAt("every-6-hours", [run(9 * HOUR, "not-run"), run(1 * HOUR, "landed")])).toBe(T0 + 7 * HOUR);
  });

  it("STRETCHES FROM THE SECOND FAILURE IN A ROW, up to four times, and never below the schedule", () => {
    expect([0, 1, 2, 3, 4, 10].map(backoffFactor)).toEqual([1, 1, 2, 4, 4, 4]);
    const log = [run(3, "failed"), run(2, "not-run"), run(1, "failed"), run(0, "landed"), run(-1, "failed")];
    expect(failureStreak(log)).toBe(2);
    expect(pollDueAt("every-6-hours", log)).toBe(T0 + 3 + 12 * HOUR);
    for (let n = 0; n < 12; n += 1) expect(backoffFactor(n)).toBeGreaterThanOrEqual(1);
  });

  it("is reset by any whole read, pressed or scheduled", () => {
    expect(failureStreak([run(2, "landed", "by-hand"), run(1, "failed"), run(0, "failed")])).toBe(0);
    expect(failureStreak([run(2, "no-change"), run(1, "failed"), run(0, "failed")])).toBe(0);
  });
});

describe("the log", () => {
  it("KEEPS THE LAST TWENTY, newest first", () => {
    let runs: SyncRun[] = [];
    for (let i = 0; i < 25; i += 1) runs = appendRun(runs, run(i * HOUR, "no-change"));
    expect(KEEP_RUNS).toBe(20);
    expect(runs).toHaveLength(20);
    expect(runs[0]!.at).toBe(new Date(T0 + 24 * HOUR).toISOString());
    expect(runs[19]!.at).toBe(new Date(T0 + 5 * HOUR).toISOString());
  });

  it("says a missing key once: only when the newest entry does not already say it", () => {
    expect(alreadySaid([run(1, "not-run"), run(0, "landed")], "no-key")).toBe(true);
    expect(alreadySaid([run(1, "landed"), run(0, "not-run")], "no-key")).toBe(false);
    expect(alreadySaid([run(1, "not-run")], "no-address")).toBe(false);
    expect(alreadySaid([], "no-key")).toBe(false);
  });

  it("READS A STORED RUN BACK FROM ITS TYPES, and rebuilds its sentence from its reason", () => {
    const stored = {
      ...run(0, "failed"),
      error: "the service said: jane@example.org may not read this",
      skipped: ["tension", "Assignment Title"],
      failed: [{ kind: "roleAssignment", why: "vendor-error", detail: "scope" }, { kind: "people", why: "refused" }],
      circles: { placed: 2, unresolved: -1, absent: "x", several: 0, inArchived: 0, shapes: ["list of 1 id", "text jane@example.org"] },
      extra: "anything",
    };
    const back = readRun(JSON.parse(JSON.stringify(stored)))!;
    expect(back.error).toBe(RUN_SENTENCE["no-session"]);
    expect(back.skipped).toEqual(["tension"]);
    expect(back.failed).toEqual([{ kind: "roleAssignment", why: "vendor-error" }]);
    expect(back.circles).toEqual({ placed: 2, unresolved: 0, absent: 0, several: 0, inArchived: 0, shapes: ["list of 1 id"] });
    expect(JSON.stringify(back)).not.toContain("jane");
    expect(back).not.toHaveProperty("extra");
  });

  it("drops what is not a run, and a fingerprint that is not one", () => {
    const log = readLog({
      runs: [run(1, "landed"), { at: "yesterday", trigger: "scheduled", outcome: "landed" }, { at: new Date(T0).toISOString(), trigger: "cron", outcome: "landed" }, null, "x"],
      landedFingerprint: "not-a-hash",
    });
    expect(log.runs).toHaveLength(1);
    expect(log.landedFingerprint).toBeNull();
    expect(readLog(null)).toEqual({ runs: [], landedFingerprint: null });
    expect(readLog({ runs: [], landedFingerprint: "a".repeat(64) }).landedFingerprint).toBe("a".repeat(64));
  });

  it("keeps the shapes line short, and drops a shape that reads as an address", () => {
    expect(keptShapes(["list of 2 ids", "x".repeat(200), "object (jane@example.org)", 7, ""])).toEqual(["list of 2 ids", "x".repeat(80)]);
    expect(keptShapes(Array.from({ length: 12 }, (_, i) => `shape ${i}`))).toHaveLength(8);
  });

  it("gives every reason a sentence, and none of them a dash", () => {
    for (const sentence of Object.values(RUN_SENTENCE)) {
      expect(sentence).toMatch(/\.$/);
      expect(sentence).not.toMatch(/[–—]/);
    }
  });
});
