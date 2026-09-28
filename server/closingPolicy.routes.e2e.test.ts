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
 * IT ASSERTS WHAT NAMING CLOSING CHANGES, never the whole journey. Every
 * blocking row that existed when this file was written is cleared by
 * `beforeAll` (`ROWS_THIS_FILE_CLEARS`, and the first case holds it to that),
 * so on this branch closing is the only row open and the vote answers 200.
 * A blocking row added later by another change (the launch-gate lane's
 * governance rows, say) is that change's to clear: this file measures which
 * such rows are open at the start and asserts that adopting closing closes
 * its own row and moves no other, and that the vote's answer names exactly
 * what is left. Composed with such a lane it stays true without an edit; it
 * asserted the whole open set until the review of 2026-09-27 found that a
 * composition would turn it red with no conflict marker anywhere.
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
import { provisionTestDb, testDbConfigured, testPool, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { PURPOSE_EXAMPLE } from "../shared/governingPurpose";
import { CLOSING_REDEMPTION_NOTICE, PROPORTIONAL_CLOSING_STATEMENT } from "../shared/closingPolicies";
import { CONFLICT_DOOR_READY, recordEveryCanvasBlock } from "./db/launchGovernanceFixture";

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
const ROW_ID = "closing-policy-named";

/**
 * The blocking rows on the journey when this file was written, every one of
 * which `beforeAll` clears (or the server clears on its own). A row open at
 * the start that is NOT here was added by a later change.
 */
const ROWS_THIS_FILE_CLEARS = [
  "admin-identities",
  "founder-appointed",
  "brand-basics",
  "gps-written",
  "stripe-webhook",
  "modules-decided",
  "pool-token-spendable",
  "issuance-cap",
  "session-secret",
  "exit-policy-terms",
  "backups-drilled",
  // The launch-gate lane's governance rows, cleared since the Wave 2 composition
  // (server/db/launchGovernanceFixture.ts), so the last case is a real "yes".
  "canvas-on-record",
  "conflict-door",
  "governance-on-for-members",
];

/** The other blocking rows open at the start, measured by the first case: none on this branch. */
let othersOpen: { id: string; title: string }[] = [];
const sorted = (xs: unknown): string[] => (Array.isArray(xs) ? xs.map(String).sort() : []);

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
let wrenId = "";

/** An intake role nobody holds until the last case seats Wren in it. Written before boot, so the role cache loads it. */
const CARE_ROLE = "closing-care";

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

/**
 * The records a closing write leaves, read raw: the admin audit rows and the
 * pulse lines members read (Wave 2 audit, 2026-09-28).
 */
const closingEvents = async (audience: "admin" | "public"): Promise<{ text: string; actor: string | null }[]> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT text, actor_user_id FROM health_events WHERE entity_type = 'exit_policy' AND entity_ref = 'closing' AND audience = ?",
    [audience],
  );
  return rows.map((r) => ({ text: String(r.text), actor: r.actor_user_id == null ? null : String(r.actor_user_id) }));
};

/** How many launch ballots exist, read raw: a refused ask must leave none. */
const launchBallotCount = async (): Promise<number> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT COUNT(*) AS n FROM ballots WHERE subject_type = 'village_launch'",
  );
  return Number(rows[0]?.n ?? 0);
};

/** The closing row off the live checklist, and every OTHER blocking row still open. */
async function closingRow(): Promise<{ item: any; others: { id: string; title: string }[] }> {
  const r = await call("GET", "/api/admin/launch");
  expect(r.status, "the launch checklist must answer").toBe(200);
  const items: any[] = r.json?.items ?? [];
  const item = items.find((i) => i.id === ROW_ID);
  expect(item, "the checklist must carry the closing-policy-named row").toBeTruthy();
  const others = items
    .filter((i) => i.severity === "blocking" && i.state !== "ok" && i.id !== ROW_ID)
    .map((i) => ({ id: String(i.id), title: String(i.title) }));
  return { item, others };
}

/** What a member about to redeem is told, off the live redemption surface. */
const notice = async (): Promise<string | null> => {
  const r = await call("GET", "/api/redemptions", { token: wrenToken });
  expect(r.status, r.text).toBe(200);
  return r.json?.closingNotice ?? null;
};

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
    // The conflict door, which blocks the vote: server/db/launchGovernanceFixture.ts.
    ...CONFLICT_DOOR_READY,
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
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

  await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
    "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?)",
    [CARE_ROLE, "Care", "Hears a conflict first.", JSON.stringify([]), 99],
  );
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
  wrenId = wren.id;
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
  // Every canvas block on record, which blocks the vote: server/db/launchGovernanceFixture.ts.
  await recordEveryCanvasBlock(call);
}, 240_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("silence cannot launch", () => {
  it("a village that has not named closing is told no by the launch vote, and the no names the row", async () => {
    const { item, others } = await closingRow();
    expect(item.severity).toBe("blocking");
    expect(item.state).toBe("missing");
    expect(item.detail).toMatch(/Nothing is named yet/);
    expect(
      others.filter((o) => ROWS_THIS_FILE_CLEARS.includes(o.id)).map((o) => o.id),
      "every row this file clears is clear, so any other open row belongs to a later change",
    ).toEqual([]);
    othersOpen = others;

    const no = await call("POST", "/api/admin/launch/propose", { body: { slate: [founderId] } });
    expect(no.status, no.text).toBe(409);
    expect(sorted(no.json?.open), "the no names closing and exactly the rows already open").toEqual(
      sorted([ROW, ...othersOpen.map((o) => o.title)]),
    );
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

    // The other way round: the village's own method filed under the default's
    // name, which would print "Shared by closing-day balances" above it and put
    // the closing-day notice on the redemption screen (review of 2026-09-27).
    const misnamed = await call("PUT", "/api/admin/exit-policy/closing", {
      body: { policyId: "proportional-closing-balance", statement: OWN_WORDS, adopt: true },
    });
    expect(misnamed.status, misnamed.text).toBe(400);
    expect(String(misnamed.json?.message)).toMatch(/keep the sentence that choice stands for/);
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
    expect(sorted(no.json?.open)).toEqual(sorted([ROW, ...othersOpen.map((o) => o.title)]));

    // A drafted default promises nothing yet, so a member about to redeem is told nothing.
    expect((await call("PUT", "/api/admin/modules/redemption/lifecycle", { body: { lifecycle: "members" } })).status).toBe(200);
    expect(await notice()).toBeNull();

    // A draft is recorded for the admins and is not news for the village.
    expect(await closingEvents("admin")).toEqual([
      { text: "closing-policy:draft:none->proportional-closing-balance", actor: founderId },
    ]);
    expect(await closingEvents("public")).toEqual([]);
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

    // Wave 2 audit, 2026-09-28: an adoption used to leave no record and tell
    // nobody. It is on the admin audit trail and on the pulse members read.
    expect((await closingEvents("admin")).map((e) => e.text)).toContain(
      "closing-policy:adopted:proportional-closing-balance->proportional-closing-balance",
    );
    expect(await closingEvents("public")).toEqual([
      {
        text: "An admin adopted what closing this village means: Shared by closing-day balances. The words are on the exit policy page.",
        actor: founderId,
      },
    ]);
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

  /*
   * THE SAME SAVE REFUSES A CONFLICT DOOR IT CANNOT HONOUR, at the route.
   *
   * Wave 2 composition: the exits-extract lane moved `PUT /api/admin/exit-policy`
   * into server/routes/exits.ts while the launch-gate lane changed its role
   * check into `restorativeDoorProblem`, and the integrator ported that swap by
   * hand. Only unit tests pinned the function, so a port that dropped it would
   * have saved an unknown cover role, a cover role that is the intake role, or
   * a reply time nobody can keep, with CI green. Each refusal stores nothing.
   */
  it("refuses an unknown cover role, a cover role that is the intake role, and a bad reply time, storing nothing", async () => {
    const roles = await call("GET", "/api/roles", { token: null });
    expect(roles.status, roles.text).toBe(200);
    const roleId = String((roles.json ?? [])[0]?.id ?? "");
    expect(roleId, "a fresh village carries at least one seeded role").toBeTruthy();
    const before = await storedPolicy();

    const refusals: [Record<string, unknown>, string][] = [
      [{ coverRole: "no-such-role" }, "unknown_role"],
      [{ intakeContactRole: roleId, coverRole: roleId }, "cover_is_intake"],
      [{ replyHours: -3 }, "bad_reply_hours"],
    ];
    for (const [door, error] of refusals) {
      const r = await call("PUT", "/api/admin/exit-policy", {
        body: { ...TERMS, restorative: { ...TERMS.restorative, ...door } },
      });
      expect(r.status, `${error}: ${r.text}`).toBe(400);
      expect(r.json?.error).toBe(error);
      expect(await storedPolicy(), `${error} stored nothing`).toEqual(before);
    }
  });
});

describe.skipIf(!DB_CONFIGURED)("named, the village may be asked", () => {
  it("the row passes, no other row moved, and the launch vote no longer names it", async () => {
    const { item, others } = await closingRow();
    expect(item.state).toBe("ok");
    expect(item.detail).toBe("Named and adopted: Shared by closing-day balances");
    expect(others, "naming closing closed its own row and nothing else").toEqual(othersOpen);

    // On this branch nothing else is open, so this is the real "yes". Composed
    // with a change whose rows this file does not clear, it is the "no" naming
    // exactly those rows, and never this one.
    const yes = othersOpen.length === 0;
    const answer = await call("POST", "/api/admin/launch/propose", { body: { slate: [founderId] } });
    expect(answer.status, answer.text).toBe(yes ? 200 : 409);
    expect(yes ? [] : sorted(answer.json?.open)).toEqual(sorted(othersOpen.map((o) => o.title)));
    expect(await launchBallotCount()).toBe(yes ? 1 : 0);
  });
});

describe.skipIf(!DB_CONFIGURED)("the redemption screen says what redeeming gives up, exactly when it is true", () => {
  it("with the closing-day-balance policy adopted, a member is told before asking", async () => {
    expect(await notice()).toBe(CLOSING_REDEMPTION_NOTICE);
  });

  /*
   * THE NOTICE SITS BESIDE "THIS ONE GOES TO A VILLAGE VOTE" (Wave 2 audit,
   * 2026-09-28). Nobody in this village holds `redemption.confirm`, so the
   * panel tells the member a vote decides, and the notice under it used to say
   * "once a steward confirms". Read off the same payload the panel renders.
   */
  it("where a village vote confirms a redemption, the notice does not say a steward does", async () => {
    const r = await call("GET", "/api/redemptions", { token: wrenToken });
    expect(r.status, r.text).toBe(200);
    expect(r.json?.confirmedBy, "nobody holds the redemption key here").toBe("vote");
    expect(r.json?.closingNotice).toBe(CLOSING_REDEMPTION_NOTICE);
    expect(String(r.json?.closingNotice)).not.toMatch(/steward/i);
  });

  it("with the village's own words, the platform claims nothing about redeemed tokens", async () => {
    expect((await call("PUT", "/api/admin/exit-policy/closing", {
      body: { policyId: "own-words", statement: OWN_WORDS, adopt: true },
    })).status).toBe(200);
    expect(await notice()).toBeNull();
  });

  it("a draft saved over the adopted words is refused, and the village's promise stands", async () => {
    // Review of 2026-09-27: this used to store the draft, which un-named the
    // village for every member and erased the adopted words.
    const before = (await storedPolicy())?.closing;
    expect(before?.adoptedAt).toBeTruthy();
    const draft = await call("PUT", "/api/admin/exit-policy/closing", {
      body: { policyId: "proportional-closing-balance", statement: PROPORTIONAL_CLOSING_STATEMENT },
    });
    expect(draft.status, draft.text).toBe(409);
    expect(draft.json?.error).toBe("closing_policy_adopted");
    expect((await storedPolicy())?.closing).toEqual(before);
    expect((await closingRow()).item.state).toBe("ok");
    expect(await notice(), "still the village's own words, so still nothing claimed").toBeNull();
  });
});

/*
 * THE REPLY PROMISE NEEDS SOMEBODY BEHIND IT (Wave 2 audit, 2026-09-28).
 *
 * /exit-policy printed "Bring it to the <role> and you hear back within N
 * hours" whenever an intake role id was stored, and an intake sent to a role
 * nobody holds is refused. The page now reads `heldToday` off this route and
 * promises the reply, and offers the form, only when it is true. This drives
 * the route's half through the real wiring: the role holders handed to the
 * exits module in server/index.ts, read by the intake's own reach rule.
 */
describe.skipIf(!DB_CONFIGURED)("the exit policy says whether anybody holds the intake role today", () => {
  it("an intake role nobody holds reads as not held, to anybody, and reads as held once somebody is seated", async () => {
    const saved = await call("PUT", "/api/admin/exit-policy", {
      body: { ...TERMS, restorative: { ...TERMS.restorative, intakeContactRole: CARE_ROLE } },
    });
    expect(saved.status, saved.text).toBe(200);

    for (const token of [null, wrenToken]) {
      const read = await call("GET", "/api/exit-policy", { token });
      expect(read.status, read.text).toBe(200);
      expect(read.json?.policy?.restorative?.intakeRole).toEqual({ id: CARE_ROLE, name: "Care", heldToday: false });
    }

    const seated = await call("POST", `/api/admin/roles/${CARE_ROLE}/holders`, { body: { userId: wrenId, action: "add" } });
    expect(seated.status, seated.text).toBe(200);
    const read = await call("GET", "/api/exit-policy", { token: null });
    expect(read.json?.policy?.restorative?.intakeRole).toEqual({ id: CARE_ROLE, name: "Care", heldToday: true });
  });
});
