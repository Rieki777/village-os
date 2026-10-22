// @vitest-environment jsdom
/**
 * Your part, started from your seats (2026-10-21), rendered.
 *
 *   - with no quests saved, Fewest and Most fill in from the seats, marked as
 *     a suggestion with the line saying where they came from, and the mark
 *     goes once the member saves;
 *   - a saved count is never overwritten by a suggestion;
 *   - with no seat terms, the platform's starting point is said as one;
 *   - From your roles groups suggestions by seat, Add fills a measure row and
 *     leaves its target to the member, and Add stops at the plan's limit;
 *   - a member who holds and applied for nothing is pointed to Apply.
 *
 * Every name is made up.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/** One object for every render, the way the real context hands it out. */
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

const SUGGESTIONS = {
  quests: { min: 3, max: 7, from: "terms", source: [{ seatId: "seat-fe", seat: "Front-End", min: 3, max: 5 }, { seatId: "seat-k", seat: "Kitchen keeper", min: 2, max: 7 }] },
  measures: [
    { seatId: "seat-fe", seat: "Front-End", from: "terms", measure: "Bugs closed", target: "every reported bug by the moon's end" },
    { seatId: "seat-k", seat: "Kitchen keeper", from: "terms", measure: "Meals served", target: "dinner every gathering" },
    { seatId: "seat-fe", seat: "Front-End", from: "accountability", measure: "Org chart and role proposals show accurately" },
    { seatId: "seat-k", seat: "Kitchen keeper", from: "accountability", measure: "Kitchen in good order" },
  ],
};

const MINE = {
  season: { id: "s-next", name: "Season of Testing", startsOn: "2027-03-01", endsOn: "2027-06-01", goals: [] },
  window: { seasonId: "s-next", seasonName: "Season of Testing", opensOn: "2027-02-01", closesOn: "2027-03-31", state: "open" },
  plan: null as any,
  filed: null,
  changedSinceFiling: false,
  heldSeats: [{ id: "seat-fe", name: "Front-End", termEndsOn: "2027-03-01", lapsed: false }],
  applications: [{ id: "sa-00000000000000b2", href: "/seat-applications/sa-00000000000000b2", status: "voting", statusWords: "The village is voting", seats: [{ id: "seat-k", name: "Kitchen keeper" }] }],
  questsThisMoon: { done: 1 },
  mayApply: true,
  suggestions: SUGGESTIONS as any,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let mine: () => Response;
let afterPut: (body: any) => Response;
const asked: Array<{ method: string; url: string; body?: string }> = [];

beforeEach(() => {
  asked.length = 0;
  mine = () => json(MINE);
  afterPut = (body) => json({ ...MINE, plan: { version: 1, aim: body.aim, servesGoal: null, commitments: body.commitments, handingBack: [], savedOn: "2027-02-15" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      asked.push({ method, url, body: init?.body });
      if (url.startsWith("/api/season-plans/mine")) return method === "PUT" ? afterPut(JSON.parse(init!.body!)) : mine();
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fewest = () => screen.getByLabelText("Fewest") as HTMLInputElement;
const most = () => screen.getByLabelText("Most") as HTMLInputElement;
const measureInputs = () => screen.queryAllByLabelText("Measure") as HTMLInputElement[];
const targetInputs = () => screen.queryAllByLabelText("Target") as HTMLInputElement[];

describe("quests a moon, filled in from your seats", () => {
  it("prefills Fewest and Most, marked as a suggestion until the member saves", async () => {
    render(<MySeason />);
    await screen.findByText("Your part");
    expect(fewest().value).toBe("3");
    expect(most().value).toBe("7");
    const hint = screen.getByTestId("quests-suggested");
    expect(hint.textContent).toContain("From your roles' terms: Front-End 3 to 5, Kitchen keeper 2 to 7");
    expect(hint.textContent).toContain("Suggested. Saved when you save.");
    expect(fewest().className).toContain("border-dashed");

    fireEvent.change(screen.getByLabelText("Your aim"), { target: { value: "Ship the season page." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    const put = JSON.parse(asked.find((a) => a.method === "PUT")!.body!);
    expect(put.commitments.quests).toMatchObject({ perMoonMin: 3, perMoonMax: 7 });
    expect(screen.queryByTestId("quests-suggested")).toBeNull();
    expect(fewest().className).not.toContain("border-dashed");
  });

  it("never overwrites a saved count", async () => {
    mine = () =>
      json({ ...MINE, plan: { version: 2, aim: "x", servesGoal: null, commitments: { quests: { perMoonMin: 1, perMoonMax: 2, doneWhenRequired: true } }, handingBack: [], savedOn: "2027-02-14" } });
    render(<MySeason />);
    await screen.findByText("Your part");
    expect(fewest().value).toBe("1");
    expect(most().value).toBe("2");
    expect(screen.queryByTestId("quests-suggested")).toBeNull();
  });

  it("says the platform's default is a starting point", async () => {
    mine = () => json({ ...MINE, suggestions: { quests: { min: 3, max: 5, from: "default", source: [] }, measures: [] } });
    render(<MySeason />);
    await screen.findByText("Your part");
    expect(fewest().value).toBe("3");
    expect(most().value).toBe("5");
    expect(screen.getByTestId("quests-suggested").textContent).toContain("A starting point. Change it if your roles ask for more.");
  });
});

describe("measures from your roles", () => {
  it("groups suggestions by seat, and Add fills a row leaving the target to the member", async () => {
    render(<MySeason />);
    const box = await screen.findByTestId("role-measures");
    expect(within(box).getByText("From your roles")).toBeTruthy();
    expect(within(box).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Front-End", "Kitchen keeper"]);
    expect(within(box).getByText(/From its terms\. Aims for every reported bug by the moon's end\./)).toBeTruthy();
    // Never added for the member.
    expect(measureInputs()).toEqual([]);

    fireEvent.click(within(box).getByRole("button", { name: "Add Org chart and role proposals show accurately" }));
    expect(measureInputs().map((i) => i.value)).toEqual(["Org chart and role proposals show accurately"]);
    expect(targetInputs().map((i) => i.value)).toEqual([""]);
    const added = within(box).getByRole("button", { name: "Added: Org chart and role proposals show accurately" }) as HTMLButtonElement;
    expect(added.disabled).toBe(true);

    // An empty row the member opened is filled before a new one is made.
    fireEvent.click(screen.getByRole("button", { name: "Add a measure" }));
    fireEvent.click(within(box).getByRole("button", { name: "Add Bugs closed" }));
    expect(measureInputs().map((i) => i.value)).toEqual(["Org chart and role proposals show accurately", "Bugs closed"]);
  });

  it("stops at the plan's limit and says Pick up to 3", async () => {
    render(<MySeason />);
    const box = await screen.findByTestId("role-measures");
    expect(within(box).getByText("Pick up to 3.")).toBeTruthy();
    for (const m of ["Bugs closed", "Meals served", "Kitchen in good order"]) fireEvent.click(within(box).getByRole("button", { name: `Add ${m}` }));
    expect(measureInputs().length).toBe(3);
    const fourth = within(box).getByRole("button", { name: "Add Org chart and role proposals show accurately" }) as HTMLButtonElement;
    expect(fourth.disabled).toBe(true);
    fireEvent.click(fourth);
    expect(measureInputs().length).toBe(3);
    expect(screen.queryByRole("button", { name: "Add a measure" })).toBeNull();
  });

  it("points a member who holds and applied for nothing to Apply", async () => {
    mine = () => json({ ...MINE, heldSeats: [], applications: [], suggestions: { quests: { min: 3, max: 5, from: "default", source: [] }, measures: [] } });
    render(<MySeason />);
    const box = await screen.findByTestId("role-measures");
    expect(box.textContent).toContain("Apply for a role to see measures from its role.");
    expect(within(box).getByRole("link", { name: "Apply for a role" }).getAttribute("href")).toBe("/propose?type=role_application&season=s-next");
    await waitFor(() => expect(within(box).queryAllByRole("button").length).toBe(0));
  });
});
