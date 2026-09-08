/**
 * THE ISSUANCE CAP ON THE LAUNCH JOURNEY, AGAINST A REAL DATABASE.
 *
 * Rye: "the initial village wide issuance needs to be added to the flow
 * founders are going through, and they can opt to not set a cap at that
 * moment. So, It's critical this is added to the Journey to launch process."
 *
 * WHAT IS UNDER TEST:
 *   1. a village nobody has asked reads MISSING, and the item blocks the
 *      launch vote, which is what makes the second answer a real one;
 *   2. a founder can SET a cap, and the journey sees it;
 *   3. a founder can DECLINE, the journey accepts that as an answer, and the
 *      record carries who and when;
 *   4. DECLINED AND UNSET ARE DISTINGUISHABLE AFTERWARDS, on a database that
 *      looks identical in the variables table;
 *   5. declining never uncaps anything: the platform's number keeps binding;
 *   6. declining is a power the registry hands out one row at a time.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { confirmManual, issuanceCapDecisionFor, launchStatus, launchVoteBlocked, type LaunchDeps } from "./launch";
import { MINT_CAP_KEY } from "./mintCap";
import { ISSUANCE_CAP_KEY, ISSUANCE_CAP_REQUIREMENT } from "../../shared/issuanceCap";
import { LAUNCH_REQUIREMENTS } from "../../shared/launchRequirements";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[launch.test] TEST_DATABASE_URL not set. The launch decision is UNCHECKED here.");
}

let db: TestDb;
let pool: mysql.Pool;

/**
 * Every wired check answers `missing`, and every module is off.
 *
 * This file is about ONE row, and the rest of the checklist is other lanes'
 * work reaching into server/index.ts's boot caches. Answering them all the
 * same way keeps the reading honest about what is under test: any item that
 * turns green here did so for a reason this file provided.
 */
const deps = (): LaunchDeps => {
  const checks: LaunchDeps["checks"] = {};
  for (const r of LAUNCH_REQUIREMENTS) {
    if (r.checkKey.startsWith("manual:") || r.checkKey.startsWith("decide:")) continue;
    checks[r.checkKey] = () => ({ state: "missing" as const, detail: "not in this test" });
  }
  return { checks, moduleLifecycle: () => "off" };
};

const capItem = async () => {
  const status = await launchStatus(pool, deps());
  const item = status.items.find((i) => i.id === ISSUANCE_CAP_REQUIREMENT);
  if (!item) throw new Error("the issuance cap item is not on the journey");
  return item;
};

async function clearOverride(): Promise<void> {
  await pool.query("DELETE FROM game_variables WHERE config_key = ?", [ISSUANCE_CAP_KEY]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
}

async function setOverride(value: string): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO game_variables (config_key, value, value_type) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [ISSUANCE_CAP_KEY, value, "text"],
  );
}

async function clearAnswers(): Promise<void> {
  await pool.query("DELETE FROM app_config WHERE config_key = 'launch-state'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  await clearOverride();
}

describe.skipIf(!configured)("the issuance cap on the launch journey", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, the ledger.test.ts shape
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("names the same dial the mint guard enforces", () => {
    /*
     * TWO CONSTANTS, ONE STRING, AND THIS IS WHAT STOPS THEM DRIFTING.
     * `shared/issuanceCap.ts` cannot import `MINT_CAP_KEY`, because launch.ts
     * would then reach mintCap.ts, which reaches economy.ts, which reaches
     * villageMoon.ts, which imports launch.ts. So the duplication is
     * deliberate and this assertion is its guard.
     */
    expect(ISSUANCE_CAP_KEY).toBe(MINT_CAP_KEY);
  });

  it("1. reads MISSING when nobody has answered, and BLOCKS the launch vote", async () => {
    await clearAnswers();
    const item = await capItem();
    expect(item.state).toBe("missing");
    expect(item.severity, "blocking is what makes declining a real choice").toBe("blocking");
    expect(item.detail).toContain("Nobody has answered");
    expect(item.declinedBy, "nobody declined either").toBeUndefined();

    const blocked = await launchVoteBlocked(pool, deps());
    expect(blocked?.open, "the founder has to answer before the village is asked").toContain(
      item.title,
    );

    const decision = await issuanceCapDecisionFor(pool);
    expect(decision.answer).toBe("unset");
    // AND THE CAP BINDS MEANWHILE. An unanswered question is not an open faucet.
    expect(decision.capTokens).toBe(10000);
  }, 60_000);

  it("2. reads OK once the founder sets a number of their own", async () => {
    await clearAnswers();
    await setOverride("400");
    const item = await capItem();
    expect(item.state).toBe("ok");
    expect(item.detail).toContain("400");
    expect((await issuanceCapDecisionFor(pool)).answer).toBe("set");
  }, 60_000);

  it("3. accepts a DECLINE as an answer, with a name and an instant on it", async () => {
    await clearAnswers();
    const r = await confirmManual(pool, ISSUANCE_CAP_REQUIREMENT, "usr-founder", "declined");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.answer).toBe("declined");

    const item = await capItem();
    expect(item.state, "a decision counts, and the checklist says so").toBe("ok");
    expect(item.declinedBy).toBe("usr-founder");
    expect(item.declinedAt).toBeTruthy();
    expect(item.detail).toContain("declined");

    // And the launch vote is no longer held up by this row.
    const blocked = await launchVoteBlocked(pool, deps());
    expect(blocked?.open ?? []).not.toContain(item.title);
  }, 60_000);

  it("4. HOLDS DECLINED AND UNSET APART, on a variables table that looks the same", async () => {
    await clearAnswers();
    const unsetItem = await capItem();
    const unsetDecision = await issuanceCapDecisionFor(pool);

    await confirmManual(pool, ISSUANCE_CAP_REQUIREMENT, "usr-founder", "declined");
    const declinedItem = await capItem();
    const declinedDecision = await issuanceCapDecisionFor(pool);

    // Neither village holds an override row. Read it, do not assume it.
    const [rows] = await pool.query<any[]>(
      "SELECT config_key FROM game_variables WHERE config_key = ?",
      [ISSUANCE_CAP_KEY],
    );
    expect(rows.length, "the two states are identical in game_variables").toBe(0);

    expect(unsetDecision.answer).toBe("unset");
    expect(declinedDecision.answer).toBe("declined");
    expect(unsetItem.state).toBe("missing");
    expect(declinedItem.state).toBe("ok");
    expect(unsetItem.detail).not.toBe(declinedItem.detail);
    // 5. AND NEITHER ONE UNCAPS ANYTHING.
    expect(declinedDecision.capTokens).toBe(unsetDecision.capTokens);
    expect(declinedDecision.capTokens).toBe(10000);

    // The record is in the document, so a later reader can tell them apart too.
    const [[doc]] = await pool.query<any[]>(
      "SELECT value FROM app_config WHERE config_key = 'launch-state'",
    );
    const parsed = typeof doc.value === "string" ? JSON.parse(doc.value) : doc.value;
    expect(parsed.declines[ISSUANCE_CAP_REQUIREMENT].by).toBe("usr-founder");
    expect(parsed.manualConfirms[ISSUANCE_CAP_REQUIREMENT], "a decline is not a confirmation").toBeUndefined();
  }, 60_000);

  it("retracts a decline, and the village goes back to having answered nothing", async () => {
    await clearAnswers();
    await confirmManual(pool, ISSUANCE_CAP_REQUIREMENT, "usr-founder", "declined");
    expect((await issuanceCapDecisionFor(pool)).answer).toBe("declined");
    const r = await confirmManual(pool, ISSUANCE_CAP_REQUIREMENT, "usr-founder", false);
    expect(r.ok && r.answer).toBe("retracted");
    expect((await issuanceCapDecisionFor(pool)).answer).toBe("unset");
    expect((await capItem()).state).toBe("missing");
  }, 60_000);

  it("keeps the launch answer when somebody sets a number afterwards", async () => {
    await clearAnswers();
    await confirmManual(pool, ISSUANCE_CAP_REQUIREMENT, "usr-founder", "declined");
    await setOverride("250");
    const decision = await issuanceCapDecisionFor(pool);
    expect(decision.answer, "the founder was asked at launch and said no").toBe("declined");
    expect(decision.overridden, "and a number exists now, which is a different act").toBe(true);
    expect(decision.capTokens).toBe(250);
  }, 60_000);

  it("6. REFUSES A DECLINE ON A ROW THE REGISTRY DID NOT MAKE DECLINABLE", async () => {
    await clearAnswers();
    /*
     * The guard that stops declining being a general power. Without it a
     * village could decline the shared-password exit and reach
     * `readyToLaunch` with the platform's oldest debt untouched.
     */
    const r = await confirmManual(pool, "admin-identities", "usr-founder", "declined");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("declining it is not one of the answers");

    const status = await launchStatus(pool, deps());
    const identities = status.items.find((i) => i.id === "admin-identities");
    expect(identities!.state, "and the row is still open").toBe("missing");
  }, 60_000);

  it("still confirms a manual item the way it always did, with `done` absent", async () => {
    /*
     * The backwards-compatible half. `server/index.ts` used to send
     * `req.body?.done !== false` and now forwards the raw value, so an absent
     * `done` has to keep meaning done.
     */
    await clearAnswers();
    const r = await confirmManual(pool, "backups-drilled", "usr-founder", undefined);
    expect(r.ok && r.answer).toBe("done");
    const status = await launchStatus(pool, deps());
    expect(status.items.find((i) => i.id === "backups-drilled")!.state).toBe("ok");
    expect(status.items.find((i) => i.id === "backups-drilled")!.confirmedBy).toBe("usr-founder");
  }, 60_000);
});
