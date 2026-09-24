// @vitest-environment jsdom
/**
 * EVERY OPEN ASK FOR A SEAT HAS A CONFIRM AND A DECLINE SOMEWHERE ON THE PAGE.
 *
 * The org chart draws the steward's queue on the seat it belongs to, inside
 * the seat's card, and it draws seat cards only for seats inside a circle it
 * is drawing. A member is offered every seat recorded under their name,
 * wherever it sits, so they could ask for a seat the steward had no card for:
 * the ask was filed, `GET /api/org/seat-claims` returned it, and the page drew
 * no control for it. Found in a local QA pass at phone and desktop widths,
 * counted by accessible name: one Confirm on the page while two asks were open.
 *
 * Two ways a seat goes undrawn, and both are covered because the fix does not
 * enumerate them:
 *   - it has no circle, and appears only as a name in the amber notice;
 *   - its circle is not among the ones drawn, so it is grouped under an id
 *     nothing renders and does not even reach the amber notice.
 *
 * The third case is the guard on the fix. An ask whose seat IS drawn must
 * appear exactly once, on its seat, so "draw every ask everywhere" cannot pass.
 *
 * Found by accessible name and never by a person's name in the page text:
 * every seat card lists the members in a dropdown, so a name being on the
 * page says nothing about whether their ask is.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrgChartTab } from "@/components/admin/OrgChartTab";

const circle = (id: string, name: string) => ({
  id, name, status: "active", purpose: "", parentId: null, isExample: false,
});
const seat = (id: string, name: string, circleId: string | null) => ({
  id, name, circleId, seats: 1, state: "open", holders: [], holderCount: 0, accountabilities: [],
});
const ask = (claimId: string, roleId: string, roleName: string, userName: string) => ({
  claimId, assignmentId: `seating-${roleId}`, roleId, roleName, recordedName: userName,
  userId: `u-${claimId}`, userName, askedAt: "2026-09-21T10:00:00.000Z",
});

/** Answers the four reads the tab makes on load, most specific path first. */
function stub(org: { circles: any[]; roles: any[] }, asks: any[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any) => {
      const path = String(url);
      const body =
        path.includes("/org/seat-claims") ? asks
        : path.includes("/admin/org/expiring") ? []
        : path.includes("/admin/players") ? []
        : /\/org(\?|$)/.test(path) ? org
        : {};
      return { ok: true, status: 200, json: async () => body };
    }),
  );
}

const confirmFor = (who: string, where: string) =>
  screen.queryAllByRole("button", { name: `Confirm ${who} as ${where}` });
const declineFor = (who: string, where: string) =>
  screen.queryAllByRole("button", { name: `Decline ${who}'s ask for ${where}` });

describe("the steward can answer every ask a member was able to make", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("draws an ask on the seat it belongs to when that seat sits in a drawn circle", async () => {
    // The floor under the cases below, and it passed before the fix too. If
    // this harness drew no asks at all, the two orphan cases would fail for
    // that reason and prove nothing; this is the known positive.
    stub(
      { circles: [circle("c-land", "Land Circle")], roles: [seat("r-orchard", "Orchard Keeper", "c-land")] },
      [ask("k0", "r-orchard", "Orchard Keeper", "Juniper Ash")],
    );
    render(<OrgChartTab password="secret" />);
    await waitFor(() => expect(confirmFor("Juniper Ash", "Orchard Keeper")).toHaveLength(1));
    expect(declineFor("Juniper Ash", "Orchard Keeper")).toHaveLength(1);
  });

  it("answers an ask for a seat that sits in no circle", async () => {
    stub(
      { circles: [circle("c-land", "Land Circle")], roles: [seat("r-water", "Water Steward", null)] },
      [ask("k1", "r-water", "Water Steward", "Wren Alder")],
    );
    render(<OrgChartTab password="secret" />);
    await waitFor(() => expect(confirmFor("Wren Alder", "Water Steward")).toHaveLength(1));
    expect(declineFor("Wren Alder", "Water Steward")).toHaveLength(1);
  });

  it("answers an ask for a seat whose circle is not one the page draws", async () => {
    // A seat pointing at a circle that is gone is grouped under an id nothing
    // renders, and it is not a circle-less seat either, so the amber notice
    // never names it. It was the more invisible of the two.
    stub(
      { circles: [circle("c-land", "Land Circle")], roles: [seat("r-seed", "Seed Librarian", "c-merged-away")] },
      [ask("k2", "r-seed", "Seed Librarian", "Wren Alder")],
    );
    render(<OrgChartTab password="secret" />);
    await waitFor(() => expect(confirmFor("Wren Alder", "Seed Librarian")).toHaveLength(1));
    expect(declineFor("Wren Alder", "Seed Librarian")).toHaveLength(1);
  });

  it("draws an ask for a seat inside a drawn circle exactly once, on its seat", async () => {
    stub(
      {
        circles: [circle("c-land", "Land Circle")],
        roles: [seat("r-orchard", "Orchard Keeper", "c-land"), seat("r-water", "Water Steward", null)],
      },
      [ask("k3", "r-orchard", "Orchard Keeper", "Juniper Ash"), ask("k4", "r-water", "Water Steward", "Wren Alder")],
    );
    render(<OrgChartTab password="secret" />);
    await waitFor(() => expect(confirmFor("Wren Alder", "Water Steward")).toHaveLength(1));
    // Once, and not once more in the block that catches the undrawn ones.
    expect(confirmFor("Juniper Ash", "Orchard Keeper")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Confirm / })).toHaveLength(2);
  });
});
