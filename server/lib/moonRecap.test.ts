/**
 * THE END-OF-MOON REVIEW, lane B: the decisions server/lib/moonRecap.ts makes
 * with no database in them. Gather from the board (check 36), the rooms, the
 * roles held during a moon (check 2), one terms entry per application
 * (check 3), and which moon a bare `GET /api/me/moon` opens.
 *
 * The database half is server/lib/moonRecap.db.test.ts. Every person and task
 * here is invented.
 */
import { describe, expect, it } from "vitest";
import { CALENDAR_CLOCK, LUNAR_CLOCK } from "../../shared/cycleClock";
import { readingOf, scoreContextOf, SERA_CLOSED_NOTE, taskScore, type AssignmentRow, type RecapItem } from "../../shared/moonRecap";
import { SCREEN_REASON_WORDS } from "../../shared/memberTaskFeedback";
import type { AccomplishmentMoon } from "../../shared/taskAccomplishments";
import type { BoardPress, BoardTask } from "../repos/moonGather";
import type { InvoiceRow, RecapRow } from "../repos/moonRecaps";
import {
  boardCandidates, boundsForCycleId, defaultCycleId, moonOf, resolveMoon, roomCandidates, rolesHeldFrom, seasonOn, summaryFor, termsFrom,
} from "./moonRecap";

const TZ = "America/Costa_Rica";
// The moon of 10 October to 8 November 2026, which ends with the 9 November new moon.
const MOON = moonOf(LUNAR_CLOCK.boundsFor(new Date("2026-10-20T12:00:00Z")), TZ);

const task = (over: Partial<BoardTask>): BoardTask => ({
  id: "t-1", title: "Draft the water plan", source: "self", externalId: null, status: "open", removeReason: null,
  createdOn: "2026-10-12", doneAt: null, roleId: null, servesGoalId: null, ...over,
});
const press = (taskId: string, action: string, screenReason: string | null = null): BoardPress => ({ taskId, action, screenReason, redirectToUserId: null, redirectToRoleId: null });

describe("the moon", () => {
  it("is the one the spec names, with its end-of-moon Friday", () => {
    expect(MOON.ref).toMatchObject({ firstDay: "2026-10-10", lastDay: "2026-11-08", endOfMoonFriday: "2026-11-06", periodWords: "10 October to 8 November 2026" });
  });

  it("reads a cycle id back to its bounds, and refuses one from another clock or one not begun", () => {
    expect(boundsForCycleId(LUNAR_CLOCK, MOON.bounds.id)?.id).toBe(MOON.bounds.id);
    expect(boundsForCycleId(LUNAR_CLOCK, "2026-10")).toBeNull();
    expect(boundsForCycleId(LUNAR_CLOCK, "nonsense")).toBeNull();
    const now = new Date("2026-11-03T12:00:00Z");
    expect(resolveMoon(LUNAR_CLOCK, null, TZ, now)?.bounds.id).toBe(MOON.bounds.id);
    const next = LUNAR_CLOCK.boundsFor(new Date("2026-11-20T12:00:00Z")).id;
    expect(resolveMoon(LUNAR_CLOCK, next, TZ, now)).toBeNull();
  });

  it("opens the oldest moon still in Draft or Returned, else the open moon", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const older = LUNAR_CLOCK.boundsFor(new Date("2026-09-20T12:00:00Z")).id;
    const oldest = LUNAR_CLOCK.boundsFor(new Date("2026-08-20T12:00:00Z")).id;
    expect(defaultCycleId(LUNAR_CLOCK, [], now)).toBe(MOON.bounds.id);
    expect(defaultCycleId(LUNAR_CLOCK, [{ cycleId: older, status: "waiting" }], now)).toBe(MOON.bounds.id);
    expect(defaultCycleId(LUNAR_CLOCK, [{ cycleId: older, status: "returned" }, { cycleId: oldest, status: "draft" }], now)).toBe(oldest);
    expect(defaultCycleId(LUNAR_CLOCK, [{ cycleId: "2026-08", status: "draft" }], now)).toBe(MOON.bounds.id);
    expect(defaultCycleId(CALENDAR_CLOCK, [], now)).toBe(CALENDAR_CLOCK.boundsFor(now).id);
  });

  it("reads the season running on the moon's last day", () => {
    const seasons = [{ id: "s1", startsOn: "2026-06-21", endsOn: "2027-01-01" }, { id: "s2", startsOn: "2027-01-01" }];
    expect(seasonOn(seasons, "2026-11-08")?.id).toBe("s1");
    expect(seasonOn(seasons, "2027-01-07")?.id).toBe("s2");
    expect(seasonOn(seasons, "2026-01-01")).toBeNull();
  });
});

describe("check 36: gather reads the board first", () => {
  it("brings a task the member pressed Done inside the moon in kept, and done", () => {
    const [c] = boardCandidates([task({ status: "done", doneAt: "2026-10-20T15:00:00Z" })], [press("t-1", "done")], MOON.days, TZ, []);
    expect(c).toMatchObject({ origin: "task", dedupeKey: "task:t-1", state: "kept", taskStatus: "done", doneOn: "2026-10-20", originNote: null });
  });

  it("brings a task the Sera sync closed in suggested, with Closed in Sera, never kept", () => {
    const [c] = boardCandidates([task({ source: "sera", externalId: "lib-9", status: "done", doneAt: "2026-10-20T15:00:00Z" })], [], MOON.days, TZ, []);
    expect(c).toMatchObject({ origin: "sera", dedupeKey: "sera:lib-9", state: "suggested", originNote: SERA_CLOSED_NOTE });
  });

  it("keeps a Sera task the member pressed Done, under the Sera key so a pack naming it merges", () => {
    const [c] = boardCandidates([task({ source: "sera", externalId: "lib-9", status: "done", doneAt: "2026-10-20T15:00:00Z" })], [press("t-1", "done")], MOON.days, TZ, []);
    expect(c).toMatchObject({ dedupeKey: "sera:lib-9", state: "kept", taskStatus: "done" });
  });

  it("brings an open task set this moon in as a Carry suggestion", () => {
    const [c] = boardCandidates([task({})], [], MOON.days, TZ, []);
    expect(c).toMatchObject({ state: "suggested", taskStatus: "carry", doneOn: null });
  });

  it("never brings in a task set before the moon, done or not", () => {
    const out = boardCandidates(
      [task({ id: "a", createdOn: "2026-10-09", status: "done", doneAt: "2026-10-20T15:00:00Z" }), task({ id: "b", createdOn: "2026-10-09" }), task({ id: "c", createdOn: "2026-11-09" })],
      [press("a", "done")], MOON.days, TZ, [],
    );
    expect(out).toEqual([]);
  });

  it("reads a Done press after the moon ended as work still open at its end", () => {
    const [c] = boardCandidates([task({ status: "done", doneAt: "2026-11-10T15:00:00Z" })], [press("t-1", "done")], MOON.days, TZ, []);
    expect(c).toMatchObject({ state: "suggested", taskStatus: "carry" });
  });

  it("brings a removed task in as a let-go or redirect suggestion, with the press's reason in its own words", () => {
    const out = boardCandidates(
      [task({ id: "a", status: "removed", removeReason: "not_a_task" }), task({ id: "b", status: "removed", removeReason: "redirected" })],
      [press("a", "remove", "not_a_task"), press("b", "redirect", "better_for_someone_else")], MOON.days, TZ, [],
    );
    expect(out[0]).toMatchObject({ state: "suggested", taskStatus: "let_go", originNote: SCREEN_REASON_WORDS.not_a_task });
    expect(out[1]).toMatchObject({ state: "suggested", taskStatus: "redirect", originNote: SCREEN_REASON_WORDS.better_for_someone_else });
  });

  it("keeps a task's role only when the member held it this moon, and its season goal as tagged", () => {
    const out = boardCandidates([task({ id: "a", roleId: "r-held", servesGoalId: "g1" }), task({ id: "b", roleId: "r-other" })], [], MOON.days, TZ, ["r-held"]);
    expect(out.map((c) => [c.roleId, c.seasonGoalId])).toEqual([["r-held", "g1"], [null, null]]);
  });

  it("carries the title and nothing else of the task", () => {
    const [c] = boardCandidates([{ ...task({ title: "  Fix   the  gate " }), private_detail: "a phone number" } as BoardTask], [], MOON.days, TZ, []);
    expect(c.text).toBe("Fix the gate");
    expect(JSON.stringify(c)).not.toContain("phone");
  });
});

describe("gather from the rooms", () => {
  const moons: AccomplishmentMoon[] = [{
    id: MOON.bounds.id, startsAt: MOON.bounds.startsAt.toISOString(), endsAt: MOON.bounds.endsAt.toISOString(),
    items: [
      { entryId: 41, text: "Walked the boundary", ownerNo: 3, roleId: "r-held", doneByNo: 3, doneAt: "2026-10-22T15:00:00Z", acceptedAt: "2026-10-23T15:00:00Z", note: null },
      { entryId: 42, text: "Old work", ownerNo: 3, roleId: "r-held", doneByNo: 3, doneAt: "2026-09-22T15:00:00Z", acceptedAt: "2026-10-23T15:00:00Z", note: null },
      { entryId: 43, text: "Another role's work", ownerNo: 3, roleId: "r-other", doneByNo: null, doneAt: null, acceptedAt: "2026-10-24T15:00:00Z", note: null },
    ],
  }];
  it("brings accepted room work done inside the moon in kept, keyed on its entry", () => {
    const out = roomCandidates(moons, MOON.bounds, TZ, ["r-held"]);
    expect(out.map((c) => [c.dedupeKey, c.roleId, c.state, c.doneOn])).toEqual([
      ["room:41", "r-held", "kept", "2026-10-22"],
      ["room:43", null, "kept", "2026-10-24"],
    ]);
  });
});

describe("roles held and terms in force", () => {
  const seat = (over: Partial<AssignmentRow>): AssignmentRow => ({
    id: "a-1", roleId: "r-1", userId: "u-wren", holderKind: "member", isExample: false, applicationId: null, startedOn: "2026-09-01", endedOn: null, ...over,
  });
  const cards = ["r-1", "r-2", "r-3"].map((id) => ({ id, name: `Role ${id}`, circleId: null, accountabilities: [`Keep ${id}`], responsibilities: [`Tend ${id}`] }));

  it("check 2: reads only member seatings held during the moon, never an example or a documented holder", () => {
    const roles = rolesHeldFrom(
      [
        seat({ id: "a", roleId: "r-1" }),
        seat({ id: "b", roleId: "r-2", endedOn: "2026-10-01" }),
        seat({ id: "c", roleId: "r-3", isExample: true }),
        seat({ id: "d", roleId: "r-3", holderKind: "documented" }),
      ],
      cards, () => null, MOON.days,
    );
    expect(roles.map((r) => r.roleId)).toEqual(["r-1"]);
    expect(roles[0].accountabilities).toEqual(["Keep r-1", "Tend r-1"]);
    expect(roles[0].daysHeld).toBe(MOON.days.days);
  });

  it("check 3: three seats on one application are one terms entry, with every role named", () => {
    const seats = [seat({ id: "a", roleId: "r-1", applicationId: "app-1" }), seat({ id: "b", roleId: "r-2", applicationId: "app-1", startedOn: "2026-10-20" }), seat({ id: "c", roleId: "r-3", applicationId: "app-1" })];
    const roles = rolesHeldFrom(seats, cards, () => "Ship the plan\n- Hold the circle", MOON.days);
    expect(roles[0].deliverables).toEqual(["Ship the plan", "Hold the circle"]);
    const settings = { v: 1, pay: { kind: "fixed", amountMinor: 100000, currency: "USD", per: "moon" } };
    const terms = termsFrom(seats, roles, [{ id: "app-1", settings, deliverables: null }, { id: "app-2", settings, deliverables: null }], new Set(["app-1", "app-2"]), MOON.days);
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ applicationId: "app-1", firstSeatId: "a", daysHeld: MOON.days.days });
    expect([...terms[0].roleIds].sort()).toEqual(["r-1", "r-2", "r-3"]);
  });

  it("leaves out an application whose terms are not in force", () => {
    const seats = [seat({ applicationId: "app-1" })];
    const roles = rolesHeldFrom(seats, cards, () => null, MOON.days);
    expect(termsFrom(seats, roles, [{ id: "app-1", settings: null, deliverables: null }], new Set(), MOON.days)).toEqual([]);
  });
});

describe("the work summary an invoice email carries", () => {
  const item = (over: Partial<RecapItem>): RecapItem => ({
    id: "mi-1", origin: "task", dedupeKey: "task:t1", text: "Wrote the water plan", originNote: null, doneOn: null, evidenceUrl: null,
    evidenceAsset: null, proofInSummary: false, roleId: "r1", accountabilityWords: null, seasonGoalId: null, ownGoalWords: null,
    state: "kept", visibility: "members", review: "approved", reviewNote: null, position: 0, setOn: "2026-10-12", taskStatus: "done",
    redirectTo: null, letGoReason: null, belongsToRoleId: null, evidenceKind: null, evidenceOn: null, belongsToSeatWords: null, ...over,
  });
  const items = [
    item({ id: "mi-1" }),
    item({ id: "mi-2", text: "Mended the fence", dedupeKey: "task:t2" }),
    item({ id: "mi-3", text: "Planted the hedge", dedupeKey: "task:t3", taskStatus: "partly" }),
  ];
  const recap = { id: "mr-0000000000000001", financeApprovedAt: "2026-11-12T15:00:00Z" } as RecapRow;
  const stored = {
    status: "approved", payerKey: "us-payer", memberNumber: "2026-001", fromJson: JSON.stringify({ legalName: "A Member", address: "1 Road" }),
    linesJson: JSON.stringify([{ kind: "pay", roleNames: ["Steward"], approvedItemIds: ["mi-1", "mi-2", "mi-3"] }]),
  } as InvoiceRow;
  const payers = { payers: [{ key: "us-payer", legalName: "Example Payer" }] } as Parameters<typeof summaryFor>[0]["payers"];

  it("carries no READING line, only the approved work in standard financial language", () => {
    // These tasks score, so a reading exists for them: the summary leaves it out (company rule).
    const t = taskScore(items, MOON.days);
    expect(readingOf(t, scoreContextOf(t, 0))).not.toBeNull();
    const out = summaryFor({ stored, recap, items, seasonGoals: [], payers, moon: MOON, timeZone: TZ });
    expect(out).not.toBeNull();
    expect(out!.text).not.toMatch(/READING/i);
    expect(out!.html).not.toMatch(/READING/i);
    expect(out!.text).toContain("Wrote the water plan; Mended the fence; Planted the hedge");
    expect(out!.text.split("\n").at(-1)).toBe("Approved by the Operations and Finance roles on 12 November 2026");
    expect(out!.text).toContain("A Member, for Example Payer");
  });
});
