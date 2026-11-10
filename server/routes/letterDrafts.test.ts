/**
 * THE LETTERS SCREEN, over real HTTP and the scratch schema (role journey L13).
 *
 *   - only an admin reads, edits, sends or discards
 *   - nothing is sent until a person presses Send; the connector's queue holds it
 *   - Send goes to the mail door once, with the EDITED words, and the letter leaves the queue
 *   - an address on the suppression list gets nothing, and the letter stays waiting
 *   - a refused mail door leaves the letter waiting; a discard sends nothing
 *   - an application with no address cannot be sent
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { emailKeyOf } from "../../shared/comms/address";
import { letterTitle } from "../../shared/agentProposals";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { escapeHtml } from "../lib/comms/mailer";
import { addSuppression } from "../lib/comms/suppressions";
import { addProposal, proposalById } from "../repos/agentProposals";
import { insertOpenProposal } from "../repos/openProposals";
import { usersRepo } from "../repos/users";
import { register } from "./letterDrafts";

const configured = testDbConfigured();
if (!configured) console.warn("[letterDrafts] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const ADMIN = { id: "u-admin", name: "Fern Oak", email: "fern@example.test" };
const ANA = { id: "u-ana", name: "Ana Reed", email: "ana@example.test" };
const REF = "op-aaaaaaaaaaaaaaaaaaaa";
const REF_SUPPRESSED = "op-bbbbbbbbbbbbbbbbbbbb";
const REF_NO_ADDRESS = "op-cccccccccccccccccccc";
const BODY = "Thank you for applying. We read your proposal with care.\n\nWe will be in touch about the next step soon.";

describe.skipIf(!configured)("the letters screen, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  const state = { viewer: null as string | null, sent: [] as OutgoingEmail[], answer: { status: "sent", messageId: "m-1" } as PostResult };

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned

  const draft = (ref: string, kind: "first_reply" | "decision" = "first_reply") =>
    addProposal(pool, { kind: "letter", proposedBy: ANA.id, applicationRef: ref, title: letterTitle(kind, "Thank you"), body: BODY });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    const users = usersRepo(pool);
    for (const p of [ADMIN, ANA]) await users.add({ id: p.id, name: p.name, email: p.email, passwordHash: "x", paths: [] } as any);
    const now = new Date();
    const one = (id: string, email: string) => insertOpenProposal(pool, { id, name: "Pat Rowan", email, emailKey: emailKeyOf(email), targetSeasonId: null, body: {} as any, confirmHash: "h", linkId: null, now });
    await one(REF, "pat@example.test");
    await one(REF_SUPPRESSED, "gone@example.test");
    await q("INSERT INTO open_role_proposals (id, name, email, email_key, status, body_json, confirm_hash, created_at) VALUES (?, 'No Address', NULL, NULL, 'unconfirmed', '{}', 'h', NOW())", [REF_NO_ADDRESS]).catch(() => undefined);
    await addSuppression(pool, "gone@example.test", "manual", "asked to stop");

    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async () => (state.viewer ? await usersRepo(pool).byId(state.viewer) : null),
      getPool: () => pool,
      isAdmin: async () => state.viewer === ADMIN.id,
      overLimit: async () => false,
      members: usersRepo(pool),
      escapeHtml,
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

  beforeEach(async () => {
    state.viewer = ADMIN.id;
    state.sent.length = 0;
    state.answer = { status: "sent", messageId: "m-1" };
    await q("DELETE FROM agent_proposals");
  });

  const call = async (method: string, path: string, body?: unknown, as: string | null = state.viewer) => {
    const before = state.viewer;
    state.viewer = as;
    try {
      const res = await fetch(`${base}${path}`, { // module-review-ok: a test calling its own local server, never an outside host
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as any };
    } finally {
      state.viewer = before;
    }
  };

  it("is for an admin only, and sends nothing to anyone else", async () => {
    const id = await draft(REF);
    for (const [m, p, b] of [["GET", "/api/admin/letter-drafts", undefined], ["PUT", `/api/admin/letter-drafts/${id}`, { subject: "s", body: BODY }], ["POST", `/api/admin/letter-drafts/${id}/send`, undefined], ["POST", `/api/admin/letter-drafts/${id}/discard`, undefined]] as const) {
      expect((await call(m, p, b, ANA.id)).status).toBe(401);
      expect((await call(m, p, b, null)).status).toBe(401);
    }
    expect(state.sent).toEqual([]);
    expect((await proposalById(pool, id))?.status).toBe("waiting");
  });

  it("lists the waiting letters with where each would go, and sends nothing by listing", async () => {
    await draft(REF, "decision");
    await draft(REF_SUPPRESSED);
    const r = await call("GET", "/api/admin/letter-drafts");
    expect(r.status).toBe(200);
    expect(r.body.letters).toHaveLength(2);
    const first = r.body.letters.find((l: any) => l.applicationRef === REF);
    expect(first).toMatchObject({ kind: "decision", subject: "Thank you", to: { email: "pat@example.test" }, suppressed: false });
    expect(r.body.letters.find((l: any) => l.applicationRef === REF_SUPPRESSED).suppressed).toBe(true);
    expect(state.sent).toEqual([]);
  });

  it("a person edits and sends: the mail door gets the edited words once, and the letter leaves the queue", async () => {
    const id = await draft(REF);
    const edited = "Thank you for applying, Pat. We would like to talk.\n\nSomeone will write to you this week to find a time.";
    expect((await call("PUT", `/api/admin/letter-drafts/${id}`, { subject: "Next step", body: edited })).status).toBe(200);
    expect(state.sent).toEqual([]);
    const r = await call("POST", `/api/admin/letter-drafts/${id}/send`);
    expect(r.status).toBe(200);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ subject: "Next step", text: edited, to: { email: "pat@example.test" }, origin: "role.letter" });
    expect(state.sent[0].html).toContain("We would like to talk.");
    const row = await proposalById(pool, id);
    expect(row?.status).toBe("sent");
    expect((await call("POST", `/api/admin/letter-drafts/${id}/send`)).status).toBe(404);
    expect(state.sent).toHaveLength(1);
  });

  it("an address on the suppression list gets nothing, and the letter stays waiting", async () => {
    const id = await draft(REF_SUPPRESSED);
    const r = await call("POST", `/api/admin/letter-drafts/${id}/send`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("suppressed");
    expect(state.sent).toEqual([]);
    expect((await proposalById(pool, id))?.status).toBe("waiting");
  });

  it("a mail door that does not take the letter leaves it waiting", async () => {
    const id = await draft(REF);
    state.answer = { status: "failed", messageId: null } as unknown as PostResult;
    const r = await call("POST", `/api/admin/letter-drafts/${id}/send`);
    expect(r.status).toBe(503);
    expect((await proposalById(pool, id))?.status).toBe("waiting");
  });

  it("an application with no address cannot be sent", async () => {
    const id = await draft(REF_NO_ADDRESS);
    const r = await call("POST", `/api/admin/letter-drafts/${id}/send`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("no_address");
    expect(state.sent).toEqual([]);
  });

  it("a discard sends nothing and takes the letter off the list", async () => {
    const id = await draft(REF);
    expect((await call("POST", `/api/admin/letter-drafts/${id}/discard`)).status).toBe(200);
    expect(state.sent).toEqual([]);
    expect((await proposalById(pool, id))?.status).toBe("dismissed");
    expect((await call("GET", "/api/admin/letter-drafts")).body.letters).toEqual([]);
  });

  it("refuses to edit to nothing", async () => {
    const id = await draft(REF);
    expect((await call("PUT", `/api/admin/letter-drafts/${id}`, { subject: "", body: "short" })).status).toBe(400);
  });
});
