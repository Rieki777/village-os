// @vitest-environment jsdom
/**
 * Raise a tension with a role (player role card, PR 5 of 7), in the browser:
 * the member's control says who can read it before a word is written, and
 * draws nothing for a reader who may not raise one; the holder's row in
 * Waiting on you takes, answers and brings to the circle, and never names who
 * raised it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { roleTensionsUrl, TENSION_COPY, tensionRespondUrl, type HeldTension } from "@shared/roleTensions";
import { WAITING_COPY, WAITING_URL } from "@shared/waitingOnYou";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));
let signedIn = true;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: signedIn ? { id: "u-ana" } : null }) }));

import RaiseTension from "@/components/roleTension/RaiseTension";
import WaitingOnYou from "@/components/profile/WaitingOnYou";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchMock = vi.fn();
beforeEach(() => {
  signedIn = true;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", (url: unknown, init?: unknown) => fetchMock(String(url), init));
});
afterEach(() => vi.unstubAllGlobals());

describe("the Raise a tension control", () => {
  it("says who can read it before the box, and sends the words to the role", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { mayRaise: true, open: 0, answered: 0, tensions: [] }))
      .mockResolvedValueOnce(reply(201, { tension: { id: "rt-0123456789abcdef" } }));
    render(<RaiseTension roleId="seat-water" roleName="Water keeper" />);
    fireEvent.click(await screen.findByRole("button", { name: `${TENSION_COPY.raise}: Water keeper` }));
    const privacy = screen.getByText(TENSION_COPY.privacy);
    const box = screen.getByLabelText(TENSION_COPY.label);
    // The privacy line comes before the box, and the box names it.
    expect(privacy.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.getAttribute("aria-describedby")).toContain(privacy.id);
    expect(box.getAttribute("maxlength")).toBe("600");
    fireEvent.change(box, { target: { value: "The rota leaves Sundays empty." } });
    fireEvent.click(screen.getByRole("button", { name: TENSION_COPY.send }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(roleTensionsUrl("seat-water"));
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ text: "The rota leaves Sundays empty." });
    await waitFor(() => expect(screen.queryByLabelText(TENSION_COPY.label)).toBeNull());
  });

  it("shows the server's refusal in place", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { mayRaise: true, open: 0, answered: 0, tensions: [] }))
      .mockResolvedValueOnce(reply(400, { error: "That looks like payment details. Leave card and account numbers out." }));
    render(<RaiseTension roleId="seat-water" roleName="Water keeper" />);
    fireEvent.click(await screen.findByRole("button", { name: `${TENSION_COPY.raise}: Water keeper` }));
    fireEvent.change(screen.getByLabelText(TENSION_COPY.label), { target: { value: "4111 1111 1111 1111" } });
    fireEvent.click(screen.getByRole("button", { name: TENSION_COPY.send }));
    expect(await screen.findByRole("alert")).toHaveTextContent("payment details");
  });

  it("draws nothing for a guest, and asks nothing for a visitor", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { mayRaise: false, open: 0, answered: 0, tensions: [] }));
    const { container } = render(<RaiseTension roleId="seat-water" roleName="Water keeper" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
    signedIn = false;
    fetchMock.mockReset();
    const second = render(<RaiseTension roleId="seat-water" roleName="Water keeper" />);
    expect(second.container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Raised with your roles, in Waiting on you", () => {
  const held = (over: Partial<HeldTension> = {}): HeldTension => ({
    id: "rt-0123456789abcdef",
    roleId: "seat-water",
    role: "Water keeper",
    circle: "Garden circle",
    text: "The rota leaves Sundays empty.",
    status: "open",
    raisedOn: "2026-10-16",
    overdue: true,
    ...over,
  });

  it("shows the words, the 2 business days line, and takes it in place", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === WAITING_URL) return reply(200, { applications: [], drafts: [], toAccept: [], raisedWithYou: [held()] });
      return reply(200, { tension: { id: "rt-0123456789abcdef", status: "taken" } });
    });
    render(<WaitingOnYou />);
    const heading = await screen.findByRole("heading", { name: TENSION_COPY.groupHeading });
    expect(screen.getByRole("heading", { name: WAITING_COPY.heading })).toBeInTheDocument();
    const row = heading.parentElement as HTMLElement;
    expect(within(row).getByText("The rota leaves Sundays empty.")).toBeInTheDocument();
    expect(within(row).getByText(TENSION_COPY.overdue)).toBeInTheDocument();
    expect(within(row).getByText(/Water keeper · Garden circle · Raised 16 October 2026/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: TENSION_COPY.take }));
    await waitFor(() => expect(within(row).queryByRole("button", { name: TENSION_COPY.take })).toBeNull());
    const call = fetchMock.mock.calls.find((c) => c[0] === tensionRespondUrl("rt-0123456789abcdef"))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ action: "take" });
    expect(within(row).getByText(TENSION_COPY.takenBy)).toBeInTheDocument();
  });

  it("warns before bringing it to the circle, sends the note, and the row leaves", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === WAITING_URL) return reply(200, { applications: [], drafts: [], raisedWithYou: [held({ status: "taken", overdue: false })] });
      return reply(200, { tension: { id: "rt-0123456789abcdef", status: "brought_to_circle" } });
    });
    render(<WaitingOnYou />);
    await screen.findByRole("heading", { name: TENSION_COPY.groupHeading });
    // Taken already: no Take it.
    expect(screen.queryByRole("button", { name: TENSION_COPY.take })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: TENSION_COPY.bring }));
    expect(screen.getByText(TENSION_COPY.bringWarning)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(TENSION_COPY.noteLabel), { target: { value: "For Thursday's call" } });
    fireEvent.click(screen.getByRole("button", { name: TENSION_COPY.confirmBring }));
    await waitFor(() => expect(screen.queryByText("The rota leaves Sundays empty.")).toBeNull());
    const call = fetchMock.mock.calls.find((c) => c[0] === tensionRespondUrl("rt-0123456789abcdef"))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ action: "bring_to_circle", note: "For Thursday's call" });
  });

  it("draws nothing for a server from before the group", async () => {
    fetchMock.mockResolvedValue(reply(200, { applications: [], drafts: [] }));
    const { container } = render(<WaitingOnYou />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
