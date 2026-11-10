/**
 * A PROPOSAL'S LINKS AND FILES AT THE INTAKE (Rye, 10 Nov 2026), over real
 * HTTP and the scratch schema, with a private folder of the suite's own.
 *
 * What is pinned:
 *
 *   - Links are kept checked and never fetched; a bad one is refused with the
 *     field named.
 *   - Files come as one multipart post, are checked by their own bytes, and
 *     land in the proposal's private folder before its row is written.
 *   - A refused file keeps nothing: no row, no folder.
 *   - A confirmation that did not go keeps nothing, files included.
 *   - The tidy job: files go with a proposal never confirmed in 48 hours, and
 *     links and files go with the name and address at 90 days.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { ATTACHMENT_WORDS, PROPOSAL_FILE_MAX_BYTES } from "../../shared/proposalAttachments";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { escapeHtml } from "../lib/comms/mailer";
import { createOrgRole } from "../lib/orgChart";
import { readOpenProposal } from "../repos/openProposals";
import { usersRepo } from "../repos/users";
import { register, tidyOpenProposals } from "./openProposals";

const configured = testDbConfigured();
if (!configured) console.warn("[openProposals.attachments] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const ORIGIN = "https://village.example.test";
const NEXT = { id: "s-next", name: "Season of Roots", startsOn: "2099-01-01", endsOn: "2099-03-20", goals: [] };
const NOW_SEASON = { id: "s-now", name: "Season of Seeds", startsOn: "2000-01-01", endsOn: "2098-12-31" };

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

describe.skipIf(!configured)("a proposal's links and files at the intake, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  let gate = "";
  let dir = "";
  const state = { sent: [] as OutgoingEmail[], answer: { status: "sent", messageId: "m-1" } as PostResult };
  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "proposal-files-"));
    await q("INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-land', 'Land Circle', '[]', 0)");
    gate = await createOrgRole(pool, { id: "opa-role-gate", name: "Gate Keeper", seats: 2, circleId: "c-land", aim: "Open the gate at dawn." });
    const app = express();
    app.use(express.json());
    register(app, {
      getPool: () => pool,
      overLimit: async () => false,
      clientIp: () => "203.0.113.9",
      guardCapability: async (_req: any, res: any) => {
        res.status(401).json({ error: "auth_required" });
        return false;
      },
      authedUser: async () => null,
      commsPostOffice: { getPool: () => pool },
      deploymentOrigin: () => ORIGIN,
      projectName: () => "Test Village",
      escapeHtml,
      seasonState: () => ({ current: NOW_SEASON, seasons: [NOW_SEASON, NEXT], timezone: "UTC" }),
      postEmail: async (email: OutgoingEmail) => {
        state.sent.push(email);
        return state.answer;
      },
      governanceLifecycle: () => "public",
      notify: async () => ({ fresh: true }),
      notifyAdmins: async () => undefined,
      members: usersRepo(pool),
      liveHoldersOf: async () => [],
      rolesCarrying: () => [],
      loadRoleHolders: () => [],
      seatCalendar: () => ({ seasons: [NOW_SEASON, NEXT], currentSeasonId: "s-now", timezone: "UTC" }),
      lapse: () => ({ currentSeasonId: "s-now", cadence: "season_turn" }),
      stageOf: async () => "guest",
      recordStageEvent: async () => undefined,
      proposalFileDir: dir,
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
    if (dir) await fs.promises.rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    state.sent.length = 0;
    state.answer = { status: "sent", messageId: "m-1" };
  });

  let n = 0;
  const proposal = (over: Record<string, unknown> = {}) => ({
    name: "Rowan Field",
    email: `rowan${++n}@example.test`,
    roles: [{ roleId: gate, note: "I open gates for a living." }],
    why: "I live up the road and the gate is always shut.",
    aim: "The gate opens at dawn every day.",
    ...over,
  });

  const postJson = async (body: unknown) => {
    const res = await fetch(`${base}/api/open-proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); // module-review-ok: a test calling its own local server
    return { status: res.status, body: (await res.json()) as any };
  };

  const postFiles = async (body: unknown, files: Array<{ name: string; bytes: Buffer; type?: string }>) => {
    const fd = new FormData();
    fd.append("proposal", JSON.stringify(body));
    for (const f of files) fd.append("files", new Blob([f.bytes], { type: f.type ?? "application/octet-stream" }), f.name);
    const res = await fetch(`${base}/api/open-proposals`, { method: "POST", body: fd }); // module-review-ok: a test calling its own local server
    return { status: res.status, body: (await res.json()) as any };
  };

  const lastId = () => state.sent[state.sent.length - 1].idempotencyKey.split(":")[1];
  const folders = async () => (await fs.promises.readdir(dir)).sort();

  it("keeps checked links on the proposal, and refuses a bad one with the field named", async () => {
    const ok = await postJson(proposal({ links: [{ label: "Portfolio", url: "https://work.example.org/me" }, { label: "", url: "" }] }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await readOpenProposal(pool, lastId()))?.body.links).toEqual([{ label: "Portfolio", url: "https://work.example.org/me" }]);
    const bad = await postJson(proposal({ links: [{ label: "Mine", url: "http://work.example.org/me" }] }));
    expect(bad).toEqual({ status: 400, body: { error: ATTACHMENT_WORDS.linkNotHttps, field: "links" } });
  });

  it("keeps files sent with the proposal in its own private folder, named on the row by kind, size and fingerprint", async () => {
    const before = await folders();
    const r = await postFiles(proposal(), [
      { name: "My CV.pdf", bytes: PDF, type: "application/pdf" },
      { name: "garden.png", bytes: PNG, type: "image/png" },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const id = lastId();
    const row = await readOpenProposal(pool, id);
    expect(row?.body.files?.map((f) => [f.kind, f.name, f.size])).toEqual([
      ["pdf", "My CV.pdf", PDF.length],
      ["png", "garden.png", PNG.length],
    ]);
    expect(await folders()).toEqual([...before, id].sort());
    const onDisk = (await fs.promises.readdir(path.join(dir, id))).sort();
    expect(onDisk).toEqual(row!.body.files!.map((f) => `${f.id}.${f.kind}`).sort());
    // CONTROL: the same bytes under the browser's other words are still read by their bytes.
    const lied = await postFiles(proposal(), [{ name: "cv.pdf", bytes: PNG, type: "application/pdf" }]);
    expect(lied).toEqual({ status: 400, body: { error: ATTACHMENT_WORDS.fileWrongType, field: "files" } });
  });

  it("keeps nothing when a file is refused: no row, no folder", async () => {
    const before = await folders();
    const sent = state.sent.length;
    for (const files of [
      [{ name: "page.html", bytes: Buffer.from("<script>alert(1)</script>") }],
      [{ name: "run.pdf", bytes: Buffer.from("MZ\x90\x00 not a pdf") }],
      [{ name: "a.pdf", bytes: PDF }, { name: "b.pdf", bytes: PDF }, { name: "c.pdf", bytes: PDF }, { name: "d.pdf", bytes: PDF }],
    ]) {
      const r = await postFiles(proposal(), files);
      expect(r.status, files.map((f) => f.name).join()).toBe(400);
      expect(r.body.field).toBe("files");
    }
    const big = await postFiles(proposal(), [{ name: "big.pdf", bytes: Buffer.concat([PDF, Buffer.alloc(PROPOSAL_FILE_MAX_BYTES)]) }]);
    expect(big).toEqual({ status: 413, body: { error: ATTACHMENT_WORDS.fileTooBig, field: "files" } });
    expect(state.sent.length).toBe(sent);
    expect(await folders()).toEqual(before);
  });

  it("keeps nothing, files included, when the confirmation email did not go", async () => {
    const before = await folders();
    state.answer = { status: "failed", error: "provider down" } as any;
    const r = await postFiles(proposal(), [{ name: "cv.pdf", bytes: PDF }]);
    expect(r.status).toBe(503);
    expect(await readOpenProposal(pool, lastId())).toBeNull();
    expect(await folders()).toEqual(before);
  });

  it("the tidy job: files go with a proposal never confirmed in 48 hours, and links and files go with the name and address at 90 days", async () => {
    await postFiles(proposal(), [{ name: "cv.pdf", bytes: PDF }]);
    const stale = lastId();
    await postFiles(proposal({ links: [{ label: "Portfolio", url: "https://work.example.org/me" }] }), [{ name: "cv.pdf", bytes: PDF }]);
    const declined = lastId();
    await postFiles(proposal({ links: [{ label: "Portfolio", url: "https://work.example.org/you" }] }), [{ name: "cv.pdf", bytes: PDF }]);
    const recent = lastId();
    await q("UPDATE open_role_proposals SET created_at = ? WHERE id = ?", [new Date(Date.now() - 49 * 60 * 60_000), stale]);
    await q("UPDATE open_role_proposals SET status = 'declined', confirmed_at = ?, decided_at = ? WHERE id = ?", [new Date(), new Date(Date.now() - 91 * 24 * 60 * 60_000), declined]);
    await q("UPDATE open_role_proposals SET status = 'declined', confirmed_at = ?, decided_at = ? WHERE id = ?", [new Date(), new Date(Date.now() - 10 * 24 * 60 * 60_000), recent]);
    // A folder left by a crash between the files and the row: no row names it.
    const orphan = "op-00000000000000000000";
    await fs.promises.mkdir(path.join(dir, orphan), { recursive: true });

    const said = await tidyOpenProposals(pool, new Date(), dir);
    expect(said).toMatch(/file folders removed$/);
    const left = await folders();
    expect(left).not.toContain(stale);
    expect(left).not.toContain(declined);
    expect(left).not.toContain(orphan);
    expect(await readOpenProposal(pool, stale)).toBeNull();
    const gone = await readOpenProposal(pool, declined);
    expect(gone).toMatchObject({ name: null, email: null });
    expect(gone?.body.links).toBeUndefined();
    expect(gone?.body.files).toBeUndefined();
    // CONTROL: a decision ten days old keeps its links, its files and its folder.
    expect(left).toContain(recent);
    const kept = await readOpenProposal(pool, recent);
    expect(kept?.body.links).toHaveLength(1);
    expect(kept?.body.files).toHaveLength(1);
  });
});
