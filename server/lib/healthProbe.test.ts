import { describe, expect, it } from "vitest";
import { publicDatabaseError } from "./healthProbe";

/**
 * /health is unauthenticated (R116). The probe's error names the class of
 * failure for whoever is reading it, and nothing a driver message carries
 * about the account or the host.
 */
describe("the database error /health shows a stranger", () => {
  it("is the driver's code, never its message", () => {
    const e = Object.assign(new Error("Access denied for user 'village_app'@'10.0.0.5' (using password: YES)"), {
      code: "ER_ACCESS_DENIED_ERROR",
    });
    const shown = publicDatabaseError(e);
    expect(shown).toBe("ER_ACCESS_DENIED_ERROR");
    expect(shown).not.toContain("village_app");
    expect(shown).not.toContain("10.0.0.5");
  });

  it("keeps the codes the runbook tells an operator to look for", () => {
    expect(publicDatabaseError(Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:3306"), { code: "ECONNREFUSED" }))).toBe("ECONNREFUSED");
  });

  it("says something plain when there is no code to give", () => {
    const shown = publicDatabaseError(new Error("Unknown database 'village_secret_name'"));
    expect(shown).not.toContain("village_secret_name");
    expect(shown.length).toBeGreaterThan(0);
    expect(publicDatabaseError(undefined).length).toBeGreaterThan(0);
  });

  it("never passes through a code that is not code-shaped", () => {
    expect(publicDatabaseError({ code: "user village_app at 10.0.0.5" })).not.toContain("10.0.0.5");
  });
});
