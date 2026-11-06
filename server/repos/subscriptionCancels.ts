/**
 * The audit rows that carry what a departed member's recurring payments still
 * owe: a cancel nobody could make, and the cancel that later settled it.
 *
 *   member:subscriptions-cancel-by-hand:<n>:<ids>   a person must cancel these
 *   member:subscriptions-cancelled:<n>:<ids>        these are cancelled
 *
 * Both are `kind = 'audit'`, `entity_type = 'user'`, `entity_ref` the
 * tombstone's id, `audience = 'admin'`. The obligation is DERIVED from them
 * (server/lib/owedCancels.ts): a subscription id is still owed while the
 * newest row naming it is a by-hand one. Nothing else records it, and the
 * erasure record's `steps_done` is left as it is.
 *
 * WRITTEN THROUGH `recordEvent` WITH `throwOnFailure`. By default that
 * writer swallows a failed insert, which is right for a log line and wrong for an
 * obligation: a by-hand row that silently failed to land is a cancel nobody
 * will ever be asked for. This one throws, so the erasure step stops and is
 * resumed, and a webhook is redelivered.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { recordEvent } from "../lib/events";

export const CANCEL_BY_HAND = "member:subscriptions-cancel-by-hand:";
export const CANCELLED = "member:subscriptions-cancelled:";

/** One row, as the derivation reads it. */
export interface SubscriptionCancelRow {
  id: string;
  /** The tombstone's id. */
  userId: string;
  kind: "by-hand" | "cancelled";
  subscriptionIds: string[];
  /** Who wrote it: the erasure's actor, the person who confirmed, or null for the webhook and the hourly job. */
  actorUserId: string | null;
  at: string;
}

/** Write one row. Throws on a failed insert, on purpose (see the header). */
export async function recordSubscriptionCancels(
  pool: Pool,
  row: { userId: string; kind: "by-hand" | "cancelled"; subscriptionIds: readonly string[]; actorUserId: string | null },
): Promise<void> {
  const ids = Array.from(new Set(row.subscriptionIds.map(String).filter(Boolean)));
  if (!ids.length) return;
  const text = `${row.kind === "by-hand" ? CANCEL_BY_HAND : CANCELLED}${ids.length}:${ids.join(",")}`;
  await recordEvent(pool, {
    kind: "audit",
    text,
    actorUserId: row.actorUserId,
    entityType: "user",
    entityRef: row.userId,
    audience: "admin",
  }, { throwOnFailure: true });
}

/** Parse one row's text, or null for a line that is not one of the two. */
export function parseSubscriptionCancelText(text: string): Pick<SubscriptionCancelRow, "kind" | "subscriptionIds"> | null {
  const kind = text.startsWith(CANCEL_BY_HAND) ? "by-hand" : text.startsWith(CANCELLED) ? "cancelled" : null;
  if (!kind) return null;
  const rest = text.slice(kind === "by-hand" ? CANCEL_BY_HAND.length : CANCELLED.length);
  const colon = rest.indexOf(":");
  if (colon < 0) return null;
  const subscriptionIds = rest.slice(colon + 1).split(",").map((s) => s.trim()).filter(Boolean);
  return { kind, subscriptionIds };
}

/** Every such row in the village, oldest first. */
export async function subscriptionCancelRows(pool: Pool): Promise<SubscriptionCancelRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, text, entity_ref, actor_user_id, at FROM health_events " +
      "WHERE kind = 'audit' AND audience = 'admin' AND entity_type = 'user' AND (text LIKE ? OR text LIKE ?) " +
      "ORDER BY at, id",
    [`${CANCEL_BY_HAND}%`, `${CANCELLED}%`],
  );
  const out: SubscriptionCancelRow[] = [];
  for (const r of rows) {
    const parsed = parseSubscriptionCancelText(String(r.text));
    if (!parsed || !r.entity_ref) continue;
    out.push({
      id: String(r.id),
      userId: String(r.entity_ref),
      ...parsed,
      actorUserId: r.actor_user_id == null ? null : String(r.actor_user_id),
      at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    });
  }
  return out;
}
