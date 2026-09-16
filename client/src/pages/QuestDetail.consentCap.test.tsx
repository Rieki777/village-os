// @vitest-environment jsdom
/**
 * WHAT THE QUEST BOARD PROMISES, UNDER EACH OF THE THREE THINGS A VILLAGE
 * CAN VOTE.
 *
 * `quest.consent_cap_mode` is an open-ring dial with three settings, and each
 * pays a different shape. Only "posted" makes the advertised amount the payout,
 * and its own registry entry in shared/gameVariables.ts uses this page's
 * sentence to describe that ONE setting: "Capping it at the posted amount keeps
 * the quest board honest: what a quest advertises is what it pays."
 *
 * The page printed that guarantee under all three settings. After that was
 * fixed it still opened every setting with "the exact amount inside the range"
 * and qualified it in a second sentence, so a village on "unlimited" read a
 * promise and its retraction in one paragraph, and a village on "capped" was
 * never told that the floor holds (ruling 7, 2026-09-14). Each setting now has
 * its own lead sentence, and each is asserted whole.
 *
 * THE SENTENCE IS ASSERTED THROUGH THE RENDERED PAGE, from the payload
 * `GET /api/game/rules` answers, which is the whitelist that exists so the UI
 * can render the game's actual rules. Nothing here reads the component's
 * source or its props.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
 * anonymous read on this page answering with nothing worth drawing. Resolves
 * once the page has read the rules body, so a test can tell "the rules named
 * nothing" apart from "the rules have not been read yet".
 */
const serve = (quests: unknown): Promise<void> => {
  let read!: () => void;
  const rulesRead = new Promise<void>((resolve) => {
    read = resolve;
  });
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/api/game/rules")) {
      return {
        ok: true,
        json: async () => {
          read();
          return { quests };
        },
      } as unknown as Response;
    }
    return { ok: true, json: async () => ({ perQuest: {}, recent: [] }) } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return rulesRead;
};

/** The page, drawn, with the rules read and the render that follows them flushed. */
const drawn = async (rulesRead: Promise<void>): Promise<void> => {
  render(<QuestDetail />);
  await rulesRead;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

/** The paragraph that says how this quest is paid, once the page has drawn it. */
const paymentParagraph = async (): Promise<string> => {
  const found = await waitFor(() => {
    const hit = screen
      .queryAllByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").includes("when it consents to your work"))
      .find((el) => el.textContent);
    if (!hit) throw new Error("the payment sentence has not rendered");
    return hit;
  });
  return String(found.textContent).replace(/\s+/g, " ").trim();
};

const GUARANTEE = "What a quest advertises is what it pays.";
const NEUTRAL = "The circle sets the amount when it consents to your work. This quest advertises 50-100.";

describe("the quest board states what the village voted about its own payouts", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
  });

  it("posted: the amount sits inside the range, and the guarantee is kept", async () => {
    await drawn(serve({ consentCapMode: "posted", consentCapMultiplier: 2 }));
    expect(await paymentParagraph()).toBe(
      `The circle sets the amount inside the 50-100 range when it consents to your work. ${GUARANTEE}`,
    );
  });

  it("capped: the range is where the circle starts, the floor holds, and the ceiling is named", async () => {
    await drawn(serve({ consentCapMode: "capped", consentCapMultiplier: 2 }));
    const text = await paymentParagraph();
    expect(text).toBe(
      "The 50-100 range is where the circle starts when it consents to your work. " +
        "It pays at least the bottom of that range, and may lift the amount up to 2 times what the quest advertises.",
    );
    expect(text).not.toContain(GUARANTEE);
  });

  it("capped: carries the multiplier the village voted, and never a literal", async () => {
    await drawn(serve({ consentCapMode: "capped", consentCapMultiplier: 5 }));
    const text = await paymentParagraph();
    expect(text).toContain("up to 5 times what the quest advertises");
    expect(text).not.toContain("up to 2 times");
  });

  it("unlimited: the range is a suggestion, and nothing promises an amount inside it", async () => {
    await drawn(serve({ consentCapMode: "unlimited", consentCapMultiplier: 2 }));
    const text = await paymentParagraph();
    expect(text).toBe("This quest suggests 50-100, and the circle may release any amount when it consents to your work.");
    expect(text).not.toContain("inside the 50-100 range");
    expect(text).not.toContain(GUARANTEE);
  });

  /**
   * A PAYLOAD THAT NAMES NO SETTING IS NOT A SETTING. The page draws the
   * neutral sentence, which is true under all three, and nothing mode-specific
   * on top of it: a guarantee, a floor or a ceiling printed here would be the
   * old defect with an extra step.
   */
  it("makes no mode-specific promise when the rules name no setting", async () => {
    await drawn(serve(undefined));
    expect(await paymentParagraph()).toBe(NEUTRAL);
  });

  it("makes no mode-specific promise for a setting this page does not know", async () => {
    await drawn(serve({ consentCapMode: "generous", consentCapMultiplier: 2 }));
    expect(await paymentParagraph()).toBe(NEUTRAL);
  });

  it("names no ceiling for a capped village whose multiplier did not arrive as a number", async () => {
    await drawn(serve({ consentCapMode: "capped", consentCapMultiplier: "2" }));
    expect(await paymentParagraph()).toBe(NEUTRAL);
  });

  it("makes no mode-specific promise while the rules are still on their way", async () => {
    // The rules request never answers, so the page draws with nothing read.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).includes("/api/game/rules")
          ? new Promise<Response>(() => {})
          : Promise.resolve({ ok: true, json: async () => ({ perQuest: {}, recent: [] }) } as unknown as Response),
      ),
    );
    render(<QuestDetail />);
    expect(await paymentParagraph()).toBe(NEUTRAL);
  });
});
