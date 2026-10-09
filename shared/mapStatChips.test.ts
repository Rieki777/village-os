/**
 * The crown bar's chips: the document a founder edits, and what the map is
 * told to draw from it (shared/mapStatChips.ts).
 *
 * The behaviour Rye asked for (F29, 2026-10-02) is in the `resolveChips`
 * block: a chip nobody has set is an EXAMPLE, and the moment it is set the
 * example goes. Everything else here pins the boundary: the document leaves
 * this system for a separate artifact that draws every string in it.
 */
import { describe, expect, it } from "vitest";
import {
  CHIP_ICONS,
  DEFAULT_MAP_CHIPS,
  LEGACY_CHIP_IDS,
  MAX_MAP_CHIPS,
  REGEN_SOURCE_METRIC,
  STAT_SOURCES,
  STAT_SOURCE_GROUPS,
  STAT_SOURCE_KEYS,
  chipWithSource,
  formatStat,
  freshChipId,
  neededSources,
  resolveChips,
  sanitiseMapChips,
  type MapChip,
} from "./mapStatChips";
import { HEALTH_METRICS_BY_KEY } from "./healthMetrics";
import { MODULES } from "./modules";

const chip = (over: Partial<MapChip> = {}): MapChip => ({
  id: "people",
  label: "People",
  icon: "people",
  source: "none",
  unit: "",
  format: "compact",
  link: "",
  manual: null,
  ...over,
});

describe("the chips document", () => {
  it("gives a village with no document the five examples the map has always drawn", () => {
    for (const absent of [undefined, null, {}, { chips: "nope" }]) {
      const doc = sanitiseMapChips(absent);
      expect(doc.chips.map((c) => c.id)).toEqual([...LEGACY_CHIP_IDS]);
      expect(doc.chips.every((c) => c.source === "none")).toBe(true);
    }
  });

  it("keeps an empty list a founder saved on purpose", () => {
    expect(sanitiseMapChips({ chips: [] }).chips).toEqual([]);
  });

  it("holds the bar to six chips", () => {
    const many = Array.from({ length: 10 }, (_, i) => chip({ id: `c${i}` }));
    expect(sanitiseMapChips({ chips: many }).chips).toHaveLength(MAX_MAP_CHIPS);
  });

  it("falls back to an example for a source it does not know, and keeps a known one", () => {
    // `crowdpool` was asked about and is still not a source: see the registry's header.
    const doc = sanitiseMapChips({
      chips: [chip({ id: "a", source: "crowdpool" as any }), chip({ id: "b", source: "members" })],
    });
    expect(doc.chips.map((c) => c.source)).toEqual(["none", "members"]);
  });

  it("gives every chip a unique id, renaming a repeat instead of dropping it", () => {
    const doc = sanitiseMapChips({ chips: [chip({ id: "x" }), chip({ id: "x" }), chip({ id: "BAD ID!" })] });
    const ids = doc.chips.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("x");
  });

  it("keeps only a page on this site as a door", () => {
    const links = ["/quests", "/village-health", "https://evil.example", "//evil.example", "/a?b=c", "javascript:alert(1)", "/ok/path"];
    const doc = sanitiseMapChips({ chips: links.map((link, i) => chip({ id: `c${i}`, link })) });
    expect(doc.chips.map((c) => c.link)).toEqual(["/quests", "/village-health", "", "", "", "", "/ok/path"].slice(0, MAX_MAP_CHIPS));
  });

  it("strips control characters and clips every string", () => {
    const doc = sanitiseMapChips({
      chips: [chip({ label: "Peo\u0000ple\n" + "x".repeat(60), unit: "kilograms!!", source: "manual", manual: { value: "1".repeat(40), asOf: "2026-10-02" } })],
    });
    const c = doc.chips[0];
    expect(c.label).not.toMatch(/[\u0000-\u001f]/);
    expect(c.label.length).toBeLessThanOrEqual(24);
    expect(c.unit.length).toBeLessThanOrEqual(8);
    expect(c.manual!.value.length).toBeLessThanOrEqual(16);
  });

  it("keeps a typed number's date only when it is a real day", () => {
    const at = (asOf: string) =>
      sanitiseMapChips({ chips: [chip({ source: "manual", manual: { value: "40", asOf } })] }).chips[0].manual!.asOf;
    expect(at("2026-10-02")).toBe("2026-10-02");
    expect(at("2026-02-30")).toBe("");
    expect(at("yesterday")).toBe("");
  });

  it("drops the typed number from a chip that reads a source", () => {
    const doc = sanitiseMapChips({ chips: [chip({ source: "members", manual: { value: "99", asOf: "2026-10-02" } })] });
    expect(doc.chips[0].manual).toBeNull();
  });

  it("gives an unknown icon the source's own", () => {
    const doc = sanitiseMapChips({ chips: [chip({ icon: "dragon" as any, source: "seats_open" })] });
    expect(doc.chips[0].icon).toBe(STAT_SOURCES.seats_open.icon);
  });

  it("makes a fresh id unlike every id it is handed", () => {
    expect(freshChipId("Open seats", [])).toBe("open-seats");
    expect(freshChipId("Open seats", ["open-seats", "open-seats-2"])).toBe("open-seats-3");
    expect(freshChipId("!!!", [])).toBe("chip");
    // Read only as far as an id could reach, so a pasted wall of dashes costs nothing.
    expect(freshChipId("-".repeat(5000) + "a", [])).toBe("chip");
  });
});

describe("what the map is told to draw (F29: examples until set)", () => {
  const reading = (n: number) => ({ ok: true as const, n, countedAt: "2026-10-02T12:00:00.000Z" });

  it("leaves an unset chip as an example with no number of its own", () => {
    const [r] = resolveChips([chip()], {});
    expect(r.state).toBe("example");
    expect(r.value).toBeNull();
  });

  it("draws a set chip's reading, with no example left on it", () => {
    const [r] = resolveChips([chip({ source: "members" })], { members: reading(41) });
    expect(r).toMatchObject({ state: "live", value: "41", sub: STAT_SOURCES.members.sub });
  });

  it("draws a typed number with its date, and calls an empty one an example", () => {
    const [typed, empty] = resolveChips(
      [
        chip({ id: "a", source: "manual", unit: "%", manual: { value: "76", asOf: "2026-09-30" } }),
        chip({ id: "b", source: "manual", manual: { value: "", asOf: "" } }),
      ],
      {},
    );
    expect(typed).toMatchObject({ state: "manual", value: "76%", asOf: "2026-09-30" });
    // ICU spells September "Sep" or "Sept" depending on the Node release.
    expect(typed.sub).toMatch(/^as of 30 Sept? 2026$/);
    expect(empty.state).toBe("example");
  });

  it("never falls back to the example for a chip the founder pointed at a source", () => {
    // A chip set to a module this viewer cannot open is a different fact
    // from a chip nobody set, so it is unavailable, never the sample.
    const [r] = resolveChips([chip({ source: "trees_planted" })], {
      trees_planted: { ok: false, why: "Village Health is switched off, so this chip is not drawn." },
    });
    expect(r.state).toBe("unavailable");
    expect(r.value).toBeNull();
    expect(r.why).toContain("switched off");
  });

  it("asks for each source once, whatever the number of chips reading it", () => {
    expect(neededSources([chip({ source: "members" }), chip({ id: "b", source: "members" }), chip({ id: "c" })])).toEqual(["members"]);
  });
});

describe("a reading, as the bar draws it", () => {
  it("keeps small numbers whole and groups the thousands in full", () => {
    expect(formatStat(24, "compact", "")).toBe("24");
    expect(formatStat(9999, "compact", "")).toBe("9,999");
    expect(formatStat(12400, "full", "")).toBe("12,400");
    expect(formatStat(12.5, "full", "ha")).toBe("12.5ha");
  });

  it("shortens large numbers for a phone's bar, spacing a word unit from the suffix", () => {
    expect(formatStat(12400, "compact", "")).toBe("12.4k");
    expect(formatStat(12400, "compact", "kg")).toBe("12.4k kg");
    expect(formatStat(2_500_000, "compact", "%")).toBe("2.5M%");
    expect(formatStat(62, "compact", "kg")).toBe("62kg");
  });

  it("draws a broken count as zero instead of NaN", () => {
    expect(formatStat(Number.NaN, "compact", "")).toBe("0");
  });
});

describe("pointing a chip somewhere new in the editor", () => {
  it("lets an untouched chip follow the new source, and keeps what the founder typed", () => {
    const fresh = chipWithSource(chip({ id: "c", label: "", icon: "star", source: "none" }), "quests_open", "2026-10-02");
    expect(fresh).toMatchObject({ label: "Open quests", icon: "quests", link: "/quests", unit: "" });
    const named = chipWithSource(chip({ label: "Our people", link: "/team" }), "members_active", "2026-10-02");
    expect(named).toMatchObject({ label: "Our people", link: "/team", source: "members_active" });
  });

  it("moves the unit with what is counted", () => {
    const c = chipWithSource(chip({ id: "food", label: "Food", icon: "food", source: "none" }), "food_produced", "2026-10-02");
    expect(c.unit).toBe("kg");
    expect(chipWithSource(c, "trees_planted", "2026-10-02").unit).toBe("");
  });

  it("starts a typed number out true today", () => {
    expect(chipWithSource(chip(), "manual", "2026-10-02").manual).toEqual({ value: "", asOf: "2026-10-02" });
    expect(chipWithSource(chip({ source: "manual", manual: { value: "9", asOf: "2026-01-01" } }), "members", "2026-10-02").manual).toBeNull();
  });
});

describe("the source list is held to what the village keeps", () => {
  it("names a module that exists, and never a core one", () => {
    for (const key of STAT_SOURCE_KEYS) {
      const id = STAT_SOURCES[key].module;
      if (!id) continue;
      const def = MODULES.find((m) => m.id === id);
      expect(def, `${key} reads ${id}`).toBeTruthy();
      expect(def!.core, `${key}: a core module needs no gate`).toBeFalsy();
    }
  });

  it("reads Village Health metrics the registry declares, as regen readings", () => {
    for (const metric of Object.values(REGEN_SOURCE_METRIC)) {
      expect(HEALTH_METRICS_BY_KEY[metric]?.kind, metric).toBe("regen");
    }
    for (const key of Object.keys(REGEN_SOURCE_METRIC) as (keyof typeof REGEN_SOURCE_METRIC)[]) {
      expect(STAT_SOURCES[key].module).toBe("health");
    }
  });

  it("files every source under a group the picker shows, with an icon the map can draw", () => {
    for (const key of STAT_SOURCE_KEYS) {
      expect(STAT_SOURCE_GROUPS).toContain(STAT_SOURCES[key].group);
      expect(CHIP_ICONS).toContain(STAT_SOURCES[key].icon);
    }
  });

  it("starts every default chip as an example", () => {
    expect(DEFAULT_MAP_CHIPS.every((c) => c.source === "none")).toBe(true);
  });
});

describe("the treasury (Rye, 2026-10-05: treasury balance shown to members only)", () => {
  const reading = (n: number, sub?: string) => ({ ok: true as const, n, countedAt: "2026-10-05T12:00:00.000Z", ...(sub ? { sub } : {}) });

  it("is a source on the list, read from the ledger's core accounts and never a module", () => {
    expect(STAT_SOURCE_KEYS).toContain("treasury");
    const def = STAT_SOURCES.treasury;
    expect(def.module).toBeNull();
    expect(STAT_SOURCE_GROUPS).toContain(def.group);
    expect(CHIP_ICONS).toContain(def.icon);
  });

  it("is the one source kept to members, whatever a module's lifecycle says", () => {
    expect(STAT_SOURCE_KEYS.filter((k) => STAT_SOURCES[k].membersOnly)).toEqual(["treasury"]);
  });

  it("survives a save as itself, never falling back to an example", () => {
    const doc = sanitiseMapChips({ chips: [chip({ id: "money", source: "treasury" })] });
    expect(doc.chips[0].source).toBe("treasury");
  });

  it("draws a member's reading with the token's own name under the number", () => {
    const [r] = resolveChips([chip({ id: "money", source: "treasury" })], {
      treasury: reading(4321, "Village Credits held in the treasury"),
    });
    expect(r).toMatchObject({ state: "live", value: "4,321", sub: "Village Credits held in the treasury" });
  });

  it("keeps the registry's words under the number when a reading names nothing", () => {
    const [r] = resolveChips([chip({ id: "money", source: "treasury" })], { treasury: reading(12) });
    expect(r.sub).toBe(STAT_SOURCES.treasury.sub);
  });

  it("is unavailable, with no number and no sample, for a viewer it is withheld from", () => {
    // `people` is one of the five the map has its own sample for. A withheld
    // treasury on that id must still never draw the sample.
    const [r] = resolveChips([chip({ id: "people", source: "treasury" })], {
      treasury: { ok: false, why: "Treasury is for members only, so a visitor or a guest does not see this chip." },
    });
    expect(r.state).toBe("unavailable");
    expect(r.value).toBeNull();
  });

  it("starts a chip pointed at it with no unit and a door to the wallet", () => {
    const c = chipWithSource(chip({ id: "c", label: "", icon: "star", source: "none" }), "treasury", "2026-10-05");
    expect(c).toMatchObject({ label: "Treasury", unit: "", link: "/wallet", manual: null });
  });
});
