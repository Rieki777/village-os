/**
 * THE GOVERNING PURPOSE STATEMENT: the sentence every later upgrade is
 * judged against.
 *
 * Rye, 2026-09-23: "all upgrades going forward will be judged against it."
 * Every village writes one. Amora's is a single sentence of roughly 140
 * words, produced by a fill-in template whose shape is five parts: who it
 * serves, what they suffer, the move from X to Y, by what means, and so that
 * what becomes true.
 *
 * ── WHAT "JUDGED AGAINST" DOES, AND WHAT IT DELIBERATELY DOES NOT ──────────
 *
 * His ruling is that THE PROPOSER WRITES A LINE. On a proposal that changes
 * how the village works, the proposer writes one line saying how it serves
 * the purpose; the line shows beside the proposal while people vote, and it
 * stays on the record. Three alternatives were put to him and he chose
 * against each: requiring the line on every proposal, displaying the
 * statement without recording anything, and making a holder answer before a
 * ballot may open.
 *
 * THE SCOPING IS PART OF THE RULING and it is the half most likely to be
 * quietly widened later. His reason for keeping small proposals free of it is
 * that a field on every proposal becomes a ritual people fill with "it does",
 * which looks like judgement happened when it did not. So the required set
 * below is short on purpose, and widening it is a decision somebody makes
 * against that sentence rather than a tidy-up.
 *
 * ── THIS FILE IS THE PURE HALF ─────────────────────────────────────────────
 *
 * The shape, the back-fill and every refusal's words live here, with no pool
 * in sight, so the client can import them for the wizard and the setup step
 * without dragging in mysql2. The read and the write live in
 * `server/lib/governingPurpose.ts`, and there is exactly one of each.
 */

/**
 * The `app_config` key. Config plane 4, alongside `brand`, `launch-state` and
 * `exit-policy`.
 */
export const GPS_DOC_KEY = "gps";

/**
 * THE BALLOT SUBJECT FOR CHANGING IT, defined here beside the document it
 * changes, the same way `CYCLE_SETTLEMENT` lives beside the settlement it
 * names. `shared/ballotSubjects.ts` imports this constant and prices it;
 * nothing hand-types the string twice.
 */
export const GPS_CHANGE = "gps_change";

/** The stored document. */
export interface GoverningPurposeDoc {
  /** The statement itself, as written. */
  statement: string;
  /** ISO instant it was last written. Empty string when it never has been. */
  writtenAt: string;
  /** The user id who last wrote it, or the ballot that carried it. */
  writtenBy: string;
}

/**
 * The shape a village that has never written one reads as.
 *
 * Every field present and empty, never a partial object, because the whole
 * point of `purposeDocFrom` below is that callers get all three fields
 * whatever is in the table.
 */
export const EMPTY_PURPOSE: GoverningPurposeDoc = { statement: "", writtenAt: "", writtenBy: "" };

/**
 * READ A STORED DOCUMENT, BACK-FILLING EVERY ABSENT KEY.
 *
 * A stored document in this codebase never merges defaults. `dbDocument.get()`
 * returns the fallback only when NO ROW EXISTS; the moment a row exists it
 * returns exactly what was written, keys and all. So the day somebody adds a
 * fourth field to this interface, every village that already wrote a
 * statement reads that field as `undefined` while the type says `string`, and
 * nothing anywhere would say so. The same trap cost `launch-state` a fix when
 * `declines` was added: a spread of an older document left the new key
 * undefined instead of empty.
 *
 * So the read goes through here and never through `get()` directly. Anything
 * that is not a string becomes the empty string, which is the same answer a
 * village with no row gets, and the one answer every caller below already has
 * to handle.
 */
export function purposeDocFrom(raw: unknown): GoverningPurposeDoc {
  const doc = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    statement: str(doc.statement),
    writtenAt: str(doc.writtenAt),
    writtenBy: str(doc.writtenBy),
  };
}

/**
 * HOW LONG A STATEMENT HAS TO BE BEFORE IT IS ONE, AND WHY THIS NUMBER.
 *
 * Counted in WORDS and never in characters, and that choice is the whole
 * defence. The failure mode worth catching is not an empty box, which
 * anybody would notice. It is a plausible non-answer: "TBD", or one ordinary
 * sentence that names none of the five parts. A character floor low enough to
 * be fair to a terse village passes both of those, and a character floor high
 * enough to refuse them demands an essay from a village that writes plainly.
 *
 * The template has five parts: who it serves, what they suffer, the move from
 * X to Y, by what means, so that what becomes true. Eighty words is sixteen
 * words a part, which is one short clause each and nothing more. Amora's own
 * statement is roughly 140 words, so a village writing a little over half the
 * length of the reference still clears this.
 *
 * What it refuses, measured rather than asserted, and pinned by the tests in
 * `governingPurpose.test.ts`: "TBD" is one word, and an ordinary single
 * sentence runs 20 to 40, so both land well under the floor while the
 * reference statement clears it by 60.
 */
export const PURPOSE_MIN_WORDS = 80;

/** A statement longer than this is a document, and a document is a different thing. */
export const PURPOSE_MAX_CHARS = 20_000;

/** Words, counted the way a person counts them: runs of non-whitespace. */
export function countWords(text: unknown): number {
  const t = String(text ?? "").trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

/**
 * Why this text is not a governing purpose statement, or null.
 *
 * ONE VALIDATOR, AND IT IS THE ONLY ONE. The founder's own write and the
 * closer that lands a passed change ballot both call this, so the two paths
 * cannot drift into different standards. That drift would not surface until a
 * village actually voted one through, which under the pen ruling may be years
 * away, and by then the two answers would both look deliberate.
 */
export function purposeStatementProblem(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (text === "") {
    return "A governing purpose statement is the sentence every later change is judged against, so it cannot be empty.";
  }
  if (text.length > PURPOSE_MAX_CHARS) {
    return `A governing purpose statement is one statement, so it stops at ${PURPOSE_MAX_CHARS} characters. This one is ${text.length}.`;
  }
  const words = countWords(text);
  if (words < PURPOSE_MIN_WORDS) {
    return (
      `A governing purpose statement says who this village serves, what they are up against, the move it is making, ` +
      `by what means, and what becomes true if it works. That takes at least ${PURPOSE_MIN_WORDS} words and this one is ${words}.`
    );
  }
  return null;
}

/** Has this village written one at all. */
export function hasGoverningPurpose(doc: GoverningPurposeDoc): boolean {
  return purposeStatementProblem(doc.statement) === null;
}

/**
 * ── THE SUBJECTS THAT CARRY A JUDGEMENT LINE ───────────────────────────────
 *
 * "On proposals that change how the village works." These five are that set,
 * and the set is closed:
 *
 *   mechanics        a change to the Game's own rules
 *   power_transfer   a power crossing to the village
 *   power_grant      a role being given a power it did not carry
 *   power_return     a power going back to the admin panel
 *   gps_change       the statement itself
 *
 * Every other subject is absent, which is the safe direction and also the
 * ruling: a quest payout, a seating, a moon settlement and an advisory vote
 * all stay friction-free. A subject a later lane adds inherits nothing.
 *
 * The statement's own change is in the set for the obvious reason: a village
 * moving the yardstick should say what the move serves, measured against the
 * yardstick that stands today.
 */
export const PURPOSE_ALIGNMENT_SUBJECTS: readonly string[] = [
  "mechanics",
  "power_transfer",
  "power_grant",
  "power_return",
  GPS_CHANGE,
];

/** Does a ballot on this subject need a judgement line. */
export function purposeAlignmentRequired(subjectType: unknown): boolean {
  return PURPOSE_ALIGNMENT_SUBJECTS.includes(String(subjectType ?? "").trim().toLowerCase());
}

/**
 * HOW SHORT A JUDGEMENT LINE MAY BE, and this floor is a reading of the
 * ruling rather than a number Rye named.
 *
 * His stated reason for scoping the field narrowly is that a field on every
 * proposal "becomes a ritual people fill with 'it does'". A required field
 * with no floor on the required subjects reaches the same place by a shorter
 * road. Twelve words is a sentence that has to name something: what the
 * proposal changes, and which part of the purpose that serves. "It does" is
 * two words, "yes" is one, and neither of them is a judgement.
 */
export const ALIGNMENT_MIN_WORDS = 12;

/** It shows beside the proposal while people vote, so it stops at a paragraph. */
export const ALIGNMENT_MAX_CHARS = 2_000;

/**
 * Why this judgement line will not do, or null. Null for a subject that needs
 * none, whatever was typed.
 */
export function purposeAlignmentProblem(subjectType: unknown, raw: unknown): string | null {
  if (!purposeAlignmentRequired(subjectType)) return null;
  const text = String(raw ?? "").trim();
  if (text === "") {
    return (
      "This one changes how the village works, so say in a line how it serves the governing purpose. " +
      "The whole roll reads it beside the proposal before voting."
    );
  }
  if (text.length > ALIGNMENT_MAX_CHARS) {
    return `This line shows beside the proposal, so it stops at ${ALIGNMENT_MAX_CHARS} characters. This one is ${text.length}.`;
  }
  if (countWords(text) < ALIGNMENT_MIN_WORDS) {
    return (
      `Say what this changes and which part of the purpose it serves. That takes at least ${ALIGNMENT_MIN_WORDS} words ` +
      `and this one is ${countWords(text)}.`
    );
  }
  return null;
}

/** Trim a judgement line to what the column will hold. Empty stays empty. */
export function normaliseAlignment(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, ALIGNMENT_MAX_CHARS);
}
