/**
 * What a village vote needs that only server/index.ts has.
 *
 * Its own file so a module that moves value (the mint request vote) can name
 * the shape without importing orgDraftDecide, whose draft machinery reaches the
 * seat settings model. shared/seatSettings.boundary.test.ts holds that line.
 */
import type { BallotMethod } from "../../shared/governanceEngine";
import type { WeightModeSnapshot } from "./governanceWeights";

export interface BallotSetup {
  method: BallotMethod;
  dials: { unityPct: number; quorumPct: number };
  snapshot: WeightModeSnapshot;
  tokenProblem: string | null;
  electorate: Array<{ userId: string; weight: number }>;
  durationDays: number;
}
