/**
 * Terms on offer and the village's own presets (seat settings PR3), the pure
 * half. Every figure here is fake: XTS is the ISO 4217 code reserved for
 * testing, and the amounts are round shapes no village pays.
 */
import { describe, expect, it } from "vitest";
import { SEAT_PRESETS, presetsFor } from "./seatPresets";
import {
  OFFER_WORDS,
  changedGroups,
  proposeTermsHref,
  readTermsOffer,
  seatPresetsDocProblems,
  villagePresetsFrom,
  type VillagePresetRow,
} from "./seatTermsOffer";

const FAKE_PAY = { kind: "fixed", currency: "XTS", amountMinor: 100000, per: "month" };

const row = (over: Partial<VillagePresetRow> = {}): VillagePresetRow => ({
  id: "custom:test-stipend",
  group: "pay",
  label: "Test stipend",
  blurb: "A made-up figure for tests.",
  version: 1,
  values: FAKE_PAY,
  retiredAt: null,
  ...over,
});

describe("reading an offer", () => {
  it("reads null and absent as no terms on offer, which is not an empty set of terms", () => {
    expect(readTermsOffer(null)).toEqual({ ok: true, settings: null });
    expect(readTermsOffer(undefined)).toEqual({ ok: true, settings: null });
  });

  it("reads a stored JSON string and a parsed object the same way", () => {
    const offer = { v: 1, pay: FAKE_PAY };
    const a = readTermsOffer(JSON.stringify(offer));
    const b = readTermsOffer(offer);
    expect(a).toEqual(b);
    expect(a.ok && a.settings?.pay?.amountMinor).toBe(100000);
  });

  it("refuses payment details with the parser's own sentence", () => {
    const r = readTermsOffer({ v: 1, pay: { kind: "fixed", note: "acct 1234 5678 9012" } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toMatch(/bank or card number/);
  });

  it("refuses text that is not JSON", () => {
    expect(readTermsOffer("{not json").ok).toBe(false);
  });
});

describe("which groups a change lights", () => {
  it("names exactly the groups whose values moved, in season-card order", () => {
    const before = { v: 1 as const, pay: FAKE_PAY as any, quests: { perMoonMin: 3, perMoonMax: 5, doneWhenRequired: true } as any };
    const after = { ...before, pay: { ...FAKE_PAY, amountMinor: 200000 } as any, term: { endsOn: null } as any };
    expect(changedGroups(before, after)).toEqual(["term", "pay"]);
  });

  it("an offer where there was none lights every group it sets", () => {
    expect(changedGroups(null, { v: 1, pay: FAKE_PAY as any })).toEqual(["pay"]);
    expect(changedGroups(null, null)).toEqual([]);
  });
});

describe("the village's presets as members read them", () => {
  it("reads good rows and leaves out a row that no longer reads, without taking the library down", () => {
    const presets = villagePresetsFrom({
      presets: [row(), row({ id: "custom:broken", values: { kind: "fixed", note: "IBAN GB29NWBK60161331926819" } })],
    });
    expect(presets.map((p) => p.id)).toEqual(["custom:test-stipend"]);
  });

  it("keeps a retired row for naming, and the picker leaves it out", () => {
    const presets = villagePresetsFrom({ presets: [row(), row({ id: "custom:old", retiredAt: "2026-10-01" })] });
    expect(presets.map((p) => p.id)).toContain("custom:old");
    const offered = presetsFor("pay", presets).map((p) => p.id);
    expect(offered).toContain("custom:test-stipend");
    expect(offered).not.toContain("custom:old");
  });

  it("offers the platform's shapes first and the village's own after them", () => {
    const offered = presetsFor("pay", villagePresetsFrom({ presets: [row()] })).map((p) => p.id);
    expect(offered[offered.length - 1]).toBe("custom:test-stipend");
    expect(offered[0].startsWith("platform:")).toBe(true);
  });

  it("an empty or missing document is an empty library", () => {
    expect(villagePresetsFrom(null)).toEqual([]);
    expect(villagePresetsFrom({})).toEqual([]);
  });
});

describe("the founding write", () => {
  it("accepts a well formed library", () => {
    expect(seatPresetsDocProblems({ presets: [row()] }, null)).toEqual([]);
  });

  it("refuses deleting a stored preset, and says to retire it", () => {
    const problems = seatPresetsDocProblems({ presets: [] }, { presets: [row()] });
    expect(problems.join(" ")).toMatch(/retired, never deleted/);
    // Control: retiring the same row is accepted.
    expect(seatPresetsDocProblems({ presets: [row({ retiredAt: "2026-10-09" })] }, { presets: [row()] })).toEqual([]);
  });

  it("refuses changed values without a higher version", () => {
    const moved = row({ values: { ...FAKE_PAY, amountMinor: 200000 } });
    expect(seatPresetsDocProblems({ presets: [moved] }, { presets: [row()] }).join(" ")).toMatch(/version goes up/);
    expect(seatPresetsDocProblems({ presets: [{ ...moved, version: 2 }] }, { presets: [row()] })).toEqual([]);
  });

  it("refuses a platform id, a bad id, a duplicate and an unknown group", () => {
    const platformId = SEAT_PRESETS[0].id;
    expect(seatPresetsDocProblems({ presets: [row({ id: platformId })] }, null).length).toBeGreaterThan(0);
    expect(seatPresetsDocProblems({ presets: [row({ id: "custom:Not Ok" })] }, null).length).toBeGreaterThan(0);
    expect(seatPresetsDocProblems({ presets: [row(), row()] }, null).join(" ")).toMatch(/once/);
    expect(seatPresetsDocProblems({ presets: [row({ group: "voice" as any })] }, null).length).toBeGreaterThan(0);
  });

  it("refuses payment details in the values, the label and the blurb", () => {
    const iban = "GB29NWBK60161331926819";
    expect(seatPresetsDocProblems({ presets: [row({ values: { ...FAKE_PAY, note: iban } })] }, null).length).toBeGreaterThan(0);
    expect(seatPresetsDocProblems({ presets: [row({ label: `Pay to ${iban}` })] }, null).length).toBeGreaterThan(0);
    expect(seatPresetsDocProblems({ presets: [row({ blurb: "card 4111 1111 1111 1111" })] }, null).length).toBeGreaterThan(0);
  });

  it("refuses a body that is not a list", () => {
    expect(seatPresetsDocProblems({ presets: "all of them" }, null)).toEqual(["Send { presets: [...] }."]);
  });
});

describe("the words", () => {
  it("names the empty state and where proposing terms starts", () => {
    expect(OFFER_WORDS.none).toBe("No terms on offer yet.");
    expect(OFFER_WORDS.propose).toBe("Propose terms");
    expect(proposeTermsHref("seat water")).toBe("/propose?type=role_application&seat=seat%20water");
  });
});
