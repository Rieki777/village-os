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
/** The handle that tombstone kept, `departed-` and the last eight of the id, which forum bylines print. */
const GONE_HANDLE = `departed-${GONE.slice(-8)}`;
/** Waiting for the seat the old erasure left them holding. */
const WAITER = "needstomb-waiter";
const SEATED = "needstomb-bread-night";

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
  // The tombstone kept the handle releases before round 2 wrote (round 3, finding 13).
  await seed("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`) VALUES (?, 'A departed member', ?, '', ?)", [
    GONE,
    `deleted-${GONE}@anonymized.invalid`,
    GONE_HANDLE,
  ]);
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
  // And the one seat at a gathering ahead, with a living member waiting for it.
  await seed("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?, 'Ida Fenn', ?, 'x')", [WAITER, `${WAITER}@example.test`]);
  await seed("INSERT INTO `events` (`id`, `title`, `starts_at`, `status`, `kind`, `layer`, `capacity`) VALUES (?, 'Bread night', CURRENT_TIMESTAMP + INTERVAL 5 DAY, 'scheduled', 'gathering', 'village', 1)", [SEATED]);
  await seed("INSERT INTO `event_rsvps` (`id`, `event_id`, `user_id`, `status`, `idempotency_key`) VALUES (?, ?, ?, 'going', ?)", [`rsvp-${GONE}`, SEATED, GONE, `seed:${GONE}`]);
  await seed("INSERT INTO `event_waitlist` (`id`, `event_id`, `user_id`) VALUES (?, ?, ?)", [`wl-${WAITER}`, SEATED, WAITER]);
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
    // The handle it kept is gone, so the profile page a signed-out reader
    // reached by it (join date, moons, token chips, gratitude) answers 404.
    const page = await call("GET", `/api/profiles/${GONE_HANDLE}`, undefined, "");
    expect(page.status, `no page answers to ${GONE_HANDLE}: ${page.text.slice(0, 200)}`).toBe(404);
    const [handles] = await pool.query<any[]>("SELECT `handle` FROM `users` WHERE `id` = ?", [GONE]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(handles[0]?.handle, "the old tombstone holds no handle").toBeNull();
    // The seat went to the person waiting, and they were told: the job runs once the promotion sink is wired.
    const [seats] = await pool.query<any[]>("SELECT `user_id`, `status` FROM `event_rsvps` WHERE `event_id` = ? ORDER BY `user_id`", [SEATED]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(seats.map((r) => ({ ...r }))).toEqual([{ user_id: WAITER, status: "going" }]);
    const [told] = await pool.query<any[]>("SELECT `type` FROM `notifications` WHERE `user_id` = ? AND `dedupe_key` = ?", [WAITER, `waitlist:${SEATED}:${WAITER}`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(told.map((r) => r.type), "the member given the seat is told it is theirs").toEqual(["waitlist_promoted"]);
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

  /*
   * THE HANDLE THE BOOT JOB FREED STAYS FREE (round 3 leftover). The first case
   * proved the old tombstone gave up departed-gone-old. Freed, it was the next
   * living member's for the asking: a name that slugs to it at sign-up, or the
   * handle field on the profile, and every old link to the departed member's
   * page reached that living person.
   */
  it("no living member takes the handle the old tombstone gave up", async () => {
    const namesake = await call("POST", "/api/auth/register", {
      name: "Departed Gone Old", email: `namesake-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
    }, "");
    expect(namesake.status, `a member whose name slugs to it still joins: ${namesake.text}`).toBe(200);
    expect(String(namesake.json?.user?.handle), "the handle their name gives does not start with departed-").not.toMatch(/^departed-/);
    expect(String(namesake.json?.user?.handle), "and still comes from their name").toMatch(/^gone-old/);

    const asked = await call("PUT", "/api/profile", { handle: GONE_HANDLE }, bystander.token);
    expect(asked.status, `nobody living may choose it: ${asked.text}`).toBe(400);
    expect(String(asked.json?.error), "the member is told why").toMatch(/"departed-".*members who have left/);
    const page = await call("GET", `/api/profiles/${GONE_HANDLE}`, undefined, "");
    expect(page.status, `an old link still reaches nobody: ${page.text.slice(0, 200)}`).toBe(404);

    // The control: the same member, the same field, an ordinary handle.
    const plain = await call("PUT", "/api/profile", { handle: `bay-${PORT}` }, bystander.token);
    expect(plain.status, plain.text).toBe(200);
  });

  /*
   * NOTHING MOVES TO THE OLD TOMBSTONE, by its address or by its id (round 3
   * leftover). Three doors take a recipient a member names: tokens by address
   * or id, Gratitude on the wall, and Hearts. Each is asked for the tombstone
   * and for a living member, and the ledger is read for what reached it.
   */
  it("no door sends anything to a member who has left, by address or by id", async () => {
    const address = `deleted-${GONE}@anonymized.invalid`;
    const landed = async () => {
      const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT COUNT(*) AS n FROM `token_ledger` l JOIN `ledger_accounts` a ON a.`id` = l.`to_account` WHERE a.`user_id` = ?",
        [GONE],
      );
      const [gifts] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM `gratitude_log` WHERE `to_id` = ?", [GONE]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      return { legs: Number(rows[0]?.n ?? 0), gifts: Number(gifts[0]?.n ?? 0) };
    };
    const minted = await call("POST", "/api/admin/tokens/credits/mint", { toUserId: bystander.id, amount: 5, reason: "test float" });
    expect(minted.status, `the sender holds credits: ${minted.text}`).toBe(200);
    const sender = await register("Moss Kell", "moss");

    // Tokens, by address and by id.
    for (const [door, body] of [["address", { toEmail: address }], ["id", { to: GONE }]] as const) {
      const sent = await call("POST", "/api/wallet/send", { ...body, tokenType: "credits", amount: 1, clientNonce: `gone-${door}` }, bystander.token);
      expect(sent.status, `no credits to a tombstone by ${door}: ${sent.text}`).toBe(404);
      expect(String(sent.json?.error)).toMatch(/left the village/);
    }
    const toLiving = await call("POST", "/api/wallet/send", { to: sender.id, tokenType: "credits", amount: 1, clientNonce: "living-1" }, bystander.token);
    expect(toLiving.status, `the control: a living member is paid: ${toLiving.text}`).toBe(200);

    // Gratitude on the wall, by address typed and passed, and Hearts by id.
    for (const body of [{ toEmail: address }, { to: address }]) {
      const thanked = await call("POST", "/api/game/gratitude/send", { ...body, amount: 1, message: "Thank you." }, bystander.token);
      expect(thanked.status, `no Gratitude to a tombstone: ${thanked.text}`).toBe(404);
      expect(String(thanked.json?.error)).toMatch(/left the village/);
    }
    const hearted = await call("POST", "/api/gratitude", { toId: GONE, amount: 1, note: "Thank you." }, bystander.token);
    expect(hearted.status, `no Hearts to a tombstone: ${hearted.text}`).toBe(404);
    expect(String(hearted.json?.error)).toMatch(/left the village/);
    // The control for both: a living recipient is past the recipient checks and
    // meets this village's own later refusal (it has not launched), or lands.
    const thankedLiving = await call("POST", "/api/game/gratitude/send", { toEmail: `moss-${PORT}@example.test`, amount: 1, message: "Thank you." }, bystander.token);
    expect(String(thankedLiving.json?.error ?? ""), thankedLiving.text).not.toMatch(/left the village|No member/);
    const heartedLiving = await call("POST", "/api/gratitude", { toId: sender.id, amount: 1, note: "Thank you." }, bystander.token);
    expect(String(heartedLiving.json?.error ?? ""), heartedLiving.text).not.toMatch(/left the village|No member/);

    expect(await landed(), "no ledger leg and no acknowledgement reached the tombstone").toEqual({ legs: 0, gifts: 0 });
  });

  /*
   * NOR DOES THE ADMIN HAND-MINT, OR ITS SECOND SIGNATURE (round 4). The
   * hand-mint looked the recipient up by id and refused only a missing row, so
   * a steward could mint into the tombstone's account, or into a standing
   * example's. The co-signed approval reads the recipient again when the second
   * steward signs, so a grant asked for while a member was here would pay their
   * tombstone the moment it was signed after they left. Each door is asked for
   * the tombstone, for an example identity and for a living member, and the
   * ledger is read for what reached them.
   */
  it("the hand-mint and its co-signed approval mint nothing to a member who has left, or to a standing example", async () => {
    // A standing example identity, written as the examples seed writes one: no
    // password, an @examples.invalid address, is_example set. This village's
    // own seed may have none, and the guard has to hold for one that does.
    const example = "needstomb-example";
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `role`, `is_example`) VALUES (?, 'Sample Rowan', ?, '', 'member', 1)",
      [example, `${example}@examples.invalid`],
    );
    const legsTo = async (id: string) => {
      const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT COUNT(*) AS n FROM `token_ledger` l JOIN `ledger_accounts` a ON a.`id` = l.`to_account` WHERE a.`user_id` = ?",
        [id],
      );
      return Number(rows[0]?.n ?? 0);
    };
    const asksFor = async (id: string) => {
      const [rows] = await pool.query<any[]>("SELECT `id`, `status` FROM `admin_mint_requests` WHERE `to_user_id` = ? ORDER BY `id`", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      return rows.map((r) => `${r.id}:${r.status}`);
    };
    const livingBefore = await legsTo(bystander.id);

    // The steward's own hand-mint: under the co-sign line, and over it.
    for (const amount of [2, 150]) {
      const gone = await call("POST", "/api/admin/tokens/credits/mint", { toUserId: GONE, amount, reason: "for the bread" });
      expect(gone.status, `no hand-mint of ${amount} to a tombstone: ${gone.text}`).toBe(404);
      expect(String(gone.json?.error), "the steward is told why").toMatch(/left the village/);
      const sample = await call("POST", "/api/admin/tokens/credits/mint", { toUserId: example, amount, reason: "for the bread" });
      expect(sample.status, `no hand-mint of ${amount} to a standing example: ${sample.text}`).toBe(409);
      expect(sample.json?.code, "the example refusal every admin door gives").toBe("example_immutable");
    }
    expect(await asksFor(GONE), "and no grant waits for a second steward in a departed member's name").toEqual([]);
    expect(await asksFor(example)).toEqual([]);
    const living = await call("POST", "/api/admin/tokens/credits/mint", { toUserId: bystander.id, amount: 2, reason: "for the bread" });
    expect(living.status, `the control: a living member is minted to: ${living.text}`).toBe(200);

    // Asked for by another steward while each of them was here, signed now.
    const ask = (id: string, to: string) => pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `admin_mint_requests` (`id`, `token_slug`, `to_user_id`, `amount`, `reason`, `requested_by`, `status`) VALUES (?, 'credits', ?, 150, 'asked before they left', 'needstomb-other-steward', 'pending')",
      [id, to],
    );
    await ask("amr-needstomb-gone", GONE);
    await ask("amr-needstomb-example", example);
    await ask("amr-needstomb-living", bystander.id);
    const signGone = await call("POST", "/api/admin/mint-requests/amr-needstomb-gone/approve", {});
    expect(signGone.status, `no signed grant pays a tombstone: ${signGone.text}`).toBe(404);
    expect(String(signGone.json?.error), "the second steward is told why").toMatch(/left the village/);
    expect(await asksFor(GONE), "the grant is left for a steward to decline").toEqual(["amr-needstomb-gone:pending"]);
    const signExample = await call("POST", "/api/admin/mint-requests/amr-needstomb-example/approve", {});
    expect(signExample.status, `no signed grant pays a standing example: ${signExample.text}`).toBe(409);
    const signLiving = await call("POST", "/api/admin/mint-requests/amr-needstomb-living/approve", {});
    expect(signLiving.status, `the control: a signed grant pays a living member: ${signLiving.text}`).toBe(200);
    const declined = await call("POST", "/api/admin/mint-requests/amr-needstomb-gone/decline", { reason: "they have left" });
    expect(declined.status, `a steward can still clear it: ${declined.text}`).toBe(200);

    expect(await legsTo(GONE), "no ledger leg reached the tombstone").toBe(0);
    expect(await legsTo(example), "or the standing example").toBe(0);
    expect(await legsTo(bystander.id), "the living member got the hand-mint and the signed grant").toBe(livingBefore + 2);
  });
});
