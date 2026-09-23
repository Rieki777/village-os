/**
 * The one MySQL pool (S6). Every query in the app flows through here so the
 * two disciplines cannot drift:
 *
 *  - `timezone: 'Z'` (plan rule 2.3): the app machine may sit in any zone —
 *    this one is UTC-6 — and mysql2's 'local' default would shift every
 *    stored timestamp, including the lunar boundaries the whole economy
 *    settles on.
 *  - Fail loud, never fall back: a missing DATABASE_URL after the users
 *    domain moved to MySQL is a misconfiguration, not a signal to quietly
 *    reopen the JSON era. Two backends is how a member exists in one and
 *    not the other.
 */
import mysql from "mysql2/promise";
import { pinSessionZone, zoneProblem } from "./sessionZone";

let _pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The users domain lives in MySQL (S6); on Railway it is a reference to the MySQL service, locally it belongs in .env.",
    );
  }
  _pool = mysql.createPool({
    uri: url,
    timezone: "Z",
    connectionLimit: 8,
    // Fail fast when the DB is unreachable rather than queueing forever.
    connectTimeout: 10_000,
  });
  /*
   * The driver half of the timezone discipline was never enough on its own,
   * and the reasoning now lives in `server/db/sessionZone.ts` beside the hook,
   * because the test harness needs the same hook and a second copy of the
   * explanation would drift from the one the tests read.
   *
   * What belongs HERE is which of this server's comparisons rest on it.
   * `timezone: 'Z'` above only tells mysql2 how to render JS Dates and parse
   * DATETIME strings; `NOW()` and `CURRENT_TIMESTAMP` are evaluated in the
   * SESSION zone. Two load-bearing comparisons mixed the two frames: the abuse
   * guard's window (`at > ?` against a JS Date, rows written with
   * CURRENT_TIMESTAMP) and the scheduler's dueness check. Both fail in the
   * unsafe direction, a rate limit that never triggers and hourly jobs firing
   * every tick.
   */
  pinSessionZone(_pool, "pool");
  void verifySessionZone(_pool);
  return _pool;
}

/**
 * SAY IT OUT LOUD IF THE PIN DID NOT TAKE.
 *
 * The `SET time_zone` above is fire-and-forget, and a sweep of `server/**`
 * counted about ten comparisons whose correctness rests entirely on it: the
 * abuse guard's window and the scheduler's dueness check named in the comment
 * above, the ballot close time (`ballots.closes_at`, written by
 * `DATE_ADD(NOW(), …)` and read in JS against `Date.now()`), the per-cycle mint
 * cap (`token_ledger.at` against a JS lunar boundary), agent-token last-use and
 * delivery retries, and the badge expiry checks. None of them can see this
 * file. All of them fail silently and most fail in the unsafe direction.
 *
 * So the query gets asked back. This proves the hook runs and the server
 * accepted the offset, which is the failure that would actually happen (a
 * driver change, a typo, a server refusing the value). It does NOT prove every
 * future connection is pinned; nothing short of asking on every checkout would,
 * and that is a round trip per query for a hook that either works or does not.
 *
 * Logged and never thrown. A village whose database answers everything else
 * correctly should not refuse to boot over a diagnostic, and an exception here
 * would land in an event handler where nothing can catch it.
 *
 * The structural alternative, where it is available, is to stop comparing two
 * clocks at all: `server/lib/base-reads.ts` writes its cache timestamps from a
 * bound `Date` and compares them through `withinFreshWindow`, so that pair is
 * correct whatever this query does.
 */
async function verifySessionZone(pool: mysql.Pool): Promise<void> {
  const problem = await zoneProblem(pool);
  if (problem) console.error(`[pool] ${problem}`);
}

/** For tests and graceful shutdown. */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
