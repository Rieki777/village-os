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
