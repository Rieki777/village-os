// @vitest-environment jsdom
/**
 * A person's Gene Keys seal beside their row in a role's roster (Rye,
 * 2026-10-30): a filled role shows a player, and tapping the icon with their
 * lines opens a little of their Gene Keys. The seal is the Gene Keys lane's
 * (its own tests cover what it shows and when it hides); this pins only that the
 * roster hands it the right person, beside the row and never inside its button.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Spot } from "@shared/roleSheet";

vi.mock("@/components/geneKeys/HolderGeneKeys", () => ({
  default: ({ userId, name }: { userId: string; name: string }) => <span data-testid="seal">{`${userId}:${name}`}</span>,
}));

import SeatRoster from "./SeatRoster";

afterEach(cleanup);

const spot = (over: Partial<Spot>): Spot => ({
  key: "k", kind: "person", ready: false, title: "Ana Ruiz", sub: null, subIsDate: false, avatar: null, pickKey: "u-1", userId: "u-1", ...over,
});

describe("the roster's Gene Keys seal", () => {
  it("sits beside a named person, handed their id and name", () => {
    render(<SeatRoster spots={[spot({})]} moreOpenLine={null} rosterNote={null} />);
    expect(screen.getByTestId("seal").textContent).toBe("u-1:Ana Ruiz");
  });

  it("is never inside the row's person-filter button", () => {
    render(<SeatRoster spots={[spot({})]} moreOpenLine={null} rosterNote={null} onPickPerson={() => {}} />);
    const button = screen.getByRole("button", { name: /Show every role Ana Ruiz holds/ });
    expect(button.contains(screen.getByTestId("seal"))).toBe(false);
  });

  it("is not drawn for an open place, a nameless seating, or a person with no account", () => {
    render(
      <SeatRoster
        spots={[
          spot({ key: "o", kind: "open", title: "Open", userId: null, pickKey: null }),
          spot({ key: "n", kind: "nameless", title: "Seated", userId: null, pickKey: null }),
          spot({ key: "d", kind: "person", title: "Documented Holder", userId: null, pickKey: "Documented Holder" }),
        ]}
        moreOpenLine={null}
        rosterNote={null}
      />,
    );
    expect(screen.queryByTestId("seal")).toBeNull();
  });
});
