/**
 * A VILLAGE DOES NOT LAUNCH ON A GUESSED ADDRESS (readiness R108).
 *
 * Without FRONTEND_URL every link the village emails sits on whatever address
 * the first request it answered carried. The coordinator's ruling of
 * 2026-11-05 made naming the address a BLOCKING launch row, so this holds the
 * row, its check, and the one property that makes adding a blocking row safe
 * for villages already running: it never touches `launchedAt`.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { confirmManual, launchStatus, launchVoteBlocked, siteAddressLaunchCheck, type LaunchDeps } from "./launch";
import { launchProposalDoc } from "./launchProposal";
import { writeGoverningPurpose } from "./governingPurpose";
import { dbDocument } from "../repos/store-db";
import { LAUNCH_REQUIREMENTS } from "../../shared/launchRequirements";
import { ISSUANCE_CAP_REQUIREMENT } from "../../shared/issuanceCap";
import { PURPOSE_EXAMPLE } from "../../shared/governingPurpose";
import { dialsForSubject, overrideDials as highestTierDials, thresholdSettingsFrom, VILLAGE_LAUNCH } from "../../shared/ballotSubjects";

describe("the site-address check reads FRONTEND_URL's shape", () => {
  const read = (FRONTEND_URL?: string) => siteAddressLaunchCheck({ FRONTEND_URL } as NodeJS.ProcessEnv);

  it("is missing when unset, and says what the server falls back to", () => {
    expect(read().state).toBe("missing");
    expect(read("   ").state).toBe("missing");
    expect(read().detail).toContain("first request");
  });

  it("names the wrong shape instead of calling a set value unset", () => {
    for (const [value, said] of [
      ['"https://village.example.org"', "quotes"],
      ["FRONTEND_URL=https://village.example.org", "variable name"],
      ["village.example.org", "scheme"],
      ["ftp://village.example.org", "http or https"],
    ] as const) {
      const r = read(value);
      expect(r.state, value).toBe("missing");
      expect(r.detail, value).toContain(said);
      expect(r.detail, value).not.toContain("not set");
    }
  });

  it("is ok for an address with a scheme and a host, and says where links go", () => {
    expect(read("https://village.example.org")).toEqual({ state: "ok", detail: "Emailed links go to https://village.example.org." });
    expect(read("http://localhost:3000/").state).toBe("ok");
  });

  it("is on the journey as a blocking row", () => {
    const row = LAUNCH_REQUIREMENTS.find((r) => r.id === "site-address");
    expect(row?.severity).toBe("blocking");
    expect(row?.checkKey).toBe("site-address");
    expect(row?.why).toContain("FRONTEND_URL");
  });
});

describe.skipIf(!testDbConfigured())("the site-address row against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  /** Every OTHER check answers ok, so only FRONTEND_URL moves the journey. */
  const deps = (env: NodeJS.ProcessEnv): LaunchDeps => {
    const checks: LaunchDeps["checks"] = {};
    for (const r of LAUNCH_REQUIREMENTS) {
      if (r.checkKey.startsWith("manual:") || r.checkKey.startsWith("decide:") || r.checkKey === "site-address") continue;
      checks[r.checkKey] = () => ({ state: "ok", detail: "not in this test" });
    }
    return { checks, moduleLifecycle: () => "off", env };
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 });
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("is resolved from the environment with nothing injected, and holds blockingOpen until it is set", async () => {
    const without = await launchStatus(pool, deps({} as NodeJS.ProcessEnv));
    const withIt = await launchStatus(pool, deps({ FRONTEND_URL: "https://village.example.org" } as NodeJS.ProcessEnv));
    const row = (s: typeof without) => s.items.find((i) => i.id === "site-address")!;
    expect(row(without).state).toBe("missing");
    expect(row(without).detail).not.toMatch(/No check wired/);
    expect(row(withIt).state).toBe("ok");
    // The row is the whole difference between the two, and launch state is not part of it.
    expect(without.blockingOpen - withIt.blockingOpen).toBe(1);
    expect(without.launchedAt).toBe(withIt.launchedAt);
  });

  it("lets an injected check win, so a suite can hold this row still", async () => {
    const d = deps({} as NodeJS.ProcessEnv);
    d.checks["site-address"] = () => ({ state: "ok", detail: "held" });
    const s = await launchStatus(pool, d);
    expect(s.items.find((i) => i.id === "site-address")).toMatchObject({ state: "ok", detail: "held" });
  });
});

/*
 * THE LAUNCH VOTE MAY CARRY site-address OPEN (the coordinator, 2026-11-06,
 * option b, under Rye's rule that nothing is stuck without a vote path). A
 * vote cannot set an environment variable, so a village whose host never
 * names its address would otherwise never be asked. session-secret stays a
 * host-only precondition (option a): no vote makes sessions survive a restart.
 */
describe("the launch document names a carried row", () => {
  const doc = (carriedOpen?: string[]) =>
    launchProposalDoc({
      villageName: "Test Village", quorumPct: 100, unityPct: 100, onTheRoll: 3, weightNote: "",
      openedBy: "Ada", openedOn: "2026-11-06", slate: [], handover: [], carriedOpen,
    });

  it("says every item read done when nothing is carried", () => {
    expect(doc()).toContain("Every item on the journey to launch read done when Ada opened this, on 2026-11-06.");
    expect(doc([])).not.toContain("carries open");
  });

  it("names what only the host can set, and that this vote carries it open", () => {
    expect(doc(["Tell the server its own address"])).toContain(
      "except what only the host can set, which this vote carries open: Tell the server its own address.",
    );
  });

  it("is asked at the highest tier already, because the launch subject is unanimous", () => {
    // A village that raised every tier to the ceiling still cannot set a bar above the launch's own.
    const top = highestTierDials(thresholdSettingsFrom(() => 100));
    const launch = dialsForSubject(VILLAGE_LAUNCH, "custom", { unityPct: 80, quorumPct: 20 });
    expect(launch.unityPct).toBeGreaterThanOrEqual(top.unityPct);
    expect(launch.quorumPct).toBeGreaterThanOrEqual(top.quorumPct);
  });

  it("marks site-address carriable and session-secret not", () => {
    expect(LAUNCH_REQUIREMENTS.find((r) => r.id === "site-address")?.carriedByVote).toBe(true);
    expect(LAUNCH_REQUIREMENTS.find((r) => r.id === "session-secret")?.carriedByVote).toBeFalsy();
  });
});

describe.skipIf(!testDbConfigured())("a ready village with no address of its own may still ask its launch vote", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  /** Every wired check answers ok except the two this block is about, which read the env given. */
  const deps = (env: NodeJS.ProcessEnv, sessionSecret: "ok" | "missing" = "ok"): LaunchDeps => {
    const checks: LaunchDeps["checks"] = {};
    for (const r of LAUNCH_REQUIREMENTS) {
      if (r.checkKey.startsWith("manual:") || r.checkKey.startsWith("decide:") || r.checkKey === "site-address") continue;
      checks[r.checkKey] = () => ({ state: "ok", detail: "not in this test" });
    }
    checks["session-secret"] = () => ({ state: sessionSecret, detail: "held for this test" });
    return { checks, moduleLifecycle: () => "off", env };
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 });
    // Ready by every row that is not a wired check, as launchSecretsKey.test.ts makes it.
    expect((await writeGoverningPurpose(pool, { statement: PURPOSE_EXAMPLE, writtenBy: "founder-1" })).ok).toBe(true);
    await dbDocument(pool, "season", {} as any).put({
      seasons: [], cadence: "solstice-equinox", timezone: "UTC",
      timezoneAnswer: { at: "2026-10-31T00:00:00.000Z", by: "founder-1" },
    } as any);
    expect((await confirmManual(pool, ISSUANCE_CAP_REQUIREMENT, "founder-1", "declined")).ok).toBe(true);
    expect((await confirmManual(pool, "backups-drilled", "founder-1", true)).ok).toBe(true);
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("carries site-address open: still counted, no longer holding the vote", async () => {
    const s = await launchStatus(pool, deps({} as NodeJS.ProcessEnv));
    expect(s.carriedOpen.map((c) => c.id)).toEqual(["site-address"]);
    expect(s.blockingOpen, "the row is still open and counted on the journey").toBe(1);
    expect(s.readyToLaunch).toBe(true);
    expect(await launchVoteBlocked(pool, deps({} as NodeJS.ProcessEnv))).toBeNull();
  });

  it("with the address set there is nothing to carry", async () => {
    const s = await launchStatus(pool, deps({ FRONTEND_URL: "https://village.example.org" } as NodeJS.ProcessEnv));
    expect(s.carriedOpen).toEqual([]);
    expect(s.blockingOpen).toBe(0);
    expect(s.readyToLaunch).toBe(true);
  });

  it("the control: an open session secret still holds the vote, and only it is named", async () => {
    const blocked = await launchVoteBlocked(pool, deps({} as NodeJS.ProcessEnv, "missing"));
    expect(blocked, "session-secret is a host-only precondition the vote cannot carry").not.toBeNull();
    expect(blocked!.open).toEqual([LAUNCH_REQUIREMENTS.find((r) => r.id === "session-secret")!.title]);
  });
});
