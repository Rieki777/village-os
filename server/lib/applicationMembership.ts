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
 * superseded by it, AND the signing request a steward accepts: a form alone
 * never admits anyone. Run when the account is made through the adoption's
 * invitation, and at confirm for an address that already has an account.
 *
 * NO PAYMENT. Nothing here asks for, reads or records money. The letter's
 * suggested contribution stays a paragraph in the letter.
 */
import crypto from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import { CAPACITY, userParty, VILLAGE_PARTY } from "../../shared/alignments";
import { civilDateKey } from "../../shared/lunar";
import { letterIntent, MEMBERSHIP, membershipRef, readMembershipRef, type ServedLetter } from "../../shared/membershipLetter";
import { SIGNING_TYPE } from "../../shared/membershipSigning";
import { identityKey } from "../../shared/openProposals";
import { insertEnding, textsForParty, textsForPartyKey, type StoredParty } from "../repos/alignments";
import { contentHashOf, endingIdFor, recordAlignment, viewTexts, writePreparedText } from "./alignmentSubjects";
import { prepareMembershipText } from "./membershipLetter";

/**
 * Whether the applicant behind a proposal is aligned with the membership letter,
 * for whoever decides it: they aligned on the form and the address confirmed (the
 * address's text, carried or not), or their account here already holds a letter.
 * Never the address or the words: a yes or a no.
 */
export async function membershipAlignedFor(db: Pool | PoolConnection, email: string | null, accountId: string | null): Promise<boolean> {
  if (email && (await textsForPartyKey(db, addressParty(email))).some((t) => t.subjectType === MEMBERSHIP)) return true;
  if (accountId && (await textsForParty(db, accountId)).some((t) => t.subjectType === MEMBERSHIP)) return true;
  return false;
}

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

async function openAddressTexts(conn: Pool | PoolConnection, party: string, now: Date) {
  const texts = (await textsForPartyKey(conn, party)).filter((t) => t.subjectType === MEMBERSHIP);
  const views = await viewTexts(conn, texts, civilDateKey(now, "UTC"), "UTC", now);
  return views.filter((v) => v.derived.state === "in-force");
}

/** The one door a signing row goes in by: the submissions collection's own insert (server/index.ts). */
export interface SigningDoor {
  insert(entry: Record<string, unknown>, alsoInTransaction?: (conn: PoolConnection) => Promise<void>): Promise<unknown>;
}

/**
 * MOVE AN ADDRESS'S ALIGNMENT ONTO THE ACCOUNT THAT NOW HAS THAT ADDRESS, AND
 * QUEUE THE SIGNING A STEWARD ACCEPTS (coordinator, 9 Nov 2026).
 *
 * A form alone never admits anyone. So carrying writes what a member's own
 * Love Letter signing writes, in one transaction through the collection's
 * insert, the same door `landPublicSubmission` uses:
 *
 *   the signing   a `membership-508` row in the member's name, status `new`,
 *                 which the steward's queue shows exactly like a normal
 *                 signing, and accepting it is what admits them;
 *   the text      the letter's words in the member's own name, its ref naming
 *                 that signing, so the profile reads what the village did
 *                 with it;
 *   the ending    the application's text superseded by the account's.
 *
 * The ending goes first and its id is fixed by the text it ends, so a second
 * run, or two at once, lands nothing and the signing rolls back with it: one
 * request per alignment, ever. An account that already holds a letter gets no
 * second request; the application's text is only superseded.
 *
 * Null when the address aligned with nothing, or it was carried already.
 */
export async function carryToAccount(
  pool: Pool,
  signings: SigningDoor,
  input: { userId: string; name: string; email: string; now: Date },
): Promise<{ textId: string; signingId: string | null } | null> {
  const conn = await pool.getConnection();
  let from: Awaited<ReturnType<typeof openAddressTexts>>[number] | undefined;
  let open: { text: { id: string } } | null = null;
  let mine: Awaited<ReturnType<typeof textsForParty>> = [];
  try {
    from = (await openAddressTexts(conn, addressParty(input.email), input.now))[0];
    if (!from) return null;
    mine = (await textsForParty(conn, input.userId)).filter((t) => t.subjectType === MEMBERSHIP);
    const myViews = await viewTexts(conn, mine, civilDateKey(input.now, "UTC"), "UTC", input.now);
    open = myViews.find((v) => v.derived.state === "in-force") ?? null;
  } finally {
    conn.release();
  }
  const ref = readMembershipRef(from.text.subjectRef);
  if (!ref) return null;
  const ending = (refersTo: string) => ({
    id: endingIdFor("superseded", from!.text.id),
    textId: from!.text.id,
    kind: "superseded" as const,
    refersTo,
    partyKey: null,
    effectiveAt: input.now,
    recordedBy: null,
  });

  if (open) {
    // Already aligned from the account, so a signing exists already: nothing to queue twice.
    await insertEnding(pool, ending(open.text.id));
    return { textId: open.text.id, signingId: null };
  }

  const signingId = `${input.now.getTime()}-${crypto.randomBytes(4).toString("hex")}`;
  const letter = {
    version: ref.letterVersion,
    title: from.text.title,
    body: from.text.body,
    intent: from.alignments[0]?.intentText ?? letterIntent(from.text.title),
  };
  const prepared = prepareMembershipText({
    letter,
    signingId,
    userId: input.userId,
    version: mine.reduce((m, t) => Math.max(m, t.version), 0) + 1,
    supersedesId: null,
  });
  await signings.insert(
    {
      id: signingId,
      type: SIGNING_TYPE,
      status: "new",
      rewarded: false,
      userId: input.userId,
      userName: input.name,
      submittedAt: input.now.toISOString(),
      // What the steward reads, as a member's own signing carries it. No contribution: none is asked.
      data: {
        name: input.name,
        email: input.email,
        letterVersion: ref.letterVersion,
        signedAt: (from.alignments[0]?.at ?? input.now).toISOString(),
        alignedAtApplication: true,
        applicationText: from.text.id,
      },
    },
    async (conn) => {
      if (!(await insertEnding(conn, ending(prepared.text.id)))) {
        throw Object.assign(new Error("this application's alignment was carried already"), { code: "AM_CARRIED" });
      }
      await writePreparedText(conn, prepared);
      const landed = await recordAlignment(conn, {
        textId: prepared.text.id,
        partyKey: userParty(input.userId),
        userId: input.userId,
        contentHash: prepared.text.contentHash,
        intent: letter.intent,
        method: "click",
        // The click was the applicant's own, on the application.
        authorityRef: from!.text.id,
      });
      if (!landed) throw Object.assign(new Error("the carried alignment did not land"), { code: "AM_NOT_CARRIED" });
    },
  );
  return { textId: prepared.text.id, signingId };
}
