// @vitest-environment jsdom
/**
 * The profile's task board: its groups, its empty state, the Earlier
 * disclosure that loads only when opened, a load that fails and is tried
 * again, and no number in any heading. Then the Waiting on you group
 * (WaitingOnYou.tsx): its rows, its place first, and the board with Live
 * Sessions off.
 *
 * The board now makes two reads. The Waiting on you read goes to its own
 * mock, `waitingMock`, so `fetchMock` still sees the board's reads alone and
 * in order. It answers 404 (closed, nothing drawn) unless a case says more.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TASK_COPY, TASKS_MINE_URL } from "@shared/sessionTasks";
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

const G = TASK_COPY.groups;
const groupNamed = (name: string) => screen.getByRole("region", { name });

describe("the task board", () => {
  it("draws Holding, Your seats hold and Finished, each with its own cards", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, makeBoard({
        holding: [makeTask({ entryId: 1, text: "Fix the gate latch" })],
        seatsHold: [makeTask({ entryId: 2, heldAs: "seat", text: "Order seed", seat: { id: "s1", name: "Water steward", holders: ["Ada"] } })],
        finished: [makeTask({ entryId: 3, status: "done", canAnswer: false, text: "Paint the shed" })],
      })),
    );
    render(<TaskBoard />);
    expect(await screen.findByText("Fix the gate latch")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(TASKS_MINE_URL);
    expect(within(groupNamed(G.holding)).getByText("Fix the gate latch")).toBeInTheDocument();
    expect(within(groupNamed(G.seatsHold)).getByText("Order seed")).toBeInTheDocument();
    expect(within(groupNamed(G.finished)).getByText("Paint the shed")).toBeInTheDocument();
    expect(screen.queryByText(TASK_COPY.empty)).toBeNull();
    // The groups read in their order.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([G.holding, G.seatsHold, G.finished]);
  });

  it("draws what is back with your circles below your own open tasks, with the take and no record link", async () => {
    const back = makeTask({ entryId: 5, text: "Mend the fence", heldAs: "circle", holderName: null, canAnswer: false, canTake: true, recordLink: false });
    fetchMock
      .mockResolvedValueOnce(
        reply(200, makeBoard({
          holding: [makeTask({ entryId: 1, text: "Fix the gate latch" })],
          circleBack: [back],
          finished: [makeTask({ entryId: 3, status: "done", canAnswer: false, text: "Paint the shed" })],
        })),
      )
      .mockResolvedValueOnce(reply(200, { task: { ...back, heldAs: "you", holderName: "Ada Lovelace", canTake: false, canAnswer: true, version: 2 } }))
      .mockResolvedValueOnce(reply(200, makeBoard({ holding: [makeTask({ entryId: 1, text: "Fix the gate latch" }), makeTask({ entryId: 5, text: "Mend the fence", version: 2 })] })));
    render(<TaskBoard />);
    const group = await screen.findByRole("region", { name: G.circleBack });
    expect(within(group).getByText("Mend the fence")).toBeInTheDocument();
    expect(within(group).getByText(TASK_COPY.circleBackHint)).toBeInTheDocument();
    expect(within(group).queryByText(TASK_COPY.buttons.record)).toBeNull();
    expect(within(group).queryByRole("button", { name: TASK_COPY.buttons.done })).toBeNull();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([G.holding, G.circleBack, G.finished]);
    // Taken, it is yours: the re-read moves it up to Holding and the circles' group goes.
    fireEvent.click(within(group).getByRole("button", { name: TASK_COPY.buttons.taken }));
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.sheets.taken.confirm }));
    await waitFor(() => expect(within(groupNamed(G.holding)).getByText("Mend the fence")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: G.circleBack })).toBeNull();
  });

  it("reads a board from a server that sends no circles' group", async () => {
    const { circleBack: _none, ...older } = makeBoard({ holding: [makeTask({ entryId: 1, text: "Fix the gate latch" })] });
    fetchMock.mockResolvedValueOnce(reply(200, older));
    render(<TaskBoard />);
    expect(await screen.findByText("Fix the gate latch")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: G.circleBack })).toBeNull();
  });

  it("says nothing is in your hands, and leaves out the groups that are empty", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    expect(await screen.findByText(TASK_COPY.empty)).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(screen.queryByText(G.earlier)).toBeNull();
  });

  it("puts no number in any heading", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, makeBoard({
        holding: [makeTask({ entryId: 1 }), makeTask({ entryId: 2 }), makeTask({ entryId: 4 })],
        finished: [makeTask({ entryId: 3, status: "let_go", canAnswer: false })],
        earlierCount: 12,
      })),
    );
    render(<TaskBoard />);
    await screen.findAllByText("Fix the gate latch");
    for (const h of screen.getAllByRole("heading")) expect(h.textContent).not.toMatch(/\d/);
    const summary = screen.getByText(G.earlier).closest("summary");
    expect(summary?.textContent).not.toMatch(/\d/);
  });

  it("loads Earlier only when it is opened", async () => {
    const recent = makeTask({ entryId: 3, status: "done", canAnswer: false, text: "Paint the shed" });
    const older = makeTask({ entryId: 9, status: "done", canAnswer: false, text: "Clear the ditch" });
    fetchMock
      .mockResolvedValueOnce(reply(200, makeBoard({ finished: [recent], earlierCount: 1 })))
      .mockResolvedValueOnce(reply(200, makeBoard({ finished: [recent, older], earlierCount: 1 })));
    const { container } = render(<TaskBoard />);
    await screen.findByText("Paint the shed");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const details = container.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("Clear the ditch")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${TASKS_MINE_URL}?earlier=1`);
    // A task shown in Finished is not shown again under Earlier.
    expect(screen.getAllByText("Paint the shed")).toHaveLength(1);
  });

  it("offers to try again when the board does not load", async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: "boom" })).mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    expect(await screen.findByText(TASK_COPY.loadFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.retry }));
    expect(await screen.findByText(TASK_COPY.empty)).toBeInTheDocument();
  });

  it("re-reads quietly after an answer, so a finished task moves to Finished", async () => {
    const open = makeTask({ entryId: 1, text: "Fix the gate latch" });
    const done = makeTask({ entryId: 1, text: "Fix the gate latch", status: "done", version: 2, canAnswer: false, canReopen: true });
    fetchMock
      .mockResolvedValueOnce(reply(200, makeBoard({ holding: [open] })))
      .mockResolvedValueOnce(reply(200, { task: done }))
      .mockResolvedValueOnce(reply(200, makeBoard({ finished: [done] })));
    render(<TaskBoard />);
    await screen.findByText("Fix the gate latch");
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.buttons.done }));
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.sheets.done.confirm }));
    await waitFor(() => expect(within(groupNamed(G.finished)).getByText("Fix the gate latch")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: G.holding })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The card that had focus moved groups, so focus comes home to the board's heading.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: TASK_COPY.heading })));
  });
});

const WAITING: WaitingPayload = {
  applications: [
    { id: "sa-0000000000000001", href: "/seat-applications/sa-0000000000000001", seats: ["Water steward", "Seed keeper"], circles: ["Garden circle"], applicant: "Ada", appliedOn: "2026-10-18" },
  ],
  drafts: [{ id: "draft-1", title: "The water circle", circles: 1, seats: 2, href: "/review/structure/batch-1" }],
};

describe("waiting on you", () => {
  it("comes first, names the seats, the circle, the applicant and the day, and opens the application", async () => {
    waitingMock.mockImplementation(async () => reply(200, WAITING));
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard({ holding: [makeTask({ entryId: 1, text: "Fix the gate latch" })] })));
    render(<TaskBoard />);
    const group = await screen.findByRole("region", { name: WAITING_COPY.heading });
    expect(await screen.findByText("Fix the gate latch")).toBeInTheDocument();
    const row = within(group).getByText("Ada applied for Water steward and Seed keeper").closest("a");
    expect(row?.getAttribute("href")).toBe("/seat-applications/sa-0000000000000001");
    expect(within(group).getByText("In Garden circle · Applied 18 October 2026")).toBeInTheDocument();
    const draft = within(group).getByText("A draft to publish: The water circle").closest("a");
    expect(draft?.getAttribute("href")).toBe("/review/structure/batch-1");
    expect(within(group).getByText("It adds 1 circle and 2 roles")).toBeInTheDocument();
    // First of the groups, and no number in its heading.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe(WAITING_COPY.heading);
    expect(headings[0]).not.toMatch(/\d/);
  });

  it("draws the circle's asks under Asked to consent: the roles, the circle, the day it closes, opening the proposal", async () => {
    const toConsent = [
      { proposalId: "rp-00000000000000c1", applicationId: "sa-00000000000000c1", href: "/role-applications/sa-00000000000000c1", roles: ["Kitchen keeper", "Seed saver"], circle: "Food circle", applicant: "Ana", closesOn: "2026-11-06" },
    ];
    waitingMock.mockImplementation(async () => reply(200, { applications: [], drafts: [], toConsent }));
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    const group = await screen.findByRole("region", { name: WAITING_COPY.heading });
    const asks = within(group).getByRole("list", { name: WAITING_COPY.consentHeading });
    expect(within(group).getByRole("heading", { name: WAITING_COPY.consentHeading })).toBeInTheDocument();
    const row = within(asks).getByText("Ana proposes to hold Kitchen keeper and Seed saver next season").closest("a");
    expect(row?.getAttribute("href")).toBe("/role-applications/sa-00000000000000c1");
    expect(within(asks).getByText("In Food circle · Closes on 6 November 2026")).toBeInTheDocument();
    expect(within(asks).getByText(WAITING_COPY.consentAction)).toBeInTheDocument();
    // Something waits, so the board is not called empty, and no heading carries a number.
    await waitFor(() => expect(screen.queryByText(TASK_COPY.empty)).toBeNull());
    for (const h of screen.getAllByRole("heading")) expect(h.textContent).not.toMatch(/\d/);
  });

  it("draws a proposal from outside the village: an adopt row for a decider, a consent row under Asked to consent, each opening its page", async () => {
    const openProposals = [
      { id: "op-0000000000000000000a", href: "/open-proposals/op-0000000000000000000a", roles: ["Gate keeper"], circles: ["Land circle"], proposer: "Rowan", ask: "adopt", closesOn: null, confirmedOn: "2026-11-01" },
      { id: "op-0000000000000000000b", href: "/open-proposals/op-0000000000000000000b", roles: ["Well keeper"], circles: ["Land circle"], proposer: "Sol", ask: "consent", closesOn: "2026-11-04", confirmedOn: "2026-11-02" },
    ];
    waitingMock.mockImplementation(async () => reply(200, { applications: [], drafts: [], openProposals }));
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    const group = await screen.findByRole("region", { name: WAITING_COPY.heading });
    const decide = within(group).getByText("Rowan proposes to hold Gate keeper next season").closest("a");
    expect(decide?.getAttribute("href")).toBe("/open-proposals/op-0000000000000000000a");
    expect(within(group).getByText(`${WAITING_COPY.openFrom} · In Land circle`)).toBeInTheDocument();
    expect(within(group).getByText(WAITING_COPY.openAction)).toBeInTheDocument();
    const asks = within(group).getByRole("list", { name: WAITING_COPY.consentHeading });
    const consent = within(asks).getByText("Sol proposes to hold Well keeper next season").closest("a");
    expect(consent?.getAttribute("href")).toBe("/open-proposals/op-0000000000000000000b");
    expect(within(asks).getByText("In Land circle · Closes on 4 November 2026")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(TASK_COPY.empty)).toBeNull());
  });

  it("reads a server from before the consent group as no asks", async () => {
    waitingMock.mockImplementation(async () => reply(200, { applications: WAITING.applications, drafts: [] }));
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    await screen.findByRole("region", { name: WAITING_COPY.heading });
    expect(screen.queryByRole("heading", { name: WAITING_COPY.consentHeading })).toBeNull();
  });

  it("draws nothing when the read is closed, and the empty board still says so", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    expect(await screen.findByText(TASK_COPY.empty)).toBeInTheDocument();
    await waitFor(() => expect(waitingMock).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: WAITING_COPY.heading })).toBeNull();
  });

  it("is not called empty while a decision waits", async () => {
    waitingMock.mockImplementation(async () => reply(200, { applications: WAITING.applications, drafts: [] }));
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    await screen.findByRole("region", { name: WAITING_COPY.heading });
    // The board and the waiting group load on their own, and the group tells
    // the board it drew something from an effect, one commit after its rows
    // appear. So for that one commit an empty board can still read "nothing
    // in your hands". Asserting at a single instant raced that commit: it went
    // red in CI on 2026-10-21 (push run of #516, shard 4) and again locally
    // whenever the waiting reply landed a few milliseconds after the board.
    // What the case promises is the settled board, so wait for the board to
    // load and then for the line to be gone; a board that kept the line fails.
    // The one-commit flash itself is gone since the waiting group reports only
    // once its read answers; the next case holds that read open to prove it.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("region", { name: TASK_COPY.heading })).toHaveAttribute("aria-busy", "false"));
    await waitFor(() => expect(screen.queryByText(TASK_COPY.empty)).toBeNull());
  });

  it("never says nothing is in your hands before the waiting read answers, even when the board answers first", async () => {
    let answer: (r: Response) => void = () => {};
    waitingMock.mockImplementation(() => new Promise<Response>((resolve) => { answer = resolve; }));
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // The board has its (empty) answer; the waiting read has not answered yet.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(TASK_COPY.empty)).toBeNull();
    answer(reply(200, { applications: WAITING.applications, drafts: [] }) as unknown as Response);
    await screen.findByRole("region", { name: WAITING_COPY.heading });
    expect(screen.queryByText(TASK_COPY.empty)).toBeNull();
  });

  it("says nothing is in your hands once both reads answer empty", async () => {
    waitingMock.mockImplementation(async () => reply(200, { applications: [], drafts: [] }));
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    expect(await screen.findByText(TASK_COPY.empty)).toBeInTheDocument();
  });

  it("says when it did not load, and tries again", async () => {
    waitingMock.mockResolvedValueOnce(reply(500, {})).mockResolvedValueOnce(reply(200, WAITING));
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    fireEvent.click(await screen.findByRole("button", { name: WAITING_COPY.retry }));
    expect(await screen.findByRole("region", { name: WAITING_COPY.heading })).toBeInTheDocument();
  });

  it("with Live Sessions off reads no tasks, and shows the board only while something waits", async () => {
    const { container, unmount } = render(<TaskBoard sessions={false} />);
    await waitFor(() => expect(waitingMock).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector("section")?.hidden).toBe(true);
    unmount();

    waitingMock.mockImplementation(async () => reply(200, WAITING));
    render(<TaskBoard sessions={false} />);
    expect(await screen.findByRole("region", { name: WAITING_COPY.heading })).toBeInTheDocument();
    expect(screen.getByText(WAITING_COPY.ledeAlone)).toBeInTheDocument();
    expect(screen.queryByText(TASK_COPY.empty)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
