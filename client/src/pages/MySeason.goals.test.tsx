// @vitest-environment jsdom
/**
 * Your season's goals (player role card PR 6), rendered.
 *
 *   - one tick per village goal; a "How it helps" line shows under each one
 *     ticked, and not under one left unticked;
 *   - a plan saved before the player card (only `servesGoal`) arrives ticked;
 *   - the Seasonal goals block carries its lede, adds up to three rows and no
 *     more, and Save sends the ticked goals with their lines and the seasonal
 *     goals with a title, the first goal ticked as `servesGoal`;
 *   - the plan card shows each goal's line and the seasonal goals.
 *
 * Every name is made up.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const SIGNED_IN = { id: "u-ana" };

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: SIGNED_IN }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "governance", lifecycle: "members" }] }),
  useModule: () => ({ id: "governance", lifecycle: "members" }),
}));
vi.mock("@/components/modules/ModuleGate", () => ({
  default: () => <p>Module gate</p>,
  SignInDoors: () => <a href="/login">Sign in</a>,
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import MySeason from "./MySeason";
import PlanCard from "@/components/seasonPlans/PlanCard";

const GOALS = ["Plant the north orchard", "Open the guest kitchen", "Mend the long fence"];

const MINE = {
  season: { id: "s-next", name: "Season of Testing", startsOn: "2027-03-01", endsOn: "2027-06-01", goals: GOALS },
  window: { seasonId: "s-next", seasonName: "Season of Testing", opensOn: "2027-02-01", closesOn: "2027-03-31", state: "open" },
  plan: null as any,
  filed: null,
  changedSinceFiling: false,
  heldSeats: [],
  applications: [],
  questsThisMoon: { done: 0 },
  mayApply: true,
  suggestions: null,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let mine: () => Response;
const asked: Array<{ method: string; url: string; body?: string }> = [];

beforeEach(() => {
  asked.length = 0;
  mine = () => json(MINE);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      asked.push({ method, url, body: init?.body });
      if (url.startsWith("/api/season-plans/mine")) {
        if (method !== "PUT") return mine();
        const body = JSON.parse(init!.body!);
        return json({ ...MINE, plan: { version: 1, ...body, savedOn: "2027-02-15" } });
      }
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tick = (goal: string) => screen.getByRole("checkbox", { name: goal }) as HTMLInputElement;
const helps = (goal: string) => screen.queryByLabelText(`How it helps: ${goal}`) as HTMLInputElement | null;

describe("the village goals you serve", () => {
  it("draws one tick per goal, and a How it helps line under each one ticked", async () => {
    render(<MySeason />);
    await screen.findByText("Your part");
    const box = screen.getByTestId("serves-goals");
    expect(within(box).getAllByRole("checkbox")).toHaveLength(GOALS.length);
    expect(helps(GOALS[0])).toBeNull();

    fireEvent.click(tick(GOALS[1]));
    expect(tick(GOALS[1]).checked).toBe(true);
    expect(helps(GOALS[1])).not.toBeNull();
    // CONTROL: the goals left unticked carry no line.
    expect(helps(GOALS[0])).toBeNull();
    expect(helps(GOALS[2])).toBeNull();
  });

  it("ticks a plan saved before the player card from its one `servesGoal`", async () => {
    mine = () => json({ ...MINE, plan: { version: 1, aim: "x", servesGoal: GOALS[2], commitments: {}, handingBack: [], savedOn: "2027-02-14" } });
    render(<MySeason />);
    await screen.findByText("Your part");
    expect(tick(GOALS[2]).checked).toBe(true);
    expect(tick(GOALS[0]).checked).toBe(false);
    expect(helps(GOALS[2])?.value).toBe("");
  });
});

describe("seasonal goals", () => {
  it("say what they are for, stop at three, and save with the goals served", async () => {
    render(<MySeason />);
    await screen.findByText("Your part");
    const block = screen.getByTestId("seasonal-goals");
    expect(block.textContent).toContain("One to three bigger goals for the whole season. Each moon's tasks build toward them.");

    const add = () => within(block).queryByRole("button", { name: "Add a seasonal goal" });
    fireEvent.click(add()!);
    fireEvent.click(add()!);
    fireEvent.click(add()!);
    expect(add()).toBeNull();
    const titles = within(block).getAllByLabelText("Goal") as HTMLInputElement[];
    const doneWhen = within(block).getAllByLabelText("Done when") as HTMLInputElement[];
    expect(titles).toHaveLength(3);
    fireEvent.change(titles[0], { target: { value: "Graft the old pears" } });
    fireEvent.change(doneWhen[0], { target: { value: "Ten grafts take." } });

    fireEvent.click(tick(GOALS[2]));
    fireEvent.change(helps(GOALS[2])!, { target: { value: "Keeps the goats in." } });
    fireEvent.click(tick(GOALS[0]));
    fireEvent.change(screen.getByLabelText("Your aim"), { target: { value: "Mend and plant." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");

    const put = JSON.parse(asked.find((a) => a.method === "PUT")!.body!);
    // In the season's order, so the first goal served is the first on the season's list.
    expect(put.servesGoals).toEqual([
      { goal: GOALS[0], howItHelps: null },
      { goal: GOALS[2], howItHelps: "Keeps the goats in." },
    ]);
    expect(put.servesGoal).toBe(GOALS[0]);
    // The two blank rows are not sent.
    expect(put.seasonalGoals).toEqual([{ title: "Graft the old pears", doneWhen: "Ten grafts take." }]);
  });
});

describe("the plan card", () => {
  const CARD = {
    userId: "u-ana",
    name: "Ana Quillfeather",
    handle: null,
    filed: true,
    filedOn: "2027-02-14",
    changedSinceFiling: false,
    seats: [],
    handingBack: [],
    applications: [],
    waiting: false,
    aim: "Mend and plant.",
    servesGoal: GOALS[2],
    servesGoals: [{ goal: GOALS[2], howItHelps: "Keeps the goats in." }, { goal: GOALS[0], howItHelps: null }],
    seasonalGoals: [{ title: "Graft the old pears", doneWhen: "Ten grafts take." }],
    questsThisMoon: { done: 0, min: null, max: null },
    measures: [],
  };

  it("shows each goal served with its How it helps line, and the seasonal goals", () => {
    render(<PlanCard card={CARD} />);
    const served = screen.getByTestId("plan-serves");
    expect(served.textContent).toContain(GOALS[2]);
    expect(served.textContent).toContain("How it helps: Keeps the goats in.");
    expect(served.textContent).toContain(GOALS[0]);
    expect(screen.getByTestId("plan-seasonal").textContent).toContain("Graft the old pearsDone when: Ten grafts take.");
  });

  it("draws a card from a server before the player card from its one `servesGoal`", () => {
    render(<PlanCard card={{ ...CARD, servesGoals: undefined, seasonalGoals: undefined }} />);
    expect(screen.getByTestId("plan-serves").textContent).toBe(GOALS[2]);
    expect(screen.queryByTestId("plan-seasonal")).toBeNull();
  });
});
