// @vitest-environment jsdom
/**
 * The live room page over a stubbed server: its gates, the stage rail, the
 * facilitator's moves, the door in for someone not yet joined, a close the
 * server refuses, and the closed record with the admin's shareable minutes.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CLOSE_REFUSAL, ROOM_COPY, SESSION_COPY, SESSION_REFUSALS, STAGE_DEFS, defaultSessionState, type SessionView } from "@shared/sessions";
import { json, makeView, record, type Call } from "@/components/sessions/__tests__/roomFixture";

let signedIn: { id: string } | null = { id: "2" };
let sessionsOn = true;

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: signedIn }) }));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({
    loaded: true,
    modules: sessionsOn ? [{ id: "sessions", lifecycle: "members" }, { id: "gratitude", lifecycle: "public" }] : [],
  }),
  useModuleOn: (id: string) => id === "gratitude",
}));
vi.mock("@/components/modules/ModuleGate", () => ({
  default: () => <p>Module gate</p>,
  SignInToSee: () => <p>Sign in to see</p>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("wouter", async (importOriginal) => ({ ...(await importOriginal<typeof import("wouter")>()), useParams: () => ({ id: "7" }) }));

import SessionRoom from "./SessionRoom";

let calls: Call[];
let room: SessionView;
let answer: (c: Call) => Response | undefined;

beforeEach(() => {
  signedIn = { id: "2" };
  sessionsOn = true;
  calls = [];
  room = makeView();
  answer = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c = record(calls, url, init);
      const special = answer(c);
      if (special) return special;
      if (c.method === "GET" && c.url === "/api/sessions/7") return json(room);
      return json({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const posted = (path: string) => calls.filter((c) => c.method === "POST" && c.url === `/api/sessions/7${path}`);

describe("the gates", () => {
  it("shows the module gate when the module is off, and asks nothing", () => {
    sessionsOn = false;
    render(<SessionRoom />);
    expect(screen.getByText("Module gate")).toBeInTheDocument();
    expect(calls.length).toBe(0);
  });

  it("asks a signed-out visitor to sign in, and asks nothing", () => {
    signedIn = null;
    render(<SessionRoom />);
    expect(screen.getByText("Sign in to see")).toBeInTheDocument();
    expect(calls.length).toBe(0);
  });

  it("a closed record somebody was not in says who it is kept for", async () => {
    answer = (c) => (c.method === "GET" ? json({ error: "This record is kept for the people in it." }, 403) : undefined);
    render(<SessionRoom />);
    expect(await screen.findByText(SESSION_COPY.closedNoAccess)).toBeInTheDocument();
  });
});

describe("the open room", () => {
  it("shows the session, the place line, and the stage the room is on", async () => {
    render(<SessionRoom />);
    expect(await screen.findByRole("heading", { level: 1, name: "Water circle" })).toBeInTheDocument();
    expect(screen.getByText("We meet on the hill above the creek.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: STAGE_DEFS.dropin.title })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: ROOM_COPY.stagesLabel });
    expect(rail).toHaveTextContent(ROOM_COPY.liveBadge);
    // A member who is not facilitating sees no facilitator's bar.
    expect(screen.queryByText(ROOM_COPY.youFacilitate)).not.toBeInTheDocument();
  });

  it("anyone can look at another stage, and come back to the room", async () => {
    render(<SessionRoom />);
    await screen.findByRole("heading", { level: 1, name: "Water circle" });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${STAGE_DEFS.agenda.short}`) }));
    expect(screen.getByRole("heading", { level: 2, name: STAGE_DEFS.agenda.title })).toBeInTheDocument();
    expect(screen.getByText(ROOM_COPY.browsing(STAGE_DEFS.agenda.short, STAGE_DEFS.dropin.short))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROOM_COPY.moveHere })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.backToRoom }));
    expect(screen.getByRole("heading", { level: 2, name: STAGE_DEFS.dropin.title })).toBeInTheDocument();
    // Looking moved nobody.
    expect(posted("/act")).toHaveLength(0);
  });

  it("only the facilitator's choice moves the room", async () => {
    room = makeView({ me: { userId: 1, joined: true, facilitates: true, secretary: false, admin: false } });
    render(<SessionRoom />);
    await screen.findByText(ROOM_COPY.youFacilitate);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${STAGE_DEFS.arrival.short}`) }));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.moveHere }));
    await waitFor(() => expect(posted("/act")).toHaveLength(1));
    expect(posted("/act")[0]!.body).toEqual({ action: { type: "go", stage: "arrival" } });
  });

  it("the facilitator begins the session clock", async () => {
    room = makeView({ me: { userId: 1, joined: true, facilitates: true, secretary: false, admin: false } });
    render(<SessionRoom />);
    fireEvent.click(await screen.findByRole("button", { name: ROOM_COPY.beginSession }));
    await waitFor(() => expect(posted("/act")[0]?.body).toEqual({ action: { type: "start" } }));
  });

  it("offers the door to someone who has not joined, and joining posts it", async () => {
    room = makeView({ me: { userId: 4, joined: false, facilitates: false, secretary: false, admin: false } });
    render(<SessionRoom />);
    expect(await screen.findByText(ROOM_COPY.joinLede)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.joinButton }));
    await waitFor(() => expect(posted("/join")).toHaveLength(1));
  });

  it("a member gives their number on the arrival stage", async () => {
    room = makeView({ state: { ...defaultSessionState(), stage: "arrival" } });
    render(<SessionRoom />);
    await screen.findByRole("heading", { level: 2, name: STAGE_DEFS.arrival.title });
    fireEvent.click(screen.getByRole("radio", { name: "9" }));
    fireEvent.change(screen.getByPlaceholderText(SESSION_COPY.wishPlaceholder), { target: { value: "A walk" } });
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.changeNumber }));
    await waitFor(() => expect(posted("/arrival")).toHaveLength(1));
    expect(posted("/arrival")[0]!.body).toEqual({ score: 9, wish: "A walk" });
    expect(await screen.findByText(SESSION_COPY.arrivalSaved)).toBeInTheDocument();
  });

  it("names a tension from any stage, and it goes to the backlog", async () => {
    render(<SessionRoom />);
    fireEvent.click(await screen.findByRole("button", { name: SESSION_COPY.addTension }));
    fireEvent.change(screen.getByPlaceholderText(ROOM_COPY.tensionPlaceholder), { target: { value: "The well pump is loud" } });
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.send }));
    await waitFor(() => expect(posted("/entries")).toHaveLength(1));
    expect(posted("/entries")[0]!.body).toEqual({ kind: "tension", text: "The well pump is loud", itemId: null });
  });
});

describe("closing", () => {
  const unownedAction = {
    id: 41,
    itemId: null,
    kind: "action" as const,
    text: "Order seed potatoes",
    status: "open" as const,
    authorUserId: 2,
    ownerUserId: null,
    ownerName: null,
    ownerSeatId: null,
    ownerSeatName: null,
    dueOn: null,
    createdAt: "2026-10-09T17:30:00.000Z",
  };

  it("a refused close says why and moves the room to the actions", async () => {
    room = makeView({
      state: { ...defaultSessionState(), stage: "close" },
      entries: [unownedAction],
      me: { userId: 1, joined: true, facilitates: true, secretary: false, admin: false },
    });
    answer = (c) => (c.url.endsWith("/close") ? json({ error: CLOSE_REFUSAL, unowned: [41] }, 409) : undefined);
    render(<SessionRoom />);
    fireEvent.click(await screen.findByRole("button", { name: SESSION_COPY.closeButton }));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.closeYes }));
    expect(await screen.findByText(CLOSE_REFUSAL)).toBeInTheDocument();
    await waitFor(() => expect(posted("/act").map((c) => c.body)).toContainEqual({ action: { type: "go", stage: "actions" } }));
  });

  it("the closed record shows numbers only, and an admin can read the shareable minutes", async () => {
    room = makeView({
      status: "closed",
      closedAt: "2026-10-09T18:10:00.000Z",
      arrival: { count: 3, median: 7, low: 4, high: 9 },
      people: makeView().people.map((p) => ({ ...p, arrival: null, wish: null })),
      items: [
        { id: 5, title: "Roof", aim: "decide", minutes: 15, position: 1, status: "done", presenterUserId: null, addedBy: 1, startedAt: null, endedAt: null, usedSeconds: 900, fromSessionId: null },
      ],
      entries: [
        { ...unownedAction, id: 50, itemId: 5, kind: "decision", text: "Fix the roof before the rains.", status: "done" },
        { ...unownedAction, id: 51, itemId: 5, kind: "action", text: "Call the roofer", ownerSeatId: "seat1", ownerSeatName: "Water steward" },
      ],
      me: { userId: 2, joined: true, facilitates: false, secretary: false, admin: true },
    });
    answer = (c) =>
      c.url === "/api/sessions/7/minutes.md?for=shareable" ? new Response("# Water circle\n\n- **Action:** Call the roofer, held by Water steward.\n", { status: 200 }) : undefined;
    render(<SessionRoom />);
    expect(await screen.findByText(SESSION_COPY.closeDone)).toBeInTheDocument();
    expect(screen.getByText(ROOM_COPY.arrivalNumbers({ count: 3, median: 7, low: 4, high: 9 }))).toBeInTheDocument();
    expect(screen.getByText("Fix the roof before the rains.")).toBeInTheDocument();
    expect(screen.getByText(/Water steward/)).toBeInTheDocument();
    // Nothing of the arrival words is on the record.
    expect(screen.queryByText("More sleep")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.showMinutes }));
    expect(await screen.findByText(/held by Water steward/, { selector: "pre" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SESSION_COPY.copyMinutes })).toBeInTheDocument();
    expect(screen.getByText(SESSION_COPY.shareableLede)).toBeInTheDocument();
  });

  it("the facilitator reads the feedback on the facilitation on the record, unsigned", async () => {
    room = makeView({
      status: "closed",
      closedAt: "2026-10-09T18:10:00.000Z",
      facilitation: [
        { value: "flowed", text: "Calm and clear." },
        { value: "mixed", text: null },
      ],
      me: { userId: 1, joined: true, facilitates: true, secretary: false, admin: false },
    });
    render(<SessionRoom />);
    expect(await screen.findByText(ROOM_COPY.facilitationHeading)).toBeInTheDocument();
    expect(screen.getByText("Calm and clear.")).toBeInTheDocument();
  });

  it("a member who is not an admin never sees the shareable minutes", async () => {
    room = makeView({ status: "closed", closedAt: "2026-10-09T18:10:00.000Z" });
    render(<SessionRoom />);
    await screen.findByText(SESSION_COPY.closeDone);
    expect(screen.queryByText(SESSION_COPY.shareableTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(ROOM_COPY.facilitationHeading)).not.toBeInTheDocument();
  });

  it("a missing room offers the way back to all sessions", async () => {
    answer = (c) => (c.method === "GET" ? json({ error: SESSION_REFUSALS.notFound }, 404) : undefined);
    render(<SessionRoom />);
    expect(await screen.findByText(ROOM_COPY.missing)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ROOM_COPY.allSessions })).toHaveAttribute("href", "/sessions");
  });
});
