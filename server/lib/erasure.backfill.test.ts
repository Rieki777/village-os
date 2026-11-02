/**
 * AN ERASURE THAT FINISHED BEFORE A STEP EXISTED, given that step once.
 *
 * Adversarial round 2, finding 14: `resumeErasure` returns at `finishedAt`,
 * and neither the queue nor the hourly job reads a finished record, so every
 * step added after a member's sweep finished never ran for them. A member
 * erased on 2026-10-20 kept their agent token, their open invitation link,
 * their place at a gathering, the vouch they gave somebody still waiting, the
 * group they owned and the voice somebody had handed them, for good.
 *
 * The fixture is that member: a finished record holding the step list the
 * sweep had on that day, and one live row for each of those steps. The boot
 * job (`backfillFinishedErasures`) must end each of them, move no value
 * twice, write down what it ran, and change nothing on a second run.
 *
 * Runs against a scratch schema with every real migration applied. No
 * TEST_DATABASE_URL and the database cases skip (harness rule); the
 * classification case at the bottom needs no database and always runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import {
  BACKFILL_BY_ID,
  BACKFILL_LEAVES_OUT,
  backfillFinishedErasures,
  backfillStepNames,
  erasureBackfillJob,
  resumeErasure,
  sweepStepNames,
  type ErasureDeps,
} from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { userIdForHandle } from "./profile";
import { agentRowsRemaining } from "../repos/memberAgent";
import { erasureRecord } from "../repos/memberErasure";
import { recordVouch, vouchesFor } from "../repos/vouches";
import { createInviteOn } from "../repos/memberInvites";
import { hashInviteToken, mintInviteToken } from "./invites";
import { mintToken } from "./agentTokens";
import { rsvp } from "./gatherings";
import { createMeetMe, joinWaitlist, setPromotionSink } from "./calendarCommunity";
import { seatChargeFor } from "./eventSeats";
import { createGroup } from "./messaging";
import { acceptDelegations, setDelegation } from "./delegation";
import { openBallot } from "./ballots";
import { CYCLE_POOL_FAUCET, balanceOf, checkLedgerInvariants, loadTokenRegistry, memberAccount, postTransfer } from "./ledger";
import { toLedgerUnits } from "./economy";
import { crewsRepo } from "./crews";
import * as placePhotosRepo from "../repos/placePhotos";
import { proposalMarkdown } from "./mechanics";

const configured = testDbConfigured();
const ANON = "A departed member";
const TOKEN = "credits";
const DAY = 86_400_000;

/**
 * The step list a record finished with on 2026-10-20, before the sweep gained
 * the steps of 2026-10-22 and 2026-10-23. Every step before the tombstone,
 * the tombstone, and the eight steps after it that existed then.
 */
const FINISHED_ON_2026_10_20 = [
  ...sweepStepNames().slice(0, sweepStepNames().indexOf("tombstone") + 1),
  "comms",
  "needs-after-tombstone",
  "journal-after-tombstone",
  "saberra-bridge-after-tombstone",
  "seat-application-words-after-tombstone",
  "alignment-names-after-tombstone",
  "season-plan-words-after-tombstone",
  "sessions-after-tombstone",
  "audit",
  "external-stores",
];

/** What that record lacks and finds by user id, in the sweep's order. */
const GIVEN_TO_IT = [
  "handle-after-tombstone",
  "member-agent-after-tombstone",
  "guest-places-after-tombstone",
  "invites-after-tombstone",
  "meet-me-windows-after-tombstone",
  "notices-naming-after-tombstone",
  "ballot-words-after-tombstone",
  "proposal-ballot-words-after-tombstone",
  "exit-notes-after-tombstone",
  "relayed-mail-after-tombstone",
  "checkin-notes-after-tombstone",
  "pulse-lines-naming-after-tombstone",
  "submission-words-after-tombstone",
  "role-tensions-after-tombstone",
  "event-places-after-tombstone",
  "housing-contacts-after-tombstone",
  "housing-reservations-after-tombstone",
  "vouches-after-tombstone",
  "conversations-after-tombstone",
  "delegations-after-tombstone",
  "ventures-after-tombstone",
  "investor-fact-words-after-tombstone",
  "stay-notes-after-tombstone",
  "purchase-emails-after-tombstone",
  "role-proposals-after-tombstone",
  "seat-journal-after-tombstone",
  "seat-claims-after-tombstone",
  "org-seatings-after-tombstone",
  "role-holdings-after-tombstone",
  "gene-keys-after-tombstone",
  "quest-crews-after-tombstone",
  "photo-report-reasons-after-tombstone",
  "session-cards-after-tombstone",
  "companions-after-tombstone",
  "product-subscriptions-after-tombstone",
];

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

/** Every notice the backfill hands the spine, in order. */
let notices: any[] = [];

/** The submissions store and the permission holdings, as the erasure's singletons hold them. */
let submissions: any[] = [];
let holders: Array<{ id: string; userId: string }> = [];
/** Every list of holding ids the backfill handed `roleHoldersRepo.remove`. */
let removed: string[][] = [];

/** What a removed value reads as (server/lib/submissionWords.ts). */
const REMOVED = "[removed at member's request]";

/** An open claim on a seat, the shape POST /api/org/seatings/:id/claim writes (server/routes/org.ts). */
const claim = (id: string, userId: string, name: string) => ({
  id,
  type: "seat-claim",
  status: "new",
  rewarded: false,
  data: { assignmentId: `asg-${id}`, roleId: "bf-role-steward", roleName: "Steward", recordedName: name, name, email: null },
  userId,
  userName: name,
  submittedAt: "2026-10-19T09:00:00.000Z",
});

/**
 * The erasure's singletons with the real users repository, and the spine as a
 * recorder (or one that refuses). `update` passes its third argument through,
 * as server/index.ts does: a step that writes a tombstone's identity says so
 * with `erasure`, and a wrapper that dropped it would test a repository that
 * refuses the write.
 */
function deps(opts: { notifyThrows?: boolean } = {}): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: {
      byId: (id: string) => real.byId(id),
      update: (id: string, fn: (u: any) => void, how?: { erasure?: boolean }) => real.update(id, fn, how),
    },
    submissionsRepo: {
      all: () => submissions,
      replaceAll: async (rows: unknown[]) => {
        submissions = rows as any[];
      },
    },
    roleHoldersRepo: {
      remove: async (ids: string[]) => {
        removed.push([...ids]);
        holders = holders.filter((h) => !ids.includes(h.id));
      },
    },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => holders,
    uploadsDir,
    notify: async (input: any) => {
      if (opts.notifyThrows) throw new Error("the spine refused the notice");
      notices.push(input);
      return { fresh: true };
    },
  };
}

async function member(id: string, name: string, credits = 0): Promise<any> {
  await usersRepo(pool).add({ id, name, email: `${id}@example.test`, passwordHash: "x", paths: [] });
  if (credits > 0) {
    const r = await postTransfer(pool, {
      from: CYCLE_POOL_FAUCET, to: memberAccount(id), tokenType: TOKEN, amount: toLedgerUnits(TOKEN, credits),
      source: "gratitude_pool", idempotencyKey: `seed:${id}:${credits}`,
    });
    expect(r.ok).toBe(true);
  }
  return usersRepo(pool).byId(id);
}

/**
 * What the tombstone step wrote. Before round 2 it wrote the handle
 * `departed-<last eight of the id>`, which is the default here; since, it
 * writes none (`{ handle: null }`).
 */
async function tombstone(id: string, opts: { handle?: null } = {}): Promise<void> {
  await usersRepo(pool).update(id, (u: any) => {
    u.name = ANON;
    u.email = `deleted-${u.id}@anonymized.invalid`;
    u.handle = opts.handle === null ? null : `departed-${String(u.id).slice(-8)}`;
    u.passwordHash = "";
    u.membershipGranted = false;
  });
}

/** A record as a sweep left it: finished at a fixed moment, holding these steps. */
async function finishedRecord(id: string, steps: string[]): Promise<void> {
  await q(
    "INSERT INTO member_erasures (user_id, started_at, finished_at, attempts, last_attempt_at, steps_done) " +
      "VALUES (?, '2026-10-20 09:00:00', '2026-10-20 09:01:00', 1, '2026-10-20 09:00:00', ?)",
    [id, JSON.stringify(steps)],
  );
}

/** The record as the table holds it, with its dates as text so a moved one shows. */
async function recordRow(id: string): Promise<any> {
  const [r] = await q(
    "SELECT DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s') AS started, DATE_FORMAT(finished_at, '%Y-%m-%d %H:%i:%s') AS finished, " +
      "attempts, failed_step, last_error FROM member_erasures WHERE user_id = ?",
    [id],
  );
  return r ?? null;
}

/** An open link. The repository writes on the caller's connection, never a pool (`createInviteOn`). */
async function link(inviter: string, id: string): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await createInviteOn(conn, { id, tokenHash: hashInviteToken(mintInviteToken()), inviterUserId: inviter, days: 14 });
  } finally {
    conn.release();
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

async function gathering(id: string, opts: { capacity?: number | null; price?: number } = {}): Promise<void> {
  await q(
    "INSERT INTO events (id, title, starts_at, status, kind, layer, capacity, seat_price, seat_token) VALUES (?,?,?,'scheduled','gathering','village',?,?,?)",
    [id, `Gathering ${id}`, iso(new Date(Date.now() + 5 * DAY)), opts.capacity ?? null, opts.price ?? 0, (opts.price ?? 0) > 0 ? TOKEN : null],
  );
}

const answer = async (eventId: string, userId: string) =>
  (await q("SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?", [eventId, userId]))[0]?.status ?? null;

const ownersOf = async (conversationId: string): Promise<string[]> =>
  (await q("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND role = 'owner' AND left_at IS NULL ORDER BY user_id", [conversationId])).map(
    (r) => String(r.user_id),
  );

/**
 * Everything the backfill could write, read whole: the rows the fixture made,
 * the ledger, the bells, the audit spine and the records. A second run that
 * changes any of it shows up as a difference here.
 */
async function everything(): Promise<Record<string, unknown>> {
  return {
    rsvps: await q("SELECT event_id, user_id, status, occurrence_key FROM event_rsvps ORDER BY event_id, user_id"),
    waitlist: await q("SELECT event_id, user_id, promoted_at, left_at FROM event_waitlist ORDER BY event_id, user_id"),
    charges: await q("SELECT id, event_id, user_id, status, amount, settled_at FROM event_seat_charges ORDER BY id"),
    ledger: await q("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM token_ledger"),
    balances: await q("SELECT account_id, token_type, balance FROM token_balances ORDER BY account_id, token_type"),
    events: await q("SELECT id, kind, created_by FROM events ORDER BY id"),
    invites: await q("SELECT id, inviter_user_id, revoked_at, used_at FROM member_invites ORDER BY id"),
    tokens: await q("SELECT id, user_id FROM agent_tokens ORDER BY id"),
    vouches: await q("SELECT id, voucher_user_id, vouched_user_id, note FROM member_vouches ORDER BY id"),
    conversations: await q("SELECT conversation_id, user_id, role, left_at FROM conversation_members ORDER BY conversation_id, user_id"),
    delegations: await q("SELECT delegator_id, delegate_id, revoked_at, accepted_at FROM delegations ORDER BY delegator_id"),
    bells: await q("SELECT user_id, dedupe_key, title FROM notifications ORDER BY user_id, dedupe_key"),
    audit: await q("SELECT entity_ref, text FROM health_events WHERE kind = 'audit' ORDER BY entity_ref, text, id"),
    records: await q("SELECT user_id, CAST(steps_done AS CHAR) AS steps, finished_at, attempts, failed_step FROM member_erasures ORDER BY user_id"),
  };
}

describe.skipIf(!configured)("a finished erasure, given the steps it predates", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-backfill-"));
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    setPromotionSink(null);
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  beforeEach(() => {
    clearMemberDrivers();
    setPromotionSink(null);
    notices = [];
    submissions = [];
    holders = [];
    removed = [];
  });

  it("ends the agent token, the open link, the places, the vouch, the group and the delegation an old record left, and a second run changes nothing", async () => {
    const wren = await member("bf-wren", "Wren Halloway", 50);
    await member("bf-ash", "Ash Moreno");
    await member("bf-bo", "Bo Lind");
    await member("bf-pip", "Pip Arden", 20);
    await member("bf-moss", "Moss Tal");

    // While they were here: a token minted in the window "member-agent" had already passed.
    expect((await mintToken(pool, wren.id, { name: "laptop agent", scopes: ["calendar.read"] })).ok).toBe(true);
    // An invitation link nobody used.
    await link(wren.id, "inv-bf-wren");
    // The one seat at a full gathering ahead, with Bo waiting for it, and a paid place at another.
    await gathering("bf-full", { capacity: 1 });
    expect((await rsvp(pool, "bf-full", wren.id, "going")).ok).toBe(true);
    expect((await joinWaitlist(pool, "bf-full", "bf-bo")).ok).toBe(true);
    await gathering("bf-fee", { price: 5 });
    expect((await rsvp(pool, "bf-fee", wren.id, "going")).ok).toBe(true);
    // Pip paid for a place there too, so the escrow holds a fee that is not theirs to have back.
    expect((await rsvp(pool, "bf-fee", "bf-pip", "going")).ok).toBe(true);
    // A meet-me window: "Meet Wren", with the place, on the village layer.
    const starts = new Date(Date.now() + 26 * 3600_000);
    const window = await createMeetMe(pool, {
      userId: wren.id, firstName: "Wren Halloway", layer: "village", place: "the bakery on Calle 3",
      startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + 2 * 3600_000).toISOString(),
    });
    expect(window.ok).toBe(true);
    // A vouch for Pip, who is still waiting to be admitted.
    await recordVouch(pool, { id: "vch-bf-1", voucherUserId: wren.id, vouchedUserId: "bf-pip", kind: "member", note: "Known Pip for years" });
    // A group they own, with Moss and Ash in it.
    const group = await createGroup(pool, { createdBy: wren.id, name: "Orchard crew", memberIds: ["bf-moss", "bf-ash"] });
    // Ash handed them a voice, and they took it up.
    expect((await setDelegation(pool, "bf-ash", wren.id)).ok).toBe(true);
    await acceptDelegations(pool, wren.id, "bf-ash");
    // Ash thanked them on the public pulse, which a signed-out visitor reads at GET /api/game/pulse.
    await q(
      "INSERT INTO health_events (id, kind, text, actor_user_id, actor_kind, entity_type, entity_ref, audience, at) " +
        "VALUES ('bf-grat-wren', 'gratitude', 'Ash appreciated Wren', 'bf-ash', 'human', 'user', ?, 'public', CURRENT_TIMESTAMP - INTERVAL 1 HOUR)",
      [wren.id],
    );
    // A permission holding in a role, with Ash's beside it: a carried seat vote can seat them after "role-holdings" ran.
    holders = [{ id: "rh-bf-wren", userId: wren.id }, { id: "rh-bf-ash", userId: "bf-ash" }];
    // An open claim on a seat recorded under their name, which the stewards read, with Ash's open claim beside it.
    submissions = [claim("bf-claim-wren", wren.id, "Wren Halloway"), claim("bf-claim-ash", "bf-ash", "Ash Moreno")];

    const paid = await balanceOf(pool, memberAccount(wren.id), TOKEN);
    // Erased on 2026-10-20: the tombstone, and a record that finished with that day's steps.
    await tombstone(wren.id);
    await finishedRecord(wren.id, FINISHED_ON_2026_10_20);

    // Read as one, so a run that ends none of them says which all stayed.
    const standing = async () => ({
      agentTokens: (await agentRowsRemaining(pool, wren.id)).tokens,
      openLinks: (await q("SELECT id FROM member_invites WHERE inviter_user_id = ? AND revoked_at IS NULL AND used_at IS NULL", [wren.id])).length,
      places: (await q("SELECT event_id FROM event_rsvps WHERE user_id = ?", [wren.id])).length,
      meetMeWindows: (await q("SELECT id FROM events WHERE kind = 'meet-me' AND (created_by = ? OR owner_user_id = ?)", [wren.id, wren.id])).length,
      vouchesForThePending: (await q("SELECT id FROM member_vouches WHERE voucher_user_id = ?", [wren.id])).length,
      groupsOwned: (await q("SELECT conversation_id FROM conversation_members WHERE user_id = ? AND role = 'owner' AND left_at IS NULL", [wren.id])).length,
      liveDelegations: (await q("SELECT delegator_id FROM delegations WHERE (delegator_id = ? OR delegate_id = ?) AND revoked_at IS NULL", [wren.id, wren.id])).length,
    });
    // The paths that exist without the backfill come back empty-handed.
    expect(await resumeErasure(pool, wren.id, deps())).toEqual({ ran: [], finished: true, external: null });
    expect(await standing(), "the fixture holds one of each, and the erasure left every one").toEqual({
      agentTokens: 1, openLinks: 1, places: 2, meetMeWindows: 1, vouchesForThePending: 1, groupsOwned: 1, liveDelegations: 1,
    });
    const thanks = async () => (await q("SELECT text FROM health_events WHERE id = 'bf-grat-wren'"))[0]?.text ?? null;
    const claimOf = (id: string) => submissions.find((s) => s.id === id);
    // Three more, read as one (adversarial round 3, finding 0): the public line, the holding and the open claim.
    const leftovers = async () => ({
      thanks: await thanks(),
      holdingsEnded: removed.flat(),
      claim: { status: claimOf("bf-claim-wren")?.status, recordedName: claimOf("bf-claim-wren")?.data.recordedName },
    });
    expect(await leftovers(), "the control: the line names them, the holding is theirs, the claim is open under their name").toEqual({
      thanks: "Ash appreciated Wren", holdingsEnded: [], claim: { status: "new", recordedName: "Wren Halloway" },
    });

    const counts = await backfillFinishedErasures(pool, deps(), () => undefined);

    expect(await standing(), "nothing of theirs still acts, holds a place or speaks for them").toEqual({
      agentTokens: 0, openLinks: 0, places: 0, meetMeWindows: 0, vouchesForThePending: 0, groupsOwned: 0, liveDelegations: 0,
    });
    expect(await leftovers(), "the public line names nobody gone, the holding is ended, and the claim is closed with its name taken off").toEqual({
      thanks: "Ash appreciated a departed member", holdingsEnded: ["rh-bf-wren"], claim: { status: "declined", recordedName: REMOVED },
    });
    expect(counts).toMatchObject({ given: 1, steps: GIVEN_TO_IT.length, stopped: 0 });

    expect((await agentRowsRemaining(pool, wren.id)).tokens, "the agent token they minted is gone").toBe(0);
    expect((await q("SELECT revoked_at FROM member_invites WHERE id = 'inv-bf-wren'"))[0].revoked_at, "the open link no longer lets anybody in").not.toBeNull();
    expect(await q("SELECT event_id FROM event_rsvps WHERE user_id = ?", [wren.id]), "every place they held is given up").toEqual([]);
    expect(await answer("bf-full", "bf-bo"), "the seat they held went to the person waiting for it").toBe("going");
    expect((await seatChargeFor(pool, "bf-fee", wren.id, ""))?.status, "the fee for the place ahead comes back").toBe("released");
    expect(await balanceOf(pool, memberAccount(wren.id), TOKEN)).toBe(paid + toLedgerUnits(TOKEN, 5));
    expect(await q("SELECT id FROM events WHERE kind = 'meet-me' AND (created_by = ? OR owner_user_id = ?)", [wren.id, wren.id]), "the meet-me window is gone").toEqual([]);
    expect(await q("SELECT id FROM member_vouches WHERE voucher_user_id = ?", [wren.id]), "the vouch for Pip is gone").toEqual([]);
    expect((await vouchesFor(pool, "bf-pip")).length, "Pip holds no vouch from somebody gone").toBe(0);
    const owners = await ownersOf(group.id);
    expect(owners, "the group has one owner again, and it is somebody living").toHaveLength(1);
    expect(["bf-moss", "bf-ash"]).toContain(owners[0]);
    expect(await q("SELECT delegator_id FROM delegations WHERE (delegator_id = ? OR delegate_id = ?) AND revoked_at IS NULL", [wren.id, wren.id]), "no delegation they are half of is live").toEqual([]);
    expect(notices.map((n) => [n.userId, n.dedupeKey]), "Ash is told their voice is theirs again").toEqual([["bf-ash", `delegation-ended:${wren.id}:bf-ash`]]);
    expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
    expect(holders.map((h) => h.id), "Ash still holds theirs").toEqual(["rh-bf-ash"]);
    expect(claimOf("bf-claim-ash"), "Ash's claim is untouched").toEqual(claim("bf-claim-ash", "bf-ash", "Ash Moreno"));

    // What it ran is written down, after what the sweep ran, and the finish did not move.
    const record = (await erasureRecord(pool, wren.id))!;
    expect(record.stepsDone).toEqual([...FINISHED_ON_2026_10_20, ...GIVEN_TO_IT]);
    expect(await recordRow(wren.id)).toEqual({ started: "2026-10-20 09:00:00", finished: "2026-10-20 09:01:00", attempts: 1, failed_step: null, last_error: null });
    expect(await q("SELECT text FROM health_events WHERE kind = 'audit' AND entity_ref = ?", [wren.id])).toEqual([{ text: "member:erasure-backfilled" }]);

    // A second run gives nobody anything: no refund, no seat, no notice, no note.
    const before = await everything();
    const claimsBefore = JSON.stringify(submissions);
    notices = [];
    removed = [];
    const again = await backfillFinishedErasures(pool, deps(), () => undefined);
    expect(again).toMatchObject({ given: 0, steps: 0, stopped: 0 });
    expect(await everything()).toEqual(before);
    expect(notices).toEqual([]);
    expect(JSON.stringify(submissions), "and no claim changes").toBe(claimsBefore);
    expect(removed, "and no holding is asked to end").toEqual([]);

    // A death between a step and its note: the next boot runs the steps that
    // refund and seat a second time, and they move nothing.
    const money = ["guest-places-after-tombstone", "meet-me-windows-after-tombstone", "event-places-after-tombstone", "housing-contacts-after-tombstone"];
    await q("UPDATE member_erasures SET steps_done = ? WHERE user_id = ?", [
      JSON.stringify([...FINISHED_ON_2026_10_20, ...GIVEN_TO_IT.filter((s) => !money.includes(s))]),
      wren.id,
    ]);
    const valueBefore = await everything();
    const rerun = await backfillFinishedErasures(pool, deps(), () => undefined);
    expect(rerun).toMatchObject({ given: 1, steps: money.length, stopped: 0 });
    const valueAfter = await everything();
    for (const book of ["rsvps", "waitlist", "charges", "ledger", "balances", "events"]) {
      expect(valueAfter[book], `a rerun of the steps that refund and seat moved nothing in ${book}`).toEqual(valueBefore[book]);
    }
    expect(await balanceOf(pool, memberAccount(wren.id), TOKEN), "the fee came back once").toBe(paid + toLedgerUnits(TOKEN, 5));
    expect(notices).toEqual([]);
  });

  it("gives a tombstone from before records existed a finished record of what ran, and runs nothing for it again", async () => {
    const old = await member("bf-old", "Lark Benn");
    expect((await mintToken(pool, old.id, { name: "old agent", scopes: ["calendar.read"] })).ok).toBe(true);
    await link(old.id, "inv-bf-old");
    await tombstone(old.id);
    expect(await erasureRecord(pool, old.id), "erased before 0195, with no record").toBeNull();

    const counts = await backfillFinishedErasures(pool, deps(), () => undefined);
    expect(counts).toMatchObject({ given: 1, steps: backfillStepNames().length, stopped: 0 });

    expect((await agentRowsRemaining(pool, old.id)).tokens).toBe(0);
    expect((await q("SELECT revoked_at FROM member_invites WHERE id = 'inv-bf-old'"))[0].revoked_at).not.toBeNull();
    const record = (await erasureRecord(pool, old.id))!;
    expect(record.finishedAt, "the record it was given reads finished").not.toBeNull();
    expect(record.attempts, "and says no sweep of the table's ever ran").toBe(0);
    expect(record.stepsDone).toEqual(backfillStepNames());

    const before = await everything();
    expect(await backfillFinishedErasures(pool, deps(), () => undefined)).toMatchObject({ given: 0, steps: 0 });
    expect(await everything()).toEqual(before);
  });

  it("leaves an open record to the queue, a living account with a finished record alone, and an example alone", async () => {
    // A sweep that stopped past the tombstone: the queue and the hourly job finish it.
    const open = await member("bf-open", "Rowan Ise");
    expect((await mintToken(pool, open.id, { name: "open agent", scopes: ["calendar.read"] })).ok).toBe(true);
    await tombstone(open.id);
    await q(
      "INSERT INTO member_erasures (user_id, attempts, last_attempt_at, steps_done) VALUES (?, 1, CURRENT_TIMESTAMP, ?)",
      [open.id, JSON.stringify(sweepStepNames().slice(0, sweepStepNames().indexOf("tombstone") + 1))],
    );
    // A finished record over an account that is not a tombstone names nobody gone.
    const alive = await member("bf-alive", "Sol Tarn");
    expect((await mintToken(pool, alive.id, { name: "alive agent", scopes: ["calendar.read"] })).ok).toBe(true);
    await finishedRecord(alive.id, ["ledger-descriptions"]);
    // An example identity is never swept, whatever its row says.
    await member("bf-example", "Example Person");
    await tombstone("bf-example");
    await q("UPDATE users SET is_example = 1 WHERE id = 'bf-example'");
    await link("bf-example", "inv-bf-example");

    const openBefore = await erasureRecord(pool, open.id);
    const counts = await backfillFinishedErasures(pool, deps(), () => undefined);
    expect(counts).toMatchObject({ given: 0, steps: 0, stopped: 0 });

    expect((await agentRowsRemaining(pool, open.id)).tokens, "the open sweep is the queue's to finish").toBe(1);
    expect(await erasureRecord(pool, open.id)).toEqual(openBefore);
    expect((await agentRowsRemaining(pool, alive.id)).tokens, "a living account keeps its agent").toBe(1);
    expect((await erasureRecord(pool, alive.id))!.stepsDone).toEqual(["ledger-descriptions"]);
    expect((await q("SELECT revoked_at FROM member_invites WHERE id = 'inv-bf-example'"))[0].revoked_at).toBeNull();
    expect(await erasureRecord(pool, "bf-example"), "no record is made for an example").toBeNull();
  });

  it("finishes every other member when one stops part way, keeps that one's finish, and gives it the rest on the next run", async () => {
    const stuck = await member("bf-fail-1", "Cy Rook");
    await member("bf-fail-ash", "Ida Fenn");
    expect((await setDelegation(pool, "bf-fail-ash", stuck.id)).ok).toBe(true);
    await tombstone(stuck.id);
    await finishedRecord(stuck.id, FINISHED_ON_2026_10_20);
    const fine = await member("bf-fail-2", "Dan Ruiz");
    expect((await mintToken(pool, fine.id, { name: "fine agent", scopes: ["calendar.read"] })).ok).toBe(true);
    await tombstone(fine.id);
    await finishedRecord(fine.id, FINISHED_ON_2026_10_20);

    // The spine refuses the delegation notice, so the delegations step throws for that member.
    const failure = await backfillFinishedErasures(pool, deps({ notifyThrows: true }), () => undefined).then(
      () => null,
      (err: unknown) => err as Error,
    );

    expect((await agentRowsRemaining(pool, fine.id)).tokens, "the member after it was still given every step").toBe(0);
    expect(failure?.message, "and the job throws at the end, so runOnce leaves it unrecorded for the next boot").toMatch(
      /^1 finished erasure\(s\) stopped part way/,
    );
    expect((await erasureRecord(pool, fine.id))!.stepsDone).toEqual([...FINISHED_ON_2026_10_20, ...GIVEN_TO_IT]);
    const halfway = (await erasureRecord(pool, stuck.id))!.stepsDone;
    const at = GIVEN_TO_IT.indexOf("delegations-after-tombstone");
    expect(halfway, "the steps before the one that threw are noted, and nothing from it on").toEqual([...FINISHED_ON_2026_10_20, ...GIVEN_TO_IT.slice(0, at)]);
    expect(await recordRow(stuck.id), "the record still reads finished, at the same moment").toMatchObject({ finished: "2026-10-20 09:01:00", failed_step: null });
    expect(await q("SELECT delegate_id FROM delegations WHERE delegator_id = 'bf-fail-ash' AND revoked_at IS NULL")).toEqual([{ delegate_id: stuck.id }]);

    // The next boot, with the spine taking notices again, starts where that one stopped.
    const counts = await backfillFinishedErasures(pool, deps(), () => undefined);
    expect(counts).toMatchObject({ given: 1, steps: GIVEN_TO_IT.length - at, stopped: 0 });
    expect((await erasureRecord(pool, stuck.id))!.stepsDone).toEqual([...FINISHED_ON_2026_10_20, ...GIVEN_TO_IT]);
    expect(await q("SELECT delegate_id FROM delegations WHERE delegator_id = 'bf-fail-ash' AND revoked_at IS NULL")).toEqual([]);
    expect(notices.map((n) => n.userId)).toEqual(["bf-fail-ash"]);
  });

  /*
   * Adversarial round 3, finding 13. A tombstone from before round 2 kept the
   * handle `departed-<last eight of the id>`, which forum bylines print, and
   * `GET /api/profiles/<handle>` needs no sign-in: it served the date they
   * joined, their moons on the land, their token chips and their gratitude
   * counts. The route and the gratitude form both find a member through
   * `userIdForHandle`, so a handle it no longer finds is a 404 at both.
   */
  it("takes the handle off a tombstone an older release left with one, so no page answers to it, and leaves a tombstone with none as it was", async () => {
    const old = await member("bf-handle-old", "Wren Halloway");
    await tombstone(old.id);
    await finishedRecord(old.id, FINISHED_ON_2026_10_20);
    const handle = `departed-${old.id.slice(-8)}`;
    expect((await q("SELECT handle FROM users WHERE id = ?", [old.id]))[0].handle, "the control: the old tombstone carries the handle").toBe(handle);
    expect(await userIdForHandle(pool, handle), "and the profile page and the gratitude form both find it").toBe(old.id);

    // A tombstone written since round 2 has no handle, so the step has nothing to do.
    const fresh = await member("bf-handle-none", "Ash Moreno");
    await tombstone(fresh.id, { handle: null });
    await finishedRecord(fresh.id, FINISHED_ON_2026_10_20);
    const freshRow = await q("SELECT * FROM users WHERE id = ?", [fresh.id]);
    expect(freshRow[0].handle).toBeNull();

    // Every write to a user row the backfill makes, by whose row it is.
    const writes: string[] = [];
    const real = deps();
    const counted: ErasureDeps = {
      ...real,
      members: {
        ...real.members,
        update: (id, fn, how) => {
          writes.push(id);
          return real.members.update(id, fn, how);
        },
      },
    };
    expect((await backfillFinishedErasures(pool, counted, () => undefined)).stopped).toBe(0);
    expect(writes.filter((id) => id === old.id), "one write takes the old handle off").toHaveLength(1);
    expect(writes.filter((id) => id === fresh.id), "and a tombstone with no handle is not written at all").toEqual([]);

    // Read back from the table: the users repository puts a tombstone's
    // handle back after any writer that does not say `erasure`, so a step
    // noted as done proves nothing about the row.
    expect((await q("SELECT handle FROM users WHERE id = ?", [old.id]))[0].handle, "the old tombstone holds no handle any more").toBeNull();
    expect(await userIdForHandle(pool, handle), "so GET /api/profiles/<that handle> answers 404, and the gratitude form finds nobody").toBeNull();
    expect((await erasureRecord(pool, old.id))!.stepsDone).toContain("handle-after-tombstone");
    expect((await usersRepo(pool).byId(old.id))!.name, "the rest of the tombstone is as the sweep left it").toBe(ANON);

    expect(await q("SELECT * FROM users WHERE id = ?", [fresh.id]), "a tombstone with no handle is left exactly as it was").toEqual(freshRow);
    expect((await erasureRecord(pool, fresh.id))!.stepsDone, "and is noted, so the next boot does not offer it again").toContain("handle-after-tombstone");

    const before = await everything();
    expect(await backfillFinishedErasures(pool, deps(), () => undefined)).toMatchObject({ given: 0, steps: 0 });
    expect(await everything()).toEqual(before);
  });

  /*
   * Adversarial round 3, finding 0. The backfill gives an old record
   * "ballot-words-after-tombstone". A vote to take a role back from a
   * tombstone is titled with the tombstone's first name, which is "A"
   * ("...take the role back from A"). Read back off the title as a
   * spelling, "A" would rewrite every standalone "A" in the words of the
   * living member who opened it (`nameInTitle`, server/lib/ballotErasure.ts).
   */
  it("gives an old record the ballot words step, and reads no name off a title about a tombstone, so the living opener's reason keeps every word", async () => {
    const gone = await member("bf-ballot-wren", "Wren Halloway");
    await member("bf-ballot-ann", "Ann Pryor");
    await tombstone(gone.id);
    await finishedRecord(gone.id, FINISHED_ON_2026_10_20);
    // Exactly the words the role-unseats door writes for a member whose name is the tombstone's.
    const title = "Steward: the village asks to take the role back from A";
    const doc = [
      `# ${title}`, "",
      "## What changes if this carries", "",
      "A stops sitting in Steward. The role carries no powers today, so nothing anybody can do changes.", "",
      "Steward keeps everything it carries, and anybody else sitting in it is untouched.", "",
      "## Why now", "",
      "A cleanup vote. A role held by nobody who lives here keeps the circle from filling it.", "",
      "Asked by Ann on 2026-10-04.", "",
    ].join("\n");
    const r = await openBallot(pool, {
      subjectType: "role_unseat", subjectRef: `${gone.id}@role-steward`, title, docMarkdown: doc, method: "majority",
      weightMode: "equal", unityPct: 50, quorumPct: 10, durationDays: 7, openedBy: "bf-ballot-ann", electorate: [{ userId: "bf-ballot-ann", weight: 1 }],
    } as any);
    if (!r.ok) throw new Error(`ballot refused to open: ${r.error}`);
    const words = async () => (await q("SELECT title, doc_markdown, outcome_note FROM ballots WHERE id = ?", [r.ballot.id]))[0];
    expect(await words(), "the control: the ballot is stored as the door wrote it").toEqual({ title, doc_markdown: doc, outcome_note: null });

    expect((await backfillFinishedErasures(pool, deps(), () => undefined)).stopped).toBe(0);

    expect((await erasureRecord(pool, gone.id))!.stepsDone, "the old record is given the ballot words step").toContain("ballot-words-after-tombstone");
    expect(await words(), "the living opener's reason, every standalone A in it, is untouched").toEqual({ title, doc_markdown: doc, outcome_note: null });
  });
  /*
   * The three steps of round 5 (proposal-ballot-words, quest-crews and
   * photo-report-reasons), each found by the tombstone's id alone. An old
   * tombstone holds no name, so the proposal ballot's "Proposed by" line is
   * found through the proposal it made, the crew row through its user id and
   * the report words through their reporter id.
   */
  it("gives an old record the proposal ballot, crew and photo report steps, by its id alone, and leaves a living neighbour's rows as they were", async () => {
    const gone = await member("bf-r5-wren", "Wren Halloway");
    const ann = await member("bf-r5-ann", "Ann Pryor");
    await member("bf-r5-bo", "Bo Marsh");
    await q("INSERT INTO mechanics_proposals (id, title, rationale, change_set, proposer_user_id, status) VALUES (?,?,?,?,?,'open')", [
      "gm-bf-r5", "Raise the gratitude budget", "Wren and Ann both think so.", "[]", gone.id,
    ]);
    const doc = proposalMarkdown({ id: "gm-bf-r5", title: "Raise the gratitude budget", rationale: "Wren and Ann both think so.", changeSet: [], villageName: "Village", proposerName: "Wren", supports: 3, createdAt: "2026-10-01T09:00:00.000Z" });
    const r = await openBallot(pool, {
      subjectType: "mechanics", subjectRef: "gm-bf-r5", title: "Raise the gratitude budget", docMarkdown: doc, method: "majority",
      weightMode: "equal", unityPct: 50, quorumPct: 10, durationDays: 7, openedBy: ann.id, electorate: [{ userId: ann.id, weight: 1 }],
    } as any);
    if (!r.ok) throw new Error(`ballot refused to open: ${r.error}`);
    const crews = crewsRepo(pool);
    const crew = await crews.create({ id: "bf-r5-crew", questId: "q-bf-r5", name: "The Thursday Crew", creatorId: ann.id, maxSize: 3 });
    expect(await crews.join(crew.id, gone.id)).toBe("joined");
    expect(await crews.join(crew.id, "bf-r5-bo")).toBe("joined");
    await crews.create({ id: "bf-r5-alone", questId: "q-bf-r5", name: "Just me", creatorId: gone.id, maxSize: 3 });
    await placePhotosRepo.insertPhoto(pool, {
      id: "bf-r5-photo", villageId: "local", structureKey: "hall", url: "/api/uploads/bf-r5-photo.webp", thumbUrl: null, altText: "People at the hall",
      caption: null, takenOn: null, width: null, height: null, bytes: null, contributorId: ann.id,
    });
    await placePhotosRepo.insertReport(pool, { id: "bf-r5-pr", villageId: "local", photoId: "bf-r5-photo", reporterId: gone.id, kind: "subject", reason: "This is me, Wren Halloway, please take it down" });
    await placePhotosRepo.insertReport(pool, { id: "bf-r5-pr-ann", villageId: "local", photoId: "bf-r5-photo", reporterId: ann.id, kind: "concern", reason: "Ann's own words" });
    await tombstone(gone.id, { handle: null });
    await finishedRecord(gone.id, FINISHED_ON_2026_10_20);
    const ballotDoc = async () => String((await q("SELECT doc_markdown FROM ballots WHERE id = ?", [r.ballot.id]))[0].doc_markdown);
    expect(await ballotDoc(), "the control: the ballot names the proposer").toContain("Proposed by Wren on 2026-10-01; ");
    expect(await q("SELECT 1 FROM quest_crew_members WHERE user_id = ?", [gone.id]), "the control: the old record left them in two crews").toHaveLength(2);

    expect((await backfillFinishedErasures(pool, deps(), () => undefined)).stopped).toBe(0);

    const done = (await erasureRecord(pool, gone.id))!.stepsDone;
    for (const step of ["proposal-ballot-words-after-tombstone", "quest-crews-after-tombstone", "photo-report-reasons-after-tombstone"]) {
      expect(done, `the old record is given ${step}`).toContain(step);
    }
    expect(await ballotDoc()).toContain("Proposed by a departed member on 2026-10-01; ");
    expect(await ballotDoc(), "the proposal's own words stay").toContain("Wren and Ann both think so.");
    expect(await q("SELECT 1 FROM quest_crew_members WHERE user_id = ?", [gone.id])).toHaveLength(0);
    expect((await crews.byId(crew.id))!.status, "a crew with living members stays").not.toBe("disbanded");
    expect((await crews.byId("bf-r5-alone"))!.status, "a crew they were alone in disbands").toBe("disbanded");
    const reports = new Map((await q("SELECT id, reason, status FROM place_photo_reports")).map((x: any) => [x.id, x]));
    expect(reports.get("bf-r5-pr")).toMatchObject({ reason: null, status: "open" });
    expect(reports.get("bf-r5-pr-ann")!.reason).toBe("Ann's own words");
  });
});

describe("which steps a finished erasure can be given", () => {
  it("holds every step after the tombstone to exactly one list, and never offers the tombstone or anything before it", () => {
    const names = sweepStepNames();
    const after = names.slice(names.indexOf("tombstone") + 1);
    const leftOut = Object.keys(BACKFILL_LEAVES_OUT);
    expect(
      [...BACKFILL_BY_ID, ...leftOut].sort(),
      "a step added after the tombstone goes in BACKFILL_BY_ID or BACKFILL_LEAVES_OUT (server/lib/erasure.ts)",
    ).toEqual([...after].sort());
    expect([...BACKFILL_BY_ID].filter((n) => leftOut.includes(n))).toEqual([]);
    expect(backfillStepNames(), "in the order the sweep runs them").toEqual(after.filter((n) => BACKFILL_BY_ID.has(n)));
    for (const before of names.slice(0, names.indexOf("tombstone") + 1)) expect(backfillStepNames()).not.toContain(before);
    expect(erasureBackfillJob()).toMatch(/^erasure-steps-backfill-[0-9a-f]{12}$/);
  });
});
