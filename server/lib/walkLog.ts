/**
 * The Welcome Walk's log: storage and the one report it exists for (0061).
 *
 * The aggregation itself is pure and lives in shared/walkLog.ts, so the
 * question "where does the walk lose people" is answered the same way here,
 * in a test, and anywhere else that ever asks it.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { walkFunnel, type WalkFunnel, type WalkLogRow } from "../../shared/walkLog";

export interface WalkLogInput {
  sessionKey: string;
  step: string;
  atIndex?: number;
  tsSeq?: number;
  lang?: string | null;
}

const clampInt = (v: unknown, max: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
};

/** Same key for the same row, so a replayed import is a no-op. */
const idemKey = (source: string, r: WalkLogInput): string =>
  `${source}:${r.sessionKey}:${r.tsSeq ?? 0}:${r.step}`.slice(0, 160);

/** What a batch did: how many rows were usable, and how many were new. */
export interface WalkLogWrite {
  /** Rows that survived validation. What the caller asked to be recorded. */
  accepted: number;
  /** Of those, the ones this village had not already seen. */
  stored: number;
}

/**
 * Record rows.
 *
 * One statement for the batch, and `ON DUPLICATE KEY UPDATE` on the
 * idempotency key so re-importing a scene file cannot inflate the numbers the
 * report is built from. That matters more here than in most tables: the whole
 * value of this data is that the counts are true.
 *
 * Which is also why this returns two numbers instead of one. `accepted` and
 * `stored` answer different questions, and collapsing them into a single
 * "recorded" is what let a replay claim it had written rows it had not.
 */
/**
 * How many walk-log batches one address may post in an hour.
 *
 * EVERYTHING ELSE HERE CAPS A SINGLE BATCH and nothing capped the number of
 * batches. `recordWalkRows` slices to 2000 rows, the session key is clipped to
 * 64 characters, the index and sequence are clamped, and the idempotency key
 * dedupes a replay. All of that is per call. A caller minting a fresh
 * `sessionKey` each time defeated every one of them and could write into
 * `walk_log` without limit and without an account, because the route is
 * unauthenticated on purpose: a walk runs before anybody signs in, which is
 * exactly the person it measures.
 *
 * Found by scripts/check-route-limits.mjs on its first run, which is the whole
 * argument for that script existing.
 *
 * THE ROUTE ANSWERS 200 AND `recorded: 0` RATHER THAN 429. The person a 429
 * would reach is a first-time visitor looking at the map for the first time,
 * and analytics is not worth an error in front of them. The map already reads
 * this response as advisory. Same shape as the `toolclick` limit next door.
 *
 * 60 an hour: a real walk posts a handful of batches, and a household behind
 * one address walking at the same time still fits inside it.
 */
export const WALK_LOG_PER_IP_HOURLY = 60;

export async function recordWalkRows(
  pool: Pool,
  rows: readonly WalkLogInput[],
  source: "live" | "import",
): Promise<WalkLogWrite> {
  const clean = rows
    .filter((r) => r && typeof r.sessionKey === "string" && r.sessionKey && typeof r.step === "string" && r.step)
    .slice(0, 2000);
  if (!clean.length) return { accepted: 0, stored: 0 };

  const values: any[] = [];
  const holes: string[] = [];
  for (const r of clean) {
    holes.push("(?,?,?,?,?,?,?,?)");
    values.push(
      `wl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      String(r.sessionKey).slice(0, 64),
      String(r.step).slice(0, 64),
      clampInt(r.atIndex, 999),
      clampInt(r.tsSeq, 99999),
      r.lang ? String(r.lang).slice(0, 8) : null,
      source,
      idemKey(source, r),
    );
  }
  /*
   * Count what is genuinely NEW before writing, because the write cannot tell
   * you afterwards.
   *
   * `affectedRows` on an `INSERT ... ON DUPLICATE KEY UPDATE` is 1 for an
   * insert and 2 for an update that changed something, so a replayed batch
   * reported 2 where the honest answer is 0. Nothing consumed the number, so
   * nothing broke; it just said the opposite of the truth to whoever read it,
   * and the whole reason this table has an idempotency key is that replays are
   * expected rather than exceptional.
   *
   * A separate SELECT rather than parsing `Records:`/`Duplicates:` out of the
   * driver's info string: these batches are one walk long, the extra query is
   * cheap, and a count is a count in any driver version.
   */
  const keys = clean.map((r) => idemKey(source, r));
  const [seen] = await pool.query<any[]>(
    `SELECT COUNT(*) n FROM walk_log WHERE idempotency_key IN (${keys.map(() => "?").join(",")})`,
    keys,
  );
  const alreadyHere = Number(seen[0]?.n ?? 0);

  await pool.query(
    `INSERT INTO walk_log (id, session_key, step, at_index, ts_seq, lang, source, idempotency_key)
       VALUES ${holes.join(",")}
     ON DUPLICATE KEY UPDATE at_index = VALUES(at_index)`,
    values,
  );
  return { accepted: clean.length, stored: clean.length - alreadyHere };
}

/**
 * The report: where the walk loses people.
 *
 * `source` filters live rows from imported ones, because a demo scene's log
 * and a real village's arrivals are different populations and averaging them
 * would answer neither question.
 */
export async function walkReport(
  pool: Pool,
  opts: { source?: "live" | "import" | "all"; days?: number } = {},
): Promise<WalkFunnel & { source: string; days: number }> {
  const days = Math.min(Math.max(Number(opts.days ?? 90), 1), 730);
  const source = opts.source ?? "all";
  const where = ["created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)"];
  const params: any[] = [days];
  if (source !== "all") { where.push("source = ?"); params.push(source); }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT session_key, step, at_index, ts_seq FROM walk_log
      WHERE ${where.join(" AND ")}
      ORDER BY session_key, ts_seq
      LIMIT 20000`,
    params,
  );
  const shaped: WalkLogRow[] = rows.map((r) => ({
    sessionKey: String(r.session_key),
    step: String(r.step),
    atIndex: Number(r.at_index),
    tsSeq: Number(r.ts_seq),
  }));
  return { ...walkFunnel(shaped), source, days };
}
