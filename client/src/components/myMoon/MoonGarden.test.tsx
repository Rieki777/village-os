// @vitest-environment jsdom
/**
 * THE MOON GARDEN ON MY MOON (Phase C, lane C2): the header draws this moon
 * on a golden spiral with its four chapters and the one next act, and the
 * role cards grow one garden bed per role. The moon and the work here are
 * invented.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MOON_WORDS } from "@shared/moonRecap";
import { MyMoonView } from "./MyMoon";
import { item, myMoon, ROLES } from "./myMoon.fixture";

afterEach(cleanup);

function renderMoon(over: Parameters<typeof myMoon>[0] = {}, today = "2026-10-12") {
  render(<MyMoonView data={myMoon(over)} villageRoles={[]} onCycle={() => {}} reload={async () => null} today={today} />);
}

describe("the moon on a golden spiral", () => {
  it("draws one dot per day, today in gold, the full moon and the harvest as themselves", () => {
    renderMoon();
    const spiral = screen.getByTestId("moon-spiral");
    expect(spiral.querySelectorAll("[data-day]")).toHaveLength(30);
    expect(spiral.querySelector('[data-day="2026-10-12"]')?.getAttribute("data-kind")).toBe("today");
    expect(spiral.querySelector('[data-day="2026-10-25"]')?.getAttribute("data-kind")).toBe("full");
    expect(spiral.querySelector('[data-day="2026-11-05"]')?.getAttribute("data-kind")).toBe("harvest");
    expect(spiral.querySelector('[data-day="2026-10-11"]')?.getAttribute("data-kind")).toBe("walked");
    expect(spiral.querySelector('[data-day="2026-10-20"]')?.getAttribute("data-kind")).toBe("ahead");
    // Hover names the day.
    expect(spiral.querySelector('[data-day="2026-10-12"] title')?.textContent).toBe("12 October 2026, today");
  });

  it("names the chapter we are in and lists all four, marking the one we are in", () => {
    renderMoon({}, "2026-10-12");
    expect(screen.getByTestId("moon-chapter").textContent).toBe("We sow");
    expect(screen.getByText("Day 3 of 30")).toBeTruthy();
    const list = screen.getByTestId("moon-chapters");
    expect(within(list).getAllByRole("listitem").map((l) => l.textContent?.replace(/\d{1,2} [A-Z][a-z]+$/, "").replace(/^\d/, ""))).toEqual(["We sow, Now", "We tend", "Full moon", "We harvest"]);
    expect(list.querySelector('[aria-current="step"]')?.textContent).toContain("We sow");
    cleanup();
    renderMoon({}, "2026-11-02");
    expect(screen.getByTestId("moon-chapter").textContent).toBe("We harvest");
  });

  it("puts fireflies on the one next act while the recap is the member's, and none once it is sent", () => {
    renderMoon({}, "2026-10-20");
    const act = screen.getByTestId("moon-act");
    expect(act.getAttribute("href")).toBe("#moon-gather");
    expect(act.closest("span")?.querySelector('[data-testid="fireflies"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-testid="fireflies"]')).toHaveLength(1);
    // The act lands on a real section.
    expect(document.getElementById("moon-gather")).toBeTruthy();
    cleanup();
    renderMoon({}, "2026-11-03");
    expect(screen.getByTestId("moon-act").getAttribute("href")).toBe("#moon-own-words");
    expect(document.getElementById("moon-own-words")).toBeTruthy();
    cleanup();
    const sent = myMoon().recap;
    renderMoon({ recap: { ...(sent ?? ({} as never)), id: "mr-1", status: "waiting", statusLine: "Waiting on approval", ownWords: "", roleAudit: { roles: [], newRoles: [] }, sera: null } as never }, "2026-11-03");
    expect(screen.queryByTestId("moon-act")).toBeNull();
    expect(document.querySelector('[data-testid="fireflies"]')).toBeNull();
  });

  it("says a closed moon is closed and offers no act", () => {
    renderMoon({}, "2026-12-01");
    expect(screen.getByText("This moon has closed")).toBeTruthy();
    expect(screen.queryByTestId("moon-act")).toBeNull();
    expect(screen.getByTestId("moon-spiral").querySelector('[data-kind="today"]')).toBeNull();
  });

  it("carries no percent, ring or count of the person in the header", () => {
    renderMoon();
    const header = screen.getByTestId("moon-garden-header").textContent ?? "";
    expect(header).not.toMatch(/%|score|Very full|Rethink/i);
  });
});

describe("one garden bed per role", () => {
  const TWO_ROLES = [...ROLES, { roleId: "role-water", name: "Water keeper", circleId: null, accountabilities: ["Keep the water clean"], deliverables: [], applicationId: "app-2", daysHeld: 30 }];
  const items = [
    item({ id: "mi-1", taskStatus: "done", position: 0 }),
    item({ id: "mi-2", taskStatus: "partly", position: 1, text: "Labelled the jars" }),
    item({ id: "mi-3", taskStatus: null, position: 2, text: "Sorted the beans" }),
    item({ id: "mi-4", taskStatus: "let_go", position: 3, text: "Old idea", letGoReason: "Not needed" }),
    item({ id: "mi-5", roleId: "role-water", accountabilityWords: "Keep the water clean", taskStatus: "carry", position: 4, text: "Clean the tank" }),
  ];
  const coverage = {
    roles: [
      { roleId: "role-seeds", name: "Seed keeper", lines: [{ words: "Keep the seed bank in order", kind: "accountability" as const, itemIds: ["mi-1", "mi-2", "mi-3"] }, { words: "Share seeds at the market", kind: "accountability" as const, itemIds: [] }], untagged: [], itemCount: 3 },
      { roleId: "role-water", name: "Water keeper", lines: [{ words: "Keep the water clean", kind: "accountability" as const, itemIds: ["mi-5"] }], untagged: [], itemCount: 1 },
    ],
    outsideMyRoles: [],
    seasonGoals: [],
    ownGoals: [],
    rolesWithNoItems: [],
  };

  it("grows each role's own work in its own bed, and says resting soil plainly", () => {
    renderMoon({ roles: TWO_ROLES, items, coverage });
    const beds = screen.getAllByTestId("role-bed");
    expect(beds).toHaveLength(2);
    expect(beds[0].querySelector("svg")?.getAttribute("aria-label")).toBe("The Seed keeper bed: 1 flowered, 1 in bud, 1 sprouting");
    expect(beds[0].querySelectorAll("[data-plant]")).toHaveLength(3);
    expect(beds[1].querySelector("svg")?.getAttribute("aria-label")).toBe("The Water keeper bed: 1 seed kept");
    expect(screen.getAllByTestId("resting-line").map((n) => n.textContent)).toEqual(["Resting soil this moon"]);
    // Phone swipes between beds; desktop sets them side by side.
    expect(screen.getByTestId("role-beds-row").className).toContain("snap-x");
    expect(screen.getByTestId("role-beds-row").className).toContain("lg:grid-cols-2");
  });

  it("keeps the beds on the member's own board: Room view takes them away", () => {
    renderMoon({ roles: TWO_ROLES, items, coverage });
    fireEvent.click(screen.getByRole("button", { name: MOON_WORDS.roomView }));
    expect(screen.queryAllByTestId("role-bed")).toHaveLength(0);
    // The role cards themselves stay, as words.
    expect(screen.getAllByTestId("coverage-role")).toHaveLength(2);
  });
});
