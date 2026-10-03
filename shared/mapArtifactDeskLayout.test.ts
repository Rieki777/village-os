/**
 * TWO DESK-LAYOUT DECISIONS THE LIVING MAP MAKES, PLAYED WITH THE GEOMETRY A BROWSER MEASURED.
 *
 * 1. THE TOP ROW. The stat bar stood centred on the window while the buttons
 *    at each end of the row stood where their own rules put them. At every
 *    desk width from 1024 to 1536 a button covered part of it: at 1400x850 The
 *    Loom sat on the village name, Your view sat on the Hearts number, and a
 *    real click on the moon opened Your view. topFit() now reads what stands
 *    at each end of the row, tries the bar's steps on until one fits, and puts
 *    the bar on a row of its own when none does.
 *
 * 2. A DISTRICT PLATE OVER A BUILDING. At the arrival camera four district
 *    plates sat on a building's own click box, so a click on the Welcome
 *    Lodge, the Ponds, the Kitchen or Ridge Hamlet North flew the camera and
 *    opened nothing. A plate now hands the click to a building under it.
 *
 * WHAT THIS CAN SEE AND WHAT IT CANNOT. jsdom lays nothing out: every box
 * measures zero and elementsFromPoint does not exist. So these cases hand the
 * artifact the rects Chromium measured at each window size (scratchpad
 * rects.cjs, read through the real page) and the stack a real click lands in,
 * and assert what the artifact DECIDES from them. Whether the CSS then draws
 * the bar at those widths, and whether the button in question is really on
 * top, was measured in Playwright through the shell at 1280x720, 1366x768,
 * 1400x850, 1536x864 and 1920x1080. A third fix in the same change, What
 * needs hands stepping aside with Maia while a panel is open, is pure CSS
 * geometry and has no decision for jsdom to see, so it is not here.
 *
 * The platform stubs mirror mapArtifactBoot.test.ts, which says why each one
 * exists.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  uncaught: unknown[];
  run<T>(src: string): T;
  close(): void;
}

function boot(viewport: { width: number; height: number }): Booted {
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
      Object.assign(w, { innerWidth: viewport.width, innerHeight: viewport.height });
      stubTheMissingPlatform(w);
    },
  });
  return { window, uncaught, run: <T,>(src: string) => window.eval(src) as T, close: () => window.close() };
}

/** left, top, width, height, as Chromium reported them. */
type Box = [number, number, number, number];
interface Desk {
  size: { width: number; height: number };
  boxes: Record<string, Box>;
  /** The bar's width and height at each of its four steps. */
  steps: Record<0 | 1 | 2 | 3, [number, number]>;
  expect: { fit: string; row: string | null; vx: string; vy: string };
}

/* Read from Chromium 1243 through the real page at each size, with every
   non-GET aborted. The buttons do not move between sizes except by the
   window's right edge, and the bar's steps are the same at every size. */
const STEPS: Desk["steps"] = { 0: [689.5, 46], 1: [617, 46], 2: [498.4, 36], 3: [379.1, 35] };
const left = (w: number): Record<string, Box> => ({
  topNav: [14, 14, 454.2, 31],
  themeBtn: [w - 469.9, 10, 113.9, 32],
  dayBtn: [w - 340.7, 10, 38.7, 32],
  layers: [w - 296.9, 10, 284.9, 30],
  dock: [w - 50, 52, 38, 302],
  buildBtn: [14, 52, 120.5, 44],
});
const DESKS: Desk[] = [
  /* Nothing fits between the buttons: the smallest bar with a name is 498px
     and the span is 326px. It takes its own row under them, name and all. */
  { size: { width: 1280, height: 720 }, boxes: left(1280), steps: STEPS, expect: { fit: "2", row: "2", vx: "640px", vy: "51px" } },
  /* The name goes before the row does, the order the old breakpoints shed in. */
  { size: { width: 1366, height: 768 }, boxes: left(1366), steps: STEPS, expect: { fit: "3", row: null, vx: "683px", vy: "0px" } },
  { size: { width: 1400, height: 850 }, boxes: left(1400), steps: STEPS, expect: { fit: "3", row: null, vx: "700px", vy: "0px" } },
  /* The old breakpoint showed the labels here, and the moon went under Your view. */
  { size: { width: 1536, height: 864 }, boxes: left(1536), steps: STEPS, expect: { fit: "2", row: null, vx: "768px", vy: "0px" } },
  { size: { width: 1920, height: 1080 }, boxes: left(1920), steps: STEPS, expect: { fit: "0", row: null, vx: "960px", vy: "0px" } },
];

/** Every element measures what Chromium measured, and the bar measures its current step. */
function playGeometry(b: Booted, d: Desk) {
  const w = b.window;
  Object.assign(w, { innerWidth: d.size.width, innerHeight: d.size.height });
  const rect = (x: number, y: number, width: number, height: number) =>
    ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON() {} }) as DOMRect;
  w.Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.id === "vitals") {
      const [bw, bh] = d.steps[Number(this.dataset.fit ?? 0) as 0 | 1 | 2 | 3];
      return rect(0, 0, bw, bh);
    }
    const box = d.boxes[this.id];
    return box ? rect(...box) : rect(0, 0, 0, 0);
  };
}

describe("the top row on a desk: the stat bar fits between the buttons, or takes its own row", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot({ width: 1400, height: 850 });
    await settle(300);
  });
  afterAll(() => b?.close());

  it("has a fit to run (the positive control: the artifact this file reads is the fixed one)", () => {
    expect(b.run<string>("typeof topFit"), "window.topFit").toBe("function");
    expect(b.window.document.body.classList.contains("pocket"), "a desk profile").toBe(false);
  });

  it.each(DESKS)("at $size.width x $size.height", (d) => {
    playGeometry(b, d);
    b.run("topFit()");
    const vit = b.window.document.getElementById("vitals") as HTMLElement;
    const root = b.window.document.documentElement.style;
    expect(
      { fit: vit.dataset.fit, row: vit.dataset.row ?? null, vx: root.getPropertyValue("--top-vx"), vy: root.getPropertyValue("--top-vy") },
      "the step, the row and where the bar stands",
    ).toEqual(d.expect);
    expect(b.uncaught).toEqual([]);
  });

  it("clears every trace of itself on a pocket, so the strip's own rules apply", () => {
    playGeometry(b, DESKS[0]);
    b.run("topFit()");
    const doc = b.window.document;
    const vit = doc.getElementById("vitals") as HTMLElement;
    expect(vit.dataset.row, "on its own row before the switch").toBe("2");
    doc.body.classList.add("pocket");
    b.run("topFit()");
    expect({ fit: vit.dataset.fit, row: vit.dataset.row }).toEqual({ fit: undefined, row: undefined });
    expect(doc.documentElement.style.getPropertyValue("--top-vx")).toBe("");
    expect(doc.documentElement.style.getPropertyValue("--top-vy")).toBe("");
    doc.body.classList.remove("pocket");
  });
});

/**
 * THE ARRIVAL CLEARS A BAR ON ITS OWN ROW (round 4 sweep). At 1280x720 the
 * bar takes row two, 51 px down, and the arrival camera (1440,670 at z 0.84)
 * was framed for a bar on row one: the Welcome Lodge and Pond Homes stood 6 of
 * 9 points under it, and a real click on either landed on the bar. Placing the
 * camera 50 world px lower in Chromium (42 screen px at z 0.84) left only the
 * Gate and one mark under the bar, as production's row-one bar does; a full
 * 51 px put New Food Forest under Maia's dock. This reads where the glide is
 * headed after topFit has decided, at sizes on each row.
 */
describe("the arrival camera, with the bar on its own row or not", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot({ width: 1400, height: 850 });
    await settle(300);
  });
  afterAll(() => b?.close());
  const headed = (d: Desk) => {
    playGeometry(b, d);
    b.run("topFit()");
    b.run("arriveOnLand()");
    const aim = b.run<{ x: number; y: number; z: number }>("({x:travel.tx,y:travel.ty,z:travel.tz})");
    b.run("travel=null");
    return { x: Math.round(aim.x), y: Math.round(aim.y), z: aim.z };
  };

  it("comes down by the bar's drop, up to 42 px on screen, when the bar takes row two", () => {
    const d = DESKS[0];
    expect(d.expect.row, "1280x720 puts the bar on row two (the case)").toBe("2");
    expect(headed(d)).toEqual({ x: 1440, y: 620, z: 0.84 });
  });

  it.each(DESKS.slice(1))("keeps the arrival where it was at $size.width x $size.height, with the bar on row one", (d) => {
    expect(d.expect.row).toBeNull();
    expect(headed(d)).toEqual({ x: 1440, y: 670, z: 0.84 });
  });

  it("does not move a pocket's arrival", () => {
    playGeometry(b, DESKS[0]);
    b.run("topFit()");
    b.window.document.body.classList.add("pocket");
    expect(b.run<number>("arrivalLift()")).toBe(0);
    b.window.document.body.classList.remove("pocket");
    expect(b.uncaught).toEqual([]);
  });
});

describe("a district plate over a building hands the click to the building", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot({ width: 1440, height: 900 });
    await settle(300);
  });
  afterAll(() => b?.close());

  /** The Kitchen, under its own district's plate, as it is at the arrival camera. */
  const KEY = "kitchen";
  const plateOf = () => b.run<(key: string) => HTMLElement>("(k=>bEls['d_'+BY[k].district])")(KEY);
  const poi = () => b.window.document.querySelector<HTMLElement>(`.poi[data-k="${KEY}"]`) as HTMLElement;
  const reset = () => b.run("if(panelKey)document.getElementById('panelClose').click();travel=null;panelKey=null");
  /** A real click on the plate, landing in the stack a browser would report there. */
  const clickPlate = (stack: Element[]) => {
    const plate = plateOf();
    Object.assign(b.window.document, { elementsFromPoint: () => [plate, ...stack] });
    plate.dispatchEvent(new b.window.MouseEvent("click", { bubbles: true, clientX: 602, clientY: 338 }));
  };

  it("is clicking a plate whose district names the building (the positive control)", () => {
    const plate = plateOf();
    expect(plate?.classList.contains("district"), "a district plate").toBe(true);
    expect(poi(), "the building's own click box").not.toBeNull();
  });

  it("opens the building when its click box is under the plate", () => {
    reset();
    const art = poi().firstElementChild ?? poi();
    clickPlate([art, poi(), b.window.document.getElementById("scene") as Element]);
    expect(b.run<string | null>("panelKey"), "the panel that opened").toBe(KEY);
    expect(b.window.location.hash).toBe(`#/place/${KEY}`);
    expect(b.uncaught).toEqual([]);
  });

  it("still flies to the district when only the land is under the plate", () => {
    reset();
    clickPlate([b.window.document.getElementById("scene") as Element]);
    expect(b.run<string | null>("panelKey"), "no panel").toBeNull();
    expect(b.run<number | null>("travel&&travel.tz"), "the flight in to the district").toBe(1.05);
    expect(b.uncaught).toEqual([]);
  });
});
