/**
 * The change-set executor: two phases, one ledger row per write, and a refusal
 * that names the element.
 *
 * The rules pinned here:
 *
 *  - item four of seven failing validation applies NOTHING and names item four;
 *  - the legacy apply THROWS before its first write on an element it cannot
 *    type, instead of skipping it and stamping the proposal applied;
 *  - a change set can never switch the governance module off;
 *  - every write leaves a `governance_element_ledger` row carrying the old and
 *    the new value;
 *  - the caches are reloaded from the database after a set applies;
 *  - the dry run writes nothing, and previews what would actually run.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  applyChangeSet,
  applyMechanicsProposal,
  changeSetSnapsToBoundary,
  changeSetWaitsForCycleClose,
  elementsFor,
  NEVER_BY_CHANGESET,
  UntypedElementError,
  validateElements,
  type ChangesetDeps,
} from "./changeset";
import { dryRunProposal } from "./proposalDryRun";
import { loadVariables, numberVar } from "./variables";
import { VARIABLES, applyTimingOf } from "../../shared/gameVariables";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;
let reloads = 0;
let ledgerRows: string[] = [];

const deps = (): ChangesetDeps => ({
  pool,
  recordMechanicsChange: async (key) => {
    ledgerRows.push(key);
  },
  reloadCaches: async () => {
    reloads += 1;
    await loadVariables(pool);
  },
  sharedPasswordPosture: () => false,
});

/** Seven items, of which the fourth is a dial the registry does not have. */
const sevenWithABadFourth = () => [
  { kind: "dial", key: "governance.vote_days", to: "9" },
  { kind: "dial", key: "governance.unity_pct", to: "70" },
  { kind: "dial", key: "governance.quorum_pct", to: "25" },
  { kind: "dial", key: "governance.a_dial_that_never_existed", to: "1" },
  { kind: "dial", key: "governance.sensing_days", to: "5" },
  { kind: "dial", key: "governance.consent_window_days", to: "4" },
  { kind: "dial", key: "governance.change_cooldown_days", to: "2" },
];

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
  await loadVariables(pool);
}, 300000);

afterAll(async () => {
  if (pool) await pool.end();
  if (db) await db.drop();
});

beforeEach(async () => {
  if (!configured) return;
  reloads = 0;
  ledgerRows = [];
  await pool.query("DELETE FROM governance_element_ledger"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
});

describe.skipIf(!configured)("phase one refuses before anything is written", () => {
  it("names item four of seven and applies nothing", async () => {
    const before = numberVar("governance.vote_days");
    const result = await applyChangeSet(deps(), {
      ballotId: "bal-refusal",
      proposalRef: "gm:refusal",
      actor: "u-a",
      changes: sevenWithABadFourth(),
    });
    expect(result.ok).toBe(false);
    expect(result.refusal?.index).toBe(3);
    expect(result.refusal?.sentence).toContain("Item 4 of 7");
    expect(result.refusal?.sentence).toContain("no longer exists in the registry");
    expect(result.applied).toEqual([]);
    // Not one write, including the three elements that came BEFORE the bad one.
    await loadVariables(pool);
    expect(numberVar("governance.vote_days")).toBe(before);
    expect(await elementsFor(pool, "bal-refusal")).toEqual([]);
    expect(ledgerRows).toEqual([]);
  });

  it("refuses a dial the village does not govern", async () => {
    const out = await validateElements(deps(), [{ kind: "dial", key: "governance.weight_mode", to: "token" }]);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.problem).toContain("community-governable");
  });

  it("refuses to switch the part of the Game that holds the vote", async () => {
    expect(NEVER_BY_CHANGESET.has("governance")).toBe(true);
    const out = await validateElements(deps(), [{ kind: "module_lifecycle", moduleId: "governance", to: "off" }]);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.problem).toContain("cannot be switched by a vote");
  });

  it("refuses to switch into token mode on a token that cannot weigh a vote", async () => {
    const out = await validateElements(deps(), [
      { kind: "mode_switch", to: "token", weightToken: "a-token-this-village-never-made" },
    ]);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.problem).toContain("no token called");
  });

  it("refuses a weight allocation with no reason", async () => {
    const out = await validateElements(deps(), [
      { kind: "weight_allocation", userId: "u-a", to: "5", note: "" },
    ]);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.problem).toContain("reason");
  });

  it("calls a whole set a Game change the moment one element is one", async () => {
    const out = await validateElements(deps(), [{ kind: "dial", key: "governance.vote_days", to: "8" }]);
    expect(out.ok).toBe(true);
    expect(out.ok === true && out.kind).toBe("game_change");
  });
});

describe.skipIf(!configured)("phase two writes, and records what it wrote", () => {
  it("applies every element and leaves one ledger row per write", async () => {
    const result = await applyChangeSet(deps(), {
      ballotId: "bal-good",
      proposalRef: "gm:good",
      actor: "u-a",
      changes: [
        { kind: "dial", key: "governance.vote_days", to: "9" },
        { kind: "dial", key: "governance.sensing_days", to: "5" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.applied).toEqual(["governance.vote_days", "governance.sensing_days"]);
    const rows = await elementsFor(pool, "bal-good");
    expect(rows.length).toBe(2);
    expect(rows[0].newValue).toBe("9");
    expect(rows[0].oldValue).not.toBeNull();
    expect(rows[0].sentence).toContain("governance.vote_days moves from");
    // The caches come back from the database, not from what the routine believes.
    expect(reloads).toBeGreaterThanOrEqual(1);
    await loadVariables(pool);
    expect(numberVar("governance.vote_days")).toBe(9);
  });

  it("orders the harder-to-undo writes after the easier ones", async () => {
    await applyChangeSet(deps(), {
      ballotId: "bal-order",
      proposalRef: "gm:order",
      actor: "u-a",
      changes: [
        { kind: "weight_allocation", userId: "u-order", to: "3", note: "the founding table" },
        { kind: "dial", key: "governance.quorum_pct", to: "24" },
      ],
    });
    const rows = await elementsFor(pool, "bal-order");
    expect(rows.map((r) => r.kind)).toEqual(["dial", "weight_allocation"]);
  });
});

describe.skipIf(!configured)("the legacy apply throws rather than half-applying", () => {
  it("throws before the first write on an element it cannot carry out", async () => {
    const before = numberVar("governance.consent_window_days");
    await expect(
      applyMechanicsProposal(
        deps(),
        {
          id: "gmp-untyped",
          title: "A brand change this build cannot make",
          changeSet: [
            { kind: "dial", key: "governance.consent_window_days", to: "6" },
            { kind: "brand_field", field: "project.name", to: "Something" },
          ],
          proposerUserId: "u-a",
          hyphaRef: null,
          status: "passed_onsite",
          ballotId: "bal-untyped",
        },
        "u-a",
        { onApplied: async () => {} },
      ),
    ).rejects.toBeInstanceOf(UntypedElementError);
    await loadVariables(pool);
    expect(numberVar("governance.consent_window_days")).toBe(before);
    expect(await elementsFor(pool, "bal-untyped")).toEqual([]);
  });

  it("names the element in the throw, by its place in the set", async () => {
    try {
      await applyMechanicsProposal(
        deps(),
        {
          id: "gmp-untyped-2",
          title: "Two changes, one impossible",
          changeSet: [
            { kind: "dial", key: "governance.vote_days", to: "8" },
            { kind: "role", act: "seat", role: "steward", userId: "u-a" },
          ],
          proposerUserId: "u-a",
          hyphaRef: null,
          status: "passed_onsite",
          ballotId: "bal-untyped-2",
        },
        "u-a",
        { onApplied: async () => {} },
      );
      throw new Error("it should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UntypedElementError);
      expect((e as UntypedElementError).index).toBe(1);
      expect((e as UntypedElementError).kind).toBe("role");
      expect((e as Error).message).toContain("Item 2 of 2");
    }
  });

  it("returns cleanly on a proposal that already applied", async () => {
    const out = await applyMechanicsProposal(
      deps(),
      { id: "gmp-done", title: "Already", changeSet: [], proposerUserId: "u-a", hyphaRef: null, status: "applied" },
      "u-a",
      { onApplied: async () => { throw new Error("must not be called"); } },
    );
    expect(out.ok).toBe(true);
    expect(out.applied).toEqual([]);
  });
});

describe.skipIf(!configured)("the dry run writes nothing", () => {
  const preview = (changes: unknown[]) =>
    dryRunProposal(deps(), {
      changes: changes as never,
      timing: "next_moon",
      closesAt: new Date("2026-09-10T12:00:00.000Z"),
      vetoHours: 72,
      nextBoundaryAfter: (after: Date) => new Date(after.getTime() + 20 * 24 * 60 * 60 * 1000),
    });

  it("previews a good set and changes nothing on disk", async () => {
    const before = numberVar("governance.change_cooldown_days");
    const out = await preview([{ kind: "dial", key: "governance.change_cooldown_days", to: "7" }]);
    expect(out.wouldApply).toBe(true);
    expect(out.elements[0].newValue).toBe("7");
    expect(out.landsAt).toBe("2026-09-30T12:00:00.000Z");
    await loadVariables(pool);
    expect(numberVar("governance.change_cooldown_days")).toBe(before);
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM governance_element_ledger");
    expect(Number(rows[0].n)).toBe(0);
  });

  it("previews the same blocker the executor would raise, on the same element", async () => {
    const out = await preview(sevenWithABadFourth());
    expect(out.wouldApply).toBe(false);
    expect(out.blocker?.index).toBe(3);
    const real = await applyChangeSet(deps(), {
      ballotId: "bal-same",
      proposalRef: "gm:same",
      actor: "u-a",
      changes: sevenWithABadFourth(),
    });
    expect(real.refusal?.index).toBe(out.blocker?.index);
    expect(real.refusal?.sentence).toBe(out.blocker?.sentence);
  });
});

describe("the cycle-timed predicate, with no database", () => {
  it("says a set holding a cycle-timed dial waits as a whole", () => {
    /*
     * THIS TEST'S TITLE WAS A CLAIM IT NEVER CHECKED. Both of its assertions
     * were `.toBe(false)`: it proved that two things which do NOT wait do not
     * wait, and never once asked a dial that does. The positive case, which is
     * the whole behaviour, was untested.
     */
    expect(changeSetWaitsForCycleClose([{ key: "gratitude.base_budget" }])).toBe(true);
    expect(changeSetWaitsForCycleClose([{ key: "governance.vote_days" }])).toBe(false);
    expect(changeSetWaitsForCycleClose([{ key: "a.key.that.does.not.exist" }])).toBe(false);
    // A set waits if ANY element does, which is 19F's "who bundle waits".
    expect(
      changeSetWaitsForCycleClose([{ key: "governance.vote_days" }, { key: "gratitude.base_budget" }]),
    ).toBe(true);
  });

  it("agrees with the REGISTRY on every dial, not on the two somebody picked", () => {
    /*
     * A TOTAL COMPARATOR, and it replaces a sample of two.
     *
     * `applyTimingOf` on the variable definition is what DECLARES that a dial
     * moves a number the running cycle is settled against.
     * `changeSetWaitsForCycleClose` is what the landing path ASKS. Those are
     * two readings of one fact, and nothing forced them to agree: the sample
     * above checked one key of the twenty-three that carry the timing, so a
     * dial whose key shape the predicate mishandled would have waited for
     * nobody and nothing would have failed.
     *
     * Enumerating from the registry means a dial added later is covered the day
     * it is added, by whoever adds it, without anybody remembering this file.
     */
    const declared = VARIABLES.filter((v) => applyTimingOf(v) === "cycle-close");
    // The control: a registry that has stopped answering must fail here rather
    // than pass as a clean sweep over an empty list.
    expect(declared.length, "the registry must still name cycle-close dials").toBeGreaterThan(10);

    const disagree: string[] = [];
    for (const v of VARIABLES) {
      const registrySays = applyTimingOf(v) === "cycle-close";
      const predicateSays = changeSetWaitsForCycleClose([{ key: v.key }]);
      if (registrySays !== predicateSays) {
        disagree.push(`${v.key}: registry says ${registrySays}, predicate says ${predicateSays}`);
      }
    }
    expect(disagree, "the registry and the landing path must read the same dials").toEqual([]);
  });
});

/**
 * ── THE MIX THE SECOND AUDIT FOUND (top risk 3) ────────────────────────────
 *
 * Three rules collided on one row and nothing said which won. Read one way, a
 * faction publishes one proposal that edits the veto map and reallocates the
 * weight table, and the whole thing lands with nobody able to stop the half
 * that was meant to be stoppable. Read the other way, a steward gets a veto
 * over the edit to their own reach whenever it travels with anything else.
 *
 * Before this refusal existed the set validated and went to a vote.
 */
describe.skipIf(!configured)("a set may not mix an unstoppable element with any other kind", () => {
  it("refuses a veto-map edit travelling with a weight allocation, naming both", async () => {
    const out = await validateElements(deps(), [
      { kind: "dial", key: "governance.steward_subjects", to: "mechanics" },
      { kind: "weight_allocation", userId: "u-mix", to: "40", note: "the founding table" },
    ]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problem).toContain("governance.steward_subjects");
    expect(out.problem).toContain("weight_allocation");
    expect(out.sentence).toContain("Item 1 of 2");
  });

  it("refuses the council switch and the window length the same way", async () => {
    for (const key of ["governance.steward_council", "governance.veto_hours"]) {
      const out = await validateElements(deps(), [
        { kind: "dial", key: "governance.vote_days", to: "9" },
        { kind: "dial", key, to: key === "governance.veto_hours" ? "96" : "true" },
      ]);
      expect(out.ok, `${key} travelling with an ordinary dial`).toBe(false);
      if (out.ok) continue;
      expect(out.problem).toContain(key);
    }
  });

  it("allows a set made only of unstoppable elements", async () => {
    const out = await validateElements(deps(), [
      { kind: "dial", key: "governance.steward_subjects", to: "mechanics" },
      { kind: "dial", key: "governance.veto_hours", to: "96" },
    ]);
    expect(out.ok, JSON.stringify(out)).toBe(true);
  });

  it("allows an ordinary set, which is every other proposal in the village", async () => {
    const out = await validateElements(deps(), [
      { kind: "dial", key: "governance.vote_days", to: "9" },
      { kind: "dial", key: "governance.sensing_days", to: "5" },
    ]);
    expect(out.ok).toBe(true);
  });

  it("writes nothing when it refuses", async () => {
    const before = numberVar("governance.vote_days");
    const result = await applyChangeSet(deps(), {
      ballotId: "bal-mix",
      proposalRef: "gm:mix",
      actor: "u-a",
      changes: [
        { kind: "dial", key: "governance.veto_hours", to: "96" },
        { kind: "dial", key: "governance.vote_days", to: "11" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.refusal?.problem).toContain("governance.veto_hours");
    await loadVariables(pool);
    expect(numberVar("governance.vote_days")).toBe(before);
    expect(await elementsFor(pool, "bal-mix")).toEqual([]);
  });
});

describe.skipIf(!configured)("a set that moves a number the running cycle is settled against", () => {
  it("is named by changeSetSnapsToBoundary, and an ordinary dial is not", () => {
    expect(changeSetSnapsToBoundary([{ key: "gratitude.base_budget" }])).toBe(true);
    expect(changeSetSnapsToBoundary([{ key: "cycle.mode" }])).toBe(true);
    expect(changeSetSnapsToBoundary([{ kind: "mint_rule", key: "mint.anything" }])).toBe(true);
    expect(changeSetSnapsToBoundary([{ key: "governance.vote_days" }])).toBe(false);
    expect(changeSetSnapsToBoundary([{ key: "a.key.that.does.not.exist" }])).toBe(false);
  });
});

describe.skipIf(!configured)("the element ledger is keyed on the element, not on a row id", () => {
  it("writes one row per element however many times the landing is retried", async () => {
    const changes = [{ kind: "dial", key: "governance.sensing_days", to: "6" }];
    await applyChangeSet(deps(), { ballotId: "bal-retry", proposalRef: "gm:retry", actor: "u-a", changes });
    await applyChangeSet(deps(), { ballotId: "bal-retry", proposalRef: "gm:retry", actor: "u-a", changes });
    const rows = await elementsFor(pool, "bal-retry");
    expect(rows.length, "a retry must not say the dial moved twice").toBe(1);
  });

  it("carries the proposal id beside the ballot id, so a reversion can join it", async () => {
    await applyChangeSet(deps(), {
      ballotId: "bal-join",
      proposalRef: "gm:join",
      actor: "u-a",
      changes: [{ kind: "dial", key: "governance.sensing_days", to: "8" }],
    });
    const [rows] = await pool.query<any[]>(
      "SELECT proposal_id FROM governance_element_ledger WHERE ballot_id = ?",
      ["bal-join"],
    );
    expect(String(rows[0]?.proposal_id)).toBe("gm:join");
  });
});
