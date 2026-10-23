// @vitest-environment jsdom
/**
 * "Coming up" on /sessions: each circle's next meeting, and the start card it
 * gets ready.
 *
 * What each case holds: a row says when, how the circle meets and what waits;
 * only the circle's members and admins get the controls that change it; a
 * skip names that meeting and says what is next; a change opens on the next
 * meeting's date, so saving keeps the circle's week; stopping asks first;
 * setting a rhythm sends what the form shows, for circles that have none; a
 * notice's link lights its row when it is followed from the page itself; an
 * open room is offered instead of getting one ready; and "Get the room ready"
 * fills the start card with the meeting's title, circle, length and the
 * circle's waiting items, sending nothing until the person opens it.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SESSION_COPY, SESSION_LIST_COPY } from "@shared/sessions";
import { RHYTHM_COPY, type ComingUpPayload, type ComingUpRow } from "@shared/sessionRhythm";

const state = vi.hoisted(() => ({
  fetch: null as null | ((path: string, init?: RequestInit) => Promise<Response>),
  user: { id: "usr-ana", name: "Ana" },
}));
vi.mock("@/lib/gameApi", () => ({ gameFetch: (path: string, init?: RequestInit) => state.fetch!(path, init) }));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock("@/modules/ModuleProvider", () => ({ useModules: () => ({ loaded: true, failed: false, modules: [{ id: "sessions", lifecycle: "members" }] }) }));
vi.mock("@/components/modules/ModuleGate", () => ({ default: () => <p>Module gate</p>, SignInToSee: () => <p>Sign in to see</p> }));

import ComingUp from "./ComingUp";
import Sessions from "@/pages/Sessions";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Call = { path: string; method: string; body: unknown };
let calls: Call[];
let answers: Record<string, () => Response>;

beforeEach(() => {
  calls = [];
  answers = {};
  window.location.hash = "";
  state.fetch = async (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${method} ${path}`];
    return answer ? answer() : json({ row: null });
  };
});

const row = (over: Partial<ComingUpRow> = {}): ComingUpRow => ({
  circleId: "garden",
  circleName: "Garden",
  rhythmWords: "Every Thursday at 18:00",
  next: { at: "2026-10-29T18:00:00.000Z", endsAt: "2026-10-29T19:00:00.000Z", key: "2026-10-29" },
  words: "Thursday 29 October at 18:00",
  durationMin: 60,
  waiting: 2,
  openRoom: null,
  mine: true,
  canKeep: true,
  rhythm: { kind: "weekly", weekday: 4, everyWeeks: 1, time: "18:00", durationMin: 60 },
  ...over,
});
const payload = (rows: ComingUpRow[], keepCircleIds: string[] = ["garden"]): ComingUpPayload => ({ rows, zone: "UTC", keepCircleIds });
const circles = [
  { id: "garden", name: "Garden" },
  { id: "kitchen", name: "Kitchen" },
];

describe("coming up", () => {
  it("says when each circle meets, how it meets and what waits for it", () => {
    render(<ComingUp comingUp={payload([row()])} circles={circles} defaultMinutes={60} onGetReady={() => undefined} onChanged={() => undefined} />);
    const section = screen.getByRole("region", { name: RHYTHM_COPY.sectionTitle });
    expect(within(section).getByText("Thursday 29 October at 18:00")).toBeInTheDocument();
    expect(within(section).getByText(`Every Thursday at 18:00 · ${RHYTHM_COPY.waiting(2)}`)).toBeInTheDocument();
    expect(document.getElementById("coming-garden")).not.toBeNull();
  });

  it("gives the controls only to the circle's members and admins, and a skip names that meeting", async () => {
    const onChanged = vi.fn();
    const { rerender } = render(
      <ComingUp comingUp={payload([row({ canKeep: false, mine: false })], [])} circles={circles} defaultMinutes={60} onGetReady={() => undefined} onChanged={onChanged} />,
    );
    expect(screen.queryByRole("button", { name: RHYTHM_COPY.skip })).toBeNull();
    expect(screen.queryByRole("button", { name: RHYTHM_COPY.setRhythm })).toBeNull();
    rerender(<ComingUp comingUp={payload([row()])} circles={circles} defaultMinutes={60} onGetReady={() => undefined} onChanged={onChanged} />);
    answers["POST /api/sessions/circles/garden/rhythm/skip"] = () => json({ row: row({ words: "Thursday 5 November at 18:00" }) });
    const skip = screen.getByRole("button", { name: RHYTHM_COPY.skip });
    // The button is told apart from other rows' by its circle and its meeting.
    expect(skip).toHaveAccessibleDescription("Garden circle Thursday 29 October at 18:00");
    fireEvent.click(skip);
    await waitFor(() => expect(calls).toEqual([{ path: "/api/sessions/circles/garden/rhythm/skip", method: "POST", body: { key: "2026-10-29" } }]));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await screen.findByText("Skipped. The next Garden circle meeting is on Thursday 5 November at 18:00.")).toBeInTheDocument();
  });

  it("reads the list again when a skip is refused, so the row that moved is the one tried next", async () => {
    const onChanged = vi.fn();
    answers["POST /api/sessions/circles/garden/rhythm/skip"] = () => json({ error: "That meeting isn't one of this circle's next ones." }, 409);
    render(<ComingUp comingUp={payload([row()])} circles={circles} defaultMinutes={60} onGetReady={() => undefined} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.skip }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That meeting isn't one of this circle's next ones.");
    expect(onChanged).toHaveBeenCalled();
  });

  it("opens a change on the next meeting's date, so saving a new length keeps the circle's week", async () => {
    render(
      <ComingUp
        comingUp={payload([row({ rhythm: { kind: "weekly", weekday: 4, everyWeeks: 2, time: "18:00", startsOn: "2026-10-29", durationMin: 60 } })])}
        circles={circles}
        defaultMinutes={60}
        onGetReady={() => undefined}
        onChanged={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.change }));
    // The form names its circle, and its first field takes the focus.
    expect(screen.getByRole("form", { name: "Garden circle" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText(RHYTHM_COPY.howOftenLabel));
    expect((screen.getByLabelText(RHYTHM_COPY.startsOnLabel) as HTMLInputElement).value).toBe("2026-10-29");
    fireEvent.change(screen.getByLabelText(RHYTHM_COPY.durationLabel), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.save }));
    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: "/api/sessions/circles/garden/rhythm",
          method: "PUT",
          body: { kind: "weekly", weekday: 4, everyWeeks: 2, time: "18:00", startsOn: "2026-10-29", durationMin: 90 },
        },
      ]),
    );
  });

  it("asks once before stopping a circle's rhythm, and keeping it sends nothing", async () => {
    render(<ComingUp comingUp={payload([row()])} circles={circles} defaultMinutes={60} onGetReady={() => undefined} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.change }));
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.clear }));
    const ask = screen.getByRole("group", { name: RHYTHM_COPY.clear });
    expect(within(ask).getByText(RHYTHM_COPY.clearConfirm("Garden"))).toBeInTheDocument();
    fireEvent.click(within(ask).getByRole("button", { name: RHYTHM_COPY.keep }));
    expect(calls).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: RHYTHM_COPY.clear }));
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.clear }));
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.clearYes }));
    await waitFor(() => expect(calls).toEqual([{ path: "/api/sessions/circles/garden/rhythm", method: "PUT", body: { kind: "none" } }]));
    expect(await screen.findByText(RHYTHM_COPY.stopped("Garden"))).toBeInTheDocument();
  });

  it("offers a new rhythm only for the circles that have none", () => {
    render(<ComingUp comingUp={payload([row()], ["garden", "kitchen"])} circles={circles} defaultMinutes={60} onGetReady={() => undefined} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.setRhythm }));
    const select = screen.getByLabelText(RHYTHM_COPY.circleLabel) as HTMLSelectElement;
    expect(Array.from(select.options).filter((o) => !o.disabled).map((o) => o.value)).toEqual(["kitchen"]);
    expect(select.value).toBe("kitchen");
  });

  it("lights and focuses the row a notice's link names, when it is followed from the page itself", async () => {
    render(<ComingUp comingUp={payload([row()])} circles={circles} defaultMinutes={60} onGetReady={() => undefined} onChanged={() => undefined} />);
    const li = document.getElementById("coming-garden")!;
    expect(li.className).not.toMatch(/ring-2/);
    window.location.hash = "#coming-garden";
    window.dispatchEvent(new Event("pushState"));
    await waitFor(() => expect(document.activeElement).toBe(li));
    expect(li.className).toMatch(/ring-2/);
  });

  it("leaves a hash it cannot read alone", () => {
    window.location.hash = "#coming-%E0%A4%A";
    render(<ComingUp comingUp={payload([row()])} circles={circles} defaultMinutes={60} onGetReady={() => undefined} onChanged={() => undefined} />);
    expect(screen.getByRole("region", { name: RHYTHM_COPY.sectionTitle })).toBeInTheDocument();
  });

  it("sends the rhythm the form shows", async () => {
    render(<ComingUp comingUp={payload([], ["garden", "kitchen"])} circles={circles} defaultMinutes={60} onGetReady={() => undefined} onChanged={() => undefined} />);
    expect(screen.getByText(RHYTHM_COPY.empty)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.setRhythm }));
    fireEvent.change(screen.getByLabelText(RHYTHM_COPY.circleLabel), { target: { value: "kitchen" } });
    fireEvent.change(screen.getByLabelText(RHYTHM_COPY.howOftenLabel), { target: { value: "every2" } });
    fireEvent.change(screen.getByLabelText(RHYTHM_COPY.weekdayLabel), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(RHYTHM_COPY.timeLabel), { target: { value: "07:30" } });
    expect(screen.getByText(RHYTHM_COPY.zoneHint("UTC"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: RHYTHM_COPY.save }));
    await waitFor(() =>
      expect(calls).toEqual([
        { path: "/api/sessions/circles/kitchen/rhythm", method: "PUT", body: { kind: "weekly", weekday: 2, everyWeeks: 2, time: "07:30", durationMin: 60 } },
      ]),
    );
  });

  it("offers the room while the circle's room is open", () => {
    render(
      <ComingUp comingUp={payload([row({ openRoom: { id: 9, title: "Garden, week 3" } })])} circles={circles} defaultMinutes={60} onGetReady={() => undefined} onChanged={() => undefined} />,
    );
    expect(screen.getByRole("link", { name: `${RHYTHM_COPY.openNow}: ${SESSION_LIST_COPY.enterRoom}` })).toHaveAttribute("href", "/sessions/9");
    expect(screen.queryByRole("button", { name: RHYTHM_COPY.getReady })).toBeNull();
  });
});

describe("getting the room ready from the start card", () => {
  const brought = (id: number, title: string, circleId: string | null) => ({
    id,
    title,
    aim: null,
    note: null,
    circleId,
    circleName: circleId ? "Garden" : null,
    broughtBy: "Dee",
    mine: false,
    broughtAt: "2026-10-01T10:00:00.000Z",
    status: "waiting",
    session: null,
    settledAt: null,
    backAt: null,
    changedBy: null,
    canEdit: false,
    canMoveCircle: false,
    canWithdraw: false,
    canBringAgain: false,
  });

  it("fills the title, the circle, the length and the circle's waiting items, and sends nothing", async () => {
    answers["GET /api/sessions"] = () =>
      json({
        open: [],
        recent: [],
        circles,
        defaultMinutes: 60,
        library: { items: [brought(1, "Shed roof", "garden"), brought(2, "Picnic", null)], myCircleIds: ["garden"] },
        comingUp: payload([row({ durationMin: 45 })]),
      });
    const memory = memoryLocation({ path: "/sessions", record: true });
    render(
      <Router hook={memory.hook}>
        <Sessions />
      </Router>,
    );
    fireEvent.click(await screen.findByRole("button", { name: RHYTHM_COPY.getReady }));
    expect((screen.getByLabelText(SESSION_LIST_COPY.titleLabel) as HTMLTextAreaElement).value).toMatch(/^Garden circle, /);
    expect((screen.getByLabelText(SESSION_COPY.circleLabel) as HTMLSelectElement).value).toBe("garden");
    expect((screen.getByLabelText(SESSION_COPY.durationLabel) as HTMLInputElement).value).toBe("45");
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /Shed roof/ }) as HTMLInputElement).checked).toBe(true));
    // The item for no circle is offered, and left for the person to choose.
    expect((screen.getByRole("checkbox", { name: /Picnic/ }) as HTMLInputElement).checked).toBe(false);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});
