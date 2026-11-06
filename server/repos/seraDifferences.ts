/**
 * The reads the differences list makes beside the snapshots
 * (server/lib/seraDifferencesRead.ts): every circle with its aliases, which
 * roles have pay set, and what this village PUBLISHED from the outside service.
 *
 * Reads only. Nothing here writes a row.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { AcceptedChange } from "../../shared/seraDifferences";

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

/** The most changes the base is ever folded from. A village with more has a history no review reads whole. */
const HISTORY_CAP = 5000;

/**
 * Every change of every draft a machine proposed from `moduleId` that this
 * village PUBLISHED, oldest first: the base each difference is three-way
 * against (R2). A withdrawn draft never applied, and a reverted one was undone,
 * so neither counts; a human draft says nothing about the service.
 */
export async function publishedFromModule(pool: Pool, moduleId: string): Promise<AcceptedChange[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.op, c.org_role_id, c.payload FROM org_draft_changes c JOIN org_drafts d ON d.id = c.draft_id " +
      "WHERE d.source_kind = 'agent' AND d.source_module_id = ? AND d.status = 'published' " +
      "ORDER BY d.published_at, d.id, c.sort_order, c.id LIMIT ?",
    [moduleId, HISTORY_CAP],
  );
  return rows.map((r) => {
    const payload = jsonOf(r.payload);
    return {
      op: String(r.op),
      orgRoleId: String(r.org_role_id),
      payload: payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null,
    };
  });
}
