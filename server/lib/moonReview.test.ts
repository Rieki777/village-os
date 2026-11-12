/**
 * THE END-OF-MOON REVIEW'S MONEY AND APPROVALS (lane B), each check named:
 *
 *   send-invoice      refused with the contract's sentence while the payers and
 *                     settings are empty, on a pending route, with no number,
 *                     on the contractor route with no key, with a stale pilot
 *                     note; sent with the member's own number and a bill ref
 *   two people        the member never approves their own; an admin who holds
 *                     no seat never passes; work and invoice by two people
 *   alone and own     moon.approve_alone gives both, never on their own;
 *                     moon.approve_own approves their own, marked self-approved
 *   bulk              each invoice checked alone; one that fails stays out
 *   cash owed         exactly one claimed row per line, under the settlement's
 *                     key; a key another row holds refuses the approval
 *   paid              the transfers door makes a fully paid invoice Paid
 *   privacy           the moon.approve queue carries no invoice; the room
 *                     panel has no amount; imported items show privately
 *   decision 2        no queue row carries the member's band or score; the
 *                     member still reads it, and the hash, the invoice and
 *                     both approvals are unchanged
 *   import            twice adds nothing; a pack with an amount key is refused
 *   clocks            cashKeys.role and moon_recaps.cycle_id agree on both clocks
 *
 * Every person here is invented.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { CALENDAR_CLOCK, LUNAR_CLOCK } from "../../shared/cycleClock";
import {
  APPROVAL_REFUSALS, MOON_ROUTES, NOTICE_WORDS, PACK_REFUSAL_WORDS, QUEUE_ROW_KEYS, SEND_REFUSALS, TASK_BANDS, packMoonDates, readingOf,
  rowExistsRefusal, scoreContextOf, taskScore,
} from "../../shared/moonRecap";
import { cashKeys, moonLineCashKey, recordCashTransfer } from "./cashOwed";
import { currentCycle } from "./gratitude-cycles";
import { moonOf, resolveMoon } from "./moonRecap";
import { currentHash, settlePaidInvoices } from "./moonReview";
import { itemsOf, recapById } from "../repos/moonRecaps";
import { register } from "../routes/moonRecaps";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;
const TZ = "America/Costa_Rica";

describe("the cash owed key and the recap's cycle id", () => {
  it("agree under the lunar and the calendar clock", () => {
    for (const clock of [LUNAR_CLOCK, CALENDAR_CLOCK]) {
      for (const at of ["2026-10-20T12:00:00Z", "2026-11-08T23:30:00Z", "2027-02-01T00:00:00Z"]) {
        const instant = new Date(at);
        const recapCycle = resolveMoon(clock, null, TZ, instant)!.bounds.id;
        const settlementCycle = currentCycle(instant, clock).id;
        expect(recapCycle, `${clock.mode} ${at}`).toBe(settlementCycle);
        expect(moonLineCashKey(recapCycle, { kind: "pay", firstSeatId: "a-1" }, "m-1")).toBe(cashKeys.role(settlementCycle, "a-1", "m-1"));
        // The same id read back through the recap's own door.
        expect(resolveMoon(clock, recapCycle, TZ, new Date(instant.getTime() + 86_400_000 * 400))!.bounds.id).toBe(recapCycle);
      }
    }
  });

  it("an allowance line keeps its own key beside the pay line of the same application", () => {
    expect(moonLineCashKey("c", { kind: "allowance", firstSeatId: "a-1" }, "m")).not.toBe(moonLineCashKey("c", { kind: "pay", firstSeatId: "a-1" }, "m"));
  });
});

const configured = testDbConfigured();
const MOON = moonOf(LUNAR_CLOCK.boundsFor(new Date("2026-10-20T12:00:00Z")), TZ);
const CYCLE = MOON.bounds.id;
const SEASONS = [{ id: "season-f", startsOn: "2026-06-21", endsOn: "2027-01-01", goals: [{ id: "g-ready", text: "Ready to take reservations" }] }];

const PAYERS = {
  payers: [{
    key: "holding", legalName: "Example Holding Company", address: "1 Example Road", taxId: null, country: "US", currencies: ["USD"],
    invoiceTo: "invoices@example.test", invoiceCc: [], invoicing: true, routes: ["abroad", "nomad", "local_contractor"],
    authority: { kind: "none", date: null, routes: [], monthlyCeilingMinor: null, ceilingCurrency: null, filedWhere: null }, queueNote: null,
  }],
};
const SETTINGS = { hostCountry: { code: "XX", name: "Hostland" }, pilotAck: { text: "This is a pilot.", version: "v1" }, taxForms: [], taxFormRoutes: [], holds: [] };
const ATTEST = { workCountries: ["US"], daysInHostCountry: 0, statusUnchanged: true, servedAbroad: null, visitorEntryWork: false };

/** Who holds each key through a live seat. The admin holds none, which is the point. */
const HOLDERS: Record<string, string[]> = {
  "moon.approve": ["m-ops"],
  "cash.pay": ["m-fin", "m-treas"],
  "moon.approve_alone": ["m-steward"],
  "moon.approve_own": ["m-treas"],
};

describe.skipIf(!configured)("the review against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let whoami: string | null = null;
  let gateKeys: string[] | "all" = "all";
  let notices: Array<{ userId: string; title: string }> = [];
  const handlers = new Map<string, Handler>();
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

  const call = async (key: string, req: any = {}) => {
    const h = handlers.get(key);
    if (!h) throw new Error(`no handler for ${key}`);
    const out: { status: number; body: any } = { status: 200, body: undefined };
    const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
    await h({ params: {}, body: {}, query: {}, ...req }, res);
    return out;
  };
  const as = (who: string) => { whoami = who; };

  const MEMBERS = ["m-wren", "m-ops", "m-fin", "m-treas", "m-steward", "m-admin"];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    for (const id of MEMBERS) {
      await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`) VALUES (?,?,?,'x',?)", [id, id.slice(2), `${id}@example.test`, id.slice(2)]); // module-review-ok: fixture SQL
    }
    await q("INSERT INTO `org_roles` (`id`, `name`, `accountabilities`) VALUES ('r-water', 'Water keeper', ?)", [JSON.stringify(["Keep the water clean"])]); // module-review-ok: fixture SQL
    for (const id of ["m-wren", "m-treas", "m-steward"]) {
      await q( // module-review-ok: fixture SQL
        "INSERT INTO `seat_applications` (`id`, `candidate_user_id`, `proposed_by`, `seat_ids`, `settings_json`, `settings_hash`, `term_ends_at`, `status`) VALUES (?,?,?,?,?,?, '2027-06-01 00:00:00', 'adopted')",
        [`app-${id}`, id, id, JSON.stringify([`a-${id}`]), JSON.stringify({ v: 1, pay: { kind: "fixed", currency: "USD", amountMinor: 100000, per: "moon" } }), "0".repeat(64)],
      );
      await q( // module-review-ok: fixture SQL
        "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `started_at`, `application_id`) VALUES (?, 'r-water', 'member', ?, ?, '2026-09-01 12:00:00', ?)",
        [`a-${id}`, id, id, `app-${id}`],
      );
    }
    register({ get: (p: string, h: Handler) => handlers.set(`GET ${p}`, h), post: (p: string, h: Handler) => handlers.set(`POST ${p}`, h), put: (p: string, h: Handler) => handlers.set(`PUT ${p}`, h), patch: (p: string, h: Handler) => handlers.set(`PATCH ${p}`, h), use: () => undefined } as any, {
      authedUser: async () => (whoami ? { id: whoami } : null),
      getPool: () => pool,
      overLimit: async () => false,
      seasonState: () => ({ current: null, seasons: SEASONS, timezone: TZ }) as any,
      lapseContext: () => ({ currentSeasonId: null, cadence: "never" }) as any,
      members: { byId: async (id: string) => ({ id, name: id.slice(2) }), all: async () => MEMBERS.map((id) => ({ id, name: id.slice(2) })) } as any,
      notify: async (n: any) => { notices.push({ userId: n.userId, title: n.title, dedupeKey: n.dedupeKey } as any); return {} as any; },
      // The gate: passes everybody (an admin included), or only on the keys listed.
      mayAct: async (_req: any, key: string) => ({ ok: gateKeys === "all" || gateKeys.includes(key), reachedPast: false, villageHolds: true, source: "test", message: "No." }) as any,
      cashKeyHolders: async () => HOLDERS["cash.pay"],
      keyHolders: async (k: string) => HOLDERS[k] ?? [],
    });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    whoami = "m-wren";
    gateKeys = "all";
    notices = [];
    for (const t of ["moon_recap_items", "moon_invoices", "moon_recaps", "moon_review_events", "member_pay_routes", "cash_owed", "app_config", "moon_goals"]) {
      await q(`DELETE FROM \`${t}\``); // module-review-ok: fixture SQL
    }
  });

  const configure = async () => {
    await q("INSERT INTO `app_config` (`config_key`, `value`) VALUES ('payers', ?), ('moon-review-settings', ?)", [JSON.stringify(PAYERS), JSON.stringify(SETTINGS)]); // module-review-ok: fixture SQL
  };
  const route = async (userId: string, kind = "abroad", confirmedBy: string | null = "m-fin") => {
    await q( // module-review-ok: fixture SQL
      "INSERT INTO `member_pay_routes` (`user_id`, `route`, `payer_key`, `legal_name`, `address`, `tax_form_kind`, `invoice_seq`, `confirmed_at`, `confirmed_by`) VALUES (?, ?, 'holding', 'Wren Alder', '2 Example Lane', 'none', 0, IF(? IS NULL, NULL, UTC_TIMESTAMP()), ?)",
      [userId, kind, confirmedBy, confirmedBy],
    );
  };
  const sendRecap = async (who: string) => {
    as(who);
    expect((await call(`POST ${MOON_ROUTES.addItem}`, { params: { cycle: CYCLE }, body: { text: "Fixed the pump", roleId: "r-water", accountabilityWords: "Keep the water clean" } })).status).toBe(201);
    expect((await call(`POST ${MOON_ROUTES.sendRecap}`, { params: { cycle: CYCLE }, body: {} })).status).toBe(200);
  };
  const sendInvoice = (who: string, over: Record<string, unknown> = {}) => {
    as(who);
    return call(`POST ${MOON_ROUTES.sendInvoice}`, { params: { cycle: CYCLE }, body: { attestation: ATTEST, pilotAckVersion: "v1", memberNumber: "INV-7", ...over } });
  };
  const queueRow = async (memberId: string) => {
    const out = await call(`GET ${MOON_ROUTES.queue}`, { query: { cycle: CYCLE } });
    expect(out.status).toBe(200);
    return out.body.rows.find((r: any) => r.userId === memberId);
  };
  const approveWork = async (by: string, memberId: string) => {
    as(by);
    const row = await queueRow(memberId);
    return call(`POST ${MOON_ROUTES.work}`, { params: { recap: row.recapId }, body: { hash: row.hash, items: [] } });
  };
  const approveInvoices = async (by: string, memberIds: string[], extra: Array<{ id: string; hash: string; expectedOn: string }> = []) => {
    as(by);
    const list = [];
    for (const m of memberIds) {
      const row = await queueRow(m);
      list.push({ id: row.invoice.id, hash: row.hash, expectedOn: "2026-11-20" });
    }
    return call(`POST ${MOON_ROUTES.approveInvoices}`, { body: { invoices: [...list, ...extra] } });
  };

  it("send-invoice: refused with the contract's sentence while the payers and settings are empty, then on each missing piece", async () => {
    await sendRecap("m-wren");
    expect(await sendInvoice("m-wren")).toEqual({ status: 400, body: { error: SEND_REFUSALS.notConfigured } });
    await configure();
    expect(await sendInvoice("m-wren")).toEqual({ status: 400, body: { error: SEND_REFUSALS.pending } });
    await route("m-wren");
    expect(await sendInvoice("m-wren", { memberNumber: "" })).toEqual({ status: 400, body: { error: SEND_REFUSALS.numberMissing } });
    expect(await sendInvoice("m-wren", { pilotAckVersion: "v0" })).toEqual({ status: 400, body: { error: SEND_REFUSALS.pilotAck } });
    await q("UPDATE `member_pay_routes` SET `route` = 'local_contractor' WHERE `user_id` = 'm-wren'"); // module-review-ok: fixture SQL
    expect(await sendInvoice("m-wren")).toEqual({ status: 400, body: { error: SEND_REFUSALS.externalKey } });
    const sent = await sendInvoice("m-wren", { externalInvoiceKey: "50601012600" });
    expect(sent.status).toBe(200);
    expect(sent.body.invoice).toMatchObject({ status: "waiting", memberNumber: "INV-7", billRef: "holding-0001", externalInvoiceKey: "50601012600", totalMinor: 100000, currency: "USD" });
    expect((await sendInvoice("m-wren")).body).toEqual({ error: "already_sent" });
  });

  it("two people: the member never approves their own, an admin who holds no seat never passes, and Finance approves the invoice", async () => {
    await configure();
    await route("m-wren");
    await sendRecap("m-wren");
    expect((await sendInvoice("m-wren")).status).toBe(200);

    expect((await approveWork("m-wren", "m-wren")).body).toEqual({ error: APPROVAL_REFUSALS.own });
    expect((await approveWork("m-admin", "m-wren")).body).toEqual({ error: APPROVAL_REFUSALS.noKey });
    // cash.pay stands in for work only when no other moon.approve holder can: here one can.
    expect((await approveWork("m-fin", "m-wren")).body).toEqual({ error: APPROVAL_REFUSALS.noKey });
    const work = await approveWork("m-ops", "m-wren");
    expect(work.status).toBe(200);
    expect(work.body.recap).toMatchObject({ status: "waiting", waitingOn: "invoice" });

    // The work approver cannot also approve the invoice; the admin cannot either.
    const byOps = await approveInvoices("m-ops", ["m-wren"]);
    expect(byOps.body.refused[0].reason).toBe(APPROVAL_REFUSALS.noKey);
    const byAdmin = await approveInvoices("m-admin", ["m-wren"]);
    expect(byAdmin.body.refused[0].reason).toBe(APPROVAL_REFUSALS.noKey);

    const fin = await approveInvoices("m-fin", ["m-wren"], [{ id: "mv-0000000000000000", hash: "x", expectedOn: "2026-11-20" }]);
    expect(fin.status).toBe(200);
    expect(fin.body.approved).toHaveLength(1);
    expect(fin.body.refused).toEqual([{ id: "mv-0000000000000000", reason: APPROVAL_REFUSALS.notWaiting }]);

    // Exactly one claimed cash owed row per line, under the settlement's own key.
    const rows = await q("SELECT `id`, `occurrence_key`, `state`, `amount_minor`, `user_id` FROM `cash_owed`"); // module-review-ok: fixture SQL
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "claimed", amount_minor: 100000, user_id: "m-wren", occurrence_key: cashKeys.role(CYCLE, "a-m-wren", "m-wren") });
    const inv = (await q("SELECT `status`, `lines_json` FROM `moon_invoices`"))[0]; // module-review-ok: fixture SQL
    expect(inv.status).toBe("approved");
    const lines = typeof inv.lines_json === "string" ? JSON.parse(inv.lines_json) : inv.lines_json;
    expect(lines[0].cashOwedId).toBe(rows[0].id);
    expect(lines[0].approvedItemIds).toHaveLength(1);
    // A second approval writes nothing more.
    expect((await approveInvoices("m-fin", ["m-wren"])).body.refused).toHaveLength(1);
    expect(await q("SELECT `id` FROM `cash_owed`")).toHaveLength(1); // module-review-ok: fixture SQL

    // Paid through the existing transfers door: the invoice reads Paid and the member reads the contract's words.
    const transfer = await recordCashTransfer(pool, "m-fin", { userId: "m-wren", ids: [rows[0].id], transferDate: "2026-11-02", reference: "Bank ref 42" });
    expect(transfer.ok).toBe(true);
    expect(await settlePaidInvoices(pool, [rows[0].id], "2026-11-02", { notify: async (n: any) => { notices.push(n); } })).toHaveLength(1);
    expect((await q("SELECT `status`, `paid_on` FROM `moon_invoices`"))[0].status).toBe("paid"); // module-review-ok: fixture SQL
    expect(notices.some((n) => n.userId === "m-wren" && n.title === NOTICE_WORDS.paid("2026-11-02"))).toBe(true);
  });

  it("a key another cash owed row already holds refuses the approval, naming that row, and writes nothing", async () => {
    await configure();
    await route("m-wren");
    await sendRecap("m-wren");
    expect((await sendInvoice("m-wren")).status).toBe(200);
    expect((await approveWork("m-ops", "m-wren")).status).toBe(200);
    await q( // module-review-ok: fixture SQL
      "INSERT INTO `cash_owed` (`id`, `occurrence_key`, `user_id`, `work_kind`, `work_ref`, `work_title`, `amount_minor`, `currency`) VALUES ('cash-settled', ?, 'm-wren', 'role', 'r-water', 'Settled', 5000, 'USD')",
      [cashKeys.role(CYCLE, "a-m-wren", "m-wren")],
    );
    const out = await approveInvoices("m-fin", ["m-wren"]);
    expect(out.body.refused[0].reason).toBe(rowExistsRefusal("cash-settled"));
    expect((await q("SELECT `status` FROM `moon_invoices`"))[0].status).toBe("waiting"); // module-review-ok: fixture SQL
    expect(await q("SELECT `id` FROM `cash_owed`")).toHaveLength(1); // module-review-ok: fixture SQL
  });

  it("alone: moon.approve_alone gives both approvals by itself, and never on its own recap", async () => {
    await configure();
    await route("m-wren");
    await route("m-steward");
    await sendRecap("m-wren");
    expect((await sendInvoice("m-wren")).status).toBe(200);
    expect((await approveWork("m-steward", "m-wren")).status).toBe(200);
    expect((await approveInvoices("m-steward", ["m-wren"])).body.approved).toHaveLength(1);

    await sendRecap("m-steward");
    expect((await approveWork("m-steward", "m-steward")).body).toEqual({ error: APPROVAL_REFUSALS.own });
  });

  it("own: moon.approve_own approves the holder's own recap and invoice, marked self-approved, and the reviewers are told", async () => {
    await configure();
    await route("m-treas");
    await sendRecap("m-treas");
    expect((await sendInvoice("m-treas")).status).toBe(200);
    expect((await approveWork("m-treas", "m-treas")).status).toBe(200);
    expect((await approveInvoices("m-treas", ["m-treas"])).body.approved).toHaveLength(1);
    const inv = (await q("SELECT `self_approved` FROM `moon_invoices`"))[0]; // module-review-ok: fixture SQL
    expect(Number(inv.self_approved)).toBe(1);
    const kinds = (await q("SELECT `kind` FROM `moon_review_events` WHERE `self_approved` = 1 ORDER BY `id`")).map((e: any) => e.kind); // module-review-ok: fixture SQL
    expect(kinds).toEqual(expect.arrayContaining(["work_approved", "self_approved", "invoice_approved"]));
    expect(notices.some((n) => n.userId === "m-steward" && n.title === NOTICE_WORDS.selfApprovedForReview("treas"))).toBe(true);
  });

  it("bulk: one invoice that fails a check stays out with its sentence while the other passes", async () => {
    await configure();
    await route("m-wren");
    await route("m-steward", "abroad", null); // not confirmed
    await sendRecap("m-wren");
    expect((await sendInvoice("m-wren")).status).toBe(200);
    await sendRecap("m-steward");
    expect((await sendInvoice("m-steward", { memberNumber: "S-1" })).status).toBe(200);
    expect((await approveWork("m-ops", "m-wren")).status).toBe(200);
    expect((await approveWork("m-ops", "m-steward")).status).toBe(200);
    const out = await approveInvoices("m-fin", ["m-wren", "m-steward"]);
    expect(out.body.approved).toHaveLength(1);
    expect(out.body.refused).toEqual([{ id: expect.any(String), reason: "The pay route is not confirmed yet. Another person holding the cash power confirms it." }]);
  });

  it("a member's own route is never theirs to confirm, and an admin with no seat cannot", async () => {
    await route("m-fin", "abroad", null);
    await route("m-wren", "abroad", null);
    as("m-fin");
    expect((await call(`PUT ${MOON_ROUTES.confirmRoute}`, { params: { user: "m-fin" } })).status).toBe(409);
    as("m-admin");
    expect((await call(`PUT ${MOON_ROUTES.confirmRoute}`, { params: { user: "m-wren" } })).body).toEqual({ error: APPROVAL_REFUSALS.noKey });
    as("m-fin");
    expect((await call(`PUT ${MOON_ROUTES.confirmRoute}`, { params: { user: "m-wren" } })).status).toBe(200);
  });

  it("privacy: the moon.approve queue carries no reading and no invoice; the cash.pay queue carries the amounts", async () => {
    await configure();
    await route("m-wren");
    await sendRecap("m-wren");
    expect((await sendInvoice("m-wren")).status).toBe(200);
    as("m-ops");
    gateKeys = ["moon.approve"];
    const ops = await queueRow("m-wren");
    expect(ops.invoice).toBeNull();
    expect(JSON.stringify(ops)).not.toContain("100000");
    expect(ops).not.toHaveProperty("taskReading");
    expect(ops).not.toHaveProperty("seatReading");
    expect(ops).not.toHaveProperty("score");
    expect(ops.items.map((i: any) => i.text)).toEqual(["Fixed the pump"]);
    gateKeys = ["cash.pay"];
    const fin = await queueRow("m-wren");
    expect(fin.invoice).toMatchObject({ totalMinor: 100000, routeCheck: null, hash: fin.hash });
    gateKeys = [];
    expect((await call(`GET ${MOON_ROUTES.queue}`, { query: { cycle: CYCLE } })).status).toBe(403);
  });

  it("decision 2: the people approving pay never read the member's band or score; the member still does, and the score, the hash, the invoice and both approvals are unchanged", async () => {
    // Break-the-fix control: put `taskReading: readingOf(...)` back on the row in
    // reviewQueue (server/lib/moonReview.ts) and the key and band checks below fail.
    await configure();
    await route("m-wren");
    as("m-wren");
    expect((await call(`POST ${MOON_ROUTES.addItem}`, { params: { cycle: CYCLE }, body: { text: "Fixed the pump", roleId: "r-water", accountabilityWords: "Keep the water clean" } })).status).toBe(201);
    const mine0 = await call(`GET ${MOON_ROUTES.myMoon}`, { query: { cycle: CYCLE } });
    const itemId = mine0.body.items[0].id;
    expect((await call(`PATCH ${MOON_ROUTES.editItem}`, { params: { id: itemId }, body: { taskStatus: "carry" } })).status).toBe(200);
    await q("UPDATE `moon_recap_items` SET `set_on` = NULL WHERE `id` = ?", [itemId]); // module-review-ok: fixture SQL, an item made in this recap
    expect((await call(`POST ${MOON_ROUTES.sendRecap}`, { params: { cycle: CYCLE }, body: {} })).status).toBe(200);
    expect((await sendInvoice("m-wren")).status).toBe(200);

    // The member's own reading is still there, and the arithmetic is the shared one.
    as("m-wren");
    const mine = (await call(`GET ${MOON_ROUTES.myMoon}`, { query: { cycle: CYCLE } })).body;
    const recap = (await q("SELECT `id` FROM `moon_recaps` WHERE `user_id` = 'm-wren'"))[0]; // module-review-ok: fixture SQL
    const items = await itemsOf(pool, recap.id);
    const expected = taskScore(items, MOON.days);
    expect(mine.taskScore).toEqual(expected);
    expect(expected).toMatchObject({ numHalves: 0, den: 1, pct: 0, carry: 1 });
    expect(mine.taskReading).toEqual(readingOf(expected, scoreContextOf(expected, 0)));
    expect(mine.taskReading.label).toBe(TASK_BANDS.find((b) => b.key === "rethink")!.label);
    expect(mine.seatReading).not.toBeNull();
    const band = mine.taskReading.label as string;
    const seatBand = mine.seatReading.label as string;

    // Neither approver view carries it: the keys are exactly the contract's, and no band words.
    for (const keys of [["moon.approve"], ["cash.pay"]]) {
      as(keys[0] === "cash.pay" ? "m-fin" : "m-ops");
      gateKeys = keys;
      const row = await queueRow("m-wren");
      expect(Object.keys(row).sort()).toEqual([...QUEUE_ROW_KEYS].sort());
      const text = JSON.stringify(row);
      expect(text).not.toContain(band);
      expect(text).not.toContain(seatBand);
      expect(text).not.toContain(mine.taskReading.says);
      // The hash is the approval subject's, as before.
      expect(row.hash).toBe(await currentHash(pool, (await recapById(pool, recap.id))!));
    }
    // The invoice the payer reads is the member's own invoice, amount for amount.
    const fin = await queueRow("m-wren");
    expect(fin.invoice).toMatchObject({ id: mine.invoice.id, totalMinor: mine.invoice.totalMinor, currency: mine.invoice.currency, lines: mine.invoice.lines });
    expect(fin.invoice.totalMinor).toBe(100000);

    // Both approvals go through with the row's hash, and the pay owed is the terms' amount.
    gateKeys = "all";
    expect((await approveWork("m-ops", "m-wren")).status).toBe(200);
    const paid = await approveInvoices("m-fin", ["m-wren"]);
    expect(paid.body.approved).toHaveLength(1);
    const owed = await q("SELECT `amount_minor`, `user_id`, `state` FROM `cash_owed`"); // module-review-ok: fixture SQL
    expect(owed).toEqual([{ amount_minor: 100000, user_id: "m-wren", state: "claimed" }]);
  });

  it("the room panel answers only a member joined to the room, holds back a Speak only holder, and carries no amount, score or count", async () => {
    await configure();
    await route("m-wren");
    await sendRecap("m-wren");
    expect((await sendInvoice("m-wren")).status).toBe(200);
    await q("INSERT INTO `live_session_members` (`user_id`, `created_at`) VALUES ('m-wren', UTC_TIMESTAMP()), ('m-ops', UTC_TIMESTAMP())"); // module-review-ok: fixture SQL
    const nos = await q("SELECT `no`, `user_id` FROM `live_session_members`"); // module-review-ok: fixture SQL
    const no = (u: string) => Number(nos.find((r: any) => r.user_id === u).no);
    await q("INSERT INTO `live_sessions` (`id`, `title`, `facilitator_no`, `created_by_no`, `duration_min`, `state`, `stamp`) VALUES (901, 'End of moon', ?, ?, 60, '{}', '{}')", [no("m-ops"), no("m-ops")]); // module-review-ok: fixture SQL
    await q("INSERT INTO `live_session_people` (`session_id`, `member_no`, `joined_at`, `last_seen_at`) VALUES (901, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())", [no("m-ops")]); // module-review-ok: fixture SQL
    await q("INSERT INTO `live_session_template_uses` (`session_id`, `template_id`, `stick`) VALUES (901, 1, ?)", [JSON.stringify({ order: [no("m-wren")], at: 0, rounds: 0 })]); // module-review-ok: fixture SQL

    as("m-wren"); // holds the stick, never joined
    expect((await call(`GET ${MOON_ROUTES.room}`, { params: { sessionId: "901" }, query: { cycle: CYCLE } })).status).toBe(404);
    as("m-ops");
    // Speak only, the default: the stick shows nobody, so nothing of the holder's reaches the room.
    const quiet = await call(`GET ${MOON_ROUTES.room}`, { params: { sessionId: "901" }, query: { cycle: CYCLE } });
    expect(quiet.status).toBe(200);
    expect(quiet.body.holder).toEqual({ userId: "m-wren", name: "wren" });
    expect(quiet.body.recap).toBeNull();
    expect(quiet.body.goals).toBeNull();
    // Show my moon: the stick's `shows` names the holder.
    await q("UPDATE `live_session_template_uses` SET `stick` = ? WHERE `session_id` = 901", [JSON.stringify({ order: [no("m-wren")], at: 0, rounds: 0, shows: [no("m-wren")] })]); // module-review-ok: fixture SQL
    const out = await call(`GET ${MOON_ROUTES.room}`, { params: { sessionId: "901" }, query: { cycle: CYCLE } });
    expect(out.status).toBe(200);
    expect(out.body.recap.roles[0].items).toEqual([{ text: "Fixed the pump", evidenceUrl: null }]);
    const text = JSON.stringify(out.body);
    // A4: no room panel shows anyone's numbers, not even a count of private items or of season goals.
    for (const k of ["amount", "Minor", "total", "currency", "invoice\":", "\"score\"", "heldPrivately", "\"count\"", "pct"]) expect(text).not.toContain(k);
    expect(Object.keys(out.body).sort()).toEqual(["goals", "holder", "mine", "moon", "ready", "recap", "sentCount"]);
  });

  it("thanks: saved with the recap, each thanked member told once however often it is sent", async () => {
    as("m-wren");
    expect((await call(`POST ${MOON_ROUTES.addItem}`, { params: { cycle: CYCLE }, body: { text: "Fixed the pump", roleId: "r-water" } })).status).toBe(201);
    const thanks = [{ userId: "m-ops", note: "Lent the wrench", visibility: "members" }, { name: "A neighbour" }];
    expect((await call(`POST ${MOON_ROUTES.sendRecap}`, { params: { cycle: CYCLE }, body: { thanks } })).status).toBe(200);
    expect((await call(`POST ${MOON_ROUTES.takeBack}`, { params: { cycle: CYCLE } })).status).toBe(200);
    expect((await call(`POST ${MOON_ROUTES.sendRecap}`, { params: { cycle: CYCLE }, body: { thanks } })).status).toBe(200);
    const mine = await call(`GET ${MOON_ROUTES.myMoon}`, { query: { cycle: CYCLE } });
    expect(mine.body.thanks).toEqual([{ userId: "m-ops", name: null, note: "Lent the wrench", visibility: "members" }, { userId: null, name: "A neighbour", note: null, visibility: "approvers" }]);
    expect(mine.body.guideUrl).toBeNull();
    // Two sends, one key: the notification spine's unique dedupe key makes the second a no-op.
    const keys = notices.filter((n) => n.userId === "m-ops").map((n: any) => n.dedupeKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it("goals: three to five for the next moon, a carried one counted once more, and a let go needs its reason", async () => {
    as("m-wren");
    const NEXT = LUNAR_CLOCK.boundsFor(new Date(MOON.bounds.endsAt.getTime() + 1000)).id;
    await q("INSERT INTO `moon_goals` (`id`, `user_id`, `cycle_id`, `position`, `text`, `status`, `carry_count`) VALUES ('mg-last', 'm-wren', ?, 0, 'Map the springs', 'open', 1)", [CYCLE]); // module-review-ok: fixture SQL
    expect((await call(`PUT ${MOON_ROUTES.nextGoals}`, { params: { cycle: CYCLE }, body: { goals: [{ text: "One" }, { text: "Two" }] } })).status).toBe(400);
    const put = await call(`PUT ${MOON_ROUTES.nextGoals}`, { params: { cycle: CYCLE }, body: { goals: [{ text: "Map the springs", carriedFromId: "mg-last" }, { text: "Two" }, { text: "Three" }] } });
    expect(put.status).toBe(200);
    expect(put.body.goals.map((g: any) => [g.text, g.carryCount, g.flagged])).toEqual([["Map the springs", 2, true], ["Two", 0, false], ["Three", 0, false]]);
    expect((await call(`GET ${MOON_ROUTES.nextGoals}`, { params: { cycle: CYCLE } })).body.goals).toHaveLength(3);
    expect(await q("SELECT `id` FROM `moon_goals` WHERE `cycle_id` = ?", [NEXT])).toHaveLength(3); // module-review-ok: fixture SQL
    expect((await call(`PATCH ${MOON_ROUTES.scoreGoal}`, { params: { id: "mg-last" }, body: { status: "let_go" } })).status).toBe(400);
    expect((await call(`PATCH ${MOON_ROUTES.scoreGoal}`, { params: { id: "mg-last" }, body: { status: "partly" } })).body.goal.status).toBe("partly");
    as("m-ops");
    expect((await call(`PATCH ${MOON_ROUTES.scoreGoal}`, { params: { id: "mg-last" }, body: { status: "done" } })).status).toBe(404);
  });

  const PACK = (over: Record<string, unknown> = {}) => ({
    kind: "moon_pack",
    version: 1,
    moon: packMoonDates(MOON.bounds, TZ),
    items: [
      { text: "Wrote the water report", status: "done", evidence: { kind: "mail", ref: "https://mail.example.test/1", on: "2026-10-15" }, seat: "Water keeper" },
      { text: "Something for another moon", status: "done", evidence: { kind: "drive", ref: "doc-1", on: "2026-09-01" }, seat: "r-water" },
    ],
    ...over,
  });

  it("import: preview writes nothing, confirm writes once, a second import adds nothing, and a pack with an amount is refused whole", async () => {
    const preview = await call(`POST ${MOON_ROUTES.importPack}`, { params: { cycle: CYCLE }, body: { pack: PACK() } });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ written: false, preview: { add: [expect.any(Object)], skip: [{ index: 1, reason: "outside_moon" }] } });
    expect(await q("SELECT `id` FROM `moon_recap_items`")).toHaveLength(0); // module-review-ok: fixture SQL

    expect((await call(`POST ${MOON_ROUTES.importPack}`, { params: { cycle: CYCLE }, body: { pack: PACK(), confirm: true, previewHash: "nope" } })).status).toBe(409);
    const first = await call(`POST ${MOON_ROUTES.importPack}`, { params: { cycle: CYCLE }, body: { pack: PACK(), confirm: true, previewHash: preview.body.previewHash } });
    expect(first.body).toMatchObject({ written: true, added: 1 });
    expect(first.body.items[0]).toMatchObject({ origin: "claude", state: "kept", visibility: "approvers", review: "pending", taskStatus: "done", evidenceKind: "mail" });

    const again = await call(`POST ${MOON_ROUTES.importPack}`, { params: { cycle: CYCLE }, body: { pack: PACK() } });
    const second = await call(`POST ${MOON_ROUTES.importPack}`, { params: { cycle: CYCLE }, body: { pack: PACK(), confirm: true, previewHash: again.body.previewHash } });
    expect(second.body).toMatchObject({ written: true, added: 0 });
    expect(await q("SELECT `id` FROM `moon_recap_items`")).toHaveLength(1); // module-review-ok: fixture SQL
    expect((await q("SELECT `kind` FROM `moon_review_events`")).map((e: any) => e.kind)).toEqual(["imported", "imported"]); // module-review-ok: fixture SQL

    const money = await call(`POST ${MOON_ROUTES.importPack}`, { params: { cycle: CYCLE }, body: { pack: PACK({ items: [{ text: "Paid", amountMinor: 5 }] }) } });
    expect(money).toEqual({ status: 400, body: { error: PACK_REFUSAL_WORDS.forbidden_key } });

    // An imported item shows to other members only as held privately, and its mail link never.
    expect((await call(`POST ${MOON_ROUTES.sendRecap}`, { params: { cycle: CYCLE }, body: {} })).status).toBe(200);
    as("m-ops");
    const seen = await call(`GET ${MOON_ROUTES.memberMoon}`, { params: { handle: "wren" }, query: { cycle: CYCLE } });
    expect(seen.body.roles).toEqual([{ roleId: "r-water", name: "Water keeper", items: [], heldPrivately: 1 }]);

    // Import is refused once the recap has left Draft.
    as("m-wren");
    expect((await call(`POST ${MOON_ROUTES.importPack}`, { params: { cycle: CYCLE }, body: { pack: PACK() } })).body).toEqual({ error: "not_editable" });
  });
});

describe("the room's Speak only rule, read from the stick", () => {
  it("shows a member only when the stick names them, and reads a stick without `shows` as Speak only", async () => {
    const { stickShows } = await import("./moonReview");
    expect([...stickShows(JSON.stringify({ order: [4, 7], at: 0, shows: [7] }))]).toEqual([7]);
    expect(stickShows(JSON.stringify({ order: [4], at: 0 })).size).toBe(0);
    expect(stickShows({ shows: ["5", 0, -1, "x"] })).toEqual(new Set([5]));
    expect(stickShows("not json").size).toBe(0);
    expect(stickShows(null).size).toBe(0);
  });
});
