// @vitest-environment jsdom
/**
 * THE OUTSIDE SERVICE'S LIST, IN PLACE ON /review.
 *
 * components/review/SeraDifferences.test.tsx holds the section to its boards.
 * This file holds the page around it to three rules the section cannot see
 * from inside:
 *
 *   - Once the list holds the service's records, its old batch cards fold
 *     under "Earlier Sera arrivals, now listed above" with no accept, so the
 *     same records are never offered twice (spec US1.7; retiring them is R28,
 *     later). Every other module's batches keep their cards.
 *   - A member the queue refuses is still shown how many changes wait and who
 *     decides them (R38), where the page used to refuse whole.
 *   - "Nothing waiting" is never said while the list holds changes.
 *
 * `Layout` is a passthrough, as in Review.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token", useGameConfig: () => ({ currency: { names: {} } }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import Review from "./Review";
import { listed } from "@/test/seraDifferences";

type Answer = [status: number, body: unknown];

const EMPTY = { batches: [], quests: [], drops: [], counts: { proposals: 0, quests: 0 } };
const COUNT = { total: 2, lanes: { facts: 0, lowRisk: 0, decision: 2 }, conflicts: 0, checkFirst: 0, oursAhead: 0 };

const item = (id: string, batchId: string, moduleId: string) => ({
  id,
  batchId,
  moduleId,
  kind: "org.proposed",
  payload: { seats: [{ name: "Water Steward" }] },
  quote: null,
  sourceRef: null,
  sourceOccurredAt: null,
  evidence: "absent",
  audience: "steward",
  trustTier: "extracted_unreviewed",
  confidence: null,
  significance: null,
  subjectRef: null,
  receivedAt: "2026-11-05T10:00:00.000Z",
  correlationId: null,
});

const QUEUE = {
  ...EMPTY,
  counts: { proposals: 2, quests: 0 },
  batches: [
    { batchId: "sync-abc", moduleId: "saberra", receivedAt: "2026-11-05T10:00:00.000Z", items: [item("p1", "sync-abc", "saberra")] },
    { batchId: "v1", moduleId: "vendor", receivedAt: "2026-11-04T10:00:00.000Z", items: [item("p2", "v1", "vendor")] },
  ],
};

const LIST = {
  agent: "Sera",
  lastReadAt: "2026-11-06T14:05:00.000Z",
  lastReadWhole: true,
  reads: { circles: "whole", roles: "whole" },
  count: COUNT,
  differences: [listed({ subject: { name: "Water Steward" } }), listed({ kind: "roleRest", field: null, sera: "gone", ours: "live", subject: { name: "Dish Rota" } })],
};

function serve(r: { queue: Answer; claims?: Answer; count?: Answer; list?: Answer; guide?: Answer; powers?: Answer }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      const [status, body]: Answer = path.startsWith("/api/admin/quest-claims/owed")
        ? [200, []]
        : path.startsWith("/api/admin/quest-claims")
          ? (r.claims ?? [403, { error: "Consenting to finished work is for stewards" }])
          : path === "/api/saberra/differences/count"
            ? (r.count ?? [200, { ...COUNT, lastReadAt: LIST.lastReadAt, lastReadWhole: true }])
            : path === "/api/saberra/differences"
              ? (r.list ?? [200, LIST])
              : path === "/api/guide"
                ? (r.guide ?? [404, {}])
                : path === "/api/village/powers"
                  ? (r.powers ?? [404, {}])
                  : path === "/api/review/queue"
                    ? r.queue
                    : [404, {}];
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    }),
  );
}

const renderReview = () =>
  render(
    <Router>
      <Review />
    </Router>,
  );

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the service's old batches, once the list holds them", () => {
  it("fold under Earlier Sera arrivals with no accept, and every other module keeps its card", async () => {
    serve({ queue: [200, QUEUE] });
    renderReview();
    const summary = await screen.findByText("Earlier Sera arrivals, now listed above");
    const fold = summary.closest("details") as HTMLElement;
    expect(fold.hasAttribute("open")).toBe(false);
    expect(within(fold).queryByRole("button", { name: /Accept/ })).toBeNull();
    expect(within(fold).queryByRole("textbox")).toBeNull();
    expect(within(fold).getByRole("link", { name: "Review it as one structure change" }).getAttribute("href")).toBe("/review/structure/sync-abc");
    // Accept appears once in the whole page: the other module's own batch.
    expect(screen.getAllByRole("button", { name: /^Accept all/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Accept all 1, with my edits" })).toBeTruthy();
    // And the list's rows lead to the service's batch in the structure review.
    const decide = screen.getAllByRole("link", { name: "Decide it in the structure review" });
    expect(decide.length).toBe(2);
    expect(decide[0].getAttribute("href")).toBe("/review/structure/sync-abc");
  });

  it("keep their cards when the list did not load, so nothing goes unseen", async () => {
    serve({ queue: [200, QUEUE], list: [500, { error: "Could not read the differences." }] });
    renderReview();
    expect(await screen.findByText("The list of changes did not load")).toBeTruthy();
    expect(screen.queryByText(/now listed above/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Accept all/ })).toHaveLength(2);
  });
});

describe("a member the queue refuses", () => {
  it("is shown how many changes wait and who decides them, in place of the refusal", async () => {
    serve({
      queue: [403, { error: "auth_required" }],
      list: [401, { error: "auth_required" }],
      guide: [200, { options: [{ id: "saberra", name: "Sera" }] }],
      powers: [200, { powers: [{ capability: "org.decide", heldBy: null, heldToday: ["Ops lead (Rye)"] }] }],
    });
    renderReview();
    expect(await screen.findByRole("heading", { level: 2, name: "Sera suggests 2 changes for the chart" })).toBeTruthy();
    expect(await screen.findByText("Ops lead (Rye) and the stewards decide them.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Review" })).toBeTruthy();
    expect(screen.queryByText("This queue is not open to you yet")).toBeNull();
    expect(screen.queryByText(/Water Steward/)).toBeNull();
  });

  it("still sees the refusal when the module is off", async () => {
    serve({ queue: [403, { error: "auth_required" }], count: [404, { error: "module_disabled" }] });
    renderReview();
    expect(await screen.findByText("This queue is not open to you yet")).toBeTruthy();
  });
});

describe("the page around the list", () => {
  it("never says Nothing waiting while the list holds changes", async () => {
    serve({ queue: [200, EMPTY] });
    renderReview();
    expect(await screen.findByRole("heading", { level: 2, name: "Sera suggests 2 changes for you to decide" })).toBeTruthy();
    expect(screen.queryByText("Nothing waiting")).toBeNull();
  });

  it("opens with the summary line, a jump link to each section that waits", async () => {
    const claim = { id: "c1", questId: "q1", questTitle: "Beds", userId: "u2", userName: "Ada Moss", status: "submitted", note: null, artifactUrl: null, amount: null, claimedAt: null, submittedAt: null, pay: null };
    serve({ queue: [200, EMPTY], claims: [200, [claim, { ...claim, id: "c2" }]] });
    renderReview();
    const line = await screen.findByText(/^Waiting for you:/);
    await waitFor(() => expect(line.textContent).toBe("Waiting for you: 2 Sera changes · 2 finished Quests to witness"));
    expect(within(line).getByRole("link", { name: "2 Sera changes" }).getAttribute("href")).toBe("#sera-changes");
    expect(within(line).getByRole("link", { name: "2 finished Quests to witness" }).getAttribute("href")).toBe("#witness");
    expect(document.getElementById("witness")?.textContent).toContain("Finished work waiting for a witness");
  });
});
