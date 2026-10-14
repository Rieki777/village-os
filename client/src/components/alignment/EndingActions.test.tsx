// @vitest-environment jsdom
/**
 * ENDING ALIGNED TERMS, DRAWN (seat settings PR8).
 *
 *   - the card prints how the terms are ending, in the one line the server
 *     wrote, and draws only the acts the server says this reader may take;
 *   - giving notice asks once more, saying the terms' own days and that
 *     nobody is unseated, then posts to the notice door;
 *   - a running notice offers to be taken back, and a village holder sees the
 *     village's acts under their own heading;
 *   - the drawer on the live card and the register row print the same line;
 *   - another member's list shows the line and no acts.
 *
 * Copy says "align", never "sign".
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AlignmentCard from "./AlignmentCard";
import RegisterEntry from "./RegisterEntry";
import SeatTermsDrawer from "@/components/power/SeatTermsDrawer";
import AlignedSection from "@/components/profile/AlignedSection";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const NONE = { mayGiveNotice: false, notice: null, mayEndByAgreement: false, ask: null };
const OPEN = { mayGiveNotice: true, notice: null, mayEndByAgreement: true, ask: null };

const served = (over: Record<string, unknown> = {}) => ({
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
    { partyKey: "village", label: "The village", capacity: "for the village", required: true, aligned: true, at: "2026-10-09T11:00:00.000Z", method: "holder" },
  ],
  you: { partyKey: "user:u-ana", aligned: true, alignedAt: "2026-10-09T10:00:00.000Z", mayAlign: false, acts: OPEN },
  village: null,
  contentHash: "e".repeat(64),
  createdAt: "2026-10-09T00:00:00.000Z",
  endingLine: null,
  noticeDays: { days: 10, from: "ending" },
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the card", () => {
  it("gives notice after asking once more, with the terms' own days, and posts to the notice door", async () => {
    const fetchMock = vi.fn(async () => json({ endingId: "ae-0000000000000001", effectiveAt: "2026-11-09T00:00:00.000Z", alignment: null }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    render(<AlignmentCard alignment={served() as any} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Give notice" }));
    const ask = screen.getByRole("group", { name: "Give notice" });
    expect(ask.textContent).toContain("Giving notice ends these terms in 10 days.");
    expect(ask.textContent).toContain("Nothing unseats anybody");
    // CONTROL: nothing went to the notice door before the second click.
    const toNotice = () => (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).filter(([u]) => String(u).endsWith("/notice"));
    expect(toNotice()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Give notice now" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toNotice()).toHaveLength(1);
    const [url, init] = toNotice()[0];
    expect(url).toBe("/api/profile/alignments/at-0000000000000001/notice");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it("prints a running notice, offers to take it back, and draws no second notice", () => {
    render(
      <AlignmentCard
        alignment={served({ endingLine: "Notice given, ends 9 Nov 2026", you: { ...served().you, acts: { ...OPEN, mayGiveNotice: false, notice: { id: "ae-0000000000000002", endsOn: "9 Nov 2026" } } } }) as any}
      />,
    );
    expect(screen.getByText("Notice given, ends 9 Nov 2026")).toBeTruthy();
    expect(screen.getByText("Your notice runs until 9 Nov 2026.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take back the notice" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Give notice" })).toBeNull();
  });

  it("a village holder sees the village's acts under their own heading, and they post as the village", async () => {
    const fetchMock = vi.fn(async () => json({ endingId: "ae-0000000000000003", effectiveAt: "2026-10-13T00:00:00.000Z", alignment: null }, 201));
    vi.stubGlobal("fetch", fetchMock);
    render(<AlignmentCard alignment={served({ you: null, village: OPEN }) as any} />);
    expect(screen.getByText("For the village")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "End by agreement for the village" }));
    fireEvent.click(screen.getByRole("button", { name: "End by agreement" }));
    await waitFor(() => expect((fetchMock.mock.calls as unknown as Array<[string]>).some(([u]) => String(u).endsWith("/end-by-agreement"))).toBe(true));
    const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).find(([u]) => String(u).endsWith("/end-by-agreement"))!;
    expect(url).toBe("/api/profile/alignments/at-0000000000000001/end-by-agreement");
    expect(JSON.parse(String(init.body))).toEqual({ as: "village" });
  });

  it("ended terms say how in one line and offer no acts", () => {
    render(<AlignmentCard alignment={served({ state: "ended", why: "Superseded by version 2", endingLine: "Superseded by version 2", you: { ...served().you, acts: NONE } }) as any} />);
    expect(screen.getAllByText("Superseded by version 2")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /notice|agreement/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bsign/i);
  });
});

describe("the same line everywhere", () => {
  it("the drawer on the live card prints it beside the party chips", () => {
    render(
      <SeatTermsDrawer
        settings={{ v: 1, pay: { kind: "honorary" } }}
        defaultOpen
        alignment={{ state: "in-force", sealed: true, parties: served().parties, endingLine: "Notice given, ends 9 Nov 2026" }}
      />,
    );
    expect(screen.getByText("Notice given, ends 9 Nov 2026")).toBeTruthy();
  });

  it("CONTROL: the drawer with no ending prints no line", () => {
    const { container } = render(<SeatTermsDrawer settings={{ v: 1, pay: { kind: "honorary" } }} defaultOpen alignment={{ state: "in-force", sealed: true, parties: served().parties }} />);
    expect(container.querySelector("[data-ending-line]")).toBeNull();
  });

  it("the register row prints it once, never twice with the reason", () => {
    const row = {
      textId: "at-0000000000000004",
      kind: "seat_terms",
      kindLabel: "Seat terms",
      title: "Terms for Gate keeper",
      body: "Terms for Gate keeper\n",
      version: 1,
      seatNames: ["Gate keeper"],
      state: "ended",
      why: "Ended by agreement on 2 Dec 2026",
      sealed: true,
      money: false,
      parties: [],
      alignedOn: "2026-10-10",
      writtenOn: "2026-10-09",
      year: "2026",
      village: null,
      href: null,
      contentHash: null,
      endingLine: "Ended by agreement on 2 Dec 2026",
    };
    render(<RegisterEntry row={row as any} />);
    expect(screen.getAllByText("Ended by agreement on 2 Dec 2026")).toHaveLength(1);
  });

  it("another member's list shows the line and no acts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ alignments: [served({ you: null, contentHash: null, endingLine: "Notice given, ends 9 Nov 2026" })] })),
    );
    render(<AlignedSection handle="anaq" />);
    expect(await screen.findByText("Notice given, ends 9 Nov 2026")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /notice|agreement/i })).toBeNull();
  });
});

describe("on the way out", () => {
  it("names the terms leaving ends, and leaves out the ones already ended", async () => {
    const { default: LeavingEnds, useTermsLeavingEnds, leftEndedWords } = await import("./LeavingEnds");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          alignments: [
            served({ title: "Terms for Orchard steward" }),
            served({ textId: "at-0000000000000009", title: "Terms for Ledger keeper", state: "ended" }),
            served({ textId: "at-0000000000000008", title: "Terms for Gate keeper", state: "pending" }),
          ],
        }),
      ),
    );
    function Probe() {
      const titles = useTermsLeavingEnds(true);
      return (
        <>
          <LeavingEnds titles={titles} />
          <p data-testid="after">{leftEndedWords(titles)}</p>
        </>
      );
    }
    render(<Probe />);
    expect(await screen.findByText("Terms for Orchard steward")).toBeTruthy();
    expect(screen.getByText("Terms for Gate keeper")).toBeTruthy();
    expect(screen.queryByText("Terms for Ledger keeper")).toBeNull();
    expect(screen.getByText("Leaving never waits on terms. Each one is recorded as ended when a party left the village.")).toBeTruthy();
    expect(screen.getByTestId("after").textContent).toBe("These terms ended when you left: Terms for Orchard steward; Terms for Gate keeper.");
  });

  it("CONTROL: a member with no terms sees nothing", () => {
    return import("./LeavingEnds").then(({ default: LeavingEnds }) => {
      const { container } = render(<LeavingEnds titles={[]} />);
      expect(container.innerHTML).toBe("");
    });
  });
});
