/**
 * THE ARTIFACT'S HALF OF ENTERING THE LAND: it hands its land over once, and
 * its painterly bake stays off the thread the visitor is using.
 *
 * Two defects measured in Chromium on 2026-10-01, both on every entry:
 *
 *   F66. Inside the shell the artifact drew the seed scene it ships with, and
 *        the village's published land replaced it 0.5 to 2.6 s later with 11
 *        of 22 buildings jumping and a 23rd appearing. The shell now covers
 *        the frame until the artifact posts `{type:'land-ready'}`, which it
 *        does once, after applying the first `{type:'config'}`. On a desk the
 *        arrival glide waits for the same moment, or it flew half its path
 *        under the cover where nobody could see it. The shell's half is in
 *        client/src/pages/LivingMap.shell.test.tsx.
 *
 *   F67. bakePainted, the Kuwahara and Reinhard bake behind the Painted
 *        terrain chip, ran whole inside one timer on every boot: a 1.4 to
 *        1.9 s task on a desk and 5 to 7 s on a phone at 4x, on the thread the
 *        shell shares. It now runs in a worker made from its own source, and
 *        where no worker can be made, in short slices.
 *
 * WHAT THIS CAN SEE. That the hand-over happens once and starts the arrival;
 * that the bake's arithmetic is the same picture, byte for byte, as the bake
 * it replaced (the hashes below were taken from that bake on the same input);
 * that the worker's source stands on its own; and that in a page with no
 * Worker (jsdom has none) the fallback gives the thread back between slices.
 *
 * WHAT IT CANNOT. Pixels on screen, the cover itself, and the real worker:
 * those were measured in Chromium with an entry probe (seed frames seen by the
 * visitor 3 to 6 before, 0 after; the longest task after Enter 1575 to
 * 2404 ms before, 166 to 183 ms after; the Painted chip ready 0.8 s after
 * load, from a worker).
 *
 * The platform stubs mirror mapArtifactBoot.test.ts, which says why each one
 * exists. The parent is replaced before the scripts run, as in
 * mapArtifactRoute.test.ts, so `inShell()` is true and the posts land here.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
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
  /** Every message the artifact posted to its parent, in order. */
  sent: { type?: string }[];
  run<T>(src: string): T;
  /** A message from the shell, in the shape LivingMap.tsx posts it. */
  post(data: Record<string, unknown>): void;
  landReady(): number;
}

/** The artifact at `hash`, on a desk, framed by a stand-in parent unless `standalone`. */
function boot(hash: string, { standalone = false } = {}): Booted {
  const uncaught: unknown[] = [];
  const sent: { type?: string }[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => {
    if (e.type === "unhandled-exception") uncaught.push(e.cause ?? e);
  });
  const parent = { postMessage: (m: { type?: string }) => sent.push(JSON.parse(JSON.stringify(m))) };
  const { window } = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: `http://localhost/grounds/index.html${hash}`,
    virtualConsole,
    beforeParse(w) {
      w.addEventListener("error", (ev) => uncaught.push(ev.error ?? ev.message));
      Object.assign(w, { innerWidth: 1440, innerHeight: 900 });
      stubTheMissingPlatform(w);
      if (!standalone) Object.defineProperty(w, "parent", { configurable: true, get: () => parent });
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
    landReady: () => sent.filter((m) => m.type === "land-ready").length,
  };
}

type Cam = { x: number; y: number; z: number };
const camOf = (b: Booted) => b.run<Cam>("({x:Math.round(cam.x),y:Math.round(cam.y),z:+cam.z.toFixed(2)})");
/** The camera the artifact boots with, and where the desk arrival glide starts. */
const BOOT_CAM = { x: 900, y: 640, z: 0.72 };
const GLIDE_START = { x: 430, y: 560, z: 1.15 };

describe("the land is handed over once, inside the shell (F66)", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro");
    // Long enough for the 0.625 s arrival glide to have flown, had it started.
    await settle(1200);
  });
  afterAll(() => b?.window.close());

  it("booted and announced itself (the positive control)", () => {
    expect(b.uncaught).toEqual([]);
    expect(b.sent.some((m) => m.type === "grounds-ready")).toBe(true);
    expect(b.landReady(), "nothing is handed over before the shell has spoken").toBe(0);
  });

  it("holds the desk arrival under the cover until the land is handed over", () => {
    expect(camOf(b), "the glide flew where nobody could see it").toEqual(BOOT_CAM);
    expect(b.run<unknown>("travel")).toBeNull();
  });

  it("hands over with the first config, and the arrival starts from its first frame", () => {
    b.post({ type: "config" });
    expect(b.landReady()).toBe(1);
    expect(camOf(b)).toEqual(GLIDE_START);
    expect(b.run<boolean>("!!travel"), "the glide is under way").toBe(true);
  });

  it("hands over nothing again on a later config (a Village Settings save re-pushes it)", async () => {
    await settle(900);
    const landed = camOf(b);
    b.post({ type: "config" });
    expect(b.landReady()).toBe(1);
    expect(camOf(b), "the arrival does not fly a second time").toEqual(landed);
  });

  it("threw nothing along the way", () => {
    expect(b.uncaught).toEqual([]);
  });
});

/*
 * A CONFIG THAT LANDS LATE (round 4 sweep). The shell lifts its cover 10 s
 * after the frame loads even when no config has come (LOADED_GRACE_MS), and
 * the arrival kept waiting for the config. Measured in Chromium with
 * /api/map/config held 20 s: the visitor saw the boot backdrop with no
 * welcome, opened the Greenhouse at s14, and at s21 the late config reset the
 * camera and glided them away with the panel still open. With a config that
 * never came, no welcome at all. Now the shell says `uncovered` when its
 * grace lifts the cover, which runs the arrival without handing the land
 * over, and a visitor who has already taken the land keeps the camera: the
 * late hand-over says her welcome and moves nothing.
 */
describe("a config that lands after the cover has lifted", () => {
  const welcomed = (b: Booted) =>
    [...b.window.document.querySelectorAll("#maiaLog .mline")].filter((n) => /Welcome to the living map/.test(n.textContent ?? "")).length;

  it("runs the arrival and the welcome when the shell's grace uncovers the land", async () => {
    const b = boot("#skipIntro");
    try {
      await settle(600);
      expect(camOf(b), "still waiting (the case)").toEqual(BOOT_CAM);
      b.post({ type: "uncovered" });
      expect(camOf(b), "the glide starts from its first frame").toEqual(GLIDE_START);
      expect(b.landReady(), "uncovering is not handing the land over").toBe(0);
      await settle(1200);
      expect(welcomed(b), "her welcome").toBe(1);
      const landed = camOf(b);
      b.post({ type: "config" });
      expect(b.landReady()).toBe(1);
      expect(camOf(b), "the late config does not fly the arrival again").toEqual(landed);
      await settle(900);
      expect(welcomed(b), "and does not say it twice").toBe(1);
      expect(b.uncaught).toEqual([]);
    } finally {
      b.window.close();
    }
  });

  it("leaves the camera where the visitor took it when the config lands after they acted", async () => {
    const b = boot("#skipIntro");
    try {
      await settle(600);
      b.run("openPanel('greenhouse')");
      await settle(1200);
      const taken = camOf(b);
      expect(taken, "the visitor's own view").not.toEqual(BOOT_CAM);
      b.post({ type: "config" });
      expect(b.landReady()).toBe(1);
      expect(camOf(b), "no reset to the glide's start").toEqual(taken);
      expect(b.run<string | null>("panelKey")).toBe("greenhouse");
      await settle(900);
      expect(camOf(b), "and no glide afterwards").toEqual(taken);
      expect(welcomed(b), "her welcome is still said, once").toBe(1);
      expect(b.uncaught).toEqual([]);
    } finally {
      b.window.close();
    }
  });

  it("counts a hand on the land as taking it", async () => {
    const b = boot("#skipIntro");
    try {
      await settle(600);
      const scene = b.window.document.getElementById("scene") as HTMLElement;
      // jsdom has no pointer capture; the pan asks for it on the canvas.
      Object.assign(scene, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false });
      scene.dispatchEvent(new b.window.MouseEvent("pointerdown", { bubbles: true, clientX: 700, clientY: 400 }));
      scene.dispatchEvent(new b.window.MouseEvent("pointerup", { bubbles: true, clientX: 700, clientY: 400 }));
      b.window.dispatchEvent(new b.window.MouseEvent("pointerup", { bubbles: true, clientX: 700, clientY: 400 }));
      await settle(300);
      const taken = camOf(b);
      b.post({ type: "config" });
      expect(camOf(b), "no reset to the glide's start").toEqual(taken);
      expect(b.run<boolean>("!!travel"), "no glide").toBe(false);
      expect(b.uncaught).toEqual([]);
    } finally {
      b.window.close();
    }
  });
});

describe("standalone, nothing waits", () => {
  it("flies the arrival at boot, as it always did", async () => {
    const s = boot("#skipIntro", { standalone: true });
    try {
      await settle(1200);
      expect(s.uncaught).toEqual([]);
      expect(camOf(s), "the glide ran and landed").not.toEqual(BOOT_CAM);
      expect(s.run<unknown>("travel")).toBeNull();
    } finally {
      s.window.close();
    }
  });
});

/*
 * The bake's input, made here: gradients, blocks and noise, so every pass
 * (the variance windows, posterize, the edges and their percentile, the
 * tooth, the tone transfer) has something to bite on. The two hashes are of
 * the two plates the PREVIOUS bakePainted put on its canvases for exactly
 * these pixels, taken before it was rewritten.
 */
const BW = 1200;
const BH = 800;
function platePixels(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(BW * BH * 4);
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let y = 0; y < BH; y++) {
    for (let x = 0; x < BW; x++) {
      const i = (y * BW + x) * 4;
      const blk = ((x >> 5) + (y >> 5)) & 1;
      d[i] = (x * 255 / BW + blk * 40 + rnd() * 30) | 0;
      d[i + 1] = (y * 255 / BH + rnd() * 50) | 0;
      d[i + 2] = ((x ^ y) & 255) * 0.6 + rnd() * 20;
      d[i + 3] = 255;
    }
  }
  return d;
}
const PREVIOUS_BAKE = {
  f: "ff14a0716e4690e8979cbaca5b60f8d4ba56a6aaed3ceeef203c10d6c07cd01e",
  t: "76192995afef4fab9ba0cd79bd1c1df90388a3ff589cbe3f2949bd709be4565e",
};
const sha = (b: ArrayBuffer) => crypto.createHash("sha256").update(Buffer.from(b)).digest("hex");

describe("the painterly bake (F67)", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro");
    await settle(600);
  });
  afterAll(() => {
    // Stops the fallback's slices; the bake it replaced has no such counter.
    b?.run("typeof BAKE_GEN==='number'&&BAKE_GEN++");
    b?.window.close();
  });

  /*
   * The worker is the source text the page builds, run here with nothing
   * around it but a postMessage: no document, no globals from the page. So a
   * step that reached for one would throw here before it threw in a worker.
   * It runs in this realm because the page's own realm is slow at arithmetic.
   */
  it("runs on its own source in a worker, and paints the same picture as the bake it replaced", () => {
    const source = b.run<string>("bakeWorkerSource()");
    const replies: { f: ArrayBuffer; t: ArrayBuffer }[] = [];
    /* The source is run whole, never spliced into a longer string: the
       worker's one global, `onmessage`, is caught by a setter for the length
       of the call, the way a worker's own global would take it. */
    const caught: { onmessage?: (e: { data: unknown }) => void } = {};
    Object.defineProperty(globalThis, "onmessage", {
      configurable: true,
      get: () => caught.onmessage,
      set: (f: (e: { data: unknown }) => void) => {
        caught.onmessage = f;
      },
    });
    try {
      const worker = new Function("postMessage", source) as (post: (m: { f: ArrayBuffer; t: ArrayBuffer }) => void) => void;
      worker((m) => replies.push(m));
    } finally {
      delete (globalThis as { onmessage?: unknown }).onmessage;
    }
    const onmessage = caught.onmessage;
    if (!onmessage) throw new Error("the worker source set no onmessage");
    const donor = b.run<{ m: number[]; s: number[] }>("({m:PALETTE_DONOR.m.slice(),s:PALETTE_DONOR.s.slice()})");
    onmessage({ data: { px: platePixels().buffer, donor: { m: [...donor.m], s: [...donor.s] } } });
    expect(replies.length).toBe(1);
    expect({ f: sha(replies[0].f), t: sha(replies[0].t) }).toEqual(PREVIOUS_BAKE);
  }, 60_000);

  /*
   * jsdom has no Worker, so this is the fallback a browser that refuses one
   * would take. A heartbeat in this file's own timers measures the longest
   * stretch the page held the thread. The bake it replaced ran as one task:
   * 660 to 1290 ms here when measured, 1.4 to 1.9 s in Chromium. The slices held it
   * 87 ms at most here (a slice is 12 ms, plus one step and any collection
   * the step's arrays cause), so the bound leaves room for a loaded machine.
   */
  it("gives the thread back between slices where no worker can be made", async () => {
    let last = performance.now();
    let longest = 0;
    const beat = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 5);
    try {
      // Asked for, as the first opening of Your view asks (D31).
      b.run("satPlate={};askPaint()");
      for (let waited = 0; waited < 30_000 && !b.run<boolean>("paintReady"); waited += 100) await settle(100);
    } finally {
      clearInterval(beat);
    }
    expect(longest, "the longest stretch the page held the thread, in ms").toBeLessThan(400);
    // The end of the bake is the end it always had: the chip that offers it.
    expect(b.run<boolean>("paintReady")).toBe(true);
    expect(b.run<string>("document.getElementById('tmPaint').style.display"), "the Painted chip shows").toBe("");
    expect(b.uncaught).toEqual([]);
  }, 60_000);
});

/*
 * D31. The bake above ran on every visit, worker or not: about 1.5 s of CPU on
 * a desk and about 7 s on a phone at 4x, for a terrain behind a hidden chip in
 * a sheet most visitors never open. It now waits for the first opening of
 * Your view, where the terrain switch lives. The plate's arrival calls
 * bakePainted() exactly as the seed's onload and a village's setGround do.
 */
describe("the painterly bake waits until somebody opens the terrain switch (D31)", () => {
  it("bakes nothing when the plate arrives, and starts once, at the first Your view", async () => {
    const s = boot("#skipIntro");
    try {
      await settle(600);
      s.run("satPlate={};bakePainted()");
      const atArrival = s.run<number>("BAKE_GEN");
      s.run("openMask()");
      const afterOpen = s.run<number>("BAKE_GEN");
      s.run("closeMask();openMask()");
      const afterReopen = s.run<number>("BAKE_GEN");
      expect(atArrival, "bakes started by the plate arriving").toBe(0);
      expect(afterOpen, "bakes started by the first Your view").toBe(1);
      expect(afterReopen, "bakes started by opening it again").toBe(1);
      expect(s.uncaught).toEqual([]);
    } finally {
      // Stops the fallback's slices, as the F67 block does.
      s.run("BAKE_GEN++");
      s.window.close();
    }
  });
});

/*
 * N19. The shell's cover lifted on land-ready, which the artifact posted once
 * the config was applied, and nothing waited for the village's own ground:
 * MEASURED in Chromium with the village's picture held 8 s, the cover lifted
 * at 3.1 s over the seed's coast and its coordinate caption, and the
 * village's ground replaced them 7.6 s later in plain view. The ground rides
 * in the config now (client/src/components/map/landGround.ts), and the
 * hand-over waits for it. jsdom loads no pictures, so Image is a stand-in
 * the test decodes, or fails, by hand.
 */
describe("the cover waits for the village's own ground (N19)", () => {
  interface Pic {
    src: string;
    onload: null | (() => void);
    onerror: null | (() => void);
  }
  function bootWithPictures(hash: string): Booted & { pictures: Pic[] } {
    const pictures: Pic[] = [];
    const uncaught: unknown[] = [];
    const sent: { type?: string }[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (e) => {
      if (e.type === "unhandled-exception") uncaught.push(e.cause ?? e);
    });
    const parent = { postMessage: (m: { type?: string }) => sent.push(JSON.parse(JSON.stringify(m))) };
    const { window } = new JSDOM(html, {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      url: `http://localhost/grounds/index.html${hash}`,
      virtualConsole,
      beforeParse(w) {
        w.addEventListener("error", (ev) => uncaught.push(ev.error ?? ev.message));
        Object.assign(w, { innerWidth: 1440, innerHeight: 900 });
        stubTheMissingPlatform(w);
        Object.defineProperty(w, "parent", { configurable: true, get: () => parent });
        (w as unknown as { Image: unknown }).Image = class {
          onload: null | (() => void) = null;
          onerror: null | (() => void) = null;
          decoding = "";
          width = 1200;
          height = 800;
          private s = "";
          get src() {
            return this.s;
          }
          set src(v: string) {
            this.s = v;
            pictures.push(this as unknown as Pic);
          }
        };
      },
    });
    return {
      window,
      uncaught,
      sent,
      pictures,
      run: <T>(src: string) => window.eval(src) as T,
      post(data) {
        const own = window.eval("JSON").parse(JSON.stringify(data));
        window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
      },
      landReady: () => sent.filter((m) => m.type === "land-ready").length,
    };
  }
  const ELSEWHERE = { core: { url: "/uploads/land/core.png" }, frame: { spanM: 1600, seed: false, centre: null } };
  const village = (b: { pictures: Pic[] }) => b.pictures.filter((p) => p.src === ELSEWHERE.core.url);
  const ground = (b: Booted) => b.run<{ source: string; seedGeography: boolean; caption: boolean }>(
    "({source:groundSource(),seedGeography:groundHas().seedGeography,caption:groundHas().caption})",
  );

  it("holds the hand-over while the village's picture decodes, with the seed's geography already down", async () => {
    const b = bootWithPictures("#skipIntro");
    try {
      await settle(300);
      b.post({ type: "config", ground: ELSEWHERE });
      expect(village(b).length, "the village's picture was asked for").toBe(1);
      expect(b.landReady(), "handed over before the village's ground has drawn").toBe(0);
      expect(ground(b), "under the cover, while it decodes").toEqual({ source: "vector", seedGeography: false, caption: false });
      village(b)[0].onload?.();
      expect(b.landReady()).toBe(1);
      expect(ground(b).source).toBe("village");
      // Every Village Settings save re-sends the config, picture and all.
      b.post({ type: "config", ground: ELSEWHERE });
      expect(village(b).length, "the same picture is not loaded twice").toBe(1);
      expect(b.landReady()).toBe(1);
      expect(b.uncaught).toEqual([]);
    } finally {
      b.window.close();
    }
  });

  it("loads a picture sent ahead once, and the config's cover still waits for it", async () => {
    const b = bootWithPictures("#skipIntro");
    try {
      await settle(300);
      b.post({ type: "ground", ...ELSEWHERE });
      b.post({ type: "config", ground: ELSEWHERE });
      expect(village(b).length, "one download for the two messages").toBe(1);
      expect(b.landReady(), "waiting for the picture sent ahead").toBe(0);
      village(b)[0].onload?.();
      expect(b.landReady()).toBe(1);
      expect(ground(b).source).toBe("village");
      expect(b.uncaught).toEqual([]);
    } finally {
      b.window.close();
    }
  });

  it("hands over onto the honest floor when the picture fails", async () => {
    const b = bootWithPictures("#skipIntro");
    try {
      await settle(300);
      b.post({ type: "config", ground: ELSEWHERE });
      expect(b.landReady()).toBe(0);
      village(b)[0].onerror?.();
      expect(b.landReady()).toBe(1);
      expect(ground(b)).toEqual({ source: "vector", seedGeography: false, caption: false });
      expect(b.uncaught).toEqual([]);
    } finally {
      b.window.close();
    }
  });

  it("hands over after GROUND_WAIT_MS when the picture never answers", async () => {
    const b = bootWithPictures("#skipIntro");
    try {
      await settle(300);
      const wait = b.run<number>("GROUND_WAIT_MS");
      b.post({ type: "config", ground: ELSEWHERE });
      await settle(wait - 1500);
      expect(b.landReady(), "still waiting").toBe(0);
      await settle(2000);
      expect(b.landReady()).toBe(1);
      expect(b.uncaught).toEqual([]);
    } finally {
      b.window.close();
    }
  }, 30_000);

  it("waits for nothing when the config carries no ground (a village that keeps the seed)", async () => {
    const b = bootWithPictures("#skipIntro");
    try {
      await settle(300);
      b.post({ type: "config" });
      expect(b.landReady()).toBe(1);
      expect(ground(b).seedGeography, "the seed is the village's ground here").toBe(true);
    } finally {
      b.window.close();
    }
  });
});
