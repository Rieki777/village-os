/**
 * The task layer's contract, pure parts: who may see and answer a task, what
 * each answer does to it, the order of the action check, the dates in words,
 * the three emails, and the copy itself.
 */
import { describe, expect, it } from "vitest";
import {
  TASK_CHECK_GROUPS,
  TASK_COPY,
  TASK_EMAIL_COPY,
  TASK_EVENT_KINDS,
  TASK_NOTICES,
  TASK_REFUSALS,
  addCivilDays,
  applyAnswer,
  buildAfterNote,
  buildDueNote,
  buildTaskEmail,
  canSeeTask,
  civilDaysFrom,
  compareByDue,
  cutText,
  eventFor,
  groupForCheck,
  isBackWithCircle,
  liveHoldersOf,
  liveSeatIdsFor,
  mayGive,
  parseTaskAnswer,
  splitMailSkips,
  taskCardFor,
  taskDateWords,
  taskRights,
  taskWeekday,
  validateAnswer,
  type TaskCard,
  type TaskEmailInput,
  type TaskLatestKind,
  type TaskOp,
  type TaskSeating,
  type TaskState,
  type TaskSubject,
  type TaskViewer,
} from "./sessionTasks";
import * as contract from "./sessionTasks";

// ── Fixtures ────────────────────────────────────────────────────────────────

const HOLDER = 7;
const SEAT = "seat-water";

const state = (over: Partial<TaskState> = {}): TaskState => ({
  entryId: 41,
  sessionId: 3,
  circleId: "c-garden",
  status: "open",
  ownerNo: HOLDER,
  ownerSeatId: null,
  dueOn: "2026-10-20",
  latestKind: "closed",
  latestNote: null,
  changedByNo: 0,
  changedAt: "2026-10-09T18:00:00.000Z",
  doneAt: null,
  version: 1,
  ...over,
});

const viewer = (over: Partial<TaskViewer> = {}): TaskViewer => ({
  no: 99,
  admin: false,
  liveSeatIds: [],
  inSourceSession: false,
  hostsSource: false,
  hostsOpenRoomInCircle: false,
  standsInCircle: false,
  ...over,
});

/** The org chart as it reads: one live seating, one lapsed, one example, one documented. */
const CHART: TaskSeating[] = [
  { orgRoleId: SEAT, holderKind: "member", userId: "m-live", lapsed: false, isExample: false },
  { orgRoleId: SEAT, holderKind: "member", userId: "m-lapsed", lapsed: true, isExample: false },
  { orgRoleId: SEAT, holderKind: "member", userId: "m-example", isExample: true },
  { orgRoleId: SEAT, holderKind: "documented", userId: null, isExample: false },
  { orgRoleId: "seat-ended", holderKind: "member", userId: "m-live", isExample: false, endedAt: new Date() },
];

const ROLES = {
  holder: viewer({ no: HOLDER }),
  seatHolder: viewer({ no: 20, liveSeatIds: liveSeatIdsFor(CHART, "m-live") }),
  lapsedSeatHolder: viewer({ no: 21, liveSeatIds: liveSeatIdsFor(CHART, "m-lapsed") }),
  sourceHost: viewer({ no: 30, hostsSource: true, inSourceSession: true }),
  openRoomHost: viewer({ no: 31, hostsOpenRoomInCircle: true }),
  admin: viewer({ no: 40, admin: true }),
  wasThere: viewer({ no: 50, inSourceSession: true }),
  stranger: viewer({ no: 60 }),
  /** Standing in the circle and nothing else: holds nothing, was not in the room, hosts nothing. */
  circleMember: viewer({ no: 70, standsInCircle: true }),
} as const;
type Role = keyof typeof ROLES;

const TASKS: Record<string, TaskSubject> = {
  personOpen: { status: "open", ownerNo: HOLDER, ownerSeatId: null, circleId: "c-garden" },
  seatOpen: { status: "open", ownerNo: null, ownerSeatId: SEAT, circleId: "c-garden" },
  done: { status: "done", ownerNo: HOLDER, ownerSeatId: null, circleId: "c-garden" },
  letGo: { status: "let_go", ownerNo: HOLDER, ownerSeatId: null, circleId: "c-garden" },
  circle: { status: "open", ownerNo: null, ownerSeatId: null, circleId: "c-garden" },
};

// ── Seats ───────────────────────────────────────────────────────────────────

describe("which seats a member sits in now", () => {
  it("counts a live member seating and nothing lapsed, ended, example or documented", () => {
    expect(liveSeatIdsFor(CHART, "m-live")).toEqual([SEAT]);
    expect(liveSeatIdsFor(CHART, "m-lapsed")).toEqual([]);
    expect(liveSeatIdsFor(CHART, "m-example")).toEqual([]);
    expect(liveHoldersOf(CHART, SEAT)).toEqual(["m-live"]);
    expect(liveHoldersOf(CHART, "seat-ended")).toEqual([]);
  });
});

// ── Rights ──────────────────────────────────────────────────────────────────

describe("taskRights: every role against every op", () => {
  /** What each role may do, per task, as [answer, reopen, take]. */
  const EXPECT: Record<string, Record<Role, [boolean, boolean, boolean]>> = {
    personOpen: {
      holder: [true, false, false],
      seatHolder: [false, false, false],
      lapsedSeatHolder: [false, false, false],
      sourceHost: [true, false, false],
      openRoomHost: [true, false, false],
      admin: [true, false, false],
      wasThere: [false, false, false],
      stranger: [false, false, false],
      circleMember: [false, false, false],
    },
    seatOpen: {
      holder: [false, false, false],
      seatHolder: [true, false, false],
      lapsedSeatHolder: [false, false, false],
      sourceHost: [true, false, false],
      openRoomHost: [true, false, false],
      admin: [true, false, false],
      wasThere: [false, false, false],
      stranger: [false, false, false],
      circleMember: [false, false, false],
    },
    done: {
      holder: [false, true, false],
      seatHolder: [false, false, false],
      lapsedSeatHolder: [false, false, false],
      sourceHost: [false, true, false],
      openRoomHost: [false, true, false],
      admin: [false, true, false],
      wasThere: [false, false, false],
      stranger: [false, false, false],
      circleMember: [false, false, false],
    },
    letGo: {
      holder: [false, false, false],
      seatHolder: [false, false, false],
      lapsedSeatHolder: [false, false, false],
      sourceHost: [false, true, false],
      openRoomHost: [false, true, false],
      admin: [false, true, false],
      wasThere: [false, false, false],
      stranger: [false, false, false],
      circleMember: [false, false, false],
    },
    circle: {
      holder: [false, false, false],
      seatHolder: [false, false, false],
      lapsedSeatHolder: [false, false, false],
      sourceHost: [true, false, true],
      openRoomHost: [true, false, true],
      admin: [true, false, true],
      wasThere: [false, false, true],
      stranger: [false, false, false],
      circleMember: [false, false, true],
    },
  };

  for (const [taskName, byRole] of Object.entries(EXPECT)) {
    for (const [role, [answer, reopen, take]] of Object.entries(byRole) as [Role, [boolean, boolean, boolean]][]) {
      it(`${role} on a ${taskName} task`, () => {
        expect(taskRights(TASKS[taskName], ROLES[role])).toEqual({ answer, reopen, take });
      });
    }
  }

  it("refuses a lapsed seat holder, allows the open-room facilitator of the same circle, and refuses a stranger", () => {
    expect(taskRights(TASKS.seatOpen, ROLES.lapsedSeatHolder).answer).toBe(false);
    expect(taskRights(TASKS.personOpen, ROLES.openRoomHost).answer).toBe(true);
    expect(taskRights(TASKS.personOpen, ROLES.stranger)).toEqual({ answer: false, reopen: false, take: false });
  });

  it("lets the holder open a done task again, and never a let go one", () => {
    expect(taskRights(TASKS.done, ROLES.holder).reopen).toBe(true);
    expect(taskRights(TASKS.letGo, ROLES.holder).reopen).toBe(false);
  });

  it("lets somebody with no number yet take what they can see, and gives them nothing else", () => {
    // A seat in the circle and never a session joined: the server numbers them when they take it.
    const seatedOnly = viewer({ no: null, liveSeatIds: ["seat-other"], standsInCircle: true });
    expect(taskRights(TASKS.circle, seatedOnly)).toEqual({ answer: false, reopen: false, take: true });
    expect(taskRights(TASKS.personOpen, seatedOnly)).toEqual({ answer: false, reopen: false, take: false });
    // With no number and no way to see it, nothing.
    expect(taskRights(TASKS.circle, viewer({ no: null }))).toEqual({ answer: false, reopen: false, take: false });
  });

  it("maps every op to the right it needs", () => {
    const only = (k: "answer" | "reopen" | "take") => ({ answer: k === "answer", reopen: k === "reopen", take: k === "take" });
    const need: Record<TaskOp, "answer" | "reopen" | "take"> = {
      done: "answer",
      not_yet: "answer",
      let_go: "answer",
      handed_back: "answer",
      taken: "take",
      reopened: "reopen",
    };
    for (const op of TASK_EVENT_KINDS) {
      for (const k of ["answer", "reopen", "take"] as const) expect(mayGive(op, only(k)), `${op} with ${k}`).toBe(need[op] === k);
    }
  });
});

describe("canSeeTask", () => {
  const SEES: Record<Role, boolean> = {
    holder: true,
    seatHolder: false,
    lapsedSeatHolder: false,
    sourceHost: true,
    openRoomHost: true,
    admin: true,
    wasThere: true,
    stranger: false,
    circleMember: true,
  };
  for (const [role, sees] of Object.entries(SEES) as [Role, boolean][]) {
    it(`${role} ${sees ? "sees" : "does not see"} a task held in person`, () => {
      expect(canSeeTask(TASKS.personOpen, ROLES[role])).toBe(sees);
    });
  }

  it("shows a seat's task to its live holder and not to a lapsed one", () => {
    expect(canSeeTask(TASKS.seatOpen, ROLES.seatHolder)).toBe(true);
    expect(canSeeTask(TASKS.seatOpen, ROLES.lapsedSeatHolder)).toBe(false);
  });

  it("shows a task back with the circle only to the people the rule names", () => {
    expect(canSeeTask(TASKS.circle, ROLES.holder)).toBe(false);
    expect(canSeeTask(TASKS.circle, ROLES.wasThere)).toBe(true);
    expect(canSeeTask(TASKS.circle, ROLES.circleMember)).toBe(true);
    expect(canSeeTask(TASKS.circle, ROLES.stranger)).toBe(false);
  });
});

describe("the whole circle reads its task cards (Rye, 2026-10-21)", () => {
  const member = ROLES.circleMember;
  // Somebody with no standing in this circle: a seat elsewhere, a number, nothing here.
  const outsider = viewer({ no: 80, liveSeatIds: ["seat-elsewhere"] });

  it("shows a member with standing every card of the circle, whatever its status or holder", () => {
    for (const [name, t] of Object.entries(TASKS)) expect(canSeeTask(t, member), name).toBe(true);
  });

  it("lets that member take a task back with the circle, and answer or reopen nothing", () => {
    expect(taskRights(TASKS.circle, member)).toEqual({ answer: false, reopen: false, take: true });
    for (const name of ["personOpen", "seatOpen", "done", "letGo"]) {
      expect(taskRights(TASKS[name], member), name).toEqual({ answer: false, reopen: false, take: false });
    }
    // The ops their rights allow: the take, and nothing else.
    const rights = taskRights(TASKS.circle, member);
    expect(TASK_EVENT_KINDS.filter((op) => mayGive(op, rights))).toEqual(["taken"]);
  });

  it("shows a member of another circle nothing, and gives them nothing", () => {
    for (const [name, t] of Object.entries(TASKS)) {
      expect(canSeeTask(t, outsider), name).toBe(false);
      expect(taskRights(t, outsider), name).toEqual({ answer: false, reopen: false, take: false });
    }
  });

  it("changes nothing for a task with no circle, whatever the flag says", () => {
    const noCircle = (t: TaskSubject): TaskSubject => ({ ...t, circleId: null });
    for (const [name, t] of Object.entries(TASKS)) {
      expect(canSeeTask(noCircle(t), member), name).toBe(false);
      expect(taskRights(noCircle(t), member), name).toEqual({ answer: false, reopen: false, take: false });
    }
    // The narrower rule still holds there: the room it came from, and whoever holds it.
    expect(canSeeTask(noCircle(TASKS.circle), ROLES.wasThere)).toBe(true);
    expect(canSeeTask(noCircle(TASKS.personOpen), ROLES.holder)).toBe(true);
    expect(canSeeTask(noCircle(TASKS.personOpen), ROLES.stranger)).toBe(false);
  });

  it("draws the member a card with the take and no record link, the way a seat holder who was not there gets none", () => {
    const parts = {
      text: "Fix the tank",
      sessionTitle: "Garden, week 2",
      circleName: "Garden circle",
      saidOn: "2026-10-09",
      holderName: null,
      seat: null,
      latestByName: "Ben Ortiz",
      latestByFacilitator: false,
    };
    const back = taskCardFor({ ...parts, state: state({ ownerNo: null, latestKind: "handed_back" }) }, member);
    expect(back).toMatchObject({ heldAs: "circle", canTake: true, canAnswer: false, canReopen: false, recordLink: false });
    const held = taskCardFor({ ...parts, holderName: "Ana Reyes", state: state() }, member);
    expect(held).toMatchObject({ heldAs: "person", canTake: false, canAnswer: false, canReopen: false, recordLink: false });
  });
});

// ── Answers ─────────────────────────────────────────────────────────────────

describe("validateAnswer", () => {
  const today = "2026-10-15";
  const v = (op: TaskOp, extra: { dueOn?: string; note?: string } = {}, subject: TaskSubject = TASKS.personOpen) =>
    validateAnswer({ op, version: 1, ...extra }, subject, today);

  it("refuses a let go with no sentence", () => {
    expect(v("let_go")).toBe("needSentence");
    expect(v("let_go", { note: "   " })).toBe("needSentence");
    expect(v("let_go", { note: "The well is fixed another way." })).toBeNull();
  });

  it("refuses a new date of today or earlier, and a missing one", () => {
    expect(v("not_yet")).toBe("needDate");
    expect(v("not_yet", { dueOn: today })).toBe("needDate");
    expect(v("not_yet", { dueOn: "2026-10-14" })).toBe("needDate");
    expect(v("not_yet", { dueOn: "2026-02-30" })).toBe("needDate");
    expect(v("not_yet", { dueOn: "2026-10-16" })).toBeNull();
  });

  it("refuses a done on a task already done, and any answer on a finished one", () => {
    expect(v("done", {}, TASKS.done)).toBe("alreadyDone");
    expect(v("done", {}, TASKS.letGo)).toBe("finished");
    expect(v("not_yet", { dueOn: "2026-11-01" }, TASKS.done)).toBe("finished");
    expect(v("let_go", { note: "No longer needed." }, TASKS.letGo)).toBe("finished");
    expect(v("handed_back", {}, TASKS.done)).toBe("finished");
  });

  it("refuses to open an open task, to take a held one, and to hand back what nobody holds", () => {
    expect(v("reopened")).toBe("alreadyOpen");
    expect(v("reopened", {}, TASKS.done)).toBeNull();
    expect(v("reopened", {}, TASKS.letGo)).toBeNull();
    expect(v("taken")).toBe("notWithCircle");
    expect(v("taken", {}, TASKS.circle)).toBeNull();
    expect(v("handed_back", {}, TASKS.circle)).toBe("nobodyHolds");
    expect(v("handed_back", {}, TASKS.seatOpen)).toBeNull();
  });

  it("refuses a note over the column's width and an op it does not know", () => {
    expect(v("done", { note: "x".repeat(301) })).toBe("noteLong");
    expect(validateAnswer({ op: "shrug" as TaskOp, version: 1 }, TASKS.personOpen, today)).toBe("answerShape");
  });

  it("names a refusal that exists for every key it can return", () => {
    for (const key of ["needSentence", "needDate", "alreadyDone", "finished", "alreadyOpen", "notWithCircle", "nobodyHolds", "noteLong", "answerShape"]) {
      expect(TASK_REFUSALS).toHaveProperty(key);
    }
  });
});

describe("parseTaskAnswer", () => {
  it("reads an op, a version, a clean date and a clean note", () => {
    expect(parseTaskAnswer({ op: "not_yet", version: 3, dueOn: "2026-11-01", note: "  after\nthe rains  " })).toEqual({
      op: "not_yet",
      version: 3,
      dueOn: "2026-11-01",
      note: "after the rains",
    });
  });

  it("refuses anything that is not an answer", () => {
    expect(parseTaskAnswer(null)).toBeNull();
    expect(parseTaskAnswer([])).toBeNull();
    expect(parseTaskAnswer({ op: "shrug", version: 1 })).toBeNull();
    expect(parseTaskAnswer({ op: "done" })).toBeNull();
    expect(parseTaskAnswer({ op: "done", version: 0 })).toBeNull();
    expect(parseTaskAnswer({ op: "done", version: 1.5 })).toBeNull();
  });

  it("drops a malformed date and clips a long note", () => {
    const a = parseTaskAnswer({ op: "let_go", version: 1, dueOn: "next week", note: "y".repeat(400) });
    expect(a?.dueOn).toBeUndefined();
    expect(a?.note).toHaveLength(300);
  });
});

describe("applyAnswer: every op", () => {
  const now = new Date("2026-10-15T09:30:00.000Z");
  const at = now.toISOString();
  const apply = (op: TaskOp, extra: { dueOn?: string; note?: string } = {}, from: TaskState = state()) =>
    applyAnswer(from, { op, version: from.version, ...extra }, 12, now);

  it("moves the version, the latest kind, the note, who and when, for every op", () => {
    const next = apply("done", { note: " Tank is clean. " });
    expect(next).toMatchObject({ version: 2, latestKind: "done", latestNote: "Tank is clean.", changedByNo: 12, changedAt: at });
  });

  it("done sets the status and when it was done", () => {
    expect(apply("done")).toMatchObject({ status: "done", doneAt: at, ownerNo: HOLDER });
  });

  it("not yet moves the date and keeps it open", () => {
    expect(apply("not_yet", { dueOn: "2026-11-01" })).toMatchObject({ status: "open", dueOn: "2026-11-01" });
  });

  it("let go sets the status", () => {
    expect(apply("let_go", { note: "Done another way." })).toMatchObject({ status: "let_go", doneAt: null, latestNote: "Done another way." });
  });

  it("hand it back clears both holders and keeps it open", () => {
    const next = apply("handed_back", {}, state({ ownerSeatId: SEAT }));
    expect(next).toMatchObject({ status: "open", ownerNo: null, ownerSeatId: null });
    expect(isBackWithCircle(next)).toBe(true);
  });

  it("taken makes the actor the holder", () => {
    expect(apply("taken", {}, state({ ownerNo: null }))).toMatchObject({ status: "open", ownerNo: 12, ownerSeatId: null });
  });

  it("reopened opens it and clears when it was done", () => {
    expect(apply("reopened", {}, state({ status: "done", doneAt: "2026-10-12T10:00:00.000Z" }))).toMatchObject({ status: "open", doneAt: null });
  });

  it("writes the event the answer left", () => {
    const next = apply("not_yet", { dueOn: "2026-11-01", note: "After the rains" });
    expect(eventFor(next, "not_yet")).toEqual({
      entryId: 41,
      sessionId: 3,
      kind: "not_yet",
      byNo: 12,
      status: "open",
      ownerNo: HOLDER,
      ownerSeatId: null,
      dueOn: "2026-11-01",
      note: "After the rains",
    });
  });
});

// ── Cards ───────────────────────────────────────────────────────────────────

describe("taskCardFor", () => {
  const parts = {
    text: "Fix the tank",
    sessionTitle: "Garden, week 2",
    circleName: "Garden circle",
    saidOn: "2026-10-09",
    holderName: "Ana Reyes",
    seat: { id: SEAT, name: "Water keeper", holders: ["Cai Moreno"] },
    latestByName: null,
    latestByFacilitator: false,
  };

  it("names how the task is held for this viewer", () => {
    expect(taskCardFor({ ...parts, state: state() }, ROLES.holder).heldAs).toBe("you");
    expect(taskCardFor({ ...parts, state: state() }, ROLES.wasThere).heldAs).toBe("person");
    expect(taskCardFor({ ...parts, state: state({ ownerNo: null, ownerSeatId: SEAT }) }, ROLES.seatHolder).heldAs).toBe("seat");
    expect(taskCardFor({ ...parts, state: state({ ownerNo: null }) }, ROLES.wasThere).heldAs).toBe("circle");
  });

  it("links the record only for people who were in the room, and admins", () => {
    const seatOnly = taskCardFor({ ...parts, state: state({ ownerNo: null, ownerSeatId: SEAT }) }, ROLES.seatHolder);
    expect(seatOnly.recordLink).toBe(false);
    expect(seatOnly.canAnswer).toBe(true);
    expect(taskCardFor({ ...parts, state: state() }, ROLES.wasThere).recordLink).toBe(true);
    expect(taskCardFor({ ...parts, state: state() }, ROLES.admin).recordLink).toBe(true);
  });

  it("carries no rights for a card still in an open session", () => {
    const card = taskCardFor(
      { ...parts, state: null, live: { entryId: 77, sessionId: 9, circleId: "c-garden", ownerNo: HOLDER, ownerSeatId: null, dueOn: null } },
      ROLES.admin,
    );
    expect(card).toMatchObject({ entryId: 77, sessionId: 9, inSessionNow: true, canAnswer: false, canReopen: false, canTake: false, latest: null });
  });

  it("carries names and no person numbers, ids or emails", () => {
    const card = taskCardFor({ ...parts, state: state({ changedByNo: 12, latestKind: "done", status: "done" }) }, ROLES.holder);
    const keys = JSON.stringify(card);
    expect(keys).not.toMatch(/"(userId|ownerNo|changedByNo|byNo|email)"/);
    expect(keys).not.toContain("@");
  });

  it("sorts by date, undated last", () => {
    const a = { dueOn: null, entryId: 1 };
    const b = { dueOn: "2026-10-20", entryId: 2 };
    const c = { dueOn: "2026-10-18", entryId: 3 };
    expect([a, b, c].sort(compareByDue).map((x) => x.entryId)).toEqual([3, 2, 1]);
  });
});

// ── From last time ──────────────────────────────────────────────────────────

describe("groupForCheck: the order of the action check", () => {
  const MET = "2026-10-09T18:00:00.000Z";
  const AFTER = "2026-10-12T10:00:00.000Z";
  const BEFORE = "2026-10-01T10:00:00.000Z";
  const card = (entryId: number, over: Partial<TaskCard>): TaskCard => ({
    entryId,
    sessionId: 3,
    sessionTitle: "Garden, week 2",
    circleId: "c-garden",
    circleName: "Garden circle",
    saidOn: "2026-10-01",
    text: `Task ${entryId}`,
    status: "open",
    heldAs: "person",
    holderName: "Ana Reyes",
    seat: null,
    dueOn: null,
    latest: { kind: "closed", note: null, byName: null, byFacilitator: false, at: BEFORE },
    inSessionNow: false,
    canAnswer: false,
    canReopen: false,
    canTake: false,
    recordLink: true,
    version: 1,
    ...over,
  });
  const latest = (kind: TaskLatestKind, at: string) => ({
    kind,
    note: null,
    byName: null,
    byFacilitator: false,
    at,
  });

  const cards = [
    card(1, { dueOn: "2026-10-30" }),
    card(2, { status: "done", latest: latest("done", AFTER) }),
    card(3, { status: "done", latest: latest("done", BEFORE) }),
    card(4, { heldAs: "circle", holderName: null }),
    card(5, { latest: latest("not_yet", AFTER), dueOn: "2026-10-25" }),
    card(6, { status: "let_go", latest: latest("let_go", AFTER) }),
    card(7, { status: "let_go", latest: latest("let_go", BEFORE) }),
    card(8, { dueOn: "2026-10-20" }),
    card(9, { latest: latest("not_yet", BEFORE), dueOn: "2026-10-22" }),
  ];

  it("reads done first, then back with the circle, new dates, let go and the rest by date", () => {
    const groups = groupForCheck(cards, MET);
    expect(groups.map((g) => g.key)).toEqual(["doneSince", "backWithCircle", "newDates", "letGo", "stillHolding"]);
    expect(groups.map((g) => g.cards.map((c) => c.entryId))).toEqual([[2], [4], [5], [6], [8, 9, 1]]);
  });

  it("leaves out a group with no cards, and what finished before the circle last met", () => {
    const groups = groupForCheck([cards[2], cards[6], cards[0]], MET);
    expect(groups.map((g) => g.key)).toEqual(["stillHolding"]);
  });

  it("reads every change as new when the circle never met before", () => {
    expect(groupForCheck([cards[2]], null).map((g) => g.key)).toEqual(["doneSince"]);
  });

  it("has a heading for every group", () => {
    for (const k of TASK_CHECK_GROUPS) expect(TASK_COPY.checkGroups[k]).toBeTruthy();
  });
});

// ── Dates ───────────────────────────────────────────────────────────────────

describe("dates in words", () => {
  it("writes a date in words, with the year only when it is another year", () => {
    expect(taskDateWords("2026-10-16", "2026-10-15")).toBe("Friday 16 October");
    expect(taskDateWords("2027-01-08", "2026-10-15")).toBe("Friday 8 January 2027");
    expect(taskDateWords("not a date")).toBe("");
    expect(taskWeekday("2026-10-18")).toBe("Sunday");
  });

  it("counts and moves whole days across a month and a year", () => {
    expect(addCivilDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(civilDaysFrom("2026-10-15", "2026-10-17")).toBe(2);
    expect(civilDaysFrom("2026-10-15", "2026-10-14")).toBe(-1);
    expect(civilDaysFrom("2026-10-15", "nope")).toBeNull();
  });
});

// ── Emails ──────────────────────────────────────────────────────────────────

describe("the task emails", () => {
  const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
  const base: TaskEmailInput = {
    name: "Ana Reyes",
    sessionTitle: "Garden, week 2",
    circleName: "Garden",
    closedOn: "2026-10-15",
    today: "2026-10-15",
    wasInRoom: true,
    sendNo: 1,
    askedBy: null,
    own: [{ text: "Fix the tank.", dueOn: "2026-10-23" }],
    seats: [],
    boardUrl: "https://village.example/profile#my-tasks",
    recordUrl: "https://village.example/sessions/3",
  };

  it("lists what they took on, with the date in words and the record link for someone in the room", () => {
    const m = buildTaskEmail(base);
    expect(m.subject).toBe("Your tasks from Garden, week 2");
    expect(m.text).toContain("Hi Ana,");
    expect(m.text).toContain("The Garden circle call closed today. Here is what you took on");
    expect(m.text).toContain("- Fix the tank. By Friday 23 October.");
    expect(m.text).toContain("Open the record: https://village.example/sessions/3");
    expect(m.text).toContain("Thank you for carrying this.");
    expect(m.text).toContain(TASK_EMAIL_COPY.footer);
    expect(m.blocks[m.blocks.length - 1]).toEqual({ kind: "note", text: TASK_EMAIL_COPY.footer });
  });

  it("says one more and n more for a seat beside their own tasks, and No date for an undated one", () => {
    const one = buildTaskEmail({ ...base, seats: [{ seatName: "Water keeper", tasks: [{ text: "Order seed", dueOn: null }] }] });
    expect(one.text).toContain("Your role, Water keeper, holds one more:");
    expect(one.text).toContain("- Order seed. No date.");
    expect(one.text).toContain("Thank you for carrying these.");
    const two = buildTaskEmail({
      ...base,
      seats: [{ seatName: "Water keeper", tasks: [{ text: "Order seed", dueOn: null }, { text: "Mend the hose", dueOn: "2026-10-30" }] }],
    });
    expect(two.text).toContain("Your role, Water keeper, holds 2 more:");
  });

  it("opens with the seat for a seat holder who was not in the room, with no record link", () => {
    const one = buildTaskEmail({
      ...base,
      wasInRoom: false,
      closedOn: "2026-10-14",
      own: [],
      seats: [{ seatName: "Water keeper", tasks: [{ text: "Order seed", dueOn: null }] }],
    });
    expect(one.text).toContain("The Garden circle met on Wednesday 14 October and a task landed with your role, Water keeper. Here it is:");
    expect(one.text).not.toContain("sessions/3");
    expect(one.blocks.some((b) => b.kind === "button" && b.label === TASK_EMAIL_COPY.openRecord)).toBe(false);
    const two = buildTaskEmail({
      ...base,
      wasInRoom: false,
      own: [],
      seats: [{ seatName: "Water keeper", tasks: [{ text: "Order seed", dueOn: null }, { text: "Mend the hose", dueOn: null }] }],
    });
    expect(two.text).toContain("and 2 tasks landed with your role, Water keeper. Here they are:");
  });

  it("names the session when there is no circle, and says who asked on a send again", () => {
    const m = buildTaskEmail({ ...base, circleName: null, sendNo: 2, askedBy: "Ben Ortiz" });
    expect(m.blocks[0]).toEqual({ kind: "p", text: "Ben asked for this list to go out again. Here is where your tasks stand now." });
    expect(m.text).toContain("The Garden, week 2 call closed today.");
    expect(buildTaskEmail({ ...base, sendNo: 3 }).text).toContain("The facilitator asked for this list to go out again.");
  });

  it("greets somebody with no name on file", () => {
    expect(buildTaskEmail({ ...base, name: null }).text).toContain("Hi there,");
  });

  it("writes the two notes around a due date", () => {
    const note = { name: "Ana Reyes", text: "Fix the tank before the first rains arrive in the lower garden beds", dueOn: "2026-10-17", sessionTitle: "Garden, week 2", circleName: "Garden circle", saidOn: "2026-10-09", today: "2026-10-15", boardUrl: base.boardUrl };
    const before = buildDueNote(note);
    expect(before.subject).toBe(`Coming up Saturday: ${cutText(note.text, 60)}`);
    expect(before.subject.length).toBeLessThanOrEqual("Coming up Saturday: ".length + 60);
    expect(before.text).toContain("Hi Ana, a gentle note. This one is due on Saturday 17 October:");
    expect(before.text).toContain("From the Garden circle call on Friday 9 October.");
    const after = buildAfterNote({ ...note, dueOn: "2026-10-14" });
    expect(after.subject).toBe("Checking in on what you're holding");
    expect(after.text).toContain("Hi Ana, Wednesday came and went for this one. This is only a check-in:");
    expect(after.text).toContain("This is the last email about it.");
  });

  it("never writes an ISO date into any email", () => {
    const all = [
      buildTaskEmail(base),
      buildTaskEmail({ ...base, wasInRoom: false, own: [], seats: [{ seatName: "S", tasks: [{ text: "T", dueOn: "2027-02-01" }] }] }),
      buildDueNote({ name: null, text: "T", dueOn: "2026-10-17", sessionTitle: "X", circleName: null, saidOn: "2026-10-09", today: "2026-10-15", boardUrl: "https://v.example/b" }),
      buildAfterNote({ name: null, text: "T", dueOn: "2026-10-14", sessionTitle: "X", circleName: null, saidOn: "2026-10-09", today: "2026-10-15", boardUrl: "https://v.example/b" }),
    ];
    for (const m of all) {
      expect(m.subject).not.toMatch(ISO_DATE);
      for (const b of m.blocks) {
        const words = b.kind === "list" ? b.items.join(" ") : b.kind === "button" ? b.label : b.text;
        expect(words).not.toMatch(ISO_DATE);
      }
    }
  });
});

// ── The copy ────────────────────────────────────────────────────────────────

describe("the copy", () => {
  /** Every string an export holds or a copy function returns, called with sample words. */
  function strings(value: unknown, out: string[] = [], depth = 0): string[] {
    if (depth > 6) return out;
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      const fn = value as (...a: unknown[]) => unknown;
      if (fn.length <= 4) {
        try {
          strings(fn("Water keeper", 2, 1, ["Ana", "Ben"]), out, depth + 1);
          strings(fn(1, 3, 2), out, depth + 1);
        } catch {
          // A builder that needs a whole input object is read through the email tests.
        }
      }
    } else if (Array.isArray(value)) for (const v of value) strings(v, out, depth + 1);
    else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out, depth + 1);
    return out;
  }

  it("holds no em-dash or en-dash in any exported string", () => {
    const all = strings([contract.TASK_COPY, contract.TASK_EMAIL_COPY, contract.TASK_REFUSALS, contract.TASK_NOTICES]);
    expect(all.length).toBeGreaterThan(80);
    // Built from code points, so neither dash lands in this file as the character itself.
    const dashes = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);
    for (const s of all) expect(s, s).not.toMatch(dashes);
  });

  it("writes the in-app notices", () => {
    expect(TASK_NOTICES.back("Fix the tank")).toBe("Fix the tank is back with the circle. It will be in the next action check.");
    expect(TASK_NOTICES.unheld("Garden, week 2", "Water keeper")).toBe(
      'A task from "Garden, week 2" sits with Water keeper, and nobody holds that role now. Give it to someone at the next call.',
    );
  });

  it("writes the mail button's result with and without skipped people", () => {
    const none = { members: 0, setup: 0, other: 0 };
    expect(TASK_COPY.mail.result(3, 3, none)).toBe("Sent to 3 of 3 people.");
    expect(TASK_COPY.mail.result(2, 4, { ...none, members: 2 })).toBe("Sent to 2 of 4 people. 2 have task emails turned off or have no email on file.");
    expect(TASK_COPY.mail.result(0, 3, { ...none, setup: 3 })).toBe("Sent to 0 of 3 people. The village's email is not set up yet, so 3 could not go out.");
    expect(TASK_COPY.mail.result(1, 3, { members: 0, setup: 0, other: 2 })).toBe("Sent to 1 of 3 people. 2 did not go out.");
  });

  it("splits a send's skips by whose they are, and counts a duplicate nowhere", () => {
    expect(splitMailSkips({ pref_off: 1, emails_off: 2, no_email: 1, duplicate: 4 })).toEqual({ members: 4, setup: 0, other: 0 });
    expect(splitMailSkips({ no_api_key: 3 })).toEqual({ members: 0, setup: 3, other: 0 });
    expect(splitMailSkips({ no_sender: 1, suppressed: 1, failed: 2, bad_address: 1 })).toEqual({ members: 0, setup: 1, other: 4 });
    expect(splitMailSkips({})).toEqual({ members: 0, setup: 0, other: 0 });
  });

  it("has a button and a sheet for every op", () => {
    for (const op of TASK_EVENT_KINDS) {
      expect(TASK_COPY.buttons[op]).toBeTruthy();
      expect(TASK_COPY.sheets[op].confirm).toBeTruthy();
      expect(TASK_COPY.sheets[op].toast).toBeTruthy();
    }
    expect(TASK_COPY.sheets.let_go.noteRequired).toBe(true);
  });
});

// ── One task's link, and the doors a notice uses ────────────────────────────

describe("a link that opens one task", () => {
  it("names one card on the board, beside the board's own path", () => {
    expect(contract.taskBoardLink(42)).toBe("/profile#task-42");
    expect(contract.taskCardAnchor(42)).toBe("task-42");
    expect(contract.TASK_BOARD_PATH).toBe("/profile#my-tasks");
    expect(contract.taskDoneUrl(42)).toBe("/api/sessions/tasks/42/done");
    expect(contract.TASKS_COUNT_URL).toBe("/api/sessions/tasks/count");
  });

  it("reads the task back out of a hash, and nothing else", () => {
    expect(contract.taskIdFromHash("#task-42")).toBe(42);
    expect(contract.taskIdFromHash("task-7")).toBe(7);
    for (const hash of ["", "#my-tasks", "#task-", "#task-0", "#task-07", "#task-1x", "#task--3", "#task-1.5", "#wallet", null, undefined, "#task-99999999999999999"]) {
      expect(contract.taskIdFromHash(hash as string | null | undefined), String(hash)).toBeNull();
    }
  });

  it("knows a task link from every other notice link", () => {
    expect(contract.taskIdFromLink(contract.taskBoardLink(9))).toBe(9);
    for (const link of [contract.TASK_BOARD_PATH, "/sessions/12", "/profile", "/profile#wallet", "/elsewhere#task-9", "https://village.example/profile#task-9", null, undefined]) {
      expect(contract.taskIdFromLink(link), String(link)).toBeNull();
    }
  });
});

describe("the words for the menu, the profile card and the bell", () => {
  it("counts what waits on you in plain words, one and many", () => {
    expect(TASK_COPY.menu.label).toBe("My tasks");
    expect(TASK_COPY.menu.waiting(1)).toBe("1 task waits on you");
    expect(TASK_COPY.menu.waiting(3)).toBe("3 tasks wait on you");
    expect(TASK_COPY.waitingCard.count(1)).toBe("One task waits on you.");
    expect(TASK_COPY.waitingCard.count(4)).toBe("4 tasks wait on you.");
    expect(TASK_COPY.waitingCard.nextDue("Friday 23 October")).toBe("The nearest date is Friday 23 October.");
    expect(TASK_COPY.waitingCard.nextDuePassed("Monday 19 October")).toBe("The earliest date was Monday 19 October.");
    expect(TASK_COPY.waitingCard.button).toBe("Open my task board");
  });

  it("names each bell button with the task it acts on", () => {
    expect(TASK_COPY.bell.done).toBe("It's done");
    expect(TASK_COPY.bell.open).toBe("Open");
    expect(TASK_COPY.bell.marked).toBe("Done. The circle sees it at the next action check.");
    expect(TASK_COPY.bell.undo).toBe("Open it again");
    expect(TASK_COPY.bell.doneLabel("Fix the tank")).toBe("It's done: Fix the tank");
    // Label in Name (WCAG 2.5.3): a voice user says the visible words, so each name starts with them.
    expect(TASK_COPY.bell.doneLabel("x").startsWith(TASK_COPY.bell.done)).toBe(true);
    expect(TASK_COPY.bell.openLabel("x").startsWith(TASK_COPY.bell.open)).toBe(true);
    expect(TASK_COPY.bell.undoLabel("x").startsWith(TASK_COPY.bell.undo)).toBe(true);
    expect(TASK_COPY.bell.openLabel("Fix the tank")).toBe("Open it on your task board: Fix the tank");
    expect(TASK_COPY.bell.undoLabel("Fix the tank")).toBe("Open it again: Fix the tank");
    expect(TASK_REFUSALS.letGoNotDone).toBe("This one was let go. Open it on your task board to read why.");
  });
});
