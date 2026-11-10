/**
 * A ROLE STARTS ONLY AFTER ITS AGREEMENTS (role journey L7, PR-E), on a real schema.
 *
 * The open proposal doors (server/routes/openProposals.ts) and the confidentiality
 * doors (server/routes/confidentiality.ts) are registered together, the way
 * server/index.ts registers them, and the seating path is driven through its real
 * doors: an adoption at the door (`placeOnRoles` -> `adoptApplication`), a sign-up
 * through the invitation, and the hourly season turn (`seatFromApplication`).
 *
 *   1. moon mode: no start before both alignments; the holder hears "Two steps
 *      before your role starts"; the role starts at the next turn after both.
 *      CONTROL: the same adoption with the switches off seats at once.
 *   2. season mode: nobody is seated on the season's first day without the
 *      alignments, and they are once aligned. CONTROL: switches off, seated.
 *   3. changed words ask again: an alignment with earlier words stops counting
 *      the moment the words change, and aligning again counts.
 *   4. membership at application: an alignment made on the form, against the
 *      confirmed address, is carried to the account at sign-up and the gate does
 *      not ask for it again. CONTROL: a proposal that did not align carries
 *      nothing and the gate asks.
 *   5. no payment is on the path: a holder with no money of any kind is seated
 *      once aligned, and the gate's steps are the three agreements and nothing else.
 *   6. the confidentiality door refuses changed words and a stale identity
 *      confirmation, and writes nothing then.
 *   7. the agreement's document (Rye, 9 Nov 2026): attached in Admin; served
 *      ONLY to a signed-in member at the step where they align, never to a
 *      visitor and never through a public door; a new upload asks everyone
 *      again. CONTROL: the same file attached again asks nobody.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { openInviteId } from "../../shared/openProposalDecide";
import { letterSourceFrom } from "../../shared/membershipLetter";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { escapeHtml } from "../lib/comms/mailer";
import { addressParty } from "../lib/applicationMembership";
import { currentAgreement } from "../lib/confidentiality";
import { stampConfirmed } from "../lib/identityConfirm";
import { makeInviteDoor } from "../lib/inviteDoor";
import { alignSigning, currentLetter } from "../lib/membershipLetter";
import { createOrgRole, seatHolder } from "../lib/orgChart";
import { START_STEPS, START_WORDS } from "../lib/roleStartAgreements";
import { runSeasonTurn } from "../lib/seasonTurn";
import { usersRepo } from "../repos/users";
import { dbCollection } from "../repos/store-db";
import { inApplicationTransaction } from "../repos/seatApplications";
import { register as registerConfidentiality } from "./confidentiality";
import { register as registerOpenProposals } from "./openProposals";

const configured = testDbConfigured();
if (!configured) console.warn("[roleStartAgreements] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const ORIGIN = "https://village.example.test";
const NEXT = { id: "s-next", name: "Season of Roots", startsOn: "2037-01-01", endsOn: "2037-03-20" };
const NOW_SEASON = { id: "s-now", name: "Season of Seeds", startsOn: "2000-01-01", endsOn: "2037-01-01" };
const FOUNDER = { id: "u-founder", name: "Fern Oak", email: "founder@example.test" };
const ANA = { id: "u-ana", name: "Ana Reed", email: "ana@example.test" };
const AGREEMENT = { title: "Confidentiality agreement", body: "What you read in the village's private records stays with you.\n\nYou keep it after you leave." };
const LETTER_SOURCE = letterSourceFrom({ project: { name: "Test Village", commitmentName: "membership agreement" }, currency: { name: "Seeds" } }, null);

describe.skipIf(!configured)("a role starts only after its agreements, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  let gate = "";
  let founderRole = "";
  let n = 0;
  let signings: ReturnType<typeof dbCollection>;
  const documentDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-agreement-doc-"));

  const state = {
    viewer: null as string | null,
    dials: { "org.start_after_confidentiality": false, "org.start_after_membership": false, "org.start_after_paid_terms": false } as Record<string, boolean>,
    content: { confidentiality: AGREEMENT } as Record<string, unknown>,
    sent: [] as OutgoingEmail[],
    notices: [] as Array<{ userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }>,
    adminNotices: [] as Array<{ type: string; title: string; key: string }>,
  };
  const dialsOn = (on: boolean) => {
    state.dials["org.start_after_confidentiality"] = on;
    state.dials["org.start_after_membership"] = on;
  };

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned
  const calendar = () => ({ seasons: [NOW_SEASON, NEXT], currentSeasonId: "s-now", timezone: "UTC" });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    const users = usersRepo(pool);
    for (const p of [FOUNDER, ANA]) await users.add({ id: p.id, name: p.name, email: p.email, passwordHash: "x", paths: [] } as any);
    await q("INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-land', 'Land Circle', '[]', 0), ('c-core', 'Core Circle', '[]', 0)");
    gate = await createOrgRole(pool, { id: "rsa-role-gate", name: "Gate Keeper", seats: 20, circleId: "c-land", aim: "Open the gate at dawn." });
    founderRole = await createOrgRole(pool, { id: "rsa-role-founder", name: "Founder", seats: 1, circleId: "c-core", aim: "Hold the village." });
    await seatHolder(pool, founderRole, { userId: FOUNDER.id, seasonId: "s-now", termEndsAt: new Date("2036-12-01T00:00:00Z") });

    // The submissions collection as server/index.ts keeps it: the one door a signing row goes in by.
    signings = dbCollection(pool, {
      table: "submissions",
      orderBy: "`submitted_at`, `id`",
      columns: [
        { js: "id", db: "id" },
        { js: "type", db: "type" },
        { js: "status", db: "status" },
        { js: "data", db: "data", kind: "json" },
        { js: "rewarded", db: "rewarded", kind: "bool" },
        { js: "userId", db: "user_id" },
        { js: "userName", db: "user_name" },
        { js: "submittedAt", db: "submitted_at", kind: "time" },
      ],
    });
    await signings.load();

    const app = express();
    app.use(express.json());
    const authedUser = async () => (state.viewer ? await usersRepo(pool).byId(state.viewer) : null);
    registerOpenProposals(app, {
      getPool: () => pool,
      overLimit: async () => false,
      clientIp: () => "203.0.113.9",
      guardCapability: async (_req: any, res: any) => {
        if (state.viewer === FOUNDER.id) return true;
        res.status(state.viewer ? 403 : 401).json({ error: "forbidden" });
        return false;
      },
      authedUser,
      commsPostOffice: { getPool: () => pool },
      deploymentOrigin: () => ORIGIN,
      projectName: () => "Test Village",
      escapeHtml,
      seasonState: () => ({ current: NOW_SEASON, seasons: [NOW_SEASON, NEXT], timezone: "UTC" }),
      postEmail: async (email: OutgoingEmail) => {
        state.sent.push(email);
        return { status: "sent", messageId: `m-${state.sent.length}` } as PostResult;
      },
      governanceLifecycle: () => "public",
      notify: async (x: any) => {
        state.notices.push(x);
        return { fresh: true };
      },
      notifyAdmins: async (type: string, title: string, key: string) => {
        state.adminNotices.push({ type, title, key });
      },
      members: usersRepo(pool),
      firstName: (name: string) => String(name ?? "").trim().split(/\s+/)[0] ?? "",
      liveHoldersOf: async () => [FOUNDER.id],
      rolesCarrying: () => [{ id: founderRole, name: "Founder" }],
      loadRoleHolders: () => [{ roleId: founderRole, userId: FOUNDER.id }],
      seatCalendar: calendar,
      lapse: () => ({ currentSeasonId: "s-now", cadence: "season_turn" }),
      stageOf: async () => "guest",
      recordStageEvent: async () => undefined,
      sessionsOn: () => false,
      letterSource: () => LETTER_SOURCE,
      signings: { insert: (entry: any, also?: any) => signings.insert(entry, also) },
    } as any);
    registerConfidentiality(app, {
      authedUser,
      getPool: () => pool,
      overLimit: async () => false,
      members: usersRepo(pool),
      content: () => state.content,
      boolVar: (k: string) => !!state.dials[k],
      guardCapability: async (_req: any, res: any) => {
        if (state.viewer === FOUNDER.id) return true;
        res.status(state.viewer ? 403 : 401).json({ error: "forbidden" });
        return false;
      },
      documentDir,
      googleAvailable: () => false,
      authSecret: "test-secret",
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    fs.rmSync(documentDir, { recursive: true, force: true });
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    state.viewer = null;
    dialsOn(false);
    state.dials["org.start_after_paid_terms"] = false;
    state.content = { confidentiality: AGREEMENT };
    state.sent.length = 0;
    state.notices.length = 0;
    state.adminNotices.length = 0;
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

  const isLink = (line: string) => {
    try {
      return new URL(line.trim()).origin === new URL(ORIGIN).origin;
    } catch {
      return false;
    }
  };
  const tokenOf = (mail: OutgoingEmail) => new URL((mail.text.split("\n").find(isLink) as string).trim()).searchParams.get("token") as string;

  /** Send and confirm a proposal, aligning with the letter on the form when `align` says so. */
  const proposeAndConfirm = async (email: string, align = false) => {
    const before = state.sent.length;
    const letter = currentLetter(LETTER_SOURCE);
    const r = await call(
      "POST",
      "/api/open-proposals",
      {
        name: "Rowan Field",
        email,
        roles: [{ roleId: gate, note: "I open gates for a living." }],
        why: "The gate is always shut.",
        aim: "The gate opens at dawn.",
        ...(align ? { membership: { letterVersion: letter.version } } : {}),
      },
      null,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const mail = state.sent[before];
    const id = mail.idempotencyKey.split(":")[1];
    expect((await call("POST", "/api/open-proposals/confirm", { token: tokenOf(mail) }, null)).status).toBe(200);
    return id;
  };

  const newAccount = async (label: string) => {
    n += 1;
    const id = `u-${label}-${n}`;
    const email = `${label}-${n}@example.test`;
    await usersRepo(pool).add({ id, name: "Rowan Field", email, passwordHash: "x", paths: [] } as any);
    return { id, email };
  };
  const reconfirmed = async (userId: string) => usersRepo(pool).update(userId, (m: any) => stampConfirmed(m, Date.now()));
  const alignAgreement = async (userId: string) => {
    await reconfirmed(userId);
    const read = await call("GET", "/api/confidentiality", undefined, userId);
    const r = await call("POST", "/api/profile/confidentiality", { version: read.body.agreement.version }, userId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  };
  const alignLetter = async (userId: string) =>
    inApplicationTransaction(pool, (conn) => alignSigning(conn, { letter: currentLetter(LETTER_SOURCE), signingId: `sg-${userId}`, userId, now: new Date() }));
  const seatedIn = (userId: string) => q("SELECT org_role_id FROM org_role_assignments WHERE user_id = ? AND ended_at IS NULL", [userId]);
  const appOf = async (userId: string) => (await q("SELECT id, status FROM seat_applications WHERE candidate_user_id = ? ORDER BY created_at DESC", [userId]))[0];
  const turn = (at: Date, seasonId = "s-now") =>
    runSeasonTurn({
      getPool: () => pool,
      notify: async (x: any) => {
        state.notices.push(x);
        return undefined;
      },
      notifyAdmins: async () => undefined,
      closer: { settle: async () => ({ applied: [], held: null, proposerTold: null }) } as any,
      lapse: () => ({ currentSeasonId: seasonId, cadence: "season_turn" }),
      calendar: () => ({ ...calendar(), currentSeasonId: seasonId }),
      now: () => at,
    });
  /*
   * THE NEXT TURN, A MINUTE ON: inside the hour the brief promises, and past the
   * second `starts_at` is rounded to. `seat_applications.starts_at` is a DATETIME
   * with no fraction, so MySQL 8 (CI) ROUNDS an adoption at :30.6 up to :31, and a
   * turn run in that same second finds nothing due yet (CI, 9 Nov 2026, on this
   * file's "changed words" case; a MariaDB box truncates, so it passed locally).
   * The same rounding was a PRODUCT bug at adoption: an arrival in the second half
   * of a second was adopted and not seated. The fix (whole seconds in
   * `placeOnRoles`, and `startReached` in `notYet`) lands on main in its own PR
   * from the role journey lane. Until this branch carries it, the moon-mode
   * control below is red on MySQL 8 and green on MariaDB.
   */
  const soon = () => new Date(Date.now() + 60_000);
  const moonMode = async <T,>(fn: () => Promise<T>): Promise<T> => {
    expect((await call("PUT", "/api/admin/open-proposals/settings", { term: "moon" }, FOUNDER.id)).status).toBe(200);
    try {
      return await fn();
    } finally {
      await call("PUT", "/api/admin/open-proposals/settings", { term: "season" }, FOUNDER.id);
    }
  };

  describe("moon mode: the role starts at adoption, once the agreements exist", () => {
    it("holds the start until both alignments, says the two steps, and starts at the next turn after", async () => {
      dialsOn(true);
      await moonMode(async () => {
        const who = await newAccount("moon");
        const id = await proposeAndConfirm(who.email);
        const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
        expect(r.status, JSON.stringify(r.body)).toBe(200);

        // Adopted, and nobody seated: the start waits on the agreements.
        expect((await appOf(who.id)).status).toBe("adopted");
        expect(await seatedIn(who.id)).toEqual([]);
        const told = state.notices.filter((x) => x.userId === who.id && x.title === START_WORDS.title(2));
        expect(told).toHaveLength(1);
        expect(told[0].title).toBe("Two steps before your role starts");
        expect(told[0].body).toContain(START_WORDS.step.confidentiality);
        expect(told[0].body).toContain(START_WORDS.step.membership);
        expect(told[0].link).toBe("/aligned");

        // One of two: still nobody seated, and the shorter list is said once.
        await alignAgreement(who.id);
        await turn(soon());
        expect(await seatedIn(who.id)).toEqual([]);
        expect(state.notices.filter((x) => x.userId === who.id && x.title === START_WORDS.title(1))).toHaveLength(1);
        // An hourly retry says nothing new: the same key, which notify (unique dedupe_key) writes once.
        await turn(soon());
        const keys = new Set(state.notices.filter((x) => x.userId === who.id && x.title === START_WORDS.title(1)).map((x) => x.dedupeKey));
        expect(keys.size).toBe(1);

        // Both: the next turn starts the role.
        await alignLetter(who.id);
        await turn(soon());
        expect(await seatedIn(who.id)).toEqual([{ org_role_id: gate }]);
      });
    });

    it("CONTROL: with the switches off the same adoption seats at once, as it does today", async () => {
      await moonMode(async () => {
        const who = await newAccount("moonoff");
        const id = await proposeAndConfirm(who.email);
        expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(200);
        expect(await seatedIn(who.id)).toEqual([{ org_role_id: gate }]);
        expect(state.notices.some((x) => x.title.endsWith("before your role starts"))).toBe(false);
      });
    });
  });

  describe("season mode: the role starts on the season's first day, once the agreements exist", () => {
    const firstDay = new Date("2037-01-01T12:00:00Z");

    it("nobody is seated on the first day without both alignments, and they are at the turn after aligning", async () => {
      dialsOn(true);
      const id = await proposeAndConfirm("season-newcomer@example.test");
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      const token = new URL(String(r.body?.invitation?.link)).searchParams.get("invite") as string;
      const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
      expect(await door.resolve(token)).toMatchObject({ ok: true, id: openInviteId(id) });
      const newcomer = "u-season-newcomer";
      const inviter = await door.claim(openInviteId(id), newcomer);
      await usersRepo(pool).add({ id: newcomer, name: "Rowan Field", email: "season-newcomer@example.test", passwordHash: "x", paths: [] } as any);
      await door.welcome(inviter as string, newcomer);
      expect(state.notices.some((x) => x.userId === newcomer && x.title === START_WORDS.title(2))).toBe(true);

      await turn(firstDay, "s-next");
      expect(await seatedIn(newcomer)).toEqual([]);
      expect((await appOf(newcomer)).status).toBe("adopted");

      await alignAgreement(newcomer);
      await alignLetter(newcomer);
      await turn(firstDay, "s-next");
      expect(await seatedIn(newcomer)).toEqual([{ org_role_id: gate }]);
    });

    it("CONTROL: with the switches off the first day seats them, as it does today", async () => {
      const who = await newAccount("seasonoff");
      const id = await proposeAndConfirm(who.email);
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(200);
      await turn(firstDay, "s-next");
      expect(await seatedIn(who.id)).toEqual([{ org_role_id: gate }]);
    });
  });

  it("CONTROL for the minute: starts_at keeps whole seconds, so a turn a minute on finds it due on either engine", async () => {
    // A DATETIME with no fraction, as the column is. CI's MySQL 8 ROUNDS the fraction (:00.6 reads :01, after the
    // instant it was written at); a MariaDB box truncates it, which is why the case passed locally and failed in CI.
    const [row] = await q("SELECT DATE_FORMAT(CAST('2030-05-05 10:00:00.600' AS DATETIME), '%Y-%m-%dT%H:%i:%sZ') AS t");
    const written = Date.parse("2030-05-05T10:00:00.600Z");
    const stored = Date.parse(String(row.t));
    // Either way it lands within a second of the write...
    expect(Math.abs(stored - written)).toBeLessThan(1000);
    // ...so a turn a minute on always finds it due, on either engine.
    expect(written + 60_000).toBeGreaterThan(stored);
    expect(soon().getTime() - Date.now()).toBeGreaterThanOrEqual(60_000);
  });

  describe("changed words ask again", () => {
    it("an alignment with earlier words stops counting when the words change, and aligning again counts", async () => {
      const who = await newAccount("words");
      await alignAgreement(who.id);
      expect((await call("GET", "/api/confidentiality", undefined, who.id)).body.you).toEqual({ holds: true });

      state.content = { confidentiality: { ...AGREEMENT, body: `${AGREEMENT.body}\n\nAnd one more line.` } };
      expect((await call("GET", "/api/confidentiality", undefined, who.id)).body.you).toEqual({ holds: false });

      // The gate asks again, in moon mode, before the role starts.
      state.dials["org.start_after_confidentiality"] = true;
      await moonMode(async () => {
        const id = await proposeAndConfirm(who.email);
        expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(200);
        expect(await seatedIn(who.id)).toEqual([]);
        expect(state.notices.some((x) => x.userId === who.id && x.title === START_WORDS.title(1))).toBe(true);

        await alignAgreement(who.id);
        expect((await call("GET", "/api/confidentiality", undefined, who.id)).body.you).toEqual({ holds: true });
        await turn(soon());
        expect(await seatedIn(who.id)).toEqual([{ org_role_id: gate }]);
      });
      // The first text was superseded by the second: one in force, never two.
      const texts = await q(
        "SELECT t.id FROM alignment_texts t JOIN alignment_parties p ON p.text_id = t.id WHERE p.user_id = ? AND t.subject_type = 'confidentiality'",
        [who.id],
      );
      expect(texts).toHaveLength(2);
      const ended = await q("SELECT text_id FROM alignment_endings WHERE kind = 'superseded' AND text_id IN (?)", [texts.map((t: any) => t.id)]);
      expect(ended).toHaveLength(1);
    });

    it("the door refuses words that changed while they read, and a stale identity confirmation, and writes nothing", async () => {
      const who = await newAccount("refused");
      const was = currentAgreement(AGREEMENT)!;
      // Never confirmed: asked to confirm first.
      const stale = await call("POST", "/api/profile/confidentiality", { version: was.version }, who.id);
      expect(stale.status).toBe(403);
      expect(stale.body.error).toBe("reconfirm_required");
      await reconfirmed(who.id);
      state.content = { confidentiality: { ...AGREEMENT, title: "Privacy agreement" } };
      const moved = await call("POST", "/api/profile/confidentiality", { version: was.version }, who.id);
      expect(moved.status).toBe(409);
      expect(moved.body.agreement.title).toBe("Privacy agreement");
      expect(await q("SELECT t.id FROM alignment_texts t JOIN alignment_parties p ON p.text_id = t.id WHERE p.user_id = ?", [who.id])).toEqual([]);
      // CONTROL: the version on screen now aligns.
      const ok = await call("POST", "/api/profile/confidentiality", { version: currentAgreement(state.content.confidentiality)!.version }, who.id);
      expect(ok.status).toBe(200);
    });

    it("a village that wrote no agreement offers nothing to align with, and a waiting role tells the admins", async () => {
      state.content = {};
      expect((await call("GET", "/api/confidentiality", undefined, ANA.id)).body).toMatchObject({ agreement: null });
      state.dials["org.start_after_confidentiality"] = true;
      await moonMode(async () => {
        const who = await newAccount("noagreement");
        const id = await proposeAndConfirm(who.email);
        expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(200);
        expect(await seatedIn(who.id)).toEqual([]);
        expect(state.adminNotices.some((x) => x.title === START_WORDS.noAgreement)).toBe(true);
      });
    });
  });

  describe("membership at application (Rye's answer 8)", () => {
    it("is recorded against the confirmed address, carried to the account at sign-up, and not asked again", async () => {
      const email = "aligned-applicant@example.test";
      const id = await proposeAndConfirm(email, true);
      const atAddress = await q(
        "SELECT t.id, t.subject_type FROM alignment_texts t JOIN alignment_parties p ON p.text_id = t.id WHERE p.party_key = ? AND p.user_id IS NULL",
        [addressParty(email)],
      );
      expect(atAddress).toEqual([expect.objectContaining({ subject_type: "membership" })]);
      // Whoever decides reads a yes, and never the address or the words.
      const page = await call("GET", `/api/governance/open-proposals/${id}`, undefined, FOUNDER.id);
      expect(page.body.proposal.membership).toEqual({ aligned: true });
      // The address is never stored: only its fingerprint names the party.
      expect(JSON.stringify(await q("SELECT party_key FROM alignment_parties WHERE text_id = ?", [atAddress[0].id]))).not.toContain(email);

      state.dials["org.start_after_membership"] = true;
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      const token = new URL(String(r.body?.invitation?.link)).searchParams.get("invite") as string;
      const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
      expect(await door.resolve(token)).toMatchObject({ ok: true });
      const newcomer = "u-aligned-applicant";
      const inviter = await door.claim(openInviteId(id), newcomer);
      await usersRepo(pool).add({ id: newcomer, name: "Rowan Field", email, passwordHash: "x", paths: [] } as any);
      await door.welcome(inviter as string, newcomer);

      // Carried: the account holds the letter in its own name, and the address's text is superseded by it.
      const mine = await q(
        "SELECT t.id, t.body FROM alignment_texts t JOIN alignment_parties p ON p.text_id = t.id WHERE p.user_id = ? AND t.subject_type = 'membership'",
        [newcomer],
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].body).toBe(currentLetter(LETTER_SOURCE).body);
      expect(await q("SELECT refers_to FROM alignment_endings WHERE text_id = ? AND kind = 'superseded'", [atAddress[0].id])).toEqual([{ refers_to: mine[0].id }]);
      // A form alone never admits anyone: the signing request a steward accepts is queued, in their name,
      // exactly like a normal signing, and the account's letter names it.
      const queued = await q("SELECT id, type, status, user_id, data FROM submissions WHERE user_id = ?", [newcomer]);
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ type: "membership-508", status: "new", user_id: newcomer });
      const data = typeof queued[0].data === "string" ? JSON.parse(queued[0].data) : queued[0].data;
      expect(data).toMatchObject({ email, letterVersion: currentLetter(LETTER_SOURCE).version, alignedAtApplication: true });
      expect(data).not.toHaveProperty("monthlyContribution");
      expect(signings.all().some((r: any) => r.id === queued[0].id)).toBe(true);
      expect((await q("SELECT subject_ref FROM alignment_texts WHERE id = ?", [mine[0].id]))[0].subject_ref).toBe(`${currentLetter(LETTER_SOURCE).version}:${queued[0].id}`);
      const after = await usersRepo(pool).byId(newcomer);
      expect(after?.membershipGranted ?? false).toBeFalsy();
      expect(after?.stageGranted ?? null).not.toBe("member");
      // A second arrival hook run (a retry) queues nothing twice.
      await door.welcome(inviter as string, newcomer);
      expect(await q("SELECT id FROM submissions WHERE user_id = ?", [newcomer])).toHaveLength(1);
      // Not asked again: no step names the membership letter.
      expect(state.notices.some((x) => x.userId === newcomer && x.title.endsWith("before your role starts"))).toBe(false);
      await turn(new Date("2037-01-01T12:00:00Z"), "s-next");
      // Seated with nothing paid: no step, no dues, no contribution stood between them and the start.
      expect(await seatedIn(newcomer)).toEqual([{ org_role_id: gate }]);
    });

    it("CONTROL: a proposal that did not align carries nothing, and the gate asks for the letter", async () => {
      const email = "unaligned-applicant@example.test";
      const id = await proposeAndConfirm(email, false);
      expect(await q("SELECT text_id FROM alignment_parties WHERE party_key = ?", [addressParty(email)])).toEqual([]);
      expect((await call("GET", `/api/governance/open-proposals/${id}`, undefined, FOUNDER.id)).body.proposal.membership).toEqual({ aligned: false });
      state.dials["org.start_after_membership"] = true;
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      const token = new URL(String(r.body?.invitation?.link)).searchParams.get("invite") as string;
      const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
      await door.resolve(token);
      const newcomer = "u-unaligned-applicant";
      const inviter = await door.claim(openInviteId(id), newcomer);
      await usersRepo(pool).add({ id: newcomer, name: "Rowan Field", email, passwordHash: "x", paths: [] } as any);
      await door.welcome(inviter as string, newcomer);
      const told = state.notices.find((x) => x.userId === newcomer && x.title === START_WORDS.title(1));
      expect(told?.body).toContain(START_WORDS.step.membership);
      expect(told?.link).toBe("/love-letter");
      await turn(new Date("2037-01-01T12:00:00Z"), "s-next");
      expect(await seatedIn(newcomer)).toEqual([]);
      // CONTROL for the queue: nothing aligned at application, so no signing is queued on their behalf.
      expect(await q("SELECT id FROM submissions WHERE user_id = ?", [newcomer])).toEqual([]);
    });

    it("an address that already has an account is carried at confirm, with its signing request queued once", async () => {
      const who = await newAccount("already-here");
      await proposeAndConfirm(who.email, true);
      const queued = await q("SELECT type, status FROM submissions WHERE user_id = ?", [who.id]);
      expect(queued).toEqual([{ type: "membership-508", status: "new" }]);
      expect(await q("SELECT t.id FROM alignment_texts t JOIN alignment_parties p ON p.text_id = t.id WHERE p.user_id = ? AND t.subject_type = 'membership'", [who.id])).toHaveLength(1);
      // A second proposal aligned with the same words carries nothing more and queues nothing more.
      await proposeAndConfirm(who.email, true);
      expect(await q("SELECT id FROM submissions WHERE user_id = ?", [who.id])).toHaveLength(1);
    });

    it("refuses a letter version that is not the letter on screen now, and sends nothing", async () => {
      const before = state.sent.length;
      const r = await call(
        "POST",
        "/api/open-proposals",
        { name: "Rowan Field", email: "stale-letter@example.test", roles: [{ roleId: gate, note: "" }], why: "The gate.", aim: "", membership: { letterVersion: "lv-0000000000000000" } },
        null,
      );
      expect(r.status).toBe(409);
      expect(r.body.field).toBe("membership");
      expect(r.body.letter.version).toBe(currentLetter(LETTER_SOURCE).version);
      expect(state.sent.length).toBe(before);
    });
  });

  describe("the agreement's document (Rye, 9 Nov 2026)", () => {
    const DOC_TITLE = "Test Village and Example Holdings NDA";
    const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n`, "latin1");
    const attach = async (bytes: Buffer, name: string, title: string, as: string | null = FOUNDER.id) => {
      const before = state.viewer;
      state.viewer = as;
      try {
        const form = new FormData();
        form.append("title", title);
        form.append("file", new Blob([bytes], { type: "application/pdf" }), name);
        const res = await fetch(`${base}/api/admin/confidentiality/document`, { method: "POST", body: form }); // module-review-ok: a test calling its own local server
        return { status: res.status, body: (await res.json()) as any };
      } finally {
        state.viewer = before;
      }
    };
    const read = async (as: string | null) => {
      const before = state.viewer;
      state.viewer = as;
      try {
        const res = await fetch(`${base}/api/confidentiality/document`); // module-review-ok: a test calling its own local server
        return { status: res.status, type: res.headers.get("content-type") ?? "", cache: res.headers.get("cache-control") ?? "", bytes: Buffer.from(await res.arrayBuffer()) };
      } finally {
        state.viewer = before;
      }
    };

    afterAll(async () => {
      await call("DELETE", "/api/admin/confidentiality/document", undefined, FOUNDER.id);
    });

    it("is served only to somebody signed in, never to a visitor, and its title never reaches a visitor", async () => {
      const bytes = pdf("first");
      const up = await attach(bytes, "Agreement.pdf", DOC_TITLE);
      expect(up.status, JSON.stringify(up.body)).toBe(200);
      expect(up.body.document).toMatchObject({ title: DOC_TITLE, size: bytes.length });

      // A visitor: nothing about the document, not even its title, and the file is refused.
      const visitorView = await call("GET", "/api/confidentiality", undefined, null);
      expect(visitorView.body).toMatchObject({ agreement: null, exists: true, you: null });
      expect(JSON.stringify(visitorView.body)).not.toContain(DOC_TITLE);
      const refused = await read(null);
      expect(refused.status).toBe(401);
      expect(refused.bytes.includes(Buffer.from("%PDF"))).toBe(false);
      // The admin record is for the hand that writes the words.
      expect((await call("GET", "/api/admin/confidentiality/document", undefined, null)).status).toBe(401);
      expect((await call("GET", "/api/admin/confidentiality/document", undefined, ANA.id)).status).toBe(403);
      // The bytes are outside every public folder: only the document folder holds them.
      expect(fs.readdirSync(documentDir).filter((f) => f.endsWith(".pdf"))).toHaveLength(1);

      // A signed-in member, at the step where they align: the title, the link, and the file itself.
      const memberView = await call("GET", "/api/confidentiality", undefined, ANA.id);
      expect(memberView.body.agreement.document).toEqual({ title: DOC_TITLE, size: bytes.length, href: "/api/confidentiality/document" });
      const served = await read(ANA.id);
      expect(served.status).toBe(200);
      expect(served.type).toContain("application/pdf");
      expect(served.cache).toContain("no-store");
      expect(served.bytes.equals(bytes)).toBe(true);
    });

    it("a new upload asks everyone again; CONTROL: the same file attached again asks nobody", async () => {
      await attach(pdf("v1"), "Agreement.pdf", DOC_TITLE);
      const who = await newAccount("doc-holder");
      await alignAgreement(who.id);
      const holds = async () => (await call("GET", "/api/confidentiality", undefined, who.id)).body.you;
      expect(await holds()).toEqual({ holds: true });

      // The same bytes and title again: the same words, so they still hold it.
      expect((await attach(pdf("v1"), "Agreement.pdf", DOC_TITLE)).status).toBe(200);
      expect(await holds()).toEqual({ holds: true });

      // A new file: the fingerprint moved, and they are asked again.
      expect((await attach(pdf("v2"), "Agreement.pdf", DOC_TITLE)).status).toBe(200);
      expect(await holds()).toEqual({ holds: false });
      // The stored words of their next alignment name the new file by its fingerprint.
      await alignAgreement(who.id);
      expect(await holds()).toEqual({ holds: true });
      const newest = await q(
        "SELECT t.body FROM alignment_texts t JOIN alignment_parties p ON p.text_id = t.id WHERE p.user_id = ? AND t.subject_type = 'confidentiality' ORDER BY t.version DESC LIMIT 1",
        [who.id],
      );
      const sha = (await call("GET", "/api/admin/confidentiality/document", undefined, FOUNDER.id)).body.document.sha256;
      expect(newest[0].body).toContain(sha);
    });

    it("refuses a file that is not a PDF, and anybody without the pen, and changes nothing", async () => {
      const before = (await call("GET", "/api/admin/confidentiality/document", undefined, FOUNDER.id)).body.document;
      expect((await attach(Buffer.from("not a pdf"), "Agreement.pdf", DOC_TITLE)).status).toBe(400);
      expect((await attach(pdf("x"), "Agreement.docx", DOC_TITLE)).status).toBe(400);
      expect((await attach(pdf("x"), "Agreement.pdf", DOC_TITLE, ANA.id)).status).toBe(403);
      expect((await attach(pdf("x"), "Agreement.pdf", DOC_TITLE, null)).status).toBe(401);
      expect((await call("GET", "/api/admin/confidentiality/document", undefined, FOUNDER.id)).body.document).toEqual(before);
    });

    it("a title left blank takes the file's own name, so the village's words come from the village", async () => {
      const up = await attach(pdf("named"), "Test Village Agreement.pdf", "");
      expect(up.body.document.title).toBe("Test Village Agreement");
    });
  });

  describe("the doors a new holder is sent to (role journey L7 follow-up)", () => {
    const adoptionMail = (email: string) => state.sent.filter((m) => m.origin === "open_proposal.adopted" && JSON.stringify(m).includes(email)).pop();

    it("the adoption letter drops the Love Letter line for an applicant who aligned on the form; CONTROL: it keeps it for one who did not", async () => {
      const aligned = "letter-aligned@example.test";
      const id = await proposeAndConfirm(aligned, true);
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(200);
      const sent = adoptionMail(aligned);
      expect(sent, "the adoption letter went").toBeTruthy();
      expect(String(sent!.text)).not.toContain("/love-letter");
      expect(String(sent!.text)).not.toMatch(/align with the Love Letter/i);

      const unaligned = "letter-unaligned@example.test";
      const other = await proposeAndConfirm(unaligned, false);
      expect((await call("POST", `/api/governance/open-proposals/${other}/adopt`, {}, FOUNDER.id)).status).toBe(200);
      expect(String(adoptionMail(unaligned)!.text)).toContain(`${ORIGIN}/love-letter`);
    });

    it("an account already here that aligned on the form gets no Love Letter line either", async () => {
      const who = await newAccount("letter-account");
      const id = await proposeAndConfirm(who.email, true);
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(200);
      expect(String(adoptionMail(who.email)!.text)).not.toContain("/love-letter");
    });

    it("the profile lists the steps before a role starts, to its holder alone, and empties once aligned", async () => {
      dialsOn(true);
      await moonMode(async () => {
        const who = await newAccount("steps");
        const id = await proposeAndConfirm(who.email);
        expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(200);
        const mine = await call("GET", "/api/profile/role-start-steps", undefined, who.id);
        expect(mine.status).toBe(200);
        expect(mine.body.waiting).toHaveLength(1);
        expect(mine.body.waiting[0].roles).toEqual(["Gate Keeper"]);
        expect(mine.body.waiting[0].steps).toEqual([
          { step: "confidentiality", href: "/aligned" },
          { step: "membership", href: "/love-letter" },
        ]);
        // Nobody else reads them, and a visitor is refused.
        expect((await call("GET", "/api/profile/role-start-steps", undefined, ANA.id)).body.waiting).toEqual([]);
        expect((await call("GET", "/api/profile/role-start-steps", undefined, null)).status).toBe(401);

        await alignAgreement(who.id);
        expect((await call("GET", "/api/profile/role-start-steps", undefined, who.id)).body.waiting[0].steps.map((x: any) => x.step)).toEqual(["membership"]);
        await alignLetter(who.id);
        // Nothing waits on them now: the card goes, and the next turn seats them.
        expect((await call("GET", "/api/profile/role-start-steps", undefined, who.id)).body.waiting).toEqual([]);
        await turn(soon());
        expect(await seatedIn(who.id)).toEqual([{ org_role_id: gate }]);
        expect((await call("GET", "/api/profile/role-start-steps", undefined, who.id)).body.waiting).toEqual([]);
      });
    });

    it("CONTROL: with the switches off the profile lists nothing, as the role starts at once", async () => {
      await moonMode(async () => {
        const who = await newAccount("steps-off");
        const id = await proposeAndConfirm(who.email);
        expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(200);
        expect((await call("GET", "/api/profile/role-start-steps", undefined, who.id)).body.waiting).toEqual([]);
      });
    });
  });

  it("no payment is ever a step: the gate knows the three agreements and nothing else", () => {
    expect([...START_STEPS]).toEqual(["confidentiality", "membership", "terms"]);
    for (const s of START_STEPS) expect(START_WORDS.step[s]).not.toMatch(/pay|contribut|dues|fee/i);
  });
});
