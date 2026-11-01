/**
 * OPEN ROLE PROPOSALS, THE INTAKE, over real HTTP and the S5 scratch schema
 * (server/routes/openProposals.ts), with the mail door handed in as a fake
 * that records what would go out. Nothing here reaches a provider.
 *
 * What is pinned:
 *
 *   - WHO CAN OPEN THE FORM: the public link is on unless switched off (sheet
 *     19i); a link made for one person opens it whatever the switch says,
 *     until it is switched off itself; the governance module has to be on.
 *     Only live roles in live circles are offered, never an example.
 *   - NOTHING UNCONFIRMED REACHES A PERSON: a proposal is kept unconfirmed and
 *     the address gets one essential email with a link; the desk lists only
 *     confirmed proposals; a send that did not go keeps nothing.
 *   - The link confirms once, and not after 48 hours.
 *   - The gates on the way in: the honeypot, a cap per connection and per
 *     address, and every field checked, with the field named.
 *   - The tidy job: unconfirmed after 48 hours is deleted, and a declined or
 *     withdrawn proposal loses its name and address after 90 days.
 *   - The desk: the gate on `intake.moderate`; the switch; a link shown once
 *     and switched off.
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { OPEN_WORDS } from "../../shared/openProposals";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { escapeHtml } from "../lib/comms/mailer";
import { createOrgRole } from "../lib/orgChart";
import { readOpenProposal } from "../repos/openProposals";
import { usersRepo } from "../repos/users";
import { register, tidyOpenProposals } from "./openProposals";

const configured = testDbConfigured();
if (!configured) console.warn("[openProposals] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const ORIGIN = "https://village.example.test";
const ADMIN = { id: "u-admin", name: "Ada Stone" };
const MEMBER = { id: "u-member", name: "Ivo Lantern" };
const NEXT = { id: "s-next", name: "Season of Roots", startsOn: "2099-01-01", endsOn: "2099-03-20" };
const NOW_SEASON = { id: "s-now", name: "Season of Seeds", startsOn: "2000-01-01", endsOn: "2098-12-31" };

describe.skipIf(!configured)("open role proposals, the intake, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  let gate = "";
  let well = "";
  let example = "";
  let dormant = "";

  const state = {
    viewer: null as { id: string; name: string } | null,
    moderators: [ADMIN.id] as string[],
    governance: "public",
    seasons: [NOW_SEASON, NEXT] as any[],
    limited: [] as string[],
    sent: [] as OutgoingEmail[],
    answer: { status: "sent", messageId: "m-1" } as PostResult,
    clock: null as Date | null,
  };

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await q("INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-land', 'Land Circle', '[]', 0), ('c-old', 'Old Circle', '[]', 0)");
    await q("UPDATE circles SET status = 'dormant' WHERE id = 'c-old'");
    gate = await createOrgRole(pool, { id: "op-role-gate", name: "Gate Keeper", seats: 2, circleId: "c-land", aim: "Open the gate at dawn." });
    well = await createOrgRole(pool, { id: "op-role-well", name: "Well Keeper", seats: 2, circleId: "c-land", aim: "Keep the well clean." });
    example = await createOrgRole(pool, { id: "op-role-example", name: "Example Keeper", seats: 1, circleId: "c-land", aim: "A sample." });
    await q("UPDATE org_roles SET is_example = 1 WHERE id = ?", [example]);
    dormant = await createOrgRole(pool, { id: "op-role-dormant", name: "Old Keeper", seats: 1, circleId: "c-old", aim: "Gone." });

    const app = express();
    app.use(express.json());
    register(app, {
      getPool: () => pool,
      overLimit: async (bucket: string) => state.limited.some((b) => bucket.startsWith(b)),
      clientIp: () => "203.0.113.9",
      guardCapability: async (_req: any, res: any) => {
        if (state.viewer && state.moderators.includes(state.viewer.id)) return true;
        res.status(state.viewer ? 403 : 401).json({ error: state.viewer ? "forbidden" : "auth_required" });
        return false;
      },
      authedUser: async () => state.viewer,
      commsPostOffice: { getPool: () => pool },
      deploymentOrigin: () => ORIGIN,
      projectName: () => "Test Village",
      escapeHtml,
      seasonState: () => ({ current: NOW_SEASON, seasons: state.seasons, timezone: "UTC" }),
      postEmail: async (email: OutgoingEmail) => {
        state.sent.push(email);
        return state.answer;
      },
      governanceLifecycle: () => state.governance,
      now: () => state.clock ?? new Date(),
      // What the confirm step reads to ask the circle (part B, server/routes/openProposalDecide.test.ts pins it).
      notify: async () => ({ fresh: true }),
      notifyAdmins: async () => undefined,
      members: usersRepo(pool),
      liveHoldersOf: async () => [],
      rolesCarrying: () => [],
      loadRoleHolders: () => [],
      seatCalendar: () => ({ seasons: state.seasons, currentSeasonId: "s-now", timezone: "UTC" }),
      lapse: () => ({ currentSeasonId: "s-now", cadence: "season_turn" }),
      stageOf: async () => "guest",
      recordStageEvent: async () => undefined,
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
    state.moderators = [ADMIN.id];
    state.governance = "public";
    state.seasons = [NOW_SEASON, NEXT];
    state.limited = [];
    state.sent.length = 0;
    state.answer = { status: "sent", messageId: "m-1" };
    state.clock = null;
    await q("DELETE FROM app_config WHERE config_key = 'open-proposals'");
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { // module-review-ok: a test calling its own local server, never an outside host
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  const proposal = (over: Record<string, unknown> = {}) => ({
    name: "Rowan Field",
    email: "rowan@example.test",
    roles: [{ roleId: gate, note: "I open gates for a living." }],
    why: "I live up the road and the gate is always shut.",
    aim: "The gate opens at dawn every day.",
    ...over,
  });

  const tokenOf = (mail: OutgoingEmail) => new URL(mail.text.split("\n").find((l) => l.startsWith(ORIGIN)) as string).searchParams.get("token") as string;

  /** Send a proposal, and answer the id of the row it wrote and the token its email carried. */
  const send = async (over: Record<string, unknown> = {}) => {
    const before = state.sent.length;
    const r = await call("POST", "/api/open-proposals", proposal(over));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const mail = state.sent[before];
    const id = mail.idempotencyKey.split(":")[1];
    return { id, token: tokenOf(mail), mail };
  };

  describe("who can open the form", () => {
    it("the public link is on unless switched off, and offers only live roles in live circles", async () => {
      const r = await call("GET", "/api/open-proposals/form");
      expect(r.body).toMatchObject({ open: true, village: "Test Village", season: { id: "s-next", name: "Season of Roots", startsOn: "2099-01-01" } });
      expect(r.body.roles.map((x: any) => x.id).sort()).toEqual([gate, well].sort());
      expect(r.body.roles.find((x: any) => x.id === gate)).toEqual({ id: gate, name: "Gate Keeper", circle: "Land Circle", aim: "Open the gate at dawn." });
      expect(JSON.stringify(r.body)).not.toContain(example);
      expect(JSON.stringify(r.body)).not.toContain(dormant);
    });

    it("the governance module off closes it, and no next season says so", async () => {
      state.governance = "off";
      expect((await call("GET", "/api/open-proposals/form")).body).toEqual({ open: false, message: OPEN_WORDS.closed });
      expect((await call("POST", "/api/open-proposals", proposal())).status).toBe(403);
      state.governance = "public";
      state.seasons = [NOW_SEASON];
      expect((await call("GET", "/api/open-proposals/form")).body).toMatchObject({ open: true, season: null, roles: [] });
      const refused = await call("POST", "/api/open-proposals", proposal());
      expect(refused.status).toBe(409);
      expect(refused.body.error).toBe(OPEN_WORDS.noSeason);
      expect(state.sent).toHaveLength(0);
    });

    it("the switch off closes the public link, a link made for one person still opens it, and a switched-off link does not", async () => {
      state.viewer = ADMIN;
      expect((await call("PUT", "/api/admin/open-proposals/settings", { publicLink: false })).body).toMatchObject({ publicLink: false, message: OPEN_WORDS.publicOff });
      const made = await call("POST", "/api/admin/open-proposals/links", { label: "Sol from the market" });
      expect(made.status).toBe(200);
      expect(made.body.url.startsWith(`${ORIGIN}/propose-a-role/`)).toBe(true);
      const token = decodeURIComponent(made.body.url.split("/propose-a-role/")[1]);
      state.viewer = null;

      expect((await call("GET", "/api/open-proposals/form")).body.open).toBe(false);
      expect((await call("POST", "/api/open-proposals", proposal())).status).toBe(403);
      const viaLink = await call("GET", `/api/open-proposals/form?link=${encodeURIComponent(token)}`);
      expect(viaLink.body.open).toBe(true);
      // The admin's label for the person is never shown on the page.
      expect(JSON.stringify(viaLink.body)).not.toContain("Sol from the market");
      const sent = await send({ link: token, email: "sol@example.test" });
      expect((await readOpenProposal(pool, sent.id))?.linkId).toBe(made.body.id);

      state.viewer = ADMIN;
      expect((await call("POST", `/api/admin/open-proposals/links/${made.body.id}/revoke`)).body.message).toBe(OPEN_WORDS.linkOff);
      expect((await call("POST", `/api/admin/open-proposals/links/${made.body.id}/revoke`)).status).toBe(404);
      state.viewer = null;
      expect((await call("GET", `/api/open-proposals/form?link=${encodeURIComponent(token)}`)).body.open).toBe(false);
      expect((await call("GET", "/api/open-proposals/form?link=not-a-real-link")).body.open).toBe(false);
    });
  });

  describe("nothing unconfirmed reaches a person", () => {
    it("a proposal is kept unconfirmed and its address gets one essential email with a link, and nothing else", async () => {
      const { id, mail } = await send();
      expect(mail).toMatchObject({ kind: "essential", origin: "open_proposal.confirm", to: { email: "rowan@example.test", name: "Rowan" }, subject: "Confirm your proposal to Test Village" });
      expect(mail.text).toContain("You proposed to hold Gate Keeper in Test Village next season.");
      expect(mail.text).toContain(`${ORIGIN}/propose-a-role/confirm?token=`);
      expect(state.sent).toHaveLength(1);
      const row = await readOpenProposal(pool, id);
      expect(row).toMatchObject({ status: "unconfirmed", name: "Rowan Field", email: "rowan@example.test", targetSeasonId: "s-next", linkId: null });
      expect(row?.body).toEqual({ roles: [{ roleId: gate, note: "I open gates for a living." }], why: "I live up the road and the gate is always shut.", aim: "The gate opens at dawn every day." });
      // The desk does not see it.
      state.viewer = ADMIN;
      expect((await call("GET", "/api/admin/open-proposals")).body.proposals.map((p: any) => p.id)).not.toContain(id);
    });

    it("the link confirms it once, then the desk sees it; a second use, a wrong token and one past 48 hours are refused", async () => {
      const { id, token } = await send();
      const ok = await call("POST", "/api/open-proposals/confirm", { token });
      expect(ok.body).toEqual({ confirmed: true, message: OPEN_WORDS.confirmed });
      expect((await readOpenProposal(pool, id))?.status).toBe("confirmed");
      const again = await call("POST", "/api/open-proposals/confirm", { token });
      expect(again.status).toBe(410);
      expect(again.body.error).toBe(OPEN_WORDS.confirmGone);
      expect((await call("POST", "/api/open-proposals/confirm", { token: "nope" })).status).toBe(410);
      expect((await call("POST", "/api/open-proposals/confirm", {})).status).toBe(410);

      state.viewer = ADMIN;
      const desk = await call("GET", "/api/admin/open-proposals");
      const seen = desk.body.proposals.find((p: any) => p.id === id);
      expect(seen).toMatchObject({ name: "Rowan Field", email: "rowan@example.test", via: null, roles: [{ roleId: gate, name: "Gate Keeper (Land Circle)", note: "I open gates for a living." }] });

      const late = await send({ email: "late@example.test" });
      state.clock = new Date(Date.now() + 49 * 60 * 60_000);
      expect((await call("POST", "/api/open-proposals/confirm", { token: late.token })).status).toBe(410);
      expect((await readOpenProposal(pool, late.id))?.status).toBe("unconfirmed");
    });

    it("a confirmation that did not go keeps nothing, and says so", async () => {
      state.answer = { status: "skipped", messageId: null, reason: "not_configured" };
      const before = (await q("SELECT COUNT(*) AS n FROM open_role_proposals"))[0].n;
      const r = await call("POST", "/api/open-proposals", proposal({ email: "nowhere@example.test" }));
      expect(r.status).toBe(503);
      expect(r.body.error).toBe(OPEN_WORDS.notSent);
      expect((await q("SELECT COUNT(*) AS n FROM open_role_proposals"))[0].n).toBe(before);
    });
  });

  describe("the gates on the way in", () => {
    it("the honeypot pretends it went and keeps nothing", async () => {
      const before = (await q("SELECT COUNT(*) AS n FROM open_role_proposals"))[0].n;
      expect((await call("POST", "/api/open-proposals", { ...proposal(), hp: "I am a bot" })).body).toEqual({ sent: true });
      expect((await q("SELECT COUNT(*) AS n FROM open_role_proposals"))[0].n).toBe(before);
      expect(state.sent).toHaveLength(0);
    });

    it("a cap per connection and a cap per address", async () => {
      state.limited = ["open-proposal:ip:"];
      expect((await call("POST", "/api/open-proposals", proposal())).status).toBe(429);
      state.limited = ["open-proposal:email:"];
      const r = await call("POST", "/api/open-proposals", proposal());
      expect(r.status).toBe(429);
      expect(r.body.error).toBe(OPEN_WORDS.tooMany);
      expect(state.sent).toHaveLength(0);
    });

    it.each([
      ["no name", { name: "  " }, "name", OPEN_WORDS.needName],
      ["no address", { email: "" }, "email", OPEN_WORDS.needEmail],
      ["two addresses", { email: "a@example.test, b@example.test" }, "email", OPEN_WORDS.needEmail],
      ["no role", { roles: [] }, "roles", OPEN_WORDS.needRole],
      ["four roles", { roles: [1, 2, 3, 4].map(() => ({ roleId: "x" })) }, "roles", OPEN_WORDS.tooManyRoles],
      ["an example role", { roles: [{ roleId: "op-role-example" }] }, "roles", OPEN_WORDS.unknownRole],
      ["a role in a dormant circle", { roles: [{ roleId: "op-role-dormant" }] }, "roles", OPEN_WORDS.unknownRole],
      ["the same role twice", { roles: [{ roleId: "op-role-gate" }, { roleId: "op-role-gate" }] }, "roles", OPEN_WORDS.sameRoleTwice],
      ["no why", { why: "" }, "why", OPEN_WORDS.needWhy],
      ["a why too long", { why: "x".repeat(1201) }, "why", OPEN_WORDS.tooLong("Why you", 1200)],
    ])("refuses %s, naming the field", async (_label, over, field, error) => {
      const r = await call("POST", "/api/open-proposals", proposal(over));
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error, field });
      expect(state.sent).toHaveLength(0);
    });
  });

  describe("the tidy job (sheet 19i)", () => {
    it("deletes what was never confirmed after 48 hours, and takes the name and address off what was declined or withdrawn after 90 days", async () => {
      const fresh = await send({ email: "fresh@example.test" });
      const old = await send({ email: "old@example.test" });
      await q("UPDATE open_role_proposals SET created_at = ? WHERE id = ?", [new Date(Date.now() - 49 * 60 * 60_000), old.id]);
      const confirmedOld = await send({ email: "kept@example.test" });
      await call("POST", "/api/open-proposals/confirm", { token: confirmedOld.token });
      await q("UPDATE open_role_proposals SET created_at = ? WHERE id = ?", [new Date(Date.now() - 49 * 60 * 60_000), confirmedOld.id]);
      const declined = await send({ email: "no@example.test" });
      const recent = await send({ email: "recent@example.test" });
      await q("UPDATE open_role_proposals SET status = 'declined', decided_at = ? WHERE id = ?", [new Date(Date.now() - 91 * 24 * 60 * 60_000), declined.id]);
      await q("UPDATE open_role_proposals SET status = 'withdrawn', decided_at = ? WHERE id = ?", [new Date(Date.now() - 10 * 24 * 60 * 60_000), recent.id]);

      const said = await tidyOpenProposals(pool, new Date());
      expect(said).toMatch(/^\d+ unconfirmed deleted, \d+ anonymised$/);
      expect(await readOpenProposal(pool, old.id)).toBeNull();
      expect((await readOpenProposal(pool, fresh.id))?.status).toBe("unconfirmed");
      // Confirmed is never deleted, however old.
      expect((await readOpenProposal(pool, confirmedOld.id))?.status).toBe("confirmed");
      expect(await readOpenProposal(pool, declined.id)).toMatchObject({ status: "declined", name: null, email: null });
      expect(await readOpenProposal(pool, recent.id)).toMatchObject({ status: "withdrawn", name: "Rowan Field", email: "recent@example.test" });
      // A second run finds nothing more to do.
      await tidyOpenProposals(pool, new Date());
      expect(await readOpenProposal(pool, declined.id)).toMatchObject({ name: null, email: null });
    });
  });

  describe("the desk", () => {
    it("asks the gate on intake.moderate for every desk door", async () => {
      state.viewer = MEMBER;
      expect((await call("GET", "/api/admin/open-proposals")).status).toBe(403);
      expect((await call("PUT", "/api/admin/open-proposals/settings", { publicLink: false })).status).toBe(403);
      expect((await call("POST", "/api/admin/open-proposals/links", { label: "x" })).status).toBe(403);
      expect((await call("POST", "/api/admin/open-proposals/links/opl-x/revoke")).status).toBe(403);
      state.viewer = null;
      expect((await call("GET", "/api/admin/open-proposals")).status).toBe(401);
    });

    it("the switch is on to start, a link needs a label, and its address is shown once", async () => {
      state.viewer = ADMIN;
      const desk = await call("GET", "/api/admin/open-proposals");
      expect(desk.body).toMatchObject({ publicLink: true, publicPath: "/propose-a-role" });
      expect((await call("PUT", "/api/admin/open-proposals/settings", { publicLink: "yes" })).status).toBe(400);
      expect((await call("POST", "/api/admin/open-proposals/links", { label: "  " })).status).toBe(400);
      const made = await call("POST", "/api/admin/open-proposals/links", { label: "Rick" });
      const listed = (await call("GET", "/api/admin/open-proposals")).body.links.find((l: any) => l.id === made.body.id);
      expect(listed).toMatchObject({ label: "Rick", on: true });
      expect(JSON.stringify(listed)).not.toContain(made.body.url.split("/propose-a-role/")[1]);
    });
  });
});
