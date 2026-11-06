import { describe, expect, it } from "vitest";
import { splitDue, type CoolingEntry } from "./handoverCooling";

const entry = (capability: string, landsAt: string): CoolingEntry => ({ capability: capability as any, signedBy: "a+b", startedAt: "2026-11-01T00:00:00Z", landsAt });

describe("splitDue: a mature-only power lands when its week is up, not before", () => {
  const now = new Date("2026-11-08T00:00:00Z");

  it("a week that ended is due; one still running waits", () => {
    const out = splitDue([entry("steward.veto", "2026-11-07T23:59:59Z"), entry("cash.pay", "2026-11-08T00:00:01Z")], now);
    expect(out.due.map((e) => e.capability)).toEqual(["steward.veto"]);
    expect(out.waiting.map((e) => e.capability)).toEqual(["cash.pay"]);
  });

  it("the exact moment counts as up", () => {
    expect(splitDue([entry("dial.set", "2026-11-08T00:00:00Z")], now).due).toHaveLength(1);
  });

  it("control: nothing is due a moment before", () => {
    expect(splitDue([entry("dial.set", "2026-11-08T00:00:00Z")], new Date("2026-11-07T23:59:59Z")).due).toEqual([]);
  });
});
