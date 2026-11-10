// @vitest-environment jsdom
/**
 * THE STEPS BEFORE A ROLE STARTS, ON THE PROFILE (role journey L7).
 *
 *   - a waiting role draws "Two steps before your role starts", the
 *     confidentiality agreement to align with right there, and a door to the
 *     membership letter;
 *   - CONTROL: nothing waiting draws nothing, so a holder whose role started
 *     is never told about steps.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { START_WORDS } from "@shared/roleStartWords";

vi.mock("@/lib/gameApi", () => ({ useSeason: () => ({ timezone: "UTC" }), authToken: () => "member-token" }));
vi.mock("@/components/auth/ConfirmWithGoogle", () => ({
  IdentityConfirmField: () => null,
  identityBody: () => ({}),
  identityReady: () => false,
  useIdentityConfirm: () => ({ confirmWith: "password", confirmed: false, reset: () => undefined }),
}));

import RoleStartSteps from "./RoleStartSteps";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
const AGREEMENT = { title: "Confidentiality agreement", body: "Keep it to yourself.\n", intent: "I align with the Confidentiality agreement.", version: "cv-0123456789abcdef", document: null };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the steps before a role starts, on the profile", () => {
  it("names the steps, lets the holder align with the agreement right there, and opens the letter's door", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/profile/role-start-steps")
          return json({ waiting: [{ applicationId: "sa-1", roles: ["Gate Keeper"], steps: [{ step: "confidentiality", href: "/aligned" }, { step: "membership", href: "/love-letter" }] }] });
        if (url === "/api/confidentiality") return json({ agreement: AGREEMENT, you: { holds: false } });
        return json({});
      }),
    );
    render(<RoleStartSteps />);
    expect(await screen.findByRole("heading", { name: START_WORDS.title(2) })).toBeTruthy();
    expect(screen.getByText("Gate Keeper")).toBeTruthy();
    // The agreement is aligned with in place, not somewhere the holder has to find.
    expect(await screen.findByText(AGREEMENT.intent)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Align" })).toBeTruthy();
    expect(screen.getByRole("link", { name: START_WORDS.step.membership }).getAttribute("href")).toBe("/love-letter");
    expect(screen.getByText(START_WORDS.after)).toBeTruthy();
  });

  it("CONTROL: nothing waiting draws nothing", async () => {
    const fetch = vi.fn(async () => json({ waiting: [] }));
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<RoleStartSteps />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
