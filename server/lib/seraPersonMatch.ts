/**
 * Keyed-hash person matching with Sera, the village side (docs/modules/sera-person-links.md).
 *
 * OFF unless SABERRA_PERSON_MATCH=on AND the shared secret SABERRA_LINK_SECRET
 * is set AND Sera offers match_person_by_email_hash to the privacy connection.
 * When it runs, only HMAC-SHA256(secret, lowercased trimmed verified email) is
 * sent, over the privacy token. One owner id: the link is stored. None or
 * several: the member goes to the steward review queue; nothing is ever picked.
 *
 * Never logged: the email, the hash, the secret, any token. The audit line is
 * the member id, the outcome and the match count.
 */
import { createHmac } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { MATCH_TOOL, MATCH_WORDS, normalizeEmail, readMatch, type BackfillCounts, type MatchOutcome } from "../../shared/seraPersonMatch";
import { SERA_OWNER_ID } from "../../shared/seraPersonLinks";
import { callPrivacyTool, privacyTokenSet } from "./saberraPrivacy";
import { memberLinks } from "../repos/seraPersonLinks";
import type { MemberLinkRow } from "../../shared/seraPersonLinks";
import { reviewsByMember, hasSeraLink, linkByMatch, linkedMemberOf, queueReview, unlinkedVerifiedMembers, verifiedEmailOf, clearReview } from "../repos/seraLinkReviews";

export const MATCH_SWITCH_ENV = "SABERRA_PERSON_MATCH";
export const LINK_SECRET_ENV = "SABERRA_LINK_SECRET";
export const SECRET_VERSION_ENV = "SABERRA_LINK_SECRET_VERSION";

export function secretVersion(): number {
  const n = Number((process.env[SECRET_VERSION_ENV] ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** The switch, the secret and the privacy token: all three, or the match does not run. */
export function matchReady(): { ok: true } | { ok: false; note: string } {
  if ((process.env[MATCH_SWITCH_ENV] ?? "").trim().toLowerCase() !== "on") return { ok: false, note: MATCH_WORDS.off };
  if (!(process.env[LINK_SECRET_ENV] ?? "").trim()) return { ok: false, note: "The shared secret for matching (SABERRA_LINK_SECRET) is not set." };
  if (!privacyTokenSet()) return { ok: false, note: "Matching needs the privacy connection (SABERRA_PRIVACY_TOKEN)." };
  return { ok: true };
}

/** Pure given the secret: the only thing about an email that ever leaves. */
export function emailHash(email: string, secret: string): string {
  return createHmac("sha256", secret).update(normalizeEmail(email), "utf8").digest("hex");
}

export type MatchResult = "linked" | "review" | "skipped" | "failed";

/** Ask Sera about one member. Quiet when off, unverified or already linked. */
export async function matchMember(pool: Pool, userId: string, ask: typeof callPrivacyTool = callPrivacyTool): Promise<MatchResult> {
  if (!matchReady().ok) return "skipped";
  const email = await verifiedEmailOf(pool, userId);
  if (!email || (await hasSeraLink(pool, userId))) return "skipped";
  const hash = emailHash(email, (process.env[LINK_SECRET_ENV] ?? "").trim());
  const r = await ask(MATCH_TOOL, { email_hash: hash });
  if (!r.ok) return "failed";
  const out: MatchOutcome = readMatch(r.value, (s) => SERA_OWNER_ID.test(s));
  if (out.kind === "link") {
    const holder = await linkedMemberOf(pool, out.owner);
    if (holder && holder !== userId) {
      // That Sera person is already another member's: a steward decides.
      await queueReview(pool, userId, "several", 1, secretVersion());
      return "review";
    }
    await linkByMatch(pool, out.owner, userId);
    await clearReview(pool, userId).catch(() => {});
    return "linked";
  }
  await queueReview(pool, userId, out.outcome, out.matches, secretVersion());
  return "review";
}

/** On profile creation and on email verification. Never throws, never holds the caller. */
export function matchOnEvent(pool: Pool, userId: string, audit?: (text: string) => void): void {
  if (!matchReady().ok) return;
  void matchMember(pool, userId)
    .then((r) => { if (r !== "skipped") audit?.(`sera:match:${r}`); })
    .catch(() => {});
}

/** The steward's batch: a dry run gives counts only and calls nothing. */
export async function backfill(pool: Pool, dryRun: boolean, ask: typeof callPrivacyTool = callPrivacyTool): Promise<BackfillCounts> {
  const ids = await unlinkedVerifiedMembers(pool);
  const out: BackfillCounts = { dryRun, candidates: ids.length, linked: 0, review: 0, failed: 0 };
  const ready = matchReady();
  if (!ready.ok) return { ...out, note: ready.note };
  if (dryRun) return out;
  for (const id of ids) {
    const r = await matchMember(pool, id, ask).catch(() => "failed" as const);
    if (r === "linked") out.linked += 1;
    else if (r === "review") out.review += 1;
    else if (r === "failed") out.failed += 1;
  }
  return out;
}

/** The steward's link list, with the members the match left for review marked. */
export async function linksWithReviews(pool: Pool): Promise<MemberLinkRow[]> {
  const [members, reviews] = await Promise.all([memberLinks(pool), reviewsByMember(pool).catch(() => new Map())]);
  return members.map((m) => ({ ...m, review: m.ownerTail ? null : reviews.get(m.userId) ?? null }));
}
