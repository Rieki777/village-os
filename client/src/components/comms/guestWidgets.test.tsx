// @vitest-environment jsdom
/**
 * The guest door and the host's recap tools on a gathering's card (the comms
 * build spec 5.8 and 5.9).
 *
 * The states worth pinning are the ones a visitor or a host would misread:
 * a door offered where it can never open, a closed door with no reason, a
 * sent request that does not say what happens next, a host list that shows
 * anything but names, and host tools drawn for somebody who cannot use them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CalendarItem } from "@shared/gatherings";

let commsLifecycle: string | null = "public";
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: (id: string) => (id === "comms" && commsLifecycle ? { id, lifecycle: commsLifecycle } : undefined),
}));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "member-token" }));

import GuestRsvpForm, { mayOfferGuestDoor } from "./GuestRsvpForm";
import AttendanceList from "./AttendanceList";
import { hostToolsFor, recapLinkIn } from "./HostRecapPanel";

const fetchMock = vi.fn();
const answer = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

const gathering = (over: Partial<CalendarItem> = {}): CalendarItem =>
  ({
    id: "ev-1",
    title: "Seed swap",
    kind: "gathering",
    layer: "public",
    status: "scheduled",
    seatPrice: 0,
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    occurrenceKey: "",
    daysUntil: 1,
    ...over,
  }) as CalendarItem;

beforeEach(() => {
  commsLifecycle = "public";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("the guest door", () => {
  it("is offered only on a free, public, scheduled gathering that has not begun", () => {
    expect(mayOfferGuestDoor(gathering())).toBe(true);
    expect(mayOfferGuestDoor(gathering({ layer: "village" }))).toBe(false);
    expect(mayOfferGuestDoor(gathering({ seatPrice: 3 }))).toBe(false);
    expect(mayOfferGuestDoor(gathering({ status: "cancelled" }))).toBe(false);
    expect(mayOfferGuestDoor(gathering({ kind: "sky" }))).toBe(false);
    expect(mayOfferGuestDoor(gathering({ startsAt: new Date(Date.now() - 1000).toISOString() }))).toBe(false);
  });

  it("draws nothing while the village's email is not open to everyone", () => {
    commsLifecycle = "members";
    const { container } = render(<GuestRsvpForm gathering={gathering()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says why when the door is closed, in the server's words", async () => {
    fetchMock.mockReturnValueOnce(answer({ open: false, reason: "guests_off", message: "This one is for members. Ask a member to bring you.", occurrenceKey: "" }));
    render(<GuestRsvpForm gathering={gathering()} />);
    await userEvent.click(screen.getByRole("button", { name: "Come as a guest" }));
    expect(await screen.findByRole("status")).toHaveTextContent("This one is for members. Ask a member to bring you.");
    expect(screen.queryByLabelText("Your email")).toBeNull();
  });

  it("asks for a name and an email, sends the browser's zone, and says to check the email", async () => {
    fetchMock
      .mockReturnValueOnce(answer({ open: true, occurrenceKey: "" }))
      .mockReturnValueOnce(answer({ ok: true, message: "Check your email. Press the link inside to save your place. It works for two days." }));
    render(<GuestRsvpForm gathering={gathering()} />);
    await userEvent.click(screen.getByRole("button", { name: "Come as a guest" }));
    expect(await screen.findByText(/Your place is saved when you press it/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Your name"), "Gale Guest");
    await userEvent.type(screen.getByLabelText("Your email"), "gale@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Email me the link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Check your email.");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/events/ev-1/guest-rsvp");
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ name: "Gale Guest", email: "gale@example.test" });
    expect(typeof sent.timezone).toBe("string");
  });

  it("shows the server's refusal and keeps the form", async () => {
    fetchMock.mockReturnValueOnce(answer({ open: true, occurrenceKey: "" })).mockReturnValueOnce(answer({ error: "Too many tries. Wait a few minutes, then try again." }, 429));
    render(<GuestRsvpForm gathering={gathering()} />);
    await userEvent.click(screen.getByRole("button", { name: "Come as a guest" }));
    await userEvent.type(await screen.findByLabelText("Your name"), "Gale");
    await userEvent.type(screen.getByLabelText("Your email"), "gale@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Email me the link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries.");
    expect(screen.getByLabelText("Your email")).toBeInTheDocument();
  });
});

describe("the host's tools", () => {
  it("draw nothing for somebody without the power to use them", async () => {
    fetchMock.mockReturnValueOnce(answer({ manage: false }));
    const { container } = render(<AttendanceList eventId="ev-1" occurrenceKey="" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer member-token");
  });

  it("list names with guest beside a guest's, and never an address", async () => {
    fetchMock.mockReturnValueOnce(
      answer({
        manage: true,
        eventId: "ev-1",
        occurrenceKey: "",
        started: true,
        marked: false,
        people: [
          { personKey: "u-ana", name: "Ana Came", guest: false, answer: "going", mark: null },
          { personKey: "guest:ct_1", name: "Gale Guest", guest: true, answer: "going", mark: null },
          { personKey: "u-no", name: "Nora No", guest: false, answer: "declined", mark: null },
        ],
      }),
    );
    render(<AttendanceList eventId="ev-1" occurrenceKey="" />);
    expect(await screen.findByText("Gale Guest")).toBeInTheDocument();
    expect(screen.getByText("guest")).toBeInTheDocument();
    expect(screen.queryByText("Nora No"), "somebody who said no is not on the list of who came").toBeNull();
    expect(screen.getByRole("button", { name: "Everyone who said yes came" })).toBeInTheDocument();
  });

  it("open on a gathering that has begun, within the month, and from the nudge's link", () => {
    const now = Date.now();
    expect(hostToolsFor({ kind: "gathering", startsAt: new Date(now - 3_600_000).toISOString(), daysUntil: 0 }, now)).toBe(true);
    expect(hostToolsFor({ kind: "gathering", startsAt: new Date(now + 3_600_000).toISOString(), daysUntil: 0 }, now)).toBe(false);
    expect(hostToolsFor({ kind: "gathering", startsAt: new Date(now - 40 * 86_400_000).toISOString(), daysUntil: -40 }, now)).toBe(false);
    expect(hostToolsFor({ kind: "sky", startsAt: new Date(now - 3_600_000).toISOString(), daysUntil: 0 }, now)).toBe(false);
    expect(recapLinkIn("?recap=ev-1&occ=2026-10-05")).toEqual({ eventId: "ev-1", occurrenceKey: "2026-10-05" });
    expect(recapLinkIn("?recap=ev-1&occ=bad")).toEqual({ eventId: "ev-1", occurrenceKey: "" });
    expect(recapLinkIn("?tab=list")).toBeNull();
  });
});
