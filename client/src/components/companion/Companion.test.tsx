// @vitest-environment jsdom
/**
 * THE COMPANION'S DOORS AND ITS LINE, RENDERED (Wave 4, plan 5.4).
 *
 *   a door drawn outside the Canvas view's provider draws nothing, so no
 *   button ever opens onto nothing;
 *   the header door opens the panel on the whole canvas, a card's door on its
 *   block, and the question carries that block to the server;
 *   when the server hands back the line, the panel shows it, and "Agree"
 *   sends back exactly the line shown, then asks the same question again,
 *   and never sends the panel's own notes as the conversation.
 *
 * The server is a table of answers by method and path, so a request the panel
 * should not make fails the test by name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token" }));

import { AskButton, CompanionProvider } from "./Companion";
import { askFailure } from "./CompanionPanel";

const LINE = {
  provider: "Anthropic",
  operator: "Riverbend",
  source: "village",
  sentence: "To answer in its own words, the guide sends your question, and what it reads from the village's record for you, to Anthropic, on Riverbend's own key.",
};

let calls: Array<{ key: string; body: any }>;
let answers: Record<string, Array<{ status: number; body: unknown }>>;

beforeEach(() => {
  calls = [];
  answers = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push({ key, body: init?.body ? JSON.parse(init.body) : undefined });
      const queue = answers[key];
      if (!queue || queue.length === 0) throw new Error(`the panel called ${key}, which this test does not answer`);
      const hit = queue.length > 1 ? queue.shift()! : queue[0];
      return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, json: async () => hit.body };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const draw = (ui: React.ReactNode) => render(<Router>{ui}</Router>);

describe("the doors", () => {
  it("draw nothing outside the Canvas view's provider", () => {
    draw(<AskButton block="power" label="Ask" name="Ask about Power" />);
    expect(screen.queryByRole("button", { name: /ask/i })).toBeNull();
  });

  it("open the panel on the block they sit on, and the question carries it", async () => {
    answers["GET /api/agent/companion"] = [{ status: 200, body: { connected: false, disclosure: null, consent: null } }];
    answers["POST /api/agent/ask"] = [
      { status: 200, body: { reply: "No model is connected to this village, so this answer comes straight from its record.", consulted: { readers: ["canvas.answers"] }, path: "deterministic", fromRecord: "no-key" } },
    ];
    draw(
      <CompanionProvider>
        <AskButton block={null} label="Ask about the canvas" />
        <AskButton block="power" label="Ask" name="Ask about Power" />
      </CompanionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask about Power" }));
    const panel = await screen.findByRole("dialog", { name: "Ask about Power" });
    expect(panel).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), { target: { value: "who decides here?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText(/comes straight from its record/)).toBeTruthy());
    const asked = calls.find((c) => c.key === "POST /api/agent/ask")!;
    expect(asked.body.block).toBe("power");
    expect(asked.body.messages.at(-1)).toEqual({ role: "user", content: "who decides here?" });
    expect(screen.getByText("Read from the village's canvas.")).toBeTruthy();

    // The header's door opens on the whole canvas, a fresh conversation.
    fireEvent.click(screen.getByRole("button", { name: "Ask about the canvas" }));
    expect(await screen.findByRole("dialog", { name: "Ask about the canvas" })).toBeTruthy();
    expect(screen.queryByText("who decides here?")).toBeNull();
  });
});

describe("the line before a model", () => {
  it("shows the line, sends back exactly the line shown, then asks the same question again", async () => {
    answers["GET /api/agent/companion"] = [{ status: 200, body: { connected: true, disclosure: LINE, consent: null } }];
    answers["POST /api/agent/ask"] = [
      {
        status: 200,
        body: {
          reply: "Nothing you ask goes to a model until you agree to the line below, so this answer comes straight from the village's record.",
          consulted: { readers: ["canvas.answers", "canvas.library"] },
          path: "deterministic",
          fromRecord: "no-consent",
          consent: { required: true, ...LINE },
        },
      },
      { status: 200, body: { reply: "MODEL-REPLY", consulted: { readers: ["canvas.answers"] }, path: "prefetch" } },
    ];
    answers["POST /api/agent/companion/consent"] = [
      { status: 200, body: { consent: { provider: "Anthropic", operator: "Riverbend", source: "village", at: "2026-10-03T10:00:00.000Z" }, disclosure: LINE } },
    ];
    draw(
      <CompanionProvider>
        <AskButton block="power" label="Ask" name="Ask about Power" />
      </CompanionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask about Power" }));
    await screen.findByRole("dialog", { name: "Ask about Power" });
    fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), { target: { value: "how should we decide spending?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    const line = await screen.findByTestId("companion-line");
    expect(line.textContent).toContain(LINE.sentence);
    // Nothing but the record so far.
    expect(calls.filter((c) => c.key === "POST /api/agent/ask")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Agree and ask again" }));
    await waitFor(() => expect(screen.getByText("MODEL-REPLY")).toBeTruthy());
    expect(calls.map((c) => c.key)).toEqual([
      "GET /api/agent/companion",
      "POST /api/agent/ask",
      "POST /api/agent/companion/consent",
      "POST /api/agent/ask",
    ]);
    expect(calls[2].body).toEqual({ provider: "Anthropic", operator: "Riverbend", source: "village" });
    // The same question again, and only what was really said.
    const again = calls[3].body;
    expect(again.block).toBe("power");
    expect(again.messages.at(-1)).toEqual({ role: "user", content: "how should we decide spending?" });
    expect(again.messages.filter((m: any) => m.role === "user")).toHaveLength(1);
    expect(screen.queryByTestId("companion-line")).toBeNull();
    expect(screen.getByText(/You agreed on 2026-10-03 that the guide may send your questions to Anthropic\./)).toBeTruthy();
  });

  it("says a refusal in words", () => {
    expect(askFailure(401, null)).toBe("Sign in to ask.");
    expect(askFailure(429, { error: "Slow down a moment, then keep going." })).toBe("Slow down a moment, then keep going.");
    expect(askFailure(null, null)).toBe("That did not reach the server.");
  });
});

/*
 * AUDIT OF WAVE 4. "Not now" hid the line for as long as the panel stayed
 * open, while every later answer still said "agree to the line below"; and the
 * Journey page's guide shares this panel's corner and covered it.
 */
describe("after Not now, and beside the guide", () => {
  const NO_CONSENT = {
    status: 200,
    body: {
      reply: "Nothing you ask goes to a model until you agree to the line below, so this answer comes straight from the village's record.",
      consulted: { readers: ["canvas.answers"] },
      path: "deterministic",
      fromRecord: "no-consent",
      consent: { required: true, ...LINE },
    },
  };

  it("brings the line back with the next answer that asks for it", async () => {
    answers["GET /api/agent/companion"] = [{ status: 200, body: { connected: true, disclosure: LINE, consent: null } }];
    answers["POST /api/agent/ask"] = [NO_CONSENT];
    draw(
      <CompanionProvider>
        <AskButton block="power" label="Ask" name="Ask about Power" />
      </CompanionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask about Power" }));
    await screen.findByRole("dialog", { name: "Ask about Power" });
    const box = () => screen.getByRole("textbox", { name: "Your question" });
    fireEvent.change(box(), { target: { value: "who decides here?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByTestId("companion-line");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("companion-line")).toBeNull();

    fireEvent.change(box(), { target: { value: "and who keeps the money?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(calls.filter((c) => c.key === "POST /api/agent/ask")).toHaveLength(2));
    expect((await screen.findByTestId("companion-line")).textContent).toContain(LINE.sentence);
  });

  it("closes when another panel takes the corner, and tells the page when Ask is pressed", async () => {
    answers["GET /api/agent/companion"] = [{ status: 200, body: { connected: false, disclosure: null, consent: null } }];
    const onOpen = vi.fn();
    const ui = (cornerTaken: boolean) => (
      <Router>
        <CompanionProvider cornerTaken={cornerTaken} onOpen={onOpen}>
          <AskButton block="power" label="Ask" name="Ask about Power" />
        </CompanionProvider>
      </Router>
    );
    const { rerender } = render(ui(false));
    fireEvent.click(screen.getByRole("button", { name: "Ask about Power" }));
    await screen.findByRole("dialog", { name: "Ask about Power" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    rerender(ui(true));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ask about Power" })).toBeNull());
  });
});
