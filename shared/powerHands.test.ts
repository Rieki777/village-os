/**
 * The rules of a raised hand for a power, without a database.
 *
 * The route and the profile both lean on these, so a rule wrong here is wrong in
 * both places at once. The controls stand in the same inbox as the hand that
 * counts: somebody else's hand, a hand for another power, answered hands, a seat
 * hand, and a row that names no power at all.
 */
import { describe, expect, it } from "vitest";
import {
  asOffer,
  POWER_APPLICATION,
  POWER_HAND_KEYS,
  powerHandSentence,
  raiseHandRefusal,
  STANDING_HAND_STATUSES,
  standingHands,
} from "./powerHands";

const LIBRARY = "Keep the shared library and its loans";

const hand = (over: Record<string, unknown> = {}) => ({
  id: "h1",
  type: POWER_APPLICATION,
  status: "new",
  userId: "cass",
  submittedAt: "2026-09-15T10:00:00.000Z",
  data: { capability: "library.keep", powerLabel: LIBRARY },
  ...over,
});

describe("standingHands", () => {
  it("reads only this member's hands that are still up, by power", () => {
    const inbox = [
      hand({ id: "mine" }),
      hand({ id: "theirs", userId: "dell", data: { capability: "event.manage" } }),
      hand({ id: "other-power", status: "reviewing", data: { capability: "map.publish" } }),
      hand({ id: "declined", status: "declined", data: { capability: "story.tell" } }),
      hand({ id: "seat", type: "role-application", data: { capability: "forum.moderate" } }),
      hand({ id: "no-power", data: {} }),
    ];
    const hands = standingHands(inbox, "cass");
    expect([...hands.keys()].sort()).toEqual(["library.keep", "map.publish"]);
    expect(hands.get("library.keep")).toEqual({ id: "mine", status: "new", submittedAt: "2026-09-15T10:00:00.000Z" });
  });

  it("keeps a hand up while an answer is coming, and puts it down on either answer", () => {
    expect([...STANDING_HAND_STATUSES]).toEqual(["new", "reviewing", "in-conversation"]);
    for (const status of STANDING_HAND_STATUSES) {
      expect(standingHands([hand({ status })], "cass").get("library.keep")?.status, status).toBe(status);
    }
    for (const status of ["accepted", "declined", "archived"]) {
      expect(standingHands([hand({ status })], "cass").size, status).toBe(0);
    }
  });

  it("never holds a yes up, so a member whose appointment came and went can ask again", () => {
    // THE CASE THAT BROKE IT. A yes counted as a hand still up, nothing moves an
    // answered row, and every seat has a term: once the seat that carried the
    // power ended, the member was refused every new hand, for good.
    const inbox = [hand({ id: "long-ago", status: "accepted", submittedAt: "2026-01-01T10:00:00.000Z" })];
    expect(raiseHandRefusal({ held: false, recommended: true }, standingHands(inbox, "cass").get("library.keep"))).toBeNull();
  });

  it("shows the newest of two hands for one power, whichever order the inbox holds them in", () => {
    const inbox = [hand({ id: "older", status: "reviewing", submittedAt: "2026-09-14T10:00:00.000Z" }), hand({ id: "newer" })];
    expect(standingHands(inbox, "cass").get("library.keep")?.id).toBe("newer");
    expect(standingHands([...inbox].reverse(), "cass").get("library.keep")?.id).toBe("newer");
  });

  it("reads no hands for a member with no id", () => {
    expect(standingHands([hand({ userId: "" })], "").size).toBe(0);
  });
});

describe("raiseHandRefusal", () => {
  const up = { id: "h1", status: "new" as const, submittedAt: "2026-09-15T10:00:00.000Z" };

  it("lets a hand go up for a power put to the member", () => {
    expect(raiseHandRefusal({ held: false, recommended: true }, undefined)).toBeNull();
  });

  it("names each refusal, in the order a member would want to hear them", () => {
    expect(raiseHandRefusal(undefined, undefined)).toMatchObject({ status: 404, error: "power_not_found" });
    expect(raiseHandRefusal({ held: true, recommended: false }, up)).toMatchObject({ status: 409, error: "already_held" });
    expect(raiseHandRefusal({ held: false, recommended: true }, up)).toMatchObject({ status: 409, error: "hand_already_up" });
    // A hand already up on a power the map has since stopped putting to them:
    // the member hears about their hand, which is the thing they can see.
    expect(raiseHandRefusal({ held: false, recommended: false }, up)).toMatchObject({ status: 409, error: "hand_already_up" });
    expect(raiseHandRefusal({ held: false, recommended: false }, undefined)).toMatchObject({ status: 409, error: "not_recommended" });
    expect(raiseHandRefusal({ held: false }, undefined)?.error, "a row from before the map").toBe("not_recommended");
  });
});

describe("the words", () => {
  it("lowers only the first letter of a label, so it follows 'to'", () => {
    expect(asOffer(LIBRARY)).toBe("keep the shared library and its loans");
    expect(asOffer("  Post announcements to the village feed ")).toBe("post announcements to the village feed");
    expect(asOffer("")).toBe("");
  });

  it("says in one sentence what a hand asks for", () => {
    expect(powerHandSentence({ capability: "library.keep", powerLabel: LIBRARY, suits: ["The Architect"] })).toBe(
      "Asks to keep the shared library and its loans. It suits The Architect, which they play.",
    );
    expect(
      powerHandSentence({
        capability: "story.tell",
        powerLabel: "Say what the village is, in public, in its own words",
        suits: ["The Storyteller", "The Architect"],
      }),
    ).toBe(
      "Asks to say what the village is, in public, in its own words. It suits The Storyteller and The Architect, both of which they play.",
    );
    expect(powerHandSentence({ capability: "library.keep", suits: [4, "", null] })).toBe("Asks for the power library.keep.");
    expect(powerHandSentence({})).toBe("Asks for a power.");
  });

  it("names the keys that sentence says, for the inbox table to leave out", () => {
    expect([...POWER_HAND_KEYS].sort()).toEqual(["capability", "powerLabel", "suits"]);
  });
});
