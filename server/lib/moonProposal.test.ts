/**
 * THE SETTLEMENT CLOSER THROWS WHEN NOTHING SETTLED, so the landing retries.
 *
 * `applyDue` marks a landing applied whenever a closer's `execute` returns, and
 * takes its failure path only when it throws: the row goes back to pending and
 * the next tick tries again (server/lib/landingRefusal.ts states the contract).
 * This closer used to RETURN a held sentence when `settleDueCycles` refused, so
 * a settlement the village carried could be recorded as landed while no moon
 * closed and nobody was paid, and nothing would ever try it again.
 *
 * No database. The fake deps make `settleDueCycles` refuse before it could touch
 * one: the pool check refuses when no token registry is loaded, and if a setup
 * ever loads one, the unreadable cycle id below refuses next. `getPool` throws a
 * different sentence, so reaching the database would fail this test for the
 * wrong reason instead of passing it.
 */
import { describe, expect, it, vi } from "vitest";

import { settlementCloser, type MoonProposalDeps } from "./moonProposal";
import type { BallotRow } from "./ballots";

const ballot = {
  id: "bal-1",
  subjectType: "cycle_settlement",
  subjectRef: "lunar-000329",
  title: "Settle the moon that ended: cycle 329",
} as unknown as BallotRow;

function depsThatCannotSettle() {
  const notifyAdmins = vi.fn(async () => undefined);
  const deps = {
    getPool: () => {
      throw new Error("this test must not reach the database");
    },
    cyclesRepo: { all: async () => [], upsert: async () => undefined },
    gratitudeRepo: {
      all: async () => [{ id: "g1", kind: "ack", fromId: "ana", toId: "ivo", amount: 5, cycleId: "not-a-cycle-id" }],
      reversedIds: async () => new Set<string>(),
    },
    distributionsRepo: { all: async () => [], add: async () => undefined },
    eligibleSenderIds: async () => new Set<string>(["ana"]),
    stageMultiplierFor: async () => 1,
    notify: async () => undefined,
    notifyAdmins,
    currencyNameLower: () => "gratitude",
    ballotSetup: async () => {
      throw new Error("not used by execute");
    },
    memberNames: async () => new Map<string, string>(),
    tellRoll: async () => undefined,
    governanceOn: () => true,
  } as unknown as MoonProposalDeps;
  return { deps, notifyAdmins };
}

describe("the cycle_settlement closer", () => {
  it("throws when the settlement could not run, so applyDue keeps the landing pending and retries", async () => {
    const { deps, notifyAdmins } = depsThatCannotSettle();
    await expect(settlementCloser(() => deps).execute(ballot)).rejects.toThrow(/could not land/);
    // The admins are told before the throw, so a retrying failure is visible.
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
  });
});
