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
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { consentClosesAt, CONSENT_WORDS } from "../../shared/roleProposalConsent";
import { DECIDE_WORDS, openInviteId } from "../../shared/openProposalDecide";
import { whoMayPutHandToVillage } from "../../shared/powerHands";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { escapeHtml } from "../lib/comms/mailer";
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
const NEXT = { id: "s-next", name: "Season of Roots", startsOn: "2099-01-01", endsOn: "2099-03-20" };
const NOW_SEASON = { id: "s-now", name: "Season of Seeds", startsOn: "2000-01-01", endsOn: "2098-12-31" };
const FOUNDER = { id: "u-founder", name: "Fern Oak", email: "founder@example.test" };
const ANA = { id: "u-ana", name: "Ana Reed", email: "ana@example.test" };
const BEN = { id: "u-ben", name: "Ben Moss", email: "ben@example.test" };
const MO = { id: "u-mo", name: "Mo Hill", email: "mo@example.test" };
const HAS = { id: "u-has", name: "Rowan Field", email: "rowan-has@example.test" };
const HIGH = { id: "u-high", name: "Hal Pine", email: "hal@example.test" };

describe.skipIf(!configured)("open role proposals, the decision, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  let gate = "";
  let well = "";
  let founderRole = "";

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
    const until = new Date("2098-12-01T00:00:00Z");
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

  const tokenOf = (mail: OutgoingEmail) => new URL(mail.text.split("\n").find((l) => l.startsWith(ORIGIN)) as string).searchParams.get("token") as string;

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
      expect(p.roles).toEqual([{ id: gate, name: "Gate Keeper", circle: "Land Circle", note: "I open gates for a living." }]);
      expect(p.season).toMatchObject({ id: "s-next", name: "Season of Roots", startsOn: "2099-01-01" });
      expect(p.consent).toMatchObject({ state: "open", asked: 2, consented: 0, objected: 0 });
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

      expect((await usersRepo(pool).byId(newcomer))?.stageGranted).toBe("member");
      const apps = await q("SELECT id, status, seat_ids, term_season_id, adopted_via, adopted_ref, authority_ref, UNIX_TIMESTAMP(starts_at) AS starts_s FROM seat_applications WHERE candidate_user_id = ?", [newcomer]);
      expect(apps).toHaveLength(1);
      expect(apps[0]).toMatchObject({ status: "adopted", term_season_id: "s-next", adopted_via: "holder", adopted_ref: FOUNDER.id, authority_ref: `org.seat@${founderRole}` });
      expect(JSON.parse(String(apps[0].seat_ids))).toEqual([gate]);
      expect(Number(apps[0].starts_s) * 1000).toBe(Date.parse("2099-01-01T00:00:00Z"));
      expect(state.notices.some((n) => n.userId === newcomer && n.link === `/role-applications/${apps[0].id}`)).toBe(true);
      expect(state.adminNotices).toEqual([]);

      // The season turn seats them on the first day, as it seats any adopted application.
      const at = new Date("2099-01-01T12:00:00Z");
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
    it("raises it to the Member stage and gives it the roles for the target season, with no invitation", async () => {
      const { id } = await confirmed(HAS.email, [well]);
      const r = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ success: true, status: "adopted", account: true, invitation: null });
      expect(r.body.message).toBe(`${DECIDE_WORDS.adoptedAccount} ${DECIDE_WORDS.accountTold}`);
      expect(await q("SELECT id FROM member_invites WHERE id = ?", [openInviteId(id)])).toEqual([]);
      expect((await usersRepo(pool).byId(HAS.id))?.stageGranted).toBe("member");
      expect(state.stageEvents).toEqual([expect.objectContaining({ userId: HAS.id, to: "member" })]);
      const apps = await q("SELECT status, seat_ids, term_season_id, adopted_ref FROM seat_applications WHERE candidate_user_id = ?", [HAS.id]);
      expect(apps).toEqual([expect.objectContaining({ status: "adopted", term_season_id: "s-next", adopted_ref: FOUNDER.id })]);
      expect(JSON.parse(String(apps[0].seat_ids))).toEqual([well]);
      const mail = state.sent.find((m) => m.origin === "open_proposal.adopted");
      expect(mail?.text).toContain(`${ORIGIN}/profile`);
      expect(mail?.text).not.toContain("invite");
    });

    it("never lowers a stage granted above Member", async () => {
      const { id } = await confirmed(HIGH.email, [gate]);
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(200);
      expect((await usersRepo(pool).byId(HIGH.id))?.stageGranted).toBe("co-creator");
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
});
