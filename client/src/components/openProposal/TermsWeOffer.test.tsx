// @vitest-environment jsdom
/**
 * TERMS WE OFFER (audit M5, 11 Nov 2026): typed counter-offer words are never lost quietly. A change
 * puts the house save bar up, leaving the page asks first while it waits, and saving from the bar
 * posts the revision the panel read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { resetUnsavedForTests, unsavedCount } from "@/lib/unsavedChanges";
import TermsWeOffer, { type ServedDeciderOffer } from "./TermsWeOffer";

const OFFER: ServedDeciderOffer = {
  revision: 1,
  rows: [{ key: "ending", label: "Ending", suggested: "One moon's notice.", current: "One moon's notice.", theirs: { choice: "talk", note: "Two?" }, state: "talk", changed: false }],
  theirCommitment: 60,
  roleCommitment: 100,
  ourCommitment: 60,
  history: [],
  openTalks: ["Ending"],
};

const bar = () => document.querySelector("[data-save-bar]");

describe("the counter-offer keeps what was typed", () => {
  afterEach(() => {
    cleanup();
    resetUnsavedForTests();
    vi.unstubAllGlobals();
  });

  it("puts the save bar up on a change, guards leaving, and saves revision 2 from the bar", async () => {
    const posted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        posted.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    const saved = vi.fn();
    render(<TermsWeOffer offer={OFFER} mayEdit savePath="/api/x/terms" onSaved={saved} />);
    expect(bar()).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Two moons' notice." } });
    await waitFor(() => expect(bar()).not.toBeNull());
    expect(unsavedCount()).toBe(1);
    expect(bar()?.textContent).toContain("Revision 2 of the terms");
    const inBar = (bar() as HTMLElement).querySelectorAll("button");
    fireEvent.click(Array.from(inBar).find((b) => b.textContent === "Save") as HTMLButtonElement);
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(posted[0]).toMatchObject({ expectedRevision: 1, words: { ending: "Two moons' notice." } });
    expect(unsavedCount()).toBe(0);
  });
});
