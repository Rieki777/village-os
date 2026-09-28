/**
 * EVERY ADMIN WRITE HERE IS READ BACK THROUGH THE PAGE THAT RENDERS IT.
 *
 * ── THE CLASS THIS SUITE EXISTS FOR ──────────────────────────────────────
 * An audit found twenty-seven dead or partial admin surfaces in this codebase
 * with one root cause: a form wrote into a generic document store, the renderer
 * selected from somewhere else, and the two were INDISTINGUISHABLE in the admin
 * UI. Same Save button, same green toast, same promise that changes go live
 * immediately. Nine alt-text fields round-tripped through the wizard for months
 * and were dropped by `mergedConfig()` before `/api/game/config` serialized. Two
 * org-chart fields were writable end to end and no form sent them. A checkbox
 * cleared the "these are the platform's placeholders" banner on /exit-policy
 * while the editor offered no field for three of the five terms that page
 * prints.
 *
 * ── WHY THIS SHAPE AND NOT UNIT TESTS ────────────────────────────────────
 * Every one of those surfaces had passing tests. The tests asserted the write
 * landed in the store, which was TRUE and was never the question. So each case
 * here does exactly three things and asserts across the seam:
 *
 *     1. write through the ADMIN route a founder's button calls
 *     2. read the PUBLIC route the page fetches, as the page fetches it
 *     3. assert the value the founder typed is in that payload
 *
 * A write that lands somewhere no renderer reads fails at step 3, which is the
 * one thing the old tests could not see. Its static twin is
 * `scripts/check-admin-reach.mjs`, which catches the other half of the class: a
 * route with no door at all.
 *
 * ADDING A SURFACE: add a case. If you cannot name the public route that serves
 * the value to a page, that is the finding, not a reason to skip the test.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";
import { DEFAULT_EXIT_POLICY } from "./lib/exitPolicy";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[adminReach.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
// From 6001: 6000 is a port fetch() refuses to dial, so a pid landing on it
// booted a server this suite could never reach. The gate now refuses it.
const PORT = 6001 + (process.pid % 499);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "admin-reach-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let founderToken = "";

async function call(
  method: string,
  route: string,
  body?: unknown,
  token: string | undefined = founderToken,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

/** A read with NO token, which is how a visitor reaches a public page. */
const asStranger = (route: string) => call("GET", route, undefined, "");

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the admin reach test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-admin-reach-"));
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
      AUTH_TOKEN_SECRET: "admin-reach-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s:\n${logs.join("")}`);
    try {
      if ((await fetch(`${BASE}/health`)).ok) break; // module-review-ok: the boot poll against the local test server
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Reach Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "AdminReach123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const mods = await call("GET", "/api/admin/modules");
  for (const m of mods.json?.modules ?? []) {
    if (m.core) continue;
    await call("PUT", `/api/admin/modules/${m.id}/lifecycle`, { lifecycle: "public" });
  }
}, 300_000);

afterAll(async () => {
  child?.kill();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("an admin write reaches the page that renders it", () => {
  it("the exit policy: every term the editor writes is printed by /exit-policy", async () => {
    const circle = await call("POST", "/api/admin/circles", { name: "Care Circle" });
    expect(circle.status, JSON.stringify(circle.json)).toBe(200);
    const circleId = String(circle.json.id);

    // Before the village writes anything, the route says the restorative
    // steps are still the platform's words, which is what stops /governance
    // and /roles printing them as this village's conflict process.
    const before = await asStranger("/api/exit-policy");
    expect(before.status).toBe(200);
    expect(before.json.platformWording).toContain("restorativeSteps");

    const terms = {
      placeholder: true,
      voluntary: {
        noticePeriodDays: 45,
        valuationMethod: "Hours logged are honoured at the rate the circle set in its first season.",
        unwindSteps: ["Hand back the keys", "Walk the land with a steward", "Sign the closing note"],
      },
      involuntary: {
        decidingDomainId: circleId,
        appealDomainId: circleId,
        process: "The care circle hears it first, in person, with a week between the hearing and the decision.",
      },
      restorative: {
        intakeContactRole: "",
        steps: ["A private cup of tea", "A facilitated sit-down", "A written agreement and a date to revisit it"],
      },
    };
    const saved = await call("PUT", "/api/admin/exit-policy", terms);
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);

    // THE SEAM. A visitor's read of the published page.
    const page = await asStranger("/api/exit-policy");
    expect(page.status).toBe(200);
    const p = page.json.policy;
    expect(p.voluntary.valuationMethod).toContain("the rate the circle set");
    expect(p.voluntary.unwindSteps).toEqual(terms.voluntary.unwindSteps);
    expect(p.restorative.steps).toEqual(terms.restorative.steps);
    expect(p.involuntary.process).toContain("a week between the hearing");
    // The two ids that were stored, read by nobody, and editable by nobody.
    expect(p.involuntary.decidingCircle?.name).toBe("Care Circle");
    expect(p.involuntary.appealCircle?.name).toBe("Care Circle");
    // Every printed term is now in the village's own words, draft or not.
    expect(page.json.platformWording).toEqual([]);
  });

  it("the acknowledgement refuses while any printed term is still the platform's", async () => {
    // Real terms everywhere EXCEPT the restorative steps.
    const half = {
      placeholder: false,
      voluntary: {
        noticePeriodDays: 30,
        valuationMethod: "Our own words about value.",
        unwindSteps: ["Our own first step", "Our own second step"],
      },
      involuntary: { decidingDomainId: "", appealDomainId: "", process: "Our own words about asking someone to leave." },
      restorative: { intakeContactRole: "", steps: [...DEFAULT_EXIT_POLICY.restorative.steps] },
    };
    const refused = await call("PUT", "/api/admin/exit-policy", half);
    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(refused.json.error).toBe("terms_still_platform_default");
    expect(String(refused.json.message)).toContain("The restorative path");

    // The banner is still up, because the refusal refused the whole write.
    const stillDraft = await asStranger("/api/exit-policy");
    expect(stillDraft.json.policy.placeholder).toBe(true);

    // Whitespace and case are formatting, so they do not count as new words.
    const cosmetic = {
      ...half,
      restorative: {
        intakeContactRole: "",
        steps: DEFAULT_EXIT_POLICY.restorative.steps.map((s) => `  ${s.toUpperCase()}  `),
      },
    };
    const stillRefused = await call("PUT", "/api/admin/exit-policy", cosmetic);
    expect(stillRefused.status, JSON.stringify(stillRefused.json)).toBe(409);

    // Written in the village's own words, the acknowledgement is available.
    const own = {
      ...half,
      restorative: { intakeContactRole: "", steps: ["We sit down first", "We write what we agreed"] },
    };
    const accepted = await call("PUT", "/api/admin/exit-policy", own);
    expect(accepted.status, JSON.stringify(accepted.json)).toBe(200);
    const published = await asStranger("/api/exit-policy");
    expect(published.json.policy.placeholder).toBe(false);
  });

  it("org seat accountabilities and whyItMatters reach /api/org, which is what /roles reads", async () => {
    const circle = await call("POST", "/api/admin/circles", { name: "Welcome Circle" });
    const seat = await call("POST", "/api/admin/org/roles", {
      name: "Welcome Host", circleId: String(circle.json.id), seats: 2,
    });
    expect(seat.status, JSON.stringify(seat.json)).toBe(200);
    const seatId = String(seat.json.id ?? seat.json.roleId ?? "");
    expect(seatId, "the create must hand back an id").toBeTruthy();

    const written = await call("PUT", `/api/admin/org/roles/${seatId}`, {
      name: "Welcome Host",
      accountabilities: ["Meet every arrival in their first week", "Keep the guest book current"],
      whyItMatters: "The first face somebody meets decides whether they come back.",
    });
    expect(written.status, JSON.stringify(written.json)).toBe(200);

    const org = await asStranger("/api/org");
    const rendered = (org.json.roles ?? []).find((r: any) => r.id === seatId);
    expect(rendered, "the seat must be on the public org payload").toBeTruthy();
    expect(rendered.accountabilities).toEqual([
      "Meet every arrival in their first week",
      "Keep the guest book current",
    ]);
    expect(rendered.whyItMatters).toContain("decides whether they come back");

    // The journal says a whyItMatters-only edit happened. It used to be silent,
    // and a silent edit to the seat's own history is the change people argue over.
    const again = await call("PUT", `/api/admin/org/roles/${seatId}`, {
      whyItMatters: "Rewritten, and the record should say so.",
    });
    expect(again.status).toBe(200);
    const journal = await call("GET", `/api/org/roles/${seatId}/journal`);
    expect(JSON.stringify(journal.json)).toContain("why this seat matters rewritten");
  });

  it("a circle's name, purpose and status reach /api/org, with the map module OFF", async () => {
    const made = await call("POST", "/api/admin/circles", { name: "Water Circle", purpose: "Springs and greywater" });
    const id = String(made.json.id);

    // THE COUPLING DEFECT. /circles, /roles and /team are always-on core pages
    // reading the ungated /api/org, and the only circle editor used to sit
    // behind requireModule("map"): turning the map off removed the editor while
    // the public pages kept printing the old name to every visitor.
    // Disabling refuses while a dependent is non-off, so the dependents go
    // first and come back after. Read from the registry rather than named here,
    // because the next module to require the map should not break this test.
    const registry = await call("GET", "/api/admin/modules");
    const dependents = (registry.json?.modules ?? [])
      .filter((m: any) => !m.core && (m.requires ?? []).includes("map") && m.lifecycle !== "off")
      .map((m: any) => String(m.id));
    for (const id of dependents) {
      const paused = await call("PUT", `/api/admin/modules/${id}/lifecycle`, { lifecycle: "off" });
      expect(paused.status, `${id} must pause: ${JSON.stringify(paused.json)}`).toBe(200);
    }
    const off = await call("PUT", "/api/admin/modules/map/lifecycle", { lifecycle: "off" });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    expect((await asStranger("/api/circles")).status, "the map's own route is gated").toBe(404);

    const renamed = await call("PUT", `/api/admin/circles/${id}`, {
      name: "Springs and Greywater Circle",
      purpose: "Everything the water touches on the way through.",
      status: "forming",
    });
    expect(renamed.status, JSON.stringify(renamed.json)).toBe(200);

    const org = await asStranger("/api/org");
    const c = (org.json.circles ?? []).find((x: any) => x.id === id);
    expect(c.name).toBe("Springs and Greywater Circle");
    expect(c.purpose).toContain("on the way through");
    expect(c.status).toBe("forming");

    // A status outside the enum is refused in words. `replaceAll` is a
    // DELETE-all plus a re-INSERT of the whole table, so an unknown value used
    // to roll back every circle and read as "nothing saved" everywhere.
    const bad = await call("PUT", `/api/admin/circles/${id}`, { status: "hibernating" });
    expect(bad.status).toBe(400);
    expect(String(bad.json.message)).toContain("hibernating");
    expect((await asStranger("/api/org")).json.circles.find((x: any) => x.id === id).name)
      .toBe("Springs and Greywater Circle");

    await call("PUT", "/api/admin/modules/map/lifecycle", { lifecycle: "public" });
    for (const id of dependents) {
      await call("PUT", `/api/admin/modules/${id}/lifecycle`, { lifecycle: "public" });
    }
  });

  it("where a circle sits: created inside, moved, refused in words, never deleted from under its children", async () => {
    /*
     * `parentCircleId` had one writer that could set it, a blind body spread on
     * PUT, and one check, self-parent. Two circles holding each other passed,
     * and the map then drew NOTHING. POST hardcoded null, so a founder could not
     * create a circle inside another at all. These drive the routes the admin
     * picker calls and read /api/org back, which is what every surface draws.
     */
    const parent = await call("POST", "/api/admin/circles", { name: "Nesting Hearth Circle" });
    expect(parent.status, JSON.stringify(parent.json)).toBe(200);
    const pid = String(parent.json.id);
    const child = await call("POST", "/api/admin/circles", { name: "Nesting Garden Circle", parentCircleId: pid });
    expect(child.status, JSON.stringify(child.json)).toBe(200);
    const cid = String(child.json.id);
    const sits = async (id: string) =>
      ((await asStranger("/api/org")).json.circles ?? []).find((x: any) => x.id === id)?.parentCircleId ?? null;
    expect(await sits(cid), "created inside its parent").toBe(pid);

    const ghost = await call("POST", "/api/admin/circles", { name: "Nesting Nowhere Circle", parentCircleId: "no-such-circle" });
    expect(ghost.status).toBe(400);
    expect(ghost.json.error).toBe("circle_parent_unknown");

    // The loop that used to blank the map, refused with both names in it.
    const loop = await call("PUT", `/api/admin/circles/${pid}`, { parentCircleId: cid });
    expect(loop.status, JSON.stringify(loop.json)).toBe(400);
    expect(loop.json.error).toBe("circle_parent_cycle");
    expect(String(loop.json.message)).toContain("Nesting Hearth Circle");
    expect(String(loop.json.message)).toContain("Nesting Garden Circle");
    expect(await sits(pid), "a refused move writes nothing").toBeNull();

    // A rename that does not move the circle is never checked for placement.
    const renamed = await call("PUT", `/api/admin/circles/${cid}`, { name: "Nesting Garden and Orchard Circle" });
    expect(renamed.status, JSON.stringify(renamed.json)).toBe(200);
    expect(await sits(cid)).toBe(pid);

    const blocked = await call("DELETE", `/api/admin/circles/${pid}`);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toBe("circle_has_children");

    // "" is the picker's "at the top".
    const out = await call("PUT", `/api/admin/circles/${cid}`, { parentCircleId: "" });
    expect(out.status, JSON.stringify(out.json)).toBe(200);
    expect(await sits(cid), "moved to the top of the village").toBeNull();

    const gone = await call("DELETE", `/api/admin/circles/${pid}`);
    expect(gone.status, JSON.stringify(gone.json)).toBe(200);
  });

  it("a draft that moves a circle publishes, redraws at once, and undoes", async () => {
    /*
     * The drag on the living map writes an org draft whose change is
     * move_circle (0208). The move is raw SQL inside the publish transaction,
     * and `circlesRepo.all()` never re-reads the table, so without the reload
     * the publish route now performs every surface would keep drawing the old
     * shape until a restart. /api/org is read straight after publish to prove it.
     */
    const outer = await call("POST", "/api/admin/circles", { name: "Arranging Outer Circle" });
    const inner = await call("POST", "/api/admin/circles", { name: "Arranging Inner Circle" });
    expect(outer.status, JSON.stringify(outer.json)).toBe(200);
    expect(inner.status, JSON.stringify(inner.json)).toBe(200);
    const oid = String(outer.json.id);
    const iid = String(inner.json.id);
    const sits = async (id: string) =>
      ((await asStranger("/api/org")).json.circles ?? []).find((x: any) => x.id === id)?.parentCircleId ?? null;

    const draft = await call("POST", "/api/admin/org/drafts", { title: "Arranging circles" });
    expect(draft.status, JSON.stringify(draft.json)).toBe(200);
    const did = String(draft.json.id);

    const bad = await call("POST", `/api/admin/org/drafts/${did}/changes`, {
      op: "move_circle", orgRoleId: iid, payload: { parentCircleId: oid },
    });
    expect(bad.status, "a move names its circle as circle:<id>").toBe(400);

    const added = await call("POST", `/api/admin/org/drafts/${did}/changes`, {
      op: "move_circle", orgRoleId: `circle:${iid}`, payload: { parentCircleId: oid },
    });
    expect(added.status, JSON.stringify(added.json)).toBe(200);

    const published = await call("POST", `/api/admin/org/drafts/${did}/publish`, {});
    expect(published.status, JSON.stringify(published.json)).toBe(200);
    expect(await sits(iid), "redrawn at once, with no restart").toBe(oid);

    const reverted = await call("POST", `/api/admin/org/drafts/${did}/revert`, {});
    expect(reverted.status, JSON.stringify(reverted.json)).toBe(200);
    expect(await sits(iid), "undone at once too").toBeNull();
  });

  it("image alt text reaches /api/game/config, which is what every page reads", async () => {
    const saved = await call("PUT", "/api/admin/brand", {
      images: {
        heroAlt: "Morning fog over the ridge above the village",
        logoAlt: "",
      },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);

    const cfg = await asStranger("/api/game/config");
    expect(cfg.status).toBe(200);
    // This is the exact assertion nine labelled accessibility fields could not
    // pass: `mergedConfig()` rebuilds `images` from named keys, so every alt
    // value was dropped here while the admin panel showed it round-tripping.
    expect(cfg.json.images.heroAlt).toBe("Morning fog over the ridge above the village");
    // An empty string is a deliberate "this image is decorative" and must
    // survive as one. A truthiness merge turns it back into a sentence a
    // screen reader then reads over a picture that carries no meaning.
    expect(cfg.json.images.logoAlt).toBe("");
  });

  it("a linked crowdpool campaign reaches /api/crowdpool/campaigns", async () => {
    const saved = await call("PUT", "/api/admin/modules/crowdpool/config", {
      config: { villageCampaigns: [{ slug: "second-raising" }] },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);

    const listed = await asStranger("/api/crowdpool/campaigns");
    expect(listed.status).toBe(200);
    expect((listed.json.campaigns ?? []).map((c: any) => c.key)).toContain("second-raising");

    // The validator's refusal is a sentence, and the config it refused is not
    // written: a founder who mistypes gets told, never a silent empty list.
    const refused = await call("PUT", "/api/admin/modules/crowdpool/config", {
      config: { villageCampaigns: [{ slug: "Not A Slug" }] },
    });
    expect(refused.status).toBe(400);
    expect((await asStranger("/api/crowdpool/campaigns")).json.campaigns.map((c: any) => c.key))
      .toContain("second-raising");
  });

  it("forum categories reach /api/forum/categories, and the whole config survives the write", async () => {
    const saved = await call("PUT", "/api/admin/modules/forum/config", {
      config: {
        categories: [
          { id: "village-life", label: "Life Here", sortOrder: 1 },
          { id: "water", label: "Water", sortOrder: 2 },
        ],
      },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);

    const cats = await asStranger("/api/forum/categories");
    expect(cats.status).toBe(200);
    const rendered = JSON.stringify(cats.json);
    expect(rendered).toContain("Life Here");
    expect(rendered).toContain("Water");
  });

  it("the resources routing keys reach /api/resources", async () => {
    /*
     * A SIGNED-IN MEMBER IS THE ONLY READER THAT PROVES THIS.
     *
     * The first draft read as a stranger, and a stranger gets the public tier,
     * whose payload hardcodes `measured: null`. That assertion passes whether
     * or not the config is read at all, which is the exact shape of test this
     * whole suite exists to replace: it measures something true and unrelated.
     */
    const member = await call("POST", "/api/auth/register", {
      name: "Tam Reyes", email: `tam-${PORT}@example.test`, password: "AdminReach123!", paths: ["resident"],
    }, "");
    const memberToken = String(member.json?.token ?? "");
    expect(memberToken).toBeTruthy();

    const toMembers = await call("PUT", "/api/admin/modules/resources/config", {
      config: { requestCategory: "water", measuredVisibleTo: "members", labels: {} },
    });
    expect(toMembers.status, JSON.stringify(toMembers.json)).toBe(200);
    const open = await call("GET", "/api/resources", undefined, memberToken);
    expect(open.status).toBe(200);
    expect(open.json.measured, "a member sees the measured inflows while the village says members").not.toBeNull();

    const toAdmins = await call("PUT", "/api/admin/modules/resources/config", {
      config: { requestCategory: "water", measuredVisibleTo: "admins", labels: {} },
    });
    expect(toAdmins.status, JSON.stringify(toAdmins.json)).toBe(200);
    const closed = await call("GET", "/api/resources", undefined, memberToken);
    expect(closed.json.measured, "the same member does not, once the village says admins").toBeNull();
    expect((await call("GET", "/api/resources")).json.measured, "an admin always does").not.toBeNull();
  });

  it("the map's words reach /api/map/config, which is what the shell pushes into the artifact", async () => {
    const saved = await call("PUT", "/api/admin/map/vocabulary", {
      vocabulary: {
        road: ["camino", "track"],
        water: ["quebrada"],
        zone: ["the flats"],
        media: [],
        phases: { 1: "Standing", 2: "Going up", 3: "Dreamed" },
      },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);

    const cfg = await call("GET", "/api/map/config");
    expect(cfg.status).toBe(200);
    expect(cfg.json.vocabulary.road).toContain("camino");
    expect(cfg.json.vocabulary.water).toContain("quebrada");
    expect(cfg.json.vocabulary.phases["2"]).toBe("Going up");
  });

  it("a seating can be ended, and a documented holder can be forgotten", async () => {
    const circle = await call("POST", "/api/admin/circles", { name: "Kitchen Circle" });
    const seat = await call("POST", "/api/admin/org/roles", {
      name: "Cook", circleId: String(circle.json.id), seats: 2,
    });
    const seatId = String(seat.json.id ?? seat.json.roleId ?? "");

    const member = await call("POST", "/api/auth/register", {
      name: "Rae Ono", email: `rae-${PORT}@example.test`, password: "AdminReach123!", paths: ["resident"],
    }, "");
    const seated = await call("POST", `/api/admin/org/roles/${seatId}/holders`, { userId: String(member.json.user.id) });
    expect(seated.status, JSON.stringify(seated.json)).toBe(200);

    // THE SEAM for this one: the admin's own read has to carry the seating id,
    // or no surface can address a seating and both routes stay curl-only.
    const org = await call("GET", "/api/org");
    const held = (org.json.roles ?? []).find((r: any) => r.id === seatId);
    const holder = (held.holders ?? [])[0];
    expect(holder?.assignmentId, "an admin read must carry the seating id").toBeTruthy();

    // A stranger never sees it: a seating id is a handle on a person's record.
    // R57 made the NAMES public by default, so there is a holder row here to
    // check now, and the seating id staying off it is the whole point.
    const publicOrg = await asStranger("/api/org");
    const publicHeld = (publicOrg.json.roles ?? []).find((r: any) => r.id === seatId);
    for (const h of publicHeld.holders ?? []) expect(Object.keys(h)).toEqual(["name"]);

    const ended = await call("DELETE", `/api/admin/org/seatings/${holder.assignmentId}`, { reason: "moved away" });
    expect(ended.status, JSON.stringify(ended.json)).toBe(200);
    const after = await call("GET", "/api/org");
    expect((after.json.roles ?? []).find((r: any) => r.id === seatId).holderCount).toBe(0);

    // Forget, the destructive path, which was reachable only by curl.
    await call("POST", `/api/admin/org/roles/${seatId}/holders`, { displayName: "Ines Mora", note: "kitchen lead" });
    const withDoc = await call("GET", "/api/org");
    const doc = ((withDoc.json.roles ?? []).find((r: any) => r.id === seatId).holders ?? [])
      .find((h: any) => h.kind === "documented");
    expect(doc?.assignmentId, "a documented holder must be addressable too").toBeTruthy();

    const forgotten = await call("POST", `/api/admin/org/seatings/${doc.assignmentId}/forget`, { reason: "asked to be" });
    expect(forgotten.status, JSON.stringify(forgotten.json)).toBe(200);
    const history = await call("GET", `/api/org/roles/${seatId}/history`);
    expect(JSON.stringify(history.json)).not.toContain("Ines Mora");
    expect(JSON.stringify(history.json)).not.toContain("kitchen lead");
  });
});
