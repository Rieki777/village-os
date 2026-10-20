// @vitest-environment jsdom
/**
 * The closed record and the task layer: each action drawn as it was said,
 * with where it stands now beside it (Holding, Done, Let go, Back with the
 * circle, the new date when it moved, the latest line); Send the task emails
 * only for whoever the server says may send them; the question before it
 * sends, the result read off the server's answer, and one press that cannot
 * send twice.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ROOM_COPY } from "@shared/sessions";
import { TASK_COPY, TASK_REFUSALS, taskDateWords, type TaskMailResult, type TaskRecordPayload } from "@shared/sessionTasks";
import { json, makeView, record, type Call } from "./roomFixture";
import { makeAction, makeTask, SINCE } from "./taskFixture";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: () => true }));
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> };
});

import ClosedRecord from "../ClosedRecord";
import { roomDay } from "../FromLastTime";
import { lastSendLine } from "../TaskMailButton";

const RECORD = "/api/sessions/7/task-record";
const EMAILS = "/api/sessions/7/task-emails";

let calls: Call[];
let payload: TaskRecordPayload;
let mailAnswer: () => Promise<Response>;

const closedView = () =>
  makeView({
    status: "closed",
    closedAt: "2026-10-02T18:00:00.000Z",
    items: [
      { id: 5, title: "Roof", aim: "decide", minutes: 15, position: 1, status: "done", presenterUserId: null, addedBy: 1, startedAt: null, endedAt: null, usedSeconds: 900, fromSessionId: null },
    ],
    entries: [
      makeAction({ id: 51, text: "Call the roofer", ownerSeatId: "seat1", ownerSeatName: "Water steward", dueOn: "2026-10-16" }),
      makeAction({ id: 52, text: "Buy the gutters", ownerUserId: 1, ownerName: "Ada Moss" }),
      makeAction({ id: 53, text: "Ask the neighbours", ownerUserId: 2, ownerName: "Bo Fern" }),
      makeAction({ id: 54, text: "Clear the drain", ownerUserId: 3, ownerName: "Cy Reed" }),
      makeAction({ id: 55, text: "Paint the shed", ownerUserId: 2, ownerName: "Bo Fern", dueOn: "2026-10-20" }),
    ],
    me: { userId: 1, joined: true, facilitates: true, secretary: false, admin: false },
  });

const tasks = () => [
  makeTask({ entryId: 51, text: "Call the roofer", heldAs: "seat", holderName: null, seat: { id: "seat1", name: "Water steward", holders: ["Bo Fern"] }, dueOn: "2026-10-23", latest: { kind: "not_yet", note: "The roofer is away", byName: "Bo Fern", byFacilitator: false, at: SINCE } }),
  makeTask({ entryId: 52, text: "Buy the gutters", status: "done", latest: { kind: "done", note: "Bought and stacked", byName: "Ada Moss", byFacilitator: true, at: SINCE } }),
  makeTask({ entryId: 53, text: "Ask the neighbours", status: "let_go", latest: { kind: "let_go", note: "They moved away", byName: "Bo Fern", byFacilitator: false, at: SINCE } }),
  makeTask({ entryId: 54, text: "Clear the drain", heldAs: "circle", holderName: null, latest: { kind: "handed_back", note: null, byName: "Cy Reed", byFacilitator: false, at: SINCE } }),
  makeTask({ entryId: 55, text: "Paint the shed", dueOn: "2026-10-20" }),
];

beforeEach(() => {
  calls = [];
  payload = { tasks: tasks(), mail: { canSend: true, lastSend: { sendNo: 1, at: "2026-10-02T18:00:05.000Z", byName: null, queued: 3 } } };
  mailAnswer = async () => json({ sendNo: 2, people: 3, queued: 2, skipped: { pref_off: 1 } } satisfies TaskMailResult);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c = record(calls, url, init);
      if (c.method === "GET" && c.url === RECORD) return json(payload);
      if (c.method === "POST" && c.url === EMAILS) return mailAnswer();
      return json({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const reads = () => calls.filter((c) => c.method === "GET" && c.url === RECORD);
const sends = () => calls.filter((c) => c.method === "POST" && c.url === EMAILS);

/** The action's own line in the record. */
const actionLine = (text: string) => screen.getByText(text).closest("li") as HTMLElement;

describe("where each task stands now", () => {
  it("draws a chip beside each action, the new date when it moved, and the latest line, and leaves the words as said", async () => {
    const view = closedView();
    render(<ClosedRecord view={view} />);
    await waitFor(() => expect(actionLine("Call the roofer").querySelector("[data-task-standing]")).not.toBeNull());
    const today = roomDay(view.serverNow);

    const roofer = within(actionLine("Call the roofer"));
    expect(roofer.getByText(TASK_COPY.statusLabels.newDate)).toBeInTheDocument();
    expect(roofer.getByText(TASK_COPY.newDate(taskDateWords("2026-10-23", today)))).toBeInTheDocument();
    expect(roofer.getByText(TASK_COPY.latest("The roofer is away"))).toBeInTheDocument();
    // The record still says the date the call gave it.
    expect(roofer.getByText(/2026-10-16/)).toBeInTheDocument();

    const gutters = within(actionLine("Buy the gutters"));
    expect(gutters.getByText(TASK_COPY.statusLabels.done)).toBeInTheDocument();
    expect(gutters.getByText(TASK_COPY.latestByFacilitator("Bought and stacked"))).toBeInTheDocument();

    const neighbours = within(actionLine("Ask the neighbours"));
    expect(neighbours.getByText(TASK_COPY.statusLabels.let_go)).toBeInTheDocument();
    expect(neighbours.getByText(TASK_COPY.latest("They moved away"))).toBeInTheDocument();

    const drain = within(actionLine("Clear the drain"));
    expect(drain.getByText(TASK_COPY.statusLabels.circle)).toBeInTheDocument();
    // The record keeps who held it when the call closed.
    expect(drain.getByText(/Cy Reed/)).toBeInTheDocument();

    const shed = within(actionLine("Paint the shed"));
    expect(shed.getByText(TASK_COPY.statusLabels.open)).toBeInTheDocument();
    expect(shed.queryByText(/New date/)).not.toBeInTheDocument();

    // No chip ever reads a red mark.
    for (const chip of Array.from(document.querySelectorAll("[data-task-standing] *"))) expect(chip.className).not.toMatch(/destructive|red-/);
    expect(reads()).toHaveLength(1);
  });

  it("reads whole, as said, when the task layer does not answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        record(calls, url, init);
        return json({ error: "Not here." }, 404);
      }),
    );
    render(<ClosedRecord view={closedView()} />);
    await waitFor(() => expect(reads()).toHaveLength(1));
    expect(screen.getByText("Call the roofer")).toBeInTheDocument();
    expect(document.querySelector("[data-task-standing]")).toBeNull();
    expect(screen.queryByRole("button", { name: TASK_COPY.mail.button })).not.toBeInTheDocument();
  });
});

describe("send the task emails", () => {
  it("shows only for whoever the server says may send them", async () => {
    payload = { ...payload, mail: { canSend: false, lastSend: null } };
    render(<ClosedRecord view={closedView()} />);
    await waitFor(() => expect(document.querySelector("[data-task-standing]")).not.toBeNull());
    expect(screen.queryByRole("button", { name: TASK_COPY.mail.button })).not.toBeInTheDocument();
  });

  it("asks first, sends once, says what the server counted, and reads the record again", async () => {
    render(<ClosedRecord view={closedView()} />);
    fireEvent.click(await screen.findByRole("button", { name: TASK_COPY.mail.button }));
    expect(screen.getByText(TASK_COPY.mail.confirm)).toBeInTheDocument();
    expect(sends()).toHaveLength(0);

    // Not now sends nothing and puts the button back.
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.mail.cancel }));
    expect(screen.queryByText(TASK_COPY.mail.confirm)).not.toBeInTheDocument();
    expect(sends()).toHaveLength(0);

    payload = { ...payload, mail: { canSend: true, lastSend: { sendNo: 2, at: "2026-10-05T09:00:00.000Z", byName: "Ada Moss", queued: 2 } } };
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.mail.button }));
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.mail.confirmButton }));
    expect(await screen.findByText(TASK_COPY.mail.result(2, 3, { members: 1, setup: 0, other: 0 }))).toBeInTheDocument();
    expect(sends()).toHaveLength(1);
    expect(sends()[0].body).toEqual({});
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(await screen.findByText(TASK_COPY.mail.lastSent(taskDateWords(roomDay(Date.parse("2026-10-05T09:00:00.000Z"))), "Ada Moss"))).toBeInTheDocument();
  });

  it("is disabled while the send is out, so a double tap sends once", async () => {
    let open: (r: Response) => void = () => {};
    mailAnswer = () => new Promise<Response>((r) => (open = r));
    render(<ClosedRecord view={closedView()} />);
    fireEvent.click(await screen.findByRole("button", { name: TASK_COPY.mail.button }));
    const confirm = screen.getByRole("button", { name: TASK_COPY.mail.confirmButton });
    fireEvent.click(confirm);
    const sending = screen.getByRole("button", { name: TASK_COPY.mail.sending });
    expect(sending).toBeDisabled();
    fireEvent.click(sending);
    expect(sends()).toHaveLength(1);
    await act(async () => {
      open(json({ sendNo: 2, people: 1, queued: 1, skipped: {} } satisfies TaskMailResult));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByText(TASK_COPY.mail.result(1, 1, { members: 0, setup: 0, other: 0 }))).toBeInTheDocument();
    expect(sends()).toHaveLength(1);
  });

  it("says the server's own sentence on a refusal, and never a count", async () => {
    mailAnswer = async () => json({ error: TASK_REFUSALS.sendsTooMany }, 429);
    render(<ClosedRecord view={closedView()} />);
    fireEvent.click(await screen.findByRole("button", { name: TASK_COPY.mail.button }));
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.mail.confirmButton }));
    expect(await screen.findByRole("alert")).toHaveTextContent(TASK_REFUSALS.sendsTooMany);
    expect(screen.queryByText(/^Sent to/)).not.toBeInTheDocument();
    expect(reads()).toHaveLength(1);
  });

  it("never blames a member's settings when the village's email is not set up", async () => {
    mailAnswer = async () => json({ sendNo: 2, people: 3, queued: 0, skipped: { no_api_key: 3 } } satisfies TaskMailResult);
    render(<ClosedRecord view={closedView()} />);
    fireEvent.click(await screen.findByRole("button", { name: TASK_COPY.mail.button }));
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.mail.confirmButton }));
    const line = await screen.findByText(TASK_COPY.mail.result(0, 3, { members: 0, setup: 3, other: 0 }));
    expect(line).toHaveTextContent("The village's email is not set up yet");
    expect(line.textContent).not.toMatch(/turned off|no email on file/);
    expect(screen.queryByText(/turned off or have no email on file/)).not.toBeInTheDocument();
  });

  it("a dead network says so, and nothing was sent", async () => {
    mailAnswer = async () => {
      throw new TypeError("network");
    };
    render(<ClosedRecord view={closedView()} />);
    fireEvent.click(await screen.findByRole("button", { name: TASK_COPY.mail.button }));
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.mail.confirmButton }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ROOM_COPY.offline);
    expect(screen.queryByText(/^Sent to/)).not.toBeInTheDocument();
  });

  it("the last send reads the close, or who pressed it and when", async () => {
    render(<ClosedRecord view={closedView()} />);
    expect(await screen.findByText(TASK_COPY.mail.sentAtClose)).toBeInTheDocument();
    expect(lastSendLine(null, "2026-10-09")).toBeNull();
    const when = taskDateWords(roomDay(Date.parse("2026-10-05T12:00:00.000Z")), "2026-10-09");
    expect(lastSendLine({ sendNo: 3, at: "2026-10-05T12:00:00.000Z", byName: "Ada Moss", queued: 2 }, "2026-10-09")).toBe(TASK_COPY.mail.lastSent(when, "Ada Moss"));
    // A send that put no email on its way says so, the close's and a person's alike.
    expect(lastSendLine({ sendNo: 1, at: "2026-10-02T18:00:05.000Z", byName: null, queued: 0 }, "2026-10-09")).toBe(TASK_COPY.mail.triedAtClose);
    expect(lastSendLine({ sendNo: 3, at: "2026-10-05T12:00:00.000Z", byName: "Ada Moss", queued: 0 }, "2026-10-09")).toBe(TASK_COPY.mail.lastTried(when, "Ada Moss"));
    // One still going out has no counts yet, and reads as sent.
    expect(lastSendLine({ sendNo: 1, at: "2026-10-02T18:00:05.000Z", byName: null, queued: null }, "2026-10-09")).toBe(TASK_COPY.mail.sentAtClose);
  });
});
