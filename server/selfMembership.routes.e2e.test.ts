/**
 * ONE REQUEST BOUGHT A PERMANENT VOTE. THIS DRIVES THE WHOLE CHAIN.
 *
 * Six links, each of them correct on its own, and the composition was the
 * defect. That is why this suite never asserts on one link:
 *
 *   1. `POST /api/forms/submit` read `type` straight off the request body with
 *      no allowlist anywhere in the handler, and stamped `userId` from the
 *      caller's own token.
 *   2. `hasMembership` answered true for any submission whose `type` was
 *      `membership-508` and whose `userId` matched.
 *   3. The `member` rung's rule is `{ type: "membership" }`.
 *   4. `computeStage` takes the MAX of every satisfied rule.
 *   5. `ballot.vote` unlocks at `member`.
 *   6. `buildElectorate` admits everyone the capability system says holds it.
 *
 * So any signed-in account named its own type once and stood on every roll
 * built afterwards, for good. A test that checked `hasMembership` alone would
 * have gone green against a fix that left the roll wrong, and a test that
 * checked the roll alone would not have said which link moved. This one walks
 * from the HTTP request to the count on the roll.
 *
 * THE CONTROLS ARE THE POINT. Every refusal below is proved against something
 * known to be present in the same case: a member who reached the rung the
 * honest way stays on the roll in the same assertion that takes the attacker
 * off it, and an allowed form type is posted in the same case that refuses a
 * forged one. A guard that refuses everything passes a test that only asks
 * whether the attack failed.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL. The cases run IN ORDER.
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
  console.warn("[selfMembership.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 27202 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "self-membership-admin";
const PASSWORD = "SelfMembership123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
/** Reached `member` the honest way, by a founder's stage grant. The control. */
let wrenToken = "";
let wrenId = "";
/** The same, so the roll has a real shape rather than a single row. */
let idaId = "";
/** A frozen legacy member: `membership_granted`, the 0058 freeze's own record. */
let orlaToken = "";
let orlaId = "";
/** An ordinary account with no standing at all. The attacker. */
let malloryToken = "";
let malloryId = "";

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

/** The signature of the Love Letter, exactly as `LoveLetter.tsx` sends it. */
const SIGNING = {
  name: "Mallory Vane",
  email: "mallory@example.test",
  phone: "",
  paths: ["resident"],
  why: "I would like to belong here.",
  monthlyContribution: "108",
  acknowledgedGoodNeighbor: true,
  acknowledgedCommitments: true,
  signedAt: new Date().toISOString(),
};

/** How many people the live roll holds right now, straight through the gate. */
async function onTheRoll(): Promise<number> {
  const status = await call("GET", "/api/admin/launch");
  expect(status.status, JSON.stringify(status.json)).toBe(200);
  const n = status.json?.vote?.onTheRoll;
  expect(typeof n, `onTheRoll must be a number, got ${JSON.stringify(status.json?.vote)}`).toBe("number");
  return Number(n);
}

/** What one account holds, as the product reports it back to that person. */
async function standingOf(token: string): Promise<{ stage: string; membership: boolean; caps: string[] }> {
  const me = await call("GET", "/api/game/me", { token });
  expect(me.status, JSON.stringify(me.json)).toBe(200);
  return {
    stage: String(me.json?.stage?.id ?? me.json?.stage ?? ""),
    membership: me.json?.membership === true,
    caps: Array.isArray(me.json?.capabilities) ? me.json.capabilities.map(String) : [],
  };
}

/**
 * Forget the submission rate limit, which is a different guard than the one
 * under test. The route caps six posts per ten minutes per IP, every case here
 * dials from the same localhost, and the cap is no defence against this attack
 * anyway: one request was always enough. Clearing the window keeps a 429 from
 * standing in for a refusal the allowlist should be the one to give.
 */
async function forgetTheRateWindow(): Promise<void> {
  await pool.query("DELETE FROM rate_hits WHERE bucket LIKE 'submit:%'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
}

async function submissionsOfType(type: string): Promise<any[]> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT id, type, status, user_id FROM submissions WHERE type = ? ORDER BY submitted_at, id",
    [type],
  );
  return rows;
}

async function register(name: string, handle: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    body: { name, email: `${handle}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
    token: null,
  });
  expect(r.status, `${name} must register: ${JSON.stringify(r.json)}`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the self membership test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-self-membership-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds

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
      AUTH_TOKEN_SECRET: "self-membership-secret",
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
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Self Membership Founder" },
    token: null,
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", {
    body: { token: claim, password: PASSWORD },
    token: null,
  });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  for (const mod of ["governance", "map"]) {
    const on = await call("PUT", `/api/admin/modules/${mod}/lifecycle`, {
      body: { lifecycle: "members", examples: false },
    });
    expect(on.status, `${mod} must be on for this suite`).toBe(200);
  }

  const wren = await register("Wren Ashby", "wren");
  wrenToken = wren.token; wrenId = wren.id;
  idaId = (await register("Ida Kestrel", "ida")).id;
  const orla = await register("Orla Finch", "orla");
  orlaToken = orla.token; orlaId = orla.id;
  const mallory = await register("Mallory Vane", "mallory");
  malloryToken = mallory.token; malloryId = mallory.id;

  // Three people reach `member` the way the village grants it. This is the
  // roll the attack has to be measured against: a fix that empties the roll
  // also refuses the attacker, and would be worthless.
  for (const id of [founderId, wrenId, idaId]) {
    const r = await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId: "member" } });
    expect(r.status, `${id} reaches member`).toBe(200);
  }

  /*
   * Orla is a FROZEN member and the only kind of member this deployment
   * actually has through the membership rule. `freezeEmailMatchedMemberships`
   * converted the email-matched members of the pre-0058 era into this flag,
   * once, and no route in the tree sets it. So the flag is written here the
   * way the migration wrote it, because a village running this today has
   * people whose entire claim to standing is that column.
   */
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "UPDATE users SET membership_granted = 1 WHERE id = ?",
    [orlaId],
  );
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("the village as it stands, before anybody reaches for anything", () => {
  it("seats the people who reached the rung honestly, and nobody else", async () => {
    // Founder, Wren and Ida by stage grant; Orla by the frozen flag. Four.
    expect(await onTheRoll()).toBe(4);

    const orla = await standingOf(orlaToken);
    expect(orla.membership, "a frozen member still holds membership").toBe(true);
    expect(orla.stage).toBe("member");
    expect(orla.caps).toContain("ballot.vote");

    // And the attacker starts with nothing, which is what makes the next
    // case a measurement rather than a coincidence.
    const mallory = await standingOf(malloryToken);
    expect(mallory.membership).toBe(false);
    expect(mallory.stage).not.toBe("member");
    expect(mallory.caps).not.toContain("ballot.vote");
  });
});

describe.skipIf(!DB_CONFIGURED)("a signed-in account names its own type", () => {
  let selfIssued = "";

  it("still takes the signature, because signing is something a person may do", async () => {
    await forgetTheRateWindow();
    const before = await onTheRoll();
    const posted = await call("POST", "/api/forms/submit", {
      token: malloryToken,
      body: { type: "membership-508", data: SIGNING },
    });
    expect(posted.status, JSON.stringify(posted.json)).toBe(200);
    expect(posted.json?.success).toBe(true);
    selfIssued = String(posted.json?.id ?? "");
    expect(selfIssued, "the signing is kept, so the village can act on it").toBeTruthy();

    // The row exists, it is attributed, and it is waiting. All three matter:
    // a fix that dropped the row would lose a real person's request.
    const rows = await submissionsOfType("membership-508");
    expect(rows.length).toBe(1);
    expect(String(rows[0].user_id)).toBe(malloryId);
    expect(String(rows[0].status)).toBe("new");

    expect(await onTheRoll(), "the roll did not move when the letter was signed").toBe(before);
  });

  it("DOES NOT BUY A VOTE, which is the whole defect", async () => {
    const mallory = await standingOf(malloryToken);
    expect(mallory.membership, "signing is not being admitted").toBe(false);
    expect(mallory.stage, "the rung is the village's to give").not.toBe("member");
    expect(mallory.caps).not.toContain("ballot.vote");

    // Link six, driven rather than reasoned about: the roll built AFTER the
    // request still holds exactly the four who earned their place.
    expect(await onTheRoll()).toBe(4);
  });

  it("cannot be bought by asking again, or by asking twice", async () => {
    await forgetTheRateWindow();
    for (let i = 0; i < 2; i += 1) {
      const again = await call("POST", "/api/forms/submit", {
        token: malloryToken,
        body: { type: "membership-508", data: { ...SIGNING, why: `attempt ${i}` } },
      });
      expect(again.status).toBe(200);
    }
    expect((await standingOf(malloryToken)).membership).toBe(false);
    expect(await onTheRoll()).toBe(4);
  });

  it("is admitted when the village says yes, and only then", async () => {
    const moved = await call("PUT", `/api/admin/submissions/${selfIssued}/status`, {
      body: { status: "accepted" },
    });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);

    const mallory = await standingOf(malloryToken);
    expect(mallory.membership, "an accepted signing is an admission").toBe(true);
    expect(mallory.stage).toBe("member");
    expect(mallory.caps).toContain("ballot.vote");
    expect(await onTheRoll()).toBe(5);

    // And the people who were already here are still here. This is the half
    // that a security fix gets wrong: taking standing back off somebody who
    // earned it is the same harm in a different coat.
    expect((await standingOf(orlaToken)).membership, "the frozen member kept their place").toBe(true);
    expect((await standingOf(wrenToken)).stage, "a stage grant still stands").toBe("member");
  });
});

describe.skipIf(!DB_CONFIGURED)("a submitted form cannot name its own type", () => {
  it("still takes every type the village actually collects", async () => {
    await forgetTheRateWindow();
    // The control, in the same case as the refusals below: a guard that
    // refused everything would pass a test that only checked the attack.
    for (const type of ["visit-inquiry", "work-with-us", "steward-interest", "contact", "quest-proposal"]) {
      const ok = await call("POST", "/api/forms/submit", {
        token: null,
        body: { type, data: { name: "A Stranger", email: `${type}@example.test` } },
      });
      expect(ok.status, `${type} is a real form: ${JSON.stringify(ok.json)}`).toBe(200);
      expect(ok.json?.success).toBe(true);
    }
  });

  it("refuses a type nobody built a form for, in a sentence a person can read", async () => {
    await forgetTheRateWindow();
    const made = await call("POST", "/api/forms/submit", {
      token: malloryToken,
      body: { type: "board-of-directors", data: { name: "Mallory Vane" } },
    });
    expect(made.status).toBe(400);
    expect(String(made.json?.error)).toBe("unknown_form_type");
    expect(String(made.json?.message ?? "").length, "a refusal says something").toBeGreaterThan(20);
    expect(String(made.json?.message ?? "")).not.toContain("board-of-directors");
    expect(await submissionsOfType("board-of-directors")).toEqual([]);
  });

  it("refuses the types only the village's own routes are allowed to write", async () => {
    await forgetTheRateWindow();
    // `role-application` is written by raise-hand and `investor-doc-request`
    // by the investor packet route. Both land in the same inbox a founder
    // works, so forging one puts a lie in front of a person making decisions.
    for (const type of ["role-application", "investor-doc-request"]) {
      const forged = await call("POST", "/api/forms/submit", {
        token: malloryToken,
        body: { type, data: { roleName: "Water keeper", name: "Mallory Vane" } },
      });
      expect(forged.status, `${type} must not be forgeable`).toBe(400);
      expect(String(forged.json?.error)).toBe("unknown_form_type");
      expect(await submissionsOfType(type)).toEqual([]);
    }
  });

  it("refuses a type that is not a string at all", async () => {
    await forgetTheRateWindow();
    for (const type of [{ toString: () => "membership-508" }, ["membership-508"], 508]) {
      const odd = await call("POST", "/api/forms/submit", {
        token: malloryToken,
        body: { type, data: SIGNING },
      });
      expect([400], `a ${typeof type} type is refused`).toContain(odd.status);
    }
    // Nothing crept in under a shape the allowlist did not read as a string.
    expect((await submissionsOfType("membership-508")).length).toBe(3);
  });

  it("leaves the raise-hand route writing its own type, which the form cannot", async () => {
    // The proof that the allowlist guards the DOOR and not the vocabulary:
    // the seat route still writes `role-application` for a real member.
    const seat = await call("POST", "/api/admin/org/roles", {
      body: { id: "self-membership-well", name: "Well keeper", seats: 1 },
    });
    expect(seat.status, JSON.stringify(seat.json)).toBe(200);
    const raised = await call("POST", "/api/map/roles/self-membership-well/raise-hand", {
      token: wrenToken,
      body: { note: "I know the well." },
    });
    expect(raised.status, JSON.stringify(raised.json)).toBe(200);
    const rows = await submissionsOfType("role-application");
    expect(rows.length, "the village's own route still writes it").toBe(1);
    expect(String(rows[0].user_id)).toBe(wrenId);
  });
});

/*
 * A GUEST THE VILLAGE PAYS DOES NOT CLIMB PAST THE DOOR.
 *
 * The chain in the header, one rung higher. Contributor is the rung the village
 * pays you onto and it sits above Member, and `computeStage` took the MAX of
 * every satisfied rule without asking whether the person had been admitted. So
 * one hand-mint put a guest on every roll and opened `member.vouch` for them,
 * and a steward could name a guest a contributor to the same effect.
 *
 * The pay goes through the village's own mint route, the way a steward pays
 * somebody, and every refusal is measured beside a member the same act lifts.
 */
describe.skipIf(!DB_CONFIGURED)("a guest the village pays does not climb past the door", () => {
  let paxToken = "";
  let paxId = "";

  /** Pay one account through the village's hand-mint, under the second-steward threshold. */
  async function payByTheVillage(userId: string): Promise<void> {
    const paid = await call("POST", "/api/admin/tokens/stay-credit/mint", {
      body: { toUserId: userId, amount: 5, reason: "Rebuilt the gate hinge by the well." },
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  }

  it("keeps a paid guest a Guest, while the same pay lifts a member to Contributor", async () => {
    const pax = await register("Pax Merrow", "pax");
    paxToken = pax.token;
    paxId = pax.id;
    const before = await onTheRoll();

    await payByTheVillage(paxId);
    await payByTheVillage(wrenId);

    const paid = await standingOf(paxToken);
    expect(paid.membership).toBe(false);
    expect(paid.stage, "being paid is not being admitted").toBe("guest");
    expect(paid.caps).not.toContain("ballot.vote");
    expect(paid.caps).not.toContain("member.vouch");

    // THE CONTROL, in the same case: Wren reached Member by a stage grant, and
    // the same mint carries her to the rung that opens vouching.
    const wren = await standingOf(wrenToken);
    expect(wren.stage).toBe("contributor");
    expect(wren.caps).toContain("member.vouch");

    expect(await onTheRoll(), "a paid guest is not on the roll").toBe(before);
  });

  it("refuses to let a steward name a guest a contributor, and still names a member", async () => {
    const refused = await call("POST", `/api/members/${paxId}/contributor`);
    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(String(refused.json?.error ?? "")).toContain("not a member");
    expect((await standingOf(paxToken)).stage, "the refusal wrote nothing").toBe("guest");

    const named = await call("POST", `/api/members/${idaId}/contributor`);
    expect(named.status, JSON.stringify(named.json)).toBe(200);
    expect(named.json?.changed).toBe(true);
    expect(named.json?.stage).toBe("contributor");
  });

  it("opens once the village lets them in, and the pay they already had then counts", async () => {
    const before = await onTheRoll();
    const admitted = await call("POST", `/api/members/${paxId}/super-vouch`);
    expect(admitted.status, JSON.stringify(admitted.json)).toBe(200);
    expect(admitted.json?.admitted).toBe(true);

    const pax = await standingOf(paxToken);
    expect(pax.membership).toBe(true);
    expect(pax.stage, "admitted, and already paid").toBe("contributor");
    expect(pax.caps).toContain("member.vouch");
    expect(await onTheRoll()).toBe(before + 1);
  });
});
