/**
 * BUILD MODE'S TWO UNDOS DO WHAT THEY SAY, AND THE PUBLISH CARD COUNTS WHAT THEY LEFT.
 *
 * Found by the 2026-10-01 QA sweep and reproduced by an independent skeptic,
 * all on production:
 *
 *   F70  The publish card listed changes that undo had already taken back,
 *        and counted each undo as one more change.
 *   F71  Undo after Discard draft put a removed building back beside the live
 *        copy: two of it, both autosaved.
 *   F76  Undo skipped renames and every other inspect-card edit, took back an
 *        older move instead, and said nothing about which.
 *
 * Runs the real artifact in jsdom and plays the village around it: the
 * map's posts to its shell are caught at shellPost, and a small in-memory
 * village answers them the way server/routes/mapScene.ts does. Platform
 * stubs mirror mapArtifactBoot.test.ts, which says why each one exists.
 *
 * WHAT THIS CANNOT SEE. Pixels and real pointers. The drag below dispatches
 * the events the poi listens for, at coordinates the artifact's own
 * worldToScreen computes. The real-browser version of every case here was
 * run in Playwright against a fake shell before and after the fix.
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

interface Scene {
  map_structures: { key: string; name: string }[];
  map_edits: unknown[];
  [k: string]: unknown;
}
interface Posted {
  type: string;
  nonce?: string;
  version?: number;
  baseVersion?: number;
  scene?: Scene;
}

/**
 * The village, kept as the server keeps it: revisions are append-only, a
 * publish is refused when its base already has a child (the UNIQUE index on
 * base_version), a publish rebases the member's draft, and a restore is a
 * publish of an old scene from the live version, which moves an untouched
 * draft along with it (followRestore).
 */
class Village {
  revs: { version: number; base: number; scene: string }[] = [];
  draft: { scene: string; baseVersion: number } | null = null;
  seen: Posted[] = [];
  constructor(seed: Scene, version: number) {
    this.revs.push({ version, base: version - 1, scene: JSON.stringify(seed) });
  }
  get live() {
    return this.revs[this.revs.length - 1];
  }
  card() {
    const prev = this.revs[this.revs.length - 2];
    return { version: this.live.version, by: "the founder", previous: prev ? prev.version : null };
  }
  liveScene(): Scene {
    return JSON.parse(this.live.scene) as Scene;
  }
  private publish(scene: string, base: number) {
    if (this.revs.some((r) => r.base === base)) return null;
    const version = this.live.version + 1;
    this.revs.push({ version, base, scene });
    return version;
  }
  /** Answers one post, as [messages to the map, in order]. */
  answer(m: Posted): Record<string, unknown>[] {
    this.seen.push({ type: m.type, version: m.version, baseVersion: m.baseVersion });
    const result = (r: Record<string, unknown>) => ({ type: "scene-result", of: m.type, nonce: m.nonce, ...r });
    if (m.type === "draft-save") {
      this.draft = { scene: JSON.stringify(m.scene), baseVersion: m.baseVersion ?? 0 };
      return [result({ ok: true, baseVersion: this.draft.baseVersion })];
    }
    if (m.type === "draft-discard") {
      this.draft = null;
      return [result({ ok: true })];
    }
    if (m.type === "publish") {
      const text = JSON.stringify(m.scene);
      const version = this.publish(text, m.baseVersion ?? 0);
      if (version === null) {
        return [result({ ok: false, reason: "stale", error: "The live map changed while you were working.", live: this.card() })];
      }
      this.draft = { scene: text, baseVersion: version };
      return [result({ ok: true, version, live: this.card() })];
    }
    if (m.type === "restore") {
      const src = this.revs.find((r) => r.version === Number(m.version));
      if (!src) return [result({ ok: false, error: `There is no version ${m.version} to put back.` })];
      const before = this.live.scene;
      const version = this.publish(src.scene, this.live.version);
      if (version === null) return [result({ ok: false, reason: "stale", error: "The live map changed a moment ago." })];
      if (this.draft && this.draft.scene === before) this.draft = { scene: src.scene, baseVersion: version };
      return [this.config(), result({ ok: true, version, live: this.card() })];
    }
    return [];
  }
  config() {
    return { type: "config", scene: this.liveScene(), sceneVersion: this.live.version };
  }
  hand() {
    return { type: "hand", canEdit: true, canPublish: true, liveVersion: this.live.version, live: this.card(), draft: null };
  }
}

interface Booted {
  window: ArtifactWindow;
  uncaught: unknown[];
  village: Village;
  run<T>(src: string): T;
  post(data: Record<string, unknown>): void;
  el<T extends HTMLElement = HTMLElement>(sel: string): T;
  close(): void;
}

let SEED: Scene;

/** The artifact, booted with a village around it and the seed published as version 6. */
async function boot(opts: { shell?: boolean } = {}): Promise<Booted> {
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
    },
  });
  const run = <T>(src: string) => window.eval(src) as T;
  const post = (data: Record<string, unknown>) => {
    // Through the window's own JSON, so the artifact holds objects of its
    // own realm, the way a structured clone arrives.
    const own = (window.eval("JSON") as JSON).parse(JSON.stringify(data));
    window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
  };
  await settle(200);
  const village = new Village(SEED ?? (run<Scene>("JSON.parse(JSON.stringify(buildExportJSON()))") as Scene), 6);
  if (opts.shell !== false) {
    // The map talks to its parent through shellPost and asks inShell first.
    // Here the parent is the village above, answering on the next tick the
    // way a postMessage round trip does.
    (window as unknown as { __toShell: (m: Posted) => void }).__toShell = (m) => {
      const copy = JSON.parse(JSON.stringify(m)) as Posted;
      setTimeout(() => village.answer(copy).forEach(post), 0);
    };
    run("inShell=()=>true;shellPost=m=>window.__toShell(m)");
    post(village.config());
    post(village.hand());
  }
  return {
    window,
    uncaught,
    village,
    run,
    post,
    el: <T extends HTMLElement = HTMLElement>(sel: string) => window.document.querySelector(sel) as T,
    close: () => window.close(),
  };
}

const lastToast = (m: Booted) => m.el("#toasts")?.lastElementChild?.textContent ?? "";
const name = (m: Booted, key: string) => m.run<string>(`BY[${JSON.stringify(key)}]&&BY[${JSON.stringify(key)}].name`);
const liveName = (m: Booted, key: string) => m.village.liveScene().map_structures.find((s) => s.key === key)?.name;

/** Rename through the inspect card, the way a person types and tabs away. */
function rename(m: Booted, key: string, to: string) {
  m.run(`openInspect(${JSON.stringify(key)})`);
  const box = m.el<HTMLInputElement>("#iName");
  box.value = to;
  box.dispatchEvent(new m.window.Event("input"));
  box.dispatchEvent(new m.window.Event("change"));
}
/** Drag a place by the events its poi listens for, to a point the artifact
    itself says is on screen. */
function drag(m: Booted, key: string, dx: number, dy: number) {
  const [x0, y0, x1, y1] = m.run<number[]>(
    `(()=>{const s=BY[${JSON.stringify(key)}],a=worldToScreen(s.x,s.y),b=worldToScreen(s.x+${dx},s.y+${dy});return [a[0]/DPR,a[1]/DPR,b[0]/DPR,b[1]/DPR]})()`,
  );
  const poi = m.el(`.poi[data-k="${key}"]`);
  poi.dispatchEvent(new m.window.MouseEvent("pointerdown", { bubbles: true, clientX: x0, clientY: y0 }));
  m.window.dispatchEvent(new m.window.MouseEvent("pointermove", { clientX: x1, clientY: y1 }));
  m.window.dispatchEvent(new m.window.MouseEvent("pointerup", { clientX: x1, clientY: y1 }));
}
async function publish(m: Booted) {
  // The bar enables Publish when it next renders, which is on the autosave
  // timer, 2.5 s after the last edit. Rendered now rather than waited for.
  m.run("renderDraftBar()");
  m.el("#pubGo").click();
  const card = { blast: m.el("#pubBlast").textContent ?? "", list: [...m.window.document.querySelectorAll("#pubList li")].map((li) => li.textContent ?? "") };
  m.el("#pubConfirm").click();
  await settle(50);
  return card;
}
function card(m: Booted) {
  m.run("renderDraftBar()");
  const bar = { state: m.el("#draftState").textContent ?? "", publishDisabled: m.el<HTMLButtonElement>("#pubGo").disabled };
  m.run("openPublish()");
  const open = m.el("#pubWrap").classList.contains("show");
  const list = open ? [...m.window.document.querySelectorAll("#pubList li")].map((li) => li.textContent ?? "") : [];
  const blast = open ? m.el("#pubBlast").textContent ?? "" : "";
  const toast = lastToast(m);
  m.run("closePublish()");
  return { bar, open, blast, list, toast };
}
const undoThis = (m: Booted) =>
  [...m.window.document.querySelectorAll<HTMLButtonElement>("#maiaLog button")].filter((b) => b.textContent === "Undo this").pop();
const build = (m: Booted) => m.el("#buildBtn").click();
const restores = (m: Booted) => m.village.seen.filter((s) => s.type === "restore");

beforeAll(async () => {
  const m = await boot({ shell: false });
  SEED = JSON.parse(JSON.stringify(m.run<Scene>("buildExportJSON()"))) as Scene;
  m.close();
});

it("the artifact still has the parts this guard drives (the positive control)", () => {
  for (const key of ["market", "gate", "pondhomes"]) {
    expect(SEED.map_structures.some((s) => s.key === key), `the seed has ${key}`).toBe(true);
  }
  expect(html).toContain("function undoPublish(");
  expect(html).toContain('id="undoBtn"');
  expect(html).toContain("function shellPost(");
});

describe("the publish card after undo (F70)", () => {
  it("lists only what is left once two of three changes are taken back", async () => {
    const m = await boot();
    build(m);
    rename(m, "market", "Renamed Market");
    m.el('.poi[data-k="gate"] .rm').click();
    m.run("duplicateStructure('market')");
    m.el("#undoBtn").click();
    m.el("#undoBtn").click();
    const seen = card(m);
    const gate = m.run<boolean>("!!BY.gate");
    m.close();
    expect(gate, "the gate is back on the land").toBe(true);
    expect(seen.bar.state).toContain("1 unpublished change.");
    expect(seen.blast).toMatch(/^1 change will become the map/);
    expect(seen.list).toEqual(["renamed market"]);
  });

  it("offers nothing to publish after one move and its undo", async () => {
    const m = await boot();
    build(m);
    const from = m.run<number[]>("[BY.market.x,BY.market.y]");
    drag(m, "market", 30, 20);
    const moved = m.run<number[]>("[BY.market.x,BY.market.y]");
    m.el("#undoBtn").click();
    const seen = card(m);
    m.close();
    expect(moved, "the drag moved it (the case is the one it says it is)").not.toEqual(from);
    expect(seen.bar.publishDisabled).toBe(true);
    expect(seen.bar.state).toBe("Editing a draft. The live map is unchanged.");
    expect(seen.open).toBe(false);
    expect(seen.toast).toContain("Nothing to publish");
  });

  it("drops a duplicate's placing along with it", async () => {
    const m = await boot();
    build(m);
    m.run("duplicateStructure('market')");
    // Set it down with a click on the land, where the artifact says the
    // kitchen's neighbourhood is on screen.
    const [x, y] = m.run<number[]>("(()=>{const a=worldToScreen(BY.kitchen.x+40,BY.kitchen.y+40);return [a[0]/DPR,a[1]/DPR]})()");
    m.el("#scene").dispatchEvent(new m.window.MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
    const placed = m.run<string[]>("unpublished().map(e=>e.action)");
    m.el("#undoBtn").click();
    const seen = card(m);
    const copies = m.run<number>("SCENE.structures.filter(s=>/^market-c/.test(s.key)).length");
    m.close();
    expect(placed, "duplicated, then placed (the case is the one it says it is)").toEqual(["duplicate", "place"]);
    expect(copies).toBe(0);
    expect(seen.bar.publishDisabled).toBe(true);
    expect(seen.open).toBe(false);
  });

  it("still counts the undo of a change the live map already has", async () => {
    const m = await boot();
    build(m);
    m.el('.poi[data-k="gate"] .rm').click();
    await publish(m);
    m.el("#undoBtn").click();
    const seen = card(m);
    m.close();
    expect(seen.list).toEqual(["undid a change to gate"]);
  });
});

describe("Undo after Discard draft (F71)", () => {
  let seen: { structures: number; pond: number; pois: number; toast: string };
  beforeAll(async () => {
    const m = await boot();
    build(m);
    m.el('.poi[data-k="pondhomes"] .rm').click();
    m.el("#dropBtn").click();
    m.el("#pubConfirm").click();
    await settle(50);
    m.el("#undoBtn").click();
    seen = {
      structures: m.run<number>("SCENE.structures.length"),
      pond: m.run<number>("SCENE.structures.filter(s=>s.key==='pondhomes').length"),
      pois: m.window.document.querySelectorAll('.poi[data-k="pondhomes"]').length,
      toast: lastToast(m),
    };
    m.close();
  });

  it("does not put the building back a second time", () => {
    expect(seen.structures).toBe(SEED.map_structures.length);
    expect(seen.pond).toBe(1);
    expect(seen.pois).toBe(1);
    expect(seen.toast).toBe("Nothing to undo.");
  });

  it("keeps one element per place even when a place is drawn twice", async () => {
    const m = await boot({ shell: false });
    m.run("makePoi(BY.pondhomes);makeBanner(BY.pondhomes)");
    const pois = m.window.document.querySelectorAll('.poi[data-k="pondhomes"]').length;
    m.close();
    expect(pois).toBe(1);
  });
});

describe("Undo and the inspect card (F76)", () => {
  it("takes back a rename, and says so", async () => {
    const m = await boot();
    build(m);
    const was = name(m, "market");
    rename(m, "market", "Renamed Market");
    m.el("#undoBtn").click();
    const seen = { name: name(m, "market"), banner: m.run<string>("bEls.market.textContent"), toast: lastToast(m) };
    m.close();
    expect(seen.name).toBe(was);
    expect(seen.banner).toContain(was);
    expect(seen.toast).toBe("Undid: renamed market.");
  });

  it("takes back the rename made after a move, and leaves the move", async () => {
    const m = await boot();
    build(m);
    const was = name(m, "market");
    drag(m, "market", 30, 20);
    const moved = m.run<number[]>("[BY.market.x,BY.market.y]");
    rename(m, "market", "Renamed Market");
    m.el("#undoBtn").click();
    const seen = { name: name(m, "market"), at: m.run<number[]>("[BY.market.x,BY.market.y]") };
    m.close();
    expect(seen.name).toBe(was);
    expect(seen.at).toEqual(moved);
  });

  it("takes back a circle change, a new seat and a new flow, newest first", async () => {
    const m = await boot();
    build(m);
    m.run("openInspect('market')");
    const before = m.run<{ circle: string; seats: number; flows: number }>(
      "({circle:BY.market.circle,seats:SCENE.seats.length,flows:SCENE.flows.length})",
    );
    const sel = m.el<HTMLSelectElement>("#iCircle");
    const other = [...sel.options].map((o) => o.value).find((v) => v && v !== before.circle) ?? "";
    sel.value = other;
    sel.dispatchEvent(new m.window.Event("change"));
    m.el<HTMLInputElement>("#iSeatName").value = "Keeper of the scales";
    m.el("#iSeatAdd").click();
    m.el("#iFOutAdd").click();
    const after = m.run<{ circle: string; seats: number; flows: number }>(
      "({circle:BY.market.circle,seats:SCENE.seats.length,flows:SCENE.flows.length})",
    );
    m.el("#undoBtn").click();
    const oneBack = m.run<number>("SCENE.flows.length");
    m.el("#undoBtn").click();
    m.el("#undoBtn").click();
    const back = m.run<{ circle: string; seats: number; flows: number }>(
      "({circle:BY.market.circle,seats:SCENE.seats.length,flows:SCENE.flows.length})",
    );
    const net = m.run<number>("netChanges().length");
    m.close();
    expect(after).toEqual({ circle: other, seats: before.seats + 1, flows: before.flows + 1 });
    expect(oneBack).toBe(before.flows);
    expect(back).toEqual(before);
    expect(net).toBe(0);
  });
});

