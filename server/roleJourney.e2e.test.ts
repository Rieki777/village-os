/**
 * THE ROLE JOURNEY, END TO END (role journey brief v2, 6.5; PR-F).
 *
 * One stranger takes one role, through the built server on a scratch schema,
 * the way the Lead Financial Steward pilot runs: the village sets this moon's
 * proposals and its season goals; the role is on the chart with its outcomes;
 * a visitor reads the form, sends their own role card (aim, a season goal,
 * time zone, terms), confirms by email; a holder of the power to fill roles
 * adopts; the invitation is used once to make the account; the person is
 * placed on the role for this moon, admitted by nothing but their own
 * alignment (Rye's ruling); and the application carries their card.
 *
 * IT GROWS WITH EACH LANE. The `it.todo` steps at the end are the brief's
 * 6.5 steps another lane owns; each lane turns its step into a test (with a
 * control) when its PR lands: listing (PR-A), the card's parameters (PR-C),
 * conversations (L5), agreements before the start (PR-E), the access bundle and
 * the onboarding path (L8, L9).
 *
 * A neutral village name, so the brand guard holds. Skips loudly without
 * TEST_DATABASE_URL, like every DB-backed suite.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { E2E_BOOT_DEADLINE_MS, provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[roleJourney] TEST_DATABASE_URL not set: DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs.
const PORT = 1714 + (process.pid % 5);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "role-journey-admin";
const PROVIDER_KEY = "re_test_role_journey";
const FOUNDER = { email: `journey-founder-${PORT}@example.test`, name: "Fern Oak", password: "JourneyFounder123!" };
const APPLICANT = { email: `journey-applicant-${PORT}@example.test`, name: "Juno Reed", password: "JourneyApplicant123!" };

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
const logs: string[] = [];

async function call(method: string, route: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

const civil = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;
const mailTo = (email: string, subject: RegExp) => fake!.emails().filter((e) => JSON.stringify(e.body.to ?? []).includes(email) && subject.test(String(e.body.subject)));
const linkIn = (text: string, pathPart: string) => (String(text).match(new RegExp(`${BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${pathPart}[^\\s"<]+`)) ?? [""])[0];

/** What every step after the setup reads. */
const state = { founder: "", founderId: "", roleId: "", goalId: "", moonEnds: "", proposalId: "", applicantToken: "", applicantId: "" };

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing. Run \`pnpm build\` before the role journey test.`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-role-journey-"));
  testDb = await provisionTestDb();
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler, for the reason selfMembership.routes.e2e.test.ts gives.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "role-journey-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      FRONTEND_URL: BASE,
      RESEND_API_BASE: fake.url,
      RESEND_API_KEY: PROVIDER_KEY,
      EMAIL_FROM: "Test Village <hello@village.example.test>",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not start. Output:\n${logs.join("")}`);
    try {
      const res = await fetch(`${BASE}/health`); // module-review-ok: the boot poll against the local test server
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}, 300_000);

afterAll(async () => {
  child?.kill();
  await fake?.close();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("the role journey: one stranger takes one role this moon", () => {
  it("the village is set up the way the pilot runs: a founder who fills roles, this moon's proposals, season goals and the role", async () => {
    const boot = await call("POST", "/api/admin/bootstrap", { password: ADMIN, email: FOUNDER.email, name: FOUNDER.name });
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    expect(claim, JSON.stringify(boot.json).slice(0, 200)).toBeTruthy();
    const claimed = await call("POST", "/api/auth/set-password", { token: claim, password: FOUNDER.password });
    state.founder = String(claimed.json?.token ?? "");
    state.founderId = String(claimed.json?.user?.id ?? "");
    expect(state.founder).toBeTruthy();
    const F = state.founder;

    // The founder aligns with the membership letter and is admitted, so they may hold the power to fill roles.
    const letter = await call("GET", "/api/membership-letter");
    const signed = await call("POST", "/api/forms/submit", {
      type: "membership-508",
      data: { name: FOUNDER.name, email: FOUNDER.email, phone: "", paths: ["resident"], why: "Founding.", monthlyContribution: "", acknowledgedGoodNeighbor: true, acknowledgedCommitments: true, signedAt: new Date().toISOString(), letterVersion: String(letter.json?.version ?? "") },
    }, F);
    expect(signed.status, JSON.stringify(signed.json)).toBe(200);
    expect((await call("PUT", `/api/admin/submissions/${signed.json.id}/status`, { status: "accepted" }, F)).status).toBe(200);
    expect((await call("POST", "/api/admin/roles/steward-circle/holders", { userId: state.founderId, action: "add" }, F)).status).toBe(200);

    // The village's switches for the pilot: governance on, this moon's public proposals, the season and its goals.
    expect((await call("PUT", "/api/admin/modules/governance/lifecycle", { lifecycle: "public" }, F)).status).toBe(200);
    const cfg = (await call("GET", "/api/admin/seasons", undefined, F)).json;
    const now = Date.now();
    const seasons = [
      { id: "s-now", name: "Season of Seeds", startsOn: civil(now - 30 * DAY), endsOn: civil(now + 150 * DAY), goals: [{ id: "g-books", text: "One set of numbers everyone trusts", done: false }] },
      { id: "s-next", name: "", startsOn: civil(now + 151 * DAY), endsOn: civil(now + 240 * DAY), goals: [] },
    ];
    const saved = await call("PUT", "/api/admin/seasons", { ...cfg, seasons }, F);
    expect(saved.status, JSON.stringify(saved.json).slice(0, 400)).toBe(200);
    expect(saved.json?.current?.id, JSON.stringify(saved.json).slice(0, 600)).toBe("s-now");
    expect((await call("PUT", "/api/admin/open-proposals/settings", { term: "moon", publicLink: true }, F)).status).toBe(200);

    // The role, on the chart with its outcomes.
    expect((await call("POST", "/api/admin/circles", { id: "anchor", name: "Anchor Circle" }, F)).status).toBe(200);
    const role = await call("POST", "/api/admin/org/roles", { name: "Lead Financial Steward", circleId: "anchor", seats: 1 }, F);
    state.roleId = String(role.json?.id ?? "");
    expect(state.roleId).toBeTruthy();
    const words = await call("PUT", `/api/admin/org/roles/${state.roleId}`, {
      name: "Lead Financial Steward",
      circleId: "anchor",
      seats: 1,
      aim: "The village always knows where its money is.",
      accountabilities: ["One living model", "A cash view every Monday", "Bills and filings on time"],
    }, F);
    expect(words.status, JSON.stringify(words.json)).toBe(200);
  });

  it("a visitor reads the form for this moon: the role with its outcomes, and the season's goals", async () => {
    const form = await call("GET", "/api/open-proposals/form");
    expect(form.json, JSON.stringify(form.json).slice(0, 600)).toMatchObject({ open: true, term: { kind: "moon" }, goals: [{ text: "One set of numbers everyone trusts" }] });
    // The Season tab keys each goal on save, so the card names the id the form offered.
    state.goalId = String(form.json.goals[0].id);
    state.moonEnds = String(form.json.term.endsOn);
    const lfs = form.json.roles.find((r: any) => r.id === state.roleId);
    expect(lfs).toMatchObject({ name: "Lead Financial Steward", accountabilities: ["One living model", "A cash view every Monday", "Bills and filings on time"] });
  });

  it("sends their own role card, which the village refuses without an aim, and confirms by email", async () => {
    const card = {
      roles: [{ roleId: state.roleId, moves: [{ text: "A cash view every Monday", target: "every Monday" }], firstMoon: [{ quest: "Publish the first cash view", doneWhen: "every circle lead has it" }] }],
      serves: [{ goalId: state.goalId, how: "One model every figure traces to." }],
      hours: "roughly 40 a week",
      agreed: { loveLetter: true, nda: true },
      terms: { choice: "accept", note: "" },
      timeZone: "America/Costa_Rica",
      windows: ["weekday-mornings"],
    };
    const body = { name: APPLICANT.name, email: APPLICANT.email, roles: [{ roleId: state.roleId, note: "Ten years of village books." }], why: "I keep books for land trusts.", aim: "", hp: "", card };
    const noAim = await call("POST", "/api/open-proposals", body);
    expect(noAim).toMatchObject({ status: 400, json: { field: "aim" } });
    const sent = await call("POST", "/api/open-proposals", { ...body, aim: "Money kept true, every Monday." });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);

    const confirm = mailTo(APPLICANT.email, /^Confirm your proposal/).pop();
    expect(confirm, "the confirmation email went").toBeTruthy();
    expect(String(confirm!.body.text)).toContain("for this moon");
    const token = new URL(linkIn(confirm!.body.text, "/propose-a-role/confirm")).searchParams.get("token");
    expect((await call("POST", "/api/open-proposals/confirm", { token })).status).toBe(200);
    const desk = await call("GET", "/api/admin/open-proposals", undefined, state.founder);
    const mine = desk.json.proposals.find((p: any) => p.email === APPLICANT.email);
    expect(mine).toBeTruthy();
    state.proposalId = mine.id;
  });

  it("a holder of the power to fill roles reads both cards side by side and adopts; the invitation goes by email and asks for the Love Letter", async () => {
    const page = await call("GET", `/api/governance/open-proposals/${state.proposalId}`, undefined, state.founder);
    expect(page.status).toBe(200);
    expect(page.json.proposal.card).toMatchObject({ terms: { choice: "accept" }, serves: [{ goalId: state.goalId, goal: "One set of numbers everyone trusts" }] });
    expect(page.json.proposal.roles[0].accountabilities).toHaveLength(3);
    const adopted = await call("POST", `/api/governance/open-proposals/${state.proposalId}/adopt`, {}, state.founder);
    expect(adopted.status, JSON.stringify(adopted.json)).toBe(200);
    const invite = mailTo(APPLICANT.email, /adopted your proposal/).pop();
    expect(invite, "the adoption letter went").toBeTruthy();
    expect(String(invite!.body.text)).toContain(`${BASE}/love-letter`);
    expect(String(invite!.body.text)).toContain("this moon");
  });

  it("the invitation makes the account once; the person is placed on the role, admitted by nothing but their own alignment", async () => {
    const invite = mailTo(APPLICANT.email, /adopted your proposal/).pop()!;
    const link = linkIn(invite.body.text, "/register");
    const inviteToken = new URL(link).searchParams.get("invite");
    // The sign-up page names the roles and gives back what the person sent (role audit, 10 Nov 2026).
    const check = await call("GET", `/api/invites/check?token=${encodeURIComponent(String(inviteToken))}`);
    expect(check.json).toMatchObject({ valid: true, forRoles: ["Lead Financial Steward"], name: APPLICANT.name, email: APPLICANT.email });
    const made = await call("POST", "/api/auth/register", { name: APPLICANT.name, email: APPLICANT.email, password: APPLICANT.password, paths: ["steward"], invite: inviteToken });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    state.applicantToken = String(made.json?.token ?? "");
    state.applicantId = String(made.json?.user?.id ?? "");
    // Used once. An open village still lets a second person in through the
    // same link, as an ordinary visitor (server/routes/register.ts): the
    // invitation's role is not theirs.
    const again = await call("POST", "/api/auth/register", { name: "Rowan Vale", email: `again-${PORT}@example.test`, password: APPLICANT.password, paths: ["steward"], invite: inviteToken });
    const secondId = String(again.json?.user?.id ?? "");
    const held = (await call("GET", "/api/org/holders", undefined, state.founder)).json?.holdings ?? [];
    // Holders read as references (holders/1), so the count says it: one seating, the applicant's, for this moon.
    const onRole = held.filter((h: any) => h?.orgRoleId === state.roleId);
    expect(onRole, JSON.stringify(held).slice(0, 400)).toHaveLength(1);
    expect(String(onRole[0].termEndsAt).slice(0, 10)).toBe(state.moonEnds);
    expect(secondId, "the second visitor still has an ordinary account").toBeTruthy();

    // Rye's ruling: adoption admits nobody. Member comes with the Love Letter.
    const me = (await call("GET", "/api/profile", undefined, state.applicantToken)).json;
    expect(me?.stageGranted ?? null).not.toBe("member");

    // The role application is adopted, for this moon, and carries the card's words.
    const apps = (await call("GET", "/api/governance/role-applications", undefined, state.founder)).json?.applications ?? [];
    const app = apps.find((a: any) => String(a?.candidate?.id) === state.applicantId);
    expect(app?.status).toBe("adopted");
    expect(String(app?.deliverables ?? "")).toContain("First moon: Publish the first cash view");
    expect(String(app?.deliverables ?? "")).toContain("Accepts the terms on offer.");
  });

  it("D34: the moon term crosses the season's end; the turn leaves it running, and next season's goals apply from the turn", async () => {
    // The season ends yesterday and the next begins today, inside the moon the person holds the role for.
    const F = state.founder;
    const now = Date.now();
    const cfg = (await call("GET", "/api/admin/seasons", undefined, F)).json;
    const seasons = [
      { id: "s-now", name: "Season of Seeds", startsOn: civil(now - 30 * DAY), endsOn: civil(now - DAY), goals: [{ text: "One set of numbers everyone trusts", done: false }] },
      { id: "s-next", name: "Season of Roots", startsOn: civil(now), endsOn: civil(now + 90 * DAY), goals: [{ text: "Roots in the ground", done: false }] },
    ];
    const turned = await call("PUT", "/api/admin/seasons", { ...cfg, seasons }, F);
    expect(turned.status, JSON.stringify(turned.json).slice(0, 400)).toBe(200);
    expect(turned.json?.current?.id).toBe("s-next");
    expect(state.moonEnds > civil(now - DAY), "the moon runs past the season's end").toBe(true);

    // The seating is still there, still ending with the moon, not with the season.
    const held = (await call("GET", "/api/org/holders", undefined, F)).json?.holdings ?? [];
    const onRole = held.filter((h: any) => h?.orgRoleId === state.roleId);
    expect(onRole, JSON.stringify(held).slice(0, 400)).toHaveLength(1);
    expect(String(onRole[0].termEndsAt).slice(0, 10)).toBe(state.moonEnds);

    // From the turn, the form offers the new season's goals.
    const form = (await call("GET", "/api/open-proposals/form")).json;
    expect(form.season?.id).toBe("s-next");
    expect(form.goals.map((g: any) => g.text)).toEqual(["Roots in the ground"]);
  });

  // ── The brief's 6.5 steps other lanes own. Each becomes a test, with a control, when its PR lands. ──
  it.todo("PR-A: an unlisted role is absent from the form and the board, and the listed one is offered");
  it.todo("PR-C: the public card carries the parameters and the pay range, and no other terms key");
  it.todo("L5: the conversations run in the role's order, the final approval last, and consent opens after them");
  it.todo("PR-E: the membership alignment is made at application and carried to the account; the role start waits for confidentiality");
  it.todo("L8: the access tasks are raised at the start, and the ending revokes them");
  it.todo("L9: the onboarding path opens on the profile");
});
