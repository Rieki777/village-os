// @vitest-environment jsdom
/**
 * The front door to a circle's calls, at /sessions.
 *
 * What each case holds: the page lists what the list door answers; opening a
 * room or joining one moves into it ONLY after the server said yes, and a
 * refusal shows the server's own sentence where it happened; a title that
 * cleans to nothing never leaves the page; and a visitor who is signed out,
 * or a village with the module off, gets the gate card and no request at all.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SESSION_COPY, SESSION_DISCARD_COPY, SESSION_LIST_COPY, SESSION_REFUSALS, type SessionListRow } from "@shared/sessions";
import { LIBRARY_REFUSALS } from "@shared/sessionLibrary";
import { clearRoomGone, leaveRoomGone, peekRoomGone } from "@/components/sessions/roomGone";

const state = vi.hoisted(() => ({
  user: { id: "usr-wren", name: "Wren" } as null | { id: string; name: string },
  modules: [{ id: "sessions", lifecycle: "members" }] as { id: string; lifecycle: string }[],
  fetch: null as null | ((path: string, init?: RequestInit) => Promise<Response>),
}));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: state.user, loading: false }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, failed: false, modules: state.modules }),
}));
vi.mock("@/components/modules/ModuleGate", () => ({
  default: () => <p>Module gate</p>,
  SignInToSee: () => <p>Sign in to see</p>,
}));
vi.mock("@/lib/gameApi", () => ({
  gameFetch: (path: string, init?: RequestInit) => state.fetch!(path, init),
}));

import Sessions from "./Sessions";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const row = (over: Partial<SessionListRow>): SessionListRow => ({
  id: 1,
  title: "A session",
  circleId: null,
  circleName: null,
  status: "open",
  createdAt: "2026-10-09T15:00:00.000Z",
  closedAt: null,
  facilitatorName: "Fen",
  peopleCount: 3,
  joined: false,
  ...over,
});

const LIST = {
  open: [
    row({ id: 7, title: "Garden circle", circleId: "garden", circleName: "Garden", joined: false }),
    row({ id: 8, title: "Kitchen circle", joined: true }),
  ],
  recent: [row({ id: 3, title: "Water circle", status: "closed", closedAt: "2026-10-02T17:00:00.000Z", joined: true })],
  circles: [
    { id: "garden", name: "Garden" },
    { id: "kitchen", name: "Kitchen" },
  ],
};

type Call = { path: string; method: string; body: unknown };
let calls: Call[];
let answers: Record<string, () => Response>;

beforeEach(() => {
  clearRoomGone();
  state.user = { id: "usr-wren", name: "Wren" };
  state.modules = [{ id: "sessions", lifecycle: "members" }];
  calls = [];
  answers = {
    "GET /api/sessions": () => json(LIST),
    // "Asking for advice" reads its own lists; a member who has asked nothing and been asked nothing.
    "GET /api/sessions/advice/requests": () => json({ askedOfMe: [], mine: [], circles: [], today: "2026-10-24" }),
  };
  state.fetch = async (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${method} ${path}`];
    return answer ? answer() : json({ error: "not_found" }, 404);
  };
});

function renderPage() {
  const memory = memoryLocation({ path: "/sessions", record: true });
  render(
    <Router hook={memory.hook}>
      <Sessions />
    </Router>,
  );
  return memory;
}

const writes = () => calls.filter((c) => c.method !== "GET");

describe("the sessions list", () => {
  it("shows the rooms open now, the records this member can read, and the circles to choose from", async () => {
    renderPage();
    const open = await screen.findByRole("region", { name: SESSION_COPY.openNow });
    expect(within(open).getByRole("link", { name: "Garden circle" })).toHaveAttribute("href", "/sessions/7");
    // The room this member is already in offers a real way back in, and the one they are not in offers the join.
    const enter = within(open).getByRole("link", { name: SESSION_LIST_COPY.enterRoom });
    expect(enter).toHaveAttribute("href", "/sessions/8");
    expect(enter.className).toContain("min-h-11");
    expect(within(open).queryByText(SESSION_COPY.joinedLabel)).toBeNull();
    expect(within(open).getAllByRole("button", { name: SESSION_COPY.joinButton })).toHaveLength(1);
    expect(within(open).getAllByRole("link", { name: SESSION_LIST_COPY.enterRoom })).toHaveLength(1);

    const recent = screen.getByRole("region", { name: SESSION_COPY.recent });
    expect(within(recent).getByRole("link", { name: "Water circle" })).toHaveAttribute("href", "/sessions/3");
    expect(within(recent).queryByRole("button")).toBeNull();

    const circle = screen.getByLabelText(SESSION_COPY.circleLabel) as HTMLSelectElement;
    expect(Array.from(circle.options).map((o) => o.textContent)).toEqual([SESSION_COPY.noCircle, "Garden", "Kitchen"]);
  });

  it("says plainly when no room is open and nothing has closed", async () => {
    answers["GET /api/sessions"] = () => json({ open: [], recent: [], circles: [] });
    renderPage();
    expect(await screen.findByText(SESSION_COPY.nothingOpen)).toBeTruthy();
    expect(screen.getByText(SESSION_LIST_COPY.recentEmpty)).toBeTruthy();
  });

  it("starts the length from the village's usual one when the list door sends it, and sends what it shows", async () => {
    answers["GET /api/sessions"] = () => json({ ...LIST, defaultMinutes: 45 });
    answers["POST /api/sessions"] = () => json({ id: 44 });
    renderPage();
    await screen.findByRole("region", { name: SESSION_COPY.openNow });
    await waitFor(() => expect((screen.getByLabelText(SESSION_COPY.durationLabel) as HTMLInputElement).value).toBe("45"));
    fireEvent.change(screen.getByLabelText(SESSION_LIST_COPY.titleLabel), { target: { value: "Open call" } });
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.startButton }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ title: "Open call", durationMin: 45 });
  });

  it("shows no number of its own when the list door sends no usual length", async () => {
    renderPage();
    await screen.findByRole("region", { name: SESSION_COPY.openNow });
    const field = screen.getByLabelText(SESSION_COPY.durationLabel) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.placeholder).toBe(SESSION_LIST_COPY.usualLength);
  });

  it("names the trouble and offers another try when the list does not load", async () => {
    answers["GET /api/sessions"] = () => json({ error: "boom" }, 500);
    renderPage();
    expect(await screen.findByText(SESSION_LIST_COPY.loadFailed)).toBeTruthy();
    answers["GET /api/sessions"] = () => json(LIST);
    fireEvent.click(screen.getByRole("button", { name: SESSION_LIST_COPY.retry }));
    expect(await screen.findByRole("link", { name: "Garden circle" })).toBeTruthy();
  });
});

describe("opening a room", () => {
  it("moves into the new room once the server has opened it", async () => {
    answers["POST /api/sessions"] = () => json({ id: 42 });
    const memory = renderPage();
    await screen.findByRole("region", { name: SESSION_COPY.openNow });

    fireEvent.change(screen.getByLabelText(SESSION_LIST_COPY.titleLabel), { target: { value: "  Seed library  " } });
    fireEvent.change(screen.getByLabelText(SESSION_COPY.circleLabel), { target: { value: "garden" } });
    fireEvent.change(screen.getByLabelText(SESSION_COPY.durationLabel), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.startButton }));

    await waitFor(() => expect(memory.history).toContain("/sessions/42"));
    expect(writes()).toEqual([{ path: "/api/sessions", method: "POST", body: { title: "Seed library", circleId: "garden", durationMin: 90 } }]);
  });

  it("leaves the circle out when none is chosen", async () => {
    answers["POST /api/sessions"] = () => json({ id: 43 });
    renderPage();
    await screen.findByRole("region", { name: SESSION_COPY.openNow });
    fireEvent.change(screen.getByLabelText(SESSION_LIST_COPY.titleLabel), { target: { value: "Open call" } });
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.startButton }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    // No length either: the field was left empty, so the server applies the
    // village's own usual length (sessions.default_minutes).
    expect(writes()[0].body).toEqual({ title: "Open call" });
  });

  it("shows the server's sentence and stays put when the room is refused", async () => {
    answers["POST /api/sessions"] = () => json({ error: SESSION_REFUSALS.circleUnknown }, 400);
    const memory = renderPage();
    await screen.findByRole("region", { name: SESSION_COPY.openNow });
    fireEvent.change(screen.getByLabelText(SESSION_LIST_COPY.titleLabel), { target: { value: "Seed library" } });
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.startButton }));

    expect(await screen.findByRole("alert")).toHaveTextContent(SESSION_REFUSALS.circleUnknown);
    expect(memory.history).toEqual(["/sessions"]);
  });

  it("never sends a title that is only spaces, or a length out of range", async () => {
    renderPage();
    await screen.findByRole("region", { name: SESSION_COPY.openNow });
    fireEvent.change(screen.getByLabelText(SESSION_LIST_COPY.titleLabel), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.startButton }));
    expect(await screen.findByRole("alert")).toHaveTextContent(SESSION_REFUSALS.titleNeeded);

    fireEvent.change(screen.getByLabelText(SESSION_LIST_COPY.titleLabel), { target: { value: "Seed library" } });
    fireEvent.change(screen.getByLabelText(SESSION_COPY.durationLabel), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.startButton }));
    expect(await screen.findByRole("alert")).toHaveTextContent(SESSION_REFUSALS.durationRange);
    expect(writes()).toEqual([]);
  });
});

describe("joining a room", () => {
  it("joins first, then moves into the room", async () => {
    answers["POST /api/sessions/7/join"] = () => json({ ok: true });
    const memory = renderPage();
    const open = await screen.findByRole("region", { name: SESSION_COPY.openNow });
    fireEvent.click(within(open).getByRole("button", { name: SESSION_COPY.joinButton }));

    await waitFor(() => expect(memory.history).toContain("/sessions/7"));
    expect(writes()).toEqual([{ path: "/api/sessions/7/join", method: "POST", body: {} }]);
  });

  it("keeps the member on the list with the server's sentence when the join is refused", async () => {
    answers["POST /api/sessions/7/join"] = () => json({ error: SESSION_REFUSALS.full }, 409);
    const memory = renderPage();
    const open = await screen.findByRole("region", { name: SESSION_COPY.openNow });
    fireEvent.click(within(open).getByRole("button", { name: SESSION_COPY.joinButton }));

    expect(await within(open).findByRole("alert")).toHaveTextContent(SESSION_REFUSALS.full);
    expect(memory.history).toEqual(["/sessions"]);
  });
});

describe("a room that went", () => {
  it("enter the room goes straight in, with no join asked of the server", async () => {
    const memory = renderPage();
    const open = await screen.findByRole("region", { name: SESSION_COPY.openNow });
    fireEvent.click(within(open).getByRole("link", { name: SESSION_LIST_COPY.enterRoom }));
    await waitFor(() => expect(memory.history).toContain("/sessions/8"));
    expect(writes()).toEqual([]);
  });

  it("says once that the session was discarded, and the list no longer shows it", async () => {
    leaveRoomGone(SESSION_DISCARD_COPY.discarded);
    // The server no longer has session 8.
    answers["GET /api/sessions"] = () => json({ ...LIST, open: LIST.open.filter((r) => r.id !== 8) });
    renderPage();
    expect(await screen.findByRole("status")).toHaveTextContent("This session was discarded.");
    const open = await screen.findByRole("region", { name: SESSION_COPY.openNow });
    expect(within(open).queryByRole("link", { name: "Kitchen circle" })).toBeNull();
    expect(peekRoomGone()).toBeNull();
    cleanup();
    // The next visit to the list has nothing to say.
    renderPage();
    await screen.findByRole("region", { name: SESSION_COPY.openNow });
    expect(screen.queryByText("This session was discarded.")).toBeNull();
  });
});

describe("the gates", () => {
  it("asks a signed-out visitor to sign in, and asks the server nothing", () => {
    state.user = null;
    renderPage();
    expect(screen.getByText("Sign in to see")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("shows the module card while the module is off, and asks the server nothing", () => {
    state.modules = [];
    renderPage();
    expect(screen.getByText("Module gate")).toBeTruthy();
    expect(calls).toEqual([]);
  });
});

describe("what members brought, on the start card", () => {
  const brought = (id: number, title: string, circleId: string | null, broughtAt = "2026-10-01T10:00:00.000Z") => ({
    id,
    title,
    aim: null,
    note: null,
    circleId,
    circleName: circleId === "garden" ? "Garden" : null,
    broughtBy: "Dee",
    mine: false,
    broughtAt,
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
  const WITH_LIBRARY = {
    ...LIST,
    defaultMinutes: 60,
    library: {
      items: [brought(21, "Shed roof", "garden", "2026-10-02T10:00:00.000Z"), brought(22, "Picnic", null), brought(23, "Seed order", "garden")],
      myCircleIds: ["garden"],
    },
  };

  it("offers the chosen circle's items, drops a tick that no longer fits, and opens the room with the rest in order", async () => {
    answers["GET /api/sessions"] = () => json(WITH_LIBRARY);
    answers["POST /api/sessions"] = () => json({ id: 45 });
    const memory = renderPage();
    await screen.findByRole("region", { name: SESSION_COPY.openNow });
    // No circle chosen yet: only the item for no circle is offered.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(SESSION_COPY.circleLabel), { target: { value: "garden" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    fireEvent.click(screen.getByRole("checkbox", { name: /Picnic/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Shed roof/ }));
    // A tick on a garden item goes when the circle changes away from the garden.
    fireEvent.click(screen.getByRole("checkbox", { name: /Seed order/ }));
    fireEvent.change(screen.getByLabelText(SESSION_COPY.circleLabel), { target: { value: "kitchen" } });
    fireEvent.change(screen.getByLabelText(SESSION_COPY.circleLabel), { target: { value: "garden" } });
    expect((screen.getByRole("checkbox", { name: /Seed order/ }) as HTMLInputElement).checked).toBe(false);
    // The kitchen dropped both garden ticks and kept the picnic's.
    expect((screen.getByRole("checkbox", { name: /Shed roof/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /Picnic/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Seed order/ }));
    fireEvent.change(screen.getByLabelText(SESSION_LIST_COPY.titleLabel), { target: { value: "Garden, week 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Open the room with 2 items" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    // The order the checklist shows: the garden's oldest first, then the one for no circle.
    expect(writes()[0].body).toEqual({ title: "Garden, week 2", circleId: "garden", durationMin: 60, libraryIds: [23, 22] });
    await waitFor(() => expect(memory.history).toContain("/sessions/45"));
  });

  it("reads the list again when an item went elsewhere a moment ago, and says so", async () => {
    answers["GET /api/sessions"] = () => json(WITH_LIBRARY);
    answers["POST /api/sessions"] = () =>
      json({ error: LIBRARY_REFUSALS.moved }, 409);
    renderPage();
    await screen.findByRole("region", { name: SESSION_COPY.openNow });
    fireEvent.click(screen.getByRole("checkbox", { name: /Picnic/ }));
    fireEvent.change(screen.getByLabelText(SESSION_LIST_COPY.titleLabel), { target: { value: "Open call" } });
    const reads = calls.filter((c) => c.method === "GET").length;
    fireEvent.click(screen.getByRole("button", { name: "Open the room with 1 item" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("went onto another agenda");
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(reads));
  });

  it("lists what waits between the rooms open now and the records", async () => {
    answers["GET /api/sessions"] = () => json(WITH_LIBRARY);
    renderPage();
    await screen.findByRole("region", { name: SESSION_COPY.openNow });
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"));
    expect(regions.indexOf("sessions-waiting-heading")).toBeGreaterThan(regions.indexOf("sessions-open-heading"));
    expect(regions.indexOf("sessions-waiting-heading")).toBeLessThan(regions.indexOf("sessions-recent-heading"));
  });
});
