/**
 * The End of moon kinds and template (spec section 9 and 16): the three kinds
 * the contract knows, hidden from the editor while the moon-review module is
 * off, the template's flow in its order, the holder's Show my moon choice
 * carried on the stick, and the rollback claim that an older `readFlow` drops
 * a kind it does not know.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES,
  MOON_REVIEW_MODULE_ID,
  MOON_ROOM_COPY,
  MOON_SECTION_KINDS,
  MOON_TEMPLATE,
  SECTION_KINDS,
  SECTION_KIND_DEFS,
  TEMPLATE_LIMITS,
  chooseMoonShare,
  cleanFlow,
  cleanMoonShare,
  editorKinds,
  flowMinutes,
  moveStick,
  readFlow,
  readStick,
  sectionMinutesFor,
} from "./sessionTemplates";
import { MOON_REVIEW_MODULE } from "./moonRecap";

describe("the End of moon section kinds", () => {
  it("are known to the contract, each with a label and a hint", () => {
    for (const k of ["moon_recaps", "moon_goals", "moon_invoices"] as const) {
      expect(SECTION_KINDS).toContain(k);
      expect(SECTION_KIND_DEFS[k].label.length).toBeGreaterThan(0);
      expect(MOON_SECTION_KINDS).toContain(k);
    }
    expect(SECTION_KIND_DEFS.moon_recaps.label).toBe("Our moons");
    expect(SECTION_KIND_DEFS.moon_invoices.label).toBe("Sending together");
  });

  it("names the same module id as the moon-review contract", () => {
    expect(MOON_REVIEW_MODULE_ID).toBe(MOON_REVIEW_MODULE);
  });

  it("are hidden from the template editor while the module is off", () => {
    const off = editorKinds(false);
    for (const k of MOON_SECTION_KINDS) expect(off).not.toContain(k);
    expect(off).toContain("talking_stick");
    expect(editorKinds(true)).toEqual([...SECTION_KINDS]);
  });

  it("keep a section's own kind in the editor even while off, so an existing section is never relabelled", () => {
    const off = editorKinds(false, "moon_goals");
    expect(off).toContain("moon_goals");
    expect(off).not.toContain("moon_recaps");
  });
});

describe("rolling back past the moon kinds", () => {
  it("an older readFlow drops a kind it does not know and keeps the rest", () => {
    // The release before this one knew no moon kinds. Its readFlow is this
    // one's: each stored section is cleaned alone, and one whose kind fails
    // `isSectionKind` is filtered out. A kind THIS release does not know
    // stands in for the moon kinds there.
    const stored = JSON.stringify([
      { key: "arrive", kind: "round", title: "Arriving", prompt: "", minutes: 5 },
      { key: "later", kind: "kind_from_a_newer_release", title: "Something newer", prompt: "", minutes: 10 },
      { key: "close", kind: "close", title: "Closing round", prompt: "", minutes: 5 },
    ]);
    expect(readFlow(stored).map((s) => s.key)).toEqual(["arrive", "close"]);
  });

  it("this release reads the whole End of moon flow back", () => {
    expect(readFlow(JSON.stringify(MOON_TEMPLATE.flow)).map((s) => s.kind)).toEqual(MOON_TEMPLATE.flow.map((s) => s.kind));
  });
});

describe("the End of moon template", () => {
  it("is its own seed, apart from the three every village starts with", () => {
    expect(MOON_TEMPLATE.seedKey).toBe("end-of-moon");
    expect(DEFAULT_TEMPLATES.map((t) => t.seedKey)).not.toContain("end-of-moon");
    expect(MOON_TEMPLATE.category).toBe("Moon rhythm");
    expect(MOON_TEMPLATE.name).toBe("End of moon");
  });

  it("runs its sections in order, with their kinds and minutes", () => {
    expect(MOON_TEMPLATE.flow.map((s) => [s.title, s.kind, s.minutes])).toEqual([
      ["Arriving", "round", 5],
      ["This season's goals", "season_priorities", 5],
      ["Our moons", "moon_recaps", 10],
      ["Moon goals", "moon_goals", 10],
      ["Wins and celebrations", "wins", 10],
      ["Roles to change", "talking_stick", 10],
      ["Sending together", "moon_invoices", 5],
      ["Closing round", "close", 5],
    ]);
    const clean = cleanFlow(MOON_TEMPLATE.flow);
    expect(clean.ok).toBe(true);
  });

  it("grows Our moons by 5 minutes for each person here", () => {
    const moons = MOON_TEMPLATE.flow.find((s) => s.kind === "moon_recaps")!;
    expect(sectionMinutesFor(moons, 7)).toBe(45);
    expect(sectionMinutesFor(MOON_TEMPLATE.flow[0], 7)).toBe(5);
    expect(flowMinutes(MOON_TEMPLATE.flow) + 5 * 7).toBe(MOON_TEMPLATE.durationMin);
  });

  it("says role, never seat, carries no dash, and fits the limits", () => {
    const words = [MOON_TEMPLATE.summary, ...MOON_TEMPLATE.flow.flatMap((s) => [s.title, s.prompt])];
    for (const w of words) {
      expect(w).not.toMatch(/\bseats?\b/i);
      expect(w).not.toMatch(/[–—]/);
    }
    expect(MOON_TEMPLATE.summary.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.summary);
    expect(MOON_TEMPLATE.summary).toContain("by the Monday after the circle");
    for (const s of MOON_TEMPLATE.flow) expect(s.prompt.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.prompt);
  });

  it("puts no number about a person's moon in the room's words", () => {
    const all = Object.values(MOON_ROOM_COPY)
      .map((v) => (typeof v === "function" ? (v as (x: never) => string)("Ana" as never) : v))
      .join(" ");
    expect(all).not.toMatch(/score|amount|%|reading|load/i);
  });
});

describe("Show my moon or Speak only, carried on the stick", () => {
  const started = moveStick({ order: [], at: 0, rounds: 0 }, { move: "start", order: [4, 7, 9] });

  it("starts with everyone speaking only", () => {
    expect(readStick(JSON.stringify(started)).shows).toEqual([]);
  });

  it("records the holder's choice, and takes it back", () => {
    const shown = chooseMoonShare(started, true);
    expect(shown.shows).toEqual([4]);
    expect(chooseMoonShare(shown, false).shows).toEqual([]);
    expect(chooseMoonShare(chooseMoonShare(shown, true), true).shows).toEqual([4]);
  });

  it("keeps a choice as the stick passes, and a new start clears it", () => {
    const passed = moveStick(chooseMoonShare(started, true), { move: "pass" });
    expect(readStick(JSON.stringify(passed)).shows).toEqual([4]);
    expect(moveStick(passed, { move: "start", order: [4, 7] }).shows ?? []).toEqual([]);
  });

  it("reads back only numbers in the stick's order", () => {
    expect(readStick(JSON.stringify({ order: [4, 7], at: 0, rounds: 0, shows: [7, 99, "x", 7] })).shows).toEqual([7]);
    expect(readStick(JSON.stringify({ order: [4], at: 0, rounds: 0 })).shows).toEqual([]);
  });

  it("does nothing while nobody holds the stick", () => {
    const resting = { order: [], at: 0, rounds: 0 };
    expect(chooseMoonShare(resting, true)).toBe(resting);
  });

  it("accepts only a yes or no", () => {
    expect(cleanMoonShare({ show: true })).toEqual({ ok: true, value: { show: true } });
    expect(cleanMoonShare({ show: "yes" }).ok).toBe(false);
  });
});
