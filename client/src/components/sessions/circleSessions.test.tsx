// @vitest-environment jsdom
/**
 * A circle's sessions, on its card (`/circles/:id`).
 *
 * What each case holds: when the card says Live Sessions is not open to the
 * reader (a signed-out visitor, a village with it off) nothing is asked and
 * nothing drawn; when the summary is refused after all, or for a member who
 * does not keep the circle (a former role holder among them), the card stands
 * as it is, with no heading, no loading line and no error; a summary that fails says nothing
 * either; somebody who keeps the circle reads its decision log and this
 * season's pulse, for this circle only, with no circle chooser; a circle that
 * has never met says so in both; and a decision from a session the reader
 * was not in names no session and no person.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DECISION_COPY, type CircleDecision, type CircleDecisionLog } from "@shared/sessionDecisions";
import { PULSE_COPY, type CirclePulse as Pulse } from "@shared/sessionPulse";
import type { CircleSessionsSummary } from "@shared/sessionRhythm";
import { CIRCLE_CARD_WORDS as W } from "@shared/circleCardWords";

const state = vi.hoisted(() => ({ fetch: null as null | ((path: string, init?: RequestInit) => Promise<Response>) }));
vi.mock("@/lib/gameApi", () => ({ gameFetch: (path: string, init?: RequestInit) => state.fetch!(path, init) }));

import CircleSessions from "./CircleSessions";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let calls: string[];
let answers: Record<string, () => Response>;

const SUMMARY = "/api/sessions/circles/garden/summary";
const DECISIONS = "/api/sessions/circles/garden/decisions";
const PULSE = "/api/sessions/circles/garden/pulse";

const summary = (over: Partial<CircleSessionsSummary> = {}): CircleSessionsSummary => ({
  circleId: "garden",
  rhythm: null,
  next: null,
  lastMetAt: null,
  waiting: 0,
  openRoom: null,
  canKeep: true,
  ...over,
});
const decision = (over: Partial<CircleDecision> = {}): CircleDecision => ({
  entryId: 1,
  text: "Water the beds at dawn in the dry months.",
  decidedOn: "2026-10-12",
  session: { id: 7, title: "Garden check-in" },
  review: null,
  ...over,
});
const log = (decisions: CircleDecision[]): CircleDecisionLog => ({ circleId: "garden", decisions, canSetReview: true, today: "2026-10-31" });
const pulse = (over: Partial<Pulse> = {}): Pulse => ({
  circleId: "garden",
  season: "autumn",
  since: "2026-09-22",
  sessions: 3,
  people: 6,
  decisions: 2,
  tensions: 1,
  actions: { open: 1, done: 4, letGo: 0 },
  arrival: 8,
  ...over,
});

beforeEach(() => {
  calls = [];
  answers = {
    [SUMMARY]: () => json(summary()),
    [DECISIONS]: () => json(log([decision()])),
    [PULSE]: () => json(pulse()),
  };
  state.fetch = async (path) => {
    calls.push(path);
    const answer = answers[path];
    return answer ? answer() : json({ error: "no answer" }, 500);
  };
});

const draw = (sessionsOn = true) => render(<CircleSessions circleId="garden" circleName="Garden Circle" sessionsOn={sessionsOn} />);

/** The summary has answered and every request it led to has been sent. */
async function settled() {
  await waitFor(() => expect(calls).toContain(SUMMARY));
  await new Promise((r) => setTimeout(r, 20));
}

describe("a circle's sessions on its card", () => {
  it("asks nothing and draws nothing when Live Sessions is not open to the reader: a visitor, or a village with it off", async () => {
    const { container } = draw(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(calls).toEqual([]);
  });

  it("leaves the card as it is when the summary is refused after all", async () => {
    answers[SUMMARY] = () => json({ error: "This part of the village is not open." }, 404);
    const { container } = draw();
    await settled();
    expect(container).toBeEmptyDOMElement();
    expect(calls).toEqual([SUMMARY]);
  });

  it("shows a member who does not keep the circle nothing, a former role holder among them", async () => {
    answers[SUMMARY] = () => json(summary({ canKeep: false }));
    const { container } = draw();
    await settled();
    expect(container).toBeEmptyDOMElement();
    expect(calls).toEqual([SUMMARY]);
  });

  it("says nothing when the summary fails, and the card stands", async () => {
    answers[SUMMARY] = () => json({ error: "boom" }, 500);
    const { container } = draw();
    await settled();
    expect(container).toBeEmptyDOMElement();
    expect(calls).toEqual([SUMMARY]);
  });

  it("says nothing when the summary cannot be reached at all", async () => {
    state.fetch = async (path) => {
      calls.push(path);
      throw new Error("offline");
    };
    const { container } = draw();
    await settled();
    expect(container).toBeEmptyDOMElement();
  });

  it("gives a keeper this circle's decision log and season pulse, with no chooser", async () => {
    draw();
    expect(await screen.findByRole("heading", { name: DECISION_COPY.sectionTitle })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: PULSE_COPY.sectionTitle })).toBeInTheDocument();
    expect(await screen.findByText("Water the beds at dawn in the dry months.")).toBeInTheDocument();
    expect(await screen.findByText(PULSE_COPY.line("Garden Circle", pulse()))).toBeInTheDocument();
    // One circle, so the ledes speak of this one and there is nothing to choose.
    expect(screen.getByText(W.decisionsLede)).toBeInTheDocument();
    expect(screen.getByText(W.pulseLede)).toBeInTheDocument();
    expect(screen.queryByText(DECISION_COPY.lede)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(new Set(calls)).toEqual(new Set([SUMMARY, DECISIONS, PULSE]));
  });

  it("says a circle that has never met has no decisions and has not met this season", async () => {
    answers[DECISIONS] = () => json(log([]));
    answers[PULSE] = () => json(pulse({ sessions: 0, people: 0, decisions: 0, tensions: 0, actions: { open: 0, done: 0, letGo: 0 }, arrival: null }));
    draw();
    expect(await screen.findByText(DECISION_COPY.empty("Garden Circle"))).toBeInTheDocument();
    expect(await screen.findByText("The Garden Circle has not met this autumn yet.")).toBeInTheDocument();
    expect(screen.queryByText(PULSE_COPY.numbers.sessions)).not.toBeInTheDocument();
  });

  it("names no session and no person for a decision from a session the reader was not in", async () => {
    answers[DECISIONS] = () => json(log([decision({ session: null })]));
    draw();
    expect(await screen.findByText(DECISION_COPY.decidedOn("12 October 2026"))).toBeInTheDocument();
    expect(screen.queryByText(/Garden check-in/)).not.toBeInTheDocument();
  });
});
