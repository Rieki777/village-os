/**
 * The name check under the canvas's public lines (server/lib/canvasNames.ts).
 *
 * Every refusal here is paired with a line that passes, because a check that
 * refused everything would pass every "it refuses" case on its own.
 */
import { describe, expect, it } from "vitest";
import { countsAsVillager, nameInLine, nameRefusal, namesToProtect, type NameFacts } from "./canvasNames";

const VILLAGE: NameFacts[] = [
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
  // Placed at Member by an admin (PUT /api/admin/players/:id/stage), which writes only the grant: admitted.
  { name: "Juniper Vale", email: "juniper@example.test", role: "member", stageGranted: "member" },
  // Granted a rung below Member: not admitted, so not on the list.
  { name: "Linden Rowe", email: "linden@example.test", role: "member", stageGranted: "immersant" },
];

const NAMES = namesToProtect(VILLAGE);

describe("whose names a public line may not hold", () => {
  it("is the admitted members, however they were admitted, the admins and the founders", () => {
    expect(VILLAGE.map((m) => countsAsVillager(m))).toEqual([true, true, true, true, false, false, false, true, true, false]);
  });

  it("counts a stage grant at Member or any rung above it as an admission, and one below it as none", () => {
    for (const stageGranted of ["member", "initiate", "co-creator"]) {
      expect(countsAsVillager({ name: "Juniper Vale", role: "member", stageGranted }), stageGranted).toBe(true);
    }
    for (const stageGranted of ["guest", "immersant", "participant", "", null]) {
      expect(countsAsVillager({ name: "Juniper Vale", role: "member", stageGranted }), String(stageGranted)).toBe(false);
    }
  });

  it("protects each villager's whole name and first name, folded, and nobody else's", () => {
    expect(NAMES.sort()).toEqual(
      ["ash", "ash brook", "juniper", "juniper vale", "moss", "moss fielding", "wren", "wren halloway", "zoe", "zoe marchetti"].sort(),
    );
  });

  it("refuses the name of a member an admin placed at Member by hand", () => {
    expect(nameInLine("Juniper holds the keys to the seed store.", NAMES)).toBe("Juniper");
    // Control: the one granted a rung below Member is not on the list.
    expect(nameInLine("Linden holds the keys to the seed store.", NAMES)).toBeNull();
  });
});

describe("nameInLine", () => {
  it("finds a first name written as a name, and quotes it as the line spells it", () => {
    expect(nameInLine("Ash keeps the keys to the seed store.", NAMES)).toBe("Ash");
    expect(nameInLine("the keys stay with ASH until spring", NAMES)).toBe("ASH");
    expect(nameInLine("ask Moss about the budget", NAMES)).toBe("Moss");
  });

  it("finds a whole name in any case, and a first name only with its capital", () => {
    expect(nameInLine("ask moss fielding about the budget", NAMES)).toBe("moss fielding");
    // Control: the same first word in lower case is the plant, not the person.
    expect(nameInLine("ask about the moss on the north wall", NAMES)).toBeNull();
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

describe("a name that is also an ordinary word", () => {
  // Bootstrap stores a founder who leaves the name blank as "Founder" (server/index.ts).
  const ROSTER: NameFacts[] = [
    { name: "Founder", email: "founder@example.test", role: "founder" },
    { name: "Will Harper", email: "will@example.test", role: "member", membershipGranted: true },
    { name: "May Chen", email: "may@example.test", role: "member", membershipGranted: true },
    { name: "An Nguyen", email: "an@example.test", role: "member", membershipGranted: true },
    { name: "Don Park", email: "don@example.test", role: "member", membershipGranted: true },
    { name: "The Gardener", email: "gardener@example.test", role: "member", membershipGranted: true },
  ];
  const names = namesToProtect(ROSTER);

  it("leaves a title and a sentence's own words off the list, and keeps every whole name", () => {
    expect(names.sort()).toEqual(["an nguyen", "don", "don park", "may", "may chen", "the gardener", "will", "will harper"].sort());
  });

  it("lets through the lines a village writes about how it works", () => {
    for (const line of [
      "Until the handover, the founder keeps the purpose pen.",
      "Founder keeps the purpose pen until every power is handed over.",
      "Founders hand over one power at a time.",
      "The stewards will review every proposal within a week.",
      "Any member may propose a change to any dial.",
      "We meet once a moon in an open circle.",
      "An open circle meets each moon.",
      "We don't vote on small things; the role holder decides.",
      "The circle meets at dusk.",
    ]) {
      expect(nameInLine(line, names), line).toBeNull();
    }
  });

  it("still refuses each of those people by name (controls)", () => {
    expect(nameInLine("Will Harper holds the keys.", names)).toBe("Will Harper");
    expect(nameInLine("will harper holds the keys.", names)).toBe("will harper");
    expect(nameInLine("Will holds the keys.", names)).toBe("Will");
    expect(nameInLine("Ask May first.", names)).toBe("May");
    expect(nameInLine("An Nguyen keeps the ledger.", names)).toBe("An Nguyen");
    expect(nameInLine("Ask the gardener first.", names)).toBe("the gardener");
  });

  it("finds a capitalised name after the same word in lower case earlier in the line", () => {
    expect(nameInLine("The stewards will ask Will first.", names)).toBe("Will");
  });
});

describe("a name typed in another script's keyboard, or set against another script", () => {
  const names = namesToProtect([{ name: "Ash", email: "ash@example.test", role: "admin" }]);

  it("finds a full-width Latin name, and a Latin name set against Japanese, Chinese or Hebrew letters", () => {
    expect(nameInLine("Ａｓｈ holds the keys.", names)).toBe("Ａｓｈ");
    expect(nameInLine("Ashさんが鍵を持つ。", names)).toBe("Ash");
    expect(nameInLine("鍵はAshが持つ。", names)).toBe("Ash");
    expect(nameInLine("由Ash负责钥匙。", names)).toBe("Ash");
    expect(nameInLine("המפתחות לAsh", names)).toBe("Ash");
  });

  it("still keeps the Latin word edge (controls)", () => {
    expect(nameInLine("Ashfordさんが鍵を持つ。", names)).toBeNull();
    expect(nameInLine("Ａｓｈｆｏｒｄ holds the keys.", names)).toBeNull();
    expect(nameInLine("钥匙由照料者保管。", names)).toBeNull();
  });
});

describe("a name in a script written without spaces", () => {
  const names = namesToProtect([
    { name: "王伟", email: "wang@example.test", role: "member", membershipGranted: true },
    { name: "สมชาย ใจดี", email: "somchai@example.test", role: "member", membershipGranted: true },
  ]);

  it("is found inside a run of text with no word edge around it", () => {
    expect(nameInLine("王伟负责钥匙。", names)).toBe("王伟");
    expect(nameInLine("ถามสมชายก่อน", names)).toBe("สมชาย");
  });

  it("is still not found where it is not written (controls)", () => {
    expect(nameInLine("钥匙由照料者保管。", names)).toBeNull();
    expect(nameInLine("ถามผู้ดูแลก่อน", names)).toBeNull();
    // A Latin name keeps its word edge beside them.
    expect(nameInLine("Ashford keeps the keys.", namesToProtect([{ name: "Ash", role: "admin" }]))).toBeNull();
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
