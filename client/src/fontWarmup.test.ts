import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_SCREEN_FACES, firstFamily, firstScreenFontQueries, warmFirstScreenFonts } from "./fontWarmup";

describe("firstFamily", () => {
  it("takes the first family of a stack and drops its quotes", () => {
    expect(firstFamily('"Jost", -apple-system, BlinkMacSystemFont, sans-serif')).toBe("Jost");
    expect(firstFamily("'Cormorant Garamond', Georgia, serif")).toBe("Cormorant Garamond");
    expect(firstFamily(" Raleway , system-ui")).toBe("Raleway");
  });

  it("answers null when no web font could be asked for", () => {
    expect(firstFamily("")).toBeNull();
    expect(firstFamily("   ")).toBeNull();
    expect(firstFamily("system-ui, sans-serif")).toBeNull();
    expect(firstFamily("-apple-system, BlinkMacSystemFont")).toBeNull();
    expect(firstFamily('var(--sheet-font-display, "Marcellus")')).toBeNull();
  });
});

describe("firstScreenFontQueries", () => {
  // The two stacks production served on 2026-10-20 (/api/brand/theme.css).
  const LIVE_THEME: Record<string, string> = {
    "--font-body": ' "Jost", -apple-system, BlinkMacSystemFont, sans-serif',
    "--font-display": ' "Cormorant Garamond", Georgia, serif',
  };

  it("asks for the five measured first-screen cuts of the village's own families", () => {
    expect(firstScreenFontQueries((t) => LIVE_THEME[t] ?? "")).toEqual([
      '400 1em "Jost"',
      '500 1em "Jost"',
      '600 1em "Jost"',
      '600 1em "Cormorant Garamond"',
      '700 1em "Cormorant Garamond"',
    ]);
  });

  it("follows whatever the theme says, so a fork gets its own faces", () => {
    const platform: Record<string, string> = {
      "--font-body": '"Montserrat", -apple-system, BlinkMacSystemFont, sans-serif',
      "--font-display": '"Raleway", system-ui, -apple-system, sans-serif',
    };
    const q = firstScreenFontQueries((t) => platform[t] ?? "");
    expect(q.filter((x) => x.includes('"Montserrat"'))).toHaveLength(3);
    expect(q.filter((x) => x.includes('"Raleway"'))).toHaveLength(2);
    expect(q.some((x) => x.includes("Jost") || x.includes("Cormorant"))).toBe(false);
  });

  it("asks for nothing when the tokens are unset or generic, rather than guessing a face", () => {
    expect(firstScreenFontQueries(() => "")).toEqual([]);
    expect(firstScreenFontQueries(() => "system-ui, sans-serif")).toEqual([]);
  });

  it("does not ask twice when body and display are the same family", () => {
    const q = firstScreenFontQueries(() => '"Jost", sans-serif');
    expect(q).toEqual(['400 1em "Jost"', '500 1em "Jost"', '600 1em "Jost"', '700 1em "Jost"']);
  });

  it("cannot be steered into a malformed descriptor by a quote in a family name", () => {
    const q = firstScreenFontQueries(() => "'Evil\" Face', serif");
    for (const x of q) expect(x).toMatch(/^\d{3} 1em "[^"]+"$/);
  });

  it("covers body and display, which every route renders", () => {
    expect(FIRST_SCREEN_FACES.map(([t]) => t)).toEqual(["--font-body", "--font-display"]);
  });
});

describe("warmFirstScreenFonts", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeDoc(tokens: Record<string, string>, load: (q: string) => Promise<unknown>) {
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (t: string) => tokens[t] ?? "" }));
    return { documentElement: {}, fonts: { load } } as unknown as Document;
  }

  it("asks the browser for each face, before anything renders", () => {
    const load = vi.fn(() => Promise.resolve([]));
    warmFirstScreenFonts(fakeDoc({ "--font-body": '"Jost"', "--font-display": '"Cormorant Garamond"' }, load));
    expect(load.mock.calls.map((c) => c[0])).toEqual([
      '400 1em "Jost"',
      '500 1em "Jost"',
      '600 1em "Jost"',
      '600 1em "Cormorant Garamond"',
      '700 1em "Cormorant Garamond"',
    ]);
  });

  it("swallows a failed load, because the fallback face is the page without it", async () => {
    const load = vi.fn(() => Promise.reject(new Error("network")));
    expect(() => warmFirstScreenFonts(fakeDoc({ "--font-body": '"Jost"' }, load))).not.toThrow();
    await Promise.resolve();
    expect(load).toHaveBeenCalled();
  });

  it("does nothing where the Font Loading API is missing", () => {
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => '"Jost"' }));
    expect(() => warmFirstScreenFonts({ documentElement: {} } as unknown as Document)).not.toThrow();
  });
});
