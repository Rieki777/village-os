/**
 * THE ROLE START GATE'S RULES, WITHOUT A DATABASE (role journey L7).
 *
 *   1. Every switch off: the gate asks nothing and reads nothing.
 *   2. A paid role waits on its terms; a role with no money in its terms does not.
 *   3. The notice's words: "Two steps before your role starts", the steps one a
 *      line, and where the first is done.
 *   4. The three switches ship off.
 */
import { describe, expect, it } from "vitest";
import { VARIABLES } from "../../shared/gameVariables";
import { makeRoleStartGate, NO_DIALS, roleStartDials, START_WORDS, stepHref, stepsBody } from "./roleStartAgreements";

/** A connection that fails the test if anything reads it. */
const untouchable = new Proxy({}, { get: (_t, k) => { throw new Error(`the gate read the database (${String(k)}) when it had nothing to ask`); } }) as any;

const app = (settings: unknown) => ({ id: "sa-1", candidateUserId: "u-1", textId: null, textHash: null, settings }) as any;
const PAID = { v: 1, pay: { kind: "hourly", amount: 25, currency: "USD" } };
const UNPAID = { v: 1, pay: { kind: "none" } };

const deps = (dials = NO_DIALS) => ({
  dials: () => dials,
  agreement: () => null,
  emailOf: async () => null,
  membershipGranted: async () => false,
});

describe("the role start gate", () => {
  it("every switch off asks nothing and reads nothing: today's behaviour", async () => {
    expect(await makeRoleStartGate(deps())(untouchable, app(PAID), new Date())).toEqual([]);
  });

  it("a paid role waits on its terms; CONTROL: a role whose terms carry no money does not", async () => {
    const gate = makeRoleStartGate(deps({ ...NO_DIALS, paidTerms: true }));
    expect(await gate(untouchable, app(PAID), new Date())).toEqual(["terms"]);
    expect(await gate(untouchable, app(UNPAID), new Date())).toEqual([]);
  });

  it("the switches are read by their keys, and every one ships off", () => {
    const on = new Set(["org.start_after_membership"]);
    expect(roleStartDials((k) => on.has(k))).toEqual({ confidentiality: false, membership: true, paidTerms: false });
    for (const key of ["org.start_after_confidentiality", "org.start_after_membership", "org.start_after_paid_terms"]) {
      const v = VARIABLES.find((x) => x.key === key);
      expect(v, key).toMatchObject({ type: "boolean", default: "false" });
    }
  });
});

describe("telling the holder", () => {
  it("says how many steps, each one, when the role starts, and where the first is done", () => {
    expect(START_WORDS.title(2)).toBe("Two steps before your role starts");
    expect(START_WORDS.title(1)).toBe("One step before your role starts");
    expect(stepsBody(["confidentiality", "membership"]).split("\n")).toEqual([
      START_WORDS.step.confidentiality,
      START_WORDS.step.membership,
      START_WORDS.after,
    ]);
    expect(START_WORDS.after).toContain("within the hour");
    expect(stepHref("confidentiality", { id: "sa-1" })).toBe("/aligned");
    expect(stepHref("membership", { id: "sa-1" })).toBe("/love-letter");
    expect(stepHref("terms", { id: "sa-1" })).toContain("sa-1");
  });
});
