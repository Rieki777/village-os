/**
 * THE MAP FOLLOWS THE VILLAGE'S LIVE ORG: ITS CIRCLES, ITS SEATS, WHO HOLDS
 * THEM, AND WHAT IS OPEN, WITHOUT A RELOAD (Rye, D3).
 *
 * "We need to wire it up so the map can realtime update to new seats, and
 * circle structures, etc." Until this change the map drew the published
 * scene's own sixteen seats, typed into the map, and on 2026-10-01 not one of
 * them was among the village's twenty-five roles (F03). The village's own
 * circles never reached the land at all: the halos were the map's eleven
 * words (Land, Building, Gathering...), none of them a circle the village has.
 *
 * The shell now pushes the village's circles and active seats on the `lens`
 * message, and pushes again whenever they change while the map is open
 * (client/src/components/map/orgFollow.ts, server/routes/mapOrg.ts). This
 * file plays those pushes into the real artifact in jsdom and reads what the
 * map then shows and offers:
 *
 *   - a seat sits at its circle's home, and a circle's home is the place the
 *     founder gave that circle in build mode, published with the land;
 *   - a circle with no home, and its seats, are listed as not yet placed and
 *     are drawn nowhere;
 *   - a second push adds a new seat to an open place, and takes a removed
 *     one away, with the reader still on the tab they were reading;
 *   - none of it is ever written into the scene a publish sends.
 *
 * Values cross into the window by message only. Nothing is spliced into a
 * string the artifact evaluates: every `run` below is a fixed expression.
 *
 * WHAT THIS CANNOT SEE. Pixels, and the shell's own timing. The rings and
 * satellites are read off the lens's own placement functions, the same ones
 * the frame draws from, and the poll interval is held by orgFollow.test.ts
 * and by a Playwright run against a local server (see the commit).
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
    run: <T>(src: string) => window.eval(src) as T,
    post(data) {
      const own = window.eval("JSON").parse(JSON.stringify(data));
      window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
    },
    close: () => window.close(),
  };
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/* ── The village, as /api/map/org would answer it ─────────────────────────── */

const SOIL = { id: "regen-ag-circle", name: "Regenerative Agriculture Circle", parentCircleId: null, status: "active", colour: "#6fae52" };
const OUTREACH = { id: "outreach-growth-circle", name: "Outreach & Growth Circle", parentCircleId: null, status: "active", colour: "#7f9fd0" };
const role = (id: string, name: string, circleId: string | null, over: Record<string, unknown> = {}) => ({
  id, name, circleId, state: "open", seats: 1, holderCount: 0, archetypes: [], description: `The ${name}'s aim.`, holders: [],
  ...over,
});
const LAND_STEWARD = role("land-steward", "Land Steward", SOIL.id);
const SEED_KEEPER = role("seed-keeper", "Seed Keeper", SOIL.id, { state: "filled", holderCount: 1, holders: ["Ana"] });
const MARKETING = role("marketing-steward", "Marketing Steward", OUTREACH.id);
const COMPOST = role("compost-lead", "Compost Lead", SOIL.id);
/** A seat the published scene draws under the same name: it stays where the scene put it. */
const DRAWN = role("greenhouse-steward", "Greenhouse Steward", OUTREACH.id, { state: "filled", holderCount: 1, holders: ["Bo"] });

const HOME = "greenhouse";
const lens = (roles: unknown[], circles: unknown[] = [SOIL, OUTREACH]) => ({ type: "lens", party: [], circles, roles });

/** The artifact's own seed, exported, with the greenhouse given to the village's soil circle. */
let SCENE_BOUND: any;
let SCENE_SECOND: any;

beforeAll(async () => {
  const m = boot();
  await settle(200);
  const seed = clone(m.run<any>("buildExportJSON()"));
  m.close();
  SCENE_BOUND = clone(seed);
  const gh = SCENE_BOUND.map_structures.find((s: any) => s.key === HOME);
  gh.circle_id = SOIL.id;
  // And a second publish that gives the outreach circle the gate as its home.
  SCENE_SECOND = clone(SCENE_BOUND);
  SCENE_SECOND.map_structures.find((s: any) => s.key === "gate").circle_id = OUTREACH.name;
});

/* A new version for a new publish: the map skips a scene it already holds at that version. */
const config = (scene: unknown, sceneVersion = 7) => ({ type: "config", scene, sceneVersion });

/* Fixed expressions, read once per state. */
const SEATS_AT_HOME = "seatsAt('greenhouse').map(x=>x.s)";
const ATTN = "attnItems().map(x=>x.h).filter(h=>h.includes('Seat'))";
const HALOS = "roleHomes('now').map(h=>({k:h.k,circles:h.circles}))";
const SATS = "(()=>{const m=roleSeatsBy(),o={};for(const k of Object.keys(m))o[k]=m[k].map(x=>x.s);return o})()";

it("the seed is what this file says it is: the greenhouse is the Land circle's, and draws seats of its own", () => {
  const m = boot();
  try {
    expect(m.run<string>("BY.greenhouse.circle")).toBe("Land");
    expect(m.run<string[]>(SEATS_AT_HOME).length).toBeGreaterThan(0);
  } finally {
    m.close();
  }
});

describe("the village's org, pushed into a map whose greenhouse the founder gave to a village circle", () => {
  let m: Booted;
  let first: {
    home: string[];
    attn: string[];
    halos: { k: string; circles: string[] }[];
    sats: Record<string, string[]>;
    rows: { name: string; who: string; held: boolean; hand: boolean }[];
    wall: string;
    key: { hidden: boolean; text: string };
    exported: string[];
    head: string;
  };
  let second: { home: string[]; attn: string[]; rows: string[]; tab: number; wall: string };
  let third: { gateHome: string[]; wall: string; halos: string[] };
  let withoutCircles: { halos: number };

  const seatRows = () =>
    [...m.window.document.querySelectorAll<HTMLElement>("#panelBody .seatrow")].map((r) => ({
      name: r.querySelector("b")?.textContent ?? "",
      who: r.querySelector(".who")?.textContent ?? "",
      held: !!r.querySelector(".held"),
      hand: !!r.querySelector("a.btn"),
    }));
  const wallText = () => {
    m.run("buildWall()");
    return m.window.document.getElementById("wallList")?.textContent ?? "";
  };

  beforeAll(async () => {
    m = boot();
    await settle(200);
    m.post(config(SCENE_BOUND));
    await settle(50);
    m.post(lens([LAND_STEWARD, SEED_KEEPER, MARKETING, DRAWN]));
    m.run("openPanel('greenhouse',2)");
    const key = m.window.document.getElementById("roleUnplaced") as HTMLButtonElement | null;
    first = {
      home: m.run<string[]>(SEATS_AT_HOME),
      attn: m.run<string[]>(ATTN),
      halos: m.run(HALOS),
      sats: m.run(SATS),
      rows: seatRows(),
      wall: wallText(),
      key: { hidden: key?.hidden ?? true, text: key?.textContent ?? "" },
      exported: m.run<string[]>("buildExportJSON().org_roles.map(r=>r.role)"),
      head: m.window.document.querySelector("#panelHead .sub")?.textContent ?? "",
    };

    // The org tools add a seat and retire another while the Seats tab is open.
    m.post(lens([SEED_KEEPER, MARKETING, DRAWN, COMPOST]));
    second = {
      home: m.run<string[]>(SEATS_AT_HOME),
      attn: m.run<string[]>(ATTN),
      rows: seatRows().map((r) => r.name),
      tab: [...(m.window.document.getElementById("tabs")?.children ?? [])].findIndex((b) => b.classList.contains("on")),
      wall: wallText(),
    };

    // The founder publishes a land that gives the outreach circle the gate.
    m.post(config(SCENE_SECOND, 8));
    await settle(50);
    third = {
      gateHome: m.run<string[]>("seatsAt('gate').map(x=>x.s)"),
      wall: wallText(),
      halos: m.run<{ k: string }[]>(HALOS).map((h) => h.k),
    };
  });
  afterAll(() => m?.close());

  it("draws the village's seats at the greenhouse, the soil circle's home", () => {
    expect(first.home).toEqual(expect.arrayContaining(["Land Steward", "Seed Keeper"]));
    expect(first.sats[HOME]).toEqual(expect.arrayContaining(["Land Steward", "Seed Keeper"]));
  });

  it("keeps a seat the scene already draws by name where the scene put it", () => {
    expect(first.home).toContain("Greenhouse Steward");
    expect(first.home.filter((n) => n === "Greenhouse Steward")).toHaveLength(1);
    // And says who holds it, from the village's row.
    expect(first.rows.find((r) => r.name === "Greenhouse Steward")?.who).toBe("Held by Bo");
  });

  it("rings the village's circle at its home, and none of the map's own eleven", () => {
    expect(first.halos).toEqual([{ k: HOME, circles: [SOIL.name] }]);
  });

  it("draws no seat the village does not keep", () => {
    const drawn = Object.values(first.sats).flat();
    // Nursery Keeper is a seat the seed draws at the greenhouse, and no role of the village's.
    expect(first.home).toContain("Nursery Keeper");
    expect(drawn).not.toContain("Nursery Keeper");
  });

  it("lists the village's seats before the seats the map drew that the village does not keep", () => {
    const at = (n: string) => first.rows.findIndex((r) => r.name === n);
    expect(at("Land Steward")).toBeGreaterThanOrEqual(0);
    expect(at("Nursery Keeper")).toBeGreaterThan(at("Land Steward"));
    expect(at("Nursery Keeper")).toBeGreaterThan(at("Seed Keeper"));
  });

  it("says who holds a seat, and offers a hand only on an open one", () => {
    expect(first.rows.find((r) => r.name === "Seed Keeper")).toMatchObject({ who: "Held by Ana", held: true, hand: false });
    expect(first.rows.find((r) => r.name === "Land Steward")).toMatchObject({ who: "Nobody holds this seat yet", held: false, hand: true });
  });

  it("names the circle the way the village names it, on the place and on its seats", () => {
    expect(first.head.startsWith(SOIL.name)).toBe(true);
    expect(first.head).not.toContain("Circle circle");
  });

  it("offers an open placed seat in What needs hands, and never one with no place", () => {
    expect(first.attn).toContain("⛨ Seat open: Land Steward");
    expect(first.attn.some((h) => h.includes("Marketing Steward"))).toBe(false);
  });

  it("lists a seat whose circle has no home, and that circle, as not placed yet", () => {
    expect(first.wall).toContain("the village's seats, not placed on the land yet");
    expect(first.wall).toContain("Marketing Steward");
    expect(first.wall).toContain("circles with no home on the land yet");
    expect(first.wall).toContain(OUTREACH.name);
    expect(first.key).toEqual({ hidden: false, text: "1 seat not placed yet" });
  });

  it("never writes a live seat into the scene a publish sends", () => {
    expect(first.exported).not.toContain("Land Steward");
    expect(first.exported).not.toContain("Seed Keeper");
    expect(first.exported).toContain("Greenhouse Steward");
  });

  it("adds a seat the org tools created, and takes away one they retired, on the open Seats tab", () => {
    expect(second.home).toContain("Compost Lead");
    expect(second.home).not.toContain("Land Steward");
    expect(second.rows).toContain("Compost Lead");
    expect(second.rows).not.toContain("Land Steward");
    expect(second.tab, "the reader is still on Seats").toBe(2);
    expect(second.attn).toContain("⛨ Seat open: Compost Lead");
    expect(second.attn.some((h) => h.includes("Land Steward"))).toBe(false);
  });

  it("moves a circle's seats onto the land the moment a published scene gives it a home, by name as well as by id", () => {
    expect(third.gateHome).toContain("Marketing Steward");
    expect(third.wall).not.toContain("the village's seats, not placed on the land yet");
    expect(third.wall).not.toContain("circles with no home on the land yet");
    expect(third.halos).toEqual(expect.arrayContaining([HOME, "gate"]));
  });

  it("threw nothing", () => {
    expect(m.uncaught).toEqual([]);
  });

  describe("and a shell that sends no circles (an older shell, or a refused read)", () => {
    beforeAll(async () => {
      const old = boot();
      await settle(200);
      old.post(config(SCENE_BOUND));
      await settle(50);
      old.post({ type: "lens", party: [], roles: [{ name: "Greenhouse Steward", state: "filled", archetypes: [] }] });
      withoutCircles = { halos: old.run<unknown[]>(HALOS).length };
      expect(old.uncaught).toEqual([]);
      old.close();
    });
    it("keeps the map's own rings, exactly as before this change", () => {
      expect(withoutCircles.halos).toBeGreaterThan(5);
    });
  });
});

describe("the inspector's circle picker, in build mode", () => {
  let m: Booted;
  let options: { value: string; label: string; selected: boolean }[];
  let help: string;
  beforeAll(async () => {
    m = boot();
    await settle(200);
    m.post(config(SCENE_BOUND));
    await settle(50);
    m.post(lens([LAND_STEWARD, MARKETING]));
    m.run("openInspect('greenhouse')");
    const sel = m.window.document.getElementById("iCircle") as HTMLSelectElement;
    options = [...sel.options].map((o) => ({ value: o.value, label: o.textContent ?? "", selected: o.selected }));
    help = m.window.document.querySelector(".insp-h-circle")?.textContent ?? "";
  });
  afterAll(() => m?.close());

  it("offers the village's circles by id, with the place's own circle chosen", () => {
    expect(options.map((o) => o.value)).toEqual(["", SOIL.id, OUTREACH.id]);
    expect(options.find((o) => o.selected)?.value).toBe(SOIL.id);
    expect(options.find((o) => o.value === OUTREACH.id)?.label).toBe(OUTREACH.name);
  });

  it("says where the circle's seats gather", () => {
    expect(help).toContain(`This is the ${SOIL.name}'s home on the land`);
  });

  it("threw nothing", () => {
    expect(m.uncaught).toEqual([]);
  });
});
