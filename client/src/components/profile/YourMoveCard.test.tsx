// @vitest-environment jsdom
/**
 * YOUR MOVE, first on the profile (guide v2, Rye 10 Nov 2026): what waits on
 * the reader to align with, each a link to where they align; nothing when
 * nothing waits.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/gameApi", async (orig) => ({ ...(await orig<typeof import("@/lib/gameApi")>()), authToken: () => "a-token" }));
const alignments = vi.fn();
vi.mock("@/components/alignment/alignmentsApi", () => ({ fetchMyAlignments: () => alignments() }));

import YourMoveCard, { waitingOnYou } from "./YourMoveCard";

const row = (title: string, you: { aligned: boolean; mayAlign: boolean } | null, href: string | null = "/aligned#t1") =>
  ({ textId: title, title, body: "", version: 1, seatNames: [], href, state: "waiting", why: null, parties: [], you: you ? { partyKey: "me", alignedAt: null, ...you } : null }) as any;

afterEach(cleanup);

describe("Your move", () => {
  it("keeps only what waits on you: a party, not yet aligned, and free to align now", () => {
    const rows = [row("Terms for Garden Steward", { aligned: false, mayAlign: true }), row("Done already", { aligned: true, mayAlign: false }), row("Not yours", null), row("Not yet open", { aligned: false, mayAlign: false })];
    expect(waitingOnYou(rows).map((r) => r.title)).toEqual(["Terms for Garden Steward"]);
    // A response without the list waits on nothing, and never throws.
    expect(waitingOnYou(undefined)).toEqual([]);
    expect(waitingOnYou(null)).toEqual([]);
  });

  it("leads with each, linking to where you align", async () => {
    alignments.mockResolvedValue({ ok: true, data: { alignments: [row("Terms for Garden Steward", { aligned: false, mayAlign: true }, "/aligned#terms-1")] } });
    render(<YourMoveCard />);
    const link = await screen.findByRole("link", { name: /Align with Terms for Garden Steward/ });
    expect(link.getAttribute("href")).toBe("/aligned#terms-1");
    expect(screen.getByRole("heading", { name: "Your move" })).toBeTruthy();
  });

  it("draws nothing when nothing waits on you", async () => {
    alignments.mockResolvedValue({ ok: true, data: { alignments: [row("Done already", { aligned: true, mayAlign: false })] } });
    const { container } = render(<YourMoveCard />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-your-move]")).toBeNull();
  });
});
