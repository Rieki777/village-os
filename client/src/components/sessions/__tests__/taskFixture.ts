/**
 * One task card, the way the task layer hands it to the room (TaskCard in
 * shared/sessionTasks.ts), for the room's task tests. By default it is an open
 * task Ada holds from an earlier Water circle call, unanswered since it closed.
 */
import type { SessionEntry } from "@shared/sessions";
import type { TaskCard } from "@shared/sessionTasks";

/** When the circle's last call closed. */
export const LAST_MET = "2026-10-02T18:00:00.000Z";
/** A moment after it, for answers given since. */
export const SINCE = "2026-10-05T09:00:00.000Z";
/** A moment before it, for answers the circle already heard. */
export const BEFORE = "2026-09-20T09:00:00.000Z";

export function makeTask(over: Partial<TaskCard> = {}): TaskCard {
  return {
    entryId: 30,
    sessionId: 3,
    sessionTitle: "Water circle, last moon",
    circleId: "water",
    circleName: "Water",
    saidOn: "2026-10-02",
    text: "Mend the fence",
    status: "open",
    heldAs: "person",
    holderName: "Ada Moss",
    seat: null,
    dueOn: null,
    latest: { kind: "closed", note: null, byName: null, byFacilitator: false, at: LAST_MET },
    inSessionNow: false,
    canAnswer: false,
    canReopen: false,
    canTake: false,
    recordLink: true,
    version: 1,
    ...over,
  };
}

/** An action as the record wrote it down. */
export function makeAction(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: 51,
    itemId: 5,
    kind: "action",
    text: "Call the roofer",
    status: "open",
    authorUserId: 2,
    ownerUserId: null,
    ownerName: null,
    ownerSeatId: null,
    ownerSeatName: null,
    dueOn: null,
    createdAt: "2026-10-09T17:30:00.000Z",
    ...over,
  };
}
