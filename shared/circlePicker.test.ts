import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { anchorCircleId, circleStanding, groupCircles, matchCircles, soleOperatingId, withAnchor } from "./circlePicker";

const row = (id: string, name: string, extra: object = {}) => ({ id, name, ...extra });

describe("circle picker ordering and grouping", () => {
  const rows = [
    row("b", "Zeta", { status: "active" }),
    row("f", "Alpha forming", { status: "forming" }),
    row("d", "Gone", { status: "dormant" }),
    row("a", "Beta", { status: "active", isAnchor: true }),
    row("e", "Example", { status: "active", isExample: true }),
  ];
  it("puts operating first with the anchor leading, then forming, and hides dormant and examples", () => {
    const g = groupCircles(withAnchor(rows));
    expect(g.operating.map((c) => c.id)).toEqual(["a", "b"]);
    expect(g.forming.map((c) => c.id)).toEqual(["f"]);
  });
  it("reads a missing status as operating, as every circle was before the field mattered", () => {
    expect(circleStanding(undefined)).toBe("operating");
    expect(circleStanding("forming")).toBe("forming");
    expect(circleStanding("dormant")).toBe("hidden");
  });
  it("offers a default only when exactly one circle operates", () => {
    expect(soleOperatingId([row("x", "X", { status: "active" }), row("y", "Y", { status: "forming" })])).toBe("x");
    expect(soleOperatingId(rows)).toBeNull();
  });
  it("searches by name", () => {
    expect(matchCircles(rows, "ALPHA").map((c) => c.id)).toEqual(["f"]);
    expect(matchCircles(rows, " ")).toHaveLength(rows.length);
  });
});

describe("the anchor comes from data", () => {
  it("is the marked circle, whatever it is called", () => {
    expect(anchorCircleId([row("p", "Any name"), row("q", "Other", { isAnchor: true })])).toBe("q");
  });
  it("falls back to the circle that coordinates the others", () => {
    expect(anchorCircleId([row("top", "Top"), row("kid", "Kid", { parentCircleId: "top" })])).toBe("top");
  });
  it("is none for flat circles", () => {
    expect(anchorCircleId([row("p", "P"), row("q", "Q")])).toBeNull();
  });
  it("names no circle in the shared module or the picker components", () => {
    for (const f of ["shared/circlePicker.ts", "client/src/components/circles/CirclePicker.tsx", "client/src/components/circles/CircleName.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/General Coordinating|Anchor Circle/);
    }
  });
});
