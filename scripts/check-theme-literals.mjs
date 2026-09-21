#!/usr/bin/env node
/**
 * The theme-literal guard: a village's brand colour should reach every
 * surface a member looks at. It cannot reach a colour baked into the
 * compiled bundle as a literal.
 *
 * THE MECHANISM THIS PROTECTS. shared/brandTokens.ts derives a full palette
 * from a founder's seed colour; server/lib/themeCss.ts emits it as a
 * `:root:root { --tone-brand: ...; --primary: ...; ... }` stylesheet that
 * beats the platform defaults in client/src/index.css regardless of load
 * order (docs/DESIGN_TOKENS_SPEC.md §6.4). Any `--tone-*` or `--color-*`
 * reference — `var(--tone-brand, #157f7d)`, or a Tailwind utility generated
 * from one of index.css's `@theme inline` entries such as `bg-teal-deep` —
 * picks up that override for free. A hex code, or an rgb()/hsl()/oklch()
 * call with literal numbers, written directly into a className or a style
 * value, cannot: it is baked into the compiled bundle at build time and a
 * founder's colour never reaches it.
 *
 * WHAT COUNTS AS SAFE. `var(--anything, #fallback)` is the platform's own
 * established pattern (CircleScene.tsx, MoonGlyph.tsx, YearWheel.tsx,
 * MobileFab.tsx all do this deliberately) — the literal there is a FALLBACK
 * for a village that has not picked a seed colour yet, not a value the theme
 * can never reach. This guard strips every `var(...)` span (fallback and
 * all, one level of nested parens allowed for a nested function like
 * `var(--x, rgba(0,0,0,0))`) before it looks for literals, so that pattern
 * costs nothing.
 *
 * WHAT DOES NOT COUNT. shared/**, server/**, and every non-.tsx file: the
 * harm here is specifically compiled-in client colour that a browser paints
 * without ever asking the server for a theme. index.css itself is the
 * token layer, not a bypass of it, and is out of this lane's ownership besides.
 *
 * THE RATCHET, same discipline as scripts/check-image-budget.mjs: the
 * baseline in scripts/theme-literals-baseline.json is a per-file count that
 * may only ever fall, `--update-baseline` REFUSES to write a total higher
 * than the one already committed (check-brand-refs.mjs's baseline does not
 * refuse this; this one must), and a brand-new file starts at zero so it is
 * born clean.
 *
 * A genuine false positive (an id, a non-colour string that happens to look
 * like a hex triplet) gets an inline `theme-ok: <reason>` on the line, same
 * spelling convention as check-brand-refs.mjs's `brand-ok:`.
 *
 * A SECOND CHECK LIVES HERE, AND IT IS NOT A RATCHET: white text on the soft
 * brand tone. `bg-teal` (and its alias `bg-ocean`) paints --tone-brand-soft,
 * which shared/brandTokens.ts derives at a FIXED light lightness (L 0.66)
 * for every seed, so no founder's colour can make white text legible on it.
 * Measured with buildThemeCss across the nine seeds and six cards the token
 * tests use, white on it is 1.67 to 3.00:1, and 2.52:1 on an unseeded fork.
 * The pairing that does carry white is `bg-teal-deep` (--tone-brand, derived
 * so white clears 4.5:1 for every seed), which is also the site's primary
 * button convention. The theme layer can re-colour both tones; it cannot
 * rescue this pairing, which is why it is refused outright here instead of
 * counted down. The scan is described where PAIRING_HELD is declared below.
 *
 * The same check reads the HOVER, FOCUS and ACTIVE states, because a button
 * is read while a pointer rests on it too. White text may not move onto the
 * soft tone there either, nor onto the mid tone (`bg-teal-light`, derived for
 * white at 3:1 only), nor onto a translucent brand (`hover:bg-teal-deep/90`,
 * `hover:bg-primary/90`), nor may a white-on-brand button fade
 * (`hover:opacity-90`). --tone-brand is derived so white only just clears 4.5
 * for a light seed, so any fade over a light page drops it under: at /90, 28
 * of 55 villages, 3.79:1 worst. The hover that carries white is
 * `hover:bg-teal-deep-dark`, --tone-brand-hover, a derived step from the brand
 * that white clears at 6.33:1 or better for every seed.
 *
 * Usage:
 *   node scripts/check-theme-literals.mjs                    # the gate
 *   node scripts/check-theme-literals.mjs --json              # machine readable
 *   node scripts/check-theme-literals.mjs --update-baseline   # only ever downward
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./brand-strip.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOT = path.join(ROOT, "client", "src");
const BASELINE_PATH = path.join(ROOT, "scripts", "theme-literals-baseline.json");

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Remove every `var(...)` span from a line, fallback literal and all, before
 * hex/rgb/hsl/oklch matching runs. Written as a scanner rather than a regex
 * because a fallback can itself be a function call — `var(--nat-dawn-high,
 * rgba(246,201,138,0))` (client/src/components/natural/Celebration.tsx) — and
 * a naive `var\([^)]*\)` stops at the FIRST close-paren, which is the inner
 * call's, leaving `))` and a truncated dangling fragment behind that a
 * regex-only pass would then need a second special case to not mis-scan.
 */
function stripVarCalls(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line.startsWith("var(", i)) {
      let depth = 1;
      let j = i + 4;
      while (j < line.length && depth > 0) {
        if (line[j] === "(") depth += 1;
        else if (line[j] === ")") depth -= 1;
        j += 1;
      }
      i = j; // skip the whole var(...) span, however deep it nested
      continue;
    }
    out += line[i];
    i += 1;
  }
  return out;
}

/** Hex triplets/sextuplets, and rgb()/rgba()/hsl()/hsla()/oklch() calls that
 *  open on a literal number rather than a var() reference (already stripped
 *  above). `\b` on the hex form so a 7+ char token (an id, a hash) doesn't
 *  false-positive on its first six characters. */
const HEX = /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g;
const FUNC = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(\s*[-\d.]/g;

function countLiterals(line) {
  const stripped = stripVarCalls(line);
  const hexHits = stripped.match(HEX) ?? [];
  const funcHits = stripped.match(FUNC) ?? [];
  return hexHits.length + funcHits.length;
}

/**
 * `theme-ok:` waives a line the same way check-brand-refs.mjs's `brand-ok:`
 * does — but a colour hit is often a five-hex-wide generated Tailwind
 * arbitrary-selector string (client/src/components/ui/chart.tsx), where a
 * trailing same-line comment would make an already-unreadable line worse. So
 * the marker also arms across ONE line boundary: a comment-only line ending
 * in `theme-ok:` waives the next line that actually carries a literal, in
 * addition to the same-line case. Either way the reason must be written down,
 * not just the marker.
 */
function scanFile(file) {
  const ext = path.extname(file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let count = 0;
  let waived = 0;
  const hits = [];
  let inBlock = false;
  let pendingWaiver = false;
  lines.forEach((line, i) => {
    const opensBlock = /\/\*/.test(line) && !/\*\//.test(line);
    const closesBlock = /\*\//.test(line);
    const wasInBlock = inBlock;
    if (opensBlock) inBlock = true;
    if (closesBlock) inBlock = false;
    const hasMarker = /theme-ok:/.test(line);
    const code = wasInBlock ? "" : stripComments(line, ext);
    const n = countLiterals(code);
    const isBlankOrCommentOnly = code.trim() === "";

    if (hasMarker) {
      if (n > 0) { waived += 1; pendingWaiver = false; return; }
      // Comment-only marker line: arm the waiver and keep looking — a
      // multi-line comment (chart.tsx) can put several wrapped lines between
      // the marker and the literal it excuses.
      pendingWaiver = true;
      return;
    }
    if (isBlankOrCommentOnly) return; // continuation/blank line: leave pendingWaiver as-is
    if (n > 0 && pendingWaiver) {
      waived += 1;
      pendingWaiver = false;
      return;
    }
    pendingWaiver = false;
    if (n > 0) {
      count += n;
      hits.push({ line: i + 1, text: line.trim().slice(0, 140) });
    }
  });
  return { count, waived, hits };
}

/**
 * THE SOFT-GROUND PAIRING SCAN (the second check; see the header).
 *
 * WHAT IT READS. Class lists, not lines: every double- or single-quoted
 * string and every template literal in a .tsx file under client/src, after
 * comments are blanked. A template contributes its static text, each quoted
 * literal inside a `${...}` on its own, and each of those joined to the
 * static text, because `bg-teal ${on ? "text-white" : ""}` renders the
 * pairing on one branch. White ink is an unprefixed `text-white` or
 * `text-primary-foreground` (white in the light scheme, the only one there
 * is), an opacity suffix allowed.
 *
 * AT REST, a pairing is an UNPREFIXED `bg-teal` or `bg-ocean` (an opacity
 * suffix too) with white ink in one class list. `-deep`, `-light` and `-band`
 * are different tokens and are never matched here: `bg-teal-deep` is the
 * pairing white text is meant for.
 *
 * UNDER A STATE, a token is read when its variant chain names hover, focus,
 * focus-visible, focus-within or active (a `group-` or `peer-` form too, and
 * inside an arbitrary chain such as shadcn's `[a&]:hover:`). The ink under the
 * state is a state `text-*` colour if the list has one, else the resting ink.
 * With white ink it refuses a state ground of:
 *  - `bg-teal` or `bg-ocean`, the soft tone, at any opacity;
 *  - `bg-teal-light`, the mid tone: white on it is 3.00 to 13.79:1, below 4.5
 *    for 30 of 55 villages;
 *  - `bg-teal-deep/NN` or `bg-primary/NN` below 100: a translucent brand;
 *  - `opacity-NN` below 100 when the resting ground is `bg-teal-deep`,
 *    `bg-primary` or `bg-teal-light`: the whole button fades toward the page.
 *    (A white-on-teal-light button fails AT REST for 30 villages as well.
 *    This check does not refuse that resting pairing; it was reported with
 *    the change that added the state half.)
 * A chain that also names `disabled` is not read (WCAG exempts an inactive
 * control), nor is one that names `dark` (the theme is light only).
 *
 * WHAT IT DOES NOT READ, stated so nobody takes a green for more than it is:
 *  - Grounds that are not the brand family. A fixed colour's fade, such as
 *    `bg-gold hover:opacity-90`, is not refused here.
 *  - Attribute states: `data-[state=open]:`, `aria-selected:` and the like.
 *    None paints the soft tone or a faded brand today.
 *  - Stylesheets. `.btn-amora:hover` lives in index.css, and
 *    client/src/lib/brandGroundContrast.test.ts resolves and measures it.
 *  - A class list split across strings, such as `cn("text-white", "hover:bg-teal")`:
 *    each string is its own list, so the two are never joined.
 *  - A colour that arrives through data. `color: "bg-teal"` in an object,
 *    rendered under a `text-white` icon somewhere else, is two literals in
 *    two places, and no text scan can join them.
 *  - Test files. A test may need to write the pairing down.
 *
 * THE FLOOR. A scan that silently finds nothing reads exactly like a clean
 * tree, so every run prints its denominator (files, class lists, state grounds
 * read) and how often it saw each CONVENTION: `bg-teal-deep` with
 * `text-white` at rest, and white text hovering to `bg-teal-deep-dark`. The
 * site's primary buttons use both by the dozen. If either known positive reads
 * zero, the extractor is broken, and the check fails instead of passing.
 *
 * HELD FOR A RULING. An entry here is a known defect whose fix is a design
 * call rather than a mechanical one, and it is printed on every run. It counts
 * refused class lists in the file, at rest and under a state together. The
 * count is EXACT: one more fails, and one fewer fails too, so a hold cannot
 * outlive the fix that makes it stale. An empty map is valid: nothing is held.
 */
const PAIRING_HELD = {
  // Empty since 2026-09-21. The Housing hero was held here, white type on the
  // soft tone, until Rye ruled "band colour": it now sits on bg-teal-band with
  // a full-white paragraph.
};

const SOFT_GROUND = /^bg-(?:teal|ocean)(?:\/\d+)?$/;
const WHITE_INK = /^text-(?:white|primary-foreground)(?:\/\d+)?$/;
const QUOTED = /"([^"\n]*)"|'([^'\n]*)'/g;

/** A `text-*` utility that sets size, alignment or wrapping, not colour. */
const TEXT_NOT_COLOUR = /^text-(?:xs|sm|base|lg|[2-9]?xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/;
const STATE_VARIANT = /^(?:group-|peer-)?(?:hover|focus|focus-visible|focus-within|active)(?:\/[\w-]+)?$/;
const UNREAD_VARIANT = /^(?:dark|disabled|aria-disabled|group-disabled|peer-disabled)$/;
/** A resting ground in the brand family that a white-text button fades from. */
const FADING_GROUND = /^bg-(?:teal-deep|teal-light|primary)$/;
const HOVER_PARTNER = "bg-teal-deep-dark";

/** Why white text may not sit on this ground under a state, or null. */
function refusedStateGround(utility, restingBrand) {
  if (SOFT_GROUND.test(utility)) return "white text onto the soft tone (bg-teal), 1.67 to 3.00:1";
  if (/^bg-teal-light(?:\/\d+)?$/.test(utility)) return "white text onto the mid tone (bg-teal-light), under 4.5 for 30 of 55 villages";
  const fade = /^bg-(?:teal-deep|primary)\/(\d+)$/.exec(utility);
  if (fade && Number(fade[1]) < 100) return `white text onto a translucent brand (${utility}), under 4.5 for 28 of 55 villages at /90`;
  const dim = /^opacity-(\d+)$/.exec(utility);
  if (dim && Number(dim[1]) < 100 && restingBrand) return `a white-on-brand button fading (${utility}), under 4.5 for 28 of 55 villages at opacity-90`;
  return null;
}

/** `[a&]:hover:bg-teal` into its variant chain and utility; a `:` inside brackets is not a separator. */
function splitVariants(token) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const c of token) {
    if (c === "[") depth += 1;
    if (c === "]") depth -= 1;
    if (c === ":" && depth === 0) { parts.push(cur); cur = ""; } else cur += c;
  }
  parts.push(cur);
  return { variants: parts.slice(0, -1), utility: parts[parts.length - 1].replace(/^!|!$/g, "") };
}

const isStateChain = (variants) =>
  variants.some((v) => STATE_VARIANT.test(v)) && !variants.some((v) => UNREAD_VARIANT.test(v));

/**
 * Replace every comment with spaces, keeping each newline where it was so an
 * offset still maps to its line. String-aware, so `https://` inside a string
 * is not a comment; a quote or apostrophe string ends at its line, so an
 * apostrophe in JSX text ("don't") can cost the rest of its own line at most.
 */
function blankComments(src) {
  let out = "";
  let quote = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\" && i + 1 < src.length) { out += src[i + 1]; i += 1; continue; }
      if (c === quote || (c === "\n" && quote !== "`")) quote = null;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i += 1; }
      i -= 1; // hand the newline back to the loop
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i += 1) out += src[i] === "\n" ? "\n" : " ";
      i -= 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c;
  }
  return out;
}

/** Every class list in comment-blanked code, each with the offset it starts at. */
function classLists(code) {
  const lists = [];
  const outsideTemplates = code.replace(/`(?:[^`\\]|\\[\s\S])*`/g, (whole, at) => {
    const body = whole.slice(1, -1);
    let staticText = "";
    let expr = "";
    let depth = 0;
    const inner = [];
    for (let i = 0; i < body.length; i += 1) {
      const c = body[i];
      if (depth === 0) {
        if (c === "$" && body[i + 1] === "{") { depth = 1; expr = ""; staticText += " "; i += 1; continue; }
        staticText += c;
        continue;
      }
      if (c === "{") depth += 1;
      if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          for (const m of expr.matchAll(QUOTED)) inner.push(m[1] ?? m[2]);
          continue;
        }
      }
      expr += c;
    }
    lists.push({ text: staticText, at });
    for (const s of inner) {
      lists.push({ text: s, at });
      lists.push({ text: `${staticText} ${s}`, at });
    }
    return whole.replace(/[^\n]/g, " ");
  });
  for (const m of outsideTemplates.matchAll(QUOTED)) lists.push({ text: m[1] ?? m[2], at: m.index });
  return lists;
}

function scanPairings(allFiles) {
  const result = {
    files: 0, testsSkipped: 0, lists: 0, convention: 0,
    stateGrounds: 0, whiteStateLists: 0, hoverConvention: 0, restHits: 0, stateHits: 0, hits: {},
  };
  for (const file of allFiles) {
    if (file.endsWith(".test.tsx")) { result.testsSkipped += 1; continue; }
    result.files += 1;
    const src = fs.readFileSync(file, "utf8");
    const code = blankComments(src);
    const paired = new Set();
    const conventional = new Set();
    const stateGrounds = new Set();
    const whiteState = new Set();
    const hoverConventional = new Set();
    const hit = (at, kind, why) => {
      paired.add(at);
      const line = code.slice(0, at).split("\n").length;
      result[kind === "rest" ? "restHits" : "stateHits"] += 1;
      (result.hits[rel(file)] ??= []).push({ line, kind, why, text: src.split("\n")[line - 1].trim().slice(0, 140) });
    };
    for (const { text, at } of classLists(code)) {
      result.lists += 1;
      const tokens = text.split(/\s+/).filter(Boolean);
      if (tokens.includes("bg-teal-deep") && tokens.includes("text-white")) conventional.add(at);

      const parsed = tokens.map(splitVariants);
      const resting = parsed.filter((p) => p.variants.length === 0).map((p) => p.utility);
      const state = parsed.filter((p) => p.variants.length > 0 && isStateChain(p.variants)).map((p) => p.utility);
      for (const u of state) if (/^(?:bg|opacity)-/.test(u)) stateGrounds.add(`${at}|${u}`);
      const stateInk = state.filter((u) => u.startsWith("text-") && !TEXT_NOT_COLOUR.test(u));
      const whiteUnderState =
        stateInk.some((u) => WHITE_INK.test(u)) ||
        (resting.some((u) => WHITE_INK.test(u)) && !stateInk.some((u) => !WHITE_INK.test(u)));
      if (whiteUnderState && state.some((u) => /^(?:bg|opacity)-/.test(u))) whiteState.add(at);
      if (whiteUnderState && state.includes(HOVER_PARTNER)) hoverConventional.add(at);

      if (paired.has(at)) continue;
      if (resting.some((u) => SOFT_GROUND.test(u)) && resting.some((u) => WHITE_INK.test(u))) {
        hit(at, "rest", "white text on the soft tone (bg-teal), 1.67 to 3.00:1");
        continue;
      }
      if (!whiteUnderState) continue;
      const restingBrand = resting.some((u) => FADING_GROUND.test(u));
      for (const u of state) {
        const why = refusedStateGround(u, restingBrand);
        if (why) { hit(at, "state", why); break; }
      }
    }
    result.convention += conventional.size;
    result.stateGrounds += stateGrounds.size;
    result.whiteStateLists += whiteState.size;
    result.hoverConvention += hoverConventional.size;
    result.hits[rel(file)]?.sort((a, b) => a.line - b.line);
  }
  return result;
}

const files = walk(SCAN_ROOT).sort();
const counts = {};
const details = {};
let totalWaivers = 0;
for (const file of files) {
  const r = rel(file);
  const { count, waived, hits } = scanFile(file);
  totalWaivers += waived;
  if (count > 0) { counts[r] = count; details[r] = hits; }
}
const total = Object.values(counts).reduce((n, v) => n + v, 0);

if (process.argv.includes("--update-baseline")) {
  const baseline = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) : null;
  const baselineTotal = baseline ? Object.values(baseline.files ?? baseline).reduce((n, v) => n + v, 0) : Infinity;
  if (total > baselineTotal) {
    console.error(
      `::error::refusing to raise the theme-literal baseline: ${total} is above the recorded ${baselineTotal}. ` +
      `This number only ever falls. Route the new colour through a --tone-* var or a token-backed Tailwind class ` +
      `(see client/src/index.css's @theme inline block), or wrap a genuine one-off in var(--something, #literal) so ` +
      `it is at least a fallback rather than a dead end.`);
    process.exit(1);
  }
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ totalLiterals: total, files: counts }, null, 2)}\n`,
  );
  console.log(`theme-literal baseline lowered to ${total} across ${Object.keys(counts).length} file(s).`);
  process.exit(0);
}

const pairing = scanPairings(files);
const pairingProblems = [];
for (const [file, hits] of Object.entries(pairing.hits)) {
  const held = PAIRING_HELD[file] ?? 0;
  if (hits.length > held) {
    const rest = hits.filter((h) => h.kind === "rest").length;
    pairingProblems.push({
      file,
      reason: `${rest} white-on-soft pairing(s) at rest and ${hits.length - rest} under hover, focus or active, ${held} held for a ruling`,
      hits,
    });
  }
}
for (const [file, held] of Object.entries(PAIRING_HELD)) {
  const found = pairing.hits[file]?.length ?? 0;
  if (found < held) {
    pairingProblems.push({
      file,
      reason: `the hold is stale: ${held} held, ${found} found. Lower or delete its PAIRING_HELD entry in scripts/check-theme-literals.mjs`,
      hits: [],
    });
  }
}
if (pairing.files === 0 || pairing.convention === 0) {
  pairingProblems.push({
    file: "client/src",
    reason:
      `the scan read ${pairing.files} file(s) and saw the bg-teal-deep + text-white convention ${pairing.convention} time(s). ` +
      `A scan that cannot see a known positive is broken, and its zero proves nothing`,
    hits: [],
  });
}
if (pairing.stateGrounds === 0 || pairing.hoverConvention === 0) {
  pairingProblems.push({
    file: "client/src",
    reason:
      `the state scan read ${pairing.stateGrounds} hover, focus or active ground(s) and saw white text hovering to ` +
      `${HOVER_PARTNER} ${pairing.hoverConvention} time(s). The variant reader cannot see a known positive, so its zero proves nothing`,
    hits: [],
  });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({
    total,
    files: counts,
    waivers: totalWaivers,
    softGroundPairing: {
      filesRead: pairing.files,
      testFilesSkipped: pairing.testsSkipped,
      classLists: pairing.lists,
      conventionSeen: pairing.convention,
      stateGroundsRead: pairing.stateGrounds,
      whiteInkListsWithStateGround: pairing.whiteStateLists,
      hoverConventionSeen: pairing.hoverConvention,
      foundAtRest: pairing.restHits,
      foundUnderState: pairing.stateHits,
      found: Object.fromEntries(Object.entries(pairing.hits).map(([f, h]) => [f, h.length])),
      held: PAIRING_HELD,
    },
  }));
}

const baseline = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) : { totalLiterals: 0, files: {} };
const baselineFiles = baseline.files ?? {};
const baselineTotal = baseline.totalLiterals ?? Object.values(baselineFiles).reduce((n, v) => n + v, 0);

const failures = [];
for (const [file, count] of Object.entries(counts)) {
  const allowed = baselineFiles[file] ?? 0;
  if (count > allowed) {
    failures.push({
      file,
      reason: `${count} theme-bypassing colour literal(s), baseline allows ${allowed} — the ratchet only turns down`,
      hits: details[file].slice(0, 5),
    });
  }
}
// A file dropping out of the baseline entirely, or every file combined
// coming in lower, is fine and expected — only a RISE anywhere fails. The
// per-file check above already catches a rise hidden inside a falling total
// (moving literals into a new file), so the total is reported, not re-gated.

if (failures.length) {
  console.error("\nTHEME-LITERAL GUARD FAILED — a founder's colour cannot reach a literal.\n");
  console.error("Route the colour through a --tone-* CSS var (see client/src/index.css) or a token-backed");
  console.error("Tailwind utility (e.g. teal-deep, teal-band, amber, cream — all @theme inline entries).\n");
  for (const f of failures) {
    console.error(`  ${f.file} — ${f.reason}`);
    for (const h of f.hits) console.error(`      ${f.file}:${h.line}: ${h.text}`);
  }
  console.error(`\nIf a hit is a genuine false positive (not a rendered colour), add \`theme-ok: <reason>\` on that line.`);
  console.error(`If you REMOVED literals, lower the baseline: node scripts/check-theme-literals.mjs --update-baseline\n`);
}

if (pairingProblems.length) {
  console.error("\nSOFT-GROUND PAIRING REFUSED: white text on bg-teal measures 1.67 to 3.00:1 across every seed measured.\n");
  console.error("bg-teal is --tone-brand-soft, derived at a fixed light tone, so no village colour can carry white on it.");
  console.error("Put white text on bg-teal-deep, the primary-button convention: --tone-brand is derived so white clears");
  console.error("4.5:1 on it for every seed, in both colour schemes.");
  console.error("Under hover, focus or active, move it to hover:bg-teal-deep-dark: --tone-brand-hover is a visible step from the");
  console.error("brand that white clears at 6.33:1 or better for every seed. Not the soft or mid tone, and not a fade.\n");
  for (const p of pairingProblems) {
    console.error(`  ${p.file}: ${p.reason}`);
    for (const h of p.hits.slice(0, 8)) console.error(`      ${p.file}:${h.line}: ${h.why}\n          ${h.text}`);
  }
  console.error("");
}

if (failures.length || pairingProblems.length) process.exit(1);

console.log(
  `Theme-literal guard passed. ${total} theme-bypassing colour literal(s) across ${Object.keys(counts).length} file(s) ` +
  `(baseline ${baselineTotal}); ${totalWaivers} waiver(s) in force.`,
);
const heldList = Object.entries(PAIRING_HELD).map(([f, n]) => `${f}: ${n}`).join(", ") || "none";
console.log(
  `Soft-ground pairing check passed. Read ${pairing.files} .tsx file(s) (${pairing.testsSkipped} test file(s) skipped) ` +
  `and ${pairing.lists} class list(s). White on bg-teal/bg-ocean: 0 unheld, held for a ruling: ${heldList}. ` +
  `Known positive, bg-teal-deep with text-white: seen ${pairing.convention} time(s).`,
);
console.log(
  `State pairing check passed. Read ${pairing.stateGrounds} hover, focus or active ground(s), ` +
  `${pairing.whiteStateLists} of them in class lists with white ink. White onto the soft or mid tone, a translucent brand, ` +
  `or a fading brand button: 0 unheld. Known positive, white text hovering to ${HOVER_PARTNER}: seen ${pairing.hoverConvention} time(s).`,
);
