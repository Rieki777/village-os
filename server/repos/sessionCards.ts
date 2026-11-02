/**
 * Every statement against `session_cards` and `session_card_lines` (drizzle/0296).
 *
 * A card lasts as long as its session: `clearClosedCards` deletes the cards of
 * every closed or discarded session with their lines, a member's erasure
 * deletes every card that named them (`forgetCardsNaming`), and a card that
 * read somebody who has since withdrawn is deleted (`forgetCardsReading`).
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type Queryable = Pool | PoolConnection;

export interface CardRow {
  id: number;
  sessionId: number;
  n: number;
  pulledBy: string;
  /** The stored JSON, parsed. Shape-checked by the lib before it is trusted. */
  sky: unknown;
  reading: unknown;
  createdAt: string;
}

export interface CardLineRow {
  cardId: number;
  userId: string;
  line: string | null;
  shared: boolean;
}

const parse = (text: unknown): unknown => {
  try {
    return JSON.parse(String(text ?? "null"));
  } catch {
    return null;
  }
};

const toCard = (r: RowDataPacket): CardRow => ({
  id: Number(r.id),
  sessionId: Number(r.session_id),
  n: Number(r.n),
  pulledBy: String(r.pulled_by),
  sky: parse(r.sky),
  reading: parse(r.reading),
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date(0).toISOString(),
});

/** A session's cards, first pulled first. */
export async function cardsOf(q: Queryable, sessionId: number): Promise<CardRow[]> {
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT `id`, `session_id`, `n`, `pulled_by`, `sky`, `reading`, `created_at` FROM `session_cards` WHERE `session_id` = ? ORDER BY `n`",
    [sessionId],
  );
  return rows.map(toCard);
}

/** The lines of the given cards, every person present on each. */
export async function linesOf(q: Queryable, cardIds: readonly number[]): Promise<CardLineRow[]> {
  if (!cardIds.length) return [];
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT `card_id`, `user_id`, `line`, `shared` FROM `session_card_lines` WHERE `card_id` IN (?)",
    [[...cardIds]],
  );
  return rows.map((r) => ({ cardId: Number(r.card_id), userId: String(r.user_id), line: r.line == null ? null : String(r.line), shared: Number(r.shared) === 1 }));
}

/**
 * How many cards a session holds, the highest number among them, and when the
 * last was pulled (ms). The caller holds the session row's lock. A new card
 * takes `maxN + 1`, never `count + 1`: a card taken back mid-session (somebody
 * it read withdrew, or was erased) leaves a gap, and counting would hand the
 * next card a number a surviving card still holds.
 */
export async function cardCount(q: Queryable, sessionId: number): Promise<{ count: number; maxN: number; lastAt: number | null }> {
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS `c`, COALESCE(MAX(`n`), 0) AS `max_n`, MAX(`created_at`) AS `last` FROM `session_cards` WHERE `session_id` = ?",
    [sessionId],
  );
  const last = rows[0]?.last;
  return { count: Number(rows[0]?.c ?? 0), maxN: Number(rows[0]?.max_n ?? 0), lastAt: last ? new Date(last).getTime() : null };
}

export interface CardWrite {
  sessionId: number;
  n: number;
  pulledBy: string;
  sky: unknown;
  reading: unknown;
  /** One per person present: their line, or null for somebody welcomed and not read. */
  lines: { userId: string; line: string | null }[];
}

/** The card and its lines, inside the caller's transaction. Returns the card's id. */
export async function insertCard(conn: PoolConnection, w: CardWrite): Promise<number> {
  const [r] = await conn.query<ResultSetHeader>(
    "INSERT INTO `session_cards` (`session_id`, `n`, `pulled_by`, `sky`, `reading`) VALUES (?, ?, ?, ?, ?)",
    [w.sessionId, w.n, w.pulledBy, JSON.stringify(w.sky), JSON.stringify(w.reading)],
  );
  const id = Number(r.insertId);
  if (w.lines.length) {
    await conn.query("INSERT INTO `session_card_lines` (`card_id`, `user_id`, `line`) VALUES ?", [w.lines.map((l) => [id, l.userId, l.line])]);
  }
  return id;
}

/** Share or unshare one person's own line on one card. Returns whether they have a line there. */
export async function setLineShared(q: Queryable, cardId: number, userId: string, shared: boolean): Promise<boolean> {
  const [r] = await q.query<ResultSetHeader>(
    "UPDATE `session_card_lines` SET `shared` = ? WHERE `card_id` = ? AND `user_id` = ? AND `line` IS NOT NULL",
    [shared ? 1 : 0, cardId, userId],
  );
  return Number(r.affectedRows ?? 0) > 0;
}

/** One card, by id, for the share door's check that it belongs to the session asked about. */
export async function cardById(q: Queryable, cardId: number): Promise<CardRow | null> {
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT `id`, `session_id`, `n`, `pulled_by`, `sky`, `reading`, `created_at` FROM `session_cards` WHERE `id` = ? LIMIT 1",
    [cardId],
  );
  return rows[0] ? toCard(rows[0]) : null;
}

async function deleteCards(q: Queryable, ids: readonly number[]): Promise<number> {
  if (!ids.length) return 0;
  await q.query("DELETE FROM `session_card_lines` WHERE `card_id` IN (?)", [[...ids]]);
  const [r] = await q.query<ResultSetHeader>("DELETE FROM `session_cards` WHERE `id` IN (?)", [[...ids]]);
  return Number(r.affectedRows ?? 0);
}

/**
 * Delete the cards, with their lines, of every session that has closed or is
 * gone. A discarded session's row is deleted outright (`discardSession`), so
 * the join is a LEFT JOIN: a card whose session no longer exists goes too.
 * Returns how many cards went.
 */
export async function clearClosedCards(q: Queryable): Promise<number> {
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT c.`id` FROM `session_cards` c LEFT JOIN `live_sessions` s ON s.`id` = c.`session_id` WHERE s.`id` IS NULL OR s.`status` = 'closed' LIMIT 500",
  );
  return deleteCards(q, rows.map((r) => Number(r.id)));
}

/** Delete every card that READ any of these members (they have a line on it), with all its lines. Returns how many cards went. */
export async function forgetCardsReading(q: Queryable, userIds: readonly string[]): Promise<number> {
  if (!userIds.length) return 0;
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT DISTINCT `card_id` FROM `session_card_lines` WHERE `user_id` IN (?) AND `line` IS NOT NULL",
    [[...userIds]],
  );
  return deleteCards(q, rows.map((r) => Number(r.card_id)));
}

/** How many cards still name this member: a line row for them, or pulled by them. Erasure's read back. */
export async function cardsNamingCount(q: Queryable, userId: string): Promise<number> {
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS `n` FROM (SELECT `card_id` FROM `session_card_lines` WHERE `user_id` = ? UNION SELECT `id` FROM `session_cards` WHERE `pulled_by` = ?) AS `naming`",
    [userId, userId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Delete every card that named this member, present or read, with all its lines. Returns how many cards went. */
export async function forgetCardsNaming(q: Queryable, userId: string): Promise<number> {
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT DISTINCT `card_id` FROM `session_card_lines` WHERE `user_id` = ? UNION SELECT `id` FROM `session_cards` WHERE `pulled_by` = ?",
    [userId, userId],
  );
  return deleteCards(q, rows.map((r) => Number(r.card_id)));
}
