// @vitest-environment jsdom
/**
 * A path's particulars, rendered.
 *
 * The claims worth pinning here are the three states this section has to keep
 * apart, because two of them draw nothing and confusing them is the whole bug:
 *
 *   the payload has not arrived      -> nothing
 *   the member does not walk it      -> nothing
 *   they walk it and it is empty     -> the section, with what would fill it
 *
 * Collapse the third into the first two and a member who claims a path watches
 * the page do nothing and concludes the claim failed.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import PathFacts from "./PathFacts";
import type { PathParticulars } from "@shared/pathLadders";
import type { VillageMoon } from "@shared/villageMoon";

const MOON: VillageMoon = {
  ordinal: 7,
  standing: "counted",
  cycleNumber: 1000,
  startsAt: new Date("2026-03-01T00:00:00Z").toISOString(),
  endsAt: new Date("2026-03-29T00:00:00Z").toISOString(),
} as unknown as VillageMoon;

const venture = {
  id: "ven-1",
  name: "Hollow Oak Bakery",
  summary: "Bread three mornings a week",
  kind: "food",
  link: "https://example.test/bakery",
  live: true,
  listed: true,
  openedMoon: MOON,
  listedMoon: MOON,
  closedMoon: null,
  closedReason: null,
};

describe("PathFacts", () => {
  it("draws nothing at all while the payload is unknown", () => {
    const { container } = render(
      <PathFacts pathId="prosperity-creator" title="Prosperity Creator" particulars={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("draws nothing for a path whose key the server did not send", () => {
    // Absent means this member does not walk it, so there is nothing to say.
    // An empty section here would offer somebody a surface they never claimed.
    const { container } = render(
      <PathFacts pathId="investor" title="Investor" particulars={{ resident: { reservations: [] } }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("draws the section and names what would fill it when the list is empty", () => {
    render(
      <PathFacts
        pathId="prosperity-creator"
        title="Prosperity Creator"
        particulars={{ "prosperity-creator": { ventures: [] } }}
      />,
    );
    expect(screen.getByText("Prosperity Creator")).toBeTruthy();
    expect(screen.getByText(/The first one you open appears here/)).toBeTruthy();
  });

  it("shows the particulars a ladder could never carry", () => {
    const particulars: PathParticulars = { "prosperity-creator": { ventures: [venture] } };
    render(<PathFacts pathId="prosperity-creator" title="Prosperity Creator" particulars={particulars} />);
    expect(screen.getByText("Hollow Oak Bakery")).toBeTruthy();
    expect(screen.getByText("Bread three mornings a week")).toBeTruthy();
    expect(screen.getByText("food")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Visit/ });
    expect(link.getAttribute("href")).toBe("https://example.test/bakery");
    // A member's own link is somebody else's page: it must not hand the opener
    // a live reference back to this tab.
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("says a venture is closed, and why, without any date arithmetic", () => {
    const closed = {
      ...venture,
      live: false,
      closedMoon: MOON,
      closedReason: "Moved away",
    };
    render(
      <PathFacts
        pathId="prosperity-creator"
        title="Prosperity Creator"
        particulars={{ "prosperity-creator": { ventures: [closed] } }}
      />,
    );
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("Moved away")).toBeTruthy();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("names an investor fact in the ladder's own words, never its key", () => {
    // The words exist already in shared/pathLadders.ts, whose rung ids match
    // INVESTOR_FACTS. A member should never read a column value.
    render(
      <PathFacts
        pathId="investor"
        title="Investor"
        particulars={{
          investor: {
            facts: [
              {
                id: "f1",
                fact: "packet_released",
                detail: "Sent after the Tuesday call",
                documentId: null,
                live: true,
                startedMoon: MOON,
                endedMoon: null,
                endedReason: null,
              },
            ],
          },
        }}
      />,
    );
    expect(screen.queryByText("packet_released")).toBeNull();
    expect(screen.getByText("Packet released")).toBeTruthy();
    expect(screen.getByText("Sent after the Tuesday call")).toBeTruthy();
  });

  it("prints a fact key it cannot name, instead of an empty line", () => {
    // A village that adds a fifth fact gets the raw key, which is ugly and
    // true. A blank row would be neither.
    render(
      <PathFacts
        pathId="investor"
        title="Investor"
        particulars={{
          investor: {
            facts: [
              {
                id: "f2",
                fact: "board_seat_offered",
                detail: null,
                documentId: null,
                live: true,
                startedMoon: null,
                endedMoon: null,
                endedReason: null,
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("board_seat_offered")).toBeTruthy();
  });

  it("names a seat and says when it began", () => {
    render(
      <PathFacts
        pathId="steward"
        title="Village Steward"
        particulars={{
          steward: {
            seats: [
              {
                id: "s1",
                roleName: "Water Steward",
                live: true,
                representsCircle: true,
                startedMoon: MOON,
                endedMoon: null,
                endedReason: null,
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("Water Steward")).toBeTruthy();
    expect(screen.getByText("Speaks for a circle.")).toBeTruthy();
    expect(screen.getByText(/Seated/)).toBeTruthy();
  });

  it("shows a reservation's home and status and no contact detail", () => {
    const { container } = render(
      <PathFacts
        pathId="resident"
        title="Resident"
        particulars={{
          resident: {
            reservations: [
              { id: "r1", homeType: "casita", structureKey: "casita-3", status: "confirmed", madeMoon: MOON },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("casita")).toBeTruthy();
    expect(screen.getByText("confirmed")).toBeTruthy();
    // The type has no field for any of it, and this is the render-side half of
    // the server test that holds the same line.
    expect(container.textContent).not.toContain("@");
  });
});
