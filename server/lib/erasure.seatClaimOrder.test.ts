/**
 * A SEAT CLAIM'S RECORDED NAME, READ BY THE SEAT JOURNAL BEFORE IT GOES.
 *
 * Two lanes meet here. The seats lane (#622) finds the journal lines that
 * quote the name a seating was recorded under in four ways, and the third is
 * the recorded name on each seat claim the member filed
 * (server/repos/orgSeatErasure.ts). The submissions lane (#623) takes every
 * value off a member's submissions that `KEPT_BY_TYPE` does not list, in the
 * "submissions" step before the tombstone and again in
 * "submission-words-after-tombstone". Both of those run before the journal is
 * read ("org-seatings", "seat-journal-after-tombstone"), so composed, the
 * claims the journal reads carry no name and the third way finds nothing.
 *
 * The cases are the ones only a claim can answer: a member whose seating was
 * re-recorded on the chart after a steward confirmed them, so the seating no
 * longer carries the name the confirm line quotes, and an erasure that
 * finished before the journal steps existed, whose seatings gave up their
 * names long ago. Each also holds the other guarantee: every seat claim of
 * the member, open or answered, ends with no recorded name.
 *
 * A neighbour on the same seat keeps every line. No TEST_DATABASE_URL and the
 * suite skips (harness rule).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { BACKFILL_LEAVES_OUT, anonymizeMember, backfillFinishedErasures, sweepStepNames, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { recordEvent } from "./events";
import { claimSeating, releaseSeatingsForUser, seatHolder } from "./orgChart";
import { loadTokenRegistry } from "./ledger";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";

const configured = testDbConfigured();
const ANON = "A departed member";
const REMOVED = "[removed at member's request]";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";
/** The submissions store, as the erasure's singleton holds it. */
let submissions: any[] = [];

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: {
      byId: (id: string) => real.byId(id),
      update: (id: string, fn: (u: any) => void, how?: { erasure?: boolean }) => real.update(id, fn, how),
    },
    submissionsRepo: {
      all: () => submissions,
      replaceAll: async (rows: unknown[]) => {
        submissions = rows as any[];
      },
    },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
    notify: async () => ({ fresh: true }),
  };
}

async function person(id: string, name: string): Promise<void> {
  await usersRepo(pool).add({ id, name, email: `${id}@example.test`, passwordHash: "x", paths: [] });
}

/** One seat on the chart, with one documented holder on it. */
async function seat(roleId: string, recordedName: string): Promise<string> {
  await q("INSERT IGNORE INTO `org_roles` (`id`, `name`, `aim`, `seats`) VALUES (?, ?, 'Keep it running.', 3)", [roleId, `${roleId} role`]);
  const made = await seatHolder(pool, roleId, { displayName: recordedName });
  expect(made.ok, made.reason).toBe(true);
  return String(made.assignmentId);
}

/** A journal line as the routes wrote it before they stopped writing names. */
async function line(roleId: string, text: string, actorUserId: string | null): Promise<void> {
  await recordEvent(pool, { kind: "role", text, actorUserId, entityType: "org_role", entityRef: roleId, audience: "admin" });
}

async function journalOf(roleId: string): Promise<string[]> {
  return (await q("SELECT `text` FROM `health_events` WHERE `entity_type` = 'org_role' AND `entity_ref` = ? ORDER BY `text`", [roleId])).map((r) =>
    String(r.text),
  );
}

/** A seat claim as POST /api/org/seatings/:id/claim writes it (server/routes/org.ts). */
function claim(id: string, userId: string, accountName: string, roleId: string, assignmentId: string, recordedName: string, status: string): any {
  return {
    id,
    type: "seat-claim",
    status,
    rewarded: false,
    data: { assignmentId, roleId, roleName: `${roleId} role`, recordedName, name: accountName, email: `${userId}@example.test` },
    userId,
    userName: accountName,
    submittedAt: "2026-10-19T09:00:00.000Z",
  };
}

describe.skipIf(!configured)("a seat claim's recorded name, read by the seat journal before it goes", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-seat-claims-"));
    await loadTokenRegistry(pool);
    await person("sc-steward", "Sam Steward");
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  beforeEach(() => {
    clearMemberDrivers();
    submissions = [];
  });

  it("takes a confirmed claim's recorded name out of the journal when the chart no longer carries it, and off every claim of theirs", async () => {
    await person("sc-wren", "Wren Halloway");
    await person("sc-ash", "Ash Grey");
    // Recorded under the name the village knew them by, which is not their account's.
    const water = await seat("sc-water", "Wren Alder");
    submissions.push(claim("sc-claim-water", "sc-wren", "Wren Halloway", "sc-water", water, "Wren Alder", "accepted"));
    await line("sc-water", 'confirmed: the holder recorded "Wren Alder" is a member here', "sc-steward");
    expect(await claimSeating(pool, water, "sc-wren")).toBe(true);
    // Re-recorded on the chart since, so the seating no longer says the name the confirm quotes.
    await q("UPDATE org_role_assignments SET display_name = 'Wren H.' WHERE id = ?", [water]);
    // An open claim of theirs on another seat, and a neighbour's line on the same seat.
    const fire = await seat("sc-fire", "W. Alder");
    submissions.push(claim("sc-claim-fire", "sc-wren", "Wren Halloway", "sc-fire", fire, "W. Alder", "new"));
    await line("sc-water", 'confirmed: the holder recorded "Ash Grey" is a member here', "sc-steward");
    expect((await journalOf("sc-water")).filter((t) => t.includes("Wren Alder")), "the fixture must put the name there").toHaveLength(1);

    await anonymizeMember(pool, await usersRepo(pool).byId("sc-wren"), "sc-steward", deps());
    expect((await erasureRecord(pool, "sc-wren"))?.finishedAt, "the sweep must finish").toBeTruthy();

    const after = await journalOf("sc-water");
    for (const text of after) expect(text, "no journal line still quotes the recorded name").not.toContain("Alder");
    expect(after, "a neighbour's line on the same seat is untouched").toContain('confirmed: the holder recorded "Ash Grey" is a member here');
    expect(after, "every line is still there").toHaveLength(2);
    for (const c of submissions.filter((s) => s.userId === "sc-wren")) {
      expect(c.data.recordedName, `${c.id} loses its recorded name`).toBe(REMOVED);
      expect(["accepted", "declined"], `${c.id} is closed`).toContain(c.status);
    }
  });

  it("gives an erasure that finished before the journal steps the recorded name its claim kept, and then takes it off the claim", async () => {
    await person("sc-old", "Rowan Pike");
    // Recorded under a name that is not their account's, and confirmed.
    const earth = await seat("sc-earth", "Rowan Ashby");
    await line("sc-earth", 'confirmed: the holder recorded "Rowan Ashby" is a member here', "sc-steward");
    expect(await claimSeating(pool, earth, "sc-old")).toBe(true);
    await line("sc-earth", 'confirmed: the holder recorded "Ash Grey" is a member here', "sc-steward");
    // What an erasure on main before the journal steps left: the seatings released with their names,
    // the claim's name and address scrubbed and its recorded name kept, and the tombstone written.
    await releaseSeatingsForUser(pool, "sc-old", "member left the village");
    submissions.push({
      ...claim("sc-claim-earth", "sc-old", "Rowan Pike", "sc-earth", earth, "Rowan Ashby", "accepted"),
      userName: ANON,
    });
    submissions[0].data.name = REMOVED;
    submissions[0].data.email = REMOVED;
    await usersRepo(pool).update("sc-old", (u: any) => {
      u.name = ANON;
      u.email = `deleted-${u.id}@anonymized.invalid`;
      u.handle = null;
      u.passwordHash = "";
      u.membershipGranted = false;
    });
    const names = sweepStepNames();
    const ranThen = [...names.slice(0, names.indexOf("tombstone") + 1), ...Object.keys(BACKFILL_LEAVES_OUT)];
    await q(
      "INSERT INTO member_erasures (user_id, started_at, finished_at, attempts, last_attempt_at, steps_done) " +
        "VALUES (?, '2026-10-20 09:00:00', '2026-10-20 09:01:00', 1, '2026-10-20 09:00:00', ?)",
      ["sc-old", JSON.stringify(ranThen)],
    );
    expect((await journalOf("sc-earth")).filter((t) => t.includes("Rowan Ashby")), "the fixture must put the name there").toHaveLength(1);

    expect((await backfillFinishedErasures(pool, deps(), () => undefined)).stopped).toBe(0);

    const after = await journalOf("sc-earth");
    for (const text of after) expect(text, "no journal line still quotes the recorded name").not.toContain("Ashby");
    expect(after, "a neighbour's line on the same seat is untouched").toContain('confirmed: the holder recorded "Ash Grey" is a member here');
    expect(submissions.find((s) => s.id === "sc-claim-earth").data.recordedName, "the claim loses its recorded name").toBe(REMOVED);
  });
});
