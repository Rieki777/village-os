// @vitest-environment jsdom
/**
 * What the Propose a Quest page says once an idea has been sent.
 *
 * THE DEFECT: an idea past the open-idea allowance, or carrying an email
 * address in its words, is stored in the team's inbox and never reaches the
 * review queue (server/lib/publicForms.ts). The page said "Your Quest idea is
 * in." for those too, so a person waited on a queue their idea was never in.
 * `POST /api/forms/submit` now answers where the idea went, and these hold the
 * page to saying it, with the reason in words its sender can act on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => null,
  fetchConfigCached: async () => ({ project: { name: "Sample Village" } }),
  // The registry's names by slug, as GET /api/game/config serves them.
  useGameConfig: () => ({
    currency: { name: "Gratitude", names: { gratitude: "Gratitude", credits: "Village Credits", "earned-equity": "Earned Equity" } },
  }),
}));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Gratitude" }));
// The guided chat is its own component and is not offered here: the assistant answers unavailable.
vi.mock("@/components/GuideChat", () => ({ default: () => null }));

import ProposeQuest from "./ProposeQuest";

const fetchMock = vi.fn();

/** Serve the page's reads, and answer the submission with `answer`. */
function serve(answer: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    const body =
      url === "/api/forms/submit" ? answer : url === "/api/assistant/status" ? { available: false } : {};
    return { ok: true, status: 200, json: async () => body };
  });
}

/** Fill the three required fields and send. */
async function send() {
  render(<ProposeQuest />);
  fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Ada Wren" } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "ada@example.test" } });
  fireEvent.change(screen.getByLabelText(/What do you want to do/), {
    target: { value: "Turn the old bookcase into a seed library." },
  });
  fireEvent.click(screen.getByRole("button", { name: /Send your Quest proposal/ }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("what the form offers as compensation", () => {
  // Rye, 2026-11-01: "Gratitude ONLY for the recognition token and NOT for the
  // credit or earned equity tokens". Gratitude never pays work, so the example
  // answer names the village's pay tokens by their registry names.
  it("names Credits and Earned Equity and never offers Gratitude", () => {
    render(<ProposeQuest />);
    const asked = screen.getByLabelText(/What compensation, if any, do you want\?/) as HTMLTextAreaElement;
    expect(asked.placeholder).not.toMatch(/gratitude/i);
    expect(asked.placeholder).toContain("Village Credits");
    expect(asked.placeholder).toContain("Earned Equity");
  });
});

describe("after a Quest idea is sent", () => {
  it("says it is in when it reached the review queue", async () => {
    serve({ success: true, id: "s1", idea: { queued: true } });
    await send();
    expect(await screen.findByText("Your Quest idea is in.")).toBeTruthy();
  });

  it("says a member's idea past the allowance was held, how many is the allowance, and what to do", async () => {
    serve({ success: true, id: "s2", idea: { queued: false, held: "over_allowance", member: true, allowance: 3 } });
    await send();
    expect(await screen.findByText("Your Quest idea is saved, and held back from review.")).toBeTruthy();
    expect(screen.queryByText("Your Quest idea is in.")).toBeNull();
    expect(screen.getByText(/It is in the Sample Village team's inbox\. It is not in the queue a steward reads/)).toBeTruthy();
    expect(screen.getByText(/You already have 3 Quest ideas waiting for a steward/)).toBeTruthy();
    expect(screen.getByText(/When a steward decides on one of yours, send this one again\./)).toBeTruthy();
  });

  it("names the visitors' shared allowance to a visitor, and the way past it", async () => {
    serve({ success: true, id: "s3", idea: { queued: false, held: "over_allowance", member: false, allowance: 10 } });
    await send();
    expect(await screen.findByText(/10 ideas from visitors are already waiting for a steward/)).toBeTruthy();
    expect(screen.getByText(/sign in and send it again/)).toBeTruthy();
  });

  it("says an idea carrying an email address was held, and sends its sender back to the form with their words kept", async () => {
    serve({ success: true, id: "s4", idea: { queued: false, held: "contained_an_email", member: false, allowance: null } });
    await send();
    expect(await screen.findByText(/Its words carry an email address/)).toBeTruthy();
    expect(screen.getByText(/Take the address out of the title and your answers, and send it again/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Change it and send again" }));
    const what = (await screen.findByLabelText(/What do you want to do/)) as HTMLTextAreaElement;
    expect(what.value).toBe("Turn the old bookcase into a seed library.");
  });

  it("reads an answer with no receipt as in, which is what an older server sends", async () => {
    serve({ success: true, id: "s5" });
    await send();
    await waitFor(() => expect(screen.getByText("Your Quest idea is in.")).toBeTruthy());
  });
});
