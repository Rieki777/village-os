// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { BLANK_GOAL, GOAL_LIMITS, parseGoals, type ProposalGoal } from "@shared/proposalGoals";
import { goalsOfApplication } from "@shared/seatApplications";
import GoalsList from "./GoalsList";

i18n.load("en", {});
i18n.activate("en");
afterEach(cleanup);

const ROLES = [{ id: "r1", name: "Gate Keeper", goals: ["Open at dawn", "Close at dusk"] }];
let latest: ProposalGoal[] = [];

function Harness({ start = [] as ProposalGoal[], roles = ROLES }) {
  const [goals, setGoals] = useState<ProposalGoal[]>(start);
  latest = goals;
  return (
    <I18nProvider i18n={i18n}>
      <GoalsList goals={goals} onChange={setGoals} roles={roles} seasonGoals={[{ value: "sg1", label: "Food on the land" }]} today="2026-11-10" />
    </I18nProvider>
  );
}
const g = (title: string) => ({ ...BLANK_GOAL, title, doneWhen: "done", roleId: "r1" });
const titles = () => screen.getAllByLabelText("The goal").map((e) => (e as HTMLInputElement).value);

describe("the goals list", () => {
  it("adds a goal with fields inline, focuses it, and states that tasks come later and both are tracked", () => {
    render(<Harness />);
    expect(screen.getByText(/we issue your tasks on your profile each moon/)).toBeTruthy();
    expect(screen.getByText(/track both your goals and your tasks for your compensation/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a goal" }));
    expect(document.activeElement).toBe(screen.getByLabelText("The goal"));
    fireEvent.change(screen.getByLabelText("The goal"), { target: { value: "Open the gate" } });
    fireEvent.change(screen.getByLabelText("Done when"), { target: { value: "it is open by seven" } });
    fireEvent.change(screen.getByLabelText("The role goal it moves"), { target: { value: "Open at dawn" } });
    fireEvent.change(screen.getByLabelText("The season goal it serves (optional)"), { target: { value: "sg1" } });
    fireEvent.change(screen.getByLabelText("A day in this moon (optional)"), { target: { value: "2026-11-20" } });
    expect(latest).toEqual([{ title: "Open the gate", doneWhen: "it is open by seven", moves: "Open at dawn", serves: "sg1", date: "2026-11-20", roleId: "r1" }]);
    expect(parseGoals(latest, { roleGoalsOf: () => ROLES[0]!.goals, seasonKeys: new Set(["sg1"]), today: "2026-11-10" }).ok).toBe(true);
  });

  it("removes a goal and moves focus to Add, and announces it", () => {
    render(<Harness start={[g("a"), g("b"), g("c")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove goal 2" }));
    expect(titles()).toEqual(["a", "c"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a goal" }));
    expect(screen.getByRole("status").textContent).toMatch(/Goal 2 removed/);
  });

  it("reorders with buttons, keeps focus on the moved goal's button, and disables the ends", () => {
    render(<Harness start={[g("a"), g("b"), g("c")]} />);
    expect((screen.getByRole("button", { name: "Move goal 1 up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move goal 3 down" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move goal 1 down" }));
    expect(titles()).toEqual(["b", "a", "c"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move goal 2 down" }));
    fireEvent.click(screen.getByRole("button", { name: "Move goal 3 up" }));
    expect(titles()).toEqual(["b", "c", "a"]);
    expect(screen.getByRole("status").textContent).toMatch(/moved to position 2 of 3/);
  });

  it("nudges gently outside three to five and never blocks adding below the cap", () => {
    const { rerender } = render(<Harness start={[g("a")]} />);
    expect(document.querySelector("[data-goals-nudge]")?.textContent).toMatch(/three to five/);
    cleanup();
    render(<Harness start={[g("a"), g("b"), g("c")]} />);
    expect(document.querySelector("[data-goals-nudge]")).toBeNull();
    cleanup();
    render(<Harness start={Array.from({ length: 6 }, (_, i) => g(`g${i}`))} />);
    expect(document.querySelector("[data-goals-nudge]")?.textContent).toMatch(/More is allowed/);
    expect((screen.getByRole("button", { name: "Add a goal" }) as HTMLButtonElement).disabled).toBe(false);
    void rerender;
  });

  it("stops at the cap", () => {
    render(<Harness start={Array.from({ length: GOAL_LIMITS.max }, (_, i) => g(`g${i}`))} />);
    expect((screen.getByRole("button", { name: "Add a goal" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says so when the role has no goals set, and offers no pick", () => {
    render(<Harness start={[g("a")]} roles={[{ id: "r1", name: "Gate Keeper", goals: [] }]} />);
    expect(document.querySelector("[data-no-role-goals]")?.textContent).toMatch(/has no goals set yet/);
    expect(screen.queryByLabelText("The role goal it moves")).toBeNull();
  });

  it("asks which role only when a proposal names several", () => {
    render(<Harness start={[g("a")]} roles={[...ROLES, { id: "r2", name: "Cook", goals: [] }]} />);
    const role = screen.getByLabelText("Which role it is for");
    expect(within(role).getAllByRole("option").map((o) => o.textContent)).toEqual(["Gate Keeper", "Cook"]);
  });
});

describe("an older proposal's words", () => {
  it("read as one goal where the list would be", () => {
    const goals = goalsOfApplication({ answers: null, deliverables: "Plant the first three beds, done when planted." });
    render(<Harness start={goals} />);
    expect(titles()).toEqual(["Plant the first three beds, done when planted."]);
  });
});
