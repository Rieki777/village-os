/**
 * THE SESSION ZONE PIN, IN ONE PLACE, so the app and the tests cannot drift.
 *
 * `server/db/pool.ts` has carried this discipline since the timezone sweep, and
 * it carried it ALONE. Every suite in this repository builds its own pool with
 * `mysql.createPool({ uri, timezone: "Z" })` and no session pin, which
 * `server/db/pool.test.ts` already says out loud in the comment on its control
 * test. So the configuration under test was never the configuration that runs,
 * and the difference is invisible on a UTC database.
 *
 * ── WHY THE DRIVER OPTION IS NOT THE WHOLE JOB ─────────────────────────────
 *
 * `timezone: "Z"` tells mysql2 how to RENDER a JS Date on the way in and how to
 * parse a DATETIME on the way out. It says nothing to the server. `NOW()`,
 * `CURRENT_TIMESTAMP` and `UNIX_TIMESTAMP()` are evaluated by MySQL in the
 * SESSION zone, which without this pin is the server's default.
 *
 * ── WHICH READING IS WRONG, MEASURED RATHER THAN REASONED ──────────────────
 *
 * The first version of this file named the wrong pairing, so here are the three
 * readings with numbers, taken on an unpinned connection whose session sat at
 * UTC-7 (`@@session.time_zone` reporting `SYSTEM`):
 *
 *   NOW() written, read back through the DRIVER     off by 25,201 s
 *   NOW() written, read back with UNIX_TIMESTAMP    off by 1 s
 *   UNIX_TIMESTAMP('2026-02-20 12:00:00')           off by 28,800 s
 *
 * So `UNIX_TIMESTAMP` of a `NOW()`-written column is the REMEDY, not the harm:
 * MySQL evaluates both ends in the session's own frame, so they agree whatever
 * that frame is. What does NOT cancel is a `NOW()`-written value read back
 * through a `timezone: "Z"` driver, which parses the returned wall clock as
 * UTC, and any comparison between such a value and a JS `Date` bound as a true
 * instant. Those are wrong by the host's offset.
 *
 * `UNIX_TIMESTAMP` of a LITERAL is a third case and is session-dependent, since
 * the string is interpreted in the session zone. Note that it read 28,800 in
 * the same run where the live offset was 25,200: **the offset that applies is
 * the one for the DATE BEING READ**, not the one in force today, because
 * February sits the other side of a daylight-saving boundary. So a suite cannot
 * correct for this by measuring the current offset either.
 *
 * ── THE NUMERIC OFFSET, NEVER THE NAME ─────────────────────────────────────
 *
 * `'+00:00'` rather than `'UTC'`, for the reason `server/db/pool.ts` gives: a
 * server without the timezone tables loaded throws on the name, and a throwing
 * init query takes the whole pool down. On a UTC MySQL this is a no-op.
 *
 * ── THE NAME AND THE OFFSET ANSWER DIFFERENT QUESTIONS, AND BOTH MATTER ────
 *
 * `@@session.time_zone` reads `SYSTEM` on both engines this repository runs
 * against unless something pinned it: CI's MySQL 8 reports `SYSTEM` while its
 * host runs UTC, and the local MariaDB reports `SYSTEM` some hours from it.
 *
 * So the NAME answers "did the pin take", and it is the right trigger, because
 * a pin that silently failed on a UTC host does no harm today and is a landmine
 * the day the database moves. The OFFSET, measured with
 * `TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW())`, answers "is it wrong right
 * now", which is what tells a reader whether to hurry. `zoneProblem` asks both
 * and says both, and any test that needs to know reads the number rather than
 * branching on the name.
 */
import type { Pool, PoolConnection } from "mysql2/promise";

/** The offset every connection in this codebase is pinned to. */
export const SESSION_ZONE = "+00:00";

/** The statement that pins it, exported so a guard and a test can name it exactly. */
export const PIN_SESSION_ZONE_SQL = `SET time_zone = '${SESSION_ZONE}'`;

/**
 * Pin every connection this pool opens, and give its errors somewhere to land.
 *
 * Both halves belong to the same hook because both are per-connection hygiene
 * that every pool needs and that no caller remembers. A dropped connection
 * belongs to no awaited query: it happens between requests, the connection
 * emits `error`, and an EventEmitter `error` with no listener THROWS, which in
 * the server reaches the crash handler and exits the process. mysql2 has
 * already discarded the connection and dialled a new one by then, so the event
 * is logged and never alerted.
 *
 * Fire-and-forget on purpose. Awaiting here would mean holding every checkout
 * behind a round trip for a statement that either works or does not, and the
 * one that does not is proven by asking the question back once (`zoneProblem`).
 */
export function pinSessionZone(pool: Pool, label: string): void {
  pool.on("connection", (c: PoolConnection) => {
    c.query(PIN_SESSION_ZONE_SQL);
    c.on("error", (err: any) => {
      console.error(`[${label}] connection dropped, the pool will redial: ${err?.code ?? ""} ${err?.message ?? err}`);
    });
  });
}

/**
 * The sentence to say when the pin did not take, or null when it did.
 *
 * Returned rather than logged, so the app can print it at boot and a test can
 * assert on it without reading console output.
 *
 * THE TRIGGER IS THE NAME, and the offset rides along as context. A pin that
 * failed on a UTC host reads zero seconds out and is still a defect, because
 * the whole point is that the reading stops depending on where the database
 * sits. Triggering on the offset instead would stay quiet on exactly the
 * machine where CI runs and go off later on somebody's laptop.
 */
export async function zoneProblem(pool: Pool): Promise<string | null> {
  try {
    const [rows] = await pool.query<any[]>(
      "SELECT @@session.time_zone AS tz, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offsetSeconds",
    );
    const tz = String(rows?.[0]?.tz ?? "");
    if (tz === SESSION_ZONE) return null;
    const offset = Number(rows?.[0]?.offsetSeconds);
    const bites = Number.isFinite(offset) && offset !== 0
      ? `It currently sits ${offset} seconds from UTC, so the readings are wrong by that much today.`
      : "It happens to sit at UTC today, so nothing reads wrong yet, and that changes the day this database moves.";
    return (
      `SESSION ZONE IS ${tz || "unreadable"}, not ${SESSION_ZONE}. ${bites} ` +
      "Every comparison between a NOW()-written column and this process's clock depends on it, " +
      "silently. Rate limits, job cadence, ballot close times and the mint cap all read it."
    );
  } catch (e: any) {
    return `could not confirm the session zone: ${e?.message ?? e}`;
  }
}
