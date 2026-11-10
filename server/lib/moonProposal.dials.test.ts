/**
 * THE MOON'S BALLOT FREEZES THE VILLAGE'S RAISED ROUTINE TIER (AC2.5).
 *
 * `cycle_settlement` is a routine subject (shared/ballotSubjects.ts), and the
 * Decision Matrix prices its vote at the village's routine tier settings. The
 * proposer used to freeze the village's own dials with no subject floor, so a
 * village that raised `governance.tier_routine_quorum_pct` was told one number
 * on the matrix and voted its moons on another.
 *
 * No database: every module `runMoonProposal` reaches one through is replaced
 * here, and `openBallot` only records what it was asked to freeze. Its own
 * file, because the mocks are file-wide and the closer test beside it needs the
 * real settlement path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const opened: Array<Record<string, unknown>> = [];

vi.mock("./ballots", () => ({
  openBallot: vi.fn(async (_pool: unknown, spec: Record<string, unknown>) => {
    opened.push(spec);
    return { ok: true, ballot: { id: "bal-moon", ...spec } };
  }),
}));
vi.mock("../repos/settlementBallots", () => ({ settlementAsks: vi.fn(async () => []) }));
vi.mock("./events", () => ({ recordEvent: vi.fn(async () => undefined) }));
vi.mock("./cyclePool", () => ({ cyclePoolProblem: () => null }));
vi.mock("./gratitude-cycles", () => ({
  unreadableCycleProblem: () => null,
  dueCycles: () => [{ id: "lunar-000329", cycleNumber: 329, startsAt: "2026-10-01", endsAt: "2026-10-29" }],
}));
vi.mock("./cycleSettlement", () => ({
  poolSettingNow: () => ({ size: 100, token: "seeds" }),
  freezeCycleSplit: vi.fn(async () => []),
  settleDueCycles: vi.fn(),
}));
vi.mock("./variables", () => ({
  numberVar: () => 0,
  stringVar: (key: string) => ({ "cycle.settlement_mode": "proposal", "cycle.settlement_vote_days": "3" })[key] ?? "",
}));

import { runMoonProposal, type MoonProposalDeps } from "./moonProposal";
import { thresholdSettingsFrom } from "../../shared/ballotSubjects";

/** A village on custom dials of unity 60 and quorum 20 that raised its routine tier to 70 and 45. */
function deps(): MoonProposalDeps {
  return {
    getPool: () => ({}) as never,
    cyclesRepo: { all: async () => [] },
    gratitudeRepo: { all: async () => [], reversedIds: async () => new Set<string>() },
    eligibleSenderIds: async () => new Set<string>(),
    currencyNameLower: () => "gratitude",
    ballotSetup: async () => ({
      method: "custom",
      dials: { unityPct: 60, quorumPct: 20 },
      snapshot: { mode: "one_person_one_vote" },
      electorate: [{ userId: "ana", weight: 1 }],
      tokenProblem: null,
    }),
    memberNames: async () => new Map<string, string>(),
    tellRoll: async () => undefined,
    governanceOn: () => true,
    thresholdSettings: () =>
      thresholdSettingsFrom(
        (k) => ({ "governance.tier_routine_unity_pct": 70, "governance.tier_routine_quorum_pct": 45 })[k] ?? 0,
      ),
  } as unknown as MoonProposalDeps;
}

describe("the moon proposer's ballot dials", () => {
  beforeEach(() => {
    opened.length = 0;
  });

  it("freezes the village's raised routine tier, not its own lower dials", async () => {
    const run = await runMoonProposal(deps());
    expect(run.posted, run.why).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ subjectType: "cycle_settlement", unityPct: 70, quorumPct: 45 });
  });

  it("keeps the village's own dials where they already sit above the tier (control)", async () => {
    const d = deps();
    d.thresholdSettings = () => thresholdSettingsFrom(() => 0);
    const run = await runMoonProposal(d);
    expect(run.posted, run.why).toBe(true);
    expect(opened[0]).toMatchObject({ unityPct: 60, quorumPct: 20 });
  });
});
