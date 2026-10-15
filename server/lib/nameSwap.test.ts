/**
 * The name swap, held to the promise the founder made the vendor on
 * 2026-10-13: every member name the village knows, swapped for that member's
 * code-name, whole words, case-insensitive, possessives handled.
 *
 * Pure, so every case is a string in and a string out. Each case names the
 * way a swap goes wrong in practice: a name inside a longer word, the shorter
 * of two overlapping names winning, an accent or a capital letting a name
 * through, a possessive losing its "'s", and a shared first name pinned on
 * the wrong person.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_NAME_CHARS,
  SHARED_NAME_STAND_IN,
  mentionedMembers,
  namesOf,
  swapNames,
  type NamedMember,
} from "./nameSwap";

const JESS: NamedMember = { id: "u-jess", names: namesOf({ name: "Jess Mora", handle: "jessm", email: "jess.mora@example.org" }) };
const ANN: NamedMember = { id: "u-ann", names: namesOf({ name: "Ann Pell" }) };
const ANNA: NamedMember = { id: "u-anna", names: namesOf({ name: "Anna Quist" }) };
const JOSE: NamedMember = { id: "u-jose", names: namesOf({ name: "José Úbeda" }) };
const ED: NamedMember = { id: "u-ed", names: namesOf({ name: "Ed" }) };
const DARCY: NamedMember = { id: "u-darcy", names: namesOf({ name: "D'Arcy Fenn" }) };
const ROSTER = [JESS, ANN, ANNA, JOSE, ED, DARCY];

const CODES = new Map([
  ["u-jess", "brisk-otter-41"],
  ["u-ann", "calm-heron-12"],
  ["u-anna", "tidy-marmot-77"],
  ["u-jose", "mossy-lynx-30"],
  ["u-ed", "spry-tapir-58"],
  ["u-darcy", "lunar-egret-63"],
]);

const swap = (text: string, roster: readonly NamedMember[] = ROSTER, codes = CODES) => swapNames(text, roster, codes);

describe("the names a member record holds", () => {
  it("reads the display name whole, its first and last word, the handle both ways and the email", () => {
    expect(namesOf({ name: "  Jess   Mora ", handle: "@jessm", email: "jess.mora@example.org" })).toEqual([
      "Jess Mora",
      "Jess",
      "Mora",
      "jessm",
      "@jessm",
      "jess.mora@example.org",
    ]);
  });

  it("reads a one-word name once, and skips fields that are absent or not text", () => {
    expect(namesOf({ name: "Ed", handle: null, email: 7 })).toEqual(["Ed"]);
  });
});

describe("whole words, case-insensitive", () => {
  it("swaps a first name, a full name and a handle, whatever their case", () => {
    expect(swap("I spoke with Jess today.")).toBe("I spoke with brisk-otter-41 today.");
    expect(swap("JESS MORA said no, then jess said yes")).toBe("brisk-otter-41 said no, then brisk-otter-41 said yes");
    expect(swap("ping @jessm or jessm")).toBe("ping brisk-otter-41 or brisk-otter-41");
  });

  it("swaps a surname on its own", () => {
    expect(swap("Mora took the bench.")).toBe("brisk-otter-41 took the bench.");
  });

  it("swaps an email address whole, before any part of it could be read as a name", () => {
    expect(swap("write to jess.mora@example.org.")).toBe("write to brisk-otter-41.");
  });

  it("NEVER SWAPS A NAME INSIDE ANOTHER WORD", () => {
    expect(swap("The Annual plan was planned by nobody.")).toBe("The Annual plan was planned by nobody.");
    expect(swap("We used the shed, and Edward helped.")).toBe("We used the shed, and Edward helped.");
    expect(swap("Jessamine flowers, Moravia, jessm2")).toBe("Jessamine flowers, Moravia, jessm2");
    expect(swap("jess_mora is not a handle here")).toBe("jess_mora is not a handle here");
  });
});

describe("possessives and punctuation", () => {
  it("keeps the possessive on the code-name, with either apostrophe", () => {
    expect(swap("Jess's idea")).toBe("brisk-otter-41's idea");
    expect(swap("Jess’s idea")).toBe("brisk-otter-41’s idea");
    expect(swap("the Peterses and Ann's plan")).toBe("the Peterses and calm-heron-12's plan");
  });

  it("swaps a name against every kind of punctuation", () => {
    expect(swap('"Jess," (Ann), [Anna]; Ed! José? Jess-like.')).toBe(
      '"brisk-otter-41," (calm-heron-12), [tidy-marmot-77]; spry-tapir-58! mossy-lynx-30? brisk-otter-41-like.',
    );
  });

  it("matches a name with an apostrophe of its own, escaped rather than read as a pattern", () => {
    expect(swap("I asked D'Arcy, then d'arcy's sister.")).toBe("I asked lunar-egret-63, then lunar-egret-63's sister.");
  });
});

describe("overlapping names", () => {
  it("TRIES THE LONGER NAME FIRST, so Anna is never swapped as Ann plus an a", () => {
    expect(swap("Anna and Ann")).toBe("tidy-marmot-77 and calm-heron-12");
    expect(swap("Ann and Anna")).toBe("calm-heron-12 and tidy-marmot-77");
  });

  it("prefers the full name to the first name it starts with", () => {
    expect(swap("Jess Mora came")).toBe("brisk-otter-41 came");
  });

  it("reads a full name across a line break", () => {
    expect(swap("I thanked Jess\nMora twice")).toBe("I thanked brisk-otter-41 twice");
  });

  it("NEVER READS A CODE-NAME TWICE, even when its words are somebody's name", () => {
    const otter: NamedMember = { id: "u-otter", names: ["Otter"] };
    const codes = new Map([...CODES, ["u-otter", "calm-heron-99"]]);
    expect(swapNames("Jess and Otter", [JESS, otter], codes)).toBe("brisk-otter-41 and calm-heron-99");
  });
});

describe("accents and other scripts", () => {
  it("SWAPS A NAME WRITTEN WITH OR WITHOUT ITS ACCENT, in any case", () => {
    expect(swap("José came")).toBe("mossy-lynx-30 came");
    expect(swap("JOSÉ and jose and Jose")).toBe("mossy-lynx-30 and mossy-lynx-30 and mossy-lynx-30");
    expect(swap("Úbeda and Ubeda")).toBe("mossy-lynx-30 and mossy-lynx-30");
  });

  it("swaps a decomposed accent with the name it sits on, leaving no stray mark", () => {
    const decomposed = "José came";
    expect(swap(decomposed)).toBe("mossy-lynx-30 came");
  });

  it("treats an accented letter as a letter, so a name inside an accented word stays", () => {
    expect(swap("Annéa and Edé")).toBe("Annéa and Edé");
  });

  it("matches a name in a script written without spaces", () => {
    const yamada: NamedMember = { id: "u-ya", names: ["山田"] };
    expect(swapNames("今日山田さんと話した", [yamada], new Map([["u-ya", "calm-heron-12"]]))).toBe(
      "今日calm-heron-12さんと話した",
    );
  });
});

describe("names the swap cannot pin on one person", () => {
  it("TURNS A NAME TWO MEMBERS SHARE INTO 'a member', and still swaps each full name", () => {
    const jessB: NamedMember = { id: "u-jess-b", names: namesOf({ name: "Jess Brand" }) };
    const codes = new Map([...CODES, ["u-jess-b", "polar-ibis-20"]]);
    expect(swapNames("Jess said Jess Mora and Jess Brand agree", [JESS, jessB], codes)).toBe(
      `${SHARED_NAME_STAND_IN} said brisk-otter-41 and polar-ibis-20 agree`,
    );
    expect([...mentionedMembers(["Jess said hi"], [JESS, jessB])]).toEqual([]);
  });

  it("FAILS CLOSED: a member with no code-name in hand becomes the stand-in, never their name", () => {
    expect(swapNames("Jess came", [JESS], new Map())).toBe(`${SHARED_NAME_STAND_IN} came`);
  });

  it(`ignores a name shorter than ${MIN_NAME_CHARS} characters`, () => {
    const a: NamedMember = { id: "u-a", names: ["A"] };
    expect(swapNames("A day at a time", [a], new Map([["u-a", "calm-heron-12"]]))).toBe("A day at a time");
  });

  it("leaves text alone with an empty roster or empty text", () => {
    expect(swapNames("Jess came", [], CODES)).toBe("Jess came");
    expect(swap("")).toBe("");
  });
});

describe("who is mentioned", () => {
  it("names exactly the members whose names appear, across several texts", () => {
    const found = mentionedMembers(["Jess's plan", "with Anna", "nobody else"], ROSTER);
    expect([...found].sort()).toEqual(["u-anna", "u-jess"]);
  });

  it("does not count a name found only inside another word", () => {
    expect([...mentionedMembers(["Annual planning"], ROSTER)]).toEqual([]);
  });
});
