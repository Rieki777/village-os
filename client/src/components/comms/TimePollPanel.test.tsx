// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let token: string | null = null;
vi.mock("@/lib/gameApi", () => ({ authToken: () => token }));

import TimePollPanel from "@/components/comms/TimePollPanel";
import type { CalendarItem } from "@shared/gatherings";
import type { PollView } from "@shared/comms/timePoll";

/**
 * The time vote on a gathering's card (the comms build spec 5.10): one line
 * while closed, the tally when opened, names only when the server sent them,
 * and a tick that saves the person's picks and asks the calendar to reload,
 * because the gathering's own time follows the vote.
 */

const item = (over: Partial<CalendarItem> = {}): CalendarItem =>
  ({
    id: "ev-1",
    title: "Soup night",
    occurrenceKey: "",
    timePoll: { state: "open", mode: "once", closesAt: "2030-01-08T18:00:00.000Z", leadingLabel: "Tuesday, January 8 at 6:00 PM", stillVoting: true },
    ...over,
  }) as CalendarItem;

const view = (over: Partial<PollView> = {}): PollView => ({
  id: "tp-1",
  eventId: "ev-1",
  mode: "once",
  state: "open",
  closesAt: "2030-01-08T18:00:00.000Z",
  closesAtSet: false,
  settleMinutes: 0,
  freezeHours: 48,
  showNames: true,
  lockedAt: null,
  options: [
    { id: "a", label: "Tuesday, January 8 at 6:00 PM", startsAt: null, weekday: null, startMinute: null, durationMinutes: 60, count: 2, leading: true, applied: true, pinned: false },
    { id: "b", label: "Wednesday, January 9 at 6:00 PM", startsAt: null, weekday: null, startMinute: null, durationMinutes: 60, count: 1, leading: false, applied: false, pinned: false },
  ],
  voters: 3,
  leadingLabel: "Tuesday, January 8 at 6:00 PM",
  appliedLabel: "Tuesday, January 8 at 6:00 PM",
  mine: null,
  canVote: false,
  canManage: false,
  namesShown: false,
  ...over,
});

type Call = { url: string; method: string; body: any };
let calls: Call[] = [];
let answer: () => PollView;

beforeEach(() => {
  calls = [];
  token = null;
  answer = () => view();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ poll: answer() }), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TimePollPanel", () => {
  it("says the time is still being voted and what leads, and asks nothing until opened", () => {
    render(<TimePollPanel item={item()} />);
    expect(screen.getByText("Time still being voted")).toBeTruthy();
    expect(screen.getByText(/Leading: Tuesday, January 8 at 6:00 PM/)).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("shows a signed-out reader counts and no names, and the way to vote", async () => {
    render(<TimePollPanel item={item()} />);
    await userEvent.click(screen.getByRole("button", { name: "Vote on the time" }));
    await waitFor(() => expect(screen.getByText(/2 can come · leading/)).toBeTruthy());
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText("Sign in to vote.")).toBeTruthy();
    expect(calls[0]).toMatchObject({ url: "/api/events/ev-1/time-poll", method: "GET" });
  });

  it("lets a member tick a time, saves every pick at once, and reloads the calendar", async () => {
    token = "member-token";
    answer = () => view({ mine: ["a"], canVote: true, namesShown: true, options: view().options.map((o) => ({ ...o, names: o.id === "a" ? ["Sam", "Ana (guest)"] : ["Kai"] })) });
    const onChanged = vi.fn();
    render(<TimePollPanel item={item()} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: "Vote on the time" }));
    await waitFor(() => expect(screen.getByText("Sam, Ana (guest)")).toBeTruthy());
    await userEvent.click(screen.getByRole("checkbox", { name: "I can make Wednesday, January 9 at 6:00 PM" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/events/ev-1/time-poll/vote");
    expect(put.body).toEqual({ optionIds: ["a", "b"] });
  });

  it("names an evening inside a weekly freeze as set, and a locked vote as set", () => {
    const { rerender } = render(
      <TimePollPanel item={item({ timePoll: { state: "open", mode: "weekly", closesAt: null, leadingLabel: "Tuesdays at 6:00 PM", stillVoting: false } })} />,
    );
    expect(screen.getByText("Time set for this evening")).toBeTruthy();
    rerender(<TimePollPanel item={item({ timePoll: { state: "locked", mode: "once", closesAt: null, leadingLabel: null, stillVoting: false } })} />);
    expect(screen.getByText("Time set")).toBeTruthy();
    expect(screen.getByRole("button", { name: "See the vote" })).toBeTruthy();
  });
});
