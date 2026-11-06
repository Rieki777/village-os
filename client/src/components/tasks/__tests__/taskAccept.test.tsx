// @vitest-environment jsdom
/**
 * "Accept as accomplished" on the profile's task board (PR 4 of the player
 * role card): the control on a task row for whoever may accept it, the
 * Accomplished chip and its date once accepted, "Waiting to be accepted" when
 * nobody may, and the toAccept rows in Waiting on you, which carry the control
 * themselves because the task is not on the reader's own board.
 *
 * Same harness as taskBoard.test.tsx: the waiting read has its own mock, so
 * `fetchMock` sees the board's reads and the answers alone.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TASK_COPY, TASKS_MINE_URL, taskAcceptUrl, taskUrl } from "@shared/sessionTasks";
import { WAITING_COPY, WAITING_URL, type WaitingPayload } from "@shared/waitingOnYou";
import { makeBoard, makeTask, reply } from "./taskFixture";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/MicButton", () => ({ default: () => null }));
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> };
});

import TaskBoard from "@/components/profile/TaskBoard";

const fetchMock = vi.fn();
const waitingMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  waitingMock.mockReset();
  waitingMock.mockImplementation(async () => reply(404, { error: "not_found" }));
  vi.stubGlobal("fetch", (url: unknown, init?: unknown) => (String(url) === WAITING_URL ? waitingMock(url, init) : fetchMock(url, init)));
});
afterEach(() => vi.unstubAllGlobals());


describe("a done task on the board", () => {
  const done = makeTask({ entryId: 3, status: "done", canAnswer: false, canReopen: false, text: "Paint the shed", version: 4, latest: { kind: "done", note: null, byName: "Ada Lovelace", byFacilitator: false, at: "2026-10-14T10:00:00.000Z" } });

  it("offers Accept as accomplished to whoever may accept it, and sends the accept with its version and note", async () => {
    const accepted = { ...done, canAccept: false, version: 5, acceptedOn: "2026-10-15", latest: { kind: "accepted" as const, note: "Looks right", byName: "Bo", byFacilitator: false, at: "2026-10-15T09:00:00.000Z" } };
    fetchMock
      .mockResolvedValueOnce(reply(200, makeBoard({ finished: [{ ...done, canAccept: true }] })))
      .mockResolvedValueOnce(reply(200, { task: accepted }))
      .mockResolvedValue(reply(200, makeBoard({ finished: [accepted] })));
    render(<TaskBoard />);
    const group = await screen.findByRole("region", { name: TASK_COPY.groups.finished });
    fireEvent.click(within(group).getByRole("button", { name: TASK_COPY.buttons.accepted }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText(TASK_COPY.sheets.accepted.notePrompt), { target: { value: "Looks right" } });
    fireEvent.click(within(sheet).getByRole("button", { name: TASK_COPY.sheets.accepted.confirm }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === taskUrl(3))).toBe(true));
    const call = fetchMock.mock.calls.find((c) => c[0] === taskUrl(3))!;
    expect((call[1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ op: "accepted", version: 4, note: "Looks right" });
    // Accepted: the chip reads Accomplished and the date is in words.
    await waitFor(() => expect(within(screen.getByRole("region", { name: TASK_COPY.groups.finished })).getByText(TASK_COPY.statusLabels.accepted)).toBeInTheDocument());
    expect(screen.getByText(TASK_COPY.acceptedOn("Thursday 15 October"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TASK_COPY.buttons.accepted })).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe(TASKS_MINE_URL);
  });

  it("offers nothing to somebody who may not accept, and reads Waiting to be accepted when nobody may", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, makeBoard({ finished: [{ ...done, canAccept: false, waitingToBeAccepted: true }, { ...done, entryId: 4, text: "Sweep the yard", canAccept: false }] })),
    );
    render(<TaskBoard />);
    const group = await screen.findByRole("region", { name: TASK_COPY.groups.finished });
    expect(within(group).queryByRole("button", { name: TASK_COPY.buttons.accepted })).toBeNull();
    expect(within(group).getAllByText(TASK_COPY.waitingToBeAccepted)).toHaveLength(1);
    expect(within(group).getAllByText(TASK_COPY.statusLabels.done)).toHaveLength(2);
  });

  it("reads a card from a server that sends none of the accept fields as it did before", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard({ finished: [done] })));
    render(<TaskBoard />);
    const group = await screen.findByRole("region", { name: TASK_COPY.groups.finished });
    expect(within(group).getByText("Paint the shed")).toBeInTheDocument();
    expect(within(group).queryByText(TASK_COPY.waitingToBeAccepted)).toBeNull();
    expect(within(group).queryByRole("button", { name: TASK_COPY.buttons.accepted })).toBeNull();
  });
});

const WAITING: WaitingPayload = {
  applications: [],
  drafts: [],
  toAccept: [
    { entryId: 21, text: "Fix the water tank", role: "Water steward", circle: "Garden circle", doneOn: "2026-10-14" },
    { entryId: 22, text: "Sweep the yard", role: null, circle: null, doneOn: "2026-10-13" },
  ],
};

describe("waiting on you: to accept", () => {
  it("lists the done tasks to accept, with no person named, and accepts one in place with a note", async () => {
    waitingMock.mockImplementation(async () => reply(200, WAITING));
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url) === taskAcceptUrl(21) ? reply(200, { task: makeTask({ entryId: 21, status: "done" }) }) : reply(200, makeBoard()),
    );
    render(<TaskBoard />);
    const group = await screen.findByRole("region", { name: WAITING_COPY.heading });
    expect(within(group).getByText(WAITING_COPY.acceptLine("Fix the water tank"))).toBeInTheDocument();
    expect(within(group).getByText("Water steward · Garden circle · Marked done 14 October 2026")).toBeInTheDocument();
    expect(within(group).getByText("Marked done 13 October 2026")).toBeInTheDocument();
    expect(group.textContent).not.toMatch(/Ada|Lovelace/);

    const row = group.querySelector('[data-to-accept="21"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: WAITING_COPY.acceptAction }));
    fireEvent.change(within(row).getByLabelText(WAITING_COPY.acceptNote), { target: { value: "  Holds water again " } });
    fireEvent.click(within(row).getByRole("button", { name: WAITING_COPY.acceptConfirm }));
    await waitFor(() => expect(group.querySelector('[data-to-accept="21"]')).toBeNull());
    const call = fetchMock.mock.calls.find((c) => c[0] === taskAcceptUrl(21))!;
    expect((call[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ note: "Holds water again" });
    // The other row stays.
    expect(group.querySelector('[data-to-accept="22"]')).not.toBeNull();
  });

  it("shows the server's sentence when the accept is refused, and keeps the row", async () => {
    waitingMock.mockImplementation(async () => reply(200, WAITING));
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url) === taskAcceptUrl(21) ? reply(400, { error: TASK_COPY.waitingToBeAccepted }) : reply(200, makeBoard()),
    );
    render(<TaskBoard />);
    const group = await screen.findByRole("region", { name: WAITING_COPY.heading });
    const row = group.querySelector('[data-to-accept="21"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: WAITING_COPY.acceptAction }));
    fireEvent.click(within(row).getByRole("button", { name: WAITING_COPY.acceptConfirm }));
    expect(await within(row).findByRole("alert")).toHaveTextContent(TASK_COPY.waitingToBeAccepted);
    expect(group.querySelector('[data-to-accept="21"]')).not.toBeNull();
  });

  it("draws nothing for a server that sends no toAccept group", async () => {
    waitingMock.mockImplementation(async () => reply(200, { applications: [], drafts: [] }));
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    expect(await screen.findByText(TASK_COPY.empty)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: WAITING_COPY.heading })).toBeNull();
  });
});
