// @vitest-environment jsdom
/**
 * The builder's journey on the Module Library page: five steps, three worked
 * examples, and the block a builder hands their agent, with its copy button.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import BuilderJourney, { BUILDER_JOURNEY_ID } from "./BuilderJourney";
import { MODULE_CONTRACT_URL, START_HERE_URL, agentHandoffText } from "@shared/builderJourney";

describe("BuilderJourney", () => {
  it("shows the five steps, the examples and the agent block, under an anchor the shelf card links to", () => {
    const { container } = render(<BuilderJourney />);
    expect(container.querySelector(`#${BUILDER_JOURNEY_ID}`)).toBeTruthy();
    expect(screen.getAllByText(/^Step \d$/)).toHaveLength(5);
    expect(screen.getByText("node scripts/module-facts.mjs")).toBeTruthy();
    expect(screen.getByText("The Module Library contract ↗").closest("a")?.getAttribute("href")).toBe(MODULE_CONTRACT_URL);
    expect(screen.getByText("START_HERE ↗").closest("a")?.getAttribute("href")).toBe(START_HERE_URL);
    expect(screen.getByText(/A connected tool/)).toBeTruthy();
    expect(screen.getByText(/A personal practice: Gene Keys/)).toBeTruthy();
    expect(screen.getByText(/A shared ritual: live sessions/)).toBeTruthy();
  });

  it("copies the agent text, and says how to copy by hand when the browser refuses", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<BuilderJourney />);
    fireEvent.click(screen.getByText("Copy for your agent"));
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(agentHandoffText());
    fireEvent.click(screen.getByText("Copied"));
    await waitFor(() => expect(screen.getByText(/Your browser blocked copying/)).toBeTruthy());
  });
});
