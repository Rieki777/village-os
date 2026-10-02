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
