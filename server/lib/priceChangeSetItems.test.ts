/**
 * WHICH CHANGE SETS THE BAR (change requests, Rye 2026-11-06, 3b).
 *
 * A change set is priced at its hardest change. A member gathering several
 * changes needs to see which one that is, and what every other change would
 * cost on its own, so "split this into its own proposal" is an informed act.
 * `priceChangeSetItems` answers both, and it is the computation
 * `priceChangeSet` itself runs, so the explanation can never disagree with
 * the price the ballot freezes (I.21).
 */
import { describe, expect, it } from "vitest";
import { priceChangeSet, priceChangeSetItems, pricingOf, asChangeItem, type ChangeInput } from "./mechanics";
import { changeSetPriceNow, conductedMethod, pricePreview } from "./changeSetPriceNow";
import { TIER_SETTING_KEYS, thresholdSettingsFrom } from "../../shared/ballotSubjects";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";

const village = { unityPct: 50, quorumPct: 20 };
const settings = thresholdSettingsFrom((key) => Number(VARIABLES_BY_KEY[key]?.default ?? 0));

const ROUTINE = { key: "governance.sensing_days", to: "4" };
const STRUCTURAL = { key: "governance.landing_expiry_cycles", to: "4" };
const CONSTITUTIONAL = { key: "governance.veto_hours", to: "96" };
const MODULE: ChangeInput = { kind: "module_lifecycle", moduleId: "journal", to: "members" };
const BRAND: ChangeInput = { kind: "brand_field", field: "project.tagline", to: "A new line" };
const TIER_BAR = { key: TIER_SETTING_KEYS.structural.unity, to: "70" };

describe("priceChangeSetItems", () => {
  it("prices the fixtures at the tiers the registry gives them", () => {
    expect(VARIABLES_BY_KEY[ROUTINE.key].criticality ?? "routine").toBe("routine");
    expect(VARIABLES_BY_KEY[STRUCTURAL.key].criticality).toBe("structural");
    expect(VARIABLES_BY_KEY[CONSTITUTIONAL.key].criticality).toBe("constitutional");
  });

  it("gives every change its own tier, in the order the set names them", () => {
    const changes = [ROUTINE, CONSTITUTIONAL, MODULE, BRAND];
    const { items } = priceChangeSetItems(changes, "majority", village, settings);
    expect(items.map((i) => i.index)).toEqual([0, 1, 2, 3]);
    expect(items.map((i) => i.criticality)).toEqual(changes.map((c) => pricingOf(asChangeItem(c)).criticality));
  });

  it("names the change that sets the bar, and only that one", () => {
    const { items, setBy } = priceChangeSetItems([ROUTINE, CONSTITUTIONAL, BRAND], "majority", village, settings);
    expect(setBy).toEqual([1]);
    expect(items[1].setsTheBar).toBe(true);
    expect(items[0].setsTheBar).toBe(false);
    expect(items[2].setsTheBar).toBe(false);
  });

  it("says every change sets the bar when they all ask the same", () => {
    const { setBy } = priceChangeSetItems([ROUTINE, BRAND], "majority", village, settings);
    expect(setBy).toEqual([0, 1]);
  });

  it("names a threshold that prices itself (19B) when it asks more than its tier", () => {
    const { items, setBy, set } = priceChangeSetItems([STRUCTURAL, TIER_BAR], "majority", village, settings);
    expect(setBy).toContain(1);
    expect(items[1].dials.unityPct).toBe(set.dials.unityPct);
  });

  it("gives each change the dials it would cost alone, never more than the set's", () => {
    const { items, set } = priceChangeSetItems([ROUTINE, STRUCTURAL, CONSTITUTIONAL], "majority", village, settings);
    for (const item of items) {
      expect(item.dials.unityPct).toBeLessThanOrEqual(set.dials.unityPct);
      expect(item.dials.quorumPct).toBeLessThanOrEqual(set.dials.quorumPct);
      const alone = priceChangeSet([[ROUTINE, STRUCTURAL, CONSTITUTIONAL][item.index]], "majority", village, settings);
      expect(item.dials).toEqual(alone.dials);
    }
  });

  it("is the same price priceChangeSet freezes, for every set in the table", () => {
    const table: ChangeInput[][] = [
      [ROUTINE],
      [CONSTITUTIONAL],
      [ROUTINE, STRUCTURAL],
      [BRAND, MODULE],
      [ROUTINE, CONSTITUTIONAL, MODULE, BRAND],
      [STRUCTURAL, TIER_BAR],
      [TIER_BAR, ROUTINE, BRAND],
    ];
    for (const method of ["majority", "custom", "consent"] as const) {
      for (const changes of table) {
        const whole = priceChangeSet(changes, method, village, settings);
        const { set, items } = priceChangeSetItems(changes, method, village, settings);
        expect(set).toEqual(whole);
        // The set's dials are exactly the hardest of its changes', half by half.
        expect(set.dials.unityPct).toBe(Math.max(...items.map((i) => i.dials.unityPct)));
        expect(set.dials.quorumPct).toBe(Math.max(...items.map((i) => i.dials.quorumPct)));
      }
    }
  });
});

describe("changeSetPriceNow, the one price the preview and the ballot share", () => {
  const readers = (method: string, unity = 50, quorum = 20) => ({
    numberVar: (key: string) =>
      key === "governance.unity_pct" ? unity : key === "governance.quorum_pct" ? quorum : Number(VARIABLES_BY_KEY[key]?.default ?? 0),
    stringVar: (key: string) => (key === "governance.default_method" ? method : String(VARIABLES_BY_KEY[key]?.default ?? "")),
  });

  it("reads a Hypha village as custom, the way the open-ballot route always has", () => {
    expect(conductedMethod(readers("hypha"))).toBe("custom");
  });

  it("is priceChangeSetItems on the village's own method and dials", () => {
    const read = readers("custom", 61, 33);
    const changes = [ROUTINE, CONSTITUTIONAL, BRAND];
    const now = changeSetPriceNow(changes, read);
    const direct = priceChangeSetItems(
      changes,
      conductedMethod(read),
      { unityPct: 61, quorumPct: 33 },
      thresholdSettingsFrom(read.numberVar, read.stringVar),
    );
    expect(now).toEqual(direct);
  });

  it("previews the price with the changes that set the bar, by index", () => {
    const preview = pricePreview([ROUTINE, CONSTITUTIONAL], readers("custom"));
    expect(preview.setBy).toEqual([1]);
    expect(preview.criticality).toBe("constitutional");
    expect(preview.items[1].setsTheBar).toBe(true);
    expect(preview.unityPct).toBe(preview.items[1].unityPct);
  });
});
