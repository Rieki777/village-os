// @vitest-environment jsdom
/**
 * THE SEAT CARD'S CONTRAST, measured on the night it is drawn on.
 *
 * Measured through client/src/test/tokenContrast.ts from the classes each line
 * and its ancestors actually carry, with the night sheet's own values as the
 * overlay (`nightOverlay()`, read from the `.sheet-night` block in index.css).
 * Without that overlay the instrument would resolve `bg-card` and
 * `text-foreground` to the light page's values and measure a card nobody sees:
 * the instrument would share the assumption it exists to check.
 *
 * FOUR GROUNDS jsdom CANNOT PAINT, AND WHAT STANDS IN FOR EACH. The resolver
 * refuses a gradient (it throws, naming the element), so each one is replaced
 * by the solid it is made of that is WORST for the ink on it, and the test
 * counts that every replacement happened:
 *
 *   the card's inner ground   muted at the top fading to card. Light ink
 *                             reads worst on the lighter end: `bg-muted`.
 *   the sigil's glow          gold at 14% fading out, over the art window:
 *                             taken as the art window's own `bg-muted`.
 *   the name plate's scrim    card, card at 90%, then clear. The clear part is
 *                             the plate's top padding and nothing else: the
 *                             90% stop sits exactly that far below the top
 *                             (held by "the name plate's scrim" below, since
 *                             a stop at a percentage of the plate's height
 *                             once left a long name's first line on 39 to 62%
 *                             card). So the thinnest ground under the name and
 *                             the chips is card at 90%, over a picture that
 *                             can be anything. A picture is a black and then a
 *                             white stand-in, as the hero copy tests do for a
 *                             photograph. A sigil has no picture under it,
 *                             only the window's own muted.
 *   the gold button           earned-lit at the top to the gold at the
 *                             bottom, under dark ink. Dark ink reads worst on
 *                             the darker end: `bg-notice`.
 *
 * Floors: body text 4.5, and 3 for the 30px figures and the large name.
 * Edges that are controls (the chips, the turn bar, the way back, the
 * buttons) clear 3:1 against their own ground. The hairlines at /45, /50 and
 * /55 and the art's gold ring are decorative and named as such below, and the
 * test holds that no control is drawn with one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { fromMapSeat, fromProposedSeat } from "@shared/roleSheetInputs";
import type { SheetContext } from "@shared/roleSheet";
import { describeFailures, edgeContrast, measureText, nightOverlay, schemeVars } from "@/test/tokenContrast";
import SeatTradingCard from "./SeatTradingCard";
import SeatAction from "./SeatAction";

vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const NIGHT = nightOverlay();
const VARS = schemeVars("light", NIGHT);

const NOW = new Date("2026-10-01T12:00:00.000Z");
const CTX: SheetContext = {
  now: NOW,
  season: { name: "Season of Foundations", endsOn: "2027-03-21", daysLeft: 171 },
  classNames: { researching: "The Architect" },
};
const DATA = (viewPeople: boolean) => ({
  circles: [{ id: "land", name: "Land & Water", decidesBy: null, color: "sage" }],
  power: { decidesBy: "consent" },
  viewer: { viewPeople },
});

const BASE = {
  id: "water-keeper",
  name: "Water Keeper",
  description: "Keep the village's water clean, flowing and understood.",
  domain: "The catchment, the tanks and the greywater lines",
  accountabilities: ["Testing the spring monthly", "Calling a repair before a failure"],
  whyItMatters: "A village that loses its water loses a season.",
  circleId: "land",
  seats: 2,
  holderCount: 2,
  state: "partial",
  stateSource: "derived",
  criticality: "high",
  recruiting: true,
  isExample: true,
  representsCircle: true,
  howChosen: "elected_by_circle",
  howChosenGloss: null,
  termEnds: "2026-11-11T12:00:00.000Z",
  archetypes: ["researching"],
  holders: [
    { userId: "u-mara", name: "Mara Quill", kind: "member", isAgent: false, focus: null, lapsed: false, avatar: null, termEndsAt: "2026-11-11T12:00:00.000Z" },
    { userId: null, name: "Vendorbot", kind: "documented", isAgent: true, focus: null, lapsed: true, avatar: null, termEndsAt: null },
  ],
};
const EMPTY = { ...BASE, domain: null, accountabilities: [], whyItMatters: null, holderCount: 0, state: "open", termEnds: null, howChosen: null, archetypes: [], holders: [], isExample: false };

/** One card per state, plus the shapes that draw a different part. */
const CASES: Array<[string, object, boolean]> = [
  ["open", EMPTY, true],
  ["partial, member tier", BASE, true],
  ["filled, contactable", { ...EMPTY, state: "filled", holderCount: 1, holders: [{ userId: "u-ana", name: "Ana Lima", kind: "member", lapsed: false }] }, true],
  ["forming", { ...EMPTY, state: "forming", stateSource: "declared", seats: 3 }, true],
  ["expired", { ...BASE, state: "expired", holderCount: 1, holders: [{ ...BASE.holders[0], lapsed: true }] }, true],
  ["a stranger", BASE, false],
];

/** How the plate's scrim class begins; `stopUnderPadding` reads the rest of it. */
const PLATE_SCRIM = "bg-[linear-gradient(to_top,";

/**
 * Where the plate's scrim reaches 90% card, as rem below the plate's top, and
 * how deep the plate's top padding is. Null when the scrim does not put its
 * 90% stop a fixed distance below the top, which is the shape that left a
 * long name on a thinner ground than the stand-in claims.
 */
function stopUnderPadding(cls: string[]): { stopRem: number; padRem: number } | null {
  const scrim = cls.find((c) => c.startsWith(PLATE_SCRIM));
  const pad = cls.map((c) => /^pt-(\d+(?:\.\d+)?)$/.exec(c)).find(Boolean);
  if (!scrim || !pad) return null;
  const stop = /color-mix\(in_srgb,var\(--card\)_90%,transparent\)_calc\(100%_-_(\d+(?:\.\d+)?)rem\)/.exec(scrim);
  return stop ? { stopRem: Number(stop[1]), padRem: Number(pad[1]) / 4 } : null;
}

/** Each gradient the resolver cannot read, replaced by its worst solid, counted. */
function flatten(root: Element, art: "bg-black" | "bg-white"): Record<string, number> {
  const done: Record<string, number> = { inner: 0, sigil: 0, plate: 0, gold: 0, art: 0 };
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    let next = cls;
    if (cls.some((c) => c.startsWith("bg-[radial-gradient(130%"))) {
      next = next.map((c) => (c.startsWith("bg-[radial-gradient(130%") ? "bg-muted" : c));
      done.inner++;
    }
    if (cls.some((c) => c.startsWith("bg-[radial-gradient(80%"))) {
      next = next.filter((c) => !c.startsWith("bg-[radial-gradient(80%"));
      done.sigil++;
    }
    if (cls.some((c) => c.startsWith(PLATE_SCRIM))) {
      next = next.map((c) => (c.startsWith(PLATE_SCRIM) ? "bg-card/90" : c));
      done.plate++;
    }
    if (cls.includes("bg-gradient-to-b")) {
      next = next.map((c) => (c === "bg-gradient-to-b" ? "bg-notice" : c));
      done.gold++;
    }
    // Only a picture can be anything; a sigil sits on the window's own ground.
    if (cls.includes("min-h-52") && cls.includes("bg-muted") && el.querySelector("img")) {
      next = next.map((c) => (c === "bg-muted" ? art : c));
      done.art++;
    }
    if (next !== cls) el.setAttribute("class", next.join(" "));
  }
  return done;
}

const cardRoot = () => document.querySelector("article[data-power-card]")!;

function measure(art: "bg-black" | "bg-white") {
  const done = flatten(cardRoot(), art);
  const results = measureText(cardRoot(), "light", NIGHT);
  return { done, results };
}

describe("the seat card on the night ground", () => {
  for (const [label, seat, viewPeople] of CASES) {
    for (const art of ["bg-black", "bg-white"] as const) {
      it(`clears every floor: ${label}, over a ${art === "bg-black" ? "dark" : "light"} picture`, () => {
        render(
          <SeatTradingCard
            input={fromMapSeat(viewPeople ? seat : { ...seat, holders: [] }, DATA(viewPeople), { signedIn: viewPeople })}
            ctx={CTX}
            action={<SeatAction circleId="land" />}
          />,
        );
        const hasPicture = !!cardRoot().querySelector("img");
        const { done, results } = measure(art);
        expect(done.inner, "the inner ground was flattened").toBe(1);
        expect(done.plate, "the plate's scrim was flattened").toBe(1);
        expect(done.art, "a picture's window was given a stand-in").toBe(hasPicture ? 1 : 0);
        expect(done.sigil, "a sigil's glow was flattened").toBe(hasPicture ? 0 : 1);
        expect(results.length).toBeGreaterThan(20);
        expect(describeFailures(results)).toEqual([]);
      });
    }
  }

  it("clears every floor on a proposal, stacked", () => {
    const input = fromProposedSeat({ name: "Seed Keeper", aim: "Tend the seed library.", seats: 2, domain: "The seed shelves" });
    render(<SeatTradingCard input={input} ctx={CTX} faces="stacked" />);
    const { done, results } = measure("bg-white");
    expect(done.sigil).toBe(1);
    expect(describeFailures(results)).toEqual([]);
  });

  it("clears every floor with the hand's form open, and the gold button measured", () => {
    render(<SeatTradingCard input={fromMapSeat(EMPTY, DATA(true), { signedIn: true })} ctx={CTX} action={<SeatAction circleId="land" />} />);
    const { done } = measure("bg-black");
    expect(done.gold, "the gold door was flattened").toBe(1);
    expect(describeFailures(measureText(cardRoot(), "light", NIGHT))).toEqual([]);
  });

  it("clears every floor in the opened raise form and the opened composer", () => {
    render(<SeatTradingCard input={fromMapSeat(EMPTY, DATA(true), { signedIn: true })} ctx={CTX} action={<SeatAction circleId="land" />} />);
    fireEvent.click(screen.getByRole("button", { name: "Raise your hand for Water Keeper" }));
    expect(describeFailures(measure("bg-black").results)).toEqual([]);
  });
});

describe("the name plate's scrim", () => {
  it("reaches 90% card at the top of the name: a fixed distance below the plate's top, never a share of its height", () => {
    // The live longest name, three lines at a phone's width, which is where a
    // stop at a share of the height left the first line on thin ground.
    const long = { ...BASE, name: "Regenerative Agriculture and Permaculture Circle Lead" };
    render(<SeatTradingCard input={fromMapSeat(long, DATA(true), { signedIn: true })} ctx={CTX} />);
    const plate = screen.getByRole("heading", { level: 3 }).parentElement!;
    const reading = stopUnderPadding((plate.getAttribute("class") ?? "").split(/\s+/));
    expect(reading, "the plate's scrim names its 90% stop as a distance below the top").not.toBeNull();
    // The clear part of the scrim lies inside the top padding, so the name's
    // first line starts on 90% card and every line below it on more.
    expect(reading!.stopRem).toBeLessThanOrEqual(reading!.padRem);
    // Controls: the scrim this replaced, its 90% stop at 55% of the plate's
    // height, is refused by the same reading, written either way; and a stop
    // further down than the padding reads as one the name would start above.
    expect(stopUnderPadding("bg-gradient-to-t from-card via-card/90 via-55% to-transparent px-3 pb-3 pt-12".split(" "))).toBeNull();
    const asShare = "bg-[linear-gradient(to_top,var(--card)_0%,color-mix(in_srgb,var(--card)_90%,transparent)_55%,transparent_100%)] pt-12";
    expect(stopUnderPadding(asShare.split(" "))).toBeNull();
    const tooLow = "bg-[linear-gradient(to_top,var(--card)_0%,color-mix(in_srgb,var(--card)_90%,transparent)_calc(100%_-_4rem),transparent_100%)] pt-12";
    const low = stopUnderPadding(tooLow.split(" "))!;
    expect(low.stopRem).toBeGreaterThan(low.padRem);
  });
});

describe("the pairs the judges measured", () => {
  const pair = (text: string, ground: string) => {
    const div = document.createElement("div");
    div.setAttribute("class", ground);
    const p = document.createElement("p");
    p.setAttribute("class", text);
    p.textContent = "A line";
    div.appendChild(p);
    document.body.appendChild(div);
    try {
      return measureText(div, "light", NIGHT)[0].ratio;
    } finally {
      div.remove();
    }
  };

  it("reproduces dim, gold and green on the raised panel, and the ground on gold", () => {
    expect(pair("text-muted-foreground", "bg-muted")).toBeCloseTo(6.45, 1);
    expect(pair("text-notice", "bg-muted")).toBeCloseTo(7.1, 1);
    expect(pair("text-open", "bg-muted")).toBeCloseTo(7.02, 1);
    expect(pair("text-background", "bg-notice")).toBeCloseTo(8.95, 1);
  });

  it("reads the earned highlight by its variable, as the Held badge does", () => {
    expect(pair("text-(--sheet-earned-lit)", "bg-card")).toBeGreaterThan(4.5);
    // Control: a variable nothing declares is refused, never read as some colour.
    expect(() => pair("text-(--no-such-token)", "bg-card")).toThrow(/no value and no fallback/);
  });
});

/** Hairlines and rings that draw no control's edge. */
const DECORATIVE = ["border-border/45", "border-border/50", "border-border/55", "after:border-notice/25", "ring-notice/50"];

describe("edges", () => {
  it("draws every control's edge at 3:1 or better against its own ground", () => {
    const edges: Array<[string, string, string]> = [
      ["the Key seat chip", "border-notice/60", "bg-card"],
      ["the Recruiting chip", "border-open/55", "bg-card"],
      ["the Speaks for and Suits chips", "border-border", "bg-card"],
      ["the turn bar, inside", "border-notice/55", "bg-muted"],
      ["the turn bar, on the card", "border-notice/55", "bg-card"],
      ["the way back, the shortcut and Contact", "border-border", "bg-muted"],
      ["the gold door, on the card", "border-notice", "bg-muted"],
    ];
    for (const [what, edge, ground] of edges) {
      expect(edgeContrast(edge, ground, VARS), what).toBeGreaterThanOrEqual(3);
    }
  });

  it("draws no control with a decorative hairline", () => {
    render(<SeatTradingCard input={fromMapSeat(BASE, DATA(true), { signedIn: true })} ctx={CTX} action={<SeatAction circleId="land" />} />);
    const controls = Array.from(cardRoot().querySelectorAll("button, a, input, textarea"));
    expect(controls.length).toBeGreaterThan(5);
    for (const c of controls) {
      const cls = (c.getAttribute("class") ?? "").split(/\s+/);
      expect(DECORATIVE.filter((d) => cls.includes(d)), c.textContent ?? "").toEqual([]);
    }
    // Control: the hairlines are really on the card, on its dividers.
    const html = cardRoot().outerHTML;
    for (const d of ["border-border/45", "border-border/55", "ring-notice/50"]) expect(html).toContain(d);
  });
});
