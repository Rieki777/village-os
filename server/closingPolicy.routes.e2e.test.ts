/**
 * WHAT CLOSING THIS VILLAGE MEANS, DRIVEN against the built server.
 *
 * Rye, 2026-09-25: "before you launch the village you have to articulate what
 * it means to close a village ... one does need to be agreed to name upon
 * before launching." And, asked the binary: proportional to the balances held
 * on closing day, with a member who already redeemed receiving nothing more.
 *
 * The harm this file measures is one sentence, and every clause is driven
 * over HTTP rather than asserted about:
 *
 *   A village whose journey is otherwise complete is told "no" by the launch
 *   vote until it names what closing means; the pre-filled default does not
 *   count until somebody adopts it; only the exit policy's writers can adopt
 *   it; every reader sees it without learning who adopted it; and the
 *   redemption screen says what redeeming gives up exactly when that is true.
 *
 * THE CASES RUN IN ORDER on one village, from "no" to "yes". Run the whole
 * file, never a `-t` slice.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { PURPOSE_EXAMPLE } from "../shared/governingPurpose";
import { CLOSING_REDEMPTION_NOTICE, PROPORTIONAL_CLOSING_STATEMENT } from "../shared/closingPolicies";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[closingPolicy.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// A window checked by scripts/check-e2e-ports.mjs, never claimed by hand here.
const PORT = 3500 + (process.pid % 100);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "closing-admin";
const PASSWORD = "ClosingTest123!";
const ROW = "Name what closing this village means";

const OWN_WORDS =
  "If this village closes, the land passes to the parish land trust and the cash is shared among the members still living here.";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
let wrenToken = "";

interface Answer { status: number; json: any; text: string }

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
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* a non-JSON answer stays readable through text */ }
  return { status: res.status, json, text };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    token: "",
    body: { name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** The exit policy document exactly as stored, read raw and never off a payload. */
const storedPolicy = async (): Promise<any | null> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT value FROM app_config WHERE config_key = 'exit-policy'",
  );
  if (!rows[0]) return null;
  return typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
};

/** How many launch ballots exist, read raw: a refused ask must leave none. */
const launchBallotCount = async (): Promise<number> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT COUNT(*) AS n FROM ballots WHERE subject_type = 'village_launch'",
  );
  return Number(rows[0]?.n ?? 0);
};

/** The closing row off the live checklist, and the ids of every blocking row still open. */
async function closingRow(): Promise<{ item: any; openBlocking: string[] }> {
  const r = await call("GET", "/api/admin/launch");
  expect(r.status, "the launch checklist must answer").toBe(200);
  const items: any[] = r.json?.items ?? [];
  const item = items.find((i) => i.id === "closing-policy-named");
  expect(item, "the checklist must carry the closing-policy-named row").toBeTruthy();
  return { item, openBlocking: items.filter((i) => i.severity === "blocking" && i.state !== "ok").map((i) => i.id) };
}

const TERMS = {
  placeholder: false,
  voluntary: {
    noticePeriodDays: 21,
    valuationMethod: "A leaving member is paid the value the last cycle settled, in full, within one lunation.",
    unwindSteps: [
      "Bring back anything borrowed from the barn",
      "Finish or hand on the work you are holding",
      "The stewards settle what is owed and write it down",
    ],
  },
  involuntary: {
    decidingDomainId: "",
    appealDomainId: "",
    process: "Two stewards sit with the person first. Nothing formal begins until that conversation has happened.",
  },
  restorative: {
    intakeContactRole: "",
    steps: [
      "Somebody who was not involved hears both people",
      "The village agrees what would put it right",
      "Whoever asked for this says whether it did",
    ],
  },
};

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the closing policy route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-closing-"));
  // A village that has NOT started its Game: the launch vote is the subject.
  testDb = await provisionTestDb({ gameStarted: false });
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

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
      AUTH_TOKEN_SECRET: "closing-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", {
    token: "",
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Closing Founder" },
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: "", body: { token: claim, password: PASSWORD } });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  expect((await call("PUT", "/api/admin/modules/governance/lifecycle", {
    body: { lifecycle: "members", examples: false },
  })).status, "governance must be on for the launch vote").toBe(200);

  // Three on the roll, so the only thing between this village and its vote is
  // the row under test.
  const wren = await register("Wren Ashby", "wren");
  wrenToken = wren.token;
  const ida = await register("Ida Kestrel", "ida");
  for (const id of [founderId, wren.id, ida.id]) {
    expect((await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId: "member" } })).status).toBe(200);
  }

  /*
   * THE REST OF THE JOURNEY, CLEARED the way server/launchVote.routes.e2e.test.ts
   * clears it, so the first case can assert that closing is the ONE row left.
   */
  expect((await call("PUT", "/api/admin/brand", {
    body: { project: { name: "Hollowmere", tagline: "A village by the water", location: "The fens" } },
  })).status).toBe(200);
  const terms = await call("PUT", "/api/admin/exit-policy", { body: TERMS });
  expect(terms.status, terms.text).toBe(200);
  expect((await call("POST", "/api/admin/launch/confirm", { body: { id: "backups-drilled", done: true } })).status).toBe(200);
  expect((await call("POST", "/api/admin/launch/confirm", { body: { id: "issuance-cap", done: "declined" } })).status).toBe(200);
  expect((await call("PUT", "/api/admin/purpose", { body: { statement: PURPOSE_EXAMPLE } })).status).toBe(200);
}, 240_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("silence cannot launch", () => {
  it("a village that has not named closing is told no by the launch vote, and the no names the row", async () => {
    const { item, openBlocking } = await closingRow();
    expect(item.severity).toBe("blocking");
    expect(item.state).toBe("missing");
    expect(item.detail).toMatch(/Nothing is named yet/);
    expect(openBlocking, "the rest of the journey is cleared, so closing is the one row left").toEqual([
      "closing-policy-named",
    ]);

    const no = await call("POST", "/api/admin/launch/propose", { body: { slate: [founderId] } });
    expect(no.status, no.text).toBe(409);
    expect(no.json?.open).toEqual([ROW]);
    expect(await launchBallotCount()).toBe(0);
  });

  it("only the exit policy's writers can change it", async () => {
    const body = { policyId: "proportional-closing-balance", statement: PROPORTIONAL_CLOSING_STATEMENT, adopt: true };
    expect((await call("PUT", "/api/admin/exit-policy/closing", { body, token: null })).status).toBe(401);
    expect((await call("PUT", "/api/admin/exit-policy/closing", { body, token: wrenToken })).status).toBe(401);
    expect((await storedPolicy())?.closing, "a refused write stores nothing").toBeUndefined();
  });

  it("refuses words that are not a statement, in the editor's own sentences", async () => {
    const tbd = await call("PUT", "/api/admin/exit-policy/closing", { body: { policyId: "own-words", statement: "TBD", adopt: true } });
    expect(tbd.status).toBe(400);
    expect(String(tbd.json?.message)).toMatch(/at least 8 words/);

    const unknown = await call("PUT", "/api/admin/exit-policy/closing", { body: { policyId: "equal-shares", statement: OWN_WORDS } });
    expect(unknown.status).toBe(400);

    const disguised = await call("PUT", "/api/admin/exit-policy/closing", {
      body: { policyId: "own-words", statement: PROPORTIONAL_CLOSING_STATEMENT, adopt: true },
    });
    expect(disguised.status).toBe(400);
    expect(String(disguised.json?.message)).toMatch(/Choose the default itself/);
    expect((await storedPolicy())?.closing).toBeUndefined();
  });
});

describe.skipIf(!DB_CONFIGURED)("the default is a suggestion until the village adopts it", () => {
  it("the default's words saved without adopting are a draft, and the vote stays shut", async () => {
    const saved = await call("PUT", "/api/admin/exit-policy/closing", {
      // A body claiming an adoption is not one: who and when come from the session.
      body: { policyId: "proportional-closing-balance", statement: PROPORTIONAL_CLOSING_STATEMENT, adoptedBy: "someone", adoptedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.json?.named).toBe(false);
    expect((await storedPolicy())?.closing).toMatchObject({ adoptedBy: null, adoptedAt: null });

    const { item } = await closingRow();
    expect(item.state).toBe("missing");
    expect(item.detail).toMatch(/not adopted yet/);
    const no = await call("POST", "/api/admin/launch/propose", { body: { slate: [founderId] } });
    expect(no.status).toBe(409);
    expect(no.json?.open).toEqual([ROW]);
  });

  it("adopting names it, stamped with the admin who did it", async () => {
    const adopted = await call("PUT", "/api/admin/exit-policy/closing", {
      body: { policyId: "proportional-closing-balance", statement: PROPORTIONAL_CLOSING_STATEMENT, adopt: true },
    });
    expect(adopted.status, adopted.text).toBe(200);
    expect(adopted.json?.named).toBe(true);
    const stored = (await storedPolicy())?.closing;
    expect(stored?.adoptedBy).toBe(founderId);
    expect(Number.isFinite(Date.parse(stored?.adoptedAt))).toBe(true);
    // The terms beside it are exactly as they were.
    expect((await storedPolicy())?.voluntary?.valuationMethod).toBe(TERMS.voluntary.valuationMethod);
  });

  it("every reader sees it, signed in or not, and nobody learns who adopted it", async () => {
    for (const token of [null, wrenToken]) {
      const read = await call("GET", "/api/exit-policy", { token });
      expect(read.status).toBe(200);
      expect(read.json?.policy?.closing?.policyId).toBe("proportional-closing-balance");
      expect(read.json?.policy?.closing?.statement).toBe(PROPORTIONAL_CLOSING_STATEMENT);
      expect(read.json?.policy?.closing?.adoptedAt).toBeTruthy();
      expect(read.json?.policy?.closing).not.toHaveProperty("adoptedBy");
      expect(read.text).not.toContain(founderId);
    }
  });

  it("saving the rest of the exit policy keeps the closing section, whatever the body says", async () => {
    const before = (await storedPolicy())?.closing;
    const resaved = await call("PUT", "/api/admin/exit-policy", {
      body: { ...TERMS, closing: { policyId: "own-words", statement: OWN_WORDS, adoptedBy: "someone", adoptedAt: "2026-01-01T00:00:00.000Z" } },
    });
    expect(resaved.status, resaved.text).toBe(200);
    expect((await storedPolicy())?.closing).toEqual(before);
  });
});

describe.skipIf(!DB_CONFIGURED)("named, the village may be asked", () => {
  it("the row passes and the launch vote opens", async () => {
    const { item, openBlocking } = await closingRow();
    expect(item.state).toBe("ok");
    expect(item.detail).toMatch(/^Named: Shared by closing-day balances, adopted \d{4}-\d{2}-\d{2}$/);
    expect(openBlocking).toEqual([]);

    const yes = await call("POST", "/api/admin/launch/propose", { body: { slate: [founderId] } });
    expect(yes.status, yes.text).toBe(200);
    expect(await launchBallotCount()).toBe(1);
  });
});

describe.skipIf(!DB_CONFIGURED)("the redemption screen says what redeeming gives up, exactly when it is true", () => {
  const notice = async () => {
    const r = await call("GET", "/api/redemptions", { token: wrenToken });
    expect(r.status, r.text).toBe(200);
    return r.json?.closingNotice ?? null;
  };

  it("with the closing-day-balance policy adopted, a member is told before asking", async () => {
    expect((await call("PUT", "/api/admin/modules/redemption/lifecycle", { body: { lifecycle: "members" } })).status).toBe(200);
    expect(await notice()).toBe(CLOSING_REDEMPTION_NOTICE);
  });

  it("with the village's own words, the platform claims nothing about redeemed tokens", async () => {
    expect((await call("PUT", "/api/admin/exit-policy/closing", {
      body: { policyId: "own-words", statement: OWN_WORDS, adopt: true },
    })).status).toBe(200);
    expect(await notice()).toBeNull();
  });

  it("with the default only drafted, nothing is promised yet, so nothing is said", async () => {
    expect((await call("PUT", "/api/admin/exit-policy/closing", {
      body: { policyId: "proportional-closing-balance", statement: PROPORTIONAL_CLOSING_STATEMENT },
    })).status).toBe(200);
    expect(await notice()).toBeNull();
  });
});
