/**
 * The platform's seat presets: valid, copied on pick, and brand neutral.
 *
 * Platform presets ship to every village, so three things are held here.
 * Every preset passes the one parser. Picking one copies it, so a member
 * editing their terms can never edit the library. And no preset carries a
 * village's name, a person's name, a currency or an amount (decision 4,
 * defaulted to shapes only).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_GROUPS, parseSeatSettings, type SeatSettings } from "./seatSettings";
import {
  SEAT_PRESETS,
  WHOLE_PRESETS,
  applyPreset,
  applyWholePreset,
  clearGroup,
  isCustomised,
  presetById,
  presetsFor,
  resetGroup,
  type SeatPreset,
} from "./seatPresets";

describe("every platform preset", () => {
  it("passes the parser alone, with no problems and no flags", () => {
    for (const p of SEAT_PRESETS) {
      const r = parseSeatSettings({ v: 1, [p.group]: p.values });
      expect(r.problems, p.id).toEqual([]);
      expect(r.flags, p.id).toEqual([]);
      // What the parser keeps is what the preset says.
      expect((r.settings as any)[p.group], p.id).toEqual(p.values);
    }
  });

  it("passes the parser once applied, provenance included", () => {
    for (const p of SEAT_PRESETS) {
      const r = parseSeatSettings(applyPreset(null, p));
      expect(r.ok, p.id).toBe(true);
      expect(r.settings?.presets, p.id).toEqual([{ group: p.group, presetId: p.id, presetVersion: p.version }]);
    }
  });

  it("has a unique platform id, and every group has at least one", () => {
    const ids = SEAT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^platform:[a-z0-9-]+$/);
    for (const g of SETTINGS_GROUPS) expect(presetsFor(g).length, g).toBeGreaterThan(0);
  });

  it("offers the spec's shapes by name", () => {
    for (const id of [
      "until-season-end", "three-moons", "one-moon-trial",
      "pay-month-work-moon", "all-moon",
      "weekly-sync-plus-core-call", "fortnightly", "async-first",
      "unpaid", "honorary", "fixed-monthly-stipend", "stipend-range", "in-kind-or-deferred",
      "no-allowance", "flat-monthly-allowance", "reimbursed",
      "no-bonus", "rated-equity-in-words",
      "three-to-five-done-when-by-consent",
      "starter-measures",
    ]) {
      expect(presetById(`platform:${id}`), id).not.toBeNull();
    }
  });
});

describe("whole presets", () => {
  it("name one real preset per group, of that group", () => {
    for (const w of WHOLE_PRESETS) {
      for (const g of SETTINGS_GROUPS) {
        const p = presetById(w.picks[g]);
        expect(p, `${w.id}.${g}`).not.toBeNull();
        expect(p!.group, `${w.id}.${g}`).toBe(g);
      }
    }
  });

  it("fill every group at once, and the result parses", () => {
    for (const w of WHOLE_PRESETS) {
      const s = applyWholePreset(null, w);
      for (const g of SETTINGS_GROUPS) expect(s[g], `${w.id}.${g}`).toBeDefined();
      expect(parseSeatSettings(s).ok, w.id).toBe(true);
      for (const g of SETTINGS_GROUPS) expect(isCustomised(s, g), `${w.id}.${g}`).toBe(false);
    }
  });
});

describe("picking copies", () => {
  it("leaves SEAT_PRESETS unchanged when the result is mutated", () => {
    const before = JSON.stringify(SEAT_PRESETS);
    for (const p of SEAT_PRESETS) {
      const s: any = applyPreset(null, p);
      // Mutate every reachable object in the copy.
      const g = s[p.group];
      g.kind = "mutated";
      g.note = "mutated";
      if (Array.isArray(g.gatherings)) g.gatherings.push({ label: "x", weekday: 1, time: "10:00" });
      if (Array.isArray(g.gatherings) && g.gatherings[0]) g.gatherings[0].label = "mutated";
      if (Array.isArray(g.measures) && g.measures[0]) g.measures[0].measure = "mutated";
      if (Array.isArray(g.quietDays)) g.quietDays.push(6);
    }
    for (const w of WHOLE_PRESETS) {
      const s: any = applyWholePreset(null, w);
      s.rhythm.gatherings?.push({ label: "x", weekday: 1, time: "10:00" });
      s.scoreboard.measures[0].measure = "mutated";
    }
    expect(JSON.stringify(SEAT_PRESETS)).toBe(before);
  });

  it("never touches the settings it was given", () => {
    const start: SeatSettings = { v: 1, pay: { kind: "none" } };
    const frozen = JSON.stringify(start);
    applyPreset(start, presetById("platform:stipend-range")!);
    applyWholePreset(start, WHOLE_PRESETS[0]);
    clearGroup(start, "pay");
    expect(JSON.stringify(start)).toBe(frozen);
  });

  it("marks a tweak as customised, and reset puts the preset back exactly", () => {
    const preset = presetById("platform:three-to-five-done-when-by-consent")!;
    const picked = applyPreset(null, preset);
    const tweaked: SeatSettings = { ...picked, quests: { ...picked.quests!, perMoonMax: 7 } };
    expect(isCustomised(tweaked, "quests")).toBe(true);
    const reset = resetGroup(tweaked, "quests");
    expect(reset.quests).toEqual(preset.values);
    expect(isCustomised(reset, "quests")).toBe(false);
  });

  it("hides a retired village preset from the picker and keeps it findable", () => {
    const village: SeatPreset[] = [
      { id: "custom:old", group: "pay", label: "Old", blurb: "Retired.", version: 2, values: { kind: "honorary" }, retiredAt: "2026-10-01" },
      { id: "custom:new", group: "pay", label: "New", blurb: "Live.", version: 1, values: { kind: "none" } },
    ];
    const offered = presetsFor("pay", village).map((p) => p.id);
    expect(offered).toContain("custom:new");
    expect(offered).not.toContain("custom:old");
    // Platform first, village second.
    expect(offered.indexOf("platform:unpaid")).toBeLessThan(offered.indexOf("custom:new"));
    expect(presetById("custom:old", village)?.label).toBe("Old");
  });
});

/*
 * BRAND NEUTRAL. The brand words are read from the brand guard itself
 * (scripts/check-brand-refs.mjs), so a fork adding its own village's name
 * there is checked here too, and this file never spells one out.
 */
describe("platform presets carry no village, person, currency or amount", () => {
  const brandWords = (): string[] => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", "scripts", "check-brand-refs.mjs"), "utf8");
    const block = src.match(/const BANNED = \[([\s\S]*?)\]/);
    return block ? Array.from(block[1].matchAll(/"([^"]+)"/g), (m) => m[1]) : [];
  };
  const text = JSON.stringify([SEAT_PRESETS, WHOLE_PRESETS]);
  /** Names that have stood in real seats on this platform's first village. */
  const PEOPLE = ["Rye", "Rieki", "Rick", "Jess", "Maia"];
  /** ISO 4217 codes, read from the runtime, and the symbols money is written with. */
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const CODES = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("currency") : ["USD", "EUR", "CRC", "GBP"];

  it("names no village", () => {
    const words = brandWords();
    expect(words.length).toBeGreaterThan(0);
    for (const w of words) expect(text.toLowerCase(), w).not.toContain(w.toLowerCase());
    // Control: the scan finds a brand word planted in a copy of the text.
    expect(`${text} ${words[0]}`.toLowerCase()).toContain(words[0].toLowerCase());
  });

  it("names no person", () => {
    for (const name of PEOPLE) expect(text, name).not.toMatch(new RegExp(`\\b${name}\\b`));
  });

  it("names no currency and carries no amount", () => {
    for (const code of CODES) expect(text, code).not.toMatch(new RegExp(`\\b${code}\\b`));
    expect(text).not.toMatch(/[$€£¥₡₹]/);
    for (const p of SEAT_PRESETS) {
      const v = p.values as Record<string, unknown>;
      for (const key of ["currency", "amountMinor", "minMinor", "maxMinor"]) expect(v[key], `${p.id}.${key}`).toBeUndefined();
    }
    // Control: the code scan catches a currency written into a preset.
    expect(JSON.stringify({ currency: CODES[0] })).toMatch(new RegExp(`\\b${CODES[0]}\\b`));
  });
});
