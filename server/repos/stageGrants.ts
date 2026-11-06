/**
 * WHO LAST SET EACH MEMBER'S STAGE, AND WHEN, read off the audit trail.
 *
 * Nothing new is written for this. Every successful mutation under /api/admin
 * already leaves an audit row naming the admin (the `app.use("/api/admin")`
 * hook in server/index.ts), and a stage grant is `PUT /api/admin/players/:id/stage`.
 * So every grant ever made, the bulk ones included, is already here, and the
 * Players card can say "Set by Rye on Oct 26" for grants made before this file
 * existed.
 *
 * The row does not carry WHICH stage was set, and it does not need to: the
 * member's current grant is on their record and the card already shows it.
 * This answers only the two things the record cannot, who and when.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface StageSetNote {
  at: string;
  actorUserId: string | null;
}

const STAGE_PUT = /^PUT \/api\/admin\/players\/([^/]+)\/stage$/;

/** The latest stage change per member, for the whole village in ONE query. */
export async function latestStageSets(pool: Pool): Promise<Map<string, StageSetNote>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT text, actor_user_id, at FROM health_events " +
      "WHERE kind = 'audit' AND audience = 'admin' AND is_example = 0 AND text LIKE 'PUT /api/admin/players/%/stage' " +
      "ORDER BY at, id",
  );
  const out = new Map<string, StageSetNote>();
  for (const r of rows) {
    const id = STAGE_PUT.exec(String(r.text))?.[1];
    if (!id) continue;
    const at = r.at instanceof Date ? r.at.toISOString() : String(r.at);
    out.set(decodeURIComponent(id), { at, actorUserId: r.actor_user_id == null ? null : String(r.actor_user_id) });
  }
  return out;
}
