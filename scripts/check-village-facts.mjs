/**
 * The village-fact guard: no NEW hardcoded village facts in user-facing copy.
 *
 * NO SHEBANG, and it has to stay that way. Every other guard in this directory
 * that is only ever RUN opens with `#!/usr/bin/env node`, and this one is
 * IMPORTED as well: `scripts/check-village-facts.test.mjs` takes its rules and
 * drives them directly. That import is plain node today, which handles a
 * shebang without complaint. The line stays out anyway, for the reason
 * `scripts/check-identity-keys.mjs` records after paying for it: the moment
 * anything under vitest.config.ts's globs imports a guard, the file goes
 * through Vite's transform as well, and a shebang together with CRLF line
 * endings makes that transform throw `SyntaxError: Invalid or unexpected
 * token`. Either one alone is fine, which is how that ran green half a dozen
 * times on an LF working copy and failed the moment a checkout rewrote the file
 * with CRLF. Every caller runs this as `node scripts/check-village-facts.mjs`,
 * so a shebang would buy nothing. Its own test asserts the line is absent.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 *
 * In one day this platform was found publishing, under every village's name,
 * with no admin field able to change any of it: four housing price bands with
 * square footages and a Reserve button, "Total Acres" over a number a village
 * meant as hectares, one token's name as display text in 93 places across 29
 * client files, a real person's first name compiled into every fork
 * (`setFormSuccess("Thank you! Jess will be in touch within 48 hours.")`),
 * hardcoded USD bands in the dropdown on the page that collects money, eight
 * more USD bands with no settings hook at all, a deposit band, a hard "$"
 * prefix, and "150+ home sites" stated under a tile that hides when unset.
 *
 * Every one survived because nothing was looking. Each was found by a person
 * or an agent reading a page, never by a gate.
 *
 * ── WHAT THE EXISTING GUARDS CANNOT SEE ────────────────────────────────────
 *
 * `check-identity-keys.mjs` is the closest precedent and this copies its
 * posture wholesale. Its scope is one file: `shared/gameConfig.ts`. It guards
 * the config and never looks at the pages.
 *
 * `check-brand-refs.mjs` matches WORDS, from a list of four proper nouns, and
 * none of these facts contains one. "$88 Grove" and "Total Acres" and "Thank
 * you! Jess will be in touch" carry no village's name to match on. It also
 * exempts seventeen SHOPFRONT pages by a founder decision, and those pages are
 * where the money and the units live. That decision is about a village's own
 * PROSE. It was never a decision to let a price band with a submit button
 * travel to a fork, so this guard reads the shopfront too, for facts rather
 * than for names. Whose village it is stays brand-refs' question.
 *
 * `check-theme-literals.mjs` is the scanning half: how to walk client files,
 * what to exclude, how to report, and a ratchet that only turns down.
 *
 * This guard is the union. identity-keys' posture at theme-literals' scope.
 *
 * ── WHAT IT DENIES ─────────────────────────────────────────────────────────
 *
 * A member or an investor reads it, and it is the village's to choose:
 *
 *   money        a currency amount or symbol in display text
 *   unit         an area or size unit asserted in display text
 *   token-name   the recognition token's name as a literal
 *   value-token  the value token's name as a literal
 *   member-name  the member noun as a literal
 *   person-name  a specific person named in copy shown to users
 *
 * The four configurable names are read through `client/src/hooks/useTokenNames
 * .ts` (`useTokenName`, `useTokenNameLower`, `useValueTokenName`) and
 * `client/src/hooks/useVillageName.ts` (`useVillageName`). The live config at
 * `GET /api/game/config` answers with `currency.name`, `currency.value.name`
 * and `project.memberName`, so every one of these has somewhere to be read
 * from.
 *
 * THE VILLAGE'S OWN NAME IS NOT A RULE HERE, deliberately, and this is the one
 * narrowing from the brief worth stating out loud. `check-brand-refs.mjs`
 * already owns that word with its own per-file ratchet, its own waiver marker
 * and the shopfront decision above. A second guard counting the same word
 * would make one fix have to lower two baselines, and on the shopfront it
 * would reverse a decision the founder took. `useVillageName` is still the
 * right accessor and brand-refs is still the gate that says so.
 *
 * ── WHAT IT MUST NOT FLAG ──────────────────────────────────────────────────
 *
 * A guard that cries wolf gets deleted, so the exclusions are structural
 * rather than a list of exceptions. The scan runs over the TypeScript AST, the
 * way `check-voice.mjs` does, and reads only real copy: JSX text, and string
 * or template literals that are not machinery. That makes whole classes of
 * false positive invisible rather than filtered:
 *
 *   route paths and hrefs      `/gratitude` is a single-token string, and
 *                              href/to/path/src are machinery attributes.
 *                              Renaming a route breaks every existing link,
 *                              bookmark and notification.
 *   component and symbol names identifiers are not literals. `GratitudeWall`
 *                              and `useGratitudeBloom` never enter the scan,
 *                              and the word-boundary rules would not match
 *                              them if they did.
 *   column and field names,    single-token strings, plus the machinery-key
 *   source tags, token slugs   list below (source, slug, tokenSlug, column).
 *   comments and docblocks     the AST walk never visits them.
 *   historical records         `ProjectHistory.tsx` is excluded by path. It
 *                              holds the record of the token-naming decision
 *                              itself, `suggestedOptions: ["Gratitude",
 *                              "Seeds", "Roots", ...]` included. Substituting
 *                              the current name there would corrupt a
 *                              document. This is the subtlest exclusion and
 *                              the one most likely to make a guard wrong.
 *   test files and fixtures    excluded by path, same rule as check-voice.
 *   shared/gameConfig.ts       the declared identity home, and outside this
 *                              scan root. check-identity-keys guards it.
 *
 * A genuine false positive takes an inline `village-ok: <reason>` on the line,
 * the same spelling convention as `brand-ok:`, `voice-ok:` and `theme-ok:`.
 * Waivers are counted and printed, so an allowance is never silent.
 *
 * ── THE PENDING LIST, AND WHY IT IS NOT ZERO YET ───────────────────────────
 *
 * Every fact in the WHY paragraph above is still somewhere in this tree. A
 * guard that fails on the day it lands gets disabled, so this ships ARMED with
 * exactly what exists today recorded in `scripts/village-facts-pending.json`,
 * per file and per rule, dated. It is a ratchet in the same discipline as
 * `scripts/theme-literals-baseline.json` and `scripts/image-budget-baseline
 * .json`, and it carries identity-keys' four refusals rather than
 * theme-literals' one:
 *
 *   it fails if a count GROWS anywhere,
 *   it fails if a file or rule appears that is not on the list,
 *   it fails if a listed count has FALLEN and the list still says the old
 *     number, which is a red that means good news,
 *   it fails if the list's own arithmetic is inconsistent, or if the recorded
 *     total and PENDING_CEILING disagree.
 *
 * The third of those is the one theme-literals leaves out and identity-keys
 * gets right. A fall that nobody records is an allowance for the same fact to
 * come back later without anybody noticing. `--update-pending` does the
 * bookkeeping mechanically and REFUSES to write a total above the one already
 * committed.
 *
 * THE LIST MUST REACH ZERO. Every entry is a village fact welded into a page,
 * and every entry removed is one that can never quietly come back. When the
 * last one goes, delete the JSON and PENDING_CEILING and leave the plain rule.
 *
 * ── FORKS ──────────────────────────────────────────────────────────────────
 *
 * This is an UPSTREAM guard, for the same reason check-identity-keys is. A
 * fork's own pages carry that fork's own prices, its own units and its own
 * staff, and those are correct for that fork. A fork passes `--fork` (or sets
 * VILLAGE_FORK=1) and gets the full report with exit 0.
 *
 * ── KNOWN GAP ──────────────────────────────────────────────────────────────
 *
 * Scope is `client/src` only, which is theme-literals' scope and this lane's.
 * `server/seeds/**.json` becomes page copy on a fresh deployment's first boot,
 * so a price band seeded there would reach a member and this guard would not
 * see it. check-voice.mjs already parses those files for its own rules, so the
 * extension is a scan root and a key list rather than new machinery. Recorded
 * here rather than left to be discovered on a page.
 *
 * Usage:
 *   node scripts/check-village-facts.mjs                   # the gate
 *   node scripts/check-village-facts.mjs --json            # machine readable
 *   node scripts/check-village-facts.mjs --fork            # a fork: never fails
 *   node scripts/check-village-facts.mjs --update-pending  # only ever downward
 *   node scripts/check-village-facts.mjs --root <dir> --pending <file>
 *
 * The last form points the guard at a different client tree and a different
 * list. `check-voice.mjs` takes positional paths for the same reason: the
 * self-test needs to drive the REAL script over a fixture tree rather than a
 * copy of it, because a copy is a second implementation and the thing worth
 * proving is that this one refuses. CI invokes it with no arguments, so the
 * defaults are what ships, and the workflow diff shows it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// fileURLToPath, not `new URL(...).pathname` with a drive-letter fixup, for
// the reason check-identity-keys.mjs records: the hand-rolled form leaves a
// checkout under a path containing a space reading `%20` as literal
// characters, so the guard looks for files that are not there and reports a
// clean tree.
const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..");
const SCAN_ROOT = path.join(ROOT, "client", "src");
const PENDING_PATH = path.join(ROOT, "scripts", "village-facts-pending.json");

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

/**
 * 2026-09-03: the total recorded in village-facts-pending.json when this guard
 * landed. THIS NUMBER ONLY EVER FALLS.
 *
 * It has to equal the total in the JSON, so raising the allowance means
 * editing a number one line under the sentence forbidding it. That is the
 * point: the list cannot grow by accident, only by a deliberate edit that
 * shows up in a diff next to this comment.
 */
export const PENDING_CEILING = 34;

// ── Scope ───────────────────────────────────────────────────────────────────

/**
 * Excluded by path, each for a different reason. Every one of these is a case
 * where flagging the hit would be the guard being wrong, not the code.
 */
export const EXCLUDED = [
  // The record of the token-naming decision itself, suggestedOptions and all.
  // Substituting the current name into a historical document corrupts it.
  "client/src/pages/ProjectHistory.tsx",
];

/** Tests describe behaviour to developers. Same rule as check-voice.mjs. */
export const isTest = (r) =>
  /\.(test|spec)\.(ts|tsx|mjs)$/.test(r) || r.includes("__tests__") || r.includes("/fixtures/");

export const isExcluded = (r) => EXCLUDED.includes(r) || isTest(r);

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".vite"]);

export function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ── Telling copy from machinery ─────────────────────────────────────────────

/**
 * Attributes and properties whose string values are machinery, never prose.
 *
 * Seeded from check-voice.mjs's own list, which has been in CI since before
 * this guard existed, plus the keys that carry the identifiers THIS guard's
 * rules would otherwise trip over: a token slug, a ledger source tag, a
 * database column, a metric id. Those are the ALLOW list from the brief,
 * expressed as the thing the parser already knows.
 */
export const MACHINERY_KEYS = new Set([
  // check-voice.mjs's list, verbatim.
  "className", "class", "style", "id", "key", "href", "src", "to", "path",
  "type", "name", "slug", "variant", "size", "color", "colour", "fill",
  "stroke", "icon", "role", "testId", "data-testid", "value", "kind",
  "target", "rel", "method", "accept", "autoComplete", "inputMode",
  "pattern", "font", "fontFamily", "tag", "code", "event", "action",
  // This guard's own additions: the identifiers its rules would trip over.
  "source", "sourceTag", "tokenSlug", "token", "column", "field", "metric",
  "eventType", "route", "endpoint", "url", "query", "queryKey", "status",
]);

/**
 * Properties and attributes whose value IS the copy, so a one-word value there
 * is still display text.
 *
 * `label: "Gratitude"` is a rendered word. `source: "gratitude"` is a ledger
 * tag. Same string, opposite verdicts, and the key is what separates them.
 */
export const DISPLAY_KEYS = new Set([
  "label", "title", "placeholder", "description", "desc", "note", "hint",
  "text", "heading", "subtitle", "caption", "alt", "aria-label", "ariaLabel",
  "message", "body", "subject", "summary", "blurb", "copy", "cta", "unit",
  "valueHint", "noteHint", "shortNote", "prefix", "suffix", "legend",
  "children", "tooltip", "helper", "helperText", "error", "success",
]);

/** The name of the attribute or property a literal is the value of, if any. */
function ownerKey(node) {
  const parent = node.parent;
  if (!parent) return null;
  if (ts.isJsxAttribute(parent)) return parent.name.getText();
  if (ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) {
    return parent.parent.name.getText();
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    return parent.name.getText().replace(/['"]/g, "");
  }
  if (ts.isVariableDeclaration(parent) && parent.name) return parent.name.getText();
  return null;
}

/**
 * Every span of a parsed file that a member could read, with the metadata the
 * rules need.
 *
 * `kind` is "jsx" for JSX text, "head" for the opening chunk of a template
 * literal, and "string" for everything else. The money rule needs the
 * distinction: a template literal that OPENS on a bare currency symbol is a
 * money formatter, and one that merely contains a dollar somewhere is often a
 * shell variable in generated code (client/src/components/YourAgentPanel.tsx
 * builds `Authorization: Bearer $${envVar}` for a curl example).
 *
 * `oneWord` is carried through rather than filtered here, because JSX text is
 * display copy even when it is a single word and a bare string almost never
 * is. `<span>Gratitude</span>` is a rendered word; `useToken("gratitude")` is
 * an argument.
 */
export function copySpans(sourceFile) {
  const spans = [];
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText();
      if (text.trim()) spans.push({ pos: node.getStart(), text, kind: "jsx", key: null });
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const key = ownerKey(node);
      const isImport =
        node.parent &&
        (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent));
      const isPropName =
        node.parent && ts.isPropertyAssignment(node.parent) && node.parent.name === node;
      if (isImport || isPropName) {
        ts.forEachChild(node, visit);
        return;
      }
      if (key && MACHINERY_KEYS.has(key) && !DISPLAY_KEYS.has(key)) {
        ts.forEachChild(node, visit);
        return;
      }
      spans.push({
        pos: node.getStart(),
        text: node.text,
        kind: ts.isTemplateHead(node) ? "head" : "string",
        key,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return spans;
}

/**
 * Is this span display copy, or is it an identifier that happens to be a
 * string?
 *
 * A single token with no whitespace is a slug, a route, a column name, an enum
 * member or an argument. That one rule covers most of the brief's ALLOW list
 * without naming a single exception, and it is why `"gratitude"` passed as an
 * argument costs nothing while `"Send gratitude to a neighbour"` does not.
 *
 * JSX text is exempt from it: `<b>Gratitude</b>` is one word and it is paint
 * on a page. So is a one-word value under a display key.
 */
export function isProse(span) {
  if (span.kind === "jsx") return true;
  if (span.key && DISPLAY_KEYS.has(span.key)) return true;
  return /\s/.test(span.text.trim()) && /[A-Za-z]/.test(span.text);
}

// ── The rules ───────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS = "$€£¥₡₪₩₹";

/**
 * A currency amount.
 *
 * Requires a symbol or code next to a number that is actually a PRICE: two or
 * more digits, or a separator, or a magnitude suffix, or a rate slash. A lone
 * symbol plus one digit is a regular-expression backreference, which is what
 * `client/src/pages/Admin.tsx` line 985 is (`k.replace(/([A-Z])/g, " $1")`),
 * and a guard that flagged it would be wrong in the most annoying possible
 * place. The cost of that precision is a genuine "$5" going unseen; every
 * amount this platform was found publishing was $33 or more.
 */
const MONEY_CANDIDATE = new RegExp(
  `[${CURRENCY_SYMBOLS}]\\s?\\d[\\d.,]*\\s?[kKmMbB]?\\+?`,
  "g",
);

/** A number followed by a currency code: "45,000 CRC", "20 USD". */
const MONEY_CODE = /\d[\d.,]*\s?(?:USD|EUR|CRC|GBP|CHF|COP|MXN|CAD|AUD)\b/;

/**
 * The whole amount, or null.
 *
 * Two steps rather than one regex, so the reported hit is the figure a reader
 * would recognise ("$80,000") instead of the first two digits of it, and so
 * the qualification rule can be read on its own line.
 */
export function moneyHit(text) {
  for (const m of text.matchAll(MONEY_CANDIDATE)) {
    const body = m[0].slice(1).trim();
    const rate = text[m.index + m[0].length] === "/";
    if (/^\d{2,}/.test(body) || /^\d[.,]\d/.test(body) || /^\d\s?[kKmMbB]/.test(body) || rate) {
      // Trim the trailing punctuation the candidate is deliberately greedy
      // about: `[\d.,]*` swallows the comma in `from $80,000, reserve now` and
      // `\s?` swallows the space in `costs $33 a month`, both needed to reach
      // the separators and suffixes inside a real figure. Reporting
      // `"$80,000,"` reads like the scanner losing track of where the amount
      // ends, and the point of naming the hit is that a reader recognises it.
      return m[0].replace(/[.,\s]+$/, "");
    }
  }
  return null;
}

/**
 * Area and size units asserted as a fact.
 *
 * The whole class, because the defect was symmetrical: a page said square feet
 * at a village that measures in metres, and a tile said "Total Acres" over a
 * number a village meant as hectares. Neither unit is the safe one. A village
 * states its own unit in Settings, or nothing is stated.
 */
const AREA_UNIT =
  /\b(?:acres?|hectares?|manzanas?|sq\.?\s?ft|sqft|square\s+(?:feet|foot|met(?:er|re)s?)|ft2|m2)\b|m²|ft²/i;

/** The recognition token's default name. Read `useTokenName` instead. */
const TOKEN_NAME = /\bgratitude\b/i;

/** The value token's default name. Read `useValueTokenName` instead. */
const VALUE_TOKEN_NAME = /\bvillage\s+credits\b/i;

/** The member noun. Read `project.memberName` through the config. */
const MEMBER_NAME = /\bvillage\s+members?\b/i;

/**
 * A specific person named in copy a visitor reads.
 *
 * Shaped on the promise rather than on a list of names, because a name list
 * cannot exist: the next fork's staff are people this repository has never
 * heard of. What travels badly is the SENTENCE, `Thank you! Jess will be in
 * touch within 48 hours.`, which arrives in a fork and promises a stranger
 * that somebody else's colleague will call them.
 *
 * A village's own team page listing its people is not this. That is a page a
 * fork replaces, it names nobody as the handler of a form the fork is running,
 * and none of these patterns match a bare list of names.
 */
const PERSON_PROMISE = [
  /\b[A-Z][a-z]{2,11} will (?:be in touch|contact|reach|get back|email|call|follow up|write|respond|reply)/,
  /\b(?:contact|email|ask|message|write to|reach out to|speak (?:to|with)|talk to) [A-Z][a-z]{2,11}\b/,
  /\b[A-Z][a-z]{2,11}(?:'s| is)\s+(?:the|our|your)\s+(?:founder|steward|host|guide|contact|lead|organiser|organizer)\b/,
];

/**
 * Capitalised words the person rule must never read as a given name.
 *
 * MEASURED, and the measurement is worth recording because it says how much
 * of the work the patterns above are doing: over the whole client at b6af325,
 * the three patterns matched ONCE, on the Jess line, and this list stopped
 * nothing. So it is insurance against the sentences English will eventually
 * produce here ("The steward will be in touch", "Contact Support"), not a
 * filter propping up patterns that over-match. If it ever starts carrying
 * real load, the patterns are wrong and this is the wrong place to fix them.
 */
export const NOT_A_PERSON = new Set([
  "The", "This", "That", "You", "Your", "We", "Our", "They", "It", "She", "He",
  "Village", "Admin", "Support", "Someone", "Anyone", "Nobody", "Everyone",
  "Council", "Circle", "Team", "Stewards", "Steward", "Members", "Member",
  "Guide", "Host", "Founder", "Nothing", "Please", "Contact", "Email",
  "Message", "Ask", "Gratitude", "Credits",
]);

/**
 * Every rule, in one place, so the report and the pending list agree on the
 * names and the test can drive them one at a time.
 */
export const RULES = [
  {
    id: "money",
    what: "a currency amount in display text",
    fix: "read the amount and the symbol from the village's own settings. Nobody's prices should travel to a fork.",
    /**
     * A template literal that OPENS on a bare currency symbol, which is a
     * money formatter: `` `$${(Number(minor) / 100).toFixed(2)}` `` appears
     * five times in this client and hard-codes the dollar for every village.
     *
     * This one runs on EVERY span rather than on prose spans only, because
     * the shape is unambiguous without needing to look like a sentence, and
     * `isProse` would throw it away: the head's text is one character with no
     * whitespace in it.
     *
     * Exactly the head, and exactly one symbol. A template that merely
     * CONTAINS a dollar somewhere is often a shell variable in generated
     * code: client/src/components/YourAgentPanel.tsx builds
     * `Authorization: Bearer $${envVar}` for a curl example, three times, and
     * flagging that would be the guard being wrong in a file that has nothing
     * to do with money. That span is a template MIDDLE and its text starts
     * with the close of the previous substitution, so it never reaches here.
     *
     * `x ?? "$"` and `x || "$"` are NOT this, and they pass. A symbol read
     * from config with a literal fallback is the platform's own established
     * pattern (client/src/pages/ResidentJourney.tsx renders
     * `{dues.currency || "$"}`), the same shape check-theme-literals.mjs
     * accepts for `var(--tone-brand, #157f7d)`: the literal there is what a
     * village that has set nothing yet sees, not a value config can never
     * reach. Those spans are single-token strings under no display key, so
     * `isProse` drops them.
     */
    matchAny: (span) =>
      span.kind === "head" && new RegExp(`^[${CURRENCY_SYMBOLS}]$`).test(span.text)
        ? `${span.text}\${...}`
        : null,
    match: (span) => moneyHit(span.text) ?? span.text.match(MONEY_CODE)?.[0] ?? null,
  },
  {
    id: "unit",
    what: "an area or size unit asserted in display text",
    fix: "state the unit from the village's own settings, or state no unit. A hectares village must not read acres.",
    match: (span) => span.text.match(AREA_UNIT)?.[0] ?? null,
  },
  {
    id: "token-name",
    what: "the recognition token's name as a literal",
    fix: "read useTokenName() or useTokenNameLower() from client/src/hooks/useTokenNames.ts.",
    match: (span) => span.text.match(TOKEN_NAME)?.[0] ?? null,
  },
  {
    id: "value-token-name",
    what: "the value token's name as a literal",
    fix: "read useValueTokenName() from client/src/hooks/useTokenNames.ts.",
    match: (span) => span.text.match(VALUE_TOKEN_NAME)?.[0] ?? null,
  },
  {
    id: "member-name",
    what: "the member noun as a literal",
    fix: "read project.memberName through the game config. A village calls its people what it likes.",
    match: (span) => span.text.match(MEMBER_NAME)?.[0] ?? null,
  },
  {
    id: "person-name",
    what: "a specific person named in copy shown to users",
    fix: "name a role or a shared inbox. A first name compiled into the bundle travels to every fork.",
    match: (span) => {
      for (const re of PERSON_PROMISE) {
        const m = span.text.match(re);
        if (!m) continue;
        const word = m[0].match(/\b[A-Z][a-z]{2,11}\b/)?.[0];
        if (word && NOT_A_PERSON.has(word)) continue;
        return m[0].slice(0, 60);
      }
      return null;
    },
  },
];

/**
 * Is the hit on this line waived?
 *
 * `village-ok: <reason>` on the line itself, or on any comment-only line
 * directly above it. The second form matters more than it looks: the lines
 * these rules land on are the long ones, a JSX paragraph or a ternary over a
 * template literal, and check-theme-literals.mjs learned the same lesson on
 * generated Tailwind selectors. Forcing the marker onto a 140-column line to
 * make a guard happy makes the code worse and teaches people to delete the
 * guard instead.
 *
 * A blank line breaks the arming, so a marker cannot drift onto an unrelated
 * hit further down the file. Either way the reason has to be written down; the
 * marker alone is not the point.
 */
export function isWaived(lines, index) {
  if (/village-ok:/.test(lines[index] ?? "")) return true;
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") return false;
    // `{/*` as well as `//`, `/*` and a JSDoc continuation `*`. Most of the
    // lines these rules land on are inside JSX, where the only comment form
    // available is `{/* ... */}`, so leaving it out would mean the marker
    // could not be written above the hit in the place it is most needed.
    if (!/^\s*(?:\{?\/[/*]|\*)/.test(line)) return false;
    if (/village-ok:/.test(line)) return true;
  }
  return false;
}

/** Every finding in one already-parsed file. Pure, so the test can drive it. */
export function scanSource(relPath, source) {
  const sf = ts.createSourceFile(
    relPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  // The carriage return goes first, the way scripts/brand-strip.mjs does it.
  // check-brand-refs.mjs gave a different answer per machine over exactly
  // this, and its own test records the incident. The AST is CRLF-safe on its
  // own; the WAIVER lookup reads raw lines, and a trailing \r there would make
  // `village-ok:` at end of line match on Linux and not on Windows.
  const lines = source.split("\n").map((l) => l.replace(/\r$/, ""));
  const hits = [];
  let waived = 0;

  for (const span of copySpans(sf)) {
    const prose = isProse(span);
    for (const rule of RULES) {
      // `matchAny` runs on every span; `match` only on the ones that read as
      // copy. A rule whose shape is unambiguous on its own does not need the
      // prose test, and the money formatter would fail it.
      const found = rule.matchAny?.(span) ?? (prose ? rule.match?.(span) : null);
      if (!found) continue;
      const { line } = sf.getLineAndCharacterOfPosition(span.pos);
      const lineText = lines[line] ?? "";
      if (isWaived(lines, line)) {
        waived += 1;
        continue;
      }
      hits.push({
        file: relPath,
        line: line + 1,
        rule: rule.id,
        hit: found,
        text: lineText.trim().slice(0, 140),
      });
    }
  }
  return { hits, waived };
}

// ── The pending list ────────────────────────────────────────────────────────

/**
 * Counts keyed `file::rule`, so a page that carries two different kinds of
 * fact burns them down separately rather than hiding one behind the other.
 */
export function countsOf(hits) {
  const counts = {};
  for (const h of hits) {
    const k = `${h.file}::${h.rule}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

export const totalOf = (counts) => Object.values(counts).reduce((n, v) => n + v, 0);

/**
 * The four refusals. identity-keys' rules, over a list of counts rather than a
 * list of keys.
 *
 * `grown` and `unexpected` are the ones every ratchet has. `stale` is the one
 * theme-literals leaves out and identity-keys gets right: a count that has
 * fallen and not been recorded is a standing allowance for the same fact to
 * come back later, under a number nobody checked. It is a red that means good
 * news, and the message says so.
 */
export function auditPending(counts, pending, ceiling = PENDING_CEILING) {
  const listed = pending.counts ?? {};
  const grown = [];
  const unexpected = [];
  const stale = [];

  for (const [k, n] of Object.entries(counts)) {
    if (!(k in listed)) unexpected.push({ key: k, found: n });
    else if (n > listed[k]) grown.push({ key: k, found: n, allowed: listed[k] });
  }
  for (const [k, n] of Object.entries(listed)) {
    const found = counts[k] ?? 0;
    if (found < n) stale.push({ key: k, found, listed: n });
  }

  const listedTotal = totalOf(listed);
  return {
    grown,
    unexpected,
    stale,
    // Two arithmetic checks rather than one, and both have to hold.
    //
    // `declared` catches a hand-edited JSON whose counts and whose own `total`
    // field disagree, which is the shape of somebody deleting an entry and
    // leaving the header alone.
    //
    // `ceiling` catches the script's constant drifting from the file, which is
    // identity-keys' rule: the number lives one line under the sentence
    // forbidding a raise, so growing the allowance takes a deliberate edit
    // that shows up in the diff next to that sentence.
    declared:
      pending.total === undefined || pending.total === listedTotal
        ? null
        : { listed: listedTotal, declared: pending.total },
    ceiling: ceiling === null || listedTotal === ceiling ? null : { listed: listedTotal, ceiling },
    total: totalOf(counts),
    listedTotal,
  };
}

// ── The gate ────────────────────────────────────────────────────────────────

function readPending(file) {
  if (!fs.existsSync(file)) return { total: 0, counts: {}, entries: {} };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function scanTree(root, base) {
  const files = walk(root).sort();
  const hits = [];
  let waived = 0;
  let scanned = 0;
  for (const file of files) {
    const r = path.relative(base, file).split(path.sep).join("/");
    if (isExcluded(r)) continue;
    scanned += 1;
    const res = scanSource(r, fs.readFileSync(file, "utf8"));
    hits.push(...res.hits);
    waived += res.waived;
  }
  return { hits, waived, scanned, found: files.length };
}

/** The value after a flag, e.g. `--root some/dir`. */
function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

function main(argv) {
  const fork = argv.includes("--fork") || process.env.VILLAGE_FORK === "1";
  const rootArg = flagValue(argv, "--root");
  const pendingArg = flagValue(argv, "--pending");
  const scanRoot = rootArg ? path.resolve(rootArg) : SCAN_ROOT;
  const pendingPath = pendingArg ? path.resolve(pendingArg) : PENDING_PATH;
  // The base a finding's path is reported relative to. With --root it is the
  // parent of the client tree, so a fixture reports the same
  // `client/src/pages/X.tsx` shape the real run does and its pending list is
  // written in the same keys.
  const base = rootArg ? path.resolve(rootArg, "..", "..") : ROOT;
  // PENDING_CEILING tracks the committed list. A run pointed at some other
  // list has nothing to compare it to, so that rule stands down and the
  // internally-consistent-total rule carries the arithmetic instead. Printed,
  // so a run without the ceiling rule never looks like a run with it.
  const ceiling = pendingArg ? null : PENDING_CEILING;

  if (!fs.existsSync(scanRoot)) {
    console.error(
      `::error::the client tree is not at ${scanRoot}. This guard reads it by path; if it moved, move this with it rather than leaving a green run behind.`,
    );
    return 1;
  }

  const { hits, waived, scanned, found } = scanTree(scanRoot, base);

  // "0 findings" and "the walk found nothing to scan" must never print the
  // same line, the rule check-voice.mjs states in its own words. A moved or
  // renamed scan root would otherwise report a clean tree forever.
  if (scanned === 0) {
    console.error(
      `::error::found ZERO scannable files under ${scanRoot} (${found} before exclusions). That means the walk did not run, not that the client is clean. Refusing to report a pass.`,
    );
    return 1;
  }

  const counts = countsOf(hits);
  const total = totalOf(counts);

  if (argv.includes("--update-pending")) {
    const old = readPending(pendingPath);
    const oldTotal = totalOf(old.counts ?? {});
    // The one write that is allowed to be a rise is the FIRST one, when no
    // list exists yet. That is the seeding run, and refusing it would leave
    // the only way to create the file being to hand-write a hundred entries.
    // Every run after it may only lower the number.
    const seeding = !fs.existsSync(pendingPath);
    if (!seeding && total > oldTotal) {
      console.error(
        `::error::refusing to raise the village-fact pending total: ${total} is above the recorded ${oldTotal}. ` +
          `This number only ever falls. Read the amount, the unit or the name from the village's own settings ` +
          `(useTokenName / useValueTokenName / project.memberName / the settings row), or if the hit is a genuine ` +
          `false positive put \`village-ok: <reason>\` on the line. A fact that has to stay welded in is a decision ` +
          `to take with the founder, not a number to raise here.`,
      );
      return 1;
    }
    const entries = {};
    const today = new Date().toISOString().slice(0, 10);
    for (const k of Object.keys(counts).sort()) {
      entries[k] = old.entries?.[k] ?? { since: today };
    }
    fs.writeFileSync(
      pendingPath,
      `${JSON.stringify(
        {
          note:
            "Village facts welded into client copy, recorded per file and per rule. " +
            "This list only ever shrinks. Read scripts/check-village-facts.mjs before editing it, " +
            "and lower PENDING_CEILING in that file to match the total here.",
          total,
          // Written into the file so it explains itself when somebody opens it
          // on its own, without having to go and read the guard first.
          rules: Object.fromEntries(RULES.map((r) => [r.id, { what: r.what, fix: r.fix }])),
          counts: Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]])),
          entries,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `village-fact pending list lowered to ${total} across ${Object.keys(counts).length} file/rule pair(s). ` +
        `Set PENDING_CEILING to ${total} in scripts/check-village-facts.mjs in the same commit.`,
    );
    return 0;
  }

  const pending = readPending(pendingPath);
  const result = auditPending(counts, pending, ceiling);

  console.log(
    `village facts: ${scanned} client file(s) scanned, ${total} finding(s) in ${Object.keys(counts).length} file/rule pair(s), ` +
      `pending list ${result.listedTotal} (${ceiling === null ? `ceiling rule stood down, list at ${pendingPath}` : `ceiling ${ceiling}`}); ${waived} waiver(s) in force.`,
  );
  // The pending list prints on every run, pass or fail, the way
  // check-identity-keys prints its own. An allowance nobody reads is an
  // allowance that rots.
  for (const k of Object.keys(pending.counts ?? {}).sort()) {
    const [file, ruleId] = k.split("::");
    const since = pending.entries?.[k]?.since ?? "undated";
    console.log(`  PENDING  ${String(pending.counts[k]).padStart(3)}  ${ruleId.padEnd(17)} ${file}  (recorded ${since})`);
  }
  console.log("  This list must reach zero. Every entry is a village fact welded into a page. It only ever shrinks.");

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ...result, counts, hits, waived, ceiling: PENDING_CEILING }));
  }

  const problems = [];
  const byKey = {};
  for (const h of hits) {
    const k = `${h.file}::${h.rule}`;
    (byKey[k] ??= []).push(h);
  }
  const ruleOf = (id) => RULES.find((r) => r.id === id);
  const show = (k) => (byKey[k] ?? []).slice(0, 5).map((h) => `        ${h.file}:${h.line}  ${JSON.stringify(h.hit)}  ${h.text}`);

  for (const u of result.unexpected) {
    const [file, ruleId] = u.key.split("::");
    const r = ruleOf(ruleId);
    problems.push(
      [
        `${file} carries ${u.found} NEW hit(s) of rule "${ruleId}": ${r?.what}. Nothing in the pending list covers this file for this rule, so it is new.`,
        `      ${r?.fix}`,
        `      If it is a genuine false positive, put \`village-ok: <reason>\` on the line. The reason has to be written down.`,
        ...show(u.key),
      ].join("\n"),
    );
  }
  for (const g of result.grown) {
    const [file, ruleId] = g.key.split("::");
    const r = ruleOf(ruleId);
    problems.push(
      [
        `${file} now carries ${g.found} hit(s) of rule "${ruleId}" and the pending list allows ${g.allowed}. This ratchet only turns down.`,
        `      ${r?.fix}`,
        ...show(g.key),
      ].join("\n"),
    );
  }
  for (const s of result.stale) {
    const [file, ruleId] = s.key.split("::");
    problems.push(
      s.found === 0
        ? `${file} is listed as pending for rule "${ruleId}" and is now CLEAN. Good news, and it needs the bookkeeping: delete that entry from scripts/village-facts-pending.json and lower PENDING_CEILING to ${result.listedTotal - s.listed}. \`node scripts/check-village-facts.mjs --update-pending\` does the JSON. A pending entry left behind is a standing permission for that fact to come back without anybody noticing.`
        : `${file} is listed as pending for rule "${ruleId}" at ${s.listed} and now carries ${s.found}. Good news, and the ratchet has to record it: run \`node scripts/check-village-facts.mjs --update-pending\` and lower PENDING_CEILING to ${result.total}. A fall nobody writes down is an allowance for the old number to come back.`,
    );
  }
  if (result.declared) {
    const { listed, declared } = result.declared;
    problems.push(
      `${rel(pendingPath)} declares a total of ${declared} and its own counts add up to ${listed}. Somebody edited one and left the other. Run \`node scripts/check-village-facts.mjs --update-pending\`, which writes both from the same number.`,
    );
  }
  if (result.ceiling) {
    const { listed, ceiling: c } = result.ceiling;
    problems.push(
      listed > c
        ? `${rel(pendingPath)} totals ${listed} and PENDING_CEILING is ${c}. This list only ever shrinks. A village fact that has to stay welded into a page is a decision to take with the founder, not a number to raise here.`
        : `${rel(pendingPath)} totals ${listed} and PENDING_CEILING is still ${c}. Lower the ceiling to ${listed} so the ratchet holds at the number actually reached.`,
    );
  }

  // A fork gets every finding and none of the ::error:: markers, for the
  // reason check-identity-keys gives: annotating a green build as failed
  // teaches people to read past annotations, and a fork's own pages carry that
  // fork's own prices, units and staff, which are correct for that fork.
  if (problems.length && fork) {
    console.log(
      "\nnote: --fork, so these are reported and not failed. This gate is for the upstream platform, where a page's facts belong to no village. A fork's own pages are its own.",
    );
    for (const p of problems) console.log(`  note: ${p}`);
    return 0;
  }
  if (!problems.length) {
    console.log("village-fact guard passed: no new hardcoded village facts in client copy.");
    return 0;
  }
  console.error("\nVILLAGE-FACT GUARD FAILED. A page is stating a fact the village cannot change.\n");
  for (const p of problems) console.error(`::error::${p}`);
  return 1;
}

// Run as a gate only when invoked directly. Imported (by its own test) it is a
// library of rules with no side effects.
const invoked = process.argv[1] && path.resolve(process.argv[1]) === SELF;
if (invoked) process.exit(main(process.argv.slice(2)));
