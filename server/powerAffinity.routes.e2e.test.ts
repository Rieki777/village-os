/**
 * WHICH CHARACTER SUITS WHICH POWER, FROM THE REQUEST TO THE PROFILE.
 *
 * Rye's ruling (2026-09-09) is one sentence about three things at once: a power
 * the village entrusts, the class a member chose, and the rung they reached. A
 * test of any one of those alone passes against a build that gets the sentence
 * wrong, so every case here is read back where a member reads it, on
 * `/api/game/progression` and on a class's card.
 *
 * THE CONTROLS SIT IN THE SAME CASE. Cass stands at Contributor and plays The
 * Architect, and the same read that recommends her The Architect's powers
 * recommends her nothing of The Storyteller's. Dell plays The Architect too and
 * stands below the rung. Ezra stands at the rung and plays only The Builder, who
 * suits no power by the ruling. A build that recommended everything, or nothing,
 * or ignored the rung, fails a named line below.
 *
 * AND A SUGGESTION NEVER PERMITS. The last case suggests `story.tell` to Cass
 * and then has her try to use it.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first. Skips loudly without TEST_DATABASE_URL. The cases run IN
 * ORDER, and the village's own decisions accumulate from one to the next.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[powerAffinity.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 5800 + (process.pid % 200);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "power-affinity-admin";
const PASSWORD = "PowerAffinity123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
/** Contributor, plays The Architect. The member the ruling is about. */
let cassToken = "";
/** Member, below the rung, plays The Architect too. */
let dellToken = "";
/** Contributor, plays only The Builder. */
let ezraToken = "";
/** Member with no appointment and no class. Holds nothing that edits the map. */
let fernToken = "";

interface Answer { status: number; json: any }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function register(name: string, handle: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    body: { name, email: `${handle}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
    token: null,
  });
  expect(r.status, `${name} must register: ${JSON.stringify(r.json)}`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

async function stage(id: string, stageId: string): Promise<void> {
  const r = await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId } });
  expect(r.status, `${id} reaches ${stageId}: ${JSON.stringify(r.json)}`).toBe(200);
}

async function play(token: string, archetypeKey: string): Promise<void> {
  const r = await call("POST", "/api/me/characters", { token, body: { archetypeKey, presentation: "f", tone: "olive" } });
  expect(r.status, `plays ${archetypeKey}: ${JSON.stringify(r.json)}`).toBe(200);
}

/** The catalogue exactly as the profile reads it. */
async function catalogueOf(token: string): Promise<any[]> {
  const r = await call("GET", "/api/game/progression", { token });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  expect(Array.isArray(r.json?.capabilityCatalogue)).toBe(true);
  return r.json.capabilityCatalogue;
}

function rowOf(rows: any[], key: string): any {
  const row = rows.find((r) => r.key === key);
  expect(row, `${key} is in the catalogue`).toBeTruthy();
  return row;
}

async function editor(): Promise<any> {
  const r = await call("GET", "/api/admin/power-affinity");
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json;
}

const powerIn = (doc: any, key: string): any => (doc?.powers ?? []).find((p: any) => p.key === key);

async function cardOf(classKey: string): Promise<string[]> {
  const r = await call("GET", `/api/archetypes/${classKey}/paths`, { token: null });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  expect(Array.isArray(r.json?.powers), "the card carries a powers list").toBe(true);
  expect(Array.isArray(r.json?.roles), "and still carries its seats").toBe(true);
  return r.json.powers.map((p: any) => String(p.key));
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the power affinity test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-power-affinity-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds

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
      AUTH_TOKEN_SECRET: "power-affinity-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s. Output:\n${logs.join("")}`);
    }
    try {
      const res = await fetch(`${BASE}/health`); // module-review-ok: the boot poll against the local test server
      if (res.ok) break;
    } catch { /* not up yet */ }
    await settle(400);
  }

  const boot = await call("POST", "/api/admin/bootstrap", {
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Power Affinity Founder" },
    token: null,
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const cass = await register("Cass Morrow", "cass");
  const dell = await register("Dell Arden", "dell");
  const ezra = await register("Ezra Quill", "ezra");
  const fern = await register("Fern Hollis", "fern");
  cassToken = cass.token;
  dellToken = dell.token;
  ezraToken = ezra.token;
  fernToken = fern.token;

  await stage(cass.id, "contributor");
  await stage(ezra.id, "contributor");
  await stage(dell.id, "member");
  await stage(fern.id, "member");

  await play(cassToken, "researching");
  await play(dellToken, "researching");
  await play(ezraToken, "building");
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("the platform's suggestion, before the village decides anything", () => {
  it("shows a founder every entrusted power beside the classes it suits, and nobody else", async () => {
    const stranger = await call("GET", "/api/admin/power-affinity", { token: null });
    expect(stranger.status).toBe(401);
    expect(String(stranger.json?.message)).toContain("Sign in as an admin");

    const doc = await editor();
    expect(doc.classes.map((c: any) => c.key).sort()).toEqual(
      ["building", "catalyzing", "facilitating", "researching", "storytelling"],
    );
    expect(doc.classes.find((c: any) => c.key === "researching")?.name).toBe("The Architect");

    const library = powerIn(doc, "library.keep");
    expect(library).toMatchObject({ classes: ["researching"], suggested: ["researching"], decided: false, live: true });
    // The map module is off in this village, so its photo power is listed for
    // the founder and marked as reaching nobody yet.
    expect(powerIn(doc, "map.curatePhotos")).toMatchObject({ classes: ["storytelling"], live: false });
    // A power the ladder opens is not the editor's to suggest.
    expect(powerIn(doc, "mechanics.propose")).toBeUndefined();
  });

  it("puts The Architect's powers to a Contributor who plays The Architect, and nothing else", async () => {
    const rows = await catalogueOf(cassToken);

    const publish = rowOf(rows, "map.publish");
    expect(publish.recommended).toBe(true);
    expect(publish.suits).toEqual([{ key: "researching", name: "The Architect", yours: true }]);
    expect(rowOf(rows, "library.keep").recommended).toBe(true);

    // The control in the same read: a power that suits a class she does not play.
    const story = rowOf(rows, "story.tell");
    expect(story.suits).toEqual([{ key: "storytelling", name: "The Storyteller" }]);
    expect(story.recommended).toBe(false);

    // And no power the ladder opens carries a suggestion at all.
    const climbed = rows.filter((r) => r.opens?.via === "stage");
    expect(climbed.length).toBeGreaterThan(0);
    for (const r of climbed) {
      expect(r.suits, r.key).toEqual([]);
      expect(r.recommended, r.key).toBe(false);
    }
  });

  it("names the class to a member below the rung, and recommends nothing", async () => {
    const rows = await catalogueOf(dellToken);
    const publish = rowOf(rows, "map.publish");
    expect(publish.suits, "the same fact, said about the class").toEqual([{ key: "researching", name: "The Architect" }]);
    expect(publish.recommended).toBe(false);
    expect(rows.filter((r) => r.recommended).map((r) => r.key)).toEqual([]);
  });

  it("recommends nothing to a Contributor who plays only The Builder", async () => {
    const rows = await catalogueOf(ezraToken);
    expect(rows.filter((r) => r.recommended).map((r) => r.key)).toEqual([]);
    expect(rows.some((r) => (r.suits ?? []).some((s: any) => s.key === "building"))).toBe(false);
  });

  it("lists a class's powers on its card, leaving out a power whose module is off", async () => {
    expect((await cardOf("researching")).sort()).toEqual(["library.keep", "map.edit", "map.publish"]);
    // The Storyteller's photo and announcement powers belong to modules that
    // are off here, so the card names only the one that reaches anybody.
    expect(await cardOf("storytelling")).toEqual(["story.tell"]);
    expect(await cardOf("building")).toEqual([]);
  });
});

describe.skipIf(!DB_CONFIGURED)("a village's own map", () => {
  it("replaces the platform's suggestion for one power, and the member reads it on the next request", async () => {
    const put = await call("PUT", "/api/admin/power-affinity/story.tell", {
      body: { classes: ["storytelling", "researching"] },
    });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    expect(powerIn(put.json, "story.tell")).toMatchObject({ classes: ["storytelling", "researching"], decided: true });

    const story = rowOf(await catalogueOf(cassToken), "story.tell");
    expect(story.recommended).toBe(true);
    expect(story.suits).toContainEqual({ key: "researching", name: "The Architect", yours: true });
    expect(await cardOf("researching")).toContain("story.tell");
    // Every power the founder did not touch still follows the platform.
    expect(powerIn(await editor(), "library.keep")).toMatchObject({ classes: ["researching"], decided: false });
  });

  it("reads an empty list as a power that suits nobody, and null as following the platform again", async () => {
    const cleared = await call("PUT", "/api/admin/power-affinity/map.publish", { body: { classes: [] } });
    expect(cleared.status, JSON.stringify(cleared.json)).toBe(200);
    let publish = rowOf(await catalogueOf(cassToken), "map.publish");
    expect(publish.suits).toEqual([]);
    expect(publish.recommended).toBe(false);
    expect(powerIn(await editor(), "map.publish")).toMatchObject({ classes: [], decided: true });

    const back = await call("PUT", "/api/admin/power-affinity/map.publish", { body: { classes: null } });
    expect(back.status, JSON.stringify(back.json)).toBe(200);
    publish = rowOf(await catalogueOf(cassToken), "map.publish");
    expect(publish.recommended).toBe(true);
    expect(powerIn(await editor(), "map.publish")).toMatchObject({ classes: ["researching"], decided: false });
  });

  it("refuses an edit it cannot read, names what is wrong, and changes nothing", async () => {
    const noClasses = await call("PUT", "/api/admin/power-affinity/library.keep", { body: {} });
    expect(noClasses.status).toBe(400);

    const noPower = await call("PUT", "/api/admin/power-affinity/library.burn", { body: { classes: ["researching"] } });
    expect(noPower.status).toBe(400);
    expect(String(noPower.json?.error)).toContain("library.burn");

    const noClass = await call("PUT", "/api/admin/power-affinity/library.keep", { body: { classes: ["gardening"] } });
    expect(noClass.status).toBe(400);
    expect(String(noClass.json?.error)).toContain("gardening");

    expect(powerIn(await editor(), "library.keep")).toMatchObject({ classes: ["researching"], decided: false });
  });
});

describe.skipIf(!DB_CONFIGURED)("a power the village takes off its ladder", () => {
  it("joins the editor, can be given a class, and leaves the card when the ladder takes it back", async () => {
    // The ladder opens it, so the editor does not list it yet.
    expect(powerIn(await editor(), "mechanics.propose")).toBeUndefined();

    const off = await call("PUT", "/api/admin/variables/progression.unlock.mechanics.propose", { body: { value: "none" } });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    expect(powerIn(await editor(), "mechanics.propose"), "entrusted here now").toMatchObject({
      classes: [],
      suggested: [],
      decided: false,
      entrusted: true,
    });

    const mapped = await call("PUT", "/api/admin/power-affinity/mechanics.propose", { body: { classes: ["researching"] } });
    expect(mapped.status, JSON.stringify(mapped.json)).toBe(200);
    const entrusted = rowOf(await catalogueOf(cassToken), "mechanics.propose");
    expect(entrusted.opens).toEqual({ via: "appointment" });
    expect(entrusted.held).toBe(false);
    expect(entrusted.recommended).toBe(true);
    expect(await cardOf("researching")).toContain("mechanics.propose");

    // Back onto the ladder. The catalogue and the card both stop suggesting
    // it, and the editor keeps the decision where the founder left it.
    const on = await call("PUT", "/api/admin/variables/progression.unlock.mechanics.propose", { body: { value: "member" } });
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    const climbed = rowOf(await catalogueOf(cassToken), "mechanics.propose");
    expect(climbed.opens.via).toBe("stage");
    expect(climbed.suits).toEqual([]);
    expect(climbed.recommended).toBe(false);
    expect(await cardOf("researching")).not.toContain("mechanics.propose");
    // Kept, and it says why its ticks reach nobody now.
    expect(powerIn(await editor(), "mechanics.propose")).toMatchObject({
      classes: ["researching"],
      decided: true,
      entrusted: false,
    });
  });
});

describe.skipIf(!DB_CONFIGURED)("a suggestion never permits", () => {
  it("leaves the map to whoever holds org.declare, even for the member it suggests story.tell to", async () => {
    // Fern holds nothing. Cass is the member the map now suggests story.tell
    // to, and a suggestion is not the power. Since 2026-09-23 the map is
    // written by `org.declare`, so holding story.tell would not open it either.
    for (const token of [fernToken, cassToken]) {
      const tried = await call("PUT", "/api/admin/power-affinity/library.keep", { token, body: { classes: ["catalyzing"] } });
      expect([401, 403], JSON.stringify(tried.json)).toContain(tried.status);
    }
    expect(rowOf(await catalogueOf(cassToken), "story.tell").held).toBe(false);
    expect(powerIn(await editor(), "library.keep")).toMatchObject({ classes: ["researching"], decided: false });
  });
});

/*
 * A HAND ASKS, AND IT NEVER GRANTS. Cass raises a hand for a power put to her,
 * and the founder's inbox, the founder's bell and her own profile all read it
 * back. Dell plays the same class below the rung, and Ezra stands at the rung
 * playing only The Builder: both are refused and neither files anything, which
 * is the ruling's rung half and its class half each failing on its own. The
 * last case has the founder say yes and reads Cass's catalogue again: the power
 * is still closed, because a role carries a power and an inbox row does not,
 * and the answered hand is down.
 */
describe.skipIf(!DB_CONFIGURED)("a raised hand for a power", () => {
  let handId = "";

  /** Every hand for a power, as the founder's inbox lists them. */
  async function inbox(): Promise<any[]> {
    const r = await call("GET", "/api/admin/submissions?type=power-application");
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json;
  }

  it("refuses a stranger, a power the village does not have, and a power not put to the member, filing nothing", async () => {
    const stranger = await call("POST", "/api/powers/library.keep/raise-hand", { token: null, body: {} });
    expect(stranger.status).toBe(401);

    const nothing = await call("POST", "/api/powers/library.burn/raise-hand", { token: cassToken, body: {} });
    expect(nothing.status).toBe(404);
    expect(nothing.json?.error).toBe("power_not_found");

    const below = await call("POST", "/api/powers/library.keep/raise-hand", { token: dellToken, body: {} });
    expect(below.status, JSON.stringify(below.json)).toBe(409);
    expect(below.json?.error).toBe("not_recommended");

    // At the rung, and playing a class the power does not suit.
    const builder = await call("POST", "/api/powers/library.keep/raise-hand", { token: ezraToken, body: {} });
    expect(builder.status, JSON.stringify(builder.json)).toBe(409);
    expect(builder.json?.error).toBe("not_recommended");

    expect(await inbox()).toEqual([]);
  });

  it("files a hand for a power put to the member, rings the founder, and shows it on her profile", async () => {
    const up = await call("POST", "/api/powers/library.keep/raise-hand", {
      token: cassToken,
      body: { note: "I already keep the tool shed ledger." },
    });
    expect(up.status, JSON.stringify(up.json)).toBe(200);
    expect(up.json?.hand?.status).toBe("new");

    const rows = await inbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "power-application", status: "new" });
    expect(rows[0].data).toMatchObject({
      capability: "library.keep",
      powerLabel: "Keep the shared library and its loans",
      suits: ["The Architect"],
      note: "I already keep the tool shed ledger.",
    });
    handId = String(rows[0].id);

    const [bells] = await pool.query<any[]>("SELECT title FROM notifications WHERE dedupe_key LIKE ?", [`power-application:${handId}:%`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(bells.length, "the founder's bell rang").toBeGreaterThan(0);
    expect(String(bells[0].title)).toBe("Cass raised a hand to keep the shared library and its loans");

    const row = rowOf(await catalogueOf(cassToken), "library.keep");
    expect(row.hand).toMatchObject({ status: "new" });
    expect(row.recommended).toBe(true);
  });

  it("refuses a second hand for the same power while the first is up, and names the hand that is", async () => {
    const again = await call("POST", "/api/powers/library.keep/raise-hand", { token: cassToken, body: {} });
    expect(again.status).toBe(409);
    expect(again.json?.error).toBe("hand_already_up");
    expect(again.json?.hand).toMatchObject({ status: "new" });
    expect(await inbox()).toHaveLength(1);
  });

  it("shows the member when somebody opens her hand, and keeps it up", async () => {
    const opened = await call("PUT", `/api/admin/submissions/${handId}/status`, { body: { status: "reviewing" } });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    expect(rowOf(await catalogueOf(cassToken), "library.keep").hand).toMatchObject({ status: "reviewing" });

    const again = await call("POST", "/api/powers/library.keep/raise-hand", { token: cassToken, body: {} });
    expect(again.status).toBe(409);
    expect(again.json?.hand).toMatchObject({ status: "reviewing" });

    // No route takes a hand down (shared/powerHands.ts says why).
    const down = await call("DELETE", "/api/powers/library.keep/raise-hand", { token: cassToken });
    expect(down.status).not.toBe(200);
    expect(await inbox()).toHaveLength(1);
  });

  it("grants nothing when the founder says yes, puts the answered hand down, and tells the member which power", async () => {
    const yes = await call("PUT", `/api/admin/submissions/${handId}/status`, { body: { status: "accepted" } });
    expect(yes.status, JSON.stringify(yes.json)).toBe(200);

    const row = rowOf(await catalogueOf(cassToken), "library.keep");
    expect(row.held, "an inbox row is not a role").toBe(false);
    expect(row.hand, "an answered hand is down").toBeUndefined();
    expect(row.recommended).toBe(true);

    const [told] = await pool.query<any[]>("SELECT title FROM notifications WHERE dedupe_key = ?", [`submission:${handId}:accepted`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(String(told[0]?.title)).toBe("Yes to your offer to keep the shared library and its loans");

    // Still waiting on the appointment, she can ask again, and the new hand is its own row.
    const again = await call("POST", "/api/powers/library.keep/raise-hand", { token: cassToken, body: {} });
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect((await inbox()).map((r) => String(r.status)).sort()).toEqual(["accepted", "new"]);
  });
});
