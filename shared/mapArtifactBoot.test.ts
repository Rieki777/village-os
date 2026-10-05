/**
 * THE LIVING MAP ARTIFACT RUNS TO ITS LAST LINE, ON EVERY ADDRESS THE SHELL BUILDS.
 *
 * On 2026-10-01 every visit to /map showed the HUD standing over a land that
 * never painted, and an empty minimap. #399 had the shell show its own Enter
 * the Land gate and open the artifact with `#skipIntro`. The artifact answered
 * at the bottom of its boot script by calling leaveIntro() one line ABOVE
 * `$('enterBtn').onclick=`. Leaving the intro removes #introCard, the button
 * lives inside that card, so the assignment threw "Cannot set properties of
 * null (setting 'onclick')" and the script stopped before its last line,
 * `requestAnimationFrame(frame)`. The loop that paints the land never started.
 *
 * Every gate was green, because nothing in `pnpm test` RAN this file.
 * mapArtifactHandoff.test.ts compiles each inline script with vm.Script, and
 * a TypeError at runtime compiles fine. The component tests mount the shell,
 * and the shell's iframe never loads in jsdom. So this file loads the real
 * artifact into jsdom with its scripts switched on, at the address the shell
 * builds, lets its timers run for a second, and checks three things per case:
 *
 *   1. Nothing it ran threw. Errors are collected from the window's own
 *      `error` events and from jsdom's virtual console, before any script runs.
 *   2. The boot reached its last line and the paint loop turned over. Every
 *      function handed to requestAnimationFrame is recorded by name. The boot
 *      tail is the only caller that schedules `frame` before `frame` has run,
 *      and `frame` schedules itself again as its own last statement, so two
 *      `frame` entries mean the boot finished AND one whole frame completed.
 *   3. The intro did what the address asked. With `skipIntro` the card is
 *      gone and the token is out of the address. Without it the card and the
 *      button stand, and pressing the button enters the land.
 *
 * WHAT IS STUBBED, AND WHY NOTHING ELSE IS. jsdom has no canvas, no Path2D,
 * no matchMedia, no ResizeObserver and no IntersectionObserver. The stubs
 * below supply those and nothing more: every drawing call does nothing,
 * measureText reports 0px, pixel reads return a correctly sized buffer of
 * zeros. The intro card, the Enter button, the hash router and the frame loop
 * all run exactly as written. A call jsdom does not implement is listed in the
 * failure message apart from the errors, so a gap in these stubs is named as
 * one.
 *
 * WHAT THIS CANNOT SEE. Pixels. Every draw is a no-op here, so a frame that
 * paints the wrong thing, or paints nothing, still passes. This guard proves
 * the land's loop RUNS. Whether it draws is a question for a real browser
 * (Playwright counting distinct canvas colours is how the 2026-10-01 fix was
 * verified). It also loads the artifact standalone, outside the shell, so the
 * shell's side of the handshake is out of its sight.
 *
 * AND IT CANNOT SEE A SCROLL. jsdom lays nothing out: every box measures zero,
 * and nothing ever scrolls unless a script sets scrollLeft by hand. So the
 * 400 px slide of the whole map that an item link caused on a desk (focusItem
 * called scrollIntoView while #panel was still parked off the edge, and the
 * browser scrolled the document to reach the row) is invisible here. What this
 * file CAN see is the two ends of it, and that is all the item case and the
 * last block claim: the call that walked up to the document, which jsdom does
 * not implement and this file records, and the backstop that puts a scrolled
 * document back, driven by the scroll event a browser would have fired. That
 * the row still comes into view inside the panel, and that the map stays put,
 * were measured in Playwright at 1400 by 850, 1280 by 560 and 390 by 844.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ArtifactWindow, evalIn } from "./test/artifactWindow";

const ARTIFACT = path.resolve(__dirname, "../docs/prototypes/grounds-v0.html");
const html = fs.readFileSync(ARTIFACT, "utf8");

/* jsdom ships no type declarations and this repo carries no @types/jsdom, so
   this file declares the slice of its API it uses. One test does not earn a
   new dependency. */
interface JsdomReport extends Error {
  type?: string;
  cause?: unknown;
}
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
  VirtualConsole: new () => { on(event: "jsdomError", listener: (e: JsdomReport) => void): void };
}
const { JSDOM, VirtualConsole } = createRequire(import.meta.url)("jsdom") as Jsdom;

/** A desk wide enough that the artifact picks its desk profile on its own. */
const DESK = { width: 1440, height: 900 };
/** The phone the pocket profile was measured on. */
const PHONE = { width: 390, height: 844 };
/** A place the artifact's own scene carries. The deep-link case checks the
    panel really opened, so a renamed place fails here by name. A missing key
    would otherwise only raise the artifact's "no longer on the map" toast. */
const PLACE = "greenhouse";
/** A quest the scene puts at PLACE, addressed the way itemAddr() builds it. */
const ITEM = "quest:plant-the-dry-season-beds";
/** Long enough for every boot timer to fire: the deep-link router waits
    400ms and the pocket welcome 700ms. */
const SETTLE_MS = 1000;

const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** An object whose unknown members are functions that do nothing. */
function inert<T extends object>(known: T): T {
  return new Proxy(known, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      return typeof key === "symbol" ? undefined : () => undefined;
    },
  });
}

function pixels(width: number, height: number) {
  const w = Math.max(0, Math.floor(width) || 0);
  const h = Math.max(0, Math.floor(height) || 0);
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

function context2d(canvas: HTMLCanvasElement) {
  const paint = () => ({ addColorStop() {} });
  return inert({
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    filter: "none",
    imageSmoothingEnabled: true,
    measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => pixels(w, h),
    createImageData: (w: number | { width: number; height: number }, h?: number) =>
      typeof w === "object" ? pixels(w.width, w.height) : pixels(w, h ?? 0),
    createLinearGradient: paint,
    createRadialGradient: paint,
    createConicGradient: paint,
    createPattern: () => ({ setTransform() {} }),
    getLineDash: () => [],
    isPointInPath: () => false,
    isPointInStroke: () => false,
  });
}

/** What jsdom lacks, and only that. */
function stubTheMissingPlatform(window: ArtifactWindow) {
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(this: HTMLCanvasElement, kind: string) {
      return kind === "2d" ? context2d(this) : null;
    },
  });
  class Path2D {
    constructor() {
      return inert({});
    }
  }
  class Unobserved {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.assign(window, {
    Path2D,
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
  /** Everything the artifact threw, from load until now. */
  uncaught: string[];
  /** Platform calls jsdom answered with "not implemented". */
  missing: string[];
  /** The name of every function handed to requestAnimationFrame, in order. */
  scheduled: string[];
  /** Every element handed to scrollIntoView, by its data-item or id. */
  scrolledIntoView: string[];
  /** State read the moment the scripts finished, before any timer fired. */
  atLoad: { scheduledFrame: boolean; introCard: boolean; enterBtn: boolean; onclick: string; hash: string };
}

function describeError(e: unknown): string {
  if (e instanceof Error || (e && typeof e === "object" && "message" in e)) {
    const err = e as Error;
    const at = (err.stack ?? "").split("\n").find((l) => l.includes("grounds/index.html"));
    return `${err.name}: ${err.message}${at ? ` (${at.trim()})` : ""}`;
  }
  return String(e);
}

function boot(hash: string, viewport: { width: number; height: number }): Booted {
  const thrown = new Set<unknown>();
  const missing: string[] = [];
  const scheduled: string[] = [];
  const scrolledIntoView: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => {
    if (e.type === "not-implemented") missing.push(e.message);
    else if (e.type === "unhandled-exception") thrown.add(e.cause ?? e);
  });

  const { window } = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: `http://localhost/grounds/index.html${hash}`,
    virtualConsole,
    beforeParse(w) {
      w.addEventListener("error", (ev) => thrown.add(ev.error ?? ev.message));
      Object.assign(w, { innerWidth: viewport.width, innerHeight: viewport.height });
      stubTheMissingPlatform(w);
      const raf = w.requestAnimationFrame.bind(w);
      w.requestAnimationFrame = (cb: FrameRequestCallback) => {
        scheduled.push(cb.name);
        return raf(cb);
      };
      // jsdom has no scrollIntoView. Recorded, so a call is a fact this file
      // can assert on, and not a TypeError that would fail it for jsdom's sake.
      w.Element.prototype.scrollIntoView = function (this: Element) {
        scrolledIntoView.push((this as HTMLElement).dataset?.item || this.id || this.tagName);
      };
    },
  });

  const enterBtn = window.document.getElementById("enterBtn");
  return {
    window,
    get uncaught() {
      return [...thrown].map(describeError);
    },
    missing,
    scheduled,
    scrolledIntoView,
    atLoad: {
      scheduledFrame: scheduled.includes("frame"),
      introCard: !!window.document.getElementById("introCard"),
      enterBtn: !!enterBtn,
      onclick: typeof enterBtn?.onclick,
      hash: window.location.hash,
    },
  };
}

const framesScheduled = (b: Booted) => b.scheduled.filter((n) => n === "frame").length;
const missingNote = (b: Booted) =>
  b.missing.length ? ` (jsdom also reported, not implemented: ${b.missing.join("; ")})` : "";

interface Case {
  name: string;
  hash: string;
  viewport: { width: number; height: number };
  pocket: boolean;
  /** null: the intro stays. A string: the intro is skipped and this is the address left behind. */
  skipsTo: string | null;
}

const CASES: Case[] = [
  { name: "a standalone desk load, no hash", hash: "", viewport: DESK, pocket: false, skipsTo: null },
  { name: "the shell's gate on a desk, #skipIntro", hash: "#skipIntro", viewport: DESK, pocket: false, skipsTo: "" },
  {
    name: `a deep link through the gate, #/place/${PLACE}&skipIntro`,
    hash: `#/place/${PLACE}&skipIntro`,
    viewport: DESK,
    pocket: false,
    skipsTo: `#/place/${PLACE}`,
  },
  {
    name: `an item link through the gate, #/place/${PLACE}?item=${ITEM}&skipIntro`,
    hash: `#/place/${PLACE}?item=${ITEM}&skipIntro`,
    viewport: DESK,
    pocket: false,
    skipsTo: `#/place/${PLACE}?item=${ITEM}`,
  },
  {
    name: "the gate on a phone, #hud=pocket&skipIntro",
    hash: "#hud=pocket&skipIntro",
    viewport: PHONE,
    pocket: true,
    skipsTo: "#hud=pocket",
  },
];

it("the artifact is the file the shell mounts, scheduled the way this guard assumes (the positive control)", () => {
  // Every case below is about this file. If it stops looking like the map,
  // they would pass or fail for the wrong reason. Fail here instead.
  expect(html.length).toBeGreaterThan(100_000);
  expect(html).toContain('id="introCard"');
  expect(html).toContain('id="enterBtn"');
  // Check 2 reads "frame was scheduled" as "the boot reached its last line".
  // That holds only while exactly two places schedule it: the boot's last
  // statement and frame's own. A third, earlier call would make it pass on a
  // boot that died halfway, so pin the count and both places.
  const calls = html.match(/requestAnimationFrame\(frame\)\s*[;}]/g) ?? [];
  expect(calls.length, "call sites of requestAnimationFrame(frame)").toBe(2);
  expect(html, "frame's last statement schedules the next frame").toMatch(
    /requestAnimationFrame\(frame\)\}\s*<\/script>/,
  );
  expect(html, "the boot's last statement starts the loop").toMatch(
    /requestAnimationFrame\(frame\);[^\n]*\n<\/script>\s*<\/body>/,
  );
});

describe.each(CASES)("the living map artifact, booted as $name", (c) => {
  let b: Booted;
  beforeAll(async () => {
    b = boot(c.hash, c.viewport);
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.window.close());

  it("throws nothing while it boots and settles", () => {
    expect(b.uncaught, `uncaught errors${missingNote(b)}`).toEqual([]);
  });

  it("reaches its last line and the paint loop turns over", () => {
    expect(b.atLoad.scheduledFrame, "the boot's last line, requestAnimationFrame(frame), ran").toBe(true);
    expect(framesScheduled(b), "one whole frame ran and scheduled the next").toBeGreaterThanOrEqual(2);
  });

  it(`picks the ${c.pocket ? "pocket" : "desk"} profile (the case is the one it says it is)`, () => {
    expect(b.window.document.body.classList.contains("pocket")).toBe(c.pocket);
  });

  if (c.skipsTo === null) {
    it("keeps the intro, with the Enter button wired", () => {
      expect(b.atLoad.introCard, "#introCard at load").toBe(true);
      expect(b.atLoad.enterBtn, "#enterBtn at load").toBe(true);
      expect(b.atLoad.onclick, "enterBtn.onclick at load").toBe("function");
      // On a desk, only the visitor leaves the intro.
      const doc = b.window.document;
      expect(doc.getElementById("introCard"), "#introCard after the timers ran").not.toBeNull();
      expect(doc.body.classList.contains("intro")).toBe(true);
    });

    it("enters the land when the Enter button is pressed", async () => {
      const doc = b.window.document;
      const enter = doc.getElementById("enterBtn");
      expect(enter, "#enterBtn to press").not.toBeNull();
      enter?.click();
      expect(doc.body.classList.contains("intro"), "the intro class leaves on the press").toBe(false);
      const before = framesScheduled(b);
      await settle(300);
      expect(b.uncaught, `uncaught errors after pressing Enter${missingNote(b)}`).toEqual([]);
      expect(framesScheduled(b), "the loop kept turning through the glide in").toBeGreaterThan(before);
    });
  } else {
    const left = c.skipsTo;
    it("skips the intro and takes the token out of the address", () => {
      expect(b.atLoad.introCard, "#introCard at load").toBe(false);
      expect(b.atLoad.hash, "the address the moment the scripts finished").toBe(left);
      expect(b.window.document.body.classList.contains("intro")).toBe(false);
      expect(b.window.location.hash, "the address after the timers ran").toBe(left);
    });
  }

  if (c.hash.startsWith("#/place/")) {
    it("still lands on the place the link names", () => {
      expect(b.window.document.getElementById("panel")?.classList.contains("open"), `the ${PLACE} panel opened`).toBe(
        true,
      );
    });
  }

  if (c.hash.includes("?item=")) {
    it("lights the row the link names, and hands no element to scrollIntoView", () => {
      const doc = b.window.document;
      const lit = [...doc.querySelectorAll<HTMLElement>("#panelBody .itemfocus")].map((n) => n.dataset.item);
      expect(lit, "the rows lit in the panel").toEqual([ITEM]);
      // scrollIntoView walks every scrollable ancestor up to the document, and
      // it runs while #panel is still sliding in from off the edge, so on a
      // desk it slid the whole map 400 px left and kept it there.
      expect(b.scrolledIntoView, "elements handed to scrollIntoView while the panel opened").toEqual([]);
    });
  }
});

/* THE BACKSTOP. The artifact's document is pinned at 0,0, because closed
   panels hang past the edges and anything that brings one of their elements
   into view (keyboard focus among them) can scroll the page that a person
   cannot. jsdom never scrolls on its own and never fires the event, so these
   set the offsets by hand and send the scroll event a browser would send. */
describe("the living map artifact's document stays at 0,0", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.window.close());

  const offsets = (el: Element) => [el.scrollLeft, el.scrollTop];
  const scrollAndFire = (el: Element, left: number, top: number) => {
    el.scrollLeft = left;
    el.scrollTop = top;
    const doc = b.window.document;
    (el === doc.documentElement ? doc : el).dispatchEvent(new b.window.Event("scroll"));
  };

  it("puts a scrolled document and a scrolled body straight back", () => {
    const doc = b.window.document;
    // The positive control: offsets set here stick unless something answers them.
    doc.documentElement.scrollLeft = 1;
    expect(doc.documentElement.scrollLeft, "jsdom keeps a scroll offset set by hand").toBe(1);
    scrollAndFire(doc.documentElement, 400, 120);
    expect(offsets(doc.documentElement), "the document after a scroll event").toEqual([0, 0]);
    scrollAndFire(doc.body, 420, 692);
    expect(offsets(doc.body), "the body after a scroll event").toEqual([0, 0]);
    expect(b.uncaught, `uncaught errors${missingNote(b)}`).toEqual([]);
  });

  it("lets a text field keep the page lifted while it has focus, and brings it down after", async () => {
    const doc = b.window.document;
    const field = doc.getElementById("maiaText") as HTMLInputElement | null;
    expect(field, "#maiaText to focus").not.toBeNull();
    field?.focus();
    expect(doc.activeElement, "the field has focus").toBe(field);
    scrollAndFire(doc.documentElement, 400, 120);
    expect(offsets(doc.documentElement), "sideways goes back, the lift stays for the keyboard").toEqual([0, 120]);
    field?.blur();
    await settle(20);
    expect(offsets(doc.documentElement), "the page comes down once the field lets go").toEqual([0, 0]);
  });
});

/* BUILD MODE IS VISIBLE TO THE TWO READERS THAT ASK THROUGH window.buildModeOn.
   The line that defined it sat on the end of a `//` comment, so it was part
   of the comment and never ran, and a blueprint's drawn footprint and its
   flows vanished in build mode the moment they were deselected. Nothing threw
   and every other check here stayed green, because both readers guard with
   `window.buildModeOn&&`. A comment cannot swallow the line again without
   this failing. */
describe("build mode, as the blueprint footprint and flow readers see it", () => {
  let b: Booted;
  const read = <T,>(js: string): T => evalIn<T>(b.window, js);
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.window.close());

  it("is answered by window.buildModeOn, which follows the Build button", () => {
    expect(read<string>("typeof window.buildModeOn")).toBe("function");
    expect(read<boolean>("window.buildModeOn()")).toBe(false);
    b.window.document.getElementById("buildBtn")?.click();
    expect(read<boolean>("window.buildModeOn()")).toBe(true);
    b.window.document.getElementById("buildBtn")?.click();
    expect(read<boolean>("window.buildModeOn()")).toBe(false);
    expect(b.uncaught, `uncaught errors${missingNote(b)}`).toEqual([]);
  });
});

/**
 * NO WALK UNTIL THE VILLAGE WRITES ONE, AND NEVER THE EXAMPLE.
 *
 * Rye, 2026-10-01: "Get rid of the maia walkthrough for now, it's not great,
 * we'll have to make one." Then 2026-10-02: "Onboarding is something that
 * founders should do and really personalize and put their spirit into it.
 * So just add this to a journey to launch that's suggested remove the
 * example journey for now." The artifact asks welcomeWalkOn() at every door
 * into the walk, and it answers yes only for a walk the village wrote. This
 * boots the map as a village that has written none, which is every map
 * opened standalone, and pins that nothing is offered, the way
 * mapArtifactHandoff.test.ts pins its own decision: the artifact is
 * regenerated as one enormous file, and a regeneration that quietly put the
 * seed's walk back would otherwise ship with nobody noticing. What a written
 * walk does is in mapArtifactWelcomeWalk.test.ts.
 *
 * The other journeys walk on the same engine, so the control below plays one
 * of them. A guard that switched the whole engine off would pass every check
 * about the walk and fail that one.
 */
describe("the Welcome Walk, until the village writes one (Rye, 2026-10-01 and 2026-10-02)", () => {
  const read = <T,>(b: Booted, js: string): T => evalIn<T>(b.window, js);

  describe("on a desk", () => {
    let b: Booted;
    beforeAll(async () => {
      b = boot("#skipIntro", DESK);
      await settle(SETTLE_MS);
    });
    afterAll(() => b?.window.close());

    it("is off, names no newcomer's journey, and the scene still carries the example as data", () => {
      expect(read<boolean>(b, "welcomeWalkOn()")).toBe(false);
      expect(read<string | null>(b, "welcomeJourney()")).toBeNull();
      expect(read<string | undefined>(b, "(jById('j1')||{}).name"), "the example is still in the scene").toBe("The Welcome Walk");
    });

    it("leaves Maia's dock without the tour chip, and keeps her other two", () => {
      const doc = b.window.document;
      expect(doc.querySelector('#maiaActions .chip[data-say="tour"]')).toBeNull();
      expect(doc.querySelectorAll("#maiaActions .chip").length, "Where can I help? and What's alive?").toBe(2);
    });

    it("does not start from startTour(), the t key, or a request to be shown around", async () => {
      read(b, "startTour()");
      b.window.document.dispatchEvent(new b.window.KeyboardEvent("keydown", { key: "t", bubbles: true }));
      read(b, "conciergeMatch('show me around')");
      await settle(300);
      expect(read<unknown>(b, "JWALK"), "no walk is running").toBeNull();
      expect(b.uncaught).toEqual([]);
    });

    it("is not offered by the Journeys door, which still offers the other journeys", () => {
      const door = read<string>(b, "MODULES.journeys.sample({})");
      expect(door).not.toContain("The Welcome Walk");
      expect(door).toContain("Resident Journey");
    });

    it("still plays the other journeys (the control: the engine itself is on)", async () => {
      read(b, "playJourney('j2')");
      await settle(200);
      expect(read<{ id: string } | null>(b, "JWALK")?.id, "the Resident Journey is walking").toBe("j2");
      read(b, "jEnd()");
      expect(read<unknown>(b, "JWALK")).toBeNull();
    });
  });

  describe("from an old #/journey/ address", () => {
    let b: Booted;
    beforeAll(async () => {
      b = boot("#/journey/j1&skipIntro", DESK);
      // The router waits 400ms and then hands a journey another 500ms.
      await settle(SETTLE_MS + 600);
    });
    afterAll(() => b?.window.close());

    it("lands on the map with no walk running and the address cleared", () => {
      expect(read<unknown>(b, "JWALK")).toBeNull();
      expect(b.window.location.hash).toBe("");
      expect(b.uncaught).toEqual([]);
    });
  });

  describe("on a phone", () => {
    let b: Booted;
    beforeAll(async () => {
      b = boot("#hud=pocket&skipIntro", PHONE);
      await settle(SETTLE_MS);
    });
    afterAll(() => b?.window.close());

    it("shows no Take the walk offer and no drawer cell for it", () => {
      const doc = b.window.document;
      expect(doc.getElementById("gresume")?.classList.contains("on"), "the walk offer").toBe(false);
      read(b, "renderDrawer()");
      expect(doc.querySelector('#pdrawer [data-pa="walk"]'), "Take the walk again").toBeNull();
      expect(doc.querySelector('#pdrawer [data-pa="exit"]'), "the drawer still renders its other cells").not.toBeNull();
    });

    it("welcomes the visitor without offering the walk", () => {
      const log = b.window.document.getElementById("maiaLog")?.textContent ?? "";
      expect(log).toContain("Welcome to the living map");
      expect(log).not.toContain("Take the walk");
    });
  });
});
