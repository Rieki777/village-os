// @vitest-environment jsdom
/**
 * The structure review AFTER the accept, in the shape the founder met on
 * 2026-10-20: the batch's structure accepted into an open draft, and only the
 * circles the source had archived still waiting in the batch.
 *
 * What it has to be able to say:
 *   - it shows the draft it made, never an empty batch;
 *   - "Publish to the live chart" only for a viewer the publish route admits,
 *     behind a confirm that names what goes live, and a viewer who may not
 *     publish is told who can;
 *   - withdrawing sends the proposals back and the page reviews them again;
 *   - the stepper says which step this batch is on, with the action inline;
 *   - the header's date is the newest arrival in the batch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { planStructure, type PlanLiveCircle, type PlanLiveSeat, type PlanProposal } from "@shared/structurePlan";
import { countDraft, newestArrival, planFromDraft, stayedBehind } from "@shared/structureDraft";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => "a-token",
}));
vi.mock("wouter", async (orig) => ({
  ...(await orig<typeof import("wouter")>()),
  useParams: () => ({ batchId: "sync-1" }),
}));

import StructureReview from "./StructureReview";

const LIVE_CIRCLES: PlanLiveCircle[] = [
  { id: "general", name: "General Circle", parentCircleId: null, status: "active", isExample: false },
];
const LIVE_SEATS: PlanLiveSeat[] = [
  { id: "ops", name: "Operations Steward", circleId: "general", active: true, isExample: false, holders: 1 },
];

/** What the accept wrote: two circles, two new seats, and one live seat moved. */
const CHANGES = [
  { op: "create_circle", orgRoleId: "circle:community-anchor", payload: { name: "Community Anchor", purpose: null, parentCircleId: null } },
  { op: "create_circle", orgRoleId: "circle:regenerative-business", payload: { name: "Regenerative Business", purpose: null, parentCircleId: null } },
  { op: "update_seat", orgRoleId: "ops", payload: { name: "Operations Steward", circleId: "community-anchor" } },
  { op: "create_seat", orgRoleId: "rec-3", payload: { name: "Events Manager", circleId: "regenerative-business", aim: "Gatherings." } },
  { op: "create_seat", orgRoleId: "rec-4", payload: { name: "Marketing Lead", circleId: "community-anchor" } },
  { op: "create_seat", orgRoleId: "rec-2", payload: { name: "Ventures Operations Steward", circleId: "regenerative-business" } },
];

/** The leftovers: three circles the source archived, still waiting. */
const ARCHIVED: PlanProposal[] = ["Old Garden", "Old Kitchen", "Old Gate"].map((name, i) => ({
  id: `xp-arch-${i}`,
  kind: "circle.proposed",
  payload: { "Circle Name": name, Status: "Archived" },
}));
const LEFTOVER = planStructure(ARCHIVED, LIVE_CIRCLES, LIVE_SEATS);

/** The review plan, before the accept. */
const REVIEW_PLAN = planStructure(
  [
    {
      id: "xp-structure",
      kind: "org.proposed",
      payload: { title: "Structure suggested by the connected service", seats: [{ name: "Events Manager", circleName: "General Circle", id: "rec-3" }] },
    },
  ],
  LIVE_CIRCLES,
  LIVE_SEATS,
);

function draftAnswer(status: "open" | "published" = "open", blocked = 0) {
  const { plan, decisions } = planFromDraft("draft-1", CHANGES, LIVE_CIRCLES, LIVE_SEATS);
  return {
    id: "draft-1",
    title: "Structure suggested by Organisational Memory",
    status,
    publishedAt: status === "published" ? "2026-10-20T19:00:00Z" : null,
    counts: countDraft(CHANGES),
    plan,
    decisions,
    preview:
      status === "open"
        ? {
            lines: CHANGES.length,
            blocked,
            blockedLines: blocked ? [{ reads: 'Create the seat "Marketing Lead"', blocked: "A seat with this name already exists" }] : [],
          }
        : null,
  };
}

let answer: any;
let posts: Array<{ url: string; body: any }> = [];
let onPost: (url: string) => { ok: boolean; status: number; body: any };

beforeEach(() => {
  posts = [];
  answer = {
    batchId: "sync-1",
    moduleId: "saberra",
    receivedAt: "2026-10-20T17:24:00Z",
    title: "Structure suggested by the connected service",
    plan: LEFTOVER,
    waiting: 3,
    draft: draftAnswer(),
    mayPublish: true,
  };
  onPost = () => ({ ok: true, status: 200, body: { success: true } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST") {
        posts.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
        const r = onPost(String(url));
        return { ok: r.ok, status: r.status, json: async () => r.body };
      }
      expect(String(url)).toBe("/api/review/batches/sync-1/structure");
      const snapshot = answer;
      return { ok: true, status: 200, json: async () => snapshot };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function open() {
  render(<StructureReview />);
  await screen.findByTestId("your-draft");
}

describe("the structure review after the accept", () => {
  it("shows the draft it made, never an empty batch", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "Your draft" })).toBeTruthy();
    expect(screen.getByTestId("draft-state").textContent).toBe("Nothing is live yet. 6 changes, none blocked.");
    expect(screen.getByTestId("draft-count-New circles").textContent).toBe("2");
    expect(screen.getByTestId("draft-count-New roles").textContent).toBe("3");
    expect(screen.getByTestId("draft-count-Moved roles").textContent).toBe("1");
    // The read-only list carries the draft's seats, and the moved one says its holder stays.
    expect(screen.getAllByText("Ventures Operations Steward").length).toBeGreaterThan(0);
    expect(screen.getByText(/Our existing role moves here from General Circle\. 1 person keeps it\./)).toBeTruthy();
    // No checkbox and no choice: it is read only.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    // What stayed behind is named, with the way to the list.
    expect(screen.getByTestId("stayed-behind").textContent).toContain(
      "3 proposals from Organisational Memory stay in the queue: archived in Organisational Memory.",
    );
    expect(within(screen.getByTestId("stayed-behind")).getByRole("link", { name: "See the list" }).getAttribute("href")).toBe("#draft-archived");
    expect(within(screen.getByTestId("draft-archived")).getByText("Old Gate")).toBeTruthy();
    // And none of the empty batch the founder saw.
    expect(document.body.textContent).not.toContain("suggests 0");
    expect(screen.queryByRole("button", { name: "Accept into a draft" })).toBeNull();
  });

  it("says what blocks it, and holds the publish until nothing does", async () => {
    answer = { ...answer, draft: draftAnswer("open", 1) };
    await open();
    expect(screen.getByTestId("draft-state").textContent).toBe("Nothing is live yet. 6 changes, 1 blocked. Each one says why below.");
    expect(screen.getByText("A seat with this name already exists")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish to the live chart" })).toBeDisabled();
  });

  it("offers the publish only to a viewer who may publish, and says who can to anybody else", async () => {
    answer = { ...answer, mayPublish: false };
    await open();
    expect(screen.queryByRole("button", { name: "Publish to the live chart" })).toBeNull();
    expect(screen.getByTestId("who-publishes").textContent).toContain("whoever holds the power to change the village's structure does it");
    // Withdrawing is the steward's own, so it stays.
    expect(screen.getByRole("button", { name: "Withdraw the draft" })).toBeEnabled();
  });

  it("publishes through the holder's door when the read names it, and says what that door refused", async () => {
    answer = { ...answer, publishDoor: "power", mayModerate: true };
    onPost = () => ({ ok: false, status: 403, body: { error: "not_a_holder", message: "Publishing a change to the structure straight onto the chart is for whoever holds the power." } });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Publish to the live chart" }));
    fireEvent.click(within(screen.getByTestId("publish-confirm")).getByRole("button", { name: "Yes, publish it now" }));
    await screen.findByText("Publishing a change to the structure straight onto the chart is for whoever holds the power.");
    expect(posts.map((p) => p.url)).toEqual(["/api/org/drafts/draft-1/publish-by-power"]);
  });

  it("offers a holder who does not keep the review queue the publish, and no withdraw", async () => {
    answer = { ...answer, plan: null, waiting: 0, publishDoor: "power", mayModerate: false };
    await open();
    expect(screen.getByRole("button", { name: "Publish to the live chart" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Withdraw the draft" })).toBeNull();
  });

  it("publishes only through a confirm that names what goes live, then says it is live", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Publish to the live chart" }));
    const confirm = screen.getByTestId("publish-confirm");
    expect(confirm.textContent).toContain("This puts 2 new circles, 3 new roles and 1 moved role on the live chart at once");
    expect(confirm.textContent).toContain("People keep their roles");
    expect(posts).toHaveLength(0);

    fireEvent.click(within(confirm).getByRole("button", { name: "Not yet" }));
    expect(screen.queryByTestId("publish-confirm")).toBeNull();
    expect(posts).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Publish to the live chart" }));
    answer = { ...answer, draft: draftAnswer("published"), mayPublish: false };
    fireEvent.click(within(screen.getByTestId("publish-confirm")).getByRole("button", { name: "Yes, publish it now" }));

    await screen.findByRole("heading", { level: 1, name: "Your draft is live" });
    expect(posts.map((p) => p.url)).toEqual(["/api/admin/org/drafts/draft-1/publish"]);
    expect(screen.getByTestId("notice").textContent).toContain("Published");
    expect(screen.getByRole("link", { name: "See the living map" }).getAttribute("href")).toBe("/map");
    expect(screen.getByRole("link", { name: "See every role" }).getAttribute("href")).toBe("/roles");
    expect(screen.getByTestId("step-3").getAttribute("data-state")).toBe("done");
    expect(within(screen.getByTestId("step-3")).getByText("Live now")).toBeTruthy();
  });

  it("keeps the draft open and says why when the publish is refused", async () => {
    onPost = () => ({ ok: false, status: 409, body: { error: "1 change(s) cannot be applied. First: a seat moved" } });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Publish to the live chart" }));
    fireEvent.click(within(screen.getByTestId("publish-confirm")).getByRole("button", { name: "Yes, publish it now" }));
    expect((await screen.findByRole("alert")).textContent).toContain("cannot be applied");
    expect(screen.getByRole("heading", { level: 1, name: "Your draft" })).toBeTruthy();
  });

  it("withdraws the draft, and the proposals come back to review", async () => {
    onPost = () => ({ ok: true, status: 200, body: { success: true, reopened: 1 } });
    await open();
    answer = { ...answer, plan: REVIEW_PLAN, waiting: 1, draft: null, mayPublish: false };
    fireEvent.click(screen.getByRole("button", { name: "Withdraw the draft" }));
    await screen.findByRole("heading", { level: 1, name: "Structure suggested by the connected service" });
    expect(posts.map((p) => p.url)).toEqual(["/api/review/drafts/draft-1/withdraw"]);
    expect(screen.getByTestId("notice").textContent).toBe("Withdrawn. Its proposal is back in the queue, ready to review again.");
    expect(screen.queryByTestId("your-draft")).toBeNull();
  });

  it("becomes the draft right after the accept", async () => {
    answer = { ...answer, plan: REVIEW_PLAN, waiting: 1, draft: null, mayPublish: false };
    onPost = () => ({ ok: true, status: 200, body: { success: true, draftId: "draft-1", blockedLines: [], leftInQueue: [] } });
    render(<StructureReview />);
    await screen.findByRole("heading", { level: 1, name: "Structure suggested by the connected service" });
    answer = { ...answer, plan: LEFTOVER, waiting: 3, draft: draftAnswer(), mayPublish: true };
    fireEvent.click(within(screen.getByTestId("action-bar")).getByRole("button", { name: "Accept into a draft" }));
    await screen.findByTestId("your-draft");
    expect(screen.getByTestId("notice").textContent).toBe("Accepted into a draft. Nothing is live yet.");
    expect(screen.getByRole("button", { name: "Publish to the live chart" })).toBeEnabled();
  });
});

describe("the stepper", () => {
  it("puts a batch under review on step one, with the accept inline", async () => {
    answer = { ...answer, plan: REVIEW_PLAN, waiting: 1, draft: null };
    render(<StructureReview />);
    await screen.findByRole("heading", { level: 1, name: "Structure suggested by the connected service" });
    expect(screen.getByTestId("step-1").getAttribute("data-state")).toBe("now");
    expect(screen.getByTestId("step-2").getAttribute("data-state")).toBe("next");
    expect(screen.getByTestId("step-3").getAttribute("data-state")).toBe("next");
    expect(within(screen.getByTestId("step-1")).getByRole("button", { name: "Accept into a draft" })).toBeTruthy();
  });

  it("puts an open draft on step two, with publish and withdraw inline and the vote as a slot with no button", async () => {
    await open();
    expect(screen.getByTestId("step-1").getAttribute("data-state")).toBe("done");
    expect(screen.getByTestId("step-2").getAttribute("data-state")).toBe("now");
    const two = screen.getByTestId("step-2");
    expect(within(two).getByRole("button", { name: "Publish to the live chart" })).toBeTruthy();
    expect(within(two).getByRole("button", { name: "Withdraw the draft" })).toBeTruthy();
    const slot = screen.getByTestId("put-to-village-slot");
    expect(slot.textContent).toContain("Put it to the village");
    expect(within(slot).queryAllByRole("button")).toHaveLength(0);
    expect(within(slot).queryAllByRole("link")).toHaveLength(0);
  });
});

describe("the header date", () => {
  it("is the newest arrival among the batch's proposals", () => {
    expect(newestArrival(["2026-10-09T17:24:00.000Z", "2026-10-20T16:02:00.000Z", null, "2026-10-09T17:25:00.000Z"])).toBe(
      "2026-10-20T16:02:00.000Z",
    );
    expect(newestArrival([null, undefined])).toBeNull();
  });

  it("shows the date the read sent", async () => {
    await open();
    expect(document.body.textContent).toContain(
      `Arrived ${new Date("2026-10-20T17:24:00Z").toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}`,
    );
  });
});

describe("what stayed behind", () => {
  it("names archived proposals, notes and anything still to decide", () => {
    expect(stayedBehind(LEFTOVER, 3, "The source")).toBe("3 proposals from The source stay in the queue: archived in The source.");
    expect(stayedBehind(null, 0, "The source")).toBeNull();
    const mixed = planStructure(
      [...ARCHIVED, { id: "xp-risk", kind: "risk.observed", payload: { Risk: "Rain" } }],
      LIVE_CIRCLES,
      LIVE_SEATS,
    );
    expect(stayedBehind(mixed, 5, "The source")).toBe(
      "5 proposals from The source stay in the queue: 3 archived in The source, 1 note that changes no structure, 1 still waiting for a decision.",
    );
  });
});
