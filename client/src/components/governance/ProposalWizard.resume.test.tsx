// @vitest-environment jsdom
/**
 * A REFRESH, BACK OR FORWARD KEEPS THE WORK (red team U3).
 *
 * The live walkthrough lost visible work on a refresh, left duplicate drafts
 * (one "Untitled") because a prefilled start autosaved before anything was
 * written, and Back left the page instead of stepping back. Now: an untouched
 * start saves nothing; the first save names the draft in the address
 * (`?draft=<id>`), and the page opened at that address resumes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProposalWizard, { draftFromUrl } from "./ProposalWizard";
import { walkFor } from "./wizardWalk";

vi.mock("@/components/natural", () => ({ BreathingLoader: () => null }));
vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "u-ana" } }), useAuth: () => ({ user: { id: "u-ana" } }) }));

const DRAFT = {
  id: "pd-resume-1",
  wizardType: "role_application",
  payload: { seatIds: ["seat-1"], fitStatement: "I kept the orchard ledger last season." },
  stepIndex: 2,
  createdAt: "2026-10-09T10:00:00Z",
  updatedAt: "2026-10-09T10:05:00Z",
};

const asked: string[] = [];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/governance/wizard") return json({ conductable: ["role_application"], advisory: [], mayOpenAdvisory: false, supportThreshold: 0, draftCap: 5 });
      if (url === "/api/governance/drafts" && init?.method === "POST") return json({ success: true, draft: DRAFT, created: true });
      if (url === "/api/governance/drafts") return json({ cap: 5, drafts: [DRAFT] });
      if (url === "/api/org") return json({ roles: [{ id: "seat-1", name: "Orchard keeper", state: "open", holders: [] }], circles: [] });
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/propose");
});

describe("the wizard's address", () => {
  it("reads only a well-formed draft id from it", () => {
    expect(draftFromUrl("?draft=pd-resume-1")).toBe("pd-resume-1");
    expect(draftFromUrl("?draft=../../x")).toBeNull();
    expect(draftFromUrl("?type=role_application")).toBeNull();
  });

  it("an untouched prefilled start saves no draft", async () => {
    window.history.replaceState(null, "", "/propose?type=role_application&seat=seat-1");
    render(<ProposalWizard start={{ type: "role_application", answers: { seatIds: ["seat-1"] } }} />);
    await waitFor(() => expect(asked).toContain("GET /api/governance/drafts"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1800));
    });
    expect(asked.filter((a) => a === "POST /api/governance/drafts")).toEqual([]);
  });

  it("opened at ?draft=<id>, resumes that draft at its step with its words", async () => {
    window.history.replaceState(null, "", "/propose?draft=pd-resume-1");
    render(<ProposalWizard />);
    expect(await screen.findByDisplayValue("I kept the orchard ledger last season.")).toBeTruthy();
    expect(window.location.search).toBe("?draft=pd-resume-1");
  });
});

describe("focus follows the step (red team U10)", () => {
  it("arriving moves no focus; each Next puts focus on the new step's heading, named for the step", async () => {
    const label = (key: string) => walkFor("role_application").find((s) => s.key === key)!.label;
    window.history.replaceState(null, "", "/propose?type=role_application&seat=seat-1");
    render(<ProposalWizard start={{ type: "role_application", answers: { seatIds: ["seat-1"] } }} />);
    const subject = await screen.findByRole("heading", { level: 2, name: label("subject") });
    expect(document.activeElement).not.toBe(subject);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const details = await screen.findByRole("heading", { level: 2, name: label("details") });
    await waitFor(() => expect(document.activeElement).toBe(details));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const terms = await screen.findByRole("heading", { level: 2, name: label("terms") });
    await waitFor(() => expect(document.activeElement).toBe(terms));
  });
});

describe("no error before any input (red team U11)", () => {
  const PICK = "Pick the seat you are applying for.";
  const SHORT_DELIVERABLES = /^Your list of deliverables needs at least 40 characters/;
  const SHORT_WHY = /^"Why you" needs at least 30 characters/;

  it("arriving at a step shows no error; leaving a field shows its own; Next then Back shows the step's", async () => {
    window.history.replaceState(null, "", "/propose?type=role_application");
    render(<ProposalWizard start={{ type: "role_application", answers: {} }} />);
    const label = (key: string) => walkFor("role_application").find((s) => s.key === key)!.label;
    await screen.findByRole("heading", { level: 2, name: label("subject") });
    // Arrival: the empty seat pick is not yet a mistake.
    expect(screen.queryByText(PICK)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { level: 2, name: label("details") });
    expect(screen.queryByText(SHORT_DELIVERABLES)).toBeNull();
    // Writing too little and leaving the field: that field's problem, and only that one.
    const deliverables = screen.getByLabelText(/Deliverables for the season/);
    fireEvent.focus(deliverables);
    fireEvent.change(deliverables, { target: { value: "Too short." } });
    fireEvent.blur(deliverables);
    expect(await screen.findByText(SHORT_DELIVERABLES)).toBeTruthy();
    expect(screen.queryByText(SHORT_WHY)).toBeNull();

    // Moving on submits the step; coming back to it shows what it still lacks, in the label's words.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { level: 2, name: label("terms") });
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`^${label("details")}, completed`) })[0]);
    await screen.findByRole("heading", { level: 2, name: label("details") });
    expect(await screen.findByText(SHORT_WHY)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`^${label("subject")}, completed`) })[0]);
    await screen.findByRole("heading", { level: 2, name: label("subject") });
    expect(await screen.findByText(PICK)).toBeTruthy();
  });
});

describe("the seat preview says what it shows (red team U11)", () => {
  it("one seat: the seat you picked; several: the first, and the terms cover them all", async () => {
    const one = render(<ProposalWizard start={{ type: "role_application", answers: { seatIds: ["seat-1"] } }} />);
    expect((await screen.findAllByText("Shows the seat you picked.")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Shows the role you picked.")).toBeNull();
    one.unmount();
    render(<ProposalWizard start={{ type: "role_application", answers: { seatIds: ["seat-1", "seat-2"] } }} />);
    expect((await screen.findAllByText("Shows the first seat you picked. Your terms cover every seat you picked.")).length).toBeGreaterThan(0);
  });
});
