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
