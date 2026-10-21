/**
 * The name swap: every member name the village knows, replaced in a piece of
 * text by that member's code-name, before the text crosses to an outside
 * service.
 *
 * ── WHAT THE FOUNDER PROMISED THE VENDOR (2026-10-13) ────────────────────
 *
 * Before any text crosses, the village swaps every member name it knows for
 * that member's code-name: display names, first names, handles and every
 * other name field the user record holds; whole words, case-insensitive,
 * possessives handled ("Jess's"). Nicknames and descriptions can still point
 * at a person, and that was accepted out loud. What this file owes is the
 * names the village holds.
 *
 * ── PURE, ON PURPOSE ─────────────────────────────────────────────────────
 *
 * No database, no clock, no module state. Text and a member list in, text
 * out, so every rule below is a unit test and the outbox decides nothing
 * about matching. `mentionedMembers` runs first so the outbox mints a
 * code-name only for people actually named, and `swapNames` runs second with
 * those code-names in hand.
 *
 * ── HOW A MATCH IS DECIDED ───────────────────────────────────────────────
 *
 *   WHOLE WORDS. A name matches only where the characters either side are not
 *   a letter, a digit or an underscore, in any script. "Ann" is never swapped
 *   inside "Annual" or "planning"; "Ed" never inside "used".
 *
 *   POSSESSIVES FOR FREE. An apostrophe is not a letter, so "Jess's" matches
 *   "Jess" and keeps its "'s": the code-name takes the possessive. The curly
 *   apostrophe behaves the same.
 *
 *   LONGEST NAME FIRST, in one pass. "Anna" is tried before "Ann" at the same
 *   place, and "Jess Mora" before "Jess", so the fuller name wins. One pass
 *   also means a code-name written into the text is never read again, so a
 *   code-name word that happens to be somebody's name cannot be swapped twice.
 *
 *   CASE AND ACCENTS FOLDED. Both sides are folded one code point at a time:
 *   decomposed, combining marks dropped, lowercased. "José", "JOSE", "jose"
 *   and a decomposed "Jose" plus a combining accent all match a member named
 *   José, because a name typed without its accent is still the name. The
 *   fold keeps a map back to the original text, so the replacement lands on
 *   exactly the characters that were matched, marks included.
 *
 *   SPACES INSIDE A NAME are any run of whitespace, so "Jess\nMora" across a
 *   line break is still the full name.
 *
 *   A NAME TWO MEMBERS SHARE becomes "a member". Two people called Jess cannot
 *   be told apart by the word "Jess", and either code-name would pin one
 *   person's words on the other. The full name, when written, still resolves.
 *
 *   SCRIPTS WRITTEN WITHOUT SPACES (Han, Hiragana, Katakana, Thai) have no
 *   word boundary to wait for, so a name in one of them matches wherever it
 *   appears.
 *
 * ── WHAT IT COSTS, SAID PLAINLY ──────────────────────────────────────────
 *
 * Case-insensitive whole-word matching swaps a name that is also an ordinary
 * word everywhere it appears: a member called Will turns "I will go" into "I
 * <code-name> go". The text reads worse and nothing leaks, and that is the
 * direction this file fails in by design. A name shorter than two characters
 * is not matched at all, since "A" or "I" would eat every sentence.
 */

/** One person and every name the village holds for them. */
export interface NamedMember {
  id: string;
  names: readonly string[];
}

/** What a name two members share becomes, because neither code-name is honest. */
export const SHARED_NAME_STAND_IN = "a member";

/** Shorter than this, a "name" is a letter, and swapping it would eat every sentence. */
export const MIN_NAME_CHARS = 2;

const WORD_CHAR = String.raw`[\p{L}\p{N}_]`;
const BEFORE = `(?<!${WORD_CHAR})`;
const AFTER = `(?!${WORD_CHAR})`;
// Built with the constructor: the typecheck targets a language level that
// refuses the `u` flag on a literal, and every runtime this ships on has it.
const UNSPACED_SCRIPT = new RegExp(String.raw`^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\s]+$`, "u");
const COMBINING_MARKS = new RegExp(String.raw`\p{M}`, "gu");

/**
 * Every name a member record holds, as the swap reads it.
 *
 * The display name whole, its first word and its last word, the handle with
 * and without its "@", and the email address. The record's shape is the
 * users repository's (`server/repos/users.ts`); nothing else on it is a name.
 */
export function namesOf(record: { name?: unknown; handle?: unknown; email?: unknown }): string[] {
  const out: string[] = [];
  const name = clean(record.name);
  if (name) {
    out.push(name);
    const words = name.split(" ");
    if (words.length > 1) {
      out.push(words[0]);
      out.push(words[words.length - 1]);
    }
  }
  const handle = clean(record.handle).replace(/^@+/, "");
  if (handle) {
    out.push(handle);
    out.push(`@${handle}`);
  }
  const email = clean(record.email);
  if (email) out.push(email);
  return Array.from(new Set(out));
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim() : "";
}

/** One code point, folded: decomposed, combining marks dropped, lowercased. */
function foldPoint(ch: string): string {
  return ch.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

/** A name folded the way the text is, with every run of space read as one. */
function foldName(name: string): string {
  let out = "";
  for (const ch of clean(name)) out += foldPoint(ch);
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The text folded, with a map back. `starts[i]` and `ends[i]` are the span of
 * the original text that produced folded character `i`. A point that folds
 * to nothing (a combining mark) produces no folded character, and is swept
 * into whichever match ends just before it.
 */
function foldText(text: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  for (const ch of text) {
    const f = foldPoint(ch);
    for (let k = 0; k < f.length; k++) {
      starts.push(at);
      ends.push(at + ch.length);
    }
    folded += f;
    at += ch.length;
  }
  return { folded, starts, ends };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A folded name as a pattern: each space is any run of whitespace. */
function namePattern(folded: string): string {
  return folded.split(" ").map(escapeRegExp).join(String.raw`\s+`);
}

interface Matcher {
  regex: RegExp;
  /** Folded name to the ids of every member who holds it. */
  holders: Map<string, Set<string>>;
}

/**
 * One regular expression for the whole roster, longest names first, built
 * once per call. An empty roster, or one whose names are all too short,
 * matches nothing.
 */
function buildMatcher(members: readonly NamedMember[]): Matcher | null {
  const holders = new Map<string, Set<string>>();
  for (const m of members) {
    for (const raw of m.names) {
      const key = foldName(raw);
      if (Array.from(key).length < MIN_NAME_CHARS) continue;
      const ids = holders.get(key) ?? new Set<string>();
      ids.add(m.id);
      holders.set(key, ids);
    }
  }
  if (holders.size === 0) return null;
  const keys = Array.from(holders.keys()).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const spaced = keys.filter((k) => !UNSPACED_SCRIPT.test(k)).map(namePattern);
  const unspaced = keys.filter((k) => UNSPACED_SCRIPT.test(k)).map(namePattern);
  const parts: string[] = [];
  if (spaced.length) parts.push(`${BEFORE}(?:${spaced.join("|")})${AFTER}`);
  if (unspaced.length) parts.push(`(?:${unspaced.join("|")})`);
  return { regex: new RegExp(parts.join("|"), "gu"), holders };
}

interface Hit {
  start: number;
  end: number;
  ids: Set<string>;
}

/** Every match in the text, as spans of the ORIGINAL text. */
function hits(text: string, matcher: Matcher): Hit[] {
  const { folded, starts, ends } = foldText(text);
  const out: Hit[] = [];
  matcher.regex.lastIndex = 0;
  for (const m of Array.from(folded.matchAll(matcher.regex))) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (e === s) continue;
    const key = m[0].replace(/\s+/g, " ");
    const ids = matcher.holders.get(key);
    if (!ids) continue;
    const start = starts[s];
    // To the start of whatever produced the next folded character, so a
    // trailing combining mark goes with the name it sat on; never short of
    // the end of the last matched point.
    const end = e < folded.length ? Math.max(ends[e - 1], starts[e]) : text.length;
    out.push({ start, end, ids });
  }
  return out;
}

/** The members named anywhere in these texts, by a name only they hold. */
export function mentionedMembers(texts: readonly string[], members: readonly NamedMember[]): Set<string> {
  const found = new Set<string>();
  const matcher = buildMatcher(members);
  if (!matcher) return found;
  for (const text of texts) {
    if (!text) continue;
    for (const h of hits(text, matcher)) {
      if (h.ids.size === 1) found.add(Array.from(h.ids)[0]);
    }
  }
  return found;
}

/**
 * The text with every member name swapped for that member's code-name.
 *
 * A name only one member holds becomes their code-name. A name two or more
 * hold becomes `SHARED_NAME_STAND_IN`. A member with no code-name in
 * `codeNames` also becomes the stand-in: the name never stays, whatever the
 * caller forgot to mint.
 */
export function swapNames(
  text: string,
  members: readonly NamedMember[],
  codeNames: ReadonlyMap<string, string>,
): string {
  if (!text) return text;
  const matcher = buildMatcher(members);
  if (!matcher) return text;
  let out = "";
  let at = 0;
  for (const h of hits(text, matcher)) {
    if (h.start < at) continue;
    const only = h.ids.size === 1 ? Array.from(h.ids)[0] : null;
    const replacement = (only && codeNames.get(only)) || SHARED_NAME_STAND_IN;
    out += text.slice(at, h.start) + replacement;
    at = h.end;
  }
  return out + text.slice(at);
}
