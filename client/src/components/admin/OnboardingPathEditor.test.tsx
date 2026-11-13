// @vitest-environment jsdom
/**
 * Admin, Onboarding path: the form edits the one document field by field (a
 * step's day, who it waits on, its link, the owners and the check-in days), the
 * JSON beside it is the same text, and a step's link with both fields cleared
 * leaves no link behind.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import OnboardingPathEditor, { linkFrom, readDays } from "./OnboardingPathEditor";

const DOC = {
  enabled: false,
  title: "Our first 14 days",
  phases: [{ key: "first", name: "Our first 14 days", fromDay: 1, toDay: 14, items: [{ key: "tech", title: "Technical Operations conversation", owner: "holder", dueDay: 10, doneWhen: "Held" }] }],
  circles: {},
  owners: { onboarding: "Welcomers" },
  checkins: [],
};

const json = () => JSON.parse((screen.getByLabelText("Onboarding path document (JSON)") as HTMLTextAreaElement).value);

describe("the onboarding path editor", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("moves a step to day 3 and names who it waits on, in the same document the JSON shows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ doc: DOC }), { status: 200 })));
    render(<OnboardingPathEditor password="pw" />);
    const row = (await screen.findAllByText("Step 1"))[0].closest("[data-step-row]") as HTMLElement;
    fireEvent.change(within(row).getByLabelText("Due by day"), { target: { value: "3" } });
    fireEvent.change(within(row).getByLabelText("Waits on"), { target: { value: "onboarding" } });
    expect(json().phases[0].items[0]).toMatchObject({ key: "tech", dueDay: 3, owner: "onboarding" });
    // The owner list names the village's own role where it has one.
    expect(within(row).getByRole("option", { name: "Welcomers" })).toBeTruthy();
  });

  it("writes a link, a check-in day, an owner and the switch; and adds a step", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ doc: DOC }), { status: 200 })));
    render(<OnboardingPathEditor password="pw" />);
    const row = (await screen.findAllByText("Step 1"))[0].closest("[data-step-row]") as HTMLElement;
    fireEvent.change(within(row).getByLabelText("Link words (optional)"), { target: { value: "Open the steward training" } });
    fireEvent.change(within(row).getByLabelText("Link address (optional)"), { target: { value: "/training/steward" } });
    fireEvent.change(screen.getByLabelText(/Check-in days/), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("Access"), { target: { value: "Keys" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Add a step" }));
    const doc = json();
    expect(doc.phases[0].items[0].link).toEqual({ label: "Open the steward training", href: "/training/steward" });
    expect(doc.checkins).toEqual([14]);
    expect(doc.owners).toEqual({ onboarding: "Welcomers", access: "Keys" });
    expect(doc.enabled).toBe(true);
    expect(doc.phases[0].items).toHaveLength(2);
  });

  it("pauses the form while the JSON does not read, and the JSON stays editable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ doc: DOC }), { status: 200 })));
    render(<OnboardingPathEditor password="pw" />);
    await screen.findAllByText("Step 1");
    fireEvent.change(screen.getByLabelText("Onboarding path document (JSON)"), { target: { value: "{ not json" } });
    expect(screen.getByRole("status").textContent).toContain("not valid JSON");
    expect(screen.queryByText("Step 1")).toBeNull();
  });

  it("reads check-in days and links the way a steward types them", () => {
    expect(readDays("7, 14 x 400 0")).toEqual([7, 14]);
    expect(linkFrom("", "  ")).toBeUndefined();
    expect(linkFrom("Go", "")).toEqual({ label: "Go", href: "" }); // half a link stays, so the save names it
  });
});
