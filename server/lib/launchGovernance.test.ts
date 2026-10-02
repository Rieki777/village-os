/**
 * THE THREE GOVERNANCE ROWS ON THE LAUNCH CHECKLIST, every state, no database.
 *
 * Each resolver is pure: it takes facts and answers a state and one sentence.
 * So every state is driven here directly, and the registry entries are held to
 * the keys and the severity the ruling set (Rye chose Option B: all three
 * block). `launchGovernance.db.test.ts` is the other half: the same rows
 * refusing the launch vote against a real database.
 */
import { describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import {
  CANVAS_ON_RECORD_KEY,
  CONFLICT_DOOR_KEY,
  GOVERNANCE_ON_KEY,
  GOVERNANCE_ROW_KEYS,
  OUTSIDE_CONTACT_BELOW,
  canvasOnRecordCheck,
  conflictDoorCheck,
  governanceOnCheck,
  governanceRowFor,
  type ConflictDoorFacts,
} from "./launchGovernance";
import { CANVAS_BLOCK_IDS, CANVAS_BLOCKS } from "../../shared/governanceCanvas";
import { LAUNCH_REQUIREMENTS } from "../../shared/launchRequirements";

const EVERY_BLOCK = [...CANVAS_BLOCK_IDS];

describe("canvas-on-record: every one of the twelve blocks has a reading", () => {
  it("is missing when nothing has been read, and says an Absent reading counts", () => {
    const r = canvasOnRecordCheck([]);
    expect(r.state).toBe("missing");
    expect(r.detail).toBe("No block has a reading yet. A reading of Absent, with one sentence saying why, counts");
  });

  it("is missing while one block has no reading, and names that block", () => {
    const r = canvasOnRecordCheck(EVERY_BLOCK.filter((id) => id !== "conflict"));
    expect(r.state).toBe("missing");
    expect(r.detail).toBe(
      `Still without a reading: ${CANVAS_BLOCKS.conflict.name}. A reading of Absent, with one sentence saying why, counts`,
    );
  });

  it("names every unread block, in canvas order, and never as a count out of twelve (R55)", () => {
    const r = canvasOnRecordCheck(["purpose", "team", "roles", "meetings", "stakeholders", "coordination", "power", "conflict", "learning"]);
    expect(r.state).toBe("missing");
    expect(r.detail).toContain("Still without a reading: Resourcing, Legal and Impact.");
    expect(r.detail).not.toMatch(/\d/);
    expect(r.detail).not.toContain("%");
  });

  it("is ok once every block has at least one reading, however many repeats", () => {
    const r = canvasOnRecordCheck([...EVERY_BLOCK, "purpose", "purpose", "conflict"]);
    expect(r).toEqual({ state: "ok", detail: "Every block has a reading on record" });
  });

  it("does not count a reading of a block the registry does not know", () => {
    const r = canvasOnRecordCheck([...EVERY_BLOCK.filter((id) => id !== "impact"), "not-a-block"]);
    expect(r.state).toBe("missing");
    expect(r.detail).toContain("Impact");
  });
});

/** A village where the conflict door is open by its intake role, with three members who are not founders. */
const door = (over: Partial<ConflictDoorFacts> = {}): ConflictDoorFacts => ({
  replyHours: 48,
  outsideContact: { name: "", organisation: "", howToReach: "" },
  intakeRoleId: "care",
  intakeRoleName: "Care",
  liveIntakeHolders: 1,
  lapsedIntakeHolders: 0,
  nonFounderMembers: OUTSIDE_CONTACT_BELOW,
  ...over,
});

const OMBUDS = { name: "Jo Bell", organisation: "Cohort Care", howToReach: "ombuds@example.org" };

describe("conflict-door: somebody to bring a conflict to, and a promised reply", () => {
  it("is ok with a live holder of the intake role and a reply time, at three members who are not founders", () => {
    expect(conflictDoorCheck(door())).toEqual({
      state: "ok",
      detail: "The Care role is held today, and a member hears back within 48 hours",
    });
  });

  it("says one hour, not one hours", () => {
    expect(conflictDoorCheck(door({ replyHours: 1 })).detail).toContain("within 1 hour");
  });

  it("is missing with no reply time, whatever the door, and there is no default to fall back on", () => {
    const r = conflictDoorCheck(door({ replyHours: null }));
    expect(r.state).toBe("missing");
    expect(r.detail).toBe("No reply time is promised yet. Say within how many hours a member hears back");
    expect(conflictDoorCheck(door({ replyHours: null, outsideContact: OMBUDS })).state).toBe("missing");
  });

  it("is missing when nobody holds the intake role today and no outside contact is named", () => {
    const r = conflictDoorCheck(door({ liveIntakeHolders: 0 }));
    expect(r.state).toBe("missing");
    expect(r.detail).toBe("Nobody holds the Care role today, and no outside contact is named");
  });

  it("says so when the holders are there and every term has run out", () => {
    const r = conflictDoorCheck(door({ liveIntakeHolders: 0, lapsedIntakeHolders: 2 }));
    expect(r.state).toBe("missing");
    expect(r.detail).toBe("Nobody holds the Care role today, because every term in it has run out, and no outside contact is named");
  });

  it("is missing when no intake role is chosen and no outside contact is named", () => {
    const r = conflictDoorCheck(door({ intakeRoleId: "", intakeRoleName: null, liveIntakeHolders: 0 }));
    expect(r.detail).toBe("No intake role is chosen and no outside contact is named");
  });

  it("does not count holders of a role that no longer exists", () => {
    const r = conflictDoorCheck(door({ intakeRoleName: null, liveIntakeHolders: 3 }));
    expect(r.state).toBe("missing");
    expect(r.detail).toBe("The intake role on the exit policy no longer exists, and no outside contact is named");
  });

  it("is ok with a named outside contact in place of a holder", () => {
    const r = conflictDoorCheck(door({ liveIntakeHolders: 0, outsideContact: OMBUDS }));
    expect(r).toEqual({
      state: "ok",
      detail: "Jo Bell (Cohort Care) is the outside contact, and a member hears back within 48 hours",
    });
  });

  it("names both when both are there", () => {
    expect(conflictDoorCheck(door({ outsideContact: OMBUDS })).detail).toBe(
      "The Care role is held today, Jo Bell (Cohort Care) is the outside contact, and a member hears back within 48 hours",
    );
  });

  it("below three members who are not founders, a live holder is not enough: the outside contact is required", () => {
    const small = door({ nonFounderMembers: OUTSIDE_CONTACT_BELOW - 1, liveIntakeHolders: 4 });
    const r = conflictDoorCheck(small);
    expect(r.state).toBe("missing");
    expect(r.detail).toBe(
      "Fewer than three members here are not founders, so a conflict needs a named contact outside the village. Give their name and how to reach them",
    );
    expect(conflictDoorCheck({ ...small, outsideContact: OMBUDS }).state).toBe("ok");
    // No members at all but founders is the Season Two shape, and the same rule.
    expect(conflictDoorCheck(door({ nonFounderMembers: 0, outsideContact: OMBUDS })).state).toBe("ok");
  });

  it("a contact with no way to reach them is not named", () => {
    const r = conflictDoorCheck(door({ nonFounderMembers: 0, outsideContact: { ...OMBUDS, howToReach: "  " } }));
    expect(r.state).toBe("missing");
    expect(conflictDoorCheck(door({ nonFounderMembers: 0, outsideContact: { ...OMBUDS, name: "" } })).state).toBe("missing");
  });

  it("the organisation is optional", () => {
    const r = conflictDoorCheck(door({ nonFounderMembers: 0, liveIntakeHolders: 0, outsideContact: { ...OMBUDS, organisation: "" } }));
    expect(r).toEqual({ state: "ok", detail: "Jo Bell is the outside contact, and a member hears back within 48 hours" });
  });

  it("names every missing piece at once", () => {
    const r = conflictDoorCheck(door({ nonFounderMembers: 1, replyHours: null }));
    expect(r.detail).toBe(
      "Fewer than three members here are not founders, so a conflict needs a named contact outside the village. Give their name and how to reach them. No reply time is promised yet. Say within how many hours a member hears back",
    );
  });
});

describe("governance-on-for-members: members can answer the vote", () => {
  it("is missing while governance is off", () => {
    expect(governanceOnCheck("off")).toEqual({
      state: "missing",
      detail: "Governance is off, so there is no vote a member could answer",
    });
  });

  it("is missing at preview, where only admins reach a vote", () => {
    expect(governanceOnCheck("preview")).toEqual({
      state: "missing",
      detail: "Governance is open to admins only, so a member sent to the vote would find nothing there",
    });
  });

  it("is ok open to members, and open to everyone", () => {
    expect(governanceOnCheck("members")).toEqual({ state: "ok", detail: "Governance is open to members" });
    expect(governanceOnCheck("public")).toEqual({ state: "ok", detail: "Governance is open to everyone, members included" });
  });

  it("reads a lifecycle it does not know as closed", () => {
    expect(governanceOnCheck("").state).toBe("missing");
    expect(governanceOnCheck("sideways").state).toBe("missing");
  });
});

describe("the adapter", () => {
  it("asks the module lifecycle for governance, and nothing else, for the governance row", async () => {
    const asked: string[] = [];
    const noPool = {} as Pool;
    const r = await governanceRowFor(noPool, { moduleLifecycle: (id) => (asked.push(id), "members") }, GOVERNANCE_ON_KEY);
    expect(r.state).toBe("ok");
    expect(asked).toEqual(["governance"]);
  });

  it("reads a key it does not resolve as missing, in words that name it", async () => {
    const r = await governanceRowFor({} as Pool, { moduleLifecycle: () => "off" }, "governance:nothing-here");
    expect(r).toEqual({
      state: "missing",
      detail: 'No governance resolver for "governance:nothing-here". This is a platform bug, report it',
    });
  });
});

describe("the three rows on the registry", () => {
  const row = (id: string) => {
    const r = LAUNCH_REQUIREMENTS.find((x) => x.id === id);
    if (!r) throw new Error(`no launch requirement "${id}"`);
    return r;
  };

  it("are blocking, in the governance group, and keyed to this file's resolvers", () => {
    expect(row("canvas-on-record").checkKey).toBe(CANVAS_ON_RECORD_KEY);
    expect(row("conflict-door").checkKey).toBe(CONFLICT_DOOR_KEY);
    expect(row("governance-on-for-members").checkKey).toBe(GOVERNANCE_ON_KEY);
    for (const id of ["canvas-on-record", "conflict-door", "governance-on-for-members"]) {
      expect(row(id).severity, id).toBe("blocking");
      expect(row(id).group, id).toBe("governance");
      // A row the governance module's own switch could withdraw would hide the refusal it exists to show.
      expect(row(id).appliesWhenModule, id).toBeUndefined();
    }
  });

  it("every canvas: and governance: key on the list has a resolver here", () => {
    const keys = LAUNCH_REQUIREMENTS.map((r) => r.checkKey).filter((k) => k.startsWith("canvas:") || k.startsWith("governance:"));
    expect([...keys].sort()).toEqual([...GOVERNANCE_ROW_KEYS].sort());
  });

  it("tells a founder that not decided yet counts, and links to the Canvas view", () => {
    expect(row("canvas-on-record").why).toContain('"not decided yet, because..."');
    expect(row("canvas-on-record").fixAt).toBe("/journey-to-launch?view=canvas");
  });

  it("moves the exit policy's terms in beside them, and sends a founder to Departures where the editor is", () => {
    expect(row("exit-policy-terms").group).toBe("governance");
    expect(row("exit-policy-terms").severity).toBe("blocking");
    expect(row("exit-policy-terms").fixAt).toBe("/admin?tab=exits-admin");
    expect(row("conflict-door").fixAt).toBe("/admin?tab=exits-admin");
  });

  it("sends a founder to the governance module itself", () => {
    expect(row("governance-on-for-members").fixAt).toBe("/admin?tab=modules&module=governance");
  });
});
