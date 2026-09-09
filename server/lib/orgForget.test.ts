/**
 * Taking a person off the org chart, at the column level.
 *
 * These two functions are the ones a deletion request ends up in, and almost
 * nothing they do is visible over HTTP: an ENDED seating publishes its id, its
 * dates and a name resolved through `users`, and never its `display_name` or
 * its `note`. So an end-to-end test can prove the seat was released and cannot
 * prove the person was scrubbed, which is the shape of a test that passes over
 * a defect. This one reads the rows.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { forgetDocumentedHolder, releaseSeatingsForUser } from "./orgChart";
import { forgetMemberInDrafts } from "./orgDrafts";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

/** One seating, written straight to the table so every column is explicit. */
async function seat(row: {
  id: string;
  roleId: string;
  kind?: "member" | "documented";
  userId?: string | null;
  displayName?: string | null;
  holderKey: string;
  focus?: string | null;
  note?: string | null;
  endedAt?: string | null;
}): Promise<void> {
  await pool.query(
    "INSERT INTO org_role_assignments " +
      "(id, org_role_id, holder_kind, user_id, display_name, holder_key, focus, note, ended_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?)",
    [
      row.id, row.roleId, row.kind ?? "member", row.userId ?? null,
      row.displayName ?? null, row.holderKey, row.focus ?? null,
      row.note ?? null, row.endedAt ?? null,
    ],
  );
}

async function read(id: string): Promise<any> {
  const [[r]] = await pool.query<any[]>(
    "SELECT holder_kind, user_id, display_name, holder_key, focus, note, ended_at, ended_reason " +
      "FROM org_role_assignments WHERE id = ?",
    [id],
  );
  return r;
}

describe.skipIf(!configured)("taking a person off the org chart", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
    await pool.query(
      "INSERT INTO org_roles (id, name, seats) VALUES ('seat-a','Seat A',3), ('seat-b','Seat B',3)",
    );
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM org_role_assignments");
  });

  describe("a member who leaves", () => {
    it("ends every live seating and takes their name off all of them", async () => {
      // The row that matters most is the CLAIMED one: `claimSeating` turns a
      // documented seating into a member one and keeps the name it was
      // recorded under, so the tombstone on the users row never reaches it.
      await seat({ id: "a1", roleId: "seat-a", userId: "u-leaver", holderKey: "u-leaver",
        displayName: "Departing Steward", note: "Away and inactive.", focus: "the north slope" });
      await seat({ id: "a2", roleId: "seat-b", userId: "u-leaver", holderKey: "u-leaver" });

      expect(await releaseSeatingsForUser(pool, "u-leaver", "member left")).toBe(2);

      const a1 = await read("a1");
      expect(a1.ended_at, "the seating ends").not.toBeNull();
      expect(a1.ended_reason).toBe("member left");
      expect(a1.display_name, "the name it was documented under").toBeNull();
      expect(a1.note, "the note somebody wrote about them").toBeNull();
      // Kept on purpose: which slice of the seat was held is a fact about the
      // seat, and the history is the whole point of ending instead of deleting.
      expect(a1.focus).toBe("the north slope");
      expect(a1.user_id, "the id stays, as it does everywhere else").toBe("u-leaver");
      expect((await read("a2")).ended_at).not.toBeNull();
    });

    it("scrubs seatings they had ALREADY left, which the ending pass never touches", async () => {
      // A seating ended last season still carries the name, and `ended_at IS
      // NULL` in the first statement will never reach it. Two statements for
      // exactly this reason.
      await seat({ id: "old", roleId: "seat-a", userId: "u-leaver", holderKey: "u-leaver",
        displayName: "Departing Steward", note: "Stepped back.", endedAt: "2026-01-01 00:00:00" });

      expect(await releaseSeatingsForUser(pool, "u-leaver", "member left"), "nothing live to end").toBe(0);

      const old = await read("old");
      expect(old.display_name).toBeNull();
      expect(old.note).toBeNull();
      expect(String(old.ended_reason ?? ""), "an old ending is not rewritten").not.toBe("member left");
    });

    it("touches nobody else", async () => {
      await seat({ id: "mine", roleId: "seat-a", userId: "u-leaver", holderKey: "u-leaver" });
      await seat({ id: "theirs", roleId: "seat-a", userId: "u-stays", holderKey: "u-stays",
        displayName: "Still Here", note: "Carrying on." });
      await seat({ id: "doc", roleId: "seat-b", kind: "documented", displayName: "Never Signed Up",
        holderKey: "doc:never-signed-up" });

      await releaseSeatingsForUser(pool, "u-leaver", "member left");

      const theirs = await read("theirs");
      expect(theirs.ended_at).toBeNull();
      expect(theirs.display_name).toBe("Still Here");
      expect(theirs.note).toBe("Carrying on.");
      expect((await read("doc")).display_name).toBe("Never Signed Up");
    });
  });

  describe("a documented holder, who has no account to delete", () => {
    it("goes from every seat at once, found by holder key and not by the id passed in", async () => {
      // Forgetting somebody from one seat and leaving them named on the next
      // one is not forgetting them, so the id is a way IN and not the scope.
      await seat({ id: "d1", roleId: "seat-a", kind: "documented", displayName: "Bo Reyes",
        holderKey: "doc:bo-reyes", note: "Reachable by post." });
      await seat({ id: "d2", roleId: "seat-b", kind: "documented", displayName: "Bo Reyes",
        holderKey: "doc:bo-reyes" });
      await seat({ id: "d3", roleId: "seat-a", kind: "documented", displayName: "Bo Reyes",
        holderKey: "doc:bo-reyes", endedAt: "2026-01-01 00:00:00" });

      const r = await forgetDocumentedHolder(pool, "d1", "forgotten at their request");
      expect(r.found).toBe(true);
      expect(r.seatings, "two were live; the third had already ended").toBe(2);

      for (const id of ["d1", "d2", "d3"]) {
        const row = await read(id);
        expect(row.display_name, `${id} keeps no name`).toBeNull();
        expect(row.ended_at, `${id} is ended`).not.toBeNull();
        // The key itself is rewritten: `documentedKey` derives it from the
        // name, so a slug is a name with hyphens in it.
        expect(String(row.holder_key), `${id} keeps no slug`).not.toContain("bo-reyes");
        expect(String(row.holder_key)).toContain("doc:forgotten-");
      }
      expect((await read("d1")).note).toBeNull();
    });

    it("refuses an id that is not a documented seating", async () => {
      await seat({ id: "m1", roleId: "seat-a", userId: "u-someone", holderKey: "u-someone" });
      expect(await forgetDocumentedHolder(pool, "m1", "no")).toEqual({ found: false, seatings: 0 });
      expect(await forgetDocumentedHolder(pool, "no-such-id", "no")).toEqual({ found: false, seatings: 0 });
      expect((await read("m1")).ended_at, "a member seating is left alone").toBeNull();
    });

    it("leaves a different documented holder on the same seat alone", async () => {
      await seat({ id: "d1", roleId: "seat-a", kind: "documented", displayName: "Bo Reyes",
        holderKey: "doc:bo-reyes" });
      await seat({ id: "d2", roleId: "seat-a", kind: "documented", displayName: "Ada Vance",
        holderKey: "doc:ada-vance" });

      await forgetDocumentedHolder(pool, "d1", "forgotten at their request");

      const d2 = await read("d2");
      expect(d2.display_name).toBe("Ada Vance");
      expect(d2.ended_at).toBeNull();
      expect(d2.holder_key).toBe("doc:ada-vance");
    });
  });

  /*
   * THE SEATINGS THAT HAVE NOT HAPPENED YET.
   *
   * Everything above is a column, so the sweep reaches it with one UPDATE. A
   * DRAFT restates a person inside JSON: `seat_holder` keeps
   * `{ userId, displayName }` in `payload`, and `end_holding` keeps a whole
   * assignment row in `before_json`. Nothing swept either, so a member could
   * exercise deletion, watch every column-shaped trace go, and have their name
   * sit in an open draft that `/api/org/vision` publishes.
   *
   * Read at the ROW, like the rest of this file, because none of these fields
   * reaches HTTP in a shape a request could prove empty.
   */
  describe("a member named in a draft that has not been published", () => {
    const ANON = "A departed member";

    beforeEach(async () => {
      await pool.query("DELETE FROM org_draft_changes");
      await pool.query("DELETE FROM org_drafts");
      await pool.query(
        "INSERT INTO org_drafts (id, title, created_by, status) VALUES ('d', 'A season of changes', 'u-steward', 'open')",
      );
    });

    const change = async (id: string, op: string, payload: unknown, before: unknown = null) =>
      pool.query(
        "INSERT INTO org_draft_changes (id, draft_id, op, org_role_id, payload, before_json, sort_order) VALUES (?,?,?,?,?,?,0)",
        [id, "d", op, "seat-a", JSON.stringify(payload), before === null ? null : JSON.stringify(before)],
      );

    const readChange = async (id: string) => {
      const [[row]] = await pool.query<any[]>("SELECT payload, before_json FROM org_draft_changes WHERE id = ?", [id]);
      const j = (v: any) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);
      return { payload: j(row.payload), before: j(row.before_json) };
    };

    it("takes their name and id out of a pending seating", async () => {
      await change("c1", "seat_holder", { userId: "u-leaver", displayName: "Bo Reyes", focus: "the pond" });
      expect(await forgetMemberInDrafts(pool, "u-leaver", ANON)).toBe(1);
      const { payload } = await readChange("c1");
      expect(payload.userId).toBeNull();
      expect(payload.displayName).toBe(ANON);
      // De-attribution is not erasure: the words beside the id go too.
      expect(payload.focus).toBeNull();
    });

    it("empties the revert row of an end_holding, name, note and key", async () => {
      await change("c2", "end_holding", { assignmentId: "a1" }, {
        id: "a1", org_role_id: "seat-a", holder_kind: "member", user_id: "u-leaver",
        display_name: "Bo Reyes", holder_key: "u-leaver", focus: "the pond", note: "asked to step back",
      });
      expect(await forgetMemberInDrafts(pool, "u-leaver", ANON)).toBe(1);
      const { before } = await readChange("c2");
      expect(before.user_id).toBeNull();
      expect(before.display_name).toBe(ANON);
      expect(before.note).toBeNull();
      expect(before.focus).toBeNull();
      expect(String(before.holder_key)).toContain("doc:forgotten-");
      // The STRUCTURE survives, so reverting the change still works and only
      // the person is gone.
      expect(before.org_role_id).toBe("seat-a");
    });

    it("leaves everybody else in the same draft alone", async () => {
      await change("c1", "seat_holder", { userId: "u-leaver", displayName: "Bo Reyes" });
      await change("c3", "seat_holder", { userId: "u-stays", displayName: "Ada Vance" });
      expect(await forgetMemberInDrafts(pool, "u-leaver", ANON)).toBe(1);
      const { payload } = await readChange("c3");
      expect(payload.userId).toBe("u-stays");
      expect(payload.displayName).toBe("Ada Vance");
    });

    it("leaves a documented holder who is not a member alone", async () => {
      // No user id to match, so nothing here is about the departing member.
      await change("c4", "seat_holder", { displayName: "Bo Reyes" });
      expect(await forgetMemberInDrafts(pool, "u-leaver", ANON)).toBe(0);
      expect((await readChange("c4")).payload.displayName).toBe("Bo Reyes");
    });
  });
});
