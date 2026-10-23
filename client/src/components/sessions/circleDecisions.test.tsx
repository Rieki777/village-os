// @vitest-environment jsdom
/**
 * "Decisions" on /sessions: a circle's decisions and their review dates.
 *
 * What each case holds: nobody who keeps no circle sees the section; the log
 * of the viewer's own circle loads first, each decision saying where it was
 * decided and its review; a quick choice fills the date and Save sends it;
 * the review can be taken off; a review that has come and one that is on the
 * agenda items say so; and a refusal is said in the server's words.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DECISION_COPY, addMonthsTo, dateWords, type CircleDecision, type CircleDecisionLog } from "@shared/sessionDecisions";

const state = vi.hoisted(() => ({ fetch: null as null | ((path: string, init?: RequestInit) => Promise<Response>) }));
vi.mock("@/lib/gameApi", () => ({ gameFetch: (path: string, init?: RequestInit) => state.fetch!(path, init) }));

import CircleDecisions from "./CircleDecisions";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Call = { path: string; method: string; body: unknown };
let calls: Call[];
let answers: Record<string, () => Response>;

const TODAY = "2026-10-22";
const decision = (over: Partial<CircleDecision> = {}): CircleDecision => ({
  entryId: 11,
  text: "We fill the tanks on Mondays.",
  decidedOn: "2026-10-01",
  session: { id: 4, title: "Garden, week 1" },
  review: null,
  ...over,
});
const log = (decisions: CircleDecision[]): CircleDecisionLog => ({ circleId: "garden", decisions, canSetReview: true, today: TODAY });
const circles = [
  { id: "garden", name: "Garden" },
  { id: "kitchen", name: "Kitchen" },
];

beforeEach(() => {
  calls = [];
  answers = { "GET /api/sessions/circles/garden/decisions": () => json(log([decision()])) };
  state.fetch = async (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${method} ${path}`];
    return answer ? answer() : json({ error: "no answer" }, 500);
  };
});

describe("decisions", () => {
  it("is not there for somebody who keeps no circle", () => {
    const { container } = render(<CircleDecisions circles={circles} keepCircleIds={[]} myCircleIds={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(calls).toEqual([]);
  });

  it("loads the viewer's own circle first, saying where each was decided and its review", async () => {
    render(<CircleDecisions circles={circles} keepCircleIds={["kitchen", "garden"]} myCircleIds={["garden"]} />);
    expect(await screen.findByText("We fill the tanks on Mondays.")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ path: "/api/sessions/circles/garden/decisions", method: "GET" });
    expect(screen.getByText(DECISION_COPY.decidedIn("Garden, week 1", dateWords("2026-10-01")))).toBeInTheDocument();
    expect(screen.getByText(DECISION_COPY.noReview)).toBeInTheDocument();
  });

  it("fills the date from a quick choice, sends it, and reads out what landed", async () => {
    const on = addMonthsTo(TODAY, 3);
    answers["PUT /api/sessions/circles/garden/decisions/11/review"] = () => json({ decision: decision({ review: { on, due: false, brought: false } }) });
    render(<CircleDecisions circles={circles} keepCircleIds={["garden"]} myCircleIds={["garden"]} />);
    fireEvent.click(await screen.findByRole("button", { name: DECISION_COPY.setReview }));
    fireEvent.click(screen.getByRole("button", { name: DECISION_COPY.inMonths(3) }));
    expect((screen.getByLabelText(DECISION_COPY.dateLabel) as HTMLInputElement).value).toBe(on);
    fireEvent.click(screen.getByRole("button", { name: DECISION_COPY.save }));
    await waitFor(() => expect(calls.at(-1)).toEqual({ path: "/api/sessions/circles/garden/decisions/11/review", method: "PUT", body: { reviewOn: on } }));
    expect(await screen.findByText(DECISION_COPY.saved(dateWords(on)))).toBeInTheDocument();
    expect(screen.getByText(DECISION_COPY.reviewOn(dateWords(on)))).toBeInTheDocument();
  });

  it("takes a review date off", async () => {
    answers["GET /api/sessions/circles/garden/decisions"] = () => json(log([decision({ review: { on: "2027-01-22", due: false, brought: false } })]));
    answers["PUT /api/sessions/circles/garden/decisions/11/review"] = () => json({ decision: decision() });
    render(<CircleDecisions circles={circles} keepCircleIds={["garden"]} myCircleIds={["garden"]} />);
    fireEvent.click(await screen.findByRole("button", { name: DECISION_COPY.changeReview }));
    fireEvent.click(screen.getByRole("button", { name: DECISION_COPY.clear }));
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ reviewOn: null }));
    expect(await screen.findByText(DECISION_COPY.cleared)).toBeInTheDocument();
  });

  it("says when a review has come, and when it is on the agenda items", async () => {
    answers["GET /api/sessions/circles/garden/decisions"] = () =>
      json(log([decision({ review: { on: TODAY, due: true, brought: false } }), decision({ entryId: 12, text: "Compost goes left.", session: null, review: { on: "2026-10-20", due: true, brought: true } })]));
    render(<CircleDecisions circles={circles} keepCircleIds={["garden"]} myCircleIds={["garden"]} />);
    expect(await screen.findByText(DECISION_COPY.reviewDue)).toBeInTheDocument();
    expect(screen.getByText(DECISION_COPY.reviewBrought)).toBeInTheDocument();
    expect(screen.getByText(DECISION_COPY.decidedOn(dateWords("2026-10-01")))).toBeInTheDocument();
  });

  it("says a refusal in the server's words", async () => {
    answers["PUT /api/sessions/circles/garden/decisions/11/review"] = () => json({ error: "Choose a review date in the next three years." }, 400);
    render(<CircleDecisions circles={circles} keepCircleIds={["garden"]} myCircleIds={["garden"]} />);
    fireEvent.click(await screen.findByRole("button", { name: DECISION_COPY.setReview }));
    fireEvent.click(screen.getByRole("button", { name: DECISION_COPY.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a review date in the next three years.");
  });
});
