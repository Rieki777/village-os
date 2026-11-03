/**
 * The bridge board's reading: counts only, never a title, a note, or a person.
 * A table that is not in this database yet answers "not ready", never an error,
 * so the board can say "Building" while another change is still landing.
 */
import type { Pool } from "mysql2/promise";
import type { BridgeAnswer } from "@shared/seraBridgeBoard";
import { notesRelease, outboxCounts } from "./memberTaskFeedback";

type Row = Record<string, unknown>;

async function tables(pool: Pool, names: string[]): Promise<Set<string>> {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")})`,
    names,
  );
  return new Set((rows as Row[]).map((r) => String(r.t ?? r.TABLE_NAME)));
}

async function one(pool: Pool, sql: string, args: unknown[] = []): Promise<Row> {
  const [rows] = await pool.query(sql, args);
  return ((rows as Row[])[0] ?? {}) as Row;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function bridgeLists(pool: Pool, have: Set<string>): Promise<BridgeAnswer["lists"]> {
  const empty = { ready: false, linkedPeople: 0, listsOn: 0, imported: 0, importedOpen: 0, lastBatch: null };
  if (!have.has("member_tasks") || !have.has("member_task_access") || !have.has("sera_person_links")) return empty;
  const linked = await one(pool, "SELECT COUNT(DISTINCT `user_id`) AS n FROM `sera_person_links`");
  const on = await one(pool, "SELECT COUNT(*) AS n FROM `member_task_access` WHERE `list_on` = 1");
  const imp = await one(
    pool,
    "SELECT COUNT(*) AS n, SUM(`status` = 'open') AS o FROM `member_tasks` WHERE `source` = 'sera'",
  );
  const last = await one(
    pool,
    "SELECT `import_batch` AS b, MAX(`created_at`) AS at, COUNT(*) AS n FROM `member_tasks` WHERE `source` = 'sera' AND `import_batch` IS NOT NULL GROUP BY `import_batch` ORDER BY MAX(`created_at`) DESC LIMIT 1",
  );
  const at = last.at instanceof Date ? last.at.toISOString() : last.at ? String(last.at) : null;
  return {
    ready: true,
    linkedPeople: n(linked.n),
    listsOn: n(on.n),
    imported: n(imp.n),
    importedOpen: n(imp.o),
    lastBatch: last.b ? { id: String(last.b), at, tasks: n(last.n) } : null,
  };
}

export async function bridgeFeedback(pool: Pool, have: Set<string>): Promise<BridgeAnswer["feedback"]> {
  const off = { ready: false, sent: 0, queued: 0, failed: 0, notesHeld: 0, notesReleased: null };
  if (!have.has("member_task_outbox") || !have.has("member_task_bridge")) return off;
  // The outbox is what goes to Sera; `member_task_feedback` is what members said.
  const counts = await outboxCounts(pool);
  const sum = (status: string, kind?: string) =>
    Object.entries(counts).reduce((t, [k, v]) => {
      const [kk, ss] = k.split(":");
      return ss === status && (!kind || kk === kind) ? t + v : t;
    }, 0);
  return {
    ready: true,
    sent: sum("sent"),
    queued: sum("queued"),
    failed: sum("failed"),
    notesHeld: sum("held", "note"),
    notesReleased: (await notesRelease(pool)) === "released",
  };
}

export async function bridgeReading(pool: Pool): Promise<Omit<BridgeAnswer, "connection">> {
  const have = await tables(pool, [
    "member_tasks",
    "member_task_access",
    "sera_person_links",
    "member_task_import_queue",
    "member_task_outbox",
    "member_task_bridge",
    "external_proposals",
  ]);
  const lists = await bridgeLists(pool, have);
  const feedback = await bridgeFeedback(pool, have);
  const review = have.has("external_proposals")
    ? n((await one(pool, "SELECT COUNT(*) AS n FROM `external_proposals` WHERE `module_id` = 'saberra' AND `status` = 'proposed'")).n)
    : 0;
  const needsOwner = have.has("member_task_import_queue")
    ? { ready: true, waiting: n((await one(pool, "SELECT COUNT(*) AS n FROM `member_task_import_queue` WHERE `status` = 'waiting'")).n) }
    : { ready: false, waiting: 0 };
  return { lists, feedback, reviewQueue: { waiting: review }, needsOwner };
}
