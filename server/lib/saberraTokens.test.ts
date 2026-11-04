import { afterEach, describe, expect, it } from "vitest";
import { tokenUses, syncTokenSet, SYNC_ENV } from "./saberraTokens";

describe("which token each act uses", () => {
  afterEach(() => { delete process.env[SYNC_ENV]; });
  it("routine acts use the sync token when set, else the connection's", () => {
    const withSync = tokenUses(true, true, false);
    expect(withSync.filter((t) => t.uses === "sync").length).toBe(5);
    expect(withSync.filter((t) => t.uses === "privacy").every((t) => !t.set)).toBe(true);
    const without = tokenUses(false, true, true);
    expect(without.some((t) => t.uses === "sync")).toBe(false);
    expect(without.filter((t) => t.uses === "connection").every((t) => t.set)).toBe(true);
  });
  it("hard delete, export and the match are privacy-only", () => {
    const priv = tokenUses(true, true, true).filter((t) => t.uses === "privacy").map((t) => t.act).join(" ");
    expect(priv).toMatch(/hard_delete_person_tasks/);
    expect(priv).toMatch(/export/);
    expect(priv).toMatch(/Match/);
  });
  it("never carries a value", () => {
    process.env[SYNC_ENV] = "secret-value-xyz";
    expect(syncTokenSet()).toBe(true);
    expect(JSON.stringify(tokenUses(true, true, true))).not.toContain("secret-value-xyz");
  });
});
