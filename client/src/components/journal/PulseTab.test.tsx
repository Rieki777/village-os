// @vitest-environment jsdom
/**
 * The village pulse shows an average where the server shows one, and the
 * sentence where the server held a cell back.
 *
 * The floor ships at 1 (a pulse runs at any team size), so the usual state is
 * every answered metric showing its mean and count. A village can raise the
 * floor, and then a held-back cell must read as the sentence naming the
 * floor, never as a zero, a blank, or a stale number passed off as this week.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { PulseAggregate } from "@shared/journal";
import { TOKEN_KEY } from "@/lib/gameApi";
import PulseTab, { suppressedSentence } from "./PulseTab";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let aggregate: PulseAggregate;

beforeEach(() => {
  const map = new Map<string, string>([[TOKEN_KEY, "tok-wren"]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/journal/pulse") return json([{ weekId: "2026-W40", scores: { confidence: 4, energy: -1 } }]);
      if (url === "/api/journal/pulse/aggregate") return json(aggregate);
      return json({ error: "not-here" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The village card for one metric, found by its name. */
async function villageCard(name: string) {
  const section = await screen.findByRole("region", { name: "The village" });
  const title = await within(section).findByText(name);
  return title.closest("li") as HTMLElement;
}

describe("the village pulse", () => {
  it("shows the sentence, with the floor, for a cell the server held back", async () => {
    aggregate = {
      floor: 4,
      weeks: [
        {
          weekId: "2026-W40",
          cells: [
            { metric: "confidence", n: null, mean: null, suppressed: true },
            { metric: "coherence", n: 5, mean: 3.4, suppressed: false },
          ],
        },
      ],
      signals: [{ key: "space", text: "Some people may want more room in calls." }],
    };
    render(<PulseTab village="Willowbrook" />);

    const confidence = await villageCard("Confidence");
    expect(confidence).toHaveTextContent(suppressedSentence(4));
    expect(confidence).toHaveTextContent("(needs 4)");
    expect(confidence).not.toHaveTextContent(/average/);

    // The control: the neighbouring cell was not held back and shows its number.
    const coherence = await villageCard("Coherence");
    expect(coherence).toHaveTextContent("3.4");
    expect(coherence).toHaveTextContent("average from 5 people, week 2026-W40");
    expect(coherence).not.toHaveTextContent("Not enough answers yet");

    expect(screen.getByText("Some people may want more room in calls.")).toBeInTheDocument();
  });

  it("shows every answered metric at the shipped floor of 1, a single answer included", async () => {
    aggregate = {
      floor: 1,
      weeks: [
        {
          weekId: "2026-W40",
          cells: [
            { metric: "confidence", n: 1, mean: 4, suppressed: false },
            { metric: "energy", n: 2, mean: -0.5, suppressed: false },
          ],
        },
      ],
      signals: [],
    };
    render(<PulseTab village="Willowbrook" />);

    expect(await villageCard("Confidence")).toHaveTextContent("average from 1 person");
    // The centred scale reads with its sign.
    expect(await villageCard("Energy")).toHaveTextContent("-0.5");
    expect(screen.queryByText(/Not enough answers yet/)).toBeNull();
  });

  it("keeps an earlier week's number apart from this week's held-back cell", async () => {
    aggregate = {
      floor: 3,
      weeks: [
        { weekId: "2026-W39", cells: [{ metric: "load", n: 4, mean: 2.5, suppressed: false }] },
        { weekId: "2026-W40", cells: [{ metric: "load", n: null, mean: null, suppressed: true }] },
      ],
      signals: [],
    };
    render(<PulseTab village="Willowbrook" />);

    const load = await villageCard("Load");
    expect(load).toHaveTextContent(suppressedSentence(3));
    expect(load).toHaveTextContent("Week 2026-W39: 2.5, from 4 people");
  });
});

it("shows the member's own numbers under Your weeks", async () => {
  aggregate = { floor: 1, weeks: [], signals: [] };
  render(<PulseTab village="Willowbrook" />);
  const mine = await screen.findByRole("region", { name: "Your weeks" });
  const prompt = await within(mine).findByText("How confident are you in Willowbrook right now?");
  expect(prompt.closest("li")).toHaveTextContent("Latest: 4");
  const energy = within(mine).getByText("Energy").closest("li");
  expect(energy).toHaveTextContent("Latest: -1");
});
