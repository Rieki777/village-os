// @vitest-environment jsdom
/**
 * Discarding a session and deleting a record, in the room over a stubbed
 * server: who is offered the control and where, the confirm's own words and
 * where focus starts, that nothing leaves the room until the server said yes,
 * and that everybody (whoever pressed it, and the rest of the room on their
 * next poll) lands on the list with the sentence that says why.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ROOM_COPY, SESSION_DISCARD_COPY as C, SESSION_REFUSALS, type SessionView } from "@shared/sessions";
import { json, makeView, record, type Call } from "@/components/sessions/__tests__/roomFixture";
import { clearRoomGone, peekRoomGone } from "@/components/sessions/roomGone";
import { forgetDrafts } from "@/components/sessions/roomUi";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "2" } }) }));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "sessions", lifecycle: "members" }] }),
  useModuleOn: () => false,
  // The room's card invitation reads Gene Keys through useModule; off here, as every module but sessions.
  useModule: () => undefined,
}));
vi.mock("@/components/modules/ModuleGate", () => ({ default: () => <p>Module gate</p>, SignInToSee: () => <p>Sign in to see</p> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("wouter", async (importOriginal) => ({ ...(await importOriginal<typeof import("wouter")>()), useParams: () => ({ id: "7" }) }));

import SessionRoom from "./SessionRoom";

let calls: Call[];
let room: SessionView;
/** Once true, the room is gone from the server: every GET of it answers 404. */
let gone: boolean;
/** What the DELETE answers. */
let deleteAnswer: () => Response | Promise<Response>;

const FACILITATOR = { userId: 2, joined: true, facilitates: true, secretary: false, admin: false };
const MEMBER = { userId: 2, joined: true, facilitates: false, secretary: false, admin: false };
const ADMIN_OUTSIDE = { userId: 2, joined: false, facilitates: false, secretary: false, admin: true };
const ADMIN_IN = { userId: 2, joined: true, facilitates: false, secretary: false, admin: true };

beforeEach(() => {
  calls = [];
  room = makeView({ me: FACILITATOR, facilitatorUserId: 2 });
  gone = false;
  deleteAnswer = () => {
    gone = true;
    return json({ ok: true });
  };
  forgetDrafts();
  clearRoomGone();
  window.history.replaceState(null, "", "/sessions/7");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c = record(calls, url, init);
      if (c.method === "DELETE" && c.url === "/api/sessions/7") return deleteAnswer();
      if (c.method === "GET" && c.url === "/api/sessions/7") return gone ? json({ error: SESSION_REFUSALS.notFound }, 404) : json(room);
      return json({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const deletes = () => calls.filter((c) => c.method === "DELETE");
const discardControl = () => screen.queryByRole("button", { name: C.discardButton });

/** Open the room as its facilitator; the control is in plain view on the bar. */
async function openRoom() {
  render(<SessionRoom />);
  await screen.findByRole("button", { name: C.discardButton });
}

describe("who is offered the control, and where", () => {
  it("the facilitator sees it on the bar without opening anything, and never beside the forward button", async () => {
    render(<SessionRoom />);
    const forward = await screen.findByRole("button", { name: new RegExp(ROOM_COPY.beginSession) });
    const hosting = screen.getByRole("button", { name: ROOM_COPY.hostsTitle });
    const cues = screen.getByRole("button", { name: ROOM_COPY.showCues });
    // Both toggles are shut, and the control is already there.
    expect(hosting).toHaveAttribute("aria-expanded", "false");
    expect(cues).toHaveAttribute("aria-expanded", "false");
    const control = screen.getByRole("button", { name: C.discardButton });
    // It sits in the bar's own row with the two toggles, ahead of them.
    expect(control.parentElement).toBe(hosting.parentElement);
    expect(control.compareDocumentPosition(cues) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Not in the forward button's row.
    expect(forward.parentElement?.contains(control)).toBe(false);
    expect(control.parentElement?.contains(forward)).toBe(false);
    // Opening Hosting adds no second copy.
    fireEvent.click(hosting);
    expect(screen.getAllByRole("button", { name: C.discardButton })).toHaveLength(1);
  });

  it("a member who does not facilitate is never offered it", async () => {
    room = makeView({ me: MEMBER });
    render(<SessionRoom />);
    await screen.findByRole("heading", { level: 1, name: "Water circle" });
    expect(discardControl()).toBeNull();
  });

  it("an admin is offered it whether or not they joined", async () => {
    room = makeView({ me: ADMIN_OUTSIDE });
    const first = render(<SessionRoom />);
    expect(await screen.findByRole("button", { name: C.discardButton })).toBeInTheDocument();
    first.unmount();
    room = makeView({ me: ADMIN_IN });
    render(<SessionRoom />);
    expect(await screen.findByRole("button", { name: C.discardButton })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ROOM_COPY.takeOver })).toBeInTheDocument();
  });
});

describe("the confirm", () => {
  it("says what goes and for whom, starts on Keep it, and Keep it sends nothing", async () => {
    await openRoom();
    fireEvent.click(screen.getByRole("button", { name: C.discardButton }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: "Discard this session?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Everything in it is removed for everyone, and no record is kept. Use this for a session opened by mistake or as a test.",
    );
    const keep = within(dialog).getByRole("button", { name: "Keep it" });
    expect(within(dialog).getByRole("button", { name: "Discard" })).toBeInTheDocument();
    await waitFor(() => expect(keep).toHaveFocus());

    fireEvent.click(keep);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deletes()).toEqual([]);
    expect(window.location.pathname).toBe("/sessions/7");
    // Focus goes back to the control that opened it.
    await waitFor(() => expect(screen.getByRole("button", { name: C.discardButton })).toHaveFocus());
  });

  it("discards only on the server's yes, then lands on the list with the sentence", async () => {
    let release: () => void = () => undefined;
    const answered = new Promise<void>((r) => {
      release = r;
    });
    // Hold the DELETE open, so what the dialog says while it is out can be read.
    deleteAnswer = async () => {
      await answered;
      gone = true;
      return json({ ok: true });
    };
    await openRoom();
    fireEvent.click(screen.getByRole("button", { name: C.discardButton }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(await within(dialog).findByRole("button", { name: C.discarding })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Keep it" })).toBeDisabled();
    expect(window.location.pathname).toBe("/sessions/7");
    expect(peekRoomGone()).toBeNull();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(window.location.pathname).toBe("/sessions"));
    expect(deletes().map((c) => c.url)).toEqual(["/api/sessions/7"]);
    expect(peekRoomGone()).toBe("This session was discarded.");
  });

  it("a refusal keeps the room and the dialog, and says the server's sentence inside it", async () => {
    deleteAnswer = () => json({ error: SESSION_REFUSALS.discardNotYours }, 403);
    await openRoom();
    fireEvent.click(screen.getByRole("button", { name: C.discardButton }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(SESSION_REFUSALS.discardNotYours);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/sessions/7");
    expect(peekRoomGone()).toBeNull();
    // The room is still behind the dialog (hidden from the reader while the dialog is open).
    expect(screen.getByRole("heading", { level: 1, name: "Water circle", hidden: true })).toBeInTheDocument();
  });
});

describe("everybody else in the room", () => {
  it("finds the room gone on their next poll and lands on the list with the sentence", async () => {
    room = makeView({ me: MEMBER });
    render(<SessionRoom />);
    await screen.findByRole("heading", { level: 1, name: "Water circle" });
    gone = true;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(window.location.pathname).toBe("/sessions"));
    expect(peekRoomGone()).toBe("This session was discarded.");
  });

  it("a room that was never there is still the missing card, and nobody is moved", async () => {
    gone = true;
    render(<SessionRoom />);
    expect(await screen.findByText(ROOM_COPY.missing)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/sessions/7");
    expect(peekRoomGone()).toBeNull();
  });
});

describe("the closed record", () => {
  const closed = (me: SessionView["me"]) => makeView({ status: "closed", closedAt: "2026-10-09T18:10:00.000Z", me });

  it("an admin can delete it, after a confirm in its own words, and lands on the list", async () => {
    room = closed({ userId: 2, joined: true, facilitates: false, secretary: false, admin: true });
    render(<SessionRoom />);
    fireEvent.click(await screen.findByRole("button", { name: C.deleteButton }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: "Delete this record?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Its minutes, decisions and the tasks it left are removed for everyone. This cannot be undone.");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Keep it" })).toHaveFocus());
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(window.location.pathname).toBe("/sessions"));
    expect(deletes().map((c) => c.url)).toEqual(["/api/sessions/7"]);
    expect(peekRoomGone()).toBe(C.deleted);
  });

  it("its facilitator and its people are not offered it", async () => {
    room = closed({ userId: 2, joined: true, facilitates: true, secretary: false, admin: false });
    const first = render(<SessionRoom />);
    await screen.findByText(ROOM_COPY.signoff);
    expect(screen.queryByRole("button", { name: C.deleteButton })).toBeNull();
    expect(screen.queryByRole("button", { name: C.discardButton })).toBeNull();
    first.unmount();
    room = closed(MEMBER);
    render(<SessionRoom />);
    await screen.findByText(ROOM_COPY.signoff);
    expect(screen.queryByRole("button", { name: C.deleteButton })).toBeNull();
  });
});
