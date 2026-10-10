/**
 * WHAT THE POST OFFICE ASKS BEFORE EVERY EMAIL, and what "stop" does
 * (the comms build spec 5.3).
 *
 * Real rows, because every claim here is about rows: which answer is on
 * record, which journeys stopped, what landed in a member's prefs. The
 * suppressions module belongs to the post office lane and arrives at merge,
 * so it is a fake here, in memory, and the assertions about suppressing are
 * assertions about what this lane ASKED that module to do. The flows that
 * read a suppression back (start again) use the running server's port, which
 * writes real rows the way the real module does.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../../db/testDb";
import { usersRepo } from "../../repos/users";
import { ensureContact } from "./contacts";
import { enroll } from "./journeys";
import {
  answerFor,
  permissionFor,
  setPause,
  setPermission,
  startAgain,
  stopEverything,
  suppressionsPortFor,
  unsubscribe,
  type PeopleDeps,
  type SuppressionsPort,
} from "./permissions";
import { applyPreferencesChange, type PreferencesDeps } from "./preferences";
import { contactById } from "../../repos/commsContacts";

const configured = testDbConfigured();
const DAY = 86_400_000;

let db: TestDb;
let pool: mysql.Pool;

/** The post office lane's suppressions module, as a minimal fake that records what it was asked. */
function memorySuppressions() {
  const held = new Map<string, string>();
  const asked: string[] = [];
  const port: SuppressionsPort = {
    async isSuppressed(emailKey) {
      return held.has(emailKey);
    },
    async addSuppression(emailKey, reason) {
      asked.push(`add ${emailKey} ${reason}`);
      if (!held.has(emailKey)) held.set(emailKey, reason);
    },
    async removeSuppression(emailKey, opts) {
      asked.push(`remove ${emailKey}`);
      // The real module's rule (server/lib/comms/suppressions.ts): a complaint
      // lifts only with a reason, and otherwise is refused and stays.
      if (held.get(emailKey) === "complained" && !String(opts?.reason ?? "").trim()) {
        return { removed: false, refused: "A complaint lifts only with a reason." };
      }
      return { removed: held.delete(emailKey) };
    },
    async listSuppressions(opts) {
      return Array.from(held.entries())
        .filter(([k]) => !opts.emailKey || k === opts.emailKey)
        .map(([emailKey, reason]) => ({ emailKey, reason }));
    },
  };
  return { port, held, asked };
}

let sup = memorySuppressions();
let clock = Date.UTC(2026, 9, 2, 12, 0, 0);
let refusal: string | null = null;

function deps(over: Partial<PeopleDeps> = {}): PreferencesDeps {
  return {
    getPool: () => pool,
    members: usersRepo(pool),
    suppressions: sup.port,
    now: () => clock,
    mailRefusal: async () => refusal,
    projectName: () => "Test Village",
    letters: { post: async () => ({ status: "sent", messageId: "msg_fake" }), origin: () => "https://village.example.test", projectName: () => "Test Village" },
    ...over,
  };
}

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

let n = 0;
/** A member with an account, and their contact. */
async function member(opts: { paths?: string[]; emailsOff?: boolean } = {}): Promise<{ userId: string; contactId: string; email: string }> {
  n += 1;
  const userId = `perm-member-${n}`;
  const email = `${userId}@example.test`;
  await usersRepo(pool).add({
    id: userId,
    name: `Member ${n}`,
    email,
    passwordHash: "x",
    paths: opts.paths ?? [],
    prefs: opts.emailsOff ? { notify: { emailsOff: true } } : {},
  });
  const contact = await ensureContact({ getPool: () => pool }, { email, userId, source: "account" });
  return { userId, contactId: contact!.id, email };
}

/** Somebody with no account, met through a form. */
async function stranger(): Promise<{ contactId: string; email: string }> {
  n += 1;
  const email = `perm-guest-${n}@example.test`;
  const contact = await ensureContact({ getPool: () => pool }, { email, source: "resident" });
  return { contactId: contact!.id, email };
}

const allowed = async (email: string, kind: Parameters<typeof permissionFor>[2], contactId?: string) =>
  (await permissionFor(deps(), email, kind, contactId ?? null)).allowed;

describe.skipIf(!configured)("permissionFor and stopping", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
  });
  beforeEach(() => {
    sup = memorySuppressions();
    clock = Date.UTC(2026, 9, 2, 12, 0, 0);
    refusal = null;
  });

  it("sends essential mail to anybody, even a suppressed address, and nothing else to a suppressed one", async () => {
    const g = await stranger();
    sup.held.set(g.email, "bounced");
    expect(await allowed(g.email, "essential")).toBe(true);
    const verdict = await permissionFor(deps(), g.email, "events", g.contactId);
    expect(verdict).toMatchObject({ allowed: false, reason: "suppressed" });
  });

  it("lets a gathering's own emails follow from the yes, and stops them at a no", async () => {
    const g = await stranger();
    expect(await allowed(g.email, "events", g.contactId)).toBe(true);
    expect((await unsubscribe(deps(), { contactId: g.contactId, kind: "events", basis: "asked", source: "unsubscribe" })).ok).toBe(true);
    expect(await permissionFor(deps(), g.email, "events", g.contactId)).toMatchObject({ allowed: false, reason: "no_permission" });
  });

  it("asks a member who chose a path nothing more, and writes path emails to nobody else without a yes", async () => {
    const withPath = await member({ paths: ["resident"] });
    const withoutPath = await member();
    const g = await stranger();
    expect(await allowed(withPath.email, "paths", withPath.contactId)).toBe(true);
    // Joining is choosing the member's path: its welcome sends as paths (2026-10-09).
    expect(await allowed(withoutPath.email, "paths", withoutPath.contactId)).toBe(true);
    expect(await allowed(g.email, "paths", g.contactId)).toBe(false);

    await setPermission(deps(), { contactId: g.contactId, kind: "paths", state: "yes", basis: "asked", source: "resident", evidence: { words: "Walk me through it" } });
    expect(await allowed(g.email, "paths", g.contactId)).toBe(true);
    const stored = await q("SELECT basis, source, evidence FROM comms_permissions WHERE contact_id = ? AND kind = 'paths'", [g.contactId]);
    expect(stored[0]).toMatchObject({ basis: "asked", source: "resident" });
    expect(JSON.stringify(stored[0].evidence)).toContain("Walk me through it");
  });

  it("sends letters only on an explicit yes", async () => {
    const m = await member({ paths: ["steward"] });
    const g = await stranger();
    expect(await allowed(m.email, "letters", m.contactId)).toBe(false);
    expect(await allowed(g.email, "letters", g.contactId)).toBe(false);
    await setPermission(deps(), { contactId: m.contactId, kind: "letters", state: "yes", basis: "account", source: "profile" });
    expect(await allowed(m.email, "letters", m.contactId)).toBe(true);
  });

  it("lets the spine's notices through to a member whatever their switch says, and refuses one to somebody with no account", async () => {
    // The spine (server/lib/notify.ts) applied `emailsOff` already, type by
    // type, and pins the steward window notices above it. A second check here
    // would drop exactly those.
    const quiet = await member({ emailsOff: true });
    const g = await stranger();
    expect(await allowed(quiet.email, "notices", quiet.contactId)).toBe(true);
    expect(await permissionFor(deps(), g.email, "notices", g.contactId)).toMatchObject({ allowed: false, reason: "no_permission" });
  });

  it("holds what was agreed while paused, and lets it go again when the pause lapses, with nothing written", async () => {
    const g = await stranger();
    await setPermission(deps(), { contactId: g.contactId, kind: "letters", state: "yes", basis: "asked", source: "letters_confirm" });
    expect((await setPause(deps(), { contactId: g.contactId, until: new Date(clock + 30 * DAY) })).ok).toBe(true);

    expect(await allowed(g.email, "letters", g.contactId)).toBe(false);
    expect(await allowed(g.email, "events", g.contactId)).toBe(false);
    // The answer itself is untouched: still a yes, held.
    const contact = (await contactById(pool, g.contactId))!;
    expect(await answerFor(deps(), contact, "letters")).toMatchObject({ state: "yes", derived: false });
    // A kind never answered still reads as never answered while it is held.
    expect(await answerFor(deps(), contact, "paths")).toMatchObject({ state: "no", derived: true });

    const before = await q("SELECT kind, state, evidence FROM comms_permissions WHERE contact_id = ? ORDER BY kind", [g.contactId]);
    clock += 31 * DAY;
    expect(await allowed(g.email, "letters", g.contactId)).toBe(true);
    expect(await allowed(g.email, "events", g.contactId)).toBe(true);
    expect(await allowed(g.email, "paths", g.contactId)).toBe(false);
    expect(await q("SELECT kind, state, evidence FROM comms_permissions WHERE contact_id = ? ORDER BY kind", [g.contactId])).toEqual(before);
  });

  it("stops everything: suppresses the address and stops every journey the person is on", async () => {
    const g = await stranger();
    const going = await enroll({ getPool: () => pool }, { journeyKey: "gathering.going", contactId: g.contactId, subjectRef: "event:ev-stop:2026-10-09" });
    const path = await enroll({ getPool: () => pool }, { journeyKey: "path.resident", contactId: g.contactId, subjectRef: "path:resident" });

    const result = await stopEverything(deps(), { contactId: g.contactId });
    expect(result).toMatchObject({ ok: true, stopped: 2 });
    expect(sup.asked).toEqual([`add ${g.email} unsubscribed_all`]);
    const rows = await q("SELECT id, state, stop_reason FROM comms_enrollments WHERE contact_id = ? ORDER BY id", [g.contactId]);
    expect(rows.map((r) => [r.id, r.state, r.stop_reason]).sort()).toEqual(
      [
        [going.enrollmentId, "stopped", "suppressed"],
        [path.enrollmentId, "stopped", "suppressed"],
      ].sort(),
    );
  });

  it("stops only the journeys of the kind somebody said no to", async () => {
    const g = await stranger();
    const going = await enroll({ getPool: () => pool }, { journeyKey: "gathering.going", contactId: g.contactId, subjectRef: "event:ev-kind:2026-10-09" });
    const path = await enroll({ getPool: () => pool }, { journeyKey: "path.resident", contactId: g.contactId, subjectRef: "path:resident" });
    expect(await unsubscribe(deps(), { contactId: g.contactId, kind: "paths", basis: "asked", source: "unsubscribe" })).toMatchObject({ ok: true, stopped: 1 });
    const state = async (id: string) => (await q("SELECT state, stop_reason FROM comms_enrollments WHERE id = ?", [id]))[0];
    expect(await state(path.enrollmentId)).toEqual({ state: "stopped", stop_reason: "unsubscribed" });
    expect(await state(going.enrollmentId)).toEqual({ state: "active", stop_reason: null });
  });

  it("writes a member's notices switch to users.prefs, and refuses to quiet a seated steward", async () => {
    const m = await member({ paths: ["resident"] });
    const off = await applyPreferencesChange(deps(), m.contactId, { type: "kind", kind: "notices", on: false }, "link");
    expect(off.ok).toBe(true);
    expect((await usersRepo(pool).byId(m.userId))!.prefs.notify.emailsOff).toBe(true);
    if (off.ok) expect(off.view.kinds.find((k) => k.kind === "notices")).toMatchObject({ on: false });

    const on = await applyPreferencesChange(deps(), m.contactId, { type: "kind", kind: "notices", on: true }, "account");
    expect(on.ok).toBe(true);
    expect((await usersRepo(pool).byId(m.userId))!.prefs.notify.emailsOff).toBe(false);

    refusal = "Governance mail stays on while you hold that seat.";
    const refused = await applyPreferencesChange(deps(), m.contactId, { type: "kind", kind: "notices", on: false }, "link");
    expect(refused).toEqual({ ok: false, status: 409, error: refusal });
    expect((await usersRepo(pool).byId(m.userId))!.prefs.notify.emailsOff).toBe(false);
  });

  it("refuses stop everything whole for a seated steward: nothing suppressed, nothing stopped", async () => {
    const m = await member({ paths: ["steward"] });
    const going = await enroll({ getPool: () => pool }, { journeyKey: "gathering.going", contactId: m.contactId, subjectRef: "event:ev-steward:" });
    refusal = "Governance mail stays on while you hold that seat.";
    expect(await stopEverything(deps(), { contactId: m.contactId })).toEqual({ ok: false, status: 409, error: refusal });
    expect(sup.asked).toEqual([]);
    expect((await q("SELECT state FROM comms_enrollments WHERE id = ?", [going.enrollmentId]))[0].state).toBe("active");
  });

  it("starts again only after a stop the person made, never after a bounce", async () => {
    const real = suppressionsPortFor(() => pool);
    const g = await stranger();
    expect((await stopEverything(deps({ suppressions: real }), { contactId: g.contactId })).ok).toBe(true);
    expect(await real.isSuppressed(g.email)).toBe(true);
    expect((await startAgain(deps({ suppressions: real }), { contactId: g.contactId })).ok).toBe(true);
    expect(await real.isSuppressed(g.email)).toBe(false);

    const bounced = await stranger();
    await real.addSuppression(bounced.email, "bounced");
    expect(await startAgain(deps({ suppressions: real }), { contactId: bounced.contactId })).toMatchObject({ ok: false, status: 409 });
    expect(await real.isSuppressed(bounced.email)).toBe(true);
  });
});
