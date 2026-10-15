/**
 * THE `membership` ALIGNMENT SUBJECT: A LOVE LETTER SIGNING ALIGNS THE MEMBER
 * WITH THE WORDS THEY READ (seat settings PR9).
 *
 * A signed-in member who signs the Love Letter (`POST /api/forms/submit`, type
 * `membership-508`) now writes, IN THE SAME TRANSACTION AS THE SIGNING ROW:
 *
 *   the text      the letter's exact words as the page showed them
 *                 (shared/membershipLetter.ts renders them for both), titled
 *                 with what the village calls the letter
 *                 (`project.commitmentName`), salted and hashed as every text
 *                 in the store is (`contentHashOf`);
 *   the parties   `user:<member>`, "individually", REQUIRED, and `village`,
 *                 "for the village", NOT required;
 *   the alignment the member's own row, method `click`, bound to that hash.
 *
 * The signing goes through the submissions collection's own `insert`, which
 * runs these writes on its connection before it commits
 * (server/repos/store-db.ts), so the row and the alignment land together or
 * not at all, and the collection's cache only learns of a row that committed.
 *
 * ── WHICH WORDS: THE ONES ON THE MEMBER'S SCREEN ───────────────────────────
 *
 * The page reads the letter from `GET /api/membership-letter` and draws it,
 * and sends back the version it drew (`data.letterVersion`). The version is a
 * fingerprint of the title and the words (`letterVersionOf`). The server
 * renders the letter again from what the village holds NOW and refuses the
 * signing when the two differ, so a member is never aligned with words that
 * changed after they read them, and nothing is written. A signed-in signing
 * that names no version is refused the same way: there is no way to know what
 * it was shown. A visitor's signing, which names nobody, aligns nobody and is
 * stored as it always was.
 *
 * ── WHY THE VILLAGE NEED NOT ALIGN ─────────────────────────────────────────
 *
 * Seat terms bind the village to something it has to agree to, so a holder's
 * adopt click or a landed ballot is its countersign. The letter is the other
 * way round: the words are the village's own, written by whoever holds
 * `story.tell` in Admin (the `covenant` and `legal` content) and closing in
 * the village's name. The countersign the spec reached for, "the village's
 * adopted letter", has no record to point at: `PUT /api/admin/content/:section`
 * overwrites a section in place and stores no version, no author, no date and
 * no ballot, so there is no holder and no ballot an alignment row could name
 * without inventing one. And admitting a member is a separate act with doors
 * of its own (a steward accepting the signing, an invitation, a vouch, and
 * two one-time freezes at boot), none of which is the letter.
 *
 * So the village is a party, named "for the village" so the receipt, the
 * export and the register say who the letter is between, and NOT required, so
 * the text is in force at the member's own click and nothing waits on a row
 * nobody can honestly write. Being a party already, a later change that does
 * record a village act (the welcome, say) needs no new text and no new hash.
 *
 * ── ENDINGS ────────────────────────────────────────────────────────────────
 *
 * Leaving the village ends it: the erasure sweep writes `party_left` on every
 * text the member is a party to (server/lib/alignmentEndings.ts). Signing
 * again writes a new text that supersedes the one in force, with its
 * `superseded` ending in the same transaction. Notice and ending by agreement
 * refuse a letter (`endsByAct`).
 *
 * ── LEGACY SIGNERS ─────────────────────────────────────────────────────────
 *
 * A signing from before PR9 has no text and no hash. It is never listed as an
 * alignment (it has no row in the store to list), and the journey section
 * keeps showing it where it always did (`legacySigningOf`).
 *
 * No `recordEvent` and no `addActivity`: the alignment row is the record.
 */
import crypto from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import { canonicalJson } from "../../shared/canonicalJson";
import { CAPACITY, userParty, VILLAGE_PARTY } from "../../shared/alignments";
import { civilDateKey } from "../../shared/lunar";
import {
  LETTER_WORDS,
  MEMBERSHIP,
  membershipRef,
  readMembershipRef,
  renderMembershipLetter,
  type LetterSource,
  type ServedLetter,
} from "../../shared/membershipLetter";
import { SIGNING_TYPE, signingOf, type MembershipSigning } from "../../shared/membershipSigning";
import { insertEnding, textsForParty, type StoredParty } from "../repos/alignments";
import {
  contentHashOf,
  endingIdFor,
  recordAlignment,
  sealIfReady,
  viewText,
  viewTexts,
  writePreparedText,
  type PreparedText,
} from "./alignmentSubjects";

/** The fingerprint of a letter's title and words: `lv-` and sixteen hex characters. */
export function letterVersionOf(letter: { title: string; body: string }): string {
  const bytes = canonicalJson({ title: letter.title, body: letter.body });
  return `lv-${crypto.createHash("sha256").update(bytes, "utf8").digest("hex").slice(0, 16)}`;
}

/** The letter as the village's inputs render it now, with its version. */
export function currentLetter(src: LetterSource): ServedLetter {
  const rendered = renderMembershipLetter(src);
  return { ...rendered, version: letterVersionOf(rendered) };
}

/**
 * One member's text for one signing, ready to insert. Pure apart from the id
 * and the salt. `version` is 1 for a member's first letter and counts on from
 * there; `supersedesId` names the letter this one replaces, if one is in force.
 */
export function prepareMembershipText(input: {
  letter: ServedLetter;
  signingId: string;
  userId: string;
  version: number;
  supersedesId: string | null;
}): PreparedText {
  const id = `at-${crypto.randomBytes(8).toString("hex")}`;
  const subjectRef = membershipRef(input.letter.version, input.signingId);
  if (subjectRef.length > 64) throw Object.assign(new Error("a signing id this long cannot name its letter"), { code: "ML_REF_TOO_LONG" });
  const version = Math.max(1, Math.floor(input.version));
  const parties: StoredParty[] = [
    { textId: id, partyKey: userParty(input.userId), userId: input.userId, capacity: CAPACITY.individually, required: true },
    { textId: id, partyKey: VILLAGE_PARTY, userId: null, capacity: CAPACITY.forTheVillage, required: false },
  ];
  const salt = crypto.randomBytes(32).toString("hex");
  const contentHash = contentHashOf({
    salt,
    subjectType: MEMBERSHIP,
    subjectRef,
    version,
    title: input.letter.title,
    body: input.letter.body,
    settings: null,
    parties,
  });
  return {
    text: {
      id,
      subjectType: MEMBERSHIP,
      subjectRef,
      version,
      title: input.letter.title,
      body: input.letter.body,
      settings: null,
      salt,
      contentHash,
      supersedesId: input.supersedesId,
      // No window: in force from the click until the member leaves or aligns again.
      effectiveFrom: null,
      effectiveTo: null,
      createdBy: input.userId,
    },
    parties,
    seatNames: [],
  };
}

/** What `alignSigning` wrote. */
export interface SigningAlignment {
  textId: string;
  contentHash: string;
  /** The member's earlier letter this one superseded, or null. */
  superseded: string | null;
}

/**
 * Write the member's text, its parties and their alignment, INSIDE THE
 * SIGNING'S TRANSACTION. Throws on any failure, which rolls the signing back
 * with it. The member's newest letter that has not ended is superseded here
 * too: the new one is in force the moment it is written.
 */
export async function alignSigning(
  conn: PoolConnection,
  input: { letter: ServedLetter; signingId: string; userId: string; now: Date },
): Promise<SigningAlignment> {
  const theirs = (await textsForParty(conn, input.userId)).filter((t) => t.subjectType === MEMBERSHIP);
  const views = await viewTexts(conn, theirs, civilDateKey(input.now, "UTC"), "UTC", input.now);
  // At most one of a member's letters is open: each signing supersedes the one before it. The version counts on from the highest they hold.
  const open = views.find((v) => v.derived.state !== "ended") ?? null;
  const prepared = prepareMembershipText({
    letter: input.letter,
    signingId: input.signingId,
    userId: input.userId,
    version: theirs.reduce((m, t) => Math.max(m, t.version), 0) + 1,
    supersedesId: open?.text.id ?? null,
  });
  await writePreparedText(conn, prepared);
  const landed = await recordAlignment(conn, {
    textId: prepared.text.id,
    partyKey: userParty(input.userId),
    userId: input.userId,
    contentHash: prepared.text.contentHash,
    intent: input.letter.intent,
    method: "click",
    authorityRef: null,
  });
  if (!landed) throw Object.assign(new Error("the member's alignment with a new text did not land"), { code: "ML_NOT_ALIGNED" });
  if (open) {
    await insertEnding(conn, {
      id: endingIdFor("superseded", open.text.id),
      textId: open.text.id,
      kind: "superseded",
      refersTo: prepared.text.id,
      partyKey: null,
      effectiveAt: input.now,
      recordedBy: null,
    });
  }
  return { textId: prepared.text.id, contentHash: prepared.text.contentHash, superseded: open?.text.id ?? null };
}

/** Seal a letter once it is written, when the village can sign. Best effort: the hourly sweep seals what this misses. */
export async function sealLetter(pool: Pool, textId: string, now: Date = new Date()): Promise<boolean> {
  const v = await viewText(pool, textId, civilDateKey(now, "UTC"), "UTC", now);
  return v ? sealIfReady(pool, v) : false;
}

/** Why a signing was refused, in the shape the form route answers with (409). */
export interface SigningRefusal {
  error: "letter_changed";
  message: string;
  /** The letter as it stands now, so the page can show it at once. Null when it could not be rendered. */
  letter: ServedLetter | null;
}

/**
 * Whether a signing may align its member with the letter as it stands, and
 * the letter if so. A visitor's signing (no member) is not asked: it aligns
 * nobody. A member's signing must name the version it drew, and that version
 * must be the one the village's inputs render now. With no inputs to render
 * from, a member's signing is refused: nothing could say what they read.
 */
export function judgeSigning(
  entry: { type: string; userId?: unknown; data?: unknown },
  src: LetterSource | null,
): { align: false } | { align: true; letter: ServedLetter } | { refused: SigningRefusal } {
  if (entry.type !== SIGNING_TYPE || !entry.userId) return { align: false };
  if (!src) return { refused: { error: "letter_changed", message: LETTER_WORDS.unreadable, letter: null } };
  const letter = currentLetter(src);
  const data = entry.data && typeof entry.data === "object" ? (entry.data as Record<string, unknown>) : {};
  if (data.letterVersion !== letter.version) return { refused: { error: "letter_changed", message: LETTER_WORDS.changed, letter } };
  return { align: true, letter };
}

/**
 * The signing the journey section shows: the member's newest, ONLY when it
 * wrote no text (a legacy signing, from before PR9). A signing that wrote one
 * is shown under "What you have aligned with" instead, and never twice.
 */
export async function legacySigningOf(pool: Pool, rows: readonly unknown[], userId: unknown): Promise<MembershipSigning | null> {
  const signing = signingOf(rows, userId);
  if (!signing) return null;
  const me = String(userId ?? "");
  const newest = (rows as Array<Record<string, unknown>>)
    .filter((r) => r && r.type === SIGNING_TYPE && String(r.userId ?? "") === me)
    .sort((a, b) => stamp(a.submittedAt).localeCompare(stamp(b.submittedAt)))
    .pop();
  if (!newest) return signing;
  const aligned = (await textsForParty(pool, me)).some(
    (t) => t.subjectType === MEMBERSHIP && readMembershipRef(t.subjectRef)?.signingId === String(newest.id ?? ""),
  );
  return aligned ? null : signing;
}

const stamp = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : "");
