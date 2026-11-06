/**
 * `saberra_snapshots` (0331): the newest whole reads of the outside service's
 * circles and roles, one row per read, newest kept and the rest deleted.
 *
 * The rows are written by server/lib/saberraSnapshot.ts under the sync's lock
 * and read by the differences routes. What a row may hold, and why it never
 * holds a page address or a member's name, is in that file and in 0331.
 *
 * `taken_at` is read back with UNIX_TIMESTAMP, so the host's offset can never
 * shift it (the TIMESTAMP trap the test pools are pinned against).
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { SNAPSHOT_READS, type Snapshot, type SnapshotKind, type SnapshotRead, type SnapshotRecord } from "../../shared/seraDifferences";

export interface SnapshotRow {
  seq: number;
  snapshot: Snapshot;
}

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

/** A stored kind, read without trusting it: an unknown read word is a failed read, a non-list holds nothing. */
function kindOf(read: unknown, records: unknown): SnapshotKind {
  const word = typeof read === "string" && (SNAPSHOT_READS as readonly string[]).includes(read) ? (read as SnapshotRead) : "failed";
  const list = jsonOf(records);
  return {
    read: word,
    records: Array.isArray(list)
      ? list.filter((r): r is SnapshotRecord => !!r && typeof r === "object" && typeof (r as SnapshotRecord).id === "string")
      : [],
  };
}

/** One read, written whole. */
export async function insertSnapshot(pool: Pool, takenAt: Date, snapshot: Omit<Snapshot, "takenAt">): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "INSERT INTO saberra_snapshots (taken_at, run_trigger, circles_read, circles, roles_read, roles) VALUES (?, ?, ?, ?, ?, ?)",
    [
      takenAt,
      String(snapshot.trigger).slice(0, 16),
      snapshot.circles.read,
      JSON.stringify(snapshot.circles.records),
      snapshot.roles.read,
      JSON.stringify(snapshot.roles.records),
    ],
  );
  return Number(res.insertId);
}

/** The newest `limit` rows, newest first. */
export async function recentSnapshots(pool: Pool, limit: number): Promise<SnapshotRow[]> {
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seq, UNIX_TIMESTAMP(taken_at) AS taken, run_trigger, circles_read, circles, roles_read, roles " +
      "FROM saberra_snapshots ORDER BY seq DESC LIMIT ?",
    [n],
  );
  return rows.map((r) => ({
    seq: Number(r.seq),
    snapshot: {
      takenAt: new Date(Number(r.taken) * 1000).toISOString(),
      trigger: String(r.run_trigger ?? ""),
      circles: kindOf(r.circles_read, r.circles),
      roles: kindOf(r.roles_read, r.roles),
    },
  }));
}

/** Delete every row older than the newest `keep`. Returns how many went. */
export async function pruneSnapshots(pool: Pool, keep: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seq FROM saberra_snapshots ORDER BY seq DESC LIMIT 1 OFFSET ?",
    [Math.max(0, Math.floor(keep) - 1)],
  );
  const oldestKept = rows[0]?.seq;
  if (oldestKept === undefined || oldestKept === null) return 0;
  const [res] = await pool.query<ResultSetHeader>("DELETE FROM saberra_snapshots WHERE seq < ?", [Number(oldestKept)]);
  return res.affectedRows;
}
