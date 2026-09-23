/**
 * THE WAY BACK IS THE VILLAGE'S, AND THE VETO COMES FROM A SEAT.
 *
 * Two rulings of Rye's, 2026-09-23, driven against the built server. Both are
 * about the same hole: a power the village holds, and an administrator with a
 * way round it that nothing measured.
 *
 * ── 1. HANDING A POWER BACK NEEDS A VILLAGE VOTE ─────────────────────────
 *
 * `DELETE /api/admin/capabilities/:capability/holding` asked `isAdmin` and
 * nothing else. So the gate's whole 0098 apparatus — an admin who stops
 * passing by being an admin, a break-glass narrowed on 2026-09-21 to a
 * founder seated as a steward with the veto, a public line every time
 * somebody reaches past the village — could be stepped around in one request
 * by the same administrator it refused: take the power back to the panel,
 * then act as an ordinary admin. The gate's own header named that door and
 * said the ruling had not reached it. It has now: the route asks the gate for
 * the key being returned and carries on only on `reachedPastVillage`.
 *
 * The machinery the village uses instead was already built. `power_return` is
 * a subject type with a closer and a route
 * (`POST /api/governance/power-returns`), and `server/powerRunway.routes.e2e`
 * drives the carried path end to end with no admin in the chain. Nothing here
 * re-drives it; what is here is the REFUSAL on the other side of the same
 * act, the one exception, and the vote that does not carry.
 *
 * ── 2. A BADGE MAY NOT GRANT `steward.veto` ──────────────────────────────
 *
 * `server/lib/roleGrants.ts` claimed the key was "UNGRANTABLE and UNREMOVABLE
 * by any admin route, admin path included, in both directions". It fenced two
 * ROLES routes. `POST /api/admin/badges` took `capabilities: ["steward.veto"]`,
 * and step 4 of the gate answered yes for it, so an administrator could mint a
 * badge, award it to themselves and veto a carried decision. Rye: seats only,
 * "so that an admin cannot mint a badge and give themselves a veto".
 *
 * ── WHO IS IN THIS VILLAGE ───────────────────────────────────────────────
 *
 *   Ada    founder, seated as a steward with the veto AND in the circle that
 *          holds the power. The only person who gets through, and only with
 *          the glass in their hand.
 *   Fin    an ordinary administrator. Refused with the glass and without it.
 *   Kira   a member, seated in the holding circle and in the steward seat.
 *          She acts on the power, and her veto comes from the seat.
 *   Wren   a co-creator, so she can open a ballot as a member.
 *   Otto   a member carrying a hand-written badge granting the veto.
 *
 * `dial.set` is the power, for the reason the founder-override suite gives:
 * it is movable, the Steward Circle can carry it, and
 * `PUT /api/admin/variables/:key` is gated on it.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first or you are testing stale code. The cases run IN ORDER:
 * one power is held, defended, and handed back. Run the whole file, never a
 * `-t` slice. Skips loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { BREAK_GLASS_WAY_THROUGH } from "../shared/capabilities";
import { RETURN_NEEDS_A_VOTE } from "./lib/capabilityHolding";
import { STEWARD_SEAT_REFUSAL } from "./lib/roleGrants";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[handbackVote.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written surveys this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 3000 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "handback-vote-admin";
const PASSWORD = "HandbackVote123!";
/** The power, held by the Steward Circle for the whole file until it goes back. */
const POWER = "dial.set";
/** An open-ring dial, so nothing but the capability decides the answer. */
const DIAL = "gratitude.base_budget";
const GLASS = { "x-capability-override": "true" };
const DAY = 864e5;

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

interface Person { id: string; token: string }
const people: Record<"ada" | "fin" | "kira" | "wren" | "otto", Person> = {
  ada: { id: "", token: "" },
  fin: { id: "", token: "" },
  kira: { id: "", token: "" },
  wren: { id: "", token: "" },
  otto: { id: "", token: "" },
};

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = people.ada.token,
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

async function boot(): Promise<void> {
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: on its first tick every job with no
      // scheduled_jobs row is due, and this suite asserts on what ran.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb!.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "handback-vote-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  await waitForHealth({ base: BASE, logs, child });
}

async function stop(): Promise<void> {
  child?.kill();
  child = undefined;
  await new Promise((r) => setTimeout(r, 500));
}

async function register(name: string, slug: string): Promise<Person> {
  const r = await call(
    "POST",
    "/api/auth/register",
    { name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
    "",
  );
  expect(r.status, `${name} must register: ${r.text}`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** The holding table exactly as it stands, read raw and never off a payload. */
const holdingRows = async (): Promise<Array<{ capability: string; role: string }>> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT capability, holder_role_id FROM capability_holding ORDER BY capability",
  );
  return rows.map((r) => ({ capability: String(r.capability), role: String(r.holder_role_id) }));
};

/** Every line the VILLAGE can read. Audience public, examples out. */
const publicPulse = async (): Promise<string[]> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT text FROM health_events WHERE audience = 'public' AND is_example = 0 ORDER BY at DESC, id DESC LIMIT 50",
  );
  return rows.map((r) => String(r.text));
};

/** Admin-trail rows whose text starts with this, counted whole. */
const trailCount = async (prefix: string): Promise<number> => {
  const [[row]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT COUNT(*) AS n FROM health_events WHERE audience = 'admin' AND LEFT(text, ?) = ?",
    [prefix.length, prefix],
  );
  return Number(row?.n ?? 0);
};

/** Lines the VILLAGE reads about somebody reaching past a power it holds. */
const reachCount = async (): Promise<number> => {
  const [[row]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT COUNT(*) AS n FROM health_events WHERE audience = 'public' AND is_example = 0 " +
      "AND text LIKE '%acted on a power this village holds%'",
  );
  return Number(row?.n ?? 0);
};

/** What the gate says about one person and one key, from the explainer route. */
async function verdict(userId: string, capability: string): Promise<{ held: boolean; source: string }> {
  const r = await call("GET", `/api/admin/members/${userId}/capabilities`);
  expect(r.status, r.text).toBe(200);
  const row = (r.json?.capabilities ?? []).find((c: any) => c.capability === capability);
  expect(row, `${capability} must be in the explainer: ${r.text.slice(0, 200)}`).toBeTruthy();
  return { held: !!row.held, source: String(row.source) };
}

const takeBack = (headers: Record<string, string> = {}, token = people.ada.token) =>
  call("DELETE", `/api/admin/capabilities/${POWER}/holding`, undefined, token, headers);

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the hand-back vote route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-handback-vote-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  await boot();

  const bootstrap = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `ada-${PORT}@example.test`, name: "Ada Founder",
  }, "");
  const claim = decodeURIComponent(String(bootstrap.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: PASSWORD }, "");
  people.ada = { token: String(setPw.json?.token ?? ""), id: String(setPw.json?.user?.id ?? "") };
  expect(people.ada.token, "the founder must hold a session").toBeTruthy();

  people.fin = await register("Fin Admin", "fin");
  people.kira = await register("Kira Keeper", "kira");
  people.wren = await register("Wren Opener", "wren");
  people.otto = await register("Otto Member", "otto");
  // Ada is in the list because the Steward Circle asks for a minimum stage and
  // a bootstrapped founder starts below it: seating her would be refused.
  for (const p of [people.ada, people.fin, people.kira, people.otto]) {
    const r = await call("PUT", `/api/admin/players/${p.id}/stage`, { stageId: "member" });
    expect(r.status, r.text).toBe(200);
  }
  // Wren reaches co-creator, so she holds `proposal.open` as a MEMBER and the
  // return ballot below has nobody's permission behind it but her own.
  const wrenStage = await call("PUT", `/api/admin/players/${people.wren.id}/stage`, { stageId: "co-creator" });
  expect(wrenStage.status, wrenStage.text).toBe(200);

  const finAdmin = await call("PUT", `/api/admin/users/${people.fin.id}/role`, { role: "admin" });
  expect(finAdmin.status, `Fin becomes an admin: ${finAdmin.text}`).toBe(200);

  // Badges on, so a badge row reaches the gate at all.
  const badgesOn = await call("PUT", "/api/admin/modules/badges/lifecycle", { lifecycle: "public", examples: false });
  expect(badgesOn.status, badgesOn.text).toBe(200);

  const govOn = await call("PUT", "/api/admin/modules/governance/lifecycle", { lifecycle: "public", examples: false });
  expect(govOn.status, govOn.text).toBe(200);

  // The village takes `dial.set` onto the Steward Circle, where Kira and Ada sit.
  const roles = await call("GET", "/api/roles", undefined, "");
  const circle = (roles.json ?? []).find((r: any) => r.id === "steward-circle");
  const armed = await call("PUT", "/api/admin/roles/steward-circle/capabilities", {
    capabilities: [...(circle?.capabilities ?? []), POWER], grantedEscalations: [POWER],
  });
  expect(armed.status, armed.text).toBe(200);
  for (const p of [people.kira, people.ada]) {
    const seated = await call("POST", "/api/admin/roles/steward-circle/holders", { userId: p.id, action: "add" });
    expect(seated.status, seated.text).toBe(200);
  }
  const moved = await call("PUT", `/api/admin/capabilities/${POWER}/holding`, { roleId: "steward-circle" });
  expect(moved.status, moved.text).toBe(200);

  /*
   * THE STEWARD'S SEATS, as a carried `role_seat` ballot leaves them. No admin
   * route writes these: `stewardSeatRefusal` refuses a role carrying the veto
   * in both directions, and roles and holdings are served from a cache built
   * at boot, so they go in underneath and the process comes back up to read
   * them. That is the method server/stewardSeat.routes.e2e.test.ts argues for.
   */
  await stop();
  await pool.query( // module-review-ok: fixture SQL standing in for a carried role_seat ballot, against the scratch schema
    "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?)",
    ["steward", "Steward", "Can stop a carried decision inside its window.", JSON.stringify(["steward.veto"]), 0],
  );
  const ahead = new Date(Date.now() + 30 * DAY);
  for (const p of [people.ada, people.kira]) {
    await pool.query( // module-review-ok: fixture SQL standing in for a carried role_seat ballot, against the scratch schema
      "INSERT INTO role_holders (id, role_id, user_id, granted_by, term_ends_at) VALUES (?,?,?,?,?)",
      [`rh-steward-${p.id}`.slice(0, 64), "steward", p.id, "bal-role-seat", ahead],
    );
  }
  await boot();
}, 300_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("the premise, measured", () => {
  it("the village holds the power through the Steward Circle", async () => {
    expect(await holdingRows()).toEqual([{ capability: POWER, role: "steward-circle" }]);
  });

  it("Kira acts on it with a member token, and the seat carries her veto", async () => {
    const set = await call("PUT", `/api/admin/variables/${DIAL}`, { value: "41" }, people.kira.token);
    expect(set.status, set.text).toBe(200);
    expect(await verdict(people.kira.id, "steward.veto")).toEqual({ held: true, source: "role" });
  });

  it("an ordinary administrator is already refused the power itself", async () => {
    const set = await call("PUT", `/api/admin/variables/${DIAL}`, { value: "42" }, people.fin.token);
    expect(set.status, set.text).toBe(409);
    expect(set.json?.overrideAvailable).toBe(false);
  });
});

describe.skipIf(!DB_CONFIGURED)("an administrator cannot hand a village-held power back alone", () => {
  it("refuses an ordinary admin, and the sentence names the ballot", async () => {
    const r = await takeBack({}, people.fin.token);
    expect(r.status, r.text).toBe(409);
    expect(String(r.json?.error)).toContain(RETURN_NEEDS_A_VOTE);
    expect(String(r.json?.error)).toContain("power-returns");
    expect(String(r.json?.error)).toContain("power_return");
    // Who holds it, named, so the panel can say it without parsing a sentence.
    expect(String(r.json?.holderName)).toContain("Steward");
    expect(r.json?.overrideAvailable).toBe(false);
    expect(await holdingRows()).toEqual([{ capability: POWER, role: "steward-circle" }]);
  });

  it("refuses the same admin WITH the glass, and writes the village nothing", async () => {
    const before = await reachCount();
    const r = await takeBack(GLASS, people.fin.token);
    expect(r.status, r.text).toBe(409);
    expect(String(r.json?.error)).toContain(BREAK_GLASS_WAY_THROUGH);
    expect(await reachCount()).toBe(before);
    expect(await holdingRows()).toEqual([{ capability: POWER, role: "steward-circle" }]);
  });

  it("refuses a member outright, however seated, because this is an admin route", async () => {
    const r = await takeBack({}, people.kira.token);
    expect(r.status, r.text).toBe(401);
    expect(await holdingRows()).toEqual([{ capability: POWER, role: "steward-circle" }]);
  });

  /*
   * THE CASE THAT NEEDED THE VERDICT WIDENING. Ada is a founder seated as a
   * steward AND seated in the circle that holds the power, so the gate ALLOWS
   * her: `roleCapabilities` carries `dial.set` and the answer is an ordinary
   * yes, not a reach past the village. The route still refuses her, because
   * the ruling is about the act and not about the person — and the refusal
   * has to offer her the door anyway, which is a thing `mayAct` used to
   * answer only on a refusal.
   */
  it("refuses the founder-steward who has not said they mean to reach past the village, and offers the door", async () => {
    const r = await takeBack();
    expect(r.status, r.text).toBe(409);
    expect(String(r.json?.error)).toContain(RETURN_NEEDS_A_VOTE);
    expect(r.json?.overrideAvailable, "the one person who can break the glass must be told so").toBe(true);
    expect(await holdingRows()).toEqual([{ capability: POWER, role: "steward-circle" }]);
  });

  it("answers 404 for a power the village is not holding, rather than sending anyone to a ballot", async () => {
    const r = await call("DELETE", "/api/admin/capabilities/library.keep/holding", undefined, people.fin.token);
    expect(r.status, r.text).toBe(404);
  });
});

describe.skipIf(!DB_CONFIGURED)("a return vote that does not carry leaves the power with the village", () => {
  let ballotId = "";

  it("a member opens the return ballot, with no admin in the chain", async () => {
    const opened = await call("POST", "/api/governance/power-returns", {
      capability: POWER,
      reason:
        "The circle has not had the time this asks for, and the village would rather hand it back than leave the dials with nobody answering.",
    }, people.wren.token);
    expect(opened.status, opened.text).toBe(200);
    ballotId = String(opened.json?.ballot?.id ?? "");
    expect(ballotId).toBeTruthy();
    expect(String(opened.json?.ballot?.subjectType)).toBe("power_return");
  });

  it("the village says no, and the power stays exactly where it was", async () => {
    for (const p of [people.wren, people.kira, people.otto]) {
      const v = await call("POST", `/api/governance/ballots/${ballotId}/vote`, { choice: "no" }, p.token);
      expect(v.status, v.text).toBe(200);
    }
    await pool.query( // module-review-ok: fixture SQL against the scratch schema this suite provisioned, never a production table
      "UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?",
      [ballotId],
    );
    const closed = await call("POST", `/api/governance/ballots/${ballotId}/close`, {
      outcomeNote: "The village keeps the dials for now.",
    }, people.wren.token);
    expect(closed.status, closed.text).toBe(200);
    expect(await holdingRows()).toEqual([{ capability: POWER, role: "steward-circle" }]);
    const pulse = await publicPulse();
    expect(pulse.some((t) => t.includes("went back to the admin panel"))).toBe(false);
    expect(pulse.some((t) => t.includes("handed this back to the admin panel"))).toBe(false);
  });
});

describe.skipIf(!DB_CONFIGURED)("the one exception: a founder seated as a steward breaks the glass", () => {
  it("takes the power back, and the village reads both lines", async () => {
    const reachesBefore = await reachCount();
    const r = await takeBack(GLASS);
    expect(r.status, r.text).toBe(200);
    expect(await holdingRows()).toEqual([]);

    const pulse = await publicPulse();
    // The reach, written by the gate, and the hand-back's own line, written by
    // the route. A village that cannot read that its power moved has not been
    // told, whatever the audit trail holds.
    expect(await reachCount(), "the reach past the village is on the public pulse").toBe(reachesBefore + 1);
    expect(pulse.some((t) => t.includes("went back to the admin panel"))).toBe(true);
    expect(await trailCount(`capability:returned:${POWER}`)).toBe(1);
  });

  it("and the panel carries it again, which is what the ballot document promised", async () => {
    const set = await call("PUT", `/api/admin/variables/${DIAL}`, { value: "43" }, people.fin.token);
    expect(set.status, set.text).toBe(200);
    expect(await verdict(people.fin.id, POWER)).toEqual({ held: true, source: "admin" });
  });

  it("refuses a second hand-back of a power that is already back", async () => {
    const r = await takeBack(GLASS);
    expect(r.status, r.text).toBe(404);
  });
});

describe.skipIf(!DB_CONFIGURED)("a badge may not grant the steward's veto", () => {
  it("refuses the badge at the admin route, and says where the seat is filled", async () => {
    const r = await call("POST", "/api/admin/badges", {
      name: "Veto By Badge", kind: "granted", capabilities: ["steward.veto"],
    });
    expect(r.status, r.text).toBe(400);
    expect(String(r.json?.error)).toContain(STEWARD_SEAT_REFUSAL);
    const [[row]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT COUNT(*) AS n FROM badges WHERE id = 'veto-by-badge'",
    );
    expect(Number(row.n), "nothing may be stored when the sentence goes back").toBe(0);
  });

  it("saves the same badge once the veto is off it, so this is a fence and not a closed door", async () => {
    const r = await call("POST", "/api/admin/badges", {
      name: "Keeper Of Books", kind: "granted", capabilities: ["library.keep"],
    });
    expect(r.status, r.text).toBe(200);
    expect(r.json?.badge?.capabilities).toEqual(["library.keep"]);
  });

  /*
   * THE ROW WRITTEN UNDERNEATH, which is the state every lock exists for: an
   * admin who edits the table by hand, or a badge minted before the ruling.
   * Badges are read per request with no cache above them, so this lands
   * immediately and no reboot is needed.
   */
  it("grants nothing when the row was written by hand", async () => {
    await pool.query( // module-review-ok: fixture SQL standing in for a badge minted before the ruling, against the scratch schema
      "INSERT INTO badges (id, name, kind, capabilities, denies, active) VALUES (?,?,?,?,?,1)",
      ["hand-written-veto", "Hand Written Veto", "granted", JSON.stringify(["steward.veto"]), JSON.stringify([])],
    );
    await pool.query( // module-review-ok: fixture SQL standing in for an award made before the ruling, against the scratch schema this suite provisioned
      "INSERT INTO badge_awards (id, badge_id, user_id, awarded_by) VALUES (?,?,?,?)", // module-review-ok: the award half of the same fixture; both rules read their own line
      ["award-hand-written-veto", "hand-written-veto", people.otto.id, people.ada.id],
    );
    expect(await verdict(people.otto.id, "steward.veto")).toEqual({ held: false, source: "not granted" });
  });

  it("and a SEAT carrying it still grants it, which is the whole of the ruling", async () => {
    expect(await verdict(people.kira.id, "steward.veto")).toEqual({ held: true, source: "role" });
  });

  it("the migration clears the hand-written row, which is the third lock", async () => {
    // `drizzle/0215` verbatim. It runs before `assertBadgeInvariants` at boot,
    // so a village holding this row starts instead of refusing to.
    await pool.query( // module-review-ok: running the suite's own migration statement against the scratch schema it provisioned
      "UPDATE `badges` SET `capabilities` = JSON_REMOVE(`capabilities`, JSON_UNQUOTE(JSON_SEARCH(`capabilities`, 'one', 'steward.veto'))) " +
        "WHERE JSON_SEARCH(`capabilities`, 'one', 'steward.veto') IS NOT NULL",
    );
    const [[row]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT capabilities FROM badges WHERE id = 'hand-written-veto'",
    );
    const left = typeof row.capabilities === "string" ? JSON.parse(row.capabilities) : row.capabilities;
    expect(left).toEqual([]);
    // The badge itself is untouched: it may still say something true.
    const [[still]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT COUNT(*) AS n FROM badges WHERE id = 'hand-written-veto'",
    );
    expect(Number(still.n)).toBe(1);
  });
});
