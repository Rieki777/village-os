// @vitest-environment jsdom
/**
 * The circle card drawn from the real model: purpose first, plain headings
 * that show their CCOS term on hover or tap, the roles with their card links,
 * and the adoption record.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CircleCardView from "./CircleCardView";
import { buildCircleCard, type CircleCardIn } from "@shared/circleCard";
import { EMPTY_CHARTER } from "@shared/circleCharter";

afterEach(cleanup);

const input = (over: Partial<CircleCardIn> = {}): CircleCardIn => ({
  circle: { id: "c-garden", name: "Garden circle", purpose: "Grow food together.", status: "active", parent: { id: "c-root", name: "Coordinating circle" } },
  charter: {
    ...EMPTY_CHARTER,
    existsWhile: "the village eats from its own land",
    accountabilities: ["Fresh food each week", "Richer soil each season", "Seeds kept for next year"],
    domains: ["The food forest"],
    values: [{ value: "Reciprocity", practice: "We share every harvest first." }],
  },
  roles: [
    { id: "r-water", name: "Water Keeper", capacity: 1, holderCount: 1, state: "filled", holderHandles: ["cai"] },
    { id: "r-seed", name: "Seed Librarian", capacity: 1, holderCount: 0, state: "open", holderHandles: [] },
  ],
  adoptions: [{ draftId: "d-1", publishedAt: "2026-09-04T10:00:00Z", byVote: true, created: true }],
  timeZone: "UTC",
  frameworkTerms: true,
  ...over,
});

describe("the circle card, drawn", () => {
  it("leads with the purpose, then what the circle answers for, and reads every written word", () => {
    // Terms off, so the closed tooltips' words do not sit in the text between a label and its words.
    render(<CircleCardView card={buildCircleCard(input({ frameworkTerms: false }))} />);
    const text = document.querySelector("[data-circle-card]")!.textContent ?? "";
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Garden circle");
    expect(text.indexOf("Grow food together.")).toBeLessThan(text.indexOf("What you can count on us for"));
    expect(text).toContain("This circle exists while the village eats from its own land");
    expect(text).toContain("Seeds kept for next year");
    expect(text).toContain("Reciprocity:");
    expect(text).toContain("Adopted by a village vote on 4 Sep 2026");
    expect(screen.getByRole("link", { name: "Coordinating circle" }).getAttribute("href")).toBe("/circles/c-root");
  });

  it("shows the CCOS term when a heading is tapped, and describes the heading with it", () => {
    render(<CircleCardView card={buildCircleCard(input())} />);
    const trigger = screen.getByRole("button", { name: "What we look after" });
    const tip = document.getElementById(trigger.getAttribute("aria-describedby")!)!;
    expect(tip.textContent).toBe("CCOS: Domains");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("draws plain headings with no trigger when the village turned the terms off", () => {
    render(<CircleCardView card={buildCircleCard(input({ frameworkTerms: false }))} />);
    expect(screen.queryByRole("button", { name: "What we look after" })).toBeNull();
    expect(screen.getByRole("heading", { name: "What we look after" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("CCOS");
  });

  it("links a filled role's holder card by the role's name, and offers Apply on an open role", () => {
    render(<CircleCardView card={buildCircleCard(input())} />);
    const card = screen.getByRole("link", { name: "See the card of the holder of Water Keeper" });
    expect(card.getAttribute("href")).toBe("/profile/cai#role-r-water");
    expect(card.textContent).toBe("See their card");
    expect(screen.getByRole("link", { name: "Apply for this role" }).getAttribute("href")).toBe("/propose?type=role_application&seat=r-seed");
    expect(screen.getByRole("link", { name: "Water Keeper" }).getAttribute("href")).toBe("/roles?seat=r-water");
  });

  it("says Not written yet for each unwritten section", () => {
    render(<CircleCardView card={buildCircleCard(input({ charter: null, frameworkTerms: false }))} />);
    expect(screen.getAllByText("Not written yet").length).toBe(10);
    expect(document.body.textContent).toContain("This circle exists while: not written yet");
  });
});
