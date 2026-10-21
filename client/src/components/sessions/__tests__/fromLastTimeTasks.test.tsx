// @vitest-environment jsdom
/**
 * From last time reads the circle's tasks: every open task from the circle's
 * earlier sessions and every one answered since it last met, grouped in the
 * order the room reads them (what got done, what is back with the circle, the
 * new dates, what was let go, what is still held). A task back with the
 * circle offers "I'll take it" only to whoever the server says may take it,
 * and taking it moves the card to Still holding before the next poll. The
 * facilitator reads the cue line; the backlog and the parked items stay as
 * they were.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ROOM_COPY, SESSION_COPY } from "@shared/sessions";
import { TASK_COPY, type TaskCard } from "@shared/sessionTasks";
import { json, makeView, record, type Call } from "./roomFixture";
import { BEFORE, LAST_MET, SINCE, makeAction, makeTask } from "./taskFixture";
import type { RoomActions } from "../useSessionRoom";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: () => true }));
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> };
});

import FromLastTime, { lastMetFrom, roomDay } from "../FromLastTime";

let calls: Call[];
let added: unknown[];
let patchAnswer: (c: Call) => Response;

/** The room's doors: only adding to the agenda is reached from here. */
const doors = () =>
  ({
    addItem: async (input: unknown) => {
      added.push(input);
      return { ok: true, body: {}, room: null };
    },
  }) as unknown as RoomActions;

const FACILITATOR = { userId: 1, joined: true, facilitates: true, secretary: false, admin: false };

/** One card in every group, plus two the circle already heard. */
const circleTasks = (): TaskCard[] => [
  makeTask({ entryId: 31, text: "Fix the gate", dueOn: "2026-10-30", latest: { kind: "closed", note: null, byName: null, byFacilitator: false, at: LAST_MET } }),
  makeTask({ entryId: 32, text: "Order the pipe", latest: { kind: "let_go", note: "The well is fine", byName: "Bo Fern", byFacilitator: false, at: SINCE }, status: "let_go" }),
  makeTask({ entryId: 33, text: "Move the hives", dueOn: "2026-10-25", latest: { kind: "not_yet", note: null, byName: "Ada Moss", byFacilitator: false, at: SINCE } }),
  makeTask({ entryId: 34, text: "Clear the drain", heldAs: "circle", holderName: null, canTake: true, latest: { kind: "handed_back", note: null, byName: "Cy Reed", byFacilitator: false, at: SINCE } }),
  makeTask({ entryId: 35, text: "Buy the gutters", status: "done", latest: { kind: "done", note: "Bought and stacked", byName: "Ada Moss", byFacilitator: false, at: SINCE } }),
  // A date moved before the circle last met was heard then: it is still being held.
  makeTask({ entryId: 36, text: "Sharpen the saws", dueOn: "2026-11-02", latest: { kind: "not_yet", note: null, byName: "Ada Moss", byFacilitator: false, at: BEFORE } }),
];

beforeEach(() => {
  calls = [];
  added = [];
  patchAnswer = () => json({ task: makeTask({ entryId: 34, text: "Clear the drain", heldAs: "you", holderName: "Bo Fern", version: 2, latest: { kind: "taken", note: null, byName: "Bo Fern", byFacilitator: false, at: SINCE } }) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c = record(calls, url, init);
      if (c.method === "PATCH") return patchAnswer(c);
      return json({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const groupKeys = () => Array.from(document.querySelectorAll("[data-check-group]")).map((g) => g.getAttribute("data-check-group"));
const group = (key: string) => within(document.querySelector(`[data-check-group="${key}"]`) as HTMLElement);

describe("the action check reads the circle's tasks", () => {
  it("groups them in the order the room reads them, with the circle's own count", () => {
    render(<FromLastTime view={makeView({ circleTasks: circleTasks() })} actions={doors()} />);
    expect(groupKeys()).toEqual(["doneSince", "backWithCircle", "newDates", "letGo", "stillHolding"]);
    for (const key of ["doneSince", "backWithCircle", "newDates", "letGo", "stillHolding"] as const) {
      expect(screen.getByRole("heading", { name: TASK_COPY.checkGroups[key] })).toBeInTheDocument();
    }
    expect(group("doneSince").getByText("Buy the gutters")).toBeInTheDocument();
    expect(group("doneSince").getByText(TASK_COPY.doneSince(1))).toBeInTheDocument();
    expect(group("backWithCircle").getByText("Clear the drain")).toBeInTheDocument();
    expect(group("newDates").getByText("Move the hives")).toBeInTheDocument();
    expect(group("letGo").getByText("Order the pipe")).toBeInTheDocument();
    expect(group("letGo").getByText(TASK_COPY.latest("The well is fine"))).toBeInTheDocument();
    // Still holding goes by date.
    const holding = Array.from(document.querySelectorAll('[data-check-group="stillHolding"] [data-task] p:first-child')).map((p) => p.textContent);
    expect(holding).toEqual(["Fix the gate", "Sharpen the saws"]);
  });

  it("leaves out an empty group, and draws nothing at all with nothing to carry", () => {
    const only = circleTasks().filter((t) => t.entryId === 31);
    const { unmount } = render(<FromLastTime view={makeView({ circleTasks: only })} actions={doors()} />);
    expect(groupKeys()).toEqual(["stillHolding"]);
    expect(screen.queryByText(TASK_COPY.doneSince(0))).not.toBeInTheDocument();
    unmount();
    const { container } = render(<FromLastTime view={makeView({ circleTasks: [] })} actions={doors()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers I'll take it only where the server says it may be taken", () => {
    const tasks = [
      makeTask({ entryId: 40, text: "Clear the drain", heldAs: "circle", holderName: null, canTake: true }),
      makeTask({ entryId: 41, text: "Stack the wood", heldAs: "circle", holderName: null, canTake: false }),
    ];
    render(<FromLastTime view={makeView({ circleTasks: tasks })} actions={doors()} />);
    const take = screen.getAllByRole("button", { name: TASK_COPY.buttons.taken });
    expect(take).toHaveLength(1);
    expect(screen.getByText("Clear the drain").closest("[data-task]")).toContainElement(take[0]);
    expect(within(screen.getByText("Stack the wood").closest("[data-task]") as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });

  it("taking a task sends op taken with the version seen, and the card moves to Still holding before the next poll", async () => {
    render(<FromLastTime view={makeView({ circleTasks: circleTasks() })} actions={doors()} />);
    fireEvent.click(group("backWithCircle").getByRole("button", { name: TASK_COPY.buttons.taken }));
    const sheet = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: TASK_COPY.sheets.taken.confirm }));
    });
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe("/api/sessions/tasks/34");
    expect(patch.body).toEqual({ op: "taken", version: 1 });
    await waitFor(() => expect(groupKeys()).not.toContain("backWithCircle"));
    expect(group("stillHolding").getByText("Clear the drain")).toBeInTheDocument();
  });

  it("a card answered by somebody who is not its holder shows no answer buttons", () => {
    render(<FromLastTime view={makeView({ circleTasks: [makeTask({ entryId: 31, canAnswer: false })] })} actions={doors()} />);
    expect(screen.queryByRole("button", { name: TASK_COPY.buttons.done })).not.toBeInTheDocument();
  });

  it("the holder and the facilitator get the answer buttons the server allows", () => {
    render(<FromLastTime view={makeView({ circleTasks: [makeTask({ entryId: 31, canAnswer: true })], me: FACILITATOR })} actions={doors()} />);
    for (const op of ["done", "not_yet", "let_go", "handed_back"] as const) {
      expect(screen.getByRole("button", { name: TASK_COPY.buttons[op] })).toBeInTheDocument();
    }
  });

  it("the cue line is the facilitator's, and the record's open actions give way to the tasks", () => {
    const carried = {
      sessionId: 3,
      title: "Water circle, last moon",
      actions: [makeAction({ id: 30, itemId: null, text: "An action as the record said it", ownerUserId: 1, ownerName: "Ada Moss" })],
      backlog: [makeAction({ id: 39, itemId: null, kind: "tension", text: "Paths flood" })],
      parkedItems: [],
    };
    const first = render(<FromLastTime view={makeView({ carried, circleTasks: circleTasks(), me: FACILITATOR })} actions={doors()} />);
    expect(screen.getByText(TASK_COPY.checkCue)).toBeInTheDocument();
    expect(screen.queryByText("An action as the record said it")).not.toBeInTheDocument();
    expect(screen.getByText("Paths flood")).toBeInTheDocument();
    first.unmount();

    render(<FromLastTime view={makeView({ carried, circleTasks: circleTasks() })} actions={doors()} />);
    expect(screen.queryByText(TASK_COPY.checkCue)).not.toBeInTheDocument();
  });

  it("with no circle tasks the record's open actions still show, as before", () => {
    const carried = {
      sessionId: 3,
      title: "Water circle, last moon",
      actions: [makeAction({ id: 30, itemId: null, text: "Mend the fence", ownerUserId: 1, ownerName: "Ada Moss" })],
      backlog: [],
      parkedItems: [],
    };
    render(<FromLastTime view={makeView({ carried })} actions={doors()} />);
    expect(screen.getByText("Mend the fence")).toBeInTheDocument();
    expect(document.querySelector("[data-check-group]")).toBeNull();
  });

  it("the action check can come onto the agenda even when the last record has nothing else to carry", async () => {
    render(<FromLastTime view={makeView({ circleTasks: circleTasks() })} actions={doors()} />);
    expect(screen.getByRole("heading", { name: SESSION_COPY.carriedActions })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.addActionCheck }));
    await waitFor(() => expect(added).toEqual([{ title: ROOM_COPY.actionCheckTitle, aim: "report", minutes: 5, fromSessionId: 3 }]));
  });

  it("offers the action check once a room has one, whichever earlier session it points back to", () => {
    // Somebody who was in the last call brought it in from there; this viewer reads only an older session's tasks.
    const check = {
      id: 90,
      title: ROOM_COPY.actionCheckTitle,
      aim: "report" as const,
      minutes: 5,
      position: 1,
      status: "waiting" as const,
      presenterUserId: 1,
      addedBy: 1,
      startedAt: null,
      endedAt: null,
      usedSeconds: 0,
      fromSessionId: 99,
    };
    render(<FromLastTime view={makeView({ circleTasks: circleTasks(), items: [check] })} actions={doors()} />);
    expect(screen.getByRole("heading", { name: SESSION_COPY.carriedActions })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROOM_COPY.addActionCheck })).toBeNull();
  });
});

describe("the readings under it", () => {
  it("reads when the circle last met off the newest unanswered close", () => {
    expect(lastMetFrom(circleTasks())).toBe(LAST_MET);
    expect(lastMetFrom([makeTask({ latest: { kind: "done", note: null, byName: null, byFacilitator: false, at: SINCE } })])).toBeNull();
    expect(lastMetFrom([])).toBeNull();
  });

  it("groups by when the server says the circle last met, even when no card still carries that close", () => {
    // Every task from the last call was answered before this one, so no card is still "closed".
    // A Not yet given before that call was heard then: it is still being held, not a new date.
    const oldNotYet = makeTask({ entryId: 41, text: "Sharpen the saws", dueOn: "2026-11-02", latest: { kind: "not_yet", note: null, byName: "Ada Moss", byFacilitator: false, at: BEFORE } });
    const doneSince = makeTask({ entryId: 42, text: "Buy the gutters", status: "done", latest: { kind: "done", note: null, byName: "Ada Moss", byFacilitator: false, at: SINCE } });
    render(<FromLastTime view={makeView({ circleTasks: [oldNotYet, doneSince], circleLastMetAt: LAST_MET })} actions={doors()} />);
    expect(groupKeys()).toEqual(["doneSince", "stillHolding"]);
    expect(group("stillHolding").getByText("Sharpen the saws")).toBeInTheDocument();
  });

  it("the room's day is a plain YYYY-MM-DD", () => {
    expect(roomDay(Date.UTC(2026, 9, 9, 12, 0, 0))).toMatch(/^2026-10-(08|09|10)$/);
  });
});
