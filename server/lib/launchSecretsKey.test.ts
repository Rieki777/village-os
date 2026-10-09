/**
 * THE SEALING KEY ON THE LAUNCH JOURNEY, AND WHAT IT MAY NOT DO TO A VILLAGE
 * THAT IS ALREADY LIVE.
 *
 * `village-secrets-key` was added to shared/launchRequirements.ts on
 * 2026-10-02, after villages had launched. A requirement added late lands on
 * every running village the day it deploys, so before anything about its copy
 * matters, it has to be shown harmless to them:
 *
 *   1. it never un-launches a village. `launchedAt` is written once by the
 *      launch ballot and never derived from the checks, and this holds it;
 *   2. it never closes a launch vote that was open to be asked. Only a
 *      BLOCKING row moves `readyToLaunch`, and this row is recommended, so a
 *      village that was ready before it existed is still ready without the
 *      key. That is the live shape too: a village running its Game without
 *      having held the vote yet is exactly a village that must still be able
 *      to ask;
 *   3. reading the journey writes nothing.
 *
 * Then the row itself: it reads the environment, names what is wrong with the
 * key, and goes green for a usable one.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { confirmManual, launchStatus, launchVoteBlocked, recordLaunchCarried, type LaunchDeps } from "./launch";
import { writeGoverningPurpose } from "./governingPurpose";
import { readConfigDocument } from "../repos/appConfigDocs";
import { LAUNCH_REQUIREMENTS } from "../../shared/launchRequirements";
import { ISSUANCE_CAP_REQUIREMENT } from "../../shared/issuanceCap";
import { PURPOSE_EXAMPLE } from "../../shared/governingPurpose";
import { VILLAGE_SECRETS_ENV } from "./secrets";
import { PROPORTIONAL_CLOSING_STATEMENT } from "../../shared/closingPolicies";
import { writeConfigDocument } from "../repos/appConfigDocs";

const ID = "village-secrets-key";
const KEY = "c3".repeat(32);
const withKey = { [VILLAGE_SECRETS_ENV]: KEY } as NodeJS.ProcessEnv;
const withNone = {} as NodeJS.ProcessEnv;
const quoted = { [VILLAGE_SECRETS_ENV]: `"${KEY}"` } as NodeJS.ProcessEnv;

describe("the sealing-key requirement in the registry", () => {
  const req = LAUNCH_REQUIREMENTS.find((r) => r.id === ID);

  it("is on the journey, in Connections, first, and never blocking", () => {
    expect(req, "the requirement is registered").toBeTruthy();
    expect(req!.group).toBe("integrations");
    // A blocking row could close the launch vote on a live village. See the
    // header: this is the property the rest of this file holds.
    expect(req!.severity).toBe("recommended");
    expect(req!.appliesWhenModule, "every village holds integration keys, so it always applies").toBeUndefined();
    expect(LAUNCH_REQUIREMENTS.filter((r) => r.group === "integrations")[0].id).toBe(ID);
    expect(req!.fixAt).toBe("/admin?tab=integrations");
  });

  it("carries the steps in short", () => {
    const why = req!.why;
    for (const step of ["openssl rand -hex 32", "password manager", "web service", "Variables", "New Variable",
      VILLAGE_SECRETS_ENV, "only the 64 characters", "no quotes", "Deploy", "Active"]) {
      expect(why, step).toContain(step);
    }
  });
});

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[launchSecretsKey.test] TEST_DATABASE_URL not set. The launched-village invariance is UNCHECKED here.");
}

describe.skipIf(!configured)("the sealing-key requirement against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  /** Every check wired through server/index.ts answers the same way, so only this file's facts move a row. */
  const deps = (env: NodeJS.ProcessEnv, answer: "ok" | "missing" = "ok"): LaunchDeps => {
    const checks: LaunchDeps["checks"] = {};
    for (const r of LAUNCH_REQUIREMENTS) {
      if (r.checkKey.startsWith("manual:") || r.checkKey.startsWith("decide:")) continue;
      checks[r.checkKey] = () => ({ state: answer, detail: "not in this test" });
    }
    // Governance open to members, since `governance-on-for-members` is a
    // blocking row read from this lifecycle; every other module is off.
    return { checks, moduleLifecycle: (id) => (id === "governance" ? "members" : "off"), env };
  };

  const item = async (env: NodeJS.ProcessEnv) => {
    const status = await launchStatus(pool, deps(env));
    const found = status.items.find((i) => i.id === ID);
    if (!found) throw new Error("the sealing-key item is not on the journey");
    return found;
  };

  /** Everything about the journey EXCEPT this one row's own state and detail. */
  const shape = async (env: NodeJS.ProcessEnv) => {
    const s = await launchStatus(pool, deps(env));
    return {
      blockingOpen: s.blockingOpen,
      readyToLaunch: s.readyToLaunch,
      launchedAt: s.launchedAt,
      launchedBy: s.launchedBy,
      launchedByBallotId: s.launchedByBallotId,
      others: s.items.filter((i) => i.id !== ID).map((i) => [i.id, i.state, i.severity]),
      voteBlocked: await launchVoteBlocked(pool, deps(env)),
    };
  };

  // Read through the repo, the same door server/lib/launch.ts reads by, so
  // this file adds no raw SQL outside server/repos (module-intake stage 6).
  const launchRow = async (): Promise<string | null> => {
    const doc = await readConfigDocument(pool, "launch-state");
    return doc === null ? null : JSON.stringify(doc);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    /*
     * A VILLAGE THAT IS READY, by every blocking row this file can answer:
     * the wired checks say ok, the purpose is written, the issuance cap is
     * answered, the backup drill is confirmed. Without this, every comparison
     * below would be between two villages that were not ready anyway, and
     * "the vote stays closed" would be true for reasons unrelated to the key.
     */
    const wrote = await writeGoverningPurpose(pool, { statement: PURPOSE_EXAMPLE, writtenBy: "founder-1" });
    expect(wrote.ok, JSON.stringify(wrote)).toBe(true);

    /*
     * The canvas build's two PLATFORM-WIDE governance rows are blocking and
     * resolve from the database or the lifecycle rather than the stubbed
     * `deps.checks`, so they are answered here: an adopted closing statement,
     * and governance open to members (in `deps`). The canvas and conflict-door
     * rows belong to their optional modules (Rye's module ruling, 2026-10-01),
     * which are off here like every module but governance, so this village is
     * READY with no canvas reading and no conflict door at all.
     */
    await writeConfigDocument(pool, "exit-policy", {
      closing: {
        policyId: "proportional-closing-balance",
        statement: PROPORTIONAL_CLOSING_STATEMENT,
        adoptedBy: "founder-1",
        adoptedAt: new Date().toISOString(),
      },
    });
  }, 180_000);

  beforeEach(async () => {
    await pool.query("DELETE FROM app_config WHERE config_key = 'launch-state'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect((await confirmManual(pool, ISSUANCE_CAP_REQUIREMENT, "founder-1", "declined")).ok).toBe(true);
    expect((await confirmManual(pool, "backups-drilled", "founder-1", true)).ok).toBe(true);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("reads MISSING with no key, and the detail says it is not set", async () => {
    const i = await item(withNone);
    expect(i.state).toBe("missing");
    expect(i.detail).toContain(`${VILLAGE_SECRETS_ENV} is not set`);
  });

  it("reads MISSING for a key in the wrong shape, and names the shape, never 'not set'", async () => {
    const i = await item(quoted);
    expect(i.state).toBe("missing");
    expect(i.detail).toContain("with quotes around it");
    expect(i.detail).not.toContain("is not set");
    expect(i.detail).not.toContain(KEY.slice(0, 8));
  });

  it("reads OK for a usable key", async () => {
    const i = await item(withKey);
    expect(i.state).toBe("ok");
    expect(i.detail).not.toMatch(/No check wired/);
  });

  it("2. leaves a READY village able to ask its launch vote, with or without the key", async () => {
    // The control: this village really is ready, so the comparison is real.
    const ready = await shape(withKey);
    expect(ready.readyToLaunch, JSON.stringify(ready.others.filter(([, st, sev]) => sev === "blocking" && st !== "ok"))).toBe(true);
    expect(ready.voteBlocked).toBeNull();
    expect(ready.launchedAt).toBeNull();
    // With no key, and with a malformed one, nothing but this row moves.
    expect(await shape(withNone)).toEqual(ready);
    expect(await shape(quoted)).toEqual(ready);
    // The row did go red, so the equality above is not two greens.
    expect((await item(withNone)).state).toBe("missing");
    // And it counts where a recommended row counts, and only there.
    const without = await launchStatus(pool, deps(withNone));
    const withIt = await launchStatus(pool, deps(withKey));
    expect(without.recommendedOpen).toBe(withIt.recommendedOpen + 1);
  });

  it("1. never un-launches a village that has launched", async () => {
    const recorded = await recordLaunchCarried(pool, { ballotId: "ballot-launch-1", closedBy: "founder-1" });
    expect(recorded.alreadyRecorded).toBe(false);
    const launched = await shape(withKey);
    expect(launched.launchedAt).toBe(recorded.launchedAt);
    expect(launched.launchedByBallotId).toBe("ballot-launch-1");
    expect(launched.voteBlocked?.error).toBe("This village has already started its Game.");
    // The key goes missing, or arrives in the wrong shape: still launched,
    // by the same ballot at the same instant, and nothing else moves.
    expect(await shape(withNone)).toEqual(launched);
    expect(await shape(quoted)).toEqual(launched);
  });

  it("1b. a launched village that was never READY stays launched too", async () => {
    // The other live shape: launched while some blocking row reads open (the
    // checks below all answer missing). The new row must not change that
    // either, and it must not be the thing that reopens anything.
    const recorded = await recordLaunchCarried(pool, { ballotId: "ballot-launch-2", closedBy: "founder-1" });
    const read = async (env: NodeJS.ProcessEnv) => {
      const s = await launchStatus(pool, deps(env, "missing"));
      return { launchedAt: s.launchedAt, blockingOpen: s.blockingOpen, readyToLaunch: s.readyToLaunch };
    };
    const base = await read(withKey);
    expect(base.launchedAt).toBe(recorded.launchedAt);
    expect(base.readyToLaunch).toBe(false);
    expect(await read(withNone)).toEqual(base);
  });

  it("3. reading the journey writes nothing, key or no key", async () => {
    await recordLaunchCarried(pool, { ballotId: "ballot-launch-3", closedBy: "founder-1" });
    const before = await launchRow();
    expect(before).toContain("ballot-launch-3");
    await launchStatus(pool, deps(withNone));
    await launchVoteBlocked(pool, deps(quoted));
    await launchStatus(pool, deps(withKey));
    expect(await launchRow()).toBe(before);
  });
});
