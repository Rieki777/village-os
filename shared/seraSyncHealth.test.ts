import { describe, expect, it } from "vitest";
import { parseSyncLast, syncHealth, syncHealthWords } from "./seraSyncHealth";

const now = Date.parse("2026-11-03T18:00:00Z");
const rec = (hoursAgo: number, ok = true, e = 0) => parseSyncLast(JSON.stringify({ at: new Date(now - hoursAgo * 3_600_000).toISOString(), ok, s: ok ? "ok" : "no session", m: 2, e }));

describe("sync health", () => {
  it("is healthy within 8 hours, behind past 8, and failed when the last run failed", () => {
    expect(syncHealth(rec(5), now).state).toBe("ok");
    expect(syncHealth(rec(8), now).state).toBe("stale");
    expect(syncHealth(rec(1, false, 1), now)).toEqual({ state: "failed", hours: 1, errors: 1, status: "no session" });
    expect(syncHealth(null, now).state).toBe("never");
    expect(syncHealth(parseSyncLast("not json"), now).state).toBe("never");
  });
  it("says it in plain words", () => {
    expect(syncHealthWords(syncHealth(rec(9), now))).toMatch(/^Behind\. The last read was 9 hours ago/);
    expect(syncHealthWords(syncHealth(rec(2, false, 1), now))).toMatch(/did not work for 1 member \(no session\)/);
  });
});
