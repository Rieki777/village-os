// @vitest-environment jsdom
/**
 * ONE ROOT, AND THE VILLAGE LEVEL THAT WENT BLANK BEHIND IT.
 *
 * Bostock's rule is that only the children of the FOCUS carry labels and take
 * clicks; it is what keeps forty circles legible. At the village level the
 * focus is null, so "child of the focus" resolves to "has no parent".
 *
 * That was fine while Amora had fifteen parentless circles. On 2026-09-09 the
 * General Coordinating Circle became the parent of all fourteen councils,
 * which is the correct sociocratic shape and the whole point of the change.
 * Exactly one circle then had no parent, and the rule collapsed: the map
 * opened on a single big disc labelled "General Coordinating Circle" with
 * fourteen unnamed discs inside it, and not one of them clickable. The
 * structure was right and the map had stopped saying anything.
 *
 * Caught by driving the deployed site after the data change, not by any test
 * or gate: every one of them passed, because nothing in the suite had ever
 * seen a village with a single root.
 *
 * The fix is that a village with ONE root treats that root's ring as the
 * village boundary, so standing outside the village means standing inside it.
 * These hold both halves: the single-root village names and opens its
 * councils, and a many-rooted village is untouched.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PowerMap from "./PowerMap";
import { layoutNestedMap } from "@shared/mapLayout";
import type { PowerData } from "./types";

/** Amora's shape after Step 0: one root holding every council. */
const NESTED = [
  { id: "gcc", name: "General Coordinating Circle", parentCircleId: null },
  { id: "land", name: "Permaculture Council", parentCircleId: "gcc" },
  { id: "dev", name: "Development Circle", parentCircleId: "gcc" },
  { id: "care", name: "Health & Healing Council", parentCircleId: "gcc" },
  { id: "arch", name: "Architecture Circle", parentCircleId: "dev" },
];

/** Amora's shape BEFORE it, which must keep working for every fork. */
const FLAT = [
  { id: "land", name: "Permaculture Council", parentCircleId: null },
  { id: "dev", name: "Development Circle", parentCircleId: null },
  { id: "care", name: "Health & Healing Council", parentCircleId: null },
];

function draw(circles: typeof NESTED, focusId: string | null = null) {
  const layout = layoutNestedMap(
    circles.map((c, i) => ({
      id: c.id, parentId: c.parentCircleId, order: i + 1, memberCount: 3,
      roles: [{ id: `${c.id}-lead`, vacant: false }], questCount: 0, name: c.name,
    })),
    [],
  );
  const data = {
    circles, relations: [], season: { current: null, nextRollAt: null },
    viewer: { viewPeople: true },
    roles: circles.map((c) => ({
      id: `${c.id}-lead`, name: `${c.name} Lead`, circleId: c.id,
      state: "filled", holderCount: 1, seats: 1, holders: [],
    })),
  } as unknown as PowerData;
  return render(
    <PowerMap
      data={data} layout={layout} shape="circle" focusId={focusId}
      onFocus={() => {}} selected={null as never} onSelect={() => {}}
      filters={{} as never} viewerUserId={null} linesOn={false}
    />,
  );
}

/*
 * REACHABLE MEANS THE BROWSER WOULD ACTUALLY DELIVER THE CLICK.
 *
 * A non-interactive circle is still IN the document with its aria-label:
 * it is drawn, it is just not a door. So "is there a button with this
 * name" answers yes for both, and an earlier version of this helper asked
 * exactly that and passed against the defect. What PowerMap actually sets
 * is `pointer-events: none` and `tabIndex -1`, so those are what to read.
 */
function reachable(name: string): boolean {
  const el = screen.queryAllByRole("button", { name: new RegExp(name, "i") })[0];
  if (!el) return false;
  return el.getAttribute("pointer-events") !== "none" && el.getAttribute("tabindex") !== "-1";
}

describe("a village whose circles all hang off one root", () => {
  it("names the councils at the village level, not just the root", () => {
    const { container } = draw(NESTED);
    const labels = Array.from(container.querySelectorAll("text")).map((t) => t.textContent ?? "").join(" ");
    // The defect: this was "General Coordinating Circle" and nothing else.
    expect(labels).toContain("Permaculture");
    expect(labels).toContain("Development");
    expect(labels).toContain("Healing");
  });

  it("lets a reader click a council without clicking the root first", () => {
    draw(NESTED);
    expect(reachable("Permaculture Council")).toBe(true);
    expect(reachable("Development Circle")).toBe(true);
  });

  it("still holds the depth rule: a grandchild is not named from outside", () => {
    // The whole point of the rule is that forty circles stay legible. Opening
    // the village must not open every level at once.
    const { container } = draw(NESTED);
    const labels = Array.from(container.querySelectorAll("text")).map((t) => t.textContent ?? "").join(" ");
    expect(labels).not.toContain("Architecture");
  });

  it("names the grandchildren once the reader is inside their parent", () => {
    const { container } = draw(NESTED, "dev");
    const labels = Array.from(container.querySelectorAll("text")).map((t) => t.textContent ?? "").join(" ");
    expect(labels).toContain("Architecture");
  });
});

describe("a village with several roots is untouched", () => {
  it("names every root at the village level, as it always did", () => {
    const { container } = draw(FLAT as typeof NESTED);
    const labels = Array.from(container.querySelectorAll("text")).map((t) => t.textContent ?? "").join(" ");
    expect(labels).toContain("Permaculture");
    expect(labels).toContain("Development");
    expect(labels).toContain("Healing");
  });

  it("keeps every root clickable", () => {
    draw(FLAT as typeof NESTED);
    expect(reachable("Permaculture Council")).toBe(true);
    expect(reachable("Health & Healing Council")).toBe(true);
  });
});
