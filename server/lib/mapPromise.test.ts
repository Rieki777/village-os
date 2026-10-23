/**
 * Turning the map's key into a row, and the two words for having no row.
 *
 * `not-here` and `gone` are the whole reason this file exists. They look
 * interchangeable and they are not: one says a village has never brought the
 * scene across, which is the DEFAULT state of a fresh fork and the most common
 * answer the map will ever get; the other says the thing existed here and does
 * not now. Telling a first-time visitor that a gathering was deleted when it
 * was never adopted is the failure this pins.
 *
 * Runs against a real scratch schema because the discriminator is a query, and
 * a mocked pool would only prove I can write the mock I already imagined.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { goingCountFor, missingReason, rowByMapKey } from "./mapPromise";

const configured = testDbConfigured();

describe.skipIf(!configured)("resolving the map's key", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    // No local timeout: inherit the 300s from vitest.config.ts. Provisioning
    // runs every migration against a hosted MySQL and a local ceiling below
    // the config's has already failed a run by five seconds.
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM event_rsvps");
    await pool.query("DELETE FROM events");
    await pool.query("DELETE FROM quests");
  });

  const addEvent = async (id: string, mapKey: string | null) =>
    pool.query(
      "INSERT INTO events (id, title, starts_at, status, map_key) VALUES (?,?,?,'scheduled',?)",
      [id, `Gathering ${id}`, new Date("2026-09-01T18:00:00Z"), mapKey],
    );

  it("finds a row by the key the map sent, not by anything derived", async () => {
    await addEvent("ev-village-e1", "e1");
    const row = await rowByMapKey(pool, "events", "e1");
    expect(row?.id).toBe("ev-village-e1");
    // The namespaced row id is NOT the handle. The map has never seen it and
    // cannot send it, which is the whole reason map_key exists.
    expect(await rowByMapKey(pool, "events", "ev-village-e1")).toBeNull();
  });

  it("says not-here when the village has imported nothing", async () => {
    // A fresh fork: rows may exist, but none of them came from a scene.
    await addEvent("hand-made", null);
    expect(await missingReason(pool, "events")).toBe("not-here");
    expect(await missingReason(pool, "quests")).toBe("not-here");
  });

  it("says gone once the scene IS here and this one is not", async () => {
    await addEvent("ev-village-e1", "e1");
    expect(await missingReason(pool, "events")).toBe("gone");
  });

  it("keeps the two tables' answers independent", async () => {
    // Importing gatherings says nothing about whether quests came across, and
    // a shared answer would tell somebody a quest was deleted on the strength
    // of an unrelated import.
    await addEvent("ev-village-e1", "e1");
    expect(await missingReason(pool, "events")).toBe("gone");
    expect(await missingReason(pool, "quests")).toBe("not-here");
  });

  it("counts only the people who said they are coming", async () => {
    await addEvent("ev-village-e1", "e1");
    // idempotency_key is NOT NULL on purpose (0059): a nullable dedupe column
    // is exempt from its own unique index and prevents nothing.
    await pool.query(
      "INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key) VALUES " +
        "('r1','ev-village-e1','u1','going','k1')," +
        "('r2','ev-village-e1','u2','going','k2')," +
        "('r3','ev-village-e1','u3','maybe','k3')",
    );
    expect(await goingCountFor(pool, "ev-village-e1")).toBe(2);
    expect(await goingCountFor(pool, "no-such-event")).toBe(0);
  });

  it("refuses to let two rows answer to one map key", async () => {
    await addEvent("ev-village-e1", "e1");
    // The unique index is the guard. Without it a second import under a
    // different sceneKey would address two gatherings as one and the bridge
    // would silently RSVP the wrong people to the wrong evening.
    await expect(addEvent("ev-second-e1", "e1")).rejects.toThrow();
  });

  it("still allows any number of rows that carry no key", async () => {
    // MySQL UNIQUE exempts NULLs, which is the behaviour wanted here: almost
    // every row in almost every village has never been near a scene.
    await addEvent("a", null);
    await addEvent("b", null);
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) n FROM events");
    expect(Number(rows[0].n)).toBe(2);
  });
});
