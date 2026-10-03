/**
 * THE CROWN BAR DRAWS THE VILLAGE'S OWN CHIPS, AND AN UNSET ONE SAYS "EXAMPLE".
 *
 * Rye, deciding F29 (2026-10-02): "Mark them as examples and wire them to
 * admin where we can add in a label and a datasource ... Label as example -
 * this label goes away once set."
 *
 * The shell pushes `{type:'chips', chips}`: the founder's list from Village
 * settings, in order, each chip already resolved by the server
 * (shared/mapStatChips.ts, `resolveChips`). This file runs the real artifact
 * in jsdom and plays the shell's side, the way mapArtifactDraftMark.test.ts
 * does, and checks what a visitor is shown:
 *
 *   - with no push (a standalone open, or before the shell answers) the five
 *     chips the map has always drawn, each saying "example" in words;
 *   - with a push, exactly the founder's chips in the founder's order, the
 *     example word on the unset ones and on nothing else;
 *   - the drop-down, the Village Health door and the bar agreeing, because
 *     all three read `chipRows()`.
 *
 * Every script string handed to the window is a constant. Values travel as
 * message data or through the document, never by being spliced into code.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHIP_ICON_PATHS } from "./mapStatChips";

const ARTIFACT = path.resolve(__dirname, "../docs/prototypes/grounds-v0.html");
const html = fs.readFileSync(ARTIFACT, "utf8");

type ArtifactWindow = Window & typeof globalThis & { eval(src: string): unknown };
interface Jsdom {
  JSDOM: new (
    markup: string,
    options: {
      runScripts: "dangerously";
      pretendToBeVisual: boolean;
      url: string;
      virtualConsole: unknown;
      beforeParse: (window: ArtifactWindow) => void;
    },
  ) => { window: ArtifactWindow };
  VirtualConsole: new () => { on(event: "jsdomError", listener: (e: Error & { type?: string; cause?: unknown }) => void): void };
}
const { JSDOM, VirtualConsole } = createRequire(import.meta.url)("jsdom") as Jsdom;

const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function inert<T extends object>(known: T): T {
  return new Proxy(known, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      return typeof key === "symbol" ? undefined : () => undefined;
    },
  });
}

/** The platform jsdom lacks. mapArtifactBoot.test.ts says why each stub exists. */
function stubTheMissingPlatform(window: ArtifactWindow) {
  const pixels = (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4) || 0) });
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(this: HTMLCanvasElement, kind: string) {
      if (kind !== "2d") return null;
      const paint = () => ({ addColorStop() {} });
      return inert({
        canvas: this,
        measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
        getImageData: (_x: number, _y: number, w: number, h: number) => pixels(w, h),
        createImageData: (w: number, h: number) => pixels(w, h),
        createLinearGradient: paint,
        createRadialGradient: paint,
        createConicGradient: paint,
        createPattern: () => ({ setTransform() {} }),
        getLineDash: () => [],
        isPointInPath: () => false,
        isPointInStroke: () => false,
      });
    },
  });
  class Unobserved {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.assign(window, {
    Path2D: class {
      constructor() {
        return inert({});
      }
    },
    ResizeObserver: Unobserved,
    IntersectionObserver: Unobserved,
    matchMedia: (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }),
  });
}

interface Booted {
  window: ArtifactWindow;
  doc: Document;
  uncaught: unknown[];
  run<T>(src: string): T;
  /** A message from the shell, in the shape LivingMap.tsx posts it. */
  post(data: Record<string, unknown>): void;
  close(): void;
}

function boot(): Booted {
  const uncaught: unknown[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => {
    if (e.type === "unhandled-exception") uncaught.push(e.cause ?? e);
  });
  const { window } = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/grounds/index.html#skipIntro",
    virtualConsole,
    beforeParse(w) {
      w.addEventListener("error", (ev) => uncaught.push(ev.error ?? ev.message));
      Object.assign(w, { innerWidth: 1440, innerHeight: 900 });
      stubTheMissingPlatform(w);
    },
  });
  return {
    window,
    doc: window.document,
    uncaught,
    run: <T>(src: string) => window.eval(src) as T,
    post(data) {
      // Through the window's own JSON, so the artifact holds objects of its
      // own realm, the way a structured clone arrives.
      const own = window.eval("JSON").parse(JSON.stringify(data));
      window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
    },
    close: () => window.close(),
  };
}

interface Seen {
  k: string;
  value: string;
  label: string;
  example: boolean;
  /** The word under the number, where labels are hidden. */
  vex: string | null;
  aria: string;
  icon: string;
}

function bar(m: Booted): Seen[] {
  return [...m.doc.querySelectorAll<HTMLElement>("#vitals .vital")]
    .filter((c) => c.dataset.k !== "moon")
    .map((c) => ({
      k: c.dataset.k ?? "",
      value: c.querySelector("b")?.textContent ?? "",
      label: c.querySelector("small")?.textContent ?? "",
      example: c.getAttribute("data-example") === "1",
      vex: c.querySelector(".vex")?.textContent ?? null,
      aria: c.getAttribute("aria-label") ?? "",
      icon: c.querySelector("path")?.getAttribute("d") ?? "",
    }));
}

/** Open a chip's reading the way a click does, read it, and close it. */
function dropFor(m: Booted, k: string) {
  const chip = [...m.doc.querySelectorAll<HTMLElement>("#vitals .vital")].find((c) => c.dataset.k === k);
  chip?.click();
  const drop = m.doc.getElementById("vdrop") as HTMLElement;
  const out = {
    shown: drop.classList.contains("show"),
    lead: drop.querySelector(".vsample")?.textContent ?? null,
    text: (drop.textContent ?? "").replace(/\s+/g, " "),
    doors: [...drop.querySelectorAll<HTMLAnchorElement>("a.btn")].map((a) => a.getAttribute("href") ?? ""),
  };
  drop.classList.remove("show");
  return out;
}

function healthRows(m: Booted): string[] {
  m.run("openDoor('health',{})");
  const card = m.doc.getElementById("moduleCard");
  const rows = [...(card?.querySelectorAll(".mrow") ?? [])].map((r) => (r.textContent ?? "").replace(/\s+/g, " ").trim());
  m.run("closeDoor()");
  return rows;
}

/** What `GET /api/map/chips` hands the shell, in the order the founder set. */
const PUSHED = [
  { id: "members", label: "Members", icon: "people", state: "live", value: "41", sub: "members",
    how: "Accounts in the village.", asOf: "", countedAt: "2026-10-02T12:00:00.000Z", link: "/team", source: "members" },
  { id: "food", label: "Food", icon: "food", state: "example", value: null, sub: "", how: "", asOf: "", countedAt: "", link: "", source: "none" },
  { id: "rain", label: "Rain", icon: "water", state: "manual", value: "1200mm", sub: "as of 1 Oct 2026",
    how: "Set by the founder in Village settings. True as of 1 Oct 2026.", asOf: "2026-10-01", countedAt: "", link: "/nowhere", source: "manual" },
  { id: "chip", label: "New chip", icon: "star", state: "example", value: null, sub: "", how: "", asOf: "", countedAt: "", link: "", source: "none" },
];

describe("the crown bar before the village has said anything", () => {
  let m: Booted;
  beforeAll(async () => {
    m = boot();
    await settle(200);
  });
  afterAll(() => m?.close());

  it("draws the five chips it has always drawn, each saying example in words", () => {
    const seen = bar(m);
    expect(seen.map((c) => c.k)).toEqual(["people", "food", "water", "canopy", "hearts"]);
    for (const c of seen) {
      expect(c.example, c.k).toBe(true);
      expect(c.vex, `${c.k}: the word under the number`).toBe("example");
      expect(c.label, `${c.k}: the word beside the label`).toMatch(/ · example$/);
      expect(c.aria, `${c.k}: and to a screen reader`).toMatch(/, example\. The founder has not set this yet$/);
    }
    expect(seen.map((c) => c.value)).toEqual(["24", "62kg", "96", "76%", "132"]);
  });

  it("leads each reading with the word, and names no sample anywhere", () => {
    const people = dropFor(m, "people");
    expect(people.shown).toBe(true);
    expect(people.lead).toBe("Example. The founder has not set this chip yet.");
    expect(people.text).not.toMatch(/sample/i);
  });

  it("shows the word on the chip at every width, the labels' own rule turned around", () => {
    // jsdom applies no stylesheet, so this reads the rules themselves: where
    // a rule hides the small label, a rule beside it shows the word.
    expect(html).toContain("#vitals:not([data-fit]) .vital .vex{display:block}");
    expect(html).toContain('#vitals:is([data-fit="1"],[data-fit="2"],[data-fit="3"]) .vital .vex{display:block}');
    expect(html).toContain("body.pocket #vitals .vital .vex{display:block}");
    // Out of the flow, across the chip's own bottom edge: it may cost the bar
    // height, never width. In the flow it pushed a phone's bar 43px off each
    // side (measured in Chromium at 390px; jsdom lays nothing out).
    expect(html).toMatch(/\.vital \.vex\{display:none;position:absolute;left:0;right:0;bottom:3px;/);
    expect(html).not.toContain('.vital[data-tip$="sample"]');
  });

  it("threw nothing", () => {
    expect(m.uncaught).toEqual([]);
  });
});

describe("the crown bar once the village has pushed its chips", () => {
  let m: Booted;
  beforeAll(async () => {
    m = boot();
    await settle(200);
    m.post({ type: "chips", chips: PUSHED });
    await settle(20);
  });
  afterAll(() => m?.close());

  it("draws exactly the founder's chips, in the founder's order, with the moon after them", () => {
    expect(bar(m).map((c) => c.k)).toEqual(["members", "food", "rain", "chip"]);
    const ks = [...m.doc.querySelectorAll<HTMLElement>("#vitals .vital")].map((c) => c.dataset.k);
    expect(ks[ks.length - 1]).toBe("moon");
  });

  it("drops the example from a chip that reads something, and keeps it on the rest", () => {
    const [members, food, rain, chip] = bar(m);
    expect(members).toMatchObject({ value: "41", example: false, vex: null, label: "Members" });
    expect(members.aria).toBe("Members: 41, counted by the village");
    expect(rain).toMatchObject({ value: "1200mm", example: false, vex: null });
    expect(rain.aria).toBe("Rain: 1200mm, set by the founder");
    // An unset chip the map has its own number for keeps that number.
    expect(food).toMatchObject({ value: "62kg", example: true, vex: "example" });
    // One it has nothing for says so without inventing a figure.
    expect(chip).toMatchObject({ value: "?", example: true, vex: "example" });
  });

  it("draws each chip's own icon from the same table the editor shows", () => {
    const [members, food, rain, chip] = bar(m);
    expect(members.icon).toBe(CHIP_ICON_PATHS.people);
    expect(food.icon).toBe(CHIP_ICON_PATHS.food);
    expect(rain.icon).toBe(CHIP_ICON_PATHS.water);
    expect(chip.icon).toBe(CHIP_ICON_PATHS.star);
    expect(m.run<string>("JSON.stringify(VICON)")).toBe(JSON.stringify(CHIP_ICON_PATHS));
  });

  it("opens a live reading with what it counts and the founder's door, and no example", () => {
    const members = dropFor(m, "members");
    expect(members.lead).toBeNull();
    expect(members.text).toContain("Accounts in the village.");
    expect(members.text).toContain("counted live");
    // siteHref puts the site's own origin in front, so the page is the tail.
    expect(members.doors.some((d) => d.endsWith("/team"))).toBe(true);
  });

  it("draws no door to a page the site does not serve", () => {
    const rain = dropFor(m, "rain");
    expect(rain.doors.some((d) => d.includes("nowhere"))).toBe(false);
    expect(rain.text).toContain("True as of 1 Oct 2026");
  });

  it("keeps the Village Health door in step with the bar", () => {
    const rows = healthRows(m);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("Members");
    expect(rows[0]).toContain("41");
    expect(rows[0]).not.toContain("example");
    expect(rows[1]).toContain("example");
  });

  it("leaves the bar alone when the same chips arrive again", () => {
    // The shell asks every minute; an identical answer must not rebuild the
    // bar under somebody's pointer.
    const before = m.doc.querySelector("#vitals .vital");
    m.post({ type: "chips", chips: PUSHED });
    expect(m.doc.querySelector("#vitals .vital")).toBe(before);
  });

  it("moves an open reading to the new number, and drops the word once a chip is set", () => {
    const chip = [...m.doc.querySelectorAll<HTMLElement>("#vitals .vital")].find((c) => c.dataset.k === "food");
    chip?.click();
    const next = PUSHED.map((c) =>
      c.id === "food" ? { ...c, state: "live", value: "18kg", sub: "harvest recorded", how: "Harvest weighed and recorded in Village Health." } : c,
    );
    m.post({ type: "chips", chips: next });
    const drop = m.doc.getElementById("vdrop") as HTMLElement;
    expect(drop.classList.contains("show"), "the reading stays open").toBe(true);
    expect(drop.textContent).toContain("18kg");
    expect(drop.querySelector(".vsample")).toBeNull();
    drop.classList.remove("show");
    expect(bar(m).find((c) => c.k === "food")).toMatchObject({ value: "18kg", example: false, vex: null });
  });

  it("looks a founder's own id up in no table, so an id every object answers to is still just a chip", () => {
    // "constructor" passes the server's id rule, and Object.prototype has one.
    m.post({ type: "chips", chips: [{ ...PUSHED[3], id: "constructor", icon: "toString" }] });
    const [c] = bar(m);
    expect(c).toMatchObject({ k: "constructor", value: "?", example: true, icon: CHIP_ICON_PATHS.star });
    const drop = dropFor(m, "constructor");
    expect(drop.lead).toBe("Example. The founder has not set this chip yet.");
    expect(drop.text).not.toContain("[object");
    expect(drop.text).not.toContain("undefined");
  });

  it("draws a founder's words as words, never as markup", () => {
    m.post({ type: "chips", chips: [{ ...PUSHED[0], label: '<img src=x onerror="window.__hit=1">', value: "<b>9</b>" }] });
    expect(m.doc.querySelector("#vitals img")).toBeNull();
    expect(bar(m)[0].value).toBe("<b>9</b>");
  });

  it("threw nothing", () => {
    expect(m.uncaught).toEqual([]);
  });
});
