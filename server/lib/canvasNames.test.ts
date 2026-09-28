/**
 * The name check under the canvas's public lines (server/lib/canvasNames.ts).
 *
 * Every refusal here is paired with a line that passes, because a check that
 * refused everything would pass every "it refuses" case on its own.
 */
import { describe, expect, it } from "vitest";
import { countsAsVillager, nameInLine, nameRefusal, namesToProtect, type NameFacts } from "./canvasNames";

const admitted = (m: any) => !!m.membershipGranted;

const VILLAGE: (NameFacts & { membershipGranted?: boolean })[] = [
  { name: "Ash Brook", email: "ash@example.test", role: "member", membershipGranted: true },
  { name: "Zoë Marchetti", email: "zoe@example.test", role: "member", membershipGranted: true },
  // An admin the village never admitted as a member is still one of its own.
  { name: "Moss Fielding", email: "moss@example.test", role: "admin", membershipGranted: false },
  // A founder whose account is not claimed yet is still a person.
  { name: "Wren Halloway", email: "wren@example.test", role: "founder", membershipGranted: false },
  // Registered and never admitted: not on the list (see the header).
  { name: "Rook Talbot", email: "rook@example.test", role: "member", membershipGranted: false },
  // A standing example identity is content.
  { name: "Example Steward", email: "steward@example.test", role: "member", membershipGranted: true, isExample: true },
  // A tombstone's name is whatever erasure left.
  { name: "Former member", email: "gone@anonymized.invalid", role: "member", membershipGranted: true },
  // One letter is not a name anybody here goes by, and it would refuse every "a".
  { name: "A", email: "a@example.test", role: "member", membershipGranted: true },
];

const NAMES = namesToProtect(VILLAGE, admitted);

describe("whose names a public line may not hold", () => {
  it("is the admitted members, the admins and the founders", () => {
    expect(VILLAGE.map((m) => countsAsVillager(m, admitted))).toEqual([true, true, true, true, false, false, false, true]);
  });

  it("protects each villager's whole name and first name, folded, and nobody else's", () => {
    expect(NAMES.sort()).toEqual(
      ["ash", "ash brook", "moss", "moss fielding", "wren", "wren halloway", "zoe", "zoe marchetti"].sort(),
    );
  });
});

describe("nameInLine", () => {
  it("finds a first name in any case, and quotes it as the line spells it", () => {
    expect(nameInLine("Ash keeps the keys to the seed store.", NAMES)).toBe("Ash");
    expect(nameInLine("the keys stay with ASH until spring", NAMES)).toBe("ASH");
    expect(nameInLine("ask moss about the budget", NAMES)).toBe("moss");
  });

  it("quotes a whole name whole, even across extra spaces", () => {
    expect(nameInLine("Ask Ash   Brook first.", NAMES)).toBe("Ash   Brook");
  });

  it("finds a name beside punctuation, and a possessive", () => {
    expect(nameInLine("(Wren) opens every gathering.", NAMES)).toBe("Wren");
    expect(nameInLine("Wren's circle decides the budget.", NAMES)).toBe("Wren");
    expect(nameInLine("Talk to Ash-first, then the circle.", NAMES)).toBe("Ash");
  });

  it("folds accents both ways, so Zoë is named with or without hers", () => {
    expect(nameInLine("Zoe holds the treasury.", NAMES)).toBe("Zoe");
    expect(nameInLine("ZOË holds the treasury.", NAMES)).toBe("ZOË");
  });

  it("finds a name an invisible character split, once the line is tidied as the route tidies it", () => {
    const split = `W${String.fromCharCode(0x200d)}ren keeps the calendar.`;
    // The route stores and checks the tidied line (normalisePublicLine); raw, the joiner hides the name.
    expect(nameInLine(split.replace(String.fromCharCode(0x200d), ""), NAMES)).toBe("Wren");
  });

  it("does not refuse a word that merely contains a name", () => {
    // Controls, one per refusal shape above.
    expect(nameInLine("We planted a hedge of mossy stones by Ashford Lane.", NAMES)).toBeNull();
    expect(nameInLine("Our care holder answers within two days.", NAMES)).toBeNull();
    expect(nameInLine("A wrenching season; we rebuilt the zoetrope.", NAMES)).toBeNull();
  });

  it("does not refuse a surname alone, a registrant's name, an example's or a tombstone's", () => {
    expect(nameInLine("The brook floods in March.", NAMES)).toBeNull();
    expect(nameInLine("Rook Talbot visited once.", NAMES)).toBeNull();
    expect(nameInLine("The example steward role is open.", NAMES)).toBeNull();
    expect(nameInLine("Any former member may come back.", NAMES)).toBeNull();
    expect(nameInLine("A circle meets on a new moon.", NAMES)).toBeNull();
  });

  it("names nobody when nobody is protected", () => {
    expect(nameInLine("Ash keeps the keys.", [])).toBeNull();
  });
});

describe("a name in a script written without spaces", () => {
  const names = namesToProtect(
    [
      { name: "王伟", email: "wang@example.test", role: "member", membershipGranted: true },
      { name: "สมชาย ใจดี", email: "somchai@example.test", role: "member", membershipGranted: true },
    ] as (NameFacts & { membershipGranted?: boolean })[],
    admitted,
  );

  it("is found inside a run of text with no word edge around it", () => {
    expect(nameInLine("王伟负责钥匙。", names)).toBe("王伟");
    expect(nameInLine("ถามสมชายก่อน", names)).toBe("สมชาย");
  });

  it("is still not found where it is not written (controls)", () => {
    expect(nameInLine("钥匙由照料者保管。", names)).toBeNull();
    expect(nameInLine("ถามผู้ดูแลก่อน", names)).toBeNull();
    // A Latin name keeps its word edge beside them.
    expect(nameInLine("Ashford keeps the keys.", namesToProtect([{ name: "Ash", role: "admin" }], admitted))).toBeNull();
  });
});

describe("nameRefusal", () => {
  it("quotes back only what the writer typed, and says what to write instead", () => {
    const said = nameRefusal("Ash");
    expect(said).toContain('"Ash"');
    expect(said).toMatch(/names nobody/);
    expect(said).toMatch(/role/);
  });
});
