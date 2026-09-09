/**
 * THE FREEZE LEAVES UNDONE GIFTS OUT, or the vote pays on a gift that did not happen.
 *
 * Main fixed this in the close (31f6e59): `settleCycle` now takes the ids of
 * reversed gifts, because a reversed gift used to keep drawing a share of the
 * cycle pool after the ledger had already clawed the recognition back. That
 * fix lived in the route body. This branch moved the route body into
 * `freezeCycleSplit`, which is also where a settlement BALLOT freezes the split
 * its document shows. So the fix has to live here too, or the button leaves
 * the gift out and the vote pays on it.
 *
 * The control case is the proof. The same moon, frozen without the reversed
 * set, pays Ivo 70 instead of 40. If `reversed` ever stops reaching
 * `settleCycle`, the first case goes red while the control stays green, which
 * is the difference between a test of the fix and a test of the arithmetic.
 *
 * No database: `freezeCycleSplit` reads only the distributions repo it is
 * handed, and the one below is an add-if-absent array, like the real one.
 */
import { describe, expect, it } from "vitest";

import { freezeCycleSplit, shareOf, type SettlementDeps } from "./cycleSettlement";
import type { CycleRecord, DistributionRecord } from "./gratitude-cycles";

const MOON = "lunar-000329";

const cycle = {
  id: MOON,
  cycleNumber: 329,
  startsAt: "2026-08-13T00:00:00.000Z",
  endsAt: "2026-09-11T03:27:00.000Z",
  status: "open",
  clock: "lunar",
} as unknown as CycleRecord;

/** Six and four to Maya and Ivo from Ana, and ten more to Ivo from Bo that was undone. */
const entries = [
  { id: "g1", kind: "ack", fromId: "ana", toId: "maya", amount: 6, cycleId: MOON },
  { id: "g2", kind: "ack", fromId: "ana", toId: "ivo", amount: 4, cycleId: MOON },
  { id: "g3", kind: "ack", fromId: "bo", toId: "ivo", amount: 10, cycleId: MOON },
];

const eligible = new Set(["ana", "bo"]);
const pool = { size: 100, token: "credits" };

/** An in-memory distributions repo with the real one's add-if-absent rule. */
function depsWithFreshRepo(): SettlementDeps {
  const rows: DistributionRecord[] = [];
  return {
    distributionsRepo: {
      all: async () => rows.slice(),
      add: async (r: DistributionRecord) => {
        if (!rows.some((x) => x.id === r.id)) rows.push(r);
      },
    },
  } as unknown as SettlementDeps;
}

const byUser = (rows: DistributionRecord[]) =>
  Object.fromEntries(
    rows.map((d) => [d.userId, { credited: Number(d.credited), received: Number(d.received), senders: Number(d.distinctSenders) }]),
  );

describe("freezing a moon's split", () => {
  it("leaves a reversed gift out of every number the vote will pay on", async () => {
    const frozen = await freezeCycleSplit(depsWithFreshRepo(), cycle, entries, eligible, new Set(["g3"]), pool);
    expect(byUser(frozen)).toEqual({
      maya: { credited: 60, received: 6, senders: 1 },
      // Bo's undone gift is not in `received`, not in the share, and Bo is not
      // counted as somebody who thanked Ivo.
      ivo: { credited: 40, received: 4, senders: 1 },
    });
  });

  it("CONTROL: the same moon without the reversed set pays on the undone gift", async () => {
    const frozen = await freezeCycleSplit(depsWithFreshRepo(), cycle, entries, eligible, new Set(), pool);
    expect(byUser(frozen)).toEqual({
      maya: { credited: 30, received: 6, senders: 1 },
      ivo: { credited: 70, received: 14, senders: 2 },
    });
  });

  it("a second freeze returns the first freeze's numbers, which is what the vote was shown", async () => {
    const deps = depsWithFreshRepo();
    await freezeCycleSplit(deps, cycle, entries, eligible, new Set(["g3"]), pool);
    // The pool is doubled and the reversal forgotten between the two calls.
    // Neither may move a number that is already written down.
    const again = await freezeCycleSplit(deps, cycle, entries, eligible, new Set(), { size: 200, token: "credits" });
    expect(byUser(again)).toEqual({
      maya: { credited: 60, received: 6, senders: 1 },
      ivo: { credited: 40, received: 4, senders: 1 },
    });
  });

  it("the share formula floors in the pool's favour and pays nothing from an empty pool", () => {
    expect(shareOf(1, 3, 100)).toBe(33);
    expect(shareOf(5, 10, 0)).toBe(0);
    expect(shareOf(5, 0, 100)).toBe(0);
  });
});
