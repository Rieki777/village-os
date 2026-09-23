/**
 * THE SIGNING A MEMBER CAN SEE.
 *
 * Signing the Love Letter has named its signer since 29473e4 (2026-08-29): the
 * page sends an `Authorization` header when there is somebody signed in, the
 * row stores their `user_id`, and accepting that row is what admits them. All
 * of that worked and none of it was visible. The only routes that read the
 * submissions table are the three under `/api/admin`, so the one person the
 * row is about could not see it anywhere.
 *
 * Rye asked for the signing to be "stored in that account as a record of them
 * signing it" (2026-09-23). It was stored. This is the record part.
 *
 * ── THE PIPELINE'S WORDS DO NOT CROSS ──────────────────────────────────────
 *
 * `submissions.status` walks `new`, `reviewing`, `in-conversation`, `accepted`
 * and `declined` over half a dozen unrelated acts, and
 * `server/lib/submissionNotices.ts` already ruled that none of them is a
 * sentence for a person. So this answers in three states a member recognises
 * and never hands the raw status out:
 *
 *   waiting    the village has it and has not answered
 *   welcomed   the village said yes, and `membershipGranted` was set with it
 *   left       the village said no
 *
 * `new`, `reviewing` and `in-conversation` all read as `waiting` here, for the
 * reason the notices module gives: a founder moving their own filing around is
 * not news, and a member holding one end of a conversation does not learn
 * about it from a profile.
 *
 * ── WHY `left` IS SHOWN AT ALL ─────────────────────────────────────────────
 *
 * A declined signer who reads `waiting` for the rest of their time here is
 * being told something false by a page built to be a record. The notice spine
 * already says the no plainly, and for the same reason it gives: a village
 * that lets applications go quiet teaches people to stop applying. This
 * profile is the member's own and nobody else's, so the no is seen by the one
 * person who already heard it.
 *
 * ── THE LAST SIGNING, NOT ALL OF THEM ──────────────────────────────────────
 *
 * A person signs once. A second row exists only where somebody refiled, and
 * then the live one is the newest. The repo orders by `submitted_at`, so this
 * sorts anyway instead of trusting the caller's order.
 *
 * PURE, so a test holds every judgement here without a database.
 */

/** The form the Love Letter posts. */
export const SIGNING_TYPE = "membership-508";

/** What the village has done with a signing, in words a member recognises. */
export type SigningAnswer = "waiting" | "welcomed" | "left";

/** One member's signing, as their own profile reads it. */
export interface MembershipSigning {
  at: string;
  answer: SigningAnswer;
}

/** A submission row, narrowed to the four fields this file reads. */
interface Row {
  type?: unknown;
  status?: unknown;
  userId?: unknown;
  submittedAt?: unknown;
}

/**
 * An instant as a string, whatever the repo handed over.
 *
 * `submittedAt` is spec'd `kind: "time"`, which arrives as a Date on one path
 * and as a string on another, and a Date interpolated into JSX renders the
 * host's locale instead of the village's. One producer of the value here means
 * the client never has to know which it got.
 */
function instant(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return typeof value === "string" ? value : "";
}

/** The three states, from the pipeline's five. */
export function signingAnswer(status: unknown): SigningAnswer {
  if (status === "accepted") return "welcomed";
  if (status === "declined") return "left";
  return "waiting";
}

/**
 * This member's signing, or null when they have not signed.
 *
 * `userId` is compared as a string on both sides: the column is a varchar and
 * a caller holding a number would otherwise match nothing and report a member
 * who signed as one who never did.
 */
export function signingOf(rows: readonly unknown[], userId: unknown): MembershipSigning | null {
  const me = String(userId ?? "");
  if (!me) return null;
  const mine = (rows as Row[])
    .filter((r) => r && r.type === SIGNING_TYPE && String(r.userId ?? "") === me)
    .map((r) => ({ at: instant(r.submittedAt), answer: signingAnswer(r.status) }));
  if (!mine.length) return null;
  return mine.sort((a, b) => a.at.localeCompare(b.at))[mine.length - 1];
}
