// @vitest-environment jsdom
/**
 * A quest idea on /review says where it came from, and what the person
 * answered (Rye, 2026-09-14: people should be able to propose quests).
 *
 * The steward who accepts an idea types its reward, so the answers beneath
 * what the person wants to do are what that steward decides from: what they
 * bring, need, ask in return and by when, one line each. An idea from the
 * public form names the form, because its module id means nothing to a
 * steward. A machine's proposal keeps its module's name.
 *
 * Any read but the queue is refused, so this file stays about the card.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import Review from "./Review";

const ANSWERS = [
  "What they bring: Two afternoons and my own seeds",
  "What they need: Some jars and labels",
  "Timeline: Shelf up by the next moon",
].join("\n");

const card = (over: Record<string, unknown> = {}) => ({
  id: "qp-1",
  batchId: `${PROPOSE_QUEST_MODULE}:visitors`,
  moduleId: PROPOSE_QUEST_MODULE,
  prose: { title: "Build a seed library shelf", description: "Turn the old bookcase by the gate into a seed library." },
  rationale: ANSWERS,
  quote: null,
  sourceRef: "submission:sub-1",
  proposedByKind: "human",
  receivedAt: "2026-09-14T10:00:00.000Z",
  ...over,
});

function serve(quests: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).startsWith("/api/review/queue")
        ? {
            ok: true,
            status: 200,
            json: async () => ({ batches: [], quests, drops: [], counts: { proposals: 0, quests: quests.length } }),
          }
        : { ok: false, status: 403, json: async () => ({ error: "Not for this reader" }) },
    ),
  );
}

const renderReview = () =>
  render(
    <Router>
      <Review />
    </Router>,
  );

describe("a quest idea on /review says where it came from, and what the person answered", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
