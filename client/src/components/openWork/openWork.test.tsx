// @vitest-environment jsdom
/**
 * The open work board (Phase C, decision 5) as rendered: one "Fits you" card
 * with one act, cards that carry the goal they grow, the place, the hands on
 * them and a small status mark, and `/quests?goal=<id>` opening the board on
 * one season goal with the village's count of open quests that grow it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import type { BoardQuest } from "@/lib/questBoard";

const nav = vi.hoisted(() => ({ search: "" }));

vi.mock("wouter", () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  useSearch: () => nav.search,
}));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }), useOptionalAuth: () => ({ user: null }) }));
vi.mock("@/components/ExamplesBanner", () => ({ ExamplesBanner: () => null }));
vi.mock("@/components/geneKeys/MaiaTypeLine", () => ({ default: () => null }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  fetchGameMe: async () => null,
  useGameConfig: () => ({ stages: [], project: { name: "the village" } }),
}));

import FitsYouCard from "./FitsYouCard";
import QuestCard from "@/components/QuestCard";
import Quests from "@/pages/Quests";

const quest = (over: Partial<BoardQuest> & { id: string }): BoardQuest => ({
  title: over.id,
  gratitude: "",
  status: "Open",
  ...over,
});

const WATER = { id: "gwater", text: "Clean water all year" };

describe("FitsYouCard", () => {
  it("one act, 'Take this on', lit by fireflies, opening the quest's own page", () => {
    const { container } = render(
      <FitsYouCard lead={{ quest: quest({ id: "q-well", title: "Dig the well" }), reason: "begin", fits: true, needed: false }} status="seed" goal={WATER} />,
    );
    expect(screen.getByText("Fits you")).toBeTruthy();
    expect(screen.getByText("It grows from your roots.")).toBeTruthy();
    const act = screen.getByRole("link", { name: /Take this on/ });
    expect(act.getAttribute("href")).toBe("/quests/q-well");
    expect(container.querySelectorAll('[data-testid="fireflies"]')).toHaveLength(1);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("says when it was chosen for a season goal that needs hands", () => {
    render(<FitsYouCard lead={{ quest: quest({ id: "q-tank" }), reason: "begin", fits: false, needed: true }} status="sprout" goal={WATER} />);
    expect(screen.getByText("It grows Clean water all year, and that goal needs hands this season.")).toBeTruthy();
  });
});

describe("QuestCard on the open work board", () => {
  it("carries the goal it grows, the place, the hands on it and its status mark", () => {
    const { container } = render(
      <QuestCard
        quest={quest({ id: "q-well", title: "Dig the well", circle: "Land", place: "land", duration: "One afternoon" })}
        signs={{ active: 2, done: 0, moon: 0 }}
        goal={WATER}
      />,
    );
    expect(screen.getByText("Grows: Clean water all year")).toBeTruthy();
    expect(screen.getByText("On the land")).toBeTruthy();
    expect(screen.getByText("One afternoon")).toBeTruthy();
    expect(screen.getByText("2 hands on this")).toBeTruthy();
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("sprout");
    expect(screen.getByText("Underway: someone carries it")).toBeTruthy();
  });

  it("a quest done this moon wears a flower; one nobody carries, a seed", () => {
    const { container, rerender } = render(<QuestCard quest={quest({ id: "q" })} signs={{ active: 0, done: 4, moon: 1 }} />);
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("flower");
    rerender(<QuestCard quest={quest({ id: "q" })} signs={{ active: 0, done: 4, moon: 0 }} />);
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("seed");
  });
});

describe("the board at /quests?goal=<id>", () => {
  const BOARD = [
    quest({ id: "q-well", title: "Dig the well", circle: "Land", difficulty: "Beginner", goalId: "gwater", place: "land" }),
    quest({ id: "q-tank", title: "Clean the tank", circle: "Land", difficulty: "Intermediate", goalId: "gwater", place: "both" }),
    quest({ id: "q-menu", title: "Write the menu", circle: "Hearth", difficulty: "Beginner", place: "remote" }),
  ];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      const body = u.startsWith("/api/quests/goals")
        ? { goals: [{ id: "gwater", text: "Clean water all year", done: false, openQuests: 2 }] }
        : u.startsWith("/api/quests/field")
          ? { perQuest: { "q-tank": { active: 1, done: 0, moon: 0 } }, recent: [] }
          : u.startsWith("/api/quests")
            ? BOARD
            : {};
      return { ok: true, status: 200, json: async () => body } as any;
    }) as any;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    nav.search = "";
  });

  it("opens on the goal, says the village's count, and shows only the work that grows it", async () => {
    nav.search = "goal=gwater";
    const { container } = render(<Quests />);
    await waitFor(() => expect(container.querySelector('[data-goal-thread="gwater"]')).toBeTruthy());
    expect(screen.getByText("2 open quests grow Clean water all year")).toBeTruthy();
    const shown = Array.from(container.querySelectorAll("[data-circle-group] article h3")).map((h) => h.textContent);
    expect(shown).toEqual(["Dig the well", "Clean the tank"]);
    // One press lets go of the goal and the whole board is back.
    fireEvent.click(screen.getByRole("button", { name: "Show every goal" }));
    await waitFor(() => expect(container.querySelectorAll("[data-circle-group] article")).toHaveLength(3));
  });

  it("groups the open work by circle and leads with one Fits you card", async () => {
    const { container } = render(<Quests />);
    await waitFor(() => expect(container.querySelectorAll("[data-circle-group]")).toHaveLength(2));
    expect(Array.from(container.querySelectorAll("[data-circle-group]")).map((g) => g.getAttribute("data-circle-group"))).toEqual(["Land", "Hearth"]);
    // The goal that still needs hands leads among the gentle ones.
    expect(container.querySelector("[data-lead-quest]")?.getAttribute("data-lead-quest")).toBe("q-well");
    expect(container.querySelectorAll('[data-testid="fireflies"]')).toHaveLength(1);
  });

  it("the place filter keeps work that happens in both places", async () => {
    const { container } = render(<Quests />);
    await waitFor(() => expect(container.querySelector('[data-place-filter="remote"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-place-filter="remote"]')!);
    await waitFor(() =>
      expect(Array.from(container.querySelectorAll("[data-circle-group] article h3")).map((h) => h.textContent)).toEqual(["Clean the tank", "Write the menu"]),
    );
  });
});
