/**
 * THE ROWS AN ERASED MEMBER OWNED THAT THE SWEEP NEVER TOUCHED.
 *
 * An adversarial review of the erasure (2026-10-22) walked every member-keyed
 * table in `drizzle/` against the steps in server/lib/erasure.ts and found
 * these, each with no stated reason to stay:
 *
 *   PLACES AT GATHERINGS. Their answers, queue places and slots kept holding
 *   seats, and the waitlist could promote a tombstone into one.
 *   HOUSING REQUESTS. Their name, address, phone and notes stayed in the
 *   founder's list, where a status change still wrote to them.
 *   VOUCHES. What people wrote about them stayed readable, and a new vouch
 *   could set a tombstone's membership back on.
 *   CONVERSATIONS. A group they owned kept a tombstone as its only owner.
 *   DELEGATIONS. Members who handed them their voice stayed handed to
 *   somebody who will never vote again, and nobody told them.
 *   VENTURES, INVESTOR FACTS, STAY NOTES, PURCHASE ADDRESSES. Their own words,
 *   and their real address beside "A departed member".
 *
 * Every case asserts COMPLETENESS on the rows (gone, or scrubbed to the
 * constant), beside somebody who stays and whose rows must not move. The two
 * refusals are asserted at the door that makes them: the waitlist, and the
 * vouch route as the server registers it.
 *
 * Runs against a scratch schema with every real migration applied. No
 * TEST_DATABASE_URL and the suite skips (harness rule).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { anonymizeMember, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import { recordVouch } from "../repos/vouches";
import { recordFact } from "../repos/investorPath";
import { register as registerVouchRoutes } from "../routes/vouches";
import { rsvp, withdrawRsvp } from "./gatherings";
import { createSlot, joinWaitlist, setPromotionSink, signupSlot, whoIsHere } from "./calendarCommunity";
import { seatChargeFor } from "./eventSeats";
import { createReservation, setReservationStatus } from "./housing";
import { createGroup, openDirect, sendMessage } from "./messaging";
import { acceptDelegations, setDelegation } from "./delegation";
import { CYCLE_POOL_FAUCET, balanceOf, checkLedgerInvariants, loadTokenRegistry, memberAccount, postTransfer } from "./ledger";
import { toLedgerUnits } from "./economy";

const configured = testDbConfigured();
const ANON = "A departed member";
const TOKEN = "credits";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

/** Every notice the erasure hands the spine, in order. */
let notices: any[] = [];

/** The erasure's singletons with the real users repository, and the spine as a recorder. */
function deps(opts: { notify?: boolean } = {}): ErasureDeps {
  const real = usersRepo(pool);
  const out: any = {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: (u: any) => void) => real.update(id, fn) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn: () => Promise<unknown>) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
  if (opts.notify !== false) {
    out.notify = async (input: any) => {
      notices.push(input);
      return { fresh: true };
    };
  }
  return out as ErasureDeps;
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

/** What the tombstone step writes, for a member whose sweep stopped after it. */
async function tombstoneOnly(id: string): Promise<void> {
  await usersRepo(pool).update(id, (u: any) => {
    u.name = ANON;
    u.email = `deleted-${u.id}@anonymized.invalid`;
    u.passwordHash = "";
    u.membershipGranted = false;
  });
}

const iso = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const DAY = 86_400_000;

async function gathering(id: string, opts: { capacity?: number | null; startsAt?: Date; price?: number } = {}): Promise<void> {
  await q(
    "INSERT INTO events (id, title, starts_at, status, kind, layer, capacity, seat_price, seat_token) VALUES (?,?,?,'scheduled','gathering','village',?,?,?)",
    [id, `Gathering ${id}`, iso(opts.startsAt ?? new Date(Date.now() + 5 * DAY)), opts.capacity ?? null, opts.price ?? 0, (opts.price ?? 0) > 0 ? TOKEN : null],
  );
}

const answer = async (eventId: string, userId: string) =>
  (await q("SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?", [eventId, userId]))[0]?.status ?? null;

/** A fake Express that records handlers, the shape server/routes/liveSessions.test.ts uses. */
function vouchRoutes(voucherId: string) {
  const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
  const record = (method: string) => (p: string, h: any) => void handlers.set(`${method} ${p}`, h);
  registerVouchRoutes({ get: record("GET"), post: record("POST") } as any, {
    authedUser: async () => usersRepo(pool).byId(voucherId),
    getPool: () => pool,
    members: usersRepo(pool),
    guardCapability: async () => true,
    stageOf: async () => null,
    recordStageEvent: async () => undefined,
  } as any);
  return async (route: string, targetId: string, body: Record<string, unknown> = {}) => {
    const out = { status: 200, body: undefined as any };
    const res: any = {
      status(code: number) { out.status = code; return res; },
      json(b: any) { out.body = b; return res; },
    };
    await handlers.get(`POST ${route}`)!({ params: { id: targetId }, body, headers: {} }, res);
    return out;
  };
}

describe.skipIf(!configured)("the rows an erased member owned", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-owned-"));
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
  });

  it("gives up their answers, queue places and slots, and the freed seat ahead serves the queue", async () => {
    const leaver = await member("own-leaver-ev", "Wren Halloway");
    await member("own-ev-ash", "Ash Moreno");
    await member("own-ev-bo", "Bo Lind");
    await member("own-ev-cy", "Cy Rook");

    // Upcoming and full: the leaver holds the one seat and Bo waits for it.
    await gathering("own-ev-full", { capacity: 1 });
    expect((await rsvp(pool, "own-ev-full", leaver.id, "going")).ok).toBe(true);
    expect((await joinWaitlist(pool, "own-ev-full", "own-ev-bo")).ok).toBe(true);
    // A maybe on an open gathering, which holds no seat and is still their answer.
    await gathering("own-ev-open");
    expect((await rsvp(pool, "own-ev-open", leaver.id, "maybe")).ok).toBe(true);
    // A queue place behind Ash.
    await gathering("own-ev-queue", { capacity: 1 });
    expect((await rsvp(pool, "own-ev-queue", "own-ev-ash", "going")).ok).toBe(true);
    expect((await joinWaitlist(pool, "own-ev-queue", leaver.id)).ok).toBe(true);
    // A slot they took, with a note they wrote on it.
    const slot = await createSlot(pool, "own-ev-open", { kind: "dish", label: "Bread", needed: 2 } as any);
    expect((await signupSlot(pool, "own-ev-open", slot, leaver.id, undefined, "Sourdough, no nuts")).ok).toBe(true);
    // A gathering that has already happened: its queue is history and nobody is promoted into it.
    await gathering("own-ev-past", { capacity: 1, startsAt: new Date(Date.now() - 3 * DAY) });
    expect((await rsvp(pool, "own-ev-past", leaver.id, "going")).ok).toBe(true);
    expect((await joinWaitlist(pool, "own-ev-past", "own-ev-cy")).ok).toBe(true);

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(await q("SELECT event_id FROM event_rsvps WHERE user_id = ?", [leaver.id]), "every answer they gave is gone").toEqual([]);
    expect(await q("SELECT event_id FROM event_waitlist WHERE user_id = ?", [leaver.id]), "every queue place is gone").toEqual([]);
    expect(await q("SELECT id FROM event_slot_signups WHERE user_id = ?", [leaver.id]), "every slot and its note is gone").toEqual([]);

    // The seat they freed on an upcoming gathering went to the person waiting for it.
    expect(await answer("own-ev-full", "own-ev-bo")).toBe("going");
    expect(await answer("own-ev-past", "own-ev-cy"), "nobody is seated into an evening that has already happened").toBeNull();
    // Ash, who stays, keeps the seat ahead of the leaver's old queue place.
    expect(await answer("own-ev-queue", "own-ev-ash")).toBe("going");

    const steps = (await erasureRecord(pool, leaver.id))!.stepsDone;
    expect(steps.indexOf("event-places-after-tombstone")).toBeGreaterThan(steps.indexOf("tombstone"));
  });

  it("hands back the fee on a place ahead and leaves the fee on an evening already held, and the ledger still balances", async () => {
    const leaver = await member("own-leaver-fee", "Wren Halloway", 50);
    await gathering("own-fee-ahead", { price: 5 });
    await gathering("own-fee-held", { price: 5, startsAt: new Date(Date.now() - 2 * 3600_000) });
    expect((await rsvp(pool, "own-fee-ahead", leaver.id, "going")).ok).toBe(true);
    expect((await rsvp(pool, "own-fee-held", leaver.id, "going")).ok).toBe(true);
    const before = await balanceOf(pool, memberAccount(leaver.id), TOKEN);

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect((await seatChargeFor(pool, "own-fee-ahead", leaver.id, ""))?.status, "the place ahead was given up, so its fee comes back").toBe("released");
    expect((await seatChargeFor(pool, "own-fee-held", leaver.id, ""))?.status, "the evening they held is the village's to settle").toBe("held");
    expect(await balanceOf(pool, memberAccount(leaver.id), TOKEN)).toBe(before + toLedgerUnits(TOKEN, 5));
    expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
  });

  it("never promotes a tombstone off the waitlist, and seats the next person instead", async () => {
    await member("own-wl-ash", "Ash Moreno");
    const gone = await member("own-wl-gone", "Lark Benn");
    await member("own-wl-bo", "Bo Lind");
    await gathering("own-wl-ev", { capacity: 1 });
    expect((await rsvp(pool, "own-wl-ev", "own-wl-ash", "going")).ok).toBe(true);
    expect((await joinWaitlist(pool, "own-wl-ev", gone.id)).ok).toBe(true);
    expect((await joinWaitlist(pool, "own-wl-ev", "own-wl-bo")).ok).toBe(true);
    // The sweep stopped after the tombstone: the queue row still stands, first in line.
    await tombstoneOnly(gone.id);

    expect(await withdrawRsvp(pool, "own-wl-ev", "own-wl-ash")).toBe(true);

    expect(await answer("own-wl-ev", gone.id), "a tombstone is never seated").toBeNull();
    expect(await answer("own-wl-ev", "own-wl-bo"), "the seat goes to the next living person").toBe("going");
  });

  it("scrubs their housing requests, the signed-in one and the one their address made, and keeps the row that holds a home", async () => {
    const leaver = await member("own-leaver-hs", "Wren Halloway");
    const signedIn = await createReservation(pool, {
      structureKey: "ridgeA", homeType: "casita", name: "Wren Halloway", email: leaver.email,
      phone: "+1 555 0100", notes: "Two dogs, one cat", userId: leaver.id,
    });
    expect(await setReservationStatus(pool, signedIn.id, "reserved")).toBe(true);
    // Sent from the public form before they had an account, in a different case.
    const byAddress = await createReservation(pool, {
      structureKey: null, homeType: "tiny-home", name: "W. Halloway", email: `  ${leaver.email.toUpperCase()} `,
      phone: "555 0100", notes: "Call after six",
    });
    const theirs = await createReservation(pool, {
      structureKey: "ridgeA", homeType: "villa", name: "Ash Moreno", email: "ash@example.test", phone: "555 0199", notes: "Soon",
    });
    await q("UPDATE housing_reservations SET updated_at = '2026-02-01 09:00:00.000' WHERE id = ?", [byAddress.id]);

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(
      await q("SELECT DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS at FROM housing_reservations WHERE id = ?", [byAddress.id]),
      "a scrub is not the founder moving the request along",
    ).toEqual([{ at: "2026-02-01 09:00:00" }]);

    const rows = await q(
      "SELECT id, name, email, phone, notes, user_id, status, home_type FROM housing_reservations WHERE id IN (?, ?) ORDER BY id",
      [signedIn.id, byAddress.id],
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r, `reservation ${r.id} names nobody`).toMatchObject({
        name: ANON, email: `deleted-${leaver.id}@anonymized.invalid`, phone: null, notes: null, user_id: null,
      });
    }
    // The held home is still held: reserved rows count toward homes taken.
    expect(rows.find((r) => r.id === signedIn.id)).toMatchObject({ status: "reserved", home_type: "casita" });
    expect(await q("SELECT name, email, phone, notes FROM housing_reservations WHERE id = ?", [theirs.id])).toEqual([
      { name: "Ash Moreno", email: "ash@example.test", phone: "555 0199", notes: "Soon" },
    ]);
  });

  it("drops the vouches written about them and the words of the ones they gave, and keeps the vouch that admitted somebody", async () => {
    const leaver = await member("own-leaver-vc", "Wren Halloway");
    await member("own-vc-new", "Pip Arden");
    await member("own-vc-friend", "Moss Tal");
    await member("own-vc-other", "Sage Okafor");
    await recordVouch(pool, { id: "vch-own-1", voucherUserId: leaver.id, vouchedUserId: "own-vc-new", kind: "member", note: "Known Pip ten years" });
    await recordVouch(pool, { id: "vch-own-2", voucherUserId: "own-vc-friend", vouchedUserId: leaver.id, kind: "member", note: "Wren mends every fence" });
    await recordVouch(pool, { id: "vch-own-3", voucherUserId: "own-vc-other", vouchedUserId: "own-vc-new", kind: "member", note: "Pip is steady" });

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(await q("SELECT id FROM member_vouches WHERE vouched_user_id = ?", [leaver.id]), "nothing written about them stays").toEqual([]);
    expect(await q("SELECT id, kind, note FROM member_vouches WHERE voucher_user_id = ?", [leaver.id])).toEqual([
      { id: "vch-own-1", kind: "member", note: null },
    ]);
    expect(await q("SELECT note FROM member_vouches WHERE id = 'vch-own-3'")).toEqual([{ note: "Pip is steady" }]);
  });

  it("refuses a vouch, ordinary or super, for a tombstone, and records nothing", async () => {
    await member("own-vr-steward", "Rowan Ise");
    const gone = await member("own-vr-gone", "Lark Benn");
    await tombstoneOnly(gone.id);
    const call = vouchRoutes("own-vr-steward");

    const ordinary = await call("/api/members/:id/vouch", gone.id, { note: "Still my friend" });
    const superVouch = await call("/api/members/:id/super-vouch", gone.id);

    expect((await usersRepo(pool).byId(gone.id))!.membershipGranted, "a tombstone is never admitted").toBeFalsy();
    expect(await q("SELECT id FROM member_vouches WHERE vouched_user_id = ?", [gone.id]), "no vouch is recorded").toEqual([]);
    expect(ordinary.status).toBe(409);
    expect(superVouch.status).toBe(409);
    expect(ordinary.body?.error).toBe(superVouch.body?.error);
  });

  it("walks them out of every conversation, hands a group they owned to the next member, and keeps the words de-attributed", async () => {
    const leaver = await member("own-leaver-cv", "Wren Halloway");
    await member("own-cv-ash", "Ash Moreno");
    await member("own-cv-bo", "Bo Lind");
    const group = await createGroup(pool, { createdBy: leaver.id, name: "Orchard crew", memberIds: ["own-cv-ash", "own-cv-bo"] });
    const direct = await openDirect(pool, leaver.id, "own-cv-ash");
    await sendMessage(pool, { conversationId: group.id, authorId: leaver.id, body: "Picking Saturday" });
    await sendMessage(pool, { conversationId: direct.id, authorId: leaver.id, body: "Thanks for the ladder" });

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(
      await q("SELECT conversation_id FROM conversation_members WHERE user_id = ? AND (left_at IS NULL OR role = 'owner')", [leaver.id]),
      "they are an active member and an owner of nothing",
    ).toEqual([]);
    const owners = await q("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND role = 'owner' AND left_at IS NULL", [group.id]);
    expect(owners).toHaveLength(1);
    expect(["own-cv-ash", "own-cv-bo"]).toContain(owners[0].user_id);
    // Kept on purpose, and read through the join as the tombstone's.
    const kept = await q(
      "SELECT m.body, u.name FROM messages m JOIN users u ON u.id = m.author_id WHERE m.author_id = ? ORDER BY m.seq",
      [leaver.id],
    );
    expect(kept).toEqual([{ body: "Picking Saturday", name: ANON }, { body: "Thanks for the ladder", name: ANON }]);
  });

  it("ends every delegation they gave or carried, and tells each member who handed them a voice", async () => {
    const leaver = await member("own-leaver-dl", "Wren Halloway");
    await member("own-dl-ash", "Ash Moreno");
    await member("own-dl-bo", "Bo Lind");
    await member("own-dl-cy", "Cy Rook");
    expect((await setDelegation(pool, "own-dl-ash", leaver.id)).ok).toBe(true);
    await acceptDelegations(pool, leaver.id, "own-dl-ash");
    // An offer they never took up, which also points at them.
    expect((await setDelegation(pool, "own-dl-bo", leaver.id)).ok).toBe(true);
    // And their own voice, handed to Cy.
    expect((await setDelegation(pool, leaver.id, "own-dl-cy")).ok).toBe(true);
    await acceptDelegations(pool, "own-dl-cy", leaver.id);

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(
      await q("SELECT delegator_id FROM delegations WHERE (delegator_id = ? OR delegate_id = ?) AND revoked_at IS NULL", [leaver.id, leaver.id]),
      "no delegation they are half of is still live",
    ).toEqual([]);
    const told = notices.map((n) => [n.userId, n.type, n.dedupeKey]).sort();
    expect(told).toEqual([
      ["own-dl-ash", "governance", `delegation-ended:${leaver.id}:own-dl-ash`],
      ["own-dl-bo", "governance", `delegation-ended:${leaver.id}:own-dl-bo`],
    ]);
    for (const n of notices) {
      expect(n.actorUserId ?? null, "the notice is from the village, never from the person who left").toBeNull();
      expect(`${n.title} ${n.body}`).not.toContain("Wren");
    }

    // An erasure asked for again tells nobody twice.
    notices = [];
    await anonymizeMember(pool, await usersRepo(pool).byId(leaver.id), null, deps());
    expect(notices).toEqual([]);
  });

  it("writes the delegation notice to the bell itself when the host hands it no spine", async () => {
    const leaver = await member("own-leaver-db", "Wren Halloway");
    await member("own-db-ash", "Ash Moreno");
    expect((await setDelegation(pool, "own-db-ash", leaver.id)).ok).toBe(true);

    await anonymizeMember(pool, leaver, "admin-1", deps({ notify: false }));

    expect(await q("SELECT type, dedupe_key, actor_user_id FROM notifications WHERE user_id = 'own-db-ash'")).toEqual([
      { type: "governance", dedupe_key: `delegation-ended:${leaver.id}:own-db-ash`, actor_user_id: null },
    ]);
  });

  it("deletes their ventures and clears their words from investor facts, stays and purchases, keeping the value rows", async () => {
    const leaver = await member("own-leaver-vx", "Wren Halloway");
    await member("own-vx-ash", "Ash Moreno");
    await q("INSERT INTO member_ventures (id, user_id, name, summary, link) VALUES (?,?,?,?,?)", ["mv-own-1", leaver.id, "Halloway Honey", "Raw honey from the ridge", "https://honey.example.test"]);
    await q("INSERT INTO member_ventures (id, user_id, name) VALUES (?,?,?)", ["mv-own-2", "own-vx-ash", "Moreno Mill"]);
    const fact = await recordFact(pool, { userId: leaver.id, fact: "interest_registered", detail: "Wants to put in a little after the harvest" });
    // Ended months ago. The who-is-here band reads an ended stay's departure off `updated_at`.
    await q("INSERT INTO stays (id, user_id, accommodation_id, status, notes, updated_at) VALUES (?,?,?,?,?,?)", ["st-own-1", leaver.id, "acc-1", "ended", "Allergic to wool, arriving by bus", "2026-01-15 10:00:00"]);
    await q("INSERT INTO stays (id, user_id, accommodation_id, status, notes) VALUES (?,?,?,?,?)", ["st-own-2", "own-vx-ash", "acc-1", "ended", "Ash's note"]);
    await q("INSERT INTO product_purchases (id, product_id, user_id, payer_email, amount_minor, receipt_no) VALUES (?,?,?,?,?,?)", ["pp-own-1", "prod-1", leaver.id, leaver.email, 1200, 1]);
    // Paid before they signed in, under the same address.
    await q("INSERT INTO product_purchases (id, product_id, user_id, payer_email, amount_minor, receipt_no) VALUES (?,?,?,?,?,?)", ["pp-own-2", "prod-1", null, leaver.email.toUpperCase(), 1200, 2]);
    await q("INSERT INTO product_purchases (id, product_id, user_id, payer_email, amount_minor, receipt_no) VALUES (?,?,?,?,?,?)", ["pp-own-3", "prod-1", "own-vx-ash", "ash@example.test", 1200, 3]);

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(await q("SELECT id FROM member_ventures WHERE user_id = ?", [leaver.id]), "their ventures are gone").toEqual([]);
    expect(await q("SELECT id FROM member_ventures WHERE id = 'mv-own-2'")).toEqual([{ id: "mv-own-2" }]);
    expect(await q("SELECT fact, detail FROM investor_path_facts WHERE id = ?", [fact.id]), "the fact stays, without their words").toEqual([
      { fact: "interest_registered", detail: null },
    ]);
    expect(await q("SELECT id, notes FROM stays ORDER BY id")).toEqual([
      { id: "st-own-1", notes: null },
      { id: "st-own-2", notes: "Ash's note" },
    ]);
    // Clearing a note is not a departure: the band must not show them leaving today.
    const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
    const band = await whoIsHere(pool, { from: day(-2), to: day(1) }, true);
    expect(JSON.stringify(band.departures), "a stay that ended in January does not leave again today").not.toContain(ANON);
    expect(await q("SELECT id, payer_email, amount_minor FROM product_purchases ORDER BY id")).toEqual([
      { id: "pp-own-1", payer_email: null, amount_minor: 1200 },
      { id: "pp-own-2", payer_email: null, amount_minor: 1200 },
      { id: "pp-own-3", payer_email: "ash@example.test", amount_minor: 1200 },
    ]);
  });

  it("runs every new step after the tombstone, between the role tensions and the role proposals, and runs clean twice", async () => {
    const leaver = await member("own-leaver-st", "Wren Halloway");
    await anonymizeMember(pool, leaver, "admin-1", deps());
    const steps = (await erasureRecord(pool, leaver.id))!.stepsDone;
    const at = steps.indexOf("role-tensions-after-tombstone");
    expect(at).toBeGreaterThan(steps.indexOf("tombstone"));
    expect(steps.slice(at, at + 11)).toEqual([
      "role-tensions-after-tombstone",
      "event-places-after-tombstone",
      "housing-reservations-after-tombstone",
      "vouches-after-tombstone",
      "conversations-after-tombstone",
      "delegations-after-tombstone",
      "ventures-after-tombstone",
      "investor-fact-words-after-tombstone",
      "stay-notes-after-tombstone",
      "purchase-emails-after-tombstone",
      "role-proposals-after-tombstone",
    ]);
    expect(steps.indexOf("sessions-after-tombstone")).toBeGreaterThan(steps.indexOf("purchase-emails-after-tombstone"));
    // An erasure asked for again runs every step again, over the tombstone, and finishes.
    await anonymizeMember(pool, await usersRepo(pool).byId(leaver.id), null, deps());
    expect((await erasureRecord(pool, leaver.id))!.finishedAt).not.toBeNull();
  });
});
