/**
 * "Your next step" for a guest who already signed the letter.
 *
 * THE DEFECT: the membership rule read membership alone, so a guest who had
 * signed and was waiting for the village's answer was told to "Sign the Love
 * Letter" on their profile and on the Trail of every page, for a letter they
 * had signed. These run the REAL rules from GAME_CONFIG, in their real order,
 * so a reorder or a reworded rule is measured too.
 */
import { describe, expect, it } from "vitest";
import { GAME_CONFIG, withCommitmentName } from "../../shared/gameConfig";
import { SIGNING_TYPE } from "../../shared/membershipSigning";
import { joiningOf, pickNextAction, type NextActionFacts } from "./nextAction";

const RULES = GAME_CONFIG.nextActions;

/** A guest who has trained, claimed nothing and has nothing to send, so the letter is the step in question. */
const guest = (over: Partial<NextActionFacts> = {}): NextActionFacts => ({
  trained: true,
  joining: "unsigned",
  claims: [],
  budget: { remaining: 0, total: 0 },
  ...over,
});

const signing = (status: string, over: Record<string, unknown> = {}) => ({
  id: `s-${status}`,
  type: SIGNING_TYPE,
  userId: "u-ada",
  status,
  submittedAt: "2026-10-01T10:00:00.000Z",
  ...over,
});

describe("where a guest stands with the letter", () => {
  it("reads a signing the village has not answered as waiting, under every pipeline word for it", () => {
    for (const status of ["new", "reviewing", "in-conversation"]) {
      expect(joiningOf([signing(status)], "u-ada"), status).toBe("waiting");
    }
  });

  it("reads no signing, somebody else's signing and another form as unsigned", () => {
    expect(joiningOf([], "u-ada")).toBe("unsigned");
    expect(joiningOf([signing("new", { userId: "u-bea" })], "u-ada")).toBe("unsigned");
    expect(joiningOf([signing("new", { type: "membership-request" })], "u-ada")).toBe("unsigned");
  });

  it("reads a signing the village said no to as unsigned, because signing again is how a person asks again", () => {
    expect(joiningOf([signing("declined")], "u-ada")).toBe("unsigned");
  });

  it("follows the newest signing when somebody signed twice", () => {
    const declined = signing("declined", { submittedAt: "2026-09-01T10:00:00.000Z" });
    const again = signing("new", { id: "s-again", submittedAt: "2026-10-02T10:00:00.000Z" });
    expect(joiningOf([again, declined], "u-ada")).toBe("waiting");
  });
});

describe("the next step a guest is shown", () => {
  it("tells a guest who signed that the letter is with the village, and never to sign again", () => {
    const step = pickNextAction(RULES, guest({ joining: joiningOf([signing("new")], "u-ada") }));
    expect(step.id).toBe("membership-waiting");
    const label = withCommitmentName(step.label, "Love Letter");
    expect(label).toContain("Your Love Letter is with the village");
    expect(label).not.toMatch(/^Sign/);
    expect(step.href).not.toBe("/love-letter");
  });

  it("still tells a guest who has not signed to sign", () => {
    const step = pickNextAction(RULES, guest({ joining: joiningOf([], "u-ada") }));
    expect(step.id).toBe("membership");
    expect(step.href).toBe("/love-letter");
  });

  it("asks a guest the village said no to to sign again", () => {
    expect(pickNextAction(RULES, guest({ joining: joiningOf([signing("declined")], "u-ada") })).id).toBe("membership");
  });

  it("keeps training first, for a guest who signed before training", () => {
    expect(pickNextAction(RULES, guest({ trained: false, joining: "waiting" })).id).toBe("training");
  });

  it("says nothing about the letter to a member, or where the village does not serve it", () => {
    expect(pickNextAction(RULES, guest({ joining: null })).id).toBe("first-quest");
  });

  it("falls back to the last rule when nothing applies", () => {
    const busy = guest({ joining: null, claims: [{ status: "consented" }] });
    expect(pickNextAction(RULES, busy).id).toBe(RULES[RULES.length - 1].id);
  });
});
