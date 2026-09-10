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

/**
 * WHICH GRATITUDE ROWS HAVE BEEN UNDONE, written once because two answers to
 * this question is the defect it replaces.
 *
 * A `FROM ... WHERE` fragment binding `g` to `gratitude_log`, so a caller adds
 * its own `SELECT` and its own extra `AND`s and gets the SAME definition of
 * "reversed" that every other caller gets. Two callers today:
 * `allowanceFor` (server/lib/economy.ts) sums what a giver may have back, and
 * `reversedIds` below hands the settlement the ids to leave out. They used to
 * disagree: the allowance refunded a reversed gift and the settlement still
 * paid a pool share on it.
 *
 * ── IT IS ANCHORED ON THE NOTE, NOT ON A KEY PREFIX ─────────────────────────
 *
 * `allowanceFor` matched reversals with `source_ref LIKE 'gratitude.given:%'`,
 * which is the key `give()` writes and NOT the key the acknowledgement door
 * writes (`gratitude_received:<noteId>`, server/lib/gratitude.ts). One door's
 * reversals were therefore invisible to the refund while both doors' gifts
 * were counted in the spend. Walking the three rows — the mirror, the posting
 * it undoes, the note that posting delivered — asks the question the product
 * actually means, and it holds for any key either door writes next.
 *
 * ── AND IT IS DRIVEN FROM THE MIRROR, WHICH IS WHAT KEEPS IT CHEAP ──────────
 *
 * `rev` leads because `token_ledger_source_idx (source)` makes reversals a
 * short list — one correction is rare and a gift is not. From there both hops
 * are index lookups: `token_ledger_idempotency_unique` for the posting, the
 * primary key for the note. Reading it the other way round would probe
 * `source_ref`, which carries no index, once per gift; this runs inside the
 * lock `writeGratitudeRow` holds on every give, so that direction is not
 * available to it. Same reasoning as the uncredited-notes check in
 * server/lib/ledger.ts, which had to solve the identical shape.
 *
 * `rev.source_ref` IS the reversed posting's whole idempotency key: `reverse()`
 * writes it there, clipped at `MAX_SOURCE_REF` (120) only for keys longer than
 * that. Every gratitude key is under 50 characters, and
 * `server/lib/economy.allowance.test.ts` asserts that against a real key both
 * doors wrote rather than trusting this sentence to stay true.
 */
export const REVERSED_GRATITUDE_FROM =
  "FROM `token_ledger` rev " +
  "JOIN `token_ledger` orig ON orig.`idempotency_key` = rev.`source_ref` " +
  "AND orig.`source` IN ('gratitude_received', 'heart_received') " +
  "JOIN `gratitude_log` g ON g.`id` = orig.`source_ref` " +
  "WHERE rev.`source` = 'reversal'";

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
  /**
   * The ids of gratitude rows whose delivery has been reversed.
   *
   * The settlement's missing term. `settleCycle` sums `gratitude_log` and had
   * no idea a gift could be undone, so a reversed gift still counted toward
   * the recipient's `received`, still counted toward `receivedEligible`, and
   * still earned them a share of the cycle's value pool — while the mirror
   * posting had already taken the recognition back out of their balance and
   * `allowanceFor` had already handed the giver their allowance back. The
   * ledger, the allowance and the settlement were three readings of one moon.
   *
   * A SET AND NOT A FILTERED SUM, because the settlement is a pure function
   * over rows it is handed (server/lib/gratitude-cycles.ts) and that is worth
   * keeping: it stays testable with no database, and the preview an admin
   * reads and the close they press go on sharing one implementation.
   *
   * Whole-table, not per cycle. A close settles several finished lunations in
   * one pass and the preview beside it previews all of them, so one read
   * serves the whole loop; the row count here is the number of corrections a
   * village has ever made, which is small by construction.
   */
  reversedIds(): Promise<Set<string>>;
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

    async reversedIds() {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT g.`id` AS id " + REVERSED_GRATITUDE_FROM,
      );
      return new Set(rows.map((r) => String(r.id)));
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
        "SELECT id, cycle_number, starts_at, ends_at, status, closed_at, clock FROM gratitude_cycles ORDER BY cycle_number",
      );
      return rows.map((r) => ({
        id: String(r.id),
        cycleNumber: Number(r.cycle_number),
        startsAt: toIso(r.starts_at),
        endsAt: toIso(r.ends_at),
        status: String(r.status) as CycleRecord["status"],
        closedAt: r.closed_at ? toIso(r.closed_at) : undefined,
        // 0169. A row written before the column existed reads as lunar,
        // which is the only clock any village has ever run.
        clock: String(r.clock ?? "lunar") === "calendar" ? "calendar" : "lunar",
      }));
    },

    async upsert(rec) {
      await pool.query(
        "INSERT INTO gratitude_cycles (id, cycle_number, starts_at, ends_at, status, closed_at, clock) VALUES (?,?,?,?,?,?,?) " +
          "ON DUPLICATE KEY UPDATE status=VALUES(status), closed_at=VALUES(closed_at)",
        // `clock` is written on INSERT and deliberately NOT in the UPDATE
        // list: a cycle records the rhythm it was PLAYED on, and a re-run of
        // close after a village changed its rhythm must not rewrite history.
        [rec.id, rec.cycleNumber, toDb(rec.startsAt), toDb(rec.endsAt), rec.status, toDb(rec.closedAt ?? null), rec.clock ?? "lunar"],
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
