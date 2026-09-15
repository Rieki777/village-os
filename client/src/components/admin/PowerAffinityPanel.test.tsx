// @vitest-environment jsdom
/**
 * The power map editor: which rows lead and that they hold still, what one tick
 * sends, what a refusal puts back, how a power is handed back to the platform,
 * and where the keyboard goes when it is.
 *
 * Two of these hold the server's answer open on purpose. Asserting that a box is
 * still ticked after a refused save passes against a panel that never moved the
 * box, and asserting that rows kept their order after a save passes against a
 * panel that only reorders while the save is out. Each proves the in-between
 * state first.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PowerAffinityPanel from "./PowerAffinityPanel";

const classes = [
  { key: "researching", name: "The Architect" },
  { key: "storytelling", name: "The Storyteller" },
];
const LIBRARY = "Keep the shared library and its loans";
const STORY = "Say what the village is, in public, in its own words";
const VETO = "Stop a carried decision inside its window, and say why";
const DECLARE = "Declare how the village holds power";
const PROPOSE = "Propose a change to the game's rules";

// In the server's order. Two rows carry nothing, so they sit below the rest.
const powers = [
  { key: "steward.veto", label: VETO, classes: [], suggested: [], decided: false, live: true, entrusted: true },
  { key: "library.keep", label: LIBRARY, classes: ["researching"], suggested: ["researching"], decided: false, live: true, entrusted: true },
  { key: "story.tell", label: STORY, classes: ["storytelling"], suggested: ["storytelling"], decided: true, live: false, entrusted: true },
  { key: "org.declare", label: DECLARE, classes: [], suggested: [], decided: false, live: true, entrusted: true },
  { key: "mechanics.propose", label: PROPOSE, classes: ["researching"], suggested: [], decided: true, live: true, entrusted: false },
];

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

type Answer = (url: string, init?: RequestInit) => Promise<any>;

function routing(answer: Answer) {
  const spy = vi.fn((url: string, init?: RequestInit) => answer(String(url), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

const putsOf = (spy: ReturnType<typeof routing>) =>
  spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT");

/** Each row's power label, top to bottom. */
const rowLabels = () =>
  screen.getAllByRole("rowheader").map((th) => th.querySelector("span")?.textContent ?? "");

const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PowerAffinityPanel", () => {
  it("leads with the powers that carry a class, and says whose choice each one is", async () => {
    routing(async () => ok({ classes, powers }));
    render(<PowerAffinityPanel password="pw" castKey="" />);

    await screen.findByRole("table");
    expect(rowLabels()).toEqual([LIBRARY, STORY, PROPOSE, VETO, DECLARE]);
    const heads = screen.getAllByRole("rowheader").map((th) => th.textContent ?? "");
    expect(heads[0]).toContain("The platform suggests The Architect.");
    expect(heads[1]).toContain("Your village's choice.");
    expect(heads[1]).toContain("Its module is off here");
    // Decided, and the ladder opens it again, so the ticks reach nobody.
    expect(heads[2]).toContain("This village's ladder opens it, so no member is recommended it.");
    expect(heads[3]).toContain("No suggestion from the platform.");
    expect(heads[0]).not.toContain("ladder opens it");
  });

  it("keeps every row where it was while a first tick makes a power the village's own", async () => {
    let answer: (value: unknown) => void = () => {};
    routing(async (_url, init) => {
      if (init?.method !== "PUT") return ok({ classes, powers });
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    render(<PowerAffinityPanel password="pw" castKey="" />);
    await screen.findByRole("table");
    const before = rowLabels();

    // The veto row carries nothing, so it sits in the lower group. Its first
    // tick marks it decided while the save is still out.
    fireEvent.click(box(`${VETO}: suits The Storyteller`));
    await waitFor(() => expect(box(`${VETO}: suits The Storyteller`).checked).toBe(true));
    expect(rowLabels(), "nothing moves while the save is out").toEqual(before);

    answer(
      ok({
        success: true,
        classes,
        powers: powers.map((p) => (p.key === "steward.veto" ? { ...p, classes: ["storytelling"], decided: true } : p)),
      }),
    );
    await waitFor(() => expect(screen.getByText(`${VETO} now suits The Storyteller.`)).toBeTruthy());
    expect(rowLabels(), "and nothing moves when it lands").toEqual(before);
  });

  it("saves one power when a box is ticked, placing the class in the columns' order", async () => {
    const spy = routing(async (_url, init) =>
      init?.method === "PUT"
        ? ok({
            success: true,
            classes,
            powers: powers.map((p) => (p.key === "story.tell" ? { ...p, classes: ["researching", "storytelling"] } : p)),
          })
        : ok({ classes, powers }),
    );
    render(<PowerAffinityPanel password="pw" castKey="" />);

    // The Architect is the first column and The Storyteller is already ticked,
    // so an implementation that appended would send them the other way round.
    fireEvent.click(await screen.findByRole("checkbox", { name: `${STORY}: suits The Architect` }));
    await waitFor(() => expect(putsOf(spy)).toHaveLength(1));
    const [url, init] = putsOf(spy)[0];
    expect(url).toBe("/api/admin/power-affinity/story.tell");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ classes: ["researching", "storytelling"] });
    await waitFor(() => expect(screen.getByText(`${STORY} now suits The Architect and The Storyteller.`)).toBeTruthy());
  });

  it("orders its columns the way the classes panel shows them, whatever the server sent", async () => {
    const spy = routing(async (_url, init) =>
      init?.method === "PUT" ? ok({ success: true, classes, powers }) : ok({ classes, powers }),
    );
    render(<PowerAffinityPanel password="pw" castKey="" castOrder={["storytelling", "researching"]} />);

    await screen.findByRole("table");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Power",
      "The Storyteller",
      "The Architect",
    ]);
    fireEvent.click(box(`${LIBRARY}: suits The Storyteller`));
    await waitFor(() => expect(putsOf(spy)).toHaveLength(1));
    expect(JSON.parse(String((putsOf(spy)[0][1] as RequestInit).body))).toEqual({
      classes: ["storytelling", "researching"],
    });
  });

  it("moves the box at once, and puts it back when the server refuses", async () => {
    let refuse: (value: unknown) => void = () => {};
    routing(async (_url, init) => {
      if (init?.method !== "PUT") return ok({ classes, powers });
      return new Promise((resolve) => {
        refuse = resolve;
      });
    });
    render(<PowerAffinityPanel password="pw" castKey="" />);

    const name = `${LIBRARY}: suits The Architect`;
    expect(((await screen.findByRole("checkbox", { name })) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box(name));
    await waitFor(() => expect(box(name).checked).toBe(false));

    refuse({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden", message: "Only a member who holds story.tell can change this." }),
    });
    await waitFor(() => expect(box(name).checked).toBe(true));
    expect(screen.getByText("Only a member who holds story.tell can change this.")).toBeTruthy();
  });

  it("hands a decided power back to the platform by sending null, and keeps the keyboard on that row", async () => {
    const spy = routing(async (_url, init) =>
      init?.method === "PUT"
        ? ok({
            success: true,
            classes,
            powers: powers.map((p) => (p.key === "story.tell" ? { ...p, decided: false } : p)),
          })
        : ok({ classes, powers }),
    );
    render(<PowerAffinityPanel password="pw" castKey="" />);

    const storyRow = (await screen.findAllByRole("row")).find((r) =>
      within(r).queryByText(STORY, { selector: "span" }),
    ) as HTMLElement;
    const handBack = within(storyRow).getByRole("button", { name: "Use the platform's suggestion" });
    handBack.focus();
    fireEvent.click(handBack);

    await waitFor(() => expect(putsOf(spy)).toHaveLength(1));
    const [url, init] = putsOf(spy)[0];
    expect(url).toBe("/api/admin/power-affinity/story.tell");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ classes: null });
    // The button is gone with the decision, and focus did not fall to the page.
    await waitFor(() => expect(within(storyRow).queryByRole("button")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(box(`${STORY}: suits The Architect`)));
  });

  it("says the powers did not load, in the server's words, and draws no table", async () => {
    routing(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "auth_required", message: "Sign in as an admin to see which classes suit which powers." }),
    }));
    render(<PowerAffinityPanel password="pw" castKey="" />);

    expect((await screen.findByRole("status")).textContent).toContain("Sign in as an admin");
    // Polite, so it never talks over the page it sits on, and never a second alert on it.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
