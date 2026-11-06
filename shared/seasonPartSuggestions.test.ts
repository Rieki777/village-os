/**
 * Your part, started from your seats (shared/seasonPartSuggestions.ts).
 *
 * Pinned: quests take the largest fewest and the largest most across seats and
 * are never summed; adopted terms beat applied terms beat an offer; with no
 * quests anywhere the platform preset is the starting point; an accountability
 * is phrased plainly as a measure; the same measure is offered once; the list
 * is capped; and nothing that ranks people or carries payment details is
 * ever suggested, nor any money group read.
 */
import { describe, expect, it } from "vitest";
import { presetById } from "./seatPresets";
import {
  DEFAULT_QUESTS_PRESET,
  measureFromAccountability,
  partSuggestions,
  questHint,
  suggestMeasures,
  suggestQuests,
  SUGGESTIONS_MAX,
  type SuggestionSeat,
} from "./seasonPartSuggestions";

const seat = (over: Partial<SuggestionSeat> & { seatId: string }): SuggestionSeat => ({
  name: over.seatId,
  accountabilities: [],
  terms: [],
  ...over,
});
const quests = (perMoonMin?: number, perMoonMax?: number) => ({ v: 1, quests: { perMoonMin, perMoonMax, doneWhenRequired: true } });
const board = (...measures: Array<{ measure: string; target?: string; readFrom?: string }>) => ({ v: 1, scoreboard: { measures } });

describe("quests a moon from the member's seats", () => {
  it("takes the largest fewest and the largest most across seats, never the sum", () => {
    const q = suggestQuests([
      seat({ seatId: "fe", name: "Front-End", terms: [{ rank: "adopted", settings: quests(3, 5) }] }),
      seat({ seatId: "k", name: "Kitchen", terms: [{ rank: "offer", settings: quests(2, 7) }] }),
    ]);
    expect(q).toMatchObject({ min: 3, max: 7, from: "terms" });
    expect(q.source.map((s) => s.seat)).toEqual(["Front-End", "Kitchen"]);
    expect(questHint(q)).toBe("From your roles' terms: Front-End 3 to 5, Kitchen 2 to 7");
  });

  it("one seat's hint reads as the brief says", () => {
    const q = suggestQuests([seat({ seatId: "fe", name: "Front-End", terms: [{ rank: "adopted", settings: quests(3, 5) }] })]);
    expect(questHint(q)).toBe("From your roles' terms: Front-End 3 to 5");
  });

  it("adopted terms beat applied terms, which beat the seat's offer", () => {
    const one = (terms: SuggestionSeat["terms"]) => suggestQuests([seat({ seatId: "s", terms })]);
    expect(one([{ rank: "offer", settings: quests(1, 2) }, { rank: "adopted", settings: quests(4, 6) }, { rank: "applied", settings: quests(8, 9) }])).toMatchObject({ min: 4, max: 6 });
    expect(one([{ rank: "offer", settings: quests(1, 2) }, { rank: "applied", settings: quests(8, 9) }])).toMatchObject({ min: 8, max: 9 });
    // Adopted terms with no quests group leave the seat to the next set that has one.
    expect(one([{ rank: "adopted", settings: { v: 1 } }, { rank: "offer", settings: quests(1, 2) }])).toMatchObject({ min: 1, max: 2 });
  });

  it("raises a most below the fewest to the fewest", () => {
    const q = suggestQuests([
      seat({ seatId: "a", terms: [{ rank: "adopted", settings: quests(5) }] }),
      seat({ seatId: "b", terms: [{ rank: "adopted", settings: quests(undefined, 3) }] }),
    ]);
    expect(q).toMatchObject({ min: 5, max: 5 });
    expect(questHint(q)).toBe("From your roles' terms: a at least 5, b up to 3");
  });

  it("with no quests group anywhere, starts from the platform preset and says so", () => {
    const preset = presetById(DEFAULT_QUESTS_PRESET)!.values as { perMoonMin: number; perMoonMax: number };
    for (const seats of [[], [seat({ seatId: "a", terms: [{ rank: "offer", settings: board({ measure: "Beds weeded" }) }] })]]) {
      const q = suggestQuests(seats);
      expect(q).toEqual({ min: preset.perMoonMin, max: preset.perMoonMax, from: "default", source: [] });
      expect(questHint(q)).toBe("A starting point. Change it if your roles ask for more.");
    }
    expect(preset).toMatchObject({ perMoonMin: 3, perMoonMax: 5 });
  });

  it("reads quests from terms whose money group is unreadable, and from stored JSON text", () => {
    const broken = { v: 1, pay: { kind: "nonsense" }, quests: { perMoonMin: 2, perMoonMax: 4 } };
    expect(suggestQuests([seat({ seatId: "a", terms: [{ rank: "adopted", settings: broken }] })])).toMatchObject({ min: 2, max: 4 });
    expect(suggestQuests([seat({ seatId: "a", terms: [{ rank: "adopted", settings: JSON.stringify(quests(1, 3)) }] })])).toMatchObject({ min: 1, max: 3 });
    // Out of bounds is refused by the reader and the seat stays silent.
    expect(suggestQuests([seat({ seatId: "a", terms: [{ rank: "adopted", settings: quests(40, 50) }] })]).from).toBe("default");
  });
});

describe("an accountability phrased as a measure", () => {
  it.each([
    ["The org chart, role proposals and Game mechanics showing accurately for members", "Org chart and role proposals show accurately"],
    ["The quest board showing accurately.", "Quest board shows accurately"],
    ["Testing the spring monthly", "Testing the spring monthly"],
    ["Calling a repair before a failure", "Calling a repair before a failure"],
    ["The kitchen", "Kitchen in good order"],
    ["The spring, the catchment, the water tests", "Spring and catchment in good order"],
    ["the kitchen & the pantry", "Kitchen and pantry in good order"],
    ["Members are paid on time", "Members are paid on time"],
    ["The building and grounds", "Building and grounds in good order"],
  ])("%s", (from, to) => {
    expect(measureFromAccountability(from)).toBe(to);
  });

  it("gives no measure for a line about time given, an empty line, words that rank people or payment details", () => {
    expect(measureFromAccountability("Contribution: 4 hours a week")).toBeNull();
    expect(measureFromAccountability("   ")).toBeNull();
    expect(measureFromAccountability("A leaderboard of the best member each moon")).toBeNull();
    expect(measureFromAccountability("Paying into GB82WEST12345698765432")).toBeNull();
  });

  it("keeps a measure inside the scoreboard's length", () => {
    const long = `Keeping ${"the long list of village records ".repeat(8)}`;
    const m = measureFromAccountability(long)!;
    expect(m.length).toBeLessThanOrEqual(120);
    expect(m.endsWith(" ")).toBe(false);
  });
});

describe("measures from the member's roles", () => {
  const seats: SuggestionSeat[] = [
    seat({
      seatId: "fe",
      name: "Front-End",
      accountabilities: ["The org chart, role proposals and Game mechanics showing accurately for members", "Handoffs written"],
      terms: [
        { rank: "offer", settings: board({ measure: "Pages shipped", target: "two a moon" }) },
        { rank: "adopted", settings: board({ measure: "Bugs closed", target: "every reported bug by the moon's end", readFrom: "the issue list" }) },
      ],
    }),
    seat({
      seatId: "k",
      name: "Kitchen",
      accountabilities: ["The kitchen", "Contribution: two mornings a week"],
      terms: [{ rank: "applied", settings: { ...board({ measure: "Handoffs written", target: "one each moon" }), pay: { kind: "fixed", currency: "XTS", amountMinor: 4321000, per: "month" } } }],
    }),
  ];

  it("offers terms first (adopted, applied, offer), then one per accountability, with targets only from terms", () => {
    expect(suggestMeasures(seats)).toEqual([
      { seatId: "fe", seat: "Front-End", from: "terms", measure: "Bugs closed", target: "every reported bug by the moon's end" },
      { seatId: "k", seat: "Kitchen", from: "terms", measure: "Handoffs written", target: "one each moon" },
      { seatId: "fe", seat: "Front-End", from: "terms", measure: "Pages shipped", target: "two a moon" },
      { seatId: "fe", seat: "Front-End", from: "accountability", measure: "Org chart and role proposals show accurately" },
      // "Handoffs written" is already offered from the Kitchen's terms: once only.
      { seatId: "k", seat: "Kitchen", from: "accountability", measure: "Kitchen in good order" },
    ]);
  });

  it("never carries a money key or figure, though the terms behind it do", () => {
    const text = JSON.stringify(partSuggestions(seats));
    for (const leak of ["pay", "amountMinor", "currency", "XTS", "4321000", "readFrom"]) expect(text).not.toContain(`"${leak}"`);
    expect(text).not.toContain("4321000");
  });

  it("drops a terms measure that ranks people", () => {
    const out = suggestMeasures([seat({ seatId: "a", terms: [{ rank: "offer", settings: { v: 1, scoreboard: { measures: [{ measure: "Holder ranking" }, { measure: "Quests done" }] } } }] })]);
    expect(out.map((m) => m.measure)).toEqual([]);
    // The whole group is refused by the reader, so a seat with one ranking measure offers none of that group.
    const clean = suggestMeasures([seat({ seatId: "a", terms: [{ rank: "offer", settings: board({ measure: "Quests done" }) }] })]);
    expect(clean.map((m) => m.measure)).toEqual(["Quests done"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Record number ${String.fromCharCode(97 + (i % 26))}${i} kept`);
    expect(suggestMeasures([seat({ seatId: "a", accountabilities: many })]).length).toBe(SUGGESTIONS_MAX);
  });

  it("a member with no seats gets no measures and the default quests", () => {
    expect(partSuggestions([])).toEqual({ quests: { min: 3, max: 5, from: "default", source: [] }, measures: [] });
  });
});
