/**
 * THE ARTIFACT'S HALF OF THE ADDRESS BAR: it says where it is, routes without
 * touching its own history, and an address it shows is the thing on screen.
 *
 * Inside the shell the artifact's own URL is one nobody sees. On 2026-10-01 a
 * place opened on the map never reached the visible address bar, so F5 and a
 * shared link came back to the gate with nothing open (F36, F57, F65), and
 * Back had nothing to step through (F55). The shell half lives in
 * client/src/components/map/mapHistory.ts and is tested beside it. This file
 * runs the real artifact in jsdom, framed by a stand-in parent, and checks
 * the four things the shell relies on:
 *
 *   1. setHash posts `{type:'route', hash}` to the parent, every time;
 *   2. `goto` routes the land WITHOUT adding an entry to the frame's history:
 *      an entry there is popped by the browser's Back before the page's, so a
 *      press would rewind an invisible hash and do nothing visible;
 *   3. an empty `goto` closes what an address opened: the place, the door,
 *      the Loom. That is what Back to the closed map sends;
 *   4. the address agrees with the screen after the closers that used to
 *      disagree: Escape left `#/place/x` behind, and closing the Loom or a door
 *      over an open place cleared the address while the place stayed open.
 *
 * The platform stubs mirror mapArtifactBoot.test.ts, which says why each one
 * exists. The parent is the only addition: `window.parent` is replaced before
 * the artifact's scripts run, so its `inShell()` is true and its posts land
 * in a list this file reads.
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

interface Framed {
  window: ArtifactWindow;
  uncaught: unknown[];
  /** Every message the artifact posted to its parent, in order. */
  sent: { type?: string; hash?: string }[];
  run<T>(src: string): T;
  /** A message from the shell, in the shape LivingMap.tsx and mapHistory.ts post it. */
  post(data: Record<string, unknown>): void;
  routes(): string[];
}

function framed(): Framed {
  const uncaught: unknown[] = [];
  const sent: { type?: string; hash?: string }[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => {
    if (e.type === "unhandled-exception") uncaught.push(e.cause ?? e);
  });
  const parent = { postMessage: (m: { type?: string; hash?: string }) => sent.push(JSON.parse(JSON.stringify(m))) };
  const { window } = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/grounds/index.html#skipIntro",
    virtualConsole,
    beforeParse(w) {
      w.addEventListener("error", (ev) => uncaught.push(ev.error ?? ev.message));
      Object.assign(w, { innerWidth: 1440, innerHeight: 900 });
      stubTheMissingPlatform(w);
      Object.defineProperty(w, "parent", { configurable: true, get: () => parent });
    },
  });
  return {
    window,
    uncaught,
    sent,
    run: <T>(src: string) => window.eval(src) as T,
    post(data) {
      const own = window.eval("JSON").parse(JSON.stringify(data));
      window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
    },
    routes: () => sent.filter((m) => m.type === "route").map((m) => m.hash ?? "?"),
  };
}

describe("the artifact's address, inside the shell", () => {
  let f: Framed;
  beforeAll(async () => {
    f = framed();
    await settle(1000);
  });
  afterAll(() => f?.window.close());

  const panelOpen = () => f.run<boolean>("document.getElementById('panel').classList.contains('open')");
  const doorOpen = () => f.run<boolean>("document.getElementById('module').classList.contains('show')");
  const loomOpen = () => f.run<boolean>("document.body.classList.contains('loom')");

  it("is framed, booted, and announced itself (the positive control)", () => {
    expect(f.uncaught).toEqual([]);
    expect(f.sent.some((m) => m.type === "grounds-ready"), "the stand-in parent hears the artifact").toBe(true);
  });

  it("tells the shell every address it takes, and the empty one when it closes", () => {
    f.sent.length = 0;
    f.run("openPanel('greenhouse')");
    expect(f.routes()).toContain("#/place/greenhouse");
    f.run("document.getElementById('panelClose').click()");
    expect(f.routes().at(-1)).toBe("");
  });

  it("routes a goto without adding an entry to its own history", () => {
    const before = f.window.history.length;
    f.post({ type: "goto", hash: "#/place/kitchen" });
    expect(f.window.location.hash).toBe("#/place/kitchen");
    expect(f.run<string | null>("panelKey")).toBe("kitchen");
    expect(f.window.history.length, "an entry here is one the browser's Back pops first").toBe(before);
  });

  it("closes the place, the door and the Loom on an empty goto", () => {
    f.run("openPanel('greenhouse');openDoor('stay',{});openLoom()");
    expect([panelOpen(), doorOpen(), loomOpen()]).toEqual([true, true, true]);
    f.post({ type: "goto", hash: "" });
    expect([panelOpen(), doorOpen(), loomOpen()]).toEqual([false, false, false]);
    expect(f.window.location.hash).toBe("");
  });

  it("Escape clears the address of the place it closes", () => {
    f.run("openPanel('greenhouse')");
    f.window.dispatchEvent(new f.window.KeyboardEvent("keydown", { key: "Escape" }));
    expect(panelOpen()).toBe(false);
    expect(f.window.location.hash, "a reload would reopen what Escape closed").toBe("");
    expect(f.routes().at(-1)).toBe("");
  });

  it("closing the Loom or a door over an open place leaves the place's address", () => {
    f.run("openPanel('greenhouse');openLoom()");
    f.run("closeLoom()");
    expect(panelOpen()).toBe(true);
    expect(f.window.location.hash).toBe("#/place/greenhouse");
    f.run("openDoor('stay',{})");
    f.run("closeDoor()");
    expect(f.window.location.hash).toBe("#/place/greenhouse");
    expect(f.routes().at(-1)).toBe("#/place/greenhouse");
    f.run("document.getElementById('panelClose').click()");
  });

  it("threw nothing along the way", () => {
    expect(f.uncaught).toEqual([]);
  });
});
