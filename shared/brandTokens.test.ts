import { describe, expect, it } from "vitest";
import { atContrast, CHARACTER_CARDS, contrastRatio, deriveTheme, hexToHsl, hslToHex, HOVER_STEP, luminance } from "./brandTokens";

describe("the token layer", () => {
  it("emits NOTHING without a seed — the neutral fork", () => {
    // The white-label baseline: no seed means no output, so an untouched
    // fork renders pixel-identically to the platform's shipped CSS.
    expect(deriveTheme(undefined, undefined)).toBeNull();
    expect(deriveTheme("", "quiet")).toBeNull();
    expect(deriveTheme("not-a-colour", "quiet")).toBeNull();
  });

  it("round-trips colour math within a hair", () => {
    for (const hex of ["#157f7d", "#ecb163", "#3f4a44", "#0000ff"]) {
      const back = hslToHex(hexToHsl(hex)!);
      // channel drift ≤ 2 from float rounding
      const d = (a: string, b: string, i: number) =>
        Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16));
      expect(Math.max(d(hex, back, 1), d(hex, back, 3), d(hex, back, 5))).toBeLessThanOrEqual(2);
    }
  });

  it("derivation is deterministic", () => {
    const a = deriveTheme("#8a5a2b", "handmade")!;
    const b = deriveTheme("#8a5a2b", "handmade")!;
    expect(a.vars).toEqual(b.vars);
  });

  it("every card yields readable text from ANY seed — the A3 guarantee", () => {
    // The amendment's failure case: a dark muddy green that would have shipped
    // 1.2:1 body text under the refuted spec. Plus a neon, a pastel, black-ish
    // and white-ish seeds — the pathological corners.
    const seeds = ["#3f4a44", "#39ff14", "#ffe4ec", "#0a0a0a", "#fdfdfd", "#157f7d"];
    for (const card of CHARACTER_CARDS) {
      for (const seed of seeds) {
        const t = deriveTheme(seed, card.id)!;
        expect(contrastRatio("#ffffff", t.vars["--primary"])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.vars["--foreground"], t.vars["--background"])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.vars["--muted-foreground"], t.vars["--muted"])).toBeGreaterThanOrEqual(4.5);
        expect(t.contrast.status).not.toBe("fail");
      }
    }
  });

    it("the accent stays a COLOUR while it stays legible on the band, any seed, any card", () => {
      /*
       * Fifteen section eyebrows shipped `text-amber` on `bg-teal-deep` at 2.53:1,
       * below even the 3:1 large-text floor, and nothing here caught it because
       * nothing here DERIVED that pairing. Now the band and the accent move toward
       * each other until they clear AA body.
       *
       * The second half of this test is the half that is easy to leave out.
       * Legibility alone is trivially satisfiable by washing the accent to white,
       * and lifting the accent alone DID wash 34 of these combinations past L 0.92.
       * A guarantee that destroys the village's colour to satisfy a ratio has
       * missed the point of the white-label rule, so this also asserts the accent
       * is still a colour and the band is still not black.
       */
      const seeds = ["#3f4a44", "#39ff14", "#ffe4ec", "#0a0a0a", "#fdfdfd", "#157f7d", "#1e3a8a", "#ff6b00", "#7b2d8b"];
      for (const card of CHARACTER_CARDS) {
        for (const seed of seeds) {
          const t = deriveTheme(seed, card.id)!;
          const band = t.vars["--tone-brand-band"];
          const accent = t.vars["--tone-sun-on-band"];
          const where = `${card.id}/${seed}`;
          expect(contrastRatio(accent, band), `accent on band, ${where}`).toBeGreaterThanOrEqual(4.5);
          // white text shares these bands, and deepening one can only help it
          expect(contrastRatio("#ffffff", band), `white on band, ${where}`).toBeGreaterThanOrEqual(4.5);
          expect(hexToHsl(accent)!.l, `accent washed out at ${where}`).toBeLessThanOrEqual(0.94);
          expect(hexToHsl(band)!.l, `band blacked out at ${where}`).toBeGreaterThanOrEqual(0.02);
        }
      }
    });

    it("the hover tone is a VISIBLE step from the brand and still carries white, any seed, any card", () => {
      /*
       * Primary buttons are white on --tone-brand, and they hover to
       * --tone-brand-hover. Seventeen of them used to hover to the soft tone
       * (white at 1.67 to 3.00:1) and dozens more to a translucent brand, which
       * lifts toward the page from a tone derived to only just carry white.
       *
       * Legibility alone is easy to satisfy by hovering to the rest colour, so
       * this also asserts the two grounds are a step apart. The seeds past the
       * usual nine are the forks that break a FIXED hover: #262626 is the old
       * neutral hover partner itself, and black and white are the two ends.
       */
      const seeds = ["#3f4a44", "#39ff14", "#ffe4ec", "#0a0a0a", "#fdfdfd", "#157f7d", "#1e3a8a", "#ff6b00", "#7b2d8b", "#262626", "#000000", "#ffffff"];
      for (const card of CHARACTER_CARDS) {
        for (const seed of seeds) {
          const t = deriveTheme(seed, card.id)!;
          const rest = t.vars["--tone-brand"];
          const hover = t.vars["--tone-brand-hover"];
          const where = `${card.id}/${seed}`;
          expect(contrastRatio("#ffffff", hover), `white on hover, ${where}`).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(rest, hover), `rest ${rest} to hover ${hover}, ${where}`).toBeGreaterThanOrEqual(HOVER_STEP);
          // Darker whenever a darker colour can sit a step away; lighter only for a brand too dark to have one.
          if (luminance(hover) > luminance(rest)) {
            expect(contrastRatio(rest, "#000000"), `hover went lighter at ${where} with room to darken`).toBeLessThan(HOVER_STEP);
          }
          const r = hexToHsl(rest)!, h = hexToHsl(hover)!;
          if (r.s > 0.3) expect(Math.abs(r.h - h.h), `hue drifted at ${where}`).toBeLessThan(3);
          expect(t.contrast.pairs.find((p) => p.name === "white on brand hover")?.verdict, where).toBe("pass");
        }
      }
    });

    it("every measured pair carries the floor it was judged against", () => {
      // `worst` used to infer the floor from the pair's NAME. That was right for
      // the six pairings that existed and wrong for the first one added whose
      // name contains "accent" and is judged at AA body.
      const t = deriveTheme("#157f7d", "civic")!;
      for (const p of t.contrast.pairs) {
        expect([3, 4.5]).toContain(p.wanted);
        if (p.verdict !== "fail") expect(p.ratio).toBeGreaterThanOrEqual(p.wanted);
      }
      expect(t.contrast.pairs.find((p) => p.name === "accent label on brand band")?.wanted).toBe(4.5);
    });

  it("reports 'adjusted', not 'ok', when the seed's lightness was overruled", () => {
    // A pastel seed cannot carry white text at its own lightness; enforce
    // darkens it. The report must SAY so — a silent fix is half a lie.
    const t = deriveTheme("#ffe4ec", "quiet")!;
    expect(t.contrast.status).toBe("adjusted");
  });

  it("keeps the seed's hue — the village's colour stays theirs", () => {
    const t = deriveTheme("#7b2d8b", "woven")!; // purple
    const brand = hexToHsl(t.vars["--primary"])!;
    const seed = hexToHsl("#7b2d8b")!;
    expect(Math.abs(brand.h - seed.h)).toBeLessThan(2);
  });

  it("cards shape radius and typography", () => {
    const civic = deriveTheme("#157f7d", "civic")!;
    const woven = deriveTheme("#157f7d", "woven")!;
    expect(civic.vars["--radius"]).toBe("0.25rem");
    expect(woven.vars["--radius"]).toBe("1rem");
    expect(civic.fonts.display).toContain("Marcellus");
    expect(woven.fonts.display).toContain("Cormorant Garamond");
  });

  it("atContrast changes lightness as little as necessary", () => {
    const seed = hexToHsl("#157f7d")!;
    const adjusted = atContrast(seed, "#ffffff", 4.5, true);
    expect(contrastRatio(hslToHex(adjusted), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    // #157f7d already carries white at 4.5? If not, the adjustment is small.
    expect(Math.abs(adjusted.l - seed.l)).toBeLessThan(0.15);
  });
});
