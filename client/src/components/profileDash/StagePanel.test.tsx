// @vitest-environment jsdom
/**
 * DOORS OPEN TO YOU (the prune). The panel draws the doors walked through,
 * named by what they let a person do, and never the rung, the ladder strip,
 * "stage n of m" or a countdown to the next rung.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import StagePanel from "./StagePanel";

afterEach(cleanup);

const stages = [{ id: "guest" }, { id: "member" }, { id: "contributor" }];
const catalogue = [
  { label: "Say you are coming to a gathering", held: true, opens: { via: "stage" as const, stage: "guest" } },
  { label: "Cast a vote on a ballot", held: true, opens: { via: "stage" as const, stage: "member" } },
  { label: "Vouch for an applicant", held: false, opens: { via: "stage" as const, stage: "contributor" } },
  { label: "Seat roles", held: true, opens: { via: "appointment" as const } },
];

describe("StagePanel", () => {
  it("names each door walked through and nothing ahead", () => {
    const { container } = render(
      <Router>
        <StagePanel catalogue={catalogue} stages={stages} nextAction={null} />
      </Router>,
    );
    expect(screen.getByText("Doors open to you")).toBeTruthy();
    expect(screen.getByText("You can now cast a vote on a ballot")).toBeTruthy();
    expect(screen.getByText("You can now say you are coming to a gathering")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Vouch|Seat roles|Stage reached|You are a|stage \d+ of \d+|consented/i);
    expect(container.querySelector("ol")).toBeNull();
  });

  it("carries the one next step, without naming the next rung", () => {
    render(
      <Router>
        <StagePanel catalogue={catalogue} stages={stages} nextAction={{ label: "Consent a quest", href: "/quests" }} />
      </Router>,
    );
    expect(screen.getByText("Your next step")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Go/ }).getAttribute("href")).toBe("/quests");
  });
});
