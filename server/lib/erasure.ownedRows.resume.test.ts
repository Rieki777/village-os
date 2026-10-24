/**
 * EVERY NEW ERASURE STEP, STOPPED PART WAY AND RESUMED.
 *
 * server/lib/erasure.ownedRows.test.ts proves what each step does on a run
 * that goes through. That is not what the steps promise. Each one says it is
 * safe to resume: a death part way leaves the step unrecorded, and the resume
 * finds whatever is left and finishes it, once. A test that re-runs a whole
 * erasure from the start never meets the half-done state the promise is
 * about, because every write of the first run has already landed.
 *
 * So every case here seeds one member who holds a row in every table the new
 * steps reach, breaks ONE statement inside ONE step (the pool throws once on
 * it), lets the sweep stop there, resumes it the way the steward's queue and
 * the hourly job do (`resumeErasure`, which re-reads the tombstone), and then
 * asks for the same end state an unbroken run reaches. The control case is
 * that unbroken run, against the same check.
 *
 * Three cases sit beside the table. A member's own leave of a group, which
 * has no resume behind it, is all or nothing. And two are about the seat
 * refunds' own resume: a refund whose claim landed and whose ledger leg did
 * not is finished exactly once, and giving up a place and refunding its fee
 * are judged on the same clock even when the step stops between them.
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
import { anonymizeMember, resumeErasure, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import { recordVouch } from "../repos/vouches";
import { recordFact } from "../repos/investorPath";
import { rsvp } from "./gatherings";
import { joinWaitlist, releasePlacesOf, setPromotionSink } from "./calendarCommunity";
import { keysFor, seatChargeFor } from "./eventSeats";
import { createReservation } from "./housing";
import { createGroup, leaveConversation } from "./messaging";
import { acceptDelegations, setDelegation } from "./delegation";
import { recordEvent } from "./events";
import { ensureContact } from "./comms/contacts";
import { guestPersonKey } from "../../shared/comms/kinds";
import { CYCLE_POOL_FAUCET, balanceOf, checkLedgerInvariants, loadTokenRegistry, memberAccount, postTransfer } from "./ledger";
import { toLedgerUnits } from "./economy";

const configured = testDbConfigured();
const ANON = "A departed member";
const TOKEN = "credits";
const DAY = 86_400_000;

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

/** The erasure's singletons with the real users repository. No spine, so each notice lands in the bell under its key. */
function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: (u: any) => void) => real.update(id, fn) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn: () => Promise<any>) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  } as ErasureDeps;
}

type Match = (sql: string, params: unknown) => boolean;

/**
 * The pool, except that the first statement `match` names throws, once, on
 * the pool or on any connection taken from it. That is what a dropped
 * connection or a lock timeout looks like to the code under test: a query
 * that never came back, with everything before it landed.
 */
function faultOnce(real: mysql.Pool, match: Match): { pool: mysql.Pool; fired: () => boolean } {
  let fired = false;
  const check = (sql: unknown, params: unknown) => {
    const text = typeof sql === "string" ? sql : String((sql as any)?.sql ?? "");
    if (!fired && match(text, params)) {
      fired = true;
      throw new Error(`injected fault on: ${text.slice(0, 80)}`);
    }
  };
  const wrap = <T extends object>(target: T, extra: Record<string, unknown> = {}): T =>
    new Proxy(target, {
      get(t: any, prop) {
        if (prop in extra) return extra[prop as string];
        if (prop === "query" || prop === "execute") {
          return async (sql: unknown, params?: unknown) => {
            check(sql, params);
            return t[prop](sql, params);
          };
        }
        const v = Reflect.get(t, prop, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  const faulty = wrap(real, { getConnection: async () => wrap(await real.getConnection()) });
  return { pool: faulty, fired: () => fired };
}

const has = (needle: string): Match => (sql) => sql.includes(needle);
const withParam = (needle: string, test: (params: unknown[]) => boolean): Match => (sql, params) =>
  sql.includes(needle) && Array.isArray(params) && test(params);

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

const iso = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

async function gathering(id: string, opts: { capacity?: number | null; startsAt?: Date; price?: number } = {}): Promise<void> {
  await q(
    "INSERT INTO events (id, title, starts_at, status, kind, layer, capacity, seat_price, seat_token) VALUES (?,?,?,'scheduled','gathering','village',?,?,?)",
    [id, `Gathering ${id}`, iso(opts.startsAt ?? new Date(Date.now() + 5 * DAY)), opts.capacity ?? null, opts.price ?? 0, (opts.price ?? 0) > 0 ? TOKEN : null],
  );
}

const answer = async (eventId: string, userId: string) =>
  (await q("SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?", [eventId, userId]))[0]?.status ?? null;

/** One member holding a row in every table the new steps reach, and the people around them. */
interface Seeded {
  leaver: any;
  guest: string;
  workContact: string;
  feeBefore: number;
  p: string;
}

async function seed(p: string): Promise<Seeded> {
  // The tombstone handle keeps the id's last eight characters, so the prefix goes last.
  const leaver = await member(`leaver-${p}`, "Wren Halloway", 50);
  // Bo waits behind a paid seat, and a paid queue place is charged too, so Bo has credits.
  for (const who of ["ash", "bo", "pip", "juno", "moss"]) await member(`${p}-${who}`, who, who === "bo" ? 50 : 0);
  await q("UPDATE users SET membership_granted = 1 WHERE id = ?", [`${p}-juno`]);

  // Places: a guest-era seat Ash waits behind, and a paid seat of their own Bo waits behind.
  const guest = guestPersonKey((await ensureContact({ getPool: () => pool }, { email: leaver.email, name: null, userId: leaver.id, source: "guest" }))!.id);
  await gathering(`${p}-g1`, { capacity: 1 });
  expect((await rsvp(pool, `${p}-g1`, guest, "going")).ok).toBe(true);
  expect((await joinWaitlist(pool, `${p}-g1`, `${p}-ash`)).ok).toBe(true);
  await gathering(`${p}-g2`, { capacity: 1, price: 5 });
  expect((await rsvp(pool, `${p}-g2`, leaver.id, "going")).ok).toBe(true);
  expect((await joinWaitlist(pool, `${p}-g2`, `${p}-bo`)).ok).toBe(true);
  const feeBefore = await balanceOf(pool, memberAccount(leaver.id), TOKEN);

  // Housing: their signed-in request with its audit line, and a second address with its own contact.
  const own = await createReservation(pool, { structureKey: "ridgeA", homeType: "casita", name: "Wren Halloway", email: leaver.email, phone: "555 0100", notes: "Two dogs", userId: leaver.id });
  await recordEvent(pool, { kind: "housing_reservation", text: "Wren Halloway asked for a casita in ridgeA", actorUserId: leaver.id, entityType: "housing_reservation", entityRef: own.id, audience: "admin" });
  const work = `${p}.work@x-own.test`;
  await createReservation(pool, { structureKey: null, homeType: "villa", name: "Wren Halloway", email: work, phone: null, notes: null, userId: leaver.id });
  const workContact = (await ensureContact({ getPool: () => pool }, { email: work, name: "Wren Halloway", userId: null, source: "housing" }))!.id;

  // Vouches: one for somebody waiting, one that admitted somebody, one about them.
  await recordVouch(pool, { id: `${p}-v1`, voucherUserId: leaver.id, vouchedUserId: `${p}-pip`, kind: "member", note: "Known Pip for years" });
  await recordVouch(pool, { id: `${p}-v2`, voucherUserId: leaver.id, vouchedUserId: `${p}-juno`, kind: "member", note: "Juno is kind" });
  await recordVouch(pool, { id: `${p}-v3`, voucherUserId: `${p}-moss`, vouchedUserId: leaver.id, kind: "member", note: "Wren mends fences" });

  // A group they own, and a voice Ash handed them.
  await createGroup(pool, { createdBy: leaver.id, name: `Orchard ${p}`, memberIds: [`${p}-ash`, `${p}-bo`] });
  expect((await setDelegation(pool, `${p}-ash`, leaver.id)).ok).toBe(true);
  await acceptDelegations(pool, leaver.id, `${p}-ash`);

  // Their words on value rows, and a venture.
  await q("INSERT INTO member_ventures (id, user_id, name, summary) VALUES (?,?,?,?)", [`${p}-mv`, leaver.id, "Halloway Honey", "Raw honey"]);
  await recordFact(pool, { userId: leaver.id, fact: "interest_registered", detail: "After the harvest" });
  await q("INSERT INTO stays (id, user_id, accommodation_id, status, notes, updated_at) VALUES (?,?,?,?,?,?)", [`${p}-st`, leaver.id, "acc-1", "ended", "Allergic to wool", "2026-01-15 10:00:00"]);
  await q("INSERT INTO product_purchases (id, product_id, user_id, payer_email, amount_minor, receipt_no) VALUES (?,?,?,?,?,?)", [`${p}-pp`, "prod-1", leaver.id, leaver.email, 1200, Math.floor(Math.random() * 1e9)]);

  return { leaver, guest, workContact, feeBefore, p };
}

/**
 * The state an unbroken sweep leaves. Every resumed sweep must reach the same
 * one. Soft, so a red run names every row that differs and not only the first.
 */
async function expectSwept(s: Seeded): Promise<void> {
  const { leaver, guest, p } = s;
  const record = await erasureRecord(pool, leaver.id);
  expect.soft(record?.finishedAt, "the sweep finished").not.toBeNull();

  // Places, and the seats they freed.
  for (const key of [leaver.id, guest]) {
    expect.soft(await q("SELECT event_id FROM event_rsvps WHERE user_id = ?", [key]), `no answer stands for ${key}`).toEqual([]);
    expect.soft(await q("SELECT event_id FROM event_waitlist WHERE user_id = ?", [key]), `no queue place stands for ${key}`).toEqual([]);
  }
  expect.soft(await answer(`${p}-g1`, `${p}-ash`), "the guest-era seat served the queue").toBe("going");
  expect.soft(await answer(`${p}-g2`, `${p}-bo`), "their own seat served the queue").toBe("going");
  const charge = await seatChargeFor(pool, `${p}-g2`, leaver.id, "");
  expect.soft(charge?.status).toBe("released");
  expect.soft(await q("SELECT id FROM token_ledger WHERE idempotency_key = ?", [keysFor(charge!).refund]), "the fee came back exactly once").toHaveLength(1);
  expect.soft(await balanceOf(pool, memberAccount(leaver.id), TOKEN)).toBe(s.feeBefore + toLedgerUnits(TOKEN, 5));
  expect.soft((await checkLedgerInvariants(pool)).problems).toEqual([]);

  // Housing, its audit line, and the second address's contact.
  const rows = await q("SELECT id, name, email, phone, notes, user_id FROM housing_reservations WHERE name = ? AND email = ?", [ANON, `deleted-${leaver.id}@anonymized.invalid`]);
  expect.soft(rows, "both requests are scrubbed").toHaveLength(2);
  expect.soft(rows.every((r) => r.phone === null && r.notes === null && r.user_id === null)).toBe(true);
  expect.soft(await q("SELECT id FROM housing_reservations WHERE user_id = ?", [leaver.id])).toEqual([]);
  const lines = await q("SELECT text FROM health_events WHERE entity_type = 'housing_reservation' AND entity_ref IN (?)", [rows.map((r) => r.id)]);
  expect.soft(lines).toEqual([{ text: "A departed member asked for a casita in ridgeA" }]);
  expect.soft(await q("SELECT id FROM comms_contacts WHERE id = ?", [s.workContact]), "the second address left the address book").toEqual([]);
  expect.soft(await q("SELECT id FROM comms_contacts WHERE user_id = ?", [leaver.id]), "and so did every contact on the account").toEqual([]);

  // Vouches.
  expect.soft(await q("SELECT id FROM member_vouches WHERE vouched_user_id = ?", [leaver.id])).toEqual([]);
  expect.soft(await q("SELECT id, note FROM member_vouches WHERE voucher_user_id = ? ORDER BY id", [leaver.id]), "only the vouch that admitted Juno stays").toEqual([
    { id: `${p}-v2`, note: null },
  ]);

  // The group has one living owner, the longest-standing member, and they are in no thread.
  const owned = await q(
    "SELECT m.user_id FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id WHERE c.name = ? AND m.role = 'owner' AND m.left_at IS NULL",
    [`Orchard ${p}`],
  );
  expect.soft(owned).toEqual([{ user_id: `${p}-ash` }]);
  expect.soft(await q("SELECT conversation_id FROM conversation_members WHERE user_id = ? AND left_at IS NULL", [leaver.id])).toEqual([]);

  // Delegations end, and Ash is told once.
  expect.soft(await q("SELECT delegator_id FROM delegations WHERE (delegator_id = ? OR delegate_id = ?) AND revoked_at IS NULL", [leaver.id, leaver.id])).toEqual([]);
  expect.soft(await q("SELECT dedupe_key FROM notifications WHERE user_id = ? AND type = 'governance'", [`${p}-ash`]), "told exactly once").toEqual([
    { dedupe_key: `delegation-ended:${leaver.id}:${p}-ash` },
  ]);

  // Their words.
  expect.soft(await q("SELECT id FROM member_ventures WHERE user_id = ?", [leaver.id])).toEqual([]);
  expect.soft(await q("SELECT detail FROM investor_path_facts WHERE user_id = ?", [leaver.id])).toEqual([{ detail: null }]);
  expect.soft(await q("SELECT notes FROM stays WHERE id = ?", [`${p}-st`])).toEqual([{ notes: null }]);
  expect.soft(await q("SELECT payer_email FROM product_purchases WHERE id = ?", [`${p}-pp`])).toEqual([{ payer_email: null }]);
}

describe.skipIf(!configured)("every new erasure step, stopped part way and resumed", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-resume-"));
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
  });

  it("the control: an unbroken sweep reaches the state every resume below must reach", async () => {
    const s = await seed("rz0");
    await anonymizeMember(pool, s.leaver, "admin-1", deps());
    await expectSwept(s);
  });

  /*
   * One row per new step, naming the statement that breaks. Where a step
   * writes more than once, the break is after its first write has landed,
   * which is the state "part way" means.
   */
  const cases: Array<[string, string, (s: Seeded) => Match]> = [
    ["rz1", "guest-places-after-tombstone", () => withParam("DELETE FROM event_waitlist WHERE user_id", (ps) => String(ps[0]).startsWith("guest:"))],
    ["rz2", "event-places-after-tombstone", (s) => withParam("DELETE FROM event_waitlist WHERE user_id", (ps) => ps[0] === s.leaver.id)],
    ["rz3", "event-places-after-tombstone", (s) => withParam("INTO token_ledger (id", (ps) => ps.some((v) => typeof v === "string" && v.endsWith(":refund") && v.includes(s.leaver.id)))],
    ["rz4", "housing-contacts-after-tombstone", (s) => withParam("DELETE FROM comms_contacts", (ps) => Array.isArray(ps[1]) && (ps[1] as unknown[]).includes(s.workContact))],
    // The housing audit line by its kind: the seat journal's rewrite in "org-seatings" is an earlier UPDATE of the same table.
    ["rz5", "housing-reservations-after-tombstone", () => has("WHERE kind = 'housing_reservation'")],
    ["rz6", "vouches-after-tombstone", () => has("UPDATE member_vouches SET note = NULL")],
    ["rz7", "conversations-after-tombstone", () => has("SET role = 'owner'")],
    ["rz8", "delegations-after-tombstone", () => has("UPDATE delegations SET revoked_at")],
    ["rz9", "ventures-after-tombstone", () => has("DELETE FROM member_ventures")],
    ["rz10", "investor-fact-words-after-tombstone", () => has("UPDATE investor_path_facts SET detail = NULL")],
    ["rz11", "stay-notes-after-tombstone", () => has("UPDATE stays SET notes = NULL")],
    ["rz12", "purchase-emails-after-tombstone", () => has("UPDATE product_purchases SET payer_email = NULL")],
  ];

  it.each(cases)("%s: stopped inside %s, resumed, and finished the same as an unbroken sweep", async (prefix, step, match) => {
    const s = await seed(prefix);
    const broken = faultOnce(pool, match(s));

    await expect(anonymizeMember(broken.pool, s.leaver, "admin-1", deps())).rejects.toThrow(/injected fault/);
    expect(broken.fired()).toBe(true);
    const stopped = await erasureRecord(pool, s.leaver.id);
    expect(stopped?.failedStep, "the sweep stopped where the fault was").toBe(step);
    expect(stopped?.stepsDone).not.toContain(step);

    const out = await resumeErasure(pool, s.leaver.id, deps());
    expect(out.finished).toBe(true);
    expect(out.ran[0], "the resume starts at the step that stopped").toBe(step);
    await expectSwept(s);
  });

  it("leaves a group exactly as it was when a member's own leave dies between handing it on and the heir taking it", async () => {
    // The member's own leave route has no resume to repair it, so the leave itself has to be all or nothing.
    for (const id of ["rl-owner", "rl-ash", "rl-bo"]) await member(id, id);
    const group = await createGroup(pool, { createdBy: "rl-owner", name: "Rota", memberIds: ["rl-ash", "rl-bo"] });
    const broken = faultOnce(pool, has("SET role = 'owner'"));

    await expect(leaveConversation(broken.pool, group.id, "rl-owner")).rejects.toThrow(/injected fault/);

    expect(
      await q("SELECT user_id, role, left_at IS NULL AS live FROM conversation_members WHERE conversation_id = ? ORDER BY user_id", [group.id]),
      "nothing landed: the owner is still in and still owner",
    ).toEqual([
      { user_id: "rl-ash", role: "member", live: 1 },
      { user_id: "rl-bo", role: "member", live: 1 },
      { user_id: "rl-owner", role: "owner", live: 1 },
    ]);
    expect(await leaveConversation(pool, group.id, "rl-owner")).toBe(true);
    expect(await q("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND role = 'owner' AND left_at IS NULL", [group.id])).toEqual([
      { user_id: "rl-ash" },
    ]);
  });

  it("finishes a refund whose claim landed and whose ledger leg did not, exactly once", async () => {
    const leaver = await member("rr-leaver", "Wren Halloway", 50);
    await gathering("rr-g", { price: 5 });
    expect((await rsvp(pool, "rr-g", leaver.id, "going")).ok).toBe(true);
    const before = await balanceOf(pool, memberAccount(leaver.id), TOKEN);
    // The state a death between `refundPlace`'s claim and its post leaves: released, and the fee still in escrow.
    await q("UPDATE event_seat_charges SET status = 'released', settled_at = NOW() WHERE event_id = 'rr-g' AND user_id = ?", [leaver.id]);
    const charge = (await seatChargeFor(pool, "rr-g", leaver.id, ""))!;
    expect(await q("SELECT id FROM token_ledger WHERE idempotency_key = ?", [keysFor(charge).refund])).toEqual([]);

    await releasePlacesOf(pool, leaver.id);
    await releasePlacesOf(pool, leaver.id);

    expect(await q("SELECT id FROM token_ledger WHERE idempotency_key = ?", [keysFor(charge).refund]), "the leg landed, once").toHaveLength(1);
    expect(await balanceOf(pool, memberAccount(leaver.id), TOKEN)).toBe(before + toLedgerUnits(TOKEN, 5));
    expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
  });

  it("judges giving up a place and refunding its fee on one clock, even when the step stops between them", async () => {
    const leaver = await member("rc-leaver", "Wren Halloway", 50);
    await member("rc-bo", "Bo Lind", 50);
    // An evening an hour away, which will be over by the time the hourly retry comes back.
    await gathering("rc-g", { capacity: 1, price: 5, startsAt: new Date(Date.now() + 3600_000) });
    expect((await rsvp(pool, "rc-g", leaver.id, "going")).ok).toBe(true);
    expect((await joinWaitlist(pool, "rc-g", "rc-bo")).ok).toBe(true);
    const broken = faultOnce(pool, withParam("DELETE FROM event_waitlist WHERE user_id", (ps) => ps[0] === leaver.id));

    await expect(releasePlacesOf(broken.pool, leaver.id)).rejects.toThrow(/injected fault/);
    await releasePlacesOf(pool, leaver.id, { now: new Date(Date.now() + 3 * 3600_000) });

    expect(await answer("rc-g", "rc-bo"), "the seat was handed on while the evening was ahead").toBe("going");
    expect((await seatChargeFor(pool, "rc-g", leaver.id, ""))?.status, "so the fee for it came back").toBe("released");
  });
});
