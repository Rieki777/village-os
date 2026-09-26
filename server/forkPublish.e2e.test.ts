/**
 * WHAT A BRAND-NEW VILLAGE PUBLISHES ON DAY ONE, signed out, nothing configured.
 *
 * A fork boots against an empty schema and starts serving pages before anyone
 * has typed a word into it. QA-3 opened that state and found another project's
 * real named people on `/team` and `/roles`, twelve seat holders carrying
 * internal availability notes, and four financial claims about land the fork
 * does not own. Both are shipped repository content: seed files for the people,
 * module constants for the numbers.
 *
 * The people half is the sharper one. R57 makes a village's people public by
 * default, so those names are served to anyone with the URL, immediately, with
 * no act by the fork. The people named agreed to appear on ONE project's site.
 * They did not agree to appear on every fork of the platform it was built from.
 *
 * The numbers half is a different danger: a fork publishing an appraisal and a
 * projected return about land it has never owned is making a financial
 * representation it cannot stand behind, and misstating the real project's
 * figures at the same time.
 *
 * THE HARM METRIC THIS FILE HOLDS, in one sentence:
 *
 *   A village that has configured nothing publishes no real person who is not
 *   theirs, and no financial claim that is not theirs.
 *
 * Two suites, and the second is why the first is safe to enforce:
 *
 *   1. THE FRESH FORK. Empty schema, signed out. Nothing another project owns
 *      reaches an anonymous caller, through the API or through the JavaScript
 *      the same anonymous caller downloads.
 *   2. THE CONFIGURED VILLAGE. A village that seats its own people still
 *      publishes them. Without this, "delete everything" would pass suite 1
 *      and quietly blank `/team` for every real village including the one this
 *      platform was built for.
 *
 * On the named strings below. They are written out because a structural check
 * alone can go hollow: if the shape changes, "no non-example holders" can pass
 * on a payload that carries the same names in a new field. The list is the
 * regression, the structural assertions are the invariant, and neither is
 * sufficient by itself.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[forkPublish] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
const ASSETS = path.resolve(process.cwd(), "dist/public/assets");
const PORT = 13000 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "fork-publish-admin";

/**
 * The four financial claims, exactly as a fork rendered them. Each is a
 * statement about one specific piece of land in one specific country.
 */
const FOREIGN_NUMBERS = [
  // "113%" without the plus, deliberately. The first version of this list
  // wrote "+113%" and passed while the same figure went on rendering on the
  // very page it was written about, from a different file, as "appreciated
  // 113% in 16 months". A regression list that matches only the exact spelling
  // it first met is a list with a hole in it.
  "113%", // brand-ok: the regression list this file asserts the ABSENCE of
  "$16M+",
  "19.6%",
  "266 acres", // brand-ok: same
  "Dominicalito", // brand-ok: same
];

/**
 * People who agreed to appear on one project's website. Surnames included:
 * the team cards carried full names and hotlinked photographs, which is the
 * strongest identification of the set.
 */
const FOREIGN_PEOPLE = [
  "Jessica Filkins",
  "Kyleen Keenan",
  "Filkins",
  "Keenan",
  "Magdalena",
  "Kyleen",
  "Blake",
  "Kyra",
];

/** The real project's own domain: every hotlinked photograph came from it. */
const FOREIGN_MEDIA = "amora.cr/wp-content"; // brand-ok: asserted absent, never rendered

/**
 * Signed-out routes a fresh fork answers. Anything that renders a page a
 * stranger can open without an account belongs here.
 */
const PUBLIC_ROUTES = [
  "/api/org",
  "/api/org/vision",
  "/api/content",
  "/api/content/team",
  "/api/content/roles",
  "/api/content/circles",
  "/api/milestones",
  "/api/visit-config",
  "/api/faqs/investor",
  "/api/faqs/resident",
  "/api/faqs/steward",
];

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let founderToken = "";

/**
 * THE ONLY PLACE THIS FILE CALLS `fetch`.
 *
 * `scripts/contribution-scan.mjs` treats a raw fetch under `server/` as a
 * finding, and it is right to: a module's outbound call belongs in
 * `guardedFetchJson` so it carries a correlation id. A test that drives the
 * server over HTTP is the case that rule was not written for, and every fetch
 * here is inbound to a server this file started on localhost. One waived site
 * rather than seven keeps the exception small enough to read.
 */
async function http(route: string, init?: RequestInit): Promise<Response> {
  return fetch(BASE + route, init); // module-review-ok: inbound HTTP to a server this file starts
}

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
): Promise<{ status: number; json: any }> {
  const res = await http(route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Every public payload, as one text blob per route, fetched with no credentials. */
async function anonymousBodies(): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (const r of PUBLIC_ROUTES) {
    const res = await http(r);
    out.push([r, await res.text()]);
  }
  return out;
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the fork publish test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-forkpublish-"));
  testDb = await provisionTestDb();

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "fork-publish-token-secret", // module-review-ok: throwaway, for a server this file starts and kills
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs, child });
});

afterAll(async () => {
  child?.kill();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("the fresh fork publishes nobody else's people", () => {
  it("answers the public routes at all (a hollow pass would prove nothing)", async () => {
    const bodies = await anonymousBodies();
    const org = bodies.find(([r]) => r === "/api/org")?.[1] ?? "";
    expect(org.length, "/api/org must answer an anonymous caller").toBeGreaterThan(50);
    expect(JSON.parse(org).people, "/api/org must say what tier it served").toBeTruthy();
  });

  it("names no real person from another project on any signed-out route", async () => {
    const bodies = await anonymousBodies();
    for (const [route, body] of bodies) {
      for (const person of FOREIGN_PEOPLE) {
        expect(body, `${route} must not name ${person}`).not.toContain(person);
      }
    }
  });

  it("carries no seat holder the village did not seat", async () => {
    const org = (await call("GET", "/api/org", undefined, "")).json;
    const documented: string[] = [];
    for (const role of org?.roles ?? []) {
      for (const h of role.holders ?? []) documented.push(`${role.name}: ${h.name}`);
    }
    expect(
      documented,
      "a village that has seated nobody must publish nobody",
    ).toEqual([]);
  });

  it("publishes no team card, rather than another project's team card", async () => {
    const res = await http("/api/content/team");
    if (res.status === 404) return; // the section does not exist yet: correct.
    const body = await res.json();
    expect(Array.isArray(body) ? body : [], "the team page starts empty").toEqual([]);
  });

  it("hotlinks no photograph from another project", async () => {
    for (const [route, body] of await anonymousBodies()) {
      expect(body, `${route} must not hotlink ${FOREIGN_MEDIA}`).not.toContain(FOREIGN_MEDIA);
    }
  });

  it("leaks no internal note or focus about a person through the public tier", async () => {
    const org = (await call("GET", "/api/org", undefined, "")).json;
    const keys = new Set<string>();
    for (const role of org?.roles ?? []) {
      for (const h of role.holders ?? []) for (const k of Object.keys(h)) keys.add(k);
    }
    for (const forbidden of ["note", "focus", "userId", "lapsed", "assignmentId"]) {
      expect(
        [...keys],
        `the public holder row must not carry ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });
});

describe.skipIf(!DB_CONFIGURED)("the fresh fork publishes nobody else's numbers", () => {
  it("states no foreign financial claim on any signed-out route", async () => {
    for (const [route, body] of await anonymousBodies()) {
      for (const claim of FOREIGN_NUMBERS) {
        expect(body, `${route} must not claim ${claim}`).not.toContain(claim);
      }
    }
  });

  it("ships no foreign financial claim in the JavaScript an anonymous visitor downloads", async () => {
    // The `/investor` and `/master-plan` numbers were module constants, so
    // they never crossed an API. They cross the wire in the bundle instead,
    // which any stranger can fetch, so that is where they have to be absent.
    expect(fs.existsSync(ASSETS), "dist/public/assets must exist; run pnpm build").toBe(true);
    const chunks = fs.readdirSync(ASSETS).filter((f) => f.endsWith(".js"));
    expect(chunks.length, "there must be chunks to check").toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const chunk of chunks) {
      const res = await http(`/assets/${chunk}`);
      expect(res.ok, `${chunk} must be served to an anonymous caller`).toBe(true);
      const text = await res.text();
      for (const claim of FOREIGN_NUMBERS) {
        if (text.includes(claim)) offenders.push(`${chunk} claims ${claim}`);
      }
    }
    expect(offenders, "no chunk may carry another project's financial claim").toEqual([]);
  });
});

/**
 * WHAT A FRESH VILLAGE IS HANDED AS ITS OWN, before anybody has typed a word.
 *
 * The seed files in server/seeds land in a fresh village's database on first
 * boot, or stand behind its documents until a founder saves one, and the
 * village then serves them as its own. Measured on a fresh boot on 2026-09-26,
 * they handed every fork one village's development plan as its public roadmap
 * (eight milestones in four phases, from buying the land to a retreat centre
 * and a full village), eight councils marked active, four journey ladders with
 * that village's stages and rites, an investor summary stating a debt
 * structure and exit terms, FAQs promising land share agreements, a fifteen
 * year financial model and bilingual schools twenty minutes away, and training
 * that told members their village already talks in NVC and decides by
 * consent. Nothing a stranger reads on a fork that has chosen nothing yet may
 * say the village chose it (docs/COORDINATION_SUBSTRATE.md section 7, "seeding
 * aspirational structure").
 *
 * This block runs BEFORE the founder writes anything below, so it reads the
 * state every fork boots in. The standing examples stay: they are labelled
 * (`isExample`), inert, and retire on the first real item, and none of the
 * routes here serves one on a fresh boot.
 *
 * Three kinds of check, for the reason the header gives: the structural
 * invariant (the roadmap is EMPTY; every investment term is unstated), and two
 * regression lists of strings the seed really served, because a structural
 * check alone goes hollow when the shape changes.
 */
const SEEDED_ROUTES = [
  "/api/milestones",
  "/api/faqs/investor",
  "/api/faqs/steward",
  "/api/faqs/resident",
  "/api/faqs/prosperity",
  "/api/visit-config",
  "/api/investor-summary",
  "/api/content",
  "/api/org",
  "/api/roles",
  "/api/quests",
  "/api/training-modules",
  "/api/game/config",
  "/api/settings",
  "/api/work-with-us-config",
];

/** Another village's name, place and legal entity. Matched case-insensitively. */
const FOREIGN_IDENTITY = [
  "amora", // brand-ok: the regression list this file asserts the ABSENCE of
  "dominicalito", // brand-ok: same
  "costa rica",
  "amorian",
  "508(c)",
];

/**
 * What the seeds actually served, word for word where it was one village's own
 * programme or plan. Matched case-sensitively, as written.
 */
const FOREIGN_STRUCTURE = [
  // The roadmap's phases and the build it described.
  "Phase 0",
  "Phase 1",
  "Phase 2",
  "Phase 3",
  "Phase 4",
  "Land Secured",
  "Retreat Center",
  "Health + Wellness Center",
  "Full Village",
  // The visit page's programme and the investor terms.
  "Village Weaving",
  "Debt (secured notes)",
  "structured buyback",
  // The FAQs.
  "Land Share Agreement",
  "15-year financial model",
  "bilingual schools",
  "Prosperity Packet",
  // The journey ladders' rites, and a quest gated on that visit programme.
  "Right of Passage",
  "Immersant",
];

async function seededBodies(): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (const r of SEEDED_ROUTES) {
    const res = await http(r);
    out.push([r, await res.text()]);
  }
  // Every section the content listing names is readable by a stranger, so each
  // one is part of what the village publishes.
  const listing = JSON.parse(out.find(([r]) => r === "/api/content")?.[1] ?? "{}");
  for (const name of listing.sections ?? []) {
    const r = `/api/content/${encodeURIComponent(name)}`;
    out.push([r, await http(r).then((x) => x.text())]);
  }
  return out;
}

describe.skipIf(!DB_CONFIGURED)("the fresh fork is handed no other village's story", () => {
  it("answers every seeded route, so an absence below means something", async () => {
    for (const [route, body] of await seededBodies()) {
      expect(body.length, `${route} must answer a stranger`).toBeGreaterThan(1);
    }
    // The positive control for the lists below: the quest library is still
    // seeded, so a route that serves seed content is being read here.
    const quests = (await call("GET", "/api/quests", undefined, "")).json;
    expect(Array.isArray(quests) && quests.length > 0, "the starter quests still arrive").toBe(true);
  });

  it("names no other village, its place or its legal entity on any seeded route", async () => {
    for (const [route, body] of await seededBodies()) {
      const lower = body.toLowerCase();
      for (const word of FOREIGN_IDENTITY) {
        expect(lower.includes(word), `${route} must not name ${word}`).toBe(false);
      }
    }
  });

  it("publishes no roadmap phase the village never planned", async () => {
    const res = await call("GET", "/api/milestones", undefined, "");
    expect(res.status).toBe(200);
    expect(res.json, "a village that has planned nothing publishes no milestone").toEqual([]);
  });

  it("serves none of another village's programmes, plans or rites", async () => {
    for (const [route, body] of await seededBodies()) {
      for (const phrase of FOREIGN_STRUCTURE) {
        expect(body.includes(phrase), `${route} must not serve "${phrase}"`).toBe(false);
      }
    }
  });

  it("stands up no circle, FAQ or journey the village never wrote", async () => {
    const org = (await call("GET", "/api/org", undefined, "")).json;
    expect(
      (org?.circles ?? []).filter((c: any) => !c.isExample).map((c: any) => c.name),
      "a village that has formed no circle publishes none",
    ).toEqual([]);
    for (const pathway of ["investor", "steward", "resident", "prosperity"]) {
      const faqs = (await call("GET", `/api/faqs/${pathway}`, undefined, "")).json;
      expect(faqs, `the ${pathway} FAQ starts empty`).toEqual([]);
    }
    const listing = (await call("GET", "/api/content", undefined, "")).json;
    for (const journey of ["investor", "steward", "resident", "prosperity"]) {
      expect(listing.sections, `no ${journey} journey is written for the village`).not.toContain(journey);
    }
  });

  it("states no investment term the village never set", async () => {
    const summary = (await call("GET", "/api/investor-summary", undefined, "")).json;
    expect(summary?.details?.length, "the summary still has its questions").toBeGreaterThan(0);
    for (const d of summary.details) {
      expect(d.value, `${d.label} is unstated until the village states it`).toBe("To be confirmed");
    }
    const visit = (await call("GET", "/api/visit-config", undefined, "")).json;
    for (const v of visit?.visit_types ?? []) {
      for (const k of ["duration", "format", "cost"]) {
        expect(v[k], `${v.title}: ${k} is unstated until the village states it`).toBe("To be confirmed");
      }
    }
  });

  it("tells members no practice is already their village's own", async () => {
    const name = String((await call("GET", "/api/game/config", undefined, "")).json?.project?.name ?? "");
    expect(name, "the village has a name to look for").toBeTruthy();
    const training = (await call("GET", "/api/training-modules", undefined, "")).json;
    expect(Array.isArray(training) && training.length > 0, "the starter training still arrives").toBe(true);
    for (const t of training) {
      expect(String(t.description), `${t.title} must describe the practice, not claim it for ${name}`).not.toContain(name);
    }
    const roles = (await call("GET", "/api/roles", undefined, "")).json;
    for (const r of roles ?? []) {
      expect(String(r.description), `${r.name} must not presume a Hypha space the village never opened`).not.toMatch(/hypha/i);
    }
  });
});

describe.skipIf(!DB_CONFIGURED)("a village with its own people still publishes them", () => {
  it("seats a documented holder and serves their first name to a stranger", async () => {
    const boot = await call(
      "POST",
      "/api/admin/bootstrap",
      { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Fork Founder" },
      "",
    );
    /*
     * The founder's link, on the state every fork boots in: no mail provider.
     *
     * This answered `emailed: true` while the server logged "[RESEND] API key
     * not set, skipping email" on the same request, because the sender
     * returned normally when it skipped and the caller could only ever catch a
     * throw. An operator read that and waited two days for an email that was
     * never attempted. A fork whose founder cannot get in never starts.
     */
    expect(boot.json?.emailed, "no provider means no email was sent").toBe(false);
    expect(String(boot.json?.emailNote ?? ""), "and the response says why").toMatch(/provider|sender/i);
    expect(boot.json?.claimUrl, "and the link is on screen instead").toBeTruthy();

    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    expect(claim, "bootstrap must return a claim link").toBeTruthy();
    const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "ForkPublish123!" }, "");
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder must hold a session").toBeTruthy();

    const made = await call("POST", "/api/admin/org/roles", {
      name: "Water Steward",
      aim: "Keep the springs running and the tanks full.",
      seats: 1,
    });
    expect(made.status, "the founder may create a seat of their own").toBe(200);
    const roleId = String(made.json?.id ?? "");
    expect(roleId).toBeTruthy();

    const seated = await call("POST", `/api/admin/org/roles/${roleId}/holders`, {
      displayName: "Rowan Ashfield",
      focus: "the upper spring",
      note: "Two days a week through the dry season.",
    });
    expect(seated.status, "the founder may seat somebody").toBe(200);

    const anon = (await call("GET", "/api/org", undefined, "")).json;
    const mine = (anon?.roles ?? []).find((r: any) => r.id === roleId);
    expect(mine, "the village's own seat must reach a stranger").toBeTruthy();
    expect(
      (mine.holders ?? []).map((h: any) => h.name),
      "the village's own holder must reach a stranger",
    ).toContain("Rowan");
  });

  it("still keeps that person's internal note and focus off the public tier", async () => {
    const raw = await http("/api/org").then((r) => r.text());
    expect(raw, "the note written about a person stays inside").not.toContain("dry season");
    expect(raw, "the focus written about a person stays inside").not.toContain("upper spring");
    expect(raw, "a surname is not the public tier's business").not.toContain("Ashfield");
  });

  it("publishes the figures a village states about its own land", async () => {
    /*
     * The other half of "the fix does not simply blank the page". Taking four
     * financial claims out of a module constant is only correct if a village
     * that states its own gets them back, so this walks the door the investor
     * page and the master plan read from.
     *
     * The pages themselves render from this payload, and a rendered page is
     * not something an HTTP suite can assert. What it CAN hold is the
     * contract: what a village writes reaches a stranger, unchanged, with no
     * account.
     *
     * THE ACRES FIXTURE IS A HECTARES VILLAGE ON PURPOSE, and for a while this
     * file was the only place the defect was written down. The master plan
     * printed a hardcoded "Total Acres" over this exact payload, so a village
     * that measures in hectares published its land at 40% of its real size and
     * this test called it a pass, because it only ever asked about `value`.
     * The unit is half the claim. It gets asserted here, and the tile built
     * from it gets asserted in client/src/pages/MasterPlan.test.tsx.
     */
    const put = await call("PUT", "/api/admin/settings", {
      landFacts: {
        acres: { value: "40", note: "hectares" },
        appraisal: { value: "2.4M", note: "March 2027" },
      },
    });
    expect(put.status, "the village may state its own figures").toBe(200);

    const anon = await http("/api/settings").then((r) => r.json());
    expect(anon?.landFacts?.acres?.value, "and a stranger reads them").toBe("40");
    expect(
      anon?.landFacts?.acres?.note,
      "the unit a village measures in reaches the page that states its size",
    ).toBe("hectares");
    expect(anon?.landFacts?.appraisal?.note, "including the line under the figure").toBe("March 2027");
    // Untouched keys stay blank rather than picking anything up.
    expect(String(anon?.landFacts?.projectedReturn?.value ?? ""), "an unstated figure stays unstated").toBe("");
  });

  it("publishes the team cards a village writes for itself", async () => {
    const put = await call("PUT", "/api/admin/content/team", [
      {
        name: "Rowan Ashfield",
        role: "Water Steward",
        circle: "Land Circle",
        bio: "Walks the springs on Mondays and Thursdays.",
      },
    ]);
    expect(put.status, "the village may write its own team page").toBe(200);
    const anon = await http("/api/content/team").then((r) => r.json());
    expect(
      (anon ?? []).map((c: any) => c.name),
      "a village that wrote a team page publishes it",
    ).toContain("Rowan Ashfield");
  });
});

/**
 * THE SECTION LISTING AND THE SECTION READER MUST AGREE.
 *
 * Public pages learn which content sections exist from `GET /api/content` and
 * request only those, because every blind request for an unwritten section
 * was a 404 the browser logged on every visit. The pair has to agree in both
 * directions or the fix does harm: a name listed but unreadable brings the red
 * console back, and a written section left off the list hides a village's own
 * words behind a placeholder.
 *
 * The 404 itself must not move. The admin content editor reads
 * `404 {"error":"Section not found"}` as "not written yet"
 * (client/src/components/admin/ContentEditorTab.tsx), so this asserts the
 * exact status and body, not only "not ok".
 */
describe.skipIf(!DB_CONFIGURED)("the content listing agrees with the section reader", () => {
  const UNWRITTEN_ON_A_FRESH_FORK = ["legal", "money", "covenant"];

  it("lists names only, each one readable, and leaves the unwritten ones off", async () => {
    const res = await http("/api/content");
    expect(res.status, "the listing answers a stranger").toBe(200);
    const body = await res.json();
    expect(Object.keys(body), "names only, never a section's words").toEqual(["sections"]);
    expect(Array.isArray(body.sections)).toBe(true);
    for (const name of body.sections) {
      expect(typeof name).toBe("string");
      const read = await http(`/api/content/${encodeURIComponent(name)}`);
      expect(read.status, `${name} is listed, so it must be readable`).toBe(200);
    }
    for (const name of UNWRITTEN_ON_A_FRESH_FORK) {
      if (body.sections.includes(name)) continue;
      const read = await http(`/api/content/${name}`);
      expect(read.status, `${name} is unlisted, so the reader must still refuse it`).toBe(404);
      expect(await read.json(), "the editor's 'not written' signal is unchanged").toEqual({
        error: "Section not found",
      });
    }
  });

  it("lists a section the moment a founder writes it", async () => {
    expect(founderToken, "the founder session from the suite above").toBeTruthy();
    const before = await http("/api/content").then((r) => r.json());
    expect(before.sections, "covenant starts unwritten on a fresh fork").not.toContain("covenant");
    const put = await call("PUT", "/api/admin/content/covenant", { opening: "Dear neighbours," });
    expect(put.status).toBe(200);
    const after = await http("/api/content").then((r) => r.json());
    expect(after.sections, "a written section is listed at once").toContain("covenant");
    const read = await http("/api/content/covenant").then((r) => r.json());
    expect(read.opening).toBe("Dear neighbours,");
  });
});

/**
 * THE OTHER HALF OF "HANDED NOTHING": what the village writes, it publishes.
 *
 * Emptying the roadmap and the circles is only correct if a village that plans
 * its own gets it back, through the same doors, to a stranger, unchanged. The
 * roadmap card and the circles page render nothing at all for an empty list
 * (client/src/components/BuildProgress.tsx, /circles), so an empty seed is a
 * blank section rather than a broken one, and this is the proof it fills.
 */
describe.skipIf(!DB_CONFIGURED)("a village that plans its own roadmap and circles still publishes them", () => {
  it("publishes the milestone a founder writes", async () => {
    expect(founderToken, "the founder session from the suites above").toBeTruthy();
    const made = await call("POST", "/api/admin/milestones", {
      phase: "This season",
      title: "Dig the first swale",
      status: "in-progress",
    });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    const anon = (await call("GET", "/api/milestones", undefined, "")).json;
    expect(
      (anon ?? []).map((m: any) => `${m.phase}: ${m.title}`),
      "a village's own roadmap reaches a stranger",
    ).toEqual(["This season: Dig the first swale"]);
  });

  it("publishes the circle a founder forms", async () => {
    const made = await call("POST", "/api/admin/circles", { name: "Springs Circle", purpose: "The water." });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    const org = (await call("GET", "/api/org", undefined, "")).json;
    expect(
      (org?.circles ?? []).filter((c: any) => !c.isExample).map((c: any) => c.name),
      "a village's own circle reaches a stranger",
    ).toEqual(["Springs Circle"]);
  });
});
