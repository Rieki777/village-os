/**
 * THE DAILY EMAIL CAP DOES NOT SWALLOW A SEASON-END REMINDER, against the real
 * notifications table.
 *
 * `insertNotification` drops an immediate email once a member has had
 * `notify.daily_email_cap` emails in 24 hours. The in-app row always lands, so
 * the cap only ever costs the email, and on the busiest day of a member's week
 * that email is the one telling them the season turns and seats need filling.
 * `clearsDailyEmailCap` in server/lib/notify.ts exempts it. This proves the
 * exemption does what it says and, with two controls, that an ordinary
 * governance email over the cap is still dropped and under it is still sent,
 * so the headline test cannot pass against a build where the cap never fired.
 *
 * It also proves the sweep lands once per member per mark against the real
 * unique index on `dedupe_key`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { DAILY_EMAIL_CAP, insertNotification, type NotifyDeps } from "./lib/notify";
import { numberVar } from "./lib/variables";
import { runSeasonReminders } from "./lib/seasonReminders";
import { presenceTest } from "./lib/memberPresence";

/** The host's bound presence predicate, as server/index.ts hands it in. */
const isPresent = presenceTest("season-reminders-db-test-secret");

const configured = testDbConfigured();
if (!configured) {
  console.warn("[seasonReminders.db] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

let db: TestDb;
let pool: mysql.Pool;

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, as every DB suite holds
});

afterAll(async () => {
  if (!configured) return;
  await pool?.end();
  await db?.drop();
});

/** The ceiling `underDailyCap` reads, read the same way. */
const cap = () => Math.max(1, numberVar("notify.daily_email_cap") || DAILY_EMAIL_CAP);

function deps(sent: string[], prefs: unknown): NotifyDeps {
  return {
    pool,
    memberById: async (id: string) => ({ id, email: `${id}@example.test`, passwordHash: "hash", prefs }),
    sendEmail: async (o) => {
      sent.push(o.subject);
    },
    origin: () => "https://example.test",
    projectName: () => "Test village",
    isPresent,
  };
}

/** Stamp a full day's worth of emails on a member, so the cap is reached. */
async function fillTheCap(userId: string) {
  for (let i = 0; i < cap(); i += 1) {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO notifications (id, user_id, type, title, dedupe_key, emailed_at) VALUES (?,?,?,?,?, CURRENT_TIMESTAMP)",
      [`ntf-fill-${userId}-${i}`, userId, "message", "An earlier email", `fill:${userId}:${i}`],
    );
  }
}

const immediate = { notify: { governanceEmail: "immediate" } };

describe.skipIf(!configured)("the daily cap and the season-end reminder", () => {
  it("CONTROL: an ordinary governance email over the cap is dropped, and the row still lands", async () => {
    await fillTheCap("u-busy");
    const sent: string[] = [];
    const r = await insertNotification(deps(sent, immediate), {
      userId: "u-busy",
      type: "ballot_opened",
      title: "A vote opened",
      dedupeKey: "ctl:over-cap:u-busy",
    });
    expect(r.fresh, "the in-app row is never capped").toBe(true);
    expect(sent, "the cap fired, which is what makes the next test mean something").toEqual([]);
  });

  it("CONTROL: the same email under the cap is sent", async () => {
    const sent: string[] = [];
    await insertNotification(deps(sent, immediate), {
      userId: "u-quiet",
      type: "ballot_opened",
      title: "A vote opened",
      dedupeKey: "ctl:under-cap:u-quiet",
    });
    expect(sent).toEqual(["A vote opened"]);
  });

  it("emails the season-end reminder to a member already over the cap", async () => {
    const sent: string[] = [];
    const r = await insertNotification(deps(sent, immediate), {
      userId: "u-busy",
      type: "season_ending",
      title: "Spring turns in 7 days, on 1 October 2026",
      dedupeKey: "season-ending:spring-2026:2026-10-01:7:u-busy",
    });
    expect(r.fresh).toBe(true);
    expect(sent).toEqual(["Spring turns in 7 days, on 1 October 2026"]);
  });

  it("still honours a member who turned all mail off", async () => {
    const sent: string[] = [];
    await insertNotification(deps(sent, { notify: { emailsOff: true } }), {
      userId: "u-busy",
      type: "season_ending",
      title: "Spring turns in 3 days, on 1 October 2026",
      dedupeKey: "season-ending:spring-2026:2026-10-01:3:u-busy",
    });
    expect(sent).toEqual([]);
  });

  it("lands once per member per mark against the real unique index", async () => {
    const quiet = { notify: { emailsOff: true } };
    const notify = (input: Parameters<typeof insertNotification>[1]) => insertNotification(deps([], quiet), input);
    const members = [
      { id: "u-sweep-a", passwordHash: "h", role: "member" },
      { id: "u-sweep-b", passwordHash: "h", role: "admin" },
      { id: "u-sweep-example", passwordHash: "", role: "member", isExample: true },
    ];
    const season = { current: { id: "spring-2026", name: "Spring", endsOn: "2026-10-01" }, today: "2026-09-17" };
    const isAdmin = (u: Record<string, any>) => u.role === "admin" || u.role === "founder";

    const first = await runSeasonReminders({ season, members, isPresent, isAdmin, notify });
    const second = await runSeasonReminders({ season, members, isPresent, isAdmin, notify });
    expect(first).toMatchObject({ recipients: 2, told: 2 });
    expect(second.told, "a second sweep inserts nothing").toBe(0);

    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT user_id, link FROM notifications WHERE dedupe_key LIKE 'season-ending:spring-2026:2026-10-01:14:u-sweep-%' ORDER BY user_id",
    );
    expect(rows.map((r) => [r.user_id, r.link])).toEqual([
      ["u-sweep-a", "/seasonal-festivals"],
      ["u-sweep-b", "/admin?tab=seasons-patterns"],
    ]);
  });
});
