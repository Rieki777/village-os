// @vitest-environment jsdom
/**
 * "This season" on /sessions, and the regenerative lens in the room.
 *
 * What each case holds: nobody who keeps no circle sees the season; the
 * viewer's own circle loads first, saying its season in one sentence with the
 * numbers under it; a circle that has not met says so and shows no numbers;
 * a pulse that did not load can be tried again; and the lens opens and
 * closes its four questions, saying which it is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LENS_COPY, PULSE_COPY, type CirclePulse as Pulse } from "@shared/sessionPulse";

const state = vi.hoisted(() => ({ fetch: null as null | ((path: string, init?: RequestInit) => Promise<Response>) }));
vi.mock("@/lib/gameApi", () => ({ gameFetch: (path: string, init?: RequestInit) => state.fetch!(path, init) }));

import CirclePulse from "./CirclePulse";
import RegenLens from "./RegenLens";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let calls: string[];
let answers: Record<string, () => Response>;

const circles = [
  { id: "garden", name: "Garden circle" },
  { id: "kitchen", name: "Kitchen circle" },
];
const pulse = (over: Partial<Pulse> = {}): Pulse => ({
  circleId: "garden",
  season: "spring",
  since: "2026-09-03",
  sessions: 5,
  people: 7,
  decisions: 12,
  tensions: 4,
  actions: { open: 3, done: 9, letGo: 2 },
  arrival: 7,
  ...over,
});

beforeEach(() => {
  calls = [];
  answers = { "/api/sessions/circles/garden/pulse": () => json(pulse()) };
  state.fetch = async (path) => {
    calls.push(path);
    const answer = answers[path];
    return answer ? answer() : json({ error: "no answer" }, 500);
  };
});

describe("this season", () => {
  it("is not there for somebody who keeps no circle", () => {
    const { container } = render(<CirclePulse circles={circles} keepCircleIds={[]} myCircleIds={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(calls).toEqual([]);
  });

  it("loads the viewer's own circle first, in one sentence with the numbers under it", async () => {
    render(<CirclePulse circles={circles} keepCircleIds={["kitchen", "garden"]} myCircleIds={["garden"]} />);
    expect(await screen.findByText(PULSE_COPY.line("Garden circle", pulse()))).toBeInTheDocument();
    expect(calls[0]).toBe("/api/sessions/circles/garden/pulse");
    const cell = (label: string) => within(screen.getByText(label).parentElement as HTMLElement);
    expect(cell(PULSE_COPY.numbers.sessions).getByText("5")).toBeInTheDocument();
    expect(cell(PULSE_COPY.numbers.actionsDone).getByText("9")).toBeInTheDocument();
    expect(cell(PULSE_COPY.numbers.arrival).getByText(PULSE_COPY.arrivalOf(7))).toBeInTheDocument();
  });

  it("says a circle has not met this season, and shows no numbers", async () => {
    answers["/api/sessions/circles/garden/pulse"] = () => json(pulse({ sessions: 0, people: 0, decisions: 0, tensions: 0, actions: { open: 0, done: 0, letGo: 0 }, arrival: null }));
    render(<CirclePulse circles={circles} keepCircleIds={["garden"]} myCircleIds={["garden"]} />);
    expect(await screen.findByText("The Garden circle has not met this spring yet.")).toBeInTheDocument();
    expect(screen.queryByText(PULSE_COPY.numbers.sessions)).not.toBeInTheDocument();
  });

  it("offers to try again when the pulse did not load", async () => {
    let first = true;
    answers["/api/sessions/circles/garden/pulse"] = () => {
      if (!first) return json(pulse());
      first = false;
      return json({ error: "x" }, 503);
    };
    render(<CirclePulse circles={circles} keepCircleIds={["garden"]} myCircleIds={["garden"]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(PULSE_COPY.loadFailed);
    fireEvent.click(screen.getByRole("button", { name: PULSE_COPY.retry }));
    expect(await screen.findByText(PULSE_COPY.line("Garden circle", pulse()))).toBeInTheDocument();
  });
});

describe("the regenerative lens", () => {
  it("opens and closes its four questions, saying which it is", () => {
    render(<RegenLens entryId={5} />);
    const toggle = screen.getByRole("button", { name: LENS_COPY.show });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(LENS_COPY.questions[0])).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: LENS_COPY.hide })).toHaveAttribute("aria-expanded", "true");
    for (const q of LENS_COPY.questions) expect(screen.getByText(q)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: LENS_COPY.hide }));
    expect(screen.queryByText(LENS_COPY.questions[0])).not.toBeInTheDocument();
  });
});
