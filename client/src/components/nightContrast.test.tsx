// @vitest-environment jsdom
/**
 * THE "WHY THIS PLACE" SECTION AND THE QUEST CARD, MEASURED ON BOTH GROUNDS
 * THEY ARE DRAWN ON (night-contrast lane, 2026-11-11).
 *
 * /resident and /quests stand in the sheet's night world; the investor page
 * and a quest's own page do not. Both components used the brand inks
 * (`text-teal-deep`, `text-sage`, `text-teal-700`), which are dark by design,
 * and on the night card a browser measured the section's heading at 1.59:1,
 * "See the quest" at 1.58:1 and the Beginner chip at 2.52:1.
 *
 * Measured through client/src/test/tokenContrast.ts from the classes each line
 * and its ancestors actually carry: the night with the `.sheet-night` block's
 * own values as the overlay (`nightOverlay()`), the light with `:root`.
 *
 * The quest card is measured from its body down. The poster above it is a
 * gradient or a village's photograph, which the resolver refuses to guess, and
 * its title is white over a black scrim on every ground.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { describeFailures, measureText, nightOverlay } from "@/test/tokenContrast";
import type { BoardQuest } from "@/lib/questBoard";
import { forgetDisplayRates } from "@/lib/workPay";

const LEGAL = {
  jurisdictionOverview: {
    heading: "Why this place, why now",
    intro: "The legal, financial and practical reasons this place makes sense.",
    points: [
      { title: "Holding land together", body: "How a family holds a share of the land here." },
      { title: "Staying a while", body: "The ways to live here for longer than a visit." },
    ],
  },
};
let legal: unknown = LEGAL;
vi.mock("@/hooks/useVillageContent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useVillageContent")>()),
  useVillageContent: () => ({ content: legal, loading: false, isPlaceholder: legal == null }),
}));

import WhyCostaRica from "./WhyCostaRica";
import QuestCard from "./QuestCard";

beforeEach(() => {
  forgetDisplayRates();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  legal = LEGAL;
});

const GROUNDS: Array<[string, Record<string, string>]> = [
  ["the night sheet", nightOverlay()],
  ["the light page", {}],
];

const QUEST = (difficulty: string): BoardQuest => ({
  id: `q-${difficulty}`,
  title: "Welcome someone new",
  subtitle: "Be the first hello a newcomer remembers.",
  gratitude: "",
  pay: null,
  duration: "One gathering",
  difficulty,
  circle: "Community",
  status: "active",
  icon: "Users",
  minStage: "member",
});

describe("the section on where the village sits", () => {
  for (const [ground, overlay] of GROUNDS) {
    it(`reads at AA on ${ground}, published and placeholder alike`, () => {
      for (const content of [LEGAL, null]) {
        legal = content;
        const { container } = render(<WhyCostaRica />);
        const lines = measureText(container, "light", overlay);
        expect(lines.length).toBeGreaterThanOrEqual(2);
        expect(describeFailures(lines)).toEqual([]);
        cleanup();
      }
    });
  }
});

describe("the quest card's body", () => {
  for (const [ground, overlay] of GROUNDS) {
    for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
      it(`reads at AA on ${ground} with a ${difficulty} chip, the gate and the field signs`, () => {
        const { container } = render(
          <QuestCard
            quest={QUEST(difficulty)}
            signs={{ active: 2, done: 3 }}
            stages={[{ id: "member", name: "Member" }]}
          />,
        );
        const body = container.querySelector("article > div:last-child");
        expect(body).not.toBeNull();
        const lines = measureText(body as Element, "light", overlay);
        const texts = lines.map((l) => l.text);
        expect(texts).toContain(difficulty);
        expect(texts).toContain("See the quest");
        expect(describeFailures(lines)).toEqual([]);
      });
    }
  }
});
