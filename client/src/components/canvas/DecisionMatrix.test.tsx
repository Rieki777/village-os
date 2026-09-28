// @vitest-environment jsdom
/**
 * THE DECISION MATRIX, RENDERED (plan 2.3 and 7 item 3).
 *
 * The payload is the real generator's output (shared/decisionMatrix.ts) on a
 * fresh village's shipped settings, so what renders here is what the route
 * would serve. The test reads what a member would: the matrix opens from the
 * Power block and nowhere else, asks the server only once somebody opens it,
 * names the canvas's five columns beside every answer, carries the credit,
 * and says a refusal in the server's own words.
 *
 * ── WHAT jsdom CANNOT SHOW, SAID PLAINLY ───────────────────────────────────
 *
 * The switch between the stacked cards and the table is a container query,
 * and jsdom lays nothing out. So the layout is asserted by the classes that
 * make it: every column named inside each row (visible when stacked, hidden
 * from sight in the table), and a header row drawn only when the box is at
 * least 40rem wide. Whether that looks right at 375px is a question for a
 * real browser, and this file does not claim to answer it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { CANVAS_BLOCK_IDS, CANVAS_CREDIT } from "@shared/governanceCanvas";
import { CANVAS_DECISION_MATRIX_COLUMNS } from "@shared/governanceCanvasText";
import { generateDecisionMatrix, VETO_OVERRIDE_NOTE, type DecisionMatrix as Matrix } from "@shared/decisionMatrix";
import { VARIABLES_BY_KEY } from "@shared/gameVariables";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token" }));

import DecisionMatrix from "./DecisionMatrix";
import { CanvasBaseline } from "./CanvasBaseline";

const shipped = (key: string) => String(VARIABLES_BY_KEY[key]!.default);

/** The generator's own output for a fresh village, one power held by a named role, one row tagged. */
const matrix = (): Matrix =>
  generateDecisionMatrix({
    defaultMethod: shipped("governance.default_method"),
    village: { unityPct: Number(shipped("governance.unity_pct")), quorumPct: Number(shipped("governance.quorum_pct")) },
    governanceOnForMembers: true,
    supportThreshold: 0,
    sensingDays: Number(shipped("governance.sensing_days")),
    steward: {
      seated: 1,
      council: false,
      vetoHoursRaw: 72,
      subjectInReach: () => true,
      tiersInReach: new Set(["constitutional"] as const),
    },
    handoverComplete: false,
    powers: [{ capability: "dial.set", villageHolds: true, holderRoleName: "The Dial Keepers", liveHolders: 2, rolesCarrying: [] }],
    riskTags: { "vote:mint_rule": ["budget"] },
  });

let calls: Array<{ url: string; init: any }>;
let answers: Array<{ status: number; body: unknown } | "network">;

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      calls.push({ url: String(url), init });
      const next = answers.shift();
      if (!next) throw new Error(`the view called ${url}, which this test does not answer`);
      if (next === "network") throw new TypeError("Failed to fetch");
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const open = () => fireEvent.click(screen.getByRole("button", { name: "Show who decides what" }));

describe("the matrix a member opens", () => {
  it("asks the server nothing until somebody opens it, then asks once, with their token", async () => {
    render(<DecisionMatrix />);
    expect(calls).toEqual([]);
    expect(screen.queryByTestId("matrix-group-votes")).toBeNull();

    answers.push({ status: 200, body: matrix() });
    open();
    await waitFor(() => expect(screen.getByTestId("matrix-group-votes")).toBeTruthy());
    expect(calls.map((c) => c.url)).toEqual(["/api/canvas/decision-matrix"]);
    expect(calls[0].init.headers.Authorization).toBe("Bearer a-token");

    // Closing and opening again reads what it already has.
    fireEvent.click(screen.getByRole("button", { name: "Hide who decides what" }));
    open();
    expect(calls).toHaveLength(1);
    expect(screen.getByTestId("matrix-group-powers")).toBeTruthy();
  });

  it("shows every row the server sent, under its group, with the canvas's five columns named beside each answer", async () => {
    const m = matrix();
    answers.push({ status: 200, body: m });
    render(<DecisionMatrix />);
    open();
    await waitFor(() => expect(screen.getByTestId("matrix-group-votes")).toBeTruthy());

    for (const group of m.groups) {
      const section = screen.getByTestId(`matrix-group-${group.id}`);
      expect(within(section).getByRole("heading", { name: group.title })).toBeTruthy();
      for (const r of group.rows) {
        const rowEl = within(section).getByTestId(`matrix-row-${r.key}`);
        expect(rowEl.tagName).toBe("DL");
        const labels = Array.from(rowEl.querySelectorAll("dt")).map((dt) => dt.textContent);
        expect(labels, r.key).toEqual([...CANVAS_DECISION_MATRIX_COLUMNS]);
        expect(rowEl.textContent, r.key).toContain(r.decision);
        expect(rowEl.textContent, r.key).toContain(r.approval.text);
        for (const line of [...r.consultation, ...r.information, ...r.method.lines]) expect(rowEl.textContent, r.key).toContain(line);
      }
    }
    const held = screen.getByTestId("matrix-row-power:dial.set");
    expect(held.textContent).toContain("The village holds it, with The Dial Keepers.");
    expect(screen.getByTestId("matrix-row-vote:mint_rule").textContent).toContain("Risk: budget");
  });

  it("stacks under 40rem of its own width and lines up as a table above it", async () => {
    answers.push({ status: 200, body: matrix() });
    render(<DecisionMatrix />);
    open();
    await waitFor(() => expect(screen.getByTestId("matrix-group-votes")).toBeTruthy());

    const body = screen.getByRole("region", { name: "The Decision Matrix" });
    expect(body.className).toContain("@container");
    const header = within(screen.getByTestId("matrix-group-votes")).getByText(CANVAS_DECISION_MATRIX_COLUMNS[0]!, {
      selector: "span",
    }).parentElement!;
    expect(header.getAttribute("aria-hidden")).toBe("true");
    expect(header.className).toMatch(/(^| )hidden( |$)/);
    expect(header.className).toContain("@min-[40rem]:grid");
    const row = screen.getByTestId("matrix-row-vote:mechanics:routine");
    expect(row.className).toContain("@min-[40rem]:grid-cols-5");
    for (const dt of Array.from(row.querySelectorAll("dt"))) expect(dt.className).toContain("@min-[40rem]:sr-only");
  });

  it("carries the canvas's credit and the notes, the override among them as unavailable", async () => {
    const m = matrix();
    answers.push({ status: 200, body: m });
    render(<DecisionMatrix />);
    open();
    await waitFor(() => expect(screen.getByTestId("decision-matrix-notes")).toBeTruthy());
    const credit = screen.getByTestId("decision-matrix-credit");
    const link = within(credit).getByRole("link");
    expect(link.getAttribute("href")).toBe(CANVAS_CREDIT.url);
    expect(link.textContent).toContain(CANVAS_CREDIT.text);
    const notes = screen.getByTestId("decision-matrix-notes");
    for (const note of m.notes) expect(notes.textContent).toContain(note);
    expect(notes.textContent).toContain(VETO_OVERRIDE_NOTE);
    expect(screen.getByTestId("decision-matrix").textContent).not.toContain("%");
  });
});

describe("when the matrix cannot be read", () => {
  it("prints the server's refusal and offers nothing to press", async () => {
    answers.push({ status: 403, body: { error: "The canvas and its season are for the village's members." } });
    render(<DecisionMatrix />);
    open();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("The canvas and its season are for the village's members.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offers to try again after a network failure, and a second read that works shows the matrix", async () => {
    answers.push("network");
    render(<DecisionMatrix />);
    open();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("The matrix could not be read just now."));
    answers.push({ status: 200, body: matrix() });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("matrix-group-powers")).toBeTruthy());
    expect(calls).toHaveLength(2);
  });
});

describe("where it lives", () => {
  it("opens from the Power block, and from no other block", async () => {
    answers.push({
      status: 200,
      body: { mayRecord: false, blocks: CANVAS_BLOCK_IDS.map((id) => ({ id, latest: null, history: [] })) },
    });
    render(
      <Router>
        <CanvasBaseline />
      </Router>,
    );
    const power = await screen.findByTestId("canvas-block-power");
    await waitFor(() => expect(within(power).getByRole("button", { name: "Show who decides what" })).toBeTruthy());
    expect(screen.getAllByTestId("decision-matrix")).toHaveLength(1);
    // Rendering the Power block asked for the canvas and nothing else.
    expect(calls.map((c) => c.url)).toEqual(["/api/canvas"]);
  });
});
