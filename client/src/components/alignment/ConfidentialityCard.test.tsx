// @vitest-environment jsdom
/**
 * THE CONFIDENTIALITY CARD ON /aligned, WITH ITS DOCUMENT (role journey L7).
 *
 *   - an attached document shows its title and a button that fetches the PDF
 *     with the member's own token, never a bare link a visitor could follow;
 *   - CONTROL: no document, no button;
 *   - a visitor's answer (no agreement) draws nothing at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/gameApi", () => ({ useSeason: () => ({ timezone: "UTC" }), authToken: () => "member-token" }));
vi.mock("@/components/auth/ConfirmWithGoogle", () => ({
  IdentityConfirmField: () => null,
  identityBody: () => ({}),
  identityReady: () => false,
  useIdentityConfirm: () => ({ confirmWith: "password", confirmed: false, reset: () => undefined }),
}));

import ConfidentialityCard from "./ConfidentialityCard";

const AGREEMENT = { title: "Confidentiality agreement", body: "Keep it to yourself.\n", intent: "I align with the Confidentiality agreement.", version: "cv-0123456789abcdef" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the confidentiality card", () => {
  it("shows the attached document's title, and opens it by fetching with the member's token", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
        if (url === "/api/confidentiality") return json({ agreement: { ...AGREEMENT, document: { title: "Example NDA", size: 2048, href: "/api/confidentiality/document" } }, you: { holds: false } });
        return new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), { status: 200 });
      }),
    );
    vi.stubGlobal("open", vi.fn(() => ({})));
    (URL as any).createObjectURL = vi.fn(() => "blob:agreement");
    (URL as any).revokeObjectURL = vi.fn();
    render(<ConfidentialityCard />);
    const button = await screen.findByRole("button", { name: "Read Example NDA (PDF)" });
    // A button, not a link: a bare href would carry no token and could be shared.
    expect(document.querySelector('a[href="/api/confidentiality/document"]')).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.url === "/api/confidentiality/document")).toBe(true));
    expect(calls.find((c) => c.url === "/api/confidentiality/document")?.auth).toMatch(/^Bearer /);
  });

  it("CONTROL: with no document there is no button; a visitor's answer draws nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ agreement: { ...AGREEMENT, document: null }, you: { holds: false } })));
    render(<ConfidentialityCard />);
    expect(await screen.findByText(AGREEMENT.intent)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /\(PDF\)/ })).toBeNull();
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => json({ agreement: null, exists: true, you: null })));
    const { container } = render(<ConfidentialityCard />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});
