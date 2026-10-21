/**
 * The village's theme is built once per theme, not once per page.
 *
 * Every page the server sends splices the stylesheet's version into the shell
 * (shellWithTheme, server/routes/brandTheme.ts), and the version is a hash of
 * the CSS that buildThemeCss derives from the brand. With a seed set, that
 * derivation is deriveTheme's colour math: 1.2 to 1.9 ms of synchronous CPU a
 * call, measured 2026-10-20, and production has a seed. It used to run on
 * every page. These cases hold that it runs once while the brand stands still,
 * and that a saved brand still moves the link on the very next request, which
 * is the promise the versioned URL exists to keep.
 *
 * getBrand() rebuilds its document on every call, so each case below hands
 * over a FRESH object with equal content, exactly as server/index.ts does.
 */
import { describe, expect, it, vi } from "vitest";

const built = vi.hoisted(() => ({ n: 0 }));
vi.mock("./lib/themeCss", async (importOriginal) => {
  const real = await importOriginal<typeof import("./lib/themeCss")>();
  return {
    ...real,
    buildThemeCss: (theme: Parameters<typeof real.buildThemeCss>[0]) => {
      built.n++;
      return real.buildThemeCss(theme);
    },
  };
});

import { buildThemeCss, themeCssVersion } from "./lib/themeCss";
import { shellWithTheme } from "./routes/brandTheme";

const SHELL = '<head><link rel="stylesheet" href="/api/brand/theme.css" /></head>';
const brandOf = (seed: string) => () => ({ theme: { seed, character: "grounded", place: "forest" } });
const versionIn = (html: string) => /theme\.css\?v=([0-9a-f]+)/.exec(html)?.[1];
const expected = (seed: string) => {
  const css = buildThemeCss(brandOf(seed)().theme);
  built.n--; // that call was the test's own
  return themeCssVersion(css);
};

describe("shellWithTheme", () => {
  it("derives the theme once for fifty pages of an unchanged brand", () => {
    const want = expected("#16342a");
    const before = built.n;
    for (let i = 0; i < 50; i++) expect(versionIn(shellWithTheme(SHELL, brandOf("#16342a")))).toBe(want);
    expect(built.n - before).toBe(1);
  });

  it("moves the link on the first page after the brand changes, and only rebuilds then", () => {
    const greenVersion = expected("#16342a");
    const blueVersion = expected("#2d4a8a");
    expect(blueVersion).not.toBe(greenVersion);
    const before = built.n;
    expect(versionIn(shellWithTheme(SHELL, brandOf("#2d4a8a")))).toBe(blueVersion);
    expect(versionIn(shellWithTheme(SHELL, brandOf("#2d4a8a")))).toBe(blueVersion);
    expect(built.n - before).toBe(1);
    // And back: the old brand is a new key again, never a stale hit.
    expect(versionIn(shellWithTheme(SHELL, brandOf("#16342a")))).toBe(greenVersion);
    expect(built.n - before).toBe(2);
  });

  it("treats an absent theme as its own key", () => {
    const before = built.n;
    const none = () => ({});
    const v = versionIn(shellWithTheme(SHELL, none));
    expect(v).toBe(themeCssVersion(""));
    expect(versionIn(shellWithTheme(SHELL, none))).toBe(v);
    expect(built.n - before).toBe(1);
  });
});
