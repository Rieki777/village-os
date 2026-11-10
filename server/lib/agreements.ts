/**
 * THE VILLAGE'S AGREEMENTS, STORED (defect 9; shared/agreements.ts holds the
 * shape and the validator).
 *
 * One `app_config` document per agreement, under `village-agreement:<id>`,
 * written through `writeConfigDocument` and read through `readConfigDocument`
 * (server/repos/appConfigDocs.ts). Nothing caches these keys, so a write is
 * read back exactly, and no migration was needed: `app_config` is the table
 * for a village's own documents.
 *
 * ── ONE WRITER AT A TIME, BY CONSTRUCTION ─────────────────────────────────
 *
 * The route writes the document once, when the vote opens. After that only
 * the ballot's own closer touches it (server/lib/agreementCloser.ts): settle
 * at the close, execute at the landing, or withdraw while it is open. A ballot
 * moves through those one at a time, so a whole-document write here cannot
 * race another write to the same agreement.
 *
 * ── WHAT A READER GETS ─────────────────────────────────────────────────────
 *
 * The agreement's words and its scope, as stored. Who proposed it is kept for
 * the record and served to nobody by the list route: the ballot already names
 * its opener to the people who can open it.
 */
import type { Pool } from "mysql2/promise";
import { readConfigDocument, readConfigDocumentsByPrefix, writeConfigDocument } from "../repos/appConfigDocs";
import { AGREEMENT_STATUSES, type AgreementStatus, type StoredAgreement } from "../../shared/agreements";
import type { PresenceTest } from "./memberPresence";

export const AGREEMENT_KEY_PREFIX = "village-agreement:";

export const agreementKey = (id: string): string => `${AGREEMENT_KEY_PREFIX}${id}`;

/** A stored document is only as good as the last thing that wrote it, so each field is checked on the way out. */
function asStored(doc: Record<string, unknown> | null): StoredAgreement | null {
  if (!doc) return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const status = str(doc.status);
  if (!str(doc.id) || !(AGREEMENT_STATUSES as readonly string[]).includes(status)) return null;
  return {
    id: str(doc.id),
    title: str(doc.title),
    body: str(doc.body),
    domain: (str(doc.domain) || null) as StoredAgreement["domain"],
    circleId: str(doc.circleId) || null,
    reviewAt: str(doc.reviewAt) || null,
    status: status as AgreementStatus,
    ballotId: str(doc.ballotId),
    proposedBy: str(doc.proposedBy),
    proposedAt: str(doc.proposedAt),
    decidedAt: str(doc.decidedAt) || null,
  };
}

export async function recordAgreement(pool: Pool, a: StoredAgreement): Promise<void> {
  await writeConfigDocument(pool, agreementKey(a.id), { ...a });
}

export async function readAgreement(pool: Pool, id: string): Promise<StoredAgreement | null> {
  return asStored(await readConfigDocument(pool, agreementKey(id)));
}

/** Move an agreement to a new standing. Null when there is no such agreement. */
export async function markAgreement(
  pool: Pool,
  id: string,
  status: AgreementStatus,
  decidedAt: string | null,
): Promise<StoredAgreement | null> {
  const before = await readAgreement(pool, id);
  if (!before) return null;
  const after: StoredAgreement = { ...before, status, decidedAt };
  await recordAgreement(pool, after);
  return after;
}

/**
 * Every agreement in play or on record, in the order a member reads them:
 * active first (soonest review first, open-ended last), then the ones being
 * voted on, then the rest, newest first within each.
 */
export async function listAgreements(pool: Pool): Promise<StoredAgreement[]> {
  const rows = await readConfigDocumentsByPrefix(pool, AGREEMENT_KEY_PREFIX);
  const all = rows.map((r) => asStored(r.doc)).filter((a): a is StoredAgreement => !!a);
  const rank: Record<AgreementStatus, number> = { active: 0, voting: 1, "not-adopted": 2, withdrawn: 3 };
  return all.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.status === "active") {
      const ra = a.reviewAt ?? "9999-12-31";
      const rb = b.reviewAt ?? "9999-12-31";
      if (ra !== rb) return ra < rb ? -1 : 1;
    }
    return a.proposedAt < b.proposedAt ? 1 : a.proposedAt > b.proposedAt ? -1 : 0;
  });
}

/*
 * ── THE REVIEW DATE COMES ROUND (D10b, 2026-11-09) ───────────────────────────
 *
 * An adopted agreement names the day the village looks at it again, and until
 * this job nothing told anybody when that day came. The `agreement-review`
 * job (server/index.ts) calls this once a day with the village's own civil
 * date (`todayIn`, server/routes/governanceAgreements.ts).
 *
 * WHO: every present member (`isPresentMember`, server/lib/memberPresence.ts,
 * the predicate every ballot roll and the season reminders use), handed in
 * bound to the session secret.
 *
 * WHEN: on the review date, and on any later sweep while the agreement is
 * still active, so a day the scheduler missed is caught the next day. ONCE per
 * agreement, review date and member: the date is in the dedupe key, so moving
 * the date re-arms it, because the date the village was told is no longer the
 * date. Amending or retiring an agreement is later work; this only reminds.
 */

/** Where a review reminder lands: the governance page, which lists the village's agreements. */
export const AGREEMENT_REVIEW_LINK = "/governance";

/** One stable key per (agreement, review date, member). Well under the column's 191. */
export const agreementReviewKey = (agreementId: string, reviewAt: string, userId: string): string =>
  `agreement:${agreementId}:review:${reviewAt}:u${userId}`;

export interface AgreementReviewDeps {
  agreements: ReadonlyArray<StoredAgreement>;
  /** The village's civil date today, `YYYY-MM-DD`, in its own timezone. */
  today: string;
  members: ReadonlyArray<Record<string, any>>;
  isPresent: PresenceTest;
  notify(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    dedupeKey: string;
  }): Promise<{ fresh: boolean }>;
}

/** The daily sweep. One member's failure never stops the rest hearing. */
export async function runAgreementReviews(deps: AgreementReviewDeps): Promise<{ due: number; told: number }> {
  const due = deps.agreements.filter((a) => a.status === "active" && !!a.reviewAt && a.reviewAt <= deps.today);
  let told = 0;
  for (const a of due) {
    for (const member of deps.members) {
      if (!deps.isPresent(member)) continue;
      const userId = String(member.id);
      try {
        const r = await deps.notify({
          userId,
          type: "governance",
          title: `Today the village looks again at an agreement: ${a.title}`,
          body: `The village adopted this agreement with ${a.reviewAt} as its review date, and that day has come. Read it again on the governance page and say whether it still serves. A member who holds the power to open votes can put a new version to the village.`,
          link: AGREEMENT_REVIEW_LINK,
          dedupeKey: agreementReviewKey(a.id, a.reviewAt!, userId),
        });
        if (r.fresh) told += 1;
      } catch (e) {
        console.error(`[agreements] reminding ${userId} that agreement ${a.id} is due for review failed (the rest continue)`, e);
      }
    }
  }
  return { due: due.length, told };
}
