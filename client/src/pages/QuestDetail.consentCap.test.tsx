// @vitest-environment jsdom
/**
 * WHAT THE QUEST BOARD PROMISES, UNDER EACH OF THE THREE THINGS A VILLAGE
 * CAN VOTE.
 *
 * `quest.consent_cap_mode` is an open-ring dial with three settings, and only
 * "posted" makes the advertised amount the payout. Its own registry entry in
 * shared/gameVariables.ts uses this page's sentence to describe that ONE
 * setting: "Capping it at the posted amount keeps the quest board honest:
 * what a quest advertises is what it pays."
 *
 * This page printed that guarantee unconditionally. So a village on "capped"
 * published a promise its own consent route would break (server/index.ts
 * refuses at a ceiling of the multiplier, not at the posted amount), and a
 * village on "unlimited" published a ceiling it had voted away entirely.
 *
 * THE SENTENCE IS ASSERTED THROUGH THE RENDERED PAGE, from the payload
 * `GET /api/game/rules` answers, which is the whitelist that exists so the UI
 * can render the game's actual rules. Nothing here reads the component's
 * source or its props.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, { id: "q-1" }],
  Link: ({ children }: { children: ReactNode }) => <a href="/quests">{children}</a>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Gratitude" }));
vi.mock("@/components/QuestActions", () => ({ default: () => <div /> }));
vi.mock("@/components/QuestCrews", () => ({ default: () => <div /> }));
vi.mock("@/components/NeedChips", () => ({ default: () => <div /> }));
vi.mock("@/components/admin/NeedTagPicker", () => ({ default: () => <div /> }));
vi.mock("@/components/QuestCard", () => ({
  default: () => <div />,
  QuestPoster: () => <div />,
  iconFor: () => () => <span />,
  difficultyColors: {} as Record<string, string>,
}));

const QUEST = {
  id: "q-1",
  title: "Mend the north fence",
  description: "A morning with wire and gloves.",
  gratitude: "50-100",
  circle: "Land",
  status: "open",
  difficulty: "gentle",
};

vi.mock("@/lib/gameApi", () => ({
  fetchGameMe: async () => null,
  gameFetch: async () => ({ ok: true, status: 200, json: async () => ({ quest: QUEST, related: [] }) }),
  useGameConfig: () => ({ stages: [{ id: "member", name: "Member", description: "" }] }),
}));

import QuestDetail from "./QuestDetail";

/**
 * `GET /api/game/rules` answering with one quests block, and every other
 * anonymous read on this page answering with nothing worth drawing.
 */
const serve = (quests: unknown) => {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/api/game/rules")) {
      return { ok: true, json: async () => ({ quests }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({ perQuest: {}, recent: [] }) } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
};

/** The whole paragraph the range sentence lives in, once the page has drawn. */
const rangeParagraph = async (): Promise<string> => {
  const found = await waitFor(() => {
    const hit = screen
      .getAllByText(/The circle sets the exact amount inside the/i)
      .find((el) => el.textContent);
    if (!hit) throw new Error("the range sentence has not rendered");
    return hit;
  });
  return String(found.textContent).replace(/\s+/g, " ").trim();
};

const GUARANTEE = "What a quest advertises is what it pays.";

describe("the quest board states what the village voted about its own payouts", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the guarantee on the setting that earns it", async () => {
    serve({ consentCapMode: "posted", consentCapMultiplier: 2 });
    render(<QuestDetail />);
    expect(await rangeParagraph()).toContain(GUARANTEE);
  });

  it("drops the guarantee and names the bonus ceiling when the village capped it", async () => {
    serve({ consentCapMode: "capped", consentCapMultiplier: 2 });
    render(<QuestDetail />);
    const text = await rangeParagraph();
    expect(text).not.toContain(GUARANTEE);
    expect(text).toContain("up to 2 times what the quest advertises");
  });

  it("carries the multiplier the village voted, and never a literal", async () => {
    serve({ consentCapMode: "capped", consentCapMultiplier: 5 });
    render(<QuestDetail />);
    const text = await rangeParagraph();
    expect(text).toContain("up to 5 times what the quest advertises");
    expect(text).not.toContain("up to 2 times");
  });

  it("drops the guarantee entirely when the village voted no ceiling", async () => {
    serve({ consentCapMode: "unlimited", consentCapMultiplier: 2 });
    render(<QuestDetail />);
    const text = await rangeParagraph();
    expect(text).not.toContain(GUARANTEE);
    expect(text).toContain("The circle may release any amount when it consents.");
  });

  /**
   * A PAYLOAD THAT HAS NOT ARRIVED IS NOT A SETTING. The page draws the range
   * sentence, which is true under all three, and promises nothing on top of
   * it. Printing the guarantee here would be the old defect with an extra step.
   */
  it("promises nothing while the rules have not arrived", async () => {
    serve(undefined);
    render(<QuestDetail />);
    const text = await rangeParagraph();
    expect(text).toContain("The circle sets the exact amount inside the 50-100 range");
    expect(text).not.toContain(GUARANTEE);
    expect(text).not.toContain("any amount");
  });
});
