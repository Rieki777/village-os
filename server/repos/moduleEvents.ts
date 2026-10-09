/**
 * `module_events`: the trail every module setting change leaves, read back.
 *
 * `setModuleLifecycle` (server/lib/modules.ts) writes one `lifecycle` row per
 * change, carrying where the module stood before (`from_value`) and where it
 * went (`to_value`). Until now nothing read it. The canvas's funding moment
 * does (server/lib/canvasRevisit.ts): governance reaching members, or the
 * crowdpool leaving off, is a crossing, and only the row the write itself
 * left can say which side the module was on before.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface LifecycleMove {
  from: string;
  to: string;
}

/** The newest lifecycle change recorded for one module, or null when it never moved. */
export async function latestLifecycleMove(pool: Pool, moduleId: string): Promise<LifecycleMove | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT from_value, to_value FROM module_events WHERE module_id = ? AND kind = 'lifecycle' " +
      // `at` is a whole second, and two moves can share one. The id is
      // `mev-<milliseconds>-<random>` (setModuleLifecycle), so it breaks the tie
      // in the order the writes happened.
      "ORDER BY at DESC, id DESC LIMIT 1",
    [moduleId],
  );
  const r = rows[0];
  if (!r) return null;
  return { from: String(r.from_value ?? "off"), to: String(r.to_value ?? "off") };
}
