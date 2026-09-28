// @vitest-environment jsdom
/**
 * THE SEASON ON THE CANVAS VIEW, RENDERED (2026-09-26).
 *
 * The rule this file exists for: a season ORDERS the canvas and never gates
 * it. With a week in focus, its blocks come first and are tagged, and every
 * other block is still on the page, in canvas order, with its card whole and
 * its form still offered to the pen. Then the week map itself: the current
 * week found by date and marked, each week's blocks linking down to their
 * cards, and for the pen, a file checked in the validator's own words before
 * anything is sent, and saved with a token when it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { CANVAS_BLOCK_IDS } from "@shared/governanceCanvas";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token" }));

import { CanvasBaseline } from "./CanvasBaseline";
import { CanvasSeason } from "./CanvasSeason";
import { CanvasView } from "./CanvasView";

const EMPTY_CANVAS = (mayRecord: boolean) => ({
  mayRecord,
  blocks: CANVAS_BLOCK_IDS.map((id) => ({ id, latest: null, history: [] })),
});

const SEASON = {
  id: "test-season",
  name: "A test season",
  timezone: "America/Los_Angeles",
  sessionTime: "11:00",
  weeks: [
    { number: 1, date: "2026-10-03", title: "Purpose first", blocks: ["purpose"], foundations: [], tools: [], showcaseAsk: "", actions: [] },
    {
      number: 2,
      date: "2026-10-10",
      title: "Who decides",
      blocks: ["power", "conflict"],
      foundations: ["internal-rules"],
      tools: ["The Decision Matrix"],
      showcaseAsk: "Who decides what?",
      actions: ["Hold one practice vote."],
    },
    { number: 3, date: "2026-10-17", title: "The money", blocks: ["resourcing"], foundations: [], tools: [], showcaseAsk: "", actions: [] },
  ],
  moons: [{ date: "2026-10-12", blocks: ["legal"], note: "A canvas moon." }],
};

const withSeason = (over: Record<string, unknown> = {}) => ({
  season: SEASON,
  savedBy: { id: "u1", name: "Wren" },
  savedAt: "2026-10-01T09:00:00.000Z",
  problem: null,
  mayEdit: false,
  ...over,
});
const NO_SEASON = (mayEdit: boolean) => ({ season: null, savedBy: null, savedAt: null, problem: null, mayEdit });

let calls: Array<{ url: string; method: string; init: any }>;
let routes: Record<string, Array<{ status: number; body: unknown }>>;

/** Answers by method and path, in order, and fails loudly on a call nobody expected. */
function answer(method: string, url: string, status: number, body: unknown) {
  (routes[`${method} ${url}`] ??= []).push({ status, body });
}

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      const method = String(init?.method ?? "GET");
      calls.push({ url: String(url), method, init });
      const queue = routes[`${method} ${url}`];
      const next = queue && queue.length > 1 ? queue.shift() : queue?.[0];
      if (!next) throw new Error(`the view called ${method} ${url}, which this test does not answer`);
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const cardOrder = () => screen.getAllByTestId(/^canvas-block-/).map((c) => c.getAttribute("data-testid")!.replace("canvas-block-", ""));

describe("a season orders the canvas and never gates it", () => {
  it("puts the focus first, tagged, and keeps every other block in canvas order", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(true));
    render(
      <Router>
        <CanvasBaseline focus={["power", "conflict"]} focusLabel="This week" />
      </Router>,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    expect(cardOrder()).toEqual(["power", "conflict", ...CANVAS_BLOCK_IDS.filter((id) => id !== "power" && id !== "conflict")]);
    expect(within(screen.getByTestId("canvas-block-power")).getByText("This week")).toBeTruthy();
    expect(within(screen.getByTestId("canvas-block-legal")).queryByText("This week")).toBeNull();
  });

  it("leaves every card whole and every form offered, in focus or not", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(true));
    render(
      <Router>
        <CanvasBaseline focus={["power"]} />
      </Router>,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    for (const id of CANVAS_BLOCK_IDS) {
      const card = within(screen.getByTestId(`canvas-block-${id}`));
      expect(card.getByRole("button", { name: /record a reading/i }), id).toBeTruthy();
      // The canvas-text lane labels our own prompts as ours ("Our questions
      // to talk through") under the canvas's quoted question; every card
      // keeps that disclosure whether it is in focus or not.
      expect(card.getByText("Our questions to talk through"), id).toBeTruthy();
      expect(screen.getByTestId(`canvas-block-${id}`).id, "each card is a link target").toBe(`canvas-block-${id}`);
    }
    // A block out of focus still takes a reading.
    const legal = within(screen.getByTestId("canvas-block-legal"));
    fireEvent.click(legal.getByRole("button", { name: /record a reading/i }));
    expect(legal.getByRole("button", { name: /save this reading/i })).toBeTruthy();
  });

  it("ignores a focus naming a block the canvas does not have, and still draws all twelve", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(false));
    render(
      <Router>
        <CanvasBaseline focus={["impact", "vibes" as never, "impact"]} />
      </Router>,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    expect(cardOrder()).toEqual(["impact", ...CANVAS_BLOCK_IDS.filter((id) => id !== "impact")]);
  });
});

describe("the week map on the Canvas view", () => {
  const draw = () =>
    render(
      <Router>
        <CanvasView />
      </Router>,
    );

  it("with no season, says so and leaves the cards in canvas order", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(false));
    answer("GET", "/api/canvas/season", 200, NO_SEASON(false));
    draw();
    await waitFor(() => expect(screen.getByText(/No season is loaded/)).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    expect(cardOrder()).toEqual([...CANVAS_BLOCK_IDS]);
    expect(screen.queryByText("This week")).toBeNull();
    expect(screen.queryByText(/Load a season file/)).toBeNull();
    // No season, no weeks: no card borrows another programme's calendar.
    for (const id of CANVAS_BLOCK_IDS) {
      expect(screen.getByTestId(`canvas-block-${id}`).textContent, id).not.toMatch(/Season Two|weeks? \d/);
    }
  });

  it("gives each card the loaded season's weeks for its block, so the card and the week map agree", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T18:00:00Z"));
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(false));
    answer("GET", "/api/canvas/season", 200, withSeason());
    draw();
    const text = (id: string) => screen.getByTestId(`canvas-block-${id}`).textContent ?? "";
    await waitFor(() => expect(text("power")).toContain("A test season: week 2"));
    expect(text("conflict")).toContain("A test season: week 2");
    expect(text("resourcing")).toContain("A test season: week 3");
    expect(text("purpose")).toContain("A test season: week 1");
    // Named by a moon and by no week: no week line, and nothing from the registry's fixed list.
    expect(text("legal")).not.toMatch(/A test season|weeks? \d/);
    for (const id of CANVAS_BLOCK_IDS) expect(text(id), id).not.toContain("Season Two");
  });

  it("finds this week by date, marks it, links its blocks to their cards, and orders the cards by it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T18:00:00Z")); // Tuesday 13 October, in week 2
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(false));
    answer("GET", "/api/canvas/season", 200, withSeason());
    draw();
    await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
    expect(screen.getByTestId("season-moment").textContent).toMatch(/^This week is week 2, Sat 10 Oct: Who decides\./);
    expect(screen.getByText(/Loaded by Wren on Thu 1 Oct 2026/)).toBeTruthy();

    const week2 = screen.getByTestId("season-week-2");
    expect(week2.getAttribute("aria-current")).toBe("date");
    expect(screen.getByTestId("season-week-1").getAttribute("aria-current")).toBeNull();
    expect(within(week2).getByText("This week")).toBeTruthy();
    expect(within(week2).getByText(/Who decides what\?/)).toBeTruthy();
    expect(within(week2).getByText("Hold one practice vote.")).toBeTruthy();
    for (const [name, id] of [["Power", "power"], ["Conflict", "conflict"]]) {
      const link = within(week2).getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(`#canvas-block-${id}`);
    }
    // The moon between two sessions sits in the map by its date, named for the
    // reading it sets and never as a claim about the sky ("New moon").
    expect(screen.getByText(/Canvas moon, Mon 12 Oct/)).toBeTruthy();
    expect(screen.queryByText(/New moon/)).toBeNull();
    // A week's foundations use the canvas's own names, the ones the cards below use.
    expect(within(week2).getByText("Foundations: Internal Rules & Regulations")).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    expect(cardOrder().slice(0, 2)).toEqual(["power", "conflict"]);
    expect(cardOrder()).toHaveLength(CANVAS_BLOCK_IDS.length);
    // Every link on the map lands on a card that is on the page.
    for (const a of screen.getAllByRole("link")) {
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("#")) expect(document.getElementById(href.slice(1)), href).toBeTruthy();
    }
  });

  it("before the season starts, puts the first week's blocks first and says when it starts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T18:00:00Z"));
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(false));
    answer("GET", "/api/canvas/season", 200, withSeason());
    draw();
    await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
    expect(screen.getByTestId("season-moment").textContent).toMatch(/starts on Sat 3 Oct 2026 with Purpose first/);
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    expect(cardOrder()[0]).toBe("purpose");
    expect(within(screen.getByTestId("canvas-block-purpose")).getByText("First up")).toBeTruthy();
  });

  it("after the season ends, goes back to canvas order", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-30T18:00:00Z"));
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(false));
    answer("GET", "/api/canvas/season", 200, withSeason());
    draw();
    await waitFor(() => expect(screen.getByTestId("season-moment").textContent).toMatch(/back in canvas order/));
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
    expect(cardOrder()).toEqual([...CANVAS_BLOCK_IDS]);
  });

  it("reports a stored season that no longer reads, and keeps canvas order", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(false));
    answer("GET", "/api/canvas/season", 200, { ...NO_SEASON(false), problem: "The stored season could not be read: nope." });
    draw();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be read: nope\. The blocks below are in canvas order/));
    // A season IS stored; it just does not read. "No season is loaded" would be false.
    expect(screen.queryByText(/No season is loaded/)).toBeNull();
  });

  it("claims nothing about the season while it is being read, or when the read fails", () => {
    const panel = (failed: string | null) => (
      <CanvasSeason payload={null} failed={failed} now={new Date()} onSave={async () => null} onRemove={async () => null} />
    );
    const { rerender } = render(panel(null));
    expect(screen.getByText("Reading the season.")).toBeTruthy();
    expect(screen.queryByText(/No season is loaded/)).toBeNull();

    rerender(panel("The season could not be read just now."));
    expect(screen.getByRole("alert").textContent).toBe("The season could not be read just now.");
    expect(screen.queryByText(/No season is loaded/)).toBeNull();
    expect(screen.queryByText("Reading the season.")).toBeNull();
  });

  it("names nobody once the member who loaded it is erased, and still says when", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T18:00:00Z"));
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(false));
    answer("GET", "/api/canvas/season", 200, withSeason({ savedBy: null }));
    draw();
    await waitFor(() => expect(screen.getByText("Loaded on Thu 1 Oct 2026.")).toBeTruthy());
    expect(screen.queryByText(/Loaded by/)).toBeNull();
  });

  it("lets a word too long for a phone's line break inside the view, instead of widening the page", async () => {
    // jsdom lays nothing out, so this holds only the rule in place; the width
    // itself is measured live on the built CSS at 375px (the lane's QA run).
    // `anywhere`, never `break-words`: break-word left the reading cards' grid
    // as wide as the longest word, and the page 310px too wide.
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(false));
    answer("GET", "/api/canvas/season", 200, NO_SEASON(false));
    draw();
    expect(screen.getByTestId("canvas-view").className.split(/\s+/)).toContain("wrap-anywhere");
    await waitFor(() => expect(screen.getByTestId("canvas-radar")).toBeTruthy());
  });
});

describe("the pen loads a season", () => {
  const draw = () =>
    render(
      <Router>
        <CanvasView />
      </Router>,
    );

  it("offers no form to a member without the pen", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(false));
    answer("GET", "/api/canvas/season", 200, withSeason());
    draw();
    await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
    expect(screen.queryByText(/season file/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /take the season off/i })).toBeNull();
  });

  it("refuses a pasted file in the validator's words, and sends nothing", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(true));
    answer("GET", "/api/canvas/season", 200, NO_SEASON(true));
    draw();
    const box = await screen.findByLabelText("Season file");
    fireEvent.change(box, { target: { value: "{ not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    expect(screen.getByRole("alert").textContent).toMatch(/That is not JSON the platform can read/);

    fireEvent.change(box, { target: { value: JSON.stringify({ ...SEASON, weeks: [{ ...SEASON.weeks[0], blocks: ["vibes"] }] }) } });
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    expect(screen.getByRole("alert").textContent).toMatch(/"vibes" is not one of the twelve canvas blocks/);
    expect(screen.queryByTestId("season-preview")).toBeNull();
    expect(calls.map((c) => c.method)).not.toContain("PUT");
  });

  it("previews a good file as it will be stored, then saves it with a token and reads the season again", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(true));
    answer("GET", "/api/canvas/season", 200, NO_SEASON(true));
    answer("GET", "/api/canvas/season", 200, withSeason({ mayEdit: true }));
    answer("PUT", "/api/canvas/season", 200, { season: SEASON, ignored: [], savedBy: { id: "u1", name: "Wren" }, savedAt: "2026-10-01T09:00:00.000Z" });
    draw();
    const box = await screen.findByLabelText("Season file");
    fireEvent.change(box, { target: { value: JSON.stringify({ ...SEASON, colour: "green" }) } });
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    const preview = within(screen.getByTestId("season-preview"));
    expect(preview.getByText(/from Sat 3 Oct 2026 to Sat 17 Oct 2026, in America\/Los_Angeles time/)).toBeTruthy();
    expect(preview.getByText(/left out: colour/)).toBeTruthy();
    expect(preview.getByText(/Week 2, Sat 10 Oct: Who decides/)).toBeTruthy();

    fireEvent.click(preview.getByRole("button", { name: "Save this season" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.init.headers.Authorization).toBe("Bearer a-token");
    const sent = JSON.parse(put.init.body);
    expect(sent).toEqual(SEASON);
    expect(sent.colour).toBeUndefined();
    await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
    expect(calls.filter((c) => c.url === "/api/canvas/season" && c.method === "GET")).toHaveLength(2);
  });

  it("reads a chosen .json file and checks it the same way", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(true));
    answer("GET", "/api/canvas/season", 200, NO_SEASON(true));
    draw();
    const input = (await screen.findByLabelText(/Choose a \.json file/)) as HTMLInputElement;
    const file = new File([JSON.stringify(SEASON)], "season.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("season-preview")).toBeTruthy());
    expect((screen.getByLabelText("Season file") as HTMLTextAreaElement).value).toContain('"test-season"');
  });

  it("shows the server's refusal when the gate says no after all", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(true));
    answer("GET", "/api/canvas/season", 200, NO_SEASON(true));
    answer("PUT", "/api/canvas/season", 403, { error: "Loading or removing the season is for whoever holds the village's story." });
    draw();
    fireEvent.change(await screen.findByLabelText("Season file"), { target: { value: JSON.stringify(SEASON) } });
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    fireEvent.click(screen.getByRole("button", { name: "Save this season" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/whoever holds the village's story/));
  });

  it("takes the season off after asking, and reads it again", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(true));
    answer("GET", "/api/canvas/season", 200, withSeason({ mayEdit: true }));
    answer("GET", "/api/canvas/season", 200, NO_SEASON(true));
    answer("DELETE", "/api/canvas/season", 200, { removed: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /take the season off/i }));
    expect(confirm).toHaveBeenCalledTimes(1);
    // The question says the season itself goes, and what it takes to have it back.
    expect(String(confirm.mock.calls[0]?.[0])).toMatch(/to load it again you will need its file/);
    await waitFor(() => expect(screen.getByText(/No season is loaded/)).toBeTruthy());
    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.init.headers.Authorization).toBe("Bearer a-token");
  });

  it("lets the pen take off a stored season that no longer reads, which clears the red line for everyone", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(true));
    answer("GET", "/api/canvas/season", 200, { ...NO_SEASON(true), problem: "The stored season could not be read: nope." });
    answer("GET", "/api/canvas/season", 200, NO_SEASON(true));
    answer("DELETE", "/api/canvas/season", 200, { removed: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    draw();
    // The pen is told what to do about it, in the alert itself.
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be read: nope\. .*Take the stored season off below/));
    // Nothing to download: a season that does not read is not a file anybody could load again.
    expect(screen.queryByRole("link", { name: /download this season file/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /take the season off/i }));
    expect(String(confirm.mock.calls[0]?.[0])).toMatch(/It no longer reads/);
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.getByText(/No season is loaded/)).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers the pen the stored season as a file, the same season the form takes back", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(true));
    answer("GET", "/api/canvas/season", 200, withSeason({ mayEdit: true }));
    draw();
    const link = await screen.findByRole("link", { name: /download this season file/i });
    expect(link.getAttribute("download")).toBe("test-season.json");
    const href = link.getAttribute("href") ?? "";
    const prefix = "data:application/json;charset=utf-8,";
    expect(href.startsWith(prefix)).toBe(true);
    const file = JSON.parse(decodeURIComponent(href.slice(prefix.length)));
    expect(file).toEqual(SEASON);
  });

  it("keeps the form closed until the pen opens it, and says where a season file comes from", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(true));
    answer("GET", "/api/canvas/season", 200, NO_SEASON(true));
    draw();
    const summary = await screen.findByText("Load a season file");
    expect((summary.closest("details") as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText(/comes from whoever runs your season/)).toBeTruthy();
    expect(screen.getByText(/docs\/seasons/)).toBeTruthy();
  });

  it("says the save worked, by the form, and closes it", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(true));
    answer("GET", "/api/canvas/season", 200, withSeason({ mayEdit: true }));
    answer("PUT", "/api/canvas/season", 200, { season: SEASON, ignored: [], savedBy: { id: "u1", name: "Wren" }, savedAt: "2026-10-01T09:00:00.000Z" });
    draw();
    const summary = await screen.findByText("Load a different season file");
    const details = summary.closest("details") as HTMLDetailsElement;
    details.open = true;
    // The element fires "toggle" as a task, as a browser does; let it land before going on.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.change(screen.getByLabelText("Season file"), { target: { value: JSON.stringify(SEASON) } });
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    fireEvent.click(screen.getByRole("button", { name: "Save this season" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved A test season. The week map above reads it now."));
    expect(details.open).toBe(false);
  });
});

describe("when the season cannot be read", () => {
  const draw = () =>
    render(
      <Router>
        <CanvasView />
      </Router>,
    );

  it("prints the server's members-only sentence to an account the village has not admitted, and offers no retry", async () => {
    const sentence = "The canvas and its season are for the village's members. They open to you once the village admits you.";
    answer("GET", "/api/canvas", 403, { error: sentence });
    answer("GET", "/api/canvas/season", 403, { error: sentence });
    draw();
    await waitFor(() => expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([sentence, sentence]));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText(/No season is loaded/)).toBeNull();
  });

  it("offers Try again after any other failure, and reads the season again", async () => {
    answer("GET", "/api/canvas", 200, EMPTY_CANVAS(false));
    answer("GET", "/api/canvas/season", 500, {});
    answer("GET", "/api/canvas/season", 200, NO_SEASON(false));
    draw();
    const again = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText("The season could not be read just now.")).toBeTruthy();
    fireEvent.click(again);
    await waitFor(() => expect(screen.getByText(/No season is loaded/)).toBeTruthy());
    expect(calls.filter((c) => c.url === "/api/canvas/season")).toHaveLength(2);
    expect(screen.queryByText("The season could not be read just now.")).toBeNull();
  });
});
