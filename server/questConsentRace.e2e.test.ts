/**
 * ONE CONSENT, ONE 200, AND THE CLAIM AGREES WITH THE LEDGER.
 *
 * `POST /api/admin/quest-claims/:id/consent` had a check-then-act on the
 * claim's own status: it tested the row this request had loaded, then flipped
 * it with nothing holding that reading in between. Six consents fired together
 * on one claim answered 200 TWICE, measured over HTTP against the built server
 * by the mint-cap lane, which reported it rather than taking it.
 *
 * THE MONEY WAS NEVER WRONG, and it still is not: both value legs are keyed on
 * the claim and the ledger's unique index pays once. What was wrong is
 * everything a caller and a village can SEE.
 *
 *   - The claim's own `amount` is whichever request committed LAST while the
 *     ledger paid whichever posted FIRST. Two stewards choosing different
 *     points of an advertised range leave the claim saying one number over a
 *     member holding another.
 *   - `addActivity` writes the village pulse with no dedupe key, so the whole
 *     village reads the quest completed twice for one act.
 *   - Two callers are both told the release landed.
 *
 * WHAT IS RED AGAINST THE OLD CODE, and how each case earns its place:
 *
 *   1. The SEQUENTIAL case is deterministic. With
 *      `quest.require_submission_before_consent` off, consenting twice with two
 *      different amounts used to answer 200 twice and leave the claim holding
 *      the second amount over a ledger that paid the first. No race, no timing,
 *      the same result every run.
 *   2. The CONCURRENT case is the original measurement. It is honest about what
 *      it can prove: the fix makes "at most one 200" a property, while the old
 *      code violated it only sometimes, so a green here on the old code would
 *      be luck. It is kept because it is the shape the defect was found in, and
 *      because the money assertions beside it must hold under either code.
 *
 * Run `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { E2E_BOOT_DEADLINE_MS, provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[questConsentRace] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window, above every window in the tree when it was written.
 * `node scripts/check-e2e-ports.mjs` is the survey that proves it is clear, and
 * it says so on the day you run it; a comment claiming a clear window is
 * exactly the claim that guard exists because it went stale.
 */
const PORT = 32002 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "ConsentRace123!";
const PASSWORD = "OraConsentRace123!";

let child: ChildProcess | null = null;
let testDb: TestDb | undefined;
let dataDir = "";
const logs: string[] = [];

let founderToken = "";
let oraToken = "";
let oraId = "";

interface Answer { status: number; json: any; text: string }

async function call(method: string, route: string, body?: unknown, token?: string | null): Promise<Answer> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

describe.skipIf(!DB_CONFIGURED)("one consent, one 200, and the claim agrees with the ledger", () => {
  const setVar = async (key: string, value: string) => {
    const r = await call("PUT", `/api/admin/variables/${key}`, { value }, founderToken);
    expect(r.status, `${key} := ${value}: ${r.text.slice(0, 200)}`).toBe(200);
  };

  /** A quest, claimed and submitted by Ora. Returns the claim and quest ids. */
  const readyClaim = async (title: string, gratitude: string, stayCreditReward = 0) => {
    const quest = await call("POST", "/api/admin/quests", {
      title, description: "Work exchange", gratitude, stayCreditReward, status: "Open",
    }, founderToken);
    expect(quest.status, quest.text.slice(0, 200)).toBe(200);
    const questId = String(quest.json?.id ?? "");
    const claim = await call("POST", `/api/game/quests/${questId}/claim`, {}, oraToken);
    expect(claim.status, claim.text.slice(0, 200)).toBe(200);
    const claimId = String(claim.json?.id ?? "");
    expect((await call("POST", `/api/game/quests/${questId}/submit`, {
      artifactUrl: "https://example.test/evidence", note: "Done",
    }, oraToken)).status).toBe(200);
    return { questId, claimId };
  };

  /** What the ledger actually paid for this claim, in MINOR units. */
  const paidFor = async (claimId: string): Promise<number> => {
    const [rows] = await testDb!.conn.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT amount FROM token_ledger WHERE idempotency_key = ?",
      [`quest_consent:${claimId}`],
    );
    expect(rows.length, "the recognition leg must have been written exactly once").toBe(1);
    return Number(rows[0].amount);
  };

  /** The claim row's own number, read straight off the table. */
  const claimAmount = async (claimId: string): Promise<number> => {
    const [rows] = await testDb!.conn.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT amount, status FROM quest_claims WHERE id = ?",
      [claimId],
    );
    expect(rows.length).toBe(1);
    expect(String(rows[0].status)).toBe("consented");
    return Number(rows[0].amount);
  };

  /** How many times the village pulse says this quest was completed. */
  const pulseRows = async (questId: string): Promise<number> => {
    const [rows] = await testDb!.conn.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) AS n FROM health_events WHERE kind = 'quest' AND entity_ref = ?",
      [questId],
    );
    return Number(rows[0]?.n ?? 0);
  };

  beforeAll(async () => {
    if (!fs.existsSync(DIST)) {
      throw new Error(`${DIST} is missing. Run \`pnpm build\` before this drive.`);
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-consent-race-"));
    testDb = await provisionTestDb();
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
        AUTH_TOKEN_SECRET: "consent-race-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
        throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s:\n${logs.join("")}`);
      }
      try {
        if ((await fetch(`${BASE}/health`)).ok) break; // module-review-ok: the boot poll against the local test server
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 400));
    }

    const boot = await call("POST", "/api/admin/bootstrap", {
      password: ADMIN, email: `founder-${PORT}@example.test`, name: "Race Founder",
    }, null);
    const claimToken = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { token: claimToken, password: ADMIN }, null);
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder must hold a session").toBeTruthy();

    const reg = await call("POST", "/api/auth/register", {
      name: "Ora", email: `ora-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
    }, null);
    expect(reg.status, `Ora must register: ${reg.text.slice(0, 200)}`).toBe(200);
    oraToken = String(reg.json?.token ?? "");
    oraId = String(reg.json?.user?.id ?? "");
    expect(oraId).toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    child?.kill();
    await testDb?.drop();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /**
   * THE DETERMINISTIC CASE. No concurrency, so nothing here depends on timing.
   *
   * The submission guard is turned OFF, which is the one supported way to reach
   * the consent route twice on one claim. Under the old code both calls
   * answered 200, the second rewrote the claim's `amount` to 90, and the ledger
   * still held the 10 the first one posted, because the occurrence key is the
   * claim. A member would have been shown a completed quest worth 90 over a
   * balance that moved by 10.
   */
  it("refuses a second consent, so the claim's amount is the amount the ledger paid", async () => {
    await setVar("quest.require_submission_before_consent", "false");
    const { claimId } = await readyClaim("Mend the fence", "10-100");

    const first = await call("POST", `/api/admin/quest-claims/${claimId}/consent`, {
      approve: true, amount: 10,
    }, founderToken);
    expect(first.status, `the first consent must land: ${first.text.slice(0, 300)}`).toBe(200);

    const second = await call("POST", `/api/admin/quest-claims/${claimId}/consent`, {
      approve: true, amount: 90,
    }, founderToken);
    expect(second.status, `the second consent must refuse: ${second.text.slice(0, 300)}`).toBe(409);
    // The STATUS, not a sentence, for the reason the case below gives. This
    // line asserted the refusal sentence of the compare-and-swap this branch
    // used to carry, which the merge with main replaced with #233 and its
    // consentOnce: that refuses with a different sentence and reports the
    // status of the claim beside it.
    expect(second.json?.status, `the refusal names the status of the claim: ${second.text.slice(0, 300)}`).toBe("consented");

    // THE ASSERTION THE OLD CODE FAILED, in the units each side actually holds:
    // `quest_claims.amount` is the human number a witness typed and the ledger
    // row is in minor units, so the comparison converts by the token's own
    // scale rather than assuming today's.
    const tokens = await call("GET", "/api/admin/tokens", undefined, founderToken);
    const recognition = (tokens.json?.tokens ?? []).find((t: any) => t.slug === "gratitude");
    expect(recognition, "the recognition token is registered at boot").toBeTruthy();
    const scale = 10 ** Number(recognition.decimals ?? 0);

    expect(await claimAmount(claimId), "the claim must hold what the first consent granted").toBe(10);
    expect(await paidFor(claimId), "and the ledger must hold the same number").toBe(10 * scale);

    await setVar("quest.require_submission_before_consent", "true");
  }, 120_000);

  /**
   * THE ORIGINAL MEASUREMENT, RE-RUN. Six at once, on the shipped default.
   *
   * The money assertions here held before the fix too and are kept for that
   * reason: they are what proves the fix did not weaken the claim-keyed
   * idempotency that was doing the real work. The response and pulse counts are
   * the new property.
   */
  it("answers one 200 to six concurrent consents, and writes the pulse once", async () => {
    // SET HERE AND NOT INHERITED. The case above turns the submission guard off
    // and turns it back on at its end, and a failing assertion returns before
    // that line: driving this case against the old build once left the guard
    // off and reported six 200s where the default configuration gives fewer.
    // A case that reads a dial another case left behind is measuring the order
    // the file happened to run in.
    await setVar("quest.require_submission_before_consent", "true");
    const { questId, claimId } = await readyClaim("Clear the north path", "10", 20);

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        call("POST", `/api/admin/quest-claims/${claimId}/consent`, { approve: true, amount: 10 }, founderToken)),
    );

    const accepted = results.filter((r) => r.status === 200);
    const refused = results.filter((r) => r.status === 409);
    expect(accepted.length, `exactly one caller is told the consent landed: ${results.map((r) => r.status).join(",")}`).toBe(1);
    expect(refused.length, "and the other five are told it was already consented").toBe(5);
    /*
     * TWO DIFFERENT SENTENCES ARE BOTH CORRECT HERE, which is why this asserts
     * the reported STATUS and not a phrase. A request that arrives after the
     * winner has committed reads `consented` at the top of the route and is
     * refused by the submission guard that was always there; a request that read
     * `submitted` before the winner committed gets as far as the compare-and-
     * swap and is refused by that. Both are 409, both name the status, and
     * which one a given caller meets is a matter of microseconds.
     */
    for (const r of refused) {
      expect(String(r.json?.status ?? ""), r.text.slice(0, 200)).toBe("consented");
      expect(String(r.json?.error ?? ""), r.text.slice(0, 200)).toContain("consented");
    }

    // THE MONEY, unchanged by the fix and asserted from the ledger. Two legs,
    // one claim, whatever the concurrency.
    const [rows] = await testDb!.conn.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT idempotency_key, token_type, amount FROM token_ledger WHERE idempotency_key IN (?, ?)",
      [`quest_consent:${claimId}`, `queststay:${claimId}`],
    );
    expect(rows.length, "one claim, two value legs, whatever the concurrency").toBe(2);

    // THE VILLAGE PULSE. One act, one line in the feed the whole village reads.
    expect(await pulseRows(questId), "the village hears about one completion, not six").toBe(1);
  }, 180_000);
});
