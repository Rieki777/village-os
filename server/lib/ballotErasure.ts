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
  ballotWordsOfProposalsBy,
  ballotWordsOpenedBy,
  ballotWordsOpenedOf,
  forgetPublicLinesOn,
  rewriteBallotWords,
  slatesHolding,
  type BallotWords,
} from "../repos/ballotWords";
import { SUBJECT_FOR_ITEM_KIND, VILLAGE_LAUNCH } from "../../shared/ballotSubjects";
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

/*
 * ROUND 4, FINDING 9: THREE TEMPLATES THE STEP ABOVE NEVER KNEW, for the
 * erasure's "proposal-ballot-words-after-tombstone" step. Each is matched by
 * the template's own fixed wording and found by the member's id, so the step
 * needs no name and cleans an old tombstone the same way it cleans a fresh
 * one.
 *
 *   1. A GAME-MECHANICS PROPOSAL'S VOTE (mechanics, mint_rule or
 *      governance_mode, every subject a proposal can be priced at) freezes
 *      "Proposed by <first name> on <date>; ..." (proposalMarkdown,
 *      server/lib/mechanics.ts) into its header, above the first "## ". Only
 *      that header line is touched, so the proposer's rationale below keeps
 *      every word.
 *   2. A LAUNCH VOTE THEY OPENED names them in three fixed sentences
 *      (launchProposalDoc, server/lib/launchProposal.ts), each of which only
 *      ever holds the opener.
 *   3. A LAUNCH VOTE'S STEWARD SLATE lists one "- <first name>" line per
 *      `ballot_steward_slate` row, in the opener's order, which the table does
 *      not keep. So the lines are matched against the slate: every LIVING
 *      person on it claims the line that reads their first name, and when all
 *      of them have, every line left belongs to somebody who has gone and
 *      reads "- A departed member". A living namesake therefore keeps their
 *      own line. When a living person's line no longer reads their name (a
 *      rename since), or the lines and the rows do not agree in number, no
 *      line is guessed at: the member's own line goes only if their first
 *      name is still known, and otherwise the slate is left and counted.
 */

/** Every subject a game-mechanics proposal's vote can be opened under. */
const PROPOSAL_SUBJECTS: readonly string[] = Array.from(new Set(Object.values(SUBJECT_FOR_ITEM_KIND)));

const PROPOSED_BY = /^Proposed by .+ on (\d{4}-\d{2}-\d{2}); /;

/** A proposal vote's document with its header's "Proposed by" line naming nobody. */
export function scrubProposedBy(doc: string): string {
  const lines = doc.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) break;
    if (PROPOSED_BY.test(lines[i])) lines[i] = lines[i].replace(PROPOSED_BY, `Proposed by ${DEPARTED_IN_A_BALLOT} on $1; `);
  }
  return lines.join("\n");
}

/** The three sentences a launch vote names its opener in, and what each reads instead. */
const LAUNCH_OPENER: ReadonlyArray<[RegExp, string]> = [
  [/^.+ (opened this vote and chose who it puts forward\. )/, `${DEPARTED_OPENS_A_SENTENCE} $1`],
  [/^.+ (named nobody for the steward role, so the village starts with it empty\. )/, `${DEPARTED_OPENS_A_SENTENCE} $1`],
  [/^(Every item on the journey to launch read done when ).+( opened this, on \d{4}-\d{2}-\d{2}\.\r?)$/, `$1${DEPARTED_IN_A_BALLOT}$2`],
];

/** A launch vote's document with its opener named nowhere. */
export function scrubLaunchOpener(doc: string): string {
  return doc
    .split("\n")
    .map((line) => {
      for (const [re, to] of LAUNCH_OPENER) if (re.test(line)) return line.replace(re, to);
      return line;
    })
    .join("\n");
}

/** The heading the launch document lists its slate under. */
const SLATE_HEADING = "## Who carries the steward role";

/** Where a launch document's "- <name>" lines are, and what each reads. */
function slateLinesOf(lines: string[]): Array<{ at: number; name: string }> {
  const heading = lines.findIndex((l) => l.replace(/\r$/, "") === SLATE_HEADING);
  if (heading < 0) return [];
  let i = heading + 1;
  while (i < lines.length && !lines[i].startsWith("- ") && !lines[i].startsWith("## ")) i += 1;
  const out: Array<{ at: number; name: string }> = [];
  for (; i < lines.length && lines[i].startsWith("- "); i += 1) out.push({ at: i, name: lines[i].replace(/\r$/, "").slice(2) });
  return out;
}

/**
 * A launch document's slate with the lines of everybody on it who has gone
 * reading "- A departed member". `living` is the first name of every living
 * person on the slate; `rows` is how many people the slate holds; `known` is
 * the departing member's own first name, when it is still known. Null when no
 * line can be told apart (see the header).
 */
export function forgetSlateLinesIn(doc: string, slate: { rows: number; living: readonly string[]; known: string | null }): { doc: string; changed: number } | null {
  const lines = doc.split("\n");
  const found = slateLinesOf(lines);
  const departedLine = (i: number) => `- ${DEPARTED_OPENS_A_SENTENCE}${lines[i].endsWith("\r") ? "\r" : ""}`;
  const open = found.filter((l) => l.name !== DEPARTED_OPENS_A_SENTENCE);
  const unclaimed = [...open];
  let allClaimed = found.length === slate.rows;
  for (const first of slate.living) {
    const k = unclaimed.findIndex((l) => l.name === first);
    if (k < 0) allClaimed = false;
    else unclaimed.splice(k, 1);
  }
  let targets = allClaimed ? unclaimed : [];
  if (!allClaimed && slate.known) {
    const own = unclaimed.find((l) => l.name === slate.known);
    if (own) targets = [own];
  }
  if (!targets.length) return allClaimed || found.length === 0 || open.length === 0 ? { doc, changed: 0 } : null;
  for (const t of targets) lines[t.at] = departedLine(t.at);
  return { doc: lines.join("\n"), changed: targets.length };
}

export interface ProposalBallotErasureCounts {
  /** Proposal votes whose "Proposed by" line changed. */
  proposals: number;
  /** Launch votes they opened whose opener sentences changed. */
  launchesOpened: number;
  /** Slate lines that now read "- A departed member". */
  slateLines: number;
  /** Launch votes whose slate could not be read safely, left as they were. */
  slatesLeft: number;
}

/** Take a departed member's name out of the proposal and launch ballots that carry it. See the block above. */
export async function forgetProposalBallotWordsOf(
  pool: Pool,
  who: { id: string; name?: string | null; handle?: string | null; email?: string | null },
): Promise<ProposalBallotErasureCounts> {
  const counts: ProposalBallotErasureCounts = { proposals: 0, launchesOpened: 0, slateLines: 0, slatesLeft: 0 };
  if (!who.id) return counts;
  const save = (b: BallotWords, docMarkdown: string) =>
    docMarkdown !== b.docMarkdown && rewriteBallotWords(pool, b.id, { title: b.title, docMarkdown, outcomeNote: b.outcomeNote });

  for (const b of await ballotWordsOfProposalsBy(pool, who.id, PROPOSAL_SUBJECTS)) {
    if (await save(b, scrubProposedBy(b.docMarkdown))) counts.proposals += 1;
  }
  for (const b of await ballotWordsOpenedOf(pool, who.id, VILLAGE_LAUNCH)) {
    if (await save(b, scrubLaunchOpener(b.docMarkdown))) counts.launchesOpened += 1;
  }
  const known = !isTombstone({ email: String(who.email ?? "") }) && !!String(who.name ?? "").trim() && String(who.name).trim() !== DEPARTED_OPENS_A_SENTENCE;
  // The slate's lines are written with the launch door's firstName, "Someone" for a member with no name.
  const slateName = (name: string) => firstNameOf(name) || "Someone";
  for (const { ballot, slate } of await slatesHolding(pool, who.id)) {
    const living = slate
      .filter((s) => s.userId !== who.id && s.name != null && !isTombstone({ email: String(s.email ?? "") }))
      .map((s) => slateName(String(s.name)));
    const out = forgetSlateLinesIn(ballot.docMarkdown, { rows: slate.length, living, known: known ? slateName(String(who.name)) : null });
    if (!out) {
      counts.slatesLeft += 1;
      continue;
    }
    if (await save(ballot, out.doc)) counts.slateLines += out.changed;
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
