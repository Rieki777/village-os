/**
 * The gratitude domain's repositories (S8): log, cycles, distributions — all
 * MySQL, all camelCase at the interface so the route code and API responses
 * kept their historical shape. The JSON files these replace stay on the
 * volume as history; nothing reads them anymore.
 *
 * The log's add() surfaces ER_DUP_ENTRY as {duplicate:true} rather than
 * throwing: the unique heart index (one heart per sender per piece of
 * content, D5) makes "already acknowledged" an expected outcome, not an
 * error. Plain sends carry NULL context and are exempt from that index.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { CycleRecord, DistributionRecord } from "../lib/gratitude-cycles";

const toIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : new Date(String(v)).toISOString();

const toDb = (v: unknown): Date | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

export interface GratitudeEntry {
  id: string;
  kind: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
  message: string;
  contextType?: string | null;
  contextRef?: string | null;
  cycleId: string;
  cycleNumber?: number | null;
  at: string;
}

export interface GratitudeLogRepo {
  all(): Promise<GratitudeEntry[]>;
  add(e: GratitudeEntry): Promise<{ ok: boolean; duplicate: boolean }>;
  /*
   * `spentInCycle` USED TO LIVE HERE and it is deliberately gone.
   *
   * It summed `gratitude_log.amount` for one giver and one `cycle_id`, and
   * `budgetFor` subtracted that from the cycle total to get a sending budget.
   * It had no reversal term, so a reversed gift stayed spent, while
   * `allowanceFor` in server/lib/economy.ts subtracted the cycle's reversals
   * and handed the allowance back. Two answers to one question, and the
   * profile rendered both of them side by side.
   *
   * `allowanceFor` is the one computation now (R73) and it reads its own two
   * sums under whichever connection holds the lock, so nothing calls this and
   * a new caller would be re-introducing the drift. It was also unscoped by
   * `village_id`, which the replacement is not.
   */
  /**
   * How many of ONE kind have gone from one member to another this cycle.
   *
   * NOT what `sendGratitude` decides against any more (ECON lane, S3): a bare
   * pool query like this one cannot ride the SERIALIZABLE lock
   * `writeGratitudeRow` (server/lib/economy.ts) holds while it writes, so a
   * read through here and a write moments later is exactly the check-then-act
   * race that let concurrent sends overspend the heart-tap cap. The guard
   * inside `writeGratitudeRow` runs the same count on the LOCKED connection
   * instead. This method stays for informational, non-deciding reads only.
   */
  countPair(fromId: string, toId: string, cycleId: string, kind: string): Promise<number>;
  /**
   * How much GRATITUDE has gone from one member to another this cycle, across
   * ALL KINDS. The per-recipient share (R73) is a share of one allowance, and
   * the allowance is one across the channels, so its aggregate has to be one
   * too: kind-filtering this would let a heart carry what an acknowledgment
   * was refused, which is the concentration the share exists to bound.
   *
   * NOT what either gratitude door decides against any more, for the same
   * reason `countPair` above is not: see `writeGratitudeRow` in
   * server/lib/economy.ts, which reads the identical running total on the
   * SAME locked connection it writes through. Informational only from here.
   */
  sumPair(fromId: string, toId: string, cycleId: string): Promise<number>;
}

export function gratitudeLogRepo(pool: Pool): GratitudeLogRepo {
  return {
    async all() {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id, kind, from_id, from_name, to_id, to_name, amount, message, context_type, context_ref, cycle_id, cycle_number, at " +
          "FROM gratitude_log ORDER BY at, id",
      );
      return rows.map((r) => ({
        id: String(r.id),
        kind: String(r.kind ?? "gratitude"),
        fromId: String(r.from_id),
        fromName: String(r.from_name ?? ""),
        toId: String(r.to_id),
        toName: String(r.to_name ?? ""),
        amount: Number(r.amount ?? 0),
        message: String(r.message ?? ""),
        contextType: r.context_type ?? null,
        contextRef: r.context_ref ?? null,
        cycleId: String(r.cycle_id ?? ""),
        cycleNumber: r.cycle_number == null ? null : Number(r.cycle_number),
        at: toIso(r.at),
      }));
    },

    async countPair(fromId, toId, cycleId, kind) {
      const [[row]] = await pool.query<any[]>(
        "SELECT COUNT(*) AS n FROM gratitude_log WHERE from_id = ? AND to_id = ? AND cycle_id = ? AND kind = ?",
        [fromId, toId, cycleId, kind],
      );
      return Number(row.n);
    },

    async sumPair(fromId, toId, cycleId) {
      const [[row]] = await pool.query<any[]>(
        "SELECT COALESCE(SUM(amount),0) AS s FROM gratitude_log WHERE from_id = ? AND to_id = ? AND cycle_id = ?",
        [fromId, toId, cycleId],
      );
      return Number(row.s);
    },

    async add(e) {
      try {
        await pool.query(
          "INSERT INTO gratitude_log (id, kind, from_id, from_name, to_id, to_name, amount, message, context_type, context_ref, cycle_id, cycle_number, at) " +
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?, CURRENT_TIMESTAMP))",
          [
            e.id,
            e.kind ?? "gratitude",
            e.fromId,
            e.fromName ?? "",
            e.toId,
            e.toName ?? "",
            Number(e.amount ?? 0),
            e.message ?? "",
            e.contextType ?? null,
            e.contextRef ?? null,
            e.cycleId,
            e.cycleNumber ?? null,
            toDb(e.at),
          ],
        );
        return { ok: true, duplicate: false };
      } catch (err: any) {
        if (err?.code === "ER_DUP_ENTRY") return { ok: false, duplicate: true };
        throw err;
      }
    },
  };
}

export interface CyclesRepo {
  all(): Promise<CycleRecord[]>;
  /** Insert or replace by cycleNumber (the unique key a re-run collides on). */
  upsert(rec: CycleRecord): Promise<void>;
}

export function gratitudeCyclesRepo(pool: Pool): CyclesRepo {
  return {
    async all() {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id, cycle_number, starts_at, ends_at, status, closed_at FROM gratitude_cycles ORDER BY cycle_number",
      );
      return rows.map((r) => ({
        id: String(r.id),
        cycleNumber: Number(r.cycle_number),
        startsAt: toIso(r.starts_at),
        endsAt: toIso(r.ends_at),
        status: String(r.status) as CycleRecord["status"],
        closedAt: r.closed_at ? toIso(r.closed_at) : undefined,
      }));
    },

    async upsert(rec) {
      await pool.query(
        "INSERT INTO gratitude_cycles (id, cycle_number, starts_at, ends_at, status, closed_at) VALUES (?,?,?,?,?,?) " +
          "ON DUPLICATE KEY UPDATE status=VALUES(status), closed_at=VALUES(closed_at)",
        [rec.id, rec.cycleNumber, toDb(rec.startsAt), toDb(rec.endsAt), rec.status, toDb(rec.closedAt ?? null)],
      );
    },
  };
}

export interface DistributionsRepo {
  all(): Promise<DistributionRecord[]>;
  /** Idempotent on (cycleId, userId): a re-run of close updates, never doubles. */
  add(rec: DistributionRecord): Promise<void>;
}

export function gratitudeDistributionsRepo(pool: Pool): DistributionsRepo {
  return {
    async all() {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id, cycle_id, user_id, received, received_hearts, received_acks, distinct_senders, credited, pool_token, created_at " +
          "FROM gratitude_distributions ORDER BY created_at, id",
      );
      return rows.map((r) => ({
        id: String(r.id),
        cycleId: String(r.cycle_id),
        userId: String(r.user_id),
        received: Number(r.received ?? 0),
        receivedHearts: Number(r.received_hearts ?? 0),
        receivedAcks: Number(r.received_acks ?? 0),
        distinctSenders: Number(r.distinct_senders ?? 0),
        credited: Number(r.credited ?? 0),
        poolToken: r.pool_token ?? null,
        createdAt: toIso(r.created_at),
      })) as DistributionRecord[];
    },

    async add(rec) {
      // Add-if-absent ON PURPOSE: the settlement basis is sticky. A retried
      // cycle close recomputes its split from live data that has drifted, and
      // updating these columns would let the report rows diverge from the
      // ledger legs already posted under the first split's amounts. The first
      // persisted split is the story, forever.
      await pool.query(
        "INSERT INTO gratitude_distributions (id, cycle_id, user_id, received, received_hearts, received_acks, distinct_senders, credited, pool_token, created_at) " +
          "VALUES (?,?,?,?,?,?,?,?,?,COALESCE(?, CURRENT_TIMESTAMP)) " +
          "ON DUPLICATE KEY UPDATE id=id",
        [
          rec.id,
          rec.cycleId,
          rec.userId,
          Number(rec.received ?? 0),
          Number((rec as any).receivedHearts ?? 0),
          Number((rec as any).receivedAcks ?? 0),
          Number(rec.distinctSenders ?? 0),
          Number((rec as any).credited ?? 0),
          (rec as any).poolToken ?? null,
          toDb((rec as any).createdAt),
        ],
      );
    },
  };
}
