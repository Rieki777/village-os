/**
 * S2 STEP 2 OF THE MAP SPEED PLAN: A CONSTRUCTION SPRITE IS FETCHED ONLY WHEN
 * IT IS SHOWN.
 *
 * Every building that has an unfinished twin (`window.SPRITES_WIP`) gets a
 * second <img class="sprite-wip"> beside its finished sprite. It is hidden
 * (display:none) except while that building is in phase 2, which on a normal
 * day is a handful of buildings at most. A hidden <img> is still fetched,
 * so a phone paid for every construction sprite on first view, about 500 KB
 * of images nobody saw (WOVEN.md, the S2 plan, 9 Nov 2026).
 *
 * `loading="lazy"` is the whole fix: a lazy image that is not rendered is
 * never fetched, and the moment `.ph2` shows it the browser fetches it. This
 * holds the artifact to drawing every construction sprite that way, and to
 * leaving the finished sprite eager, because that one IS the first view.
 *
 * WHAT THIS CANNOT SEE. Whether a browser honours the attribute: jsdom
 * fetches nothing. The network effect is measured by tools/perf.cjs against a
 * local server (see the commit), and the swap's pop-in by a screenshot.
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
  await settle(400);
});
afterAll(() => map?.close());

describe("construction sprites on the first view", () => {
  it("the map draws buildings that have a construction twin", () => {
    expect(map.uncaught).toEqual([]);
    const wip = map.window.document.querySelectorAll("img.sprite-wip");
    expect(wip.length).toBeGreaterThan(0);
  });

  it("every construction sprite is lazy, so a hidden one is never fetched", () => {
    const wip = Array.from(map.window.document.querySelectorAll("img.sprite-wip"));
    for (const img of wip) expect(img.getAttribute("loading"), img.outerHTML.slice(0, 120)).toBe("lazy");
  });

  it("the finished sprite stays eager, because it is the first view", () => {
    const done = Array.from(map.window.document.querySelectorAll("img.sprite"));
    expect(done.length).toBeGreaterThan(0);
    for (const img of done) expect(img.getAttribute("loading")).not.toBe("lazy");
  });
});
