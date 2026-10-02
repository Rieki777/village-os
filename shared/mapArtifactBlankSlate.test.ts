/**
 * A VILLAGE WITH NOTHING PUBLISHED IS NOT DRAWN AS THE SEED'S LAND.
 *
 * The artifact ships one village's land baked in: its buildings, roads, water,
 * satellite plate, coast, place names and district names. Until this change a
 * village that had published nothing was handed `scene: null`, which the map
 * reads as "keep your own", so it drew all of that as the village's. The map
 * may never invent geography (Rye's standing ruling), and another village's
 * land at full fidelity is the plainest case of it.
 *
 * Two messages from the shell put it right, and this file plays both:
 *
 *   `scene: blankScene()` with `sceneVersion: 0`, when nothing is published.
 *     The seed's buildings, features, flows, seats, quests, threads and
 *     journeys come off the land, and the property line is the frame's edge.
 *
 *   `seedGround: false`, when the server says this village does not stand on
 *     the seed's own rectangle. The seed's plate, coast, place names, caption
 *     and district names come down, which the map already did under a village
 *     with its own picture and now does under one without.
 *
 * And the pathway the blank slate exists for: a draft an agent made from the
 * masterplan, offered on the blank board, opened, counted and published.
 *
 * Runs the real artifact in jsdom and plays the shell's side, as
 * mapArtifactDraftMark.test.ts does; the platform stubs are that file's. No
 * value is ever interpolated into evaluated source: what a case needs inside
 * the window is handed over as a window property.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blankScene, DRAFT_SCENE_VERSION, SCENE_WORLD } from "./mapFromMasterplan";

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

interface Asked {
  type: string;
  nonce?: string;
  scene?: { map_structures: { key: string }[]; [k: string]: unknown };
  baseVersion?: number;
  [k: string]: unknown;
}

interface Booted {
  window: ArtifactWindow;
  uncaught: unknown[];
  asked: Asked[];
  run<T>(src: string): T;
  post(data: Record<string, unknown>): void;
  close(): void;
}

function boot(): Booted {
  const uncaught: unknown[] = [];
  const asked: Asked[] = [];
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
      // Framed, so the map talks to a shell and keeps what it posts.
      const shell = { postMessage: (m: Asked) => asked.push(m) };
      Object.defineProperty(w, "parent", { configurable: true, get: () => shell });
    },
  });
  const post = (data: Record<string, unknown>) => {
    const own = window.eval("JSON").parse(JSON.stringify(data));
    window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
  };
  return { window, uncaught, asked, run: <T>(src: string) => window.eval(src) as T, post, close: () => window.close() };
}

/** What is on the land, counted from the map's own state. */
const land = (m: Booted) =>
  m.run<Record<string, number>>(
    "({structures:SCENE.structures.length,features:SCENE.features.length,flows:SCENE.flows.length," +
      "seats:SCENE.seats.length,quests:SCENE.quests.length,journeys:SCENE.journeys.length,threads:SCENE.threads.length})",
  );
const ground = (m: Booted) => m.run<Record<string, unknown>>("groundHas()");
/** The district a building's hover card names, which is seed geography too. */
const hoverPlace = (m: Booted) => {
  m.run("showHover(BY.gate,document.body)");
  return m.window.document.querySelector("#hovercard .circ")?.textContent ?? "";
};
/** Whether any of the seed's district names is on screen after a frame or two. */
const districtsShown = (m: Booted) =>
  m.run<number>("Object.keys(bEls).filter(k=>k.startsWith('d_')&&bEls[k].style.display!=='none').length");

it("the artifact still has the parts this guard drives (the positive control)", () => {
  expect(html).toContain("const seedGeography=");
  expect(html).toContain("function restoreScene(");
  expect(html).toContain("d.type!=='config'");
});

describe("the seed, untouched, while nobody has said otherwise", () => {
  let m: Booted;
  beforeAll(async () => {
    m = boot();
    await settle(200);
  });
  afterAll(() => m?.close());

  it("draws the seed's land and its geography, as every standalone open does", () => {
    const l = land(m);
    expect(l.structures).toBeGreaterThan(10);
    expect(l.features).toBeGreaterThan(10);
    expect(ground(m).seedGeography).toBe(true);
    expect(hoverPlace(m)).toMatch(/· The Arrival$/);
  });
});

describe("a village that has published nothing, on the board", () => {
  let m: Booted;
  let before: Record<string, number>;
  beforeAll(async () => {
    m = boot();
    await settle(200);
    before = land(m);
    m.post({ type: "config", scene: blankScene(), sceneVersion: 0, seedGround: false });
    await settle(100);
  });
  afterAll(() => m?.close());

  it("starts from the seed, so the empty land below is the push's doing", () => {
    expect(before.structures).toBeGreaterThan(10);
  });

  it("takes every one of the seed's buildings, features, flows, seats, quests, threads and journeys off the land", () => {
    expect(land(m)).toEqual({ structures: 0, features: 0, flows: 0, seats: 0, quests: 0, journeys: 0, threads: 0 });
  });

  it("puts the property line on the frame's edge, where build mode can move it", () => {
    const { w, h } = SCENE_WORLD;
    expect(m.run<number[][]>("SCENE.bound")).toEqual([[0, 0], [w, 0], [w, h], [0, h]]);
    expect(m.run<boolean>("inBound(1200,800)"), "a building can be placed in the middle").toBe(true);
  });

  it("takes the seed's ground, coast, place names, caption and districts down", () => {
    const g = ground(m);
    expect(g.seedGeography).toBe(false);
    expect(g.surround).toBe(false);
    expect(g.caption).toBe(false);
  });

  it("has nothing to publish yet, and says the cover may lift", () => {
    expect(m.run<number>("netChanges().length")).toBe(0);
    expect(m.asked.some((a) => a.type === "land-ready")).toBe(true);
  });

  it("threw nothing", () => {
    expect(m.uncaught).toEqual([]);
  });
});

describe("the seed's ground, under a village that does not stand on it", () => {
  /*
   * jsdom never decodes an image, so the seed plate is put in place by hand:
   * a stand-in the size of the real one, which is what `groundCore` hands
   * the frame loop. The verdict is what is under test, not the decoder.
   */
  const withPlate = async (verdict: boolean | null) => {
    const m = boot();
    await settle(200);
    m.run("satPlate={width:2400,height:1600}");
    if (verdict !== null) m.post({ type: "config", seedGround: verdict });
    // District names draw only while the land is pulled back (0.375 < z < 0.95).
    m.run("travel=null;cam.z=0.7");
    await settle(150);
    const seen = { ground: ground(m), source: m.run<string>("groundSource()"), place: hoverPlace(m), districts: districtsShown(m) };
    m.close();
    return seen;
  };

  it("keeps all of it when the village stands on the seed's own rectangle", async () => {
    const seen = await withPlate(true);
    expect(seen.ground.core).toBe(true);
    expect(seen.source).toBe("seed");
    expect(seen.ground.seedGeography).toBe(true);
    expect(seen.place).toMatch(/· The Arrival$/);
    expect(seen.districts).toBeGreaterThan(0);
  });

  it("keeps all of it when nothing has been said, which is a standalone open", async () => {
    const seen = await withPlate(null);
    expect(seen.ground.core).toBe(true);
    expect(seen.source).toBe("seed");
  });

  it("takes all of it down when the village stands anywhere else", async () => {
    const seen = await withPlate(false);
    expect(seen.ground.core, "the seed's satellite plate").toBe(false);
    expect(seen.source).toBe("vector");
    expect(seen.ground.surround, "the seed's coast").toBe(false);
    expect(seen.ground.caption, "the seed's coordinate caption").toBe(false);
    expect(seen.ground.seedGeography).toBe(false);
    expect(seen.place, "a district name on the hover card").toMatch(/· the land$/);
    expect(seen.districts, "district names on the land").toBe(0);
  });
});

/** A draft as a founder's agent would send it: two buildings and a road, journaled. */
function agentDraft() {
  return {
    map_scene: { key: "village-grounds", name: "", status: "draft", version: DRAFT_SCENE_VERSION },
    map_structures: [
      { key: "hall", name: "Common House", archetype: "bighall", anchor: { x: 1200, y: 800 }, phase: 1,
        circle_id: null, blurb: "", origin_story: "", state_inputs: { fund: null, activity: "steady", event: null }, bindings: { doors: [] } },
      { key: "tank", name: "Cistern", archetype: "tank", anchor: { x: 1000, y: 700 }, phase: 2,
        state_inputs: { fund: null, activity: "steady", event: null } },
    ],
    map_zones: [{ id: "f1", kind: "road", geom: "line", path: [[900, 600], [1200, 800]], subtype: "track", phase: 1, owner_structure_key: null, name: "Lane" }],
    map_flows: [{ id: 1, from_key: "tank", to_key: "hall", medium: "water", note: "", phase: 1 }],
    map_edits: [
      { seq: 1, actor: "agent", action: "place", target: "structure:Common House", diff: {}, at: "2026-10-02T10:00:00.000Z" },
      { seq: 2, actor: "agent", action: "place", target: "structure:Cistern", diff: {}, at: "2026-10-02T10:00:01.000Z" },
    ],
    boundary: { scene_units: [[400, 300], [2000, 300], [2000, 1300], [400, 1300]] },
    org_roles: [], quests: [], journeys: [], forum_threads: [], events: [],
  };
}

describe("an agent's draft, reviewed on the blank board and published", () => {
  let m: Booted;
  let offer = "";
  let card = { open: false, blast: "", list: [] as string[] };
  let sent: Asked | undefined;
  beforeAll(async () => {
    m = boot();
    await settle(200);
    m.post({ type: "config", scene: blankScene(), sceneVersion: 0, seedGround: false });
    m.post({ type: "hand", canEdit: true, canPublish: true, liveVersion: 0, live: null, draft: { scene: agentDraft(), baseVersion: 0 } });
    offer = m.window.document.getElementById("restoreMsg")?.textContent ?? "";
    (m.window.document.getElementById("restoreYes") as HTMLElement).click();
    m.run("openPublish()");
    const doc = m.window.document;
    card = {
      open: !!doc.getElementById("pubWrap")?.classList.contains("show"),
      blast: doc.getElementById("pubBlast")?.textContent ?? "",
      list: [...doc.querySelectorAll("#pubList li")].map((li) => li.textContent ?? ""),
    };
    (doc.getElementById("pubConfirm") as HTMLElement).click();
    await settle(50);
    sent = m.asked.find((a) => a.type === "publish");
  });
  afterAll(() => m?.close());

  it("is offered as the draft it is", () => {
    expect(offer).toBe("You have an unpublished draft of the map: 2 buildings, 2 changes.");
  });

  it("draws the agent's land, and only the agent's", () => {
    expect(land(m)).toMatchObject({ structures: 2, features: 1, flows: 1, seats: 0, quests: 0 });
    expect(m.run<string>("BY.hall.name")).toBe("Common House");
  });

  it("lists every line the agent journaled on the publish card, as the first version", () => {
    expect(card.open).toBe(true);
    expect(card.blast).toMatch(/^2 changes will become the map/);
    expect(card.blast).toContain("This is the first published version.");
    expect(card.list).toEqual(["placed Cistern", "placed Common House"]);
  });

  it("publishes the land on screen from version 0 when the founder says so", () => {
    expect(sent?.baseVersion).toBe(0);
    expect(sent?.scene?.map_structures.map((s) => s.key)).toEqual(["hall", "tank"]);
  });

  it("threw nothing", () => {
    expect(m.uncaught).toEqual([]);
  });
});
