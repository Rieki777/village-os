// @vitest-environment jsdom
/**
 * THE REVIEW STEP SHOWS THE EXACT WORDS (seat settings PR5).
 *
 *   - the words come from the server's `words` route, and are what the step
 *     reports back for `alignedWords`;
 *   - terms with no money are ready at once, with no confirmation;
 *   - MONEY with a stale confirmation shows the re-confirm in place and holds
 *     the button until it passes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AlignmentReview, { type ReviewAlignment } from "./AlignmentReview";

vi.mock("@/components/natural", () => ({ BreathingLoader: ({ label }: { label: string }) => <p>{label}</p> }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const WORDS = "Terms for Orchard steward\n\nTHE SEAT\n  Orchard steward\n";
let money = false;
let fresh = false;
const asked: string[] = [];

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/governance/role-applications/words") {
        return json({ title: "Terms for Orchard steward", body: WORDS, money, intent: "I align with these terms for Orchard steward." });
      }
      if (url === "/api/profile/alignments/confirm" && init?.method === "POST") return json({ success: true, fresh: true, freshUntil: null, confirmWith: "password" });
      if (url === "/api/profile/alignments/confirm") return json({ fresh, freshUntil: null, confirmWith: "password" });
      if (url === "/api/auth/confirm-methods") return json({ confirmWith: "password" });
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the words at Review", () => {
  it("shows the server's words and reports them back, ready at once when no money is in them", async () => {
    money = false;
    const states: ReviewAlignment[] = [];
    render(<AlignmentReview body={{ seatIds: ["s-1"] }} onState={(s) => states.push(s)} />);
    await screen.findByText((_, el) => el?.getAttribute("data-alignment-words") === "" && el.textContent === WORDS);
    await waitFor(() => expect(states.at(-1)).toEqual({ words: WORDS, ready: true }));
    expect(screen.queryByPlaceholderText("Your password")).toBeNull();
    expect(asked).not.toContain("GET /api/profile/alignments/confirm");
  });

  it("MONEY with a stale confirmation holds the button until the member confirms", async () => {
    money = true;
    fresh = false;
    const states: ReviewAlignment[] = [];
    render(<AlignmentReview body={{ seatIds: ["s-1"] }} onState={(s) => states.push(s)} />);
    expect(await screen.findByText("These terms carry money, so the village asks you to confirm it is you before you align.")).toBeTruthy();
    expect(states.at(-1)?.ready).toBe(false);
    fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "right horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm it is you" }));
    await waitFor(() => expect(states.at(-1)).toEqual({ words: WORDS, ready: true }));
  });

  it("the password box is labelled, offers the saved password, and Enter confirms (red team U8)", async () => {
    money = true;
    fresh = false;
    const states: ReviewAlignment[] = [];
    render(<AlignmentReview body={{ seatIds: ["s-1"] }} onState={(s) => states.push(s)} />);
    const box = (await screen.findByLabelText("Your password")) as HTMLInputElement;
    expect(box.getAttribute("autocomplete")).toBe("current-password");
    fireEvent.change(box, { target: { value: "right horse battery" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(asked).toContain("POST /api/profile/alignments/confirm"));
    await waitFor(() => expect(states.at(-1)).toEqual({ words: WORDS, ready: true }));
  });

  it("CONTROL: money with a fresh confirmation is ready without asking again", async () => {
    money = true;
    fresh = true;
    const states: ReviewAlignment[] = [];
    render(<AlignmentReview body={{ seatIds: ["s-1"] }} onState={(s) => states.push(s)} />);
    await waitFor(() => expect(states.at(-1)).toEqual({ words: WORDS, ready: true }));
    expect(screen.queryByPlaceholderText("Your password")).toBeNull();
  });
});
