// @vitest-environment jsdom
/**
 * The member's page about the village's email (the comms build spec 5.13).
 * What is pinned: a member reads journeys, words and dials with nothing on the
 * page that changes them; each "Propose a change" door goes where its item
 * can be proposed (an open dial to Game Mechanics, everything else filed); and
 * a page the server refuses says why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { MemberCommsView } from "@shared/comms/memberView";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "member-token" }));

import VillageEmail from "./VillageEmail";

const fetchMock = vi.fn();
const answer = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

const email = (templateKey: string, subject: string) => ({
  templateKey,
  label: "Confirmation",
  subject,
  preheader: "Saturday at 6:00 PM. Your seat is saved.",
  text: `Hi Ana,\n\n${subject}, and your seat is saved.`,
});

const VIEW: MemberCommsView = {
  journeys: [
    {
      key: "gathering.going",
      title: "Saying yes to a gathering",
      state: "on",
      stops: ["They withdrew"],
      steps: [
        { key: "confirm", label: "Confirmation", timing: "When they say yes", skipIf: [], email: email("gathering.confirm", "You're coming to Community supper") },
        { key: "day", label: "The day before", timing: "1 day before it starts", skipIf: ["They said yes less than 36 hours before"], email: null },
      ],
    },
  ],
  others: [{ title: "Letters", emails: [email("letters.confirm", "Confirm your letters from Sample Village")] }],
  dials: [
    { key: "comms.daily_cap", label: "Most automated emails one person receives per day", description: "Counts path emails.", value: "2", defaultValue: "2", unit: null, isDefault: true, door: "mechanics" },
    { key: "comms.retention_months", label: "How long the email record is kept", description: "A privacy window.", value: "12", defaultValue: "18", unit: "months", isDefault: false, door: "submission" },
  ],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("how the village emails", () => {
  it("shows every journey, its steps, timing and words, and the dials, with nothing that edits them", async () => {
    fetchMock.mockReturnValueOnce(answer(VIEW));
    render(<VillageEmail />);
    expect(await screen.findByText("Saying yes to a gathering")).toBeInTheDocument();
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("When they say yes")).toBeInTheDocument();
    expect(screen.getByText(/Confirmation: You're coming to Community supper/)).toBeInTheDocument();
    expect(screen.getByText(/Waits or skips when: They said yes less than 36 hours before/)).toBeInTheDocument();
    expect(screen.getByText("This email's words didn't load.")).toBeInTheDocument();
    expect(screen.getByText("Most automated emails one person receives per day")).toBeInTheDocument();
    expect(screen.getByText(/default 18 months/)).toBeInTheDocument();
    // Read-only: nothing to type into, tick or choose until a door is opened.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    // It asks with the member's own token.
    expect(fetchMock.mock.calls[0][0]).toBe("/api/comms/village");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer member-token");
  });

  it("sends a dial the village votes on to the Game Mechanics page, with the dial named", async () => {
    fetchMock.mockReturnValueOnce(answer(VIEW));
    render(<VillageEmail />);
    const row = (await screen.findByText("Most automated emails one person receives per day")).closest("li")!;
    expect(within(row).getByRole("link", { name: "Propose a change" }).getAttribute("href")).toBe("/game-mechanics?dial=comms.daily_cap");
  });

  it("files a proposal about an email's words and says it was sent", async () => {
    fetchMock.mockReturnValueOnce(answer(VIEW)).mockReturnValueOnce(answer({ filed: true, id: "s1" }));
    render(<VillageEmail />);
    const user = userEvent.setup();
    await screen.findByText("Saying yes to a gathering");
    const letters = screen.getByText(/Confirmation: Confirm your letters from Sample Village/).closest("details")!;
    await user.click(within(letters).getByRole("button", { name: "Propose a change" }));
    await user.type(within(letters).getByRole("textbox"), "Say how often letters come.");
    await user.click(within(letters).getByRole("button", { name: "Send the proposal" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sent."));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/comms/village/propose");
    expect(JSON.parse(init.body)).toEqual({ target: "words", key: "letters.confirm", step: null, change: "Say how often letters come." });
  });

  it("files a founder-held dial through the same door and shows the server's refusal when there is one", async () => {
    fetchMock.mockReturnValueOnce(answer(VIEW)).mockReturnValueOnce(answer({ error: "That's a lot of proposals in an hour. Wait a little and try again." }, 429));
    render(<VillageEmail />);
    const user = userEvent.setup();
    const row = (await screen.findByText("How long the email record is kept")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Propose a change" }));
    await user.type(within(row).getByRole("textbox"), "Keep it for a year only.");
    await user.click(within(row).getByRole("button", { name: "Send the proposal" }));
    await waitFor(() => expect(within(row).getByRole("status")).toHaveTextContent("That's a lot of proposals"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ target: "dial", key: "comms.retention_months" });
  });

  it("says why when the village's email is not running", async () => {
    fetchMock.mockReturnValueOnce(answer({ error: "module_disabled" }, 404));
    render(<VillageEmail />);
    expect(await screen.findByText("The village's email isn't running yet.")).toBeInTheDocument();
  });
});
