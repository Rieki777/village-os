/**
 * Where a village's Moon 1 lands, and the three ways it can fail to land
 * anywhere.
 *
 * These run against the resolver and the lunar clock, with no database: the
 * anchor is resolved from two raw strings, so the precedence between them and
 * the refusal are both provable without provisioning a schema. The read of
 * those two strings is one variable lookup and one primary-key select, and
 * neither is where a wrong moon number would come from.
 */
import { describe, expect, it } from "vitest";
import { cycleBoundsFor, cycleBoundsByNumber } from "../shared/lunar";
import { villageMoonLabel } from "../shared/villageMoon";
import {
  anchorCycleFrom,
  villageMoonFor,
  villageMoonForCycle,
  villageMoonForCycleId,
} from "./lib/villageMoon";

/** A real instant with a real lunation under it. */
const LAUNCH = "2026-03-25T09:00:00.000Z";
const LAUNCH_CYCLE = cycleBoundsFor(new Date(LAUNCH)).cycleNumber;

describe("the anchor, in precedence order", () => {
  it("counts from the moon the village launched under when nothing is overridden", () => {
    const { moonOneCycle, problem } = anchorCycleFrom("", LAUNCH);
    expect(problem).toBeNull();
    expect(moonOneCycle).toBe(LAUNCH_CYCLE);
  });

  it("takes the new moon AT OR BEFORE the launch, so the launch moon is Moon 1", () => {
    const { moonOneCycle } = anchorCycleFrom("", LAUNCH);
    const bounds = cycleBoundsByNumber(moonOneCycle!);
    expect(bounds.startsAt.getTime()).toBeLessThanOrEqual(new Date(LAUNCH).getTime());
    expect(bounds.endsAt.getTime()).toBeGreaterThan(new Date(LAUNCH).getTime());
    expect(villageMoonFor(new Date(LAUNCH), moonOneCycle!).ordinal).toBe(1);
  });

  it("lets a founder's date beat the launch instant", () => {
    const { moonOneCycle } = anchorCycleFrom("2026-06-01", LAUNCH);
    expect(moonOneCycle).toBe(cycleBoundsFor(new Date("2026-06-01T00:00:00Z")).cycleNumber);
    expect(moonOneCycle).not.toBe(LAUNCH_CYCLE);
  });

  it("has no anchor at all for a village that has not launched and set nothing", () => {
    expect(anchorCycleFrom("", null)).toEqual({ moonOneCycle: null, problem: null });
    expect(anchorCycleFrom(null, null).moonOneCycle).toBeNull();
  });

  it("still anchors an unlaunched village that set a date, because that is what setting it means", () => {
    expect(anchorCycleFrom("2026-06-01", null).moonOneCycle).not.toBeNull();
  });

  /*
   * THE REFUSAL. Falling through to the launch instant here would print a
   * moon number on every screen in the village that is wrong by an unknown
   * number of moons, with nothing anywhere saying so. Absent beats wrong.
   */
  it("stops counting rather than guessing when the override cannot be read", () => {
    const { moonOneCycle, problem } = anchorCycleFrom("next spring", LAUNCH);
    expect(moonOneCycle).toBeNull();
    expect(problem).toContain("next spring");
    expect(problem).toContain("2026-03-19");
  });
});

describe("a village counting from its launch", () => {
  const anchor = anchorCycleFrom("", LAUNCH).moonOneCycle;

  it("calls the launch moon Moon 1 and the next one Moon 2", () => {
    expect(villageMoonForCycle(LAUNCH_CYCLE, anchor).ordinal).toBe(1);
    expect(villageMoonForCycle(LAUNCH_CYCLE + 1, anchor).ordinal).toBe(2);
    expect(villageMoonForCycle(LAUNCH_CYCLE + 11, anchor).ordinal).toBe(12);
  });

  it("gives the window the settlement clock gives, so a label and a total agree", () => {
    const moon = villageMoonForCycle(LAUNCH_CYCLE, anchor);
    const bounds = cycleBoundsByNumber(LAUNCH_CYCLE);
    expect(moon.startsAt).toBe(bounds.startsAt.toISOString());
    expect(moon.endsAt).toBe(bounds.endsAt.toISOString());
  });

  it("carries the full moon inside the window as a landmark, and settles on neither end of it", () => {
    const moon = villageMoonForCycle(LAUNCH_CYCLE, anchor);
    expect(moon.fullMoonAt).toBeTruthy();
    const full = new Date(moon.fullMoonAt!).getTime();
    expect(full).toBeGreaterThan(new Date(moon.startsAt).getTime());
    expect(full).toBeLessThan(new Date(moon.endsAt).getTime());
  });

  /*
   * A row from before the anchor. An early seed, a test fixture, or a founder
   * who moved Moon 1 forward over moons already displayed.
   */
  it("numbers nothing before Moon 1, and shows no minus sign for it", () => {
    const earlier = villageMoonForCycle(LAUNCH_CYCLE - 1, anchor);
    expect(earlier.ordinal).toBeNull();
    expect(earlier.standing).toBe("before");
    expect(villageMoonLabel(earlier)).toMatch(/^Before Moon 1, /);

    const muchEarlier = villageMoonForCycle(LAUNCH_CYCLE - 40, anchor);
    expect(muchEarlier.ordinal).toBeNull();
    expect(villageMoonLabel(muchEarlier)).not.toMatch(/-\d/);
  });
});

describe("a first moon set in the future", () => {
  const future = anchorCycleFrom("2030-01-01", LAUNCH).moonOneCycle;

  it("is accepted, because a founder may start the count whenever they like", () => {
    expect(future).not.toBeNull();
  });

  it("leaves every moon until then unnumbered instead of counting down to it", () => {
    const now = villageMoonFor(new Date("2026-08-01T00:00:00Z"), future);
    expect(now.ordinal).toBeNull();
    expect(now.standing).toBe("before");
    expect(villageMoonLabel(now)).toMatch(/^Before Moon 1, /);
  });

  it("starts at 1 on the day it arrives", () => {
    expect(villageMoonFor(new Date("2030-01-01T12:00:00Z"), future).ordinal).toBe(1);
  });
});

describe("a village that is not counting", () => {
  it("labels its moons with dates alone and never with a number", () => {
    const moon = villageMoonFor(new Date("2026-08-01T00:00:00Z"), null);
    expect(moon.ordinal).toBeNull();
    expect(moon.standing).toBe("unanchored");
    const label = villageMoonLabel(moon);
    expect(label).not.toContain("Moon");
    expect(label).toMatch(/\d{4}$/);
  });

  it("still carries the absolute lunation, so support can still find the row", () => {
    const moon = villageMoonFor(new Date("2026-08-01T00:00:00Z"), null);
    expect(moon.cycleNumber).toBe(cycleBoundsFor(new Date("2026-08-01T00:00:00Z")).cycleNumber);
  });
});

describe("labelling a stored cycle id", () => {
  const anchor = anchorCycleFrom("", LAUNCH).moonOneCycle;

  it("reads the one spelling this build writes", () => {
    const moon = villageMoonForCycleId(`lunar-${String(LAUNCH_CYCLE).padStart(6, "0")}`, anchor);
    expect(moon?.ordinal).toBe(1);
  });

  /*
   * The legacy calendar-month ids migration 0105 refused to remap, and the
   * `moon-329` spelling that once shared the column with `lunar-000329`. A
   * label for either would be a guess about which lunation the row belongs
   * to, and guessing is what cost a village 30 units.
   */
  it("gives no label to an id it cannot place, rather than somebody else's label", () => {
    expect(villageMoonForCycleId("2026-07", anchor)).toBeNull();
    expect(villageMoonForCycleId("moon-329", anchor)).toBeNull();
    expect(villageMoonForCycleId("", anchor)).toBeNull();
  });
});

describe("the count is a label and never a key", () => {
  /*
   * The whole design rests on this: the ordinal is computed on read, so a
   * founder moving the anchor renames what people see and moves nothing that
   * was recorded. The proof is that the same lunation keeps its cycle number
   * and its window under two different anchors, and only the ordinal moves.
   */
  it("moving the anchor changes the number a member reads and nothing else", () => {
    const before = villageMoonForCycle(LAUNCH_CYCLE + 5, LAUNCH_CYCLE);
    const after = villageMoonForCycle(LAUNCH_CYCLE + 5, LAUNCH_CYCLE + 2);
    expect(before.ordinal).toBe(6);
    expect(after.ordinal).toBe(4);
    expect(after.cycleNumber).toBe(before.cycleNumber);
    expect(after.startsAt).toBe(before.startsAt);
    expect(after.endsAt).toBe(before.endsAt);
  });
});
