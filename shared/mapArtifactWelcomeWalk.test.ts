/**
 * THE WELCOME WALK IS THE VILLAGE'S OWN, OR THERE IS NONE.
 *
 * Rye, 2026-10-02: "Onboarding is something that founders should do and
 * really personalize and put their spirit into it. So just add this to a
 * journey to launch that's suggested remove the example journey for now."
 *
 * What the map does about it, each block below run against the real artifact:
 *
 *   - the seed's example walk (j1, Maia's monologue about another village's
 *     land) is offered to nobody, and neither is anything else until the
 *     village has written a walk;
 *   - once the shell pushes the village's walk, every door offers it, and it
 *     walks the village's stops in the village's words, never a seed line;
 *   - her first line greets and says how the map moves, and claims nothing,
 *     until the village writes a welcome, which she then says instead;
 *   - the four lines that promised "everything you see traces to something
 *     true" promise it no longer.
 *
 * HOW IT RUNS. The artifact boots in jsdom with the platform it lacks stubbed,
 * as in mapArtifactJourneys.test.ts, which says why each stub exists, on the
 * same fast clock. "In the shell" means `window.parent` is a stand-in that
 * keeps what the map posts, which is exactly what the map's inShell() asks,
 * and the shell's {type:'config'} is dispatched the way a postMessage from
 * the same origin arrives.
 *
 * NO VALUE IS EVER INTERPOLATED INTO CODE THE PAGE EVALUATES. Every string
 * handed to `run` is a constant; a value a probe needs travels on a window
 * property instead.
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
  VirtualConsole: new () => {
    on(event: "jsdomError", listener: (e: Error & { type?: string; cause?: unknown }) => void): void;
  };
}
const { JSDOM, VirtualConsole } = createRequire(import.meta.url)("jsdom") as Jsdom;

/** How much faster than real time the artifact's timers and Date.now run. */
const SPEED = 20;
const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

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
  window.Element.prototype.scrollIntoView = function () {};
}

/** The fast clock: every delay the artifact asks for, and Date.now, at SPEED. */
function fastClock(window: ArtifactWindow) {
  const setT = window.setTimeout.bind(window);
  const setI = window.setInterval.bind(window);
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) =>
    setT(fn, (Number(ms) || 0) / SPEED, ...rest)) as typeof window.setTimeout;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) =>
    setI(fn, (Number(ms) || 0) / SPEED, ...rest)) as typeof window.setInterval;
  const now = window.Date.now.bind(window.Date);
  const t0 = now();
  window.Date.now = () => t0 + (now() - t0) * SPEED;
}

interface Booted {
  window: ArtifactWindow;
  doc: Document;
  uncaught: string[];
  /** What the map posted to the shell, when it was booted in one. */
  posted: Array<Record<string, unknown>>;
  run<T>(src: string): T;
  /** A message from the shell, arriving the way a same-origin postMessage does. */
  post(data: Record<string, unknown>): void;
  close(): void;
}

function boot(hash: string, viewport: { width: number; height: number }, opts: { shell?: boolean } = {}): Booted {
  const uncaught: string[] = [];
  const posted: Array<Record<string, unknown>> = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => {
    if (e.type !== "not-implemented") uncaught.push(String(e.cause ?? e.message));
  });
  const { window } = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: `http://localhost/grounds/index.html${hash}`,
    virtualConsole,
    beforeParse(w) {
      w.addEventListener("error", (ev) => uncaught.push(String(ev.error ?? ev.message)));
      Object.assign(w, { innerWidth: viewport.width, innerHeight: viewport.height });
      stubTheMissingPlatform(w);
      fastClock(w);
      if (opts.shell) {
        const shell = { postMessage: (m: Record<string, unknown>) => posted.push(m) };
        Object.defineProperty(w, "parent", { configurable: true, get: () => shell });
      }
    },
  });
  return {
    window,
    doc: window.document,
    uncaught,
    posted,
    run: <T,>(src: string) => evalIn<T>(window, src),
    post(data) {
      // Through the window's own JSON, so the map holds objects of its own
      // realm, the way a structured clone arrives.
      const own = ownCopy(window, data);
      window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
    },
    close: () => window.close(),
  };
}

async function until(test: () => boolean, realMs: number): Promise<boolean> {
  const end = Date.now() + realMs;
  while (Date.now() < end) {
    if (test()) return true;
    await settle(20);
  }
  return test();
}

const lines = (b: Booted) => [...b.doc.querySelectorAll<HTMLElement>("#maiaLog .mline")];
const logText = (b: Booted) => lines(b).map((d) => d.textContent ?? "").join("\n");
/** The lines that are stops: each carries the "n of total" counter. */
const stopLines = (b: Booted) => lines(b).filter((d) => d.querySelector(".jrow .jn"));
/** What a stop says about itself: the line, less its bold title and its row of answers. */
const narration = (stop: HTMLElement) =>
  [...stop.querySelectorAll(":scope > div")]
    .filter((d) => !d.classList.contains("jrow"))
    .map((d) => d.textContent ?? "")
    .join(" ")
    .trim();
async function landed(b: Booted, n: number): Promise<HTMLElement> {
  await until(() => stopLines(b).length >= n, 30000);
  const line = stopLines(b)[n - 1];
  expect(line, `stop ${n} landed`).toBeTruthy();
  return line as HTMLElement;
}
const tourChip = (b: Booted) => b.doc.querySelector<HTMLElement>('#maiaActions .chip[data-say="tour"]');

/** A village's own walk: three stops on the land, one whose place is not drawn, one with no words. */
const WALK = [
  { id: "v-gate", structure_key: "gate", title: "Our gate", body: "We hung this gate together in our first spring.", gesture: "none" },
  { id: "v-nowhere", structure_key: "not-on-this-land", title: "A place still on paper", body: "Soon.", gesture: "none" },
  { id: "v-ponds", structure_key: "ponds", title: "The ponds", body: "", gesture: "none" },
  { id: "v-council", structure_key: "council", title: "Where we decide", body: "Every circle brings its question here.", gesture: "none" },
];
const WELCOME = "Hello from the people who live here. <img src=x onerror=\"window.__welcomeRan=1\">";

/** Every word the seed's example walk could say, read off the page. */
function seedWords(b: Booted): string[] {
  return b.run<string[]>(
    "[...Object.values(MAIA_STOPS),...(window.WALK_SEED||[]).map(w=>w.body)].filter(Boolean)",
  );
}

describe("with no walk written, nothing is offered and the example never is", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await until(() => /Welcome to the living map/.test(logText(b)), 15000);
  });
  afterAll(() => b?.close());

  it("has no walk, and no newcomer's journey to name", () => {
    expect(b.run<boolean>("welcomeWalkOn()")).toBe(false);
    expect(b.run<string | null>("welcomeJourney()")).toBeNull();
    expect(tourChip(b), "the tour chip").toBeNull();
  });

  it("never plays the seed's example, whichever door asks", async () => {
    b.run("playJourney('j1')");
    b.run("startTour()");
    b.run("conciergeMatch('show me around')");
    await settle(200);
    expect(b.run<unknown>("JWALK"), "no walk is running").toBeNull();
    expect(logText(b)).toContain("There is no guided walk here yet.");
    expect(b.run<string>("MODULES.journeys.sample({})")).not.toContain("playJourney('j1')");
  });

  it("still offers and plays the other journeys (the control: the engine is on)", async () => {
    expect(b.run<string>("MODULES.journeys.sample({})")).toContain("Resident Journey");
    b.run("playJourney('j2')");
    await settle(200);
    expect(b.run<{ id: string } | null>("JWALK")?.id).toBe("j2");
    b.run("jEnd()");
  });

  it("greets plainly, says how the map moves, and promises nothing about the land", () => {
    const name = b.run<string>("SCENE.name");
    const welcome = lines(b).find((d) => /Welcome to the living map/.test(d.textContent ?? ""));
    expect(welcome?.textContent).toBe(
      `maiaWelcome to the living map of ${name}. Hover anything, and click any building to open its door.`,
    );
    expect(logText(b)).not.toMatch(/traces to something true/);
  });

  it("exports no walk, where it used to export the seed's as the village's", () => {
    expect(b.run<unknown[]>("buildExportJSON().walk.steps")).toEqual([]);
  });

  it("threw nothing", () => {
    expect(b.uncaught).toEqual([]);
  });
});

describe("the four lines that promised the land was true", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(200);
  });
  afterAll(() => b?.close());

  it("promise it no longer: the council stop, the Sanctuary card and the Now tip", () => {
    const said = b.run<{ council: string; sanctuary: string; now: string }>(
      "({council:MAIA_STOPS.council,sanctuary:(WALK_SEED.find(w=>w.structure_key==='sanctuary')||{}).body,now:document.getElementById('lyNow').getAttribute('data-tip')})",
    );
    for (const [where, words] of Object.entries(said)) {
      expect(words, where).toBeTruthy();
      expect(words, where).not.toMatch(/traces to something true|no truth dies|only what is/i);
    }
    expect(said.now).toBe("Now: the land as the map holds it today, with planned buildings left out.");
  });

  it("and the welcome, on a phone as on a desk", () => {
    for (const pocket of ["true", "false"]) {
      (b.window as unknown as { __pocket: boolean }).__pocket = pocket === "true";
      expect(b.run<string>("welcomeLine(window.__pocket)")).not.toMatch(/traces to something true/);
    }
  });
});

describe("in the shell, once the village has written its walk and welcome (desk)", () => {
  let b: Booted;
  let arrivedBefore = false;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK, { shell: true });
    await settle(300);
    // The arrival waits for the land, so nothing has greeted anybody yet.
    arrivedBefore = /Welcome to the living map|Hello from the people/.test(logText(b));
    b.post({ type: "config", walk: WALK, welcome: WELCOME });
    await until(() => /Hello from the people who live here/.test(logText(b)), 15000);
  });
  afterAll(() => b?.close());

  it("waits for the village's words before it greets", () => {
    expect(arrivedBefore, "greeted before the config arrived").toBe(false);
  });

  it("greets in the village's own words, as text, and offers the walk", () => {
    const greeting = lines(b).find((d) => /Hello from the people who live here/.test(d.textContent ?? ""));
    expect(greeting?.textContent).toBe(
      `maia${WELCOME} Hover anything, and click any building to open its door. Want the short walk?`,
    );
    expect(greeting?.querySelector("img"), "the welcome became markup").toBeNull();
    expect((b.window as unknown as { __welcomeRan?: number }).__welcomeRan).toBeUndefined();
    expect(logText(b)).not.toContain("Welcome to the living map");
  });

  it("puts the tour chip back, first in her dock", () => {
    expect(b.run<boolean>("welcomeWalkOn()")).toBe(true);
    expect(tourChip(b)).not.toBeNull();
    expect(b.doc.querySelector("#maiaActions .chip")).toBe(tourChip(b));
  });

  it("offers the village's walk at the Journeys door, and still never the example", () => {
    const door = b.run<string>("MODULES.journeys.sample({})");
    expect(door).toContain("playJourney('walk')");
    expect(door).not.toContain("playJourney('j1')");
    expect(door).toContain("3 of 4 steps placed");
  });

  describe("walking it", () => {
    const stops: { title: string; said: string }[] = [];
    let logged: string[] = [];
    let seed: string[] = [];
    beforeAll(async () => {
      seed = seedWords(b);
      b.run("startWalk(true)");
      for (let n = 1; n <= 3; n++) {
        const line = await landed(b, n);
        stops.push({ title: line.querySelector("b")?.textContent ?? "", said: narration(line) });
        if (n < 3) b.run("jNext()");
      }
      logged = b.run<string[]>("WALK_LOG.map(r=>r.step)");
      b.run("jNext()");
      await until(() => b.run<unknown>("JWALK") === null, 10000);
    });

    it("walks the stops that have a place, in the village's order, and passes the other by", () => {
      expect(stops.map((s) => s.title)).toEqual(["Our gate", "The ponds", "Where we decide"]);
    });

    it("says the village's words where it wrote some", () => {
      expect(stops[0].said).toBe(WALK[0].body);
      expect(stops[2].said).toBe(WALK[3].body);
    });

    it("says what is true at a stop it left without words, and never a seed line anywhere", () => {
      expect(stops[1].said.length, "the ponds said something").toBeGreaterThan(0);
      expect(seed.length, "the seed's words, read off the page").toBeGreaterThan(8);
      const heard = stops.filter((s) => seed.some((w) => s.said.includes(w)));
      expect(heard.map((s) => s.title), "stops that said a seed line").toEqual([]);
    });

    it("counts the run against the village's own step ids", () => {
      expect(logged).toEqual(["v-gate", "v-ponds", "v-council"]);
    });

    it("ends without pointing at a page of the site, which this walk does not have", () => {
      const endings = lines(b).map((d) => d.textContent ?? "").filter((t) => t.includes("The walk ends here"));
      expect(endings, "her closing line").toEqual(["maiaThe walk ends here. Wander wherever you like, and say my name when you want me."]);
    });
  });

  it("keeps the walk on a bare config, which is what the shell sends after a failed fetch", async () => {
    b.post({ type: "config" });
    await settle(50);
    expect(b.run<boolean>("welcomeWalkOn()")).toBe(true);
  });

  it("takes the walk and the welcome away when the founder clears them", async () => {
    b.post({ type: "config", walk: null, welcome: null });
    await settle(50);
    expect(b.run<boolean>("welcomeWalkOn()")).toBe(false);
    expect(tourChip(b), "the tour chip").toBeNull();
    expect(b.run<string>("MODULES.journeys.sample({})")).not.toContain("playJourney('walk')");
    expect(b.run<string>("welcomeLine(false)")).toMatch(/^Welcome to the living map of /);
  });

  it("threw nothing", () => {
    expect(b.uncaught).toEqual([]);
  });
});

describe("in the shell on a phone, when the village's words arrive after the boot", () => {
  let b: Booted;
  let before = "";
  beforeAll(async () => {
    b = boot("#hud=pocket&skipIntro", PHONE, { shell: true });
    // The pocket boot speaks 700 ms in, which is 35 ms on this clock.
    await settle(400);
    before = logText(b);
    b.post({ type: "config", walk: WALK, welcome: WELCOME });
    await until(() => /Hello from the people who live here/.test(logText(b)), 15000);
  });
  afterAll(() => b?.close());

  it("held her welcome until the land and the village's words were in", () => {
    expect(before).not.toContain("Welcome to the living map");
  });

  it("says the village's welcome, with how the land moves and the walk to take", () => {
    expect(logText(b)).toContain(
      `${WELCOME} The land is yours to move: drag it, pinch it, tap any building to open its door. Tap Take the walk and I will show you around.`,
    );
  });

  it("raises the walk offer, and the drawer carries the walk", () => {
    const offer = b.doc.getElementById("gresume");
    expect(offer?.classList.contains("on"), "the walk offer").toBe(true);
    expect(b.doc.getElementById("gresumeLab")?.textContent).toBe("Take the walk");
    b.run("renderDrawer()");
    expect(b.doc.querySelector('#pdrawer [data-pa="walk"]'), "Take the walk again").not.toBeNull();
  });

  it("threw nothing", () => {
    expect(b.uncaught).toEqual([]);
  });
});

/* The shell's grace lifts its cover 10 s after the frame loads when the map
   has said no land-ready, and tells the map `uncovered` (round 3). The phone's
   welcome waits for the village's words, so with a config that is late or
   never comes the visitor would stand on the land with no greeting at all. */
describe("in the shell on a phone, when the shell's grace lifts the cover before any config", () => {
  let b: Booted;
  let before = "";
  beforeAll(async () => {
    b = boot("#hud=pocket&skipIntro", PHONE, { shell: true });
    await settle(400);
    before = logText(b);
    b.post({ type: "uncovered" });
    await until(() => /Welcome to the living map/.test(logText(b)), 15000);
  });
  afterAll(() => b?.close());

  it("held her welcome while the cover was up", () => {
    expect(before).not.toContain("Welcome to the living map");
  });

  it("greets plainly once the visitor can see the land, with no config and no land-ready", () => {
    expect(logText(b)).toContain("The land is yours to move: drag it, pinch it, tap any building to open its door.");
    expect(b.posted.filter((m) => m.type === "land-ready"), "nothing was handed over").toEqual([]);
  });

  it("still raises the walk offer when the village's words come after", async () => {
    expect(b.doc.getElementById("gresume")?.classList.contains("on"), "no walk to offer yet").toBe(false);
    b.post({ type: "config", walk: WALK, welcome: WELCOME });
    await until(() => b.doc.getElementById("gresume")?.classList.contains("on") === true, 15000);
    expect(b.doc.getElementById("gresume")?.classList.contains("on"), "the walk offer").toBe(true);
  });

  it("threw nothing", () => {
    expect(b.uncaught).toEqual([]);
  });
});

describe("in the shell on a phone, with nothing written (the control)", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#hud=pocket&skipIntro", PHONE, { shell: true });
    await settle(400);
    b.post({ type: "config", walk: null, welcome: null });
    await until(() => /Welcome to the living map/.test(logText(b)), 15000);
  });
  afterAll(() => b?.close());

  it("greets plainly and offers no walk", () => {
    expect(logText(b)).toContain("The land is yours to move: drag it, pinch it, tap any building to open its door.");
    expect(logText(b)).not.toContain("Take the walk");
    expect(b.doc.getElementById("gresume")?.classList.contains("on")).toBe(false);
  });
});
