/**
 * THE RUNWAY AND THE WAY BACK, DRIVEN WITH NO ADMIN IN THE CHAIN.
 *
 * R54, the founder's ruling: "these villages are meant to be taken over by
 * the electorate to run the game and put the admins out of a full time job."
 * Lane G-B made a power able to move. Lane G-C built the ceremony that moves
 * it. Both of them stood on a step neither owned, and both directions were
 * missing an exit:
 *
 *  1. THE RUNWAY WAS ADMIN-ONLY. A power cannot cross to a village unless a
 *     role already carries it, because a holder that cannot act is not a
 *     holder. The only writer of a role's capability list was
 *     `PUT /api/admin/roles/:id/capabilities`, behind `isAdmin`.
 *  2. THERE WAS NO WAY BACK. Returning a power was
 *     `DELETE /api/admin/capabilities/:capability/holding`, also admin-only,
 *     so a village that found it was not ready had to ask the scaffolding to
 *     take the power off it.
 *
 * The harm metric for this file is one sentence, and every clause of it is
 * driven over HTTP against the built server:
 *
 *   A power goes from carried by nobody, to held by the village, and back
 *   again, with NO ADMIN ANYWHERE IN THE CHAIN.
 *
 * `library.keep` is the power on purpose. It is one of the five movable
 * powers that NO seeded role carries (`intake.moderate`, `library.keep`,
 * `story.tell`, `org.seat`, `dial.set`), so this file starts from the state
 * the runway exists for: a real, wired power that the village could not begin
 * on at all without asking an admin first. The other three movable powers are
 * already on seeded roles, which is why the transfer suite could drive
 * `event.manage` without ever needing this.
 *
 * WHAT IS DELIBERATELY IMPOSSIBLE gets cases of its own, because a design
 * whose limits are untested is a design whose limits are a comment: the
 * runway refuses the two keys that make an electorate, refuses a power that
 * could never leave the admin panel, and cannot take a capability OFF a role.
 *
 * The cases run IN ORDER: one power walks the whole path and comes back. Run
 * the whole file, never a `-t` slice. Boots the BUILT `dist/index.js` against
 * a throwaway schema, so run `pnpm build` first or you are testing stale
 * code. Skips loudly without TEST_DATABASE_URL.
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
  console.warn("[powerRunway.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window. It is checked, not asserted.
 *
 * A hand-written survey used to live here, ending with RE-GREP BEFORE
 * TRUSTING THIS. Nobody re-grepped, the tree moved, and the paragraph went on
 * claiming the window was clear when it had not been for over a week. Worse,
 * every one of those surveys grepped for `process.pid %` and so never saw the
 * stub ports (GOOGLE_PORT, BARE_PORT, STUB_PORT) or the fixed 8127 that
 * actually caused a failure.
 *
 * `scripts/check-e2e-ports.mjs` is that survey, executable, run in CI. It
 * refuses any two windows in different files that overlap at all, any fixed
 * port, and anything reaching into Linux's ephemeral range. Change the number
 * below and it will tell you.
 */
const PORT = 23502 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "runway-admin";
const PASSWORD = "RunwayTest123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
/** Wren reached co-creator, so she holds proposal.open as a MEMBER. */
let wrenToken = "";
let wrenId = "";
/** Ida is seated in the Steward Circle and will act on the power. */
let idaToken = "";
let idaId = "";
/** Otto holds nothing anybody appointed. He is the control. */
let ottoToken = "";
let ottoId = "";

interface Answer { status: number; json: any }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null; headers?: Record<string, string> } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    token: "",
    body: { name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** Push a ballot's window into the past: the clock, never a status change. */
const expire = async (ballotId: string) => {
  await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

/** The holding table exactly as it stands. The permanent row, read raw. */
const holdingRows = async (): Promise<Array<{ capability: string; role: string; ballot: string | null }>> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT capability, holder_role_id, moved_by_ballot_id FROM capability_holding ORDER BY capability",
  );
  return rows.map((r) => ({
    capability: String(r.capability),
    role: String(r.holder_role_id),
    ballot: r.moved_by_ballot_id == null ? null : String(r.moved_by_ballot_id),
  }));
};

/** What a role carries, read from the roles table and never from a payload. */
const roleCapabilities = async (roleId: string): Promise<string[]> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT capabilities FROM roles WHERE id = ?",
    [roleId],
  );
  if (rows.length === 0) return [];
  const raw = rows[0].capabilities;
  try {
    return Array.isArray(raw) ? raw.map(String) : JSON.parse(String(raw ?? "[]")).map(String);
  } catch {
    return [];
  }
};

/** Every line the VILLAGE can read. Audience public, examples out. */
const publicPulse = async (): Promise<string[]> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT text FROM health_events WHERE audience = 'public' AND is_example = 0 ORDER BY at DESC, id DESC LIMIT 50",
  );
  return rows.map((r) => String(r.text));
};

/**
 * Everybody says yes, the clock runs out, and a MEMBER closes it.
 *
 * The closer is Wren throughout this file and never the founder, because a
 * chain with an admin closing the ballot is a chain with an admin in it. A
 * ballot closes by a human act and this is the human.
 */
async function carry(ballotId: string, outcomeNote: string): Promise<Answer> {
  for (const t of [founderToken, wrenToken, idaToken, ottoToken]) {
    const r = await call("POST", `/api/governance/ballots/${ballotId}/vote`, { token: t, body: { choice: "yes" } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  }
  await expire(ballotId);
  return await call("POST", `/api/governance/ballots/${ballotId}/close`, {
    token: wrenToken,
    body: { outcomeNote },
  });
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the power runway route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-runway-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

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
      AUTH_TOKEN_SECRET: "runway-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
    token: "",
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Runway Founder" },
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: "", body: { token: claim, password: PASSWORD } });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const on = await call("PUT", "/api/admin/modules/governance/lifecycle", {
    body: { lifecycle: "members", examples: false },
  });
  expect(on.status, "governance must be on for this suite").toBe(200);
  await call("PUT", "/api/admin/modules/library/lifecycle", { body: { lifecycle: "public", examples: false } });

  const wren = await register("Wren Ashby", "wren");
  wrenToken = wren.token; wrenId = wren.id;
  const ida = await register("Ida Kestrel", "ida");
  idaToken = ida.token; idaId = ida.id;
  const otto = await register("Otto Brand", "otto");
  ottoToken = otto.token; ottoId = otto.id;

  /*
   * Everybody reaches member so `ballot.vote` unlocks and the roll is real.
   * Wren goes further, to co-creator, because that is the rung
   * `proposal.open` unlocks at: she holds it as a MEMBER of this village and
   * not as its operator, which is the premise of every ruling-1 case.
   *
   * The FOUNDER is pinned at member on purpose, so a refusal is the ruling
   * working and never an accident of where a bootstrap account starts.
   */
  for (const [id, stage] of [
    [founderId, "member"],
    [wrenId, "co-creator"],
    [idaId, "member"],
    [ottoId, "member"],
  ] as const) {
    const r = await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId: stage } });
    expect(r.status, `${id} reaches ${stage}`).toBe(200);
  }

  // Ida takes a seat in the Steward Circle. Somebody has to be sitting there
  // before the village votes it a power, or the grant lands on an empty chair.
  const seated = await call("POST", "/api/admin/roles/steward-circle/holders", {
    body: { userId: idaId, action: "add" },
  });
  expect(seated.status, JSON.stringify(seated.json)).toBe(200);
}, 180_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("the state the runway exists for", () => {
  it("no role carries library.keep, so the handover cannot even be asked for", async () => {
    /*
     * THE PREMISE, MEASURED AND NEVER ASSUMED. This is the gap in one
     * assertion: a real, wired, movable power that no role in a fresh village
     * carries, so the ceremony that would move it refuses at the door.
     */
    for (const roleId of ["founders-circle", "steward-circle", "treasury", "practitioners"]) {
      expect(await roleCapabilities(roleId), roleId).not.toContain("library.keep");
    }

    const tooEarly = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken,
      body: {
        capability: "library.keep",
        roleId: "steward-circle",
        reason: "The stewards have been keeping the library in practice for two seasons and should hold it.",
      },
    });
    expect(tooEarly.status).toBe(409);
    expect(String(tooEarly.json?.error)).toContain("does not carry this power yet");
    expect(await holdingRows()).toEqual([]);
  });

  it("and the seated steward cannot work the library, because nothing granted it", async () => {
    const refused = await call("POST", "/api/admin/library/adjust", {
      token: idaToken,
      body: { userId: "nobody-at-all", credits: 1 },
    });
    expect(refused.status).toBe(401);
  });
});

describe.skipIf(!DB_CONFIGURED)("ruling 1 holds on both new ceremonies", () => {
  const grant = {
    capability: "library.keep",
    roleId: "steward-circle",
    reason: "The stewards have been keeping the library in practice for two seasons, and every loan already goes through them.",
  };

  it("refuses the founder on a grant, whose only path to proposal.open is being an admin", async () => {
    const explain = await call("GET", `/api/admin/members/${founderId}/capabilities`);
    const row = (explain.json?.capabilities ?? []).find((c: any) => c.capability === "proposal.open");
    expect(row.held).toBe(true);
    expect(row.source).toBe("admin");

    const refused = await call("POST", "/api/governance/power-grants", { body: grant });
    expect(refused.status, JSON.stringify(refused.json)).toBe(403);
    expect(refused.json?.adminOnly).toBe(true);
    // The refusal names THIS act and says what to do instead.
    expect(String(refused.json?.error)).toContain("Giving a role a power");
    expect(String(refused.json?.error)).toContain("advisory vote");
  });

  it("refuses a member who holds proposal.open nowhere at all", async () => {
    const refused = await call("POST", "/api/governance/power-grants", { token: ottoToken, body: grant });
    expect(refused.status).toBe(403);
    expect(refused.json?.adminOnly).toBe(false);
  });

  it("refuses the founder on a return too, so an admin cannot start one either", async () => {
    /*
     * The return is refused here for the SAME reason and not a lesser one. An
     * admin who could open a return could put a village's handover back on
     * the table by starting a vote the village never asked for, which is the
     * scaffolding relitigating a decision made about itself.
     *
     * It refuses on ruling 1 BEFORE it looks at whether anything is held, so
     * this reads the same on an empty village as on a full one.
     */
    const refused = await call("POST", "/api/governance/power-returns", {
      body: { capability: "library.keep", reason: "An admin trying to start a return the village never asked for." },
    });
    expect(refused.status).toBe(403);
    expect(refused.json?.adminOnly).toBe(true);
    expect(String(refused.json?.error)).toContain("Handing a power back");
  });
});

describe.skipIf(!DB_CONFIGURED)("what the runway deliberately cannot do", () => {
  const good = {
    capability: "library.keep",
    roleId: "steward-circle",
    reason: "The stewards have been keeping the library in practice for two seasons, and every loan already goes through them.",
  };

  it("refuses ballot.vote BY NAME, and the reason is capture and never enlargement", async () => {
    /*
     * THE LINE THAT DOES NOT MOVE. `TRANSFERABLE` already excludes
     * `ballot.vote`, so this refusal is doing nothing today. It is written
     * down anyway, and this case is why: the day a lane converts the vote
     * route to `mayAct` and flips the key, the runway's derived width would
     * otherwise widen to include it silently, in a commit about something
     * else.
     *
     * The sentence has to point at the way that IS open, or a refusal on a
     * governance key reads as the platform closing a door R54 calls the
     * destination.
     */
    const r = await call("POST", "/api/governance/power-grants", {
      token: wrenToken, body: { ...good, capability: "ballot.vote" },
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("choosing who else gets a say");
    expect(String(r.json?.error)).toContain("rule change");
    // It is the REFUSAL talking and not the movability check, which would
    // have caught this key too and said something else entirely.
    expect(String(r.json?.error)).not.toContain("not a power the village can take on");
  });

  it("refuses member.vouch by name for the same reason", async () => {
    const r = await call("POST", "/api/governance/power-grants", {
      token: wrenToken, body: { ...good, capability: "member.vouch" },
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("choosing who else gets a say");
  });

  it("refuses a personal act, which no role can hold on anybody's behalf", async () => {
    const r = await call("POST", "/api/governance/power-grants", {
      token: wrenToken, body: { ...good, capability: "message.send" },
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("not a power the village can take on");
  });

  it("refuses a key that names a personal act, because there is nobody to give it to", async () => {
    /*
     * This case used to name `feed.announce`, and 0103 is why it does not.
     *
     * The runway is exactly as wide as the ceremony it serves: every key it
     * can grant is a key the village could go on to hold, and that width is
     * DERIVED from `TRANSFERABLE` and from whether anything gates on the key.
     * `map.curatePhotos` was refused here because every route behind it was
     * still an inline `hasCapability` call that could not carry the
     * break-glass. 0103 converted those five routes to `guardCapability` and
     * flipped the map in the same commit, so the runway widened to include
     * the key with no edit in this route, which is the property the
     * derivation was built for.
     *
     * `map.curatePhotos` and not `feed.announce`, because `roles-seed.json`
     * already puts announcements on the Steward Circle and the runway
     * correctly refuses a role that already carries the power. Nothing seeded
     * carries curation, so it is the honest demonstration.
     *
     * What this case still has to pin is the OTHER half: a key that names
     * something a member does for themselves is refused whatever happens to
     * the wiring. `map.edit` is that shape. Keeping a private draft of the
     * land is a personal act with nobody to hand it to, and a row saying the
     * village holds it would be a category error with a lockout attached.
     */
    const r = await call("POST", "/api/governance/power-grants", {
      token: wrenToken, body: { ...good, capability: "map.edit" },
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("not a power the village can take on");
  });

  it("now offers map.curatePhotos, because converting its route widened the runway", async () => {
    /*
     * THE DERIVATION, DRIVEN. Nothing in this route names `feed.announce`,
     * and nothing in it was edited by 0103. The route asks `TRANSFERABLE` and
     * `POWERS`, both of which moved, so this key became askable on the same
     * commit that gave its gate an escape hatch. A `TRANSFERABLE` flip
     * without the conversion would have widened the runway toward a lockout,
     * which is exactly what the old case was guarding.
     *
     * It opens a real ballot, so this case calls it off again straight away:
     * one open handover per power, and the cases below need a clear board.
     */
    const opened = await call("POST", "/api/governance/power-grants", {
      token: wrenToken,
      body: {
        ...good,
        capability: "map.curatePhotos",
        reason: "The stewards already answer for what is on the village map, and should be able to work its photographs.",
      },
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const id = String(opened.json?.ballot?.id ?? "");
    expect(id).toBeTruthy();
    const off = await call("POST", `/api/governance/ballots/${id}/withdraw`, {
      token: wrenToken, body: { reason: "Opened here only to show the runway widened." },
    });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
  });

  it("refuses a key this platform does not know", async () => {
    const r = await call("POST", "/api/governance/power-grants", {
      token: wrenToken, body: { ...good, capability: "library.boss" },
    });
    expect(r.status).toBe(400);
  });

  it("refuses a role that already carries it, because there is nothing to decide", async () => {
    const r = await call("POST", "/api/governance/power-grants", {
      token: wrenToken, body: { ...good, capability: "event.manage" },
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("already carries this one");
  });

  it("refuses a role that is not this village's", async () => {
    const r = await call("POST", "/api/governance/power-grants", {
      token: wrenToken, body: { ...good, roleId: "no-such-circle" },
    });
    expect(r.status).toBe(404);
  });

  it("asks for the case in words, because the whole roll reads it before voting", async () => {
    const r = await call("POST", "/api/governance/power-grants", {
      token: wrenToken, body: { ...good, reason: "because" },
    });
    expect(r.status).toBe(400);
  });

  it("refuses a return of something the village is not holding", async () => {
    const r = await call("POST", "/api/governance/power-returns", {
      token: wrenToken,
      body: { capability: "library.keep", reason: "Trying to hand back a power this village never took on at all." },
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("not holding that one");
  });

  it("has written nothing through any of that", async () => {
    expect(await holdingRows()).toEqual([]);
    expect(await roleCapabilities("steward-circle")).not.toContain("library.keep");
  });
});

describe.skipIf(!DB_CONFIGURED)("STEP ONE: the village gives a role a power, with no admin in the chain", () => {
  let grantId = "";

  it("the wizard offers the runway and the way back as real votes", async () => {
    const facts = await call("GET", "/api/governance/wizard", { token: wrenToken });
    expect(facts.status).toBe(200);
    expect(facts.json?.conductable).toContain("power_grant");
    expect(facts.json?.conductable).toContain("power_return");
  });

  it("a MEMBER opens the ask, and the frozen document says what changes and what does not", async () => {
    const opened = await call("POST", "/api/governance/power-grants", {
      token: wrenToken,
      body: {
        capability: "library.keep",
        roleId: "steward-circle",
        reason: "The stewards have been keeping the library in practice for two seasons, and every loan already goes through them.",
      },
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const ballot = opened.json?.ballot;
    grantId = String(ballot?.id ?? "");
    expect(grantId).toBeTruthy();

    // It BINDS, straight off SUBJECT_CLOSERS, so `binding` on the wire cannot
    // drift from what closing actually does.
    expect(ballot.binding).toBe(true);
    expect(ballot.subjectType).toBe("power_grant");
    expect(ballot.subjectRef).toBe("library.keep@steward-circle");

    const doc = String(ballot.docMarkdown);
    // WHAT IT DOES.
    expect(doc).toContain("Anybody seated in Steward Circle can");
    // WHAT IT DOES NOT DO. The half that keeps this honest beside a handover.
    expect(doc).toContain("Nothing moves off the admin panel");
    // THE ESCALATION FACT, in the document instead of behind a checkbox: the
    // roll reads it before voting, which is a stronger confirmation than a
    // founder ticking a box alone.
    expect(doc).toContain("would be the first role in this village to carry this one");
    // AND IT ASKS THE VILLAGE FOR NOTHING AFTERWARDS (R55).
    expect(doc).toContain("Both are whole answers");

    // The card's own facts, discriminated so it cannot render a crossing.
    expect(ballot.transfer.kind).toBe("grant");
    expect(ballot.transfer.capability).toBe("library.keep");
    expect(ballot.transfer.toRoleName).toBe("Steward Circle");
    expect(ballot.transfer.roleCarriesIt).toBe(false);
    expect(ballot.transfer.heldNow).toBeNull();
    expect(ballot.transfer.crossedHere).toBeNull();
  });

  it("IT CARRIES, and the role carries the power", async () => {
    const closed = await carry(grantId, "The stewards keep the library from today.");
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("passed");
    expect(closed.json?.applied).toEqual(["library.keep"]);
    expect(closed.json?.held).toBeNull();

    // THE ROLES TABLE, read raw. The village wrote a permission table.
    expect(await roleCapabilities("steward-circle")).toContain("library.keep");
    // And it added ONE key, never replacing what was there.
    expect(await roleCapabilities("steward-circle")).toContain("event.manage");

    // NOTHING CROSSED. A grant is not a handover and the tables say so.
    expect(await holdingRows()).toEqual([]);

    const pulse = await publicPulse();
    expect(pulse.some((t) => t.includes("by a vote of the whole village"))).toBe(true);
  });

  it("and the seated steward can now work the library, on a MEMBER token", async () => {
    /*
     * THE POWER IS REAL. The same request from the same account was refused
     * before the vote. `itemId` names nothing, so a 404 is the route
     * answering ABOUT the item, which is past the gate; the gate's own
     * refusal is the 401 this got in the first block.
     */
    const acted = await call("POST", "/api/admin/library/adjust", {
      token: idaToken,
      body: { userId: "nobody-at-all", credits: 1 },
    });
    // 404 is the route answering ABOUT the member, which is past the gate.
    // The gate's own refusal is the 401 this same call got before the vote.
    expect(acted.status, JSON.stringify(acted.json)).toBe(404);
  });

  it("the card reads the fact off the role, and never off the outcome", async () => {
    const cold = await call("GET", `/api/governance/ballots/${grantId}`, { token: ottoToken });
    expect(cold.json?.transfer?.kind).toBe("grant");
    expect(cold.json?.transfer?.roleCarriesIt).toBe(true);
    // A grant writes no holding row, so the crossing field stays null forever
    // and the card cannot claim one.
    expect(cold.json?.transfer?.crossedHere).toBeNull();
    expect(cold.json?.transfer?.heldNow).toBeNull();
  });
});

describe.skipIf(!DB_CONFIGURED)("STEP TWO: the village takes the power on, still with no admin", () => {
  let transferId = "";

  it("the handover the village could not ask for an hour ago now opens", async () => {
    const opened = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken,
      body: {
        capability: "library.keep",
        roleId: "steward-circle",
        reason: "The stewards have been keeping it since the village gave them the power, and the admin panel has not been needed once.",
      },
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    transferId = String(opened.json?.ballot?.id ?? "");
    expect(opened.json?.ballot?.transfer?.kind).toBe("transfer");
    expect(opened.json?.ballot?.transfer?.roleCarriesIt).toBe(true);
  });

  it("IT CARRIES, AND THE POWER CROSSES: one row, naming the ballot that moved it", async () => {
    const closed = await carry(transferId, "The village keeps its own library from today.");
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.applied).toEqual(["library.keep"]);

    const rows = await holdingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].capability).toBe("library.keep");
    expect(rows[0].role).toBe("steward-circle");
    expect(rows[0].ballot).toBe(transferId);
  });

  it("THE WHOLE CHAIN HAD NO ADMIN IN IT, proved from the audit trail", async () => {
    /*
     * THE CLAIM OF THIS FILE, CHECKED AGAINST THE RECORD RATHER THAN THE
     * NARRATIVE. Every act that moved this power was written by a member.
     *
     * The two admin routes that used to be the only way through both leave a
     * distinctive audit line, and neither appears: `role:capabilities:` is the
     * admin runway, `capability:moved:` is the admin handover. What IS here
     * are the ballot-written ones.
     */
    /*
     * WAITED FOR, NOT SNAPSHOT. recordEvent() is fire-and-forget by design
     * (server/lib/events.ts: a trace must never fail the mutation it traces),
     * and the capability:moved-by-ballot: write is the last thing the apply
     * does before it returns, so the response can beat its own audit row out
     * of the door. A bare read here lost that race under load: every
     * assertion about the crossing itself passed and only the trail looked
     * empty. Same defect and same remedy as the auditRowCount helper in
     * server/loop.e2e.test.ts, which carries the note "reading the admin view
     * first raced it and lost in CI".
     *
     * This cannot weaken the two ABSENCE assertions below. A longer window
     * gives a forbidden role:capabilities: row MORE time to appear, never
     * less, so waiting makes those two stricter. And a row that never lands
     * still fails, on whatever rows were actually found.
     */
    let rows: any[] = [];
    const deadline = Date.now() + 10_000;
    for (;;) {
      const [found] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT text, actor_user_id FROM health_events WHERE audience = 'admin' AND entity_ref IN ('library.keep','steward-circle')",
      );
      rows = found;
      const have = rows.map((r) => String(r.text));
      const both =
        have.some((t) => t.startsWith("role:capabilities-by-ballot:")) &&
        have.some((t) => t.startsWith("capability:moved-by-ballot:"));
      if (both || Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const texts = rows.map((r) => String(r.text));
    expect(texts.some((t) => t.startsWith("role:capabilities-by-ballot:"))).toBe(true);
    expect(texts.some((t) => t.startsWith("capability:moved-by-ballot:"))).toBe(true);
    // The admin routes' own lines are absent.
    expect(texts.some((t) => /^role:capabilities:/.test(t))).toBe(false);
    expect(texts.some((t) => /^capability:moved:/.test(t))).toBe(false);
    // And every actor on those lines is Wren, who is not an admin.
    const actors = new Set(rows.map((r) => String(r.actor_user_id)));
    expect(actors.has(founderId)).toBe(false);
  });

  it("...and the admin is stopped, with the explanation and not a bare refusal", async () => {
    const stopped = await call("POST", "/api/admin/library/adjust", {
      body: { userId: "nobody-at-all", credits: 1 },
    });
    expect(stopped.status).toBe(409);
    expect(stopped.json?.villageHolds).toBe(true);
    expect(stopped.json?.requiresOverride).toBe(true);
    expect(String(stopped.json?.error)).toContain("Steward Circle");
  });
});

describe.skipIf(!DB_CONFIGURED)("STEP THREE: the village hands it back, still with no admin", () => {
  let returnId = "";

  it("a MEMBER opens the return, and the document reads as an ordinary act", async () => {
    const opened = await call("POST", "/api/governance/power-returns", {
      token: wrenToken,
      body: {
        capability: "library.keep",
        reason: "Both of the people who were keeping the library have moved on, and the village would rather hand this back than leave it with nobody answering.",
      },
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const ballot = opened.json?.ballot;
    returnId = String(ballot?.id ?? "");

    expect(ballot.binding).toBe(true);
    expect(ballot.subjectType).toBe("power_return");
    // The ref is the capability ALONE. Where it goes is not a choice.
    expect(ballot.subjectRef).toBe("library.keep");
    expect(ballot.transfer.kind).toBe("return");
    expect(ballot.transfer.heldNow?.roleName).toBe("Steward Circle");
    expect(ballot.transfer.heldNow?.byBallot).toBe(true);

    const doc = String(ballot.docMarkdown);
    expect(doc).toContain("The admin panel carries this one again");
    // THE ROLE KEEPS THE POWER. Handing back the holding is not disarming
    // anybody, and a village voting on this is owed that distinction.
    expect(doc).toContain("keeps the power itself");
    // R55: the way back is a path and it says so, without asking for anything.
    expect(doc).toContain("can ask for it again");

    /*
     * AND IT IS NOT A SCORECARD. Nothing in the document a village reads on
     * the way out counts anything, ranks anything, or says the village is
     * behind. This is the one surface where that would be easiest to get
     * wrong, because a return is the only ceremony where a count could be
     * framed as going down.
     */
    expect(doc).not.toMatch(/\d+\s*%/);
    expect(doc.toLowerCase()).not.toContain("failed");
    expect(doc.toLowerCase()).not.toContain("not ready");
  });

  it("IT CARRIES, AND THE POWER GOES BACK: the row is gone, the role is untouched", async () => {
    const closed = await carry(returnId, "The village hands the library back for now.");
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("passed");
    expect(closed.json?.applied).toEqual(["library.keep"]);
    expect(closed.json?.held).toBeNull();

    // THE HOLDING IS GONE.
    expect(await holdingRows()).toEqual([]);
    // AND THE ROLE STILL CARRIES THE POWER. This is the whole distinction:
    // the village stopped HOLDING it, and nobody was disarmed.
    expect(await roleCapabilities("steward-circle")).toContain("library.keep");

    const pulse = await publicPulse();
    expect(pulse.some((t) => t.includes("handed this back to the admin panel, by its own vote"))).toBe(true);
  });

  it("the admin passes again, with no break-glass and no record of one", async () => {
    const pulseBefore = await publicPulse();
    const acted = await call("POST", "/api/admin/library/adjust", {
      body: { userId: "nobody-at-all", credits: 1 },
    });
    expect(acted.status, JSON.stringify(acted.json)).toBe(404);
    // Nothing was reached past, so nothing says anybody was.
    const pulseAfter = await publicPulse();
    expect(pulseAfter.filter((t) => t.includes("acted on a power this village holds")).length).toBe(
      pulseBefore.filter((t) => t.includes("acted on a power this village holds")).length,
    );
  });

  it("and the seated steward can STILL work the library, because the grant survived", async () => {
    const acted = await call("POST", "/api/admin/library/adjust", {
      token: idaToken,
      body: { userId: "nobody-at-all", credits: 1 },
    });
    expect(acted.status, JSON.stringify(acted.json)).toBe(404);
  });

  it("the village can ask for it again, which is what makes this a path", async () => {
    /*
     * THE SENTENCE THE RETURN CEREMONY PROMISES, DRIVEN. A journey with no
     * way back is a trap; a way back you cannot return from is a different
     * trap wearing the same coat.
     */
    const again = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken,
      body: {
        capability: "library.keep",
        roleId: "steward-circle",
        reason: "Two new people have been keeping the library all season, and the village would like to hold it again.",
      },
    });
    expect(again.status, JSON.stringify(again.json)).toBe(200);
  });
});
