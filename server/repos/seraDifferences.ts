/**
 * The reads the differences list makes beside the snapshots
 * (server/lib/seraDifferencesRead.ts): every circle with its aliases, which
 * roles have pay set, and what this village PUBLISHED from the outside service.
 *
 * Reads only. Nothing here writes a row.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { PublishedChange } from "../../shared/seraDifferences";

/** A JSON column, whichever way the driver hands it back. */
function jsonOf(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Every circle, with its aliases read into a list, in chart order. Read from
 * the table rather than the boot-time cache, which this module is not handed.
 */
export async function circlesForDifferences(pool: Pool): Promise<Array<Record<string, unknown>>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, aliases, parent_circle_id, status, is_example FROM circles ORDER BY sort_order, name, id",
  );
  return rows.map((r) => {
    const aliases = jsonOf(r.aliases);
    return {
      id: String(r.id),
      name: String(r.name ?? r.id),
      aliases: Array.isArray(aliases) ? aliases : [],
      parentCircleId: r.parent_circle_id ? String(r.parent_circle_id) : null,
      status: r.status ? String(r.status) : "active",
      isExample: Number(r.is_example) === 1,
    };
  });
}

/** The roles this village has set any pay on: a value, cash, tokens or terms. Ids only, never a figure. */
export async function rolesWithPaySet(pool: Pool): Promise<Set<string>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM org_roles WHERE value_minor IS NOT NULL OR cash_minor IS NOT NULL OR value_tokens IS NOT NULL OR terms_offer IS NOT NULL",
  );
  return new Set(rows.map((r) => String(r.id)));
}

/** The most changes the base is ever folded from: the NEWEST ones, since the newest change to a field is its base. */
const HISTORY_CAP = 5000;

const objectOf = (raw: unknown): Record<string, unknown> | null => {
  const v = jsonOf(raw);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
};

/**
 * The changes of every draft a machine proposed from `moduleId` that this
 * village PUBLISHED, oldest first: what the base each difference is three-way
 * against is folded from (R2). A withdrawn draft never applied, and a reverted
 * one was undone, so neither counts; a human draft says nothing about the
 * service. Read newest first under the cap, then put back in order.
 */
export async function publishedFromModule(pool: Pool, moduleId: string): Promise<PublishedChange[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.draft_id, c.op, c.org_role_id, c.payload FROM org_draft_changes c JOIN org_drafts d ON d.id = c.draft_id " +
      "WHERE d.source_kind = 'agent' AND d.source_module_id = ? AND d.status = 'published' " +
      "ORDER BY d.published_at DESC, d.id DESC, c.sort_order DESC, c.id DESC LIMIT ?",
    [moduleId, HISTORY_CAP],
  );
  return rows
    .map((r) => ({ draftId: String(r.draft_id), op: String(r.op), orgRoleId: String(r.org_role_id), payload: objectOf(r.payload) }))
    .reverse();
}

/** A proposal accepted into one of the given drafts, with what it needs to prove it is untouched. */
export interface AcceptedProposalRow {
  id: string;
  draftId: string;
  kind: string;
  payload: Record<string, unknown>;
  sourceRef: string | null;
  dedupeKey: string;
}

/**
 * The proposals from `moduleId` accepted into these drafts UNTOUCHED: never
 * edited at accept (spec T14a). An accept that changed the words marks
 * `edited_at_accept` (`a_sera_difference_is_answered`), so a proposal whose capitals alone a steward fixed
 * is left out here, and the change built from it has no base it could be
 * mistaken for.
 *
 * A row accepted before that migration carries no mark whatever was done to it, so the
 * caller still checks that the payload hashes to the dedupe key it landed
 * under, and the engine still treats a base differing from the service's
 * value by capitals alone as unknown (shared/seraDifferences.ts
 * `tracedUpToCase`). Both stay as a second guard for those older rows: nothing
 * can tell an old capitals-only edit from the service's own words.
 */
export async function acceptedProposalsFor(pool: Pool, moduleId: string, draftIds: readonly string[]): Promise<AcceptedProposalRow[]> {
  if (draftIds.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, created_ref, kind, payload, source_ref, dedupe_key FROM external_proposals WHERE module_id = ? AND status = 'accepted' AND edited_at_accept IS NULL AND created_ref IN (${draftIds.map(() => "?").join(",")})`,
    [moduleId, ...draftIds],
  );
  return rows.map((r) => ({
    id: String(r.id),
    draftId: String(r.created_ref),
    kind: String(r.kind),
    payload: objectOf(r.payload) ?? {},
    sourceRef: r.source_ref === null || r.source_ref === undefined ? null : String(r.source_ref),
    dedupeKey: String(r.dedupe_key),
  }));
}

/** What changes when the base could: how many drafts from `moduleId` stand published, and the newest publish. */
export async function publishStamp(pool: Pool, moduleId: string): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n, MAX(UNIX_TIMESTAMP(published_at)) AS at FROM org_drafts WHERE source_kind = 'agent' AND source_module_id = ? AND status = 'published'",
    [moduleId],
  );
  return `${Number(rows[0]?.n ?? 0)}:${Number(rows[0]?.at ?? 0)}`;
}

/** The kinds that change the chart (shared/structurePlan.ts STRUCTURE_KINDS). */
const CHART_KINDS = ["org.proposed", "role.proposed", "circle.proposed"];

/** Every proposal from `moduleId` still waiting, of any kind, for the retire after a landing (spec R28). */
export async function waitingFromModule(
  pool: Pool,
  moduleId: string,
): Promise<Array<{ batchId: string; kind: string; receivedAt: string | null; payload: Record<string, unknown> | null }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT batch_id, kind, UNIX_TIMESTAMP(received_at) AS at, payload FROM external_proposals WHERE module_id = ? AND status = 'proposed'",
    [moduleId],
  );
  return rows.map((r) => ({
    batchId: String(r.batch_id),
    kind: String(r.kind),
    receivedAt: r.at === null || r.at === undefined ? null : new Date(Number(r.at) * 1000).toISOString(),
    payload: objectOf(r.payload),
  }));
}

/** Every proposal from `moduleId` still waiting that changes the chart, for the list's links (review C7). */
export async function waitingChartProposals(
  pool: Pool,
  moduleId: string,
): Promise<Array<{ batchId: string; kind: string; receivedAt: string | null; payload: Record<string, unknown> | null }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT batch_id, kind, UNIX_TIMESTAMP(received_at) AS at, payload FROM external_proposals WHERE module_id = ? AND status = 'proposed' AND kind IN (${CHART_KINDS.map(() => "?").join(",")})`,
    [moduleId, ...CHART_KINDS],
  );
  return rows.map((r) => ({
    batchId: String(r.batch_id),
    kind: String(r.kind),
    receivedAt: r.at === null || r.at === undefined ? null : new Date(Number(r.at) * 1000).toISOString(),
    payload: objectOf(r.payload),
  }));
}
