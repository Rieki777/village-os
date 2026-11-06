// @vitest-environment jsdom
/**
 * A quest idea on /review says where it came from, what the person answered,
 * and goes on the board in the words the steward leaves it in (Rye, 2026-09-14:
 * people should be able to propose quests).
 *
 * The steward who accepts an idea types its reward, so the answers beneath
 * what the person wants to do are what that steward decides from: what they
 * bring, need, ask in return and by when, one line each. An idea from the
 * public form names the form, because its module id means nothing to a
 * steward. A machine's proposal keeps its module's name. The board is public
 * and only an email address is screened on the way, so the title and the
 * description can be changed before accepting, and accepting sends them.
 *
 * Any read but the queue and the accept is refused, so this file stays about the card.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { PROPOSE_QUEST_MODULE } from "@shared/questIdeas";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => "a-token",
  // The owed-postings panel names each token through useTokenNameMap, which
  // reads the village's own names from the game config (readiness, R-words).
  useGameConfig: () => ({ currency: { names: {} } }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import Review from "./Review";
import { forgetPayOptions } from "@/components/WorkValueEditor";

const ANSWERS = [
  "What they bring: Two afternoons and my own seeds",
  "What they need: Some jars and labels",
  "Timeline: Shelf up by the next moon",
].join("\n");

const card = (over: Record<string, unknown> = {}) => ({
  id: "qp-1",
  batchId: `${PROPOSE_QUEST_MODULE}:visitor:sub-1`,
  moduleId: PROPOSE_QUEST_MODULE,
  prose: { title: "Build a seed library shelf", description: "Ring Ada on 0412 555 010 and turn the old bookcase into a seed library." },
  rationale: ANSWERS,
  quote: null,
  sourceRef: "submission:sub-1",
  proposedByKind: "human",
  receivedAt: "2026-09-14T10:00:00.000Z",
  ...over,
});

function serve(quests: unknown[], drops: unknown[] = []) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (String(url).startsWith("/api/review/queue")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ batches: [], quests, drops, counts: { proposals: 0, quests: quests.length } }),
      };
    }
    // What a quest may pay in this village (0265): one token, with its ceiling and standard amount.
    if (String(url).startsWith("/api/quests/pay-options")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ currency: "CRC", quest: [{ token: "credits", name: "Village Credits", ceiling: 250, standard: 25, decimals: 2 }], role: [] }),
      };
    }
    if (String(url).startsWith("/api/review/quests/")) {
      return { ok: true, status: 200, json: async () => ({ success: true, questId: "q-new" }) };
    }
    return { ok: false, status: 403, json: async () => ({ error: "Not for this reader" }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const renderReview = () =>
  render(
    <Router>
      <Review />
    </Router>,
  );

describe("a quest idea on /review says where it came from, and what the person answered", () => {
  // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    // The editor keeps the pay options for the page; each case reads its own.
    forgetPayOptions();
  });

  it("names the form, and puts each answer on its own line beneath the idea", async () => {
    serve([card()]);
    renderReview();
    await waitFor(() => expect(screen.getByText("Build a seed library shelf")).toBeTruthy());
    expect(screen.getByText(/^Proposed through the Propose a Quest form,/)).toBeTruthy();
    const answers = screen.getByText(/What they bring: Two afternoons and my own seeds/);
    // The newlines are the lines, and the class is what keeps them on screen.
    expect(answers.textContent).toBe(ANSWERS);
    expect(answers.className).toContain("whitespace-pre-line");
  });

  it("keeps a machine's module name, and shows no answers it did not give", async () => {
    serve([card({ moduleId: "meeting-notes", rationale: null, sourceRef: null, proposedByKind: "agent" })]);
    renderReview();
    await waitFor(() => expect(screen.getByText("Build a seed library shelf")).toBeTruthy());
    expect(screen.getByText(/^Proposed by meeting-notes,/)).toBeTruthy();
    expect(screen.queryByText(/Propose a Quest form/)).toBeNull();
    expect(screen.queryByText(/What they bring/)).toBeNull();
  });

  it("opens the words on what arrived, and sends them as the steward leaves them", async () => {
    const fetchMock = serve([card()]);
    renderReview();
    await waitFor(() => expect(screen.getByText("Build a seed library shelf")).toBeTruthy());
    const title = screen.getByLabelText("Quest title") as HTMLInputElement;
    const asks = screen.getByLabelText("What the quest asks") as HTMLTextAreaElement;
    expect(title.value).toBe("Build a seed library shelf");
    expect(asks.value).toContain("0412 555 010");

    // The number a person typed comes out before anybody else can read it.
    fireEvent.change(asks, { target: { value: "Turn the old bookcase into a seed library." } });
    // A value in the village's currency, and the token boxes open on the standard amounts.
    await waitFor(() => expect((screen.getByLabelText("Village Credits") as HTMLInputElement).value).toBe("25"));
    fireEvent.change(screen.getByLabelText(/What it is worth/), { target: { value: "25000" } });
    fireEvent.click(screen.getByRole("button", { name: "Put it on the board" }));

    const accepted = () => fetchMock.mock.calls.find(([url]) => String(url) === "/api/review/quests/qp-1/accept");
    await waitFor(() => expect(accepted()).toBeTruthy());
    expect(JSON.parse(String(accepted()![1]?.body))).toEqual({
      // 0285: an empty cash box sends null, which stores no cash.
      reward: { cashMinor: null, valueMinor: 2500000, valueTokens: [{ token: "credits", amount: 25 }], stayCreditReward: null },
      edits: { title: "Build a seed library shelf", description: "Turn the old bookcase into a seed library." },
    });
  });

  it("sends the reason a steward typed with a rejection, which the proposer reads", async () => {
    // Rejecting always sent an empty note, so a no could never say why.
    const fetchMock = serve([card()]);
    renderReview();
    await waitFor(() => expect(screen.getByText("Build a seed library shelf")).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Why, if you reject it/), { target: { value: "  The shelf went up last moon.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    const rejected = () => fetchMock.mock.calls.find(([url]) => String(url) === "/api/review/quests/qp-1/reject");
    await waitFor(() => expect(rejected()).toBeTruthy());
    expect(JSON.parse(String(rejected()![1]?.body))).toEqual({ note: "The shelf went up last moon." });
  });
});

describe("the refusal count says what was kept", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says a held quest idea is kept in the admin inbox, and an outside service's refused record was not stored", async () => {
    // "None of it was stored" was printed under every line, and for a quest
    // idea it was false: the submission is stored, only the review copy is not.
    serve([], [
      { moduleId: PROPOSE_QUEST_MODULE, reason: "over_allowance", dropped: 2, lastAt: null },
      { moduleId: "saberra", reason: "contained_an_email", dropped: 1, lastAt: null },
    ]);
    renderReview();
    const idea = await screen.findByText(/^2 from the Propose a Quest form were held back/);
    expect(idea.textContent).toContain("Each one is kept as a submission in the admin inbox, under Form Submissions.");
    expect(idea.textContent).not.toContain("None of it was stored");
    const vendor = screen.getByText(/^1 from saberra carried an email address/);
    expect(vendor.textContent).toContain("None of it was stored.");
  });
});
