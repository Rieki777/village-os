/**
 * The room's own read of a proposal (shared/sessionCheck.ts): which season
 * priorities its words name, which roles it names, and the stored read read
 * back tolerantly. Pure, no pool.
 */
import { describe, expect, it } from "vitest";
import {
  CHECK_COPY,
  CHECK_LIMITS,
  goalNamed,
  instantRead,
  readCheckRead,
  seatsNamed,
  type CheckRead,
} from "./sessionCheck";

const SEATS = [
  { id: "s-tre", name: "Treasurer" },
  { id: "s-wat", name: "Water Steward" },
  { id: "s-kit", name: "Kitchen" },
  { id: "s-op", name: "Op" },
];

describe("a season priority the words name", () => {
  it("names a priority written into the proposal word for word, whatever the case and punctuation", () => {
    expect(goalNamed("We fix the water system, before the rains come.", "Fix the water system")).toBe(true);
    expect(goalNamed("FIX THE WATER SYSTEM now", "fix the water system")).toBe(true);
  });

  it("names a priority whose every meaningful word is there, in any order, a plural folded", () => {
    expect(goalNamed("Before the rains we finish the water systems", "Finish the water system before the rains")).toBe(true);
  });

  it("does NOT name a priority when only some of its meaningful words appear", () => {
    expect(goalNamed("We buy a water tank", "Finish the water system before the rains")).toBe(false);
  });

  it("never names a priority inside a longer word", () => {
    expect(goalNamed("The gardening rota moves to Monday", "Garden")).toBe(false);
    expect(goalNamed("The garden rota moves to Monday", "Garden")).toBe(true);
  });

  it("names nothing for an empty priority", () => {
    expect(goalNamed("anything at all", "  ")).toBe(false);
  });

  it("reads text the way it is typed in other scripts and forms", () => {
    // No spaces between words: matched as written.
    expect(goalNamed("我们要修好水系统", "水系统")).toBe(true);
    expect(goalNamed("我们要修好路", "水系统")).toBe(false);
    // An accent typed as a separate mark is the same letter.
    expect(goalNamed("Open the café by spring", "Open the café")).toBe(true);
    // Fullwidth punctuation and an emoji are not part of a word.
    expect(goalNamed("修水，建房", "建房")).toBe(true);
    expect(goalNamed("Fix the water system💧 now", "Fix the water system")).toBe(true);
    // A dotted capital lowercases with a mark that is dropped.
    expect(goalNamed("ISTANBUL first, then İSTANBUL", "istanbul")).toBe(true);
  });
});

describe("the roles the words name", () => {
  it("names a role written whole, in the order the words name them", () => {
    const named = seatsNamed("The Kitchen asks the Treasurer for a budget", SEATS, null);
    expect(named.map((s) => s.id)).toEqual(["s-kit", "s-tre"]);
  });

  it("names a role of several words only when all of them are there together", () => {
    expect(seatsNamed("The water steward checks the pipes", SEATS, null).map((s) => s.id)).toEqual(["s-wat"]);
    expect(seatsNamed("Water the garden, steward the land", SEATS, null)).toEqual([]);
  });

  it("never matches a role inside another word, and skips a name too short to mean one role", () => {
    expect(seatsNamed("The Treasury meets", SEATS, null)).toEqual([]);
    expect(seatsNamed("Op the shop up", SEATS, null)).toEqual([]);
  });

  it("reads a plural as the role, \"the Treasurers\" naming the Treasurer", () => {
    expect(seatsNamed("The Treasurers meet", SEATS, null).map((s) => s.id)).toEqual(["s-tre"]);
  });

  it("counts a one-word role only where the words write it with a capital, so an everyday word names nobody", () => {
    const seats = [{ id: "s-host", name: "Host" }, { id: "s-lead", name: "Lead" }, { id: "s-cook", name: "Head Cook" }];
    expect(seatsNamed("We will host the dinner and lead the walk", seats, null)).toEqual([]);
    expect(seatsNamed("The Host welcomes them and the Lead walks ahead", seats, null).map((s) => s.id)).toEqual(["s-host", "s-lead"]);
    // A role of several words is its name whatever the case.
    expect(seatsNamed("ask the head cook", seats, null).map((s) => s.id)).toEqual(["s-cook"]);
  });

  it("puts the role the proposal sits with first, named or not, once", () => {
    const named = seatsNamed("The Treasurer pays", SEATS, "s-kit");
    expect(named.map((s) => s.id)).toEqual(["s-kit", "s-tre"]);
    expect(seatsNamed("The Kitchen cooks", SEATS, "s-kit").map((s) => s.id)).toEqual(["s-kit"]);
  });

  it(`names at most ${CHECK_LIMITS.roles} roles`, () => {
    const many = Array.from({ length: CHECK_LIMITS.roles + 3 }, (_, i) => ({ id: `s-${i}`, name: `Role${i}x` }));
    const text = many.map((s) => s.name).join(" and ");
    expect(seatsNamed(text, many, null)).toHaveLength(CHECK_LIMITS.roles);
  });
});

describe("the instant read", () => {
  const base = {
    text: "The Treasurer releases the budget to fix the water system",
    season: { name: "Rains", goals: ["Fix the water system", "Open the guest house"] },
    seats: SEATS,
    ownerSeatId: null,
    holderOf: (id: string) => (id === "s-tre" ? ("here" as const) : ("away" as const)),
    purpose: { statement: "We serve the valley", writtenAt: "2026-09-23T10:00:00.000Z" },
  };

  it("lists every season priority, marking the ones the words name", () => {
    const read = instantRead(base);
    expect(read.season).toBe("Rains");
    expect(read.priorities).toEqual([
      { text: "Fix the water system", named: true },
      { text: "Open the guest house", named: false },
    ]);
  });

  it("names each role with where its holder was when the check ran, and no person", () => {
    const read = instantRead(base);
    expect(read.roles).toEqual([{ seatId: "s-tre", name: "Treasurer", holder: "here" }]);
    expect(JSON.stringify(read)).not.toMatch(/userId|member_no|"no"/);
  });

  it("keeps when the purpose was written, and says when there is none", () => {
    expect(instantRead(base).purposeWrittenAt).toBe("2026-09-23T10:00:00.000Z");
    expect(instantRead(base).hasPurpose).toBe(true);
    const none = instantRead({ ...base, purpose: { statement: "  ", writtenAt: "" } });
    expect(none.hasPurpose).toBe(false);
  });

  it("reads with no season running", () => {
    const read = instantRead({ ...base, season: null });
    expect(read.season).toBeNull();
    expect(read.priorities).toEqual([]);
  });
});

describe("a stored read, read back", () => {
  const good: CheckRead = {
    season: "Rains",
    priorities: [{ text: "Fix the water system", named: true }],
    roles: [{ seatId: "s-tre", name: "Treasurer", holder: "open" }],
    hasPurpose: true,
    purposeWrittenAt: "2026-09-23T10:00:00.000Z",
  };

  it("reads back what was written", () => {
    expect(readCheckRead(JSON.stringify(good))).toEqual(good);
  });

  it("drops what it cannot read, and never throws", () => {
    expect(readCheckRead("not json")).toBeNull();
    expect(readCheckRead(null)).toBeNull();
    const odd = readCheckRead(JSON.stringify({ ...good, roles: [{ seatId: 1 }, { seatId: "s-x", name: "X", holder: "elsewhere" }] }));
    expect(odd?.roles).toEqual([]);
  });
});

describe("the words", () => {
  it("names the agent the village's module names", () => {
    expect(CHECK_COPY.button("Sera")).toBe("Check Sera");
    expect(CHECK_COPY.agentLine("Ana")).toContain("Ana");
  });

  it("names a holder's place for every state the read can hold", () => {
    for (const h of ["here", "away", "open"] as const) expect(CHECK_COPY.holder[h]).toBeTruthy();
  });
});
