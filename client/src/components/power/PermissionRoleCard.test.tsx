// @vitest-environment jsdom
/**
 * THE PERMISSION FACE, RENDERED: a role a vote seats somebody into, as the
 * proposal wizard will preview it.
 *
 * It prints only what a role-seat ballot can back up: the powers by their
 * real labels (a raw capability key never reaches the page), every rung the
 * village serves around the one the role asks for, and the sentence the vote
 * enforces. Its figures sit two by two until the container is 420px wide,
 * because four up overflowed the 288px rail by 6px.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CAPABILITY_LABELS } from "@shared/capabilities";
import { GAME_CONFIG } from "@shared/gameConfig";
import { fromPermissionRole } from "@shared/roleSheetInputs";
import PermissionRoleCard from "./PermissionRoleCard";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const STAGES = GAME_CONFIG.stages.map((s) => ({ id: s.id, name: s.name }));
const ROLE = {
  id: "treasurer",
  name: "Treasurer",
  description: "Keeps the books.",
  capabilities: ["exchange.manage", "redemption.confirm", "made.up.power"],
  minStage: "co-creator",
  isExample: false,
  seats: 3,
  holderCount: 1,
  holders: [{ userId: "u-mara", name: "Mara" }],
};

const show = (role: object = ROLE, stages: typeof STAGES | null = STAGES) =>
  render(<PermissionRoleCard input={fromPermissionRole(role, { signedIn: true })} ctx={{ stages, roleWord: "Role", now: NOW }} />);

describe("PermissionRoleCard", () => {
  it("names its powers by their labels, and never prints a key", () => {
    show();
    expect(screen.getByText(CAPABILITY_LABELS["exchange.manage"])).toBeTruthy();
    expect(screen.getByText(CAPABILITY_LABELS["redemption.confirm"])).toBeTruthy();
    expect(screen.getByText("A power this page cannot name yet")).toBeTruthy();
    // Control: the key really is in the input, and nowhere on the page.
    expect(JSON.stringify(ROLE)).toContain("made.up.power");
    for (const key of ROLE.capabilities) expect(document.body.textContent).not.toContain(key);
    expect(screen.getByText("A role with powers")).toBeTruthy();
  });

  it("draws all twelve served rungs, names verbatim, around the one it asks for", () => {
    show();
    expect(STAGES).toHaveLength(12);
    const rungs = Array.from(document.querySelectorAll("ol > li"));
    expect(rungs).toHaveLength(12);
    expect(screen.getByText("Co-Creator")).toBeTruthy();
    const current = document.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Co-Creator");
    expect(screen.getByText("Asks for Co-Creator or above. The vote turns away anyone on a lower rung.")).toBeTruthy();
  });

  it("says so plainly when no rung is asked, or the rung is one the village no longer names", () => {
    const { unmount } = show({ ...ROLE, minStage: null });
    expect(screen.getByText("This role asks for no rung.")).toBeTruthy();
    expect(document.querySelectorAll("ol > li")).toHaveLength(0);
    unmount();
    show({ ...ROLE, minStage: "archmage" });
    expect(screen.getByText("Asks for a rung this village no longer names.")).toBeTruthy();
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
  });

  it("fills an open place by a vote, and counts Seated, never Held now", () => {
    show();
    expect(screen.getAllByText("A vote fills this place")).toHaveLength(2);
    expect(screen.getByText("Seated")).toBeTruthy();
    expect(screen.queryByText("Held now")).toBeNull();
    expect(screen.queryByRole("button", { name: /Raise your hand/ })).toBeNull();
  });

  it("sets its figures two by two below a 420px container and four up above", () => {
    show();
    const figures = document.querySelector('dl[aria-label="Right now"]')!;
    const classes = figures.getAttribute("class")!.split(/\s+/);
    expect(classes).toContain("grid-cols-2");
    expect(classes).toContain("@min-[420px]:grid-cols-4");
    expect(figures.querySelectorAll("dt").length).toBe(4);
  });

  it("says when nobody has written what the role does", () => {
    show({ ...ROLE, description: "" });
    expect(screen.getByText("Nobody has written down what this role does yet.")).toBeTruthy();
  });
});
