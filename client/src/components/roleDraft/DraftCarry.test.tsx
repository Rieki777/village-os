// @vitest-environment jsdom
/**
 * WHAT A NEWCOMER DRAFTED, WAITING AFTER SIGN-UP (role draft board, 9 Nov).
 * The draft lives in the browser they drafted in. On the character page it
 * offers the characters they picked and the roles they drafted, and they
 * choose what to keep; nothing is joined or proposed for them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ROLE_DRAFT_KEY } from "@shared/roleDraft";
import DraftCarry from "./DraftCarry";

const CAST = [
  { key: "catalyzing", name: "The Catalyst" },
  { key: "facilitating", name: "The Spaceholder" },
];

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("DraftCarry", () => {
  it("says nothing when there is no draft", () => {
    const { container } = render(<DraftCarry cast={CAST} roleNames={{}} onPickCharacter={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("offers each drafted character on the stage, and the drafted roles to propose", () => {
    localStorage.setItem(ROLE_DRAFT_KEY, JSON.stringify({ chars: ["catalyzing", "facilitating"], picks: ["lfs", "garden"] }));
    const pick = vi.fn();
    render(<DraftCarry cast={CAST} roleNames={{ lfs: "Lead Financial Steward" }} onPickCharacter={pick} />);
    fireEvent.click(screen.getByRole("button", { name: "Show The Spaceholder" }));
    expect(pick).toHaveBeenCalledWith("facilitating");
    expect(screen.getByText(/Lead Financial Steward/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Propose my roles/ }).getAttribute("href")).toBe("/role-proposals/new?role=lfs&path=quick");
  });

  it("clears the draft when they are done with it", () => {
    localStorage.setItem(ROLE_DRAFT_KEY, JSON.stringify({ chars: ["catalyzing"], picks: [] }));
    render(<DraftCarry cast={CAST} roleNames={{}} onPickCharacter={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear my draft" }));
    expect(localStorage.getItem(ROLE_DRAFT_KEY)).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear my draft" })).toBeNull();
  });
});
