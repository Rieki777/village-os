import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { formSubmittedTrigger } from "../../../shared/comms/contracts";
import { pathJourney } from "../../../shared/comms/defaults/journeys";
import { DEFAULT_CONSENT_TEXT } from "../../../shared/comms/settings";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import { contactByEmailKey } from "../../repos/commsContacts";
import { joinPathRow, pathEnrollmentOf } from "../../repos/pathEnrollments";
import { usersRepo } from "../../repos/users";
import { createReservation } from "../housing";
import type { NotifyInput } from "../notify";
import { answerConditions, type ConditionContext } from "./conditions";
import { setJourneyState } from "./journeyDefinitions";
import { handOff, registerPathJourneyParts, runPathRungs, type PathPartsDeps } from "./pathParts";
import { backfillPathEnrollments, handlePathTrigger, includeExistingOnPath, setPathJourneyOptions, type PathDeps } from "./paths";
import type { CommsMode, PostOfficeDeps } from "./postOffice";
import { loadEmailVillage } from "./render";
import { writeCommsSettings } from "./settings";
import type { Transport, TransportMessage } from "./transport";

/**
 * The paths lane against a provisioned schema (the comms build spec 5.11):
 * the triggers a public form, a profile, a housing request, a decision on a
 * submission and an admission fire, handed to the handler the dispatcher
 * calls; the path rules the tick asks; the backfill; the day 21 hand-off; and
 * the rung emails, through a post office whose provider records what it is
 * handed.
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;
const ORIGIN = "https://village.example.test";
const LIVE: CommsMode = { lifecycle: "members", paused: false, rehearsalTo: [] };

const sent: TransportMessage[] = [];
const transport: Transport = {
  name: "resend",
  async send(m) {
    sent.push(m);
    return { ok: true, providerId: `prov_${sent.length}` };
  },
};

const office = (): PostOfficeDeps => ({
  getPool: () => pool,
  transport,
  sender: () => "Test Village <hello@village.example.test>",
  hasApiKey: () => true,
  origin: () => ORIGIN,
  mode: async () => LIVE,
  dial: (k) => (k === "comms.send_rate_per_second" ? 50 : k === "comms.daily_cap" ? 5 : 120),
});

const notices: NotifyInput[] = [];
const inboxes: Record<string, unknown> = { steward: "stewards@village.example.test" };
const parts = (): PathPartsDeps => ({
  getPool: () => pool,
  postOffice: office(),
  members: usersRepo(pool),
  notify: async (input) => {
    notices.push(input);
    return { inserted: true } as any;
  },
  emailConfig: () => inboxes,
  commsLifecycle: () => "members",
  eventsLifecycle: () => "members",
  timezone: () => "UTC",
});
const deps = (): PathDeps => ({ getPool: () => pool, members: usersRepo(pool) });

async function rows(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [r] = await pool.query<RowDataPacket[]>(sql, params); // module-review-ok: reading back the scratch schema this suite provisioned
  return r;
}

const enrollmentOf = async (email: string, journeyKey: string) =>
  (
    await rows(
      "SELECT e.id, e.state, e.stop_reason, e.subject_ref FROM comms_enrollments e JOIN comms_contacts c ON c.id = e.contact_id " +
        "WHERE c.email_key = ? AND e.journey_key = ?",
      [email.toLowerCase(), journeyKey],
    )
  )[0] ?? null;

let n = 0;
async function member(name: string, paths: string[] = []): Promise<{ id: string; email: string }> {
  n += 1;
  const id = `paths-member-${n}`;
  const email = `${id}@example.test`;
  await usersRepo(pool).add({ id, name, email, passwordHash: "x", paths, prefs: {} });
  return { id, email };
}

async function submission(id: string, type: string, email: string, status = "new", userId: string | null = null): Promise<void> {
  await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
    "INSERT INTO submissions (id, type, status, data, rewarded, user_id) VALUES (?, ?, ?, ?, 0, ?)",
    [id, type, status, JSON.stringify({ email, name: "Form Person" }), userId],
  );
}

/** The rule answers for one person on one journey, the way the tick asks them. */
async function answers(email: string, journeyKey: string, keys: string[], subject?: string) {
  const contact = await contactByEmailKey(pool, email.toLowerCase());
  const e = await enrollmentOf(email, journeyKey);
  const definition = journeyKey.startsWith("path.") ? pathJourney(journeyKey.slice(5)) : pathJourney("resident");
  const ctx: ConditionContext = {
    getPool: () => pool,
    now: new Date(),
    villageZone: "UTC",
    enrollment: {
      id: e?.id ?? "none",
      journeyKey,
      journeyVersion: 1,
      contactId: contact!.id,
      subjectRef: subject ?? String(e?.subject_ref ?? ""),
      enrolledAt: new Date(),
      stored: {},
    },
    contact: { id: contact!.id, email: contact!.email, name: contact!.name, userId: contact!.userId, timezone: null },
    definition,
    facts: {},
  };
  return answerConditions(keys as any, ctx);
}

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db);
  registerPathJourneyParts(parts());
});

afterAll(async () => {
  if (!configured) return;
  await pool.end();
  await db.drop();
});

describe.skipIf(!configured)("paths: the triggers", () => {
  it("a ticked public form records the yes with the words shown, puts them on the path, and starts its journey", async () => {
    const email = "Rowan.Guest@Example.test";
    await handlePathTrigger(deps(), formSubmittedTrigger("steward-interest", "sub-steward-1", { email, name: "Rowan Guest", commsConsent: true }) as any);
    const contact = await contactByEmailKey(pool, email.toLowerCase());
    expect(contact).not.toBeNull();
    const [perm] = await rows("SELECT state, basis, source, evidence FROM comms_permissions WHERE contact_id = ? AND kind = 'paths'", [contact!.id]);
    expect(perm).toMatchObject({ state: "yes", basis: "asked", source: "steward-interest" });
    const evidence = typeof perm.evidence === "string" ? JSON.parse(perm.evidence) : perm.evidence;
    expect(evidence).toMatchObject({ form: "steward-interest", submissionId: "sub-steward-1", words: DEFAULT_CONSENT_TEXT });
    const row = await pathEnrollmentOf(pool, `guest:${contact!.id}`, "steward");
    expect(row).toMatchObject({ source: "steward-interest", state: "active", contactId: contact!.id, userId: null });
    expect(await enrollmentOf(email, "path.steward")).toMatchObject({ state: "active", subject_ref: "path:steward" });
  });

  it("an unticked form records nothing and starts nothing", async () => {
    const email = "quiet.person@example.test";
    await handlePathTrigger(deps(), formSubmittedTrigger("work-with-us", "sub-quiet", { email, name: "Quiet Person" }) as any);
    expect(await contactByEmailKey(pool, email)).toBeNull();
    expect(await rows("SELECT 1 FROM path_enrollments WHERE source = 'work-with-us'")).toHaveLength(0);
  });

  it("an address that belongs to an account walks the path as that member", async () => {
    const m = await member("Mara Member");
    await handlePathTrigger(deps(), formSubmittedTrigger("investor-call", "sub-call-1", { email: m.email, name: "Mara", commsConsent: true }) as any);
    expect(await pathEnrollmentOf(pool, m.id, "investor")).toMatchObject({ userId: m.id, source: "investor-call" });
    expect((await contactByEmailKey(pool, m.email))?.userId).toBe(m.id);
  });

  it("a ticked request to join starts the joining journey on the submission; a decline stops it", async () => {
    const email = "asker@example.test";
    await submission("sub-join-1", "membership-request", email);
    await handlePathTrigger(deps(), formSubmittedTrigger("membership-request", "sub-join-1", { email, name: "Ash Asker", commsConsent: true }) as any);
    expect(await enrollmentOf(email, "joining.request")).toMatchObject({ state: "active", subject_ref: "form:sub-join-1" });
    expect(await rows("SELECT 1 FROM path_enrollments WHERE contact_id = (SELECT id FROM comms_contacts WHERE email_key = ?)", [email])).toHaveLength(0);
    await pool.query("UPDATE submissions SET status = 'declined' WHERE id = 'sub-join-1'"); // module-review-ok: moving a row in the scratch schema
    await handlePathTrigger(deps(), { type: "submission_status", submissionId: "sub-join-1", formType: "membership-request", status: "declined" });
    expect(await enrollmentOf(email, "joining.request")).toMatchObject({ state: "stopped", stop_reason: "joining_declined" });
  });

  it("an admission stops the joining journey of the address that asked", async () => {
    const m = await member("Ari Admitted");
    await submission("sub-join-2", "membership-request", m.email);
    await handlePathTrigger(deps(), formSubmittedTrigger("membership-request", "sub-join-2", { email: m.email, commsConsent: true }) as any);
    expect(await enrollmentOf(m.email, "joining.request")).toMatchObject({ state: "active" });
    await handlePathTrigger(deps(), { type: "member_admitted", userId: m.id });
    expect(await enrollmentOf(m.email, "joining.request")).toMatchObject({ state: "stopped", stop_reason: "joining_admitted" });
  });

  it("a ticked housing request starts the resident path; reserving the home marks it done and stops the journey", async () => {
    const email = "home.seeker@example.test";
    await handlePathTrigger(deps(), { type: "housing_status", reservationId: "hres-x", status: "new", email, name: "Hana Seeker", consentPaths: true });
    const contact = await contactByEmailKey(pool, email);
    expect(await enrollmentOf(email, "path.resident")).toMatchObject({ state: "active" });
    await handlePathTrigger(deps(), { type: "housing_status", reservationId: "hres-x", status: "reserved", email });
    expect(await pathEnrollmentOf(pool, `guest:${contact!.id}`, "resident")).toMatchObject({ state: "done" });
    expect(await enrollmentOf(email, "path.resident")).toMatchObject({ state: "stopped", stop_reason: "resident_reserved" });
  });

  it("an unticked housing request starts nothing", async () => {
    await handlePathTrigger(deps(), { type: "housing_status", reservationId: "hres-y", status: "new", email: "no.box@example.test", name: "No Box" });
    expect(await contactByEmailKey(pool, "no.box@example.test")).toBeNull();
  });

  it("an accepted Work With Us proposal is the prosperity path's goal", async () => {
    const email = "maker@example.test";
    await submission("sub-wwu-1", "work-with-us", email);
    await handlePathTrigger(deps(), formSubmittedTrigger("work-with-us", "sub-wwu-1", { email, name: "Mo Maker", commsConsent: true }) as any);
    expect(await enrollmentOf(email, "path.prosperity-creator")).toMatchObject({ state: "active" });
    await pool.query("UPDATE submissions SET status = 'accepted' WHERE id = 'sub-wwu-1'"); // module-review-ok: moving a row in the scratch schema
    await handlePathTrigger(deps(), { type: "submission_status", submissionId: "sub-wwu-1", formType: "work-with-us", status: "accepted" });
    expect(await enrollmentOf(email, "path.prosperity-creator")).toMatchObject({ state: "stopped", stop_reason: "prosperity_venture_listed" });
  });

  it("a member leaving a path stops its journey, and joining again picks the same row up", async () => {
    const m = await member("Lee Leaver", ["resident"]);
    await handlePathTrigger(deps(), { type: "path_joined", personKey: m.id, userId: m.id, pathId: "resident", source: "profile" });
    expect(await enrollmentOf(m.email, "path.resident")).toMatchObject({ state: "active" });
    await handlePathTrigger(deps(), { type: "path_left", personKey: m.id, userId: m.id, pathId: "resident", source: "profile" });
    const left = await pathEnrollmentOf(pool, m.id, "resident");
    expect(left).toMatchObject({ state: "left" });
    expect(left!.leftAt).not.toBeNull();
    expect(await enrollmentOf(m.email, "path.resident")).toMatchObject({ state: "stopped", stop_reason: "left_path" });
    await handlePathTrigger(deps(), { type: "path_joined", personKey: m.id, userId: m.id, pathId: "resident", source: "profile" });
    const back = await pathEnrollmentOf(pool, m.id, "resident");
    expect(back).toMatchObject({ id: left!.id, state: "active", leftAt: null });
    expect(await enrollmentOf(m.email, "path.resident")).toMatchObject({ state: "active" });
  });

  it("a new member starts the welcome on their account", async () => {
    const m = await member("Nia New");
    await handlePathTrigger(deps(), { type: "member_joined", userId: m.id });
    expect(await enrollmentOf(m.email, "member.welcome")).toMatchObject({ state: "active", subject_ref: "account" });
  });
});

describe.skipIf(!configured)("paths: the rules the tick asks", () => {
  it("answers the resident rules from the housing table and the path row", async () => {
    const email = "resi@example.test";
    await handlePathTrigger(deps(), formSubmittedTrigger("resident", "sub-res-1", { email, name: "Resi Dent", commsConsent: true }) as any);
    expect(await answers(email, "path.resident", ["resident_first_step_done", "resident_reserved", "left_path"])).toEqual({
      resident_first_step_done: false,
      resident_reserved: false,
      left_path: false,
    });
    const { id } = await createReservation(pool, { structureKey: null, homeType: "cabin", name: "Resi", email: "RESI@example.test", arrivedFrom: "site" } as any);
    expect((await answers(email, "path.resident", ["resident_first_step_done"])).resident_first_step_done).toBe(true);
    await pool.query("UPDATE housing_reservations SET status = 'reserved' WHERE id = ?", [id]); // module-review-ok: moving a row in the scratch schema
    expect((await answers(email, "path.resident", ["resident_reserved"])).resident_reserved).toBe(true);
    // The goal holding marks the path row done.
    const contact = await contactByEmailKey(pool, email);
    expect(await pathEnrollmentOf(pool, `guest:${contact!.id}`, "resident")).toMatchObject({ state: "done" });
  });

  it("holds the investor words until they are reviewed", async () => {
    const email = "inv@example.test";
    await handlePathTrigger(deps(), formSubmittedTrigger("investor-doc-request", "sub-inv-1", { email, name: "Ivy", commsConsent: true }) as any);
    expect((await answers(email, "path.investor", ["investor_words_unreviewed"])).investor_words_unreviewed).toBe(true);
    const saved = await writeCommsSettings(pool, { investorWordsReviewed: true }, { pathIds: ["investor"], reviewer: "u-rev" });
    expect(saved.ok).toBe(true);
    expect((await answers(email, "path.investor", ["investor_words_unreviewed"])).investor_words_unreviewed).toBe(false);
    await writeCommsSettings(pool, { investorWordsReviewed: false }, { pathIds: ["investor"] });
  });

  it("answers the packet, the hand and the decline from their own rows", async () => {
    const email = "packet@example.test";
    await handlePathTrigger(deps(), formSubmittedTrigger("investor-doc-request", "sub-pk-1", { email, commsConsent: true }) as any);
    expect((await answers(email, "path.investor", ["investor_first_step_done"])).investor_first_step_done).toBe(false);
    await submission("sub-pk-1", "investor-doc-request", email);
    expect((await answers(email, "path.investor", ["investor_first_step_done", "investor_committed"]))).toEqual({
      investor_first_step_done: true,
      investor_committed: false,
    });
    expect((await answers(email, "path.investor", ["steward_first_step_done"])).steward_first_step_done).toBe(false);
    expect((await answers(email, "joining.request", ["joining_declined"], "form:sub-join-1")).joining_declined).toBe(true);
  });
});

describe.skipIf(!configured)("paths: members already on a path", () => {
  it("records them with source backfill and starts nobody, until an admin includes them", async () => {
    const a = await member("Bea Backfill", ["steward"]);
    const b = await member("Bo Backfill", ["steward", "investor"]);
    const all = usersRepo(pool);
    const counts = await backfillPathEnrollments({ getPool: () => pool, members: all }, () => undefined);
    expect(counts.recorded).toBeGreaterThanOrEqual(3);
    expect(await pathEnrollmentOf(pool, a.id, "steward")).toMatchObject({ source: "backfill", state: "active" });
    expect(await enrollmentOf(a.email, "path.steward")).toBeNull();
    expect(await enrollmentOf(b.email, "path.investor")).toBeNull();
    // Running it again records nothing new.
    expect((await backfillPathEnrollments({ getPool: () => pool, members: all }, () => undefined)).recorded).toBe(0);

    const included = await setPathJourneyOptions(deps(), "path.steward", { includeExisting: true }, "u-admin");
    expect(included?.started).toBeGreaterThanOrEqual(2);
    expect(included?.status.definition.includeExisting).toBe(true);
    expect(await enrollmentOf(a.email, "path.steward")).toMatchObject({ state: "active" });
    expect(await enrollmentOf(b.email, "path.investor")).toBeNull();
    expect(await includeExistingOnPath(deps(), "steward")).toBe(0);
  });

  it("never reactivates a row a person left, from the backfill", async () => {
    const m = await member("Lou Left", ["resident"]);
    await joinPathRow(pool, { id: "pe-left-1", personKey: m.id, userId: m.id, contactId: null, pathId: "resident", source: "profile" });
    await pool.query("UPDATE path_enrollments SET state = 'left' WHERE id = 'pe-left-1'"); // module-review-ok: moving a row in the scratch schema
    const again = await joinPathRow(pool, { id: "pe-left-2", personKey: m.id, userId: m.id, contactId: null, pathId: "resident", source: "backfill" });
    expect(again).toMatchObject({ outcome: "already", row: { id: "pe-left-1", state: "left" } });
  });
});

describe.skipIf(!configured)("paths: day 21 and the rungs", () => {
  const stepCtx = async (email: string, journeyKey: string, status: string) => {
    const contact = await contactByEmailKey(pool, email);
    const e = await enrollmentOf(email, journeyKey);
    const definition = pathJourney(journeyKey.slice(5));
    return {
      getPool: () => pool,
      now: new Date(),
      villageZone: "UTC",
      enrollment: { id: e.id, journeyKey, journeyVersion: 1, contactId: contact!.id, subjectRef: e.subject_ref, enrolledAt: new Date(), stored: {} },
      contact: { id: contact!.id, email: contact!.email, name: contact!.name, userId: contact!.userId, timezone: null },
      definition,
      facts: {},
      step: definition.steps.find((s) => s.key === "check_in")!,
      village: await loadEmailVillage(pool, ORIGIN),
      result: { status, messageId: "m1" },
    } as any;
  };

  it("asks the path's contact person to write, by first name, linking to People", async () => {
    const host = await member("Sol Steward");
    await writeCommsSettings(pool, { pathContacts: { steward: host.id } }, { pathIds: ["steward"] });
    const ctx = await stepCtx("rowan.guest@example.test", "path.steward", "queued");
    expect(await handOff(parts(), ctx)).toBe("notified");
    expect(notices.at(-1)).toMatchObject({
      userId: host.id,
      type: "comms_path_handoff",
      dedupeKey: `comms_path_handoff:${ctx.enrollment.id}`,
      link: `/admin?tab=comms-people&person=${ctx.contact.id}`,
    });
    expect(notices.at(-1)!.title).toContain("Rowan has been on the Village Steward path for three weeks");
    expect(await handOff(parts(), { ...ctx, step: { ...ctx.step, key: "stories" } })).toBe("not_this_step");
    expect(await handOff(parts(), { ...ctx, result: { status: "skipped", messageId: null } })).toBe("not_this_step");
  });

  it("asks nobody to write when the check-in was only rehearsed", async () => {
    const host = await member("Rae Rehearsal");
    await writeCommsSettings(pool, { pathContacts: { steward: host.id } }, { pathIds: ["steward"] });
    const before = notices.length;
    const ctx = await stepCtx("rowan.guest@example.test", "path.steward", "rehearsed");
    expect(await handOff(parts(), ctx)).toBe("rehearsal");
    expect(notices.length, "a real contact person is never asked to write to a rehearsal's reader").toBe(before);
  });

  it("falls back to the path's inbox when the path has no contact person", async () => {
    await writeCommsSettings(pool, { pathContacts: { steward: null } }, { pathIds: ["steward"] });
    const ctx = await stepCtx("rowan.guest@example.test", "path.steward", "sent");
    expect(await handOff(parts(), ctx)).toBe("inbox");
    const [msg] = await rows("SELECT kind, origin, to_email, subject FROM comms_messages WHERE origin = 'comms.path_handoff'");
    expect(msg).toMatchObject({ kind: "essential", to_email: "stewards@village.example.test" });
    expect(String(msg.subject)).toContain("Rowan has been on the Village Steward path");
  });

  it("records where a member stands, then emails once when they move up the ladder", async () => {
    const m = await member("Rae Rung", ["resident"]);
    await handlePathTrigger(deps(), { type: "path_joined", personKey: m.id, userId: m.id, pathId: "resident", source: "signup", email: m.email, name: "Rae Rung" });
    await setJourneyState({ getPool: () => pool }, "path.resident", "on", "u-admin");
    expect((await runPathRungs(parts())).posted).toBe(0);
    await setPathJourneyOptions(deps(), "path.resident", { rungEmails: true }, "u-admin");
    const first = await runPathRungs(parts());
    expect(first.posted).toBe(0);
    expect((await pathEnrollmentOf(pool, m.id, "resident"))!.lastRung).toBe("0");

    await createReservation(pool, { structureKey: null, homeType: "cabin", name: "Rae", email: m.email, arrivedFrom: "site", userId: m.id } as any);
    const moved = await runPathRungs(parts());
    expect(moved.posted).toBe(1);
    expect((await pathEnrollmentOf(pool, m.id, "resident"))!.lastRung).toBe("1");
    const [msg] = await rows("SELECT kind, origin, subject, UNIX_TIMESTAMP(send_after) AS sa FROM comms_messages WHERE origin = 'path.rung'");
    expect(msg).toMatchObject({ kind: "paths" });
    expect(String(msg.subject)).toContain("on the Resident path");
    expect((await runPathRungs(parts())).posted).toBe(0);
  });
});
