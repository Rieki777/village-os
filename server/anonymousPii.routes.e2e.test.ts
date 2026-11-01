/**
 * THE ANONYMOUS PII WALKER (readiness findings R097 and R098).
 *
 * Calls every GET route a signed-out visitor can reach, with real people on
 * the record, and reads what comes back. Two findings made this file:
 *
 *   R098  `GET /api/governance/ballots/:id` gave a signed-out visitor every
 *         voter's first name, choice, weight and cast time, the names of the
 *         electors who had not voted yet, and who objected. Ruling 22 is
 *         staged, so a MEMBER still reads the named roll (docs/GOVERNANCE.md
 *         says so in its own words), and a stranger reads counts, tallies and
 *         status, which is the stranger's-view rule in
 *         docs/GOVERNANCE_EVOLUTION_PROMPT.md 21.8.
 *   R097  The village's secret-society lock (`org.public_people` off) was
 *         honoured by three routes while others went on naming members to the
 *         internet, some with full names and internal user ids.
 *
 * THE ROUTE LIST IS DERIVED, NEVER TYPED. `deriveGetRoutes` reads every
 * `app.get(...)` in `server/index.ts` and `server/routes/` with the
 * TypeScript compiler (server/testkit/getRoutes.ts). A route somebody adds
 * tomorrow is walked tomorrow, and a registration the reader cannot resolve
 * fails this file by name instead of being skipped. Every parameter is filled
 * from the seeded record, every id tried in every `:id`, so a route is asked
 * about the rows that actually hold people.
 *
 * WHAT IS SEEDED. Five members with names that occur nowhere else in the
 * repository, one documented holder with no account, an org role two of them
 * hold, a permission role one of them was appointed to (which writes the
 * "<name> joined the <role>" pulse line), a gratitude send, a skill tag, a
 * consent ballot with a yes, an abstention, an objection and two silent
 * electors, a seat vote whose title and document name its candidate, and a
 * closed ballot. Every module that can be public is set public, because a
 * module at `members` answers a stranger with a 401 and would prove nothing.
 *
 * WHAT IS ASSERTED.
 *   - Lock ON (`org.public_people` = false): no member's first name, last
 *     name, handle or user id appears in ANY anonymous response, on any
 *     route the walk reached.
 *   - Lock OFF (the platform default): still no user id and no last name on
 *     any anonymous response (the public tier is a first name only, R097), and
 *     on every ballot route no voter-level data at all: no `votes`, `silent`,
 *     objection authors, cast times or `myVote` rows naming anybody.
 *   - The member view is unchanged: a signed-in member still reads the named
 *     roll on the ballot page, and the people on `/api/org`, through the lock.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema. Run
 * `pnpm build` first. Skips loudly without TEST_DATABASE_URL, and a skip is
 * not a pass. Set PII_SURVEY=<file> to write every route's answer to a JSON
 * report instead of asserting, which is how the R097 enumeration was taken.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { deriveGetRoutes, type DerivedRoute } from "./testkit/getRoutes";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[anonymousPii.routes] TEST_DATABASE_URL not set: DB-backed tests SKIPPED.");
}

const ROOT = process.cwd();
const DIST = path.resolve(ROOT, "dist/index.js");
const SURVEY = process.env.PII_SURVEY ?? "";

/** This suite's port window, held disjoint from every other by scripts/check-e2e-ports.mjs. */
const PORT = 4050 + (process.pid % 50);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "pii-walker-admin";
const PASSWORD = "PiiWalker123!";

/**
 * The people. Every first and last name here occurs nowhere else in the
 * repository (checked when this file was written), so a hit is a person and
 * never a coincidence of copy.
 */
interface Person { key: string; name: string; email: string; id: string; token: string; handle: string }
const people: Record<string, Person> = {};
const NAMES: Record<string, string> = {
  founder: "Ottoline Quarrington",
  proposer: "Isadora Penhallow",
  yes: "Caspian Ravensworth",
  abstain: "Delphine Okonkwo",
  objector: "Evander Blackthorne",
};
/** A real person the village wrote down before they had an account. */
const DOCUMENTED = "Faustina Marchetti";

/** The parts of the record the walker fills route parameters from. */
const seeded = {
  ballotIds: [] as string[],
  proposalIds: [] as string[],
  objectionIds: [] as string[],
  orgRoleId: "",
  permRoleId: "",
  circleId: "community-life-council",
  badgeIds: [] as string[],
  threadIds: [] as string[],
};

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

interface Answer { status: number; json: any; text: string }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null; timeoutMs?: number } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? people.founder?.token : opts.token;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
      method,
      signal: ctl.signal,
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text().catch(() => "");
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text };
  } catch (err: any) {
    // A stream that never ends (a live feed) is read for as long as the
    // timeout allows and judged on what it sent; nothing it sent is lost.
    return { status: -1, json: null, text: String(err?.name ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

async function ok(method: string, route: string, body?: unknown, token?: string | null): Promise<any> {
  const r = await call(method, route, { body, token });
  expect(r.status, `${method} ${route}: ${r.text.slice(0, 300)}`).toBe(200);
  return r.json;
}

async function register(key: string): Promise<Person> {
  const name = NAMES[key];
  const email = `${key}-${PORT}@example.test`;
  const r = await call("POST", "/api/auth/register", {
    body: { name, email, password: PASSWORD, paths: ["resident"] },
    token: null,
  });
  expect(r.status, `${name} must register: ${r.text.slice(0, 200)}`).toBe(200);
  return { key, name, email, id: String(r.json?.user?.id ?? ""), token: String(r.json?.token ?? ""), handle: "" };
}

/** Every module that will go public, public. Dependencies settle over a few passes. */
async function everyModulePublic(): Promise<string[]> {
  const list = await ok("GET", "/api/admin/modules");
  const ids: string[] = (Array.isArray(list) ? list : list?.modules ?? []).map((m: any) => String(m.id));
  expect(ids.length, "the module list must come back").toBeGreaterThan(5);
  const pub = new Set<string>();
  for (let pass = 0; pass < 4; pass++) {
    for (const id of ids) {
      if (pub.has(id)) continue;
      const r = await call("PUT", `/api/admin/modules/${id}/lifecycle`, { body: { lifecycle: "public", examples: false } });
      if (r.status === 200) pub.add(id);
    }
  }
  return [...pub];
}

async function setVar(key: string, value: string): Promise<void> {
  await ok("PUT", `/api/admin/variables/${key}`, { value });
}

// ── The walk ───────────────────────────────────────────────────────────────

/** A route's answer, judged. */
interface Visit { route: string; url: string; status: number; bytes: number; hits: string[] }

/**
 * Extra query shapes for routes whose interesting branch is behind a query
 * string. The bare route is always walked as well; these only add.
 */
function queryVariants(p: string): string[] {
  const v: string[] = [];
  if (p === "/api/badges/match") {
    v.push("?skill=carpentry", ...seeded.badgeIds.map((id) => `?badge=${encodeURIComponent(id)}`));
  }
  if (p === "/api/governance/ballots") {
    v.push("?limit=200");
    for (const id of seeded.proposalIds) v.push(`?subjectType=game_mechanics&subjectRef=${encodeURIComponent(id)}`);
    if (people.abstain) v.push(`?subjectType=role_seat&subjectRef=${encodeURIComponent(`${people.abstain.id}@${seeded.permRoleId}`)}`);
  }
  if (p === "/api/governance/objections/lineage") v.push(`?ids=${encodeURIComponent(seeded.objectionIds.join(","))}`);
  return v;
}

/** Every value worth trying for one route parameter. */
function candidates(param: string): string[] {
  const userIds = Object.values(people).map((p) => p.id);
  const handles = Object.values(people).map((p) => p.handle).filter(Boolean);
  switch (param) {
    case "handle":
      return [...handles, "me"];
    case "userId":
      return userIds;
    case "circleId":
      return [seeded.circleId];
    case "kind":
      return ["role", "circle", "org_role", "user"];
    case "id":
      return [
        ...seeded.ballotIds,
        ...seeded.proposalIds,
        ...seeded.objectionIds,
        seeded.orgRoleId,
        seeded.permRoleId,
        seeded.circleId,
        ...seeded.badgeIds,
        ...seeded.threadIds,
        ...userIds,
      ].filter(Boolean);
    default:
      return ["x"];
  }
}

function urlsFor(route: string): string[] {
  const params = [...route.matchAll(/:([A-Za-z_]+)\??/g)].map((m) => m[1]);
  // An Express 5 wildcard (`{*splat}`) is walked as one ordinary segment.
  let urls = [route.replace(/\(.*?\)/g, "").replace(/\{\*[A-Za-z_]+\}/g, "x")];
  for (const p of params) {
    const vals = candidates(p);
    urls = urls.flatMap((u) => vals.map((v) => u.replace(new RegExp(`:${p}\\??`), encodeURIComponent(v))));
  }
  return [...new Set(urls)].flatMap((u) => [u, ...queryVariants(route).map((q) => u + q)]);
}

/**
 * What may not appear.
 *
 * `strict` is the lock: every part of every name, every handle, every id,
 * every email. Matched case-insensitively, so a handle (a slug of the name)
 * is caught by the name as well as by itself.
 *
 * Otherwise the public tier (R097's rule): a first name and a handle may
 * appear, a handle being the public address of a profile while the people
 * are public. A full display name, an internal user id and an email may not.
 */
function needles(strict: boolean): string[] {
  const out: string[] = [];
  const everyone = [
    ...Object.values(people).map((p) => ({ name: p.name, id: p.id, handle: p.handle, email: p.email })),
    { name: DOCUMENTED, id: "", handle: "", email: "" },
  ];
  for (const p of everyone) {
    out.push(p.id, p.email);
    if (strict) out.push(...p.name.split(" "), p.handle);
    else out.push(p.name);
  }
  return out.filter(Boolean);
}

/** Keys that only voter-level data carries, on a ballot route. */
const VOTER_KEYS = ["votes", "silent", "castAt", "by", "followedUserId", "userId", "voterId"];

function voterLevelHits(json: any): string[] {
  const hits: string[] = [];
  const visit = (v: any, trail: string) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x, i) => visit(x, `${trail}[${i}]`)); return; }
    for (const [k, x] of Object.entries(v)) {
      if (VOTER_KEYS.includes(k) && x !== null && x !== undefined && !(Array.isArray(x) && x.length === 0)) hits.push(`${trail}.${k}`);
      visit(x, `${trail}.${k}`);
    }
  };
  visit(json, "$");
  return hits;
}

const isBallotRoute = (r: string) => r.startsWith("/api/governance/ballots") || r.startsWith("/api/governance/objections");

/** The prefixes the brief names. A route under one of these must be reached, never skipped. */
const REQUIRED = ["/api/governance", "/api/game/mechanics", "/api/org", "/api/map", "/api/game/pulse", "/api/people/"];

async function walk(routes: DerivedRoute[], strict: boolean): Promise<Visit[]> {
  const visits: Visit[] = [];
  const echoable = new Set(Object.values(people).flatMap((p) => [p.id, p.email]));
  for (const r of routes) {
    for (const url of urlsFor(r.path)) {
      const a = await call("GET", url, { token: null, timeoutMs: 8000 });
      const lower = a.text.toLowerCase();
      // An id or address the caller typed into the URL (a page shell echoes
      // its own path) tells them nothing they did not send. Names and handles
      // are never excused this way: a profile URL carries a handle, and the
      // name behind it is exactly what the lock keeps.
      const sent = decodeURIComponent(url).toLowerCase();
      const echoed = (n: string) => !n.includes(" ") && echoable.has(n) && sent.includes(n.toLowerCase());
      const hits = needles(strict).filter((n) => !echoed(n) && lower.includes(n.toLowerCase()));
      if (a.status === 200 && a.json && isBallotRoute(r.path)) hits.push(...voterLevelHits(a.json).map((h) => `voter-level ${h}`));
      visits.push({ route: r.path, url, status: a.status, bytes: a.text.length, hits });
    }
  }
  return visits;
}

// ── Boot and seed ──────────────────────────────────────────────────────────

let routes: DerivedRoute[] = [];

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing. Run \`pnpm build\` before the PII walker.`);
  const derived = deriveGetRoutes(ROOT);
  expect(derived.unresolved, "every GET registration must be readable, or the walk has a blind spot").toEqual([]);
  // Every GET, the page shell, the org's markdown, the sitemap and the
  // well-known card included: a name on an OG tag or in `/org/roles/x.md` is
  // as public as one in JSON.
  routes = derived.routes;

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-pii-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "pii-walker-secret",
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  await waitForHealth({ base: BASE, logs, child });

  // The founder.
  const boot = await call("POST", "/api/admin/bootstrap", {
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: NAMES.founder },
    token: null,
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
  people.founder = {
    key: "founder", name: NAMES.founder, email: `founder-${PORT}@example.test`,
    id: String(setPw.json?.user?.id ?? ""), token: String(setPw.json?.token ?? ""), handle: "",
  };
  expect(people.founder.token, "founder must hold a session").toBeTruthy();

  for (const key of ["proposer", "yes", "abstain", "objector"]) {
    people[key] = await register(key);
    await ok("PUT", `/api/admin/players/${people[key].id}/stage`, { stageId: "member" });
  }
  const [handleRows] = await pool.query<any[]>("SELECT id, handle FROM users"); // module-review-ok: fixture read against the S5 scratch schema
  for (const p of Object.values(people)) p.handle = String(handleRows.find((u: any) => u.id === p.id)?.handle ?? "");
  for (const p of Object.values(people)) expect(p.handle, `${p.name} has a handle`).toBeTruthy();

  await everyModulePublic();
  await setVar("map.public_structure", "true");

  // An org role two people hold: one member, one documented.
  const seat = await ok("POST", "/api/admin/org/roles", {
    name: "Welcome Host", circleId: seeded.circleId, seats: 3, aim: "Be the first warm face somebody meets.",
  });
  seeded.orgRoleId = String(seat.id);
  await ok("POST", `/api/admin/org/roles/${seeded.orgRoleId}/holders`, { userId: people.proposer.id });
  await ok("POST", `/api/admin/org/roles/${seeded.orgRoleId}/holders`, { displayName: DOCUMENTED, focus: "arrivals" });

  // A permission role, appointed, which writes "<name> joined the <role>" to the pulse.
  const perm = await ok("GET", "/api/roles");
  const roleList: any[] = Array.isArray(perm) ? perm : perm?.roles ?? [];
  const target = roleList.find((r: any) => r.id !== "founders-circle") ?? roleList[0];
  seeded.permRoleId = String(target?.id ?? "");
  expect(seeded.permRoleId, "a permission role exists to appoint to").toBeTruthy();
  await ok("POST", `/api/admin/roles/${seeded.permRoleId}/holders`, { userId: people.yes.id, action: "add" });

  // Gratitude, and a skill.
  await ok("POST", "/api/game/gratitude/send", { toEmail: people.yes.email, amount: 1, message: "For the bread." }, people.proposer.token);
  await ok("POST", "/api/badges/skills", { tag: "carpentry" }, people.proposer.token);
  const [badgeRows] = await pool.query<any[]>("SELECT badge_id FROM badge_awards LIMIT 5"); // module-review-ok: fixture read against the S5 scratch schema
  seeded.badgeIds = [...new Set(badgeRows.map((b: any) => String(b.badge_id)))];

  // A forum thread and a reply, each with an author.
  const cats = await ok("GET", "/api/forum/categories");
  const category = String((Array.isArray(cats) ? cats : cats?.categories ?? [])[0]?.id ?? "");
  const thread = await ok("POST", "/api/forum/threads", { category, title: "Bread on Thursdays", body: "Who bakes this week?" }, people.proposer.token);
  seeded.threadIds.push(String(thread.id ?? thread.thread?.id ?? ""));
  await ok("POST", `/api/forum/threads/${seeded.threadIds[0]}/replies`, { body: "I will bring rye." }, people.yes.token);

  // A consent ballot: a yes, an abstention, an objection, and two silent electors.
  await setVar("governance.default_method", "consent");
  const prop = await ok("POST", "/api/game/mechanics/proposals", {
    title: "Raise the gratitude budget for the winter cycle",
    rationale: "The cold months are when people carry each other.",
    changes: [{ key: "gratitude.base_budget", to: "120" }],
  }, people.proposer.token);
  seeded.proposalIds.push(String(prop.id));
  const opened = await ok("POST", `/api/governance/mechanics/${prop.id}/open-ballot`);
  const consentId = String(opened.ballot.id);
  seeded.ballotIds.push(consentId);
  await ok("POST", `/api/governance/ballots/${consentId}/vote`, { choice: "yes" }, people.yes.token);
  await ok("POST", `/api/governance/ballots/${consentId}/vote`, { choice: "abstain" }, people.abstain.token);
  const obj = await ok("POST", `/api/governance/ballots/${consentId}/objections`, { text: "The budget should wait one moon." }, people.objector.token);
  seeded.objectionIds.push(String(obj.id));

  // A seat vote, whose title and document name the candidate. Opening one is
  // a member's act (proposal.open, at co-creator), never the admin's.
  await ok("PUT", `/api/admin/players/${people.objector.id}/stage`, { stageId: "co-creator" });
  const seatVote = await ok("POST", "/api/governance/role-seats", {
    userId: people.abstain.id,
    roleId: seeded.permRoleId,
    reason: "She has carried this work for two seasons and the village trusts the care in it.",
  }, people.objector.token);
  seeded.ballotIds.push(String(seatVote.ballot.id));
  await ok("POST", `/api/governance/ballots/${seatVote.ballot.id}/vote`, { choice: "yes" }, people.yes.token);

  // A closed ballot, so a closer is on the record.
  await setVar("governance.default_method", "custom");
  const prop2 = await ok("POST", "/api/game/mechanics/proposals", {
    title: "Lengthen the voting window",
    rationale: "Some of us are away for a week at a time.",
    changes: [{ key: "governance.vote_days", to: "10" }],
  }, people.objector.token);
  seeded.proposalIds.push(String(prop2.id));
  const opened2 = await ok("POST", `/api/governance/mechanics/${prop2.id}/open-ballot`);
  const closedId = String(opened2.ballot.id);
  seeded.ballotIds.push(closedId);
  await ok("POST", `/api/governance/ballots/${closedId}/vote`, { choice: "no" }, people.yes.token);
  await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [closedId]); // module-review-ok: fixture SQL against the S5 scratch schema
  const closed = await call("POST", `/api/governance/ballots/${closedId}/close`, { body: { outcomeNote: "Closed by the walker's founder." } });
  expect([200, 409], `close: ${closed.text.slice(0, 200)}`).toContain(closed.status);
}, 300_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("a signed-out visitor, on every GET the server registers", () => {
  it("the seed put people on the record the walk can find", async () => {
    const ballot = await ok("GET", `/api/governance/ballots/${seeded.ballotIds[0]}`, undefined, people.yes.token);
    // The member view, unchanged: ruling 22 is staged, so a member reads the named roll.
    expect(ballot.votes.length).toBe(2);
    expect(ballot.objections.map((o: any) => o.by)).toEqual(["Evander"]);
    expect(ballot.silent.length).toBeGreaterThanOrEqual(2);
  });

  it("a stranger's ballot keeps the counts and says whose view it is", async () => {
    const r = await call("GET", `/api/governance/ballots/${seeded.ballotIds[0]}`, { token: null });
    expect(r.status).toBe(200);
    expect(r.json.viewerTier, "the page needs to know why the roll is empty").toBe("stranger");
    expect(r.json.votes).toEqual([]);
    expect(r.json.silent).toEqual([]);
    expect(r.json.objections).toEqual([]);
    expect(r.json.docMarkdown).toBe("");
    // What a stranger IS owed (21.8): how many may vote, how many spoke, the tallies.
    expect(r.json.votedCount).toBe(2);
    expect(r.json.objectionCount).toBe(1);
    expect(r.json.electorateCount).toBeGreaterThanOrEqual(5);
    expect(Number(r.json.tallies.yesW)).toBeGreaterThan(0);
    const cards = await call("GET", "/api/governance/ballots", { token: null });
    expect(cards.json.every((c: any) => c.viewerTier === "stranger" && c.subjectRef === "")).toBe(true);
  });

  it("LOCK ON: a handle finds nobody for a stranger, and a member still reads the person", async () => {
    await setVar("org.public_people", "false");
    const h = people.proposer.handle;
    expect((await call("GET", `/api/profiles/${h}`, { token: null })).status).toBe(404);
    expect((await call("GET", `/api/people/${h}/role-card`, { token: null })).status).toBe(404);
    const asMember = await call("GET", `/api/profiles/${h}`, { token: people.yes.token });
    expect(asMember.status).toBe(200);
    expect(asMember.json.name).toBe(NAMES.proposer);
    const org = await ok("GET", "/api/org", undefined, people.yes.token);
    expect(JSON.stringify(org)).toContain("Isadora");
    await setVar("org.public_people", "true");
  });

  it("LOCK ON: no member's name, handle or user id reaches a stranger, anywhere", async () => {
    await setVar("org.public_people", "false");
    const visits = await walk(routes, true);
    if (SURVEY) fs.writeFileSync(SURVEY.replace(/(\.json)?$/, ".lock-on.json"), JSON.stringify(visits, null, 1));
    const leaks = visits.filter((v) => v.hits.length).map((v) => `${v.status} ${v.url} -> ${[...new Set(v.hits)].join(", ")}`);
    const reachedRequired = new Set(visits.filter((v) => REQUIRED.some((p) => v.route.startsWith(p))).map((v) => v.route));
    for (const r of routes.filter((x) => REQUIRED.some((p) => x.path.startsWith(p)))) {
      expect(reachedRequired.has(r.path), `${r.path} (${r.file}:${r.line}) was not walked`).toBe(true);
    }
    if (!SURVEY) expect(leaks).toEqual([]);
  }, 600_000);

  it("LOCK OFF: a first name at most, and no voter-level data on any ballot route", async () => {
    await setVar("org.public_people", "true");
    const visits = await walk(routes, false);
    if (SURVEY) fs.writeFileSync(SURVEY.replace(/(\.json)?$/, ".lock-off.json"), JSON.stringify(visits, null, 1));
    const leaks = visits.filter((v) => v.hits.length).map((v) => `${v.status} ${v.url} -> ${[...new Set(v.hits)].join(", ")}`);
    if (!SURVEY) expect(leaks).toEqual([]);
  }, 600_000);
});
