/**
 * A LOCAL BUTTON NEVER CARRIES BRAND TEAL INK WITHOUT A LIGHT GROUND OF ITS OWN
 * (batch 158, the lead's screenshot of Profile, Your journal).
 *
 * `client/src/components/journal/ui.ts` kept its own BTN_* strings, "light
 * surfaces only": `text-teal-deep` on `bg-card`. On the night world `bg-card`
 * is dark, so the profile's "Weekly pulse" and "Feedback" were dark teal on
 * night, nearly invisible. `text-teal-deep` is a fixed brand tone, so it only
 * reads where the button brings its own light ground (`bg-white`, a 50 tint).
 * Every `BTN_*` constant in the client is read here, and one that sets brand
 * teal text with no light ground in the same string fails, naming its file.
 * The fix is the journey's own BTN_PRIMARY / BTN_SECONDARY
 * (components/journey/look.ts) or semantic tokens that read on both grounds.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const LIGHT_GROUND = /\bbg-(white|[a-z]+-50|[a-z]+-100)\b/;
const TEAL_INK = /(^|[\s`"'])text-teal-deep(\s|$|[`"'])/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Each `const BTN_X = ...;` in a file, its name and the text of its value. */
export function buttonStrings(source: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  const re = /\bconst (BTN_[A-Z0-9_]*)\s*=\s*([\s\S]*?);\s*\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push({ name: m[1], value: m[2] });
  return out;
}

export function tealOnNight(value: string): boolean {
  return TEAL_INK.test(value) && !LIGHT_GROUND.test(value);
}

describe("local BTN_* strings and their ground", () => {
  it("knows the shape it guards", () => {
    expect(tealOnNight("`rounded-xl border border-teal-deep bg-card px-4 font-semibold text-teal-deep`")).toBe(true);
    expect(tealOnNight("`rounded-xl bg-white text-teal-deep`")).toBe(false);
    expect(tealOnNight("`rounded-xl bg-teal-deep text-white`")).toBe(false);
    expect(buttonStrings('export const BTN_A =\n  `x text-teal-deep`;\nexport const BTN_B = "y";\n').map((b) => b.name)).toEqual(["BTN_A", "BTN_B"]);
  });

  it("finds none in the client with brand teal ink and no light ground", () => {
    const bad: string[] = [];
    for (const f of files(ROOT)) {
      const src = fs.readFileSync(f, "utf8");
      if (!src.includes("BTN_")) continue;
      for (const b of buttonStrings(src)) if (tealOnNight(b.value)) bad.push(`${path.relative(ROOT, f)}: ${b.name}`);
    }
    expect(bad).toEqual([]);
  });
});
