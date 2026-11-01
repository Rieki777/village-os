/**
 * Tests for the members repository, S6 edition: the backing store is MySQL.
 *
 * The interesting case is still `update()`. In the JSON era every handler did
 * its own read-modify-write and two overlapping requests silently lost one
 * member's change — the old suite documented that staleness as a known
 * limitation. The MySQL repository runs SELECT ... FOR UPDATE inside a
 * transaction, so overlapping update() calls SERIALIZE; the concurrency test
 * here proves all of them land, which the file store could never promise.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL → the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { usersRepo, type MemberRecord, type UsersRepo } from "./users";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let repo: UsersRepo;

const member = (id: string, email: string, extra: Record<string, any> = {}): MemberRecord => ({
  id,
  email,
  name: id,
  recognitionBalance: 0,
  ...extra,
});

describe.skipIf(!configured)("usersRepo (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    repo = usersRepo(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("adds and reads back a full record with camelCase fidelity", async () => {
    const joined = "2025-03-01T12:00:00.000Z";
    await repo.add(
      member("usr-1", "One@Example.test", {
        passwordHash: "hash-1",
        role: "founder",
        handle: "one",
        tokenVersion: 3,
        paths: ["steward"],
        contributions: [{ id: "c1", recognitionEarned: 5 }],
        quests: ["q1"],
        journeys: { training: ["step-1", "step-2"] },
        bio: "hello",
        avatar: "/a.png",
        stageGranted: "resident",
        trainingComplete: true,
        recognitionBalance: 42,
        joinedAt: joined,
      }),
    );
    const u = await repo.byId("usr-1");
    expect(u).not.toBeNull();
    expect(u!.email).toBe("One@Example.test");
    expect(u!.passwordHash).toBe("hash-1");
    expect(u!.role).toBe("founder");
    expect(u!.handle).toBe("one");
    expect(u!.tokenVersion).toBe(3);
    expect(u!.paths).toEqual(["steward"]);
    expect(u!.contributions).toEqual([{ id: "c1", recognitionEarned: 5 }]);
    expect(u!.quests).toEqual(["q1"]);
    // journeys gates training completion and therefore stage computation —
    // this field silently vanishing is a member silently demoted.
    expect(u!.journeys).toEqual({ training: ["step-1", "step-2"] });
    expect(u!.bio).toBe("hello");
    expect(u!.avatar).toBe("/a.png");
    expect(u!.stageGranted).toBe("resident");
    expect(u!.trainingComplete).toBe(true);
    expect(u!.recognitionBalance).toBe(42);
    // Timestamp round-trip without zone drift (the timezone-Z discipline;
    // this machine is UTC-6, so a 'local' connection would shift this).
    expect(u!.joinedAt).toBe(joined);
  });

  it("finds by email case-insensitively, like the JSON repo did", async () => {
    // Registration and login compare emails, so a member typing a different
    // case must not create or miss an account.
    expect((await repo.byEmail("one@example.TEST"))?.id).toBe("usr-1");
    expect(await repo.existsByEmail("ONE@EXAMPLE.TEST")).toBe(true);
    expect(await repo.existsByEmail("nobody@example.test")).toBe(false);
  });

  it("returns null rather than throwing for a member who is gone", async () => {
    expect(await repo.byId("usr-missing")).toBeNull();
    expect(await repo.byEmail("missing@example.test")).toBeNull();
  });

  it("counts and lists in join order", async () => {
    await repo.add(member("usr-2", "two@example.test", { joinedAt: "2025-03-02T00:00:00.000Z" }));
    expect(await repo.count()).toBe(2);
    expect((await repo.all()).map((u) => u.id)).toEqual(["usr-1", "usr-2"]);
  });

  it("update() persists the mutation and leaves everyone else alone", async () => {
    const updated = await repo.update("usr-2", (m) => {
      m.recognitionBalance = 40;
      m.bio = "planted the swale";
      m.journeys = { training: ["s1"] };
    });
    expect(updated?.recognitionBalance).toBe(40);
    // Read back from the database, not from the returned object.
    const fresh = await repo.byId("usr-2");
    expect(fresh?.recognitionBalance).toBe(40);
    expect(fresh?.bio).toBe("planted the swale");
    expect(fresh?.journeys).toEqual({ training: ["s1"] });
    expect((await repo.byId("usr-1"))?.recognitionBalance).toBe(42);
  });

  it("keeps the proof of an address (0304, R104): null until written, then the instant, and a tombstone keeps none", async () => {
    // A row added without the field is unproved, which is what every row
    // that existed before the column reads as.
    await repo.add(member("usr-proof", "proof@example.test", { passwordHash: "h" }));
    expect((await repo.byId("usr-proof"))!.emailVerifiedAt).toBeNull();
    const at = "2026-10-31T09:30:00.000Z";
    await repo.update("usr-proof", (m) => void (m.emailVerifiedAt = at));
    // Read back from the database, with no zone drift.
    expect((await repo.byId("usr-proof"))!.emailVerifiedAt).toBe(at);
    // A write that does not mention it leaves it alone: the UPDATE names
    // every column, so a field the mapping dropped would be nulled here.
    await repo.update("usr-proof", (m) => void (m.bio = "still proved"));
    expect((await repo.byId("usr-proof"))!.emailVerifiedAt).toBe(at);
    // A row that is already a tombstone cannot be handed a proof back.
    await repo.update("usr-proof", (m) => { m.email = "deleted-usr-proof@anonymized.invalid"; m.emailVerifiedAt = null; }, { erasure: true });
    await repo.update("usr-proof", (m) => void (m.emailVerifiedAt = at));
    expect((await repo.byId("usr-proof"))!.emailVerifiedAt).toBeNull();
    await repo.remove("usr-proof");
  });

  it("update() returns null for a missing member and writes nothing", async () => {
    expect(await repo.update("usr-missing", (m) => void (m.recognitionBalance = 1))).toBeNull();
    expect(await repo.count()).toBe(2);
  });

  it("THE POINT: overlapping update() calls all land (row lock, no lost update)", async () => {
    // This is what the JSON store lost routinely: two handlers read, both
    // mutate, second write erases the first. FOR UPDATE serializes the
    // mutators, so ten concurrent increments must produce exactly ten.
    await repo.update("usr-1", (m) => void (m.recognitionBalance = 0));
    await Promise.all(
      Array.from({ length: 10 }, () =>
        repo.update("usr-1", (m) => {
          m.recognitionBalance = (m.recognitionBalance ?? 0) + 1;
        }),
      ),
    );
    expect((await repo.byId("usr-1"))?.recognitionBalance).toBe(10);
  });

  it("removes one member and returns them", async () => {
    await repo.add(member("usr-3", "three@example.test"));
    expect((await repo.remove("usr-3"))?.email).toBe("three@example.test");
    expect(await repo.byId("usr-3")).toBeNull();
    expect(await repo.remove("usr-3")).toBeNull();
  });
});
