// @vitest-environment jsdom
/**
 * THE CANVAS BASELINE, RENDERED (0232).
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
import { CANVAS_BLOCK_IDS, CANVAS_CREDIT, CANVAS_LEVELS, CANVAS_ORDER } from "@shared/governanceCanvas";
import { CANVAS_BLOCK_TEXT, CANVAS_SCALE_TEXT } from "@shared/governanceCanvasText";
import { readingDate, weeksPhrase } from "@/lib/canvasCopy";

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
    // The newest reading says who and when on the closed card.
    expect(power.getAllByText(/Recorded by Wren on/)).toHaveLength(1);
    expect(power.queryByText(/Nobody had asked who decides/)).toBeNull();
    // The one before it is in the block's Sense frame (Wave 3b), with its own who and when.
    fireEvent.click(power.getByRole("button", { name: "Open this block: Power" }));
    expect(await power.findByText("Earlier readings")).toBeTruthy();
    expect(power.getByText(/Nobody had asked who decides/)).toBeTruthy();
    expect(power.getAllByText(/Recorded by Wren on/)).toHaveLength(2);
    expect(within(screen.getByTestId("canvas-block-legal")).getByText("No reading yet")).toBeTruthy();
    // Opening a block on Sense asked the server for nothing more.
    expect(calls.map((c) => c.url)).toEqual(["/api/canvas"]);

    const credit = screen.getByRole("link", { name: new RegExp(CANVAS_CREDIT.text.slice(0, 40)) });
    expect(credit.getAttribute("href")).toBe(CANVAS_CREDIT.url);
  });

  it("leads every card with the canvas's own question, opens its description, and keeps our questions labelled as ours", async () => {
    answers.push({ status: 200, body: payload(false) });
    draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    for (const block of CANVAS_ORDER) {
      const card = within(screen.getByTestId(`canvas-block-${block.id}`));
      const question = card.getByTestId(`canvas-question-${block.id}`);
      expect(question.textContent, block.id).toBe(CANVAS_BLOCK_TEXT[block.id].question);
      expect(question.tagName, block.id).toBe("BLOCKQUOTE");
      expect(question.getAttribute("cite"), block.id).toBe(CANVAS_CREDIT.url);
      // The description sits inside a disclosure a reader opens.
      const description = card.getByText(CANVAS_BLOCK_TEXT[block.id].description);
      expect(description.closest("details")?.querySelector("summary")?.textContent).toBe("What the canvas says about it");
      // Our own question and prompts stay on the card, under our own heading.
      const ours = card.getByText(block.question).closest("details");
      expect(ours?.querySelector("summary")?.textContent).toBe("Our questions to talk through");
      for (const p of block.prompts) expect(within(ours as HTMLElement).getByText(p)).toBeTruthy();
    }
  });

  it("reads the radar's rings in the canvas's scale words, centre to edge", async () => {
    answers.push({ status: 200, body: payload(false) });
    draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    const legend = within(screen.getByTestId("canvas-scale-legend"));
    expect(legend.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      CANVAS_LEVELS.map((l) => `${CANVAS_SCALE_TEXT[l].word}: ${CANVAS_SCALE_TEXT[l].meaning}`),
    );
    expect(screen.getByText(/The rings run from Absent at the centre to Thriving at the edge/)).toBeTruthy();
  });

  it("credits the canvas on the view, says which words are quoted, and offers the workbook", async () => {
    answers.push({ status: 200, body: payload(false) });
    draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    const credit = within(screen.getByTestId("canvas-credit"));
    const link = credit.getByRole("link", { name: (name) => name.includes(CANVAS_CREDIT.text) });
    expect(link.getAttribute("href")).toBe(CANVAS_CREDIT.url);
    expect(screen.getByTestId("canvas-credit").textContent).toMatch(/question and description, and the words for the five levels, are quoted from the/);
    expect(credit.getByRole("link", { name: /print the canvas workbook/i }).getAttribute("href")).toBe("/canvas/workbook");
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

  it("shows no digit but a block's number, a date or a season week, with every block read", async () => {
    // A total comparator, not a list of banned shapes: "7 blocks have a
    // reading" needs no percent sign and no "of". So the page is drawn with
    // all twelve blocks read, and every digit left on it must be one of these.
    answers.push({
      status: 200,
      body: {
        mayRecord: false,
        blocks: CANVAS_BLOCK_IDS.map((id) => ({ id, latest: reading(), history: [reading(), reading({ id: 6 })] })),
      },
    });
    const { container } = draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    // What DID render: twelve newest readings, each with its date. The earlier
    // ones wait in each block's Sense frame, behind "Open this block".
    expect(screen.getAllByText(/Recorded by Wren on/)).toHaveLength(12);
    const date = readingDate(reading().recordedAt);
    expect(container.textContent).toContain(date);

    const allowed = [
      date,
      ...CANVAS_ORDER.map((b) => `Block ${b.number}`),
      ...CANVAS_ORDER.map((b) => weeksPhrase(b.seasonWeeks)).filter(Boolean),
    ].sort((a, b) => b.length - a.length); // "Block 12" goes before "Block 1"
    const leftover = () => {
      let rest = container.textContent ?? "";
      for (const s of allowed) rest = rest.split(s).join(" ");
      return rest.match(/.{0,30}\d.{0,30}/g);
    };
    expect(leftover()).toBeNull();

    // And with every block open on its Sense frame, where the earlier readings
    // moved (Wave 3b): twenty-four readings, and still no digit but those.
    for (const block of CANVAS_ORDER) {
      fireEvent.click(within(screen.getByTestId(`canvas-block-${block.id}`)).getByRole("button", { name: `Open this block: ${block.name}` }));
    }
    await waitFor(() => expect(screen.getAllByText(/Recorded by Wren on/)).toHaveLength(24));
    expect(leftover()).toBeNull();
    expect(calls.map((c) => c.url)).toEqual(["/api/canvas"]);
  });

  it("says so in words when the canvas cannot be read", async () => {
    answers.push({ status: 401, body: { error: "auth_required" } });
    draw();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Sign in to read the canvas."));
    expect(screen.queryByTestId("canvas-radar")).toBeNull();
  });

  it("prints the server's own sentence to an account the village has not admitted, and offers no retry", async () => {
    const sentence = "The canvas and its season are for the village's members. They open to you once the village admits you.";
    answers.push({ status: 403, body: { error: sentence } });
    draw();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(sentence));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByTestId("canvas-radar")).toBeNull();
  });

  it("offers Try again when the read failed for another reason, and reads the canvas again", async () => {
    answers.push({ status: 500, body: {} }, { status: 200, body: payload(false) });
    draw();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be read just now/));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    expect(calls.map((c) => c.url)).toEqual(["/api/canvas", "/api/canvas"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("one meaning per level on the page", () => {
  it("offers each level in the pen's form with the legend's own meaning, word for word", async () => {
    answers.push({ status: 200, body: payload(true) });
    draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    const legend = within(screen.getByTestId("canvas-scale-legend"))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    const legal = within(screen.getByTestId("canvas-block-legal"));
    fireEvent.click(legal.getByRole("button", { name: /record a reading/i }));
    const offered = (await legal.findAllByRole("radio")).map((r) => r.closest("label")?.textContent);
    expect(offered).toEqual(CANVAS_LEVELS.map((l) => `${CANVAS_SCALE_TEXT[l].word}: ${CANVAS_SCALE_TEXT[l].meaning}`));
    expect(offered).toEqual(legend);
  });
});

describe("what the pen can do", () => {
  it("refuses in the validator's words before sending anything", async () => {
    answers.push({ status: 200, body: payload(true) });
    draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    const legal = within(screen.getByTestId("canvas-block-legal"));
    fireEvent.click(legal.getByRole("button", { name: /record a reading/i }));
    fireEvent.click(await legal.findByRole("button", { name: /save this reading/i }));
    await waitFor(() => expect(legal.getByRole("alert").textContent).toMatch(/1 \(Absent\) to 5 \(Thriving\)/));
    expect(calls).toHaveLength(1);
  });

  it("sends a checked reading with a token, then reads the canvas again", async () => {
    answers.push({ status: 200, body: payload(true) });
    draw();
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    const legal = within(screen.getByTestId("canvas-block-legal"));
    fireEvent.click(legal.getByRole("button", { name: /record a reading/i }));
    fireEvent.click(await legal.findByLabelText(/Emerging/));
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
    fireEvent.click(await power.findByLabelText(/Growing/));
    fireEvent.change(power.getByLabelText(/Why, in one sentence/), { target: { value: "The circle now decides and says so." } });
    answers.push({ status: 403, body: { error: "Recording a canvas reading is for whoever holds the village's story." } });
    fireEvent.click(power.getByRole("button", { name: /save this reading/i }));
    await waitFor(() => expect(power.getByRole("alert").textContent).toMatch(/whoever holds the village's story/));
    // A second reading of a block defaults to the canvas moon, not the baseline.
    expect(JSON.parse(calls[1].init.body).moment).toBe("canvas-moon");
  });
});
