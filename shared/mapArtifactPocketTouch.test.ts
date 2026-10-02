/**
 * THE LIVING MAP ON A PHONE: WHICH SHEET IS UP, AND WHAT A FINGER REACHES.
 *
 * The phone sweep of 2026-10-01 found a set of pocket defects. Most of them are
 * geometry (a row under the bottom bar, a card 70 px tall, a seed that moves
 * 34 px), and jsdom lays nothing out, so those were proved in Playwright with
 * real CDP touch input and are named in their commits. What is left here is the
 * part a DOM can honestly see: which sheet a door leaves open, which elements a
 * finger's touch events reach, which line Maia writes, and what the shell's
 * scene push says out loud.
 *
 * Runs the real artifact in jsdom at the phone address the shell builds,
 * `#hud=pocket&skipIntro`. The platform stubs mirror mapArtifactBoot.test.ts,
 * which says why each one exists.
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
  VirtualConsole: new () => {
    on(event: "jsdomError", listener: (e: Error & { type?: string; cause?: unknown }) => void): void;
  };
}
const { JSDOM, VirtualConsole } = createRequire(import.meta.url)("jsdom") as Jsdom;

const PHONE = { width: 390, height: 844 };
/** The pocket boot writes its welcome 700ms in. */
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
  const pixels = (w: number, h: number) => ({
    width: w,
    height: h,
    data: new Uint8ClampedArray(Math.max(0, w * h * 4) || 0),
  });
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
  // jsdom has no scrollIntoView; the drawer and the panels call it.
  window.Element.prototype.scrollIntoView = function () {};
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
  return {
    window,
    doc: window.document,
    uncaught,
    run: <T>(src: string) => window.eval(src) as T,
    post(data) {
      const own = window.eval("JSON").parse(JSON.stringify(data));
      window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
    },
    close: () => window.close(),
  };
}

const shown = (b: Booted, id: string, cls = "show") => !!b.doc.getElementById(id)?.classList.contains(cls);
const msheet = (b: Booted) => b.doc.body.classList.contains("msheet");
const tap = (b: Booted, el: Element | null) => (el as HTMLElement | null)?.click();

it("boots on the phone profile (the positive control for every block below)", async () => {
  const b = boot();
  await settle(SETTLE_MS);
  expect(b.doc.body.classList.contains("pocket")).toBe(true);
  expect(b.uncaught).toEqual([]);
  b.close();
});

/* GET INVOLVED, ONE SHEET AT A TIME. Measured at 390x844: asking Maia for a
   seat put the list up and left her sheet over it, and 1479 of 5838 points
   sampled across its rows landed on her. On a phone the list is now a sheet on
   the bar, so every door into it has to put the other sheets away. */
describe("Get Involved on a phone", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot();
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  it("puts Maia's sheet away when she opens the list for a seat", async () => {
    tap(b, b.doc.getElementById("pbAsk"));
    expect(msheet(b), "her sheet is up after ask maia").toBe(true);
    b.run("conciergeMatch('is there a seat for me')");
    await settle(50);
    expect(shown(b, "wall"), "the list is up").toBe(true);
    expect(msheet(b), "her sheet went away for it").toBe(false);
  });

  it("closes the drawer and the help sheet when it opens from either", () => {
    b.doc.getElementById("wall")?.classList.remove("show");
    tap(b, b.doc.getElementById("pbMore"));
    expect(shown(b, "pdrawer", "open"), "the drawer is open").toBe(true);
    tap(b, b.doc.querySelector('#pdrawer [data-pa="wall"]'));
    expect(shown(b, "wall"), "the list from the drawer").toBe(true);
    expect(shown(b, "pdrawer", "open"), "the drawer closed").toBe(false);

    b.doc.getElementById("wall")?.classList.remove("show");
    b.run("openHelp()");
    expect(shown(b, "help"), "the help sheet is up").toBe(true);
    tap(b, b.doc.querySelector("#help .help-wall"));
    expect(shown(b, "wall"), "the list from the help sheet").toBe(true);
    expect(shown(b, "help"), "the help sheet closed").toBe(false);
  });

  it("steps aside for the place a row opens, which would otherwise open underneath it", () => {
    tap(b, b.doc.getElementById("pbMore"));
    tap(b, b.doc.querySelector('#pdrawer [data-pa="wall"]'));
    expect(shown(b, "wall"), "the list is up").toBe(true);
    const row =b.doc.querySelector<HTMLElement>("#wallList .wallrow[onclick]");
    expect(row, "a row that names a place").not.toBeNull();
    tap(b, row);
    expect(shown(b, "panel", "open"), "the place opened").toBe(true);
    expect(shown(b, "wall"), "the list stepped aside").toBe(false);
    expect(b.uncaught).toEqual([]);
  });
});

/* "WHERE CAN I HELP?" ON A PHONE ANSWERS WITH THE LIST. The desk answer cycles
   the attention banner, which the pocket profile hides: measured at 390x844 the
   chip flew the camera to the Greenhouse, filled a card that measured 0x0, and
   Maia told a phone to press Space. */
describe("Where can I help? in Maia's phone sheet", () => {
  let b: Booted;
  let cam0: number[];
  beforeAll(async () => {
    b = boot();
    await settle(SETTLE_MS);
    tap(b, b.doc.getElementById("pbAsk"));
    cam0 = b.run<number[]>("[cam.x,cam.y,cam.z]");
    tap(b, b.doc.querySelector('#maiaActions .chip[data-say="where can I help"]'));
    await settle(500);
  });
  afterAll(() => b?.close());

  it("opens Get Involved, the list of every open seat and quest", () => {
    expect(shown(b, "wall"), "the list is up").toBe(true);
    expect(b.doc.querySelectorAll("#wallList .wallrow").length, "rows to choose from").toBeGreaterThan(0);
  });

  it("does not fill the attention card the phone hides, or fly the camera to it", () => {
    expect(shown(b, "attnCard"), "the hidden attention card").toBe(false);
    expect(b.run<number[]>("[cam.x,cam.y,cam.z]"), "the camera stayed put").toEqual(cam0);
  });

  it("never tells a phone to press a key", () => {
    const lines = [...b.doc.querySelectorAll("#maiaLog .mline")].map((n) => n.textContent ?? "");
    expect(lines.join(" ")).toContain("Get Involved lists every open seat and quest");
    expect(lines.join(" ")).not.toMatch(/Space/);
    expect(b.uncaught).toEqual([]);
  });
});

/* A FINGER THAT STARTS ON A BUILDING STILL MOVES THE LAND. The plates, the
   place names and the seals are their own layers over #scene, and the gesture
   code listened on #scene alone: measured at 390x844 in the village, a drag
   from the Village Heart label moved the camera 0,0 where the same drag on
   bare land moved it 80,-53.33. jsdom has no Touch constructor, so each event
   carries its touch list the way a browser's does, as a property. What jsdom
   cannot show is the page zoom the browser took instead (touch-action), which
   was measured in Playwright: a pinch on the label set visualViewport.scale to
   1.12 before and left it at 1 after. */
describe("a drag or a pinch that starts on a mark over the land", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot();
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  const fire = (target: Element, type: string, pts: [number, number][]) => {
    const ev = new b.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "touches", { value: pts.map(([clientX, clientY]) => ({ clientX, clientY })) });
    target.dispatchEvent(ev);
  };
  const cam = () => b.run<{ x: number; y: number; z: number }>("({x:cam.x,y:cam.y,z:cam.z})");
  const village = () => b.run("travel=null;cam.vx=cam.vy=0;cam.x=1400;cam.y=640;cam.z=0.9;clampCam()");
  /** One finger from (200,300), 72 px left and 48 px down, in twelve moves. */
  async function drag(target: Element) {
    village();
    const c0 = cam();
    fire(target, "touchstart", [[200, 300]]);
    for (let i = 1; i <= 12; i++) {
      fire(target, "touchmove", [[200 - 6 * i, 300 + 4 * i]]);
      await settle(20);
    }
    await settle(40);
    fire(target, "touchend", []);
    b.run("cam.vx=cam.vy=0");
    const c1 = cam();
    return { dx: +(c1.x - c0.x).toFixed(2), dy: +(c1.y - c0.y).toFixed(2) };
  }
  /** Two fingers 40 px apart about (200,300), spread to 160. */
  async function pinch(target: Element) {
    village();
    const z0 = cam().z;
    const pts = (d: number): [number, number][] => [
      [200 - d / 2, 300],
      [200 + d / 2, 300],
    ];
    fire(target, "touchstart", pts(40));
    for (let i = 1; i <= 12; i++) {
      fire(target, "touchmove", pts(40 + 10 * i));
      await settle(20);
    }
    await settle(40);
    fire(target, "touchend", []);
    return { z0, z1: +cam().z.toFixed(3) };
  }
  const poi = () => b.doc.querySelector("#icons .poi") as Element;
  const label = () => b.doc.querySelector("#banners .banner:not(.geo)") as Element;
  const seal = () => b.doc.querySelector("#badges .bseal") as Element;

  it("moves the camera by the finger on bare land (the positive control)", async () => {
    expect(await drag(b.doc.getElementById("scene") as Element)).toEqual({ dx: 80, dy: -53.33 });
  });

  it("moves it the same when the drag starts on a building, a place name or a seal", async () => {
    expect(poi(), "a building plate").not.toBeNull();
    expect(label(), "a place name").not.toBeNull();
    expect(seal(), "a seal").not.toBeNull();
    expect(await drag(poi()), "from a building").toEqual({ dx: 80, dy: -53.33 });
    expect(await drag(label()), "from a place name").toEqual({ dx: 80, dy: -53.33 });
    expect(await drag(seal()), "from a seal").toEqual({ dx: 80, dy: -53.33 });
  });

  it("zooms the map when both fingers of a pinch start on a place name", async () => {
    const r = await pinch(label());
    expect(r.z1, "the map's zoom after a 4x spread").toBeGreaterThan(r.z0 * 2);
  });

  it("threw nothing", () => {
    // That a plain tap still opens the door is a browser fact: jsdom never
    // turns touch events into a click. Measured in Playwright with CDP touch:
    // a tap on a plate and on a seal each opened its place after the change.
    expect(b.uncaught).toEqual([]);
  });
});

/* THE HOVER CARD IS A MOUSE'S. A finger's tap sends compatibility mouse events,
   mouseenter among them, so the desk card ("click to open the door") came up on
   every tap of a plate or a name and stayed over the vitals strip with the
   panel already open. Measured at 390x844: [120,26,250,106], display block. The
   sequence below is the one Chromium sent for a tap, recorded in that probe. */
describe("the hover card and a finger", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot();
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  const card = () => (b.doc.getElementById("hovercard") as HTMLElement).style.display;
  const arrive = (el: Element, pointerType: string) => {
    el.dispatchEvent(new b.window.PointerEvent("pointerover", { bubbles: true, pointerType }));
    el.dispatchEvent(new b.window.PointerEvent("pointerenter", { pointerType }));
    el.dispatchEvent(new b.window.MouseEvent("mouseover", { bubbles: true }));
    el.dispatchEvent(new b.window.MouseEvent("mouseenter"));
  };
  const plate = () => b.doc.querySelector("#icons .poi") as Element;
  const name = () => b.doc.querySelector("#banners .banner:not(.geo)") as Element;

  it("stays down when a finger lands on a building or its name", () => {
    b.run("hideHover()");
    arrive(plate(), "touch");
    expect(card(), "after a tap on a plate").not.toBe("block");
    arrive(name(), "touch");
    expect(card(), "after a tap on a name").not.toBe("block");
  });

  it("still comes up for a mouse (the control: hover is not switched off)", () => {
    arrive(plate(), "mouse");
    expect(card()).toBe("block");
  });

  it("goes down when a door opens, however it was opened", () => {
    arrive(plate(), "mouse");
    b.run("openPanel('greenhouse')");
    expect(card()).toBe("none");
    expect(b.uncaught).toEqual([]);
  });
});
