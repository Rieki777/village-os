/**
 * THE THREE GOVERNANCE ROWS REFUSE THE LAUNCH VOTE, AGAINST A REAL DATABASE.
 *
 * `launchGovernance.test.ts` drives each resolver through every state with no
 * database. This file asks the question the rows exist for: does
 * `launchVoteBlocked` refuse to put the Birthing to the village while each one
 * is open, and let it through once all three are met?
 *
 * The village here is built so that EVERY OTHER blocking row reads done: the
 * checks server/index.ts would wire are stubbed to ok, the manual and decided
 * rows are answered through the real `confirmManual`, and the purpose
 * statement is written through its real writer. So each refusal below names
 * exactly one row, and the assertion is on that whole answer, never on "some
 * refusal happened".
 *
 * Order-dependent by design: one village, walked through its states in turn,
 * each test putting back what it moved.
 */
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { confirmManual, launchStatus, launchVoteBlocked, type LaunchDeps } from "./launch";
import { writeGoverningPurpose } from "./governingPurpose";
import { normalizeExitPolicy } from "./exitPolicy";
import { LAUNCH_REQUIREMENTS } from "../../shared/launchRequirements";
import { CANVAS_BLOCK_IDS } from "../../shared/governanceCanvas";
import { PURPOSE_EXAMPLE } from "../../shared/governingPurpose";
import { recordCanvasReading } from "../repos/canvasReadings";
import { writeConfigDocument } from "../repos/appConfigDocs";
import { insertRoleIfAbsent } from "../repos/stewardRoles";
import { insertHoldingIfAbsent } from "../repos/permissionHoldings";
import { usersRepo } from "../repos/users";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[launchGovernance.db.test] TEST_DATABASE_URL not set. The governance rows are UNCHECKED against a database.");
}

let db: TestDb;
let pool: Pool;

/** The governance module's effective lifecycle, as the test sets it. */
let governance = "members";

/**
 * Every check server/index.ts would wire reads ok, and every module but
 * governance is off, so the only rows that can refuse are the ones this file
 * is about and the ones it answers for real.
 */
const deps = (): LaunchDeps => {
  const checks: LaunchDeps["checks"] = {};
  for (const r of LAUNCH_REQUIREMENTS) checks[r.checkKey] = () => ({ state: "ok" as const, detail: "stubbed ok" });
  return { checks, moduleLifecycle: (id) => (id === "governance" ? governance : "off") };
};

const title = (id: string): string => {
  const r = LAUNCH_REQUIREMENTS.find((x) => x.id === id);
  if (!r) throw new Error(`no launch requirement "${id}"`);
  return r.title;
};

/** The refusal naming exactly one row. */
const refusedOn = (id: string) => ({ error: "1 item(s) on the journey still block the launch vote.", open: [title(id)] });

const item = async (id: string) => {
  const found = (await launchStatus(pool, deps())).items.find((i) => i.id === id);
  if (!found) throw new Error(`"${id}" is not on the journey`);
  return found;
};

/** The village's own exit policy, with the conflict door open by its intake role. */
const policy = (restorative: Record<string, unknown> = {}) =>
  normalizeExitPolicy({
    placeholder: false,
    voluntary: { noticePeriodDays: 21, valuationMethod: "Hours are honoured at the rate the circle agreed.", unwindSteps: ["Hand back the keys"] },
    involuntary: { decidingDomainId: "", appealDomainId: "", process: "Two stewards sit with the person first." },
    restorative: { intakeContactRole: "care", steps: ["Somebody who was not involved hears both people"], replyHours: 48, ...restorative },
  });

const writePolicy = async (doc: Record<string, unknown>) => writeConfigDocument(pool, "exit-policy", doc);

const readBlock = (blockId: (typeof CANVAS_BLOCK_IDS)[number]) =>
  recordCanvasReading(pool, {
    blockId,
    level: 1,
    sentence: "Not decided yet, because we have not sat down with it together.",
    moment: "baseline",
    recordedBy: "usr-founder",
  });

const setAdmitted = async (id: string, admitted: boolean) => {
  await usersRepo(pool).update(id, (m) => {
    m.membershipGranted = admitted;
  });
};

describe.skipIf(!configured)("the governance rows on the launch vote", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisions and drops

    // One founder, three admitted members who are not founders, and two
    // accounts that must NOT count toward those three: a guest nobody has
    // admitted, and an example row.
    const users = usersRepo(pool);
    await users.add({ id: "usr-founder", name: "Ida Founder", email: "ida@example.test", role: "founder", membershipGranted: true });
    for (const n of [1, 2, 3]) {
      await users.add({ id: `usr-m${n}`, name: `Member ${n}`, email: `m${n}@example.test`, role: "member", membershipGranted: true });
    }
    await users.add({ id: "usr-guest", name: "Guest", email: "guest@example.test", role: "member", membershipGranted: false });
    await users.add({ id: "usr-example", name: "Example", email: "ex@example.test", role: "member", membershipGranted: true, isExample: true });

    await insertRoleIfAbsent(pool, { id: "care", name: "Care", description: "", capabilitiesJson: "[]", sortOrder: 1 });
    await insertRoleIfAbsent(pool, { id: "elders", name: "Elders", description: "", capabilitiesJson: "[]", sortOrder: 2 });
    await insertHoldingIfAbsent(pool, { id: "rh-care-1", roleId: "care", userId: "usr-m1", grantedBy: "test", termEndsAt: null, seasonId: null });
    // The elders' only seat ran out yesterday.
    await insertHoldingIfAbsent(pool, {
      id: "rh-elders-1",
      roleId: "elders",
      userId: "usr-m2",
      grantedBy: "test",
      termEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      seasonId: null,
    });

    // Every other blocking row, answered the way a founder answers it.
    expect((await confirmManual(pool, "backups-drilled", "usr-founder", true)).ok).toBe(true);
    expect((await confirmManual(pool, "issuance-cap", "usr-founder", "declined")).ok).toBe(true);
    expect((await writeGoverningPurpose(pool, { statement: PURPOSE_EXAMPLE, writtenBy: "usr-founder" })).ok).toBe(true);
    await writePolicy(policy() as any);

    // Eleven of the twelve blocks read, all at Absent. The twelfth is the first test.
    for (const blockId of CANVAS_BLOCK_IDS) if (blockId !== "impact") await readBlock(blockId);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("refuses while one canvas block has no reading, and names only that row", async () => {
    expect(await launchVoteBlocked(pool, deps())).toEqual(refusedOn("canvas-on-record"));
    expect((await item("canvas-on-record")).detail).toContain("Still without a reading: Impact.");
  });

  it("lets the vote through once every block has a reading, and a reading of Absent counts", async () => {
    await readBlock("impact");
    expect(await launchVoteBlocked(pool, deps())).toBeNull();
    const canvas = await item("canvas-on-record");
    expect(canvas.state).toBe("ok");
    const door = await item("conflict-door");
    expect(door.state).toBe("ok");
    expect(door.detail).toBe("The Care role is held today, and a member hears back within 48 hours");
    expect((await item("governance-on-for-members")).state).toBe("ok");
  });

  it("refuses with no promised reply time, and the platform supplies none", async () => {
    await writePolicy(policy({ replyHours: null }) as any);
    expect(await launchVoteBlocked(pool, deps())).toEqual(refusedOn("conflict-door"));
    expect((await item("conflict-door")).detail).toBe("No reply time is promised yet. Say within how many hours a member hears back");
    await writePolicy(policy() as any);
    expect(await launchVoteBlocked(pool, deps())).toBeNull();
  });

  it("refuses when the intake role's only holder's term has run out", async () => {
    await writePolicy(policy({ intakeContactRole: "elders" }) as any);
    expect(await launchVoteBlocked(pool, deps())).toEqual(refusedOn("conflict-door"));
    expect((await item("conflict-door")).detail).toBe(
      "Nobody holds the Elders role today, because every term in it has run out, and no outside contact is named",
    );
    await writePolicy(policy() as any);
  });

  it("below three admitted members who are not founders, refuses a live holder alone and accepts a named outside contact", async () => {
    // Two left. The guest and the example row are still there, and they do not count.
    await setAdmitted("usr-m3", false);
    try {
      expect(await launchVoteBlocked(pool, deps())).toEqual(refusedOn("conflict-door"));
      expect((await item("conflict-door")).detail).toContain("Fewer than three members here are not founders");
      await writePolicy(
        policy({ outsideContact: { name: "Jo Bell", organisation: "Cohort Care", howToReach: "ombuds@example.org" } }) as any,
      );
      expect(await launchVoteBlocked(pool, deps())).toBeNull();
      expect((await item("conflict-door")).detail).toContain("Jo Bell (Cohort Care) is the outside contact");
    } finally {
      await setAdmitted("usr-m3", true);
      await writePolicy(policy() as any);
    }
  });

  it("reads a policy saved before the conflict door's fields existed as missing, and never throws", async () => {
    await writePolicy({
      placeholder: false,
      voluntary: { noticePeriodDays: 21, valuationMethod: "Ours.", unwindSteps: ["Ours"] },
      involuntary: { decidingDomainId: "", appealDomainId: "", process: "Ours." },
      restorative: { intakeContactRole: "care", steps: ["Ours"] },
    });
    expect(await launchVoteBlocked(pool, deps())).toEqual(refusedOn("conflict-door"));
    await writePolicy(policy() as any);
    expect(await launchVoteBlocked(pool, deps())).toBeNull();
  });

  it("refuses while governance is off or open to admins only, and passes at members and public", async () => {
    try {
      for (const closed of ["off", "preview"]) {
        governance = closed;
        expect(await launchVoteBlocked(pool, deps()), closed).toEqual(refusedOn("governance-on-for-members"));
      }
      for (const open of ["members", "public"]) {
        governance = open;
        expect(await launchVoteBlocked(pool, deps()), open).toBeNull();
      }
    } finally {
      governance = "members";
    }
  });
});
