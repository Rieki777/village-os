// @vitest-environment jsdom
/** The journal guide's task suggestions: nothing changes until the member taps, and each tap uses the list's own routes. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const added: any[] = [];
const doneCalls: any[] = [];
vi.mock("@/components/yourList/yourListApi", () => ({
  addTask: async (title: string, tier: string, extra: any) => { added.push({ title, tier, extra }); return { ok: true, task: null }; },
  readList: async () => ({ on: true, open: [{ id: "t1", title: "Water the beds", version: 3 }] }),
  markDone: async (t: any) => { doneCalls.push(t); return { ok: true, task: null }; },
}));

import GuideTasks from "./GuideTasks";

afterEach(() => {
  added.length = 0;
  doneCalls.length = 0;
});

describe("GuideTasks", () => {
  it("adds a suggested task with the journal as its source, only when tapped", async () => {
    render(<GuideTasks suggested={["Call the water circle"]} done={[]} guideName="Sera" />);
    expect(screen.getByText("Sera noticed, for your list")).toBeTruthy();
    expect(added).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Add to my list" }));
    expect(added).toEqual([{ title: "Call the water circle", tier: "priority", extra: { source: "journal" } }]);
    expect(await screen.findByText("On your list")).toBeTruthy();
  });

  it("marks a task done through the list's own route, at its current version", async () => {
    render(<GuideTasks suggested={[]} done={[{ id: "t1", title: "Water the beds" }]} guideName="Maia" />);
    expect(screen.getByText("Sounds finished: Water the beds")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(doneCalls).toEqual([{ id: "t1", title: "Water the beds", version: 3 }]);
    expect(await screen.findByText("Marked done")).toBeTruthy();
  });

  it("draws nothing with nothing to suggest", () => {
    const { container } = render(<GuideTasks suggested={[]} done={[]} guideName="Maia" />);
    expect(container.innerHTML).toBe("");
  });
});
