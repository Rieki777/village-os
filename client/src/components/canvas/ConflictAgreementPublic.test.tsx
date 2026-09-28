// @vitest-environment jsdom
/**
 * The conflict agreement's card on /governance, for a member: the safety
 * contacts, and the ombuds door, which records that the member asked and
 * shows how to reach the contact, and sends no words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";

let token: string | null = "a-token";
vi.mock("@/lib/gameApi", () => ({ authToken: () => token }));
vi.mock("@/contexts/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/contexts/AuthContext")>("@/contexts/AuthContext");
  return { ...actual, useIsAdmin: () => false, useAuth: () => ({ user: null }) };
});

import ConflictAgreementPublic from "./ConflictAgreementPublic";

const fetchMock = vi.fn();
const posts: Array<{ url: string; body: any }> = [];

const PUBLIC = {
  steps: [{ what: "We talk it out", whoInRoom: "the two of us" }],
  careRole: { id: "care", name: "Care Holder" },
  coverRole: null,
  replyHours: 24,
  outsideContacts: [{ id: "oc-1", label: "Ombuds at Cohort Care" }],
  whenPowerInvolved: { role: "", outsideContact: "", words: "" },
  consequencesLadder: { rungs: [], appeal: "" },
  practices: [],
  version: 1,
  adoptedHow: "founders",
  adoptedAt: "2026-09-20T10:00:00.000Z",
  reviewDate: "2027-01-15",
  withheld: false,
};

const MEMBERS = {
  stored: true,
  agreement: {
    steps: [{ what: "We talk it out", whoInRoom: "the two of us" }],
    careRole: "care",
    coverRole: "",
    replyHours: 24,
    outsideContacts: [{ id: "oc-1", name: "Ada Quill", organisation: "Cohort Care", role: "Ombuds", howToReach: "ada@example.invalid" }],
    whenPowerInvolved: { roleId: "", outsideContactId: "", words: "" },
    safetyContacts: [{ name: "Night crisis line", howToReach: "0800 000 000", when: "" }],
    consequencesLadder: { rungs: [], appeal: "" },
    practices: [],
    reviewDate: "2027-01-15",
    version: 1,
    adoptedHow: "founders",
    adoptedAt: "2026-09-20T10:00:00.000Z",
    updatedAt: null,
    ballotId: null,
  },
  roles: [{ id: "care", name: "Care Holder", liveHolders: 1 }],
  platformSteps: false,
  pen: { how: "founders", mayWrite: false, mayPropose: false },
  openBallot: null,
  yourAsks: [],
};

function serve(members: unknown | null) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          recorded: { id: "oa-1", contactId: "oc-1", contactLabel: "Ombuds at Cohort Care", askedAt: "2026-09-28T10:00:00.000Z" },
          contact: MEMBERS.agreement.outsideContacts[0],
        }),
      };
    }
    if (url === "/api/conflict-agreement/public") return { ok: true, status: 200, json: async () => ({ stored: true, agreement: PUBLIC }) };
    if (url === "/api/conflict-agreement") {
      return members ? { ok: true, status: 200, json: async () => members } : { ok: false, status: 403, json: async () => ({ error: "members only" }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

const renderCard = () =>
  render(
    <Router>
      <ConflictAgreementPublic />
    </Router>,
  );

beforeEach(() => {
  token = "a-token";
  fetchMock.mockReset();
  posts.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("ConflictAgreementPublic", () => {
  it("shows a visitor the roles and nobody's name or contact, and asks nothing of the members' door", async () => {
    token = null;
    serve(MEMBERS);
    renderCard();
    expect(await screen.findByText("We talk it out")).toBeTruthy();
    expect(screen.getByText(/Ombuds at Cohort Care/)).toBeTruthy();
    expect(screen.queryByText(/Ada Quill/)).toBeNull();
    expect(screen.queryByText(/Night crisis line/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/conflict-agreement", expect.anything());
  });

  it("shows a member the safety contacts and the ombuds door", async () => {
    serve(MEMBERS);
    renderCard();
    expect(await screen.findByText(/Night crisis line/)).toBeTruthy();
    expect(screen.getByText(/No words go anywhere, and nobody is sent a notice/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask to talk" })).toBeTruthy();
  });

  it("the door sends the contact's id and nothing else, then shows how to reach them", async () => {
    serve(MEMBERS);
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Ask to talk" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/conflict-agreement/ombuds-asks", body: { contactId: "oc-1" } });
    expect((await screen.findByText(/Reach Ada Quill here/)).textContent).toContain("ada@example.invalid");
    expect(screen.getByText(/nothing was sent/)).toBeTruthy();
  });

  it("an account the server does not count as a member sees only the public card", async () => {
    serve(null);
    renderCard();
    expect(await screen.findByText("We talk it out")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/conflict-agreement", expect.anything()));
    expect(screen.queryByRole("button", { name: "Ask to talk" })).toBeNull();
  });
});
