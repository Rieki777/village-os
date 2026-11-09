// @vitest-environment jsdom
/**
 * THE VILLAGE'S AGREEMENTS, READ WHERE MEMBERS LOOK (W4-agreements-no-page).
 *
 * The wizard tells an author an agreement "becomes an active agreement,
 * exactly as written, with its own review date", and no page ever asked
 * GET /api/governance/agreements: the words lived only in the ballot's
 * document. This is the list, on the governance page, for members.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({ user: null as null | { id: string }, governance: true }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: (id: string) => (id === "governance" ? state.governance : false) }));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token" }));

import VillageAgreements from "./VillageAgreements";

const agreement = (over: Record<string, unknown> = {}) => ({
  id: "agr-1",
  title: "Quiet hours in the common house",
  body: "Between ten at night and seven in the morning the common house is quiet, so the people sleeping above it can.",
  domain: "space_land",
  circleId: "hearth",
  circleName: "Hearth",
  reviewAt: "2027-03-01",
  status: "active",
  ballotId: "bal-1",
  decidedAt: "2026-10-20T10:00:00.000Z",
  ...over,
});

function serve(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  state.user = null;
  state.governance = true;
  vi.unstubAllGlobals();
});

describe("the village's agreements", () => {
  it("lists active agreements with their words, circle and review date, and links one at a vote", async () => {
    state.user = { id: "u1" };
    const fetchMock = serve(200, {
      agreements: [
        agreement(),
        agreement({ id: "agr-2", title: "Tools go back to the shed", status: "voting", ballotId: "bal-2", reviewAt: null, circleName: null }),
        agreement({ id: "agr-3", title: "Nobody parks by the gate", status: "not-adopted" }),
      ],
    });
    render(<VillageAgreements />);
    expect(await screen.findByRole("heading", { name: "Quiet hours in the common house" })).toBeTruthy();
    expect(screen.getByText(/Between ten at night/)).toBeTruthy();
    expect(screen.getByText(/Circle: Hearth\./)).toBeTruthy();
    expect(screen.getByTestId("agreement-review-agr-1").textContent).toContain("Review date:");
    expect(screen.getByRole("link", { name: /Tools go back to the shed/ }).getAttribute("href")).toBe("/decisions/bal-2");
    expect(screen.queryByText("Nobody parks by the gate")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/governance/agreements", { headers: { Authorization: "Bearer a-token" } });
  });

  it("says plainly when the village has adopted none", async () => {
    state.user = { id: "u1" };
    serve(200, { agreements: [] });
    render(<VillageAgreements />);
    expect(await screen.findByText("The village has not adopted an agreement yet.")).toBeTruthy();
  });

  it("asks nothing of a visitor, or with governance off, and shows nothing an account cannot read", async () => {
    const fetchMock = serve(403, { error: "for members" });
    const { container, rerender } = render(<VillageAgreements />);
    expect(container.innerHTML).toBe("");
    state.user = { id: "u1" };
    state.governance = false;
    rerender(<VillageAgreements />);
    expect(fetchMock).not.toHaveBeenCalled();
    state.governance = true;
    rerender(<VillageAgreements />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(container.innerHTML).toBe("");
  });
});
