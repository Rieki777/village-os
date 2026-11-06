/**
 * A MODULE'S OWN HISTORY, read for the module's page in the library.
 *
 * Three reads, each addressed by one module id:
 *
 *   `moduleLifecycleRows`   `module_events`, the lifecycle flips, newest first,
 *                           with the account that did it (when one did)
 *   `moduleVoteWrites`      `governance_element_ledger`, the switches a carried
 *                           vote wrote, with the ballot they came from
 *   `liveModuleProposal`    `mechanics_proposals`, a proposal still asking to
 *                           switch this module, with its ballot's close
 *
 * The route in `server/routes/moduleLibrary.ts` decides what a reader may see
 * (names only to signed-in members, preview never below a steward). Nothing
 * here filters for privacy: a repo returns rows, and the decision about who
 * reads them lives in one place where a reviewer can find it.
 *
 * `module_events` had one reader before this, the admin events route in
 * server/index.ts, and that one still stands.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface LifecycleRow {
  from: string | null;
  to: string | null;
  at: Date;
  byUserId: string | null;
  byName: string | null;
}

export async function moduleLifecycleRows(pool: Pool, moduleId: string, limit = 50): Promise<LifecycleRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT e.from_value, e.to_value, e.at, e.by_user_id, u.name AS by_name FROM module_events e " +
      "LEFT JOIN users u ON u.id = e.by_user_id WHERE e.module_id = ? AND e.kind = 'lifecycle' " +
      "ORDER BY e.at DESC LIMIT ?",
    [moduleId, Math.max(1, Math.min(200, Math.floor(limit)))],
  );
  return rows.map((r) => ({
    from: r.from_value ?? null,
    to: r.to_value ?? null,
    at: new Date(r.at),
    byUserId: r.by_user_id ?? null,
    byName: r.by_name ?? null,
  }));
}

export interface VoteWrite {
  ballotId: string;
  title: string | null;
  newValue: string | null;
  appliedAt: Date;
}

export async function moduleVoteWrites(pool: Pool, moduleId: string): Promise<VoteWrite[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT l.ballot_id, l.new_value, l.applied_at, b.title FROM governance_element_ledger l " +
      "LEFT JOIN ballots b ON b.id = l.ballot_id " +
      "WHERE l.wrote_table = 'module_settings' AND l.wrote_id = ? ORDER BY l.applied_at DESC LIMIT 50",
    [moduleId],
  );
  return rows.map((r) => ({
    ballotId: String(r.ballot_id),
    title: r.title ?? null,
    newValue: r.new_value ?? null,
    appliedAt: new Date(r.applied_at),
  }));
}

export interface LiveModuleProposal {
  id: string;
  title: string;
  status: string;
  ballotId: string | null;
  closesAt: Date | null;
  /** The lifecycle the proposal asks this module to move to. */
  to: string | null;
}

/**
 * The newest proposal that still asks to switch this module and has not
 * finished: anything but withdrawn, failed or applied. A carried vote waiting
 * out its landing window counts, because a second proposal then would ask for
 * something already decided.
 *
 * The LIKE narrows on the stored key (`"module:<id>"`, quoted, so `tools` never
 * matches `toolsmith`); the JSON is then read here to confirm the item really
 * is a module switch for this id.
 */
export async function liveModuleProposal(pool: Pool, moduleId: string): Promise<LiveModuleProposal | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT p.id, p.title, p.status, p.ballot_id, p.change_set, b.closes_at FROM mechanics_proposals p " +
      "LEFT JOIN ballots b ON b.id = p.ballot_id " +
      "WHERE p.status NOT IN ('withdrawn','failed','applied') AND CAST(p.change_set AS CHAR) LIKE ? " +
      "ORDER BY p.created_at DESC LIMIT 20",
    [`%${JSON.stringify(`module:${moduleId}`).replace(/[\\%_]/g, (c) => `\\${c}`)}%`],
  );
  for (const r of rows) {
    let items: unknown;
    try {
      items = typeof r.change_set === "string" ? JSON.parse(r.change_set) : r.change_set;
    } catch {
      continue;
    }
    const hit = Array.isArray(items)
      ? (items as any[]).find((c) => c && c.kind === "module_lifecycle" && c.moduleId === moduleId)
      : null;
    if (!hit) continue;
    return {
      id: String(r.id),
      title: String(r.title),
      status: String(r.status),
      ballotId: r.ballot_id ?? null,
      closesAt: r.closes_at ? new Date(r.closes_at) : null,
      to: hit.to ?? null,
    };
  }
  return null;
}
