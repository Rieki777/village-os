/**
 * `ballots.seat_term_*` (0199): the term a seat vote gives, frozen when it opens.
 *
 * A seat vote freezes its term the way every ballot freezes its electorate and
 * its thresholds: what the village voted on is what lands. The rules that
 * decide the term are in shared/seatTerms.ts and the close that reads it back is
 * `termForCarriedSeat` in server/lib/seatTermLanding.ts. This file holds the two
 * statements and nothing else, so "where does a seat vote's term live" is one
 * file to open.
 *
 * `freezeSeatTerm` takes the CONNECTION, because it runs inside `openBallot`'s
 * transaction through `onOpen`: a seat vote that exists without its term, even
 * for a moment, is a vote the closer would have to guess about.
 *
 * `seat_term_ends_at` is `datetime`, so it is bound as a Date and read back as
 * the driver made it (mysql2 under `timezone: "Z"`), the way
 * server/repos/permissionHoldings.ts reads its term.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export interface FrozenSeatTerm {
  endsAt: Date;
  seasonId: string | null;
  followsSeason: boolean;
}

export async function freezeSeatTerm(conn: PoolConnection, ballotId: string, term: FrozenSeatTerm): Promise<void> {
  await conn.query(
    "UPDATE ballots SET seat_term_ends_at = ?, seat_term_season_id = ?, seat_term_follows_season = ? WHERE id = ?",
    [term.endsAt, term.seasonId, term.followsSeason ? 1 : 0, ballotId],
  );
}

/** The frozen term, or null for a ballot that carries none. */
export async function frozenSeatTerm(pool: Pool, ballotId: string): Promise<FrozenSeatTerm | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seat_term_ends_at, seat_term_season_id, seat_term_follows_season FROM ballots WHERE id = ?",
    [ballotId],
  );
  const r = rows[0];
  if (!r || !r.seat_term_ends_at) return null;
  const endsAt = r.seat_term_ends_at instanceof Date ? r.seat_term_ends_at : new Date(`${String(r.seat_term_ends_at).replace(" ", "T")}Z`);
  if (Number.isNaN(endsAt.getTime())) return null;
  return {
    endsAt,
    seasonId: r.seat_term_season_id ? String(r.seat_term_season_id) : null,
    followsSeason: Number(r.seat_term_follows_season) === 1,
  };
}
