/**
 * DOES THIS PUBLIC LINE NAME ANYBODY THE VILLAGE HAS ADMITTED? (2026-09-28)
 *
 * The canvas's public lines (shared/canvasPublicLines.ts) are read by anybody
 * at all, so they say "our Care Holder" and never "Ash". This file is the
 * rule both doors ask: the write refuses a line that holds a name, and the
 * public read holds back a stored line that has come to hold one since.
 *
 * ── WHOSE NAMES ────────────────────────────────────────────────────────────
 *
 * Everybody the village counts as one of its own today: a member it has
 * admitted (`hasMembership`, the one predicate), and its admins and founders,
 * whether or not they have claimed their account yet. Left out on purpose:
 *
 *   - standing example identities, which are content and never people;
 *   - tombstones, whose name erasure has already replaced;
 *   - accounts the village has not admitted. On a fork with invite-only off
 *     anybody can register, and a registrant calling themselves "The" or
 *     "River" would otherwise take every line holding that word off the
 *     public page. Admission is the village's own act, so the list is one
 *     the village chose.
 *
 * ── WHICH FORMS OF A NAME ──────────────────────────────────────────────────
 *
 * The whole display name, and its first word, because the first word is how
 * every public surface on this platform shows a person (`firstName`). A
 * surname alone is not a form the platform shows anybody by, and checking it
 * would refuse ordinary words ("Brook", "Fielding") with no name in sight.
 * A form with fewer than two letters is skipped: it would refuse every "a".
 *
 * ── HOW IT MATCHES ─────────────────────────────────────────────────────────
 *
 * Case-insensitive, accents folded ("Zoe" names Zoë), and word-bounded: the
 * name must not touch a letter or digit on either side, so "Ashford" does not
 * name Ash and "Ash's" does. The boundary is Unicode-aware, because `\b` in a
 * JavaScript regular expression only knows the ASCII letters and would call
 * "Zoë" two words. The refusal quotes the matching words back from the
 * writer's own line, so it tells them nothing they did not type.
 *
 * A script written without spaces between words (Chinese, Japanese, Thai,
 * Lao, Khmer, Burmese) has no word edge to find, so a name written in one is
 * matched anywhere in the line: 王伟 is named in 王伟负责钥匙, where a
 * boundary rule would find a letter touching each side and let it through.
 */
import { isExampleUser } from "./examples";
import { isTombstone } from "./oauthAccounts";
import { FORMAT_CHARACTERS } from "../../shared/canvasPublicLines";

/*
 * Built with the constructor: the typecheck target predates the `u` flag on a
 * regular expression literal, and every runtime this ships to has it.
 */
const MARKS = new RegExp("\\p{M}", "gu");
const LETTER = new RegExp("\\p{L}", "gu");
/** A letter from a script that writes words with no space between them. */
const UNSPACED_SCRIPT = new RegExp(
  "[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Thai}\\p{Script=Lao}\\p{Script=Khmer}\\p{Script=Myanmar}]",
  "u",
);

/** The member fields this reads. Any member record satisfies it. */
export interface NameFacts {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  isExample?: unknown;
}

const MIN_NAME_LETTERS = 2;

/** A string lowered and stripped of accents, with where each folded unit came from in the original. */
interface Folded {
  text: string;
  /** `from[i]` is the index in the original of the character folded unit `i` came from; one extra entry marks the end. */
  from: number[];
}

function fold(original: string): Folded {
  let text = "";
  const from: number[] = [];
  let at = 0;
  for (const ch of original) {
    const f = ch.normalize("NFD").replace(MARKS, "").toLowerCase();
    for (let k = 0; k < f.length; k += 1) from.push(at);
    text += f;
    at += ch.length;
  }
  from.push(at);
  return { text, from };
}

/** Composed, no invisible characters, single spaces: the form a name is compared in. */
function tidyName(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(FORMAT_CHARACTERS, "")
    .trim()
    .replace(/\s+/g, " ");
}

function letters(text: string): number {
  return (text.match(LETTER) ?? []).length;
}

/** Is this account one of the village's own today? See the header. */
export function countsAsVillager(member: NameFacts, hasMembership: (m: any) => boolean): boolean {
  if (!member || isExampleUser(member as Record<string, any>)) return false;
  if (isTombstone({ email: String(member.email ?? "") })) return false;
  return hasMembership(member) || member.role === "admin" || member.role === "founder";
}

/**
 * The names a public line may not hold, folded and de-duplicated: each
 * villager's whole display name and its first word.
 */
export function namesToProtect(members: readonly NameFacts[], hasMembership: (m: any) => boolean): string[] {
  const out = new Set<string>();
  for (const member of members) {
    if (!countsAsVillager(member, hasMembership)) continue;
    const whole = tidyName(member.name);
    if (!whole) continue;
    for (const form of [whole, whole.split(" ")[0]]) {
      const folded = fold(form).text;
      if (letters(folded) >= MIN_NAME_LETTERS) out.add(folded);
    }
  }
  return Array.from(out);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The words in `line` that name somebody in `names` (from `namesToProtect`),
 * exactly as the line spells them, or null when it names nobody. The longest
 * name is tried first, so "Ash Brook" is quoted whole where the line has it.
 */
export function nameInLine(line: string, names: readonly string[]): string | null {
  const composed = line.normalize("NFC");
  const folded = fold(composed);
  const longestFirst = Array.from(names).sort((a, b) => b.length - a.length);
  for (const name of longestFirst) {
    const body = name.split(" ").map(escapeRegExp).join("\\s+");
    const pattern = UNSPACED_SCRIPT.test(name)
      ? new RegExp(body, "u")
      : new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "u");
    const hit = pattern.exec(folded.text);
    if (!hit) continue;
    const start = folded.from[hit.index];
    const end = folded.from[hit.index + hit[0].length];
    return composed.slice(start, end);
  }
  return null;
}

/** What the writer is told when their line holds a name. */
export function nameRefusal(quoted: string): string {
  return `"${quoted}" is the name of someone in this village, and a public line names nobody. Say which role does it, for example "our care holder".`;
}
