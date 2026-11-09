// @vitest-environment jsdom
/**
 * Roles open now, under a character: the open untagged roles with their apply
 * links, the role ideas a village's chart does not carry yet, and always one
 * thing to do when both are empty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const loadOrg = vi.hoisted(() => vi.fn());
vi.mock("@/components/governance/pickSources", () => ({ loadOrg }));

import RolesOpenNow from "./RolesOpenNow";

beforeEach(() => loadOrg.mockReset());

describe("RolesOpenNow", () => {
  it("lists open roles tagged for no character, each with its own apply link", async () => {
    loadOrg.mockResolvedValue({ roles: [{ name: "Water keeper" }] });
    render(<RolesOpenNow archetypeKey="building" alsoOpen={[{ id: "water", name: "Water keeper", recruiting: true }]} />);
    const link = await screen.findByText("Apply for Water keeper");
    expect(link.closest("a")?.getAttribute("href")).toContain("seat=water");
    expect(screen.getByText("Also open in the village, for anyone:")).toBeTruthy();
  });

  it("offers the Catalyst its investment, crowd pooling and weaving roles, minus the ones the chart has", async () => {
    loadOrg.mockResolvedValue({ roles: [{ name: "Village Weaver" }] });
    render(<RolesOpenNow archetypeKey="catalyzing" alsoOpen={[]} />);
    expect(await screen.findByText("Investment and Partnerships")).toBeTruthy();
    expect(screen.getByText("Crowd Pool Steward")).toBeTruthy();
    expect(screen.queryByText("Village Weaver")).toBeNull();
    expect(screen.getByText("Propose a new role").closest("a")?.getAttribute("href")).toBe("/role-proposals/new");
  });

  it("always leaves one thing to do when nothing is open and there is no idea to offer", async () => {
    loadOrg.mockResolvedValue({ roles: [] });
    render(<RolesOpenNow archetypeKey="storytelling" alsoOpen={[]} />);
    expect(await screen.findByText(/No role is open right now./)).toBeTruthy();
    expect(screen.getByText("Try a quest on the board").closest("a")?.getAttribute("href")).toBe("/quests");
  });
});
