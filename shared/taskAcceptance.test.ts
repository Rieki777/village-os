/**
 * Accepted as accomplished, the pure parts (PR 4 of the player role card):
 * the `accepted` answer in the task state machine, who may give it, and the
 * Accomplished list the events make.
 *
 *   - done, then accepted, then reopened: each step through `validateAnswer`
 *     and `applyAnswer`, the way `answerTask` runs it
 *   - nobody accepts their own work: the holder, a holder of the task's role,
 *     and whoever marked it done are refused, before the power is asked
 *   - only a live holder of the power that seats people accepts at all
 *   - the note is one line of at most 300 characters, never payment details
 *   - `accomplishmentsFor` keeps a task only while its latest done is followed
 *     by an accept, and files it under the moon the work was done in
 */
import { describe, expect, it } from "vitest";
import { LUNAR_CLOCK } from "./cycleClock";
import {
  ACCEPTING_POWER,
  TASK_COPY,
  TASK_EVENT_KINDS,
  TASK_NOTE_MAX,
  TASK_REFUSALS,
  acceptRefusal,
  anyoneMayAccept,
  applyAnswer,
  eventFor,
  isAccepted,
  mayGive,
  parseTaskAnswer,
  taskAcceptUrl,
  taskCardFor,
  taskRights,
  validateAnswer,
  type TaskAnswer,
  type TaskState,
  type TaskViewer,
} from "./sessionTasks";
import { accomplishedIn, accomplishmentsFor, currentAccomplishments, groupByMoon, type AccomplishmentEvent } from "./taskAccomplishments";

const HOLDER = 7;
const ACCEPTOR = 12;
const SEAT = "seat-water";
const TODAY = "2026-10-22";

const state = (over: Partial<TaskState> = {}): TaskState => ({
  entryId: 41,
  sessionId: 3,
  circleId: "c-garden",
  status: "open",
  ownerNo: HOLDER,
  ownerSeatId: null,
  dueOn: null,
  latestKind: "closed",
  latestNote: null,
  changedByNo: 0,
  changedAt: "2026-10-09T18:00:00.000Z",
  doneAt: null,
  version: 1,
  ...over,
});

const viewer = (over: Partial<TaskViewer> = {}): TaskViewer => ({
  no: ACCEPTOR,
  admin: false,
  liveSeatIds: [],
  inSourceSession: false,
  hostsSource: false,
  hostsOpenRoomInCircle: false,
  standsInCircle: false,
  acceptPower: true,
  ...over,
});

/** One answer, run the way `answerTask` runs it: validated first, then applied. */
function give(current: TaskState, answer: TaskAnswer, by: number, at: string): TaskState {
  const problem = validateAnswer(answer, current, TODAY);
  if (problem) throw new Error(`refused: ${problem}`);
  return applyAnswer(current, answer, by, new Date(at));
}

describe("the accepted answer", () => {
  it("is an event kind that fits the kind column, and a PATCH op the parser reads", () => {
    expect(TASK_EVENT_KINDS).toContain("accepted");
    for (const k of TASK_EVENT_KINDS) expect(k.length).toBeLessThanOrEqual(16);
    expect(parseTaskAnswer({ op: "accepted", version: 3, note: "  Fine work  " })).toEqual({ op: "accepted", version: 3, note: "Fine work" });
    expect(ACCEPTING_POWER).toBe("org.seat");
    expect(taskAcceptUrl(41)).toBe("/api/sessions/tasks/41/accept");
  });

  it("runs done, then accepted, then reopened, and the history keeps every step", () => {
    const events: { kind: string; status: string; note: string | null }[] = [];
    let s = state();
    s = give(s, { op: "done", version: 1, note: "Tank fixed" }, HOLDER, "2026-10-12T10:00:00Z");
    events.push(eventFor(s, "done"));
    expect(s).toMatchObject({ status: "done", latestKind: "done", changedByNo: HOLDER, doneAt: "2026-10-12T10:00:00.000Z", version: 2 });
    expect(isAccepted(s)).toBe(false);

    s = give(s, { op: "accepted", version: 2, note: "Holds water again" }, ACCEPTOR, "2026-10-14T09:00:00Z");
    events.push(eventFor(s, "accepted"));
    // Still done, from the same moment; the accept is the latest answer.
    expect(s).toMatchObject({ status: "done", latestKind: "accepted", latestNote: "Holds water again", changedByNo: ACCEPTOR, doneAt: "2026-10-12T10:00:00.000Z", version: 3 });
    expect(isAccepted(s)).toBe(true);
    // Accepted once is enough.
    expect(validateAnswer({ op: "accepted", version: 3 }, s, TODAY)).toBe("alreadyAccepted");

    s = give(s, { op: "reopened", version: 3 }, HOLDER, "2026-10-15T09:00:00Z");
    events.push(eventFor(s, "reopened"));
    expect(s).toMatchObject({ status: "open", latestKind: "reopened", doneAt: null, version: 4 });
    expect(isAccepted(s)).toBe(false);
    expect(events.map((e) => [e.kind, e.status, e.note])).toEqual([
      ["done", "done", "Tank fixed"],
      ["accepted", "done", "Holds water again"],
      ["reopened", "open", null],
    ]);
  });

  it("is refused on a task that is not done", () => {
    expect(validateAnswer({ op: "accepted", version: 1 }, state(), TODAY)).toBe("notDoneYet");
    expect(validateAnswer({ op: "accepted", version: 1 }, state({ status: "let_go" }), TODAY)).toBe("notDoneYet");
  });

  it("carries one line of at most 300 characters, and never payment details", () => {
    const done = state({ status: "done", latestKind: "done", changedByNo: HOLDER });
    expect(validateAnswer({ op: "accepted", version: 1, note: "x".repeat(TASK_NOTE_MAX + 1) }, done, TODAY)).toBe("noteLong");
    expect(validateAnswer({ op: "accepted", version: 1, note: "Pay it to 4111 1111 1111 1111" }, done, TODAY)).toBe("paymentDetails");
    expect(validateAnswer({ op: "accepted", version: 1, note: "Paid into GB82WEST12345698765432" }, done, TODAY)).toBe("paymentDetails");
    expect(validateAnswer({ op: "accepted", version: 1, note: "Done by 2026-10-12 at 10:00" }, done, TODAY)).toBeNull();
    expect(validateAnswer({ op: "accepted", version: 1 }, done, TODAY)).toBeNull();
    expect(TASK_REFUSALS.paymentDetails).toMatch(/payment details/);
  });
});

describe("who may accept", () => {
  const done = (over: Partial<TaskState> = {}) => state({ status: "done", latestKind: "done", changedByNo: HOLDER, ...over });

  it("lets a live holder of the power accept somebody else's work", () => {
    expect(acceptRefusal(done(), viewer())).toBeNull();
    expect(taskRights(done(), viewer()).accept).toBe(true);
    expect(mayGive("accepted", taskRights(done(), viewer()))).toBe(true);
  });

  it("refuses a self-accept: the holder in person, even holding the power", () => {
    expect(acceptRefusal(done(), viewer({ no: HOLDER }))).toBe("ownWork");
    expect(taskRights(done(), viewer({ no: HOLDER })).accept).toBe(false);
  });

  it("refuses a same-role accept: anybody who sits in the role holding the task", () => {
    const seatTask = done({ ownerNo: null, ownerSeatId: SEAT, changedByNo: 30 });
    expect(acceptRefusal(seatTask, viewer({ liveSeatIds: [SEAT] }))).toBe("ownWork");
    // A holder of another role may.
    expect(acceptRefusal(seatTask, viewer({ liveSeatIds: ["seat-bees"] }))).toBeNull();
  });

  it("refuses whoever marked it done, so a facilitator never accepts what they closed off", () => {
    expect(acceptRefusal(done({ changedByNo: ACCEPTOR }), viewer())).toBe("ownWork");
  });

  it("refuses anybody without the power, after the own-work question", () => {
    expect(acceptRefusal(done(), viewer({ acceptPower: false }))).toBe("notAnAcceptor");
    expect(acceptRefusal(done(), viewer({ acceptPower: undefined }))).toBe("notAnAcceptor");
    // An admin is no exception.
    expect(acceptRefusal(done(), viewer({ acceptPower: false, admin: true }))).toBe("notAnAcceptor");
    expect(acceptRefusal(done(), viewer({ no: HOLDER, acceptPower: false }))).toBe("ownWork");
  });

  it("never lets the PATCH's other rights stand in for the accept", () => {
    // The holder may answer and reopen their task; that is not accepting it.
    const r = taskRights(done(), viewer({ no: HOLDER, acceptPower: false }));
    expect(r).toMatchObject({ reopen: true, accept: false });
    expect(mayGive("accepted", r)).toBe(false);
  });

  it("knows when nobody in the village may accept a task", () => {
    const task = { ownerUserId: "u-ana", markedByUserId: "u-ana", seatHolders: ["u-ben"] };
    expect(anyoneMayAccept([], task)).toBe(false);
    expect(anyoneMayAccept(["u-ana", "u-ben"], task)).toBe(false);
    expect(anyoneMayAccept(["u-ana", "u-cal"], task)).toBe(true);
    expect(anyoneMayAccept(["u-dee"], { ownerUserId: null, markedByUserId: "u-dee", seatHolders: [] })).toBe(false);
  });
});

describe("the card", () => {
  const parts = (s: TaskState, noAcceptor?: boolean) => ({
    state: s,
    text: "Fix the water tank",
    sessionTitle: "Garden circle",
    circleName: "Garden circle",
    saidOn: "2026-10-09",
    holderName: "Someone",
    seat: null,
    latestByName: null,
    latestByFacilitator: false,
    noAcceptor,
  });

  it("offers the accept to whoever may give it, and to nobody once accepted", () => {
    const done = state({ status: "done", latestKind: "done", changedByNo: HOLDER });
    expect(taskCardFor(parts(done), viewer()).canAccept).toBe(true);
    expect(taskCardFor(parts(done), viewer({ no: HOLDER })).canAccept).toBe(false);
    expect(taskCardFor(parts({ ...done, latestKind: "accepted" }), viewer()).canAccept).toBe(false);
  });

  it("reads Waiting to be accepted only for a done task nobody may accept", () => {
    const done = state({ status: "done", latestKind: "done", changedByNo: HOLDER });
    expect(taskCardFor(parts(done, true), viewer({ acceptPower: false })).waitingToBeAccepted).toBe(true);
    expect(taskCardFor(parts(done, false), viewer({ acceptPower: false })).waitingToBeAccepted).toBe(false);
    expect(taskCardFor(parts({ ...done, latestKind: "accepted" }, true), viewer()).waitingToBeAccepted).toBe(false);
    expect(taskCardFor(parts(state(), true), viewer()).waitingToBeAccepted).toBe(false);
  });

  it("says role and Accomplished, never seat or quest", () => {
    expect(TASK_COPY.buttons.accepted).toBe("Accept as accomplished");
    expect(TASK_COPY.statusLabels.accepted).toBe("Accomplished");
    expect(TASK_COPY.acceptedOn("Friday 6 November")).toBe("Accepted on Friday 6 November");
    expect(TASK_COPY.waitingToBeAccepted).toBe("Waiting to be accepted");
    const words = JSON.stringify([TASK_COPY.sheets.accepted, TASK_REFUSALS.ownWork, TASK_REFUSALS.notAnAcceptor, TASK_REFUSALS.notDoneYet]);
    expect(words).not.toMatch(/\bseat\b|\bquests?\b|[–—]/i);
  });
});

// ── The Accomplished list ───────────────────────────────────────────────────

const ev = (entryId: number, kind: string, at: string, over: Partial<AccomplishmentEvent> = {}): AccomplishmentEvent => ({
  entryId,
  kind,
  byNo: kind === "accepted" ? ACCEPTOR : HOLDER,
  ownerNo: HOLDER,
  ownerSeatId: null,
  note: null,
  at,
  text: `Task ${entryId}`,
  ...over,
});

describe("accomplishmentsFor", () => {
  it("keeps a task whose latest done is followed by an accept, with the date and the note", () => {
    const list = currentAccomplishments([
      ev(1, "done", "2026-10-12T10:00:00.000Z"),
      ev(1, "accepted", "2026-10-14T09:00:00.000Z", { note: "  Holds water again " }),
    ]);
    expect(list).toEqual([
      {
        entryId: 1,
        text: "Task 1",
        ownerNo: HOLDER,
        roleId: null,
        doneByNo: HOLDER,
        doneAt: "2026-10-12T10:00:00.000Z",
        acceptedAt: "2026-10-14T09:00:00.000Z",
        note: "Holds water again",
      },
    ]);
  });

  it("drops a task reopened after its accept, and takes it back when it is done and accepted again", () => {
    const first = [ev(1, "done", "2026-10-12T10:00:00.000Z"), ev(1, "accepted", "2026-10-14T09:00:00.000Z"), ev(1, "reopened", "2026-10-15T09:00:00.000Z")];
    expect(currentAccomplishments(first)).toEqual([]);
    const again = [...first, ev(1, "done", "2026-10-20T09:00:00.000Z"), ev(1, "accepted", "2026-10-21T09:00:00.000Z", { note: "Second time" })];
    expect(currentAccomplishments(again)).toMatchObject([{ entryId: 1, doneAt: "2026-10-20T09:00:00.000Z", note: "Second time" }]);
  });

  it("leaves out a done task nobody accepted, and a task let go", () => {
    expect(currentAccomplishments([ev(2, "done", "2026-10-12T10:00:00.000Z")])).toEqual([]);
    expect(currentAccomplishments([ev(3, "let_go", "2026-10-12T10:00:00.000Z")])).toEqual([]);
  });

  it("counts a task the room's close marked done, which has no done event", () => {
    const [a] = currentAccomplishments([ev(4, "accepted", "2026-10-14T09:00:00.000Z")]);
    expect(a).toMatchObject({ entryId: 4, doneAt: null, doneByNo: null });
    expect(accomplishedIn(a).toISOString()).toBe("2026-10-14T09:00:00.000Z");
  });

  it("carries a role-held task's role, and a holder who has since left as nobody", () => {
    const [a] = currentAccomplishments([
      ev(5, "done", "2026-10-12T10:00:00.000Z", { ownerNo: null, ownerSeatId: SEAT, byNo: 30 }),
      ev(5, "accepted", "2026-10-13T10:00:00.000Z", { ownerNo: null, ownerSeatId: SEAT }),
    ]);
    expect(a).toMatchObject({ ownerNo: null, roleId: SEAT, doneByNo: 30 });
  });

  it("groups by the moon the work was done in, newest moon first", () => {
    const thisMoon = LUNAR_CLOCK.boundsFor(new Date("2026-10-14T00:00:00Z"));
    const before = new Date(thisMoon.startsAt.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const inside = new Date(thisMoon.startsAt.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const after = new Date(thisMoon.startsAt.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const moons = accomplishmentsFor([
      // Done the day before the new moon, accepted inside it: filed under the moon before.
      ev(1, "done", before),
      ev(1, "accepted", inside),
      ev(2, "done", inside),
      ev(2, "accepted", after),
    ]);
    expect(moons.map((m) => m.items.map((a) => a.entryId))).toEqual([[2], [1]]);
    expect(moons[0]).toMatchObject({ id: thisMoon.id, startsAt: thisMoon.startsAt.toISOString(), endsAt: thisMoon.endsAt.toISOString() });
    expect(Date.parse(moons[1].endsAt)).toBe(thisMoon.startsAt.getTime());
    expect(groupByMoon([])).toEqual([]);
  });
});
