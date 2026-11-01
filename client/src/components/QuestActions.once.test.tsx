// @vitest-environment jsdom
/**
 * A CONSENTED QUEST'S PAY IS ANNOUNCED ONCE.
 *
 * The quest page's seeds moment and the reward moment (0294) both announced
 * the same consent. The reward moment wins wherever it names the pay: the
 * server marks those claims `announcedByRewardMoment`, and the quest page then
 * shows the settled line with no celebration. A consent the reward moment
 * never names (no tokens, Gratitude only, before the member's baseline) keeps
 * the quest page's moment, so no consent goes uncelebrated.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { QuestClaim } from "@/lib/gameApi";

vi.mock("@/lib/gameApi", () => ({ gameFetch: vi.fn() }));
vi.mock("@/lib/sound", () => ({ playMoment: vi.fn() }));

import QuestActions from "./QuestActions";
import { claimMoment } from "@/lib/celebrated";

const CONSENTED = {
  id: "claim-7",
  questId: "q-7",
  questTitle: "Seed bank shelves",
  status: "consented" as const,
  claimedAt: "2026-10-30T10:00:00.000Z",
  artifactUrl: "",
  note: "",
};
const PAY = { lines: [{ token: "village-tokens", name: "Village tokens", units: 4000, decimals: 2 }] } as any;

const celebrating = () => !!screen.queryByText(/Quest complete!/);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("a consented quest's pay is announced once", () => {
  it("stays quiet on the quest page when the reward moment names the pay", () => {
    const claim = { ...CONSENTED, announcedByRewardMoment: true } as QuestClaim;
    render(<QuestActions questId="q-7" signedIn claim={claim} pay={PAY} onChanged={() => undefined} />);
    expect(screen.getByText(/Complete/)).toBeTruthy();
    expect(celebrating()).toBe(false);
    // And it does not spend the quest page's own once: nothing was shown here.
    expect(claimMoment("quest:claim-7")).toBe(true);
  });

  it("control: celebrates on the quest page when the reward moment does not name it", () => {
    render(<QuestActions questId="q-7" signedIn claim={CONSENTED as QuestClaim} pay={PAY} onChanged={() => undefined} />);
    expect(celebrating()).toBe(true);
  });
});
