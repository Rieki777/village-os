/**
 * THE CANVAS PEN, DRIVEN THROUGH THE REAL GATE (0222), against the built server.
 *
 * server/routes/canvas.test.ts proves the routes against a real database with
 * a MODEL of `guardCapability`, because the real one lives inside
 * server/index.ts. This file boots `dist/index.js` and asks the real one, so
 * it proves the three things only the running server can:
 *
 *   1. the routes are registered at all, with no module switched on, because
 *      the canvas is core and no lifecycle switch may take it away;
 *   2. the pen is `story.tell` asked of the ONE gate, in the gate's own order:
 *      an admin before the handover, a role that carries it, and once the
 *      village holds it, its holder and not the admin;
 *   3. the refusals are the route's words: 401 to a visitor, 403 and a
 *      sentence to a member without the pen, 403 and the members-only
 *      sentence to a signed-in account the village has not admitted, and the
 *      gate's own 409 hatch to an admin on a key the village holds.
 *
 * ── FIXTURE, SAID ONCE ─────────────────────────────────────────────────────
 *
 * The village HOLDING `story.tell` is a state this file creates. No village
 * on this platform has handed a power over yet, so a green here says the code
 * is right for that day and nothing about any village having reached it.
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
import { CANVAS_MEMBERS_ONLY, CANVAS_PEN_REFUSAL } from "./routes/canvas";
import { CANVAS_SECTION_DOOR, PUBLIC_LINE_PEN_REFUSAL } from "./routes/canvasPublic";
import { nameRefusal } from "./lib/canvasNames";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[canvas.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, never claimed by hand here.
const PORT = 2500 + (process.pid % 100);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "canvas-admin";
const PASSWORD = "CanvasPen123!";
/** A role this file stands up empty before boot, so the pen can be put on it and taken off. */
const ROLE = "canvas-storytellers";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: Pool;
let founderToken = "";
const people = { pen: { token: "", id: "" }, member: { token: "", id: "" }, stranger: { token: "", id: "" } };

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
): Promise<{ status: number; json: any; text: string }> {
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

const reading = (over: Record<string, unknown> = {}) => ({
  blockId: "purpose",
  level: 2,
  sentence: "Three of us could say why this exists and the answers did not match.",
  ...over,
});

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
      AUTH_TOKEN_SECRET: "canvas-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the canvas route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-canvas-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  // Written before boot so the role cache loads it; every later change to it
  // goes through the admin routes, which keep that cache current.
  await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
    "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?)",
    [ROLE, "Storytellers", "Keeps what the village says about itself.", JSON.stringify([]), 0],
  );
  await bootServer();

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Canvas Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: PASSWORD }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "the founder must hold a session").toBeTruthy();

  people.pen = await register("Wren Halloway", "canvas-wren");
  people.member = await register("Ash Brook", "canvas-ash");
  // Registered and never admitted. The scratch village runs with
  // membership.invite_only off (server/db/testDb.ts), so registering needs no
  // invitation and admits nobody: this is anybody at all on such a fork, and
  // an invited account before its village admits it.
  people.stranger = await register("Rook Talbot", "canvas-rook");
  // The pen and the member are MEMBERS: the village admits them, as a steward
  // does. Registering alone is not membership, and the canvas is members-only.
  for (const who of [people.pen, people.member]) {
    const admitted = await call("POST", `/api/members/${who.id}/super-vouch`, {});
    expect(admitted.status, admitted.text).toBe(200);
    expect(admitted.json?.admitted).toBe(true);
  }
  const seated = await call("POST", `/api/admin/roles/${ROLE}/holders`, { userId: people.pen.id, action: "add" });
  expect(seated.status, seated.text).toBe(200);
}, 300_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("the canvas, through the real gate", () => {
  it("answers an admitted member with every block, with no module switched on", async () => {
    const r = await call("GET", "/api/canvas", undefined, people.member.token);
    expect(r.status, r.text).toBe(200);
    expect(r.json.blocks.map((b: any) => b.id)).toEqual([...CANVAS_BLOCK_IDS]);
    expect(r.json.mayRecord).toBe(false);
  });

  it("refuses a visitor with no session, on both doors", async () => {
    expect((await call("GET", "/api/canvas", undefined, "")).status).toBe(401);
    expect((await call("POST", "/api/canvas/readings", reading(), "")).status).toBe(401);
  });

  it("refuses a member without the pen with 403 and the route's own sentence", async () => {
    const r = await call("POST", "/api/canvas/readings", reading(), people.member.token);
    expect(r.status, r.text).toBe(403);
    expect(r.json).toEqual({ error: CANVAS_PEN_REFUSAL });
  });

  it("refuses a seated member whose role does not carry the pen yet", async () => {
    const r = await call("POST", "/api/canvas/readings", reading(), people.pen.token);
    expect(r.status, r.text).toBe(403);
  });

  it("lets the founder record before the handover, as for the village's other words", async () => {
    const r = await call("POST", "/api/canvas/readings", reading({ level: 2 }));
    expect(r.status, r.text).toBe(201);
    expect(r.json.reading).toMatchObject({ blockId: "purpose", level: 2, word: "Forming", moment: "baseline" });
    expect(r.json.reading.recordedBy.name).toBe("Canvas");
    expect((await call("GET", "/api/canvas")).json.mayRecord).toBe(true);
  });

  it("refuses a bad reading from the pen in the validator's words", async () => {
    const r = await call("POST", "/api/canvas/readings", reading({ level: 6 }));
    expect(r.status).toBe(400);
    expect(String(r.json?.error)).toMatch(/1 \(Absent\) to 5 \(Thriving\)/);
  });

  it("lets a member write once their role carries story.tell", async () => {
    const armed = await call("PUT", `/api/admin/roles/${ROLE}/capabilities`, {
      capabilities: ["story.tell"],
      grantedEscalations: ["story.tell"],
    });
    expect(armed.status, armed.text).toBe(200);
    const r = await call("POST", "/api/canvas/readings", reading({ level: 3, moment: "canvas-moon" }), people.pen.token);
    expect(r.status, r.text).toBe(201);
    expect(r.json.reading.recordedBy).toEqual({ id: people.pen.id, name: "Wren" });
    expect((await call("GET", "/api/canvas", undefined, people.pen.token)).json.mayRecord).toBe(true);
  });

  it("hands the founder the gate's 409 once the village holds the pen, and its holder still writes", async () => {
    const moved = await call("PUT", "/api/admin/capabilities/story.tell/holding", { roleId: ROLE });
    expect(moved.status, moved.text).toBe(200);

    const founder = await call("POST", "/api/canvas/readings", reading({ level: 5 }));
    expect(founder.status, founder.text).toBe(409);
    expect((await call("GET", "/api/canvas")).json.mayRecord).toBe(false);

    const holder = await call("POST", "/api/canvas/readings", reading({ level: 4, moment: "canvas-moon" }), people.pen.token);
    expect(holder.status, holder.text).toBe(201);
  });

  it("keeps every reading, newest first, and the newest is the block's level", async () => {
    const r = await call("GET", "/api/canvas", undefined, people.member.token);
    const purpose = r.json.blocks.find((b: any) => b.id === "purpose");
    expect(purpose.history.map((h: any) => h.level)).toEqual([4, 3, 2]);
    expect(purpose.latest).toMatchObject({ level: 4, word: "Growing", recordedBy: { name: "Wren" } });
    for (const b of r.json.blocks.filter((x: any) => x.id !== "purpose")) expect(b.latest).toBeNull();
  });

  it("refuses a registered account the village has not admitted: 403, the members-only sentence, and no recorder's name", async () => {
    const r = await call("GET", "/api/canvas", undefined, people.stranger.token);
    expect(r.status, r.text).toBe(403);
    expect(r.json).toEqual({ error: CANVAS_MEMBERS_ONLY });
    // The readings above name Wren and the founder; none of it reaches this account.
    for (const leaked of ["Wren", "Canvas", people.pen.id, "Three of us"]) expect(r.text).not.toContain(leaked);
    expect((await call("POST", "/api/canvas/readings", reading(), people.stranger.token)).status).toBe(403);
  });

  /*
   * THE DECISION MATRIX'S DOOR, through the real wiring (plan 2.3, 2026-09-27).
   * server/routes/decisionMatrix.test.ts proves the route with the two holder
   * readers modelled; this asks the ones server/index.ts hands it, after the
   * case above left `story.tell` held by the village with Wren seated.
   */
  it("serves the Decision Matrix to members, from the village's live holdings, naming roles and never people", async () => {
    expect((await call("GET", "/api/canvas/decision-matrix", undefined, "")).status).toBe(401);
    const stranger = await call("GET", "/api/canvas/decision-matrix", undefined, people.stranger.token);
    expect(stranger.status, stranger.text).toBe(403);
    expect(stranger.json).toEqual({ error: CANVAS_MEMBERS_ONLY });

    const r = await call("GET", "/api/canvas/decision-matrix", undefined, people.member.token);
    expect(r.status, r.text).toBe(200);
    const row = (key: string) => r.json.groups.flatMap((g: any) => g.rows).find((x: any) => x.key === key);
    expect(row("power:story.tell").approval.who).toBe("holder");
    expect(row("power:story.tell").approval.text).toContain("with Storytellers");
    expect(row("power:dial.set").approval.who).toBe("admin-panel");
    // A scratch village ships governance off, so no vote can be held on it yet.
    expect(row("vote:village_launch").approval.who).toBe("not-yet");
    expect(r.json.vetoOverrideAvailable).toBe(false);
    for (const person of ["Wren", "Ash", "Canvas Founder", people.pen.id]) expect(r.text).not.toContain(person);
  });

  /*
   * THE CANVAS IN PUBLIC (2026-09-28), through the real gate, the real roster
   * and the real generic content doors. The cases above left `story.tell`
   * held by the village, with Wren seated in the role that carries it.
   * server/routes/canvasPublic.test.ts proves the rest with a modelled gate.
   */
  it("serves every block's public line to a visitor, and gives the write to the pen alone", async () => {
    const r = await call("GET", "/api/canvas/public", undefined, "");
    expect(r.status, r.text).toBe(200);
    expect(r.json.blocks.map((b: any) => b.id)).toEqual([...CANVAS_BLOCK_IDS]);
    const line = { line: "Our storytellers keep the calendar." };
    expect((await call("PUT", "/api/canvas/public/meetings", line, "")).status).toBe(401);
    const member = await call("PUT", "/api/canvas/public/meetings", line, people.member.token);
    expect(member.status, member.text).toBe(403);
    expect(member.json).toEqual({ error: PUBLIC_LINE_PEN_REFUSAL });
    // The village holds the pen now, so the founder meets the gate's own hatch.
    expect((await call("PUT", "/api/canvas/public/meetings", line)).status).toBe(409);
    const pen = await call("PUT", "/api/canvas/public/meetings", line, people.pen.token);
    expect(pen.status, pen.text).toBe(200);
    const read = await call("GET", "/api/canvas/public", undefined, "");
    expect(read.json.blocks.find((b: any) => b.id === "meetings")).toEqual({
      id: "meetings", line: "Our storytellers keep the calendar.", withheld: false,
    });
  });

  it("refuses the pen a line naming a member or the founder, in any case, and stores none of them", async () => {
    for (const [text, quoted] of [
      ["ASH keeps the seed store.", "ASH"],
      ["Ask Canvas Founder about the budget.", "Canvas Founder"],
      ["wren opens every gathering.", "wren"],
    ]) {
      const r = await call("PUT", "/api/canvas/public/roles", { line: text }, people.pen.token);
      expect(r.status, text).toBe(400);
      expect(r.json).toEqual({ error: nameRefusal(quoted) });
    }
    const read = await call("GET", "/api/canvas/public", undefined, "");
    expect(read.json.blocks.find((b: any) => b.id === "roles").line).toBeNull();
    for (const leaked of ["ASH", "Canvas Founder", "wren opens"]) expect(read.text).not.toContain(leaked);
  });

  it("closes the generic content doors to the canvas key, and only to it", async () => {
    // Wren holds story.tell, so the generic door's own gate lets Wren through; the key is what it refuses.
    const sneak = await call("PUT", "/api/admin/content/canvas", { roles: "Ash keeps the seed store." }, people.pen.token);
    expect(sneak.status, sneak.text).toBe(400);
    expect(sneak.json).toEqual({ error: CANVAS_SECTION_DOOR });
    // Control: the same holder, the same door, another key.
    const other = await call("PUT", "/api/admin/content/legal", { jurisdictionOverview: "" }, people.pen.token);
    expect(other.status, other.text).toBe(200);
    // Nothing the refused write carried reached the lines, and the one written through the proper door stands.
    const read = await call("GET", "/api/canvas/public", undefined, "");
    expect(read.text).not.toContain("Ash keeps");
    expect(read.json.blocks.find((b: any) => b.id === "meetings").line).toBe("Our storytellers keep the calendar.");
    // The raw section is not served by the generic read either, to anybody.
    for (const token of ["", founderToken]) {
      const raw = await call("GET", "/api/content/canvas", undefined, token);
      expect(raw.status).toBe(404);
      expect(raw.json).toEqual({ error: CANVAS_SECTION_DOOR });
    }
    // Nor named in the public list of sections, which still names the one the control wrote.
    const names = await call("GET", "/api/content", undefined, "");
    expect(names.json.sections).toContain("legal");
    expect(names.json.sections).not.toContain("canvas");
  });

  it("holds a stored line back from the public once the village admits somebody it names", async () => {
    const written = await call("PUT", "/api/canvas/public/impact", { line: "Juniper trees now shade the upper field." }, people.pen.token);
    expect(written.status, written.text).toBe(200);
    const newcomer = await register("Juniper Vale", "canvas-juniper");
    // Registered and not yet admitted: not one of the village's own, so the line still shows.
    const before = await call("GET", "/api/canvas/public", undefined, "");
    expect(before.json.blocks.find((b: any) => b.id === "impact").line).toBe("Juniper trees now shade the upper field.");

    const admitted = await call("POST", `/api/members/${newcomer.id}/super-vouch`, {});
    expect(admitted.status, admitted.text).toBe(200);
    const after = await call("GET", "/api/canvas/public", undefined, "");
    expect(after.json.blocks.find((b: any) => b.id === "impact")).toEqual({ id: "impact", line: null, withheld: true });
    expect(after.text).not.toContain("Juniper");
    // The other lines are untouched.
    expect(after.json.blocks.find((b: any) => b.id === "meetings").line).toBe("Our storytellers keep the calendar.");
  });

  it("serves the generated Decision Matrix rows to a visitor, from the live holdings, naming roles and never people", async () => {
    const r = await call("GET", "/api/canvas/public/decision-matrix", undefined, "");
    expect(r.status, r.text).toBe(200);
    const row = (key: string) => r.json.groups.flatMap((g: any) => g.rows).find((x: any) => x.key === key);
    expect(row("power:story.tell").approval.text).toContain("with Storytellers");
    for (const person of ["Wren", "Ash", "Canvas Founder", "Juniper", people.pen.id]) expect(r.text).not.toContain(person);
  });
});
