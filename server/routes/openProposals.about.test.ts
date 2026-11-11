/**
 * A PROPOSAL'S ABOUT-YOU SECTION AT THE INTAKE (joining lane PR 2), over real
 * HTTP and the scratch schema.
 *
 * What is pinned:
 *
 *   - References are validated (a half-filled one is refused, a blank row is dropped, a bad contact is refused).
 *   - The consent is required when the references are all blank, and when a role
 *     picked is always background-checked even if the references are given; it is
 *     stored with a timestamp and the wording version, and a stale version is refused.
 *   - A form from before the section still goes through and reads back.
 *   - Every removal path takes the references, the check and the facts with it:
 *     the 48-hour unconfirmed deletion, the 90-day removal after a no, an
 *     undecided proposal expiring, an adopted one's 90 days, and a member's
 *     erasure of their own application.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { checkConsentVersion, ABOUT_WORDS } from "../../shared/proposalAbout";
import { insertApplication, readApplication, eraseApplicationWords } from "../repos/seatApplications";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { escapeHtml } from "../lib/comms/mailer";
import { createOrgRole } from "../lib/orgChart";
import { createInviteOn } from "../repos/memberInvites";
import { openInviteId } from "../../shared/openProposalDecide";
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

describe.skipIf(!configured)("a proposal's About-you section at the intake, on a real schema", () => {
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
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "proposal-about-"));
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
  const refs = [
    { name: "Ines Vargas", how: "We built a fence together", contact: "ines.vargas@example.org" },
    { name: "Tomas Rey", how: "My neighbour for ten years", contact: "+506 8888 1234" },
  ];
  const consent = () => ({ given: true, version: checkConsentVersion() });
  const dayAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000);

  it("keeps references, facts and the check, with the day and the wording version of the consent", async () => {
    const ok = await postJson(proposal({ references: [...refs, { name: "", how: "", contact: "" }], about: { based: "Uvita", languages: "Spanish", story: "I came to a workday." }, checkConsent: consent() }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const body = (await readOpenProposal(pool, lastId()))!.body;
    expect(body.references).toEqual(refs);
    expect(body.about).toEqual({ based: "Uvita", languages: "Spanish", story: "I came to a workday." });
    expect(body.backgroundCheck).toMatchObject({ needed: false, because: null, consent: { version: checkConsentVersion() } });
    expect(Date.now() - Date.parse(body.backgroundCheck!.consent!.at)).toBeLessThan(60_000);
  });

  it("refuses a half-filled reference and a contact nobody could reach, with the field named", async () => {
    const half = await postJson(proposal({ references: [{ name: "Ines", how: "", contact: "" }], checkConsent: consent() }));
    expect(half).toEqual({ status: 400, body: { error: ABOUT_WORDS.referenceNeedsAll, field: "references" } });
    const bad = await postJson(proposal({ references: [{ name: "Ines", how: "Fence", contact: "see me" }], checkConsent: consent() }));
    expect(bad).toEqual({ status: 400, body: { error: ABOUT_WORDS.referenceContact, field: "references" } });
    const four = await postJson(proposal({ references: [...refs, { name: "A", how: "b", contact: "a@example.org" }, { name: "B", how: "c", contact: "b@example.org" }] }));
    expect(four.status).toBe(400);
  });

  it("CONSENT: required when the references are all blank, refused with none", async () => {
    const none = await postJson(proposal({ references: [] }));
    expect(none).toEqual({ status: 400, body: { error: ABOUT_WORDS.needConsent, field: "checkConsent" } });
    const ticked = await postJson(proposal({ references: [], checkConsent: consent() }));
    expect(ticked.status, JSON.stringify(ticked.body)).toBe(200);
    expect((await readOpenProposal(pool, lastId()))!.body.backgroundCheck).toMatchObject({ needed: true, because: "no_references" });
    // CONTROL: with references given, no tick is needed.
    expect((await postJson(proposal({ references: refs }))).status).toBe(200);
  });

  it("CONSENT: required for an always-checked role whatever the references say, and a stale wording version is refused", async () => {
    await q("UPDATE org_roles SET always_checked = 1 WHERE id = ?", [gate]);
    try {
      const refused = await postJson(proposal({ references: refs }));
      expect(refused).toEqual({ status: 400, body: { error: ABOUT_WORDS.needConsent, field: "checkConsent" } });
      const stale = await postJson(proposal({ references: refs, checkConsent: { given: true, version: "cc-00000000" } }));
      expect(stale).toEqual({ status: 400, body: { error: ABOUT_WORDS.consentChanged, field: "checkConsent" } });
      const ok = await postJson(proposal({ references: refs, checkConsent: consent() }));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect((await readOpenProposal(pool, lastId()))!.body.backgroundCheck).toMatchObject({ needed: true, because: "role" });
      // The form is told which roles are always checked.
      const form = await (await fetch(`${base}/api/open-proposals/form`)).json(); // module-review-ok: a test calling its own local server
      expect(form.roles.find((r: any) => r.id === gate).alwaysChecked).toBe(true);
    } finally {
      await q("UPDATE org_roles SET always_checked = 0 WHERE id = ?", [gate]);
    }
  });

  it("LEGACY: a proposal sent without the section is still taken and reads back with none of it", async () => {
    const ok = await postJson(proposal());
    expect(ok.status).toBe(200);
    const body = (await readOpenProposal(pool, lastId()))!.body;
    expect(body.references).toBeUndefined();
    expect(body.backgroundCheck).toBeUndefined();
    expect(body.about).toBeUndefined();
  });

  it("REMOVAL: every path that takes the name and address takes the references, the check and the facts with it", async () => {
    const send = async () => {
      await postJson(proposal({ references: refs, about: { based: "Uvita" }, checkConsent: consent() }));
      return lastId();
    };
    const never = await send(); // never confirmed: deleted at 48 hours
    const declined = await send(); // declined: removed at 90 days
    const expired = await send(); // confirmed, undecided: expires at 90 days
    const adopted = await send(); // adopted, invitation never used: removed at 90 days
    const recent = await send(); // CONTROL: a decision ten days old keeps them
    await q("UPDATE open_role_proposals SET created_at = ? WHERE id = ?", [new Date(Date.now() - 49 * 60 * 60_000), never]);
    await q("UPDATE open_role_proposals SET status = 'declined', confirmed_at = ?, decided_at = ? WHERE id = ?", [new Date(), dayAgo(91), declined]);
    await q("UPDATE open_role_proposals SET status = 'confirmed', confirmed_at = ? WHERE id = ?", [dayAgo(91), expired]);
    await q("UPDATE open_role_proposals SET status = 'adopted', confirmed_at = ?, decided_at = ? WHERE id = ?", [dayAgo(95), dayAgo(91), adopted]);
    await q("UPDATE open_role_proposals SET status = 'declined', confirmed_at = ?, decided_at = ? WHERE id = ?", [new Date(), dayAgo(10), recent]);

    // A real adoption makes an invitation; without one the person is a member already and keeps theirs, so the fixture needs it unused.
    const conn = await pool.getConnection();
    try {
      await createInviteOn(conn, { id: openInviteId(adopted), tokenHash: `h-${adopted}`, inviterUserId: "u-inviter", days: 30 });
    } finally {
      conn.release();
    }

    await tidyOpenProposals(pool, new Date(), dir);

    expect(await readOpenProposal(pool, never)).toBeNull();
    const rows = await q("SELECT id, body_json FROM open_role_proposals WHERE id IN (?, ?, ?)", [declined, expired, adopted]);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const text = typeof r.body_json === "string" ? r.body_json : JSON.stringify(r.body_json);
      for (const secret of ["Ines Vargas", "ines.vargas", "Tomas Rey", "8888 1234", "Uvita", "backgroundCheck", "references"]) expect(text, `${r.id}: ${secret}`).not.toContain(secret);
    }
    // CONTROL: ten days after a no, they are kept.
    const kept = (await readOpenProposal(pool, recent))!;
    expect(kept.body.references).toHaveLength(2);
    expect(kept.body.backgroundCheck?.consent).toBeTruthy();
  });

  it("REMOVAL: a withdrawn or not-adopted member-door application loses references, check and about after 90 days; a 10-day one and an open one keep them", async () => {
    await q("INSERT IGNORE INTO users (id, name, email) VALUES ('u-sweep', 'Sweep', 'sweep@example.test')").catch(() => undefined);
    const make = async (id: string, status: "withdrawn" | "not-adopted" | "awaiting-holder", daysAgo: number | null) => {
      await insertApplication(pool, {
        id, candidateUserId: "u-sweep", proposedBy: "u-sweep", seatIds: [gate], note: "why", deliverables: null, settings: {} as any, settingsHash: "h",
        termEndsAt: new Date(Date.now() + 86_400_000), termSeasonId: null, termFollowsSeason: false, startsAt: null, status,
        answers: { aim: "keep this", servesGoal: null, timeZone: null, windows: [], earliestStart: null, terms: null, goals: [], references: refs, about: { based: "Uvita" }, backgroundCheck: { needed: false, because: null } },
      });
      if (daysAgo !== null) await q("UPDATE seat_applications SET decided_at = ? WHERE id = ?", [new Date(Date.now() - daysAgo * 86_400_000), id]);
    };
    await make("sa-00000000000000f1", "withdrawn", 91);
    await make("sa-00000000000000f2", "not-adopted", 91);
    await make("sa-00000000000000f3", "withdrawn", 10);
    await make("sa-00000000000000f4", "awaiting-holder", null);
    await tidyOpenProposals(pool, new Date(), dir);
    for (const id of ["sa-00000000000000f1", "sa-00000000000000f2"]) {
      const a = (await readApplication(pool, id))!;
      expect(a.answers?.references, id).toBeUndefined();
      expect(a.answers?.about, id).toBeUndefined();
      expect(a.answers?.backgroundCheck, id).toBeUndefined();
      expect(a.answers?.aim, id).toBe("keep this");
    }
    for (const id of ["sa-00000000000000f3", "sa-00000000000000f4"]) expect((await readApplication(pool, id))!.answers?.references, id).toHaveLength(2);
  });

  it("REMOVAL: a member's erasure clears the references, the check and the facts of their own application", async () => {
    await q("INSERT IGNORE INTO users (id, name, email) VALUES ('u-eraser', 'Eraser', 'eraser@example.test')").catch(() => undefined);
    await insertApplication(pool, {
      id: "sa-00000000000000e1",
      candidateUserId: "u-eraser",
      proposedBy: "u-eraser",
      seatIds: [gate],
      note: "why",
      deliverables: null,
      settings: {} as any,
      settingsHash: "h",
      termEndsAt: new Date(Date.now() + 86_400_000),
      termSeasonId: null,
      termFollowsSeason: false,
      startsAt: null,
      status: "awaiting-holder",
      answers: { aim: "a", servesGoal: null, timeZone: null, windows: [], earliestStart: null, terms: null, goals: [], references: refs, about: { based: "Uvita" }, backgroundCheck: { needed: false, because: null } },
    });
    expect((await readApplication(pool, "sa-00000000000000e1"))!.answers?.references).toHaveLength(2);
    await eraseApplicationWords(pool, "u-eraser");
    const after = await readApplication(pool, "sa-00000000000000e1");
    expect(after!.answers).toBeNull();
    const raw = await q("SELECT answers FROM seat_applications WHERE id = 'sa-00000000000000e1'");
    expect(raw[0].answers).toBeNull();
  });
});
