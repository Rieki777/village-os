// @vitest-environment jsdom
/**
 * Gene Keys in the browser: the birth-town list, the part of the day, the
 * reveal, the seal, a circle's six lines, Love and Prosperity, the moon's
 * contemplation, the share card, Maia's type line, Who complements me, and the
 * glyph on the living map. Every person is invented; every chart comes from an invented birth
 * through the same calculator the flow page runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { viewOf, type GeneKeysView } from "@shared/geneKeys";
import { chartAt, zonedToUtc } from "@shared/geneKeysSky";

const modules = vi.hoisted(() => ({ on: true }));
vi.mock("@/modules/ModuleProvider", () => ({
  useModuleOn: (id: string) => id === "gene-keys" && modules.on,
  useModule: (id: string) => (id === "gene-keys" && modules.on ? { id, lifecycle: "members" } : undefined),
}));

const api = vi.hoisted(() => ({
  people: {} as Record<string, unknown>,
  asked: [] as string[][],
  complements: { state: "not-joined" } as unknown,
  changed: [] as unknown[],
}));
vi.mock("@/lib/geneKeysApi", () => ({
  readPeopleGeneKeys: async (ids: string[]) => {
    api.asked.push(ids);
    return api.people;
  },
  readMyGeneKeys: async () => null,
  readPlacesText: async () => "",
  readComplements: async () => api.complements,
  changeMyGeneKeys: async (patch: unknown) => {
    api.changed.push(patch);
    return null;
  },
  removeMyGeneKeys: async () => true,
  GeneKeysRefusal: class extends Error {},
}));

import { parsePlaces, searchPlaces } from "./places";
import GeneKeysSeal, { ABOVE_A_MODAL } from "./GeneKeysSeal";
import CircleLines from "./CircleLines";
import GeneKeysReveal from "./GeneKeysReveal";
import { PARTS } from "@/pages/GeneKeys";
import { GeneKeysLines } from "./GeneKeysLines";
import GeneKeysComplements, { COMPLEMENTS_WORDS } from "./GeneKeysComplements";
import CircleGlyph from "./CircleGlyph";
import HolderGeneKeys from "./HolderGeneKeys";
import MaiaTypeLine, { maiaTypeLine } from "./MaiaTypeLine";
import { setMyGeneKeys } from "./useMyGeneKeys";
import { forgetShownLines, heldLines, shownLinesOf } from "./shownLines";
import { shareCardWords } from "./shareCard";
import { FREQUENCY_KEY, LADDER_MOONS, MOON_KEY_PREFIX, contemplationEntry, ladderFrom, promptFor } from "./moon";
import type { OwnGeneKeysView } from "@shared/geneKeys";
import type { JournalEntry } from "@shared/journal";

const view = (zone: string, y: number, mo: number, d: number, h: number, mi: number): GeneKeysView =>
  viewOf(chartAt(zonedToUtc(y, mo, d, h, mi, zone)));
/** Wren 2/5 Manifestor, Kai 3/6 Generator, Juno 1/3 Generator. */
const WREN = view("America/New_York", 1990, 6, 15, 14, 30);
const KAI = view("Europe/London", 2001, 7, 10, 4, 2);
const JUNO = view("Asia/Tokyo", 1995, 3, 3, 14, 54);

const inRouter = (node: ReactElement) => {
  const { hook } = memoryLocation({ path: "/profile" });
  return render(<Router hook={hook}>{node}</Router>);
};

beforeEach(() => {
  modules.on = true;
  api.people = {};
  api.asked = [];
  api.complements = { state: "not-joined" };
  api.changed = [];
  forgetShownLines();
});
afterEach(cleanup);

describe("the birth-town list", () => {
  const TEXT = [
    "# GeoNames cities15000, CC BY 4.0, https://www.geonames.org (generated 2026-10-22)",
    "America/Denver",
    "America/Phoenix",
    "America/Costa_Rica",
    "",
    "Phoenix\t\tUS\t1",
    "Denver\t\tUS\t0",
    "San José\tSan Jose\tCR\t2",
    "Boulder\t\tUS\t0",
    "",
  ].join("\r\n");

  it("reads CRLF and LF alike and keeps each town's own zone", () => {
    const places = parsePlaces(TEXT);
    expect(places.map((p) => `${p.name}:${p.zone}`)).toEqual([
      "Phoenix:America/Phoenix", "Denver:America/Denver", "San José:America/Costa_Rica", "Boulder:America/Denver",
    ]);
    expect(parsePlaces(TEXT.replace(/\r\n/g, "\n"))).toEqual(places);
  });

  it("finds a town by its start or a word in it, accents folded, and waits for two letters", () => {
    const places = parsePlaces(TEXT);
    expect(searchPlaces(places, "san jo").map((p) => p.name)).toEqual(["San José"]);
    expect(searchPlaces(places, "jose").map((p) => p.name)).toEqual(["San José"]);
    expect(searchPlaces(places, "b")).toEqual([]);
  });
});

describe("roughly when", () => {
  it("morning, afternoon, evening and night cover every minute of the day once, and no idea is the whole day", () => {
    const named = PARTS.filter((p) => p.id !== "unknown").flatMap((p) => p.spans.map(([from, to]) => [from, to] as const));
    const minutes = named.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i)).sort((a, b) => a - b);
    expect(minutes).toEqual(Array.from({ length: 1440 }, (_, i) => i));
    expect(PARTS.find((p) => p.id === "unknown")?.spans).toEqual([[0, 1439]]);
  });
});

describe("the reveal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ends with the profile as the heading's neighbour, the names as the heading, and the two lines marked", () => {
    // Reduced motion draws the finished state at once, which is the state this pins.
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    const { container } = inRouter(<GeneKeysReveal view={WREN} chosen={false} headingId="gk-result-h" />);
    const h = screen.getByRole("heading", { level: 1 });
    expect(h.id).toBe("gk-result-h");
    expect(h.textContent).toBe("Dancer · Fixer");
    expect(screen.getByText("2/5")).toBeTruthy();
    expect(screen.getByText("Your Gene Keys profile")).toBeTruthy();
    // Six bars, bottom-up in the DOM order 1..6: line 2 solid gold, line 5 a gold ring, the rest plain.
    const bars = Array.from(container.querySelectorAll("[aria-hidden='true'] > span > span"));
    expect(bars).toHaveLength(6);
    const mark = (el: Element) => (el.className.includes("bg-notice") ? "solid" : el.className.includes("border-notice") ? "ring" : "plain");
    expect(bars.map(mark)).toEqual(["plain", "solid", "plain", "plain", "ring", "plain"]);
  });

  it("says a chosen window was chosen", () => {
    inRouter(<GeneKeysReveal view={KAI} chosen headingId="h" />);
    expect(screen.getByText("Chosen by you")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(KAI.names);
  });
});

describe("the seal", () => {
  it("is a named button that opens the lines card", async () => {
    inRouter(<GeneKeysSeal view={WREN} whose="Wren" />);
    const seal = screen.getByRole("button", { name: /Gene Keys lines 2 and 5, Dancer and Fixer/ });
    expect(seal.textContent).toBe("2/5");
    fireEvent.click(seal);
    expect(await screen.findByText("Explore more in depth on genekeys.com")).toBeTruthy();
    expect(screen.getByText("How Wren works best")).toBeTruthy();
    expect(screen.getByText("Manifestor")).toBeTruthy();
    expect(screen.getByText("12.2")).toBeTruthy();
  });

  /*
   * Live 2026-10-30 (9ba19a2): the seal sits inside the role sheet, which is a
   * z-[70] modal, and its card opened at the shadcn default z-50, so on a phone
   * the lines sheet opened UNDER the role sheet. Card and overlay both sit one
   * tier above a modal, on the phone sheet and the wide dialog alike.
   */
  it.each([
    ["a phone", false],
    ["a wide screen", true],
  ])("opens its card above a modal sheet on %s, overlay included", async (_label, wide) => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: wide && q.includes("min-width"), addEventListener() {}, removeEventListener() {} }));
    inRouter(<GeneKeysSeal view={WREN} whose="Wren" />);
    fireEvent.click(screen.getByRole("button", { name: /Gene Keys lines 2 and 5/ }));
    await screen.findByText("Explore more in depth on genekeys.com");
    const content = document.querySelector(wide ? "[data-slot=dialog-content]" : "[data-slot=sheet-content]")!;
    const overlay = document.querySelector(wide ? "[data-slot=dialog-overlay]" : "[data-slot=sheet-overlay]")!;
    for (const el of [content, overlay]) {
      expect(el.className).toContain(ABOVE_A_MODAL);
      expect(el.className).not.toMatch(/(^|\s)z-50(\s|$)/);
    }
    vi.unstubAllGlobals();
  });
});

describe("a circle's six lines", () => {
  const HOLDERS = [
    { id: "m-wren", name: "Wren" },
    { id: "m-kai", name: "Kai" },
    { id: "m-juno", name: "Juno" },
    { id: "m-ash", name: "Ash" },
  ];

  it("shows who holds each line, the open one as an invitation, and the hidden as a count", async () => {
    api.people = { "m-wren": WREN, "m-kai": KAI, "m-juno": JUNO };
    inRouter(<CircleLines holders={HOLDERS} />);
    expect(await screen.findByText("5 of 6 lines held · 1 member keeps their lines private")).toBeTruthy();
    expect(screen.getAllByText("Open · who will hold it?")).toHaveLength(1);
    expect(screen.getByText("4 · Server")).toBeTruthy();
    expect(screen.queryByText(/Ash/)).toBeNull();
    expect(screen.getByText("1 Manifestor · 2 Generators")).toBeTruthy();
    expect(api.asked).toEqual([["m-ash", "m-juno", "m-kai", "m-wren"]]);
  });

  it("draws nothing while the module is off, and asks nothing", async () => {
    modules.on = false;
    const { container } = inRouter(<CircleLines holders={HOLDERS} />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(api.asked).toEqual([]);
  });

  it("draws nothing when nobody in the circle shows their lines", async () => {
    const { container } = inRouter(<CircleLines holders={HOLDERS} />);
    await waitFor(() => expect(api.asked).toHaveLength(1));
    expect(container.innerHTML).toBe("");
  });
});

const own = (v: GeneKeysView, over: Partial<OwnGeneKeysView> = {}): OwnGeneKeysView => ({
  ...v, visibility: "show", maia: false, complement: false, maiaPlain: false, cardOut: false, source: "exact", stale: false, ...over,
});

describe("Love and Prosperity on the lines card", () => {
  it("folds both sequences under the Activation tiles, with each sphere's own word", () => {
    inRouter(<GeneKeysLines view={WREN} whose="Wren" />);
    expect(screen.getByText("Love and Prosperity")).toBeTruthy();
    for (const name of ["Attraction", "IQ", "EQ", "SQ", "Core", "Culture", "Pearl"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.queryByText(/With a chosen birth time/)).toBeNull();
  });

  it("tells the owner of a chosen birth time that Attraction may read differently", () => {
    inRouter(<GeneKeysLines view={own(WREN, { source: "chosen" })} whose={null} />);
    expect(screen.getByText(/Attraction follows the Moon/)).toBeTruthy();
  });
});

describe("a contemplation each moon", () => {
  const entry = (cycle: number, frequency: string, writtenAt: string, extra: Partial<JournalEntry> = {}): JournalEntry =>
    ({
      id: `e-${cycle}-${writtenAt}`,
      practice: "free",
      answers: [
        { questionKey: `${MOON_KEY_PREFIX}${cycle}`, prompt: "p", text: "words" },
        { questionKey: FREQUENCY_KEY, prompt: "q", text: frequency },
      ],
      writtenAt,
      ...extra,
    }) as JournalEntry;

  it("asks about the Life's Work key and saves a private free entry under its own keys", () => {
    expect(promptFor(WREN)).toBe("This moon, sit with Gene Key 12, the key of your Life's Work. Where did it show up in you?");
    const e = contemplationEntry(WREN, { clientId: "c1", cycle: 330, text: "  In a hard talk.  ", frequency: "gift", now: new Date("2026-10-30T09:00:00Z") });
    expect([e.practice, e.privacy, e.depth]).toEqual(["free", "private", "light"]);
    expect(e.answers.map((a) => [a.questionKey, a.text])).toEqual([[`${MOON_KEY_PREFIX}330`, "In a hard talk."], [FREQUENCY_KEY, "Gift"]]);
  });

  it("builds the ladder from the latest mark per moon, the last season only, ignoring other pages", () => {
    const entries = [
      entry(300, "Shadow", "2026-01-01T00:00:00Z"),
      entry(300, "Gift", "2026-01-02T00:00:00Z"),
      entry(301, "Siddhi", "2026-02-01T00:00:00Z"),
      { id: "x", practice: "free", answers: [{ questionKey: "free.what", prompt: "p", text: "a day" }], writtenAt: "2026-02-02T00:00:00Z" } as JournalEntry,
      entry(302, "Nonsense", "2026-03-01T00:00:00Z"),
    ];
    expect(ladderFrom(entries)).toEqual([{ cycle: 300, frequency: "gift" }, { cycle: 301, frequency: "siddhi" }]);
    const many = Array.from({ length: 20 }, (_, i) => entry(400 + i, "Gift", `2027-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
    const ladder = ladderFrom(many);
    expect(ladder).toHaveLength(LADDER_MOONS);
    expect(ladder[0].cycle).toBe(407);
  });
});

describe("the share card", () => {
  it("prints the profile, its words, the type, the four keys and Richard's credit, and no birth detail", () => {
    const w = shareCardWords(WREN, "Willowbrook");
    expect(w.eyebrow).toBe("MY LINES IN WILLOWBROOK");
    expect([w.profile, w.names, w.type]).toEqual(["2/5", "Dancer · Fixer", "A Manifestor · Inform"]);
    expect(w.keys.map((k) => `${k.name} ${k.keyLine}`)).toEqual(["Life's Work 12.2", "Evolution 11.2", "Radiance 36.5", "Purpose 6.5"]);
    expect(w.footer).toMatch(/Richard Rudd/);
    expect(JSON.stringify(w)).not.toMatch(/1990|New York|14:30/);
  });
});

describe("Maia speaks your type", () => {
  it("leads with waiting for emotional authority, and speaks each type's strategy otherwise", () => {
    expect(maiaTypeLine({ type: "Manifestor", authority: "Emotional" })).toMatch(/^No rush on this one/);
    expect(maiaTypeLine({ type: "Generator", authority: "Sacral" })).toMatch(/lights you up, that is your yes/);
    expect(maiaTypeLine({ type: "Projector", authority: "Splenic" })).toMatch(/welcome an invitation/);
    expect(maiaTypeLine({ type: "Manifestor", authority: "Splenic" })).toMatch(/heads up first/);
  });

  it("speaks only with Maia's yes, and never once the member asked her to talk plainly", () => {
    setMyGeneKeys(own(KAI, { maia: false }));
    const { container, rerender } = inRouter(<MaiaTypeLine />);
    expect(container.innerHTML).toBe("");
    setMyGeneKeys(own(KAI, { maia: true }));
    rerender(<Router hook={memoryLocation({ path: "/" }).hook}><MaiaTypeLine /></Router>);
    expect(screen.getByText("From Maia:")).toBeTruthy();
    setMyGeneKeys(own(KAI, { maia: true, maiaPlain: true }));
    rerender(<Router hook={memoryLocation({ path: "/" }).hook}><MaiaTypeLine /></Router>);
    expect(screen.queryByText("From Maia:")).toBeNull();
    setMyGeneKeys(null);
  });
});

describe("who complements me", () => {
  it("offers to join, and joining is the one setting it changes", async () => {
    inRouter(<GeneKeysComplements mine={own(WREN)} />);
    fireEvent.click(await screen.findByRole("button", { name: COMPLEMENTS_WORDS.join }));
    await waitFor(() => expect(api.changed).toEqual([{ complement: true }]));
  });

  it("lists who joined with the lines they bring, and says when lines must be shown first", async () => {
    api.complements = { state: "joined", people: [{ name: "Kai Moss", handle: "kai", view: KAI, fills: [3, 6] }] };
    inRouter(<GeneKeysComplements mine={own(WREN, { complement: true })} />);
    expect(await screen.findByText(/Brings line 3 \(Changer\) and line 6 \(Teacher\)/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kai Moss" }).getAttribute("href")).toBe("/profile/kai");
    cleanup();
    api.complements = { state: "hidden" };
    inRouter(<GeneKeysComplements mine={own(WREN, { visibility: "hide" })} />);
    expect(await screen.findByText(COMPLEMENTS_WORDS.hidden)).toBeTruthy();
  });
});

describe("the glyph on the living map", () => {
  it("asks once for every circle drawn in the same moment, and remembers the answer", async () => {
    api.people = { "m-wren": WREN, "m-kai": KAI };
    const [a, b] = await Promise.all([shownLinesOf(["m-wren", "m-ash"]), shownLinesOf(["m-kai", "m-wren"])]);
    expect(api.asked).toEqual([["m-wren", "m-ash", "m-kai"]]);
    expect(heldLines(Object.values(a))).toEqual([2, 5]);
    expect(heldLines(Object.values(b))).toEqual([2, 3, 5, 6]);
    await shownLinesOf(["m-ash"]);
    expect(api.asked).toHaveLength(1);
  });

  it("draws six bars, solid where a line is shown and dashed where it is open, and nothing for a hidden circle", async () => {
    api.people = { "m-juno": JUNO };
    const { container } = render(<svg><CircleGlyph cx={0} cy={0} r={40} px={1} holderIds={["m-juno", "m-ash"]} /></svg>);
    await waitFor(() => expect(container.querySelectorAll("rect")).toHaveLength(7));
    expect(screen.getByRole("img", { name: "2 of 6 lines shown in this circle" })).toBeTruthy();
    expect(container.querySelectorAll("rect.fill-foreground")).toHaveLength(2);
    expect(container.querySelectorAll("rect.stroke-notice")).toHaveLength(4);
    // The plate sits outside the rim, lower right: its corner is past r / sqrt 2 on both axes.
    const plate = container.querySelector("rect.fill-background")!;
    expect(Number(plate.getAttribute("x"))).toBeGreaterThan(40 * Math.SQRT1_2);
    cleanup();
    const hidden = render(<svg><CircleGlyph cx={0} cy={0} r={40} px={1} holderIds={["m-ash"]} /></svg>);
    await waitFor(() => expect(api.asked.flat()).toContain("m-ash"));
    expect(hidden.container.querySelectorAll("rect")).toHaveLength(0);
  });
});

describe("a role holder's seal, for the map's seat card", () => {
  it("shows a shown member's seal by id, and nothing for a hidden one or with the module off", async () => {
    api.people = { "m-kai": KAI };
    inRouter(<HolderGeneKeys userId="m-kai" name="Kai Moss" />);
    expect((await screen.findByRole("button", { name: /Gene Keys lines 3 and 6/ })).textContent).toBe("3/6");
    cleanup();
    const hidden = inRouter(<HolderGeneKeys userId="m-ash" name="Ash" />);
    await waitFor(() => expect(api.asked.flat()).toContain("m-ash"));
    expect(hidden.container.innerHTML).toBe("");
    cleanup();
    modules.on = false;
    const off = inRouter(<HolderGeneKeys userId="m-kai" name="Kai Moss" />);
    expect(off.container.innerHTML).toBe("");
  });
});
