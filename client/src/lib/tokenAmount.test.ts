/**
 * THE FORMATTING RULE, pinned as numbers rather than as a description.
 *
 * The rule is one sentence: a whole amount renders whole, a fractional one
 * renders to its significant digits and no further. It is easy to agree with
 * and easy to spell three different ways, which is what happened. Before this
 * file existed the same rule was written out separately in ProfileSheet.tsx
 * and in PublicProfile.tsx, with different regexes, and a third surface (the
 * wallet) had no copy of it at all and printed the raw row.
 *
 * The headline case is first, because it is the one a member reported:
 * ten Village Voice is 10000 in the ledger and has to read as 10.
 */
import { describe, expect, it } from "vitest";
import { decimalsOf, formatTokenAmount, smallestUnit, toMinorUnits } from "./tokenAmount";

describe("formatTokenAmount", () => {
  it("shows ten Village Voice as ten, not ten thousand", () => {
    // decimals 3 is Village Voice's registry row today, and the only non-zero
    // one in the build.
    expect(formatTokenAmount(10_000, 3)).toBe("10");
    // The control, and the defect in one line: the same balance with no scale
    // is what every wallet surface printed.
    expect(formatTokenAmount(10_000, 0)).toBe("10000");
  });

  it("leaves a token with no decimals exactly as it was", () => {
    // Gratitude, stay credits and library credits all carry decimals 0, and
    // every surface that renders them has to be untouched by this change.
    expect(formatTokenAmount(25, 0)).toBe("25");
    expect(formatTokenAmount(0, 0)).toBe("0");
    expect(formatTokenAmount(-4, 0)).toBe("-4");
  });

  it("renders a whole amount whole and a fractional one to its digits", () => {
    // "10.000 Voice" and "10 Voice" are the same number and not the same
    // sentence. A trailing-zero tail reads like a price on a thing that is
    // not for sale.
    expect(formatTokenAmount(10_000, 3)).toBe("10");
    expect(formatTokenAmount(1_000, 3)).toBe("1");
    expect(formatTokenAmount(100, 3)).toBe("0.1");
    expect(formatTokenAmount(120, 3)).toBe("0.12");
    expect(formatTokenAmount(125, 3)).toBe("0.125");
    expect(formatTokenAmount(10_500, 3)).toBe("10.5");
    expect(formatTokenAmount(20_000, 3)).toBe("20");
    // A zero balance is a zero, never a bare "." or an empty chip.
    expect(formatTokenAmount(0, 3)).toBe("0");
  });

  it("never invents precision the ledger does not hold", () => {
    // The row is an INT, so the last digit is the smallest thing that exists.
    // Nothing here rounds a member's balance up or down.
    expect(formatTokenAmount(1, 3)).toBe("0.001");
    expect(formatTokenAmount(1_229, 3)).toBe("1.229");
    expect(formatTokenAmount(999_999, 3)).toBe("999.999");
  });

  it("holds at any scale a token could be given, ruled or not", () => {
    // Kept at 4 after the across-the-board ruling was cancelled on 2026-09-04
    // (docs/ECONOMICS.md section 11): the formatter is not allowed to have a
    // largest scale it works at, and a scale nothing carries is the case a
    // regression would reach first.
    expect(formatTokenAmount(100_000, 4)).toBe("10");
    expect(formatTokenAmount(100_000, 0)).toBe("100000");
    expect(formatTokenAmount(12_345, 4)).toBe("1.2345");
  });

  it("keeps a negative readable", () => {
    // A suspended account runs negative by design, and the minus belongs in
    // front of the whole number.
    expect(formatTokenAmount(-10_000, 3)).toBe("-10");
    expect(formatTokenAmount(-500, 3)).toBe("-0.5");
  });
});

describe("decimalsOf", () => {
  it("reads one token's scale out of a payload map", () => {
    expect(decimalsOf({ "village-voice": 3, gratitude: 0 }, "village-voice")).toBe(3);
    expect(decimalsOf({ "village-voice": 3, gratitude: 0 }, "gratitude")).toBe(0);
  });

  it("treats an absent or missing map as whole units, never as a guess", () => {
    // Every token carried 0 before Voice, and an unregistered slug honestly
    // means nobody has said otherwise. It must not infer a scale from a name.
    expect(decimalsOf(undefined, "village-voice")).toBe(0);
    expect(decimalsOf({}, "village-voice")).toBe(0);
    expect(decimalsOf(null, "anything")).toBe(0);
  });
});

/**
 * THE TWO HALVES OF THE CARD HAVE TO AGREE.
 *
 * A member sees a balance and types a number into a box beside it. If the
 * display divides and the box does not, the card lies to them in the most
 * expensive way available: quietly, about money, in a direction they will not
 * question.
 *
 * That is not hypothetical. The decimals sweep taught the send card to SHOW a
 * balance in human units and left its input posting MINOR units to an endpoint
 * that truncates and moves exactly that many. A member holding 10000 Village
 * Voice saw "You hold 10", typed 1, and moved 0.001. Before the sweep the card
 * said 10000 and the box took 10000: both raw, and agreeing, which is
 * survivable in a way that disagreeing is not.
 *
 * So these are round trips rather than assertions about either half alone.
 */
describe("what a member sees, typed straight back, is what the ledger held", () => {
  const cases: Array<[number, number]> = [
    [10000, 3], // 10 Village Voice, the only token with decimals today
    [10000, 4], // a scale no token carries, so the formatter cannot special-case
    [25, 0],    // Village Credits as they ship now
    [1229, 4],  // deliberately not a round number of minor units
    [1, 0],
    [500, 3],
    [0, 3],
  ];
  for (const [units, d] of cases) {
    it(`${units} at ${d}dp survives the round trip`, () => {
      expect(toMinorUnits(formatTokenAmount(units, d), d)).toBe(units);
    });
  }
});

/**
 * THE FIGURES THE OTHER SURFACES CARRY, put through the same round trip.
 *
 * A nightly rate, a product's token grant, a quest payout and a badge bonus
 * are all INT columns of minor units, and each now renders through
 * `formatTokenAmount` on its own page. None of them has an input beside it
 * that a member types into, so what the round trip proves here is narrower and
 * still worth pinning: the rendered string is the SAME NUMBER as the row, not
 * a rounded picture of it. A rate a member cannot type back exactly is a rate
 * they cannot check against the balance printed above it.
 *
 * Checked at 2 and at 3, the two scales the registry will actually carry:
 * Village Credits is ruled to 2 (docs/ECONOMICS.md section 11) and Village
 * Voice already sits at 3.
 */
describe("a rate, a grant and a payout survive being read", () => {
  const rows: Array<[string, number]> = [
    ["a nightly rate of three", 3000],
    ["a nightly rate the admin typed as 4500 minor units", 4500],
    ["a product granting ten", 10_000],
    ["a quest payout", 12_000],
    ["a badge bonus of two", 2_000],
    ["one minor unit, the smallest rate a room can post", 1],
  ];
  for (const [what, units] of rows) {
    it(`${what} reads back exactly, at 2dp and at 3dp`, () => {
      expect(toMinorUnits(formatTokenAmount(units, 2), 2)).toBe(units);
      expect(toMinorUnits(formatTokenAmount(units, 3), 3)).toBe(units);
    });
  }

  it("prints the numbers those surfaces actually show", () => {
    // Pinned as strings, because "3" and "3.000" are the same number and not
    // the same sentence, and a price tag on a night is the place that shows.
    expect(formatTokenAmount(3000, 3)).toBe("3");
    expect(formatTokenAmount(4500, 3)).toBe("4.5");
    expect(formatTokenAmount(10_000, 3)).toBe("10");
    expect(formatTokenAmount(1, 3)).toBe("0.001");
    // Village Credits at its ruled scale: the price a village could not post
    // before, which is the reason the ruling names two decimals at all.
    expect(formatTokenAmount(1250, 2)).toBe("12.5");
    expect(formatTokenAmount(1200, 2)).toBe("12");
  });

  it("leaves a token with no scale exactly as it always read", () => {
    // Six of the seven tokens sit at decimals 0 (drizzle/0126). Every surface
    // in this sweep divides unconditionally, so this is the assertion that
    // nothing visibly moved on the day the dividing shipped.
    for (const units of [0, 1, 3, 25, 4500, 10_000]) {
      expect(formatTokenAmount(units, 0)).toBe(String(units));
    }
  });
});

describe("the send card's actual bug", () => {
  it("typing the whole balance back moves the whole balance", () => {
    expect(toMinorUnits(formatTokenAmount(10000, 3), 3)).toBe(10000);
  });

  it("typing 1 moves one whole token, not one minor unit", () => {
    expect(toMinorUnits("1", 3)).toBe(1000);
    expect(toMinorUnits("1", 0)).toBe(1);
  });

  it("refuses to invent a number from something that is not one", () => {
    expect(Number.isNaN(toMinorUnits("", 3))).toBe(true);
    expect(Number.isNaN(toMinorUnits("abc", 3))).toBe(true);
  });
});

describe("smallestUnit", () => {
  // DO NOT LOOSEN THIS TO toBeCloseTo. These three are exact-equality
  // assertions on purpose. `smallestUnit` once raised ten to a negative power,
  // which V8 25 evaluates to 0.0001 and V8 22 evaluates to
  // 0.00009999999999999999, so this test passed on every dev box here and
  // failed only on CI, which pins Node 22. A tolerance would have made that
  // red go away and left a wallet step no member could land on.
  it("gives an input a step a member can actually reach", () => {
    expect(smallestUnit(0)).toBe(1);
    expect(smallestUnit(3)).toBe(0.001);
    expect(smallestUnit(4)).toBe(0.0001);
  });
});
