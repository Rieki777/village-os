/**
 * THE `confidentiality` ALIGNMENT SUBJECT (role journey L7).
 *
 * A member aligns with the village's confidentiality agreement from their own
 * account, one click with their identity re-confirmed
 * (server/routes/confidentiality.ts). That writes, in one transaction:
 *
 *   the text      the agreement's exact words as the page showed them
 *                 (shared/confidentiality.ts renders them for both), salted and
 *                 hashed as every text in the store is (`contentHashOf`);
 *   the parties   `user:<member>`, "individually", REQUIRED, and `village`,
 *                 "for the village", NOT required: the words are the village's
 *                 own, as the membership letter's are (server/lib/membershipLetter.ts
 *                 says why the village need not align with its own words);
 *   the alignment the member's own row, method `click`, bound to that hash.
 *
 * WHICH WORDS. The page reads the agreement and sends back the version it drew.
 * The server renders the agreement again from what the village holds NOW and
 * refuses when the two differ, so nobody is aligned with words they did not
 * read.
 *
 * ASKED AGAIN WHEN THE WORDS CHANGE. Holding the agreement means holding a text
 * whose version is the CURRENT one and which has not ended
 * (`holdsCurrentAgreement`). A changed agreement has a new version, so every
 * earlier alignment stops counting at once, with nothing written, and each
 * holder aligns again. Aligning again supersedes their earlier text.
 *
 * ENDINGS. Leaving the village ends it (`party_left`, written by the erasure
 * sweep for every text a member is a party to). Notice and ending by agreement
 * refuse it (`endsByAct`, server/lib/alignmentSubjects.ts).
 *
 * No `recordEvent` and no `addActivity`: the alignment row is the record.
 */
import crypto from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import { canonicalJson } from "../../shared/canonicalJson";
import { CAPACITY, userParty, VILLAGE_PARTY } from "../../shared/alignments";
import { civilDateKey } from "../../shared/lunar";
import {
  CONFIDENTIALITY,
  confidentialityRef,
  readConfidentialityRef,
  renderAgreement,
  type ServedAgreement,
} from "../../shared/confidentiality";
import { insertEnding, textsForParty, type StoredParty } from "../repos/alignments";
import { contentHashOf, endingIdFor, recordAlignment, viewTexts, writePreparedText, type PreparedText } from "./alignmentSubjects";

type Db = Pool | PoolConnection;

/** The fingerprint of an agreement's title and words: `cv-` and sixteen hex characters. */
export function agreementVersionOf(words: { title: string; body: string }): string {
  const bytes = canonicalJson({ title: words.title, body: words.body });
  return `cv-${crypto.createHash("sha256").update(bytes, "utf8").digest("hex").slice(0, 16)}`;
}

/** The agreement as the village's content section renders it now, or null when it has written none. */
export function currentAgreement(section: unknown): ServedAgreement | null {
  const words = renderAgreement(section);
  return words ? { ...words, version: agreementVersionOf(words) } : null;
}

/** One member's text for one alignment, ready to insert. */
export function prepareConfidentialityText(input: { agreement: ServedAgreement; userId: string; version: number; supersedesId: string | null }): PreparedText {
  const id = `at-${crypto.randomBytes(8).toString("hex")}`;
  const subjectRef = confidentialityRef(input.agreement.version, `ca-${crypto.randomBytes(8).toString("hex")}`);
  const parties: StoredParty[] = [
    { textId: id, partyKey: userParty(input.userId), userId: input.userId, capacity: CAPACITY.individually, required: true },
    { textId: id, partyKey: VILLAGE_PARTY, userId: null, capacity: CAPACITY.forTheVillage, required: false },
  ];
  const version = Math.max(1, Math.floor(input.version));
  const salt = crypto.randomBytes(32).toString("hex");
  const contentHash = contentHashOf({
    salt,
    subjectType: CONFIDENTIALITY,
    subjectRef,
    version,
    title: input.agreement.title,
    body: input.agreement.body,
    settings: null,
    parties,
  });
  return {
    text: {
      id,
      subjectType: CONFIDENTIALITY,
      subjectRef,
      version,
      title: input.agreement.title,
      body: input.agreement.body,
      settings: null,
      salt,
      contentHash,
      supersedesId: input.supersedesId,
      effectiveFrom: null,
      effectiveTo: null,
      createdBy: input.userId,
    },
    parties,
    seatNames: [],
  };
}

/** The member's confidentiality texts that have not ended, newest first. */
async function openTexts(db: Db, userId: string, now: Date) {
  const theirs = (await textsForParty(db, userId)).filter((t) => t.subjectType === CONFIDENTIALITY);
  const views = await viewTexts(db, theirs, civilDateKey(now, "UTC"), "UTC", now);
  return { theirs, open: views.filter((v) => v.derived.state === "in-force") };
}

/**
 * Whether a member holds the agreement AS IT READS NOW: an in-force text of
 * theirs carries the current version. False when the village has written no
 * agreement: there is nothing anybody could hold.
 */
export async function holdsCurrentAgreement(db: Db, userId: string, current: ServedAgreement | null, now: Date = new Date()): Promise<boolean> {
  if (!current) return false;
  const { open } = await openTexts(db, userId, now);
  return open.some((v) => readConfidentialityRef(v.text.subjectRef)?.version === current.version);
}

/** What `alignConfidentiality` wrote. */
export interface ConfidentialityAlignment {
  textId: string;
  superseded: string | null;
  /** True when the member already held these exact words, and nothing was written. */
  already: boolean;
}

/**
 * Write the member's text, its parties and their alignment, inside the
 * caller's transaction. A member already holding the current words writes
 * nothing. Their earlier text, if one is in force, is superseded here.
 */
export async function alignConfidentiality(
  conn: PoolConnection,
  input: { agreement: ServedAgreement; userId: string; now: Date },
): Promise<ConfidentialityAlignment> {
  const { theirs, open } = await openTexts(conn, input.userId, input.now);
  const same = open.find((v) => readConfidentialityRef(v.text.subjectRef)?.version === input.agreement.version);
  if (same) return { textId: same.text.id, superseded: null, already: true };
  const before = open[0] ?? null;
  const prepared = prepareConfidentialityText({
    agreement: input.agreement,
    userId: input.userId,
    version: theirs.reduce((m, t) => Math.max(m, t.version), 0) + 1,
    supersedesId: before?.text.id ?? null,
  });
  await writePreparedText(conn, prepared);
  const landed = await recordAlignment(conn, {
    textId: prepared.text.id,
    partyKey: userParty(input.userId),
    userId: input.userId,
    contentHash: prepared.text.contentHash,
    intent: input.agreement.intent,
    method: "click",
    authorityRef: null,
  });
  if (!landed) throw Object.assign(new Error("the member's alignment with a new text did not land"), { code: "CA_NOT_ALIGNED" });
  for (const v of open) {
    await insertEnding(conn, {
      id: endingIdFor("superseded", v.text.id),
      textId: v.text.id,
      kind: "superseded",
      refersTo: prepared.text.id,
      partyKey: null,
      effectiveAt: input.now,
      recordedBy: null,
    });
  }
  return { textId: prepared.text.id, superseded: before?.text.id ?? null, already: false };
}
