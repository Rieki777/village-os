/**
 * Where a member stands on the investor path (0156), recorded as dated facts.
 *
 * ── THIS MODULE HOLDS NO MONEY, AND THAT IS ENFORCED BY THE SCHEMA ───────
 * `investor_path_facts` has no numeric column. Not an amount, not a unit
 * count, not a currency, not a valuation. Nothing in this file can therefore
 * write one, however anybody later decides to call a function here.
 *
 * The rule it is keeping comes from server/lib/ledger.ts's own header: equity
 * and voice are HYPHA-GOVERNED tokens that live on Base and are mirrored here
 * READ-ONLY, because a platform that posted one "would quietly become the
 * source of truth for the cap table", which decision 5 forbids and the boot
 * invariants fail loud on. A column here holding how much somebody put in
 * would be that second source exactly: a member-facing capital figure written
 * outside `postTransfer`, outside the per-token SUM(balance) = 0 invariant,
 * and outside `token_balances`' recompute-never-increment discipline, with
 * nothing anywhere reconciling the two.
 *
 * So the split is total and neither side can express the other's answer:
 *
 *   server/lib/ledger.ts   HOW MUCH. The only thing that may say so.
 *   this module            WHAT HAPPENED AND WHEN, in words and dates.
 *
 * A ladder rung about holdings is read from the ledger's mirror at the moment
 * somebody looks. It is never read from here, so it can never drift from here.
 *
 * ── NO POSITION IS COMPUTED HERE ─────────────────────────────────────────
 * These functions return facts. They do not return a rung, a level or a
 * score, because a stored position outlives the fact that justified it and
 * there is no way to tell a stale one from a true one by looking. A position
 * is a function of the live rows at read time, which is how it FALLS when a
 * fact ends: `endFact` sets one `ended_at`, the next read finds one fewer
 * live fact, and the answer comes out lower with nothing written to say so.
 *
 * The rungs themselves are not defined anywhere in this repository, so this
 * module deliberately does not invent them.
 */
import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Single-village build, matching server/lib/housing.ts. */
const VILLAGE = "local";

/**
 * The facts this build records. varchar in the schema and not an enum, so a
 * village adds one by typing it and no table rebuild is involved; this list
 * is what the platform's own writers use.
 *
 * `accreditation_declared` is a DECLARATION and never a verification. The
 * name says so on purpose, because a column called `accredited` would be a
 * claim this platform has no way to stand behind.
 */
export const INVESTOR_FACTS = [
  "interest_registered",
  "packet_released",
  "accreditation_declared",
  "agreement_signed",
] as const;

export type InvestorFact = (typeof INVESTOR_FACTS)[number];

export const isInvestorFact = (v: unknown): v is InvestorFact =>
  typeof v === "string" && (INVESTOR_FACTS as readonly string[]).includes(v);

export interface InvestorFactRow {
  id: string;
  userId: string;
  fact: string;
  /** Words a human reads. Never parsed, never summed. */
  detail: string | null;
  /** investor_docs.id when the fact is about one document. */
  documentId: string | null;
  startedAt: string;
  /** Null means still true. This is what makes a rung fall. */
  endedAt: string | null;
  endedReason: string | null;
  recordedBy: string | null;
  isExample: boolean;
}

const toRow = (r: RowDataPacket): InvestorFactRow => ({
  id: String(r.id),
  userId: String(r.user_id),
  fact: String(r.fact),
  detail: r.detail == null ? null : String(r.detail),
  documentId: r.document_id == null ? null : String(r.document_id),
  startedAt: String(r.started_at),
  endedAt: r.ended_at == null ? null : String(r.ended_at),
  endedReason: r.ended_reason == null ? null : String(r.ended_reason),
  recordedBy: r.recorded_by == null ? null : String(r.recorded_by),
  isExample: Number(r.is_example) === 1,
});

const COLUMNS =
  "id, user_id, fact, detail, document_id, started_at, ended_at, ended_reason, recorded_by, is_example";

export interface RecordFactInput {
  userId: string;
  fact: InvestorFact;
  detail?: string | null;
  documentId?: string | null;
  /** Who recorded it. Null when the member's own action created it. */
  recordedBy?: string | null;
}

/**
 * Record a fact, once.
 *
 * `fresh: false` means the member already holds this fact LIVE and nothing
 * was written. The unique key on (village_id, active_fact_key) is what
 * decides that, in the database, so two requests arriving together cannot
 * both believe they made the record. The same discipline as
 * server/lib/notify.ts: the index is the dedupe, and a flag is not checked
 * anywhere.
 *
 * ON A DUPLICATE IT RETURNS THE ID OF THE ROW THAT IS ACTUALLY THERE, which
 * costs one extra SELECT and is worth it. Handing back the id of the INSERT
 * that just failed would be a string naming no row, and a caller that stored
 * it, linked to it or wrote it into an event would be pointing at nothing
 * with no error anywhere to say so.
 *
 * Twelve hex characters of id, matching housing and notify. The reason is
 * worth carrying: a PRIMARY key collision would surface as the same
 * ER_DUP_ENTRY the catch below reads as "already held", so a short id would
 * silently drop real records as successful dedupes.
 */
export async function recordFact(
  pool: Pool,
  input: RecordFactInput,
): Promise<{ id: string; fresh: boolean }> {
  const id = `ipf-${randomUUID().slice(0, 12)}`;
  try {
    await pool.query(
      "INSERT INTO investor_path_facts " +
        "(id, village_id, user_id, fact, detail, document_id, recorded_by) " +
        "VALUES (?,?,?,?,?,?,?)",
      [
        id,
        VILLAGE,
        input.userId,
        input.fact,
        input.detail ?? null,
        input.documentId ?? null,
        input.recordedBy ?? null,
      ],
    );
  } catch (e: any) {
    if (e?.code !== "ER_DUP_ENTRY") throw e;
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM investor_path_facts " +
        "WHERE village_id = ? AND user_id = ? AND fact = ? AND ended_at IS NULL LIMIT 1",
      [VILLAGE, input.userId, input.fact],
    );
    const held = rows[0];
    // Finding no live row means this was NOT the ordinary already-held case.
    // Either the collision was on the PRIMARY key (the one-in-many-millions
    // id clash notify.ts warns about) or something ended the row in the
    // moment between the INSERT failing and this SELECT. Raising covers both:
    // swallowing either one would drop a real record and report a clean
    // dedupe, which is the exact failure notify.ts documents.
    if (!held) throw e;
    return { id: String(held.id), fresh: false };
  }
  return { id, fresh: true };
}

/**
 * End a fact, which is the whole of how a rung drops.
 *
 * Scoped to the LIVE row by `ended_at IS NULL`, so ending a fact twice is a
 * no-op that answers false, and a fact ended years ago is never reopened by
 * accident. Nothing is deleted: the row stays with its dates and its reason,
 * which is where the history lives now that no crossing-event table holds it.
 */
export async function endFact(
  pool: Pool,
  userId: string,
  fact: string,
  reason?: string | null,
): Promise<boolean> {
  const [r]: any = await pool.query(
    "UPDATE investor_path_facts SET ended_at = CURRENT_TIMESTAMP, ended_reason = ? " +
      "WHERE village_id = ? AND user_id = ? AND fact = ? AND ended_at IS NULL",
    [reason ?? null, VILLAGE, userId, fact],
  );
  return (r?.affectedRows ?? 0) > 0;
}

/**
 * One member's facts. Live ones only by default, because that is what a
 * ladder reads; `includeEnded` gets the history, which is the same rows with
 * the filter dropped.
 *
 * Example rows are excluded from the live read and never counted by a ladder.
 * A village seeding a standing example must not promote a real member on it,
 * the same hazard org_role_assignments carries `is_example` for.
 */
export async function factsForMember(
  pool: Pool,
  userId: string,
  opts: { includeEnded?: boolean; includeExamples?: boolean } = {},
): Promise<InvestorFactRow[]> {
  const where = ["village_id = ?", "user_id = ?"];
  if (!opts.includeEnded) where.push("ended_at IS NULL");
  if (!opts.includeExamples) where.push("is_example = 0");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM investor_path_facts WHERE ${where.join(" AND ")} ` +
      "ORDER BY started_at DESC, id",
    [VILLAGE, userId],
  );
  return rows.map(toRow);
}

/**
 * Everyone currently holding one fact, for the founder's read. Capped, and
 * ordered oldest first because the useful question is who has been waiting
 * longest.
 */
export async function membersHoldingFact(
  pool: Pool,
  fact: string,
  limit = 200,
): Promise<InvestorFactRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM investor_path_facts ` +
      "WHERE village_id = ? AND fact = ? AND ended_at IS NULL AND is_example = 0 " +
      "ORDER BY started_at, id LIMIT ?",
    [VILLAGE, fact, Math.min(500, Math.max(1, limit))],
  );
  return rows.map(toRow);
}
