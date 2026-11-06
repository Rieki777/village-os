import { describe, expect, it } from "vitest";
import { ago, healthLine } from "./moduleHealthLine";

const now = new Date("2026-10-13T12:00:00Z");

describe("healthLine", () => {
  it("says nothing for a module with no outside service", () => {
    expect(healthLine({ vendorName: null, credentialPresent: null, health: [], now })).toBeNull();
  });

  it("names a missing key first", () => {
    expect(healthLine({ vendorName: "Saberra", credentialPresent: false, health: [], now })).toEqual({
      tone: "bad",
      text: "No key for Saberra yet, so this module cannot reach it.",
    });
  });

  it("lets one failing call outweigh a working one", () => {
    const line = healthLine({
      vendorName: "Saberra",
      credentialPresent: true,
      health: [
        { operation: "a", lastSuccessAt: "2026-10-13T11:58:00Z", reading: { verdict: "working", detail: "" } },
        { operation: "b", consecutiveFailures: 3, reading: { verdict: "failing", detail: "" } },
      ],
      now,
    });
    expect(line?.tone).toBe("bad");
    expect(line?.text).toContain("3 times in a row");
  });

  it("says when it last answered, in words", () => {
    const line = healthLine({
      vendorName: "Saberra",
      credentialPresent: true,
      health: [{ operation: "a", lastSuccessAt: "2026-10-13T11:58:00Z", reading: { verdict: "working", detail: "" } }],
      now,
    });
    expect(line).toEqual({ tone: "good", text: "Saberra answered 2 minutes ago." });
  });

  it("never claims a set key works", () => {
    expect(healthLine({ vendorName: "Saberra", credentialPresent: true, health: [], now })?.text).toContain("does not prove");
  });

  it("counts time in words", () => {
    expect(ago("2026-10-13T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-10-13T09:00:00Z", now)).toBe("3 hours ago");
    expect(ago("2026-10-10T12:00:00Z", now)).toBe("3 days ago");
  });
});
