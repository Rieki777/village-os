/**
 * WHO THE MEMBER WAS, and the ways an erasure used to forget it.
 *
 * ── A RESUME AFTER THE TOMBSTONE ─────────────────────────────────────────
 *
 * The tombstone rewrites the user row: the name becomes "A departed member",
 * the address `deleted-<id>@anonymized.invalid`, the handle `departed-<id>`.
 * Every step after it that matches the member by name or address (the comms
 * address book, the alignment words) was handed the row as it stood when the
 * sweep began, which is right on a first run. A resume re-reads the row, so it
 * got the tombstone: the address matched nothing, the scrub went looking for
 * "A departed member", and the record still read finished. The hourly job
 * resumes exactly these sweeps on its own.
 *
 * ── A RESUME BEFORE THE TOMBSTONE ────────────────────────────────────────
 *
 * Until the tombstone the account works, so a member whose sweep stopped at
 * "portraits" can still send a contact request, thank somebody or tag a skill.
 * The resume skipped every step already recorded as done, so those words
 * stood for good. `member-agent-after-tombstone` fixed that for the agent
 * tables only.
 *
 * ── A SAVE ALREADY PAST ITS SESSION CHECK ────────────────────────────────
 *
 * `PUT /api/profile` checks the session once, then writes under the row lock.
 * A save that passed the check before the tombstone and took the lock after
 * it wrote the member's real name and handle back onto the tombstone, and
 * every surface that de-attributes through the join printed them again.
 *
 * ── WHAT THIS FILE ASSERTS ───────────────────────────────────────────────
 *
 * ROWS, and every fixture proves its rows landed before the erasure is asked
 * to remove them. A real database, for the reason `erasure.test.ts` gives. No
 * TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { anonymizeMember, resumeErasure, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord, unfinishedErasures } from "../repos/memberErasure";
import * as portraits from "../repos/characterPortraits";
import { register as registerProfileRoutes } from "../routes/profile";

const configured = testDbConfigured();
const VILLAGE = "local";
const ANON = "A departed member";
const NAME = "Wren Halloway";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir: string;

/**
 * The real users repository, so the tombstone is a real write, with one seam
 * for "the tombstone has just landed". The third argument is passed through,
 * because the tombstone step is the one writer allowed to change a tombstone.
 */
function deps(afterTombstone?: () => void): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: {
      byId: (id: string) => real.byId(id),
      update: async (id: string, fn: (u: any) => void, opts?: any) => {
        const out = await (real.update as any)(id, fn, opts);
        afterTombstone?.();
        return out;
      },
    },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

async function q(sql: string, params: any[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

/**
 * The suite's pool with ONE statement refused, once, after the tombstone.
 *
 * Armed by the tombstone landing, so the refusal falls on the first step after
 * it whatever that step's SQL shares with an earlier one. Every other call,
 * `getConnection` included, goes to the real pool.
 */
function refuseOnceAfterTombstone(pattern: RegExp) {
  let armed = false;
  let fired = false;
  const proxy = new Proxy(pool, {
    get(target, prop) {
      if (prop === "query") {
        return (sql: any, params?: any) => {
          const text = typeof sql === "string" ? sql : String(sql?.sql ?? "");
          if (armed && !fired && pattern.test(text)) {
            fired = true;
            return Promise.reject(new Error("the agent sweep was refused"));
          }
          return (target.query as any)(sql, params);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { pool: proxy as mysql.Pool, arm: () => void (armed = true), fired: () => fired };
}

const onVolume = (id: string) => path.join(uploadsDir, `portrait-${id}.webp`);

/** A member with a handle, a real address and a portrait on the volume. */
async function seedMember(id: string, handle: string): Promise<any> {
  await q(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`, `bio`) VALUES (?,?,?,'x',?,?) " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, NAME, `${id}@examples.invalid`, handle, "I keep bees by the pond."],
  );
  const fileName = `portrait-${id}.webp`;
  fs.writeFileSync(onVolume(id), Buffer.from("not really a picture"));
  await portraits.upsertPortrait(pool, {
    id: `cp-${id}`,
    villageId: VILLAGE,
    userId: id,
    archetypeKey: "building",
    fileName,
    source: "uploaded",
    width: 512,
    height: 512,
    bytes: 20,
  });
  return usersRepo(pool).byId(id);
}

async function seedNeighbour(id: string): Promise<void> {
  await q(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, "Ned Okafor", `${id}@examples.invalid`],
  );
}

/** The identity column, read raw: no reader in the app returns it. */
async function heldIdentity(id: string): Promise<unknown> {
  const rows = await q("SELECT `erased_identity` AS v FROM `member_erasures` WHERE `user_id` = ?", [id]);
  return rows[0]?.v ?? null;
}

/** The handlers `register` mounts, by "METHOD path", called with a plain request. */
function profileRoutes(authedUser: () => Promise<any>) {
  const routes = new Map<string, (req: any, res: any) => Promise<unknown>>();
  const app = {
    get: (p: string, h: any) => routes.set(`GET ${p}`, h),
    put: (p: string, h: any) => routes.set(`PUT ${p}`, h),
    post: (p: string, h: any) => routes.set(`POST ${p}`, h),
  } as any;
  registerProfileRoutes(app, { authedUser: authedUser as any, members: usersRepo(pool), publicUser: (u: any) => u });
  return async (key: string, body: Record<string, unknown>) => {
    const out: { status: number; body: any } = { status: 200, body: null };
    const res: any = {
      status: (s: number) => ((out.status = s), res),
      json: (b: any) => ((out.body = b), res),
    };
    await routes.get(key)!({ body, headers: {} }, res);
    return out;
  };
}

describe.skipIf(!configured)("an erasure remembers who the member was until it finishes", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-identity-"));
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  beforeEach(async () => {
    // No driver is registered, so the external step asks nobody. These cases
    // are about the local sweep.
    clearMemberDrivers();
    await q("DELETE FROM `member_erasures`");
  });

  /**
   * The first attempt lands the tombstone and the very next step is refused,
   * so every step that matches the member by name or address is left to a
   * resume, which reads the tombstone.
   */
  async function stopRightAfterTombstone(id: string, target: any): Promise<void> {
    const flaky = refuseOnceAfterTombstone(/DELETE FROM `agent_deliveries`/);
    await expect(anonymizeMember(flaky.pool, target, null, deps(flaky.arm))).rejects.toThrow(/the agent sweep was refused/);
    expect(flaky.fired(), "the refusal must land after the tombstone, or this is a different case").toBe(true);
    const stopped = await erasureRecord(pool, id);
    expect(stopped!.stepsDone).toContain("tombstone");
    expect(stopped!.failedStep).toBe("member-agent-after-tombstone");
    // The row no longer knows who this was.
    const row = await usersRepo(pool).byId(id);
    expect(row!.name).toBe(ANON);
    expect(row!.email).toBe(`deleted-${id}@anonymized.invalid`);
  }

  it("finds the member by their old address on a resume after the tombstone (findings 14 and 23)", async () => {
    const id = "er-ident-1";
    const address = `${id}@examples.invalid`;
    const target = await seedMember(id, "wrenh");

    // Matched only by address: the housing form made this contact before Wren
    // had an account, and an unsubscribe is the address under another name.
    await q(
      "INSERT INTO `comms_contacts` (`id`, `village_id`, `email_key`, `email`, `name`, `user_id`, `first_source`) VALUES (?,?,?,?,?,NULL,'housing')",
      [`cc-${id}`, VILLAGE, address, address, NAME],
    );
    await q("INSERT INTO `comms_suppressions` (`village_id`, `email_key`, `reason`) VALUES (?,?,'unsubscribed_all')", [VILLAGE, address]);

    await stopRightAfterTombstone(id, target);
    // The hourly job, or a steward, finishes it.
    const out = await resumeErasure(pool, id, deps());
    expect(out.finished).toBe(true);
    expect(out.ran, "a resume after the close skips what it already did").not.toContain("tombstone");

    expect(
      await q("SELECT `id` FROM `comms_contacts` WHERE `email_key` = ?", [address]),
      "a resumed sweep matched nothing by the member's old address",
    ).toEqual([]);
    expect(await q("SELECT `email_key` FROM `comms_suppressions` WHERE `email_key` = ?", [address])).toEqual([]);
    // Held while the obligation was open, and only then.
    expect(await heldIdentity(id), "the finished sweep must let go of who the member was").toBeNull();
  });

  it("scrubs the member's own name and handle on a resume after the tombstone (finding 15)", async () => {
    const id = "er-ident-3";
    const target = await seedMember(id, "wrenh");
    await seedNeighbour("er-ident-ned");
    // Matched only by name and handle: another member's own words.
    await q(
      "INSERT INTO `seat_applications` (`id`, `candidate_user_id`, `proposed_by`, `seat_ids`, `note`, `settings_json`, `settings_hash`, `term_ends_at`, `status`) " +
        "VALUES (?,?,?,?,?,?,?,?,?)",
      [
        "sa-00000000000000a1",
        "er-ident-ned",
        "er-ident-ned",
        JSON.stringify(["seat-orchard"]),
        `I would co-hold this with ${NAME}; ask @wrenh about the hives.`,
        JSON.stringify({ v: 1 }),
        "a".repeat(64),
        "2029-06-30 00:00:00",
        "voting",
      ],
    );

    await stopRightAfterTombstone(id, target);
    const out = await resumeErasure(pool, id, deps());
    expect(out.finished).toBe(true);

    const [app] = await q("SELECT `note` FROM `seat_applications` WHERE `id` = 'sa-00000000000000a1'");
    expect(app.note, "a resumed sweep scrubbed the tombstone's name instead of the member's").not.toContain(NAME);
    expect(app.note).not.toContain("@wrenh");
    expect(app.note).toContain("a former member");
  });

  it("holds who the member was only while the sweep is open, and never in what the queue reads", async () => {
    const id = "er-ident-2";
    const address = `${id}@examples.invalid`;
    const target = await seedMember(id, "wrenh2");
    await q(
      "INSERT INTO `comms_contacts` (`id`, `village_id`, `email_key`, `email`, `name`, `user_id`, `first_source`) VALUES (?,?,?,?,?,NULL,'housing')",
      [`cc-${id}`, VILLAGE, address, address, NAME],
    );

    const flaky = refuseOnceAfterTombstone(/DELETE FROM `agent_deliveries`/);
    await expect(anonymizeMember(flaky.pool, target, null, deps(flaky.arm))).rejects.toThrow();
    // The comms step sits after the refusal, so the contact is still there.
    expect(await q("SELECT `id` FROM `comms_contacts` WHERE `email_key` = ?", [address])).toHaveLength(1);

    const held = await heldIdentity(id);
    const parsed = typeof held === "string" ? JSON.parse(held) : held;
    expect(parsed).toEqual({ name: NAME, email: address, handle: "wrenh2" });
    // What /review and the failed-actions job read names a step, never a person.
    const queued = JSON.stringify([await erasureRecord(pool, id), ...(await unfinishedErasures(pool))]);
    expect(queued).not.toContain(address);
    expect(queued).not.toContain(NAME);

    // Asking again from the beginning, on the tombstone, keeps what the first
    // attempt held and finds the address with it.
    const tomb = await usersRepo(pool).byId(id);
    await anonymizeMember(pool, tomb, null, deps());
    expect(await q("SELECT `id` FROM `comms_contacts` WHERE `email_key` = ?", [address])).toEqual([]);
    expect(await heldIdentity(id)).toBeNull();
    expect((await erasureRecord(pool, id))!.finishedAt).not.toBeNull();
  });

  it("re-runs every step before the close on a resume, so words written while the account still worked go too (findings 16 and 27)", async () => {
    const id = "er-second-pass-1";
    const ned = "er-second-pass-ned";
    const target = await seedMember(id, "wrenh3");
    await seedNeighbour(ned);

    // A directory where the portrait was makes unlink refuse with something
    // other than ENOENT on every platform, so the sweep stops at "portraits",
    // before the tombstone, with the account still working.
    fs.rmSync(onVolume(id), { force: true });
    fs.mkdirSync(onVolume(id));
    await expect(anonymizeMember(pool, target, null, deps())).rejects.toThrow(/could not take .* off the volume/);
    const stopped = await erasureRecord(pool, id);
    expect(stopped!.failedStep).toBe("portraits");
    for (const step of ["gratitude-names", "notifications", "skill-tags", "concierge-queries", "contact-requests", "character-sheet"]) {
      expect(stopped!.stepsDone, `the window only exists once ${step} is recorded as done`).toContain(step);
    }
    expect(stopped!.stepsDone).not.toContain("tombstone");

    // Still signed in, so each of these is a write a request could make.
    await q(
      "INSERT INTO `notifications` (`id`, `user_id`, `type`, `title`, `body`, `actor_user_id`, `dedupe_key`) VALUES (?,?,?,?,?,?,?)",
      [`n-${id}`, ned, "contact", "Wren wants to connect", "Call me on 555 0100", id, `contact:${id}:${ned}`],
    );
    await q(
      "INSERT INTO `contact_requests` (`id`, `from_user_id`, `to_user_id`, `message`, `idempotency_key`) VALUES (?,?,?,?,?)",
      [`cr-${id}`, id, ned, "Call me on 555 0100", `cr-${id}`],
    );
    await q("INSERT INTO `gratitude_log` (`id`, `from_id`, `from_name`, `to_id`, `to_name`, `amount`, `cycle_id`) VALUES (?,?,?,?,?,1,'cycle-1')", [
      `g-${id}`,
      id,
      NAME,
      ned,
      "Ned Okafor",
    ]);
    await q("INSERT INTO `skill_tags` (`id`, `user_id`, `tag`) VALUES (?,?,?)", [`st-${id}`, id, "beekeeping"]);
    await q("INSERT INTO `concierge_queries` (`id`, `user_id`, `query`) VALUES (?,?,?)", [`cq-${id}`, id, "who keeps bees near the pond"]);
    await q(
      "INSERT INTO `player_characters` (`id`, `village_id`, `user_id`, `archetype_key`, `presentation`, `tone`) VALUES (?,?,?,?,?,?)",
      [`pc-${id}`, VILLAGE, id, "building", "f", "olive"],
    );

    // Whatever stood in the way clears, and a steward presses retry.
    fs.rmdirSync(onVolume(id));
    const out = await resumeErasure(pool, id, deps());
    expect(out.finished).toBe(true);

    const [note] = await q("SELECT `title`, `body`, `actor_user_id` FROM `notifications` WHERE `id` = ?", [`n-${id}`]);
    expect(note, "a resume before the close left the member's words in a neighbour's bell").toEqual({
      title: "A message from a departed member",
      body: null,
      actor_user_id: null,
    });
    expect((await q("SELECT `message` FROM `contact_requests` WHERE `id` = ?", [`cr-${id}`]))[0].message).toBe("[removed with the member]");
    expect((await q("SELECT `from_name` FROM `gratitude_log` WHERE `id` = ?", [`g-${id}`]))[0].from_name).toBe(ANON);
    expect(await q("SELECT `id` FROM `skill_tags` WHERE `user_id` = ?", [id])).toEqual([]);
    expect(await q("SELECT `query`, `user_id` FROM `concierge_queries` WHERE `id` = ?", [`cq-${id}`])).toEqual([
      { query: "[removed with the member]", user_id: null },
    ]);
    expect(await q("SELECT `id` FROM `player_characters` WHERE `user_id` = ?", [id])).toEqual([]);
    // From the top: before the close, a step recorded as done proves nothing.
    expect(out.ran[0]).toBe("ledger-descriptions");
    expect(out.ran.indexOf("notifications")).toBeLessThan(out.ran.indexOf("tombstone"));
  });

  it("refuses a profile save that passed its session check before the tombstone and wrote after it (finding 1)", async () => {
    const id = "er-profile-race-1";
    const target = await seedMember(id, "wrenh4");

    // The session check reads the live member, and the erasure lands before
    // the save takes the row lock: the request already in flight.
    const call = profileRoutes(async () => {
      const stale = await usersRepo(pool).byId(id);
      await anonymizeMember(pool, target, null, deps());
      return stale;
    });
    const res = await call("PUT /api/profile", { name: NAME, handle: "wren-again", bio: "I keep bees by the pond." });

    const after = await usersRepo(pool).byId(id);
    expect(after!.name, "a save in flight wrote the member's name back onto the tombstone").toBe(ANON);
    expect(after!.handle).toBe(`departed-${id.slice(-8)}`);
    expect(after!.bio).toBe("");
    expect(res.status).toBe(401);
  });

  it("refuses a contribution note that passed its session check before the tombstone (finding 1)", async () => {
    const id = "er-profile-race-2";
    const target = await seedMember(id, "wrenh5");
    const call = profileRoutes(async () => {
      const stale = await usersRepo(pool).byId(id);
      await anonymizeMember(pool, target, null, deps());
      return stale;
    });
    const res = await call("POST /api/profile/contribution", { type: "note", description: "Wren Halloway mended the bench." });

    expect((await usersRepo(pool).byId(id))!.contributions).toEqual([]);
    expect(res.status).toBe(401);
  });

  it("keeps a tombstone's identity fixed against every writer but the erasure, while value still moves (finding 1)", async () => {
    const id = "er-pin-1";
    const target = await seedMember(id, "wrenh6");
    await anonymizeMember(pool, target, null, deps());
    const repo = usersRepo(pool);

    const written = await repo.update(id, (u: any) => {
      u.name = NAME;
      u.handle = "wrenh6";
      u.email = `${id}@examples.invalid`;
      u.bio = "I keep bees by the pond.";
      u.prefs = { googleLink: "sealed" };
      u.walletAddress = "0xabc";
      u.role = "founder";
      u.recognitionBalance = 7;
    });

    const after = await repo.byId(id);
    expect(after!.name, "a write after the tombstone put the member's name back").toBe(ANON);
    expect(after!.handle).toBe(`departed-${id.slice(-8)}`);
    expect(after!.email).toBe(`deleted-${id}@anonymized.invalid`);
    expect(after!.bio).toBe("");
    expect(after!.prefs).toEqual({});
    expect(after!.walletAddress).toBeNull();
    expect(after!.role).toBe("member");
    // A value row the village keeps still moves: a gratitude settled to them lands.
    expect(after!.recognitionBalance).toBe(7);
    // And what the caller is handed back is what was stored.
    expect(written!.name).toBe(ANON);

    // The erasure itself may still write: a second erasure clears what a first one missed.
    await repo.update(id, (u: any) => void (u.prefs = { cleared: true }), { erasure: true });
    expect((await repo.byId(id))!.prefs).toEqual({ cleared: true });
  });

  it("leaves a living member's own saves alone", async () => {
    const id = "er-pin-2";
    await seedMember(id, "wrenh7");
    const call = profileRoutes(async () => usersRepo(pool).byId(id));
    const res = await call("PUT /api/profile", { name: "Wren H.", bio: "Bees, still." });
    expect(res.status).toBe(200);
    const after = await usersRepo(pool).byId(id);
    expect(after!.name).toBe("Wren H.");
    expect(after!.bio).toBe("Bees, still.");
  });
});
