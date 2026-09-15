/**
 * The door above Member, held all the way up the ladder.
 *
 * Every refusal here sits beside somebody who IS let through, in the same case,
 * because a door that refused everybody would pass a test that only asked
 * whether the stranger stayed out. Pure, so none of it needs a database.
 */
import { describe, expect, it } from "vitest";

import { GAME_CONFIG, type StageRule } from "../../shared/gameConfig";
import {
  climbLadder,
  freezeStandingAboveTheDoor,
  isAdmitted,
  questsThatCarriedPastTheDoor,
  stoodAboveTheDoor,
  type LadderStage,
  type StandingOnRecord,
} from "./admission";

const LADDER = GAME_CONFIG.stages;

/** What one person has done, in plain facts. */
interface Facts {
  signed?: boolean;
  trained?: boolean;
  paid?: boolean;
  quests?: number;
}

/**
 * Each rung's own rule from those facts, the way `computeStage` reads the real
 * counts. `membership` is the host's `hasMembership`, which reads the flag, so
 * a case that grants the flag says `signed` too.
 */
const rules =
  (facts: Facts) =>
  (stage: LadderStage): boolean => {
    const rule: StageRule = stage.rule;
    switch (rule.type) {
      case "default":
      case "account":
        return true;
      case "training-complete":
        return !!facts.trained;
      case "membership":
        return !!facts.signed;
      case "quests":
        return (facts.quests ?? 0) >= rule.min;
      case "tokens":
        return !!facts.paid;
      default:
        return false;
    }
  };

describe("the ladder this guards", () => {
  it("puts Contributor and Quest Seeker above Member, which is the whole reason the door matters", () => {
    // THE PREMISE, MEASURED. If the ladder is ever reordered so these sit
    // below Member, every case below is testing a door nobody walks through.
    const at = (id: string) => LADDER.findIndex((s) => s.id === id);
    expect(at("member")).toBeGreaterThan(-1);
    expect(at("contributor")).toBeGreaterThan(at("member"));
    expect(at("quest-seeker")).toBeGreaterThan(at("member"));
  });
});

describe("isAdmitted", () => {
  it("counts a granted membership", () => {
    expect(isAdmitted({ membershipGranted: true }, LADDER)).toBe(true);
    expect(isAdmitted({ membershipGranted: false }, LADDER)).toBe(false);
  });

  it("counts an admin's stage grant at Member or above, and nothing below it", () => {
    expect(isAdmitted({ stageGranted: "member" }, LADDER)).toBe(true);
    expect(isAdmitted({ stageGranted: "co-creator" }, LADDER)).toBe(true);
    expect(isAdmitted({ stageGranted: "immersant" }, LADDER)).toBe(false);
  });

  it("admits nobody on an empty record, or on a rung the ladder has never heard of", () => {
    expect(isAdmitted({}, LADDER)).toBe(false);
    expect(isAdmitted({ stageGranted: "high-priest" }, LADDER)).toBe(false);
  });

  it("keeps nobody out on a ladder with no Member rung, so a fork cannot brick its own", () => {
    const noDoor: LadderStage[] = [
      { id: "guest", rule: { type: "account" } },
      { id: "elder", rule: { type: "granted" } },
    ];
    expect(isAdmitted({}, noDoor)).toBe(true);
  });
});

describe("climbLadder", () => {
  it("THE DEFECT: a guest the village paid stays a Guest, and the same pay lifts a member to Contributor", () => {
    expect(climbLadder(LADDER, {}, rules({ paid: true }))).toBe("guest");
    expect(climbLadder(LADDER, { membershipGranted: true }, rules({ signed: true, paid: true }))).toBe("contributor");
  });

  it("does not carry a guest past it on consented quests either", () => {
    expect(climbLadder(LADDER, {}, rules({ quests: 12 }))).toBe("guest");
    expect(climbLadder(LADDER, { membershipGranted: true }, rules({ signed: true, quests: 12 }))).toBe("quest-seeker");
  });

  it("moves nothing below the door: training still makes a guest a Participant", () => {
    expect(climbLadder(LADDER, {}, rules({ trained: true, paid: true, quests: 12 }))).toBe("participant");
  });

  it("opens for an admin's grant at Member, and the pay already had then counts", () => {
    expect(climbLadder(LADDER, { stageGranted: "member" }, rules({ paid: true }))).toBe("contributor");
  });

  it("treats every grant as a floor, above the door and below it", () => {
    expect(climbLadder(LADDER, { stageGranted: "co-creator" }, rules({}))).toBe("co-creator");
    expect(climbLadder(LADDER, { stageGranted: "immersant" }, rules({}))).toBe("immersant");
    expect(climbLadder(LADDER, { stageGranted: "immersant" }, rules({ trained: true }))).toBe("participant");
  });

  it("never lowers what a member earned to a grant below it", () => {
    expect(
      climbLadder(LADDER, { membershipGranted: true, stageGranted: "guest" }, rules({ signed: true, quests: 3 })),
    ).toBe("quest-seeker");
  });

  it("never asks the host about a granted rung, so the host's rules need no case for one", () => {
    const asked: string[] = [];
    climbLadder(LADDER, { membershipGranted: true }, (stage) => {
      asked.push(stage.rule.type);
      return false;
    });
    expect(asked).toContain("tokens");
    expect(asked).not.toContain("granted");
  });

  it("answers an empty ladder with nothing, instead of throwing", () => {
    expect(climbLadder([], {}, rules({}))).toBe("");
  });
});

describe("questsThatCarriedPastTheDoor", () => {
  it("is the platform's one quest when the village never tuned Contributor", () => {
    expect(questsThatCarriedPastTheDoor(undefined, 3)).toBe(1);
  });

  it("reads the bar the village stored, and Quest Seeker's where that was lower", () => {
    expect(questsThatCarriedPastTheDoor("2", 3)).toBe(2);
    expect(questsThatCarriedPastTheDoor("5", 3)).toBe(3);
  });

  it("reads one for a stored value that is not a whole number of at least one", () => {
    for (const stored of ["", "0", "-4", "many"]) {
      expect(questsThatCarriedPastTheDoor(stored, 3), `stored ${JSON.stringify(stored)}`).toBe(1);
    }
  });
});

describe("stoodAboveTheDoor", () => {
  const guest: StandingOnRecord = { id: "u-guest", email: "guest@example.test" };

  it("keeps a guest whose consented quest carried them past Member, and nobody who never had one", () => {
    expect(stoodAboveTheDoor(guest, LADDER, 1, 1)).toBe(true);
    expect(stoodAboveTheDoor(guest, LADDER, 0, 1)).toBe(false);
  });

  it("holds the count to the bar the village ran", () => {
    expect(stoodAboveTheDoor(guest, LADDER, 1, 2)).toBe(false);
    expect(stoodAboveTheDoor(guest, LADDER, 2, 2)).toBe(true);
  });

  it("has nothing to keep for somebody already admitted", () => {
    expect(stoodAboveTheDoor({ ...guest, membershipGranted: true }, LADDER, 5, 1)).toBe(false);
    expect(stoodAboveTheDoor({ ...guest, stageGranted: "member" }, LADDER, 5, 1)).toBe(false);
  });

  it("admits no example identity, and nobody who has left", () => {
    expect(stoodAboveTheDoor({ ...guest, isExample: true }, LADDER, 5, 1)).toBe(false);
    expect(stoodAboveTheDoor({ ...guest, email: "deleted-u-guest@anonymized.invalid" }, LADDER, 5, 1)).toBe(false);
  });
});

describe("freezeStandingAboveTheDoor", () => {
  it("admits exactly the people the door would have demoted, and says how many", async () => {
    const people: StandingOnRecord[] = [
      { id: "u-quested", email: "q@example.test" },
      { id: "u-member", email: "m@example.test", membershipGranted: true },
      { id: "u-granted", email: "g@example.test", stageGranted: "co-creator" },
      { id: "u-guest", email: "n@example.test" },
      // Paid and never had a quest consented: below Member on the old ladder,
      // so there is no standing to keep. The freeze never reads pay at all.
      { id: "u-paid-only", email: "p@example.test" },
      { id: "u-example", email: "e@example.test", isExample: true },
      { id: "u-departed", email: "deleted-u-departed@anonymized.invalid" },
    ];
    const consented = new Map([
      ["u-quested", 2],
      ["u-member", 4],
      ["u-granted", 1],
      ["u-example", 3],
      ["u-departed", 1],
    ]);
    const admitted: string[] = [];
    const lines: string[] = [];
    await freezeStandingAboveTheDoor({
      stages: LADDER,
      everyone: async () => people,
      consentedCounts: async () => consented,
      questBar: 1,
      admit: async (id) => {
        admitted.push(id);
      },
      log: (line) => lines.push(line),
    });
    expect(admitted).toEqual(["u-quested"]);
    expect(lines.join("\n")).toContain("for 1 member(s)");
  });
});
