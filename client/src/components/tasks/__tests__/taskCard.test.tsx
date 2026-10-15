// @vitest-environment jsdom
/**
 * One task card, its answer sheet and the answer it sends.
 *
 * The card draws what the server says a viewer may do and nothing more; a
 * date gone by is a question in normal ink; Let go cannot be confirmed
 * without a sentence and Not yet without a date after today; and when
 * somebody else answered first, the card the server sends back takes this
 * one's place.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { TASK_COPY, TASK_REFUSALS, type TaskCard as TaskCardData } from "@shared/sessionTasks";
import { TODAY, makeTask, reply } from "./taskFixture";

const toasts = vi.hoisted(() => ({ success: vi.fn(), message: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
vi.mock("@/components/MicButton", () => ({ default: () => null }));
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
      <a href={href} className={className}>
        {children}
      </a>
    ),
  };
});

import TaskCard from "../TaskCard";
import TaskAnswerSheet from "../TaskAnswerSheet";
import { useTaskAnswer } from "../useTaskAnswer";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  toasts.success.mockReset();
  toasts.message.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const B = TASK_COPY.buttons;

describe("the card", () => {
  it("names each kind of holder", () => {
    const { rerender } = render(<TaskCard task={makeTask()} today={TODAY} />);
    expect(screen.getByText(TASK_COPY.heldYou)).toBeInTheDocument();

    rerender(<TaskCard task={makeTask({ heldAs: "person", holderName: "Grace Hopper", canAnswer: false })} today={TODAY} />);
    expect(screen.getByText(TASK_COPY.heldPerson("Grace Hopper"))).toBeInTheDocument();

    rerender(<TaskCard task={makeTask({ heldAs: "seat", seat: { id: "s1", name: "Water steward", holders: ["Ada", "Lin"] } })} today={TODAY} />);
    expect(screen.getByText(TASK_COPY.heldSeat("Water steward", ["Ada", "Lin"]))).toBeInTheDocument();

    rerender(<TaskCard task={makeTask({ heldAs: "seat", seat: { id: "s1", name: "Water steward", holders: [] } })} today={TODAY} />);
    expect(screen.getByText(TASK_COPY.heldSeatVacant("Water steward"))).toBeInTheDocument();

    rerender(<TaskCard task={makeTask({ heldAs: "circle", holderName: null, canAnswer: false, canTake: true })} today={TODAY} />);
    // The chip says it, and the holder line does not say it again.
    expect(screen.getAllByText(TASK_COPY.heldCircle)).toHaveLength(1);
    expect(screen.getByRole("button", { name: B.taken })).toBeInTheDocument();
  });

  it("asks nobody who cannot answer about a date gone by", () => {
    render(<TaskCard task={makeTask({ dueOn: "2026-10-12", heldAs: "person", holderName: "Kai Lune", canAnswer: false })} today={TODAY} />);
    expect(screen.getByText(TASK_COPY.duePast("Monday 12 October"))).toBeInTheDocument();
    expect(screen.queryByText(TASK_COPY.duePassed("Monday 12 October"))).not.toBeInTheDocument();
  });

  it("reads a date gone by as a question in normal ink, with no red", () => {
    const { container } = render(<TaskCard task={makeTask({ dueOn: "2026-10-12" })} today={TODAY} />);
    const line = screen.getByText(TASK_COPY.duePassed("Monday 12 October"));
    expect(line.className).toContain("text-foreground");
    expect(container.innerHTML).not.toMatch(/destructive|red-|text-red|bg-red/);
  });

  it("shows no buttons on a card still in an open session", () => {
    render(<TaskCard task={makeTask({ inSessionNow: true, latest: null, version: 0 })} today={TODAY} />);
    expect(screen.getByText(TASK_COPY.inSessionNow)).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("offers exactly the answers the server allows", () => {
    const { rerender } = render(<TaskCard task={makeTask()} today={TODAY} />);
    for (const op of ["done", "not_yet", "let_go", "handed_back"] as const) expect(screen.getByRole("button", { name: B[op] })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: B.reopened })).toBeNull();

    rerender(<TaskCard task={makeTask({ canAnswer: false })} today={TODAY} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);

    rerender(<TaskCard task={makeTask({ status: "done", canAnswer: false, canReopen: true })} today={TODAY} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([B.reopened]);
  });

  it("links the record only with recordLink", () => {
    const { rerender } = render(<TaskCard task={makeTask({ recordLink: true })} today={TODAY} />);
    expect(screen.getByRole("link", { name: B.record })).toHaveAttribute("href", "/sessions/7");
    rerender(<TaskCard task={makeTask({ recordLink: false })} today={TODAY} />);
    expect(screen.queryByRole("link", { name: B.record })).toBeNull();
    rerender(<TaskCard task={makeTask({ recordLink: true })} today={TODAY} hideRecordLink />);
    expect(screen.queryByRole("link", { name: B.record })).toBeNull();
  });

  it("carries the latest line, and says when the facilitator noted it", () => {
    const latest = { kind: "not_yet" as const, note: "Waiting on the hinge", byName: "Lin", byFacilitator: true, at: "2026-10-12T10:00:00Z" };
    render(<TaskCard task={makeTask({ latest })} today={TODAY} />);
    expect(screen.getByText(TASK_COPY.latestByFacilitator("Waiting on the hinge"))).toBeInTheDocument();
    expect(screen.getByText(TASK_COPY.statusLabels.newDate)).toBeInTheDocument();
  });
});

describe("the answer sheet", () => {
  const open = (op: "let_go" | "not_yet" | "done") =>
    render(<TaskAnswerSheet task={makeTask()} op={op} today={TODAY} onDone={vi.fn()} onClose={vi.fn()} />);

  it("cannot let go without a sentence", () => {
    open("let_go");
    const confirm = screen.getByRole("button", { name: TASK_COPY.sheets.let_go.confirm });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(TASK_COPY.sheets.let_go.notePrompt), { target: { value: "   " } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(TASK_COPY.sheets.let_go.notePrompt), { target: { value: "The fence is coming down" } });
    expect(confirm).toBeEnabled();
    expect(screen.getByText(TASK_COPY.sheets.let_go.hint)).toBeInTheDocument();
  });

  it("cannot move the date without a date after today", () => {
    open("not_yet");
    const confirm = screen.getByRole("button", { name: TASK_COPY.sheets.not_yet.confirm });
    expect(confirm).toBeDisabled();
    const picker = screen.getByLabelText(TASK_COPY.datePick);
    fireEvent.change(picker, { target: { value: TODAY } });
    expect(confirm).toBeDisabled();
    fireEvent.change(picker, { target: { value: "2026-10-14" } });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /This Friday/ }));
    expect(confirm).toBeEnabled();
    expect(screen.getByText(TASK_COPY.newDate("Friday 16 October"))).toBeInTheDocument();
  });

  it("sends the answer with the version it saw, then hands back the server's card", async () => {
    const onDone = vi.fn();
    const fresh = makeTask({ status: "done", version: 2, canAnswer: false, canReopen: true });
    fetchMock.mockResolvedValueOnce(reply(200, { task: fresh }));
    render(<TaskAnswerSheet task={makeTask()} op="done" today={TODAY} onDone={onDone} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.sheets.done.confirm }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(fresh));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sessions/tasks/1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ op: "done", version: 1 });
    expect(toasts.success).toHaveBeenCalledWith(TASK_COPY.sheets.done.toast);
  });

  it("keeps a refusal in the sheet as a sentence", async () => {
    const onDone = vi.fn();
    fetchMock.mockResolvedValueOnce(reply(403, { error: TASK_REFUSALS.notYours }));
    render(<TaskAnswerSheet task={makeTask()} op="done" today={TODAY} onDone={onDone} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.sheets.done.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(TASK_REFUSALS.notYours);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("useTaskAnswer", () => {
  it("replaces the card with the server's on a 409, and says someone answered first", async () => {
    const onCard = vi.fn<(t: TaskCardData) => void>();
    const now = makeTask({ status: "done", version: 3, canAnswer: false });
    fetchMock.mockResolvedValueOnce(reply(409, { error: TASK_REFUSALS.moved, task: now }));
    const { result } = renderHook(() => useTaskAnswer(onCard));
    let outcome: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      outcome = await result.current.send(makeTask(), "let_go", { note: "Not needed now" });
    });
    expect(outcome).toEqual({ kind: "moved", task: now });
    expect(onCard).toHaveBeenCalledWith(now);
    expect(toasts.message).toHaveBeenCalledWith(TASK_REFUSALS.moved);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("draws the server's card on the card after a 409", async () => {
    const now = makeTask({ status: "done", version: 3, canAnswer: false, latest: { kind: "done", note: "Fixed it Sunday", byName: "Lin", byFacilitator: false, at: "2026-10-14T09:00:00Z" } });
    fetchMock.mockResolvedValueOnce(reply(409, { error: TASK_REFUSALS.moved, task: now }));
    render(<TaskCard task={makeTask()} today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: B.done }));
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.sheets.done.confirm }));
    expect(await screen.findByText(TASK_COPY.latest("Fixed it Sunday"))).toBeInTheDocument();
    expect(screen.getByText(TASK_COPY.statusLabels.done)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: B.done })).toBeNull();
  });
});
