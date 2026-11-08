/**
 * Voice from value, from donations and from investment: the arithmetic.
 *
 * The worked examples are Rye's answer of 2026-11-08 (spec voice-from-money §3,
 * relayed by the master coordinator), at the scale Rye chose of 1 Voice per 1,000
 * colones, which is a `voicePerUnit` of 0.001.
 */
import { describe, expect, it } from "vitest";
import {
  DONATION_RATE_PCT_DEFAULT,
  DONATION_VOICE_SOURCE,
  INVESTMENT_RATE_PCT_DEFAULT,
  INVESTMENT_VOICE_SOURCE,
  MONEY_VOICE_SOURCES,
  WORK_VOICE_SOURCES,
  floorVoice,
  moneyInIssue,
  voiceForUnits,
  voiceSourceKind,
  workShare,
  workVoiceFromPaid,
} from "./voiceFromMoney";

const PER_THOUSAND = 0.001;
const rates = { donationPct: DONATION_RATE_PCT_DEFAULT, investmentPct: INVESTMENT_RATE_PCT_DEFAULT };

describe("the worked examples at 1 Voice per 1,000 colones", () => {
  it("a donation of 10,000 earns 10 Voice and no equity", () => {
    expect(moneyInIssue("donation", 10_000, PER_THOUSAND, rates)).toEqual({ voice: 10, equity: 0 });
  });

  it("an investment of 10,000 buys 10,000 of equity and earns 1 Voice, a tenth of a donation", () => {
    expect(moneyInIssue("investment", 10_000, PER_THOUSAND, rates)).toEqual({ voice: 1, equity: 10_000 });
  });

  it("a quest paying 42,000 in total earns 42 Voice, and 22 while its Earned Equity is owed", () => {
    expect(workVoiceFromPaid(42_000, PER_THOUSAND)).toBe(42);
    expect(workVoiceFromPaid(22_000, PER_THOUSAND)).toBe(22);
  });

  it("floors at Voice's two decimals: 1,505 earns 1.50 and 9 earns nothing", () => {
    expect(moneyInIssue("donation", 1_505, PER_THOUSAND, rates).voice).toBe(1.5);
    expect(moneyInIssue("donation", 9, PER_THOUSAND, rates).voice).toBe(0);
    expect(moneyInIssue("donation", 10, PER_THOUSAND, rates).voice).toBe(0.01);
  });

  it("an investment of 2,500,000 earns 250 Voice beside 2,500,000 of equity", () => {
    expect(moneyInIssue("investment", 2_500_000, PER_THOUSAND, rates)).toEqual({ voice: 250, equity: 2_500_000 });
  });
});

describe("the rates", () => {
  it("default to a donation at the work rate and an investment at a tenth of it", () => {
    expect(DONATION_RATE_PCT_DEFAULT).toBe(100);
    expect(INVESTMENT_RATE_PCT_DEFAULT).toBe(10);
  });

  it("a donation and work at the same amount earn the same Voice", () => {
    expect(moneyInIssue("donation", 37_000, PER_THOUSAND, rates).voice).toBe(workVoiceFromPaid(37_000, PER_THOUSAND));
  });

  it("a rate of 0 earns no Voice, and equity still issues for an investment", () => {
    expect(moneyInIssue("investment", 10_000, PER_THOUSAND, { donationPct: 100, investmentPct: 0 })).toEqual({ voice: 0, equity: 10_000 });
  });

  it("a proposal's own rate, such as 200, doubles a donation's Voice", () => {
    expect(moneyInIssue("donation", 10_000, PER_THOUSAND, { donationPct: 200, investmentPct: 10 }).voice).toBe(20);
  });
});

describe("what never earns", () => {
  it("nothing, a negative amount or a broken number earns 0", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(voiceForUnits(bad, PER_THOUSAND)).toBe(0);
    }
    expect(voiceForUnits(1_000, Number.NaN)).toBe(0);
    expect(voiceForUnits(1_000, PER_THOUSAND, -10)).toBe(0);
  });

  it("floorVoice survives binary fractions: 2.30 stays 2.30", () => {
    expect(floorVoice(2.3)).toBe(2.3);
    expect(floorVoice(0.07)).toBe(0.07);
    expect(floorVoice(1.009)).toBe(1);
  });
});

describe("which Voice is work", () => {
  it("names the work sources and the money sources, and never both", () => {
    expect(WORK_VOICE_SOURCES).toEqual(["quest_consent", "role_cycle", "proposal_accepted", "admin_mint"]);
    expect(MONEY_VOICE_SOURCES).toEqual([DONATION_VOICE_SOURCE, INVESTMENT_VOICE_SOURCE, "dues_dividend"]);
    expect(WORK_VOICE_SOURCES.filter((s) => MONEY_VOICE_SOURCES.includes(s))).toEqual([]);
  });

  it("a source nobody named is not work", () => {
    expect(voiceSourceKind("quest_consent")).toBe("work");
    expect(voiceSourceKind("donation_voice")).toBe("money");
    expect(voiceSourceKind("dues_dividend")).toBe("money");
    expect(voiceSourceKind("founding_allocation")).toBe("unclassified");
  });

  it("the work share is work over everything minted, and an unknown source counts against it", () => {
    expect(workShare({ quest_consent: 1_000, donation_voice: 1_000 })).toBe(0.5);
    expect(workShare({ quest_consent: 1_000, founding_allocation: 1_000 })).toBe(0.5);
    expect(workShare({ quest_consent: 1_000 })).toBe(1);
    expect(workShare({})).toBe(0);
  });

  it("a fully reversed donation leaves the work share whole", () => {
    expect(workShare({ quest_consent: 1_000, donation_voice: 0 })).toBe(1);
  });
});
