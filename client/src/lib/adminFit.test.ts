/**
 * ADMIN FITS A PHONE (E10, 2026-10-31): the half of the check that CI can run.
 *
 * CI has no browser, so it cannot measure a page's width. What it can hold is
 * the three things the fix stands on, each of which a refactor could quietly
 * remove, plus the one pattern a single line can reintroduce:
 *
 *  1. The admin <main> carries `admin-fit`, the scope of the CSS rule.
 *  2. The rule itself: form fields lose their intrinsic min-width, long strings wrap.
 *  3. Every rail button names its tab (`data-admin-tab`), which is how
 *     scripts/qa/admin-overflow.mjs finds every tab to measure.
 *  4. No admin file sets a fixed width wider than a 320px phone's content area
 *     unless an `overflow-x-auto` wrapper sits just above it. This is a textual
 *     heuristic (it looks a few lines up for the wrapper), stated as one.
 *
 * The browser half is scripts/qa/admin-overflow.mjs, which walks every tab at
 * 393 and 320px and fails on any page wider than its viewport.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const admin = read("client/src/pages/Admin.tsx");
const css = read("client/src/index.css");

/** 320px phone, minus the icon rail and the main panel's padding. */
const WIDEST_FIXED_PX = 288;

const adminFiles = (): string[] => {
  const dir = path.join(root, "client/src/components/admin");
  const out = ["client/src/pages/Admin.tsx"];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return out;
};

describe("every admin tab fits a phone", () => {
  it("the admin main panel carries the admin-fit scope", () => {
    expect(admin).toMatch(/<main className="[^"]*\badmin-fit\b[^"]*"/);
  });

  it("the scope lets form fields shrink and long strings wrap", () => {
    const fields = /\.admin-fit :where\(input, select, textarea[^)]*\)\s*\{([^}]*)\}/.exec(css);
    expect(fields, "the .admin-fit rule for form fields is missing from client/src/index.css").not.toBeNull();
    expect(fields![1]).toMatch(/min-width:\s*0/);
    expect(fields![1]).toMatch(/max-width:\s*100%/);
    expect(css).toMatch(/\.admin-fit :where\([^)]*\bcode\b[^)]*\)\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it("every rail button names its tab, so the browser sweep can find all of them", () => {
    expect(admin).toMatch(/title=\{label\} data-admin-tab=\{key\}/);
  });

  it(`no admin file fixes a width over ${WIDEST_FIXED_PX}px outside a scrolling wrapper`, () => {
    const offenders: string[] = [];
    for (const file of adminFiles()) {
      const lines = read(file).split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/\b(?:min-w|w)-\[(\d+)px\]/g)) {
          if (Number(m[1]) <= WIDEST_FIXED_PX) continue;
          const above = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
          if (!/overflow-x-auto/.test(above)) offenders.push(`${file}:${i + 1} ${m[0]}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the width check can see a violation (control)", () => {
    const line = '<div className="min-w-[400px]">';
    expect([...line.matchAll(/\b(?:min-w|w)-\[(\d+)px\]/g)].map((m) => Number(m[1]))).toEqual([400]);
  });
});
