import { describe, expect, it } from "vitest";
import { claimOpen } from "./authRecovery";

describe("whether a village can still be claimed", () => {
  it("is open while nobody holds the founder or admin role", () => {
    expect(claimOpen([])).toBe(true);
    expect(claimOpen([{ role: "member" }, { role: undefined }, {}])).toBe(true);
  });

  it("closes the moment a founder or an admin exists, the bootstrap route's own test", () => {
    expect(claimOpen([{ role: "member" }, { role: "founder" }])).toBe(false);
    expect(claimOpen([{ role: "admin" }])).toBe(false);
  });
});
