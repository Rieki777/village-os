/**
 * THE LIVING MAP ANSWERS A KEYBOARD, A WHEEL AND A RELOAD THE WAY A PERSON EXPECTS.
 *
 * A QA sweep on 2026-10-01 found the artifact taking input it should leave
 * alone and refusing input it should take: Tab walked into sheets parked off
 * the screen, Ctrl+V switched the lens, Space on a focused button opened an
 * unrelated card, and so on. Each block below pins one of those, against the
 * real artifact booted in jsdom the way mapArtifactBoot.test.ts boots it.
 * The platform stubs mirror that file, which says why each one exists.
 *
 * WHAT THIS CANNOT SEE. jsdom lays nothing out, runs no transitions and never
 * activates a button from a key. So these tests read the computed style the
 * cascade gives, the default a key event was left with, and the state the
 * artifact's own handlers set. That the sheet slides out before it hides,
 * that a focused button really fires on Space, and that the land really
 * zooms under the pointer were each measured in Playwright; the commit that
 * added each block says how.
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

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
/** Long enough for every boot timer to fire (see mapArtifactBoot.test.ts). */
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

function boot(
  hash: string,
  viewport: { width: number; height: number },
  before?: (w: ArtifactWindow) => void,
): Booted {
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
      Object.assign(w, { innerWidth: viewport.width, innerHeight: viewport.height });
      stubTheMissingPlatform(w);
      before?.(w);
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

it("the artifact is the file the shell mounts (the positive control)", () => {
  expect(html.length).toBeGreaterThan(100_000);
  for (const id of ["panel", "panelClose", "inspect", "inspClose", "skin", "pdrawer", "attnBtn", "lyVision", "wallBtn"]) {
    expect(html, `#${id} in the markup`).toContain(`id="${id}"`);
  }
});

/* F01. A sheet parked past the edge took keyboard focus. Tab 20 and 21 of
   every desk lap landed on #panel's and #inspect's close buttons, which
   nobody could see, and 73 of 120 presses on a phone landed in the closed
   #skin. jsdom has no tab order of its own, so this reads what decides it:
   the computed visibility of every control inside each sheet, closed and
   then open. A hidden control is out of the order; a visible one is in it. */
describe("a closed sheet is out of the tab order", () => {
  const controls = (b: Booted, id: string) =>
    [...(b.doc.getElementById(id)?.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href]") ?? [])];
  const shown = (b: Booted, els: HTMLElement[]) =>
    els.filter((e) => b.window.getComputedStyle(e).visibility !== "hidden").map((e) => e.id || e.tagName);

  describe("on a desk", () => {
    let b: Booted;
    beforeAll(async () => {
      b = boot("#skipIntro", DESK);
      await settle(SETTLE_MS);
    });
    afterAll(() => b?.close());

    it("hides every control of the closed place panel and inspector, and shows them when open", () => {
      // The positive control: something outside the sheets is visible, so a
      // cascade that hid everything would fail here.
      expect(b.window.getComputedStyle(b.doc.getElementById("attnBtn") as HTMLElement).visibility).toBe("visible");
      expect(controls(b, "panel").length, "#panel has controls to count").toBeGreaterThan(0);
      expect(shown(b, controls(b, "panel")), "controls left in the closed #panel").toEqual([]);
      expect(shown(b, controls(b, "inspect")), "controls left in the closed #inspect").toEqual([]);

      b.run("openPanel('greenhouse')");
      const open = controls(b, "panel");
      expect(open.length, "the open panel renders its controls").toBeGreaterThan(1);
      expect(shown(b, open).length, "every control of the open panel").toBe(open.length);
      b.run("$('panel').classList.remove('open');panelKey=null");
      expect(shown(b, controls(b, "panel")), "controls left once it closes again").toEqual([]);

      b.run("openInspect('greenhouse')");
      const insp = controls(b, "inspect");
      expect(shown(b, insp).length, "every control of the open inspector").toBe(insp.length);
      b.run("closeInspect()");
      expect(shown(b, controls(b, "inspect"))).toEqual([]);
      expect(b.uncaught).toEqual([]);
    });
  });

  describe("on a phone", () => {
    let b: Booted;
    beforeAll(async () => {
      b = boot("#hud=pocket&skipIntro", PHONE);
      await settle(SETTLE_MS);
    });
    afterAll(() => b?.close());

    it("hides the closed Your view sheet and the drawer, and shows them when open", () => {
      expect(b.doc.body.classList.contains("pocket"), "the pocket profile").toBe(true);
      const skin = controls(b, "skin");
      expect(skin.length, "#skin has controls to count").toBeGreaterThan(5);
      expect(shown(b, skin), "controls left in the closed #skin").toEqual([]);
      b.run("$('skin').classList.add('show')");
      expect(shown(b, controls(b, "skin")).length).toBe(controls(b, "skin").length);
      b.run("$('skin').classList.remove('show')");

      b.run("renderDrawer()");
      const cells = controls(b, "pdrawer");
      expect(cells.length, "the drawer renders its cells").toBeGreaterThan(0);
      expect(shown(b, cells), "cells left in the closed drawer").toEqual([]);
      b.run("$('pdrawer').classList.add('open')");
      expect(shown(b, controls(b, "pdrawer")).length).toBe(cells.length);
      b.run("$('pdrawer').classList.remove('open')");

      b.run("openPanel('greenhouse')");
      expect(shown(b, controls(b, "panel")).length, "the open pocket panel").toBe(controls(b, "panel").length);
      b.run("$('panel').classList.remove('open');panelKey=null");
      expect(shown(b, controls(b, "panel")), "controls left in the closed pocket panel").toEqual([]);
      expect(b.uncaught).toEqual([]);
    });
  });
});

/** A keydown sent from `target` the way a browser sends one: it bubbles to
    the window and can be cancelled. Returns whether a handler cancelled it. */
function press(b: Booted, target: EventTarget, key: string, mods: KeyboardEventInit = {}) {
  const ev = new b.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(ev);
  return ev.defaultPrevented;
}

/* F30. Every map shortcut tested e.key alone, so a browser shortcut fired it
   too: Ctrl+V outside a field switched the lens to Vision, Ctrl+= and Ctrl+-
   zoomed the map as well as the page, Ctrl+H flew home, Alt+Left panned and
   Ctrl+L opened the Loom while the address bar took focus. The bare keys are
   the positive control: each one still does its job. */
describe("the map's shortcuts leave a key held with Ctrl, Cmd or Alt to the browser", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  const cam = () => b.run<{ x: number; y: number; z: number }>("({x:cam.x,y:cam.y,z:cam.z})");
  const home = () => b.run("travel=null;cam.x=1200;cam.y=600;cam.z=0.84;if(mode!=='now')setMode('now')");

  it("ignores Ctrl+V, Cmd+V, Ctrl+=, Ctrl+-, Ctrl+H and Alt+Left", () => {
    const body = b.doc.body;
    for (const [key, mods] of [
      ["v", { ctrlKey: true }],
      ["v", { metaKey: true }],
      ["=", { ctrlKey: true }],
      ["-", { ctrlKey: true }],
      ["h", { ctrlKey: true }],
      ["ArrowLeft", { altKey: true }],
    ] as [string, KeyboardEventInit][]) {
      home();
      const before = cam();
      press(b, body, key, mods);
      expect(b.run<string>("mode"), `the lens after ${JSON.stringify(mods)} ${key}`).toBe("now");
      expect(cam(), `the camera after ${JSON.stringify(mods)} ${key}`).toEqual(before);
      expect(b.run<unknown>("travel"), `no flight after ${JSON.stringify(mods)} ${key}`).toBeNull();
    }
  });

  it("leaves Ctrl+L to the address bar, and the Loom shut", () => {
    press(b, b.doc.body, "l", { ctrlKey: true });
    expect(b.doc.body.classList.contains("loom")).toBe(false);
  });

  it("still answers the bare keys (the positive control)", () => {
    home();
    press(b, b.doc.body, "v");
    expect(b.run<string>("mode")).toBe("vision");
    home();
    const z = cam().z;
    press(b, b.doc.body, "=");
    expect(cam().z).toBeGreaterThan(z);
    home();
    press(b, b.doc.body, "ArrowLeft");
    expect(cam().x).toBeLessThan(1200);
    press(b, b.doc.body, "l");
    expect(b.doc.body.classList.contains("loom"), "l opens the Loom").toBe(true);
    press(b, b.doc.body, "Escape");
    expect(b.doc.body.classList.contains("loom"), "Escape closes it").toBe(false);
    expect(b.uncaught).toEqual([]);
  });
});
