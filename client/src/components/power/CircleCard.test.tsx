// @vitest-environment jsdom
/**
 * The map's circle inspector links to the circle's own card (`/circles/:id`),
 * the circle's home page, where its words, roles and live parts are.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/CircleScene", () => ({ default: () => null }));

import CircleCard from "./CircleCard";

afterEach(cleanup);

const data: any = {
  circles: [{ id: "c-garden", name: "Garden circle", parentCircleId: null }],
  roles: [],
  power: { glossary: { decidesBy: [] } },
};

describe("the map's circle inspector", () => {
  it("opens the circle's own card", () => {
    render(
      <CircleCard
        circle={{ id: "c-garden", name: "Garden circle", purpose: "Grow food together.", status: "active", isExample: false } as any}
        data={data}
        onSelectSeat={() => undefined}
        onOut={() => undefined}
      />,
    );
    expect(screen.getByRole("link", { name: "Open this circle's card" }).getAttribute("href")).toBe("/circles/c-garden");
  });
});
