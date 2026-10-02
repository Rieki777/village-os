/**
 * THE MAP'S PLACES ANSWER FROM THE VILLAGE'S OWN LAND, AND SAY SO WHEN THEY CANNOT.
 *
 * Runs the real artifact in jsdom and plays the shell's side by dispatching
 * the messages LivingMap.tsx posts. The platform stubs mirror
 * mapArtifactBoot.test.ts, which says why each one exists. To be "in the
 * shell" the artifact only asks whether `window.parent` is itself, so the
 * shell here is a stand-in parent that records what the map posts to it.
 *
 * A DEEP LINK WAITS FOR THE PUBLISHED LAND (F02, 2026-10-01). The router used
 * to answer a shared address 400 ms into the boot, against the artifact's
 * baked seed, while the village's published scene was still being fetched by
 * the shell. Measured against the published scene: a place the founder added
 * toasted "That place is no longer on the map." and never opened, a place the
 * founder moved opened over the seed's ground, and a quest the founder
 * retitled showed its old title with nothing lit. The scenes below are the
 * artifact's own export with exactly those three changes made to it, so they
 * are the shape its restore reads.
 *
 * WHAT THIS CANNOT SEE. jsdom lays nothing out, so "the camera aims at the
 * live anchor" is read off the camera's numbers, with the panel measuring
 * zero wide. Whether the building then sits in the visible strip beside the
 * panel was measured in Chromium against the real shell.
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

interface Booted {
  window: ArtifactWindow;
  uncaught: unknown[];
  /** Every toast the map raised, in order. */
  toasts: string[];
  /** Every row that was lit at any moment. A lit row fades after 2.6 s. */
  everLit: Set<string>;
  /** The type of every message the map posted to its shell. */
  posted: string[];
  run<T>(src: string): T;
  /** A message from the shell, in the shape LivingMap.tsx posts it. */
  post(data: Record<string, unknown>): void;
  close(): void;
}

function boot(hash: string, opts: { shell?: boolean; width?: number; height?: number } = {}): Booted {
  const uncaught: unknown[] = [];
  const posted: string[] = [];
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
      Object.assign(w, { innerWidth: opts.width ?? 1440, innerHeight: opts.height ?? 900 });
      stubTheMissingPlatform(w);
      w.Element.prototype.scrollIntoView = function () {};
      if (opts.shell) {
        const shell = { postMessage: (m: { type?: string }) => posted.push(String(m?.type)) };
        Object.defineProperty(w, "parent", { configurable: true, get: () => shell });
      }
    },
  });
  const toasts: string[] = [];
  new window.MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) toasts.push((n.textContent ?? "").trim());
  }).observe(window.document.getElementById("toasts") as Node, { childList: true });
  const everLit = new Set<string>();
  new window.MutationObserver((ms) => {
    for (const m of ms) {
      const n = m.target as HTMLElement;
      if (n.classList?.contains("itemfocus") && n.dataset.item) everLit.add(n.dataset.item);
    }
  }).observe(window.document.body, { attributes: true, attributeFilter: ["class"], subtree: true });
  return {
    window,
    uncaught,
    toasts,
    everLit,
    posted,
    run: <T>(src: string) => window.eval(src) as T,
    post(data) {
      const own = window.eval("JSON").parse(JSON.stringify(data));
      window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
    },
    close: () => window.close(),
  };
}

interface Structure {
  key: string;
  name: string;
  anchor: { x: number; y: number };
  sort?: number;
  [k: string]: unknown;
}
interface Quest {
  title: string;
  key: string;
  structure_key: string | null;
  [k: string]: unknown;
}
interface Scene {
  map_structures: Structure[];
  quests: Quest[];
  org_roles: { role: string; structure_key: string | null; circle: string; [k: string]: unknown }[];
  forum_threads: { id: string; title: string; src?: string; [k: string]: unknown }[];
  [k: string]: unknown;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const NOT_THERE = /no longer on the map/;

/** The artifact's own seed, exported the way a publish writes it. */
let SEED: Scene;
/** What the founder published since: one place added, one moved, one quest retitled. */
let LIVE: Scene;
const ADDED = { key: "new-orchard", name: "New Orchard", x: 1871, y: 666 };
const MOVED = "sanctuary";
let movedTo: { x: number; y: number };
let seedAt: { x: number; y: number };
const RETITLED_AT = "foodforest";
const RETITLED = { title: "Swale dig, east slope", key: "swale-dig-east-slope" };
let retitledFrom: Quest;

beforeAll(async () => {
  const m = boot("");
  await settle(200);
  SEED = clone(m.run<Scene>("buildExportJSON()"));
  m.close();
  LIVE = clone(SEED);
  const twin = clone(LIVE.map_structures.find((s) => s.key === RETITLED_AT) as Structure);
  LIVE.map_structures.push({ ...twin, key: ADDED.key, name: ADDED.name, anchor: { x: ADDED.x, y: ADDED.y }, sort: 99 });
  const moved = LIVE.map_structures.find((s) => s.key === MOVED) as Structure;
  seedAt = { ...moved.anchor };
  moved.anchor = { x: seedAt.x - 245, y: seedAt.y + 84 };
  movedTo = { ...moved.anchor };
  const q = LIVE.quests.find((x) => x.structure_key === RETITLED_AT) as Quest;
  retitledFrom = clone(q);
  Object.assign(q, RETITLED);
});

/** Where the camera is headed: the flight's target while it flies, the camera once it has landed. */
function aimOf(m: Booted) {
  const travel = m.run<{ tx: number; ty: number } | null>("travel&&{tx:travel.tx,ty:travel.ty}");
  return travel ? { x: travel.tx, y: travel.ty } : m.run<{ x: number; y: number }>("({x:cam.x,y:cam.y})");
}

const config = (scene: Scene | null, version = 6) =>
  scene ? { type: "config", scene, sceneVersion: version } : { type: "config" };

it("the seed and the published land differ the way this file claims (the positive control)", () => {
  expect(SEED.map_structures.some((s) => s.key === ADDED.key), "the added place is not in the seed").toBe(false);
  expect(LIVE.map_structures.some((s) => s.key === ADDED.key)).toBe(true);
  expect(Math.hypot(movedTo.x - seedAt.x, movedTo.y - seedAt.y)).toBeGreaterThan(200);
  expect(retitledFrom.key, "the seed's quest key is another key").not.toBe(RETITLED.key);
  expect(html.includes("function routeHash("), "the router this file drives").toBe(true);
});

describe("a deep link inside the shell, with the published land arriving after the boot", () => {
  /* The config lands 600 ms after the boot, which is after the old 400 ms
     router fired: on production it landed 170 ms after that router's toast.
     Booted one at a time, because building a window is synchronous and a
     timer cannot fire while the next one is being built: booted together,
     each map's clock would run on while the others parsed. */
  const LATE = 600;
  /** Past the hold, so the map has given up waiting and routed what it had. */
  const AFTER_THE_WAIT = 4600;
  let added: Booted, moved: Booted, item: Booted, never: Booted, slow: Booted, slowMoved: Booted;
  async function arrive(hash: string, scene: Scene | null, after: number) {
    const m = boot(hash, { shell: true });
    await settle(after);
    if (scene) m.post(config(scene));
    await settle(400);
    return m;
  }
  beforeAll(async () => {
    added = await arrive(`#/place/${ADDED.key}&skipIntro`, LIVE, LATE);
    moved = await arrive(`#/place/${MOVED}&skipIntro`, LIVE, LATE);
    item = await arrive(`#/place/${RETITLED_AT}?item=quest:${RETITLED.key}&skipIntro`, LIVE, LATE);
    // These three wait out the hold, so they share one wait.
    never = boot("#/place/greenhouse&skipIntro", { shell: true });
    slow = boot(`#/place/${ADDED.key}&skipIntro`, { shell: true });
    slowMoved = boot(`#/place/${MOVED}&skipIntro`, { shell: true });
    await settle(AFTER_THE_WAIT);
    slow.post(config(LIVE));
    slowMoved.post(config(LIVE));
    await settle(400);
  }, 30_000);
  afterAll(() => [added, moved, item, never, slow, slowMoved].forEach((m) => m?.close()));

  it("is the shell's case: the map announced itself to a parent", () => {
    expect(added.posted).toContain("grounds-ready");
  });

  it("opens a place only the published land holds, and never calls it gone", () => {
    expect(added.toasts.filter((t) => NOT_THERE.test(t)), "toasts saying the place is gone").toEqual([]);
    expect(added.run<string | null>("panelKey")).toBe(ADDED.key);
    expect(added.window.document.getElementById("panel")?.classList.contains("open")).toBe(true);
    expect(added.window.location.hash).toBe(`#/place/${ADDED.key}`);
  });

  it("aims at where the founder moved a place, and not at the seed's spot", () => {
    expect(moved.run<string | null>("panelKey")).toBe(MOVED);
    const aim = aimOf(moved);
    expect(Math.round(aim.x), "camera aim x").toBe(movedTo.x);
    expect(Math.round(aim.y), "camera aim y").toBe(movedTo.y);
  });

  it("lights a quest the founder retitled, under its published title", () => {
    const rows = [...item.window.document.querySelectorAll<HTMLElement>("#panelBody [data-item]")].map((n) => n.dataset.item);
    expect(rows).toContain(`quest:${RETITLED.key}`);
    expect(rows, "the seed's stale key").not.toContain(`quest:${retitledFrom.key}`);
    expect([...item.everLit]).toEqual([`quest:${RETITLED.key}`]);
    expect(item.window.document.getElementById("panelBody")?.textContent).toContain(RETITLED.title);
  });

  it("still routes when the shell never sends the land, once the wait runs out", () => {
    expect(never.run<string | null>("panelKey")).toBe("greenhouse");
  });

  it("tries a missing place again when the land lands after the wait, and never calls it gone in between", () => {
    expect(slow.toasts.filter((t) => NOT_THERE.test(t))).toEqual([]);
    expect(slow.run<string | null>("panelKey")).toBe(ADDED.key);
  });

  it("aims again at a moved place when the land lands after the wait", () => {
    expect(slowMoved.run<string | null>("panelKey")).toBe(MOVED);
    const aim = aimOf(slowMoved);
    expect(Math.round(aim.x), "camera aim x").toBe(movedTo.x);
    expect(Math.round(aim.y), "camera aim y").toBe(movedTo.y);
  });

  it("threw nothing", () => {
    for (const m of [added, moved, item, never, slow, slowMoved]) expect(m.uncaught).toEqual([]);
  });
});

describe("a publish landing while a place's door is open", () => {
  it("redraws the open tab from the new land, so Claim names the village's own quest", async () => {
    const m = boot("#skipIntro", { shell: true });
    await settle(200);
    m.post(config(SEED));
    m.run(`openPanel('${RETITLED_AT}',1)`);
    const before = m.window.document.getElementById("panelBody")?.textContent ?? "";
    m.post(config(LIVE, 7));
    const body = m.window.document.getElementById("panelBody");
    const rows = [...(body?.querySelectorAll<HTMLElement>("[data-item]") ?? [])].map((n) => n.dataset.item);
    const onTab = [...(m.window.document.getElementById("tabs")?.children ?? [])].findIndex((b) => b.classList.contains("on"));
    m.close();
    expect(before, "the control: the seed's title was on screen").toContain(retitledFrom.title);
    expect(onTab, "still on the tab the reader chose").toBe(1);
    expect(body?.textContent).toContain(RETITLED.title);
    expect(rows).toContain(`quest:${RETITLED.key}`);
    expect(rows).not.toContain(`quest:${retitledFrom.key}`);
  });

  it("closes the door of a place the new land no longer holds, and says so", async () => {
    const m = boot("#skipIntro", { shell: true });
    await settle(200);
    m.post(config(LIVE));
    m.run(`openPanel('${ADDED.key}',0)`);
    const gone = clone(LIVE);
    gone.map_structures = gone.map_structures.filter((s) => s.key !== ADDED.key);
    m.post(config(gone, 7));
    await settle(20); // the toast observer reports on a microtask
    const open = m.window.document.getElementById("panel")?.classList.contains("open");
    const key = m.run<string | null>("panelKey");
    m.close();
    expect(open).toBe(false);
    expect(key).toBeNull();
    expect(m.toasts.some((t) => NOT_THERE.test(t))).toBe(true);
  });
});

/**
 * THE SEATS ON THE MAP ARE THE VILLAGE'S OWN, OR SAY THEY ARE NOT (F03).
 *
 * On 2026-10-01 none of the 16 seats the published scene draws matched any
 * of the 25 roles /api/map serves, What needs hands offered all 16 as "Seat
 * open", and every Raise a hand showed "Intro drafted. The Land circle will
 * hear from you." while sending nothing. A seat the village reported filled
 * was still offered. Here the shell's `lens` message carries a filled seat,
 * an open one, and a role the map does not draw; every other seed seat is
 * drawn and matches nothing.
 */
describe("the seats, once the village has said which roles it keeps", () => {
  const HELD = "Greenhouse Steward";
  const OPEN = "Nursery Keeper";
  const AT = "greenhouse";
  const UNLISTED = "Site Guide";
  let m: Booted;
  let before: { seatItems: string[] };
  let after: {
    seatItems: string[];
    rows: { name: string; why: string; held: boolean; href: string | null; onclick: string | null }[];
    footer: string;
    overview: string;
    wall: string;
  };
  let maiaTab: number;
  const seatItems = () => m.run<{ h: string }[]>("attnItems()").map((x) => x.h).filter((h) => h.includes("Seat"));
  beforeAll(async () => {
    m = boot("#skipIntro", { shell: true });
    await settle(200);
    m.post(config(SEED));
    before = { seatItems: seatItems() };
    m.post({
      type: "lens",
      party: [],
      roles: [
        { name: HELD, state: "filled", archetypes: [] },
        { name: OPEN, state: "open", archetypes: [] },
        { name: "Board of Directors", state: "open", archetypes: [] },
      ],
    });
    const doc = m.window.document;
    m.run(`openPanel('${AT}',2)`);
    const rows = [...doc.querySelectorAll<HTMLElement>("#panelBody .seatrow")].map((r) => {
      const a = r.querySelector("a, button");
      return {
        name: r.querySelector("b")?.textContent ?? "",
        why: r.querySelector(".why")?.textContent ?? "",
        held: !!r.querySelector(".held"),
        href: a?.getAttribute("href") ?? null,
        onclick: a?.getAttribute("onclick") ?? null,
      };
    });
    const footer = doc.querySelector("#panelBody .lastv")?.textContent ?? "";
    m.run("renderTab(0)");
    const overview = doc.getElementById("panelBody")?.textContent ?? "";
    m.run("buildWall()");
    const wall = doc.getElementById("wallList")?.textContent ?? "";
    after = { seatItems: seatItems(), rows, footer, overview, wall };
    m.run("conciergeMatch('nursery')");
    maiaTab = [...(doc.getElementById("tabs")?.children ?? [])].findIndex((b) => b.classList.contains("on"));
  });
  afterAll(() => m?.close());

  it("offered every drawn seat before the village answered (the control: the scene's own word)", () => {
    expect(before.seatItems.length).toBeGreaterThan(2);
    expect(before.seatItems.some((h) => h.includes(UNLISTED))).toBe(true);
  });

  it("offers only the open seat the village keeps in What needs hands", () => {
    expect(after.seatItems).toEqual([`⛨ Seat open: ${OPEN}`]);
  });

  it("shows a held seat as held, with no hand to raise", () => {
    const row = after.rows.find((r) => r.name === HELD);
    expect(row?.held).toBe(true);
    expect(row?.href).toBeNull();
  });

  it("sends Raise a hand to the circles view, through the shell's own navigation", () => {
    const row = after.rows.find((r) => r.name === OPEN);
    expect(row?.href).toMatch(/\/map\/circles$/);
    expect(row?.onclick).toBe("return siteNav(event,'/map/circles')");
    expect(after.footer).toContain("Raise a hand opens the circles view");
  });

  it("raises no toast in place of an action, on any seat", () => {
    // The old button was onclick="toast('Intro drafted. ...')" and sent nothing.
    expect(after.rows.map((r) => r.onclick ?? "").filter((c) => c.includes("toast("))).toEqual([]);
    expect(after.rows.length, "the rows were read").toBeGreaterThanOrEqual(2);
  });

  it("says a drawn seat the village does not keep is not one of its roles, and offers it to nobody", () => {
    m.run(`openPanel('gate',2)`);
    const row = m.window.document.querySelector<HTMLElement>("#panelBody .seatrow");
    expect(row?.querySelector("b")?.textContent).toBe(UNLISTED);
    expect(row?.querySelector(".why")?.textContent).toBe("Drawn on this map. Not one of the village's roles yet.");
    expect(row?.querySelector("a, button")).toBeNull();
    expect(after.wall).toContain("seats on the map, not the village's roles yet");
  });

  it("counts only the open seat on the place's overview", () => {
    expect(after.overview).toContain("⛨ 1 open seat ·");
  });

  it("opens Maia's seat answer on the Seats tab", () => {
    expect(maiaTab).toBe(2);
  });

  it("threw nothing", () => {
    expect(m.uncaught).toEqual([]);
  });
});
