/**
 * A DEPARTED MEMBER'S NAME, TAKEN OUT OF THE BALLOTS THAT CARRY IT, for the
 * erasure's "ballot-words-after-tombstone" step (server/lib/erasure.ts). The
 * reads and writes are server/repos/ballotWords.ts, which says which ballots
 * name a member and why.
 *
 * WHAT CHANGES, AND WHAT NEVER DOES (round 2, finding 6). A ballot about the
 * member keeps its subject, its method, its electorate, its votes, its status
 * and its dates, so what the village decided, and how, reads exactly as it
 * did. Its words stop naming them: the title, the document and the closer's
 * note say "a departed member" where the member's name stood, and its public
 * pulse lines go. A ballot the member opened loses only its last line's name,
 * "Asked by <first name> on <date>.". The roll's notices on other people's
 * bells, and their emailed copies, are rewritten by the notices steps
 * (server/repos/noticesNaming.ts), which find them by the ballot's id.
 *
 * WHICH SPELLINGS. On a ballot ABOUT them every word is about them, so their
 * full name, their @handle and their first name go wherever they stand as a
 * whole word, and so does the name the title was written with, read back off
 * the title's own template, which is the one spelling a rename since cannot
 * have moved. The rules are the alignment store's (server/lib/alignmentErasure.ts):
 * case-sensitive, on word boundaries, never beside a number, so "Wrenfield"
 * and "31 May" stay. The line "Asked by <first name> on <date>." names whoever
 * opened the ballot, who is somebody else, so it is never touched here.
 *
 * A SEAT VOTE OPENED FROM THEIR RAISED HAND (round 3, finding 11). The hand
 * door's reason, under "## Why this person", opens with the full name the hand
 * was raised under, then quotes the hand's note line by line. The note is the
 * member's own words, which the erasure takes off the hand itself, so here it
 * goes too: the "They wrote:" line and its run of "> " lines become one line
 * saying a note went with them, and the opening line's subject reads "A
 * departed member" whatever name it carried, which is the one place a surname
 * survives when the step knows only the first name off the title. Both are
 * found by the door's own wording (`handVoteReason`, shared/powerHands.ts) and
 * only at that place, so whatever the member who put the hand to the village
 * wrote after it, quotes of their own included, stays as they wrote it. A
 * name that member typed into their own words is left to the spellings above,
 * so on a tombstone a surname typed there can still stand.
 *
 * IDEMPOTENT, as the sweep requires: a rewritten text names nobody, so a
 * second run writes the same words or none. A target that is still a
 * tombstone (a record from before 0282 that stopped past the tombstone, or an
 * erasure asked again after one finished) has no name left to look for, and
 * the spellings read off the titles are then the only ones used.
 */
import type { Pool } from "mysql2/promise";
import {
  ballotWordsAbout,
  ballotWordsOpenedBy,
  forgetPublicLinesOn,
  rewriteBallotWords,
  type BallotWords,
} from "../repos/ballotWords";
import { HAND_NOTE_OPENS, HAND_RAISED_LINE, SEAT_VOTE_REASON_HEADING } from "../../shared/powerHands";
import { isTombstone } from "./oauthAccounts";

/** What the member's name reads as inside a ballot's words. */
export const DEPARTED_IN_A_BALLOT = "a departed member";

/** The same words where a sentence begins, which is also the name the tombstone carries. */
export const DEPARTED_OPENS_A_SENTENCE = "A departed member";

/**
 * What a seat vote opened from their raised hand says where it quoted the
 * hand's note. Never "They wrote nothing with it.", the door's words for a
 * hand with no note, because they did write one.
 */
export const HAND_NOTE_WENT = "They wrote a note with it, and the note went when they left.";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first name the ballot doors write: `firstName` in server/index.ts, less its "Someone" for a member with no name. */
const firstNameOf = (name: unknown): string => String(name ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * Words a title can carry where a name stood that are never a name to look
 * for (round 3, the guard from finding 0's fix). A door that opens a ballot
 * about a member who is already a tombstone writes the tombstone's first
 * name, "A", and `firstName` writes "Someone" for a member with no name. Read
 * back as a spelling, either would rewrite every standalone "A" or "Someone"
 * in the words of the living member who opened the ballot.
 */
const NEVER_A_SPELLING: ReadonlySet<string> = new Set([
  DEPARTED_IN_A_BALLOT,
  DEPARTED_OPENS_A_SENTENCE,
  firstNameOf(DEPARTED_OPENS_A_SENTENCE),
  "Someone",
]);

/** The line every door that opens a ballot ends its document with. */
const ASKED_BY = /^Asked by (.+) on (\d{4}-\d{2}-\d{2})\.$/;

/**
 * The name the title was written with, read back off its template, or null
 * when the title is not one the two doors write (a title cut at 200
 * characters, say), or when what stands there is never a name (the
 * tombstone's "A", see NEVER_A_SPELLING).
 */
export function nameInTitle(subjectType: string, title: string): string | null {
  const m =
    subjectType === "role_unseat"
      ? /^.+: the village asks to take the role back from (.+)$/.exec(title)
      : subjectType === "role_seat"
        ? /^.+: the village asks (.+) to sit in it$/.exec(title)
        : null;
  const name = m?.[1]?.trim() ?? "";
  return name && !NEVER_A_SPELLING.has(name) ? name : null;
}

/** Every spelling to take out, longest first so "Ana Q" goes before "Ana". */
export function spellingsOf(names: ReadonlyArray<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const s = String(n ?? "").trim();
    if (s && !NEVER_A_SPELLING.has(s)) out.add(s);
  }
  return Array.from(out).sort((a, b) => b.length - a.length);
}

/**
 * Replace every whole-word, case-sensitive mention of these spellings that is
 * not part of a date, in one line. The replacement opens with a capital where
 * a sentence or a heading begins.
 */
function scrubLine(line: string, spellings: readonly string[]): string {
  let out = line;
  for (const name of spellings) {
    const re = new RegExp(`(?<![\\w@])(?<!\\d[ ,.]?)${escape(name)}(?!\\w)(?![ ,.]?\\d)`, "g");
    out = out.replace(re, (_m, offset: number, whole: string) => {
      const before = whole.slice(0, offset).replace(/^\s*(?:#+\s*|[-*>]\s*)?/, "");
      const opens = before.trim() === "" || /[.!?]\s+$/.test(before);
      return opens ? DEPARTED_OPENS_A_SENTENCE : DEPARTED_IN_A_BALLOT;
    });
  }
  return out;
}

/** A ballot's text with these spellings taken out, line by line, the "Asked by" line left as it is. */
export function scrubBallotText(text: string, spellings: readonly string[]): string {
  if (!spellings.length) return text;
  return text
    .split("\n")
    .map((line) => (ASKED_BY.test(line.replace(/\r$/, "")) ? line : scrubLine(line, spellings)))
    .join("\n");
}

/**
 * A seat vote's document with the hand door's opening taken off the member,
 * found where the door writes it and nowhere else: the first line under
 * "## Why this person" when it is the door's "<name> raised a hand <offer> on
 * <date>.", and the "They wrote:" paragraph straight after it, its blank line
 * and its run of lines starting ">". The run ends at the first line that does
 * not start with ">", which is the blank line the door puts before the next
 * part, so the opener's own words after it are never reached. Every write is
 * a constant or a part of the line it replaces, so a second run writes the
 * same text. A document of any other shape comes back as it was.
 */
export function forgetHandNoteIn(doc: string): string {
  const lines = doc.split("\n");
  const bare = (i: number) => (lines[i] ?? "").replace(/\r$/, "");
  const cr = (i: number) => ((lines[i] ?? "").endsWith("\r") ? "\r" : "");
  const nextFilled = (from: number) => {
    let i = from;
    while (i < lines.length && bare(i).trim() === "") i += 1;
    return i;
  };
  const heading = lines.findIndex((_, i) => bare(i) === SEAT_VOTE_REASON_HEADING);
  if (heading < 0) return doc;
  const first = nextFilled(heading + 1);
  const raised = HAND_RAISED_LINE.exec(bare(first));
  if (!raised) return doc;
  lines[first] = `${DEPARTED_OPENS_A_SENTENCE} raised a hand ${raised[2]} on ${raised[3]}.${cr(first)}`;
  const opens = nextFilled(first + 1);
  if (bare(opens) === HAND_NOTE_OPENS) {
    const quote = nextFilled(opens + 1);
    let end = quote;
    while (end < lines.length && bare(end).startsWith(">")) end += 1;
    if (end > quote) lines.splice(opens, end - opens, `${HAND_NOTE_WENT}${cr(opens)}`);
  }
  return lines.join("\n");
}

/** The document of a ballot the member opened, with its last "Asked by" line naming nobody. */
export function scrubAskedBy(doc: string): string {
  const lines = doc.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const bare = lines[i].replace(/\r$/, "");
    const m = ASKED_BY.exec(bare);
    if (!m) continue;
    if (m[1] === DEPARTED_IN_A_BALLOT) return doc;
    lines[i] = `Asked by ${DEPARTED_IN_A_BALLOT} on ${m[2]}.${lines[i].endsWith("\r") ? "\r" : ""}`;
    return lines.join("\n");
  }
  return doc;
}

export interface BallotErasureCounts {
  /** Ballots about the member whose words changed. */
  about: number;
  /** Ballots the member opened whose "Asked by" line changed. */
  opened: number;
  /** Public pulse lines about the ballots about them, deleted. */
  lines: number;
}

/** Take a departed member's name out of every ballot that carries it. See the header. */
export async function forgetBallotWordsOf(
  pool: Pool,
  who: { id: string; name?: string | null; handle?: string | null; email?: string | null },
): Promise<BallotErasureCounts> {
  const counts: BallotErasureCounts = { about: 0, opened: 0, lines: 0 };
  if (!who.id) return counts;
  // A resume whose old address another account holds now gets the address back empty and the name still (`asTheyWere`).
  const known = !isTombstone({ email: String(who.email ?? "") }) && !!String(who.name ?? "").trim() && String(who.name).trim() !== DEPARTED_OPENS_A_SENTENCE;
  const handle = String(who.handle ?? "").trim().replace(/^@/, "");
  const ownSpellings = known ? [who.name, handle ? `@${handle}` : null, firstNameOf(who.name)] : [];

  const about = await ballotWordsAbout(pool, who.id);
  counts.lines = await forgetPublicLinesOn(pool, about.map((b) => b.id));
  for (const b of about) {
    const spellings = spellingsOf([...ownSpellings, nameInTitle(b.subjectType, b.title)]);
    // Only a seat vote is opened from a hand, and its subject is always the hand's author.
    const doc = b.subjectType === "role_seat" ? forgetHandNoteIn(b.docMarkdown) : b.docMarkdown;
    if (await rewrite(pool, b, (text) => scrubBallotText(text, spellings), doc)) counts.about += 1;
  }
  for (const b of await ballotWordsOpenedBy(pool, who.id)) {
    const doc = scrubAskedBy(b.docMarkdown);
    if (doc !== b.docMarkdown && (await rewriteBallotWords(pool, b.id, { title: b.title, docMarkdown: doc, outcomeNote: b.outcomeNote }))) counts.opened += 1;
  }
  return counts;
}

async function rewrite(pool: Pool, b: BallotWords, scrub: (text: string) => string, docMarkdown = b.docMarkdown): Promise<boolean> {
  const next = {
    title: scrub(b.title),
    docMarkdown: scrub(docMarkdown),
    outcomeNote: b.outcomeNote == null ? null : scrub(b.outcomeNote),
  };
  if (next.title === b.title && next.docMarkdown === b.docMarkdown && next.outcomeNote === b.outcomeNote) return false;
  return rewriteBallotWords(pool, b.id, next);
}
