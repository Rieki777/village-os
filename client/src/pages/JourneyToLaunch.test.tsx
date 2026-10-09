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
/** What /api/game/me says about the signed-in member: admitted by default, as a member of the village is. */
const me = vi.hoisted(() => ({ current: { membership: true } as { membership: boolean } | null, asked: 0 }));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/MicButton", () => ({ default: () => null }));
vi.mock("@/components/journey/EconomicsView", () => ({ EconomicsView: () => null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.current }));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => "a-token",
  useGameConfig: () => ({ brochurePages: true }),
  fetchGameMe: async () => {
    me.asked += 1;
    return me.current;
  },
}));

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
  me.current = { membership: true };
  me.asked = 0;
  // The open view is read from the address, so every test starts on the page's own.
  window.history.replaceState({}, "", "/journey-to-launch");
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

  /*
   * DEFECT 10 (Wave 4): the guide's only door hid once the village launched,
   * so the organizing counsel a live village needs most was unreachable, and
   * the Brain tab's promise about it was a promise about a closed door.
   */
  it("keeps the guide after launch, and opens it on organizing with no launch tab", async () => {
    auth.current = { user: { id: "u1", name: "Rye", role: "admin" }, loading: false };
    answer({
      "/api/admin/launch": { status: 200, body: { ...STATUS, launchedAt: "2026-10-31T12:00:00.000Z" } },
      "/api/admin/launch/steward-candidates": { status: 200, body: { candidates: [], powerCount: 0 } },
      "/api/admin/assistant/organize": {
        status: 200,
        body: { reply: "Start with the decisions section.", consulted: { ownRecord: [], references: [], readers: [], brief: ["decisions"] }, path: "loop" },
      },
    });
    draw();
    await waitFor(() => expect(screen.getByText("This village is live")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /ask the guide/i }));
    expect(screen.getByRole("button", { name: "Organizing" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Launch" })).toBeNull();
    // And a question goes to the organizing door, which reads the brief, and
    // the answer names the brief section it read.
    fireEvent.change(screen.getByPlaceholderText(/Ask about any step/), { target: { value: "where do we start" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Ask about any step/), { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Start with the decisions section.")).toBeTruthy());
    expect(calls.map((c) => c.url)).toContain("/api/admin/assistant/organize");
    expect(calls.map((c) => c.url)).not.toContain("/api/admin/assistant/launch");
    expect(screen.getByText(/Your brief: decisions\./)).toBeTruthy();
  });

  it("keeps both tabs before launch, opening on the launch", async () => {
    auth.current = { user: { id: "u1", name: "Rye", role: "admin" }, loading: false };
    answer({
      "/api/admin/launch": { status: 200, body: STATUS },
      "/api/admin/launch/steward-candidates": { status: 200, body: { candidates: [], powerCount: 0 } },
    });
    draw();
    await waitFor(() => expect(screen.getByText(/Take one backup/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /ask the guide/i }));
    expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Organizing" })).toBeTruthy();
    expect(screen.getByText(/I can see exactly where your launch stands/)).toBeTruthy();
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

/*
 * THE CANVAS VIEW (0232). Members read the canvas as well as admins, so the
 * tab has to be on the member's copy of this page too, and it must not ask
 * the server for anything until somebody opens it.
 */
describe("the canvas view", () => {
  const EMPTY_CANVAS = { mayRecord: false, blocks: [] };
  /** No season loaded: the season panel says so and the cards stay in canvas order. */
  const NO_SEASON = { season: null, savedBy: null, savedAt: null, problem: null, mayEdit: false };
  /** No next new moon to show: the canvas moon card stays off the page. */
  const NO_MOON = { next: null, gathering: null, calendarOn: false, mayOffer: false };

  it("is a tab a signed-in member can open, and it reads the members' doors", async () => {
    auth.current = { user: { id: "u2", name: "Wren", role: "member" }, loading: false };
    answer({
      "/api/canvas": { status: 200, body: EMPTY_CANVAS },
      "/api/canvas/season": { status: 200, body: NO_SEASON },
      "/api/canvas/moon": { status: 200, body: NO_MOON },
    });
    draw();
    expect(calls, "nothing is asked until the tab is opened").toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Canvas" }));
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/No season is loaded/)).toBeTruthy());
    expect(calls.map((c) => c.url).sort()).toEqual(["/api/canvas", "/api/canvas/moon", "/api/canvas/season"]);
    for (const c of calls) expect(c.init.headers.Authorization, c.url).toBe("Bearer a-token");
    expect(screen.getByText("How this village governs itself")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /run the test/i }), "the test run steps aside").toBeNull();
  });

  it("keeps the open tab in the address, so Back from the workbook or a reload lands on it again", async () => {
    auth.current = { user: { id: "u2", name: "Wren", role: "member" }, loading: false };
    answer({
      "/api/canvas": { status: 200, body: EMPTY_CANVAS },
      "/api/canvas/season": { status: 200, body: NO_SEASON },
      "/api/canvas/moon": { status: 200, body: NO_MOON },
    });
    const first = draw();
    const depth = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "Canvas" }));
    expect(window.location.pathname + window.location.search).toBe("/journey-to-launch?view=canvas");
    expect(window.history.length, "a tab is not a page in the history").toBe(depth);
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    first.unmount();

    // What Back and a reload do: the page mounts again at the same address.
    draw();
    expect(screen.getByText("How this village governs itself")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Test run" }));
    expect(window.location.search, "the page's own view needs no parameter").toBe("");
    expect(screen.getByText("See what these settings would do")).toBeTruthy();
  });

  it("opens on the page's own view when the address names no view it has", () => {
    auth.current = { user: { id: "u2", name: "Wren", role: "member" }, loading: false };
    window.history.replaceState({}, "", "/journey-to-launch?view=nonsense");
    draw();
    expect(screen.getByText("See what these settings would do")).toBeTruthy();
    expect(calls, "the canvas is not asked for").toEqual([]);
  });

  it("is not offered to a signed-in account the village has not admitted, which gets the test run alone", async () => {
    auth.current = { user: { id: "u3", name: "Rook", role: "member" }, loading: false };
    me.current = { membership: false };
    draw();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Canvas" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Test run" }), "no tab row with one tab in it").toBeNull();
    expect(screen.getByText("See what these settings would do")).toBeTruthy();
    expect(calls.map((c) => c.url), "the canvas is never asked for").not.toContain("/api/canvas");
  });

  it("stays offered when the profile cannot be read, since the server still decides", async () => {
    auth.current = { user: { id: "u2", name: "Wren", role: "member" }, loading: false };
    me.current = null;
    draw();
    await waitFor(() => expect(me.asked).toBe(1));
    // Let the answer land before reading the page, so this reads the state AFTER it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("button", { name: "Canvas" })).toBeTruthy();
  });

  it("sits beside the admin's other views and takes the counts off the screen", async () => {
    auth.current = { user: { id: "u1", name: "Rye", role: "admin" }, loading: false };
    answer({
      "/api/admin/launch": { status: 200, body: STATUS },
      "/api/admin/launch/steward-candidates": { status: 200, body: { candidates: [], powerCount: 0 } },
      "/api/canvas": { status: 200, body: EMPTY_CANVAS },
      "/api/canvas/season": { status: 200, body: NO_SEASON },
      "/api/canvas/moon": { status: 200, body: NO_MOON },
    });
    draw();
    await waitFor(() => expect(screen.getByText(/Take one backup/i)).toBeTruthy());
    expect(screen.getByTestId("journey-remaining").className).not.toContain("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Canvas" }));
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    expect(screen.getByTestId("journey-remaining").className).toContain("hidden");
    expect(screen.queryByText(/Take one backup/i)).toBeNull();
  });

  /*
   * THE CANVAS ROW'S LINK IS THIS PAGE. The view is read from the address on
   * arrival, so a plain link to `?view=canvas` from the launch view would move
   * the address and leave the screen where it was. The row switches the view.
   */
  it("opens the Canvas view in place from the canvas row on the checklist", async () => {
    auth.current = { user: { id: "u1", name: "Rye", role: "admin" }, loading: false };
    const canvasRow = {
      id: "canvas-on-record",
      group: "governance",
      title: "Put every canvas block on record",
      why: "Each block carries a reading.",
      detail: "No block has a reading yet",
      severity: "blocking",
      state: "missing",
      fixAt: "/journey-to-launch?view=canvas",
      fixLabel: "Open the Canvas",
      checkKey: "canvas:on-record",
    };
    answer({
      "/api/admin/launch": { status: 200, body: { ...STATUS, items: [...STATUS.items, canvasRow], blockingOpen: 2 } },
      "/api/admin/launch/steward-candidates": { status: 200, body: { candidates: [], powerCount: 0 } },
      "/api/canvas": { status: 200, body: EMPTY_CANVAS },
      "/api/canvas/season": { status: 200, body: NO_SEASON },
      "/api/canvas/moon": { status: 200, body: NO_MOON },
    });
    draw();
    await waitFor(() => expect(screen.getByText("Put every canvas block on record")).toBeTruthy());
    // Its own section, named for what it asks.
    expect(screen.getByText("How the village decides and cares")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open the Canvas/ }));
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    expect(window.location.search).toBe("?view=canvas");
    expect(screen.queryByText("Put every canvas block on record")).toBeNull();
  });
});

/*
 * R55: NO READINESS SCORE. The header carried a percentage and a bar, a
 * composite number over rows of different weight. What is left is two counts,
 * and nothing on the admin's page reads as a grade.
 */
describe("what is left, said without a score", () => {
  it("shows the two counts and no percentage, bar or readiness figure", async () => {
    auth.current = { user: { id: "u1", name: "Rye", role: "admin" }, loading: false };
    answer({
      "/api/admin/launch": { status: 200, body: { ...STATUS, recommendedOpen: 3 } },
      "/api/admin/launch/steward-candidates": { status: 200, body: { candidates: [], powerCount: 0 } },
    });
    const { container } = draw();
    await waitFor(() => expect(screen.getByText(/Take one backup/i)).toBeTruthy());
    expect(screen.getByTestId("journey-remaining").textContent).toBe("1 blocking · 3 recommended remaining");
    expect(screen.queryByText(/Readiness/)).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/\d+\s*%/);
    expect(container.querySelector("[style*='width']"), "no bar drawn to a width").toBeNull();
  });
});
