// @vitest-environment jsdom
/**
 * THE CANVAS BASELINE, RENDERED (0222).
 *
 * The copy test reads the source for shapes a number can take. This file
 * renders the view and reads what a person would: every block's card in
 * canvas order, the radar, the credit, no form for somebody who does not hold
 * the pen, and for somebody who does, a form that refuses in the validator's
 * own words before it sends anything and sends a token when it does.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { CANVAS_BLOCK_IDS, CANVAS_CREDIT } from "@shared/governanceCanvas";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token" }));

import { CanvasBaseline } from "./CanvasBaseline";

const reading = (over: Record<string, unknown> = {}) => ({
  id: 7,
  level: 2,
  word: "Forming",
  sentence: "Two people decide most things and the rest of us hear about it afterwards.",
  moment: "baseline",
  momentLabel: "Baseline",
  recordedBy: { id: "u1", name: "Wren" },
  recordedAt: "2026-10-03T10:00:00.000Z",
  ...over,
});

const payload = (mayRecord: boolean) => ({
  mayRecord,
  blocks: CANVAS_BLOCK_IDS.map((id) =>
    id === "power"
      ? {
          id,
          latest: reading(),
          history: [reading(), reading({ id: 6, level: 1, word: "Absent", sentence: "Nobody had asked who decides." })],
        }
      : { id, latest: null, history: [] },
  ),
});

let calls: Array<{ url: string; init: any }>;
let answers: Array<{ status: number; body: unknown }>;

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      calls.push({ url: String(url), init });
      const next = answers.shift();
      if (!next) throw new Error(`the view called ${url}, which this test does not answer`);
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const draw = () =>
  render(
    <Router>
      <CanvasBaseline />
    </Router>,
  );

describe("what a member reads", () => {
  it("shows every block in canvas order, the radar and the credit, and asks with a token", async () => {
    answers.push({ status: 200, body: payload(false) });
    draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    expect(calls[0].url).toBe("/api/canvas");
    expect(calls[0].init.headers.Authorization).toBe("Bearer a-token");

    const cards = screen.getAllByTestId(/^canvas-block-/);
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual(CANVAS_BLOCK_IDS.map((id) => `canvas-block-${id}`));

    const power = within(screen.getByTestId("canvas-block-power"));
    expect(power.getByText("Forming")).toBeTruthy();
    expect(power.getByText(/Two people decide most things/)).toBeTruthy();
    // The newest reading and the one before it both say who and when.
    expect(power.getAllByText(/Recorded by Wren on/)).toHaveLength(2);
    expect(power.getByText("Earlier readings")).toBeTruthy();
    expect(power.getByText(/Nobody had asked who decides/)).toBeTruthy();
    expect(within(screen.getByTestId("canvas-block-legal")).getByText("No reading yet")).toBeTruthy();

    const credit = screen.getByRole("link", { name: new RegExp(CANVAS_CREDIT.text.slice(0, 40)) });
    expect(credit.getAttribute("href")).toBe(CANVAS_CREDIT.url);
  });

  it("offers no form to a member who does not hold the pen", async () => {
    answers.push({ status: 200, body: payload(false) });
    draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /record a reading/i })).toBeNull();
  });

  it("puts no percentage and no count of blocks anywhere on the page", async () => {
    answers.push({ status: 200, body: payload(false) });
    const { container } = draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    const text = container.textContent ?? "";
    expect(text).not.toContain("%");
    expect(text).not.toMatch(/\b\d+\s+of\s+\d+\b/);
    expect(text).not.toMatch(/\bof (twelve|12)\b/i);
    expect(container.querySelector("progress, [role='progressbar']")).toBeNull();
  });

  it("says so in words when the canvas cannot be read", async () => {
    answers.push({ status: 401, body: { error: "auth_required" } });
    draw();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Sign in to read the canvas."));
    expect(screen.queryByTestId("canvas-radar")).toBeNull();
  });
});

describe("what the pen can do", () => {
  it("refuses in the validator's words before sending anything", async () => {
    answers.push({ status: 200, body: payload(true) });
    draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    const legal = within(screen.getByTestId("canvas-block-legal"));
    fireEvent.click(legal.getByRole("button", { name: /record a reading/i }));
    fireEvent.click(legal.getByRole("button", { name: /save this reading/i }));
    await waitFor(() => expect(legal.getByRole("alert").textContent).toMatch(/1 \(Absent\) to 5 \(Thriving\)/));
    expect(calls).toHaveLength(1);
  });

  it("sends a checked reading with a token, then reads the canvas again", async () => {
    answers.push({ status: 200, body: payload(true) });
    draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    const legal = within(screen.getByTestId("canvas-block-legal"));
    fireEvent.click(legal.getByRole("button", { name: /record a reading/i }));
    fireEvent.click(legal.getByLabelText(/Emerging/));
    fireEvent.change(legal.getByLabelText(/Why, in one sentence/), {
      target: { value: "The land title is in one name and the statutes were never read by the group." },
    });
    answers.push({ status: 201, body: { reading: { blockId: "legal", ...reading({ level: 3, word: "Emerging" }) } } });
    answers.push({ status: 200, body: payload(true) });
    fireEvent.click(legal.getByRole("button", { name: /save this reading/i }));
    await waitFor(() => expect(calls).toHaveLength(3));

    expect(calls[1].url).toBe("/api/canvas/readings");
    expect(calls[1].init.method).toBe("POST");
    expect(calls[1].init.headers.Authorization).toBe("Bearer a-token");
    expect(JSON.parse(calls[1].init.body)).toEqual({
      blockId: "legal",
      level: 3,
      sentence: "The land title is in one name and the statutes were never read by the group.",
      moment: "baseline",
    });
    expect(calls[2].url).toBe("/api/canvas");
  });

  it("shows the server's refusal when the gate says no after all", async () => {
    answers.push({ status: 200, body: payload(true) });
    draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    const power = within(screen.getByTestId("canvas-block-power"));
    fireEvent.click(power.getByRole("button", { name: /record a reading/i }));
    fireEvent.click(power.getByLabelText(/Growing/));
    fireEvent.change(power.getByLabelText(/Why, in one sentence/), { target: { value: "The circle now decides and says so." } });
    answers.push({ status: 403, body: { error: "Recording a canvas reading is for whoever holds the village's story." } });
    fireEvent.click(power.getByRole("button", { name: /save this reading/i }));
    await waitFor(() => expect(power.getByRole("alert").textContent).toMatch(/whoever holds the village's story/));
    // A second reading of a block defaults to the canvas moon, not the baseline.
    expect(JSON.parse(calls[1].init.body).moment).toBe("canvas-moon");
  });
});
