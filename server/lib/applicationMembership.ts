/**
 * MEMBERSHIP AT APPLICATION (role journey L7, Rye's answer 8, 9 Nov 2026).
 *
 * Applicants join the village's membership when they apply. The open form
 * (`/propose-a-role`) shows the membership letter beside an "Align" tick, and
 * the form sends back the version of the letter it drew. Nobody has an account
 * yet, so the alignment is recorded against the ADDRESS, and only once the
 * address confirms (`alignAtApplication`, run by the confirm step): a proposal
 * that never confirms aligns nobody.
 *
 *   the text      the letter's exact words, as for a member's own signing
 *                 (shared/membershipLetter.ts renders both);
 *   the parties   `address:<fingerprint>`, "individually", REQUIRED, with no
 *                 account, and `village`, "for the village", NOT required;
 *   the alignment the applicant's click, method `click`, bound to that hash.
 *
 * The address is never stored in the party key: the key is a fingerprint of the
 * address as one person writes it (`identityKey`), so the store holds nothing an
 * erasure would have to find.
 *
 * CARRIED TO THE ACCOUNT, SO NOBODY IS ASKED AGAIN (`carryToAccount`). When an
 * account with that address exists (a sign-up through the adoption's
 * invitation, or an account already here), the alignment moves onto it: a new
 * text in the member's own name with the same words, their alignment carrying
 * the application's text as its authority, and the application's text
 * superseded by it. Run at sign-up through the invitation, and again by the
 * role start gate before it asks, so whichever comes first carries it.
 *
 * NO PAYMENT. Nothing here asks for, reads or records money. The letter's
 * suggested contribution stays a paragraph in the letter.
 */
import crypto from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { CAPACITY, userParty, VILLAGE_PARTY } from "../../shared/alignments";
import { civilDateKey } from "../../shared/lunar";
import { letterIntent, MEMBERSHIP, membershipRef, readMembershipRef, type ServedLetter } from "../../shared/membershipLetter";
import { identityKey } from "../../shared/openProposals";
import { insertEnding, textsForParty, textsForPartyKey, type StoredParty } from "../repos/alignments";
import { contentHashOf, endingIdFor, recordAlignment, viewTexts, writePreparedText } from "./alignmentSubjects";
import { prepareMembershipText } from "./membershipLetter";

/** The party key for an address that has no account yet. */
export function addressParty(email: string): string {
  const key = identityKey(email);
  return `address:${crypto.createHash("sha256").update(key, "utf8").digest("hex").slice(0, 32)}`;
}

export const isAddressParty = (partyKey: string): boolean => partyKey.startsWith("address:");

/**
 * Record an applicant's alignment with the letter against their confirmed
 * address, inside the caller's transaction. `letter` is the letter as the
 * village renders it now, and the caller has checked the form drew this
 * version. An address already aligned with these words writes nothing.
 */
export async function alignAtApplication(
  conn: PoolConnection,
  input: { letter: ServedLetter; email: string; proposalId: string; now: Date },
): Promise<{ textId: string; already: boolean }> {
  const party = addressParty(input.email);
  const held = await openAddressTexts(conn, party, input.now);
  const same = held.find((v) => readMembershipRef(v.text.subjectRef)?.letterVersion === input.letter.version);
  if (same) return { textId: same.text.id, already: true };

  const id = `at-${crypto.randomBytes(8).toString("hex")}`;
  const subjectRef = membershipRef(input.letter.version, input.proposalId);
  if (subjectRef.length > 64) throw Object.assign(new Error("a proposal id this long cannot name its letter"), { code: "AM_REF_TOO_LONG" });
  const parties: StoredParty[] = [
    { textId: id, partyKey: party, userId: null, capacity: CAPACITY.individually, required: true },
    { textId: id, partyKey: VILLAGE_PARTY, userId: null, capacity: CAPACITY.forTheVillage, required: false },
  ];
  const salt = crypto.randomBytes(32).toString("hex");
  const contentHash = contentHashOf({ salt, subjectType: MEMBERSHIP, subjectRef, version: 1, title: input.letter.title, body: input.letter.body, settings: null, parties });
  await writePreparedText(conn, {
    text: {
      id,
      subjectType: MEMBERSHIP,
      subjectRef,
      version: 1,
      title: input.letter.title,
      body: input.letter.body,
      settings: null,
      salt,
      contentHash,
      supersedesId: null,
      effectiveFrom: null,
      effectiveTo: null,
      // No account made it: the proposal did.
      createdBy: input.proposalId,
    },
    parties,
    seatNames: [],
  });
  const landed = await recordAlignment(conn, { textId: id, partyKey: party, userId: null, contentHash, intent: input.letter.intent, method: "click", authorityRef: input.proposalId });
  if (!landed) throw Object.assign(new Error("the applicant's alignment did not land"), { code: "AM_NOT_ALIGNED" });
  return { textId: id, already: false };
}

async function openAddressTexts(conn: PoolConnection, party: string, now: Date) {
  const texts = (await textsForPartyKey(conn, party)).filter((t) => t.subjectType === MEMBERSHIP);
  const views = await viewTexts(conn, texts, civilDateKey(now, "UTC"), "UTC", now);
  return views.filter((v) => v.derived.state === "in-force");
}

/**
 * Move an address's alignment onto the account that now has that address.
 * Null when the address aligned with nothing. Inside the caller's transaction;
 * a second run finds the application's text superseded and writes nothing.
 */
export async function carryToAccount(conn: PoolConnection, input: { userId: string; email: string; now: Date }): Promise<{ textId: string } | null> {
  const held = await openAddressTexts(conn, addressParty(input.email), input.now);
  const from = held[0];
  if (!from) return null;
  const ref = readMembershipRef(from.text.subjectRef);
  if (!ref) return null;
  const mine = (await textsForParty(conn, input.userId)).filter((t) => t.subjectType === MEMBERSHIP);
  const myViews = await viewTexts(conn, mine, civilDateKey(input.now, "UTC"), "UTC", input.now);
  const open = myViews.find((v) => v.derived.state === "in-force") ?? null;
  let textId: string;
  if (open) {
    // Already aligned from the account: the application's text has nothing left to carry.
    textId = open.text.id;
  } else {
    const letter = {
      version: ref.letterVersion,
      title: from.text.title,
      body: from.text.body,
      intent: from.alignments[0]?.intentText ?? letterIntent(from.text.title),
    };
    const prepared = prepareMembershipText({
      letter,
      signingId: from.text.id,
      userId: input.userId,
      version: mine.reduce((m, t) => Math.max(m, t.version), 0) + 1,
      supersedesId: null,
    });
    await writePreparedText(conn, prepared);
    const landed = await recordAlignment(conn, {
      textId: prepared.text.id,
      partyKey: userParty(input.userId),
      userId: input.userId,
      contentHash: prepared.text.contentHash,
      intent: letter.intent,
      method: "click",
      // The click was the applicant's own, on the application.
      authorityRef: from.text.id,
    });
    if (!landed) throw Object.assign(new Error("the carried alignment did not land"), { code: "AM_NOT_CARRIED" });
    textId = prepared.text.id;
  }
  await insertEnding(conn, {
    id: endingIdFor("superseded", from.text.id),
    textId: from.text.id,
    kind: "superseded",
    refersTo: textId,
    partyKey: null,
    effectiveAt: input.now,
    recordedBy: null,
  });
  return { textId };
}
