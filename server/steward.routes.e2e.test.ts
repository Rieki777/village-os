/**
 * A VILLAGE VOTES A ROLE INTO EXISTENCE AND GIVES IT A POWER (R90).
 *
 * R90, in the founder's words: "eventually a village will be able to vote the
 * 'Game Steward' role or choose to not vote for this role at all ... After
 * that they can optionally vote in a steward role and give various powers to
 * this steward to immediately act, and when the game is mature enough they may
 * not even need to vote this role in."
 *
 * The harm metric for this file is one sentence, and every clause of it is
 * driven over HTTP against the built server:
 *
 *   A village with no steward works completely; the same village can vote a
 *   role into existence, vote it a power, vote somebody into it, watch them
 *   act on that power with no further vote, and vote the seat back again,
 *   with NO ADMIN ANYWHERE IN THE CHAIN.
 *
 * `library.keep` is the power on purpose, and for the reason
 * `powerRunway.routes.e2e.test.ts` gives: it is a real, wired, movable power
 * that no seeded role carries, so a role that has just been declared is the
 * only way anybody in this village can reach it.
 *
 * THE FIRST DESCRIBE IS NOT A WARM-UP. R90 says a village may choose never to
 * have a steward and a mature one may not need the role at all, so "a village
 * that never opens any of these votes behaves exactly as it does today" is a
 * property of the design and not an assumption about it. It is driven first,
 * before anything in this file has voted for anything.
 *
 * THE CASES RUN IN ORDER: one role is declared, armed, filled and emptied. Run
 * the whole file, never a `-t` slice. Boots the BUILT `dist/index.js` against
 * a throwaway schema, so run `pnpm build` first or you are testing stale code.
 * Skips loudly without TEST_DATABASE_URL.
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
  console.warn("[steward.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
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
const PORT = 27602 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "steward-admin";
const PASSWORD = "StewardTest123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

/** The operator's account. It opens nothing in this file after the setup. */
let founderToken = "";
let founderId = "";
/** Rhoda reached co-creator, so she holds proposal.open as a MEMBER. */
let rhodaToken = "";
let rhodaId = "";
/** Sol is the person the village votes into the role, and acts on the power. */
let solToken = "";
let solId = "";
/** Tam holds nothing anybody appointed. The control. */
let tamToken = "";
let tamId = "";

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

/** The roles table exactly as it stands, read raw and never off a payload. */
const roleRow = async (roleId: string): Promise<any | null> => {
  const [rows] = await pool.query<any[]>("SELECT * FROM roles WHERE id = ?", [roleId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows[0] ?? null;
};

/** What a role carries, read from the table and never from a payload. */
const roleCapabilities = async (roleId: string): Promise<string[]> => {
  const row = await roleRow(roleId);
  if (!row) return [];
  const raw = row.capabilities;
  try {
    return Array.isArray(raw) ? raw.map(String) : JSON.parse(String(raw ?? "[]")).map(String);
  } catch {
    return [];
  }
};

/** Who sits in a role, read raw. */
const seatedIn = async (roleId: string): Promise<Array<{ userId: string; grantedBy: string }>> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT user_id, granted_by FROM role_holders WHERE role_id = ? ORDER BY user_id",
    [roleId],
  );
  return rows.map((r) => ({ userId: String(r.user_id), grantedBy: String(r.granted_by ?? "") }));
};

/** Every line the VILLAGE can read. Audience public, examples out. */
const publicPulse = async (): Promise<string[]> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT text FROM health_events WHERE audience = 'public' AND is_example = 0 ORDER BY at DESC, id DESC LIMIT 100",
  );
  return rows.map((r) => String(r.text));
};

/**
 * Everybody says yes, the clock runs out, a MEMBER closes it, AND IT LANDS.
 *
 * The closer is Rhoda throughout this file and never the founder, because a
 * chain with an admin closing the ballot is a chain with an admin in it.
 *
 * THE LANDING STEP IS NEW, and it is here because declaring a role changes
 * the Game. Such a decision is stamped with a landing instant at the close
 * rather than executed there, and a steward may stop it until that instant.
 * Nothing in this file is about the window, so the fixture runs the clock out
 * and calls the landing path, which is what the five-minute job does on its
 * own in a running village. Seating and unseating carry no window at all and
 * take effect at the close, so for those this step finds nothing due.
 */
async function carry(ballotId: string, outcomeNote: string): Promise<Answer> {
  for (const t of [founderToken, rhodaToken, solToken, tamToken]) {
    const r = await call("POST", `/api/governance/ballots/${ballotId}/vote`, { token: t, body: { choice: "yes" } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  }
  await expire(ballotId);
  const closed = await call("POST", `/api/governance/ballots/${ballotId}/close`, {
    token: rhodaToken,
    body: { outcomeNote },
  });
  await land(ballotId);
  return closed;
}

/** The window runs out with nobody stopping it, and the landing path runs. */
async function land(ballotId: string): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "UPDATE ballots SET lands_at = DATE_SUB(NOW(), INTERVAL 1 HOUR), veto_closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) " +
      "WHERE id = ? AND lands_at IS NOT NULL",
    [ballotId],
  );
  await call("POST", "/api/admin/cycles/close", { body: {} });
}

const ROLE_ID = "game-steward";

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the steward route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-steward-"));
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
      AUTH_TOKEN_SECRET: "steward-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Steward Founder" },
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
  /*
   * NO PROGRESSION EXAMPLES ARE ARRANGED HERE, and the reason belongs beside
   * the attempt. The declaring executor stands the platform's example roles
   * down the way the admin route does, and there is no case for it in this
   * file because `progression` is a CORE module: its lifecycle cannot be set,
   * its examples seed at boot, and every village this harness provisions comes
   * up with none of them standing. An assertion over an empty set reads green
   * and proves nothing.
   */

  const rhoda = await register("Rhoda Vane", "rhoda");
  rhodaToken = rhoda.token; rhodaId = rhoda.id;
  const sol = await register("Sol Amery", "sol");
  solToken = sol.token; solId = sol.id;
  const tam = await register("Tam Orr", "tam");
  tamToken = tam.token; tamId = tam.id;

  /*
   * Everybody reaches member so `ballot.vote` unlocks and the roll is real.
   * Rhoda goes to co-creator, the rung `proposal.open` unlocks at, so she
   * holds it as a MEMBER of this village rather than as its operator. The
   * FOUNDER is pinned at member on purpose, so a refusal is the design working
   * and never an accident of where a bootstrap account starts.
   */
  for (const [id, stage] of [
    [founderId, "member"],
    [rhodaId, "co-creator"],
    [solId, "member"],
    [tamId, "member"],
  ] as const) {
    const r = await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId: stage } });
    expect(r.status, `${id} reaches ${stage}`).toBe(200);
  }
}, 180_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("a village with no steward works completely", () => {
  it("has no such role, and nothing in the product asks after one", async () => {
    /*
     * THE RULING'S FIRST PROPERTY, DRIVEN. "A village may choose to not vote
     * for this role at all", and a mature one "may not even need to vote this
     * role in". So a village that never opens any of the three votes in this
     * file has to be a whole village, and nothing may be seeded, flagged or
     * named after a steward.
     */
    expect(await roleRow(ROLE_ID)).toBeNull();
    const roles = await call("GET", "/api/roles", { token: rhodaToken });
    expect(roles.status).toBe(200);
    const names = (roles.json ?? []).map((r: any) => String(r.name).toLowerCase());
    expect(names.some((n: string) => n.includes("steward circle")), "the seeded roles are here").toBe(true);
    expect(names.some((n: string) => n === "game steward")).toBe(false);
  });

  it("governs, decides and reads its own powers with no steward anywhere", async () => {
    // The ordinary surfaces of a village, driven by a member on a village that
    // has voted no role into existence. Each of these is a whole feature.
    expect((await call("GET", "/api/governance/ballots", { token: rhodaToken })).status).toBe(200);
    expect((await call("GET", "/api/village/powers", { token: rhodaToken })).status).toBe(200);
    expect((await call("GET", "/api/game/pulse", { token: null })).status).toBe(200);

    // And a member can open an ordinary vote, which is the thing a village
    // needs most and needs no role at all to do.
    const ordinary = await call("POST", "/api/governance/power-grants", {
      token: rhodaToken,
      body: {
        capability: "library.keep",
        roleId: "steward-circle",
        reason: "A control: the runway a village already had, opened on a seeded role with no steward in this village.",
      },
    });
    expect(ordinary.status, JSON.stringify(ordinary.json)).toBe(200);
    // Withdrawn again so the seeded role's capabilities stay where this file
    // found them, and every later assertion is about the declared role alone.
    const id = String(ordinary.json?.ballot?.id ?? "");
    expect((await call("POST", `/api/governance/ballots/${id}/withdraw`, {
      token: rhodaToken,
      body: { reason: "A control, withdrawn." },
    })).status).toBe(200);
  });
});

describe.skipIf(!DB_CONFIGURED)("the village votes a role into existence", () => {
  let ballotId = "";

  it("refuses an administrator, whose only path to proposal.open is being one", async () => {
    const refused = await call("POST", "/api/governance/role-declarations", {
      body: { name: "Game Steward", purpose: "Looks after the library between gatherings and keeps the lending honest." },
    });
    expect(refused.status, JSON.stringify(refused.json)).toBe(403);
    expect(refused.json?.adminOnly).toBe(true);
    expect(String(refused.json?.error)).toContain("Declaring a role");
  });

  it("refuses a member who holds proposal.open nowhere at all", async () => {
    const refused = await call("POST", "/api/governance/role-declarations", {
      token: tamToken,
      body: { name: "Game Steward", purpose: "Looks after the library between gatherings and keeps the lending honest." },
    });
    expect(refused.status).toBe(403);
    expect(await roleRow(ROLE_ID)).toBeNull();
  });

  it("asks the whole village, and says the role would carry nothing", async () => {
    const opened = await call("POST", "/api/governance/role-declarations", {
      token: rhodaToken,
      body: {
        name: "Game Steward",
        purpose: "Looks after the library between gatherings, keeps the lending honest, and answers for it at the gathering.",
      },
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    ballotId = String(opened.json?.ballot?.id ?? "");
    expect(ballotId).toMatch(/^bal-/);
    expect(opened.json?.ballot?.subjectType).toBe("role_declare");
    expect(opened.json?.ballot?.subjectRef).toBe(ROLE_ID);
    // A vote that BINDS, derived off the closer table and never asserted by
    // the route, so "this decides something" cannot drift from what closing
    // actually does.
    expect(opened.json?.ballot?.binding).toBe(true);
    expect(String(opened.json?.ballot?.docMarkdown)).toContain("carries no powers at all");

    // Nothing exists yet. A vote is a question.
    expect(await roleRow(ROLE_ID)).toBeNull();
  });

  it("creates the role on carrying, and it carries nothing", async () => {
    const closed = await carry(ballotId, "We want somebody looking after the library, and this names the job.");
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("passed");
    /*
     * `applied` STAYS EMPTY. The outcome card renders each applied key as
     * "<key> now holds the value the village voted for", which is written for
     * a mechanics amendment and would be false about a role coming into
     * existence.
     */
    expect(closed.json?.applied).toEqual([]);

    const row = await roleRow(ROLE_ID);
    expect(row, "the role exists now").toBeTruthy();
    expect(String(row.name)).toBe("Game Steward");
    expect(String(row.description)).toContain("keeps the lending honest");
    expect(await roleCapabilities(ROLE_ID), "a declared role carries nothing").toEqual([]);
    expect(await seatedIn(ROLE_ID), "and nobody sits in it").toEqual([]);

    // The village's own record of it, on the PUBLIC pulse.
    const pulse = await publicPulse();
    expect(pulse.some((t) => t.includes("Game Steward is one of this village's roles now"))).toBe(true);
  });

  /*
   * NOT ASSERTED HERE, AND SAID RATHER THAN LEFT OUT: the executor also calls
   * `onRealItemPublished(pool, "progression")`, so a village declaring its own
   * role stands the platform's example roles down exactly as an admin editing
   * one into existence does. It has no case in this file because the premise
   * could not be arranged: `progression` is a CORE module, so its lifecycle
   * cannot be set and its examples seed at boot, and every village this
   * harness provisions comes up with zero example roles standing. An assertion
   * over an empty set would have read green while proving nothing, which is
   * the exact shape this round keeps paying for.
   */

  it("refuses a second declaration of a role that now exists", async () => {
    const again = await call("POST", "/api/governance/role-declarations", {
      token: rhodaToken,
      body: { name: "Game Steward", purpose: "The same role again, which this village already has and does not need twice." },
    });
    expect(again.status).toBe(409);
    expect(String(again.json?.error)).toContain("already has a role by that name");
  });
});

describe.skipIf(!DB_CONFIGURED)("the village gives it a power, and seats somebody in it", () => {
  it("cannot do the work before any of it, which is the state this exists for", async () => {
    const early = await call("POST", "/api/admin/library/adjust", {
      token: solToken,
      body: { userId: "nobody-at-all", credits: 1 },
    });
    expect(early.status).toBe(401);
  });

  it("votes library.keep onto the declared role, through the runway that already existed", async () => {
    const opened = await call("POST", "/api/governance/power-grants", {
      token: rhodaToken,
      body: {
        capability: "library.keep",
        roleId: ROLE_ID,
        reason: "The role the village just declared is the one that should be able to work the library it looks after.",
      },
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const closed = await carry(String(opened.json.ballot.id), "The role we made should be able to do the job we made it for.");
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("passed");
    expect(await roleCapabilities(ROLE_ID)).toContain("library.keep");

    // A power on an empty role is still nobody's power.
    const stillNobody = await call("POST", "/api/admin/library/adjust", {
      token: solToken,
      body: { userId: "nobody-at-all", credits: 1 },
    });
    expect(stillNobody.status).toBe(401);
  });

  it("names in the document exactly what the person would be able to do", async () => {
    const opened = await call("POST", "/api/governance/role-seats", {
      token: rhodaToken,
      body: {
        userId: solId,
        roleId: ROLE_ID,
        reason: "Sol has been carrying the lending book by hand all season and everybody already asks them.",
      },
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    expect(opened.json?.ballot?.subjectType).toBe("role_seat");
    expect(opened.json?.ballot?.subjectRef).toBe(`${solId}@${ROLE_ID}`);
    expect(opened.json?.ballot?.binding).toBe(true);
    const doc = String(opened.json?.ballot?.docMarkdown);
    expect(doc).toContain("with no further vote");
    expect(doc).toContain("The village can vote this seat back at any time");

    const closed = await carry(String(opened.json.ballot.id), "Sol already does this. This makes it the village's decision.");
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("passed");

    const seats = await seatedIn(ROLE_ID);
    expect(seats.map((s) => s.userId)).toEqual([solId]);
    // The BALLOT is the grantor, because the village seated them. Naming the
    // person who closed the vote would say somebody appointed what a vote
    // decided.
    expect(seats[0].grantedBy).toMatch(/^bal-/);

    const pulse = await publicPulse();
    expect(pulse.some((t) => t.includes("sits in Game Steward, by a vote of the whole village"))).toBe(true);
  });

  it("ACTS IMMEDIATELY on the power it was given, with no further vote and nobody to ask", async () => {
    /*
     * THE PROPERTY R90 NAMES: "give various powers to this steward to
     * immediately act". Nothing extra makes this true. The one gate reads the
     * holder rows and the role's capability list on every request with no
     * cache in between, so the seat landing IS the power arriving.
     */
    const acted = await call("POST", "/api/admin/library/adjust", {
      token: solToken,
      body: { userId: tamId, credits: 2 },
    });
    expect(acted.status, JSON.stringify(acted.json)).toBe(200);

    // And it is the SEAT and not the person. Tam, who was never seated, still
    // cannot, which is the control that makes the line above mean something.
    const tamTries = await call("POST", "/api/admin/library/adjust", {
      token: tamToken,
      body: { userId: solId, credits: 2 },
    });
    expect(tamTries.status).toBe(401);
  });

  it("refuses to seat the same person twice", async () => {
    const again = await call("POST", "/api/governance/role-seats", {
      token: rhodaToken,
      body: { userId: solId, roleId: ROLE_ID, reason: "The same seating again, which the village has already decided once." },
    });
    expect(again.status).toBe(409);
    expect(String(again.json?.error)).toContain("already sits in");
  });
});

describe.skipIf(!DB_CONFIGURED)("voted in means voteable out", () => {
  it("asks the village, and says what the person would stop being able to do", async () => {
    const opened = await call("POST", "/api/governance/role-unseats", {
      token: rhodaToken,
      body: {
        userId: solId,
        roleId: ROLE_ID,
        reason: "Sol is away for the winter and asked the village to take this back until they return.",
      },
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    expect(opened.json?.ballot?.subjectType).toBe("role_unseat");
    expect(opened.json?.ballot?.binding).toBe(true);
    const doc = String(opened.json?.ballot?.docMarkdown);
    expect(doc).toContain("stops sitting in Game Steward");
    // R55: a village handing something back is being honest about its
    // capacity. Nothing here reads as a failure or a dismissal.
    expect(doc.toLowerCase()).not.toContain("failed");
    expect(doc).toContain("keeps everything it carries");

    const closed = await carry(String(opened.json.ballot.id), "Sol asked for this and the village agrees.");
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("passed");
    expect(await seatedIn(ROLE_ID)).toEqual([]);
  });

  it("and the power goes with the seat, on the very next request", async () => {
    const refused = await call("POST", "/api/admin/library/adjust", {
      token: solToken,
      body: { userId: tamId, credits: 1 },
    });
    expect(refused.status).toBe(401);

    // The ROLE keeps what the village voted onto it. Taking a seat back is not
    // taking a power back, and a village that wants that votes for that.
    expect(await roleCapabilities(ROLE_ID)).toContain("library.keep");
  });

  it("refuses to take back a seat nobody is sitting in", async () => {
    const again = await call("POST", "/api/governance/role-unseats", {
      token: rhodaToken,
      body: { userId: solId, roleId: ROLE_ID, reason: "A second ask about a seat this village has already emptied by vote." },
    });
    expect(again.status).toBe(409);
    expect(String(again.json?.error)).toContain("no seat to take back");
  });
});

describe.skipIf(!DB_CONFIGURED)("what these votes deliberately cannot do", () => {
  it("will not seat anybody into a role that carries the vote itself", async () => {
    /*
     * `power_grant` refuses to put `ballot.vote` or `member.vouch` ON a role,
     * because a role is a set of people through its seats. This route is the
     * seating half of the same path, and it is fenced for the same reason.
     * Nothing a village can do reaches this today, so the FIXTURE puts the key
     * there through the admin route that writes a role's capability list. That
     * route writes through the repo, so the running server sees it, which a
     * raw UPDATE would not: role capabilities are a memory-cached collection
     * and a hand-written row is invisible until reboot.
     */
    const armed = await call("PUT", `/api/admin/roles/${ROLE_ID}/capabilities`, {
      body: { capabilities: ["library.keep", "ballot.vote"], grantedEscalations: ["ballot.vote"] },
    });
    expect(armed.status, JSON.stringify(armed.json)).toBe(200);
    expect(await roleCapabilities(ROLE_ID), "the fixture landed").toContain("ballot.vote");

    const refused = await call("POST", "/api/governance/role-seats", {
      token: rhodaToken,
      body: { userId: tamId, roleId: ROLE_ID, reason: "A seating into a role that carries the vote, which must never be votable." },
    });
    expect(refused.status).toBe(409);
    expect(String(refused.json?.error)).toContain("choosing who else gets a say");
    expect(await seatedIn(ROLE_ID)).toEqual([]);

    // Put the role back the way the village left it.
    const restored = await call("PUT", `/api/admin/roles/${ROLE_ID}/capabilities`, {
      body: { capabilities: ["library.keep"], grantedEscalations: [] },
    });
    expect(restored.status, JSON.stringify(restored.json)).toBe(200);
    expect(await roleCapabilities(ROLE_ID)).toEqual(["library.keep"]);
  });

  it("will not declare a role out of a name with nothing in it", async () => {
    const refused = await call("POST", "/api/governance/role-declarations", {
      token: rhodaToken,
      body: { name: "!!!", purpose: "A name with no letters or numbers in it, which cannot become a role id at all." },
    });
    expect(refused.status).toBe(400);
    expect(String(refused.json?.error)).toContain("no letters or numbers");
  });

  it("will not open any of the three without the village being told why", async () => {
    // The whole roll reads the document before voting, so every one of these
    // asks for a reason in the opener's own words.
    const thin = await call("POST", "/api/governance/role-seats", {
      token: rhodaToken,
      body: { userId: tamId, roleId: ROLE_ID, reason: "because" },
    });
    expect(thin.status).toBe(400);
    expect(String(thin.json?.error)).toContain("The whole roll reads this");
  });
});
