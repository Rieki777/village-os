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
 * admitted, and its admins and founders, whether or not they have claimed
 * their account yet. ADMITTED is the platform's one rule, `isAdmitted`
 * (server/lib/admission.ts): `membershipGranted`, or a stage grant at Member
 * or above. The grant matters here: `PUT /api/admin/players/:id/stage` writes
 * only `stageGranted`, so a check on `membershipGranted` alone let the name
 * of everybody an admin placed at Member by hand reach the public page.
 * Left out on purpose:
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
 * A ONE-WORD FORM IS SKIPPED when it is a word the platform calls people by
 * (`TITLE_WORDS`) or one a sentence is built from (`SENTENCE_WORDS`). The
 * first case is real: a founder who leaves the name blank at bootstrap is
 * stored as "Founder", and the rulings a public line describes need "the
 * founder keeps the purpose pen". The second keeps "An open circle meets each
 * moon" writable in a village with an An Nguyen in it. The whole display name
 * ("An Nguyen") is still protected; only the one-word form is dropped.
 *
 * ── HOW IT MATCHES ─────────────────────────────────────────────────────────
 *
 * Accents and compatibility forms folded ("Zoe" names Zoë, and the full-width
 * "Ａｓｈ" a Japanese keyboard types names Ash), and word-bounded: the name
 * must not touch a letter or digit on either side, so "Ashford" does not name
 * Ash and "Ash's" does. The boundary is Unicode-aware, because `\b` in a
 * JavaScript regular expression only knows the ASCII letters and would call
 * "Zoë" two words. The refusal quotes the matching words back from the
 * writer's own line, so it tells them nothing they did not type.
 *
 * A WHOLE NAME OF TWO OR MORE WORDS matches in any case: "will harper" is
 * still Will Harper. A ONE-WORD FORM matches only where the line writes it as
 * a name, starting with a capital: "Will holds the keys" names Will Harper,
 * and "the stewards will review it" does not. A script with no capitals
 * (Chinese, Korean, Arabic, Hebrew and most others) has only the one way to
 * write a name, so there every occurrence counts.
 *
 * A LATIN NAME ENDS WHERE THE LATIN LETTERS END. Japanese and Chinese set a
 * Latin name straight against their own letters ("Ashさん", "由Ash负责"), and
 * so do Hebrew and Arabic prefixes ("לAsh"), so for a name written in Latin
 * letters a letter from any other script is a word edge.
 *
 * A script written without spaces between words (Chinese, Japanese, Thai,
 * Lao, Khmer, Burmese) has no word edge to find, so a name written in one is
 * matched anywhere in the line: 王伟 is named in 王伟负责钥匙, where a
 * boundary rule would find a letter touching each side and let it through.
 *
 * NOT CAUGHT, and known: a name in a spaced script other than Latin with a
 * particle or prefix of its own script attached (Korean 김지민이, Hebrew
 * לדוד, Arabic لأحمد). Matching those anywhere would refuse ordinary words
 * that contain a short name, which is the choice this rule declines to make
 * on its own.
 */
import { isExampleUser } from "./examples";
import { isTombstone } from "./oauthAccounts";
import { isAdmitted, type AdmissionRecord } from "./admission";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { FORMAT_CHARACTERS } from "../../shared/canvasPublicLines";

/*
 * Built with the constructor: the typecheck target predates the `u` flag on a
 * regular expression literal, and every runtime this ships to has it.
 */
const MARKS = new RegExp("\\p{M}", "gu");
const LETTER = new RegExp("\\p{L}", "gu");
const LATIN = new RegExp("\\p{Script=Latin}", "u");
/** A letter from a script that writes words with no space between them. */
const UNSPACED_SCRIPT = new RegExp(
  "[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Thai}\\p{Script=Lao}\\p{Script=Khmer}\\p{Script=Myanmar}]",
  "u",
);
/** What continues a word, for a name in any script but Latin. */
const ANY_WORD_CHARACTER = "[\\p{L}\\p{N}]";
/** What continues a word, for a name in Latin letters. */
const LATIN_WORD_CHARACTER = "[\\p{Script=Latin}\\p{N}]";

/** The member fields this reads. Any member record satisfies it. */
export interface NameFacts extends AdmissionRecord {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  isExample?: unknown;
}

const MIN_NAME_LETTERS = 2;

/** Words the platform calls people by. A display name that is one of them is a title, never a name. */
const TITLE_WORDS: ReadonlySet<string> = new Set([
  "founder",
  "admin",
  "administrator",
  "steward",
  "member",
  "villager",
  "guest",
  "visitor",
]);

/**
 * The words sentences are built from: articles, pronouns, determiners,
 * conjunctions and prepositions. No first name is worth refusing one of them
 * at the start of every sentence. Modal verbs are NOT here: "Will" and "May"
 * are names, and written in the middle of a sentence the capital rule already
 * tells them apart.
 */
const SENTENCE_WORDS: ReadonlySet<string> = new Set([
  "the", "an", "we", "our", "us", "you", "your", "they", "their", "it", "its",
  "this", "that", "these", "those", "every", "each", "all", "any", "some", "no",
  "if", "when", "where", "and", "or", "but", "so", "in", "on", "at", "of",
  "for", "to", "by", "with", "from", "as",
]);

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
    // NFKD, so a full-width or otherwise compatibility-encoded letter folds to the plain one.
    const f = ch.normalize("NFKD").replace(MARKS, "").toLowerCase();
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
export function countsAsVillager(member: NameFacts): boolean {
  if (!member || isExampleUser(member as Record<string, any>)) return false;
  if (isTombstone({ email: String(member.email ?? "") })) return false;
  return isAdmitted(member, GAME_CONFIG.stages) || member.role === "admin" || member.role === "founder";
}

/**
 * The names a public line may not hold, folded and de-duplicated: each
 * villager's whole display name and its first word, less the one-word forms
 * the header says are words and not names.
 */
export function namesToProtect(members: readonly NameFacts[]): string[] {
  const out = new Set<string>();
  for (const member of members) {
    if (!countsAsVillager(member)) continue;
    const whole = tidyName(member.name);
    if (!whole) continue;
    for (const form of [whole, whole.split(" ")[0]]) {
      const folded = fold(form).text;
      if (letters(folded) < MIN_NAME_LETTERS) continue;
      if (!folded.includes(" ") && (TITLE_WORDS.has(folded) || SENTENCE_WORDS.has(folded))) continue;
      out.add(folded);
    }
  }
  return Array.from(out);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The pattern for one folded name, with the word edges its script calls for. */
function patternFor(name: string): RegExp {
  const body = name.split(" ").map(escapeRegExp).join("\\s+");
  if (UNSPACED_SCRIPT.test(name)) return new RegExp(body, "gu");
  const chars = Array.from(name);
  const before = LATIN.test(chars[0] ?? "") ? LATIN_WORD_CHARACTER : ANY_WORD_CHARACTER;
  const after = LATIN.test(chars[chars.length - 1] ?? "") ? LATIN_WORD_CHARACTER : ANY_WORD_CHARACTER;
  return new RegExp(`(?<!${before})${body}(?!${after})`, "gu");
}

/**
 * Is the word starting at `at` written the way a name is: with a capital, or
 * in a script that has no capitals? "Will" names Will Harper; "will" is a verb.
 */
function writtenAsAName(text: string, at: number): boolean {
  const first = Array.from(text.slice(at, at + 2))[0] ?? "";
  const lower = first.toLowerCase();
  return lower !== first || lower === first.toUpperCase();
}

/**
 * The words in `line` that name somebody in `names` (from `namesToProtect`),
 * exactly as the line spells them, or null when it names nobody. The longest
 * name is tried first, so "Ash Brook" is quoted whole where the line has it.
 * A one-word name counts only where the line writes it as a name (see the header).
 */
export function nameInLine(line: string, names: readonly string[]): string | null {
  const composed = line.normalize("NFC");
  const folded = fold(composed);
  const longestFirst = Array.from(names).sort((a, b) => b.length - a.length);
  for (const name of longestFirst) {
    const oneWord = !name.includes(" ");
    const pattern = patternFor(name);
    let hit: RegExpExecArray | null;
    while ((hit = pattern.exec(folded.text)) !== null) {
      const start = folded.from[hit.index];
      const end = folded.from[hit.index + hit[0].length];
      if (!oneWord || writtenAsAName(composed, start)) return composed.slice(start, end);
    }
  }
  return null;
}

/** What the writer is told when their line holds a name. */
export function nameRefusal(quoted: string): string {
  return `"${quoted}" is the name of someone in this village, and a public line names nobody. Say which role does it, for example "our care holder".`;
}
