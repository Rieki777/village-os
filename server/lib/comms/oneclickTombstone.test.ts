/**
 * A ONE-CLICK LINK OUTLIVES THE PERSON IT NAMES (lane oneclick-tombstone).
 *
 * A time vote link keeps working for 120 days and a recap answer link for 30.
 * Erasure deletes a member's votes and answers once (`forgetCommsPerson`), so
 * a press on a link signed before it writes them again, and a time vote can
 * move the gathering. Their twin `rsvp_next` already refuses a tombstone.
 *
 * Each case erases a member FOR REAL (`anonymizeMember`), then presses the
 * links that member was sent, through the deps the server itself builds
 * (`timePollDepsOf`, `guestDepsOf`) and through the real routes on a bare
 * express app, and reads the rows back. Two keys are pressed for the erased
 * person: their user id, and `guest:<contactId>` for the address they used as
 * a guest before they joined, whose contact erasure deletes. A live member
 * presses the same links beside them as the control.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import { pollForEvent } from "../../repos/timePolls";
import { usersRepo } from "../../repos/users";
import { registerPublic, type PublicDeps } from "../../routes/commsPeople";
import { guestDepsOf, type CommsGuestsDeps } from "../../routes/commsGuests";
import { register as registerPolls, timePollDepsOf, type PollRouteDeps } from "../../routes/commsPolls";
import { anonymizeMember, type ErasureDeps } from "../erasure";
import { createGathering, getGathering } from "../gatherings";
import { clearMemberDrivers } from "../memberDrivers";
import { ensureContact } from "./contacts";
import type { CommsMode, PostOfficeDeps } from "./postOffice";
import { recapAnswerAction, rsvpNextAction } from "./recaps";
import { createPoll, pollView, timeVoteAction, timeVoteLink, type TimePollDeps } from "./timePolls";
import type { Transport } from "./transport";

const configured = testDbConfigured();

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
let uploadsDir = "";

const HOST = "oc-host";
const LIVE = "oc-live";
const GONE = "oc-gone";
const LIVE_SESSION = "live-session";
const ORIGIN = "https://village.example.test";
const CTX = { village: "Test Village" };
/** What rsvp_next already answers a member who is gone; every door now says the same. */
const GONE_WORDS = "Sign in to answer this gathering.";

const HOUR = 3_600_000;
const inHours = (h: number) => new Date(Math.floor((Date.now() + h * HOUR) / 60_000) * 60_000).toISOString();

const LIVE_MODE: CommsMode = { lifecycle: "members", paused: false, rehearsalTo: [] };
const transport: Transport = { name: "recorder", send: async () => ({ ok: true, providerId: `prov_${Math.random().toString(36).slice(2)}` }) };
const office = (): PostOfficeDeps => ({
  getPool: () => pool,
  transport,
  sender: () => "Test Village <hello@village.example.test>",
  hasApiKey: () => true,
  origin: () => ORIGIN,
  mode: async () => LIVE_MODE,
  dial: () => 50,
});

/** The time vote's deps exactly as the route module builds them, with the settle at 0 so one vote moves the gathering. */
const polls = (): TimePollDeps => ({
  ...timePollDepsOf({ getPool: () => pool, commsPostOffice: office(), members: usersRepo(pool) }),
  timezone: () => "UTC",
  dial: (k) => (k === "comms.time_poll_settle_minutes" ? 0 : 48),
});

/** The recap's deps exactly as the route module builds them. */
const guestRouteDeps = (): CommsGuestsDeps =>
  ({
    authedUser: async () => null,
    overLimit: async () => false,
    clientIp: () => "127.0.0.1",
    guardCapability: async () => false,
    mayStillSee: async () => false,
    getPool: () => pool,
    commsPostOffice: office(),
    members: usersRepo(pool),
    capabilityCtx: async () => ({ capabilities: ["event.rsvp"] }),
    deploymentOrigin: () => ORIGIN,
  }) as unknown as CommsGuestsDeps;
/**
 * The recap's deps as the route module builds them. The dials are pinned so a
 * refusal can only be the one asked about: both modules public, answers open,
 * guests welcome, and the capability check passing. `member` and the guest
 * door's own rules stay the server's.
 */
const recaps = () => ({
  ...guestDepsOf(guestRouteDeps()),
  commsLifecycle: () => "public" as const,
  eventsLifecycle: () => "public" as const,
  memberMayRsvp: async () => true,
  rsvpEnabled: () => true,
  guestsDefault: () => true,
  timezone: () => "UTC",
});

function erasureDeps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: any) => real.update(id, fn) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

async function q(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

async function call(method: string, url: string, opts: { body?: unknown; auth?: string } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.auth) headers.Authorization = `Bearer ${opts.auth}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${url}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }); // module-review-ok: the test client dialling its own in-process server on 127.0.0.1
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** The `t` an email's vote link carries. */
const tokenOf = (link: string) => decodeURIComponent(new URL(link).searchParams.get("t") ?? "");

/** The gathering, its vote, and the links each person was sent, all made before the erasure. */
let eventId = "";
let pollId = "";
let optionA = "";
let optionB = "";
let startA = "";
let guestKey = "";
const recapEvent = "ev-oc-recap";
const nextEvent = "ev-oc-next";

describe.skipIf(!configured)("one-click links for a member who has been erased", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-oneclick-tombstone-"));
    clearMemberDrivers();

    const members = usersRepo(pool);
    await members.add({ id: HOST, name: "Hana Host", email: "hana.host@example.test", passwordHash: "x", paths: ["resident"] });
    await members.add({ id: LIVE, name: "Lark Live", email: "lark.live@example.test", passwordHash: "x", paths: ["resident"] });
    await members.add({ id: GONE, name: "Gale Gone", email: "gale.gone@example.test", passwordHash: "x", paths: ["resident"] });
    // The address the erased member used as a guest before they joined: linked to them, filed under its own key.
    const old = await ensureContact({ getPool: () => pool }, { email: "gale.before@example.test", userId: GONE, source: "guest" });
    guestKey = `guest:${old!.id}`;

    // A village gathering with a vote on its time: the first time is where it stands.
    const g = await createGathering(pool, { title: "Soup night", startsAt: inHours(10 * 24), status: "scheduled", layer: "village" }, HOST);
    eventId = g.id;
    startA = inHours(5 * 24);
    const made = await createPoll(polls(), { eventId, mode: "once", options: [{ startsAt: startA }, { startsAt: inHours(6 * 24) }], createdBy: HOST });
    expect(made.ok, JSON.stringify(made)).toBe(true);
    const view = (await pollView(polls(), eventId, { personKey: null, signedIn: false, canManage: false }))!;
    [optionA, optionB] = view.options.map((o) => o.id);
    pollId = (await pollForEvent(pool, eventId))!.id;
    expect((await getGathering(pool, eventId))!.startsAt).toBe(startA);

    // An evening that happened (the recap's) and the next one (rsvp_next's).
    for (const [id, at] of [
      [recapEvent, new Date(Date.now() - 24 * HOUR)],
      [nextEvent, new Date(Date.now() + 72 * HOUR)],
    ] as const) {
      await q("INSERT INTO events (id, title, starts_at, ends_at, status, kind, layer, capacity, seat_price) VALUES (?,?,?,?,?,?,?,?,?)", [
        id,
        `Gathering ${id}`,
        at,
        new Date(at.getTime() + 2 * HOUR),
        "scheduled",
        "gathering",
        "public",
        null,
        0,
      ]);
    }

    // The real erasure, with every link above already in the member's inbox.
    const target = await members.byId(GONE);
    await anonymizeMember(pool, target, "admin-1", erasureDeps());
    const after = await members.byId(GONE);
    expect(String(after?.email), "the member is a tombstone now").toMatch(/@anonymized\.invalid$/);
    expect(await q("SELECT id FROM comms_contacts WHERE id = ?", [old!.id]), "erasure took the guest-era contact").toHaveLength(0);

    // The routes, registered on a bare app the way server/index.ts registers them.
    const app = express();
    app.use(express.json());
    registerPolls(app, {
      authedUser: async (req: any) => (req.headers.authorization === `Bearer ${LIVE_SESSION}` ? members.byId(LIVE) : null),
      isAdmin: async () => false,
      guardCapability: (async (_req: any, res: any) => {
        res.status(403).json({ error: "host only" });
        return false;
      }) as any,
      mayStillSee: async () => false,
      getPool: () => pool,
      commsPostOffice: office(),
      members,
      isPresent: () => true,
      notify: (async () => ({ fresh: false })) as any,
      overLimit: async () => false,
      clientIp: () => "127.0.0.1",
    } as unknown as PollRouteDeps);
    registerPublic(app, {
      overLimit: async () => false,
      clientIp: () => "127.0.0.1",
      authedUser: async () => null,
      getPool: () => pool,
      members,
      commsPostOffice: office(),
      deploymentOrigin: () => ORIGIN,
      projectName: () => "Test Village",
    } as unknown as PublicDeps);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  const votesOf = async (key: string) => (await q("SELECT option_id FROM event_time_poll_votes WHERE poll_id = ? AND person_key = ?", [pollId, key])).map((r) => r.option_id);

  it("a time vote link refuses an erased member's press, writes no vote, and leaves the gathering where it stood", async () => {
    const action = timeVoteAction(polls());
    for (const k of [GONE, guestKey]) {
      const payload = { p: pollId, o: optionB, k };
      expect(await action.act(payload, { choice: `yes:${optionB}` }, CTX), `the press for ${k}`).toEqual({ ok: false, status: 404, error: GONE_WORDS });
      expect(await action.act(payload, { choice: `no:${optionA}` }, CTX), `a take-back for ${k}`).toMatchObject({ ok: false, status: 404 });
      expect(await votesOf(k), `no vote was written for ${k}`).toEqual([]);
      expect(await action.describe(payload, CTX), `the page for ${k} opens nothing`).toBeNull();
    }
    // One vote for B with the settle at 0 would have moved it there.
    expect((await getGathering(pool, eventId))!.startsAt, "the gathering did not move").toBe(startA);
  });

  it("the vote route and the action page refuse the same link, even with somebody else signed in", async () => {
    const goneToken = tokenOf(timeVoteLink(ORIGIN, pollId, optionB, GONE, null));
    const route = `/api/events/${encodeURIComponent(eventId)}/time-poll`;

    const put = await call("PUT", `${route}/vote`, { body: { t: goneToken, optionIds: [optionB] } });
    expect(put, "the vote route refuses the erased member's link").toEqual({ status: 404, body: { error: GONE_WORDS } });
    // A session does not turn the erased member's link into the session's own vote.
    const withSession = await call("PUT", `${route}/vote`, { body: { t: goneToken, optionIds: [optionB] }, auth: LIVE_SESSION });
    expect(withSession.status, JSON.stringify(withSession.body)).toBe(404);
    expect(await votesOf(GONE)).toEqual([]);
    expect(await votesOf(LIVE), "nothing was filed under the session's person either").toEqual([]);
    // The read no longer speaks for them: no picks of theirs, and no vote offered.
    const look = await call("GET", `${route}?t=${encodeURIComponent(goneToken)}`);
    expect(look.status, JSON.stringify(look.body)).toBe(200);
    expect(look.body.poll, "the read is a stranger's, with nobody behind it").toMatchObject({ mine: null, canVote: false });

    const page = await call("GET", `/api/comms/action?t=${encodeURIComponent(goneToken)}`);
    expect(page.status, JSON.stringify(page.body)).toBe(404);
    const press = await call("POST", `/api/comms/action?t=${encodeURIComponent(goneToken)}`, { body: { choice: `yes:${optionB}` } });
    expect(press, "the action page's press refuses it").toEqual({ status: 404, body: { error: GONE_WORDS } });
    expect(await votesOf(GONE)).toEqual([]);
    expect((await getGathering(pool, eventId))!.startsAt, "the gathering did not move").toBe(startA);
  });

  it("a live member's vote link still votes, through the action and through the route, and moves the gathering", async () => {
    const action = timeVoteAction(polls());
    const payload = { p: pollId, o: optionB, k: LIVE };
    expect(await action.describe(payload, CTX)).not.toBeNull();
    expect(await action.act(payload, { choice: `yes:${optionB}` }, CTX)).toMatchObject({ ok: true, outcome: { title: "Vote saved" } });
    expect(await votesOf(LIVE)).toEqual([optionB]);
    expect((await getGathering(pool, eventId))!.startsAt, "the live vote moved the gathering").not.toBe(startA);

    const liveToken = tokenOf(timeVoteLink(ORIGIN, pollId, optionA, LIVE, null));
    const put = await call("PUT", `/api/events/${encodeURIComponent(eventId)}/time-poll/vote`, { body: { t: liveToken, optionIds: [optionA, optionB] } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect([...put.body.poll.mine].sort()).toEqual([optionA, optionB].sort());
    const page = await call("GET", `/api/comms/action?t=${encodeURIComponent(liveToken)}`);
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body.purpose).toBe("time_vote");
  });

  const feedbackOf = async (key: string) => q("SELECT question_key, answer FROM event_feedback WHERE event_id = ? AND person_key = ?", [recapEvent, key]);

  it("a recap answer link refuses an erased member's press and keeps none of their words", async () => {
    const action = recapAnswerAction(recaps());
    for (const k of [GONE, guestKey]) {
      const yes = { e: recapEvent, p: k, q: "q1", a: "yes" };
      const words = { e: recapEvent, p: k, q: "q2" };
      expect(await action.act(yes, { choice: "yes" }, CTX), `the yes for ${k}`).toEqual({ ok: false, status: 404, error: GONE_WORDS });
      expect(await action.act(words, { text: "Words after the erasure." }, CTX), `the words for ${k}`).toEqual({ ok: false, status: 404, error: GONE_WORDS });
      expect(await feedbackOf(k), `no answer was kept for ${k}`).toEqual([]);
      expect(await action.describe(words, CTX), `the page for ${k} opens nothing`).toBeNull();
    }
  });

  it("a live member's recap answer link still answers", async () => {
    const action = recapAnswerAction(recaps());
    expect(await action.describe({ e: recapEvent, p: LIVE, q: "q2" }, CTX)).not.toBeNull();
    expect(await action.act({ e: recapEvent, p: LIVE, q: "q1", a: "yes" }, { choice: "yes" }, CTX)).toMatchObject({ ok: true });
    expect(await action.act({ e: recapEvent, p: LIVE, q: "q2" }, { text: "More soup." }, CTX)).toMatchObject({ ok: true });
    expect((await feedbackOf(LIVE)).map((r) => [r.question_key, r.answer])).toEqual([
      ["q1", "yes"],
      ["q2", "More soup."],
    ]);
  });

  const seatsOf = async (key: string) => q("SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?", [nextEvent, key]);

  it("rsvp_next holds no seat for an erased member under either key, and still seats a live member", async () => {
    const action = rsvpNextAction(recaps());
    expect(await action.act({ e: nextEvent, p: GONE }, { choice: "going" }, CTX), "the member key, which the twin already refused").toEqual({ ok: false, status: 404, error: GONE_WORDS });
    expect(await action.act({ e: nextEvent, p: guestKey }, { choice: "going" }, CTX), "the guest-era key").toEqual({ ok: false, status: 404, error: GONE_WORDS });
    expect(await seatsOf(GONE)).toEqual([]);
    expect(await seatsOf(guestKey)).toEqual([]);
    expect(await action.act({ e: nextEvent, p: LIVE }, { choice: "going" }, CTX)).toMatchObject({ ok: true, outcome: { title: "You're in!" } });
    expect((await seatsOf(LIVE)).map((r) => r.status)).toEqual(["going"]);
  });
});
