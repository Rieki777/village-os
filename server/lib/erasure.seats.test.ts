/**
 * WHAT A SEAT STILL HELD FOR A MEMBER WHO LEFT (adversarial round 2, findings
 * 8, 9 and 10).
 *
 *   8. A seat's journal kept the name the seating was recorded under, in the
 *      member's own ask and in the steward's confirm and decline, and
 *      `GET /api/org/:kind/:id/journal` serves those rows to any account that
 *      holds `map.viewPeople`, which opens at the guest rung.
 *   9. An open seat claim outlived the erasure. The stewards' queue went on
 *      offering it with the recorded name beside "A departed member", and
 *      Confirm turned the seating into a holding for the tombstone, which the
 *      moon settlement pays and nothing would ever release.
 *  10. A permission holding that landed while the sweep ran (between the
 *      role-holdings step and the tombstone) outlived it, because a resume
 *      past the tombstone never runs role-holdings again. The role_seat
 *      closer's own refusal is driven over HTTP in
 *      `server/steward.routes.e2e.test.ts`, which boots the server the closer
 *      lives in.
 *  12. (Round 3.) A documented holder, who has no account, was written into
 *      the journal as "seated <name>", and forgetting them took the name off
 *      the seatings and left it there. The lines written before are rewritten
 *      in `server/lib/orgForget.test.ts`; this file drives the route.
 *
 * EVERY CASE READS THE LEFTOVER FIRST, so a zero after the sweep is about rows
 * that were there, and every case carries a neighbour whose rows of the same
 * shape must come through untouched: a sweep with a broken WHERE would pass
 * every assertion about the leaver and empty the village.
 *
 * The submissions collection is the real one, spec'd as `server/index.ts`
 * spec's it, and the org routes and the sweep share it, so the queue a steward
 * reads is the one the sweep wrote. No TEST_DATABASE_URL and the suite skips
 * (harness rule).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { anonymizeMember, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { recordEvent } from "./events";
import { claimSeating, forgetDocumentedHolder, releaseSeatingsForUser, seatHolder } from "./orgChart";
import { SEAT_JOURNAL_LINE } from "../repos/orgSeatErasure";
import { stageIndex } from "../../shared/gameConfig";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import { dbCollection } from "../repos/store-db";
import { register } from "../routes/org";

const configured = testDbConfigured();

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";
let submissionsRepo: ReturnType<typeof dbCollection>;
let handlers: Map<string, Handler>;
/** Whoever the request is signed in as. Set per case. */
let viewer: any = null;
/** The permission holdings the sweep reads and removes, by id. */
let holders: Array<{ id: string; roleId: string; userId: string }> = [];
/** Run once, at the last instant the member's sessions still live. */
let beforeTombstone: (() => Promise<void>) | null = null;

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

async function person(id: string, name: string): Promise<void> {
  await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [id, name, `${id}@example.test`]);
}

function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: {
      byId: (id: string) => real.byId(id),
      update: async (id: string, fn: (u: any) => void, opts?: { erasure?: boolean }) => {
        const hook = beforeTombstone;
        beforeTombstone = null;
        await hook?.();
        return real.update(id, fn, opts);
      },
    },
    submissionsRepo: submissionsRepo as unknown as ErasureDeps["submissionsRepo"],
    roleHoldersRepo: {
      remove: async (ids: string[]) => {
        holders = holders.filter((h) => !ids.includes(h.id));
      },
    },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => holders,
    uploadsDir,
  };
}

async function erase(id: string): Promise<void> {
  const target = await usersRepo(pool).byId(id);
  expect(target, `${id} must exist before it is erased`).toBeTruthy();
  await anonymizeMember(pool, target, "seat-admin", deps());
  expect((await erasureRecord(pool, id))?.finishedAt, `${id}'s sweep must finish`).toBeTruthy();
}

function collect(): { app: any; handlers: Map<string, Handler> } {
  const out = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    out.set(`${method} ${p}`, handler);
  };
  return { app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") }, handlers: out };
}

async function call(key: string, req: any = {}): Promise<{ status: number; body: any }> {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const out = { status: 200, body: undefined as any };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  await handler({ params: {}, body: {}, query: {}, ...req }, res);
  return out;
}

/** One seat on the chart, with one documented holder on it. */
async function seat(roleId: string, recordedName: string): Promise<string> {
  await q("INSERT IGNORE INTO `org_roles` (`id`, `name`, `aim`, `seats`) VALUES (?, ?, 'Keep it running.', 3)", [roleId, `${roleId} role`]);
  const made = await seatHolder(pool, roleId, { displayName: recordedName });
  expect(made.ok, made.reason).toBe(true);
  return String(made.assignmentId);
}

/** A journal line as the routes wrote it before they stopped writing names. */
async function line(roleId: string, text: string, actorUserId: string | null, kind = "role"): Promise<void> {
  await recordEvent(pool, { kind, text, actorUserId, entityType: "org_role", entityRef: roleId, audience: "admin" });
}

async function journalOf(roleId: string): Promise<string[]> {
  return (await q("SELECT `text` FROM `health_events` WHERE `entity_type` = 'org_role' AND `entity_ref` = ? ORDER BY `text`", [roleId])).map((r) =>
    String(r.text),
  );
}

async function seatingRow(id: string): Promise<any> {
  return (await q("SELECT `holder_kind`, `user_id`, `display_name`, `ended_at` FROM `org_role_assignments` WHERE `id` = ?", [id]))[0];
}

describe.skipIf(!configured)("what a seat still held for a member who left", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-seats-"));
    clearMemberDrivers();
    submissionsRepo = dbCollection(pool, {
      table: "submissions",
      orderBy: "`submitted_at`, `id`",
      columns: [
        { js: "id", db: "id" },
        { js: "type", db: "type" },
        { js: "status", db: "status" },
        { js: "data", db: "data", kind: "json" },
        { js: "rewarded", db: "rewarded", kind: "bool" },
        { js: "userId", db: "user_id" },
        { js: "userName", db: "user_name" },
        { js: "submittedAt", db: "submitted_at", kind: "time" },
      ],
    });
    await submissionsRepo.load();
    const members = usersRepo(pool);
    const { app, handlers: h } = collect();
    register(app, {
      isAdmin: async () => false,
      authedUser: async () => viewer,
      // Every case here acts as a holder of org.seat, the power both doors ask.
      guardCapability: async () => true,
      getPool: () => pool,
      members: { all: () => members.all(), byId: (id: string) => members.byId(id) },
      firstName: (n: string) => String(n).split(/\s+/)[0],
      // The guest rung: no role, no badge, an account. The journal's door asks it.
      capabilityCtx: async () => ({ stageIndex: stageIndex("guest"), stageIndexOf: stageIndex, roleCapabilities: [] }),
      lapseContext: () => ({}),
      currentPatternId: () => null,
      seasonState: () => ({ seasons: [], current: null, timezone: "UTC" }),
      notify: async () => undefined,
      notifyAdmins: async () => undefined,
      submissionsRepo,
    } as any);
    handlers = h;
    await person("seat-steward", "Sam Steward");
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  beforeEach(() => {
    viewer = null;
    holders = [];
    beforeTombstone = null;
  });

  // ── 8 ─────────────────────────────────────────────────────────────────────
  describe("8: the seat's journal", () => {
    it("writes the ask, the confirm and the decline with no recorded name in them", async () => {
      await person("j8-wren", "Wren Halloway");
      const water = await seat("j8-water", "Wren Halloway");
      const fire = await seat("j8-fire", "Wren Halloway");
      viewer = { id: "j8-wren", name: "Wren Halloway", email: "j8-wren@example.test" };
      expect((await call("POST /api/org/seatings/:id/claim", { params: { id: water } })).status).toBe(200);
      expect((await call("POST /api/org/seatings/:id/claim", { params: { id: fire } })).status).toBe(200);
      viewer = { id: "seat-steward", name: "Sam Steward" };
      const confirmed = await call("POST /api/org/seatings/:id/claim/confirm", { params: { id: water }, body: { userId: "j8-wren" } });
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      const ask = (await call("GET /api/org/seat-claims")).body.find((a: any) => a.assignmentId === fire);
      expect((await call("POST /api/org/seat-claims/:id/decline", { params: { id: ask.claimId } })).status).toBe(200);

      const lines = [...(await journalOf("j8-water")), ...(await journalOf("j8-fire"))];
      expect(lines, "the ask, the confirm and the decline were all written").toHaveLength(4);
      for (const text of lines) {
        expect(text, "a journal line names nobody; the reader looks at the seat").not.toMatch(/Wren|Halloway/);
      }
    });

    it("takes the recorded name out of the lines written before, on every seat it was theirs on, and leaves a neighbour's lines alone", async () => {
      await person("j8b-wren", "Wren Halloway");
      await person("j8b-ash", "Ash Grey");
      // A seat they asked for and were confirmed in, documented by an admin first.
      const water = await seat("j8b-water", "Wren Halloway");
      await line("j8b-water", "seated Wren Halloway", "seat-steward", "org");
      await line("j8b-water", 'Wren asks to be confirmed as the holder recorded "Wren Halloway"', "j8b-wren");
      await line("j8b-water", 'confirmed: the holder recorded "Wren Halloway" is a member here', "seat-steward");
      expect(await claimSeating(pool, water, "j8b-wren")).toBe(true);
      // A seat a steward confirmed them in with no ask behind it, under a different spelling.
      const fire = await seat("j8b-fire", "W. Halloway");
      await line("j8b-fire", 'confirmed: the holder recorded "W. Halloway" is a member here', "seat-steward");
      expect(await claimSeating(pool, fire, "j8b-wren")).toBe(true);
      // A seat they asked for and were told no, with the claim still in the inbox.
      await seat("j8b-earth", "Wren Halloway");
      await line("j8b-earth", 'Wren asks to be confirmed as the holder recorded "Wren Halloway"', "j8b-wren");
      await line("j8b-earth", 'declined: the role stays recorded under "Wren Halloway"', "seat-steward");
      await submissionsRepo.insert({
        id: "j8b-claim-earth",
        type: "seat-claim",
        status: "declined",
        rewarded: false,
        data: { assignmentId: "x", roleId: "j8b-earth", roleName: "Earth", recordedName: "Wren Halloway", name: "Wren Halloway", email: null },
        userId: "j8b-wren",
        userName: "Wren Halloway",
        submittedAt: new Date().toISOString(),
      } as any);
      // The neighbour, on the same seat, with every kind of line.
      const ashSeat = await seat("j8b-water", "Ash Grey");
      const ashLines = [
        "seated Ash Grey",
        'Ash asks to be confirmed as the holder recorded "Ash Grey"',
        'confirmed: the holder recorded "Ash Grey" is a member here',
      ];
      await line("j8b-water", ashLines[0], "seat-steward", "org");
      await line("j8b-water", ashLines[1], "j8b-ash");
      await line("j8b-water", ashLines[2], "seat-steward");
      expect(await claimSeating(pool, ashSeat, "j8b-ash")).toBe(true);

      const before = [...(await journalOf("j8b-water")), ...(await journalOf("j8b-fire")), ...(await journalOf("j8b-earth"))];
      expect(before.filter((t) => t.includes("Halloway")), "the fixture must put the name there").toHaveLength(6);

      await erase("j8b-wren");

      const water2 = await journalOf("j8b-water");
      const fire2 = await journalOf("j8b-fire");
      const earth2 = await journalOf("j8b-earth");
      for (const text of [...water2, ...fire2, ...earth2]) {
        expect(text, "no line on a seat of theirs still names them").not.toMatch(/Wren|Halloway/);
      }
      // The lines stay, so the journal still says what happened to each seat.
      expect(water2.length + fire2.length + earth2.length, "every line is still there").toBe(before.length);
      for (const kept of ashLines) expect(water2, "a neighbour's line on the same seat is untouched").toContain(kept);
    });

    it("finds the names when the seatings had already given them up, as an older sweep left them", async () => {
      await person("j8c-wren", "Wren Halloway");
      const water = await seat("j8c-water", "Wren Halloway");
      await line("j8c-water", "seated Wren Halloway", "seat-steward", "org");
      await line("j8c-water", 'Wren asks to be confirmed as the holder recorded "Wren Halloway"', "j8c-wren");
      await line("j8c-water", 'confirmed: the holder recorded "Wren Halloway" is a member here', "seat-steward");
      expect(await claimSeating(pool, water, "j8c-wren")).toBe(true);
      // Recorded under the first name only, the way the seed records holders, with no ask behind it.
      const fire = await seat("j8c-fire", "Wren");
      await line("j8c-fire", "seated Wren", "seat-steward", "org");
      await line("j8c-fire", 'confirmed: the holder recorded "Wren" is a member here', "seat-steward");
      expect(await claimSeating(pool, fire, "j8c-wren")).toBe(true);
      // What "org-seatings" did before it read the journal: the names are off the seatings already.
      await releaseSeatingsForUser(pool, "j8c-wren", "member left the village");
      expect((await seatingRow(water)).display_name).toBeNull();
      expect([...(await journalOf("j8c-water")), ...(await journalOf("j8c-fire"))].filter((t) => /Wren|Halloway/.test(t))).toHaveLength(5);

      await erase("j8c-wren");

      for (const text of [...(await journalOf("j8c-water")), ...(await journalOf("j8c-fire"))]) {
        expect(text, "the ask they wrote and their own name still find every line").not.toMatch(/Wren|Halloway/);
      }
    });
  });

  // ── 9 ─────────────────────────────────────────────────────────────────────
  describe("9: an open seat claim", () => {
    it("closes the ask and takes the recorded name off it, so the stewards' queue stops offering it", async () => {
      await person("c9-wren", "Wren Halloway");
      await person("c9-ash", "Ash Grey");
      const wrens = await seat("c9-water", "Wren Halloway");
      const ashs = await seat("c9-water", "Ash Grey");
      viewer = { id: "c9-wren", name: "Wren Halloway", email: "c9-wren@example.test" };
      expect((await call("POST /api/org/seatings/:id/claim", { params: { id: wrens } })).status).toBe(200);
      viewer = { id: "c9-ash", name: "Ash Grey", email: "c9-ash@example.test" };
      expect((await call("POST /api/org/seatings/:id/claim", { params: { id: ashs } })).status).toBe(200);
      viewer = { id: "seat-steward", name: "Sam Steward" };
      const queued = (await call("GET /api/org/seat-claims")).body.map((a: any) => a.userId);
      expect(queued, "both asks are in front of the steward").toEqual(expect.arrayContaining(["c9-wren", "c9-ash"]));

      await erase("c9-wren");

      const queue = (await call("GET /api/org/seat-claims")).body as any[];
      expect(queue.map((a) => a.userId), "the departed member's ask is gone from the queue").not.toContain("c9-wren");
      expect(queue.map((a) => a.userId), "the neighbour's ask is still there").toContain("c9-ash");
      const [row] = (submissionsRepo.all() as any[]).filter((s) => s.userId === "c9-wren");
      expect(row.status, "closed, the way a decline closes it").toBe("declined");
      expect(JSON.stringify(row), "the inbox row no longer restates them").not.toMatch(/Wren|Halloway|c9-wren@/);
      const [ash] = (submissionsRepo.all() as any[]).filter((s) => s.userId === "c9-ash");
      expect(ash.status).toBe("new");
      expect(ash.data.recordedName).toBe("Ash Grey");
    });

    it("refuses to confirm the seat for the member who left, and leaves the seating as it was recorded", async () => {
      await person("c9b-wren", "Wren Halloway");
      const seating = await seat("c9b-water", "Wren Halloway");
      viewer = { id: "c9b-wren", name: "Wren Halloway" };
      expect((await call("POST /api/org/seatings/:id/claim", { params: { id: seating } })).status).toBe(200);

      await erase("c9b-wren");

      viewer = { id: "seat-steward", name: "Sam Steward" };
      const confirmed = await call("POST /api/org/seatings/:id/claim/confirm", { params: { id: seating }, body: { userId: "c9b-wren" } });
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(409);
      expect(String(confirmed.body?.error)).toContain("left the village");
      const after = await seatingRow(seating);
      expect(after.holder_kind, "the seat stays documented").toBe("documented");
      expect(after.user_id, "and nobody's account holds it").toBeNull();
      expect(after.display_name).toBe("Wren Halloway");
    });

    it("refuses at the seat itself, whichever door asks, and still seats a living member", async () => {
      await person("c9c-wren", "Wren Halloway");
      await person("c9c-ash", "Ash Grey");
      await erase("c9c-wren");
      const seating = await seat("c9c-water", "Wren Halloway");
      expect(await claimSeating(pool, seating, "c9c-wren"), "a tombstone is never made a holder").toBe(false);
      expect((await seatingRow(seating)).holder_kind).toBe("documented");
      expect(await claimSeating(pool, seating, "c9c-ash"), "a living member still is").toBe(true);
    });

    it("refuses to seat the member who left through the admin seat door", async () => {
      await person("c9d-wren", "Wren Halloway");
      await erase("c9d-wren");
      await q("INSERT IGNORE INTO `org_roles` (`id`, `name`, `aim`, `seats`) VALUES ('c9d-water', 'Water', 'Keep it running.', 3)");
      viewer = { id: "seat-steward", name: "Sam Steward" };
      const r = await call("POST /api/admin/org/roles/:id/holders", {
        params: { id: "c9d-water" },
        body: { userId: "c9d-wren", termEndsOn: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10) },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(String(r.body?.error)).toContain("left the village");
      expect(await q("SELECT `id` FROM `org_role_assignments` WHERE `org_role_id` = 'c9d-water'")).toEqual([]);
    });

    it("ends a seat confirmed for them while the sweep was running", async () => {
      await person("c9e-wren", "Wren Halloway");
      const seating = await seat("c9e-water", "Wren Halloway");
      // A steward presses Confirm after "org-seatings" ran and before the tombstone.
      beforeTombstone = async () => {
        expect(await claimSeating(pool, seating, "c9e-wren"), "the fixture must seat them in the window").toBe(true);
      };

      await erase("c9e-wren");

      const after = await seatingRow(seating);
      expect(after.ended_at, "the holding the window made is ended").not.toBeNull();
      expect(after.display_name, "and the recorded name is off it").toBeNull();
    });
  });

  // ── 10 ────────────────────────────────────────────────────────────────────
  describe("10: a permission role", () => {
    it("ends a holding that lands between the role-holdings step and the tombstone", async () => {
      await person("p10-wren", "Wren Halloway");
      await person("p10-ash", "Ash Grey");
      holders = [{ id: "rh-ash", roleId: "steward", userId: "p10-ash" }];
      // A carried role_seat lands in the window, while the member is not yet a tombstone.
      beforeTombstone = async () => {
        holders = [...holders, { id: "rh-wren", roleId: "steward", userId: "p10-wren" }];
      };

      await erase("p10-wren");

      expect(holders.map((h) => h.userId), "the departed member holds nothing; the neighbour keeps theirs").toEqual(["p10-ash"]);
    });
  });

  // ── 12 (round 3) ──────────────────────────────────────────────────────────
  describe("12: a documented holder who is forgotten", () => {
    it("records the seating with no name in the journal, and once they are forgotten no account reads their name there", async () => {
      await q("INSERT IGNORE INTO `org_roles` (`id`, `name`, `aim`, `seats`) VALUES ('d12-bakers', 'Bakers', 'Bread for the long table.', 3)");
      viewer = { id: "seat-steward", name: "Sam Steward" };
      const seated = await call("POST /api/admin/org/roles/:id/holders", {
        params: { id: "d12-bakers" },
        body: { displayName: "Maria Lopez", termEndsOn: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10) },
      });
      expect(seated.status, JSON.stringify(seated.body)).toBe(200);
      // The route writes its line fire-and-forget, so wait for it to land.
      let lines: string[] = [];
      for (let i = 0; i < 50 && lines.length === 0; i++) {
        lines = await journalOf("d12-bakers");
        if (lines.length === 0) await new Promise((r) => setTimeout(r, 20));
      }
      expect(lines, "the seat's journal says it changed hands, and names nobody").toEqual([SEAT_JOURNAL_LINE.seated]);

      const [{ id: seating }] = await q("SELECT `id` FROM `org_role_assignments` WHERE `org_role_id` = 'd12-bakers'");
      expect((await forgetDocumentedHolder(pool, String(seating), "forgotten at their request")).found).toBe(true);

      // Any account at the guest rung holds map.viewPeople, the journal's door.
      viewer = { id: "d12-guest", name: "Gale Guest" };
      const read = await call("GET /api/org/:kind/:id/journal", { params: { kind: "roles", id: "d12-bakers" } });
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect(read.body.map((r: any) => r.text), "the line stays, so the seat's history does").toEqual([SEAT_JOURNAL_LINE.seated]);
      expect(JSON.stringify(read.body)).not.toMatch(/Maria|Lopez/);
    });
  });
});
