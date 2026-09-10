/**
 * `external_proposals`: the statements that stand on their own.
 *
 * ── WHY A VENDOR TABLE NEEDS AN ENUMERABLE HOME MORE THAN MOST ─────────────
 *
 * Every row here is something an outside service said about this village, and
 * some of them are verbatim quotes about a named person. Two obligations run
 * through the table and both are answered by READING it: the export half of
 * `GET /api/profile/export`, which promises "everything the village holds about
 * me", and the erasure, which has to clear a member out of every record that
 * restates them. A reader nobody remembered breaks the first quietly and the
 * second dangerously, and the only way to check either is to be able to list
 * every statement against the table.
 *
 * `server/lib/externalProposals.ts` held twenty of them, mixed in with the
 * dedupe keys, the two refusals and the landing transaction. This file is the
 * half that is just a statement and a row shape.
 *
 * ── WHAT DELIBERATELY DID NOT MOVE, AND WHY EACH ONE STAYED ────────────────
 *
 * THE LANDING WRITES. The INSERT, the duplicate read-back and the supersede
 * UPDATE run on a `PoolConnection` that `landProposal` opened and will commit
 * or roll back as one act, and the ORDER of those three is the guarantee that a
 * vendor's retry is a no-op instead of an emptied queue. A repo function taking
 * a pool cannot be a step in somebody else's transaction: it would run on a
 * different connection, outside the transaction, and the damage would appear
 * only under a rollback or a race. They stay where the transaction is.
 *
 * THE REFERENCE RESOLVER. `resolveReferences` probes `circles`, `org_roles`,
 * `roles` and `quests` through a fixed map. It is four tables, none of them
 * this one, and the fixed map is itself the injection guard; splitting it out
 * would create a module that owns no table at all.
 *
 * THE EXPORT JOIN. `proposalsAboutMember` reads this table JOINed to
 * `external_proposal_subjects`, so a record naming three people is found by all
 * three. It is a two-table statement, and halving it would leave a caller
 * assembling one answer out of two modules with nothing saying the halves
 * agree. `server/repos/externalProposalSubjects.ts` names it too, so neither
 * file reads as a complete list when it is not.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ─────────────────────────────────────────
 *
 * Worth saying rather than leaving to be inferred. Every read below goes to the
 * database at the moment it is asked, which is what lets a steward's decision
 * and the queue they are reading be the same fact rather than two copies of it.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ExternalProposalRow, ProposalStatus } from "../lib/externalProposals";

/**
 * Every column, and every read below takes all of them.
 *
 * One list rather than a narrower one per read, because `ExternalProposalRow`
 * is one shape and a read that filled half of it would hand a caller a row
 * whose absent fields are indistinguishable from null ones. `decided_note` and
 * `created_ref` in particular are what say a steward has already acted.
 */
const COLUMNS =
  "id, village_id, module_id, batch_id, correlation_id, kind, payload, quote, source_ref, source_occurred_at, " +
  "subject_ref, trust_tier, significance, confidence, evidence, audience, dedupe_key, identity_key, status, " +
  "decided_by, decided_at, decided_note, created_ref, received_at";

/**
 * The payload as an object, whatever the driver made of the `json` column.
 *
 * It arrives parsed on some connections and as text on others, and a payload
 * that cannot be read as an object becomes `{}` rather than a throw: a steward
 * looking at a queue is better served by one record with nothing in its body
 * than by a page that will not load.
 */
function asJson(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** A timestamp as an ISO instant, or null. An unreadable one is null, never a throw. */
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Null stays null. A vendor that did not score a record has not scored it as zero. */
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * One row in the shape the review routes already read.
 *
 * `evidence` is checked against the three values rather than cast, because it
 * decides whether a record may ever be shown to a member, and a value this
 * build does not know about has to fall to the strictest answer rather than
 * travel as itself.
 */
function toRow(r: RowDataPacket): ExternalProposalRow {
  return {
    id: String(r.id),
    villageId: String(r.village_id),
    moduleId: String(r.module_id),
    batchId: String(r.batch_id),
    correlationId: r.correlation_id ? String(r.correlation_id) : null,
    kind: String(r.kind),
    payload: asJson(r.payload),
    quote: r.quote ? String(r.quote) : null,
    sourceRef: r.source_ref ? String(r.source_ref) : null,
    sourceOccurredAt: iso(r.source_occurred_at),
    subjectRef: r.subject_ref ? String(r.subject_ref) : null,
    trustTier: String(r.trust_tier),
    significance: num(r.significance),
    confidence: num(r.confidence),
    evidence: (["quoted", "anchored", "absent"] as const).includes(r.evidence) ? r.evidence : "absent",
    audience: r.audience === "member" ? "member" : "steward",
    dedupeKey: String(r.dedupe_key),
    identityKey: String(r.identity_key),
    status: String(r.status) as ProposalStatus,
    decidedBy: r.decided_by ? String(r.decided_by) : null,
    decidedAt: iso(r.decided_at),
    decidedNote: r.decided_note ? String(r.decided_note) : null,
    createdRef: r.created_ref ? String(r.created_ref) : null,
    receivedAt: iso(r.received_at) ?? "",
  };
}

/**
 * What is waiting in one status, oldest batch first.
 *
 * Oldest first and not newest first, which is the opposite of the assistant
 * draft queue and is deliberate: that queue is a conversation a founder is
 * having right now, and this one is a backlog, and a backlog read newest-first
 * grows a tail nobody ever reaches. `id` breaks the tie so two records landed
 * in the same second still come back in a stable order.
 *
 * The limit is clamped here, with the statement it bounds, so no caller can
 * pass one the query would not survive: 1 at the least, because LIMIT 0 returns
 * nothing while looking like a query that ran, and 1000 at the most.
 */
export async function proposalsByStatus(
  pool: Pool,
  status: ProposalStatus,
  limit: number,
): Promise<ExternalProposalRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM external_proposals WHERE status = ? ORDER BY received_at ASC, id ASC LIMIT ?`,
    [status, Math.max(1, Math.min(1000, limit))],
  );
  return rows.map(toRow);
}

/** One record by id, or null when there is no such record. */
export async function proposalRowById(pool: Pool, id: string): Promise<ExternalProposalRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM external_proposals WHERE id = ?`,
    [id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Everything that arrived in one delivery, in the same order the queue reads.
 *
 * Unbounded, unlike the queue read above, and on purpose: a batch is what one
 * sender handed over in one act, and a caller asking about a batch is asking
 * about all of it. A cap would make the answer quietly partial exactly when a
 * vendor sent more than expected, which is the case worth seeing whole.
 */
export async function proposalRowsInBatch(pool: Pool, batchId: string): Promise<ExternalProposalRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM external_proposals WHERE batch_id = ? ORDER BY received_at ASC, id ASC`,
    [batchId],
  );
  return rows.map(toRow);
}

/**
 * Record a steward's decision, and report whether it reached a row.
 *
 * THE EDITED PAYLOAD IS STORED WHEN THERE IS ONE. A steward who redacted a name
 * out of a proposal before accepting it has done the single most important
 * thing this surface exists for, and keeping the vendor's original would leave
 * the redacted text in the table as the only version of the record.
 *
 * The SET list is built from which fields the caller actually supplied, which
 * is the difference between "leave `created_ref` alone" and "set it to null":
 * `createdRef: undefined` means the first and `createdRef: null` means the
 * second, and one of those is how an accept that created nothing is recorded.
 * Every value still travels as a parameter; only column names are composed, and
 * they are literals in this file.
 *
 * `WHERE ... AND status = 'proposed'` is the guard. Deciding twice reaches
 * nothing, so two stewards pressing together cannot both come back true.
 */
export async function decideProposal(
  pool: Pool,
  input: {
    id: string;
    status: Extract<ProposalStatus, "accepted" | "rejected">;
    decidedBy: string;
    note?: string | null;
    createdRef?: string | null;
    editedPayload?: Record<string, unknown> | null;
  },
): Promise<boolean> {
  const sets = ["status = ?", "decided_by = ?", "decided_at = CURRENT_TIMESTAMP", "decided_note = ?"];
  const args: unknown[] = [input.status, input.decidedBy, input.note ?? null];
  if (input.createdRef !== undefined) {
    sets.push("created_ref = ?");
    args.push(input.createdRef ?? null);
  }
  if (input.editedPayload) {
    sets.push("payload = ?");
    args.push(JSON.stringify(input.editedPayload));
  }
  args.push(input.id);
  const [res]: any = await pool.query(
    `UPDATE external_proposals SET ${sets.join(", ")} WHERE id = ? AND status = 'proposed'`,
    args,
  );
  return Number(res?.affectedRows ?? 0) > 0;
}

/**
 * Return every record accepted into one draft to the queue, and say how many.
 *
 * Scoped to `status = 'accepted'` so a record that was rejected, or superseded
 * by a newer claim while the draft sat open, is left exactly as it is. All four
 * decision columns are cleared together, because a row left half-decided would
 * read as accepted by nobody at no time.
 */
export async function reopenAcceptedFor(pool: Pool, createdRef: string): Promise<number> {
  const [r] = await pool.query<any>(
    "UPDATE external_proposals SET status = 'proposed', decided_by = NULL, decided_at = NULL, " +
      "decided_note = NULL, created_ref = NULL WHERE created_ref = ? AND status = 'accepted'",
    [createdRef],
  );
  return Number(r?.affectedRows) || 0;
}

/**
 * Clear the verbatim quote off named records, and report how many still had one.
 *
 * THE ERASURE'S SECOND WRITE, and the one that matters. Dropping a subject row
 * de-attributes a record; it does not take the person out of it, and a verbatim
 * quote is the most restating thing a vendor ever sends. `AND quote IS NOT
 * NULL` is what makes the returned number the count of quotes actually cleared
 * rather than the count of records looked at, which is the number an erasure
 * report prints.
 *
 * An empty list returns zero without going to the database: `IN ()` is a syntax
 * error, so the guard is the difference between a no-op and a throw. The
 * placeholders are generated from the list's own length and every id travels as
 * a parameter.
 */
export async function clearQuotesOn(pool: Pool, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const holes = ids.map(() => "?").join(",");
  const [q] = await pool.query<any>(
    `UPDATE external_proposals SET quote = NULL WHERE id IN (${holes}) AND quote IS NOT NULL`,
    ids as string[],
  );
  return Number(q?.affectedRows) || 0;
}
