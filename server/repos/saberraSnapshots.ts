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
import {
  SNAPSHOT_READS,
  type AgreedSlot,
  type MatchVia,
  type Snapshot,
  type SnapshotKind,
  type SnapshotMatch,
  type SnapshotRead,
  type SnapshotRecord,
} from "../../shared/seraDifferences";

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

const VIAS: ReadonlySet<string> = new Set<MatchVia>(["link", "pageId", "earlier", "name", "alias"]);
const SLOTS: readonly AgreedSlot[] = ["name", "aim", "circle"];

/**
 * A record's stored match, read without trusting it (review C2). A malformed
 * one is dropped, so the record reads the way one kept before matches were
 * stored does; an agreed value that is neither text nor `true` is left out.
 */
function recordOf(r: SnapshotRecord): SnapshotRecord {
  const raw = (r as { match?: unknown }).match;
  if (raw === undefined || raw === null) return r;
  const m = raw as Record<string, unknown>;
  if (typeof m !== "object" || typeof m.ourId !== "string" || !VIAS.has(String(m.via))) {
    const { match: _dropped, ...rest } = r;
    return rest;
  }
  const objectOf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const match: SnapshotMatch = { ourId: m.ourId, via: m.via as MatchVia };
  // What both sides held, as hashes (review N3): text only.
  const held: Partial<Record<AgreedSlot, string>> = {};
  for (const s of SLOTS) {
    const v = objectOf(m.held)[s];
    if (typeof v === "string") held[s] = v;
  }
  if (Object.keys(held).length) match.held = held;
  // The mark of the history's base each was held under (review K1): text only.
  const traced: Partial<Record<AgreedSlot, string>> = {};
  for (const s of SLOTS) {
    const v = objectOf(m.traced)[s];
    if (typeof v === "string") traced[s] = v;
  }
  if (Object.keys(traced).length) match.traced = traced;
  // A row kept before held the words, or true: still read, never written now.
  const agreed: Partial<Record<AgreedSlot, string | true>> = {};
  for (const s of SLOTS) {
    const v = objectOf(m.agreed)[s];
    if (v === true || typeof v === "string") agreed[s] = v;
  }
  if (Object.keys(agreed).length) match.agreed = agreed;
  // The pay the service held when ours was last in step: a hash, kept only as text.
  if (typeof m.pay === "string") match.pay = m.pay;
  if (typeof m.ourPay === "string") match.ourPay = m.ourPay;
  return { ...r, match };
}

/** A stored kind, read without trusting it: an unknown read word is a failed read, a non-list holds nothing. */
function kindOf(read: unknown, records: unknown): SnapshotKind {
  const list = jsonOf(records);
  return {
    read: readWord(read),
    records: Array.isArray(list)
      ? list.filter((r): r is SnapshotRecord => !!r && typeof r === "object" && typeof (r as SnapshotRecord).id === "string").map(recordOf)
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
  return rows.map(rowOf);
}

/** One kept row without its records: enough to choose which rows a read needs. */
export interface SnapshotIndexRow {
  seq: number;
  /** Seconds since the epoch. */
  taken: number;
  circlesRead: SnapshotRead;
  rolesRead: SnapshotRead;
}

const readWord = (v: unknown): SnapshotRead =>
  typeof v === "string" && (SNAPSHOT_READS as readonly string[]).includes(v) ? (v as SnapshotRead) : "failed";

/** Every kept row's seq, time and read words, newest first. No records, so it costs almost nothing. */
export async function snapshotIndex(pool: Pool): Promise<SnapshotIndexRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seq, UNIX_TIMESTAMP(taken_at) AS taken, circles_read, roles_read FROM saberra_snapshots ORDER BY seq DESC LIMIT 100",
  );
  return rows.map((r) => ({ seq: Number(r.seq), taken: Number(r.taken), circlesRead: readWord(r.circles_read), rolesRead: readWord(r.roles_read) }));
}

/** These rows whole, newest first. */
export async function snapshotsBySeq(pool: Pool, seqs: readonly number[]): Promise<SnapshotRow[]> {
  if (seqs.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seq, UNIX_TIMESTAMP(taken_at) AS taken, run_trigger, circles_read, circles, roles_read, roles " +
      `FROM saberra_snapshots WHERE seq IN (${seqs.map(() => "?").join(",")}) ORDER BY seq DESC`,
    [...seqs],
  );
  return rows.map(rowOf);
}

function rowOf(r: RowDataPacket): SnapshotRow {
  return {
    seq: Number(r.seq),
    snapshot: {
      takenAt: new Date(Number(r.taken) * 1000).toISOString(),
      trigger: String(r.run_trigger ?? ""),
      circles: kindOf(r.circles_read, r.circles),
      roles: kindOf(r.roles_read, r.roles),
    },
  };
}

/**
 * Delete every row older than the newest `keep`, except the two newest whole
 * reads of each kind: a run of attempts the service never answered (review C6)
 * must not prune the last full check the list says it is from, nor the two
 * whole reads "missing twice" counts (R4). The age prune still takes them.
 * Returns how many went.
 */
export async function pruneSnapshots(pool: Pool, keep: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seq FROM saberra_snapshots ORDER BY seq DESC LIMIT 1 OFFSET ?",
    [Math.max(0, Math.floor(keep) - 1)],
  );
  const oldestKept = rows[0]?.seq;
  if (oldestKept === undefined || oldestKept === null) return 0;
  const whole = async (column: "circles_read" | "roles_read") =>
    (await pool.query<RowDataPacket[]>(`SELECT seq FROM saberra_snapshots WHERE ${column} = 'whole' ORDER BY seq DESC LIMIT 2`))[0].map((r) => Number(r.seq));
  const held = Array.from(new Set([...(await whole("circles_read")), ...(await whole("roles_read"))]));
  const [res] = await pool.query<ResultSetHeader>(
    `DELETE FROM saberra_snapshots WHERE seq < ?${held.length ? ` AND seq NOT IN (${held.map(() => "?").join(",")})` : ""}`,
    [Number(oldestKept), ...held],
  );
  return res.affectedRows;
}

/**
 * Delete every read taken before `cutoff`, the newest included. Compared through
 * UNIX_TIMESTAMP, the way reads are read back, so the host's offset cannot move
 * the line. Says how many rows went.
 */
export async function pruneSnapshotsOlderThan(pool: Pool, cutoff: Date): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>("DELETE FROM saberra_snapshots WHERE UNIX_TIMESTAMP(taken_at) < ?", [
    Math.floor(cutoff.getTime() / 1000),
  ]);
  return Number(res.affectedRows ?? 0);
}

/**
 * Take, out of every row that carries a kind it did not read whole, the
 * records whose own whole read was taken before `cutoff` (review N1). A row
 * carries what an older read said, and is newer than that read, so the age
 * prune by `taken_at` alone never reached it. A carried record whose time
 * cannot be read goes too; one kept before records carried a time stays,
 * because its age cannot be told. Says how many carried kinds were cut.
 */
export async function pruneCarriedOlderThan(pool: Pool, cutoff: Date): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seq, circles_read, circles, roles_read, roles FROM saberra_snapshots WHERE circles_read <> 'whole' OR roles_read <> 'whole'",
  );
  const line = cutoff.getTime();
  const young = (r: unknown): boolean => {
    if (!r || typeof r !== "object" || !("readAt" in r)) return true;
    const t = Date.parse(String((r as { readAt: unknown }).readAt));
    return Number.isFinite(t) && t >= line;
  };
  let cut = 0;
  for (const r of rows) {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [read, column] of [["circles_read", "circles"], ["roles_read", "roles"]] as const) {
      if (r[read] === "whole") continue;
      const list = jsonOf(r[column]);
      if (!Array.isArray(list) || list.length === 0) continue;
      const kept = list.filter(young);
      if (kept.length === list.length) continue;
      sets.push(`${column} = ?`);
      args.push(JSON.stringify(kept));
      cut += 1;
    }
    if (sets.length) await pool.query<ResultSetHeader>(`UPDATE saberra_snapshots SET ${sets.join(", ")} WHERE seq = ?`, [...args, Number(r.seq)]);
  }
  return cut;
}
