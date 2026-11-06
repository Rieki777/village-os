/**
 * WHAT A MEMBER WHO LEFT STILL HELD IN A CREW, AND STILL SAID IN A PHOTO
 * REPORT (adversarial round 4, findings R4-10 and R4-11).
 *
 *  R4-10. Nothing in the erasure touched `quest_crew_members`, so the
 *         tombstone kept its place in every crew. A full crew answered the
 *         next person's invite with 409 "That crew is full", and
 *         `GET /api/quests/:id/crews`, open to anyone signed in, listed the
 *         tombstone as "A" (the first name of "A departed member"). A crew
 *         the leaver held alone stayed open with nobody in it.
 *  R4-11. The words a member typed on a place-photo report stayed in the
 *         curators' queue, which a non-admin holder of `map.curatePhotos`
 *         reads. A subject request is often the person's own name.
 *
 * Both are driven through the real routes, with a neighbour whose rows of the
 * same shape must come through untouched, and every case reads the leftover
 * first, so a pass after the sweep is about rows that were there.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { anonymizeMember, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { crewsRepo } from "./crews";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import { dbCollection } from "../repos/store-db";
import * as placePhotosRepo from "../repos/placePhotos";
import { register as registerQuests } from "../routes/quests";
import { register as registerPlaces } from "../routes/places";

const configured = testDbConfigured();

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";
let submissionsRepo: ReturnType<typeof dbCollection>;
let handlers: Map<string, Handler>;
/** Whoever the request is signed in as. Set per case. */
let viewer: any = null;

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

async function person(id: string, name: string): Promise<any> {
  await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [id, name, `${id}@example.test`]);
  return usersRepo(pool).byId(id);
}

function deps(): ErasureDeps {
  return {
    members: usersRepo(pool) as unknown as ErasureDeps["members"],
    submissionsRepo: submissionsRepo as unknown as ErasureDeps["submissionsRepo"],
    roleHoldersRepo: { remove: async () => {} },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

async function erase(id: string): Promise<void> {
  const target = await usersRepo(pool).byId(id);
  expect(target, `${id} must exist before it is erased`).toBeTruthy();
  await anonymizeMember(pool, target, "crew-admin", deps());
  expect((await erasureRecord(pool, id))?.finishedAt, `${id}'s sweep must finish`).toBeTruthy();
}

function collect(): { app: any; handlers: Map<string, Handler> } {
  const out = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    out.set(`${method} ${p}`, handler);
  };
  // `use` is the module gate in front of a router; the handlers are called directly here.
  const use = () => {};
  return { app: { use, get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") }, handlers: out };
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

const firstName = (name: string) => String(name ?? "").trim().split(/\s+/)[0] || "Someone";

describe.skipIf(!configured)("the erasure and a member's crews and photo reports (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db);
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "erasure-crews-"));
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
    const users = usersRepo(pool);
    const wired = collect();
    const authedUser = async () => viewer;
    registerQuests(wired.app, {
      authedUser,
      members: users,
      crewsRepo: crewsRepo(pool),
      firstName,
      getPool: () => pool,
    } as any);
    registerPlaces(wired.app, {
      authedUser,
      // A curator by role, never an admin: the reader the finding names.
      capabilityCtx: async () => ({ stageIndex: 0, stageIndexOf: () => 0, roleCapabilities: ["map.curatePhotos"] }),
      mayStillSee: async () => true,
      guardCapability: async () => true,
      members: users,
      notify: async () => {},
      notifyReportReviewed: async () => {},
      getPool: () => pool,
      uploadsDir,
    } as any);
    handlers = wired.handlers;
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
  });

  describe("R4-10: their place in a quest crew", () => {
    it("a full crew of 3 admits the next joiner once a member is erased, and the roster no longer lists them", async () => {
      const ann = await person("crew-ann", "Ann Field");
      await person("crew-wren", "Wren Halloway");
      await person("crew-bo", "Bo Marsh");
      const cy = await person("crew-cy", "Cy Rowan");
      const crews = crewsRepo(pool);
      const crew = await crews.create({ id: "crew-full", questId: "q-crew", name: "The Thursday Crew", creatorId: ann.id, maxSize: 3 });
      expect(await crews.join(crew.id, "crew-wren")).toBe("joined");
      expect(await crews.join(crew.id, "crew-bo")).toBe("joined");
      // The leftover first: the crew is full, and Cy is refused.
      viewer = cy;
      expect((await call("POST /api/crews/join/:code", { params: { code: crew.inviteCode } })).status).toBe(409);

      await erase("crew-wren");

      expect(await q("SELECT 1 FROM `quest_crew_members` WHERE `user_id` = ?", ["crew-wren"])).toHaveLength(0);
      const joined = await call("POST /api/crews/join/:code", { params: { code: crew.inviteCode } });
      expect(joined.status, JSON.stringify(joined.body)).toBe(200);
      expect(joined.body.already).toBe(false);

      viewer = ann;
      const listed = await call("GET /api/quests/:id/crews", { params: { id: "q-crew" } });
      expect(listed.status).toBe(200);
      const names = listed.body.find((c: any) => c.id === crew.id).members.map((m: any) => m.name);
      expect(names).not.toContain("A");
      expect(names.sort()).toEqual(["Ann", "Bo", "Cy"]);
      // The neighbours kept their places, and the crew stayed whole.
      expect((await crews.byId(crew.id))!.status).toBe("active");
    });

    it("a crew they were alone in disbands, a crew they founded with others stays, and a neighbour's empty crew is left alone", async () => {
      await person("crew-solo", "Wren Solo");
      const mate = await person("crew-mate", "Mae Tern");
      const crews = crewsRepo(pool);
      const alone = await crews.create({ id: "crew-alone", questId: "q-crew-2", name: "Just me", creatorId: "crew-solo", maxSize: 3 });
      const founded = await crews.create({ id: "crew-founded", questId: "q-crew-2", name: "Wren's crew", creatorId: "crew-solo", maxSize: 3 });
      expect(await crews.join(founded.id, mate.id)).toBe("joined");
      // A neighbour's crew with nobody in it for some other reason: not theirs to close.
      await crews.create({ id: "crew-neighbour", questId: "q-crew-2", name: "Elsewhere", creatorId: mate.id, maxSize: 3 });
      await q("DELETE FROM `quest_crew_members` WHERE `crew_id` = ?", ["crew-neighbour"]);
      expect(await q("SELECT 1 FROM `quest_crew_members` WHERE `user_id` = ?", ["crew-solo"])).toHaveLength(2);

      await erase("crew-solo");

      expect((await crews.byId(alone.id))!.status).toBe("disbanded");
      const kept = (await crews.byId(founded.id))!;
      expect(kept.status).toBe("active");
      expect(kept.members.map((m) => m.userId)).toEqual([mate.id]);
      // crewsRepo has no founder handover (a founder who leaves simply leaves),
      // so creator_id stays as the historical id it is. Nothing renders it.
      expect(kept.creatorId).toBe("crew-solo");
      expect((await crews.byId("crew-neighbour"))!.status).toBe("forming");

      viewer = mate;
      const listed = await call("GET /api/quests/:id/crews", { params: { id: "q-crew-2" } });
      expect(listed.body.map((c: any) => c.id)).not.toContain(alone.id);
      expect(listed.body.find((c: any) => c.id === founded.id).members.map((m: any) => m.name)).toEqual(["Mae"]);
    });
  });

  describe("R4-11: the words on their photo reports", () => {
    it("clears the reason and keeps the report, its kind and status, and the photo still dark", async () => {
      await person("pr-wren", "Wren Oak");
      const neighbour = await person("pr-neighbour", "Ned Hollis");
      const curator = await person("pr-curator", "Cass Curator");
      await placePhotosRepo.insertPhoto(pool, {
        id: "photo-1",
        villageId: "local",
        structureKey: "hall",
        url: "/api/uploads/photo-1.webp",
        thumbUrl: null,
        altText: "People at the hall",
        caption: null,
        takenOn: null,
        width: null,
        height: null,
        bytes: null,
        contributorId: neighbour.id,
      });
      const words = "This is me at the solstice gathering, I'm Wren Oak, please take it down";
      await placePhotosRepo.insertReport(pool, { id: "pr-subject", villageId: "local", photoId: "photo-1", reporterId: "pr-wren", kind: "subject", reason: words });
      await placePhotosRepo.insertReport(pool, { id: "pr-concern", villageId: "local", photoId: "photo-1", reporterId: "pr-wren", kind: "concern", reason: "Wren Oak again" });
      await placePhotosRepo.insertReport(pool, { id: "pr-other", villageId: "local", photoId: "photo-1", reporterId: neighbour.id, kind: "concern", reason: "A neighbour's own words" });
      expect(await placePhotosRepo.hidePhoto(pool, "photo-1", "subject", "a person asked for their own image to come down")).toBe(true);

      // The leftover first: the curator reads her words.
      viewer = curator;
      const before = await call("GET /api/places/reports", { query: {} });
      expect(before.status).toBe(200);
      expect(JSON.stringify(before.body)).toContain("Wren Oak");

      await erase("pr-wren");

      const rows = await q("SELECT `id`, `kind`, `status`, `reason`, `photo_id`, `resolved_by` FROM `place_photo_reports` ORDER BY `id`");
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get("pr-subject")).toMatchObject({ kind: "subject", status: "open", reason: null, photo_id: "photo-1", resolved_by: null });
      expect(byId.get("pr-concern")).toMatchObject({ kind: "concern", status: "open", reason: null, photo_id: "photo-1" });
      expect(byId.get("pr-other")!.reason).toBe("A neighbour's own words");
      const [photo] = await q("SELECT `hidden_at`, `removed_at` FROM `place_photos` WHERE `id` = ?", ["photo-1"]);
      expect(photo.hidden_at).not.toBeNull();
      expect(photo.removed_at).toBeNull();

      const after = await call("GET /api/places/reports", { query: {} });
      expect(after.status).toBe(200);
      const theirs = after.body.reports.filter((r: any) => r.id === "pr-subject" || r.id === "pr-concern");
      expect(theirs).toHaveLength(2);
      for (const r of theirs) {
        expect(r.reason).toBeNull();
        expect(r.photoHidden).toBe(true);
      }
      expect(JSON.stringify(after.body)).not.toContain("Wren");
      expect(after.body.reports.find((r: any) => r.id === "pr-other").reason).toBe("A neighbour's own words");
    });
  });
});
