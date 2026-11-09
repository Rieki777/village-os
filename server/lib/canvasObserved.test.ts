/**
 * The See frame without a database: what a failed read says, and that a fact
 * a viewer may not read is absent rather than invented.
 *
 * The facts themselves are read against a real database, block by block, in
 * server/routes/canvasFrames.test.ts. This file holds the two properties that
 * need a broken pool or a narrow viewer to show.
 */
import type { Pool } from "mysql2/promise";
import { afterEach, describe, expect, it } from "vitest";
import { observedFacts, type ObservedDeps } from "./canvasObserved";
import { wireReaders } from "./villageReaders";

/** A pool that has lost its connection. */
const broken = { query: async () => { throw new Error("connection lost"); } } as unknown as Pool;

const deps = (over: Partial<ObservedDeps> = {}): ObservedDeps => ({
  pool: broken,
  viewer: { id: "m1", isAdmin: false, holds: () => false },
  readExitPolicy: () => ({}),
  loadRoles: () => [],
  roleHolders: () => [],
  tools: () => [],
  submissions: () => [],
  legalEntityLabel: () => "",
  seasonNow: () => null,
  ...over,
});

describe("the See frame", () => {
  afterEach(() => wireReaders({ moduleIsOn: () => false, boolVar: () => false }));

  it("says a read failed, with its link, and keeps the facts that did not", async () => {
    const facts = await observedFacts("power", deps());
    const byId = Object.fromEntries(facts.map((f) => [f.id, f]));
    // The method is a dial read from the variables cache, which needs no pool.
    expect(byId["default-method"].text).toMatch(/^Village-wide ballots decide by: /);
    // The Birthing reads the database, and says so when it cannot.
    expect(byId.birthing).toEqual({ id: "birthing", text: "This could not be read just now.", href: "/journey-to-launch", label: "The Birthing" });
  });

  it("leaves out a fact the viewer's audience may not read, and never makes one up", async () => {
    wireReaders({ moduleIsOn: () => true, boolVar: () => false });
    const member = await observedFacts("team", deps());
    expect(member.map((f) => f.id)).not.toContain("accounts");
  });

  it("names a care role and whether it is held today, from the policy and the seats handed in", async () => {
    const facts = await observedFacts("conflict", deps({
      readExitPolicy: () => ({ restorative: { intakeContactRole: "care", coverRole: "", replyHours: 72, outsideContact: { name: "Sam Reed", organisation: "", howToReach: "sam@example.invalid" } } }),
      loadRoles: () => [{ id: "care", name: "Care Holder" }],
      roleHolders: () => [{ roleId: "care", userId: "u1", termEndsAt: null }],
    }));
    const text = facts.map((f) => f.text);
    expect(text).toContain("Care Holder receives a request for care, and somebody holds that role today.");
    expect(text).toContain("A reply is promised within 72 hours.");
    expect(text).toContain("Somebody outside the village is named to bring a conflict to.");
    // The contact's name is never in the frame.
    expect(JSON.stringify(facts)).not.toContain("Sam Reed");
  });
});
