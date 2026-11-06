// @vitest-environment jsdom
/**
 * The spread band on /governance: Voice across the roll, in groups, and this
 * season's votes as counts. What is pinned:
 *   - the groups the server sends are drawn as sentences a screen reader reads,
 *     each with its bar, and the even-share line;
 *   - a village too small to show a group says so, and draws no bar;
 *   - nobody holding Voice, and votes that do not weigh Voice, are said plainly;
 *   - the counts read as counts, with "no closed votes yet" where there is none;
 *   - a refusal (a stranger while the village keeps its people) draws nothing,
 *     and so does the module being off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { VoiceSpreadView } from "@shared/voiceSpread";

let governanceOn = true;
vi.mock("@/modules/ModuleProvider", () => ({ useModule: () => governanceOn }));
vi.mock("@/lib/gameApi", () => ({ authToken: () => null }));

import VoiceSpreadBand from "./VoiceSpreadBand";

const VIEW: VoiceSpreadView = {
  spread: {
    voters: 24,
    anyVoice: true,
    bands: [
      { topPct: 10, sharePct: 41 },
      { topPct: 25, sharePct: 68 },
      { topPct: 50, sharePct: 90 },
    ],
    withheld: false,
    evenness: "concentrated",
  },
  weightedByVoice: true,
  quorumPct: 20,
  ballots: { since: "2026-10-01", run: 7, closed: 5, passed: 4, turnoutPct: 63 },
};

let answer: { status: number; body: unknown };

beforeEach(() => {
  governanceOn = true;
  answer = { status: 200, body: VIEW };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      expect(url).toBe("/api/governance/voice-spread");
      return { ok: answer.status < 400, status: answer.status, json: async () => answer.body } as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const band = (view?: Partial<VoiceSpreadView>) => {
  if (view) answer = { status: 200, body: { ...VIEW, ...view } };
  return render(<VoiceSpreadBand heading="Who Holds the Voice" intro="How the say is shared." />);
};

describe("VoiceSpreadBand", () => {
  it("draws each group as a sentence with its bar, and the even-share line", async () => {
    band();
    expect(await screen.findByRole("heading", { name: "Who Holds the Voice" })).toBeTruthy();
    expect(screen.getByText("How the say is shared.")).toBeTruthy();
    expect(screen.getByText("Votes here are weighted by Voice.")).toBeTruthy();
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual([
      expect.stringContaining("The top 10% of voters hold 41% of the Voice"),
      expect.stringContaining("The top 25% of voters hold 68% of the Voice"),
      expect.stringContaining("The top 50% of voters hold 90% of the Voice"),
    ]);
    // Each bar is as long as its share, and its even-share mark sits at the group's size.
    const fills = document.querySelectorAll<HTMLElement>("[data-spread-fill]");
    expect(Array.from(fills).map((f) => f.style.width)).toEqual(["41%", "68%", "90%"]);
    const marks = document.querySelectorAll<HTMLElement>("[data-spread-even]");
    expect(Array.from(marks).map((m) => m.style.left)).toEqual(["10%", "25%", "50%"]);
    expect(screen.getByText(/Most of the Voice sits with a few/)).toBeTruthy();
  });

  it("reads this season's votes as counts", async () => {
    band();
    await screen.findByText("Votes this season");
    const tile = (label: string) => screen.getByText(label).closest("[data-spread-tile]")!.textContent;
    expect(tile("Votes this season")).toContain("7");
    expect(tile("Carried")).toContain("4 of 5");
    expect(tile("Average turnout")).toContain("63%");
    expect(tile("Quorum")).toContain("20%");
  });

  it("with no season, the count is every vote so far, and with none closed, says so", async () => {
    band({ ballots: { since: null, run: 2, closed: 0, passed: 0, turnoutPct: null } });
    expect(await screen.findByText("Votes so far")).toBeTruthy();
    expect(screen.getByText("None closed yet")).toBeTruthy();
  });

  it("a village too small to show a group says so, and draws no bar", async () => {
    band({ spread: { voters: 5, anyVoice: true, bands: [], withheld: true, evenness: null } });
    expect(await screen.findByText(/too small to show how Voice is spread without pointing at someone/)).toBeTruthy();
    expect(document.querySelectorAll("[data-spread-fill]")).toHaveLength(0);
  });

  it("says plainly when nobody holds Voice, and when votes do not weigh it", async () => {
    band({ weightedByVoice: false, spread: { voters: 9, anyVoice: false, bands: [], withheld: false, evenness: null } });
    expect(await screen.findByText("Nobody holds any Voice yet.")).toBeTruthy();
    expect(screen.getByText(/every member's vote counts the same/)).toBeTruthy();
  });

  it("draws nothing for a refusal, or with governance off", async () => {
    answer = { status: 401, body: { error: "auth_required" } };
    const { container } = render(<VoiceSpreadBand heading="H" intro="" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    governanceOn = false;
    const off = render(<VoiceSpreadBand heading="H" intro="" />);
    expect(off.container.textContent).toBe("");
  });
});
