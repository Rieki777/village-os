// @vitest-environment jsdom
/**
 * "Asking for advice" on /sessions: the advice process.
 *
 * What each case holds: the two lists load, each saying when it is empty; the
 * ask form takes the focus, a quick choice sets the date, and the new request
 * joins the viewer's own with one polite line; somebody asked gives advice
 * and the card shows it; the asker records a decision, and withdraws only
 * after a confirm; a refusal is said in the server's words; a list that did
 * not load can be tried again; and a notice's link lands on its request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ADVICE_COPY, type AdvicePayload, type AdviceRequestCard } from "@shared/sessionAdvice";
import { addDaysTo } from "@shared/sessionDecisions";

const state = vi.hoisted(() => ({ fetch: null as null | ((path: string, init?: RequestInit) => Promise<Response>) }));
vi.mock("@/lib/gameApi", () => ({ gameFetch: (path: string, init?: RequestInit) => state.fetch!(path, init) }));

import AdviceProcess from "./AdviceProcess";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Call = { path: string; method: string; body: unknown };
let calls: Call[];
let answers: Record<string, () => Response>;

const TODAY = "2026-10-24";
const card = (over: Partial<AdviceRequestCard> = {}): AdviceRequestCard => ({
  id: 3,
  circleId: "garden",
  circleName: "Garden circle",
  askerName: "Ana Reyes",
  mine: false,
  intent: "We fill the tanks on Mondays.",
  context: "Sunday's rain fills them anyway.",
  decideBy: "2026-10-31",
  status: "open",
  decision: null,
  settledOn: null,
  askedCount: 2,
  advice: [],
  canAdvise: true,
  myAdvice: null,
  canDecide: false,
  ...over,
});
const payload = (over: Partial<AdvicePayload> = {}): AdvicePayload => ({
  askedOfMe: [card()],
  mine: [],
  circles: [
    { id: "garden", name: "Garden circle" },
    { id: "kitchen", name: "Kitchen circle" },
  ],
  today: TODAY,
  ...over,
});

beforeEach(() => {
  calls = [];
  answers = { "GET /api/sessions/advice/requests": () => json(payload()) };
  state.fetch = async (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${method} ${path}`];
    return answer ? answer() : json({ error: "no answer" }, 500);
  };
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("asking for advice", () => {
  it("loads what the viewer was asked about and what they asked, each saying when it is empty", async () => {
    render(<AdviceProcess />);
    expect(await screen.findByText("We fill the tanks on Mondays.")).toBeInTheDocument();
    expect(screen.getByText(ADVICE_COPY.fromWho("Ana Reyes", "Garden circle"))).toBeInTheDocument();
    expect(screen.getByText(ADVICE_COPY.decideByLine("2026-10-31"))).toBeInTheDocument();
    expect(screen.getByText(ADVICE_COPY.nothingMine)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADVICE_COPY.giveAdvice })).toBeDisabled();
  });

  it("asks a circle: the form takes the focus, a quick choice sets the date, and the request joins the viewer's own", async () => {
    const sent = card({ id: 9, mine: true, canAdvise: false, canDecide: true, askerName: "Bo Fern", intent: "Move the compost bays.", context: null, decideBy: addDaysTo(TODAY, 3) });
    answers["POST /api/sessions/advice/requests"] = () => json({ request: sent });
    render(<AdviceProcess />);
    fireEvent.click(await screen.findByRole("button", { name: ADVICE_COPY.askButton }));
    expect(screen.getByRole("group", { name: ADVICE_COPY.askTitle })).toHaveFocus();
    fireEvent.change(screen.getByLabelText(ADVICE_COPY.circleLabel), { target: { value: "kitchen" } });
    fireEvent.change(screen.getByLabelText(ADVICE_COPY.intentLabel), { target: { value: "Move the compost bays." } });
    fireEvent.click(screen.getByRole("button", { name: ADVICE_COPY.inDays(3) }));
    expect((screen.getByLabelText(ADVICE_COPY.decideByLabel) as HTMLInputElement).value).toBe(addDaysTo(TODAY, 3));
    fireEvent.click(screen.getByRole("button", { name: ADVICE_COPY.send }));
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        path: "/api/sessions/advice/requests",
        method: "POST",
        body: { circleId: "kitchen", intent: "Move the compost bays.", context: "", decideBy: addDaysTo(TODAY, 3) },
      }),
    );
    expect(await screen.findByText(ADVICE_COPY.asked("Garden circle", 2))).toBeInTheDocument();
    expect(screen.getByText("Move the compost bays.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: ADVICE_COPY.askButton })).toHaveFocus());
  });

  it("takes advice from somebody asked, and shows it on the card", async () => {
    answers["PUT /api/sessions/advice/requests/3/advice"] = () =>
      json({ request: card({ myAdvice: "Tuesdays.", advice: [{ by: "Bo Fern", words: "Tuesdays.", at: "2026-10-24T09:00:00.000Z", on: "2026-10-24", mine: true }] }) });
    render(<AdviceProcess />);
    fireEvent.change(await screen.findByLabelText(ADVICE_COPY.yourAdvice), { target: { value: "Tuesdays." } });
    fireEvent.click(screen.getByRole("button", { name: ADVICE_COPY.giveAdvice }));
    await waitFor(() => expect(calls.at(-1)).toEqual({ path: "/api/sessions/advice/requests/3/advice", method: "PUT", body: { advice: "Tuesdays." } }));
    expect(await screen.findByText(ADVICE_COPY.adviceBy("Bo Fern"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADVICE_COPY.changeAdvice })).toBeInTheDocument();
    expect(await screen.findByText(ADVICE_COPY.savedAdvice("Ana Reyes"))).toBeInTheDocument();
  });

  it("lets the asker record a decision, and withdraw only after a confirm", async () => {
    const mine = card({ id: 4, mine: true, canAdvise: false, canDecide: true, askerName: "Bo Fern" });
    answers["GET /api/sessions/advice/requests"] = () => json(payload({ askedOfMe: [], mine: [mine] }));
    answers["POST /api/sessions/advice/requests/4/decide"] = () => json({ request: { ...mine, status: "decided", canDecide: false, decision: "Tuesdays it is.", settledOn: TODAY } });
    answers["POST /api/sessions/advice/requests/4/withdraw"] = () => json({ request: { ...mine, status: "withdrawn", canDecide: false, settledOn: TODAY } });
    render(<AdviceProcess />);
    fireEvent.click(await screen.findByRole("button", { name: ADVICE_COPY.withdraw }));
    const confirm = screen.getByRole("group", { name: ADVICE_COPY.withdraw });
    expect(within(confirm).getByText(ADVICE_COPY.withdrawConfirm)).toBeInTheDocument();
    await waitFor(() => expect(within(confirm).getByRole("button", { name: ADVICE_COPY.keep })).toHaveFocus());
    fireEvent.click(within(confirm).getByRole("button", { name: ADVICE_COPY.keep }));
    await waitFor(() => expect(screen.getByRole("button", { name: ADVICE_COPY.withdraw })).toHaveFocus());
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    fireEvent.change(screen.getByLabelText(ADVICE_COPY.decisionLabel), { target: { value: "Tuesdays it is." } });
    fireEvent.click(screen.getByRole("button", { name: ADVICE_COPY.recordDecision }));
    await waitFor(() => expect(calls.at(-1)).toEqual({ path: "/api/sessions/advice/requests/4/decide", method: "POST", body: { decision: "Tuesdays it is." } }));
    expect(screen.getByText(ADVICE_COPY.youAsked("Garden circle"))).toBeInTheDocument();
    expect(await screen.findByText(ADVICE_COPY.decided(TODAY))).toBeInTheDocument();
    expect(screen.getByText("Tuesdays it is.")).toBeInTheDocument();
    // The forms are gone, so the focus goes to the card, and what landed is read out.
    await waitFor(() => expect(document.activeElement?.id).toBe("advice-4"));
    expect(await screen.findByText(ADVICE_COPY.savedDecision)).toBeInTheDocument();
  });

  it("says a refusal in the server's words", async () => {
    answers["PUT /api/sessions/advice/requests/3/advice"] = () => json({ error: "That request is decided or withdrawn already." }, 409);
    render(<AdviceProcess />);
    fireEvent.change(await screen.findByLabelText(ADVICE_COPY.yourAdvice), { target: { value: "Late." } });
    fireEvent.click(screen.getByRole("button", { name: ADVICE_COPY.giveAdvice }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That request is decided or withdrawn already.");
  });

  it("offers to try again when the lists did not load", async () => {
    let first = true;
    answers["GET /api/sessions/advice/requests"] = () => {
      if (!first) return json(payload());
      first = false;
      return json({ error: "x" }, 503);
    };
    render(<AdviceProcess />);
    expect(await screen.findByRole("alert")).toHaveTextContent(ADVICE_COPY.failed);
    fireEvent.click(screen.getByRole("button", { name: ADVICE_COPY.retry }));
    expect(await screen.findByText("We fill the tanks on Mondays.")).toBeInTheDocument();
  });

  it("lands a notice's link on its request once, and never pulls the focus back after a save", async () => {
    answers["PUT /api/sessions/advice/requests/3/advice"] = () => json({ request: card({ myAdvice: "Tuesdays." }) });
    window.history.replaceState(null, "", "/sessions#advice-3");
    render(<AdviceProcess />);
    await screen.findByText("We fill the tanks on Mondays.");
    await waitFor(() => expect(document.activeElement?.id).toBe("advice-3"));
    const box = screen.getByLabelText(ADVICE_COPY.yourAdvice);
    box.focus();
    fireEvent.change(box, { target: { value: "Tuesdays." } });
    const save = screen.getByRole("button", { name: ADVICE_COPY.giveAdvice });
    save.focus();
    fireEvent.click(save);
    expect(await screen.findByText(ADVICE_COPY.savedAdvice("Ana Reyes"))).toBeInTheDocument();
    expect(document.activeElement?.id).not.toBe("advice-3");
  });

  it("reads the lists again when a notice links to a request they do not have yet", async () => {
    let reads = 0;
    answers["GET /api/sessions/advice/requests"] = () => {
      reads += 1;
      return json(payload(reads === 1 ? {} : { askedOfMe: [card(), card({ id: 9, intent: "Paint the shed blue." })] }));
    };
    window.history.replaceState(null, "", "/sessions#advice-9");
    render(<AdviceProcess />);
    expect(await screen.findByText("Paint the shed blue.")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.id).toBe("advice-9"));
    expect(reads).toBe(2);
  });
});
