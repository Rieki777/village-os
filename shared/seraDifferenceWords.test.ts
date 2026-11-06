/**
 * The words for each difference, held to the fix round on the approved boards
 * (2026-11-06) and the standing "Role (FirstName)" ruling:
 *
 *   - a role is named with its holders' first names in parentheses, read from
 *     the live chart here and handed in, never from the service's data, and a
 *     role nobody holds gets no parentheses;
 *   - a role the service archived says whether anybody holds it here;
 *   - a conflict over a purpose reads as the board does;
 *   - the Check first words (R39) are short, and the base-unknown flag is left
 *     off the screen where it says nothing, while the data keeps it (R2).
 *
 * The rest of the table is pinned in shared/seraDifferences.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { Difference, DifferenceSubject } from "./seraDifferences";
import { differenceSentence, flagWords, shownFlags } from "./seraDifferenceWords";

type Over = Omit<Partial<Difference>, "subject"> & { subject?: Partial<DifferenceSubject> };

function diff(over: Over = {}): Difference {
  return {
    key: "page:x",
    kind: "rename",
    lane: "decision",
    state: "suggestion",
    field: "name",
    sera: "Water Keeper",
    ours: "Water Steward",
    base: { value: "Water Steward" },
    seraHash: "s",
    oursHash: "o",
    flags: [],
    namesAMember: false,
    autoEligible: false,
    bulkEligible: true,
    takeable: true,
    source: { pageId: "page", editedAt: null },
    ...over,
    subject: { kind: "role", pageId: "page", ourId: "r-water", via: "pageId", name: "Water Steward", circleId: "water", circleName: "Water", ...over.subject },
  };
}

const move = diff({ kind: "roleMove", field: "circle", params: { from: "Water", to: ["Land & Ecology"] } });
const rest = diff({ kind: "roleRest", field: null, sera: "gone", ours: "live", subject: { name: "Dish Rota" } });

describe("a role named with its holders (Role (FirstName))", () => {
  it("puts the holders' first names in parentheses after the role", () => {
    expect(differenceSentence(move, "Sera", { holders: ["Ana Moss"] })).toBe("Sera suggests moving Water Steward (Ana) from Water to Land & Ecology.");
    expect(differenceSentence(move, "Sera", { holders: ["Ana Moss", "Bo Reyes"] })).toBe(
      "Sera suggests moving Water Steward (Ana, Bo) from Water to Land & Ecology.",
    );
    expect(differenceSentence(diff(), "Sera", { holders: ["Ana Moss"] })).toBe("Sera suggests renaming Water Steward (Ana) to Water Keeper.");
  });

  it("gives a role nobody holds no parentheses, and says the same with no holders handed in", () => {
    expect(differenceSentence(move, "Sera", { holders: [] })).toBe("Sera suggests moving Water Steward from Water to Land & Ecology.");
    expect(differenceSentence(move, "Sera")).toBe("Sera suggests moving Water Steward from Water to Land & Ecology.");
  });

  it("keeps a possessive plain, and never names a holder for a circle or a role that is not here yet", () => {
    const aim = diff({ kind: "textField", field: "aim", lane: "lowRisk", subject: { name: "Treasurer" } });
    expect(differenceSentence(aim, "Sera", { holders: ["Rick Field"] })).toBe("Sera has new words for Treasurer's purpose.");
    const added = diff({ kind: "roleAdd", field: null, subject: { ourId: null, name: "Well Monitor" } });
    expect(differenceSentence(added, "Sera", { holders: ["Ana Moss"] })).toBe("Sera suggests a new role, Well Monitor, in Water.");
  });
});

describe("a role the service archived", () => {
  it("says nobody holds it here, when nobody does", () => {
    expect(differenceSentence(rest, "Sera", { holders: [] })).toBe("Sera has archived Dish Rota. It is still live here, and nobody holds it.");
  });

  it("names who holds it, when somebody does", () => {
    expect(differenceSentence(rest, "Sera", { holders: ["Ana Moss"] })).toBe("Sera has archived Dish Rota (Ana). It is still live here.");
  });

  it("says neither when the holders were not read", () => {
    expect(differenceSentence(rest, "Sera")).toBe("Sera has archived Dish Rota. It is still live here.");
  });
});

describe("a conflict over a purpose", () => {
  it("reads as the board does, with the agent's own name", () => {
    const both = diff({ kind: "textField", field: "aim", lane: "lowRisk", state: "conflict", subject: { name: "Pump Keeper" } });
    expect(differenceSentence(both, "Sera")).toBe("You and Sera both changed Pump Keeper's purpose.");
    expect(differenceSentence(both, "Maia")).toBe("You and Maia both changed Pump Keeper's purpose.");
  });
});

describe("Check first (R39)", () => {
  it("says the unknown base in a few words", () => {
    expect(flagWords({ key: "baseUnknown" }, "Sera")).toBe("Check first: no earlier version from Sera to compare");
  });

  it("leaves the unknown base off the screen beside a first sight, and on pay", () => {
    const firstSeen = diff({ kind: "roleAdd", field: null, flags: [{ key: "baseUnknown" }, { key: "firstSight" }] });
    expect(shownFlags(firstSeen).map((f) => f.key)).toEqual(["firstSight"]);
    const pay = diff({ kind: "pay", field: "pay", flags: [{ key: "baseUnknown" }] });
    expect(shownFlags(pay)).toEqual([]);
    const plain = diff({ flags: [{ key: "baseUnknown" }, { key: "matchedByName" }] });
    expect(shownFlags(plain).map((f) => f.key)).toEqual(["baseUnknown", "matchedByName"]);
  });

  it("never changes the data: the flag stays on the difference, for R2", () => {
    const pay = diff({ kind: "pay", field: "pay", flags: [{ key: "baseUnknown" }] });
    shownFlags(pay);
    expect(pay.flags).toEqual([{ key: "baseUnknown" }]);
  });
});
