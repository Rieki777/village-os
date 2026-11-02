/**
 * FOUNDER-HELD DIALS: ANYONE PROPOSES, WHOEVER HOLDS THE POWER ADOPTS.
 *
 * Rye, 2026-09-25: any member may propose a change to any dial from day one.
 * The coordinator relayed the adoption rule on 2026-10-31: founders before
 * handover, governance after, and `governance.weight_mode` keeps its own door.
 * These are the pure halves: which keys are founder-held, which proposals a
 * founder may adopt by hand, and the sentence a vote door answers with before
 * the start.
 */
import { describe, expect, it } from "vitest";
import { FOUNDERS_ADOPT, founderAdoptable, founderHeldKeys, founderHeldVoteProblem } from "./founderDials";

const held = { key: "abuse.register_per_ip_hourly", to: "50" };
const open = { key: "gratitude.base_budget", to: "150" };

describe("founder-held dials", () => {
  it("names the founder-held keys in a change set, and only those", () => {
    expect(founderHeldKeys([held, open])).toEqual(["abuse.register_per_ip_hourly"]);
    expect(founderHeldKeys([open])).toEqual([]);
  });

  it("lets a founder adopt an open proposal made only of founder-held dials", () => {
    expect(founderAdoptable({ status: "open", changeSet: [held] })).toBe(true);
    expect(founderAdoptable({ status: "draft", changeSet: [held] })).toBe(true);
    expect(founderAdoptable({ status: "open", changeSet: [held, open] })).toBe(false);
    expect(founderAdoptable({ status: "open", changeSet: [open] })).toBe(false);
    expect(founderAdoptable({ status: "applied", changeSet: [held] })).toBe(false);
    expect(founderAdoptable({ status: "open", changeSet: [] })).toBe(false);
  });

  it("before the start, turns a founder-held set away from the vote with the reason; after it, lets it through", async () => {
    expect(await founderHeldVoteProblem([held], async () => true)).toBe(FOUNDERS_ADOPT);
    expect(await founderHeldVoteProblem([held], async () => false)).toBeNull();
    expect(await founderHeldVoteProblem([open], async () => true)).toBeNull();
  });
});
