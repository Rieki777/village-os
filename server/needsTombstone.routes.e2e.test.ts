/**
 * A DEPARTURE TAKES THE NEEDS CARD WITH IT, DRIVEN THROUGH THE REAL DOOR.
 *
 * `server/lib/needs.test.ts` proves `forgetMemberNeeds` in isolation: every
 * moon removed, nobody else touched, an empty id deletes nothing. That is a
 * claim about a function, and it went green for a whole release while
 * `anonymizeMember` never called it, so a member who left had their private
 * answers about what they lack sitting in `member_needs` afterwards. The card
 * says "Only you can read this" and that was untrue of anybody who had gone.
 *
 * So this file makes the claim about the PRODUCT instead. A member registers,
 * answers the card, opens their own departure, an admin resolves it, and the
 * rows are asked for by raw SELECT against the schema the built server is
 * actually writing to.
 *
 * THE BYSTANDER IS THE WHOLE TEST. A `DELETE FROM member_needs` with a broken
 * WHERE would pass every assertion about the leaver and would empty the
 * village. Bay never leaves, answers the same two needs, and is counted before
 * and after.
 *
 * COUNTED BEFORE, NOT ONLY AFTER. An empty state and a real zero are different
 * facts: if the two saves silently failed, the after-count of zero would prove
 * nothing at all. Every count below has a non-zero reading in front of it.
 *
 * `anonymizeMember` is module-private to server/index.ts and no test can call
 * it. This suite reaches it the way the village does, through
 * `POST /api/admin/exits/:id/resolve`.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[needsTombstone.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED. A skip is not a pass.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window. It starts where `exitLevers` (30402 + 400) stops,
 * clear of every other declared window and of the 32768+ ephemeral range.
 * `scripts/check-e2e-ports.mjs` is what proves that, not this comment.
 */
/*
 * MOVED BELOW THE 6000 CONVENTION, BECAUSE THE BAND ABOVE IT IS FULL.
 *
 * This suite and main's stewardSeat suite both held 30802, the usual sibling
 * collision: a free window is only free at the instant you check it, and a lane
 * cannot see a lane. Mine moves because main's is published.
 *
 * There was nowhere above 6000 to move to. Walking the guard upward from 27602,
 * every 200-wide slot to 32701 is taken, and 32702 would reach past 32768 into
 * the range Linux hands out as ephemeral, which the guard refuses for a real
 * reason: a bound port there can lose the bind to an ordinary outbound
 * connection on CI.
 *
 * The 6000 floor is a CONVENTION and not a rule. The guard enforces only the
 * ephemeral ceiling, so 1024 to 5999 is entirely unused and this takes the top
 * of it. Anybody adding the next suite should know the band above 6000 is
 * exhausted and this is where the room is.
 */
const PORT = 5600 + (process.pid % 200);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "needstombstone-admin";
const PASSWORD = "NeedsTombstone123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];
let founderToken = "";

let leaver = { token: "", id: "" };
let bystander = { token: "", id: "" };

/**
 * A member erased on an older release, whose record finished before the needs
 * deletion moved past the tombstone and before open links were withdrawn
 * (adversarial round 2, finding 14). Written before the server boots, so the
 * boot job is what finds it.
 */
const GONE = "needstomb-gone-old";

interface Answer { status: number; json: any; text: string }

async function call(method: string, route: string, body?: unknown, token = founderToken): Promise<Answer> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
  }, "");
  expect(r.status, `${name} must register: ${r.text}`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** How many private answers this member has on file, every moon included. */
async function needRows(userId: string): Promise<number> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT COUNT(*) AS n FROM `member_needs` WHERE `user_id` = ?",
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the needs tombstone route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-needstomb-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

  // The old erasure: a tombstone, a record that finished with that release's
  // steps ("needs" still ran before the tombstone then), the answer saved after
  // it, and a link nobody used.
  const seed = (sql: string, params: unknown[]) => pool.query(sql, params); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  await seed("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?, 'A departed member', ?, '')", [GONE, `deleted-${GONE}@anonymized.invalid`]);
  await seed("INSERT INTO `member_erasures` (`user_id`, `attempts`, `steps_done`, `finished_at`) VALUES (?, 1, ?, '2026-09-20 10:00:00')", [
    GONE,
    JSON.stringify(["needs", "tombstone", "audit", "external-stores"]),
  ]);
  await seed("INSERT INTO `member_needs` (`id`, `user_id`, `need_key`, `depth`, `cycle_id`) VALUES (?, ?, 'vitality', 'unmet', 'cycle-old')", [`need-${GONE}`, GONE]);
  await seed("INSERT INTO `member_invites` (`id`, `token_hash`, `inviter_user_id`, `expires_at`) VALUES (?, ?, ?, CURRENT_TIMESTAMP + INTERVAL 7 DAY)", [
    `inv-${GONE}`,
    "a".repeat(64),
    GONE,
  ]);
  expect(await needRows(GONE), "the control: the old erasure left their answer").toBe(1);

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: the first tick runs every job with no
      // scheduled_jobs row against the schema this suite is asserting on.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "needstombstone-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      PLATFORM_ASSISTANT_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Needs Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: PASSWORD }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  leaver = await register("Wren Ash", "wren");
  bystander = await register("Bay Holt", "bay");
}, 240_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("what a resolved exit does to the needs card", () => {
  it("gives an erasure that finished on an older release the steps it predates, once, at boot", async () => {
    expect(await needRows(GONE), "the answer the old erasure left is gone").toBe(0);
    const [links] = await pool.query<any[]>("SELECT `revoked_at` FROM `member_invites` WHERE `id` = ?", [`inv-${GONE}`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(links[0]?.revoked_at, "their open link lets nobody in").not.toBeNull();
    const [records] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT CAST(`steps_done` AS CHAR) AS steps, DATE_FORMAT(`finished_at`, '%Y-%m-%d %H:%i:%s') AS finished FROM `member_erasures` WHERE `user_id` = ?",
      [GONE],
    );
    expect(JSON.parse(records[0].steps), "what ran is written on the record").toEqual(
      expect.arrayContaining(["needs", "tombstone", "needs-after-tombstone", "invites-after-tombstone"]),
    );
    expect(records[0].finished, "and the finish did not move").toBe("2026-09-20 10:00:00");
    expect(logs.join("")).toMatch(/\[erasure\] finished-erasure backfill: 1 finished erasure\(s\) read, 1 given \d+ step\(s\) they predate, 0 stopped part way\./);
    const [ledger] = await pool.query<any[]>("SELECT `value` FROM `app_config` WHERE `config_key` = 'data-migrations'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(JSON.stringify(ledger[0]?.value ?? ""), "recorded in the runOnce ledger, so the next boot does not run it again").toMatch(
      /erasure-steps-backfill-[0-9a-f]{12}/,
    );
  });

  it("both members fill in the card, and the rows are really there", async () => {
    // The control the two assertions below depend on. Without it, a zero after
    // the tombstone would be indistinguishable from two saves that never
    // happened.
    for (const who of [leaver, bystander]) {
      const vitality = await call("PUT", "/api/needs/mine", {
        needKey: "vitality", depth: "unmet", feeling: "stretched", note: "the water runs brown after rain",
      }, who.token);
      expect(vitality.status, `vitality save: ${vitality.text}`).toBe(200);
      const love = await call("PUT", "/api/needs/mine", {
        needKey: "love", depth: "deprived", feeling: "lonely", note: "I eat alone most nights",
      }, who.token);
      expect(love.status, `love save: ${love.text}`).toBe(200);
    }

    expect(await needRows(leaver.id)).toBe(2);
    expect(await needRows(bystander.id)).toBe(2);
  });

  it("the leaver's private answers are gone once their exit resolves", async () => {
    const opened = await call("POST", "/api/profile/request-exit", { password: PASSWORD }, leaver.token);
    expect(opened.status, `request-exit: ${opened.text}`).toBe(200);
    const exitId = String(opened.json?.exit?.id ?? "");
    expect(exitId, "a departure must carry an id").toBeTruthy();

    const resolved = await call("POST", `/api/admin/exits/${exitId}/resolve`, { agreementRef: "needs-tombstone" });
    expect(resolved.status, `resolve: ${resolved.text}`).toBe(200);

    // The tombstone ran: their session is dead and the roster carries the
    // anonymized name. Both are here so a 200 from a resolve that quietly did
    // nothing could not read as a pass.
    expect((await call("GET", "/api/profile", undefined, leaver.token)).status).toBe(401);

    expect(await needRows(leaver.id), "their words about what they lack do not outlive them").toBe(0);
  });

  it("and nobody else's are", async () => {
    // The same two rows Bay saved, counted after the delete that took Wren's.
    expect(await needRows(bystander.id)).toBe(2);

    const mine = await call("GET", "/api/needs/mine", undefined, bystander.token);
    expect(mine.status).toBe(200);
    expect(mine.json?.answered).toBe(true);
    expect(mine.json?.mine?.length).toBe(2);
  });

  /*
   * THE SAME DOOR, AND WHAT IT LEAVES ON OTHER PEOPLE'S SCREENS (lane E2,
   * findings 9 and 10). Opening a departure rings every admin with the
   * member's full name, and the route used to write that row with no actor, so
   * the sweep's notifications step never matched it. The note the member types
   * goes onto the exit record. Both are read back through the routes an admin
   * reads them through, with the row's actor asked for directly as the control
   * that the producer now records whose departure it is.
   */
  it("the founder's bell and the exit record keep no word of a member once their exit resolves", async () => {
    const sorrel = await register("Sorrel Vane", "sorrel");
    const opened = await call("POST", "/api/profile/request-exit", { password: PASSWORD, note: "Leaving because of how Sam treated me" }, sorrel.token);
    expect(opened.status, `request-exit: ${opened.text}`).toBe(200);
    const exitId = String(opened.json?.exit?.id ?? "");

    const titles = async () => ((await call("GET", "/api/notifications")).json?.notifications ?? []).map((n: any) => String(n.title));
    expect(await titles(), "the control: the founder is told, by name").toContain("Sorrel Vane has begun a departure");
    const [row] = (await pool.query<any[]>("SELECT `actor_user_id` FROM `notifications` WHERE `dedupe_key` LIKE ?", [`exit:${exitId}:opened:%`]))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(row?.actor_user_id, "the founder's row records whose departure it is").toBe(sorrel.id);
    const exitRecord = async () => ((await call("GET", "/api/admin/exits")).json?.exits ?? []).find((e: any) => e.id === exitId);
    expect((await exitRecord())?.resolution, "the control: the note is on the record").toContain("Sam");

    const resolved = await call("POST", `/api/admin/exits/${exitId}/resolve`, { agreementRef: "leftovers" });
    expect(resolved.status, `resolve: ${resolved.text}`).toBe(200);

    expect((await titles()).filter((t: string) => /sorrel/i.test(t)), "no title on the founder's bell names them").toEqual([]);
    const after = await exitRecord();
    expect(after?.status, "the record of leaving stays").toBe("resolved");
    expect(String(after?.resolution ?? ""), "their words do not outlive them").not.toContain("Sam");
  });
});
