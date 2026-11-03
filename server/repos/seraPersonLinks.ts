/**
 * Link to Sera, by hand: every SQL statement the steward's link panel needs.
 * The write itself is `linkSeraPerson` in ./memberTaskImport, the one writer
 * the steward import already uses, so a link made here and a link made by an
 * import are the same row.
 *
 * A member who has left (a tombstone) and the standing examples are never
 * listed and never linked. Owner ids leave this file only as a six-character
 * tail.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { ownerTail, type LinkHow, type MemberLinkRow } from "../../shared/seraPersonLinks";

type Queryable = Pool | PoolConnection;

const TOMBSTONE = "%@anonymized.invalid";
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

/** Every standing member, linked or not, by name. One row each: a member's newest link stands. */
export async function memberLinks(db: Queryable): Promise<MemberLinkRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT u.`id` AS user_id, u.`name` AS name, l.`sera_owner_id` AS owner, l.`how` AS how, l.`created_at` AS linked_at, l.`last_synced_at` AS synced_at " +
      "FROM `users` u LEFT JOIN `sera_person_links` l ON l.`user_id` = u.`id` " +
      "AND l.`updated_at` = (SELECT MAX(x.`updated_at`) FROM `sera_person_links` x WHERE x.`user_id` = u.`id`) " +
      "WHERE u.`is_example` = 0 AND u.`email` NOT LIKE ? ORDER BY u.`name`, u.`id` LIMIT 1000",
    [TOMBSTONE],
  );
  const seen = new Set<string>();
  const out: MemberLinkRow[] = [];
  for (const r of rows) {
    const userId = String(r.user_id);
    if (seen.has(userId)) continue;
    seen.add(userId);
    const owner = r.owner == null ? null : String(r.owner);
    out.push({
      userId,
      name: String(r.name ?? ""),
      ownerTail: owner ? ownerTail(owner) : null,
      how: owner ? ((r.how === "email" ? "email" : "steward") as LinkHow) : null,
      linkedAt: owner ? iso(r.linked_at) : null,
      lastSyncedAt: owner ? iso(r.synced_at) : null,
    });
  }
  return out;
}

/** The member a link may be written for, or why not. */
export async function linkableMember(db: Queryable, userId: string): Promise<{ ok: true; name: string } | { ok: false; why: "unknown" | "departed" | "example" }> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `name`, `email`, `is_example` FROM `users` WHERE `id` = ? LIMIT 1", [userId]);
  if (!rows.length) return { ok: false, why: "unknown" };
  const r = rows[0];
  if (String(r.email ?? "").toLowerCase().endsWith("@anonymized.invalid")) return { ok: false, why: "departed" };
  if (Number(r.is_example) === 1) return { ok: false, why: "example" };
  return { ok: true, name: String(r.name ?? "") };
}

export async function memberName(db: Queryable, userId: string): Promise<string> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `name` FROM `users` WHERE `id` = ? LIMIT 1", [userId]);
  return rows.length ? String(rows[0].name ?? "") : "";
}

/** Remove every link a member holds, so a relink never leaves a second library person behind. */
export async function unlinkMember(db: Queryable, userId: string): Promise<number> {
  const [r] = await db.query("DELETE FROM `sera_person_links` WHERE `user_id` = ?", [userId]);
  return Number((r as { affectedRows?: number }).affectedRows ?? 0);
}
