/**
 * The circle projection, and the two things that actually broke.
 *
 * This suite is deliberately NOT an e2e boot. What went wrong was never a
 * routing or an auth question: both endpoints read the same rows and always
 * had. A field was dropped by a hand-written object literal on its way to
 * the wire, and the second endpoint's literal was a different length. So the
 * test that would have caught it is a test about the PROJECTION, and it runs
 * in milliseconds instead of booting a server.
 *
 * `circleView.sources.test.ts` covers the other half: that both endpoints
 * still route through here at all.
 */
import { describe, expect, it } from "vitest";
import { circleView, circleViews, toneForCircle, CIRCLE_TONES, CIRCLE_TONE_HEX } from "./circleView";

/** A row shaped like `circlesRepo.all()` returns one. */
const row = (over: Record<string, unknown> = {}) => ({
  id: "gathering",
  name: "Gathering Circle",
  purpose: "Meals, welcome and the rhythm of the week.",
  aliases: ["Kitchen Circle", "Hearth"],
  parentCircleId: null,
  leadRoleId: "kitchen-lead",
  grownFromOrgRoleId: null,
  icon: "Users",
  color: "bg-sage",
  status: "active",
  order: 3,
  isExample: false,
  decidesBy: "consent",
  decidesByGloss: "We decide together, and an objection improves the proposal.",
  decidesByDomains: { money: { method: "consensus", gloss: "Spending is everyone's." } },
  createdAt: new Date("2026-01-04T00:00:00Z"),
  ...over,
});

describe("circleView carries the fields the old projection dropped", () => {
  it("keeps colour and icon, which /api/org used to delete on the way out", () => {
    const v = circleView(row());
    expect(v.color, "colour reaches the cards page").toBe("bg-sage");
    expect(v.icon, "the glyph reaches the cards page").toBe("Users");
  });

  it("keeps aliases and the lead seat, for search and for the inspector", () => {
    const v = circleView(row());
    expect(v.aliases).toEqual(["Kitchen Circle", "Hearth"]);
    expect(v.leadRoleId).toBe("kitchen-lead");
  });

  it("keeps decidesByDomains a MAP, because DecideLens indexes it by domain", () => {
    const v = circleView(row());
    // The bug this pins: an array helper here turned every override into [],
    // and the decide lens went blank with no error on either side.
    expect(v.decidesByDomains).toEqual({
      money: { method: "consensus", gloss: "Spending is everyone's." },
    });
    expect(v.decidesByDomains?.money?.method).toBe("consensus");
  });

  it("turns an array or a scalar in decidesByDomains into null, never a half-map", () => {
    expect(circleView(row({ decidesByDomains: [] })).decidesByDomains).toBeNull();
    expect(circleView(row({ decidesByDomains: "consent" })).decidesByDomains).toBeNull();
    expect(circleView(row({ decidesByDomains: null })).decidesByDomains).toBeNull();
  });

  it("normalises empty strings to null so a blank admin field is not a value", () => {
    const v = circleView(row({ purpose: "   ", color: "", icon: null }));
    expect(v.purpose).toBeNull();
    expect(v.color).toBeNull();
    expect(v.icon).toBeNull();
  });

  it("survives a row with nothing on it", () => {
    const v = circleView({});
    expect(v.id).toBe("");
    expect(v.status).toBe("active");
    expect(v.aliases).toEqual([]);
    expect(v.order).toBe(0);
  });

  it("projects a list in the order given", () => {
    const out = circleViews([row({ id: "a" }), row({ id: "b" })]);
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
    expect(circleViews(null as any)).toEqual([]);
  });
});

describe("toneForCircle resolves what villages actually stored", () => {
  it("gives EVERY word the circles seed writes a real colour", () => {
    // The defect this closes. PowerMap resolved this column through a
    // four-entry map keyed by bare words (sage, amber, coral, teal), so of
    // the eight words below, four fell to `var(--color-teal-deep)` and the
    // map drew one grey across most of the village.
    const seedWords = ["sage", "amber", "coral", "rose", "stone", "teal", "sky", "emerald"];
    for (const word of seedWords) {
      const tone = toneForCircle({ id: "seeded", color: word });
      expect(CIRCLE_TONES, `"${word}" resolves to a known tone`).toContain(tone);
      // and it must not be the hash fallback: a declared colour is honoured.
      expect(tone, `"${word}" is not silently reassigned`).toBe(
        toneForCircle({ id: "a-completely-different-id", color: word }),
      );
    }
  });

  it("gives every tone a hex, checked by the compiler and again here", () => {
    for (const tone of CIRCLE_TONES) {
      expect(CIRCLE_TONE_HEX[tone], `${tone} has a hue`).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // Eleven distinct hues, so two circles never collide by construction.
    expect(new Set(Object.values(CIRCLE_TONE_HEX)).size).toBe(CIRCLE_TONES.length);
  });

  it("matches the living map artifact's own palette", () => {
    // These are CIRCLE_COL from docs/prototypes/grounds-v0.html. Crossing
    // from the land to the circles should not feel like leaving the world.
    expect(CIRCLE_TONE_HEX.moss).toBe("#6fae52"); // Land
    expect(CIRCLE_TONE_HEX.clay).toBe("#c98b4e"); // Building
    expect(CIRCLE_TONE_HEX.amber).toBe("#d0a94f"); // Community
    expect(CIRCLE_TONE_HEX.sky).toBe("#7f9fd0"); // Learning
    expect(CIRCLE_TONE_HEX.violet).toBe("#a98ad0"); // Wisdom
  });

  it("reads the Tailwind class the admin form writes, not just a bare word", () => {
    // The whole reason this function is not a one-line includes() check.
    expect(toneForCircle({ id: "x", color: "bg-sage" })).toBe("sage");
    expect(toneForCircle({ id: "x", color: "bg-coral" })).toBe("ember");
    expect(toneForCircle({ id: "x", color: "bg-forest" })).toBe("moss");
  });

  it("folds the lightness suffixes onto one hue", () => {
    // A village that picked sage gets sage on every surface, whichever shade.
    expect(toneForCircle({ id: "x", color: "bg-sage-light" })).toBe("sage");
    expect(toneForCircle({ id: "x", color: "bg-teal-deep" })).toBe("teal");
    expect(toneForCircle({ id: "x", color: "bg-cream-dark" })).toBe("amber");
    expect(toneForCircle({ id: "x", color: "bg-cyan-brand" })).toBe("teal");
  });

  it("accepts a bare tone word too, so a fork writing 'sage' is not punished", () => {
    expect(toneForCircle({ id: "x", color: "sage" })).toBe("sage");
    expect(toneForCircle({ id: "x", color: "VIOLET" })).toBe("violet");
  });

  it("gives an undeclared circle a stable tone, the same one every time", () => {
    const a = toneForCircle({ id: "wisdom", color: null });
    const b = toneForCircle({ id: "wisdom" });
    const c = toneForCircle({ id: "wisdom", color: "  " });
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(CIRCLE_TONES).toContain(a);
  });

  it("does not reshuffle when circles are renamed or re-ordered", () => {
    // Keyed by id, so `order` and `name` cannot move a colour. An
    // index-based assignment would have failed this.
    const before = toneForCircle({ id: "healing", color: null });
    const after = toneForCircle({ id: "healing", color: null });
    expect(after).toBe(before);
  });

  it("falls back rather than throwing on a class nobody defined", () => {
    // `bg-sage-light` was stored on four live records and never existed as a
    // class; an unknown value has to resolve to something drawable.
    const t = toneForCircle({ id: "q", color: "bg-not-a-real-colour" });
    expect(CIRCLE_TONES).toContain(t);
  });
});
