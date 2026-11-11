/**
 * OPEN ROLE PROPOSALS, THE DECISION (part B), over real HTTP and the S5
 * scratch schema, with the mail door handed in as a fake that records what
 * would go out. Nothing here reaches a provider.
 *
 * What is pinned:
 *
 *   - NOTHING UNCONFIRMED REACHES A PERSON (coordinator, 2026-10-31): a sent
 *     proposal asks nobody and rings nobody; its page answers 404.
 *   - CONFIRMING ASKS THE CIRCLE: every live holder of a role in the proposed
 *     roles' circles, once each, the proposer's own account excluded, with 2
 *     business days; the holders of the power that seats people hear it waits
 *     on them; every notice on a stable key.
 *   - THE PAGE: members only; the proposer by first name and never their
 *     address; an asked holder consents or objects, with a reason, once.
 *   - WHO DECIDES (Rye, 2026-10-31): a live holder of `org.seat`, never on
 *     their own proposal; after a handover nobody decides at the door, and the
 *     page says so.
 *   - ADOPTION: an address with no account gets a one-use invitation named
 *     after the proposal, by essential email, and the decider always gets the
 *     link back with whether it went; an address with an account is raised to
 *     the Member stage and given the roles for the target season, which the
 *     season turn seats on its first day; the sign-up an invitation makes is
 *     too, through the door both sign-up routes share.
 *   - A CONFIRM LINK REPLAYED AFTER ADOPTION (coordinator, 2026-10-31): 410,
 *     and nothing moves.
 *   - DECLINING sets decided_at, so the tidy job finds it, and sends a kind no.
 *   - The task board: an asked holder's consent row, a decider's adopt row.
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

  describe("nothing unconfirmed reaches a person", () => {
    it("a sent proposal asks nobody and rings nobody, and its page is not there", async () => {
      const { id } = await send("quiet@example.test");
      expect(await asksOf(id)).toEqual([]);
      expect(state.notices).toEqual([]);
      expect((await page(id, FOUNDER.id)).status).toBe(404);
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(404);
    });
  });

  describe("confirming asks the circle", () => {
    it("asks every other live holder in the roles' circles once, for 2 business days, and tells the deciders, each on a stable key", async () => {
      const before = new Date();
      const { id, token } = await confirmed("rowan-has@example.test", [gate, well]);
      const after = new Date();
      const asks = await asksOf(id);
      // Ana and Ben hold roles in the Land Circle; the proposer's own account (u-has) is not asked.
      expect(asks.map((a: any) => [a.user_id, a.circle_id, a.answer])).toEqual([
        [ANA.id, "c-land", null],
        [BEN.id, "c-land", null],
      ]);
      const closes = Number(asks[0].closes_s) * 1000;
      expect(closes).toBeGreaterThanOrEqual(Math.floor(consentClosesAt(before, "UTC").getTime() / 1000) * 1000);
      expect(closes).toBeLessThanOrEqual(consentClosesAt(after, "UTC").getTime());

      const asked = state.notices.filter((n) => n.type === "open_role_proposal_consent_ask");
      expect(asked.map((n) => n.userId).sort()).toEqual([ANA.id, BEN.id]);
      expect(asked[0]).toMatchObject({ title: CONSENT_WORDS.askTitle(["Gate Keeper", "Well Keeper"]), link: `/open-proposals/${id}` });
      expect(asked.map((n) => n.dedupeKey).sort()).toEqual([`op:${id}:ask:${ANA.id}`, `op:${id}:ask:${BEN.id}`]);
      const waiting = state.notices.filter((n) => n.type === "open_role_proposal_waiting");
      expect(waiting).toEqual([expect.objectContaining({ userId: FOUNDER.id, link: `/open-proposals/${id}`, dedupeKey: `op:${id}:waiting:${FOUNDER.id}` })]);
      // Nothing names the proposer's address.
      expect(JSON.stringify(state.notices)).not.toContain("rowan-has@example.test");

      // The link was used: a second confirm is refused and asks nobody again.
      const count = state.notices.length;
      expect((await call("POST", "/api/open-proposals/confirm", { token }, null)).status).toBe(410);
      expect(state.notices.length).toBe(count);
      expect(await asksOf(id)).toHaveLength(2);
    });

    it("tells the admins once, on a stable key, when nobody holds the power to adopt it, or the village holds it", async () => {
      // A holder in the chair: the admins hear nothing.
      const held = await confirmed("chair@example.test");
      expect(state.adminNotices.filter((n) => n.key.startsWith(`op:${held.id}:`))).toEqual([]);

      state.powerHolders = [];
      const empty = await confirmed("nochair@example.test");
      expect(state.adminNotices).toEqual([expect.objectContaining({ type: "governance", key: `op:${empty.id}:waiting:admins` })]);
      expect(state.adminNotices[0].title).toContain("Gate Keeper");
      expect(state.notices.filter((n) => n.type === "open_role_proposal_waiting" && n.link === `/open-proposals/${empty.id}`)).toEqual([]);

      state.powerHolders = [FOUNDER.id];
      await q("INSERT INTO capability_holding (capability, holder_role_id) VALUES ('org.seat', 'village')");
      const village = await confirmed("villageheld@example.test");
      expect(state.adminNotices.map((n) => n.key)).toContain(`op:${village.id}:waiting:admins`);
      expect(state.notices.filter((n) => n.type === "open_role_proposal_waiting" && n.link === `/open-proposals/${village.id}`)).toEqual([]);
      // The admins' line names the roles, never the address.
      expect(JSON.stringify(state.adminNotices)).not.toContain("@example.test");
    });
  });

  describe("the page", () => {
    it("is for members: a visitor and a guest are refused, and an unknown id is not there", async () => {
      const { id } = await confirmed("page@example.test");
      expect((await page(id, null)).status).toBe(401);
      state.guests = [MO.id];
      expect((await page(id, MO.id)).status).toBe(401);
      state.guests = [];
      expect((await page("op-00000000000000000000", MO.id)).status).toBe(404);
      expect((await page("nope", MO.id)).status).toBe(404);
    });

    it("names the proposer by first name and never their address, with the roles, the words and where the circle stands", async () => {
      const { id } = await confirmed("page2@example.test");
      const r = await page(id, MO.id);
      expect(r.status).toBe(200);
      const p = r.body.proposal;
      expect(p).toMatchObject({ id, status: "confirmed", proposer: "Rowan", why: "I live up the road and the gate is always shut.", aim: "The gate opens at dawn every day." });
      expect(p.roles).toEqual([{ id: gate, name: "Gate Keeper", circle: "Land Circle", note: "I open gates for a living.", accountabilities: [], commitmentPct: null }]);
      expect(p.season).toMatchObject({ id: "s-next", name: "Season of Roots", startsOn: "2037-01-01" });
      // Ana, Ben and u-has hold roles in the Land Circle; u-has is asked here, since this address is not its own.
      expect(p.consent).toMatchObject({ state: "open", asked: 3, consented: 0, objected: 0 });
      expect(p.you).toMatchObject({ mayAdopt: false, mayDecline: false, holdsThePower: false });
      expect(JSON.stringify(r.body)).not.toContain("page2@example.test");
      expect(JSON.stringify(r.body)).not.toContain("Field");
      // The decider reads that it is theirs to decide.
      expect((await page(id, FOUNDER.id)).body.proposal.you).toMatchObject({ mayAdopt: true, mayDecline: true, holdsThePower: true });
    });

    it("an asked holder consents or objects once, an objection needs a reason, and nobody else answers", async () => {
      const { id } = await confirmed("answer@example.test");
      const url = `/api/governance/open-proposals/${id}/consent`;
      expect((await call("POST", url, { answer: "consent" }, MO.id)).status).toBe(404);
      const noReason = await call("POST", url, { answer: "object" }, ANA.id);
      expect(noReason.status).toBe(400);
      expect(noReason.body.error).toBe(CONSENT_WORDS.reasonNeeded);
      const ok = await call("POST", url, { answer: "consent" }, ANA.id);
      expect(ok.status).toBe(200);
      expect(ok.body.consent).toMatchObject({ consented: 1, you: { answer: "consent", mayAnswer: false } });
      expect((await call("POST", url, { answer: "object", reason: "Changed my mind." }, ANA.id)).status).toBe(409);
      const objected = await call("POST", url, { answer: "object", reason: "We have a gate keeper already." }, BEN.id);
      expect(objected.status).toBe(200);
      const read = (await page(id, MO.id)).body.proposal.consent;
      expect(read).toMatchObject({ state: "objected", consented: 1, objected: 1, objections: ["We have a gate keeper already."] });
    });
  });

  describe("links and files, for the deciders only (Rye, 10 Nov 2026)", () => {
    const PDF = Buffer.from(["%PDF-1.7", "1 0 obj", "<<>>", "endobj", ""].join(String.fromCharCode(10)));

    /** Send with a link and a PDF, as somebody with no account, and confirm. */
    const withFiles = async (email: string) => {
      const before = state.sent.length;
      const fd = new FormData();
      fd.append("proposal", JSON.stringify({
        name: "Rowan Field",
        email,
        roles: [{ roleId: gate, note: "I open gates for a living." }],
        why: "I live up the road and the gate is always shut.",
        aim: "The gate opens at dawn every day.",
        links: [{ label: "Gates I built", url: "https://gates.example.org/rowan" }],
      }));
      fd.append("files", new Blob([PDF], { type: "application/pdf" }), "Gates portfolio.pdf");
      const res = await fetch(`${base}/api/open-proposals`, { method: "POST", body: fd }); // module-review-ok: a test calling its own local server
      expect(res.status, await res.clone().text()).toBe(200);
      const mail = state.sent[before];
      const id = mail.idempotencyKey.split(":")[1];
      expect((await call("POST", "/api/open-proposals/confirm", { token: tokenOf(mail) }, null)).status).toBe(200);
      return id;
    };

    const download = async (href: string, as: string | null) => {
      const before = state.viewer;
      state.viewer = as;
      try {
        return await fetch(`${base}${href}`); // module-review-ok: a test calling its own local server
      } finally {
        state.viewer = before;
      }
    };

    it("the holder of the power and the circle's asked holders read them; another member reads neither", async () => {
      const id = await withFiles("files1@example.test");
      const founder = (await page(id, FOUNDER.id)).body.proposal.attached;
      expect(founder.links).toEqual([{ label: "Gates I built", url: "https://gates.example.org/rowan" }]);
      expect(founder.files).toHaveLength(1);
      expect(founder.files[0]).toMatchObject({ kind: "pdf", name: "Gates portfolio.pdf", size: PDF.length });
      // Ana holds a role in the Land Circle and is asked to consent: she decides it too.
      expect((await page(id, ANA.id)).body.proposal.attached.files).toHaveLength(1);
      // Mo is a member who can read the page, and decides nothing.
      const mo = await page(id, MO.id);
      expect(mo.status).toBe(200);
      expect(mo.body.proposal.attached).toBeNull();
      expect(JSON.stringify(mo.body)).not.toContain("gates.example.org");
      expect(JSON.stringify(mo.body)).not.toContain("Gates portfolio");
    });

    it("the file door serves the bytes kept, as a download nobody caches or indexes, to a decider and nobody else", async () => {
      const id = await withFiles("files2@example.test");
      const href = (await page(id, FOUNDER.id)).body.proposal.attached.files[0].href as string;
      const ok = await download(href, FOUNDER.id);
      expect(ok.status).toBe(200);
      expect(Buffer.from(await ok.arrayBuffer()).equals(PDF)).toBe(true);
      expect(ok.headers.get("content-type")).toBe("application/pdf");
      expect(ok.headers.get("content-disposition")).toMatch(/^attachment; /);
      expect(ok.headers.get("cache-control")).toBe("private, no-store");
      expect(ok.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
      expect((await download(href, ANA.id)).status).toBe(200);
      // Not a decider, not signed in, a made-up file: nothing, and nothing said about it.
      expect((await download(href, MO.id)).status).toBe(404);
      expect((await download(href, null)).status).toBe(401);
      expect((await download(href.replace(/pf-[0-9a-f]+$/, "pf-0000000000000000"), FOUNDER.id)).status).toBe(404);
      expect((await download(href.replace(/pf-[0-9a-f]+$/, "..%2F..%2Fsecret"), FOUNDER.id)).status).toBe(404);
    });

    it("a holder of the power reads none of their own proposal's links or files", async () => {
      state.powerHolders = [FOUNDER.id, HAS.id];
      const id = await withFiles(HAS.email);
      const own = await page(id, HAS.id);
      expect(own.body.proposal.attached).toBeNull();
      const href = (await page(id, FOUNDER.id)).body.proposal.attached.files[0].href as string;
      expect((await download(href, HAS.id)).status).toBe(404);
    });

    /** Send with two references and a background-check consent, as somebody with no account, and confirm. */
    const withReferences = async (email: string) => {
      const before = state.sent.length;
      const res = await fetch(`${base}/api/open-proposals`, { // module-review-ok: a test calling its own local server, never an outside host
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Rowan Field",
          email,
          roles: [{ roleId: gate, note: "I open gates for a living." }],
          why: "I live up the road and the gate is always shut.",
          aim: "The gate opens at dawn every day.",
          references: [
            { name: "Ines Vargas", how: "We built the Pavones fence together", contact: "ines.vargas@example.org" },
            { name: "Tomas Rey", how: "My neighbour for ten years", contact: "+506 8888 1234" },
          ],
          about: { based: "Uvita", languages: "Spanish, English", story: "I came to a workday in March." },
          checkConsent: { given: true, version: checkConsentVersion() },
        }),
      }); // module-review-ok: a test calling its own local server
      expect(res.status, await res.clone().text()).toBe(200);
      const mail = state.sent[before];
      const id = mail.idempotencyKey.split(":")[1];
      expect((await call("POST", "/api/open-proposals/confirm", { token: tokenOf(mail) }, null)).status).toBe(200);
      return id;
    };

    it("ABOUT YOU: the holder of the power and the circle's asked holders read the references and the check; another member and a visitor read nothing", async () => {
      const id = await withReferences("refs1@example.test");
      const founder = (await page(id, FOUNDER.id)).body.proposal.aboutYou;
      expect(founder.references.map((r: any) => r.name)).toEqual(["Ines Vargas", "Tomas Rey"]);
      expect(founder.about).toMatchObject({ based: "Uvita" });
      expect(founder.backgroundCheck).toMatchObject({ needed: false, consent: { version: checkConsentVersion() } });
      expect((await page(id, ANA.id)).body.proposal.aboutYou.references).toHaveLength(2);
      // CONTROL for the gate: Mo reads the page, so a nothing here is the gate and not a missing page.
      const mo = await page(id, MO.id);
      expect(mo.status).toBe(200);
      expect(mo.body.proposal.aboutYou).toBeNull();
      for (const secret of ["Ines Vargas", "ines.vargas", "Tomas Rey", "8888 1234", "Pavones", "Uvita"]) expect(JSON.stringify(mo.body), secret).not.toContain(secret);
      // A visitor with no session reads no page at all.
      expect((await page(id, null)).status).toBe(401);
    });

    it("ABOUT YOU: a holder of the power reads none of their own proposal's references", async () => {
      state.powerHolders = [FOUNDER.id, HAS.id];
      const id = await withReferences(HAS.email);
      expect((await page(id, HAS.id)).body.proposal.aboutYou).toBeNull();
      expect((await page(id, FOUNDER.id)).body.proposal.aboutYou.references).toHaveLength(2);
    });

    it("a file changed on disk since it was sent is not served", async () => {
      const id = await withFiles("files3@example.test");
      const f = (await readOpenProposal(pool, id))!.body.files![0];
      await fs.promises.writeFile(path.join(fileDir, id, `${f.id}.${f.kind}`), Buffer.from("%PDF-1.7 something else"));
      const href = (await page(id, FOUNDER.id)).body.proposal.attached.files[0].href as string;
      expect((await download(href, FOUNDER.id)).status).toBe(404);
    });
  });

  describe("who decides", () => {
    it("a member without the power is refused, and so is a holder on their own address", async () => {
      const { id } = await confirmed("who@example.test");
      const refused = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, ANA.id);
      expect(refused.status).toBe(403);
      expect((await call("POST", `/api/governance/open-proposals/${id}/decline`, {}, ANA.id)).status).toBe(403);
      expect((await readOpenProposal(pool, id))?.status).toBe("confirmed");

      const own = await confirmed(FOUNDER.email);
      const mine = await call("POST", `/api/governance/open-proposals/${own.id}/adopt`, {}, FOUNDER.id);
      expect(mine.status).toBe(403);
      expect(mine.body.message).toBe(DECIDE_WORDS.ownProposal);
      expect((await page(own.id, FOUNDER.id)).body.proposal.you).toMatchObject({ mayAdopt: false, own: true });

      // The same person behind a +tag or a changed case is still the applicant: never their own approver.
      for (const alias of ["founder+roles@example.test", "Founder+x@Example.TEST"]) {
        const disguised = await confirmed(alias);
        const tried = await call("POST", `/api/governance/open-proposals/${disguised.id}/adopt`, {}, FOUNDER.id);
        expect(tried.status, alias).toBe(403);
        expect(tried.body.message).toBe(DECIDE_WORDS.ownProposal);
        expect((await readOpenProposal(pool, disguised.id))?.status).toBe("confirmed");
      }
    });

    it("a former member's address is refused: nothing is granted, seated or invited, and declining it still works", async () => {
      await usersRepo(pool).add({ id: LEFT.id, name: LEFT.name, email: LEFT.email, passwordHash: "x", paths: [] } as any);
      await q("INSERT INTO exits (id, user_id, status, opened_by) VALUES (?,?,?,?)", ["opd-exit-left", LEFT.id, "resolved", LEFT.id]);
      const { id } = await confirmed(LEFT.email, [gate]);
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ error: "former_member", message: DECIDE_WORDS.formerMember });
      expect((await readOpenProposal(pool, id))?.status).toBe("confirmed");
      expect((await usersRepo(pool).byId(LEFT.id))?.stageGranted ?? null).toBeNull();
      expect(await q("SELECT id FROM seat_applications WHERE candidate_user_id = ?", [LEFT.id])).toEqual([]);
      expect(await q("SELECT id FROM member_invites WHERE id = ?", [openInviteId(id)])).toEqual([]);
      expect(state.sent.filter((m) => m.origin === "open_proposal.adopted")).toEqual([]);
      // The decider reads why, and may still decline; a member without the power is not told who left.
      expect((await page(id, FOUNDER.id)).body.proposal.you).toMatchObject({ mayAdopt: false, mayDecline: true, formerMember: true });
      expect((await page(id, MO.id)).body.proposal.you.formerMember).toBe(false);
      expect((await call("POST", `/api/governance/open-proposals/${id}/decline`, {}, FOUNDER.id)).status).toBe(200);
    });

    it("after a handover nobody adopts at the door, and the page says so plainly", async () => {
      const { id } = await confirmed("handover@example.test");
      await q("INSERT INTO capability_holding (capability, holder_role_id) VALUES ('org.seat', 'village')");
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(r.status).toBe(403);
      const p = (await page(id, FOUNDER.id)).body.proposal;
      expect(p.you).toMatchObject({ mayAdopt: false, mayDecline: false });
      expect(p.door).toEqual({ because: "village-holds-it", words: DECIDE_WORDS.door["village-holds-it"] });
      expect((await readOpenProposal(pool, id))?.status).toBe("confirmed");

      await q("DELETE FROM capability_holding WHERE capability = 'org.seat'");
      state.powerHolders = [];
      expect((await page(id, FOUNDER.id)).body.proposal.door.because).toBe("nobody-holds-it");
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(403);
    });
  });

  describe("adopting, for an address with no account", () => {
    it("records the decision, makes one invitation named after the proposal, emails it, and hands the link back", async () => {
      const { id } = await confirmed("newcomer@example.test");
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ success: true, status: "adopted", account: false, invitation: { emailed: true } });
      expect(r.body.decided).toMatch(/^Adopted on \d{1,2} \w{3} by the founder's power$/);
      expect(r.body.message).toBe(DECIDE_WORDS.adoptedEmailed(14));
      expect(linkOf(r.body).startsWith(`${ORIGIN}/register?invite=`)).toBe(true);

      const stored = await readOpenProposal(pool, id);
      expect(stored).toMatchObject({ status: "adopted" });
      expect(stored?.decidedAt).toBeInstanceOf(Date);
      expect(stored?.decision).toEqual({ words: r.body.decided, authority: `org.seat@${founderRole}` });
      const invites = await q("SELECT id, inviter_user_id, used_at FROM member_invites WHERE id = ?", [openInviteId(id)]);
      expect(invites).toEqual([expect.objectContaining({ inviter_user_id: FOUNDER.id, used_at: null })]);

      const mail = state.sent.find((m) => m.origin === "open_proposal.adopted");
      expect(mail).toMatchObject({ kind: "essential", to: { email: "newcomer@example.test", name: "Rowan" }, subject: "Test Village adopted your proposal" });
      expect(mail?.text).toContain(linkOf(r.body));
      expect(mail?.text).toContain("Your roles start when Season of Roots begins");
      expect(mail?.idempotencyKey).toMatch(new RegExp(`^open-proposal:${id}:adopted:[0-9a-f]{16}$`));

      // Decided: a second adopt and a decline are refused, and answers close.
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(409);
      expect((await call("POST", `/api/governance/open-proposals/${id}/decline`, {}, FOUNDER.id)).status).toBe(409);
      const late = await call("POST", `/api/governance/open-proposals/${id}/consent`, { answer: "consent" }, ANA.id);
      expect(late.status).toBe(409);
      expect(late.body.error).toBe(CONSENT_WORDS.decided);
    });

    it("with email off it says nothing went, and the link is still right there", async () => {
      const { id } = await confirmed("offline@example.test");
      state.answer = { status: "skipped", messageId: null, reason: "not_configured" };
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(r.status).toBe(200);
      expect(r.body.invitation.emailed).toBe(false);
      expect(r.body.message).toBe(DECIDE_WORDS.adoptedNotEmailed("not_set_up"));
      expect(linkOf(r.body)).toContain("/register?invite=");
    });

    it("a confirm link replayed after adoption answers 410 and moves nothing", async () => {
      const { id, token } = await send("replay@example.test");
      expect((await call("POST", "/api/open-proposals/confirm", { token }, null)).status).toBe(200);
      const adopted = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(adopted.status).toBe(200);
      const before = {
        row: await readOpenProposal(pool, id),
        asks: await asksOf(id),
        notices: state.notices.length,
        mail: state.sent.length,
        invites: await q("SELECT id, token_hash, revoked_at FROM member_invites WHERE id = ?", [openInviteId(id)]),
      };
      const replay = await call("POST", "/api/open-proposals/confirm", { token }, null);
      expect(replay.status).toBe(410);
      expect(await readOpenProposal(pool, id)).toEqual(before.row);
      expect(await asksOf(id)).toEqual(before.asks);
      expect(state.notices.length).toBe(before.notices);
      expect(state.sent.length).toBe(before.mail);
      expect(await q("SELECT id, token_hash, revoked_at FROM member_invites WHERE id = ?", [openInviteId(id)])).toEqual(before.invites);
    });

    it("signing up through the invitation makes a Member with the roles waiting for the season's first day", async () => {
      const { id } = await confirmed("arrives@example.test", [gate]);
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      const token = inviteToken(linkOf(r.body));
      // The door both sign-up routes share, in the order they run it.
      const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
      const found = await door.resolve(token);
      expect(found).toMatchObject({ ok: true, id: openInviteId(id) });
      const newcomer = "u-arrives";
      const inviter = await door.claim(openInviteId(id), newcomer);
      expect(inviter).toBe(FOUNDER.id);
      await usersRepo(pool).add({ id: newcomer, name: "Rowan Field", email: "arrives@example.test", passwordHash: "x", paths: [] } as any);
      await door.welcome(inviter as string, newcomer);

      // Rye's ruling: Voice is only for people who signed the membership agreement. Adoption admits nobody;
      // the signed Love Letter does (server/lib/admission.ts).
      expect((await usersRepo(pool).byId(newcomer))?.stageGranted ?? null).not.toBe("member");
      expect((await usersRepo(pool).byId(newcomer))?.membershipGranted ?? false).toBeFalsy();
      const apps = await q("SELECT id, status, seat_ids, term_season_id, adopted_via, adopted_ref, authority_ref, UNIX_TIMESTAMP(starts_at) AS starts_s FROM seat_applications WHERE candidate_user_id = ?", [newcomer]);
      expect(apps).toHaveLength(1);
      expect(apps[0]).toMatchObject({ status: "adopted", term_season_id: "s-next", adopted_via: "holder", adopted_ref: FOUNDER.id, authority_ref: `org.seat@${founderRole}` });
      expect(idsOf(apps[0].seat_ids)).toEqual([gate]);
      expect(Number(apps[0].starts_s) * 1000).toBe(Date.parse("2037-01-01T00:00:00Z"));
      expect(state.notices.some((n) => n.userId === newcomer && n.link === `/role-applications/${apps[0].id}`)).toBe(true);
      expect(state.adminNotices).toEqual([]);

      // The season turn seats them on the first day, as it seats any adopted application.
      const at = new Date("2037-01-01T12:00:00Z");
      await runSeasonTurn({
        getPool: () => pool,
        notify: async () => undefined,
        notifyAdmins: async () => undefined,
        closer: { settle: async () => ({ applied: [], held: null, proposerTold: null }) } as any,
        lapse: () => ({ currentSeasonId: "s-next", cadence: "season_turn" }),
        calendar: () => ({ ...calendar(), currentSeasonId: "s-next" }),
        now: () => at,
      });
      const seated = await q("SELECT org_role_id, season_id FROM org_role_assignments WHERE user_id = ? AND ended_at IS NULL", [newcomer]);
      expect(seated).toEqual([{ org_role_id: gate, season_id: "s-next" }]);
    });

    it("one sign-up places every adopted proposal for that address, once each, and withdraws the other links", async () => {
      const first = await confirmed("twice@example.test", [gate]);
      const second = await confirmed("twice@example.test", [well]);
      const a = await call("POST", `/api/governance/open-proposals/${first.id}/adopt`, {}, FOUNDER.id);
      const b = await call("POST", `/api/governance/open-proposals/${second.id}/adopt`, {}, FOUNDER.id);
      expect([a.status, b.status]).toEqual([200, 200]);
      const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
      const newcomer = "u-twice";
      const inviter = await door.claim(openInviteId(first.id), newcomer);
      await usersRepo(pool).add({ id: newcomer, name: "Rowan Field", email: "twice@example.test", passwordHash: "x", paths: [] } as any);
      await door.welcome(inviter as string, newcomer);

      const placed = async () => q("SELECT seat_ids, status FROM seat_applications WHERE candidate_user_id = ?", [newcomer]);
      const apps = await placed();
      expect(apps.map((x: any) => (idsOf(x.seat_ids) as string[]).join(",")).sort()).toEqual([gate, well].sort());
      expect(apps.every((x: any) => x.status === "adopted")).toBe(true);
      // The other proposal's link no longer opens anything.
      expect((await door.resolve(inviteToken(linkOf(b.body)))).ok).toBe(false);
      // A second welcome places nothing twice.
      await door.welcome(inviter as string, newcomer);
      expect(await placed()).toHaveLength(2);
    });

    it("the seated newcomer's terms read as waiting on them until they align, then in force", async () => {
      const bell = await createOrgRole(pool, { id: "opd-role-bell", name: "Bell Keeper", seats: 1, circleId: "c-land", aim: "Ring the hours." });
      const { id } = await confirmed("bell@example.test", [bell]);
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(r.status).toBe(200);
      const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
      const newcomer = "u-bell";
      const inviter = await door.claim(openInviteId(id), newcomer);
      expect(inviter).toBe(FOUNDER.id);
      await usersRepo(pool).add({ id: newcomer, name: "Bea Bell", email: "bell@example.test", passwordHash: "x", paths: [] } as any);
      await door.welcome(inviter as string, newcomer);
      const at = new Date("2037-01-01T12:00:00Z");
      await runSeasonTurn({
        getPool: () => pool,
        notify: async () => undefined,
        notifyAdmins: async () => undefined,
        closer: { settle: async () => ({ applied: [], held: null, proposerTold: null }) } as any,
        lapse: () => ({ currentSeasonId: "s-next", cadence: "season_turn" }),
        calendar: () => ({ ...calendar(), currentSeasonId: "s-next" }),
        now: () => at,
      });
      const [app] = await q("SELECT id, text_id, text_hash FROM seat_applications WHERE candidate_user_id = ?", [newcomer]);
      expect(await q("SELECT org_role_id FROM org_role_assignments WHERE user_id = ? AND ended_at IS NULL", [newcomer])).toEqual([{ org_role_id: bell }]);
      const read = async () =>
        (await heldTermsFor(pool, [{ applicationId: String(app.id) }], { timezone: "UTC", nameOf: (u) => (u === newcomer ? "Bea Bell" : "Someone"), today: "2037-01-02" })).get(String(app.id))?.alignment;
      // Seated, and the terms wait on the newcomer: the village aligned when it adopted, they have not.
      const before = await read();
      expect(before?.state).toBe("pending");
      expect(before?.parties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ partyKey: userParty(newcomer), label: "Bea Bell", aligned: false }),
          expect.objectContaining({ partyKey: "village", aligned: true }),
        ]),
      );
      // They align from the application's page; then the terms are in force.
      await recordAlignment(pool, { textId: String(app.text_id), partyKey: userParty(newcomer), userId: newcomer, contentHash: String(app.text_hash), intent: "I hold Bell Keeper on these terms.", method: "click", authorityRef: null });
      expect((await read())?.state).toBe("in-force");
    });

    it("a new invitation replaces one nobody used, and none is made once it was used", async () => {
      const { id } = await confirmed("again@example.test");
      const first = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
      expect(await door.resolve(inviteToken(linkOf(first.body)))).toMatchObject({ ok: true });
      const again = await call("POST", `/api/governance/open-proposals/${id}/invitation`, {}, FOUNDER.id);
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body.emailed).toBe(true);
      expect(again.body.link).not.toBe(linkOf(first.body));
      expect((await door.resolve(inviteToken(linkOf(first.body)))).ok).toBe(false);
      expect(await door.resolve(inviteToken(again.body.link))).toMatchObject({ ok: true, id: openInviteId(id) });
      // Somebody without the power cannot.
      expect((await call("POST", `/api/governance/open-proposals/${id}/invitation`, {}, ANA.id)).status).toBe(403);
      // Used: there is nothing to replace.
      await door.claim(openInviteId(id), "u-again");
      const used = await call("POST", `/api/governance/open-proposals/${id}/invitation`, {}, FOUNDER.id);
      expect(used.status).toBe(409);
      expect(used.body.error).toBe(DECIDE_WORDS.noInvitation);
    });
  });

  describe("adopting, for an address with an account", () => {
    it("gives it the roles for the target season, with no invitation, and admits nobody before the Love Letter", async () => {
      const { id } = await confirmed(HAS.email, [well]);
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ success: true, status: "adopted", account: true, invitation: null });
      expect(r.body.message).toBe(`${DECIDE_WORDS.adoptedAccount} ${DECIDE_WORDS.accountTold}`);
      expect(await q("SELECT id FROM member_invites WHERE id = ?", [openInviteId(id)])).toEqual([]);
      expect((await usersRepo(pool).byId(HAS.id))?.stageGranted ?? null).not.toBe("member");
      expect(state.stageEvents).toEqual([]);
      const apps = await q("SELECT status, seat_ids, term_season_id, adopted_ref FROM seat_applications WHERE candidate_user_id = ?", [HAS.id]);
      expect(apps).toEqual([expect.objectContaining({ status: "adopted", term_season_id: "s-next", adopted_ref: FOUNDER.id })]);
      expect(idsOf(apps[0].seat_ids)).toEqual([well]);
      const mail = state.sent.find((m) => m.origin === "open_proposal.adopted");
      expect(mail?.text).toContain(`${ORIGIN}/profile`);
      expect(mail?.text).not.toContain("invite");
      // The letter says what comes before seating and voting.
      expect(mail?.text).toContain(`${ORIGIN}/love-letter`);
    });

    it("never lowers a stage granted above Member", async () => {
      const { id } = await confirmed(HIGH.email, [gate]);
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(200);
      expect((await usersRepo(pool).byId(HIGH.id))?.stageGranted).toBe("co-creator");
    });
  });

  describe("a proposal for this moon (Rye, 9 Nov 2026)", () => {
    it("is adopted into this season, starting now, with its term ending on the moon's last day", async () => {
      state.viewer = FOUNDER.id;
      expect((await call("PUT", "/api/admin/open-proposals/settings", { term: "moon" }, FOUNDER.id)).status).toBe(200);
      try {
        const moon = moonTermFor(new Date(), activeClock(), "UTC");
        const MOONER = { id: "u-mooner", email: "mooner@example.test" };
        await usersRepo(pool).add({ id: MOONER.id, name: "Mo Oner", email: MOONER.email, passwordHash: "x", paths: [] } as any);
        const { id } = await confirmed(MOONER.email, [gate]);
        const before = Date.now();
        const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const apps = await q("SELECT status, term_season_id, UNIX_TIMESTAMP(starts_at) AS starts_s, DATE_FORMAT(term_ends_at, '%Y-%m-%d') AS ends_on FROM seat_applications WHERE candidate_user_id = ? ORDER BY created_at DESC", [MOONER.id]);
        expect(apps[0]).toMatchObject({ status: "adopted", term_season_id: "s-now" });
        // Starts at adoption (never before the moon's first day), not on next season's first day.
        expect(Number(apps[0].starts_s) * 1000).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 - 1000);
        expect(Number(apps[0].starts_s) * 1000).toBeLessThan(Date.now() + 60_000);
        expect(apps[0].ends_on).toBe(moon.endsOn);
        const mail = state.sent.find((m) => m.origin === "open_proposal.adopted");
        expect(mail?.text).toContain("this moon");
        expect(mail?.text).not.toContain("next season");
      } finally {
        await call("PUT", "/api/admin/open-proposals/settings", { term: "season" }, FOUNDER.id);
      }
    });
  });

  describe("the applicant's own card (Rye, 9 Nov 2026)", () => {
    it("is on the page for the decider, and becomes the role application's own words on adoption", async () => {
      const CARDED = { id: "u-carded", email: "carded@example.test" };
      await usersRepo(pool).add({ id: CARDED.id, name: "Cara Ded", email: CARDED.email, passwordHash: "x", paths: [] } as any);
      const before = state.sent.length;
      const r = await call("POST", "/api/open-proposals", {
        name: "Cara Ded",
        email: CARDED.email,
        roles: [{ roleId: well, note: "" }],
        why: "I know wells.",
        aim: "Clean water all season.",
        card: { roles: [{ roleId: well, moves: [], firstMoon: [{ quest: "Test the water", doneWhen: "the lab says it is clean" }] }], serves: [], commitmentPct: 70, agreed: { loveLetter: true, nda: true }, terms: { answers: { term: { choice: "talk", note: "Could the rate be per moon?" } } } },
      }, null);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const mail = state.sent[before];
      const ok = await call("POST", "/api/open-proposals/confirm", { token: tokenOf(mail) }, null);
      expect(ok.status).toBe(200);
      const id = mail.idempotencyKey.split(":")[1];
      const seen = await page(id, FOUNDER.id);
      expect(seen.body.proposal.card.roles[0].firstMoon[0]).toEqual({ quest: "Test the water", doneWhen: "the lab says it is clean" });
      expect(Array.isArray(seen.body.proposal.roles[0].accountabilities)).toBe(true);
      const adopted = await call("POST", `/api/governance/open-proposals/${id}/adopt`, { confirmOpenTalks: true }, FOUNDER.id); expect(adopted.status, JSON.stringify(adopted.body)).toBe(200);
      const apps = await q("SELECT deliverables FROM seat_applications WHERE candidate_user_id = ?", [CARDED.id]);
      expect(String(apps[0].deliverables)).toContain("Clean water all season.");
      expect(String(apps[0].deliverables)).toContain("Goal: Test the water: done when the lab says it is clean");
      expect(String(apps[0].deliverables)).toContain("Commitment: 70%");
      expect(String(apps[0].deliverables)).toContain("Wants to talk about the terms: Term: Could the rate be per moon?");
    });
  });

  describe("declining", () => {
    it("sets decided_at so the tidy job finds it, sends a kind no, and closes the answers", async () => {
      const { id } = await confirmed("nothanks@example.test");
      const r = await call("POST", `/api/governance/open-proposals/${id}/decline`, {}, FOUNDER.id);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ success: true, status: "declined", emailed: true, message: DECIDE_WORDS.declinedEmailed });
      const stored = await readOpenProposal(pool, id);
      expect(stored?.status).toBe("declined");
      expect(stored?.decidedAt).toBeInstanceOf(Date);
      const mail = state.sent.find((m) => m.origin === "open_proposal.declined");
      expect(mail).toMatchObject({ kind: "essential", idempotencyKey: `open-proposal:${id}:declined`, to: { email: "nothanks@example.test" } });
      expect(mail?.text).toContain("We can't say yes this time.");
      expect(await q("SELECT id FROM member_invites WHERE id = ?", [openInviteId(id)])).toEqual([]);
      expect((await call("POST", `/api/governance/open-proposals/${id}/consent`, { answer: "consent" }, ANA.id)).status).toBe(409);
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(409);

      // 90 days on, the tidy job takes the name and address off.
      await tidyOpenProposals(pool, new Date(Date.now() + 91 * 24 * 60 * 60_000));
      expect(await readOpenProposal(pool, id)).toMatchObject({ status: "declined", name: null, email: null });
    });

    it("with email off it says nothing went", async () => {
      const { id } = await confirmed("quietno@example.test");
      state.answer = { status: "skipped", messageId: null, reason: "not_configured" };
      const r = await call("POST", `/api/governance/open-proposals/${id}/decline`, {}, FOUNDER.id);
      expect(r.body).toMatchObject({ emailed: false, message: DECIDE_WORDS.declinedNotEmailed("not_set_up") });
    });
  });

  describe("the messages a proposal's person reads", () => {
    it("the invitation says what to do next, has a button, goes once on adoption, and Admin shows when", async () => {
      const { id } = await confirmed("invite-me@example.test");
      state.sent.length = 0;
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(r.status).toBe(200);
      const invites = state.sent.filter((m) => m.origin === "open_proposal.adopted");
      expect(invites).toHaveLength(1);
      expect(invites[0].to.email).toBe("invite-me@example.test");
      expect(invites[0].html).toContain(`<a href="${linkOf(r.body)}"`);
      expect(invites[0].html).toContain("Create your profile");
      expect(invites[0].text).toContain("Then check your profile. Your tasks for the moon appear there, and it is where we run our sessions and track our work together.");
      // A retried adoption is refused and sends nothing more.
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(409);
      expect(state.sent.filter((m) => m.origin === "open_proposal.adopted")).toHaveLength(1);
      // Admin shows that it went and when.
      const shown = await page(id, FOUNDER.id);
      expect(shown.body.proposal.invitation).toMatchObject({ state: "open", emailed: true });
      expect(Date.now() - new Date(shown.body.proposal.invitation.sentAt).getTime()).toBeLessThan(60_000);
      // Send again: one new email, a new time.
      const again = await call("POST", `/api/governance/open-proposals/${id}/invitation`, {}, FOUNDER.id);
      expect(again.status).toBe(200);
      expect(state.sent.filter((m) => m.origin === "open_proposal.adopted")).toHaveLength(2);
    });

    it("an email that did not go is recorded as not sent", async () => {
      const { id } = await confirmed("no-mail@example.test");
      state.answer = { status: "skipped", messageId: null, reason: "not_configured" };
      await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect((await page(id, FOUNDER.id)).body.proposal.invitation).toMatchObject({ state: "open", emailed: false });
    });

    it("the kind no thanks them, points to a quest, the open roles and next season, and goes once", async () => {
      const { id } = await confirmed("kind-no@example.test");
      state.sent.length = 0;
      expect((await call("POST", `/api/governance/open-proposals/${id}/decline`, {}, FOUNDER.id)).status).toBe(200);
      expect((await call("POST", `/api/governance/open-proposals/${id}/decline`, {}, FOUNDER.id)).status).toBe(409);
      const no = state.sent.filter((m) => m.origin === "open_proposal.declined");
      expect(no).toHaveLength(1);
      expect(no[0].text).toContain("Thank you for proposing");
      expect(no[0].text).toContain(`${ORIGIN}/quests`);
      expect(no[0].text).toContain(`${ORIGIN}/roles`);
      expect(no[0].text).toContain("propose again next season");
      // The retention rule still holds: the address is gone 90 days on.
      await tidyOpenProposals(pool, new Date(Date.now() + 91 * 24 * 60 * 60_000));
      expect(await readOpenProposal(pool, id)).toMatchObject({ status: "declined", name: null, email: null });
    });

    it("an address with an account reads the no on its profile, once", async () => {
      const { id } = await confirmed(HIGH.email);
      state.notices.length = 0;
      await call("POST", `/api/governance/open-proposals/${id}/decline`, {}, FOUNDER.id);
      const bell = state.notices.filter((n) => n.type === "applicant_update");
      expect(bell).toHaveLength(1);
      expect(bell[0]).toMatchObject({ userId: HIGH.id, dedupeKey: `op:${id}:update:declined:${HIGH.id}` });
    });

    it("the account an invitation makes finds the earlier updates on its profile", async () => {
      const { id } = await confirmed("arrives2@example.test");
      await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      state.notices.length = 0;
      const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
      const inviter = await door.claim(openInviteId(id), "u-arrives2");
      await usersRepo(pool).add({ id: "u-arrives2", name: "Rowan Field", email: "arrives2@example.test", passwordHash: "x", paths: [] } as any);
      await door.welcome(inviter as string, "u-arrives2");
      const bell = state.notices.filter((n) => n.type === "applicant_update" && n.userId === "u-arrives2");
      expect(bell.map((n) => n.dedupeKey).sort()).toEqual([`op:${id}:update:adopted:u-arrives2`, `op:${id}:update:confirmed:u-arrives2`, `op:${id}:update:consent:u-arrives2`]);
      expect(bell.find((n) => n.dedupeKey.includes(":adopted:"))?.body).toContain("Your tasks for the moon appear there");
    });
  });

  describe("retention", () => {
    it("the tidy job takes the name and address off an adopted proposal nobody arrived for, 90 days on, and keeps the rest", async () => {
      const adopt = async (email: string, roles: string[]) => {
        const p = await confirmed(email, roles);
        const r = await call("POST", `/api/governance/open-proposals/${p.id}/adopt`, {}, FOUNDER.id);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        return p.id;
      };
      const never = await adopt("never@example.test", [gate]);
      const came = await adopt("came@example.test", [gate]);
      // Somebody arrived through it: the link was used.
      await makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) }).claim(openInviteId(came), "u-came");
      // An address with an account here: placed at once, no invitation.
      const account = await adopt(MO.email, [well]);
      const recent = await adopt("recent-yes@example.test", [gate]);
      const old = new Date(Date.now() - 91 * 24 * 60 * 60_000);
      await q("UPDATE open_role_proposals SET decided_at = ? WHERE id IN (?, ?, ?)", [old, never, came, account]);

      await tidyOpenProposals(pool, new Date());
      expect(await readOpenProposal(pool, never)).toMatchObject({ status: "adopted", name: null, email: null });
      expect(await readOpenProposal(pool, came)).toMatchObject({ name: "Rowan Field", email: "came@example.test" });
      expect(await readOpenProposal(pool, account)).toMatchObject({ name: "Rowan Field", email: MO.email });
      expect(await readOpenProposal(pool, recent)).toMatchObject({ name: "Rowan Field", email: "recent-yes@example.test" });
      // The decision record stays: it names a role, never a person.
      expect((await readOpenProposal(pool, never))?.decision.words).toMatch(/^Adopted on /);
    });
  });

  describe("the task board", () => {
    it("an asked holder has a consent row until they answer, the decider an adopt row until it is decided", async () => {
      const { id } = await confirmed("board@example.test", [gate]);
      const deps = { pool, firstName: (n: string) => n.split(/\s+/)[0] ?? "", timezone: "UTC", now: new Date() };
      const rule = whoMayPutHandToVillage(false, [FOUNDER.id]);
      const ana = (await openProposalsWaitingOn(deps, rule, ANA.id)).filter((r) => r.id === id);
      expect(ana).toEqual([expect.objectContaining({ id, ask: "consent", roles: ["Gate Keeper"], circles: ["Land Circle"], proposer: "Rowan" })]);
      expect(ana[0].closesOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((await openProposalsWaitingOn(deps, rule, FOUNDER.id)).filter((r) => r.id === id)).toEqual([expect.objectContaining({ id, ask: "adopt" })]);
      expect((await openProposalsWaitingOn(deps, rule, MO.id)).filter((r) => r.id === id)).toEqual([]);

      await call("POST", `/api/governance/open-proposals/${id}/consent`, { answer: "consent" }, ANA.id);
      expect((await openProposalsWaitingOn(deps, rule, ANA.id)).filter((r) => r.id === id)).toEqual([]);
      await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect((await openProposalsWaitingOn(deps, rule, FOUNDER.id)).filter((r) => r.id === id)).toEqual([]);
    });
  });
  describe("the applicant's language and a decider's note (messages 2)", () => {
    /** Like `send`, with the language the page chose and the browser's header, and the status link read back from the confirmation. */
    const proposeIn = async (email: string, opts: { locale?: string; acceptLanguage?: string } = {}) => {
      const before = state.sent.length;
      const res = await fetch(`${base}/api/open-proposals`, { // module-review-ok: a test calling its own local server, never an outside host
        method: "POST",
        headers: { "content-type": "application/json", ...(opts.acceptLanguage ? { "accept-language": opts.acceptLanguage } : {}) },
        body: JSON.stringify({
          name: "Rowan Field",
          email,
          roles: [{ roleId: gate, note: "I open gates for a living." }],
          why: "I live up the road and the gate is always shut.",
          aim: "The gate opens at dawn every day.",
          ...(opts.locale ? { locale: opts.locale } : {}),
        }),
      });
      expect(res.status).toBe(200);
      const mail = state.sent[before];
      const id = mail.idempotencyKey.split(":")[1];
      const stored = await readOpenProposal(pool, id);
      return { id, mail, token: tokenOf(mail), locale: stored?.body.locale };
    };
    const confirmIt = async (token: string) => {
      const ok = await call("POST", "/api/open-proposals/confirm", { token }, null);
      expect(ok.status).toBe(200);
      return String(ok.body.statusPath);
    };
    const statusOf = async (statusPath: string) => {
      const u = new URL(statusPath, ORIGIN);
      return call("GET", `/api/application-status/${u.pathname.split("/").pop()}?token=${u.searchParams.get("token")}`, undefined, null);
    };

    it("the language chosen on the site is kept and the confirmation comes in it", async () => {
      const p = await proposeIn("es-chosen@example.test", { locale: "es", acceptLanguage: "en" });
      expect(p.locale).toBe("es");
      expect(p.mail.subject).toBe("Confirma tu propuesta a Test Village");
      expect(p.mail.text).toContain("Hola Rowan,");
    });

    it("else the email list, else the profile, else the browser, else the village default", async () => {
      // No language from the page, a browser that says Spanish.
      expect((await proposeIn("es-browser@example.test", { acceptLanguage: "fr;q=0.9, es-CR;q=0.8" })).locale).toBe("es");
      // An address book entry in Spanish wins over an English browser.
      await q("INSERT INTO comms_contacts (id, village_id, email_key, email, first_source, locale) VALUES ('ct_lang1', 'local', 'es-list@example.test', 'es-list@example.test', 'guest', 'es')");
      expect((await proposeIn("es-list@example.test", { acceptLanguage: "en" })).locale).toBe("es");
      // A member's saved language wins over an English browser, and the address book is silent.
      await usersRepo(pool).add({ id: "u-es-prof", name: "Pura Vida", email: "es-prof@example.test", passwordHash: "x", paths: [], prefs: { locale: "es" } } as any);
      expect((await proposeIn("es-prof@example.test", { acceptLanguage: "en" })).locale).toBe("es");
      // Nothing says Spanish: the village default (English here), never a guess.
      expect((await proposeIn("en-none@example.test", { acceptLanguage: "fr" })).locale).toBe("en");
      // The page's own choice beats the address book.
      expect((await proposeIn("es-list@example.test", { locale: "en" })).locale).toBe("en");
    });

    it("a Spanish applicant gets Spanish emails and notices, and the note, escaped, on the status page and in the email", async () => {
      const p = await proposeIn("ana-es@example.test", { locale: "es" });
      const statusPath = await confirmIt(p.token);
      const statusMail = state.sent.find((m) => m.origin === "open_proposal.status");
      expect(statusMail?.subject).toBe("Dónde está tu propuesta");
      const note = "Gracias <b>de verdad</b> & hasta pronto";
      const r = await call("POST", `/api/governance/open-proposals/${p.id}/decline`, { note }, FOUNDER.id);
      expect(r.status).toBe(200);
      const mail = state.sent.find((m) => m.origin === "open_proposal.declined");
      expect(mail?.subject).toBe("Tu propuesta a Test Village");
      expect(mail?.text).toContain("Gracias por proponerte");
      expect(mail?.text).toContain(note);
      expect(mail?.html).toContain(escapeHtml(note));
      expect(mail?.html).not.toContain("<b>de verdad</b>");
      // The status page, reloaded, shows it with the language it was written in.
      const status = await statusOf(statusPath);
      expect(status.status).toBe(200);
      expect(status.body.status).toMatchObject({ note, locale: "es", outcome: "declined" });
      // Not shown to anyone else: a wrong token reads nothing, and a decider's own read of the proposal carries no note.
      expect((await call("GET", `/api/application-status/${p.id}?token=wrong`, undefined, null)).status).toBe(404);
      expect(JSON.stringify((await page(p.id, FOUNDER.id)).body)).not.toContain("hasta pronto");
      // The one email the applicant got is the only one that carries it.
      expect(state.sent.filter((m) => m.text.includes("hasta pronto")).map((m) => m.origin)).toEqual(["open_proposal.declined"]);
    });

    it("a note is optional, and an English applicant's emails stay English", async () => {
      const p = await proposeIn("ana-en@example.test", { locale: "en" });
      const statusPath = await confirmIt(p.token);
      await call("POST", `/api/governance/open-proposals/${p.id}/decline`, {}, FOUNDER.id);
      const mail = state.sent.find((m) => m.origin === "open_proposal.declined");
      expect(mail?.text).toContain("Thank you for proposing");
      expect(mail?.text).not.toContain("A note from us");
      expect((await statusOf(statusPath)).body.status.note).toBeNull();
    });

    it("an adoption carries the note too, and the note goes when the proposal is anonymised", async () => {
      const p = await proposeIn("ana-adopt@example.test", { locale: "es" });
      await confirmIt(p.token);
      const r = await call("POST", `/api/governance/open-proposals/${p.id}/adopt`, { note: "Bienvenida." }, FOUNDER.id);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const mail = state.sent.find((m) => m.origin === "open_proposal.adopted");
      expect(mail?.text).toContain("Bienvenida.");
      expect(mail?.text).toContain("adoptó tu propuesta");
      expect((await readOpenProposal(pool, p.id))?.body.note).toBe("Bienvenida.");
      await tidyOpenProposals(pool, new Date(Date.now() + 91 * 24 * 60 * 60_000));
      const after = await readOpenProposal(pool, p.id);
      expect(after?.email).toBeNull();
      expect(after?.body.note).toBeUndefined();
    });

    it("the note never travels past this door: it is capped and plain", async () => {
      const p = await proposeIn("ana-cap@example.test", { locale: "en" });
      await confirmIt(p.token);
      await call("POST", `/api/governance/open-proposals/${p.id}/decline`, { note: "x".repeat(5000) }, FOUNDER.id);
      expect((await readOpenProposal(pool, p.id))?.body.note?.length).toBe(600);
    });
  });
});
