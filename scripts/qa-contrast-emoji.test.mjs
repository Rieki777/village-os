/**
 * The contrast scanner's emoji rule, driven against the glyphs that produced
 * false failures and the text that must keep being measured.
 *
 * WHY THIS LIVES IN `scripts/` AND NOT BESIDE THE SCANNER. `run-self-tests.mjs`
 * globs THIS directory only. A fixture in `scripts/qa/` would be a test nobody
 * runs, which is the exact shape that file's header warns about: five
 * self-tests once sat unnamed and ran nowhere at all.
 *
 * WHY IT EXISTS. `scripts/qa/contrast.mjs` reported three AA failures on
 * `/co-creators-guide` at 2.33:1 for the emoji in its step cards. A colour
 * emoji is painted by the emoji FONT; `color` does not move it, so the scanner
 * was comparing the page's inherited near-black - a value nothing on screen
 * uses - against a card those glyphs never took their ink from. The arithmetic
 * was right and the ground was wrong, which is the same family as the gradient
 * and sibling-image bugs already recorded in that scanner's header.
 *
 * WHY IT IS NOT JUST THE THREE GLYPHS. The first predicate stripped a
 * pictographic character class and nothing else, and a keycap fixture caught
 * what that misses: `1` + U+FE0F + U+20E3 renders as a colour glyph, but its
 * base is an ASCII digit, so the digit survived the strip and the element read
 * as ordinary text. The control found the gap before it shipped. The negatives
 * matter as much: a rule that swallowed "🌀 Spiral" or an em dash would hide
 * real failures instead of false ones.
 */
import { emojiOnly, EMOJI_PATTERNS } from "./qa/contrast.mjs";

let checks = 0;
let failures = 0;

function check(label, got, want) {
  checks += 1;
  if (got === want) return;
  failures += 1;
  console.error(`FAIL: ${label}\n  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`);
}

// PAINTED BY THE FONT — not measurable, must never be reported as a failure.
const PAINTED = [
  ["\u{1F300}", "the spiral that failed on /co-creators-guide"],
  ["✍️", "writing hand plus variation selector 16, the second failure"],
  ["\u{1F331}", "the seedling, the third"],
  ["\u{1F300}\u{1F331}", "two emoji with nothing between them"],
  ["  \u{1F300}  ", "surrounding whitespace is not text"],
  ["\u{1F469}‍\u{1F373}", "a zero-width-joiner sequence"],
  ["\u{1F44D}\u{1F3FD}", "a skin-tone modifier"],
  ["1️⃣", "a keycap — the case the control caught"],
  ["#⃣", "a keycap without the variation selector"],
];

// PAINTED BY `color` — must stay measurable, or a real failure goes unseen.
const INK = [
  ["\u{1F300} Spiral", "an emoji BESIDE text is still text"],
  ["Learn About the Gratitude Economy", "the /opportunities link"],
  ["7 years+", "the /resident label"],
  ["— an em dash", "punctuation is not pictographic"],
  ["© 2026", "the copyright sign is not an emoji"],
  ["12", "a bare number is not a keycap"],
  ["#hashtag", "a hash without U+20E3 is not a keycap"],
];

for (const [s, why] of PAINTED) check(`painted by the font: ${why}`, emojiOnly(s), true);
for (const [s, why] of INK) check(`painted by color: ${why}`, emojiOnly(s), false);

// The probe rebuilds these in the browser, so they have to survive
// `new RegExp(src, "gu")`. A pattern that only works as a literal would throw
// there and nowhere here.
for (const [name, src] of Object.entries(EMOJI_PATTERNS)) {
  let built = null;
  try {
    built = new RegExp(src, "gu");
  } catch {
    built = null;
  }
  check(`EMOJI_PATTERNS.${name} rebuilds under the unicode flag`, built !== null, true);
}

// The rule must not be vacuous: a predicate that answered `false` to
// everything would pass every INK case above and hide the whole point.
check("the rule actually fires on something", PAINTED.some((c) => emojiOnly(c[0])), true);

if (failures > 0) {
  console.error(`\n${failures} of ${checks} check(s) FAILED.`);
  process.exit(1);
}
console.log(`qa-contrast-emoji: ${checks} check(s) passed`);
