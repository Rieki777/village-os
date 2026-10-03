/**
 * THE ADDRESS BOOK'S FIRST FILL GRANTS NOTHING BEYOND ITS SOURCE
 * (the comms build spec 5.3).
 *
 * Every source the backfill reads is seeded, including the shapes most likely
 * to tempt it into granting: a form whose data carries the consent field set
 * to true (no form before this release had the box, so the field cannot mean
 * a yes the person saw), a member who submitted a form carrying somebody
 * else's address, an example identity and a tombstone. Then the answers are
 * read the way the post office reads them.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORM_CONSENT_FIELD } from "../../../shared/comms/contracts";
import { provisionTestDb, testDbConfigured, type TestDb } from "../../db/testDb";
import { usersRepo } from "../../repos/users";
import { backfillContacts } from "./backfill";
import { permissionFor, suppressionsPortFor, type PeopleDeps } from "./permissions";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

const submissions = [
  // Before the member joined, under their address: the first meeting.
  { id: "s1", type: "steward", userId: null, submittedAt: "2025-11-01T10:00:00.000Z", data: { email: "Ada@Example.test", name: "Ada" } },
  // A ticked-looking consent field from before the box existed grants nothing.
  { id: "s2", type: "resident", userId: null, submittedAt: "2025-12-01T10:00:00.000Z", data: { email: "stranger@example.test", firstName: "Sam", [FORM_CONSENT_FIELD]: true } },
  { id: "s3", type: "investor-doc-request", userId: null, submittedAt: "2026-02-01T10:00:00.000Z", data: { email: "investor@example.test", name: "Ivy" } },
  // A member pressed send with a friend's address: the friend is not the member.
  { id: "s4", type: "contact", userId: "bf-bo", submittedAt: "2026-06-01T10:00:00.000Z", data: { email: "friend@example.test" } },
  { id: "s5", type: "contact", userId: null, submittedAt: "2026-06-02T10:00:00.000Z", data: { email: "not an address" } },
  { id: "s6", type: "contact", userId: null, submittedAt: "2026-06-03T10:00:00.000Z", data: { message: "no address at all" } },
];

const lines: string[] = [];
const run = () =>
  backfillContacts({ getPool: () => pool, members: usersRepo(pool), submissions: { all: () => submissions }, log: (l) => lines.push(l) });

describe.skipIf(!configured)("the address book backfill", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    const users = usersRepo(pool);
    await users.add({ id: "bf-ada", name: "Ada Member", email: "ada@example.test", passwordHash: "x", paths: ["resident"], joinedAt: "2026-01-01T10:00:00.000Z" });
    await users.add({ id: "bf-bo", name: "Bo Member", email: "bo@example.test", passwordHash: "x", paths: [], joinedAt: "2026-05-01T10:00:00.000Z" });
    await users.add({ id: "bf-example", name: "Example Person", email: "example.person@example.test", passwordHash: "", isExample: true });
    await users.add({ id: "bf-gone", name: "A departed member", email: "deleted-bf-gone@anonymized.invalid", passwordHash: "" });
    await q("INSERT INTO housing_reservations (id, home_type, name, email, created_at) VALUES ('h1', 'casita', 'Hal', 'housing@example.test', '2026-03-01 10:00:00.000')");
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
  });

  it("makes a contact of every usable address, first met where it was first seen, and grants nothing", async () => {
    const counts = await run();
    // Eight addresses: two accounts (the example and the tombstone are nobody's),
    // five forms with an address (one of them unusable) and one housing request.
    // Ada's form came first, so her account, reached later, is already known.
    expect(counts).toEqual({ seen: 8, created: { forms: 4, members: 1, housing: 1 }, known: 1, unusable: 1 });
    const contacts = await q("SELECT email_key, user_id, first_source FROM comms_contacts ORDER BY email_key");
    expect(contacts).toEqual([
      { email_key: "ada@example.test", user_id: "bf-ada", first_source: "steward" },
      { email_key: "bo@example.test", user_id: "bf-bo", first_source: "account" },
      { email_key: "friend@example.test", user_id: null, first_source: "contact" },
      { email_key: "housing@example.test", user_id: null, first_source: "housing" },
      { email_key: "investor@example.test", user_id: null, first_source: "investor-doc-request" },
      { email_key: "stranger@example.test", user_id: null, first_source: "resident" },
    ]);
    expect(await q("SELECT * FROM comms_permissions")).toEqual([]);
    expect(lines.at(-1)).toMatch(/address book backfill: 8 address\(es\) seen, 6 new contact\(s\).*No permission was granted\./);
  });

  it("leaves every answer exactly where the source puts it", async () => {
    const deps: PeopleDeps = { getPool: () => pool, members: usersRepo(pool), suppressions: suppressionsPortFor(() => pool) };
    const may = async (email: string, kind: "events" | "paths" | "letters" | "notices") => (await permissionFor(deps, email, kind)).allowed;
    // A member who chose a path in their account: path emails, from the account itself.
    expect(await may("ada@example.test", "paths")).toBe(true);
    expect(await may("bo@example.test", "paths")).toBe(false);
    // Nobody is on a letters list they never asked to join.
    for (const email of ["ada@example.test", "bo@example.test", "stranger@example.test", "investor@example.test", "friend@example.test", "housing@example.test"]) {
      expect(await may(email, "letters"), email).toBe(false);
    }
    // The ticked-looking field on an old form is not a yes.
    expect(await may("stranger@example.test", "paths")).toBe(false);
    // Notices are a member's own account mail.
    expect(await may("bo@example.test", "notices")).toBe(true);
    expect(await may("friend@example.test", "notices")).toBe(false);
  });

  it("finds everybody already known on a second run, and makes nothing new", async () => {
    const again = await run();
    expect(again.created).toEqual({});
    expect(again.known).toBe(7);
    expect((await q("SELECT COUNT(*) AS n FROM comms_contacts"))[0].n).toBe(6);
  });
});
