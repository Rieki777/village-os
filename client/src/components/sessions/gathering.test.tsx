// @vitest-environment jsdom
/**
 * THE GATHERING (Phase C): the three drawings of a circle's week.
 *
 *   - "I'll be there" on Coming up writes the gatherings' own `going` through
 *     their own door (`/api/events/:id/rsvp` with the meeting's
 *     `occurrenceKey`), fills one circle of a Seed of Life per answer (seven
 *     at most), and takes the answer back with DELETE. Fireflies gather on
 *     one row only: the viewer's own circle that meets soonest and has not
 *     heard from them.
 *   - In the room, each person here lights one circle of the Flower of Life
 *     around the shared breath, and a circle that lights while the page is
 *     open draws once. The words carry the count.
 *   - On Friday, Monday's priorities read back as flowered, in bud or seed
 *     kept, and the answer underneath stays done, partly or carried.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { DEFAULT_TEMPLATES, type TemplateRoomView } from "@shared/sessionTemplates";
import type { ComingUpRow, SessionGathering } from "@shared/sessionRhythm";
import { breathAt } from "@shared/sessions";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => motion.reduced }));

const api = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method: string; body: unknown }>,
  status: 200,
  answer: {} as unknown,
  view: null as unknown,
}));
vi.mock("@/lib/gameApi", () => ({
  gameFetch: async (url: string, init?: { method?: string; body?: string }) => {
    api.calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
    if (url.startsWith("/api/session-templates/rooms/")) return new Response(JSON.stringify(api.view), { status: 200 });
    return new Response(JSON.stringify(api.answer), { status: api.status });
  },
}));
vi.mock("@/modules/ModuleProvider", () => ({ useModules: () => ({ loaded: true, failed: false, modules: [] }) }));

import GatheringSeed, { seedFilled } from "./GatheringSeed";
import GatheringFlower, { litCircles } from "./GatheringFlower";
import SharedBreath from "./SharedBreath";
import HarvestPlant, { harvestStage } from "./HarvestPlant";
import TemplatePanel from "./TemplatePanel";
import { leadRow } from "./ComingUp";

const AT = "2026-11-16T23:00:00.000Z";
const gathering = (over: Partial<SessionGathering> = {}): SessionGathering => ({
  eventId: "ev-sessions-abc",
  occurrenceKey: "2026-11-16",
  going: 0,
  mine: false,
  names: [],
  ...over,
});
const row = (over: Partial<ComingUpRow> = {}): ComingUpRow => ({
  circleId: "c-garden",
  circleName: "Garden circle",
  rhythmWords: "Every Monday at 18:00",
  next: { at: AT, endsAt: AT, key: "2026-11-16" },
  nextFrom: "rhythm",
  nextTitle: null,
  rhythmNext: null,
  words: "Monday 16 November at 18:00",
  durationMin: 60,
  waiting: 0,
  openRoom: null,
  mine: true,
  canKeep: false,
  rhythm: { kind: "none" },
  gathering: gathering(),
  ...over,
});

beforeEach(() => {
  motion.reduced = false;
  api.calls = [];
  api.status = 200;
  api.answer = { success: true };
  api.view = null;
});
afterEach(cleanup);

describe("I'll be there: a Seed of Life on Coming up", () => {
  it("fills one circle per answer, seven at most", () => {
    expect([0, 1, 6, 7, 12, -1].map(seedFilled)).toEqual([0, 1, 6, 7, 7, 0]);
    const { container } = render(<GatheringSeed row={{ ...row(), gathering: gathering({ going: 3 }) }} onChanged={() => undefined} />);
    const seed = container.querySelector("[data-shape='seed']")!;
    expect(seed.getAttribute("data-walked")).toBe("3");
    expect(seed.querySelectorAll("circle[data-state='closed']")).toHaveLength(3);
  });

  it("writes the gatherings' own going for that evening, then reads the list again", async () => {
    const changed = vi.fn();
    const said = vi.fn();
    render(<GatheringSeed row={{ ...row(), gathering: gathering() }} onChanged={changed} onSaid={said} />);
    fireEvent.click(screen.getByRole("button", { name: "I'll be there" }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(api.calls).toEqual([{ url: "/api/events/ev-sessions-abc/rsvp", method: "POST", body: { status: "going", occurrenceKey: "2026-11-16" } }]);
    expect(said).toHaveBeenCalledWith("Thank you. The Garden circle will see you there.");
  });

  it("takes it back with the gatherings' own withdraw, for that evening only", async () => {
    const changed = vi.fn();
    render(<GatheringSeed row={{ ...row(), gathering: gathering({ going: 1, mine: true, names: ["Ana"] }) }} onChanged={changed} />);
    expect(screen.getByText("You said you will be there.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I'll be there" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I can't come after all" }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(api.calls).toEqual([{ url: "/api/events/ev-sessions-abc/rsvp?occurrence=2026-11-16", method: "DELETE", body: null }]);
  });

  it("says the server's own sentence when it refuses, and nothing landed", async () => {
    api.status = 409;
    api.answer = { error: "This gathering is full", reason: "full" };
    const said = vi.fn();
    render(<GatheringSeed row={{ ...row(), gathering: gathering() }} onChanged={() => undefined} onSaid={said} />);
    fireEvent.click(screen.getByRole("button", { name: "I'll be there" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This gathering is full");
    expect(said).not.toHaveBeenCalled();
  });

  it("names who said so to those the server sends names, and only counts for anybody else", () => {
    const { unmount } = render(<GatheringSeed row={{ ...row(), gathering: gathering({ going: 2, names: ["Ana", "Zoe"] }) }} onChanged={() => undefined} />);
    expect(screen.getByText("Ana and Zoe said they will be there.")).toBeTruthy();
    unmount();
    render(<GatheringSeed row={{ ...row(), gathering: gathering({ going: 2 }) }} onChanged={() => undefined} />);
    expect(screen.getByText("2 of us said we will be there.")).toBeTruthy();
  });

  it("offers no answer while the room is already open: the meeting is happening", () => {
    render(<GatheringSeed row={{ ...row({ openRoom: { id: 4, title: "Garden" } }), gathering: gathering() }} onChanged={() => undefined} />);
    expect(screen.queryByRole("button", { name: "I'll be there" })).toBeNull();
  });

  it("lights one row only: the viewer's own circle that meets soonest and has not heard from them", () => {
    const later = row({ circleId: "c-late", next: { at: "2026-11-20T23:00:00.000Z", endsAt: AT, key: "2026-11-20" } });
    const answered = row({ circleId: "c-said", next: { at: "2026-11-14T23:00:00.000Z", endsAt: AT, key: "2026-11-14" }, gathering: gathering({ mine: true, going: 1 }) });
    const notMine = row({ circleId: "c-other", mine: false, next: { at: "2026-11-13T23:00:00.000Z", endsAt: AT, key: "2026-11-13" } });
    expect(leadRow([later, answered, notMine, row()])).toBe("c-garden");
    expect(leadRow([answered, notMine])).toBeNull();
    expect(leadRow([row({ gathering: null })])).toBeNull();
    const { container, unmount } = render(<GatheringSeed lead row={{ ...row(), gathering: gathering() }} onChanged={() => undefined} />);
    expect(container.querySelectorAll("[data-testid='fireflies']")).toHaveLength(1);
    unmount();
    const plain = render(<GatheringSeed row={{ ...row(), gathering: gathering() }} onChanged={() => undefined} />);
    expect(plain.container.querySelector("[data-testid='fireflies']")).toBeNull();
  });
});

describe("the room: one circle of the Flower of Life per person here", () => {
  it("lights the eighteen circles around the breath, one per arrival", () => {
    expect([0, 1, 5, 18, 30].map(litCircles)).toEqual([0, 1, 5, 18, 18]);
    const { container } = render(<GatheringFlower here={5} />);
    expect(container.querySelectorAll("circle[data-state='closed']")).toHaveLength(5);
    expect(container.querySelectorAll("circle[data-state='open']")).toHaveLength(13);
    expect(container.querySelectorAll("circle[data-state='centre']")).toHaveLength(1);
  });

  it("draws a circle once when somebody arrives while the page is open, and never the ones already lit", () => {
    const { container, rerender } = render(<GatheringFlower here={3} />);
    expect(container.querySelectorAll(".nk-draw")).toHaveLength(0);
    rerender(<GatheringFlower here={4} />);
    const drawn = container.querySelectorAll(".nk-draw");
    expect(drawn).toHaveLength(1);
    expect(drawn[0].getAttribute("data-state")).toBe("closed");
  });

  it("stands still under reduced motion, lit as it is", () => {
    motion.reduced = true;
    const { container } = render(<GatheringFlower here={6} />);
    expect(container.querySelector("[data-testid='gathering-flower']")!.getAttribute("data-motion")).toBe("still");
    expect(container.querySelectorAll("circle[data-state='closed']")).toHaveLength(6);
  });

  it("puts the shared breath in the flower's centre and says how many of us are here", () => {
    const breath = { pattern: "settle", rounds: 3, startedAt: null } as never;
    expect(breathAt(breath, Date.now()).state).toBe("idle");
    const actions = { act: async () => undefined } as never;
    const { container } = render(<SharedBreath breath={breath} offset={0} facilitates={false} actions={actions} here={5} />);
    expect(container.querySelector("[data-testid='breath-in-flower'] [data-testid='gathering-flower']")).toBeTruthy();
    expect(screen.getByText("5 of us are here.")).toBeTruthy();
    cleanup();
    render(<SharedBreath breath={breath} offset={0} facilitates={false} actions={actions} here={1} />);
    expect(screen.getByText("1 of us is here.")).toBeTruthy();
  });
});

describe("Friday's harvest: Monday's seeds read back", () => {
  const friday = DEFAULT_TEMPLATES.find((t) => t.seedKey === "weekly-friday")!;
  const view = (): TemplateRoomView => ({
    template: { id: 2, name: friday.name, category: friday.category, summary: friday.summary, flow: [...friday.flow] },
    hosts: true,
    joined: true,
    open: true,
    here: [],
    stick: null,
    priorities: [],
    review: {
      sessionId: 1,
      sessionTitle: "Monday planning",
      openedAt: "2026-11-09T18:00:00.000Z",
      rows: [
        { id: 11, text: "A shared meal for twenty", position: 0, outcome: "done", servesGoalId: null, servesGoal: null },
        { id: 12, text: "Fix the water filter", position: 1, outcome: "partly", servesGoalId: null, servesGoal: null },
        { id: 13, text: "The menu in two languages", position: 2, outcome: "carried", servesGoalId: null, servesGoal: null },
        { id: 14, text: "Paint the gate", position: 3, outcome: null, servesGoalId: null, servesGoal: null },
      ],
    },
    carried: null,
    shares: [],
    season: null,
    viewerNo: 1,
  });

  it("grows each outcome into its plant: flowered, in bud, seed kept, and a seed not read yet", () => {
    expect([harvestStage("done"), harvestStage("partly"), harvestStage("carried"), harvestStage(null)]).toEqual(["flower", "bud", "seed", "seed"]);
    const { container } = render(<HarvestPlant outcome="done" />);
    expect(container.querySelector("svg")!.getAttribute("data-stage")).toBe("flower");
  });

  it("reads each priority back in the garden's words and keeps the answer underneath", async () => {
    api.view = view();
    const { hook } = memoryLocation({ path: "/sessions/1" });
    render(
      <Router hook={hook}>
        <TemplatePanel sessionId={1} agenda={[]} />
      </Router>,
    );
    const meal = (await screen.findByText("A shared meal for twenty")).closest("li")!;
    expect(meal.getAttribute("data-outcome")).toBe("done");
    expect(within(meal).getByRole("button", { name: "Flowered" }).getAttribute("aria-pressed")).toBe("true");
    const filter = screen.getByText("Fix the water filter").closest("li")!;
    expect(within(filter).getByRole("button", { name: "In bud" }).getAttribute("aria-pressed")).toBe("true");
    const menu = screen.getByText("The menu in two languages").closest("li")!;
    expect(within(menu).getByRole("button", { name: "Seed kept" }).getAttribute("aria-pressed")).toBe("true");
    const gate = screen.getByText("Paint the gate").closest("li")!;
    expect(within(gate).getByText("A seed, not read back yet")).toBeTruthy();
    expect(within(gate).getByTestId("harvest-plant").getAttribute("data-stage")).toBe("seed");
    expect(screen.getByText("Nothing is marked as failed. What did not grow goes back to Monday's soil.")).toBeTruthy();
    // No word of the old tally survives on the read back.
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();

    // The answer underneath is still the series' own outcome.
    api.calls = [];
    fireEvent.click(within(gate).getByRole("button", { name: "Flowered" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = api.calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toMatch(/\/priorities\/14$/);
    expect(patch.body).toEqual({ outcome: "done" });
  });
});
