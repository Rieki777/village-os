/**
 * PROFILE INVENTORY AND THE PRIVACY SWITCH, on a scratch schema with every
 * real migration applied.
 *
 *   loadInventory   live loans, stays and homes asked about, nothing finished,
 *                   nothing withdrawn, nobody else's, and never the name,
 *                   email, phone or notes typed into a reservation.
 *   /api/me/privacy refuses junk and unknown flags with nothing written, keeps
 *                   the other flags when one changes, and reads an unset flag
 *                   as its conservative default.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { loadInventory } from "../repos/profileInventory";
import { privacyChange, register } from "./profilePrivacy";

describe("what a privacy change may be", () => {
  it("takes real booleans for flags that exist", () => {
    expect(privacyChange({ showInventory: true })).toEqual({ change: { showInventory: true } });
    expect(privacyChange({ showInventory: false, showHome: true })).toEqual({ change: { showInventory: false, showHome: true } });
  });
  it("refuses a string, a number, an unknown flag, an array and an empty change", () => {
    for (const bad of [{ showInventory: "true" }, { showInventory: 1 }, { showEverything: true }, [true], {}, null, "on"]) {
      expect("error" in privacyChange(bad)).toBe(true);
    }
  });
});

describe.skipIf(!testDbConfigured())("inventory and the privacy switch, on a database", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  let me: { id: string } | null = { id: "inv-ana" };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    const app = express();
    app.use(express.json());
    register(app, { authedUser: async () => me, getPool: () => pool as any });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;

    for (const [id, name] of [["inv-ana", "Ana Reyes"], ["inv-ben", "Ben Okafor"]]) {
      await pool.query("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [id, name, `${id}@example.org`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
    await pool.query("INSERT INTO library_items (id, name) VALUES ('it-drill','Cordless drill'), ('it-saw','Hand saw'), ('it-ladder','Ladder')"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("INSERT INTO accommodations (id, name) VALUES ('acc-two','Casita Two')"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    me = { id: "inv-ana" };
    await pool.query("DELETE FROM library_loans"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("DELETE FROM stays"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("DELETE FROM housing_reservations"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("UPDATE users SET privacy = NULL WHERE id IN ('inv-ana','inv-ben')"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
  });

  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`${base}${url}`, { // module-review-ok: this suite's own loopback server, not an outbound call
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };

  it("lists what is live, and nothing finished, withdrawn or somebody else's", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO library_loans (id, item_id, user_id, status, due_on) VALUES " +
        "('ln-live','it-drill','inv-ana','active','2026-11-07'), ('ln-done','it-saw','inv-ana','closed',NULL), ('ln-ben','it-ladder','inv-ben','active',NULL)",
    );
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO stays (id, user_id, accommodation_id, status, arrive_on) VALUES ('st-live','inv-ana','acc-two','requested','2026-12-01'), ('st-old','inv-ana','acc-two','ended',NULL)",
    );
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO housing_reservations (id, home_type, structure_key, name, email, phone, notes, status, user_id) VALUES " +
        "('hr-live','tiny-home','pond-homes','Ana Reyes','ana-private@example.org','555 0100','gate code 1234','new','inv-ana'), " +
        "('hr-gone','casita',NULL,'Ana Reyes','ana-private@example.org',NULL,NULL,'withdrawn','inv-ana')",
    );

    const inv = await loadInventory(pool as any, "inv-ana");
    expect(inv.loans).toEqual([{ id: "ln-live", item: "Cordless drill", status: "active", dueOn: "2026-11-07" }]);
    expect(inv.stays).toEqual([{ id: "st-live", place: "Casita Two", status: "requested", arriveOn: "2026-12-01" }]);
    expect(inv.lots).toEqual([{ id: "hr-live", homeType: "tiny-home", structureKey: "pond-homes", standing: "You have asked for this" }]);
    // Nothing typed into the reservation form travels, so the shape is safe to hand a stranger.
    const text = JSON.stringify(inv);
    for (const secret of ["ana-private@example.org", "555 0100", "gate code", "Ana Reyes"]) expect(text).not.toContain(secret);
  });

  it("answers empty lists for a member with nothing live", async () => {
    expect(await loadInventory(pool as any, "inv-ben")).toEqual({ loans: [], stays: [], lots: [] });
  });

  it("reads every flag at its default before the member has touched one", async () => {
    const r = await call("GET", "/api/me/privacy");
    expect(r.status).toBe(200);
    expect(r.body.privacy).toMatchObject({ showInventory: false, showHome: false, showBadges: true });
  });

  it("turns showInventory on and off, and keeps every other flag", async () => {
    expect((await call("PUT", "/api/me/privacy", { showHome: true })).status).toBe(200);
    const on = await call("PUT", "/api/me/privacy", { showInventory: true });
    expect(on.body.privacy).toMatchObject({ showInventory: true, showHome: true });
    expect((await call("GET", "/api/me/privacy")).body.privacy.showInventory).toBe(true);
    const off = await call("PUT", "/api/me/privacy", { showInventory: false });
    expect(off.body.privacy).toMatchObject({ showInventory: false, showHome: true });
  });

  it("refuses junk with nothing written, and only ever touches the reader's own row", async () => {
    for (const bad of [{ showInventory: "true" }, { showEverything: true }, {}]) {
      expect((await call("PUT", "/api/me/privacy", bad)).status).toBe(400);
    }
    expect((await call("GET", "/api/me/privacy")).body.privacy.showInventory).toBe(false);
    await call("PUT", "/api/me/privacy", { showInventory: true });
    me = { id: "inv-ben" };
    expect((await call("GET", "/api/me/privacy")).body.privacy.showInventory).toBe(false);
    me = null;
    expect((await call("PUT", "/api/me/privacy", { showInventory: true })).status).toBe(401);
  });
});
