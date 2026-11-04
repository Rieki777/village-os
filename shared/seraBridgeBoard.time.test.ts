import { describe, expect, it } from "vitest";
import { villageTime } from "./seraBridgeBoard";

describe("one clock for the Sera board", () => {
  const iso = "2026-11-04T02:06:00Z";
  it("reads in village time and names the zone for a viewer elsewhere", () => {
    expect(villageTime(iso, "x", "America/Los_Angeles")).toBe("Nov 3, 8:06 PM Costa Rica time");
  });
  it("says nothing extra to a viewer in the village's zone", () => {
    expect(villageTime(iso, "x", "America/Costa_Rica")).toBe("Nov 3, 8:06 PM");
  });
  it("falls back on a missing time", () => {
    expect(villageTime(null, "never")).toBe("never");
  });
});
