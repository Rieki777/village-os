// @vitest-environment jsdom
/**
 * Proposing next season's roles: each role says what it pays before it is
 * picked (Rye, 2026-10-30), from the `/api/org` answer the step already reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import StepRoles from "./StepRoles";

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));
afterEach(cleanup);

const ORG = {
  roles: [
    {
      id: "r1",
      name: "Water keeper",
      circleId: "c-land",
      seats: 1,
      holderCount: 0,
      holders: [],
      pay: { value: null, lines: [{ token: "village-credit", name: "Village Credits", amount: 12 }], source: "own" as const, cadence: "cycle" as const },
    },
    { id: "r2", name: "Seed keeper", circleId: "c-land", seats: 1, holderCount: 0, holders: [] },
  ],
  circles: [{ id: "c-land", name: "Land circle", purpose: "The land thrives." }],
};

describe("step 1's pay", () => {
  it("shows each role's pay where the chart sends it", () => {
    render(
      <StepRoles
        proposal={{ roles: [], limits: { maxRoles: 5 } } as any}
        picked={[]}
        newRoles={[]}
        org={ORG}
        applying={new Map()}
        me="u-me"
        onToggle={() => {}}
        onAddNew={async () => null}
        onRemoveNew={() => {}}
      />,
    );
    const water = screen.getByText("Water keeper").closest("label")!;
    expect(water.textContent).toContain("12 Village Credits each cycle");
    const seed = screen.getByText("Seed keeper").closest("label")!;
    expect(seed.querySelector("[data-work-pay]")).toBeNull();
  });
});
