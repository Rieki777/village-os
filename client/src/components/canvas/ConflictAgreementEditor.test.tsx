// @vitest-environment jsdom
/**
 * The conflict agreement editor: eight frames walked one at a time, pre-filled
 * from what the server hands it, refusing in the server's own words and
 * opening the frame a refusal names, and offering only the door the server
 * says is open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token" }));

import { ConflictAgreementEditor, PRACTICE_IDEAS, type AgreementPayload } from "./ConflictAgreementEditor";
import { AGREEMENT_FRAMES } from "@shared/conflictAgreement";

const fetchMock = vi.fn();
const sent: Array<{ url: string; method: string; body: any }> = [];

/** What GET /api/conflict-agreement answers for a village with only its old exit policy. */
function payload(over: Partial<AgreementPayload> = {}): AgreementPayload {
  return {
    stored: false,
    agreement: {
      steps: [{ what: "We talk first", whoInRoom: "" }],
      careRole: "care",
      coverRole: "",
      replyHours: null,
      outsideContacts: [],
      whenPowerInvolved: { roleId: "", outsideContactId: "", words: "" },
      safetyContacts: [],
      consequencesLadder: { rungs: [], appeal: "" },
      practices: [],
      reviewDate: null,
      version: 0,
      adoptedHow: null,
      adoptedAt: null,
      updatedAt: null,
      ballotId: null,
    },
    roles: [
      { id: "care", name: "Care Holder", liveHolders: 2 },
      { id: "cover", name: "Care Cover", liveHolders: 0 },
    ],
    platformSteps: false,
    pen: { how: "founders", mayWrite: true, mayPropose: false },
    openBallot: null,
    ...over,
  };
}

function serve(get: AgreementPayload, answer: { status: number; body: unknown } = { status: 200, body: { success: true, changed: true } }) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") sent.push({ url, method, body: JSON.parse(String(init?.body ?? "{}")) });
    const ok = method === "GET" ? true : answer.status < 400;
    return { ok, status: method === "GET" ? 200 : answer.status, json: async () => (method === "GET" ? get : answer.body) };
  });
}

const frameButton = (title: string) => within(screen.getByRole("navigation", { name: "Frames" })).getByRole("button", { name: title });

beforeEach(() => {
  fetchMock.mockReset();
  sent.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("ConflictAgreementEditor", () => {
  it("lists the eight frames by name, never a count, and opens on the steps pre-filled from the exit policy", async () => {
    serve(payload());
    render(<ConflictAgreementEditor />);
    expect(await screen.findByDisplayValue("We talk first")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Frames" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(AGREEMENT_FRAMES.map((f) => f.title));
    expect(frameButton("The steps").getAttribute("aria-current")).toBe("step");
    expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/conflict-agreement", { headers: expect.objectContaining({ Authorization: "Bearer a-token" }) });
  });

  it("shows how many people hold each role today in the care frame", async () => {
    serve(payload());
    render(<ConflictAgreementEditor />);
    await screen.findByDisplayValue("We talk first");
    fireEvent.click(frameButton("Who hears it first"));
    expect(screen.getByRole("option", { name: "Care Holder, held by 2 people today" })).toBeTruthy();
    expect(screen.getAllByRole("option", { name: "Care Cover, nobody holds it today" }).length).toBeGreaterThan(0);
  });

  it("offers practices one tap at a time and fills in none", async () => {
    serve(payload());
    render(<ConflictAgreementEditor />);
    await screen.findByDisplayValue("We talk first");
    fireEvent.click(frameButton("Practices"));
    expect(screen.queryByDisplayValue(PRACTICE_IDEAS[0].name)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: PRACTICE_IDEAS[0].name }));
    expect(screen.getByDisplayValue(PRACTICE_IDEAS[0].name)).toBeTruthy();
  });

  it("refuses an adoption with no reply time in the server's words, sends nothing, and opens the reply frame", async () => {
    serve(payload());
    render(<ConflictAgreementEditor />);
    await screen.findByDisplayValue("We talk first");
    fireEvent.change(screen.getByPlaceholderText(/the two of us and the care holder/), { target: { value: "the two of us" } });
    fireEvent.click(screen.getByRole("button", { name: "Adopt it" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Say within how many hours someone who reaches out hears back.");
    expect(frameButton("The reply time").getAttribute("aria-current")).toBe("step");
    expect(sent).toEqual([]);
  });

  it("saves a draft to the admin door and says what the server answered", async () => {
    serve(payload());
    render(<ConflictAgreementEditor />);
    await screen.findByDisplayValue("We talk first");
    fireEvent.click(screen.getByRole("button", { name: "Save as a draft" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: "/api/admin/conflict-agreement", method: "PUT", body: { adopt: false, agreement: { careRole: "care", replyHours: null } } });
    expect((await screen.findByRole("status")).textContent).toContain("Saved as a draft");
  });

  it("shows the server's refusal and opens the frame it names", async () => {
    serve(payload(), { status: 409, body: { error: "The Game has started, so a change to the conflict agreement goes to the village as a vote.", frame: "adoption" } });
    render(<ConflictAgreementEditor />);
    await screen.findByDisplayValue("We talk first");
    fireEvent.click(screen.getByRole("button", { name: "Save as a draft" }));
    expect((await screen.findByRole("alert")).textContent).toContain("goes to the village as a vote");
    expect(frameButton("Adoption and review").getAttribute("aria-current")).toBe("step");
    expect(screen.queryByText(/Saved as a draft/)).toBeNull();
  });

  it("after the Birthing offers a proposal.open holder the vote, and nobody the admin buttons", async () => {
    const whole = payload({
      pen: { how: "ballot", mayWrite: false, mayPropose: true },
      agreement: {
        ...payload().agreement,
        steps: [{ what: "We talk first", whoInRoom: "the two of us" }],
        replyHours: 48,
        reviewDate: "2031-01-01",
      },
    });
    serve(whole, { status: 200, body: { success: true, ballot: { id: "b-1", closesAt: "2026-10-05T00:00:00.000Z" } } });
    render(<ConflictAgreementEditor />);
    await screen.findByDisplayValue("We talk first");
    expect(screen.queryByRole("button", { name: /^(Adopt it|Adopt this new version|Save as a draft)$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Put this change to the village" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: "/api/governance/conflict-agreement-changes", method: "POST", body: { agreement: { replyHours: "48" } } });
    expect((await screen.findByRole("status")).textContent).toContain("The vote is open");
  });

  it("gives a member with no pen every frame to read and no button that writes", async () => {
    serve(payload({ pen: { how: "founders", mayWrite: false, mayPropose: false } }));
    render(<ConflictAgreementEditor />);
    await screen.findByDisplayValue("We talk first");
    expect(screen.queryByRole("button", { name: /^(Adopt it|Adopt this new version|Save as a draft|Put this change to the village)$/ })).toBeNull();
    expect(screen.getByText(/the founders write this agreement/)).toBeTruthy();
    expect((screen.getByDisplayValue("We talk first") as HTMLTextAreaElement).closest("fieldset")?.disabled).toBe(true);
  });
});
