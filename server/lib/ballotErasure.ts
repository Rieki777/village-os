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
import { isTombstone } from "./oauthAccounts";

/** What the member's name reads as inside a ballot's words. */
export const DEPARTED_IN_A_BALLOT = "a departed member";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first name the ballot doors write: `firstName` in server/index.ts, less its "Someone" for a member with no name. */
const firstNameOf = (name: unknown): string => String(name ?? "").trim().split(/\s+/)[0] ?? "";

/** The line every door that opens a ballot ends its document with. */
const ASKED_BY = /^Asked by (.+) on (\d{4}-\d{2}-\d{2})\.$/;

/**
 * The name the title was written with, read back off its template, or null
 * when the title is not one the two doors write (a title cut at 200
 * characters, say).
 */
export function nameInTitle(subjectType: string, title: string): string | null {
  const m =
    subjectType === "role_unseat"
      ? /^.+: the village asks to take the role back from (.+)$/.exec(title)
      : subjectType === "role_seat"
        ? /^.+: the village asks (.+) to sit in it$/.exec(title)
        : null;
  const name = m?.[1]?.trim() ?? "";
  return name && name !== DEPARTED_IN_A_BALLOT ? name : null;
}

/** Every spelling to take out, longest first so "Ana Q" goes before "Ana". */
export function spellingsOf(names: ReadonlyArray<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const s = String(n ?? "").trim();
    if (s && s !== DEPARTED_IN_A_BALLOT) out.add(s);
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
      return opens ? "A departed member" : DEPARTED_IN_A_BALLOT;
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
  const known = !isTombstone({ email: String(who.email ?? "") });
  const handle = String(who.handle ?? "").trim().replace(/^@/, "");
  const ownSpellings = known ? [who.name, handle ? `@${handle}` : null, firstNameOf(who.name)] : [];

  const about = await ballotWordsAbout(pool, who.id);
  counts.lines = await forgetPublicLinesOn(pool, about.map((b) => b.id));
  for (const b of about) {
    const spellings = spellingsOf([...ownSpellings, nameInTitle(b.subjectType, b.title)]);
    if (await rewrite(pool, b, (text) => scrubBallotText(text, spellings))) counts.about += 1;
  }
  for (const b of await ballotWordsOpenedBy(pool, who.id)) {
    const doc = scrubAskedBy(b.docMarkdown);
    if (doc !== b.docMarkdown && (await rewriteBallotWords(pool, b.id, { title: b.title, docMarkdown: doc, outcomeNote: b.outcomeNote }))) counts.opened += 1;
  }
  return counts;
}

async function rewrite(pool: Pool, b: BallotWords, scrub: (text: string) => string): Promise<boolean> {
  const next = {
    title: scrub(b.title),
    docMarkdown: scrub(b.docMarkdown),
    outcomeNote: b.outcomeNote == null ? null : scrub(b.outcomeNote),
  };
  if (next.title === b.title && next.docMarkdown === b.docMarkdown && next.outcomeNote === b.outcomeNote) return false;
  return rewriteBallotWords(pool, b.id, next);
}
