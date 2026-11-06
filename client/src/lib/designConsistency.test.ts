/**
 * Two shapes the design census of 2026-10-20 found on public pages, held here
 * so they do not come back. Both are read from the source, because both are
 * properties of a class list rather than of a rendered value.
 *
 * 1. A PAGE'S OWN STICKY BAR SITS UNDER THE SITE HEADER. The header is
 *    `sticky top-0 z-50` (components/Layout.tsx). The co-creators guide gave
 *    its section nav the same position and the same layer, so once scrolled
 *    it slid over the header and hid the home link and the menu button at
 *    every width. A page bar sticks at the header's height (`top-24`) and
 *    below its layer, the way the quest board's filters do.
 *
 * 2. WHITE INK NEVER RIDES A FADING BRAND. Sign in, Create account, Ask to
 *    join and Send the link were a gradient from the brand to the brand at
 *    80%, with only a shadow under the pointer. The brand is derived so white
 *    only just clears 4.5:1 for a light seed, so any fade toward a light page
 *    drops it below (check-theme-literals.mjs measures the hover case: /90 is
 *    28 of 55 villages); and Rye's ruling (2026-09-21) is that a primary
 *    button hovers DARKER. check-theme-literals reads hover, focus and active
 *    grounds; this reads the resting gradient it does not.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx") && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

/** Every string literal or template chunk that looks like a class list, with its line. */
function classLists(file: string): { line: number; classes: string[] }[] {
  const src = fs.readFileSync(file, "utf8");
  const out: { line: number; classes: string[] }[] = [];
  const re = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const text = (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
    out.push({ line: src.slice(0, m.index).split("\n").length, classes: text.split(/\s+/).filter(Boolean) });
  }
  return out;
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const files = tsxFiles(SRC);

describe("design consistency guards", () => {
  it("reads the source it claims to read", () => {
    // A guard that scanned nothing would pass. The header itself is the
    // known positive for the first rule.
    expect(files.length).toBeGreaterThan(300);
    const layout = files.find((f) => rel(f) === "components/Layout.tsx")!;
    expect(classLists(layout).some((c) => ["sticky", "top-0", "z-50"].every((k) => c.classes.includes(k)))).toBe(true);
  });

  it("no page bar takes the site header's position and layer", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (rel(f) === "components/Layout.tsx") continue;
      for (const c of classLists(f)) {
        if (["sticky", "top-0", "z-50"].every((k) => c.classes.includes(k))) offenders.push(`${rel(f)}:${c.line}`);
      }
    }
    expect(offenders, "stick under the header instead: `top-24` and a layer below z-50").toEqual([]);
  });

  it("no white-ink control rests on a gradient that fades the brand", () => {
    const offenders: string[] = [];
    const fading = /^(from|via|to)-(teal-deep|primary)\/\d+$/;
    for (const f of files) {
      for (const c of classLists(f)) {
        const white = c.classes.includes("text-white") || c.classes.includes("text-primary-foreground");
        const gradient = c.classes.some((k) => k.startsWith("bg-gradient-to-"));
        if (white && gradient && c.classes.some((k) => fading.test(k))) offenders.push(`${rel(f)}:${c.line}`);
      }
    }
    expect(offenders, "use bg-teal-deep with hover:bg-teal-deep-dark").toEqual([]);
  });
});
