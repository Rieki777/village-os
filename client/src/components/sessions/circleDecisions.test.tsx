// @vitest-environment jsdom
/**
 * "Decisions" on /sessions: a circle's decisions and their review dates.
 *
 * What each case holds: nobody who keeps no circle sees the section; the log
 * of the viewer's own circle loads first, each decision saying where it was
 * decided and its review; a quick choice fills the date and Save sends it;
 * the review can be taken off; a review that has come and one that is on the
 * agenda items say so; a refusal is said in the server's words; the form
 * takes the focus and starts a review that has come six months on; a log that
 * did not load can be tried again; and the chosen circle follows the circles
 * the viewer may keep.
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
    expect(screen.getByText(DECISION_COPY.reviewBrought(dateWords("2026-10-20")))).toBeInTheDocument();
    expect(screen.getByText(DECISION_COPY.decidedOn(dateWords("2026-10-01")))).toBeInTheDocument();
  });

  it("takes the focus into the form, keeps a date still to come, and starts a review that has come six months on", async () => {
    answers["GET /api/sessions/circles/garden/decisions"] = () =>
      json(log([decision({ review: { on: TODAY, due: true, brought: true } }), decision({ entryId: 12, text: "Compost goes left.", review: { on: "2027-02-01", due: false, brought: false } })]));
    render(<CircleDecisions circles={circles} keepCircleIds={["garden"]} myCircleIds={["garden"]} />);
    const [cameAlready, stillToCome] = await screen.findAllByRole("button", { name: DECISION_COPY.changeReview });
    fireEvent.click(cameAlready);
    expect(screen.getByRole("group", { name: DECISION_COPY.changeReview })).toHaveFocus();
    expect((screen.getByLabelText(DECISION_COPY.dateLabel) as HTMLInputElement).value).toBe(addMonthsTo(TODAY, 6));
    fireEvent.click(screen.getByRole("button", { name: DECISION_COPY.cancel }));
    fireEvent.click(stillToCome);
    expect((screen.getByLabelText(DECISION_COPY.dateLabel) as HTMLInputElement).value).toBe("2027-02-01");
  });

  it("offers to try again when the log did not load", async () => {
    let first = true;
    answers["GET /api/sessions/circles/garden/decisions"] = () => {
      if (!first) return json(log([decision()]));
      first = false;
      return json({ error: "x" }, 503);
    };
    render(<CircleDecisions circles={circles} keepCircleIds={["garden"]} myCircleIds={["garden"]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(DECISION_COPY.failed);
    fireEvent.click(screen.getByRole("button", { name: DECISION_COPY.retry }));
    expect(await screen.findByText("We fill the tanks on Mondays.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("follows the circles the viewer may keep as the page refreshes them", async () => {
    answers["GET /api/sessions/circles/kitchen/decisions"] = () => json({ ...log([decision({ entryId: 20, text: "Knives go back on the rail." })]), circleId: "kitchen" });
    const { rerender } = render(<CircleDecisions circles={circles} keepCircleIds={[]} myCircleIds={[]} />);
    expect(calls).toEqual([]);
    rerender(<CircleDecisions circles={circles} keepCircleIds={["garden"]} myCircleIds={["garden"]} />);
    expect(await screen.findByText("We fill the tanks on Mondays.")).toBeInTheDocument();
    // The garden is no longer theirs to keep; the kitchen now is.
    rerender(<CircleDecisions circles={circles} keepCircleIds={["kitchen"]} myCircleIds={["kitchen"]} />);
    expect(await screen.findByText("Knives go back on the rail.")).toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ path: "/api/sessions/circles/kitchen/decisions", method: "GET" });
  });

  it("says a refusal in the server's words", async () => {
    answers["PUT /api/sessions/circles/garden/decisions/11/review"] = () => json({ error: "Choose a review date in the next three years." }, 400);
    render(<CircleDecisions circles={circles} keepCircleIds={["garden"]} myCircleIds={["garden"]} />);
    fireEvent.click(await screen.findByRole("button", { name: DECISION_COPY.setReview }));
    fireEvent.click(screen.getByRole("button", { name: DECISION_COPY.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a review date in the next three years.");
  });
});
