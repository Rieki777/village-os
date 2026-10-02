// @vitest-environment jsdom
/**
 * THE SEAT CARD, RENDERED: what a reader meets on the map, on /roles and on
 * /circles, held to the view model it draws.
 *
 * `shared/roleSheet.test.ts` holds every word and number the card may print.
 * This file holds the DRAWING: that each of those reaches the page, in the
 * right element, on the right face, and that nothing the view model left out
 * appears anyway. Every absence carries a known-positive control, so an
 * assertion that a word is missing cannot pass merely because nothing
 * rendered.
 *
 * It also carries the render cases of the map's old seat card test
 * (`seatExplains.test.tsx`), whose header said why they exist and is worth
 * keeping: two of a seat's four sentences were each silently dropped from the
 * map once, by an object literal on the way out, while the database still
 * held them. A field with a reader and no test is the next one removed. So
 * the four are asserted as READ, here, on the card a member sees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { STATE_WORDS, SEAT_STATES, type SheetContext } from "@shared/roleSheet";
import { fromMapSeat, fromProposedSeat } from "@shared/roleSheetInputs";
import { GAME_CONFIG } from "@shared/gameConfig";
import SeatTradingCard from "./SeatTradingCard";
import SeatAction from "./SeatAction";
import PermissionRoleCard from "./PermissionRoleCard";
import { fromPermissionRole } from "@shared/roleSheetInputs";

const motionPref = vi.hoisted(() => ({ reduced: true }));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => motionPref.reduced,
  prefersReducedMotion: () => motionPref.reduced,
}));

const asked: string[] = [];
beforeEach(() => {
  asked.length = 0;
  motionPref.reduced = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      asked.push(String(url));
      return { ok: true, status: 200, json: async () => [] };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = new Date("2026-10-01T12:00:00.000Z");
const CTX: SheetContext = {
  now: NOW,
  season: { name: "Season of Foundations", endsOn: "2027-03-21", daysLeft: 171 },
  classNames: { researching: "The Architect", building: "The Builder" },
};
const CIRCLES = [{ id: "land", name: "Land & Water", decidesBy: null, color: "sage" }];
const DATA = (viewPeople: boolean) => ({ circles: CIRCLES, power: { decidesBy: "consent" }, viewer: { viewPeople } });

const VENDOR = "Vendorbot Supreme";
const MARA_TERM = "2026-11-11T12:00:00.000Z";

/** The brief's sample: two places, Mara current, an agent whose term reached its date. */
const SAMPLE = {
  id: "water-keeper",
  name: "Water Keeper",
  description: "Keep the village's water clean, flowing and understood.",
  domain: "The catchment, the tanks and the greywater lines",
  accountabilities: ["Testing the spring monthly", "Calling a repair before a failure"],
  whyItMatters: "A village that loses its water loses a season, not an afternoon.",
  circleId: "land",
  seats: 2,
  holderCount: 2,
  vacant: false,
  state: "partial",
  stateSource: "derived",
  criticality: "high",
  recruiting: false,
  isExample: false,
  representsCircle: true,
  howChosen: "elected_by_circle",
  howChosenGloss: null,
  termEnds: MARA_TERM,
  archetypes: ["researching"],
  holders: [
    { userId: "u-mara", name: "Mara Quill", kind: "member", isAgent: false, focus: null, lapsed: false, avatar: null, termEndsAt: MARA_TERM },
    { userId: null, name: VENDOR, kind: "documented", isAgent: true, focus: null, lapsed: true, avatar: null, termEndsAt: null },
  ],
};

/** Name and aim only: what every fork starts with. */
const EMPTY_SEAT = {
  id: "seed-keeper",
  name: "Seed Keeper",
  description: "Tend the seed library.",
  domain: null,
  accountabilities: [],
  whyItMatters: null,
  circleId: "land",
  seats: 1,
  holderCount: 0,
  vacant: true,
  state: "open",
  stateSource: "derived",
  criticality: "normal",
  recruiting: false,
  isExample: false,
  representsCircle: false,
  howChosen: null,
  howChosenGloss: null,
  termEnds: null,
  archetypes: [],
  holders: [],
};

/** A held seat with a member somebody can write to. */
const FILLED = {
  ...EMPTY_SEAT,
  id: "bridge-keeper",
  name: "Bridge Keeper",
  holderCount: 1,
  vacant: false,
  state: "filled",
  holders: [{ userId: "u-ana", name: "Ana Lima", kind: "member", isAgent: false, focus: null, lapsed: false, avatar: null, termEndsAt: null }],
};

function show(
  seat: object,
  opts: { viewPeople?: boolean; signedIn?: boolean; action?: boolean; ctx?: SheetContext; embedded?: boolean; labelledBy?: string } = {},
) {
  const viewPeople = opts.viewPeople ?? true;
  const input = fromMapSeat(viewPeople ? seat : { ...seat, holders: [] }, DATA(viewPeople), { signedIn: opts.signedIn ?? true });
  return render(
    <SeatTradingCard
      input={input}
      ctx={opts.ctx ?? CTX}
      action={opts.action === false ? undefined : <SeatAction circleId="land" />}
      embedded={opts.embedded}
      labelledBy={opts.labelledBy}
    />,
  );
}

const card = () => document.querySelector("article[data-power-card]") as HTMLElement;
const headings = () => Array.from(document.querySelectorAll("h4")).map((h) => (h.textContent ?? "").trim());
/** The text an element holds itself, leaving out its children's (the glyph's own <title>). */
const ownText = (el: Element) =>
  Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent)
    .join("")
    .trim();
/** The state badges: a pill whose own svg draws a SeatGlyph `<g>`. */
const badges = (label: string) =>
  Array.from(document.querySelectorAll("span")).filter((s) => ownText(s) === label && s.querySelector(":scope > svg g"));

describe("the five states, and a proposal", () => {
  it("prints the badge in the state's own words, over the map's own glyph", () => {
    for (const state of SEAT_STATES) {
      const { unmount } = show({ ...EMPTY_SEAT, state });
      expect(badges(STATE_WORDS[state]).length, state).toBeGreaterThan(0);
      unmount();
    }
    // Control: the badge finder finds nothing for a word no badge says.
    show(EMPTY_SEAT);
    expect(badges("Open Role")).toEqual([]);
  });

  it("badges a proposal Proposed, with no glyph", () => {
    const input = fromProposedSeat({ name: "Seed Keeper", aim: "Tend the seed library.", seats: 2 });
    render(<SeatTradingCard input={input} ctx={CTX} faces="stacked" />);
    const proposed = Array.from(document.querySelectorAll("span")).filter((s) => s.textContent === "Proposed");
    expect(proposed.length).toBeGreaterThan(0);
    expect(proposed.every((s) => !s.querySelector("svg"))).toBe(true);
    expect(screen.queryByRole("button", { name: /What it does/ })).toBeNull();
    expect(screen.queryByText("Holding it now")).toBeNull();
  });
});

describe("the brief's sample at the member tier", () => {
  it("says Held now 1, says which seating is ready to be re-chosen, and offers a hand", () => {
    show(SAMPLE);
    expect(screen.getAllByText("Held now").length).toBeGreaterThan(0);
    const narrow = card().querySelector('dl[aria-label="Right now"]')!;
    const held = Array.from(narrow.querySelectorAll("div")).find((d) => d.querySelector("dt")?.textContent === "Held now")!;
    expect(held.querySelector("dd")!.textContent).toBe("1");
    expect(screen.getByText("1 of 2 seated is ready to be re-chosen.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Raise your hand for Water Keeper" })).toBeTruthy();
    expect(screen.queryByText(/^Contact/)).toBeNull();
  });

  it("control: a held seat with a member to write to offers Contact", () => {
    show(FILLED);
    expect(screen.getAllByText("Contact Ana Lima").length).toBeGreaterThan(0);
  });

  it("draws the agent as An agent and never by its served name", () => {
    show(SAMPLE);
    expect(JSON.stringify(SAMPLE)).toContain(VENDOR);
    expect(screen.getByText("An agent")).toBeTruthy();
    expect(document.body.textContent).not.toContain(VENDOR);
  });
});

describe("the empty seat, the way every fork starts", () => {
  it("shows an open place, a hand, the season clock and what is still to be written", () => {
    show(EMPTY_SEAT);
    // The roster spot, scoped: with one open place the figure label says "Open place" too.
    expect(within(screen.getByRole("region", { name: "Holding it now" })).getByText("Open place")).toBeTruthy();
    expect(screen.getAllByText("Open place").length).toBeGreaterThan(1);
    expect(screen.getByText("Nobody holds this yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Raise your hand for Seed Keeper" })).toBeTruthy();
    expect(screen.getAllByText("Days left in the season").length).toBeGreaterThan(0);
    expect(screen.getByText("Season of Foundations ends 21 Mar 2027")).toBeTruthy();
    expect(
      screen.getByText(
        "Still to be written down: what it decides on, what it answers for, why it matters and how the next holder is chosen. The founding team writes these down.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Set at seating")).toBeTruthy();
  });

  it("draws no heading over a blank, no class chip and no picture", () => {
    show(EMPTY_SEAT);
    for (const h of ["Decides on", "Answers for", "Why it matters"]) expect(headings()).not.toContain(h);
    expect(screen.queryByText(/^Suits/)).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("control: the sample draws each of them", () => {
    show(SAMPLE);
    for (const h of ["Decides on", "Answers for", "Why it matters"]) expect(headings()).toContain(h);
    expect(screen.getByText("The Architect")).toBeTruthy();
    expect(screen.getByText("Suggested")).toBeTruthy();
    const img = document.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("Stock art for The Architect, a class suggested for this seat");
    expect(img.getAttribute("src")).toMatch(/^\/images\/avatars\/researching-[fm]-(olive|deep|light)\.webp$/);
  });

  it("draws the sigil when the picture will not load", () => {
    show(SAMPLE);
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("W")).toBeTruthy();
  });
});

describe("a seat says what it is for", () => {
  it("gives all four sentences when the seat carries all four", () => {
    show(SAMPLE);
    expect(screen.getAllByText(/Keep the village's water clean/).length).toBeGreaterThan(0);
    expect(screen.getByText(/The catchment, the tanks/)).toBeTruthy();
    expect(screen.getByText(/Testing the spring monthly/)).toBeTruthy();
    expect(screen.getByText(/loses a season, not an afternoon/)).toBeTruthy();
  });

  it("heads each one, so a reader knows which question it answers", () => {
    show(SAMPLE);
    expect(headings()).toEqual(expect.arrayContaining(["Aim", "Decides on", "Answers for", "Why it matters"]));
  });

  it("READS whyItMatters, the field that was once dropped for having no reader", () => {
    show(SAMPLE);
    expect(
      screen.queryByText(/loses a season, not an afternoon/),
      "whyItMatters is on the wire and nothing renders it",
    ).toBeTruthy();
  });

  it("says nothing under a heading that would be blank, and heads the ones that exist", () => {
    show({ ...SAMPLE, domain: null });
    expect(headings()).not.toContain("Decides on");
    expect(headings()).toEqual(expect.arrayContaining(["Answers for", "Why it matters"]));
  });

  it("SAYS SO when nothing has been written, instead of showing blank space", () => {
    show({ ...SAMPLE, description: "", domain: null, accountabilities: [], whyItMatters: null });
    expect(screen.getByText(/^Nobody has written down what this seat is for yet\./)).toBeTruthy();
    expect(screen.getByText("The aim is still to be written down.")).toBeTruthy();
  });

  it("numbers seven accountabilities in one list, and prints a long domain whole", () => {
    const seven = ["One", "Two", "Three", "Four", "Five", "Six", "Seven"].map((w) => `Answer for the ${w.toLowerCase()} thing`);
    const domain = `${"The catchment, the tanks and the greywater lines, ".repeat(6)}and everything downstream.`;
    expect(domain.length).toBeGreaterThan(300);
    show({ ...SAMPLE, accountabilities: seven, domain });
    const answers = screen.getByText("Answer for the one thing").closest("ol")!;
    expect(answers.querySelectorAll("li")).toHaveLength(7);
    expect(screen.getByText(domain)).toBeTruthy();
  });
});

describe("a stranger on the map", () => {
  it("sees a Seated spot per seating, why the names are missing, and a way to sign in", () => {
    show(SAMPLE, { viewPeople: false, signedIn: false });
    expect(screen.getAllByText("Seated").filter((el) => el.closest("li"))).toHaveLength(2);
    expect(screen.getByText("Sign in to see who holds it.")).toBeTruthy();
    const signIn = screen.getByRole("link", { name: /Sign in to raise your hand/ });
    expect(signIn.getAttribute("href")).toMatch(/^\/login\?next=/);
    expect(document.body.textContent).not.toContain("Mara");
    // The card itself reads nothing: no route at all, members-only or not.
    expect(asked).toEqual([]);
  });
});

describe("an example seat", () => {
  it("wears the example chip and offers no action", () => {
    show({ ...EMPTY_SEAT, isExample: true });
    expect(screen.getByText("example")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Raise your hand/ })).toBeNull();
    // Control: the same seat, not an example, offers one.
    show(EMPTY_SEAT);
    expect(screen.getByRole("button", { name: "Raise your hand for Seed Keeper" })).toBeTruthy();
  });
});

describe("turning the card over", () => {
  it("turns to the back, moves focus to the way back, and says so once", () => {
    show(SAMPLE);
    expect(card().getAttribute("data-face")).toBe("front");
    expect(card().querySelectorAll("[aria-live]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /What it does/ }));
    expect(card().getAttribute("data-face")).toBe("back");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to the card" }));
    expect(card().querySelector("[aria-live]")!.textContent).toBe("Showing what it does.");

    fireEvent.click(screen.getByRole("button", { name: "Back to the card" }));
    expect(card().getAttribute("data-face")).toBe("front");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /What it does/ }));
    expect(card().querySelector("[aria-live]")!.textContent).toBe("Showing the card.");
    expect(card().querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("swaps at once under reduced motion, and only after the quarter turn otherwise", async () => {
    // Reduced: the swap is in the same act as the click.
    const { unmount } = show(SAMPLE);
    fireEvent.click(screen.getByRole("button", { name: /What it does/ }));
    expect(card().getAttribute("data-face")).toBe("back");
    unmount();

    // With motion the swap waits for the first quarter turn, then lands.
    motionPref.reduced = false;
    show(SAMPLE);
    fireEvent.click(screen.getByRole("button", { name: /What it does/ }));
    expect(card().getAttribute("data-face")).toBe("front");
    await waitFor(() => expect(card().getAttribute("data-face")).toBe("back"), { timeout: 3000 });
    // Focus moves in the effect after the swap commits, so it is awaited too.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to the card" })));
  });

  it("empties its live region when the same card is handed another seat", async () => {
    // The map keeps one card across selections (VillageMap passes no key), so
    // what the region last said would otherwise be read inside the next seat.
    const cardFor = (seat: object) => (
      <SeatTradingCard input={fromMapSeat(seat, DATA(true), { signedIn: true })} ctx={CTX} action={<SeatAction circleId="land" />} />
    );
    const live = () => card().querySelector("[aria-live]")!;
    const { rerender } = render(cardFor(EMPTY_SEAT));
    fireEvent.click(screen.getByRole("button", { name: "Raise your hand for Seed Keeper" }));
    fireEvent.click(screen.getByRole("button", { name: "Raise my hand" }));
    // Known positive: the region said it, for this seat.
    await waitFor(() => expect(live().textContent).toBe("Hand raised. The founding team will be in touch."));

    rerender(cardFor(FILLED));
    expect(screen.getByRole("heading", { level: 3, name: "Bridge Keeper" })).toBeTruthy();
    expect(live().textContent).toBe("");

    // The same for the turn: "Showing what it does." does not follow the reader to the next seat.
    fireEvent.click(screen.getByRole("button", { name: /What it does/ }));
    expect(live().textContent).toBe("Showing what it does.");
    rerender(cardFor(EMPTY_SEAT));
    expect(card().getAttribute("data-face")).toBe("front");
    expect(live().textContent).toBe("");
  });

  it("turns back to the front from the back footer and opens the hand there", async () => {
    show(SAMPLE);
    fireEvent.click(screen.getByRole("button", { name: /What it does/ }));
    expect(card().getAttribute("data-face")).toBe("back");
    // The footer's shortcut is named by its words alone; the front's door names the seat.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Raise your hand" }));
    });
    expect(card().getAttribute("data-face")).toBe("front");
    const note = await screen.findByLabelText("Why this role calls to you (optional)");
    expect(document.activeElement).toBe(note);
  });
});

describe("ids, chips and ladders", () => {
  it("gives two cards on one page their own ids", () => {
    render(
      <>
        <SeatTradingCard input={fromMapSeat(SAMPLE, DATA(true), { signedIn: true })} ctx={CTX} />
        <SeatTradingCard input={fromMapSeat(SAMPLE, DATA(true), { signedIn: true })} ctx={CTX} />
      </>,
    );
    const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
    const labelled = Array.from(document.querySelectorAll("article")).map((a) => a.getAttribute("aria-labelledby"));
    expect(labelled[0]).not.toBe(labelled[1]);
  });

  it("draws no separator dot in any chip, and marks no step on a seat face", () => {
    show(SAMPLE);
    const chips = Array.from(card().querySelectorAll("ol li, button[aria-expanded]"));
    expect(chips.length).toBeGreaterThan(7);
    for (const c of chips) expect(c.textContent).not.toContain("·");
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
  });

  it("control: the permission face marks exactly one step", () => {
    const stages = GAME_CONFIG.stages.map((s) => ({ id: s.id, name: s.name }));
    const role = { id: "treasurer", name: "Treasurer", description: "Keeps the books.", capabilities: [], minStage: "co-creator", seats: 1, holderCount: 0, holders: [] };
    render(<PermissionRoleCard input={fromPermissionRole(role)} ctx={{ stages, roleWord: "Role", now: NOW }} />);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it("opens one gloss at a time, on a tap, and says so to a screen reader", () => {
    show(SAMPLE);
    const key = screen.getByRole("button", { name: "Key seat" });
    const speaks = screen.getByRole("button", { name: "Speaks for Land & Water" });
    const keyGloss = document.getElementById(key.getAttribute("aria-controls")!)!;
    const speaksGloss = document.getElementById(speaks.getAttribute("aria-controls")!)!;
    expect(key.getAttribute("aria-expanded")).toBe("false");
    expect(keyGloss.hidden).toBe(true);

    fireEvent.click(key);
    expect(key.getAttribute("aria-expanded")).toBe("true");
    expect(keyGloss.hidden).toBe(false);
    expect(keyGloss.textContent).toBe("The village marked this seat as key.");

    fireEvent.click(speaks);
    expect(speaks.getAttribute("aria-expanded")).toBe("true");
    expect(speaksGloss.textContent).toBe("This seat speaks for Land & Water on how it decides.");
    expect(key.getAttribute("aria-expanded")).toBe("false");
    expect(keyGloss.hidden).toBe(true);

    fireEvent.click(speaks);
    expect(speaks.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows Speaks for with no class tag at all", () => {
    show({ ...SAMPLE, archetypes: [] });
    expect(screen.getByRole("button", { name: "Speaks for Land & Water" })).toBeTruthy();
    expect(screen.queryByText("Suggested")).toBeNull();
  });
});

describe("embedded in a /roles row", () => {
  it("leaves the eyebrow and the badge to the row header, and is named by it", () => {
    render(<h2 id="row-header">Water Keeper</h2>);
    show(SAMPLE, { embedded: true, labelledBy: "row-header" });
    expect(card().getAttribute("aria-labelledby")).toBe("row-header");
    expect(badges(STATE_WORDS.partial)).toEqual([]);
    expect(within(card()).queryByText("Land & Water")).toBeNull();
    expect(card().querySelector("h3")).toBeNull();
  });

  it("control: the same seat on its own carries both", () => {
    show(SAMPLE);
    expect(badges(STATE_WORDS.partial).length).toBeGreaterThan(0);
    expect(within(card()).getAllByText("Land & Water").length).toBeGreaterThan(0);
    expect(card().getAttribute("aria-labelledby")).toBe(card().querySelector("h3")!.id);
  });
});

describe("the map's print rule", () => {
  it("finds the card root by data-power-card", () => {
    show(SAMPLE);
    expect(card()).toBeTruthy();
    expect(card().tagName).toBe("ARTICLE");
  });
});
