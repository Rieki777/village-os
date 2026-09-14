/**
 * The quest consent dials, as a table.
 *
 * Every case is a combination somebody could actually set: a cap mode, a ceiling
 * multiplier, the zero dial, a quest label and a standing badge. The rulings the
 * rows hold are in the header of `server/lib/questConsent.ts`. No database: what
 * is under test is arithmetic and a decision, and the route that feeds it real
 * rows is driven end to end in `server/routes/questConsentPayout.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { parseRewardRange } from "../../shared/questRewards";
import { checkConsentAmount, consentCapMode, payoutFor, type ConsentAmountInput } from "./questConsent";

const input = (over: Partial<Omit<ConsentAmountInput, "range">> & { label?: string } = {}): ConsentAmountInput => {
  const { label = "50-100", ...rest } = over;
  return { requested: 60, range: parseRewardRange(label), capMode: "posted", capMultiplier: 2, allowZero: false, ...rest };
};

const granted = (over: Parameters<typeof input>[0]) => {
  const v = checkConsentAmount(input(over));
  return v.ok ? v.granted : `refused ${v.status}`;
};

describe("the floor holds in both capping modes (ruling 7)", () => {
  it("posted refuses below the floor and above the top", () => {
    expect(granted({ requested: 49 })).toBe("refused 409");
    expect(granted({ requested: 50 })).toBe(50);
    expect(granted({ requested: 100 })).toBe(100);
    expect(granted({ requested: 101 })).toBe("refused 409");
  });

  it("capped refuses below the floor, which it used to accept", () => {
    const low = checkConsentAmount(input({ capMode: "capped", requested: 49 }));
    expect(low.ok).toBe(false);
    if (!low.ok) {
      expect(low.status).toBe(409);
      expect(low.body.error).toContain("below what this quest advertises (50 to 100)");
      expect(low.body).toMatchObject({ min: 50, ceiling: 200 });
    }
    expect(granted({ capMode: "capped", requested: 1, label: "200" })).toBe("refused 409");
  });

  it("capped still allows a bonus up to its ceiling, and no further", () => {
    expect(granted({ capMode: "capped", requested: 150 })).toBe(150);
    expect(granted({ capMode: "capped", requested: 200 })).toBe(200);
    expect(granted({ capMode: "capped", requested: 201 })).toBe("refused 409");
  });

  it("a ceiling multiplier that is not a number, or below 1, fails closed to the top of the range", () => {
    for (const capMultiplier of [Number.NaN, 0.5, 0]) {
      expect(granted({ capMode: "capped", capMultiplier, requested: 101 })).toBe("refused 409");
      expect(granted({ capMode: "capped", capMultiplier, requested: 100 })).toBe(100);
    }
  });

  it("unlimited compares nothing, and is the only mode that accepts an unreadable label", () => {
    expect(granted({ capMode: "unlimited", requested: 1 })).toBe(1);
    expect(granted({ capMode: "unlimited", requested: 10_000 })).toBe(10_000);
    expect(granted({ capMode: "unlimited", requested: 5, label: "a few hearts" })).toBe(5);
    expect(granted({ capMode: "posted", requested: 5, label: "a few hearts" })).toBe("refused 409");
    expect(granted({ capMode: "capped", requested: 5, label: "a few hearts" })).toBe("refused 409");
  });

  it("an unrecognised cap mode is read as posted, so the cap fails closed", () => {
    expect(consentCapMode("posted")).toBe("posted");
    expect(consentCapMode("capped")).toBe("capped");
    expect(consentCapMode("unlimited")).toBe("unlimited");
    expect(consentCapMode("Unlimited")).toBe("posted");
    expect(consentCapMode(undefined)).toBe("posted");
    expect(granted({ capMode: "no-cap-please", requested: 101 })).toBe("refused 409");
  });
});

describe("zero is an acknowledgement, with two doors (ruling 6)", () => {
  it("dial off: zero is refused on a quest with a floor above zero", () => {
    const v = checkConsentAmount(input({ requested: 0 }));
    expect(v).toMatchObject({ ok: false, status: 400 });
  });

  it("dial off: a quest that advertises 0 can be consented at 0, which it could not be before", () => {
    expect(granted({ requested: 0, label: "0" })).toBe(0);
    expect(granted({ requested: 0, label: "0-50" })).toBe(0);
    // And the board still binds everything above zero.
    expect(granted({ requested: 1, label: "0" })).toBe("refused 409");
  });

  it("dial on: zero is allowed on any quest, in every mode", () => {
    for (const capMode of ["posted", "capped", "unlimited"]) {
      const v = checkConsentAmount(input({ requested: 0, allowZero: true, capMode }));
      expect(v.ok, capMode).toBe(true);
      if (v.ok) expect(v.granted).toBe(0);
    }
  });

  it("dial on still refuses an amount above zero that sits outside the range", () => {
    expect(granted({ requested: 10, allowZero: true })).toBe("refused 409");
  });

  it("dial off under unlimited: zero needs the quest to advertise it", () => {
    expect(granted({ capMode: "unlimited", requested: 0 })).toBe("refused 400");
    expect(granted({ capMode: "unlimited", requested: 0, label: "0" })).toBe(0);
  });

  it("an unreadable label is refused under a cap even for a zero the dial allows", () => {
    expect(granted({ requested: 0, allowZero: true, label: "tbd" })).toBe("refused 409");
    expect(granted({ requested: 0, allowZero: true, label: "tbd", capMode: "unlimited" })).toBe(0);
  });
});

describe("a badge lifts a consent toward the cap, never past it (ruling 8)", () => {
  const cap = (over: Parameters<typeof input>[0]) => {
    const v = checkConsentAmount(input(over));
    if (!v.ok) throw new Error(`expected a grant, got ${v.status}`);
    return v;
  };

  it("posted: the lift stops at the top of the advertised range", () => {
    const v = cap({ requested: 60 });
    expect(v.cap).toBe(100);
    expect(payoutFor({ granted: 60, multiplier: 1.5, cap: v.cap })).toBe(90);
    // The case that used to post 120 on a quest advertising 50 to 100.
    expect(payoutFor({ granted: 60, multiplier: 2, cap: v.cap })).toBe(100);
    expect(payoutFor({ granted: 100, multiplier: 3, cap: v.cap })).toBe(100);
  });

  it("capped: the lift stops at the bonus ceiling", () => {
    const v = cap({ capMode: "capped", requested: 150 });
    expect(v.cap).toBe(200);
    expect(payoutFor({ granted: 150, multiplier: 2, cap: v.cap })).toBe(200);
    expect(payoutFor({ granted: 90, multiplier: 2, cap: v.cap })).toBe(180);
  });

  it("unlimited has no cap, so the lift is the multiplier alone", () => {
    const v = cap({ capMode: "unlimited", requested: 60 });
    expect(v.cap).toBeNull();
    expect(payoutFor({ granted: 60, multiplier: 2, cap: v.cap })).toBe(120);
  });

  it("no badge, or a multiplier below 1, pays exactly the grant", () => {
    expect(payoutFor({ granted: 60, multiplier: 1, cap: 100 })).toBe(60);
    expect(payoutFor({ granted: 60, multiplier: 0.5, cap: 100 })).toBe(60);
    expect(payoutFor({ granted: 60, multiplier: Number.NaN, cap: 100 })).toBe(60);
  });

  it("whole tokens: a fractional lift rounds down", () => {
    expect(payoutFor({ granted: 51, multiplier: 1.5, cap: 100 })).toBe(76);
  });

  it("a zero grant pays zero whatever the badge", () => {
    expect(payoutFor({ granted: 0, multiplier: 3, cap: 100 })).toBe(0);
  });
});
