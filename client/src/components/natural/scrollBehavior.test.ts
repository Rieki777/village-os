/**
 * Every scroll the app starts honours "reduce motion".
 *
 * The stylesheet's reduce block sets `scroll-behavior: auto !important`, and
 * that only reaches a scroll that asks the stylesheet. A call that names
 * `behavior: "smooth"` outright overrides it, so a member who asked for less
 * motion still got a half-second glide: measured on the live home page under
 * emulated reduce. `scrollBehavior()` is the one answer, and the scan below
 * keeps a new call site from spelling the glide out by hand.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollBehavior } from "./scrollBehavior";

function stubReduce(reduce: boolean) {
  vi.stubGlobal("window", {
    matchMedia: (q: string) => ({ matches: reduce && q.includes("reduce"), media: q }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scrollBehavior", () => {
  it("glides for a member who has not asked for less motion", () => {
    stubReduce(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("jumps for a member who asked for less motion", () => {
    stubReduce(true);
    expect(scrollBehavior()).toBe("instant");
  });

  it("answers at call time, so a setting changed with the page open counts", () => {
    stubReduce(false);
    expect(scrollBehavior()).toBe("smooth");
    stubReduce(true);
    expect(scrollBehavior()).toBe("instant");
  });

  it("glides when there is no window to ask, the state the rest of the CSS assumes", () => {
    vi.stubGlobal("window", undefined);
    expect(scrollBehavior()).toBe("smooth");
  });
});

/**
 * Files that still spell the glide out, each one held by another change this
 * lane could not edit. The list only shrinks: a file that no longer needs its
 * place here fails the second test until it is taken off.
 */
const STILL_SMOOTH = [
  "components/review/StructureDraft.tsx",
  "pages/CoCreatorsGuide.tsx",
  "pages/Profile.tsx",
  "pages/StructureReview.tsx",
];

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const SMOOTH = /behavior:\s*["']smooth["']/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("scrolls the app starts", () => {
  const files = sourceFiles(SRC);
  const smooth = files
    .filter((f) => SMOOTH.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .sort();

  it("reads the client tree it claims to scan", () => {
    // An empty walk would pass the next test for the wrong reason.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(path.join("components", "ScrollToTop.tsx")))).toBe(true);
  });

  it("never name the glide outright outside the held list", () => {
    expect(smooth.filter((f) => !STILL_SMOOTH.includes(f))).toEqual([]);
  });

  it("keeps the held list honest: every file on it still needs its place", () => {
    expect(STILL_SMOOTH.filter((f) => !smooth.includes(f))).toEqual([]);
  });
});
