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
 *      the Loom. That is what Forward onto an entry of the closed map sends;
 *   4. the address agrees with the screen after the closers that used to
 *      disagree: Escape left `#/place/x` behind, and closing the Loom or a door
 *      over an open place cleared the address while the place stayed open.
 *      Round 3 found the same over an open door and a running walk, and that
 *      L opened the Loom under a door;
 *   5. the lens is part of the address (Rye, D7): the Vision, Org and Flows
 *      a visitor turned on ride on the end of it, and come back on a reload.
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

function framed(start = "#skipIntro"): Framed {
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
    url: `http://localhost/grounds/index.html${start}`,
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
    /* The shell sends a config on every path, a bare one when its fetch
       fails (pushConfig in LivingMap.tsx), and inside the shell the artifact
       holds every address until that first config lands (ROUTE_HELD, so a
       shared link is answered by the village's land and not the seed). A
       stand-in parent that never sends one leaves every goto below waiting
       on a hold the real shell always ends. */
    f.post({ type: "config" });
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
    // The door last: opening the Loom closes a door (see the modes block below).
    f.run("openPanel('greenhouse');openLoom();openDoor('stay',{})");
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

/*
 * ROUND 3, MODES: the address named only the Loom, the circles and a place.
 * Closing the Loom over an open door or a running walk wrote `/map` with the
 * door or the walk still in front of the visitor, so F5 and a copied link
 * dropped it. Measured on this branch before the change, with a real browser:
 * Stays door, L, Escape gave `/map` with the door on screen, and F5 closed it.
 */
describe("the address names every layer still on screen", () => {
  let f: Framed;
  beforeAll(async () => {
    f = framed();
    f.post({ type: "config" });
    await settle(1000);
  });
  afterAll(() => f?.window.close());

  const doorOpen = () => f.run<boolean>("document.getElementById('module').classList.contains('show')");
  const walk = () => f.run<{ id: string } | null>("JWALK");

  it("closing the Loom over a running walk leaves the walk's address, and the walk goes on", async () => {
    f.run("playJourney('j2')");
    await settle(100);
    expect(walk()?.id, "the control: the walk is running").toBe("j2");
    expect(f.window.location.hash).toBe("#/journey/j2");
    f.run("openLoom()");
    expect(f.window.location.hash).toBe("#/loom");
    f.run("closeLoom()");
    expect(walk()?.id).toBe("j2");
    expect(f.window.location.hash, "a reload would drop the walk").toBe("#/journey/j2");
    expect(f.routes().at(-1)).toBe("#/journey/j2");
  });

  it("opening a place ends the walk (the camera is the visitor's), so the address names the place and then nothing", async () => {
    f.run("openPanel('greenhouse')");
    expect(walk(), "travelTo hands the camera back, which ends the walk").toBeNull();
    expect(f.window.location.hash, "no stale walk address under the place").toBe("#/place/greenhouse");
    f.run("document.getElementById('panelClose').click()");
    expect(f.window.location.hash).toBe("");
  });

  it("pressing L with a door open closes the door, so the Loom's own X is on top", () => {
    f.run("openDoor('stay',{})");
    expect(doorOpen(), "the control: the door opened").toBe(true);
    expect(f.window.location.hash).toBe("#/module/stay");
    f.window.document.dispatchEvent(new f.window.KeyboardEvent("keydown", { key: "l", bubbles: true }));
    expect(f.run<boolean>("document.body.classList.contains('loom')"), "L opened the Loom").toBe(true);
    expect(doorOpen(), "the door's backdrop no longer covers the Loom").toBe(false);
    f.run("closeLoom()");
    expect(f.window.location.hash).toBe("");
  });

  it("a door opened over the Loom keeps its address when the Loom under it closes", () => {
    f.run("openLoom();openDoor('stay',{})");
    expect(f.window.location.hash).toBe("#/module/stay");
    f.run("closeLoom()");
    expect(doorOpen()).toBe(true);
    expect(f.window.location.hash, "the door is still on screen").toBe("#/module/stay");
    f.run("closeDoor()");
    expect(f.window.location.hash).toBe("");
  });

  it("an address for a missing place leaves the open place named, since it stays on screen", () => {
    f.run("openPanel('greenhouse')");
    f.post({ type: "goto", hash: "#/place/no-such-place" });
    expect(f.run<string | null>("panelKey")).toBe("greenhouse");
    expect(f.window.location.hash).toBe("#/place/greenhouse");
    expect(f.routes().at(-1)).toBe("#/place/greenhouse");
    f.run("document.getElementById('panelClose').click()");
  });

  it("threw nothing along the way", () => {
    expect(f.uncaught).toEqual([]);
  });
});

/*
 * D7 (Rye, 2026-10-02): a lens is part of the address. Before, a reload came
 * back on Now whatever the visitor had on: measured on this branch, Vision
 * then F5 gave `/map` and mode `now`.
 */
describe("the lens is part of the address", () => {
  let f: Framed;
  beforeAll(async () => {
    f = framed();
    f.post({ type: "config" });
    await settle(1000);
  });
  afterAll(() => f?.window.close());

  const lens = () => f.run<{ mode: string; org: boolean; flows: boolean }>("({mode,org:orgOn,flows:flowsOn})");
  const click = (id: "lyNow" | "lyVision" | "lyOrg" | "lyFlows") =>
    (f.window.document.getElementById(id) as HTMLButtonElement).click();

  it("a lens a visitor turns on is written into the address and sent to the shell", () => {
    f.sent.length = 0;
    click("lyVision");
    expect(f.window.location.hash).toBe("#lens=vision");
    expect(f.routes().at(-1)).toBe("#lens=vision");
    click("lyOrg");
    expect(f.window.location.hash).toBe("#lens=vision,org");
  });

  it("rides on the end of whatever is open, and keeps riding when it closes", () => {
    f.run("openPanel('greenhouse')");
    expect(f.window.location.hash).toBe("#/place/greenhouse&lens=vision,org");
    f.run("openLoom()");
    expect(f.window.location.hash).toBe("#/loom&lens=vision,org");
    f.run("closeLoom()");
    expect(f.window.location.hash).toBe("#/place/greenhouse&lens=vision,org");
    f.run("document.getElementById('panelClose').click()");
    expect(f.window.location.hash).toBe("#lens=vision,org");
  });

  it("Now and the toggles take it back off", () => {
    click("lyNow");
    click("lyOrg");
    expect(lens()).toEqual({ mode: "now", org: false, flows: false });
    expect(f.window.location.hash).toBe("");
  });

  it("an address puts its lens on, and an address without one takes it off", () => {
    f.post({ type: "goto", hash: "#/loom&lens=flows" });
    expect(f.run<boolean>("document.body.classList.contains('loom')")).toBe(true);
    expect(lens()).toEqual({ mode: "now", org: false, flows: true });
    expect(f.window.document.getElementById("lyFlows")?.classList.contains("on"), "the button agrees").toBe(true);
    f.post({ type: "goto", hash: "#/place/kitchen" });
    expect(lens()).toEqual({ mode: "now", org: false, flows: false });
    expect(f.window.location.hash).toBe("#/place/kitchen");
    f.run("document.getElementById('panelClose').click()");
  });

  it("threw nothing along the way", () => {
    expect(f.uncaught).toEqual([]);
  });
});

describe("a reload comes back seeing what the visitor saw", () => {
  it("a place seen through Vision opens as it was", async () => {
    const f = framed("#/place/greenhouse&lens=vision&skipIntro");
    f.post({ type: "config" });
    await settle(1200);
    expect(f.run<string | null>("panelKey")).toBe("greenhouse");
    expect(f.run<string>("mode")).toBe("vision");
    expect(f.window.document.getElementById("lyVision")?.classList.contains("on")).toBe(true);
    expect(f.window.location.hash).toBe("#/place/greenhouse&lens=vision");
    expect(f.uncaught).toEqual([]);
    f.window.close();
  });

  it("a lens with nothing open comes back on the land, with nothing open", async () => {
    const f = framed("#lens=org,flows&skipIntro");
    f.post({ type: "config" });
    await settle(1200);
    expect(f.run<{ org: boolean; flows: boolean; mode: string }>("({mode,org:orgOn,flows:flowsOn})")).toEqual({
      mode: "now",
      org: true,
      flows: true,
    });
    expect(f.run<string | null>("panelKey")).toBeNull();
    expect(f.window.location.hash).toBe("#lens=org,flows");
    expect(f.uncaught).toEqual([]);
    f.window.close();
  });
});
