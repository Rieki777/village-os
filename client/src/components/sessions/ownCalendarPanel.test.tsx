// @vitest-environment jsdom
/**
 * A circle's own calendar on /sessions.
 *
 * What each case holds: nobody who keeps no circle sees the panel; an attached
 * calendar is named by where it points and its last four characters, never
 * its address, with how its last read went, and detaches after one confirm;
 * attaching sends the address the form holds, says when the first read did
 * not work, and offers "a different calendar" for a circle that has one; while
 * the village cannot seal an address the panel says to ask an admin; and a
 * Coming up row whose meeting comes from the circle's own calendar shows that
 * meeting's title, skips only the rhythm's own meeting, and offers to set a
 * rhythm where there is none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OWN_CALENDAR_COPY, type OwnCalendarView } from "@shared/sessionCalendar";
import { RHYTHM_COPY, type ComingUpRow } from "@shared/sessionRhythm";

const state = vi.hoisted(() => ({
  fetch: null as null | ((path: string, init?: RequestInit) => Promise<Response>),
}));
vi.mock("@/lib/gameApi", () => ({ gameFetch: (path: string, init?: RequestInit) => state.fetch!(path, init) }));

import OwnCalendarPanel from "./OwnCalendarPanel";
import ComingUp from "./ComingUp";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Call = { path: string; method: string; body: unknown };
let calls: Call[];
let answers: Record<string, () => Response>;

beforeEach(() => {
  calls = [];
  answers = {};
  state.fetch = async (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${method} ${path}`];
    return answer ? answer() : json({ error: "no answer" }, 500);
  };
});

const circles = [
  { id: "garden", name: "Garden" },
  { id: "kitchen", name: "Kitchen" },
];
const view = (over: Partial<OwnCalendarView> = {}): OwnCalendarView => ({ host: "calendar.google.com", last4: ".ics", lastReadAt: "2026-10-20T10:00:00.000Z", status: "ok", ...over });

describe("a circle's own calendar", () => {
  it("is not there for someone who keeps no circle", () => {
    const { container } = render(<OwnCalendarPanel circles={[]} ownCalendars={{}} available onChanged={() => undefined} onSaid={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names an attached calendar without its address, says how its last read went, and detaches it", async () => {
    answers["DELETE /api/sessions/circles/garden/calendar"] = () => json({ row: null });
    const onChanged = vi.fn();
    const onSaid = vi.fn();
    render(<OwnCalendarPanel circles={circles} ownCalendars={{ garden: view({ status: "failed" }) }} available onChanged={onChanged} onSaid={onSaid} />);
    expect(screen.getByText(OWN_CALENDAR_COPY.attachedLine("Garden", "calendar.google.com", ".ics"))).toBeInTheDocument();
    expect(screen.getByText(OWN_CALENDAR_COPY.readFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${OWN_CALENDAR_COPY.detach}`) }));
    // One confirm first: undoing it takes the secret address again.
    expect(screen.getByText(OWN_CALENDAR_COPY.detachConfirm("Garden"))).toBeInTheDocument();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: OWN_CALENDAR_COPY.detachYes }));
    await waitFor(() => expect(calls).toEqual([{ path: "/api/sessions/circles/garden/calendar", method: "DELETE", body: undefined }]));
    await waitFor(() => expect(onSaid).toHaveBeenCalledWith(OWN_CALENDAR_COPY.detached("Garden")));
    expect(onChanged).toHaveBeenCalled();
  });

  it("attaches the address the form holds, and says when the first read did not work", async () => {
    answers["PUT /api/sessions/circles/kitchen/calendar"] = () => json({ ownCalendar: view(), read: false, row: null });
    const onSaid = vi.fn();
    render(<OwnCalendarPanel circles={circles} ownCalendars={{ garden: view() }} available onChanged={() => undefined} onSaid={onSaid} />);
    fireEvent.click(screen.getByRole("button", { name: OWN_CALENDAR_COPY.open }));
    fireEvent.change(screen.getByLabelText(OWN_CALENDAR_COPY.circleLabel), { target: { value: "garden" } });
    expect(screen.getByRole("button", { name: OWN_CALENDAR_COPY.replace })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(OWN_CALENDAR_COPY.circleLabel), { target: { value: "kitchen" } });
    const box = screen.getByLabelText(OWN_CALENDAR_COPY.urlLabel) as HTMLInputElement;
    expect(box.type).toBe("password");
    fireEvent.change(box, { target: { value: "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics" } });
    fireEvent.click(screen.getByRole("button", { name: OWN_CALENDAR_COPY.attach }));
    await waitFor(() =>
      expect(calls).toEqual([
        { path: "/api/sessions/circles/kitchen/calendar", method: "PUT", body: { url: "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics" } },
      ]),
    );
    await waitFor(() => expect(onSaid).toHaveBeenCalledWith(OWN_CALENDAR_COPY.attachedUnread("Kitchen")));
  });

  it("says a refusal in the server's words", async () => {
    answers["PUT /api/sessions/circles/garden/calendar"] = () => json({ error: "Calendar addresses are https only" }, 400);
    render(<OwnCalendarPanel circles={circles.slice(0, 1)} ownCalendars={{}} available onChanged={() => undefined} onSaid={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: OWN_CALENDAR_COPY.open }));
    fireEvent.change(screen.getByLabelText(OWN_CALENDAR_COPY.urlLabel), { target: { value: "http://example.test/x.ics" } });
    fireEvent.click(screen.getByRole("button", { name: OWN_CALENDAR_COPY.attach }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Calendar addresses are https only");
  });

  it("says to ask an admin while the village cannot keep an address", () => {
    render(<OwnCalendarPanel circles={circles} ownCalendars={{}} available={false} onChanged={() => undefined} onSaid={() => undefined} />);
    expect(screen.getByText(OWN_CALENDAR_COPY.unavailable)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: OWN_CALENDAR_COPY.open })).toBeNull();
  });
});

describe("a meeting from a circle's own calendar under Coming up", () => {
  it("shows the meeting's own title and offers no skip", () => {
    const row: ComingUpRow = {
      circleId: "garden",
      circleName: "Garden",
      rhythmWords: OWN_CALENDAR_COPY.fromOwnCalendar,
      next: { at: "2026-10-29T17:00:00.000Z", endsAt: "2026-10-29T18:30:00.000Z", key: "2026-10-29" },
      nextFrom: "calendar",
      nextTitle: "Garden planning",
      rhythmNext: null,
      words: "Thursday 29 October at 17:00",
      durationMin: 90,
      waiting: 0,
      openRoom: null,
      mine: true,
      canKeep: true,
      rhythm: { kind: "none" },
    };
    render(
      <ComingUp
        comingUp={{ rows: [row], zone: "UTC", keepCircleIds: ["garden"], ownCalendars: { garden: view() }, ownCalendarsAvailable: true }}
        circles={circles}
        defaultMinutes={60}
        onGetReady={() => undefined}
        onChanged={() => undefined}
      />,
    );
    expect(screen.getByText("Garden planning")).toBeInTheDocument();
    expect(screen.getByText(`${OWN_CALENDAR_COPY.fromOwnCalendar} · ${RHYTHM_COPY.waiting(0)}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Skip/ })).toBeNull();
    // No rhythm to change: the row offers to set one, and the form has nothing to stop.
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.setRhythm }));
    expect(screen.queryByRole("button", { name: RHYTHM_COPY.clear })).toBeNull();
  });

  it("skips the rhythm's own meeting, by its day, while a meeting from the circle's calendar comes sooner", async () => {
    answers["POST /api/sessions/circles/garden/rhythm/skip"] = () => json({ row: null });
    const row: ComingUpRow = {
      circleId: "garden",
      circleName: "Garden",
      rhythmWords: "Every Friday at 09:00",
      next: { at: "2026-10-29T17:00:00.000Z", endsAt: "2026-10-29T18:00:00.000Z", key: "2026-10-29" },
      nextFrom: "calendar",
      nextTitle: "Garden planning",
      rhythmNext: { at: "2026-10-30T09:00:00.000Z", endsAt: "2026-10-30T10:00:00.000Z", key: "2026-10-30", words: "Friday 30 October at 09:00" },
      words: "Thursday 29 October at 17:00",
      durationMin: 60,
      waiting: 0,
      openRoom: null,
      mine: true,
      canKeep: true,
      rhythm: { kind: "weekly", weekday: 5, everyWeeks: 1, time: "09:00", startsOn: "2026-10-30", durationMin: 60 },
    };
    render(
      <ComingUp
        comingUp={{ rows: [row], zone: "UTC", keepCircleIds: ["garden"], ownCalendars: {}, ownCalendarsAvailable: true }}
        circles={circles}
        defaultMinutes={60}
        onGetReady={() => undefined}
        onChanged={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.skipRhythm("on Friday 30 October at 09:00") }));
    await waitFor(() => expect(calls).toEqual([{ path: "/api/sessions/circles/garden/rhythm/skip", method: "POST", body: { key: "2026-10-30" } }]));
  });
});
