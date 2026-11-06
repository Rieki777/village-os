/**
 * One task card as the server hands it to a member, for the task board's
 * tests. Every field is the contract's (`TaskCard` in shared/sessionTasks.ts);
 * a case changes only what it is about.
 */
import type { TaskBoardPayload, TaskCard } from "@shared/sessionTasks";

/** Village-local today for every case: Thursday 15 October 2026. */
export const TODAY = "2026-10-15";

export function makeTask(over: Partial<TaskCard> = {}): TaskCard {
  return {
    entryId: 1,
    sessionId: 7,
    sessionTitle: "Weekly planning",
    circleId: "c-garden",
    circleName: "Garden",
    saidOn: "2026-10-09",
    text: "Fix the gate latch",
    status: "open",
    heldAs: "you",
    holderName: "Ada Lovelace",
    seat: null,
    dueOn: "2026-10-23",
    latest: { kind: "closed", note: null, byName: null, byFacilitator: false, at: "2026-10-09T18:00:00.000Z" },
    inSessionNow: false,
    canAnswer: true,
    canReopen: false,
    canTake: false,
    recordLink: true,
    version: 1,
    ...over,
  };
}

export function makeBoard(over: Partial<TaskBoardPayload> = {}): TaskBoardPayload {
  return { holding: [], seatsHold: [], circleBack: [], finished: [], earlierCount: 0, today: TODAY, ...over };
}

/** A fetch Response with a JSON body. */
export function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
