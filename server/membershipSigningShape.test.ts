/**
 * THE SHAPE A REAL ROW ARRIVES IN.
 *
 * `shared/membershipSigning.test.ts` holds every judgement this feature makes,
 * and it holds them over hand-written objects. The one thing it cannot answer
 * is what `submissionsRepo.all()` actually hands over, and that is the only
 * question here.
 *
 * Two fields decide whether a member sees their own signing or sees nothing,
 * and both are the kind that pass a type check and fail in production:
 *
 *   `user_id`      a varchar. A caller comparing it to a number matches
 *                  nothing, and a member who signed reads as one who never did.
 *   `submitted_at` spec'd `kind: "time"`, which is the repo's own conversion.
 *                  A Date interpolated into JSX renders the host's locale, and
 *                  `dayOf` in the journey parses a string.
 *
 * So this writes a signing through the real spec into a real migration-applied
 * schema and reads it back through the real reader, then runs the same
 * function the route runs. No server is booted: the claim is about the repo's
 * conversion, and booting one would prove the same thing slower.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and it skips loudly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { dbCollection } from "./repos/store-db";
import { signingOf, SIGNING_TYPE } from "../shared/membershipSigning";

const configured = testDbConfigured();
if (!configured) {
  console.warn("[membershipSigningShape] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

/** The spec from `server/index.ts`, which is the one the route reads through. */
const SUBMISSIONS_SPEC = {
  table: "submissions",
  orderBy: "`submitted_at`, `id`",
  columns: [
    { js: "id", db: "id" },
    { js: "type", db: "type" },
    { js: "status", db: "status" },
    { js: "data", db: "data", kind: "json" as const },
    { js: "rewarded", db: "rewarded", kind: "bool" as const },
    { js: "userId", db: "user_id" },
    { js: "userName", db: "user_name" },
    { js: "submittedAt", db: "submitted_at", kind: "time" as const },
  ],
};

describe.skipIf(!configured)("a signing as the repo hands it over", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    // The one statement here, and the only reason it is not a repo call: a
    // session setting is not a query on a table, and `kind: "time"` is exactly
    // what this file is about, so a session on the host's offset would make the
    // assertion below measure the wrong thing. `provisionTestDb` hands over a
    // fresh scratch schema, so there is nothing to clear before writing.
    // `testPool` pins the session zone on EVERY connection. This file used to
    // issue one `SET time_zone` here, which reaches the ONE connection that
    // served it and leaves the other three on the host's offset - and with
    // connectionLimit 4 a later query can land on any of them. The assertion
    // below depends on the session, so that was a real race, not only a
    // ratchet violation.
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const repo = async () => {
    const r = dbCollection(pool, SUBMISSIONS_SPEC as any);
    await r.load();
    return r;
  };

  it("finds the signer's own row, and answers waiting while the village has not decided", async () => {
    const r = await repo();
    await r.insert({
      id: "sig-1",
      type: SIGNING_TYPE,
      status: "new",
      data: { name: "A signer", email: "signer@example.org" },
      rewarded: false,
      userId: "member-7",
      userName: "A signer",
      submittedAt: new Date("2026-08-30T10:00:00.000Z"),
    } as any);

    const mine = signingOf((await repo()).all(), "member-7");
    expect(mine, "a signing the repo stored is a signing the profile can read").toBeTruthy();
    expect(mine?.answer).toBe("waiting");
    // A string, whatever `kind: "time"` converted it to on the way back.
    expect(typeof mine?.at).toBe("string");
    expect(Number.isFinite(new Date(String(mine?.at)).getTime())).toBe(true);
  });

  it("answers welcomed once the row is accepted, which is the act that grants membership", async () => {
    const r = await repo();
    const rows = r.all() as any[];
    const row = rows.find((s) => s.id === "sig-1");
    row.status = "accepted";
    await r.replaceAll(rows);

    expect(signingOf((await repo()).all(), "member-7")?.answer).toBe("welcomed");
  });

  it("shows nobody a stranger's signing, which is stored with no account on it", async () => {
    const r = await repo();
    await r.insert({
      id: "sig-2",
      type: SIGNING_TYPE,
      status: "new",
      data: { name: "A stranger", email: "stranger@example.org" },
      rewarded: false,
      userId: null,
      userName: "A stranger",
      submittedAt: new Date("2026-08-31T10:00:00.000Z"),
    } as any);

    const all = (await repo()).all();
    expect(all.length, "the stranger's row is stored and kept").toBe(2);
    expect(signingOf(all, "member-7")?.answer, "and it did not become the member's").toBe("welcomed");
    expect(signingOf(all, ""), "and it belongs to no profile").toBeNull();
  });
});
