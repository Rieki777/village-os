/**
 * THE LOVE LETTER SIGNINGS, READ BY ID (seat settings PR9).
 *
 * A signing is a `submissions` row of type `membership-508`, written and
 * cached by the collection server/index.ts keeps over that table. This file
 * READS those rows and never writes one: a write here would go round the
 * collection's cache and its version counter (server/repos/store-db.ts).
 *
 * One reader today: a member's own membership letter in the alignment store
 * says what the village has done with the signing it came from, the same three
 * answers the journey section always gave (shared/membershipSigning.ts).
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { SIGNING_TYPE } from "../../shared/membershipSigning";

type Db = Pool | PoolConnection;

/** The pipeline status of each named signing, by id. A signing that is not there is absent. */
export async function signingStatuses(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, status FROM submissions WHERE type = ? AND id IN (${ids.map(() => "?").join(",")})`,
    [SIGNING_TYPE, ...ids],
  );
  for (const r of rows as any[]) out.set(String(r.id), String(r.status ?? ""));
  return out;
}
