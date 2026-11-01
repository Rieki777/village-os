/**
 * ANSWERING A REQUEST TO JOIN, OUT LOUD (sheet A5): over real HTTP and the S5
 * scratch schema (server/routes/joinAnswers.ts), with the mail door handed in
 * as a fake that records what would go out and answers as the post office is
 * told to. Nothing here reaches a provider.
 *
 * What is pinned:
 *
 *   - Accept makes the request's invitation, emails it as an essential email
 *     to the address the person typed, and answers the desk with the link,
 *     where it went, and the request moved to accepted.
 *   - NEVER A SILENT SUCCESS: email not set up, an address that is not one, a
 *     request with no address, and a send that failed each answer the link
 *     and a sentence that says to send it by hand.
 *   - Decline sends a short, kind no, and moves the request to declined.
 *   - The attacks the coordinator named: an applicant who already has an
 *     account, a mistyped address, accepting twice, declining after accepting
 *     (the link is withdrawn and stops working, and a link already used
 *     refuses the decline), and accepting again after that no.
 *   - Who may answer: the gate on `intake.moderate`, and a signed-in account
 *     to make the link from; never a request of another kind.
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { JOIN_ANSWER_WORDS, joinInviteId } from "../../shared/joinAnswers";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { escapeHtml } from "../lib/comms/mailer";
import { hashInviteToken, INVITE_DAYS } from "../lib/invites";
import { claimInvite, inviteByHash, inviteById } from "../repos/memberInvites";
import { register } from "./joinAnswers";

const configured = testDbConfigured();
if (!configured) console.warn("[joinAnswers] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const ORIGIN = "https://village.example.test";
const ADMIN = { id: "u-admin", name: "Ada Stone", email: "ada@example.test", tokenVersion: 0 };
const MEMBER = { id: "u-member", name: "Ivo Lantern", email: "ivo@example.test", tokenVersion: 0 };

describe.skipIf(!configured)("answering a request to join, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  let n = 0;

  const state = {
    viewer: null as typeof ADMIN | null,
    /** May act on `intake.moderate`. */
    moderators: [ADMIN.id] as string[],
    submissions: [] as any[],
    sent: [] as OutgoingEmail[],
    /** What the bell was asked to ring. */
    rung: [] as any[],
    /** What the post office answers the next send with. */
    answer: { status: "sent", messageId: "msg-1" } as PostResult,
  };

  const submissionsRepo = {
    all: () => state.submissions.map((s) => ({ ...s })),
    replaceAll: async (rows: any[]) => {
      state.submissions = rows.map((s) => ({ ...s }));
    },
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    for (const p of [ADMIN, MEMBER]) {
      await pool.query("INSERT INTO users (id, name, email, password_hash, paths) VALUES (?, ?, ?, 'x', '[]')", [p.id, p.name, p.email]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async () => state.viewer,
      getPool: () => pool,
      members: { byEmail: async (email: string) => ([ADMIN, MEMBER].find((p) => p.email === String(email).toLowerCase()) ?? null) },
      guardCapability: async (_req: any, res: any) => {
        if (state.viewer && state.moderators.includes(state.viewer.id)) return true;
        res.status(state.viewer ? 403 : 401).json({ error: state.viewer ? "forbidden" : "auth_required" });
        return false;
      },
      submissionsRepo,
      commsPostOffice: { getPool: () => pool },
      deploymentOrigin: () => ORIGIN,
      projectName: () => "Test Village",
      escapeHtml,
      notify: async (input: any) => {
        state.rung.push(input);
        return { fresh: true };
      },
      postEmail: async (email: OutgoingEmail) => {
        state.sent.push(email);
        return state.answer;
      },
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    state.viewer = ADMIN;
    state.moderators = [ADMIN.id];
    state.sent.length = 0;
    state.rung.length = 0;
    state.answer = { status: "sent", messageId: "msg-1" };
  });

  /** A request to join, filed the way the public form files one. */
  const request = (data: Record<string, unknown> = {}, type = "membership-request") => {
    n += 1;
    const id = `sub-${n}`;
    state.submissions.push({ id, type, status: "new", data: { name: "Rowan Field", email: `rowan${n}@example.test`, why: "I grow food.", ...data }, submittedAt: new Date() });
    return id;
  };

  const answer = async (id: string, what: "accept" | "decline") => {
    const res = await fetch(`${base}/api/admin/join-requests/${id}/${what}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); // module-review-ok: a test calling its own local server, never an outside host
    return { status: res.status, body: (await res.json()) as any };
  };

  const statusOf = (id: string) => state.submissions.find((s) => s.id === id)?.status;
  const tokenOf = (link: string) => decodeURIComponent(new URL(link).searchParams.get("invite") ?? "");

  it("accept emails the invitation to the address they typed, and shows the desk the link and where it went", async () => {
    const id = request({ name: "Rowan Field", email: "  Rowan@Example.test " });
    const r = await answer(id, "accept");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // Trimmed, and sent as typed: the case of an address is the person's own.
    expect(r.body).toMatchObject({ success: true, emailed: true, emailedTo: "Rowan@Example.test", alreadyMember: false });
    expect(r.body.message).toBe(JOIN_ANSWER_WORDS.acceptedEmailed("Rowan@Example.test", INVITE_DAYS));
    expect(r.body.link.startsWith(`${ORIGIN}/register?invite=`)).toBe(true);
    expect(statusOf(id)).toBe("accepted");

    // One essential email, to that address, carrying that very link, under a stable key.
    expect(state.sent).toHaveLength(1);
    const mail = state.sent[0];
    expect(mail).toMatchObject({ kind: "essential", origin: "joining.accepted", to: { email: "Rowan@Example.test", name: "Rowan" }, subject: "Yes, come and join Test Village" });
    expect(mail.idempotencyKey.startsWith(`join-answer:${id}:accepted:`)).toBe(true);
    expect(mail.text).toContain(r.body.link);
    expect(mail.text).toContain("Hi Rowan,");
    expect(mail.html).toContain(escapeHtml(r.body.link));

    // The link is a real, open invitation, made by the admin who accepted, named after the request.
    const row = await inviteByHash(pool, hashInviteToken(tokenOf(r.body.link)));
    expect(row).toMatchObject({ id: joinInviteId(id), inviterUserId: ADMIN.id, usedByUserId: null, revokedAt: null, expired: false });
  });

  it("NEVER A SILENT SUCCESS: email not set up, a failed send, a mistyped address and no address each show the link and say to send it by hand", async () => {
    const cases: Array<[string, () => string, PostResult | null, Parameters<typeof JOIN_ANSWER_WORDS.acceptedNotEmailed>[0]]> = [
      ["not set up", () => request(), { status: "skipped", messageId: "m", reason: "not_configured" }, "not_set_up"],
      ["no key", () => request(), { status: "skipped", messageId: null, reason: "no_api_key" }, "not_set_up"],
      ["refused", () => request(), { status: "failed", messageId: "m", reason: "rejected" }, "failed"],
      ["mistyped", () => request({ email: "rowan at example dot test" }), null, "bad_address"],
      ["two addresses", () => request({ email: "a@example.test, b@example.test" }), null, "bad_address"],
      ["none", () => request({ email: "" }), null, "no_address"],
    ];
    for (const [label, make, postAnswer, why] of cases) {
      state.sent.length = 0;
      if (postAnswer) state.answer = postAnswer;
      const id = make();
      const r = await answer(id, "accept");
      expect(r.status, label).toBe(200);
      expect(r.body, label).toMatchObject({ success: true, emailed: false, emailedTo: null });
      expect(r.body.message, label).toBe(JOIN_ANSWER_WORDS.acceptedNotEmailed(why));
      expect(r.body.link, label).toMatch(/^https:\/\/village\.example\.test\/register\?invite=/);
      expect(statusOf(id), label).toBe("accepted");
      // An address that is not one is never handed to the post office at all.
      expect(state.sent.length, label).toBe(postAnswer ? 1 : 0);
    }
  });

  it("decline sends a short, kind no and moves the request to declined", async () => {
    const id = request({ name: "Sol Reed", email: "sol@example.test" });
    const r = await answer(id, "decline");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, emailed: true, emailedTo: "sol@example.test", withdrawn: false, message: JOIN_ANSWER_WORDS.declinedEmailed("sol@example.test") });
    expect(statusOf(id)).toBe("declined");
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ kind: "essential", origin: "joining.declined", idempotencyKey: `join-answer:${id}:declined`, subject: "Your request to join Test Village" });
    expect(state.sent[0].text).toContain("Hi Sol,");
    expect(state.sent[0].text).toContain("Thank you for asking to join Test Village.");
    // No invitation was ever made for a no.
    expect(await inviteById(pool, joinInviteId(id))).toBeNull();
    // A second no sends nothing more.
    const again = await answer(id, "decline");
    expect(again.body.message).toBe(JOIN_ANSWER_WORDS.alreadyDeclined);
    expect(state.sent).toHaveLength(1);
  });

  it("ATTACK: an applicant who already has an account gets no invitation and no email", async () => {
    const id = request({ name: "Ivo", email: "IVO@example.test" });
    const r = await answer(id, "accept");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, alreadyMember: true, emailed: false, link: null, message: JOIN_ANSWER_WORDS.alreadyMember });
    expect(statusOf(id)).toBe("accepted");
    expect(state.sent).toHaveLength(0);
    expect(await inviteById(pool, joinInviteId(id))).toBeNull();
  });

  it("ATTACK: a request sent while signed in gets no invitation whatever address was typed, and the bell tells them", async () => {
    const id = request({ name: "Ivo", email: "someone-else@example.test" });
    state.submissions.find((s) => s.id === id).userId = MEMBER.id;
    const yes = await answer(id, "accept");
    expect(yes.status).toBe(200);
    expect(yes.body).toMatchObject({ success: true, alreadyMember: true, emailed: false, link: null, message: JOIN_ANSWER_WORDS.acceptedAccount });
    expect(statusOf(id)).toBe("accepted");
    expect(state.sent).toHaveLength(0);
    expect(await inviteById(pool, joinInviteId(id))).toBeNull();
    // Told by the bell, under the key a status move uses, so nobody is told twice.
    expect(state.rung).toEqual([expect.objectContaining({ userId: MEMBER.id, type: "submission_status", dedupeKey: `submission:${id}:accepted` })]);

    const other = request({ name: "Ivo", email: "ivo-typed@example.test" });
    state.submissions.find((s) => s.id === other).userId = MEMBER.id;
    state.rung.length = 0;
    const no = await answer(other, "decline");
    expect(no.body).toMatchObject({ success: true, emailed: true });
    expect(state.rung).toEqual([expect.objectContaining({ userId: MEMBER.id, dedupeKey: `submission:${other}:declined` })]);
  });

  it("ATTACK: accepting twice makes one invitation and sends one email; the second is refused", async () => {
    const id = request();
    const first = await answer(id, "accept");
    expect(first.status).toBe(200);
    const second = await answer(id, "accept");
    expect(second.status).toBe(409);
    expect(second.body.error).toBe(JOIN_ANSWER_WORDS.alreadyAccepted);
    expect(state.sent).toHaveLength(1);
    // The first link still works: the second answer did not replace it.
    expect((await inviteByHash(pool, hashInviteToken(tokenOf(first.body.link))))?.revokedAt).toBeNull();
  });

  it("ATTACK: two accepts at the same moment make one invitation and one email", async () => {
    const id = request();
    const both = await Promise.all([answer(id, "accept"), answer(id, "accept")]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(state.sent).toHaveLength(1);
  });

  it("ATTACK: declining after accepting withdraws the link so it stops working, then sends the no", async () => {
    const id = request();
    const yes = await answer(id, "accept");
    const token = tokenOf(yes.body.link);
    const no = await answer(id, "decline");
    expect(no.status).toBe(200);
    expect(no.body).toMatchObject({ withdrawn: true, emailed: true });
    expect(no.body.message).toBe(`${JOIN_ANSWER_WORDS.declinedEmailed(no.body.emailedTo)} ${JOIN_ANSWER_WORDS.linkWithdrawn}`);
    expect(statusOf(id)).toBe("declined");
    expect((await inviteByHash(pool, hashInviteToken(token)))?.revokedAt).not.toBeNull();
    // The withdrawn link admits nobody.
    expect(await claimInvite(pool, joinInviteId(id), "u-nobody")).toBeNull();
    expect(state.sent.map((m) => m.origin)).toEqual(["joining.accepted", "joining.declined"]);
  });

  it("ATTACK: a link already used refuses the decline, and the request stays accepted", async () => {
    const id = request();
    await answer(id, "accept");
    await pool.query("INSERT INTO users (id, name, email, password_hash, paths) VALUES ('u-joined', 'Rowan Field', 'joined@example.test', 'x', '[]')"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(await claimInvite(pool, joinInviteId(id), "u-joined")).toBe(ADMIN.id);
    const no = await answer(id, "decline");
    expect(no.status).toBe(409);
    expect(no.body.error).toBe(JOIN_ANSWER_WORDS.alreadyJoined);
    expect(statusOf(id)).toBe("accepted");
    // And accepting it again says they joined, never that a link is still waiting.
    const again = await answer(id, "accept");
    expect(again.status).toBe(409);
    expect(again.body.error).toBe(JOIN_ANSWER_WORDS.alreadyJoined);
    expect(state.sent.map((m) => m.origin)).toEqual(["joining.accepted"]);
  });

  it("a yes after a no gives the request a new link, which goes out; the old one stays dead", async () => {
    const id = request();
    const first = await answer(id, "accept");
    await answer(id, "decline");
    const again = await answer(id, "accept");
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.emailed).toBe(true);
    expect(again.body.link).not.toBe(first.body.link);
    expect(statusOf(id)).toBe("accepted");
    expect(await inviteByHash(pool, hashInviteToken(tokenOf(first.body.link)))).toBeNull();
    expect((await inviteByHash(pool, hashInviteToken(tokenOf(again.body.link))))).toMatchObject({ id: joinInviteId(id), revokedAt: null, expired: false });
    expect(state.sent.map((m) => m.origin)).toEqual(["joining.accepted", "joining.declined", "joining.accepted"]);
    expect(new Set(state.sent.map((m) => m.idempotencyKey)).size).toBe(3);
  });

  it("a request accepted before this door existed has no link yet, so accepting it makes one", async () => {
    const id = request();
    state.submissions.find((s) => s.id === id).status = "accepted";
    const r = await answer(id, "accept");
    expect(r.status).toBe(200);
    expect(r.body.emailed).toBe(true);
  });

  it("only a moderator who is signed in answers, and only a request to join", async () => {
    const id = request();
    state.viewer = MEMBER;
    expect((await answer(id, "accept")).status).toBe(403);
    expect((await answer(id, "decline")).status).toBe(403);
    state.viewer = null;
    expect((await answer(id, "accept")).status).toBe(401);
    state.viewer = ADMIN;
    const other = request({}, "work-with-us");
    const wrong = await answer(other, "accept");
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe(JOIN_ANSWER_WORDS.notARequest);
    expect((await answer("sub-nope", "decline")).status).toBe(404);
    expect(statusOf(id)).toBe("new");
    expect(state.sent).toHaveLength(0);
  });
});
