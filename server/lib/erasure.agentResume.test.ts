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
 * The inbox is the sharp one: `agent-week-ahead` selects
 * `FROM agent_inboxes WHERE enabled = 1` with no join to `users`, so a departed
 * member's endpoint goes on receiving the village's payloads. A token is dead
 * once its holder is a tombstone (`holderStands`), but the row keeps the label
 * the member gave it, which is the reason the sweep deletes tokens at all.
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
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { agentRowsRemaining, type AgentSweepCounts } from "../repos/memberAgent";
import { anonymizeMember, resumeErasure, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import * as portraits from "../repos/characterPortraits";
import { mintToken } from "./agentTokens";
import { enqueueAgentDelivery } from "./agentInbox";

const configured = testDbConfigured();
const VILLAGE = "local";

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
    expect(out.ran, "the original step is skipped by name on a resume").not.toContain("member-agent");
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
});
