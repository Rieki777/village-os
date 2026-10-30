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
 * THE ADVERSARIAL ROUND OF 2026-10-23 added what the first pass missed: a
 * vouch they gave somebody still waiting kept counting toward that person's
 * admission; the housing scrub reached a living member's own request at a
 * shared address; the admin audit kept the name the request was made under;
 * a second address typed into a request kept its comms contact; seats and
 * queue places held under their guest-era key skipped the seat rules; a group
 * could pass to another tombstone; a recurring evening read as still ahead a
 * day late east of UTC+12; and nothing proved a vote copied from them is
 * withdrawn. The resume of each new step part way through is in
 * server/lib/erasure.ownedRows.resume.test.ts.
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
import { recordVouch, vouchesFor } from "../repos/vouches";
import { recordFact } from "../repos/investorPath";
import { reservationsForMember } from "../repos/housing";
import { ERASED_ADDRESS } from "../repos/commsPeople";
import { register as registerVouchRoutes } from "../routes/vouches";
import { rsvp, withdrawRsvp } from "./gatherings";
import { createSlot, eveningAhead, joinWaitlist, setPromotionSink, signupSlot, whoIsHere } from "./calendarCommunity";
import { seatChargeFor } from "./eventSeats";
import { createReservation, setReservationStatus } from "./housing";
import { createGroup, leaveConversation, openDirect, sendMessage } from "./messaging";
import { acceptDelegations, setDelegation } from "./delegation";
import { castVote, openBallot, talliesFor } from "./ballots";
import { recordEvent } from "./events";
import { makeInviteDoor } from "./inviteDoor";
import { ensureContact } from "./comms/contacts";
import { handlePathTrigger } from "./comms/paths";
import { guestPersonKey } from "../../shared/comms/kinds";
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

/** Who runs a conversation now: the live rows holding the owner's role. */
const ownersOf = async (conversationId: string): Promise<string[]> =>
  (await q("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND role = 'owner' AND left_at IS NULL ORDER BY user_id", [conversationId])).map(
    (r) => String(r.user_id),
  );

/** A contact in the address book, the way a guest's confirm or an account path makes one. */
async function contactFor(email: string, userId: string | null, source = "guest"): Promise<string> {
  const made = await ensureContact({ getPool: () => pool }, { email, name: null, userId, source });
  expect(made, `a contact for ${email}`).not.toBeNull();
  return made!.id;
}

/** A ballot on the custom bar, which a delegation carries on (server/lib/delegation.test.ts uses the same shape). */
let ballots = 0;
async function ballotFor(electorate: string[]): Promise<string> {
  const opened = await openBallot(pool, {
    subjectType: "mechanics",
    subjectRef: `own-ballot-${++ballots}`,
    title: `Ballot ${ballots}`,
    docMarkdown: "# The document as checked",
    method: "custom",
    weightMode: "equal",
    unityPct: 80,
    quorumPct: 20,
    durationDays: 7,
    openedBy: electorate[0],
    electorate: electorate.map((userId) => ({ userId, weight: 1 })),
  });
  if (!opened.ok) throw new Error(`ballot refused to open: ${opened.error}`);
  return opened.ballot.id;
}

const votesOn = async (ballotId: string) =>
  q("SELECT user_id, choice, followed_user_id FROM ballot_votes WHERE ballot_id = ? ORDER BY user_id", [ballotId]);

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

  it("gives up the seat and queue place they held as a guest before joining, and the freed seat serves the queue", async () => {
    const leaver = await member("own-leaver-gs", "Wren Halloway");
    await member("own-gs-ash", "Ash Moreno");
    await member("own-gs-bo", "Bo Lind");
    // The address they used as a guest is their account address, so the contact is theirs.
    const guest = guestPersonKey(await contactFor(leaver.email, leaver.id));
    await gathering("own-gs-full", { capacity: 1 });
    expect((await rsvp(pool, "own-gs-full", guest, "going")).ok).toBe(true);
    expect((await joinWaitlist(pool, "own-gs-full", "own-gs-ash")).ok).toBe(true);
    await gathering("own-gs-queue", { capacity: 1 });
    expect((await rsvp(pool, "own-gs-queue", "own-gs-bo", "going")).ok).toBe(true);
    expect((await joinWaitlist(pool, "own-gs-queue", guest)).ok).toBe(true);

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(await q("SELECT event_id FROM event_rsvps WHERE user_id = ?", [guest]), "their guest seat is gone").toEqual([]);
    expect(await q("SELECT event_id FROM event_waitlist WHERE user_id = ?", [guest]), "their guest queue place is gone").toEqual([]);
    expect(await answer("own-gs-full", "own-gs-ash"), "the seat their guest key held went to the person waiting for it").toBe("going");
    expect(await answer("own-gs-queue", "own-gs-bo")).toBe("going");
    const steps = (await erasureRecord(pool, leaver.id))!.stepsDone;
    expect(steps.indexOf("guest-places-after-tombstone")).toBeGreaterThan(steps.indexOf("member-agent-after-tombstone"));
    expect(steps.indexOf("guest-places-after-tombstone"), "before comms deletes the contact that says whose key it is").toBe(steps.indexOf("comms") - 1);
  });

  it("never promotes a tombstone's guest-era key off the waitlist while its sweep is stopped", async () => {
    const gone = await member("own-gq-gone", "Lark Benn");
    await member("own-gq-sat", "Sol Tarn");
    await member("own-gq-bo", "Bo Lind");
    const guest = guestPersonKey(await contactFor(gone.email, gone.id));
    await gathering("own-gq-ev", { capacity: 1 });
    expect((await rsvp(pool, "own-gq-ev", "own-gq-sat", "going")).ok).toBe(true);
    expect((await joinWaitlist(pool, "own-gq-ev", guest)).ok).toBe(true);
    expect((await joinWaitlist(pool, "own-gq-ev", "own-gq-bo")).ok).toBe(true);
    // The sweep stopped after the tombstone and before comms: the contact and the queue row still stand.
    await tombstoneOnly(gone.id);

    expect(await withdrawRsvp(pool, "own-gq-ev", "own-gq-sat")).toBe(true);

    expect(await answer("own-gq-ev", guest), "a tombstone's guest key is never seated").toBeNull();
    expect(await answer("own-gq-ev", "own-gq-bo"), "the seat goes to the next living person").toBe("going");
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

  it("leaves a living member's own request at the leaver's address on their account, and takes only the leaver's address off it", async () => {
    const leaver = await member("own-leaver-hx", "Wren Halloway");
    const ash = await member("own-hx-ash", "Ash Moreno");
    // A household: Ash, signed in, typed the leaver's address as the contact for the two of them.
    const ashOwn = await createReservation(pool, {
      structureKey: "ridgeA", homeType: "villa", name: "Ash Moreno", email: leaver.email,
      phone: "555 0177", notes: "For the two of us", userId: ash.id,
    });
    expect(await setReservationStatus(pool, ashOwn.id, "reserved")).toBe(true);
    // And an order on Ash's account that carries the leaver's address.
    await q("INSERT INTO product_purchases (id, product_id, user_id, payer_email, amount_minor, receipt_no) VALUES (?,?,?,?,?,?)", ["pp-hx-ash", "prod-1", ash.id, leaver.email, 900, 41]);

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(await q("SELECT user_id, name, phone, notes, status, home_type, email FROM housing_reservations WHERE id = ?", [ashOwn.id])).toEqual([
      { user_id: ash.id, name: "Ash Moreno", phone: "555 0177", notes: "For the two of us", status: "reserved", home_type: "villa", email: `deleted-${leaver.id}@anonymized.invalid` },
    ]);
    expect((await reservationsForMember(pool, ash.id)).map((r) => r.id), "it is still on Ash's resident path").toContain(ashOwn.id);
    expect(
      await q("SELECT id FROM housing_reservations WHERE LOWER(TRIM(email)) = ?", [leaver.email.toLowerCase()]),
      "and the leaver's address is on no request",
    ).toEqual([]);
    expect(await q("SELECT user_id, payer_email, amount_minor FROM product_purchases WHERE id = 'pp-hx-ash'")).toEqual([
      { user_id: ash.id, payer_email: null, amount_minor: 900 },
    ]);
  });

  it("rewrites the admin audit line each scrubbed request wrote, and leaves a living member's own line alone", async () => {
    const leaver = await member("own-leaver-ha", "Wren Halloway");
    const ash = await member("own-ha-ash", "Ash Moreno");
    const signedIn = await createReservation(pool, {
      structureKey: "ridgeA", homeType: "casita", name: "Wren Halloway", email: leaver.email, phone: null, notes: null, userId: leaver.id,
    });
    const byAddress = await createReservation(pool, {
      structureKey: null, homeType: "tiny-home", name: "W. Halloway", email: leaver.email, phone: null, notes: null,
    });
    const ashOwn = await createReservation(pool, {
      structureKey: "ridgeA", homeType: "villa", name: "Ash Moreno", email: ash.email, phone: null, notes: null, userId: ash.id,
    });
    // The line the request route writes for each (server/routes/housing.ts).
    for (const [r, name, home, hamlet, actor] of [
      [signedIn, "Wren Halloway", "casita", "ridgeA", leaver.id],
      [byAddress, "W. Halloway", "tiny-home", null, null],
      [ashOwn, "Ash Moreno", "villa", "ridgeA", ash.id],
    ] as const) {
      await recordEvent(pool, {
        kind: "housing_reservation", text: `${name} asked for a ${home}${hamlet ? ` in ${hamlet}` : ""}`,
        actorUserId: actor, entityType: "housing_reservation", entityRef: r.id, audience: "admin",
      });
    }
    const lines = async () =>
      q("SELECT entity_ref, text FROM health_events WHERE entity_type = 'housing_reservation' AND entity_ref IN (?, ?, ?) ORDER BY text", [signedIn.id, byAddress.id, ashOwn.id]);
    expect((await lines()).filter((l) => String(l.text).includes("Halloway")), "the lines were written").toHaveLength(2);

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(await lines()).toEqual([
      { entity_ref: signedIn.id, text: "A departed member asked for a casita in ridgeA" },
      { entity_ref: byAddress.id, text: "A departed member asked for a tiny-home" },
      { entity_ref: ashOwn.id, text: "Ash Moreno asked for a villa in ridgeA" },
    ]);
  });

  it("forgets the comms contact behind a second address they typed into a request, and keeps every contact somebody else holds", async () => {
    const leaver = await member("own-leaver-h2", "Wren Halloway");
    const ash = await member("own-h2-ash", "Ash Moreno");
    const work = "wren.work@x-own.test";
    // Signed in, with an address that is not their account's, and the paths box ticked.
    const second = await createReservation(pool, {
      structureKey: "ridgeA", homeType: "casita", name: "Wren Halloway", email: work, phone: null, notes: null, userId: leaver.id,
    });
    const pathDeps = { getPool: () => pool, members: usersRepo(pool) };
    await handlePathTrigger(pathDeps, { type: "housing_status", reservationId: second.id, status: "new", email: work, name: "Wren Halloway", consentPaths: true } as any);
    const workContact = (await q("SELECT id FROM comms_contacts WHERE email_key = ?", [work]))[0]?.id;
    expect(workContact, "the trigger made a contact for the typed address").toBeTruthy();
    expect(await q("SELECT kind FROM comms_permissions WHERE contact_id = ?", [workContact]), "and a yes to paths on it").not.toEqual([]);
    expect(await q("SELECT id FROM path_enrollments WHERE person_key = ?", [guestPersonKey(workContact)]), "and a place on the resident path").not.toEqual([]);
    await q(
      "INSERT INTO comms_messages (id, idempotency_key, to_email, email_key, contact_id, kind, origin, subject, status) VALUES ('msg-own-h2', 'key-own-h2', ?, ?, ?, 'essential', 'housing.ack', 'We have your reservation request', 'sent')",
      [work, work, workContact],
    );
    // Two addresses on their requests that are somebody else's: Ash's account address, and one a stranger's own public request also uses.
    await createReservation(pool, { structureKey: null, homeType: "villa", name: "Wren Halloway", email: ash.email, phone: null, notes: null, userId: leaver.id });
    const ashContact = await contactFor(ash.email, ash.id, "account");
    const shared = "porch@x-own.test";
    await createReservation(pool, { structureKey: null, homeType: "villa", name: "Wren Halloway", email: shared, phone: null, notes: null, userId: leaver.id });
    await createReservation(pool, { structureKey: null, homeType: "villa", name: "Ida Fenn", email: shared, phone: null, notes: null });
    const strangerContact = await contactFor(shared, null);

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(await q("SELECT id FROM comms_contacts WHERE email_key = ?", [work]), "the second address leaves the address book").toEqual([]);
    expect(await q("SELECT kind FROM comms_permissions WHERE contact_id = ?", [workContact])).toEqual([]);
    expect(await q("SELECT id FROM path_enrollments WHERE person_key = ?", [guestPersonKey(workContact)]), "and its journey ends").toEqual([]);
    expect(await q("SELECT to_email, email_key, contact_id FROM comms_messages WHERE id = 'msg-own-h2'"), "the acknowledgement stays on the ledger, addressed to nobody").toEqual([
      { to_email: ERASED_ADDRESS, email_key: ERASED_ADDRESS, contact_id: null },
    ]);
    expect(await q("SELECT id FROM comms_contacts WHERE id IN (?, ?) ORDER BY id", [ashContact, strangerContact]), "every contact somebody else holds stays").toEqual(
      [{ id: ashContact }, { id: strangerContact }].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    const steps = (await erasureRecord(pool, leaver.id))!.stepsDone;
    expect(steps.indexOf("housing-contacts-after-tombstone"), "read before the scrub takes the address off the row").toBe(
      steps.indexOf("housing-reservations-after-tombstone") - 1,
    );
  });

  it("drops the vouches written about them and the ones they gave somebody still waiting, and keeps the vouch that admitted somebody without its words", async () => {
    const leaver = await member("own-leaver-vc", "Wren Halloway");
    await member("own-vc-new", "Pip Arden");
    await member("own-vc-in", "Juno Vale");
    await member("own-vc-friend", "Moss Tal");
    await member("own-vc-other", "Sage Okafor");
    await q("UPDATE users SET membership_granted = 1 WHERE id = 'own-vc-in'");
    await recordVouch(pool, { id: "vch-own-1", voucherUserId: leaver.id, vouchedUserId: "own-vc-in", kind: "member", note: "Known Juno ten years" });
    await recordVouch(pool, { id: "vch-own-2", voucherUserId: "own-vc-friend", vouchedUserId: leaver.id, kind: "member", note: "Wren mends every fence" });
    await recordVouch(pool, { id: "vch-own-3", voucherUserId: "own-vc-other", vouchedUserId: "own-vc-new", kind: "member", note: "Pip is steady" });
    await recordVouch(pool, { id: "vch-own-4", voucherUserId: leaver.id, vouchedUserId: "own-vc-new", kind: "arrival", note: null });

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(await q("SELECT id FROM member_vouches WHERE vouched_user_id = ?", [leaver.id]), "nothing written about them stays").toEqual([]);
    expect(await q("SELECT id, kind, note FROM member_vouches WHERE voucher_user_id = ?", [leaver.id]), "only the vouch that admitted Juno stays").toEqual([
      { id: "vch-own-1", kind: "member", note: null },
    ]);
    expect((await vouchesFor(pool, "own-vc-new")).map((v) => v.voucherUserId), "Pip, still waiting, holds no vouch from somebody gone").toEqual(["own-vc-other"]);
    expect(await q("SELECT note FROM member_vouches WHERE id = 'vch-own-3'")).toEqual([{ note: "Pip is steady" }]);
  });

  it("admits nobody on a vouch the leaver gave: the next living vouches count from where the living ones stand", async () => {
    const leaver = await member("own-leaver-va", "Wren Halloway");
    await member("own-va-pip", "Pip Arden");
    await member("own-va-sage", "Sage Okafor");
    await member("own-va-moss", "Moss Tal");
    await member("own-va-dan", "Dan Ruiz");
    // The village's bar is its default of three. Wren and Sage vouched while Wren was here.
    await recordVouch(pool, { id: "vch-va-1", voucherUserId: leaver.id, vouchedUserId: "own-va-pip", kind: "member" });
    await recordVouch(pool, { id: "vch-va-2", voucherUserId: "own-va-sage", vouchedUserId: "own-va-pip", kind: "member" });

    await anonymizeMember(pool, leaver, "admin-1", deps());

    const third = await vouchRoutes("own-va-moss")("/api/members/:id/vouch", "own-va-pip");
    expect(third.status).toBe(200);
    expect(third.body.vouches.count, "two living people have vouched").toBe(2);
    expect(third.body.admitted, "two living vouches and a departed one is not three").toBe(false);
    expect((await usersRepo(pool).byId("own-va-pip"))!.membershipGranted).toBeFalsy();
    // The control: a third living voucher does admit.
    const fourth = await vouchRoutes("own-va-dan")("/api/members/:id/vouch", "own-va-pip");
    expect(fourth.body.admitted).toBe(true);
    expect((await usersRepo(pool).byId("own-va-pip"))!.membershipGranted).toBeTruthy();
  });

  it("admits nobody on a tombstone's vouch while its sweep is stopped, at the vouch route and at the invitation door", async () => {
    const gone = await member("own-vs-gone", "Lark Benn");
    await member("own-vs-pip", "Pip Arden");
    await member("own-vs-kai", "Kai Brun");
    await member("own-vs-sage", "Sage Okafor");
    await member("own-vs-moss", "Moss Tal");
    await member("own-vs-ash", "Ash Moreno");
    for (const [id, vouched] of [["vch-vs-1", "own-vs-pip"], ["vch-vs-3", "own-vs-kai"]]) {
      await recordVouch(pool, { id, voucherUserId: gone.id, vouchedUserId: vouched, kind: "member" });
    }
    for (const [id, vouched] of [["vch-vs-2", "own-vs-pip"], ["vch-vs-4", "own-vs-kai"]]) {
      await recordVouch(pool, { id, voucherUserId: "own-vs-sage", vouchedUserId: vouched, kind: "member" });
    }
    // Stopped after the tombstone, before the vouches step: the rows still stand.
    await tombstoneOnly(gone.id);

    const viaRoute = await vouchRoutes("own-vs-moss")("/api/members/:id/vouch", "own-vs-pip");
    expect(viaRoute.body.vouches.count).toBe(2);
    expect(viaRoute.body.admitted).toBe(false);
    expect((await usersRepo(pool).byId("own-vs-pip"))!.membershipGranted, "the route admits nobody on it").toBeFalsy();

    // Kai arrives on Ash's link: Ash's arrival vouch is the second living one.
    await makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) }).welcome("own-vs-ash", "own-vs-kai");
    expect((await vouchesFor(pool, "own-vs-kai")).map((v) => v.voucherUserId), "the arrival vouch was recorded").toContain("own-vs-ash");
    expect((await usersRepo(pool).byId("own-vs-kai"))!.membershipGranted, "the door admits nobody on it").toBeFalsy();
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

  it("hands a group they owned to a living member, never to another tombstone that sorts first", async () => {
    const leaver = await member("own-leaver-ch", "Wren Halloway");
    const earlier = await member("own-ch-a-gone", "Lark Benn");
    await member("own-ch-b-live", "Bo Lind");
    const group = await createGroup(pool, { createdBy: leaver.id, name: "Seed library", memberIds: [earlier.id, "own-ch-b-live"] });
    // Erased before conversations were swept: their row is still live, and it sorts first.
    await tombstoneOnly(earlier.id);

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(await ownersOf(group.id)).toEqual(["own-ch-b-live"]);
  });

  it("hands a group on to a living member when its owner leaves on their own and a tombstone sorts first", async () => {
    await member("own-cl-owner", "Rowan Ise");
    const earlier = await member("own-cl-a-gone", "Lark Benn");
    await member("own-cl-b-live", "Bo Lind");
    const group = await createGroup(pool, { createdBy: "own-cl-owner", name: "Bread rota", memberIds: [earlier.id, "own-cl-b-live"] });
    await tombstoneOnly(earlier.id);

    expect(await leaveConversation(pool, group.id, "own-cl-owner")).toBe(true);

    expect(await ownersOf(group.id)).toEqual(["own-cl-b-live"]);
  });

  it("gives a group an owner again when a crash left it with none, and when its owner is a tombstone erased before this step existed", async () => {
    const leaver = await member("own-leaver-cr", "Wren Halloway");
    await member("own-cr-ash", "Ash Moreno");
    await member("own-cr-bo", "Bo Lind");
    const oldOwner = await member("own-cr-old", "Lark Benn");
    // The state a death between the two writes of a leave used to leave: the leaver out and demoted, nobody owner.
    const halfLeft = await createGroup(pool, { createdBy: leaver.id, name: "Orchard", memberIds: ["own-cr-ash", "own-cr-bo"] });
    await q("UPDATE conversation_members SET left_at = CURRENT_TIMESTAMP, role = 'member' WHERE conversation_id = ? AND user_id = ?", [halfLeft.id, leaver.id]);
    // A group whose owner was erased before conversations were swept, which the leaver is in.
    const oldOwned = await createGroup(pool, { createdBy: oldOwner.id, name: "Choir", memberIds: [leaver.id, "own-cr-bo"] });
    await tombstoneOnly(oldOwner.id);
    const direct = await openDirect(pool, leaver.id, "own-cr-ash");

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(await ownersOf(halfLeft.id), "the longest-standing living member").toEqual(["own-cr-ash"]);
    expect(await ownersOf(oldOwned.id), "a tombstone holds the role for nobody").toEqual(["own-cr-bo"]);
    expect(await ownersOf(direct.id), "a direct thread has no owner, by design").toEqual([]);
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

  it("withdraws the vote a delegator's seat carried from the leaver, keeps a living delegation's copy, and tells no tombstone", async () => {
    const leaver = await member("own-leaver-dv", "Wren Halloway");
    await member("own-dv-ash", "Ash Moreno");
    await member("own-dv-bo", "Bo Lind");
    await member("own-dv-cy", "Cy Rook");
    const gone = await member("own-dv-gone", "Lark Benn");
    const ballot = await ballotFor([leaver.id, "own-dv-ash", "own-dv-bo", "own-dv-cy"]);
    // Ash hands their voice to the leaver, who votes yes; Bo hands theirs to Cy, who votes no.
    expect((await setDelegation(pool, "own-dv-ash", leaver.id)).ok).toBe(true);
    await acceptDelegations(pool, leaver.id, "own-dv-ash");
    expect((await setDelegation(pool, "own-dv-bo", "own-dv-cy")).ok).toBe(true);
    await acceptDelegations(pool, "own-dv-cy", "own-dv-bo");
    // A delegator erased before delegations were swept still points at the leaver.
    expect((await setDelegation(pool, gone.id, leaver.id)).ok).toBe(true);
    await tombstoneOnly(gone.id);
    expect((await castVote(pool, ballot, leaver.id, "yes")).ok).toBe(true);
    expect((await castVote(pool, ballot, "own-dv-cy", "no")).ok).toBe(true);
    expect(await votesOn(ballot), "Ash's seat carries the leaver's yes").toContainEqual({ user_id: "own-dv-ash", choice: "yes", followed_user_id: leaver.id });
    expect((await talliesFor(pool, ballot)).yesW).toBe(2);

    await anonymizeMember(pool, leaver, "admin-1", deps());

    const after = await votesOn(ballot);
    expect(after.filter((v) => v.followed_user_id === leaver.id), "no vote copied from them is still cast").toEqual([]);
    expect(after.some((v) => v.user_id === "own-dv-ash"), "Ash's seat is Ash's again, uncast").toBe(false);
    expect(after, "Bo still carries Cy's no").toContainEqual({ user_id: "own-dv-bo", choice: "no", followed_user_id: "own-dv-cy" });
    // The leaver's own yes is a separate question (an erased member's own vote), so this asks only that Ash's copy left the count.
    expect((await talliesFor(pool, ballot)).yesW, "Ash's seat no longer counts the leaver's yes").toBeLessThanOrEqual(1);
    expect(notices.map((n) => n.userId), "Ash is told, and nobody gone is").toEqual(["own-dv-ash"]);
  });

  it("withdraws the vote the leaver's own seat carried from the member they handed it to", async () => {
    const leaver = await member("own-leaver-dw", "Wren Halloway");
    await member("own-dw-cy", "Cy Rook");
    const ballot = await ballotFor([leaver.id, "own-dw-cy"]);
    expect((await setDelegation(pool, leaver.id, "own-dw-cy")).ok).toBe(true);
    await acceptDelegations(pool, "own-dw-cy", leaver.id);
    expect((await castVote(pool, ballot, "own-dw-cy", "yes")).ok).toBe(true);
    expect(await votesOn(ballot)).toContainEqual({ user_id: leaver.id, choice: "yes", followed_user_id: "own-dw-cy" });

    await anonymizeMember(pool, leaver, "admin-1", deps());

    expect(await votesOn(ballot), "their seat carries nobody's vote").toEqual([{ user_id: "own-dw-cy", choice: "yes", followed_user_id: null }]);
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
    expect(await q("SELECT id, payer_email, amount_minor FROM product_purchases WHERE id LIKE 'pp-own-%' ORDER BY id")).toEqual([
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
    expect(steps.slice(steps.indexOf("tombstone"), steps.indexOf("tombstone") + 5), "the guest-era places go before comms takes the contacts").toEqual([
      "tombstone",
      "handle-after-tombstone",
      "member-agent-after-tombstone",
      "guest-places-after-tombstone",
      "comms",
    ]);
    expect(steps.slice(at, at + 12)).toEqual([
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
    ]);
    expect(steps.indexOf("sessions-after-tombstone")).toBeGreaterThan(steps.indexOf("purchase-emails-after-tombstone"));
    // An erasure asked for again runs every step again, over the tombstone, and finishes.
    await anonymizeMember(pool, await usersRepo(pool).byId(leaver.id), null, deps());
    expect((await erasureRecord(pool, leaver.id))!.finishedAt).not.toBeNull();
  });
});

/**
 * WHETHER AN EVENING IS STILL AHEAD, which decides whether a freed seat serves
 * the queue and whether a held fee comes back. Pure, so it runs with no
 * database. A recurring evening is named by its village date, so it is ahead
 * through that whole day in the village's zone and not a moment longer, at
 * either edge of the clock.
 */
describe("eveningAhead", () => {
  const weekly = { startsAt: new Date("2026-10-02T06:00:00Z"), endsAt: null, recurrence: { freq: "weekly", byWeekday: [5] } };

  it("ends a recurring evening at village midnight at UTC+13", () => {
    // 21:00Z on the 23rd is 10:00 on the 24th in Tonga (UTC+13 all year) and in Auckland (NZDT, UTC+13 in October).
    const now = new Date("2026-10-23T21:00:00Z");
    for (const zone of ["Pacific/Tongatapu", "Pacific/Auckland"]) {
      expect(eveningAhead(weekly, "2026-10-23", now, zone), `${zone}: the 23rd is over`).toBe(false);
      expect(eveningAhead(weekly, "2026-10-24", now, zone), `${zone}: the 24th is today`).toBe(true);
    }
    // 10:30Z on the 23rd is 23:30 on the 23rd in Tonga: still that evening's day.
    expect(eveningAhead(weekly, "2026-10-23", new Date("2026-10-23T10:30:00Z"), "Pacific/Tongatapu")).toBe(true);
    expect(eveningAhead(weekly, "2026-10-23", new Date("2026-10-23T11:30:00Z"), "Pacific/Tongatapu"), "00:30 on the 24th").toBe(false);
  });

  it("keeps a recurring evening ahead through its whole village day at UTC-11", () => {
    // 09:00Z on the 24th is 22:00 on the 23rd in Pago Pago (UTC-11).
    expect(eveningAhead(weekly, "2026-10-23", new Date("2026-10-24T09:00:00Z"), "Pacific/Pago_Pago")).toBe(true);
    expect(eveningAhead(weekly, "2026-10-23", new Date("2026-10-24T11:30:00Z"), "Pacific/Pago_Pago"), "00:30 on the 24th").toBe(false);
    expect(eveningAhead(weekly, "2026-10-22", new Date("2026-10-23T09:00:00Z"), "Pacific/Pago_Pago"), "22:00 on the 22nd").toBe(true);
  });

  it("reads UTC and a one-off the way it always has", () => {
    const now = new Date("2026-10-23T21:00:00Z");
    expect(eveningAhead(weekly, "2026-10-23", now, "UTC")).toBe(true);
    expect(eveningAhead(weekly, "2026-10-22", now, "UTC")).toBe(false);
    const oneOff = { startsAt: new Date("2026-10-23T18:00:00Z"), endsAt: new Date("2026-10-23T22:00:00Z"), recurrence: null };
    expect(eveningAhead(oneOff, "", now, "Pacific/Tongatapu"), "a one-off is ahead until it ends, in any zone").toBe(true);
    expect(eveningAhead(oneOff, "", new Date("2026-10-23T22:00:01Z"), "Pacific/Pago_Pago")).toBe(false);
  });
});
