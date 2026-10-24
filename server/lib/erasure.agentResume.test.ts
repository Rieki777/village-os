/**
 * A member's agent written in the window between the "member-agent" step and
 * the tombstone, and what a resumed erasure does about it.
 *
 * ── THE WINDOW ───────────────────────────────────────────────────────────
 *
 * "member-agent" runs before the tombstone, and the tombstone is where the
 * member's sessions die. `POST /api/agent/tokens` and `PUT /api/agent/inbox`
 * write for anybody signed in, so a sweep that stops between the two (the
 * "portraits" step throws when a file will not come off the volume) leaves an
 * account that still works with "member-agent" already recorded as done. The
 * member mints a token or sets an inbox, a steward presses retry, the resume
 * skips "member-agent" by name, and the rows stand for good.
 *
 * The inbox is the sharp one: `agent-week-ahead` selected
 * `FROM agent_inboxes WHERE enabled = 1` with no join to `users`, so a departed
 * member's endpoint went on receiving the village's payloads. A token is dead
 * once its holder is a tombstone (`holderStands`), but the row keeps the label
 * the member gave it, which is the reason the sweep deletes tokens at all.
 *
 * A SECOND WINDOW comes after the whole sweep, for a request already past its
 * session check when the erasure ran. The cases under "written by a request
 * still in flight" let the sweep finish first and then make that write.
 *
 * ── WHAT THIS FILE ASSERTS ───────────────────────────────────────────────
 *
 * ROWS, never that a step ran. Every table `forgetAgentForMember` reaches is
 * written again inside the window, through the route's own write where that
 * write needs only the database, and the fixture proves the rows landed
 * before the erasure is asked to remove them. A zero over an empty table
 * proves nothing.
 *
 * A real database, for the reason `erasure.test.ts` gives: every claim here is
 * about rows. No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, untilALockIsAwaited, type TestDb } from "../db/testDb";
import { agentRowsRemaining, type AgentSweepCounts } from "../repos/memberAgent";
import { anonymizeMember, resumeErasure, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import * as portraits from "../repos/characterPortraits";
import { mintToken } from "./agentTokens";
import { drainDeliveries, enqueueAgentDelivery, queueWeekAhead, setInbox } from "./agentInbox";
import { MEMBER_SECRETS_ENV, memberKeyView, storeMemberKey } from "./memberSecrets";
import { isTombstone } from "./oauthAccounts";

const configured = testDbConfigured();
const VILLAGE = "local";
/** A member-secrets key, so an inbox has a secret and a key can be sealed. */
const SECRETS_ENV = { [MEMBER_SECRETS_ENV]: "ab".repeat(32) } as NodeJS.ProcessEnv;

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir: string;

const NONE: AgentSweepCounts = { deliveries: 0, inboxes: 0, keys: 0, drafts: 0, tokens: 0, profiles: 0, statements: 0 };
const ONE_OF_EACH: AgentSweepCounts = { deliveries: 1, inboxes: 1, keys: 1, drafts: 1, tokens: 1, profiles: 1, statements: 1 };

/** The real users repository, so the tombstone is a real write; one seam for "the last instant a session lives". */
function deps(beforeTombstone?: () => Promise<void>): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: {
      byId: (id: string) => real.byId(id),
      update: async (id: string, fn: (u: any) => void) => {
        await beforeTombstone?.();
        return real.update(id, fn);
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

const onVolume = (id: string) => path.join(uploadsDir, `portrait-${id}.webp`);

/** A member with a portrait on the volume, which is what the "portraits" step needs to have work to do. */
async function seedMember(id: string): Promise<any> {
  await q(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, "Wren Halloway", `${id}@examples.invalid`],
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

/**
 * Everything a still-signed-in member's agent can hold, written the way the
 * routes write it where that needs only the database.
 *
 * The token goes through `mintToken`, the function `POST /api/agent/tokens`
 * calls, and the delivery through `enqueueAgentDelivery`, the seam the weekly
 * jobs call. The inbox is a plain row because `setInbox` resolves the URL's
 * host over DNS before it writes, and a database test does not reach the
 * network. Every NOT NULL column is supplied: strict MySQL refuses a partial
 * row, and a refused fixture would leave the zeros below passing over nothing.
 */
async function writeAgentInTheWindow(id: string): Promise<void> {
  const minted = await mintToken(pool, id, { name: "laptop agent", scopes: ["calendar.read"] });
  expect(minted.ok, "the token must actually be minted, or the zero below proves nothing").toBe(true);
  await q("INSERT INTO `agent_inboxes` (`id`, `user_id`, `url`, `enabled`) VALUES (?,?,?,1)", [
    `inbox-${id}`,
    id,
    "https://example.test/hook",
  ]);
  const queued = await enqueueAgentDelivery(pool, id, { kind: "week_ahead", data: { note: "queued" } });
  expect(queued.ok, "the delivery must actually be queued for the inbox").toBe(true);
  await q(
    "INSERT INTO `member_llm_keys` (`user_id`, `provider`, `ciphertext`, `iv`, `tag`, `last4`) VALUES (?,?,?,?,?,?)",
    [id, "anthropic", "cipher", "iv", "tag", "abcd"],
  );
  await q(
    "INSERT INTO `member_drafts` (`id`, `user_id`, `kind`, `payload`, `source`, `status`) VALUES (?,?,?,?,?,?)",
    [`draft-${id}`, id, "note", JSON.stringify({ body: "unsent" }), "assistant", "proposed"],
  );
  await q("INSERT INTO `agent_profiles` (`user_id`, `about_me`, `about_tier`) VALUES (?,?,?)", [
    id,
    "I garden on Tuesdays.",
    "assistant",
  ]);
  await q("INSERT INTO `assistant_statements` (`id`, `subject_user_id`, `mode`, `text`) VALUES (?,?,?,?)", [
    `stmt-${id}`,
    id,
    "member",
    "You garden on Tuesdays.",
  ]);
}

describe.skipIf(!configured)("a member's agent written while an erasure is stopped part way", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-agent-"));
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

  it("is gone after the resume, when it was written after member-agent ran and before the tombstone", async () => {
    const id = "er-agent-window-1";
    const target = await seedMember(id);

    // A directory where the portrait was makes unlink refuse with something
    // other than ENOENT on every platform, so the sweep stops at "portraits",
    // after "member-agent" and before the tombstone.
    fs.rmSync(onVolume(id), { force: true });
    fs.mkdirSync(onVolume(id));
    await expect(anonymizeMember(pool, target, null, deps())).rejects.toThrow(/could not take .* off the volume/);

    const record = await erasureRecord(pool, id);
    expect(record!.failedStep).toBe("portraits");
    expect(record!.stepsDone, "the window only exists once member-agent is recorded as done").toContain("member-agent");
    expect(record!.stepsDone).not.toContain("tombstone");

    // The account still works, so these are writes a signed-in request could make.
    await writeAgentInTheWindow(id);
    expect(await agentRowsRemaining(pool, id), "the fixture must put rows in every table").toEqual(ONE_OF_EACH);

    // Whatever stood in the way clears, and a steward presses retry.
    fs.rmdirSync(onVolume(id));
    const out = await resumeErasure(pool, id, deps());

    expect(await agentRowsRemaining(pool, id), "a resumed erasure left the member's agent standing").toEqual(NONE);
    expect(out.finished).toBe(true);
    // The tombstone never landed, so the resume runs every step again from
    // the top (erasure.identity.test.ts covers the other tables), the first
    // pass included, and the second pass still follows the tombstone.
    expect(out.ran, "before the close, a resume runs the first pass again").toContain("member-agent");
    expect(out.ran.indexOf("member-agent-after-tombstone")).toBeGreaterThan(out.ran.indexOf("tombstone"));
  });

  it("is gone after one uninterrupted sweep, when it was written at the last instant a session lived", async () => {
    const id = "er-agent-window-2";
    const target = await seedMember(id);
    let wrote = false;

    await anonymizeMember(
      pool,
      target,
      null,
      deps(async () => {
        await writeAgentInTheWindow(id);
        wrote = true;
      }),
    );

    expect(wrote, "the fixture must have written, or the zeros below prove nothing").toBe(true);
    expect(await agentRowsRemaining(pool, id), "an erasure left the member's agent standing").toEqual(NONE);
    expect((await erasureRecord(pool, id))!.finishedAt).not.toBeNull();
  });

  /*
   * THE SECOND WINDOW, which no step of the sweep can close.
   *
   * A request checks its session once, at the start. `PUT /api/agent/inbox`
   * then waits on a DNS lookup the member's own nameserver can stretch to
   * seconds, and only then writes. If the sweep runs in that wait, the INSERT
   * lands after "member-agent-after-tombstone" has already deleted, for a
   * holder that is now a tombstone, and nothing sweeps again. So these cases
   * let the whole erasure finish FIRST and then make the write that was in
   * flight, and assert at the two ends that matter: the write refuses itself,
   * and nothing downstream sends to an inbox nobody stands behind.
   */
  describe("written by a request still in flight when the sweep finished", () => {
    beforeEach(async () => {
      // Each case reads what the drain sends across the whole schema, so a row
      // a case leaves behind must not show up as another case's post.
      await q("DELETE FROM `agent_deliveries`");
      await q("DELETE FROM `agent_inboxes`");
    });

    async function eraseFully(id: string): Promise<void> {
      await anonymizeMember(pool, await seedMember(id), null, deps());
      const record = await erasureRecord(pool, id);
      expect(record!.finishedAt, "the sweep must have finished, or this is the first window again").not.toBeNull();
      expect(record!.stepsDone).toContain("member-agent-after-tombstone");
      expect(isTombstone({ email: String((await usersRepo(pool).byId(id))!.email) })).toBe(true);
    }

    async function seedLiving(id: string): Promise<void> {
      await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [
        id,
        "Ash Morrow",
        `${id}@examples.invalid`,
      ]);
    }

    /** The INSERT a request in flight makes once its DNS answer comes back. */
    async function lateInbox(userId: string, url: string): Promise<string> {
      const inboxId = `inbox-${userId}`;
      await q("INSERT INTO `agent_inboxes` (`id`, `user_id`, `url`, `enabled`) VALUES (?,?,?,1)", [inboxId, userId, url]);
      return inboxId;
    }

    /** A delivery already queued for that inbox, so the drain has something to refuse. */
    async function queued(inboxId: string, kind: string): Promise<void> {
      await q(
        "INSERT INTO `agent_deliveries` (`id`, `inbox_id`, `kind`, `payload`, `attempts`, `next_attempt_at`) " +
          "VALUES (?,?,?,?,0,UTC_TIMESTAMP() - INTERVAL 1 MINUTE)",
        [`dlv-${inboxId}`, inboxId, kind, JSON.stringify({ calendar: "the village's signed-in week" })],
      );
    }

    /** The drain with a recording post: what would have gone out, and where. */
    async function drainRecording(): Promise<{ posts: Array<{ url: string; kind: string }>; summary: Awaited<ReturnType<typeof drainDeliveries>> }> {
      const posts: Array<{ url: string; kind: string }> = [];
      const summary = await drainDeliveries(pool, {
        post: async (url, body: any) => {
          posts.push({ url, kind: String(body?.kind) });
          return null;
        },
        notifyDisabled: async () => undefined,
        env: SECRETS_ENV,
        now: () => new Date(Date.now() + 60_000),
      });
      return { posts, summary };
    }

    it("the week-ahead job builds and queues nothing for an inbox that landed after the sweep, and still does for a living member", async () => {
      const gone = "er-agent-late-week";
      const alive = "er-agent-alive-week";
      await eraseFully(gone);
      await seedLiving(alive);
      await lateInbox(gone, "https://gone.example.test/hook");
      await lateInbox(alive, "https://alive.example.test/hook");

      const asked: string[] = [];
      const out = await queueWeekAhead(pool, {
        timezone: "UTC",
        build: async (userId) => {
          asked.push(userId);
          return [{ title: "Bread oven firing", location: "the commons" }];
        },
      });

      expect(asked.sort(), "the erased member's week must never even be built").toEqual([alive]);
      expect(out.queued).toBe(1);
      expect(await agentRowsRemaining(pool, gone), "the late inbox must not outlive the job that found it").toEqual(NONE);

      const { posts } = await drainRecording();
      expect(posts, "only the living member's agent hears about the week").toEqual([
        { url: "https://alive.example.test/hook", kind: "week_ahead" },
      ]);
    });

    it("the drain sends nothing to an inbox whose holder was erased or has no member row, removes it, and still sends a living member's", async () => {
      const gone = "er-agent-late-drain";
      const ghost = "er-agent-ghost-drain";
      const alive = "er-agent-alive-drain";
      await eraseFully(gone);
      await seedLiving(alive);
      await queued(await lateInbox(gone, "https://gone.example.test/hook"), "weekly_digest");
      await queued(await lateInbox(ghost, "https://ghost.example.test/hook"), "opportunity");
      await queued(await lateInbox(alive, "https://alive.example.test/hook"), "weekly_digest");

      const { posts, summary } = await drainRecording();

      expect(posts, "a tombstone's endpoint, or one with no member behind it, must hear nothing").toEqual([
        { url: "https://alive.example.test/hook", kind: "weekly_digest" },
      ]);
      expect(summary).toMatchObject({ sent: 1, dropped: 2 });
      expect(await agentRowsRemaining(pool, gone), "what the drain refused, it removes").toEqual(NONE);
      expect(await agentRowsRemaining(pool, ghost)).toEqual(NONE);
      const [delivered] = await q("SELECT `delivered_at` FROM `agent_deliveries` WHERE `id` = ?", ["dlv-inbox-er-agent-alive-drain"]);
      expect(delivered?.delivered_at, "the living member's delivery went out").toBeTruthy();
    });

    it("an enqueue for an erased member's late inbox answers no_inbox, for the digest and an opportunity alike", async () => {
      const gone = "er-agent-late-enqueue";
      const alive = "er-agent-alive-enqueue";
      await eraseFully(gone);
      await seedLiving(alive);
      await lateInbox(gone, "https://gone.example.test/hook");
      await lateInbox(alive, "https://alive.example.test/hook");

      expect(await enqueueAgentDelivery(pool, gone, { kind: "weekly_digest", data: { brief: "this week" } })).toEqual({
        ok: false,
        reason: "no_inbox",
      });
      expect(await enqueueAgentDelivery(pool, gone, { kind: "opportunity", data: { intro: "meet Ash" } })).toEqual({
        ok: false,
        reason: "no_inbox",
      });
      expect(await agentRowsRemaining(pool, gone), "the enqueue that refused also removed the late inbox").toEqual(NONE);
      expect((await enqueueAgentDelivery(pool, alive, { kind: "weekly_digest", data: { brief: "this week" } })).ok).toBe(true);
    });

    it("setInbox refuses a holder the sweep already made a tombstone, or one with no member row, and keeps no row", async () => {
      const gone = "er-agent-late-set";
      const ghost = "er-agent-ghost-set";
      const alive = "er-agent-alive-set";
      await eraseFully(gone);
      await seedLiving(alive);
      // An address literal, so the guard answers without a DNS lookup and the
      // test never reaches the network. TEST-NET-1 passes the range check.
      const url = "https://192.0.2.10/hook";

      const late = await setInbox(pool, gone, url, SECRETS_ENV, 0);
      expect(late, "the write that landed after the sweep must refuse itself and hand back no secret").toMatchObject({
        ok: false,
        status: 403,
      });
      expect(await agentRowsRemaining(pool, gone)).toEqual(NONE);
      expect((await setInbox(pool, ghost, url, SECRETS_ENV, 0)).ok).toBe(false);
      expect(await agentRowsRemaining(pool, ghost)).toEqual(NONE);

      const living = await setInbox(pool, alive, url, SECRETS_ENV, 0);
      expect(living.ok, "a living member still sets an inbox").toBe(true);
      expect((await agentRowsRemaining(pool, alive)).inboxes).toBe(1);
    });

    it("storeMemberKey refuses a holder the sweep already made a tombstone, and keeps no key", async () => {
      const gone = "er-agent-late-key";
      const alive = "er-agent-alive-key";
      await eraseFully(gone);
      await seedLiving(alive);
      const input = { provider: "anthropic" as const, key: "sk-ant-example-0000" };

      const late = await storeMemberKey(pool, gone, input, SECRETS_ENV, 0);
      expect(late.ok, "a third-party credential must not be stored for a tombstone").toBe(false);
      expect(await memberKeyView(pool, gone)).toBeNull();
      expect(await agentRowsRemaining(pool, gone)).toEqual(NONE);

      expect((await storeMemberKey(pool, alive, input, SECRETS_ENV, 0)).ok, "a living member still stores a key").toBe(true);
      expect(await memberKeyView(pool, alive)).not.toBeNull();
    });

    /**
     * A pool that calls `hook` on each statement before passing it to this
     * suite's pool, including statements on a connection it hands out: the
     * inbox and key writes run inside a transaction that holds the member's
     * row (`whileSessionHolds`, server/lib/sessionHold.ts).
     */
    function hooked(hook: (sql: string) => Promise<void>): mysql.Pool {
      return {
        query: async (sql: string, params?: unknown[]) => {
          await hook(sql);
          return pool.query(sql, params); // module-review-ok: passes the code under test's own SQL through to this suite's scratch schema, and writes none of its own
        },
        getConnection: async () => {
          const conn = await pool.getConnection();
          return new Proxy(conn, {
            get(target, prop) {
              if (prop === "query") {
                return async (sql: string, params?: unknown[]) => {
                  await hook(sql);
                  return target.query(sql, params); // module-review-ok: passes the code under test's own SQL through on the connection it asked for
                };
              }
              const value = Reflect.get(target, prop, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      } as unknown as mysql.Pool;
    }

    /**
     * A pool on which the whole sweep runs just before the write's first
     * statement: after the request's session check and its DNS wait, and
     * before it has read, locked or written anything. A check made at the
     * start of the request passes a living member and lets the row stand;
     * only one made at the write sees the tombstone.
     */
    function sweepJustBefore(target: any): { pool: mysql.Pool; swept: () => boolean } {
      let swept = false;
      const racing = hooked(async () => {
        if (swept) return;
        swept = true;
        await anonymizeMember(pool, target, null, deps());
      });
      return { pool: racing, swept: () => swept };
    }

    it("setInbox asks for its holder at the write, so a sweep that runs just before it still leaves no row", async () => {
      const id = "er-agent-race-set";
      const race = sweepJustBefore(await seedMember(id));

      const out = await setInbox(race.pool, id, "https://192.0.2.10/hook", SECRETS_ENV, 0);

      expect(race.swept(), "the sweep must run inside the write, or this is the after-the-sweep case again").toBe(true);
      expect((await erasureRecord(pool, id))!.finishedAt).not.toBeNull();
      expect(out, "a write that comes after the sweep's last delete must still refuse itself").toMatchObject({
        ok: false,
        status: 403,
      });
      expect(await agentRowsRemaining(pool, id)).toEqual(NONE);
    });

    it("storeMemberKey asks for its holder at the write, so a sweep that runs just before it still leaves no key", async () => {
      const id = "er-agent-race-key";
      const race = sweepJustBefore(await seedMember(id));

      const out = await storeMemberKey(race.pool, id, { provider: "anthropic", key: "sk-ant-example-0000" }, SECRETS_ENV, 0);

      expect(race.swept(), "the sweep must run inside the write, or this is the after-the-sweep case again").toBe(true);
      expect((await erasureRecord(pool, id))!.finishedAt).not.toBeNull();
      expect(out.ok, "a key that comes after the sweep's last delete must still refuse itself").toBe(false);
      expect(await memberKeyView(pool, id)).toBeNull();
    });

    /**
     * The other order: the write holds the member's row when the sweep
     * arrives. The tombstone waits for the write's commit, and the sweep's
     * step after the tombstone then removes what the write left.
     */
    it("a sweep that arrives while setInbox holds the member's row waits for it, and still leaves no row", async () => {
      const id = "er-agent-race-held";
      const target = await seedMember(id);
      const race: { sweeping: Promise<unknown> | null } = { sweeping: null };
      const racing = hooked(async (sql) => {
        if (race.sweeping || !/^INSERT INTO `?agent_inboxes\b/.test(sql)) return;
        race.sweeping = anonymizeMember(pool, target, null, deps());
        // The sweep has to wait on the row this write holds, or nothing here is serialised.
        await untilALockIsAwaited(pool);
      });

      const out = await setInbox(racing, id, "https://192.0.2.10/hook", SECRETS_ENV, 0);
      expect(race.sweeping, "the sweep must start inside the write").not.toBeNull();
      await race.sweeping;

      expect(out.ok, "the write held the row first, so it landed before the tombstone").toBe(true);
      expect((await erasureRecord(pool, id))!.finishedAt).not.toBeNull();
      expect(await agentRowsRemaining(pool, id), "the inbox the write left outlived the sweep").toEqual(NONE);
    });
  });
});
