import { describe, expect, it } from "vitest";
import { MEASURE_KEYS, buildMeasures, median, type ApplicationFact, type HolderFact } from "./roleMeasures";

const H = 3_600_000;
const D = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const app = (reply: number | null, interview: number | null, decided: number | null, circleId = "c1"): ApplicationFact => ({
  seasonId: "s1",
  circleId,
  confirmedAt: T0,
  firstReplyAt: reply === null ? null : T0 + reply * H,
  firstInterviewAt: interview === null ? null : T0 + interview * H,
  decidedAt: decided === null ? null : T0 + decided * H,
});
const holder = (o: Partial<HolderFact> = {}): HolderFact => ({
  seasonId: "s1",
  circleId: "c1",
  startedAt: T0,
  endedAt: null,
  pathOpenedAt: T0,
  pathDoneAt: T0 + 20 * D,
  firstQuestDoneAt: T0 + 10 * D,
  renewalsDue: 2,
  renewalsRenewed: 2,
  ...o,
});

describe("buildMeasures", () => {
  it("computes medians and shares per season and circle", () => {
    const apps = [app(2, 24, 100), app(4, 48, 200), app(6, null, 300), app(null, null, null)];
    const holders = [holder(), holder(), holder({ pathDoneAt: T0 + 40 * D, firstQuestDoneAt: null }), holder({ endedAt: T0 + 30 * D, renewalsRenewed: 1 })];
    const [row] = buildMeasures(apps, holders, T0 + 200 * D);
    expect(row.applications).toMatchObject({ count: 4, medianHoursToReply: 4, medianHoursToInterview: null, medianHoursToDecision: 200 });
    expect(row.applications.answered).toEqual({ eligible: 4, yes: 3, share: 0.75 });
    expect(row.holders.pathCompleteBy30).toEqual({ eligible: 4, yes: 3, share: 0.75 });
    expect(row.holders.firstQuestBy14).toEqual({ eligible: 4, yes: 3, share: 0.75 });
    expect(row.holders.stillInRoleAt90).toEqual({ eligible: 4, yes: 3, share: 0.75 });
    expect(row.holders.renewed).toEqual({ eligible: 8, yes: 7, share: 0.88 });
  });
  it("withholds numbers built from fewer than three people, and does not count a window still open", () => {
    const [row] = buildMeasures([app(1, 1, 1), app(2, 2, 2)], [holder(), holder({ pathOpenedAt: T0 + 100 * D })], T0 + 110 * D);
    expect(row.applications.medianHoursToReply).toBeNull();
    expect(row.applications.answered.share).toBeNull();
    expect(row.holders.pathCompleteBy30.eligible).toBe(1);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("splits by circle", () => {
    expect(buildMeasures([app(1, 1, 1, "c1"), app(1, 1, 1, "c2")], [], T0)).toHaveLength(2);
  });
  it("carries exactly the declared key set and no name, id of a person or ref", () => {
    const rows = buildMeasures([app(1, 1, 1), app(2, 2, 2), app(3, 3, 3)], [holder(), holder(), holder()], T0 + 200 * D);
    const r = rows[0];
    expect(Object.keys(r).sort()).toEqual([...MEASURE_KEYS.row].sort());
    expect(Object.keys(r.applications).sort()).toEqual([...MEASURE_KEYS.applications].sort());
    expect(Object.keys(r.holders).sort()).toEqual([...MEASURE_KEYS.holders].sort());
    expect(Object.keys(r.holders.pathCompleteBy30).sort()).toEqual([...MEASURE_KEYS.share].sort());
    expect(JSON.stringify(rows)).not.toMatch(/user|email|name|ref|assignment/i);
  });
});
