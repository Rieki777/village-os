// @vitest-environment jsdom
/**
 * "WHAT YOU HAVE ALIGNED WITH" ON A PROFILE (seat settings PR5).
 *
 *   - your own: waiting on you first, with Align, then in force, then ended;
 *     every row a receipt;
 *   - empty: says so;
 *   - another member's, for a reader the server answers: their rows, no Align,
 *     no hash; a 401 renders nothing at all (visitors get nothing).
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import AlignedSection, { sortForSheet } from "./AlignedSection";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const HASH = "d".repeat(64);
const row = (over: Record<string, unknown>) => ({
  textId: "at-0000000000000001",
  title: "Terms for Orchard steward",
  body: "Terms for Orchard steward\n",
  version: 1,
  seatNames: ["Orchard steward"],
  href: "/seat-applications/sa-0000000000000001",
  state: "in-force",
  why: null,
  sealed: true,
  money: false,
  parties: [
    { partyKey: "user:u-ana", label: "Ana Quillfeather", capacity: "individually", required: true, aligned: true, at: "2026-10-09T10:00:00.000Z", method: "click" },
    { partyKey: "village", label: "The village", capacity: "for the village", required: true, aligned: true, at: "2026-10-09T11:00:00.000Z", method: "ballot" },
  ],
  you: { partyKey: "user:u-ana", aligned: true, alignedAt: "2026-10-09T10:00:00.000Z", mayAlign: false },
  contentHash: HASH,
  createdAt: "2026-10-09T00:00:00.000Z",
  ...over,
});

const ROWS = [
  row({ textId: "at-0000000000000003", title: "Terms for Ledger keeper", state: "ended", why: "The seating these terms were held on has ended." }),
  row({ textId: "at-0000000000000001" }),
  row({
    textId: "at-0000000000000002",
    title: "Terms for Platform steward",
    state: "pending",
    why: "Waiting for every party to align.",
    sealed: false,
    you: { partyKey: "user:u-ana", aligned: false, alignedAt: null, mayAlign: true },
  }),
];

const serve = (byUrl: Record<string, () => Response>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (byUrl[url] ? byUrl[url]() : json({}))),
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("your own", () => {
  it("orders waiting on you first, then in force, then ended, with Align on the waiting one and a receipt on each", async () => {
    serve({ "/api/profile/alignments": () => json({ alignments: ROWS }) });
    render(<AlignedSection />);
    expect(await screen.findByRole("heading", { name: "What you have aligned with" })).toBeTruthy();
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Terms for Platform steward", "Terms for Orchard steward", "Terms for Ledger keeper"]);
    expect(screen.getAllByRole("button", { name: "Align" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Download the receipt" })).toHaveLength(3);
    expect(screen.getByText("In force")).toBeTruthy();
    expect(screen.getByText("Ended")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    // The hash lives in the receipt, never on the page.
    expect(document.body.textContent).not.toContain(HASH);
  });

  it("says so when there is nothing yet", async () => {
    serve({ "/api/profile/alignments": () => json({ alignments: [] }) });
    render(<AlignedSection />);
    expect(await screen.findByText("Nothing yet. When you apply for seats, the terms you align with are kept here.")).toBeTruthy();
  });

  it("sorts by state when nobody waits on you", () => {
    const out = sortForSheet([row({ textId: "a", state: "ended" }), row({ textId: "b", state: "pending" }), row({ textId: "c" })] as any);
    expect(out.map((r) => r.state)).toEqual(["pending", "in-force", "ended"]);
  });
});

describe("another member's", () => {
  it("a 401 renders nothing at all", async () => {
    serve({ "/api/alignments?party=anaq": () => json({ error: "auth_required" }, 401) });
    const { container } = render(<AlignedSection handle="anaq" />);
    await waitFor(() => expect((fetch as any).mock.calls.length).toBe(1));
    expect(container.innerHTML).toBe("");
  });

  it("CONTROL: a member reader sees their rows, with no Align and no receipt", async () => {
    serve({ "/api/alignments?party=anaq": () => json({ alignments: ROWS.map((r) => ({ ...r, you: null, contentHash: null })) }) });
    render(<AlignedSection handle="anaq" />);
    expect(await screen.findByRole("heading", { name: "What they have aligned with" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Align" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download the receipt" })).toBeNull();
  });
});
