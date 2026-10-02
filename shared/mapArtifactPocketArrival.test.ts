/**
 * A PHONE ARRIVES ON THE VILLAGE, AND ITS BOTTOM BAR, DRAWER AND PAD DO WHAT THEY SAY.
 *
 * Found by the 2026-10-01 QA sweep at 390x844 through the shell, every one of
 * them on production as well:
 *
 *   - The first screen was the beach and the road, with 1 of the 20 places the
 *     land draws inside it. The pocket keeps its camera still from the first
 *     frame and the camera's default is the desk intro's backdrop.
 *   - The bottom bar's first cell opened the circles drawn inside the artifact,
 *     whose names are 2 to 4 px tall, where the desk's Circles tab goes to
 *     /map/circles. From the Loom it went there too, not back to the land.
 *   - Switching to those circles left an open place sheet over 77% of them.
 *   - Over them, the pad zoomed and panned the land hidden underneath, two
 *     fingers panned instead of zooming, and one finger dragged at 35%.
 *   - No control on a phone reached the Vision, Org or Flows lenses or the
 *     time of day.
 *
 * Runs the real artifact in jsdom at the address the shell builds for a phone.
 * The platform stubs mirror mapArtifactBoot.test.ts, which says why each one
 * exists.
 *
 * WHAT IS MEASURED IN CHROMIUM AND HANDED IN HERE. jsdom lays nothing out, so
 * every box measures zero. The three boxes the code under test reads are given
 * the rectangles Chromium measured at 390x844 with the pocket profile: the
 * vitals strip ends at 35, the bottom bar starts at 784, and the circles chart
 * is 390x729 from y 115. Everything else (the camera, the viewBox, the classes,
 * the address, the handlers) is the artifact's own state, run as written.
 *
 * WHAT THIS CANNOT SEE. Pixels, the CSS cascade, and real fingers. Whether the
 * bar's label shows the right half, whether the land's hint leaves the chart's
 * heading, and whether a CDP pinch zooms were measured in Playwright at
 * 390x844, 360x640, 844x390 and 768x1024 against the shell.
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

const PHONE = { width: 390, height: 844 };
/** Chromium, 390x844, pocket profile. See the header. */
const MEASURED: Record<string, { left: number; top: number; width: number; height: number }> = {
  vitals: { left: 0, top: 0, width: 390, height: 35 },
  pbar: { left: 0, top: 784, width: 390, height: 60 },
  orgSvg: { left: 0, top: 115, width: 390, height: 729 },
};
/** Long enough for every boot timer: the pocket welcome waits 700ms. */
const SETTLE_MS = 1000;
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
  // The three measured boxes. Every other element keeps jsdom's zero box.
  const own = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function (this: Element) {
    const m = MEASURED[this.id];
    if (!m) return own.call(this);
    return { ...m, x: m.left, y: m.top, right: m.left + m.width, bottom: m.top + m.height, toJSON() {} } as DOMRect;
  };
}

interface Cam {
  x: number;
  y: number;
  z: number;
}
interface Booted {
  window: ArtifactWindow;
  uncaught: unknown[];
  /** The camera the moment the scripts finished: what the first frame paints. */
  camAtLoad: Cam;
  run<T>(src: string): T;
  close(): void;
}

function boot(hash = "#hud=pocket&skipIntro"): Booted {
  const uncaught: unknown[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => {
    if (e.type === "unhandled-exception") uncaught.push(e.cause ?? e);
  });
  const { window } = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: `http://localhost/grounds/index.html${hash}`,
    virtualConsole,
    beforeParse(w) {
      w.addEventListener("error", (ev) => uncaught.push(ev.error ?? ev.message));
      Object.assign(w, { innerWidth: PHONE.width, innerHeight: PHONE.height });
      stubTheMissingPlatform(w);
    },
  });
  const run = <T>(src: string) => window.eval(src) as T;
  return { window, uncaught, camAtLoad: run<Cam>("({x:cam.x,y:cam.y,z:cam.z})"), run, close: () => window.close() };
}

const body = (b: Booted) => b.window.document.body.classList;
const click = (b: Booted, sel: string) => {
  const el = b.window.document.querySelector<HTMLElement>(sel);
  expect(el, sel).not.toBeNull();
  el?.click();
};

describe("a phone arrives framed on the village (F05, F53)", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot();
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  it("is the pocket profile (the case is the one it says it is)", () => {
    expect(body(b).contains("pocket")).toBe(true);
    expect(b.uncaught).toEqual([]);
  });

  it("puts every place the land draws inside the strip between the vitals and the bottom bar", () => {
    // The camera's own arithmetic (worldToScreen, in CSS px), run on the
    // camera the first frame paints with.
    const places = b.run<{ key: string; x: number; y: number }[]>(
      "SCENE.structures.filter(s=>!(mode==='now'&&s.state==='blueprint')).map(s=>({key:s.key,x:s.x,y:s.y}))",
    );
    expect(places.length, "places the land draws in Now").toBeGreaterThan(10);
    const c = b.camAtLoad;
    const top = MEASURED.vitals.top + MEASURED.vitals.height;
    const bottom = MEASURED.pbar.top;
    const outside = places
      .map((p) => ({ key: p.key, sx: (p.x - c.x) * c.z + PHONE.width / 2, sy: (p.y - c.y) * c.z + PHONE.height / 2 }))
      .filter((p) => p.sx < 0 || p.sx > PHONE.width || p.sy < top || p.sy > bottom)
      .map((p) => `${p.key} at ${Math.round(p.sx)},${Math.round(p.sy)}`);
    expect(outside, `places off screen with the camera at ${c.x.toFixed(0)},${c.y.toFixed(0)} z ${c.z.toFixed(3)}`).toEqual(
      [],
    );
  });

  it("draws them at a zoom where the district names still show, on this phone", () => {
    // syncBanners draws a district's plate only while W*cam.z > 900.
    expect(b.camAtLoad.z * b.run<number>("W")).toBeGreaterThan(900);
  });

  it("frames them before the first frame, so the camera has not moved since", () => {
    const now = b.run<Cam>("({x:cam.x,y:cam.y,z:cam.z})");
    expect(now).toEqual(b.camAtLoad);
  });
});

describe("the bottom bar's first cell on a phone (F11, F61)", () => {
  let b: Booted;
  const routes: string[] = [];
  beforeAll(async () => {
    b = boot();
    await settle(SETTLE_MS);
    // siteNav is the artifact's one door to the site. Recorded here, and
    // answered the way it answers inside the shell: it navigated, so stop.
    (b.window as unknown as { siteNav: (ev: Event, route: string) => boolean }).siteNav = (ev, route) => {
      routes.push(route);
      ev.preventDefault();
      return false;
    };
  });
  afterAll(() => b?.close());

  it("from the land, takes the same door as the desk's Circles tab, to /map/circles", () => {
    routes.length = 0;
    click(b, "#pbMap");
    expect(routes, "routes handed to siteNav").toEqual(["/map/circles"]);
    expect(body(b).contains("circles"), "the in-file circles stay closed").toBe(false);
    expect(b.window.document.querySelectorAll("#pbMap svg").length, "both drawn icons survive the tap").toBe(2);
  });

  it("from the Loom, goes back to the land and nowhere else", () => {
    routes.length = 0;
    b.run("openLoom()");
    expect(body(b).contains("loom")).toBe(true);
    click(b, "#pbMap");
    expect(body(b).contains("loom"), "the Loom closed").toBe(false);
    expect(body(b).contains("circles"), "and did not open the circles").toBe(false);
    expect(routes, "and did not leave the map").toEqual([]);
  });

  it("from the Loom opened over the in-file circles, goes back to the land in one tap", () => {
    routes.length = 0;
    b.run("setMapType('circles',true);openLoom()");
    expect([body(b).contains("circles"), body(b).contains("loom")]).toEqual([true, true]);
    click(b, "#pbMap");
    expect([body(b).contains("circles"), body(b).contains("loom")]).toEqual([false, false]);
    expect(routes).toEqual([]);
  });

  it("from the in-file circles a #/circles link opens, goes back to the land", () => {
    routes.length = 0;
    b.run("setMapType('circles',true)");
    click(b, "#pbMap");
    expect(body(b).contains("circles")).toBe(false);
    expect(routes).toEqual([]);
  });

  it("asking for the land closes the Loom, from any caller", () => {
    b.run("openLoom();setMapType('living',true)");
    expect(body(b).contains("loom")).toBe(false);
    expect(b.uncaught).toEqual([]);
  });
});

describe("switching to the in-file circles with a sheet or a door open (F60)", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot();
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  it("closes the place sheet, and the address names the circles", () => {
    b.run("openPanel('greenhouse')");
    expect(b.window.document.getElementById("panel")?.classList.contains("open"), "the control: the sheet opened").toBe(
      true,
    );
    b.run("setMapType('circles',true)");
    expect(b.window.document.getElementById("panel")?.classList.contains("open")).toBe(false);
    expect(b.run<unknown>("panelKey")).toBeNull();
    expect(b.window.location.hash).toBe("#/circles");
    b.run("setMapType('living',true)");
  });

  it("closes a module door, and the address still names the circles", () => {
    b.run("openDoor('wallet',{})");
    expect(b.window.document.getElementById("module")?.classList.contains("show"), "the control: the door opened").toBe(
      true,
    );
    b.run("setMapType('circles',true)");
    expect(b.window.document.getElementById("module")?.classList.contains("show")).toBe(false);
    expect(b.window.location.hash).toBe("#/circles");
    expect(b.uncaught).toEqual([]);
  });
});
