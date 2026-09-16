/**
 * The failed-actions report against a real database.
 *
 * server/lib/failedActions.test.ts proves the judgement with no database, and
 * server/routes/failedActions.test.ts proves the route a founder reads. Every
 * claim in this file is about what SQL does, so each runs on a scratch schema
 * migrated to the real tables:
 *
 *  - the list keeps one row per failing thing, closes what a source stops
 *    finding, and reopens a failure that comes back as a new episode;
 *  - the reads that decide something decide it right: a healed payment, the
 *    newest landing attempt, a seat fee whose move landed, a peer worth a
 *    person, a connection past three failures, a recording summarised by hand;
 *  - a run holds the lock, keeps an unreadable area's items, stops when out of
 *    time without closing what it never reached, is silent on its first run,
 *    and speaks at most once a day after, reminders included;
 *  - the one retry claims a closed deletion before finishing it, and leaves
 *    alone every deletion it has no business finishing.
 *
 * Several cases were added after adversarial review showed that the ones before
 * them still passed with the guard they named deleted. Each says which.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import type { ErasureDeps } from "./lib/erasure";
import { keysFor } from "./lib/eventSeats";
import {
  FAILED_ACTIONS_JOB,
  REPORT_SOURCE,
  RUN_BUDGET_MS,
  defaultSources,
  firstRunHere,
  resumeClosedErasures,
  runFailedActions,
  type FailureSource,
  type ReportFinding,
} from "./lib/failedActions";
import { landingStatusesFor, scheduledLandings } from "./repos/ballotLandings";
import * as items from "./repos/failedActionItems";
import * as sources from "./repos/failureSources";
import { annotateNewestOpenAttempt, closeNewestOpenAttempt, insertAttempt, stuckLandings } from "./repos/governanceExecutorPending";
import { beginErasure, claimResume, erasureRecord, noteErasureFailed, noteResumeAttempt, noteStepDone } from "./repos/memberErasure";
import { withNamedLock } from "./repos/namedLock";
import { usersRepo } from "./repos/users";

const configured = testDbConfigured();
const MEMBER = "failures-closed-member";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";

/** Seeds and read-backs on the scratch schema, through one waived line. */
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned

const finding = (key: string, extra: Partial<ReportFinding> = {}): ReportFinding => ({
  key,
  title: `title ${key}`,
  advice: `advice ${key}`,
  ...extra,
});

const source = (key: string, find: () => Promise<ReportFinding[]>): FailureSource => ({ key, find });

const openKeys = async () => (await items.openItems(pool)).map((i) => `${i.source}/${i.key}`).sort();

function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: any) => real.update(id, fn) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { replaceAll: async () => undefined },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

/** A deletion that got past the tombstone and stopped at the last step, last tried `hoursAgo` hours ago. */
async function stalledAfterClose(hoursAgo: number, attempts = 1): Promise<void> {
  await beginErasure(pool, MEMBER);
  await noteStepDone(pool, MEMBER, "tombstone");
  await noteErasureFailed(pool, MEMBER, "audit", "the audit write was refused");
  await q("UPDATE `member_erasures` SET `attempts` = ?, `last_attempt_at` = CURRENT_TIMESTAMP - INTERVAL ? HOUR WHERE `user_id` = ?", [
    attempts,
    hoursAgo,
    MEMBER,
  ]);
}

/** A ballot with the landing status a case needs, in the shape server/stewardship.db.test.ts seeds. */
async function ballot(id: string, landingStatus: string): Promise<void> {
  await q(
    "INSERT INTO `ballots` (`id`, `subject_type`, `subject_ref`, `open_key`, `title`, `doc_markdown`, `method`, `weight_mode`, " +
      "`unity_pct`, `quorum_pct`, `total_weight`, `electorate_count`, `opened_by`, `opens_at`, `closes_at`, `status`, `landing_status`) " +
      "VALUES (?, 'advisory', 'ref', ?, ?, 'body', 'custom', 'equal', 80, 20, 3, 3, 'usr-opener', NOW(), NOW(), 'passed', ?)",
    [id, `advisory:${id}`, `Decision ${id}`, landingStatus],
  );
}

/** A seat charge numbered for its id, so ids sort the way the paging reads them. */
async function seatCharge(n: number, status = "kept", settledMinutesAgo: number | null = 120): Promise<void> {
  await q(
    "INSERT INTO `event_seat_charges` (`id`, `event_id`, `user_id`, `occurrence_key`, `token_type`, `amount`, `status`, `charge_seq`, `settled_at`) " +
      "VALUES (?, 'ev-1', ?, ?, 'seat-credit', 5, ?, 1, IF(? IS NULL, NULL, CURRENT_TIMESTAMP - INTERVAL ? MINUTE))",
    [`sc-${String(n).padStart(4, "0")}`, `usr-seat-${n}`, n % 2 === 0 ? "" : "2026-09", status, settledMinutesAgo, settledMinutesAgo],
  );
}

const EMPTIED_BETWEEN_CASES = [
  "failed_action_items",
  "member_erasures",
  "scheduled_jobs",
  "payments_log",
  "governance_executor_pending",
  "event_seat_charges",
  "peer_instances",
  "integration_health",
  "library_loans",
  "synthesis_batch_items",
  "call_syntheses",
  "external_calendars",
];

describe.skipIf(!configured)("the failed-actions report, against a real database", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-failed-actions-"));
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    for (const table of EMPTIED_BETWEEN_CASES) await q(`DELETE FROM \`${table}\``);
    await q("DELETE FROM `health_events` WHERE `kind` = 'module_quarantine'");
    await q(
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `is_example`) VALUES (?,?,?,'x',0) " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `is_example` = 0",
      [MEMBER, "Wren Halloway", `${MEMBER}@examples.invalid`],
    );
  });

  describe("the list of what is failing", () => {
    it("keeps one row per failing thing, and a later run keeps its first sighting", async () => {
      await items.reconcileSource(pool, "payments", [finding("stays:ord-1", { lastError: "first" })]);
      await q("UPDATE `failed_action_items` SET `first_seen_at` = CURRENT_TIMESTAMP - INTERVAL 1 DAY");

      await items.reconcileSource(pool, "payments", [finding("stays:ord-1", { title: "retitled", lastError: "second" })]);

      const open = await items.openItems(pool);
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ source: "payments", key: "stays:ord-1", title: "retitled", lastError: "second", notifiedAt: null });
      expect(open[0].ageSeconds).toBeGreaterThanOrEqual(24 * 60 * 60 - 5);
    });

    it("closes what a source stops finding, only in that source, and reopens a return as a new episode", async () => {
      await items.reconcileSource(pool, "peers", [finding("p1"), finding("p2")]);
      await items.reconcileSource(pool, "calendars", [finding("c1")]);
      await items.markNotified(pool, [{ source: "peers", key: "p1" }]);
      expect((await items.openItems(pool)).find((i) => i.key === "p1")!.toldThisEpisode).toBe(true);

      await items.reconcileSource(pool, "peers", [finding("p2")]);
      expect(await openKeys()).toEqual(["calendars/c1", "peers/p2"]);
      const [cleared] = await items.recentlyResolved(pool, 7);
      expect(cleared).toMatchObject({ source: "peers", key: "p1" });
      expect(cleared.resolvedAgeSeconds).toEqual(expect.any(Number));

      // Back within the same second as its notice, as it can be in a test: the
      // episode counter decides, and whole-second timestamps never have to.
      await items.reconcileSource(pool, "peers", [finding("p1"), finding("p2")]);
      const back = (await items.openItems(pool)).find((i) => i.key === "p1")!;
      // The stamp stays, so the day's record of a notice survives the reopen, and it counts for nothing in the new episode.
      expect(back.notifiedAt).not.toBeNull();
      expect(back.toldThisEpisode).toBe(false);
      expect(back.ageSeconds).toBeLessThan(60);
    });

    it("closes everything in a source that was read and found nothing, and remembers it held rows", async () => {
      await items.reconcileSource(pool, "jobs", [finding("a"), finding("b")]);
      await items.reconcileSource(pool, "jobs", []);
      expect(await items.openItems(pool)).toEqual([]);
      expect(await items.itemCount(pool)).toBe(2);
    });

    it("clips what a strict database would refuse, instead of losing the row", async () => {
      await items.reconcileSource(pool, "report", [
        { key: "k".repeat(300), title: "t".repeat(400), advice: "a".repeat(900), lastError: "e".repeat(900) },
      ]);
      const [row] = await items.openItems(pool);
      expect([row.key.length, row.title.length, row.advice.length, row.lastError!.length]).toEqual([128, 255, 600, 500]);
      // The same long key finds the same row again, clipped the same way.
      await items.reconcileSource(pool, "report", [{ key: "k".repeat(300), title: "t", advice: "a" }]);
      expect(await items.openItems(pool)).toHaveLength(1);
    });

    it("forgets the recorded error the moment an item clears, and the item itself after thirty days", async () => {
      await items.reconcileSource(pool, "integrations", [finding("vendor:listing", { lastError: "503: the vendor said something about somebody" })]);
      await items.reconcileSource(pool, "integrations", []);
      const [cleared] = await items.recentlyResolved(pool, 7);
      expect(cleared).toMatchObject({ key: "vendor:listing", lastError: null });

      await items.reconcileSource(pool, "integrations", [finding("vendor:other")]);
      await q("UPDATE `failed_action_items` SET `resolved_at` = CURRENT_TIMESTAMP - INTERVAL 31 DAY WHERE `item_key` = 'vendor:listing'");
      expect(await items.forgetResolvedBefore(pool, 30)).toBe(1);
      expect((await items.openItems(pool)).map((i) => i.key)).toEqual(["vendor:other"]);
      expect(await items.itemCount(pool)).toBe(1);
      // A caller asking for less than a week still keeps the tab's own week.
      await items.reconcileSource(pool, "integrations", []);
      expect(await items.forgetResolvedBefore(pool, 0)).toBe(0);
    });

    it("reads today, and whether a notice went out on it, from the database's one clock", async () => {
      await items.reconcileSource(pool, "jobs", [finding("a")]);
      const before = await items.noticeDay(pool);
      const [rows] = await q("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS day");
      expect(before).toEqual({ day: (rows as Array<{ day: string }>)[0].day, alreadySent: false });
      await items.markNotified(pool, await items.openItems(pool));
      expect((await items.noticeDay(pool)).alreadySent).toBe(true);
    });

    it("dates a failure from when it began when its source knows, and never moves that later", async () => {
      await items.reconcileSource(pool, "payments", [finding("stays:ord-1", { failingForSeconds: 8 * 3600 })]);
      expect((await items.openItems(pool))[0].ageSeconds).toBeGreaterThanOrEqual(8 * 3600 - 5);
      await items.reconcileSource(pool, "payments", [finding("stays:ord-1", { failingForSeconds: 3600 })]);
      expect((await items.openItems(pool))[0].ageSeconds).toBeGreaterThanOrEqual(8 * 3600 - 5);
      await items.reconcileSource(pool, "payments", [finding("stays:ord-1", { failingForSeconds: 12 * 3600 })]);
      expect((await items.openItems(pool))[0].ageSeconds).toBeGreaterThanOrEqual(12 * 3600 - 5);
    });

    it("keeps each item's quiet hours on its row, so a run that cannot read the area still honours them", async () => {
      await items.reconcileSource(pool, "calendars", [finding("c1", { quietHours: 24 })]);
      expect((await items.openItems(pool))[0].quietSeconds).toBe(24 * 3600);
      await items.reconcileSource(pool, "calendars", [finding("c1", { quietHours: 6 })]);
      expect((await items.openItems(pool))[0].quietSeconds).toBe(6 * 3600);
    });
  });

  describe("the reads that decide something", () => {
    it("runs the counting reads against the migrated schema", async () => {
      // A zero from an empty table proves only that the statement parses and
      // names columns that exist. That is this case's whole claim: a wrong
      // column name is invisible to the compiler and to any mock.
      await expect(sources.scheduledJobRows(pool)).resolves.toEqual([]);
      await expect(sources.unrelayedFeedbackCount(pool)).resolves.toBe(0);
      await expect(sources.droppedDeliveries(pool, "no member-secrets key")).resolves.toBe(0);
      await expect(sources.failedCalendars(pool)).resolves.toEqual([]);
      await expect(sources.ledgerKeysPresent(pool, ["seat:none:-:nobody:1:keep"])).resolves.toEqual(new Set());
    });

    it("lists each order a settle error left, until a finished delivery of the same event heals it", async () => {
      const log = (
        id: string,
        outcome: string,
        module: string | null,
        order: string | null,
        minutesAgo: number,
        { detail = null as string | null, type = "checkout.session.completed", handled = true } = {},
      ) =>
        q(
          "INSERT INTO `payments_log` (`id`, `module`, `order_id`, `type`, `outcome`, `detail`, `at`, `handled_at`) " +
            "VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP - INTERVAL ? MINUTE, IF(?, CURRENT_TIMESTAMP, NULL))",
          [id, module, order, type, outcome, detail, minutesAgo, handled],
        );
      // Healed: a finished delivery of the same event, after the error.
      await log("pl-1", "settle_error", "stays", "ord-healed", 300, { detail: "first try" });
      await log("pl-2", "ok", "stays", "ord-healed", 240);
      // Two failed deliveries of one order: one item, dated from the first, quoting the last.
      await log("pl-3", "settle_error", "stays", "ord-twice", 600, { detail: "try one" });
      await log("pl-4", "settle_error", "stays", "ord-twice", 540, { detail: "try two" });
      // An ok BEFORE the error proves nothing about it. Review found no case had one.
      await log("pl-5", "ok", "stays", "ord-ok-before", 700);
      await log("pl-6", "settle_error", "stays", "ord-ok-before", 500, { detail: "after the ok" });
      // An ok whose dispatch never finished is only the claim written before dispatch.
      await log("pl-7", "settle_error", "stays", "ord-unfinished", 480, { detail: "crashed mid-dispatch" });
      await log("pl-8", "ok", "stays", "ord-unfinished", 420, { handled: false });
      // An ok for another event type on the same order is not this delivery settling.
      await log("pl-9", "settle_error", "stays", "ord-other-type", 460, { detail: "only an expiry came back" });
      await log("pl-10", "ok", "stays", "ord-other-type", 400, { type: "checkout.session.expired" });
      // No order named, and an order-less ok proves nothing about it.
      await log("pl-11", "settle_error", null, null, 440, { detail: "renewal refused" });
      await log("pl-12", "ok", null, null, 60);
      // Older than the window.
      await log("pl-13", "settle_error", "stays", "ord-ancient", 40 * 24 * 60, { detail: "too old to list" });

      const { groups, more } = await sources.unhealedSettleErrors(pool, 30, 200);

      expect(more).toBe(false);
      expect(groups.map((g) => [g.module, g.orderId, g.errors, g.latestDetail])).toEqual([
        ["stays", "ord-twice", 2, "try two"],
        ["stays", "ord-ok-before", 1, "after the ok"],
        ["stays", "ord-unfinished", 1, "crashed mid-dispatch"],
        ["stays", "ord-other-type", 1, "only an expiry came back"],
        [null, null, 1, "renewal refused"],
      ]);
      expect(groups[0].oldestAgeSeconds).toBeGreaterThanOrEqual(600 * 60 - 5);
    });

    it("limits settle errors by order, never by row, and says when there were more", async () => {
      for (const n of [1, 2, 3]) {
        // Each order redelivered five times: a row limit of 2 would have shown one order.
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await q(
            "INSERT INTO `payments_log` (`id`, `module`, `order_id`, `type`, `outcome`, `at`) " +
              "VALUES (?, 'stays', ?, 'checkout.session.completed', 'settle_error', CURRENT_TIMESTAMP - INTERVAL ? MINUTE)",
            [`pl-more-${n}-${attempt}`, `ord-more-${n}`, 100 - n * 10 - attempt],
          );
        }
      }
      const { groups, more } = await sources.unhealedSettleErrors(pool, 30, 2);
      expect(groups.map((g) => [g.orderId, g.errors])).toEqual([
        ["ord-more-1", 5],
        ["ord-more-2", 5],
      ]);
      expect(more).toBe(true);
    });

    it("counts refused deliveries from the last day, by outcome", async () => {
      const rows: Array<[string, string, number]> = [
        ["r1", "sig_fail", 1],
        ["r2", "sig_fail", 2],
        ["r3", "sig_fail", 30],
        ["r4", "no_order", 1],
        ["r5", "duplicate", 1],
      ];
      for (const [id, outcome, hoursAgo] of rows) {
        await q("INSERT INTO `payments_log` (`id`, `type`, `outcome`, `at`) VALUES (?, 'x', ?, CURRENT_TIMESTAMP - INTERVAL ? HOUR)", [
          id,
          outcome,
          hoursAgo,
        ]);
      }
      expect(await sources.paymentRefusalCounts(pool, 24)).toEqual({ sig_fail: 2, no_order: 1 });
    });

    it("reads each ballot's newest attempt: one that recorded an error counts at once, a silent one after ten minutes", async () => {
      const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
      // Failed once, then landed on the retry: nothing to report.
      await insertAttempt(pool, { ballotId: "bal-landed", claimedAt: minutesAgo(60), attempts: 1 });
      await annotateNewestOpenAttempt(pool, "bal-landed", "the first try failed");
      await insertAttempt(pool, { ballotId: "bal-landed", claimedAt: minutesAgo(50), attempts: 2 });
      await closeNewestOpenAttempt(pool, "bal-landed", minutesAgo(49));
      // An older attempt that finished does not hide a newer one that failed.
      await insertAttempt(pool, { ballotId: "bal-stuck", claimedAt: minutesAgo(60), attempts: 1 });
      await closeNewestOpenAttempt(pool, "bal-stuck", minutesAgo(59));
      await insertAttempt(pool, { ballotId: "bal-stuck", claimedAt: minutesAgo(30), attempts: 2 });
      await annotateNewestOpenAttempt(pool, "bal-stuck", "the executor threw");
      // Attempted every five minutes and failing each time, so its newest row is a
      // minute old. Review found the ten-minute test alone never saw this one.
      await insertAttempt(pool, { ballotId: "bal-retrying", claimedAt: minutesAgo(6), attempts: 1 });
      await annotateNewestOpenAttempt(pool, "bal-retrying", "the executor threw");
      await insertAttempt(pool, { ballotId: "bal-retrying", claimedAt: minutesAgo(1), attempts: 2 });
      await annotateNewestOpenAttempt(pool, "bal-retrying", "the executor threw again");
      // Begun a minute ago with no error yet: still running.
      await insertAttempt(pool, { ballotId: "bal-live", claimedAt: minutesAgo(1), attempts: 1 });
      // Begun twenty minutes ago and silent since: most likely a restart.
      await insertAttempt(pool, { ballotId: "bal-silent", claimedAt: minutesAgo(20), attempts: 1 });

      const stuck = await stuckLandings(pool, minutesAgo(10));

      expect(stuck.map((r) => r.ballotId).sort()).toEqual(["bal-retrying", "bal-silent", "bal-stuck"]);
      expect(stuck.find((r) => r.ballotId === "bal-retrying")).toMatchObject({ attempts: 2, lastError: "the executor threw again" });
    });

    it("lists a stuck landing only while its decision is still owed one", async () => {
      await ballot("bal-owed", "pending");
      await ballot("bal-done", "applied");
      await ballot("bal-written-off", "expired");
      for (const id of ["bal-owed", "bal-done", "bal-written-off"]) {
        await insertAttempt(pool, { ballotId: id, claimedAt: new Date(Date.now() - 60 * 60_000), attempts: 1 });
        await annotateNewestOpenAttempt(pool, id, "the executor threw");
      }

      expect(await landingStatusesFor(pool, ["bal-owed", "bal-done", "bal-missing"])).toEqual(
        new Map([
          ["bal-owed", "pending"],
          ["bal-done", "applied"],
        ]),
      );
      expect((await defaultSources(pool)[3].find()).map((f) => f.key)).toEqual(["bal-owed"]);
    });

    it("words a stuck landing by whether its decision still has a landing time", async () => {
      await ballot("bal-retrying-launch", "pending");
      await ballot("bal-left-at-close", "stalled");
      await q("UPDATE `ballots` SET `lands_at` = NOW() - INTERVAL 1 HOUR WHERE `id` = ?", ["bal-retrying-launch"]);
      for (const id of ["bal-retrying-launch", "bal-left-at-close"]) {
        await insertAttempt(pool, { ballotId: id, claimedAt: new Date(Date.now() - 60 * 60_000), attempts: 1 });
        await annotateNewestOpenAttempt(pool, id, "the executor threw");
      }

      expect(await scheduledLandings(pool, ["bal-retrying-launch", "bal-left-at-close", "bal-missing"])).toEqual(
        new Set(["bal-retrying-launch"]),
      );
      const governance = defaultSources(pool).find((s) => s.key === "governance");
      const advice = new Map((await governance!.find()).map((f) => [f.key, String(f.advice)] as [string, string]));
      expect(advice.get("bal-retrying-launch")).toContain("tries it again every few minutes");
      expect(advice.get("bal-left-at-close")).toContain("nothing tries it again");
    });

    it("pages kept seat fees newest first, one range at a time", async () => {
      for (const n of [1, 2, 3, 4, 5]) await seatCharge(n);
      const first = await sources.keptSeatChargesBefore(pool, null, 2);
      const second = await sources.keptSeatChargesBefore(pool, first[first.length - 1].id, 2);
      const third = await sources.keptSeatChargesBefore(pool, second[second.length - 1].id, 2);
      expect([first, second, third].map((page) => page.map((r) => r.id))).toEqual([
        ["sc-0005", "sc-0004"],
        ["sc-0003", "sc-0002"],
        ["sc-0001"],
      ]);
      expect(first[0].settledAgeSeconds).toBeGreaterThanOrEqual(2 * 3600 - 5);
    });

    it("finds a kept seat fee whose transfer never landed, however many landed fees surround it", async () => {
      // 250 kept fees, more than one page. Every transfer landed except the oldest one's.
      for (let n = 1; n <= 250; n += 1) await seatCharge(n);
      for (const r of await sources.keptSeatChargesBefore(pool, null, 1000)) {
        if (r.id === "sc-0001") continue;
        await q(
          "INSERT INTO `token_ledger` (`id`, `from_account`, `to_account`, `token_type`, `amount`, `source`, `idempotency_key`) " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
            "VALUES (?, 'sys:event-escrow', 'sys:treasury', 'seat-credit', 5, 'event_seat_kept', ?)",
          [`tl-${r.id}`, keysFor(r).keep],
        );
      }
      // Tonight's fee, whose transfer failed after it was marked kept. A read of the
      // oldest 200 kept fees, which is what shipped first, never reached it.
      await seatCharge(251);
      // Kept ten minutes ago, and still held: neither is stranded yet.
      await seatCharge(252, "kept", 10);
      await seatCharge(253, "held", null);

      const found = await defaultSources(pool)[12].find();

      expect(found.map((f) => f.key)).toEqual(["sc-0251", "sc-0001"]);
    }, 120_000);

    it("finds the linked villages that need a person, and leaves a fresh error and an example alone", async () => {
      const peer = (id: string, status: string, error: string | null, syncedHoursAgo: number, example = 0) =>
        q(
          "INSERT INTO `peer_instances` (`id`, `instance_id`, `base_url`, `name`, `added_by`, `status`, `last_error`, `last_sync_at`, `is_example`) " +
            "VALUES (?, ?, ?, ?, 'usr-admin', ?, ?, CURRENT_TIMESTAMP - INTERVAL ? HOUR, ?)",
          [id, `inst-${id}`, `https://${id}.examples.invalid`, `Village ${id}`, status, error, syncedHoursAgo, example],
        );
      await peer("p-paused", "paused", null, 1);
      await peer("p-stale", "active", "timeout", 72);
      await peer("p-fresh", "active", "timeout", 1);
      await peer("p-quiet", "active", null, 72);
      await peer("p-example", "paused", null, 1, 1);

      expect((await sources.troubledPeers(pool, 48)).map((p) => p.id).sort()).toEqual(["p-paused", "p-stale"]);
    });

    it("finds a connection failing three times running since its last success", async () => {
      const health = (module: string, failures: number, failedHoursAgo: number, succeededHoursAgo: number | null) =>
        q(
          "INSERT INTO `integration_health` (`module_id`, `operation`, `consecutive_failures`, `last_failure_at`, `last_failure_status`, " +
            "`last_failure_detail`, `last_success_at`) VALUES (?, 'listing', ?, CURRENT_TIMESTAMP - INTERVAL ? HOUR, '503', 'unavailable', " +
            "IF(? IS NULL, NULL, CURRENT_TIMESTAMP - INTERVAL ? HOUR))",
          [module, failures, failedHoursAgo, succeededHoursAgo, succeededHoursAgo],
        );
      await health("vendor-broken", 3, 1, 5);
      await health("vendor-healed", 5, 3, 1);
      await health("vendor-blip", 2, 1, null);

      expect(await sources.failingIntegrations(pool, 3)).toEqual([
        { moduleId: "vendor-broken", operation: "listing", status: "503", detail: "unavailable", consecutiveFailures: 3 },
      ]);
    });

    it("reads the startup checks from this process's lifetime, which kind each was, and never their text", async () => {
      const event = (id: string, entityType: string, entityRef: string, secondsAgo: number) =>
        q(
          "INSERT INTO `health_events` (`id`, `kind`, `text`, `entity_type`, `entity_ref`, `audience`, `at`) " +
            "VALUES (?, 'module_quarantine', ?, ?, ?, 'admin', CURRENT_TIMESTAMP - INTERVAL ? SECOND)",
          [id, `repaired orphan loan L1 (member usr-1784000000000-${id})`, entityType, entityRef, secondsAgo],
        );
      await event("he-module", "module", "library", 30);
      await event("he-village", "village", "capability_holding", 40);
      await event("he-before-boot", "module", "library", 7200);

      const rows = await sources.recentQuarantines(pool, 3600);

      expect(rows).toEqual([
        { id: "he-module", entityType: "module", entityRef: "library" },
        { id: "he-village", entityType: "village", entityRef: "capability_holding" },
      ]);
      expect(JSON.stringify(rows)).not.toContain("usr-");
    });

    it("counts a failed summary only while its recording still has none", async () => {
      const item = (custom: string, recording: string, status: string) =>
        q("INSERT INTO `synthesis_batch_items` (`batch_id`, `custom_id`, `recording_id`, `status`) VALUES ('batch-1', ?, ?, ?)", [
          custom,
          recording,
          status,
        ]);
      await item("c1", "rec-failed", "failed");
      await item("c2", "rec-failed", "failed");
      await item("c3", "rec-fixed-by-hand", "failed");
      await item("c4", "rec-still-trying", "errored");
      await q("INSERT INTO `call_syntheses` (`id`, `recording_id`, `ai_body`, `body`, `model`) VALUES ('syn-1', 'rec-fixed-by-hand', 'x', 'x', 'test-model')");

      expect(await sources.failedSynthesisRecordings(pool, 7)).toBe(1);
    });

    it("keeps no person in a key or a title, scrubs copied errors, and forgets them when the failure clears", async () => {
      const personal = ["usr-1784000000000-wren", "wren@example.org", "Wren Halloway"];
      await q(
        "INSERT INTO `health_events` (`id`, `kind`, `text`, `entity_type`, `entity_ref`, `audience`) " +
          "VALUES ('he-privacy', 'module_quarantine', 'repaired orphan loan L1 (member usr-1784000000000-wren)', 'module', 'library', 'admin')",
      );
      await q(
        "INSERT INTO `external_calendars` (`id`, `name`, `url_host`, `secret_ref`, `last_status`, `last_error`) " +
          "VALUES ('cal-privacy', 'Wren Halloway, private sessions', 'calendar.example.org', 'ref-privacy', 'failed', 'HTTP 404')",
      );
      await q(
        "INSERT INTO `integration_health` (`module_id`, `operation`, `consecutive_failures`, `last_failure_at`, `last_failure_status`, `last_failure_detail`) " +
          "VALUES ('mailer', 'send', 3, CURRENT_TIMESTAMP - INTERVAL 1 HOUR, '550', 'RCPT TO:<wren@example.org> refused')",
      );
      await q(
        "INSERT INTO `payments_log` (`id`, `module`, `order_id`, `type`, `outcome`, `detail`, `at`) " +
          "VALUES ('pl-privacy', 'stays', 'ord-9', 'checkout.session.completed', 'settle_error', 'charge for usr-1784000000000-wren failed', CURRENT_TIMESTAMP - INTERVAL 1 HOUR)",
      );
      const run = () => runFailedActions({ pool, sources: defaultSources(pool), retries: [], notifyAdmins: async () => undefined, isFirstRun: async () => false });

      await run();
      const [open] = await q("SELECT * FROM `failed_action_items` WHERE `resolved_at` IS NULL");
      const openRows = open as Array<Record<string, unknown>>;
      expect(openRows.map((r) => r.source).sort()).toEqual(["calendars", "integrations", "payments", "quarantine"]);
      for (const word of personal.slice(0, 2)) expect(JSON.stringify(openRows), word).not.toContain(word);
      // The feed name is admin-typed, so it may ride in last_error while the feed is failing, and nowhere else.
      expect(JSON.stringify(openRows.map((r) => [r.item_key, r.title, r.advice]))).not.toContain("Wren");

      await q("DELETE FROM `health_events` WHERE `id` = 'he-privacy'");
      await q("UPDATE `external_calendars` SET `last_status` = 'ok' WHERE `id` = 'cal-privacy'");
      await q("UPDATE `integration_health` SET `consecutive_failures` = 0, `last_success_at` = CURRENT_TIMESTAMP WHERE `module_id` = 'mailer'");
      await q(
        "INSERT INTO `payments_log` (`id`, `module`, `order_id`, `type`, `outcome`, `at`, `handled_at`) " +
          "VALUES ('pl-privacy-ok', 'stays', 'ord-9', 'checkout.session.completed', 'ok', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
      );
      await run();

      const [all] = await q("SELECT * FROM `failed_action_items`");
      expect((all as Array<{ resolved_at: unknown }>).every((r) => r.resolved_at != null)).toBe(true);
      for (const word of personal) expect(JSON.stringify(all), word).not.toContain(word);
    });
  });

  describe("a run", () => {
    let notices: unknown[][] = [];
    const notifyAdmins = async (...args: unknown[]) => {
      notices.push(args);
    };
    const pastFirstRun = async () => false;

    beforeEach(() => {
      notices = [];
    });

    it("records its first run on a village without telling anybody, and says nothing new on the run after", async () => {
      expect(await firstRunHere(pool)).toBe(true);
      const payments = source("payments", async () => [finding("stays:ord-1")]);

      const summary = await runFailedActions({ pool, sources: [payments], retries: [], notifyAdmins });

      expect(summary).toBe("1 area read, 1 thing failing; first run: 1 recorded without a notice");
      expect(notices).toEqual([]);
      expect(await firstRunHere(pool)).toBe(false);

      // The first run stamped the standing failure as told. Review found that
      // deleting that stamp left everything above green, so move today's stamp to
      // yesterday (a missing stamp stays missing) and run again: nothing is new.
      await q("UPDATE `failed_action_items` SET `notified_at` = `notified_at` - INTERVAL 1 DAY");
      await runFailedActions({ pool, sources: [payments], retries: [], notifyAdmins });
      expect(notices).toEqual([]);
    });

    it("is past its first run once the scheduler holds a result for it, even with nothing recorded", async () => {
      await q("INSERT INTO `scheduled_jobs` (`job`, `last_result`) VALUES (?, 'ok in 5ms')", [FAILED_ACTIONS_JOB]);
      expect(await firstRunHere(pool)).toBe(false);
    });

    it("tells the admins once a day, links the tab, and holds back what is still in its quiet hours", async () => {
      // Node's clock is set years away from the database's on purpose: the day a
      // notice is filed under must come from the clock `notified_at` is stamped by.
      const elsewhen = Date.parse("2001-01-01T23:30:00Z");
      const run = (findings: ReportFinding[]) =>
        runFailedActions({ pool, sources: [source("peers", async () => findings)], retries: [], notifyAdmins, isFirstRun: pastFirstRun, now: () => elsewhen });
      const { day } = await items.noticeDay(pool);

      await run([finding("p1"), finding("p2", { quietHours: 24 })]);

      expect(notices).toEqual([
        ["failed_action", "1 thing is failing in the village. The report says what to do about it.", `failed-actions:${day}`, "/admin?tab=failures"],
      ]);
      const open = await items.openItems(pool);
      expect(open.find((i) => i.key === "p1")!.toldThisEpisode).toBe(true);
      expect(open.find((i) => i.key === "p2")!.notifiedAt).toBeNull();

      await run([finding("p1"), finding("p2", { quietHours: 24 }), finding("p3")]);
      expect(notices).toHaveLength(1);
    });

    it("says nothing while everything open is inside its quiet hours", async () => {
      const summary = await runFailedActions({
        pool,
        sources: [source("calendars", async () => [finding("c1", { quietHours: 24 })])],
        retries: [],
        notifyAdmins,
        isFirstRun: pastFirstRun,
      });
      expect(summary).toBe("1 area read, 1 thing failing");
      expect(notices).toEqual([]);
    });

    it("counts quiet hours from when the failure began, so an old failure is never held back as new", async () => {
      await runFailedActions({
        pool,
        sources: [source("payments", async () => [finding("stays:ord-1", { quietHours: 6, failingForSeconds: 8 * 3600 })])],
        retries: [],
        notifyAdmins,
        isFirstRun: pastFirstRun,
      });
      expect(notices).toHaveLength(1);
    });

    it("never swallows a notice when a failure clears and comes back on the same day", async () => {
      const jobs = (findings: ReportFinding[]) => source("jobs", async () => findings);
      await runFailedActions({ pool, sources: [jobs([finding("x")])], retries: [], notifyAdmins, isFirstRun: pastFirstRun });
      expect(notices).toHaveLength(1);
      // x clears, then comes back beside a new failure, y, all before midnight.
      await runFailedActions({ pool, sources: [jobs([])], retries: [], notifyAdmins, isFirstRun: pastFirstRun });
      await runFailedActions({ pool, sources: [jobs([finding("x"), finding("y")])], retries: [], notifyAdmins, isFirstRun: pastFirstRun });

      // Today's notice already went out, so nothing more goes today, and neither
      // item is marked as told by a notice that never reached anyone. Before the
      // fix, the reopen erased today's only stamp and a second notice was sent
      // under a key the dedupe had already seen.
      expect(notices).toHaveLength(1);
      expect((await items.openItems(pool)).map((i) => [i.key, i.toldThisEpisode]).sort()).toEqual([
        ["x", false],
        ["y", false],
      ]);
    });

    it("stamps every open item a notice covers, so reminders fall due together and never one a day", async () => {
      await items.reconcileSource(pool, "jobs", [finding("old"), finding("recent")]);
      // "old" was told eight days ago and is due a reminder. "recent" was told two days ago.
      await q(
        "UPDATE `failed_action_items` SET `notified_episode` = `episode`, " +
          "`notified_at` = CURRENT_TIMESTAMP - INTERVAL 8 DAY WHERE `item_key` = 'old'",
      );
      await q(
        "UPDATE `failed_action_items` SET `notified_episode` = `episode`, " +
          "`notified_at` = CURRENT_TIMESTAMP - INTERVAL 2 DAY WHERE `item_key` = 'recent'",
      );

      await runFailedActions({
        pool,
        sources: [source("jobs", async () => [finding("old"), finding("recent")])],
        retries: [],
        notifyAdmins,
        isFirstRun: pastFirstRun,
      });

      expect(notices).toEqual([
        ["failed_action", "2 things are still failing in the village. The report says what to do about each.", expect.any(String), "/admin?tab=failures"],
      ]);
      // Both carry today's stamp now. Stamping only the one that was due gave the
      // other a reminder day of its own, and a standing list a notice every day.
      const open = await items.openItems(pool);
      expect(open.map((i) => i.notifiedAgeSeconds != null && i.notifiedAgeSeconds < 120)).toEqual([true, true]);
    });

    it("keeps an unreadable area's items, says it could not read the area, and closes both once it can", async () => {
      let answer: "one" | "throw" | "none" = "one";
      const payments = source("payments", async () => {
        if (answer === "throw") throw new Error("the payments table is locked");
        return answer === "one" ? [finding("stays:ord-1")] : [];
      });
      const run = () => runFailedActions({ pool, sources: [payments], retries: [], notifyAdmins, isFirstRun: pastFirstRun });

      await run();
      answer = "throw";
      expect(await run()).toBe("0 areas read, 0 things failing");
      expect(await openKeys()).toEqual(["payments/stays:ord-1", `${REPORT_SOURCE}/payments`]);
      const couldNotRead = (await items.openItems(pool)).find((i) => i.source === REPORT_SOURCE)!;
      expect(couldNotRead).toMatchObject({ title: "This report could not read payments", lastError: "the payments table is locked" });

      answer = "none";
      await run();
      expect(await items.openItems(pool)).toEqual([]);
    });

    it("stops when out of time, closes nothing it never reached, and says so as an item", async () => {
      let clock = 0;
      const now = () => clock;
      const run = (areas: FailureSource[]) => runFailedActions({ pool, sources: areas, retries: [], notifyAdmins, isFirstRun: pastFirstRun, now });
      // peers holds an item, and this report holds a "could not read peers" item.
      await run([source("peers", async () => [finding("p1")])]);
      await run([
        source("peers", async () => {
          throw new Error("the peers table is locked");
        }),
      ]);
      expect(await openKeys()).toEqual(["peers/p1", `${REPORT_SOURCE}/peers`]);

      const slow = source("payments", async () => {
        clock += RUN_BUDGET_MS + 1;
        return [];
      });
      const summary = await run([slow, source("peers", async () => [])]);

      expect(summary).toContain("stopped after 1 of 2 areas, out of time");
      // Review found nothing proved the unreached area's "could not read" item survived a run out of time.
      expect(await openKeys()).toEqual(["peers/p1", `${REPORT_SOURCE}/out-of-time`, `${REPORT_SOURCE}/peers`]);
      expect((await items.openItems(pool)).find((i) => i.key === "out-of-time")!.lastError).toBe("Not reached: Linked villages");

      // The next run reaches everything and closes both of this report's own items.
      clock = 0;
      await run([source("payments", async () => []), source("peers", async () => [])]);
      expect(await openKeys()).toEqual([]);
    });

    it("returns at once while another run holds the lock, and lets go when it ends", async () => {
      let inner = "";
      await runFailedActions({
        pool,
        retries: [],
        notifyAdmins,
        isFirstRun: pastFirstRun,
        sources: [
          source("jobs", async () => {
            inner = await runFailedActions({ pool, sources: [], retries: [], notifyAdmins, isFirstRun: pastFirstRun });
            return [];
          }),
        ],
      });
      expect(inner).toBe("skipped: another run holds the lock");
      expect(await runFailedActions({ pool, sources: [], retries: [], notifyAdmins, isFirstRun: pastFirstRun })).toBe("0 areas read, 0 things failing");
    });

    it("notes a retry that threw, and reads every area anyway", async () => {
      const summary = await runFailedActions({
        pool,
        notifyAdmins,
        isFirstRun: pastFirstRun,
        retries: [
          async () => {
            throw new Error("the sweep could not start");
          },
        ],
        sources: [source("jobs", async () => [])],
      });
      expect(summary).toBe("1 area read, 0 things failing; a retry failed: the sweep could not start");
    });

    it("names its lock for this database, so another village on the same server never takes it", async () => {
      const inside = await withNamedLock(pool, "failed-actions-proof", async () => {
        const [rows] = await q(
          "SELECT IS_USED_LOCK(CONCAT('failed-actions-proof:', DATABASE())) AS named, IS_USED_LOCK('failed-actions-proof') AS bare",
        );
        return (rows as Array<{ named: unknown; bare: unknown }>)[0];
      });
      expect(inside.ran).toBe(true);
      const value = (inside as { value: { named: unknown; bare: unknown } }).value;
      expect(value.named).not.toBeNull();
      expect(value.bare).toBeNull();
    });
  });

  describe("the one retry", () => {
    const soon = () => Date.now() + 60_000;

    it("finishes a closed account's deletion once its wait is over", async () => {
      await stalledAfterClose(3);

      expect(await resumeClosedErasures(pool, deps(), soon())).toBe("resumed 1 closed deletion, 1 finished");
      expect((await erasureRecord(pool, MEMBER))!.finishedAt).toBeTruthy();
    });

    it("finishes it even while the member has an open loan, because the steps left touch no loan", async () => {
      await stalledAfterClose(3);
      await q("INSERT INTO `library_loans` (`id`, `item_id`, `user_id`, `status`) VALUES ('loan-open', 'item-1', ?, 'active')", [MEMBER]);

      expect(await resumeClosedErasures(pool, deps(), soon())).toBe("resumed 1 closed deletion, 1 finished");
      expect((await erasureRecord(pool, MEMBER))!.finishedAt).toBeTruthy();
      const [loans] = await q("SELECT `status`, `settled_at` FROM `library_loans` WHERE `id` = 'loan-open'");
      expect(loans).toEqual([{ status: "active", settled_at: null }]);
    });

    it("leaves a deletion that stopped before the account closed for a person, however old", async () => {
      await beginErasure(pool, MEMBER);
      await noteErasureFailed(pool, MEMBER, "role-holdings", "refused");
      await q("UPDATE `member_erasures` SET `last_attempt_at` = CURRENT_TIMESTAMP - INTERVAL 30 DAY WHERE `user_id` = ?", [MEMBER]);

      expect(await resumeClosedErasures(pool, deps(), soon())).toBeNull();
      expect(await erasureRecord(pool, MEMBER)).toMatchObject({ attempts: 1, finishedAt: null });
    });

    it("waits out its backoff", async () => {
      await stalledAfterClose(1);

      expect(await resumeClosedErasures(pool, deps(), soon())).toBeNull();
      expect(await erasureRecord(pool, MEMBER)).toMatchObject({ attempts: 1, finishedAt: null });
    });

    it("stops after ten attempts, and the report hands the deletion to a person", async () => {
      await stalledAfterClose(48, 10);

      expect(await resumeClosedErasures(pool, deps(), soon())).toBeNull();
      expect((await defaultSources(pool)[0].find()).map((f) => f.key)).toEqual(["needs-a-person"]);
    });

    it("never touches an example account", async () => {
      await q("UPDATE `users` SET `is_example` = 1 WHERE `id` = ?", [MEMBER]);
      await stalledAfterClose(3);

      expect(await resumeClosedErasures(pool, deps(), soon())).toBeNull();
      expect(await erasureRecord(pool, MEMBER)).toMatchObject({ attempts: 1, finishedAt: null });
    });

    it("claims a sweep before running it, so one somebody attempted moments ago is left to that attempt", async () => {
      await stalledAfterClose(3);
      // A steward presses Finish them between the job's snapshot and its claim.
      await noteResumeAttempt(pool, MEMBER);
      expect(await claimResume(pool, MEMBER, 2 * 3600)).toBe(false);

      await q("UPDATE `member_erasures` SET `last_attempt_at` = CURRENT_TIMESTAMP - INTERVAL 5 HOUR WHERE `user_id` = ?", [MEMBER]);
      expect(await claimResume(pool, MEMBER, 2 * 3600)).toBe(true);
      // And only once: the claim itself is an attempt the next caller must wait out.
      expect(await claimResume(pool, MEMBER, 2 * 3600)).toBe(false);
    });
  });
});
