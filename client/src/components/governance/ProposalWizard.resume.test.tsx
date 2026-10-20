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
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import ProposalWizard, { draftFromUrl } from "./ProposalWizard";

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
