/**
 * THE KEY MOMENTS AND THE AGREEMENTS ROUTE, THROUGH THE BUILT SERVER (plan 4.2
 * and defect 9; Wave 4, 2026-09-28).
 *
 * The lib and route suites prove who hears a moment, the dedupe, and the
 * agreement's closer against models of the host. This file proves what only
 * the running server can: each moment fires from its REAL event, through the
 * route that owns it, with the host's own readers deciding who hears it.
 *
 *   instance claimed      POST /api/admin/bootstrap (the audit event it records)
 *   a circle declared     POST /api/admin/circles
 *   governance on         PUT  /api/admin/modules/governance/lifecycle
 *   the crowdpool on      PUT  /api/admin/modules/crowdpool/lifecycle
 *   a partner accepted    PUT  /api/admin/submissions/:id/status, Work With Us
 *   a Love Letter         the same route, a signed letter that admits its signer
 *   an exit opened        POST /api/profile/request-exit
 *   an objection ruled    POST /api/governance/ballots/:id/objections/:id/rule
 *
 * NOT DRIVEN HERE, and why. A peer village added: the outbound guard refuses
 * every private address by design, so no local peer can answer the handshake
 * (server/lib/canvasRevisit.test.ts matches the route's exact event instead).
 * The Birthing opened: it needs the whole launch journey cleared, which
 * server/launchVote.routes.e2e.test.ts already does, so its moment is asserted
 * there, beside the real propose.
 *
 * Every moment is fire and forget, so each case clears the rows first and
 * then waits for the count it expects and a second read that agrees
 * (`settled` below): a row written late cannot pass, and one written extra
 * cannot hide.
 *
 * Boots the BUILT server: run `pnpm build` first. The cases run IN ORDER and
 * build on each other. Skips loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { Pool } from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { CANVAS_BLOCK_IDS } from "../shared/governanceCanvas";
import { ANYONE_MAY_RAISE, MOMENT_BLOCKS, revisitTitle } from "../shared/canvasRevisit";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[canvasRevisit.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, never claimed by hand here.
const PORT = 2050 + (process.pid % 50);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "revisit-admin";
const PASSWORD = "RevisitMoments123!";
/** Roles this file stands up empty before boot: the care role, and one to carry the canvas pen. */
const CARE_ROLE = "care-keepers";
const PEN_ROLE = "storytellers";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: Pool;
let founderToken = "";
let founderId = "";
const people = {
  care: { token: "", id: "" },
  pen: { token: "", id: "" },
  leaver: { token: "", id: "" },
  stranger: { token: "", id: "" },
};

async function call(method: string, route: string, body?: unknown, token = founderToken) {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
  }, "");
  expect(r.status, `${name} must register: ${r.text}`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

interface RevisitRow {
  title: string;
  body: string;
  link: string;
  actor: string | null;
  emailedAt: unknown;
  key: string;
}

async function revisitRows(userId: string): Promise<RevisitRow[]> {
  const [rows] = await pool.query<any[]>( // module-review-ok: reading the scratch schema this suite provisioned
    "SELECT title, body, link, actor_user_id, emailed_at, dedupe_key FROM notifications " +
      "WHERE user_id = ? AND type = 'canvas_revisit' ORDER BY dedupe_key",
    [userId],
  );
  return rows.map((r) => ({
    title: String(r.title),
    body: String(r.body ?? ""),
    link: String(r.link ?? ""),
    actor: r.actor_user_id ?? null,
    emailedAt: r.emailed_at,
    key: String(r.dedupe_key),
  }));
}

/** Clear every key-moment row, so the next act's own rows are the only ones. */
async function resetRevisits(): Promise<void> {
  await pool.query("DELETE FROM notifications WHERE type = 'canvas_revisit'"); // module-review-ok: resetting the scratch schema between cases
}

/**
 * Wait until this person holds `n` key-moment rows, then read again after a
 * pause and return that second read. A delivery that never comes fails on the
 * count; one that writes more than it should fails on the second read.
 */
async function settled(userId: string, n: number): Promise<RevisitRow[]> {
  const deadline = Date.now() + 20_000;
  let rows = await revisitRows(userId);
  while (rows.length < n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    rows = await revisitRows(userId);
  }
  await new Promise((r) => setTimeout(r, 600));
  return revisitRows(userId);
}

/** Every row a moment wrote this person, in canvas order of the blocks it names. */
const titlesFor = (moment: keyof typeof MOMENT_BLOCKS) => MOMENT_BLOCKS[moment].map((b) => revisitTitle(moment, b)).sort();

/** The same lift the other exit suites use: the restorative block is set before the Birthing (Wave 3a audit). */
async function beforeTheBirthing<T>(fn: () => Promise<T>): Promise<T> {
  const [rows] = await pool.query<any[]>("SELECT value FROM app_config WHERE config_key = 'game-start'"); // module-review-ok: fixture SQL against the S5 scratch schema
  const row = rows[0];
  await pool.query("DELETE FROM app_config WHERE config_key = 'game-start'"); // module-review-ok: fixture SQL against the S5 scratch schema
  try {
    return await fn();
  } finally {
    if (row) {
      await pool.query("INSERT INTO app_config (config_key, value) VALUES ('game-start', ?)", [ // module-review-ok: fixture SQL against the S5 scratch schema
        typeof row.value === "string" ? row.value : JSON.stringify(row.value),
      ]);
    }
  }
}

const serverLogs: string[] = [];

async function bootServer(): Promise<void> {
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb!.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "revisit-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child!.stdout?.on("data", (d) => serverLogs.push(String(d)));
  child!.stderr?.on("data", (d) => serverLogs.push(String(d)));
  await waitForHealth({ base: BASE, logs: serverLogs, child });
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the key moments test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-revisit-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  // Written before boot so the role cache loads them; later changes go through the admin routes.
  for (const [id, name] of [[CARE_ROLE, "Care keepers"], [PEN_ROLE, "Storytellers"]]) {
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?)",
      [id, name, "A role this suite seats people in.", JSON.stringify([]), 0],
    );
  }
  await bootServer();
}, 300_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("the four key moments, each from its real event", () => {
  it("a founder claiming the instance asks the admins about all twelve blocks, and nobody else", async () => {
    const boot = await call("POST", "/api/admin/bootstrap", {
      password: ADMIN, email: `founder-${PORT}@example.test`, name: "Revisit Founder",
    }, "");
    expect(boot.status, boot.text).toBe(200);
    founderId = String(boot.json?.userId ?? "");
    const rows = await settled(founderId, 12);
    expect(rows.map((r) => r.title).sort()).toEqual(titlesFor("collaboration"));
    for (const r of rows) {
      expect(r.actor, "no actor: nobody's act is named").toBeNull();
      expect(r.emailedAt, "never emailed at once").toBeNull();
      expect(r.link).toMatch(/^\/journey-to-launch\?view=canvas#canvas-block-/);
      expect(r.body).not.toContain(ANYONE_MAY_RAISE);
      expect(`${r.title} ${r.body}`).not.toContain("Revisit Founder");
    }

    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: PASSWORD }, "");
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder must hold a session").toBeTruthy();

    people.care = await register("Wren Halloway", "revisit-wren");
    people.pen = await register("Ash Brook", "revisit-ash");
    people.leaver = await register("Fern Oakley", "revisit-fern");
    people.stranger = await register("Rook Talbot", "revisit-rook");
    for (const who of [people.care, people.pen, people.leaver]) {
      const staged = await call("PUT", `/api/admin/players/${who.id}/stage`, { stageId: "member" });
      expect(staged.status, staged.text).toBe(200);
    }
    for (const who of Object.values(people)) expect(await revisitRows(who.id)).toEqual([]);
  });

  it("a circle declared asks again, from the circles route", async () => {
    await resetRevisits();
    const made = await call("POST", "/api/admin/circles", { name: "Water" });
    expect(made.status, made.text).toBe(200);
    expect((await settled(founderId, 12)).map((r) => r.title).sort()).toEqual(titlesFor("collaboration"));
  });

  it("governance reaching members is a funding moment: Before you raise, four blocks, no dates", async () => {
    await resetRevisits();
    const on = await call("PUT", "/api/admin/modules/governance/lifecycle", { lifecycle: "members", examples: false });
    expect(on.status, on.text).toBe(200);
    const rows = await settled(founderId, 4);
    expect(rows.map((r) => r.title).sort()).toEqual(titlesFor("funding"));
    for (const r of rows) expect(`${r.title} ${r.body}`).not.toMatch(/\d/);
  });

  it("the crowdpool switched on is a funding moment too", async () => {
    await resetRevisits();
    const on = await call("PUT", "/api/admin/modules/crowdpool/lifecycle", { lifecycle: "preview", examples: false });
    expect(on.status, on.text).toBe(200);
    expect((await settled(founderId, 4)).map((r) => r.title).sort()).toEqual(titlesFor("funding"));
  });

  it("a Work With Us inquiry accepted asks about Stakeholders, and sends the partner nothing", async () => {
    await resetRevisits();
    const sent = await call("POST", "/api/forms/submit", {
      type: "work-with-us",
      data: { name: "Mistle Partners", email: `mistle-${PORT}@example.test`, offer: "We run a seed library and would like to share it." },
    }, "");
    expect(sent.status, sent.text).toBe(200);
    const accepted = await call("PUT", `/api/admin/submissions/${sent.json.id}/status`, { status: "accepted" });
    expect(accepted.status, accepted.text).toBe(200);
    const rows = await settled(founderId, 1);
    expect(rows.map((r) => r.title)).toEqual(["A new partner arrived. Does our Stakeholders answer still hold?"]);
    expect(rows[0].body).toContain("Nothing was sent to them");
    expect(`${rows[0].title} ${rows[0].body}`).not.toContain("Mistle");
  });

  it("a Love Letter that admits its signer is a partner arriving too", async () => {
    await resetRevisits();
    const letter = await call("POST", "/api/forms/submit", {
      type: "membership-508",
      data: { name: "Rook Talbot", signed: true },
    }, people.stranger.token);
    expect(letter.status, letter.text).toBe(200);
    const accepted = await call("PUT", `/api/admin/submissions/${letter.json.id}/status`, { status: "accepted" });
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.json?.admitted, "the signer was admitted").toBe(true);
    expect((await settled(founderId, 1)).map((r) => r.title)).toEqual([revisitTitle("partners", "stakeholders")]);
  });

  it("an exit opened reaches the care holder alone: no name, no count", async () => {
    const seated = await call("POST", `/api/admin/roles/${CARE_ROLE}/holders`, { userId: people.care.id, action: "add" });
    expect(seated.status, seated.text).toBe(200);
    const policy = await beforeTheBirthing(() =>
      call("PUT", "/api/admin/exit-policy", {
        placeholder: true,
        voluntary: { noticePeriodDays: 30 },
        involuntary: {},
        restorative: { intakeContactRole: CARE_ROLE },
      }),
    );
    expect(policy.status, policy.text).toBe(200);

    await resetRevisits();
    const leaving = await call("POST", "/api/profile/request-exit", { password: PASSWORD, note: "Moving to the coast." }, people.leaver.token);
    expect(leaving.status, leaving.text).toBe(200);
    const rows = await settled(people.care.id, 1);
    expect(rows.map((r) => r.title)).toEqual([revisitTitle("conflict", "conflict")]);
    expect(`${rows[0].title} ${rows[0].body}`).not.toMatch(/Fern|coast|\d/);
    for (const who of [founderId, people.pen.id, people.leaver.id, people.stranger.id]) {
      expect(await revisitRows(who), "nobody but the care holder hears a conflict moment").toEqual([]);
    }
  });

  it("an objection ruled reaches the care holder alone, and never the objection's words", async () => {
    const asked = await call("POST", "/api/governance/advisory", {
      question: "Should the orchard keep one quiet day each week?",
      method: "consent",
    });
    expect(asked.status, asked.text).toBe(200);
    const ballotId = String(asked.json?.ballot?.id ?? "");
    const objected = await call("POST", `/api/governance/ballots/${ballotId}/objections`, {
      text: "The goats need tending every day, so a quiet day cannot include the barn.",
    }, people.pen.token);
    expect(objected.status, objected.text).toBe(200);

    await resetRevisits();
    const ruled = await call("POST", `/api/governance/ballots/${ballotId}/objections/${objected.json.id}/rule`, {
      ruling: "concern",
      note: "Heard: the barn stays tended, and the quiet day is for the commons.",
    });
    expect(ruled.status, ruled.text).toBe(200);
    const rows = await settled(people.care.id, 1);
    expect(rows.map((r) => r.title)).toEqual([revisitTitle("conflict", "conflict")]);
    expect(`${rows[0].title} ${rows[0].body}`).not.toMatch(/goats|barn|orchard/i);
    expect(await revisitRows(founderId)).toEqual([]);
  });
});

describe.skipIf(!DB_CONFIGURED)("who hears it, as the canvas pen moves", () => {
  it("a role carrying story.tell with somebody seated: that holder, and not the admins", async () => {
    const armed = await call("PUT", `/api/admin/roles/${PEN_ROLE}/capabilities`, {
      capabilities: ["story.tell"],
      grantedEscalations: ["story.tell"],
    });
    expect(armed.status, armed.text).toBe(200);
    const seated = await call("POST", `/api/admin/roles/${PEN_ROLE}/holders`, { userId: people.pen.id, action: "add" });
    expect(seated.status, seated.text).toBe(200);

    await resetRevisits();
    expect((await call("POST", "/api/admin/circles", { name: "Orchard" })).status).toBe(200);
    const rows = await settled(people.pen.id, 12);
    expect(rows.map((r) => r.title).sort()).toEqual(titlesFor("collaboration"));
    expect(rows.every((r) => !r.body.includes(ANYONE_MAY_RAISE))).toBe(true);
    expect(await revisitRows(founderId), "the admins stand aside once somebody holds the pen").toEqual([]);
    expect(await revisitRows(people.care.id)).toEqual([]);
  });

  it("the village holding story.tell: every admitted member, told that anyone may raise this", async () => {
    const moved = await call("PUT", "/api/admin/capabilities/story.tell/holding", { roleId: PEN_ROLE });
    expect(moved.status, moved.text).toBe(200);

    await resetRevisits();
    expect((await call("POST", "/api/admin/circles", { name: "Meadow" })).status).toBe(200);
    for (const who of [people.pen, people.care, people.leaver]) {
      const rows = await settled(who.id, 12);
      expect(rows.map((r) => r.title).sort(), who.id).toEqual(titlesFor("collaboration"));
      expect(rows.every((r) => r.body.includes(ANYONE_MAY_RAISE)), who.id).toBe(true);
    }
    // Rook signed a Love Letter and the village admitted him above, so he is a member now too.
    expect((await settled(people.stranger.id, 12)).length).toBe(12);
    // A registered account the village never admitted hears nothing.
    const outsider = await register("Linden Rowe", "revisit-linden");
    expect(await revisitRows(outsider.id)).toEqual([]);
  });
});

describe.skipIf(!DB_CONFIGURED)("the agreements route, end to end (defect 9)", () => {
  let agreementId = "";
  let ballotId = "";
  const reviewAt = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);

  it("is a kind of decision the wizard can now take to a vote", async () => {
    const w = await call("GET", "/api/governance/wizard");
    expect(w.status, w.text).toBe(200);
    expect(w.json.conductable).toContain("agreement");
    expect(w.json.advisory).not.toContain("agreement");
  });

  it("opens the village's vote on the wizard's own body", async () => {
    // Exactly what wizardConfig.ts's publish.body sends for this type.
    const r = await call("POST", "/api/governance/agreements", {
      title: "Quiet hours in the common house",
      body: "Between ten at night and seven in the morning the common house is quiet. Anyone can name a night as an exception at the weekly circle.",
      domain: "space_land",
      circleId: "water",
      reviewAt,
    });
    expect(r.status, r.text).toBe(201);
    agreementId = String(r.json.id);
    ballotId = String(r.json.ballot.id);
    expect(r.json.ballot.subjectType).toBe("agreement");
    const list = await call("GET", "/api/governance/agreements", undefined, people.care.token);
    expect(list.status, list.text).toBe(200);
    expect(list.json.agreements.find((a: any) => a.id === agreementId)).toMatchObject({ status: "voting", reviewAt, circleName: "Water" });
  });

  it("carries, lands, and reads back as an active agreement with its review date", async () => {
    const [roll] = await pool.query<any[]>("SELECT user_id FROM ballot_electorate WHERE ballot_id = ?", [ballotId]); // module-review-ok: reading the scratch schema this suite provisioned
    const tokens: Record<string, string> = {
      [founderId]: founderToken,
      [people.care.id]: people.care.token,
      [people.pen.id]: people.pen.token,
      [people.leaver.id]: people.leaver.token,
      [people.stranger.id]: people.stranger.token,
    };
    for (const r of roll) {
      const t = tokens[String(r.user_id)];
      expect(t, `a token for ${r.user_id}`).toBeTruthy();
      const v = await call("POST", `/api/governance/ballots/${ballotId}/vote`, { choice: "yes" }, t);
      expect(v.status, v.text).toBe(200);
    }
    const closed = await call("POST", `/api/governance/ballots/${ballotId}/close`, { outcomeNote: "Everyone on the roll said yes." });
    expect(closed.status, closed.text).toBe(200);
    // Not yet: a carried agreement lands after the steward's window, like every Game change.
    const waiting = await call("GET", "/api/governance/agreements", undefined, people.care.token);
    expect(waiting.json.agreements.find((a: any) => a.id === agreementId).status).toBe("voting");

    await pool.query( // module-review-ok: fixture SQL against the suite's own scratch schema: the window running out
      "UPDATE ballots SET lands_at = DATE_SUB(NOW(), INTERVAL 1 HOUR), veto_closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ? AND lands_at IS NOT NULL",
      [ballotId],
    );
    const landed = await call("POST", "/api/admin/governance/land-due", {});
    expect(landed.status, landed.text).toBe(200);

    const after = await call("GET", "/api/governance/agreements", undefined, people.care.token);
    const a = after.json.agreements.find((x: any) => x.id === agreementId);
    expect(a).toMatchObject({ status: "active", reviewAt, domain: "space_land", circleId: "water" });
    expect(a.decidedAt).toBeTruthy();
    expect(after.json.agreements[0].id, "an active agreement reads first").toBe(agreementId);
  });

  it("is read by members only", async () => {
    const outsider = await register("Sorrel Finch", "revisit-sorrel");
    expect((await call("GET", "/api/governance/agreements", undefined, outsider.token)).status).toBe(403);
    expect((await call("GET", "/api/governance/agreements", undefined, "")).status).toBe(401);
  });
});

describe.skipIf(!DB_CONFIGURED)("the canvas moon", () => {
  it("names the next new moon's blocks to a member, and offers a draft gathering to the calendar's manager", async () => {
    const r = await call("GET", "/api/canvas/moon", undefined, people.care.token);
    expect(r.status, r.text).toBe(200);
    expect(r.json.next.blocks.length).toBeGreaterThan(0);
    for (const b of r.json.next.blocks) expect(CANVAS_BLOCK_IDS).toContain(b.id);
    expect(r.json.mayOffer).toBe(false);
  });
});
