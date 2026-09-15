// @vitest-environment jsdom
/**
 * WHO GETS THE TEST RUN, AND WHAT THEY GET WITH IT (R12).
 *
 * Rye: "any member as all members may suggest upgrades and will need to run
 * models and tests." `server/routes/dryRun.ts` answers any signed-in member,
 * and `server/dryRun.routes.e2e.test.ts` proves that over HTTP. Neither of
 * them can prove a member REACHES it: this page gated its whole body on
 * `isAdmin` and returned a locked card to everybody else, so a route a member
 * could call was still a button a member could not press.
 *
 * The three states this file holds apart:
 *
 *   a signed-out visitor meets the wall and no run button;
 *   a signed-in member gets the run and NONE of the admin affordances;
 *   an admin gets the checklist and the run, as before.
 *
 * And two the card itself has to hold apart, which is the other half of the
 * same discipline: a REFUSAL is not an empty report, and an empty report is not
 * a missing one. A 429 renders the server's sentence; a report carrying no
 * refusals says so in words instead of rendering a blank panel a reader would
 * take for a still-running button.
 *
 * `Layout`, `MicButton` and the economics view are mocked to passthroughs.
 * This file's subject is who sees what, not the shell around it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

const auth = vi.hoisted(() => ({
  current: { user: null as any, loading: false },
}));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/MicButton", () => ({ default: () => null }));
vi.mock("@/pages/ProjectHistory", () => ({ EconomicsView: () => null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.current }));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token" }));

import JourneyToLaunch from "./JourneyToLaunch";

/**
 * A report with something in every panel the card renders, so a missing panel
 * is a missing assertion and not a missing fixture.
 */
const REPORT = {
  moons: 3,
  spanDays: 89,
  gameStarted: false,
  isolation: "This run wrote nothing. It read your settings and worked out what each moon would do.",
  turns: [
    {
      cycleNumber: 1042,
      cycleKey: "lunar-001042",
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: "2026-09-30T00:00:00.000Z",
      findings: [{ area: "settlement", outcome: "issued", sentence: "2 seat holders each thanked 20 Gratitude." }],
    },
  ],
  runFindings: [
    { area: "issuance", outcome: "idle", sentence: "This village has not started its Game, so nothing above was issued." },
  ],
  allowances: [
    { stageId: "seedling", stageName: "Seedling", allowance: 100, shareCap: 20, heartsSendable: true, note: "A member at Seedling gives 100 a moon." },
  ],
  jobs: [{ name: "moon-settlement", cadence: "every hour", runsInSpan: "2136", note: "Asks every hour." }],
  refusals: [
    { area: "claims", outcome: "refused", sentence: "No Hypha space is set, so voice gathers correctly and nobody can claim it." },
  ],
  covered: ["The moon settlement: which rules pay."],
  notCovered: ["Real sending. Nothing was given."],
};

/** The launch status an admin's page loads on mount. */
const STATUS = {
  items: [
    {
      id: "backups-drilled",
      group: "reach",
      title: "Take one backup and restore it once",
      why: "A backup nobody has restored is a hope.",
      detail: "Not confirmed yet",
      severity: "blocking",
      state: "open",
      fixAt: "/admin?tab=settings",
      fixLabel: "Open Data & backups",
      checkKey: "manual:backups-drilled",
    },
  ],
  blockingOpen: 1,
  recommendedOpen: 0,
  launchedAt: null,
  vote: null,
};

/** Every call the page makes, so a test can read WHERE it went as well as what came back. */
let calls: Array<{ url: string; init: any }>;

function answer(routes: Record<string, { status: number; body: unknown }>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      calls.push({ url: String(url), init });
      const hit = routes[String(url)];
      if (!hit) throw new Error(`the page called ${url}, which this test does not answer`);
      return {
        ok: hit.status >= 200 && hit.status < 300,
        status: hit.status,
        json: async () => hit.body,
      };
    }),
  );
}

const draw = () =>
  render(
    <Router>
      <JourneyToLaunch />
    </Router>,
  );

beforeEach(() => {
  auth.current = { user: null, loading: false };
  answer({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("who reaches the test run", () => {
  it("shows a signed-out visitor the wall, and no way to run anything", () => {
    draw();
    expect(screen.getByText("Journey to Launch")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /run the test/i })).toBeNull();
    expect(calls, "a signed-out page asks the server for nothing").toEqual([]);
  });

  it("gives a signed-in member the run, and none of the admin affordances", () => {
    auth.current = { user: { id: "u2", name: "Wren", role: "member" }, loading: false };
    draw();
    expect(screen.getByRole("button", { name: /run the test/i })).toBeTruthy();
    // The checklist, its confirmations, the ballot and the guide all stay with
    // the team running the village.
    expect(screen.queryByText(/Take one backup/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /mark done/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /ask the village/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /ask the guide/i })).toBeNull();
    expect(screen.queryByText(/Readiness/i)).toBeNull();
    // And the page does not try to read a payload a member cannot have.
    expect(calls.map((c) => c.url), "no admin read on a member's page").toEqual([]);
  });

  it("still gives an admin the checklist and the run together", async () => {
    auth.current = { user: { id: "u1", name: "Rye", role: "admin" }, loading: false };
    answer({ "/api/admin/launch": { status: 200, body: STATUS } });
    draw();
    await waitFor(() => expect(screen.getByText(/Take one backup/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: /run the test/i })).toBeTruthy();
    expect(calls[0].url).toBe("/api/admin/launch");
  });
});

describe("what the member's run does", () => {
  const asMember = () => {
    auth.current = { user: { id: "u2", name: "Wren", role: "member" }, loading: false };
  };

  it("posts to the member door with a token, and never to the admin one", async () => {
    asMember();
    answer({ "/api/dry-run": { status: 200, body: REPORT } });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /run the test/i }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].url).toBe("/api/dry-run");
    expect(calls[0].url).not.toContain("/api/admin/");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("Bearer a-token");
  });

  it("renders the report for a member, refusals first", async () => {
    asMember();
    answer({ "/api/dry-run": { status: 200, body: REPORT } });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /run the test/i }));
    await waitFor(() => expect(screen.getByText(/One thing would not work as set/i)).toBeTruthy());
    expect(screen.getByText(/No Hypha space is set/i)).toBeTruthy();
    expect(screen.getByText(/has not started its Game/i)).toBeTruthy();
    expect(screen.getByText(/A member at Seedling gives 100 a moon/i)).toBeTruthy();
    expect(screen.getByText(/This run wrote nothing/i)).toBeTruthy();
    expect(screen.getByText(/Real sending/i)).toBeTruthy();
  });

  /*
   * A REFUSAL IS NOT AN EMPTY REPORT. The rate limit answers 429 with a
   * sentence, and a card that swallowed it would leave a member looking at a
   * button that appeared to do nothing.
   */
  it("prints the server's sentence when the hourly budget is spent", async () => {
    asMember();
    const message =
      "A test run reads every rule and dial this village holds, so each person may ask for 20 of them an hour.";
    answer({ "/api/dry-run": { status: 429, body: { error: "too_many", message } } });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /run the test/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("20 of them an hour");
    // The refused run leaves no half report behind it.
    expect(screen.queryByText(/Across the whole run/i)).toBeNull();
  });

  /*
   * AND AN EMPTY REPORT IS NOT A MISSING ONE. A village with nothing to refuse
   * is a real answer and says so in words.
   */
  it("says nothing was refused, in words, when nothing was", async () => {
    asMember();
    answer({ "/api/dry-run": { status: 200, body: { ...REPORT, refusals: [] } } });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /run the test/i }));
    await waitFor(() => expect(screen.getByText(/Nothing refused across the whole run/i)).toBeTruthy());
    expect(screen.getByText(/Every rule this run reached would pay what it says it pays/i)).toBeTruthy();
    expect(screen.queryByRole("alert"), "an empty result is not an error").toBeNull();
  });
});
