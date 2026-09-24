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
  NOTE_IS_PUBLIC,
  POWER_APPLICATION,
  POWER_HAND_KEYS,
  powerHandSentence,
  publicHands,
  putToVillageRefusal,
  raiseHandRefusal,
  STANDING_HAND_STATUSES,
  standingHands,
  whoMayPutHandToVillage,
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

/**
 * RULING 1 (Rye, 2026-09-23): who may put a raised hand to the village.
 *
 * Every case here is a CONTROL for one branch of `whoMayPutHandToVillage`, and
 * the two the ruling does not name are tested as hard as the two it does, so a
 * later reader can see which sentence each branch is standing on.
 */
describe("who may put a hand for a power to the village", () => {
  const ANA = "user-ana";
  const HOLDER = "user-holder";

  it("option 1: a role holds it, so only a live holder may", () => {
    const rule = whoMayPutHandToVillage(false, [HOLDER]);
    expect(rule).toEqual({ who: "live-holders", because: "a-role-holds-it", holders: [HOLDER] });
    expect(putToVillageRefusal(rule, HOLDER, LIBRARY)).toBeNull();
    const no = putToVillageRefusal(rule, ANA, LIBRARY);
    expect(no?.status).toBe(403);
    expect(no?.error).toBe("not_a_holder");
    // The refusal names the door, the way STEWARD_SEAT_REFUSAL does.
    expect(no?.message).toContain("Ask one of them");
  });

  it("option 2: the village holds it, so any member may", () => {
    const rule = whoMayPutHandToVillage(true, []);
    expect(rule.who).toBe("any-member");
    expect(rule.because).toBe("village-holds-it");
    expect(putToVillageRefusal(rule, ANA, LIBRARY)).toBeNull();
  });

  it("BOTH true: village-held beats a role that also carries it, and that is a reading", () => {
    // Rye named two conditions that can both hold at once. This branch reads
    // village-held as the stronger one, because it is the only place in the
    // gate where holding beats being an admin. If that reading is ever
    // overturned, THIS is the test that has to change.
    const rule = whoMayPutHandToVillage(true, [HOLDER]);
    expect(rule.because).toBe("village-holds-it");
    expect(rule.who).toBe("any-member");
    expect(putToVillageRefusal(rule, ANA, LIBRARY)).toBeNull();
  });

  it("NEITHER true: nobody holds it, so it goes to any member on the org.decide ruling", () => {
    // Not this ruling. Rye, 2026-09-14: "no holder means a ballot".
    const rule = whoMayPutHandToVillage(false, []);
    expect(rule.because).toBe("nobody-holds-it");
    expect(rule.who).toBe("any-member");
    expect(putToVillageRefusal(rule, ANA, LIBRARY)).toBeNull();
  });

  it("a blank user id is nobody, and nobody is not a holder", () => {
    const rule = whoMayPutHandToVillage(false, [HOLDER]);
    expect(putToVillageRefusal(rule, "", LIBRARY)?.status).toBe(403);
  });

  it("an empty holder id never turns a role-held power into anybody's", () => {
    // liveHoldersOfCapability stringifies user ids, so a row with none would
    // arrive as "". Counting it would open every role-held power to everybody.
    const rule = whoMayPutHandToVillage(false, [""]);
    expect(rule.because).toBe("nobody-holds-it");
    expect(rule.holders).toEqual([]);
  });

  it("says nothing about a power when it has no label to say", () => {
    const no = putToVillageRefusal(whoMayPutHandToVillage(false, [HOLDER]), ANA);
    expect(no?.message).toContain("this power");
  });
});

/**
 * RULING 2 (Rye, 2026-09-23): the notes are public, notes already written
 * included. The controls that matter are the NEIGHBOURS: `submissions` carries
 * membership requests, visit inquiries and investor enquiries in the same
 * table, and a read widened by one word would publish them.
 */
describe("the hands members read", () => {
  const rows = [
    {
      id: "h1",
      type: POWER_APPLICATION,
      status: "new",
      userId: "user-ana",
      userName: "Ana",
      submittedAt: "2026-09-20T00:00:00.000Z",
      data: { capability: "library.keep", powerLabel: LIBRARY, note: "I have run a library before.", email: "ana@example.org" },
    },
    {
      id: "h0",
      type: POWER_APPLICATION,
      status: "reviewing",
      userId: "user-ben",
      userName: "Ben",
      submittedAt: "2026-09-19T00:00:00.000Z",
      data: { capability: "library.keep", powerLabel: LIBRARY, note: "Me too." },
    },
    {
      id: "answered",
      type: POWER_APPLICATION,
      status: "accepted",
      userId: "user-cal",
      userName: "Cal",
      submittedAt: "2026-09-18T00:00:00.000Z",
      data: { capability: "library.keep", powerLabel: LIBRARY, note: "An answered hand." },
    },
    {
      id: "visit",
      type: "visit-inquiry",
      status: "new",
      userId: "user-dee",
      userName: "Dee",
      submittedAt: "2026-09-17T00:00:00.000Z",
      data: { note: "We would like to visit in March.", email: "dee@example.org", phone: "555" },
    },
    {
      id: "investor",
      type: "investor",
      status: "new",
      userId: "user-eve",
      userName: "Eve",
      submittedAt: "2026-09-16T00:00:00.000Z",
      data: { note: "How much is left in the round?", email: "eve@example.org" },
    },
    {
      /*
       * A NEIGHBOUR THAT LOOKS LIKE A HAND. The type filter is the guard and
       * the capability filter is a second lock, and the controls above cannot
       * tell them apart, because nothing else in the table happens to store a
       * `capability` key today. A later lane adding one would walk straight
       * past a test suite that never built this row, so this builds it.
       */
      id: "lookalike",
      type: "membership-request",
      status: "new",
      userId: "user-fay",
      userName: "Fay",
      submittedAt: "2026-09-15T00:00:00.000Z",
      data: { capability: "library.keep", note: "My letter asking to join.", email: "fay@example.org" },
    },
  ];

  it("gives members the note on a hand that is up", () => {
    const out = publicHands(rows);
    expect(out.map((h) => h.id)).toEqual(["h0", "h1"]);
    expect(out[1]?.note).toBe("I have run a library before.");
    expect(out[1]?.userName).toBe("Ana");
  });

  it("CONTROL: a visit inquiry's note is not published, and neither is an investor's", () => {
    const serialised = JSON.stringify(publicHands(rows));
    expect(serialised).not.toContain("We would like to visit in March.");
    expect(serialised).not.toContain("How much is left in the round?");
    expect(serialised).not.toContain("user-dee");
    expect(serialised).not.toContain("user-eve");
  });

  it("CONTROL: a membership request that happens to name a capability is still not a hand", () => {
    const serialised = JSON.stringify(publicHands(rows));
    expect(serialised).not.toContain("My letter asking to join.");
    expect(serialised).not.toContain("user-fay");
  });

  it("CONTROL: an email beside a note never leaves with it", () => {
    expect(JSON.stringify(publicHands(rows))).not.toContain("ana@example.org");
  });

  it("a hand that has been answered is down, so it is not in the list", () => {
    expect(publicHands(rows).some((h) => h.id === "answered")).toBe(false);
  });

  it("a member who is no longer here is left out, note and all", () => {
    const out = publicHands(rows, (id) => id !== "user-ana");
    expect(out.map((h) => h.id)).toEqual(["h0"]);
    expect(JSON.stringify(out)).not.toContain("I have run a library before.");
  });

  it("a row naming no power is not a hand", () => {
    const out = publicHands([{ id: "x", type: POWER_APPLICATION, status: "new", userId: "u", data: {} }]);
    expect(out).toEqual([]);
  });

  it("says on the writing screen what the ruling did", () => {
    expect(NOTE_IS_PUBLIC).toContain("Everyone in the village can read");
  });
});
