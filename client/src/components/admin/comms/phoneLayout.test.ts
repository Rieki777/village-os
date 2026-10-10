import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A COMMS SCREEN NEVER SCROLLS SIDEWAYS ON A PHONE because of its own grid.
 *
 * Found by the end-to-end walk at 390px: Words ran 28px past the screen. Its
 * two-column grid named its columns only from `lg:` up, so below that the grid
 * had one implicit `auto` column, and an `auto` track grows to the widest
 * unbreakable line inside it (a version's subject, held on one line by
 * `truncate`). `truncate` cannot cut a line its own track has grown to fit.
 * `grid-cols-1` is `repeat(1, minmax(0, 1fr))`, a column capped at the screen.
 *
 * jsdom lays nothing out, so this reads the screens' class lists: every grid
 * here that names its columns at a breakpoint must also name them below it.
 * The walk's phone screenshots (overflow named per element) are the proof in
 * a real browser; this is what stops the next screen repeating it.
 */
const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

function gridsOf(file: string): string[] {
  const src = fs.readFileSync(path.join(DIR, file), "utf8");
  return Array.from(src.matchAll(/className=["`{]([^"`}]*\bgrid\b[^"`}]*)["`}]/g))
    .map((m) => m[1])
    .filter((cls) => /\b(sm|md|lg|xl|2xl):grid-cols-/.test(cls));
}

describe("the comms admin screens on a phone", () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));

  it("reads every screen in the folder", () => {
    expect(files).toEqual(expect.arrayContaining(["CommsWords.tsx", "CommsJourneys.tsx"]));
  });

  it("names a column for every grid below the breakpoint that sets its columns", () => {
    const bare: string[] = [];
    for (const f of files) {
      for (const cls of gridsOf(f)) {
        const tokens = cls.split(/\s+/);
        if (!tokens.some((t) => t.startsWith("grid-cols-"))) bare.push(`${f}: ${cls}`);
      }
    }
    expect(bare).toEqual([]);
  });
});
