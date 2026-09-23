/**
 * THE HANDOVER, DRIVEN (0098, lane G-B), against the built server.
 *
 * R54, the founder's ruling: "these villages are meant to be taken over by
 * the electorate to run the game and put the admins out of a full time job."
 * Before this lane, `if (ctx.isAdmin) return true;` was the first line of the
 * one gate, so a power could never leave the admin panel and every claim that
 * a village held something was decoration over a short-circuit.
 *
 * Four things become true, and each one is driven here rather than asserted
 * about:
 *
 *  1. A village moves a named power onto a role, and the holder ACTS with a
 *     member token and no admin anywhere in the request.
 *  2. A founder seated as a steward reaching past a village-held power (the
 *     only person Rye's ruling of 2026-09-21 lets through) leaves a record on
 *     the PUBLIC pulse, which is the surface the village itself reads. An admin
 *     trail nobody but admins can read is a receipt and not a witness.
 *  3. Editing a badge definition that holders answer to refuses to land
 *     silently and tells the holders.
 *  4. A member reads which powers exist and who holds each, in sentences,
 *     with no number in the payload.
 *
 * Plus the two things that make it safe to ship: the break-glass exists in
 * the same commit as the gate change, and `dial.set` refuses a founder-ring
 * key to anybody who is not acting as the operator.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[handover.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 14600 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "handover-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";

// Kira is a plain member who will be seated in the Steward Circle and will
// end up moderating the village's queues with no admin password anywhere.
let kiraToken = "";
let kiraId = "";
// Otto is a member who holds nothing. He is the control.
let ottoToken = "";
let ottoId = "";

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call(
    "POST",
    "/api/auth/register",
    { name, email: `${slug}-${PORT}@example.test`, password: "HandoverTest123!", paths: ["resident"] },
    "",
  );
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** Every line the VILLAGE can read, newest first. Audience public, examples out. */
async function publicPulse(): Promise<string[]> {
  const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT text FROM health_events WHERE audience = 'public' AND is_example = 0 ORDER BY at DESC, id DESC LIMIT 50",
  );
  return rows.map((r) => String(r.text));
}

async function adminTrail(): Promise<string[]> {
  const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT text FROM health_events WHERE audience = 'admin' ORDER BY at DESC, id DESC LIMIT 50",
  );
  return rows.map((r) => String(r.text));
}

async function notificationsFor(userId: string): Promise<Array<{ type: string; title: string; body: string }>> {
  const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT type, title, body FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC",
    [userId],
  );
  return rows.map((r) => ({ type: String(r.type), title: String(r.title), body: String(r.body ?? "") }));
}

/** The server's own output, kept across restarts so a failed boot can print it. */
const serverLogs: string[] = [];

async function bootServer(): Promise<void> {
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
      DATABASE_URL: testDb!.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "handover-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child!.stdout?.on("data", (d) => serverLogs.push(String(d)));
  child!.stderr?.on("data", (d) => serverLogs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs: serverLogs, child });
}

/**
 * RYE, 2026-09-21: only a founder seated as a steward with the veto may break
 * the glass (`BREAK_GLASS_SEAT` in shared/capabilities.ts). This suite drives
 * the glass on purpose, so its founder sits in that seat. A seat carrying the
 * veto is filled by a role_seat ballot and by no admin route, so it is written
 * underneath the role cache and the server comes back up to read it.
 * `server/founderOverride.routes.e2e.test.ts` drives everybody the glass
 * refuses.
 */
async function seatFounderAsSteward(founderId: string): Promise<void> {
  child?.kill();
  await new Promise((r) => setTimeout(r, 500));
  await pool.query( // module-review-ok: fixture SQL standing in for a carried role_seat ballot, against the scratch schema
    "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?)",
    ["steward", "Steward", "Can stop a carried decision inside its window.", JSON.stringify(["steward.veto"]), 0],
  );
  await pool.query( // module-review-ok: fixture SQL standing in for a carried role_seat ballot, against the scratch schema
    "INSERT INTO role_holders (id, role_id, user_id, granted_by, term_ends_at) VALUES (?,?,?,?,?)",
    [`rh-steward-${founderId}`.slice(0, 64), "steward", founderId, "bal-role-seat", new Date(Date.now() + 365 * 864e5)],
  );
  await bootServer();
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the handover route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-handover-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await bootServer();

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Handover Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "HandoverTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  const founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const mods = await call("GET", "/api/admin/modules");
  for (const m of mods.json?.modules ?? []) {
    if (m.core) continue;
    await call("PUT", `/api/admin/modules/${m.id}/lifecycle`, { lifecycle: "public" });
  }

  const kira = await register("Kira Vance", "kira");
  kiraToken = kira.token; kiraId = kira.id;
  const otto = await register("Otto Brand", "otto");
  ottoToken = otto.token; ottoId = otto.id;
  for (const id of [kiraId, ottoId]) {
    await call("PUT", `/api/admin/players/${id}/stage`, { stageId: "member" });
  }

  // The founder breaks the glass below, so the founder sits where the
  // ruling says the glass is kept. See seatFounderAsSteward.
  await seatFounderAsSteward(founderId);
}, 180_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("harm metric 1: a power moves, and the holder acts with no admin password", () => {
  it("starts with the village holding nothing, and the admin passing", async () => {
    const holding = await call("GET", "/api/admin/capabilities/holding");
    expect(holding.status).toBe(200);
    expect(holding.json.powers.every((p: any) => p.heldBy === null)).toBe(true);
    // The count the handover tab warns from (Rye, 2026-09-14): a power may go
    // to a role nobody holds, and the panel says so from this served number.
    const steward = holding.json.roles.find((r: any) => r.id === "steward-circle");
    expect(steward?.holderCount, "nobody is seated in the Steward Circle yet").toBe(0);
  });

  it("refuses to hand a power to a role that could not act on it", async () => {
    // The one state worth refusing outright: the admin stops passing, the
    // named holder never passed either, and the power belongs to nobody.
    const r = await call("PUT", "/api/admin/capabilities/intake.moderate/holding", { roleId: "steward-circle" });
    expect(r.status).toBe(409);
    expect(String(r.json.error)).toContain("does not carry intake.moderate");
  });

  it("refuses to hand over a key that may never move", async () => {
    const r = await call("PUT", "/api/admin/capabilities/message.send/holding", { roleId: "steward-circle" });
    expect(r.status).toBe(409);
    expect(String(r.json.error)).toContain("not a power that can move");
  });

  it("gives the Steward Circle the power, and asks first because nothing else grants it", async () => {
    const before = await call("GET", "/api/roles", undefined, "");
    const steward = (before.json ?? []).find((r: any) => r.id === "steward-circle");
    expect(steward, "the seeded Steward Circle must exist").toBeTruthy();
    const next = [...(steward.capabilities ?? []), "intake.moderate"];

    // Silence is refusal: no answer to the escalation and nothing lands.
    const asked = await call("PUT", "/api/admin/roles/steward-circle/capabilities", { capabilities: next });
    expect(asked.status).toBe(409);
    expect(asked.json.requiresConfirmation).toBe(true);
    // ONE escalation and one only: the power being added. Everything the
    // role already carries is the status quo, and listing it here would mean
    // "silence is refusal" strips the role's existing powers on every edit.
    expect(asked.json.escalations.map((e: any) => e.capability)).toEqual(["intake.moderate"]);
    // The sentence says the consequence and never the key.
    expect(String(asked.json.escalations[0].consequence)).toContain("queues");
    // The refusal names no control. It used to say "Tick the ones you mean",
    // which the only client showed in an OK/Cancel box with nothing to tick.
    expect(String(asked.json.error)).toContain("nothing has changed yet");
    expect(String(asked.json.error)).not.toMatch(/\btick\b/i);

    const after = await call("GET", "/api/roles", undefined, "");
    expect((after.json ?? []).find((r: any) => r.id === "steward-circle").capabilities)
      .not.toContain("intake.moderate");

    const done = await call("PUT", "/api/admin/roles/steward-circle/capabilities", {
      capabilities: next, grantedEscalations: ["intake.moderate"],
    });
    expect(done.status).toBe(200);
    expect(done.json.added).toEqual(["intake.moderate"]);
  });

  it("seats Kira, hands the power to the village, and Kira works the queue with a member token", async () => {
    const seated = await call("POST", "/api/admin/roles/steward-circle/holders", { userId: kiraId, action: "add" });
    expect(seated.status, seated.text).toBe(200);
    const counted = await call("GET", "/api/admin/capabilities/holding");
    expect(counted.json.roles.find((r: any) => r.id === "steward-circle")?.holderCount, "Kira now holds it").toBe(1);

    const moved = await call("PUT", "/api/admin/capabilities/intake.moderate/holding", { roleId: "steward-circle" });
    expect(moved.status, moved.text).toBe(200);

    // A submission for somebody to act on.
    const sub = await call("POST", "/api/forms/submit", {
      type: "contact", data: { name: "A Neighbour", message: "Hello" },
    }, "");
    expect(sub.status).toBe(200);
    const queue = await call("GET", "/api/admin/submissions");
    const id = String((queue.json?.[0] ?? queue.json?.submissions?.[0])?.id ?? "");
    expect(id, "the queue must carry the submission").toBeTruthy();

    // THE MOMENT THIS LANE EXISTS FOR. A member token. No admin password in
    // the request, no admin session, no founder role on the actor.
    const acted = await call("PUT", `/api/admin/submissions/${id}/status`, { status: "reviewing" }, kiraToken);
    expect(acted.status, acted.text).toBe(200);
  });

  it("still refuses a member who holds nothing", async () => {
    const queue = await call("GET", "/api/admin/submissions");
    const id = String((queue.json?.[0] ?? queue.json?.submissions?.[0])?.id ?? "");
    const refused = await call("PUT", `/api/admin/submissions/${id}/status`, { status: "declined" }, ottoToken);
    expect(refused.status).toBe(401);
  });
});

describe.skipIf(!DB_CONFIGURED)("harm metric 2: a founder seated as a steward reaching past it leaves a record the village can read", () => {
  it("refuses the admin first, and the refusal says how to go through anyway", async () => {
    // THE ESCAPE HATCH IS DISCOVERABLE. An operator who meets a bare 401 on
    // their own panel starts looking for a database to edit.
    const queue = await call("GET", "/api/admin/submissions");
    const id = String((queue.json?.[0] ?? queue.json?.submissions?.[0])?.id ?? "");
    const blocked = await call("PUT", `/api/admin/submissions/${id}/status`, { status: "declined" });
    expect(blocked.status).toBe(409);
    expect(blocked.json.requiresOverride).toBe(true);
    expect(String(blocked.json.error)).toContain("Steward Circle");
    expect(String(blocked.json.error)).toContain("override");
  });

  it("goes through with the break-glass, and the village sees it on its own pulse", async () => {
    const queue = await call("GET", "/api/admin/submissions");
    const id = String((queue.json?.[0] ?? queue.json?.submissions?.[0])?.id ?? "");
    const forced = await call("PUT", `/api/admin/submissions/${id}/status`, { status: "declined", override: true });
    expect(forced.status, forced.text).toBe(200);

    const pulse = await publicPulse();
    const line = pulse.find((t) => t.includes("acted on a power this village holds"));
    expect(line, `no public line in:\n${pulse.slice(0, 10).join("\n")}`).toBeTruthy();
    expect(line).toContain("Handover Founder");
    expect(line).toContain("Steward Circle");

    // And the admin trail carries the machine-readable half.
    expect((await adminTrail()).some((t) => t.startsWith("capability:override:intake.moderate"))).toBe(true);
  });

  it("tells the person who actually holds it", async () => {
    const mine = await notificationsFor(kiraId);
    const told = mine.find((n) => n.type === "capability_override");
    expect(told, `no notification in ${JSON.stringify(mine)}`).toBeTruthy();
    expect(told!.body).toContain("Handover Founder");
  });

  it("takes the header as a hatch too, for the routes that carry no body", async () => {
    const queue = await call("GET", "/api/admin/submissions");
    const id = String((queue.json?.[0] ?? queue.json?.submissions?.[0])?.id ?? "");
    const viaHeader = await call(
      "PUT", `/api/admin/submissions/${id}/status`, { status: "reviewing" },
      founderToken, { "x-capability-override": "true" },
    );
    expect(viaHeader.status, viaHeader.text).toBe(200);
  });

  it("hands the power back, and says so on the same public surface", async () => {
    const back = await call("DELETE", "/api/admin/capabilities/intake.moderate/holding");
    expect(back.status).toBe(200);
    expect((await publicPulse()).some((t) => t.includes("This went back to the admin panel"))).toBe(true);
    // And the admin passes again with no ceremony at all.
    const queue = await call("GET", "/api/admin/submissions");
    const id = String((queue.json?.[0] ?? queue.json?.submissions?.[0])?.id ?? "");
    expect((await call("PUT", `/api/admin/submissions/${id}/status`, { status: "accepted" })).status).toBe(200);
  });
});

describe.skipIf(!DB_CONFIGURED)("harm metric 3: editing a badge definition tells its holders", () => {
  let badgeId = "";

  it("creates a badge and gives it to Otto", async () => {
    const made = await call("POST", "/api/admin/badges", {
      name: `Keeper ${PORT}`, kind: "granted", capabilities: ["forum.post"],
    });
    expect(made.status, made.text).toBe(200);
    badgeId = String(made.json.badge.id);
    expect((await call("POST", `/api/admin/badges/${badgeId}/award`, { userId: ottoId })).status).toBe(200);
  });

  it("refuses to rewrite what it grants in silence, and names the consequence", async () => {
    const quiet = await call("PUT", `/api/admin/badges/${badgeId}`, {
      capabilities: ["forum.post", "library.keep"],
    });
    expect(quiet.status).toBe(409);
    expect(quiet.json.requiresConfirmation).toBe(true);
    expect(quiet.json.gained).toEqual(["library.keep"]);
    // The sentence says what a holder could DO and never the key.
    expect(String(quiet.json.error)).toContain("keep the shared library");
    expect(String(quiet.json.error)).toContain("They will be told");

    // Nothing landed.
    const [[row]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT capabilities FROM badges WHERE id = ?", [badgeId],
    );
    expect(JSON.stringify(row.capabilities)).not.toContain("library.keep");
  });

  it("lands on the second call, and the person it happened to hears about it", async () => {
    const done = await call("PUT", `/api/admin/badges/${badgeId}`, {
      capabilities: ["forum.post", "library.keep"], confirmCapabilityChange: true,
    });
    expect(done.status, done.text).toBe(200);

    const told = (await notificationsFor(ottoId)).find((n) => n.type === "badge_definition_changed");
    expect(told, "the holder must be told").toBeTruthy();
    expect(told!.body).toContain("keep the shared library");

    expect((await adminTrail()).some((t) => t.startsWith(`badge:capabilities-changed:${badgeId}`))).toBe(true);
  });

  it("says nothing at all when the edit moves no power", async () => {
    const before = (await notificationsFor(ottoId)).length;
    const rename = await call("PUT", `/api/admin/badges/${badgeId}`, { description: "A tidier sentence" });
    expect(rename.status).toBe(200);
    expect((await notificationsFor(ottoId)).length).toBe(before);
  });
});

describe.skipIf(!DB_CONFIGURED)("harm metric 4: a member reads the powers, in sentences, with no number", () => {
  it("refuses a stranger and serves a member", async () => {
    expect((await call("GET", "/api/village/powers", undefined, "")).status).toBe(401);
    const mine = await call("GET", "/api/village/powers", undefined, ottoToken);
    expect(mine.status).toBe(200);
    expect(Array.isArray(mine.json.powers)).toBe(true);
    expect(mine.json.powers.length).toBeGreaterThan(0);
  });

  it("says what each power opens, in a sentence, and never as a key", async () => {
    const { json } = await call("GET", "/api/village/powers", undefined, ottoToken);
    for (const p of json.powers) {
      expect(p.title.length, p.capability).toBeGreaterThan(3);
      expect(p.consequence.length, p.capability).toBeGreaterThan(10);
      expect(p.consequence, p.capability).not.toBe(p.capability);
    }
  });

  it("carries no count, total or fraction anywhere in the payload", async () => {
    // R55. The client cannot render a scorecard off a payload that has no
    // denominator in it, and the surest way to keep one off the page is to
    // never put one on the wire.
    const { json } = await call("GET", "/api/village/powers", undefined, ottoToken);
    expect(Object.keys(json)).toEqual(["powers"]);
    const serialized = JSON.stringify(json.powers.map((p: any) => ({ ...p, heldBy: p.heldBy ? "..." : null })));
    expect(serialized).not.toMatch(/"(total|count|held|remaining|percent|progress)"\s*:/i);
  });

  it("renders in the same order whether the village holds a power or not", async () => {
    const cold = await call("GET", "/api/village/powers", undefined, ottoToken);
    const order = cold.json.powers.map((p: any) => p.capability);

    await call("PUT", "/api/admin/capabilities/intake.moderate/holding", { roleId: "steward-circle" });
    const warm = await call("GET", "/api/village/powers", undefined, ottoToken);
    expect(warm.json.powers.map((p: any) => p.capability)).toEqual(order);

    // And the holder is named as a role with the people sitting in it.
    const held = warm.json.powers.find((p: any) => p.capability === "intake.moderate");
    expect(held.heldBy.roleName).toBe("Steward Circle");
    expect(held.heldBy.people).toContain("Kira Vance");
    expect(held.heldBy.byBallot).toBe(false);
  });
});

describe.skipIf(!DB_CONFIGURED)("the ring becomes a floor as well as a ceiling", () => {
  it("lets an admin set a founder-ring dial, because a fork's operator has to", async () => {
    const r = await call("PUT", "/api/admin/variables/auth.session_days", { value: "21" });
    expect(r.status, r.text).toBe(200);
  });

  it("refuses a founder-ring dial to a holder of dial.set, exactly as the proposal path does", async () => {
    const before = await call("GET", "/api/roles", undefined, "");
    const steward = (before.json ?? []).find((r: any) => r.id === "steward-circle");
    await call("PUT", "/api/admin/roles/steward-circle/capabilities", {
      capabilities: [...(steward.capabilities ?? []), "dial.set"],
      grantedEscalations: ["dial.set"],
    });

    const founderRing = await call("PUT", "/api/admin/variables/auth.session_days", { value: "30" }, kiraToken);
    expect(founderRing.status).toBe(403);
    expect(String(founderRing.json.error)).toContain("not one the village governs");

    const openRing = await call("PUT", "/api/admin/variables/gratitude.base_budget", { value: "42" }, kiraToken);
    expect(openRing.status, openRing.text).toBe(200);
  });

  it("refuses a member who holds nothing, on either ring", async () => {
    expect((await call("PUT", "/api/admin/variables/gratitude.base_budget", { value: "7" }, ottoToken)).status).toBe(401);
  });
});
