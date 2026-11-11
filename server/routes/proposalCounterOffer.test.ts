/**
 * THE COUNTER-OFFER (joining lane PR 4), over real HTTP and the S5 scratch schema.
 *
 *   - EDIT GATE: whoever may adopt may edit; another member, the applicant and a visitor may not.
 *   - REVISIONS: each save appends one; nothing is overwritten; a stale save is refused.
 *   - HISTORY is served to deciders only; the applicant reads the current offer and never the log.
 *   - THE APPLICANT answers the changed settings, and only those.
 *   - ONE UPDATE PER REVISION, on a key that carries the revision number.
 *   - ADOPTION warns while a setting is still being talked about, and goes through on a second yes.
 */
import { checkConsentVersion } from "../../shared/proposalAbout";
import { moonTermFor } from "../../shared/openProposalTerm";
import { activeClock } from "../lib/gratitude-cycles";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { consentClosesAt, CONSENT_WORDS } from "../../shared/roleProposalConsent";
import { DECIDE_WORDS, openInviteId } from "../../shared/openProposalDecide";
import { userParty } from "../../shared/alignments";
import { whoMayPutHandToVillage } from "../../shared/powerHands";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { escapeHtml } from "../lib/comms/mailer";
import { recordAlignment } from "../lib/alignmentSubjects";
import { heldTermsFor } from "../lib/heldTerms";
import { makeInviteDoor } from "../lib/inviteDoor";
import { openProposalsWaitingOn } from "../lib/openProposalDecide";
import { createOrgRole, seatHolder } from "../lib/orgChart";
import { runSeasonTurn } from "../lib/seasonTurn";
import { readOpenProposal } from "../repos/openProposals";
import { usersRepo } from "../repos/users";
import { register, tidyOpenProposals } from "./openProposals";

const configured = testDbConfigured();
if (!configured) console.warn("[openProposalDecide] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const ORIGIN = "https://village.example.test";
// Before 2038: a term is a TIMESTAMP, and a season ending later cannot be held (shared/seatTerms.ts RECORD_LIMIT).
const NEXT = { id: "s-next", name: "Season of Roots", startsOn: "2037-01-01", endsOn: "2037-03-20" };
const NOW_SEASON = { id: "s-now", name: "Season of Seeds", startsOn: "2000-01-01", endsOn: "2037-01-01" };
const FOUNDER = { id: "u-founder", name: "Fern Oak", email: "founder@example.test" };
const ANA = { id: "u-ana", name: "Ana Reed", email: "ana@example.test" };
const BEN = { id: "u-ben", name: "Ben Moss", email: "ben@example.test" };
const MO = { id: "u-mo", name: "Mo Hill", email: "mo@example.test" };
const HAS = { id: "u-has", name: "Rowan Field", email: "rowan-has@example.test" };
const HIGH = { id: "u-high", name: "Hal Pine", email: "hal@example.test" };
/** An account whose exit was resolved and who was never admitted again: a former member. */
const LEFT = { id: "u-left", name: "Lee Gone", email: "left@example.test" };

describe.skipIf(!configured)("open role proposals, the decision, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  let gate = "";
  let well = "";
  let founderRole = "";
  /** The private folder a proposal's files are kept in (Rye, 10 Nov 2026). */
  let fileDir = "";

  const state = {
    viewer: null as string | null,
    guests: [] as string[],
    powerHolders: [FOUNDER.id] as string[],
    sent: [] as OutgoingEmail[],
    answer: { status: "sent", messageId: "m-1" } as PostResult,
    notices: [] as Array<{ userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }>,
    adminNotices: [] as Array<{ type: string; title: string; key: string }>,
    stageEvents: [] as Array<{ userId: string; from: string; to: string; reason: string }>,
  };

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned
  const calendar = () => ({ seasons: [NOW_SEASON, NEXT], currentSeasonId: "s-now", timezone: "UTC" });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    fileDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "proposal-decide-files-"));
    const users = usersRepo(pool);
    for (const p of [FOUNDER, ANA, BEN, MO, HAS, HIGH]) await users.add({ id: p.id, name: p.name, email: p.email, passwordHash: "x", paths: [] } as any);
    await users.update(HIGH.id, (u: any) => {
      u.stageGranted = "co-creator";
    });
    await q("INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-land', 'Land Circle', '[]', 0), ('c-core', 'Core Circle', '[]', 0)");
    gate = await createOrgRole(pool, { id: "opd-role-gate", name: "Gate Keeper", seats: 2, circleId: "c-land", aim: "Open the gate at dawn." });
    well = await createOrgRole(pool, { id: "opd-role-well", name: "Well Keeper", seats: 2, circleId: "c-land", aim: "Keep the well clean." });
    const orchard = await createOrgRole(pool, { id: "opd-role-orchard", name: "Orchard Keeper", seats: 1, circleId: "c-land", aim: "Tend the trees." });
    const compost = await createOrgRole(pool, { id: "opd-role-compost", name: "Compost Keeper", seats: 2, circleId: "c-land", aim: "Turn the heap." });
    founderRole = await createOrgRole(pool, { id: "opd-role-founder", name: "Founder", seats: 1, circleId: "c-core", aim: "Hold the village." });
    const until = new Date("2036-12-01T00:00:00Z");
    await seatHolder(pool, orchard, { userId: ANA.id, seasonId: "s-now", termEndsAt: until });
    await seatHolder(pool, compost, { userId: BEN.id, seasonId: "s-now", termEndsAt: until });
    // The proposer's own account holds a role in the circle too: it is never asked about its own proposal.
    await seatHolder(pool, compost, { userId: HAS.id, seasonId: "s-now", termEndsAt: until });
    await seatHolder(pool, founderRole, { userId: FOUNDER.id, seasonId: "s-now", termEndsAt: until });

    const app = express();
    app.use(express.json());
    register(app, {
      getPool: () => pool,
      overLimit: async () => false,
      clientIp: () => "203.0.113.9",
      guardCapability: async (_req: any, res: any, cap: string, refusal?: { status: number; body: unknown }) => {
        const ok = !!state.viewer && (cap === "terms.read" ? !state.guests.includes(state.viewer) : state.viewer === FOUNDER.id);
        if (ok) return true;
        if (refusal) res.status(refusal.status).json(refusal.body);
        else res.status(state.viewer ? 403 : 401).json({ error: state.viewer ? "forbidden" : "auth_required" });
        return false;
      },
      authedUser: async () => (state.viewer ? await usersRepo(pool).byId(state.viewer) : null),
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
      notify: async (n: any) => {
        state.notices.push(n);
        return { fresh: true };
      },
      notifyAdmins: async (type: string, title: string, key: string) => {
        state.adminNotices.push({ type, title, key });
      },
      members: usersRepo(pool),
      firstName: (name: string) => String(name ?? "").trim().split(/\s+/)[0] ?? "",
      liveHoldersOf: async () => state.powerHolders,
      rolesCarrying: () => [{ id: founderRole, name: "Founder" }],
      loadRoleHolders: () => [{ roleId: founderRole, userId: FOUNDER.id }],
      seatCalendar: calendar,
      lapse: () => ({ currentSeasonId: "s-now", cadence: "season_turn" }),
      stageOf: async (u: any) => (u.stageGranted ? String(u.stageGranted) : "guest"),
      recordStageEvent: async (u: any, from: string, to: string, reason: string) => {
        state.stageEvents.push({ userId: String(u.id), from, to, reason });
      },
      sessionsOn: () => false,
      proposalFileDir: fileDir,
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
    if (fileDir) await fs.promises.rm(fileDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    state.viewer = null;
    state.guests = [];
    state.powerHolders = [FOUNDER.id];
    state.sent.length = 0;
    state.answer = { status: "sent", messageId: "m-1" };
    state.notices.length = 0;
    state.adminNotices.length = 0;
    state.stageEvents.length = 0;
    await q("DELETE FROM capability_holding WHERE capability = 'org.seat'");
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

  /*
   * The emailed link is found by comparing ORIGIN, not by prefix.
   * `l.startsWith(ORIGIN)` also matches
   * `https://village.example.test.somewhere-else.com/...`, because the origin
   * can be followed by an arbitrary host. CodeQL refuses that as incomplete
   * URL substring sanitization (alert 468) and it is the same
   * startsWith-is-not-same-origin shape this repository has already been bitten
   * by in product code. Parsing the line and comparing `origin` is exact, and a
   * line that is not a URL is simply not the link.
   */
  const isLink = (line: string) => {
    try {
      return new URL(line.trim()).origin === new URL(ORIGIN).origin;
    } catch {
      return false;
    }
  };
  const tokenOf = (mail: OutgoingEmail) =>
    new URL((mail.text.split("\n").find(isLink) as string).trim()).searchParams.get("token") as string;

  /** Send a proposal as somebody with no account, and answer its id and the confirmation token. */
  const send = async (email: string, roles: string[] = [gate]) => {
    const before = state.sent.length;
    const r = await call("POST", "/api/open-proposals", {
      name: "Rowan Field",
      email,
      roles: roles.map((roleId) => ({ roleId, note: "I open gates for a living." })),
      why: "I live up the road and the gate is always shut.",
      aim: "The gate opens at dawn every day.",
    }, null);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const mail = state.sent[before];
    return { id: mail.idempotencyKey.split(":")[1], token: tokenOf(mail) };
  };

  /** Send and confirm. The notices and mail so far are cleared, so a test reads only what follows. */
  const confirmed = async (email: string, roles: string[] = [gate]) => {
    const p = await send(email, roles);
    const ok = await call("POST", "/api/open-proposals/confirm", { token: p.token }, null);
    expect(ok.status).toBe(200);
    return p;
  };

  const asksOf = (id: string) => q("SELECT user_id, circle_id, answer, reason, UNIX_TIMESTAMP(closes_at) AS closes_s FROM role_proposal_asks WHERE proposal_id = ? ORDER BY user_id", [id]);
  const page = (id: string, as: string | null) => call("GET", `/api/governance/open-proposals/${id}`, undefined, as);
  const linkOf = (body: any): string => String(body?.invitation?.link ?? "");
  const inviteToken = (link: string) => new URL(link).searchParams.get("invite") as string;
  /** A JSON column, as the driver hands it back: parsed already on MySQL, text on MariaDB. */
  const idsOf = (v: unknown): unknown => (Array.isArray(v) ? v : JSON.parse(String(v)));


  const FOUNDER_OFFER = JSON.stringify({ v: 1, clocks: { commitmentPct: 100 }, words: { term: "We renew together each moon.", ending: "Either of us can end it with one moon's notice." } });
  const card = (answers: Record<string, unknown>) => ({
    roles: [], serves: [], hours: "", commitmentPct: 60, agreed: { loveLetter: true, nda: true },
    terms: { choice: "accept", note: "", answers },
  });
  /** A confirmed proposal from the HAS account's address, with a terms card the way PR 3 stores it. */
  const proposalWithCard = async (answers: Record<string, unknown>, email = "rowan-has@example.test") => {
    await q("UPDATE org_roles SET terms_offer = ? WHERE id = ?", [FOUNDER_OFFER, gate]);
    const p = await confirmed(email, [gate]);
    await q("UPDATE open_role_proposals SET body_json = JSON_SET(body_json, '$.card', CAST(? AS JSON)) WHERE id = ?", [JSON.stringify(card(answers)), p.id]);
    return p;
  };
  const A = { choice: "accept", note: "" };
  const save = (id: string, body: unknown, as: string | null = FOUNDER.id) => call("POST", `/api/governance/open-proposals/${id}/terms`, body, as);
  const termsMails = () => state.sent.filter((m) => m.origin === "open_proposal.update" && m.subject === "The terms for your proposal changed");
  const bodyOf = async (id: string) => {
    const [row] = await q("SELECT body_json FROM open_role_proposals WHERE id = ?", [id]);
    return typeof row.body_json === "string" ? JSON.parse(row.body_json) : row.body_json;
  };

  describe("who may edit the terms", () => {
    it("a live holder of the seating power may; another member, the applicant and a visitor may not", async () => {
      const { id } = await proposalWithCard({ term: A, ending: A });
      const words = { ending: "We part with two moons' notice." };
      expect((await save(id, { words, expectedRevision: 0 }, null)).status).toBe(401);
      const other = await save(id, { words, expectedRevision: 0 }, MO.id);
      expect(other.status).toBe(403);
      expect(other.body.error).toBe("not_a_holder");
      const own = await save(id, { words, expectedRevision: 0 }, HAS.id);
      expect(own.status).toBe(403);
      expect(own.body.error).toBe("own_proposal");
      // An asked holder who does not hold the seating power reads, and cannot edit.
      expect((await save(id, { words, expectedRevision: 0 }, ANA.id)).status).toBe(403);
      expect((await bodyOf(id)).counterOffer).toBeUndefined();
      const ok = await save(id, { words, expectedRevision: 0 });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect((await bodyOf(id)).counterOffer.revisions).toHaveLength(1);
    });

    it("nobody edits once the power sits with nobody at the door", async () => {
      const { id } = await proposalWithCard({ term: A });
      state.powerHolders = [];
      const r = await save(id, { words: { term: "x" }, expectedRevision: 0 });
      expect(r.status).toBe(403);
    });
  });

  describe("revisions and history", () => {
    it("appends one revision per save, keeps what was there, and refuses a stale save", async () => {
      const { id } = await proposalWithCard({ term: A, ending: A });
      const one = await save(id, { words: { ending: "Two moons' notice." }, commitmentPct: 80, expectedRevision: 0 });
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body.offer.revision).toBe(1);
      const two = await save(id, { words: { ending: "Three moons' notice.", term: "Each moon we renew." }, expectedRevision: 1 });
      expect(two.body.offer.revision).toBe(2);
      // The same save again, as a retry would send it: refused, and nothing is added.
      const stale = await save(id, { words: { ending: "Three moons' notice." }, expectedRevision: 1 });
      expect(stale.status).toBe(409);
      // An edit that changes nothing is not a revision.
      const same = await save(id, { words: { ending: "Three moons' notice." }, expectedRevision: 2 });
      expect(same.status).toBe(400);

      const stored = (await bodyOf(id)).counterOffer.revisions;
      expect(stored.map((r: any) => r.n)).toEqual([1, 2]);
      expect(stored[0].changes).toEqual([
        { key: "ending", from: "Either of us can end it with one moon's notice.", to: "Two moons' notice." },
        { key: "commitment", from: "60", to: "80" },
      ]);
      expect(stored[1].changes.find((c: any) => c.key === "ending")).toMatchObject({ from: "Two moons' notice.", to: "Three moons' notice." });
      expect(stored[0].byId).toBe(FOUNDER.id);

      const seen = (await page(id, FOUNDER.id)).body.proposal;
      expect(seen.offer.history.map((h: any) => h.n)).toEqual([2, 1]);
      expect(seen.offer.history[1].by).toBe(FOUNDER.name);
      expect(seen.offer.rows.find((r: any) => r.key === "ending")).toMatchObject({ suggested: "Either of us can end it with one moon's notice.", current: "Three moons' notice.", state: "waiting" });
      expect(seen.offer.ourCommitment).toBe(80);
      expect(seen.you.mayEditTerms).toBe(true);
    });

    it("is read by deciders only: an asked holder sees it and cannot edit, an outside member and the applicant see none of it", async () => {
      const { id } = await proposalWithCard({ term: A, ending: A });
      await save(id, { words: { ending: "Two moons' notice." }, expectedRevision: 0 });
      const asked = (await page(id, ANA.id)).body.proposal;
      expect(asked.offer.history).toHaveLength(1);
      expect(asked.you.mayEditTerms).toBe(false);
      expect((await page(id, MO.id)).body.proposal.offer).toBeNull();
      expect((await page(id, HAS.id)).body.proposal.offer).toBeNull();
      const status = (await call("GET", `/api/governance/applications/${id}/status`, undefined, HAS.id)).body.status;
      expect(JSON.stringify(status)).not.toContain("history");
      expect(JSON.stringify(status)).not.toContain(FOUNDER.name);
      expect(status.offer.revision).toBe(1);
    });
  });

  describe("the applicant answers the changed settings", () => {
    it("sees each changed setting beside their answer, accepts or talks again, and cannot answer one we did not change", async () => {
      const { id } = await proposalWithCard({ term: A, ending: { choice: "talk", note: "Two moons would suit me." } });
      await save(id, { words: { ending: "Two moons' notice." }, commitmentPct: 80, expectedRevision: 0 });
      const read = async () => (await call("GET", `/api/governance/applications/${id}/status`, undefined, HAS.id)).body.status.offer;
      const offer = await read();
      expect(offer.rows.map((r: any) => r.key)).toEqual(["ending", "commitment"]);
      expect(offer.rows[0]).toMatchObject({ ours: "Two moons' notice.", theirs: { choice: "talk", note: "Two moons would suit me." }, state: "waiting" });
      expect(offer.rows[1]).toMatchObject({ ours: "80%", theirCommitment: 60 });
      expect(offer.open).toBe(2);

      const unchanged = await call("POST", `/api/governance/applications/${id}/terms`, { replies: { term: { choice: "accept", note: "" } } }, HAS.id);
      expect(unchanged.status).toBe(400);
      const stranger = await call("POST", `/api/governance/applications/${id}/terms`, { replies: { ending: { choice: "accept", note: "" } } }, MO.id);
      expect(stranger.status).toBe(404);
      const done = await call("POST", `/api/governance/applications/${id}/terms`, { replies: { ending: { choice: "accept", note: "" }, commitment: { choice: "talk", note: "Closer to 70." } } }, HAS.id);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.body.offer.rows.map((r: any) => [r.key, r.state])).toEqual([["ending", "accept"], ["commitment", "talk"]]);
      expect((await bodyOf(id)).counterOffer.replies.commitment).toMatchObject({ choice: "talk", note: "Closer to 70.", rev: 1 });

      // Changed again: the old accept no longer counts, and the setting asks again. The one we did not touch stays as it was.
      await save(id, { words: { ending: "One moon's notice, and a handover." }, expectedRevision: 1 });
      const again = await read();
      expect(again.rows.find((r: any) => r.key === "ending").state).toBe("waiting");
      expect(again.rows.find((r: any) => r.key === "commitment").state).toBe("talk");
    });
  });

  describe("the applicant is told once per revision", () => {
    it("sends one email and one notice for each saved revision and none for a retry", async () => {
      const { id } = await proposalWithCard({ term: A });
      state.sent.length = 0;
      state.notices.length = 0;
      await save(id, { words: { term: "Each moon we renew, and the first three are a trial." }, expectedRevision: 0 });
      await save(id, { words: { term: "Each moon we renew, and the first three are a trial." }, expectedRevision: 0 });
      expect(termsMails()).toHaveLength(1);
      expect(termsMails()[0].idempotencyKey).toBe(`open-proposal:${id}:update:terms:1`);
      expect(termsMails()[0].to.email).toBe("rowan-has@example.test");
      await save(id, { words: { term: "We renew together each moon." }, expectedRevision: 1 });
      expect(termsMails().map((m) => m.idempotencyKey)).toEqual([`open-proposal:${id}:update:terms:1`, `open-proposal:${id}:update:terms:2`]);
      const bells = state.notices.filter((n) => n.type === "applicant_update" && n.userId === HAS.id);
      expect(bells.map((n) => n.dedupeKey)).toEqual([`op:${id}:update:terms:1:${HAS.id}`, `op:${id}:update:terms:2:${HAS.id}`]);
    });
  });

  describe("adoption", () => {
    it("warns while a setting is still being talked about, and adopts on the second yes", async () => {
      const { id } = await proposalWithCard({ term: A, ending: A });
      await save(id, { words: { ending: "Two moons' notice." }, expectedRevision: 0 });
      await call("POST", `/api/governance/applications/${id}/terms`, { replies: { ending: { choice: "talk", note: "Two moons would suit me." } } }, HAS.id);
      const warned = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(warned.status).toBe(409);
      expect(warned.body.error).toBe("terms_open");
      expect(warned.body.settings).toEqual(["Ending"]);
      expect((await page(id, FOUNDER.id)).body.proposal.offer.openTalks).toEqual(["Ending"]);
      expect((await readOpenProposal(pool, id))?.status).toBe("confirmed");
      const adopted = await call("POST", `/api/governance/open-proposals/${id}/adopt`, { confirmOpenTalks: true }, FOUNDER.id);
      expect(adopted.status, JSON.stringify(adopted.body)).toBe(200);
    });

    it("also warns for an unchanged setting still marked let's talk", async () => {
      await q("DELETE FROM seat_applications WHERE candidate_user_id = ?", [HAS.id]);
      const { id } = await proposalWithCard({ term: { choice: "talk", note: "Let's talk." }, ending: A });
      const warned = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(warned.status).toBe(409);
      expect(warned.body.settings).toEqual(["Term"]);
    });

    it("adopts at once when every changed setting is accepted", async () => {
      // The first test adopted for this account: its application is not the subject here.
      await q("DELETE FROM seat_applications WHERE candidate_user_id = ?", [HAS.id]);
      const { id } = await proposalWithCard({ term: A, ending: { choice: "talk", note: "Two moons." } });
      await save(id, { words: { ending: "Two moons' notice." }, expectedRevision: 0 });
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(409);
      await call("POST", `/api/governance/applications/${id}/terms`, { replies: { ending: { choice: "accept", note: "" } } }, HAS.id);
      const adopted = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(adopted.status, JSON.stringify(adopted.body)).toBe(200);
      // Decided: the terms are closed.
      expect((await save(id, { words: { ending: "x" }, expectedRevision: 1 })).status).toBe(409);
    });
  });

  // ── Audit B2 (11 Nov 2026): what was agreed is what is signed ──────────────
  describe("what was agreed is what is signed", () => {
    const appOf = async (userId: string) => {
      const [row] = await q("SELECT id, settings_json, deliverables, answers AS answers_json, text_id FROM seat_applications WHERE candidate_user_id = ? ORDER BY created_at DESC LIMIT 1", [userId]);
      const json = (v: unknown) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);
      return { ...row, settings: json(row.settings_json), answers: json(row.answers_json) };
    };

    it("carries the offer, the accepted revision, the answers and the commitment into the application and the words the holder aligns with", async () => {
      await q("DELETE FROM seat_applications WHERE candidate_user_id = ?", [HAS.id]);
      const { id } = await proposalWithCard({ term: A, ending: { choice: "talk", note: "Two moons would suit me." } });
      await save(id, { words: { ending: "Two moons' notice.", allowance: "Your accounting software is paid for." }, commitmentPct: 80, expectedRevision: 0 });
      await call("POST", `/api/governance/applications/${id}/terms`, { replies: { ending: { choice: "accept", note: "" }, allowance: { choice: "accept", note: "" }, commitment: { choice: "accept", note: "" } } }, HAS.id);
      const adopted = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(adopted.status, JSON.stringify(adopted.body)).toBe(200);

      const app = await appOf(HAS.id);
      // The settings: the role's words, the counter-offer on top, and the agreed commitment.
      expect(app.settings.words).toEqual({ term: "We renew together each moon.", ending: "Two moons' notice.", allowance: "Your accounting software is paid for." });
      expect(app.settings.clocks).toEqual({ commitmentPct: 80 });
      // The terms line comes from the FINAL answers: the talk on Ending was settled by accepting the revision.
      expect(String(app.deliverables)).toContain("Accepts the terms on offer.");
      expect(String(app.deliverables)).not.toContain("Wants to talk about the terms");
      expect(String(app.deliverables)).toContain("Commitment: 80%");
      expect(app.answers.terms).toMatchObject({ choice: "accept", commitmentPct: 80, answers: { ending: { choice: "accept" }, allowance: { choice: "accept" }, term: { choice: "accept" } } });

      // The words the holder aligns with say what was agreed, and do not leave those settings "to fill together".
      const [text] = await q("SELECT body FROM alignment_texts WHERE id = ?", [app.text_id]);
      const body = String(text.body);
      expect(body).toContain("Ending: Two moons' notice.");
      expect(body).toContain("Allowance: Your accounting software is paid for.");
      expect(body).toContain("Term: We renew together each moon.");
      expect(body).toContain("Clocks: Commitment: 80%");
      const together = body.split("\n").find((l) => l.startsWith("We'll fill")) ?? "";
      for (const label of ["Term", "Clocks", "Allowance", "Ending"]) expect(together).not.toContain(label);
    });

    it("records a setting still being talked about at an adopt-anyway as still open, never as accepted", async () => {
      await q("DELETE FROM seat_applications WHERE candidate_user_id = ?", [HAS.id]);
      const { id } = await proposalWithCard({ term: A, ending: A });
      await save(id, { words: { ending: "Two moons' notice." }, expectedRevision: 0 });
      const adopted = await call("POST", `/api/governance/open-proposals/${id}/adopt`, { confirmOpenTalks: true }, FOUNDER.id);
      expect(adopted.status, JSON.stringify(adopted.body)).toBe(200);
      const app = await appOf(HAS.id);
      expect(app.settings.words.ending).toBe("Two moons' notice.");
      expect(String(app.deliverables)).toContain("Wants to talk about the terms: Ending");
    });
  });

  // ── Audit B3 (11 Nov 2026): a full seat is never promised by accident ──────
  describe("adopting into a role with every seat taken", () => {
    let bee = "";
    beforeAll(async () => {
      bee = await createOrgRole(pool, { id: "opd-role-bee", name: "Bee Keeper", seats: 1, circleId: "c-land", aim: "Keep the hives." });
      // Seated for next season too, so the seat is still taken on the day a proposal for next season would start.
      await seatHolder(pool, bee, { userId: MO.id, seasonId: "s-next", termEndsAt: new Date("2037-03-20T00:00:00Z") });
    });

    it("refuses by default with the seat count, then adopts for when a seat opens and tells them so, never 'within the hour'", async () => {
      await q("DELETE FROM seat_applications WHERE candidate_user_id = ?", [HAS.id]);
      const { id } = await confirmed("rowan-has@example.test", [bee]);
      const page1 = (await page(id, FOUNDER.id)).body.proposal;
      expect(page1.beforeAdopt.seatsFull).toEqual([{ name: "Bee Keeper", seats: 1, taken: 1 }]);
      expect(page1.beforeAdopt.seatsWords).toContain("Bee Keeper has room for 1 person, and that place is filled");

      const refused = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toBe("seats_full");
      expect(refused.body.message).toContain("Bee Keeper has room for 1 person, and that place is filled");
      expect(refused.body.canAdoptForWhenASeatOpens).toBe(true);
      expect((await readOpenProposal(pool, id))?.status).toBe("confirmed");
      expect(state.sent.filter((m) => m.origin === "open_proposal.adopted")).toHaveLength(0);

      const adopted = await call("POST", `/api/governance/open-proposals/${id}/adopt`, { whenASeatOpens: true }, FOUNDER.id);
      expect(adopted.status, JSON.stringify(adopted.body)).toBe(200);
      expect(adopted.body.decided).toContain("for when a place opens");
      expect(adopted.body.message).toContain("Adopted for when a place opens");
      const letter = state.sent.filter((m) => m.origin === "open_proposal.adopted").pop();
      expect(letter?.text).toContain("Every place in Bee Keeper is filled right now, so your role starts when a place opens.");
      expect(letter?.text).not.toContain("within the hour");
      expect(letter?.text).not.toContain("Your roles start when");
      // P11: the letter says what comes next.
      expect(letter?.text).toContain("What comes next:");
    });

    it("counts an adopted invitation nobody has used yet as a place promised", async () => {
      const roomy = await createOrgRole(pool, { id: "opd-role-hive2", name: "Hive Helper", seats: 1, circleId: "c-land", aim: "Help the hives." });
      const first = await confirmed("first-hive@example.test", [roomy]);
      const one = await call("POST", `/api/governance/open-proposals/${first.id}/adopt`, {}, FOUNDER.id);
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      const second = await confirmed("second-hive@example.test", [roomy]);
      const two = await call("POST", `/api/governance/open-proposals/${second.id}/adopt`, {}, FOUNDER.id);
      expect(two.status).toBe(409);
      expect(two.body.error).toBe("seats_full");
      expect(two.body.message).toContain("Hive Helper has room for 1 person, and that place is filled");
    });
  });
});
