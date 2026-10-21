/**
 * GUESTS, ATTENDANCE AND RECAPS, against a real schema (the comms build spec
 * 5.8 and 5.9).
 *
 * Everything that matters here is a database fact: a seat taken under the
 * gathering's row lock, an expiry decided by the database's own clock, a
 * guest's name read out of the address book, the version of a recap a person
 * was sent. So the real repositories run against a provisioned schema, the
 * post office runs for real over a transport that records instead of sending,
 * and the comms sink is listened to so the tests can say what was announced
 * and when.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CommsTrigger } from "../../../shared/comms/contracts";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import { usersRepo } from "../../repos/users";
import { setPromotionSink, type PromotedEntry } from "../calendarCommunity";
import { commsSink } from "../commsSink";
import { listRsvps, rsvp, withdrawRsvp } from "../gatherings";
import { markAttendance } from "./attendance";
import { guestConfirmAction, requestGuestSeat } from "./guests";
import { verifyLink, type LinkPayload } from "./links";
import type { PostOfficeDeps } from "./postOffice";
import { recapAnswerAction, recapView, rsvpNextAction, saveRecap, sendRecap, type RecapDeps } from "./recaps";
import type { Transport, TransportMessage } from "./transport";

const configured = testDbConfigured();
const ORIGIN = "https://village.example.test";

let db: TestDb;
let pool: Pool;
const sent: TransportMessage[] = [];
const fired: CommsTrigger[] = [];

const transport: Transport = {
  name: "recorder",
  async send(m) {
    sent.push(m);
    return { ok: true, providerId: `prov-${sent.length}` };
  },
};

const postOffice = (): PostOfficeDeps => ({
  getPool: () => pool,
  transport,
  sender: () => "Test Village <hello@village.example.test>",
  hasApiKey: () => true,
  origin: () => ORIGIN,
  mode: async () => ({ lifecycle: "public", paused: false, rehearsalTo: [] }),
  dial: () => 50,
});

const deps = (over: Partial<RecapDeps> = {}): RecapDeps => ({
  getPool: () => pool,
  postOffice: postOffice(),
  origin: () => ORIGIN,
  commsLifecycle: () => "public",
  eventsLifecycle: () => "public",
  members: usersRepo(pool),
  memberMayRsvp: async () => true,
  member: async (id) => {
    const u = await usersRepo(pool).byId(id);
    return u?.email ? { id: String(u.id), name: u.name ?? null, email: String(u.email) } : null;
  },
  rsvpEnabled: () => true,
  guestsDefault: () => true,
  timezone: () => "UTC",
  ...over,
});

async function q(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned
  return rows;
}

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000);

async function addEvent(id: string, over: { capacity?: number | null; layer?: string; startsAt?: Date; seatPrice?: number } = {}) {
  await q("INSERT INTO events (id, title, starts_at, ends_at, status, kind, layer, capacity, seat_price) VALUES (?,?,?,?,?,?,?,?,?)", [
    id,
    `Gathering ${id}`,
    over.startsAt ?? inHours(48),
    new Date((over.startsAt ?? inHours(48)).getTime() + 2 * 3_600_000),
    "scheduled",
    "gathering",
    over.layer ?? "public",
    over.capacity === undefined ? null : over.capacity,
    over.seatPrice ?? 0,
  ]);
}

/** The signed token inside the latest email to an address that carries a link for `purpose`. */
function tokenIn(html: string, purpose: Parameters<typeof verifyLink>[0], nth = 0): { token: string; payload: LinkPayload } {
  const tokens = Array.from(html.matchAll(/\/email\/a\?t=([^"&<\s]+)/g)).map((m) => decodeURIComponent(m[1].replace(/&amp;/g, "&")));
  const found = tokens.map((t) => ({ token: t, payload: verifyLink(purpose, t) })).filter((x) => x.payload);
  if (!found[nth]) throw new Error(`no ${purpose} link in the email`);
  return { token: found[nth].token, payload: found[nth].payload! };
}

const lastEmailTo = (address: string): TransportMessage => {
  const m = sent.filter((x) => x.to === address).pop();
  if (!m) throw new Error(`nothing was sent to ${address}`);
  return m;
};

const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
};

/** A guest asks, and the confirm link's payload comes back out of the email they were sent. */
async function guestAsks(eventId: string, name: string, email: string, d = deps()) {
  const asked = await requestGuestSeat(d, { eventId, occurrenceKey: "", name, email, timezone: "Europe/Lisbon" });
  expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, sent: true });
  return tokenIn(lastEmailTo(email).html, "guest_confirm").payload;
}

const confirm = (payload: LinkPayload, d = deps()) => guestConfirmAction(d).act(payload, { choice: "confirm" }, { village: "Test Village" });

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 12 });
});

afterAll(async () => {
  commsSink.register(async () => undefined);
  setPromotionSink(null);
  await pool?.end();
  await db?.drop();
});

describe.skipIf(!configured)("guests at gatherings, against a real schema", () => {
  beforeEach(() => {
    fired.length = 0;
    commsSink.register(async (t) => {
      fired.push(t);
    });
  });

  it("no reminder before confirmation: a request holds no seat and announces nothing until the link is pressed", async () => {
    await addEvent("ev-quiet");
    const payload = await guestAsks("ev-quiet", "Quinn Quiet", "quinn@example.test");
    await settle();

    // The one email is the confirmation request, essential and sent now.
    expect(sent.filter((m) => m.to === "quinn@example.test").map((m) => m.kind)).toEqual(["essential"]);
    // No answer on record, so no journey can find this person, and nothing was announced.
    expect(await q("SELECT * FROM event_rsvps WHERE event_id = 'ev-quiet'")).toEqual([]);
    expect(await q("SELECT * FROM event_waitlist WHERE event_id = 'ev-quiet'")).toEqual([]);
    expect(fired).toEqual([]);
    const [contact] = await q("SELECT id, timezone FROM comms_contacts WHERE email_key = 'quinn@example.test'");
    expect(contact.timezone).toBe("Europe/Lisbon");
    expect(await q("SELECT * FROM comms_enrollments WHERE contact_id = ?", [contact.id])).toEqual([]);
    const [request] = await q("SELECT status, token_hash FROM event_guest_requests WHERE contact_id = ?", [contact.id]);
    expect(request.status).toBe("pending");
    // The table holds a hash, never the token the email carries.
    expect(request.token_hash).not.toBe(payload.k);
    expect(String(request.token_hash)).toMatch(/^[0-9a-f]{64}$/);

    const done = await confirm(payload);
    expect(done, JSON.stringify(done)).toMatchObject({ ok: true });
    await settle();
    const guestKey = `guest:${contact.id}`;
    expect(await q("SELECT user_id, status FROM event_rsvps WHERE event_id = 'ev-quiet'")).toEqual([{ user_id: guestKey, status: "going" }]);
    // The ordinary rsvp() path announced it, so the event email lane enrolls a guest the way it enrolls a member.
    expect(fired).toContainEqual({ type: "rsvp_changed", eventId: "ev-quiet", occurrenceKey: "", personKey: guestKey, status: "going" });
    expect((await q("SELECT status FROM event_guest_requests WHERE contact_id = ?", [contact.id]))[0].status).toBe("confirmed");
  });

  it("an expired request cannot confirm, decided by the database's clock", async () => {
    await addEvent("ev-late");
    const payload = await guestAsks("ev-late", "Lou Late", "lou@example.test");
    await q("UPDATE event_guest_requests SET expires_at = CURRENT_TIMESTAMP - INTERVAL 1 MINUTE WHERE id = ?", [payload.r]);

    const late = await confirm(payload);
    expect(late).toMatchObject({ ok: false, status: 410 });
    expect(await q("SELECT * FROM event_rsvps WHERE event_id = 'ev-late'")).toEqual([]);
    expect((await q("SELECT status FROM event_guest_requests WHERE id = ?", [payload.r]))[0].status).toBe("pending");
    const page = await guestConfirmAction(deps()).describe(payload, { village: "Test Village" });
    expect(page?.title).toBe("Link expired");
    expect(page?.choices).toEqual([]);
  });

  it("refuses a gathering a guest cannot come to, and asks again when the link is pressed", async () => {
    await addEvent("ev-members", { layer: "village" });
    expect(await requestGuestSeat(deps(), { eventId: "ev-members", occurrenceKey: "", name: "Val", email: "val@example.test" })).toMatchObject({
      ok: false,
      status: 409,
      reason: "not_public",
    });
    await addEvent("ev-priced", { seatPrice: 5 });
    expect(await requestGuestSeat(deps(), { eventId: "ev-priced", occurrenceKey: "", name: "Val", email: "val@example.test" })).toMatchObject({
      reason: "priced",
    });
    expect(await requestGuestSeat(deps({ commsLifecycle: () => "members" }), { eventId: "ev-quiet", occurrenceKey: "", name: "Val", email: "val@example.test" })).toMatchObject({
      reason: "comms_closed",
    });
    expect(await requestGuestSeat(deps(), { eventId: "ev-nowhere", occurrenceKey: "", name: "Val", email: "val@example.test" })).toMatchObject({
      status: 404,
    });

    // Open when asked, closed by the time the link is pressed: the press asks again.
    await addEvent("ev-closes");
    const payload = await guestAsks("ev-closes", "Cal Closes", "cal@example.test");
    await q("INSERT INTO event_comms (event_id, guests) VALUES ('ev-closes', 0)");
    expect(await confirm(payload)).toMatchObject({ ok: false, status: 409 });
    expect(await q("SELECT * FROM event_rsvps WHERE event_id = 'ev-closes'")).toEqual([]);
  });

  it("a confirmed guest holds a seat, and capacity holds under a concurrent burst of members and guests", async () => {
    await addEvent("ev-burst", { capacity: 5 });
    const payloads: LinkPayload[] = [];
    for (let i = 1; i <= 8; i++) payloads.push(await guestAsks("ev-burst", `Guest ${i}`, `burst-${i}@example.test`));

    const results = await Promise.all([
      ...Array.from({ length: 8 }, (_, i) => rsvp(pool, "ev-burst", `member-${i + 1}`, "going")),
      ...payloads.map((p) => confirm(p)),
    ]);
    const memberResults = results.slice(0, 8) as Awaited<ReturnType<typeof rsvp>>[];
    const guestResults = results.slice(8) as Awaited<ReturnType<ReturnType<typeof guestConfirmAction>["act"]>>[];

    const [going] = await q("SELECT COUNT(*) AS n FROM event_rsvps WHERE event_id = 'ev-burst' AND status = 'going'");
    expect(Number(going.n), "the cap is exact").toBe(5);
    // Every guest press succeeded: a seat, or a place in the queue, never an error.
    expect(guestResults.every((r) => r.ok)).toBe(true);
    const guestsIn = Number((await q("SELECT COUNT(*) AS n FROM event_rsvps WHERE event_id = 'ev-burst' AND status = 'going' AND user_id LIKE 'guest:%'"))[0].n);
    const membersIn = memberResults.filter((r) => r.ok).length;
    expect(guestsIn + membersIn).toBe(5);
    expect(memberResults.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "full")).toBe(true);
    const [queued] = await q("SELECT COUNT(*) AS n FROM event_waitlist WHERE event_id = 'ev-burst' AND user_id LIKE 'guest:%'");
    expect(Number(queued.n), "every guest who missed a seat is queued").toBe(8 - guestsIn);
  });

  it("an address that belongs to a member answers as the member, so nobody holds two seats", async () => {
    await q("INSERT INTO users (id, name, email, password_hash) VALUES ('u-mia', 'Mia Member', 'mia@example.test', 'x')");
    await addEvent("ev-mia");
    const payload = await guestAsks("ev-mia", "Mia", "mia@example.test");
    expect(await confirm(payload)).toMatchObject({ ok: true });
    expect(await q("SELECT user_id FROM event_rsvps WHERE event_id = 'ev-mia'")).toEqual([{ user_id: "u-mia" }]);

    await addEvent("ev-mia-2");
    const refused = await guestAsks("ev-mia-2", "Mia", "mia@example.test");
    expect(await confirm(refused, deps({ memberMayRsvp: async () => false }))).toMatchObject({ ok: false, status: 403 });
  });

  it("the organiser list shows the guest's name with guest, and no address", async () => {
    const rows = await listRsvps(pool, "ev-quiet");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Quinn Quiet", guest: true, status: "going" });
    expect(rows[0].userId).toMatch(/^guest:ct_/);
    expect(JSON.stringify(rows)).not.toContain("@");
    const member = await listRsvps(pool, "ev-mia");
    expect(member[0]).toMatchObject({ name: "Mia Member", guest: false });
  });

  it("a promoted guest is told by email and never handed to the in-app notification sink", async () => {
    await addEvent("ev-queue", { capacity: 1 });
    expect((await rsvp(pool, "ev-queue", "member-q", "going")).ok).toBe(true);
    const payload = await guestAsks("ev-queue", "Wren Waiting", "wren@example.test");
    const queued = await confirm(payload);
    expect(queued).toMatchObject({ ok: true, outcome: { title: "Waitlist: number 1" } });

    const toNotify: PromotedEntry[][] = [];
    setPromotionSink((p) => {
      toNotify.push(p);
    });
    fired.length = 0;
    expect(await withdrawRsvp(pool, "ev-queue", "member-q")).toBe(true);
    await settle();
    const [row] = await q("SELECT user_id, status FROM event_rsvps WHERE event_id = 'ev-queue'");
    expect(row.status).toBe("going");
    expect(String(row.user_id)).toMatch(/^guest:/);
    expect(toNotify, "no in-app notification for a guest key").toEqual([]);
    expect(fired).toContainEqual({ type: "waitlist_promoted", eventId: "ev-queue", occurrenceKey: "", personKey: row.user_id });
    setPromotionSink(null);
  });
});

describe.skipIf(!configured)("attendance and the recap, against a real schema", () => {
  beforeAll(async () => {
    commsSink.register(async () => undefined);
    await q("INSERT INTO users (id, name, email, password_hash) VALUES ('u-ana', 'Ana Came', 'ana@example.test', 'x'), ('u-ben', 'Ben Missed', 'ben@example.test', 'x')");
    await addEvent("ev-recap");
    // The soonest gathering on the calendar, so it is the one every recap offers next.
    await addEvent("ev-next", { startsAt: inHours(6) });
    expect((await rsvp(pool, "ev-recap", "u-ana", "going")).ok).toBe(true);
    expect((await rsvp(pool, "ev-recap", "u-ben", "going")).ok).toBe(true);
    expect(await confirm(await guestAsks("ev-recap", "Gale Guest", "gale@example.test"))).toMatchObject({ ok: true });
  });

  it("refuses marks before the gathering begins, and only marks people who answered", async () => {
    expect(await markAttendance(deps(), "ev-recap", "", { everyone: true }, "u-host")).toMatchObject({ ok: false, status: 409 });
    await q("UPDATE events SET starts_at = UTC_TIMESTAMP() - INTERVAL 3 HOUR, ends_at = UTC_TIMESTAMP() - INTERVAL 1 HOUR WHERE id = 'ev-recap'");
    expect(await markAttendance(deps(), "ev-recap", "", { marks: [{ personKey: "u-stranger", status: "came" }] }, "u-host")).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("recap versions reach the right people: came for who came, missed only for who the host marked missed", async () => {
    const [gale] = await q("SELECT id FROM comms_contacts WHERE email_key = 'gale@example.test'");
    const galeKey = `guest:${gale.id}`;
    const marked = await markAttendance(
      deps(),
      "ev-recap",
      "",
      { marks: [{ personKey: "u-ana", status: "came" }, { personKey: "u-ben", status: "missed" }, { personKey: galeKey, status: "came" }] },
      "u-host",
    );
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    expect(marked.view.people.find((p) => p.personKey === galeKey)).toMatchObject({ name: "Gale Guest", guest: true, mark: "came" });
    expect(JSON.stringify(marked.view)).not.toContain("@");

    expect(await sendRecap(deps(), "ev-recap", "")).toMatchObject({ ok: false, status: 409 });
    expect(await saveRecap(deps(), "ev-recap", "", { bodyMd: "We planted the bed.", missedNoteMd: "Seeds are left for you.", recordingUrl: "https://video.example.test/r1" }, "u-ana")).toEqual({ ok: true });
    expect(await sendRecap(deps(), "ev-recap", "")).toEqual({ ok: true, came: 2, missed: 1, posted: 3, skipped: 0 });

    const rows = await q("SELECT to_email, template_key, kind, status, body_html FROM comms_messages WHERE origin = 'event.recap' ORDER BY to_email");
    expect(rows.map((r) => [r.to_email, r.template_key, r.kind, r.status])).toEqual([
      ["ana@example.test", "gathering.recap_came", "events", "queued"],
      ["ben@example.test", "gathering.recap_missed", "events", "queued"],
      ["gale@example.test", "gathering.recap_came", "events", "queued"],
    ]);
    expect(String(rows[1].body_html)).toContain("Seeds are left for you.");
    expect(String(rows[0].body_html)).not.toContain("Seeds are left for you.");
    // Sent once: a second press posts nothing and says so.
    expect(await sendRecap(deps(), "ev-recap", "")).toMatchObject({ ok: false, status: 409, error: "Already sent." });
    expect(await q("SELECT id FROM comms_messages WHERE origin = 'event.recap'")).toHaveLength(3);
    expect(await saveRecap(deps(), "ev-recap", "", { bodyMd: "Changed after." }, "u-ana")).toMatchObject({ ok: false, status: 409 });
  });

  it("an answer lands in event_feedback and shows to the host", async () => {
    const [row] = await q("SELECT body_html FROM comms_messages WHERE origin = 'event.recap' AND to_email = 'gale@example.test'");
    const yes = tokenIn(String(row.body_html), "recap_answer", 0).payload;
    expect(yes).toMatchObject({ e: "ev-recap", q: "q1", a: "yes" });
    const page = await recapAnswerAction(deps()).describe(yes, { village: "Test Village" });
    expect(page?.title).toBe("Would you come to the next one?");
    expect(page?.choices.find((c) => c.value === "yes")?.primary).toBe(true);
    expect(await recapAnswerAction(deps()).act(yes, { choice: "yes" }, { village: "Test Village" })).toMatchObject({ ok: true });
    const words = tokenIn(String(row.body_html), "recap_answer", 2).payload;
    expect(await recapAnswerAction(deps()).act(words, { text: "  " }, { village: "Test Village" })).toMatchObject({ ok: false, status: 400 });
    expect(await recapAnswerAction(deps()).act(words, { text: "More soup." }, { village: "Test Village" })).toMatchObject({ ok: true });

    const stored = await q("SELECT question_key, answer, person_key FROM event_feedback WHERE event_id = 'ev-recap' ORDER BY question_key");
    expect(stored.map((r) => [r.question_key, r.answer])).toEqual([
      ["q1", "yes"],
      ["q2", "More soup."],
    ]);
    const view = await recapView(deps(), "ev-recap", "");
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.answers.map((a) => [a.name, a.guest, a.questionKey, a.answer])).toEqual([
      ["Gale Guest", true, "q1", "yes"],
      ["Gale Guest", true, "q2", "More soup."],
    ]);
    expect(view.view.recap?.state).toBe("sent");
    expect(view.view.next?.title).toBe("Gathering ev-next");
  });

  it("rsvp_next confirms in one click, for a guest directly and for a member under their own id", async () => {
    const [galeRow] = await q("SELECT body_html FROM comms_messages WHERE origin = 'event.recap' AND to_email = 'gale@example.test'");
    const galeNext = tokenIn(String(galeRow.body_html), "rsvp_next").payload;
    expect(galeNext.e).toBe("ev-next");
    const page = await rsvpNextAction(deps()).describe(galeNext, { village: "Test Village" });
    expect(page?.choices).toEqual([{ value: "going", label: "Save me a seat", primary: true }]);
    expect(await rsvpNextAction(deps()).act(galeNext, { choice: "going" }, { village: "Test Village" })).toMatchObject({ ok: true, outcome: { title: "You're in!" } });

    const [anaRow] = await q("SELECT body_html FROM comms_messages WHERE origin = 'event.recap' AND to_email = 'ana@example.test'");
    const anaNext = tokenIn(String(anaRow.body_html), "rsvp_next").payload;
    expect(await rsvpNextAction(deps()).act(anaNext, { choice: "going" }, { village: "Test Village" })).toMatchObject({ ok: true });

    const seats = await q("SELECT user_id FROM event_rsvps WHERE event_id = 'ev-next' AND status = 'going' ORDER BY user_id");
    expect(seats.map((r) => String(r.user_id).replace(/^guest:.*/, "guest"))).toEqual(["guest", "u-ana"]);
  });
});
