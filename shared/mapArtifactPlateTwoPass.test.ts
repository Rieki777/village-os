/**
 * S2 STEP 3 OF THE MAP SPEED PLAN: THE SATELLITE PLATES ARRIVE IN TWO PASSES.
 *
 * The seed's two satellite plates (the land, 2198x1465, and the wide
 * surround, 1600x1390) were the two biggest things a phone fetched on first
 * view: 836 KB of the 1,458 KB once S2a and S2b had landed. Both were asked
 * for at parse time, so they competed with the drawing code and the sprites
 * for a slow link.
 *
 * Each plate now has a small preview (550 and 400 px wide, about 47 KB
 * between them) that is asked for at parse time and drawn the moment it
 * decodes. The full plate is asked for only once the page has loaded, and
 * replaces the preview when it arrives. Every draw stretches the plate to the
 * same world rectangle, so the preview sits exactly where the full plate will.
 *
 * These hold the artifact to: only previews before load, both full plates
 * after it, and a preview that decodes late never covering a full plate.
 *
 * WHAT THIS CANNOT SEE. Bytes on a wire and pixels: jsdom fetches and decodes
 * nothing, so the decode is played by hand. tools/perf.cjs and a screenshot
 * against a local server measure those (see the commit).
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ArtifactWindow, evalIn, ownCopy } from "./test/artifactWindow";

const ARTIFACT = path.resolve(__dirname, "../docs/prototypes/grounds-v0.html");
const html = fs.readFileSync(ARTIFACT, "utf8");

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

/* The platform jsdom lacks, exactly as mapArtifactBoot.test.ts stubs it. */
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
  post(data: Record<string, unknown>): void;
  close(): void;
}

interface Requested { img: HTMLImageElement; src: string; state: string }
const requested: Requested[] = [];

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
      w.Element.prototype.scrollIntoView = function () {};
      const d = Object.getOwnPropertyDescriptor(w.HTMLImageElement.prototype, "src")!;
      Object.defineProperty(w.HTMLImageElement.prototype, "src", {
        configurable: true,
        get(this: HTMLImageElement) { return d.get!.call(this); },
        set(this: HTMLImageElement, v: string) {
          requested.push({ img: this, src: String(v), state: w.document.readyState });
          d.set!.call(this, v);
        },
      });
      // In the shell: the artifact only asks whether its parent is itself.
      const shell = { postMessage: () => {} };
      Object.defineProperty(w, "parent", { configurable: true, get: () => shell });
    },
  });
  return {
    window,
    uncaught,
    run: <T>(src: string) => evalIn<T>(window, src),
    post(data) {
      const own = ownCopy(window, data);
      window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
    },
    close: () => window.close(),
  };
}



let map: Booted;
beforeAll(async () => {
  map = boot();
  await settle(600);
});
afterAll(() => map?.close());

/* A seed plate is a JPEG data URI in the raw artifact (S1 lifts them on the server). */
const plates = () => requested.filter((r) => r.src.startsWith("data:image/jpeg"));
const PREVIEW_MAX = 80_000; // characters of base64: a preview is tens of KB
const FULL_MIN = 300_000;

describe("the satellite plates on first view", () => {
  it("asks only for the two previews while the page is still loading", () => {
    expect(map.uncaught).toEqual([]);
    const early = plates().filter((r) => r.state !== "complete");
    expect(early).toHaveLength(2);
    for (const r of early) expect(r.src.length).toBeLessThan(PREVIEW_MAX);
  });

  it("asks for both full plates once the page has loaded", () => {
    const full = plates().filter((r) => r.src.length > FULL_MIN);
    expect(full).toHaveLength(2);
    for (const r of full) expect(r.state).toBe("complete");
  });

  it("draws the preview first, and the full plate replaces it", () => {
    const [prevSur, prevCore] = plates().filter((r) => r.src.length < PREVIEW_MAX);
    const [fullSur, fullCore] = plates().filter((r) => r.src.length > FULL_MIN);
    prevCore.img.onload?.(new map.window.Event("load"));
    prevSur.img.onload?.(new map.window.Event("load"));
    expect(map.run<number>("satPlate.src.length")).toBe(prevCore.src.length);
    expect(map.run<number>("surPlate.src.length")).toBe(prevSur.src.length);
    fullCore.img.onload?.(new map.window.Event("load"));
    fullSur.img.onload?.(new map.window.Event("load"));
    expect(map.run<number>("satPlate.src.length")).toBe(fullCore.src.length);
    expect(map.run<number>("surPlate.src.length")).toBe(fullSur.src.length);
  });

  it("never lets a preview that decodes late cover the full plate", () => {
    const [prevSur, prevCore] = plates().filter((r) => r.src.length < PREVIEW_MAX);
    const [fullSur, fullCore] = plates().filter((r) => r.src.length > FULL_MIN);
    prevCore.img.onload?.(new map.window.Event("load"));
    prevSur.img.onload?.(new map.window.Event("load"));
    expect(map.run<number>("satPlate.src.length")).toBe(fullCore.src.length);
    expect(map.run<number>("surPlate.src.length")).toBe(fullSur.src.length);
  });
});
