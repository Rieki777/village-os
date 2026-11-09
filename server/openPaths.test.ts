/**
 * What a class opens: the roles tagged for it, the open roles tagged for
 * nobody, and the count on each class card (build days S2).
 *
 * THE DEFECT THIS PINS (D1). `openPathsFor` promised that "an untagged row
 * belongs to everyone" and ran a bare JSON_CONTAINS, which is NULL for a
 * NULL column and false for `[]`, so every untagged role and quest vanished
 * from every class. A village that had tagged nothing showed each character
 * an empty board, and a Catalyst saw no way in.
 *
 * Four rows each, for roles and for quests: tagged for this class, tagged for
 * another, NULL and `[]`. Then the open-now rule on seats.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and the suite skips loudly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { openNowCounts, openPathsFor } from "./lib/characters";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[openPaths.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

let db: TestDb;
let pool: mysql.Pool;

async function role(id: string, archetypes: string | null, opts: { seats?: number; recruiting?: boolean } = {}) {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned
    "INSERT INTO `org_roles` (`id`, `name`, `seats`, `recruiting`, `active`, `archetypes`, `accountabilities`) VALUES (?,?,?,?,1,?, '[]')",
    [id, `Role ${id}`, opts.seats ?? 1, opts.recruiting ? 1 : 0, archetypes],
  );
}

async function seat(roleId: string, userId: string) {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned
    "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `started_at`) VALUES (?,?,'member',?,?,NOW())",
    [`as-${roleId}-${userId}`, roleId, userId, `user:${userId}`],
  );
}

async function quest(id: string, archetypes: string | null) {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned
    "INSERT INTO `quests` (`id`, `title`, `gratitude`, `status`, `tags`, `sort_order`, `archetypes`) VALUES (?,?,'10','open','[]',0,?)",
    [id, `Quest ${id}`, archetypes],
  );
}

describe.skipIf(!configured)("what a class opens (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

    await role("fit", JSON.stringify(["catalyzing"]));
    await role("other", JSON.stringify(["building"]));
    await role("untagged-null", null);
    await role("untagged-empty", "[]");
    // Untagged, but every place is held: not open now.
    await role("untagged-full", null, { seats: 1 });
    await seat("untagged-full", "u1");
    // Untagged and full, but recruiting anyway: open now.
    await role("untagged-recruiting", null, { seats: 1, recruiting: true });
    await seat("untagged-recruiting", "u2");
    // Tagged for this class and full: still a fit, but not open now.
    await role("fit-full", JSON.stringify(["catalyzing"]), { seats: 1 });
    await seat("fit-full", "u3");

    await quest("q-fit", JSON.stringify(["catalyzing"]));
    await quest("q-other", JSON.stringify(["building"]));
    await quest("q-null", null);
    await quest("q-empty", "[]");
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("keeps the fit to the roles tagged for the class", async () => {
    const out = await openPathsFor(pool, "local", "catalyzing");
    expect(out.roles.map((r) => r.id).sort()).toEqual(["fit", "fit-full"]);
  });

  it("offers every OPEN role tagged for nobody, NULL and [] alike, and never one tagged for another class", async () => {
    const out = await openPathsFor(pool, "local", "catalyzing");
    expect(out.alsoOpen.map((r) => r.id).sort()).toEqual(["untagged-empty", "untagged-null", "untagged-recruiting"]);
  });

  it("counts the quests tagged for the class and those tagged for nobody, never another class's", async () => {
    expect((await openPathsFor(pool, "local", "catalyzing")).questCount).toBe(3);
    expect((await openPathsFor(pool, "local", "building")).questCount).toBe(3);
  });

  it("counts roles open now per class card, and the untagged open ones once", async () => {
    const counts = await openNowCounts(pool, ["catalyzing", "building", "storytelling"]);
    expect(counts.byKey).toEqual({ catalyzing: 1, building: 1, storytelling: 0 });
    expect(counts.untagged).toBe(3);
  });
});
