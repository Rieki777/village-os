// @vitest-environment jsdom
/**
 * Step four of a structure change: carrying the people on the old chart
 * across, once the draft is live. Built from `planCarry` itself so the rows are
 * the rows the server would send.
 *
 * What it has to be able to say:
 *   - the stepper is on "Carry people across", with "Live now" kept on step 3;
 *   - a suggestion is marked as one with its reason, and nothing moves without
 *     a click; a row with no suggestion waits for a pick;
 *   - "Confirm all suggested" lists exactly the visible suggested rows in an
 *     in-page confirm, and moves only those, one request each;
 *   - a member without the power reads the list and is told who holds it;
 *   - retiring the empty old chart is previewed before a draft is made;
 *   - once everyone is across and the old chart retired, step four is done.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { planCarry, type CarrySeating } from "@shared/carryAcross";
import { countDraft, planFromDraft } from "@shared/structureDraft";

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

const CIRCLES = [
  { id: "general-circle", name: "General Coordinating Circle", parentCircleId: null, status: "active", isExample: false },
  { id: "finance-circle", name: "Finance & Business Circle", parentCircleId: "general-circle", status: "active", isExample: false },
  { id: "community-circle", name: "Community Circle", parentCircleId: "general-circle", status: "active", isExample: false },
  { id: "advisory-bodies", name: "Advisory Bodies", parentCircleId: "general-circle", status: "active", isExample: false },
  { id: "regenerative-business", name: "Regenerative Business", parentCircleId: null, status: "active", isExample: false },
  { id: "community-anchor", name: "Community Anchor", parentCircleId: null, status: "active", isExample: false },
];
const seat = (id: string, name: string, circleId: string) => ({ id, name, circleId, active: true, isExample: false });
const SEATS = [
  seat("finance-lead", "Finance Lead", "finance-circle"),
  seat("potluck-priestess", "Potluck Priestess", "community-circle"),
  seat("advisory-board", "Advisory Board", "advisory-bodies"),
  seat("entity-steward", "Entity and Land Trust Steward", "finance-circle"),
  seat("rec-finance", "Finance Steward", "regenerative-business"),
  seat("rec-advisory", "Advisory Council Member", "regenerative-business"),
  seat("rec-events", "Events Manager", "community-anchor"),
];
const CHANGES = [
  { op: "create_circle", orgRoleId: "circle:regenerative-business", payload: { name: "Regenerative Business" } },
  { op: "create_circle", orgRoleId: "circle:community-anchor", payload: { name: "Community Anchor" } },
  { op: "create_seat", orgRoleId: "rec-finance", payload: { name: "Finance Steward", circleId: "regenerative-business" } },
  { op: "create_seat", orgRoleId: "rec-advisory", payload: { name: "Advisory Council Member", circleId: "regenerative-business" } },
  { op: "create_seat", orgRoleId: "rec-events", payload: { name: "Events Manager", circleId: "community-anchor" } },
];
const PEOPLE: CarrySeating[] = [
  { id: "s-ana", orgRoleId: "finance-lead", person: "Ana", isExample: false },
  { id: "s-bo", orgRoleId: "potluck-priestess", person: "Bo", isExample: false },
  { id: "s-cy", orgRoleId: "advisory-board", person: "Cy", isExample: false },
  { id: "s-dee", orgRoleId: "advisory-board", person: "Dee", isExample: false },
];

function carryAnswer(seatings: CarrySeating[] = PEOPLE, extra: Record<string, unknown> = {}) {
  return {
    draftId: "draft-1",
    ...planCarry({ changes: CHANGES, seats: SEATS, circles: CIRCLES, seatings }),
    retireDraft: null,
    mayCarry: true,
    whoCarries: [],
    mayRetire: true,
    mayPublishRetire: true,
    ...extra,
  };
}

function liveDraft() {
  const live = CIRCLES.map((c) => c);
  const seats = SEATS.map((s) => ({ ...s, holders: 0 }));
  const { plan, decisions } = planFromDraft("draft-1", CHANGES, live, seats);
  return {
    id: "draft-1",
    title: "Structure suggested by the connected service",
    status: "published",
    publishedAt: "2026-10-20T19:00:00Z",
    counts: countDraft(CHANGES),
    plan,
    decisions,
    preview: null,
  };
}

let answer: any;
let posts: Array<{ url: string; body: any }> = [];
let onPost: (url: string, body: any) => { ok: boolean; status: number; body: any };

beforeEach(() => {
  posts = [];
  answer = {
    batchId: "sync-1",
    moduleId: "saberra",
    receivedAt: "2026-10-20T17:24:00Z",
    title: "Structure suggested by the connected service",
    plan: null,
    waiting: 0,
    draft: liveDraft(),
    mayPublish: false,
    carry: carryAnswer(),
  };
  onPost = () => ({ ok: true, status: 200, body: { success: true, already: false } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST") {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        posts.push({ url: String(url), body });
        const r = onPost(String(url), body);
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
  await screen.findByTestId("carry-across");
}

describe("carrying people across, once the draft is live", () => {
  it("puts the stepper on step four and keeps step three live", async () => {
    await open();
    expect(screen.getByTestId("step-3").getAttribute("data-state")).toBe("done");
    expect(within(screen.getByTestId("step-3")).getByText("Live now")).toBeTruthy();
    expect(screen.getByTestId("step-4").getAttribute("data-state")).toBe("now");
    expect(within(screen.getByTestId("step-4")).getByText("Carry people across")).toBeTruthy();
    expect(screen.getByTestId("carry-step-summary").textContent).toContain("4 people still sit on the old chart.");
  });

  it("marks a suggestion as one, and a row without one waits for a pick", async () => {
    await open();
    const ana = screen.getByTestId("carry-row-s-ana");
    expect(within(ana).getByTestId("suggested").textContent).toBe("Suggested · Similar name");
    expect((within(ana).getByLabelText("New role for Ana") as HTMLSelectElement).value).toBe("rec-finance");
    // Nothing moved on load.
    expect(posts).toEqual([]);

    const bo = screen.getByTestId("carry-row-s-bo");
    expect(within(bo).queryByTestId("suggested")).toBeNull();
    expect(within(bo).getByText("No role on the new chart has a name like it. Pick one.")).toBeTruthy();
    expect((within(bo).getByRole("button", { name: "Move Bo" }) as HTMLButtonElement).disabled).toBe(true);

    // Keep this seat for now is a choice, and it moves nobody.
    fireEvent.change(within(ana).getByLabelText("New role for Ana"), { target: { value: "keep" } });
    expect((within(ana).getByRole("button", { name: "Move Ana" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(ana).getByText("Ana stays in Finance Lead for now. A role somebody holds is never retired.")).toBeTruthy();

    // A pick of the steward's own moves that one person, with one request.
    fireEvent.change(within(bo).getByLabelText("New role for Bo"), { target: { value: "rec-events" } });
    expect(within(bo).getByText("Your pick")).toBeTruthy();
    fireEvent.click(within(bo).getByRole("button", { name: "Move Bo" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/review/batches/sync-1/structure/carry/move", body: { seatingId: "s-bo", toSeatId: "rec-events" } });
  });

  it("confirm all suggested lists the visible suggested rows first, then moves only those", async () => {
    await open();
    // Dee's suggestion is changed away, so it is no longer a suggested row.
    fireEvent.change(screen.getByLabelText("New role for Dee"), { target: { value: "rec-events" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm all suggested (2)" }));
    expect(posts).toEqual([]);
    const confirm = screen.getByTestId("carry-confirm-all");
    expect(within(confirm).getByText("Move 2 people to their suggested role?")).toBeTruthy();
    expect(Array.from(confirm.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "Cy: Advisory Board to Advisory Council Member",
      "Ana: Finance Lead to Finance Steward",
    ]);
    fireEvent.click(within(confirm).getByRole("button", { name: "Yes, move 2 people" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map((p) => p.body)).toEqual([
      { seatingId: "s-cy", toSeatId: "rec-advisory" },
      { seatingId: "s-ana", toSeatId: "rec-finance" },
    ]);
    await screen.findByText("2 people moved to their new role.");
  });

  it("shows the list read only to a member without the power, and who holds it", async () => {
    answer.carry = carryAnswer(PEOPLE, { mayCarry: false, whoCarries: ["Rye"] });
    await open();
    expect(screen.getByTestId("carry-read-only").textContent).toBe(
      "You can read this list. Moving people is for Rye, who holds the power to seat people.",
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm all suggested/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
    expect(within(screen.getByTestId("carry-row-s-ana")).getByText("Suggested: Finance Steward")).toBeTruthy();
  });

  it("previews retiring the empty old chart before a draft is made, and never lists a held seat", async () => {
    // Only Bo is left on the old chart.
    answer.carry = carryAnswer([PEOPLE[1]]);
    onPost = (url, body) =>
      body?.dryRun
        ? { ok: true, status: 200, body: { reads: ['Rest Finance Lead, so it stops appearing on the chart'], blocked: 0 } }
        : { ok: true, status: 200, body: { success: true, draftId: "draft-r" } };
    await open();
    const held = screen.getByTestId("carry-still-held");
    expect(held.textContent).toContain("Potluck Priestess");
    const retire = screen.getByTestId("carry-retire");
    expect(retire.textContent).not.toContain("Potluck Priestess");
    fireEvent.click(within(retire).getByRole("button", { name: "Retire the empty old chart" }));
    await screen.findByTestId("carry-retire-preview");
    expect(posts[0]).toEqual({ url: "/api/review/batches/sync-1/structure/carry/retire", body: { dryRun: true } });
    fireEvent.click(screen.getByRole("button", { name: "Put it in a draft" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].body).toEqual({});
  });

  it("publishes the retire draft through the same publish route, behind a confirm", async () => {
    answer.carry = carryAnswer([], {
      retireDraft: { id: "draft-r", status: "open", reads: ["Rest Finance Lead, so it stops appearing on the chart"], blocked: 0, blockedLines: [] },
    });
    await open();
    const box = screen.getByTestId("carry-retire-draft");
    fireEvent.click(within(box).getByRole("button", { name: "Publish to the live chart" }));
    expect(posts).toEqual([]);
    fireEvent.click(within(screen.getByTestId("carry-publish-confirm")).getByRole("button", { name: "Yes, publish it now" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe("/api/admin/org/drafts/draft-r/publish");
  });

  it("says so plainly when everyone is across and the old chart is retired", async () => {
    answer.carry = carryAnswer([], { retireDraft: { id: "draft-r", status: "published", reads: [], blocked: 0, blockedLines: [] } });
    await open();
    expect(screen.getByTestId("carry-state").textContent).toBe("Everyone is on the new chart, and the old chart is retired.");
    expect(screen.getByTestId("step-4").getAttribute("data-state")).toBe("done");
  });
});
