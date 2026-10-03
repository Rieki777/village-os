/**
 * BUILD MODE'S TWO UNDOS DO WHAT THEY SAY, AND THE PUBLISH CARD COUNTS WHAT THEY LEFT.
 *
 * Found by the 2026-10-01 QA sweep and reproduced by an independent skeptic,
 * all on production:
 *
 *   F18  "Undo this" after a publish was a dead button. maiaClean keeps only
 *        the inline handlers MSAY_ON_OK names and undoPublish() was not one,
 *        so its onclick was stripped and pressing it did nothing at all.
 *   F19  Once reachable, the undo put the old version live and left the
 *        screen, "View as visitor" and the base on the undone one, so the
 *        next small publish carried the undone change straight back.
 *   F70  The publish card listed changes that undo had already taken back,
 *        and counted each undo as one more change.
 *   F71  Undo after Discard draft put a removed building back beside the live
 *        copy: two of it, both autosaved.
 *   F76  Undo skipped renames and every other inspect-card edit, took back an
 *        older move instead, and said nothing about which.
 *   F78  In the village, Save map skin promised a look the village's own skin
 *        overrides on every load, and listed it as a change every visitor
 *        would see.
 *
 * Runs the real artifact in jsdom and plays the village around it: the
 * map's posts to its shell are caught at shellPost, and a small in-memory
 * village answers them the way server/routes/mapScene.ts does, with the
 * shell's config push before a restore's answer
 * (client/src/components/map/sceneRelay.ts, tested on its own). Platform
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
  revs: { version: number; base: number; scene: string; by: string }[] = [];
  draft: { scene: string; baseVersion: number } | null = null;
  seen: Posted[] = [];
  constructor(seed: Scene, version: number) {
    this.revs.push({ version, base: version - 1, scene: JSON.stringify(seed), by: "the founder" });
  }
  get live() {
    return this.revs[this.revs.length - 1];
  }
  card() {
    const prev = this.revs[this.revs.length - 2];
    return { version: this.live.version, by: this.live.by, previous: prev ? prev.version : null };
  }
  /** A colleague publishing from the live version, the way their own map would. */
  publishedBy(by: string, change: (s: Scene) => void) {
    const s = this.liveScene();
    change(s);
    const version = this.live.version + 1;
    this.revs.push({ version, base: this.live.version, scene: JSON.stringify(s), by });
    return version;
  }
  liveScene(): Scene {
    return JSON.parse(this.live.scene) as Scene;
  }
  private publish(scene: string, base: number) {
    if (this.revs.some((r) => r.base === base)) return null;
    const version = this.live.version + 1;
    this.revs.push({ version, base, scene, by: "the founder" });
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
const name = (m: Booted, key: string) => m.run<(key: string) => string>("(k=>BY[k]&&BY[k].name)")(key);
const liveName = (m: Booted, key: string) => m.village.liveScene().map_structures.find((s) => s.key === key)?.name;

/** Rename through the inspect card, the way a person types and tabs away. */
function rename(m: Booted, key: string, to: string) {
  m.run<(key: string) => void>("openInspect")(key);
  const box = m.el<HTMLInputElement>("#iName");
  box.value = to;
  box.dispatchEvent(new m.window.Event("input"));
  box.dispatchEvent(new m.window.Event("change"));
}
/** Drag a place by the events its poi listens for, to a point the artifact
    itself says is on screen. The values go in as arguments to a function the
    page hands back, never spliced into the code it evaluates. */
function drag(m: Booted, key: string, dx: number, dy: number) {
  const [x0, y0, x1, y1] = m.run<(key: string, dx: number, dy: number) => number[]>(
    "((k,dx,dy)=>{const s=BY[k],a=worldToScreen(s.x,s.y),b=worldToScreen(s.x+dx,s.y+dy);return [a[0]/DPR,a[1]/DPR,b[0]/DPR,b[1]/DPR]})",
  )(key, dx, dy);
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

describe("Undo this, pressed after a publish (F18)", () => {
  let m: Booted;
  let firstPress: { restores: number; version?: number; live: number; button: boolean };
  let secondPress: { restores: number; live: number };
  beforeAll(async () => {
    m = await boot();
    build(m);
    rename(m, "market", "Market in v7");
    await publish(m);
    const b = undoThis(m);
    expect(b, "Maia offers the undo").toBeTruthy();
    b?.click();
    await settle(50);
    firstPress = { restores: restores(m).length, version: restores(m)[0]?.version, live: m.village.live.version, button: !!b?.disabled };
    b?.click();
    await settle(50);
    secondPress = { restores: restores(m).length, live: m.village.live.version };
  });
  afterAll(() => m?.close());

  it("published version 7 first (the case is the one it says it is)", () => {
    expect(m.village.revs.map((r) => r.version)).toEqual([6, 7, 8]);
  });

  it("asks the village to put version 6 back when the rendered button is pressed", () => {
    expect(firstPress.restores).toBe(1);
    expect(firstPress.version).toBe(6);
    expect(firstPress.live).toBe(8);
  });

  it("does not undo the undo: a second press asks for nothing, and the button is spent", () => {
    expect(firstPress.button).toBe(true);
    expect(secondPress).toEqual({ restores: 1, live: 8 });
  });

  it("is not stripped on its way into the dock", () => {
    expect(m.run<string[]>("MSAY_STRIPPED.slice()")).not.toContain("button[onclick]");
  });

  it("threw nothing", () => {
    expect(m.uncaught).toEqual([]);
  });
});

describe("after the undo, with nothing unpublished in hand (F19)", () => {
  let m: Booted;
  let seen: { screen: string; liveScene: string; base: number; visitor: string; card: ReturnType<typeof card> };
  let next: { live: number; market?: string; gate?: string; history: string[] };
  beforeAll(async () => {
    m = await boot();
    build(m);
    rename(m, "market", "Market in v7");
    await publish(m);
    undoThis(m)?.click();
    await settle(50);
    m.run("toggleVisitor()");
    const visitor = name(m, "market");
    m.run("toggleVisitor()");
    seen = {
      screen: name(m, "market"),
      liveScene: m.run<string>("LIVE_SCENE.map_structures.find(s=>s.key==='market').name"),
      base: m.run<number>("BASE_VERSION"),
      visitor,
      card: card(m),
    };
    rename(m, "gate", "Gate after undo");
    await publish(m);
    next = {
      live: m.village.live.version,
      market: liveName(m, "market"),
      gate: liveName(m, "gate"),
      history: m.village.revs.map((r) => `${r.version}:${(JSON.parse(r.scene) as Scene).map_structures.find((s) => s.key === "market")?.name}`),
    };
  });
  afterAll(() => m?.close());

  it("shows the land that is live again, to the cartographer and in the visitor view", () => {
    const original = SEED.map_structures.find((s) => s.key === "market")?.name;
    expect(seen.screen).toBe(original);
    expect(seen.liveScene).toBe(original);
    expect(seen.visitor).toBe(original);
  });

  it("forks from the version the undo made, with nothing left to publish", () => {
    expect(seen.base).toBe(8);
    expect(seen.card.bar.publishDisabled).toBe(true);
    expect(seen.card.open).toBe(false);
  });

  it("does not carry the undone change back with the next publish", () => {
    const original = SEED.map_structures.find((s) => s.key === "market")?.name;
    expect(next.live).toBe(9);
    expect(next.gate).toBe("Gate after undo");
    expect(next.market).toBe(original);
    expect(next.history).toEqual([`6:${original}`, "7:Market in v7", `8:${original}`, `9:${original}`]);
  });

  it("moved the untouched server draft along with the undo", () => {
    // After the second publish the route rebased it again, onto 9.
    expect(m.village.draft?.baseVersion).toBe(9);
  });
});

describe("after the undo, with work in hand (F19)", () => {
  let m: Booted;
  let seen: { market: string; gate: string; base: number };
  let refused: { title: string; live: number };
  beforeAll(async () => {
    m = await boot();
    build(m);
    rename(m, "market", "Market in v7");
    await publish(m);
    rename(m, "gate", "Gate in hand");
    undoThis(m)?.click();
    await settle(50);
    seen = { market: name(m, "market"), gate: name(m, "gate"), base: m.run<number>("BASE_VERSION") };
    await publish(m);
    refused = { title: m.el("#pubTitle").textContent ?? "", live: m.village.live.version };
  });
  afterAll(() => m?.close());

  it("puts the old version live and leaves the draft on screen untouched", () => {
    expect(m.village.live.version).toBe(8);
    expect(seen.gate).toBe("Gate in hand");
    expect(seen.market).toBe("Market in v7");
  });

  it("keeps the draft's base, so its next publish is refused and says why", () => {
    expect(seen.base, "rebasing here let the undone change ride the next publish").toBe(7);
    expect(refused.live).toBe(8);
    expect(refused.title).toBe("The live map moved while you were working");
  });
});

describe("Undo this, pressed while viewing as a visitor (F19)", () => {
  it("is refused, and asks nothing of the village", async () => {
    const m = await boot();
    build(m);
    rename(m, "market", "Market in v7");
    await publish(m);
    m.run("toggleVisitor()");
    undoThis(m)?.click();
    await settle(50);
    const toast = lastToast(m);
    const sent = restores(m).length;
    m.close();
    expect(sent).toBe(0);
    expect(toast).toContain("Go back to your draft, then undo.");
  });
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

describe("Save map skin inside the village (F78)", () => {
  it("keeps the look on screen, says where the village's look is set, and lists nothing to publish", async () => {
    const m = await boot();
    build(m);
    const edits = m.run<number>("EDITS.length");
    m.el("#skSave").click();
    const seen = { edits: m.run<number>("EDITS.length"), toast: lastToast(m), card: card(m) };
    m.close();
    expect(seen.edits).toBe(edits);
    expect(seen.toast).toContain("Village Settings");
    expect(seen.toast).not.toContain("remembers");
    expect(seen.card.bar.publishDisabled).toBe(true);
  });

  it("still saves into the scene when the map runs on its own, where the export is the outlet", async () => {
    const m = await boot({ shell: false });
    m.el("#skSave").click();
    const last = m.run<string>("EDITS[EDITS.length-1].action");
    m.close();
    expect(last).toBe("skin");
  });

  /* The twin in the same sheet. The village's skin names a label style and
     flow marks of its own, so these two selects were promised to every
     visitor on the publish card and overwritten by the next config push. */
  const pick = (m: Booted, id: string, value: string) => {
    const sel = m.el<HTMLSelectElement>(id);
    sel.value = value;
    sel.dispatchEvent(new m.window.Event("change"));
  };

  it("keeps a label style and flow marks on screen too, and lists neither to publish", async () => {
    const m = await boot();
    build(m);
    const edits = m.run<number>("EDITS.length");
    pick(m, "#skLabelStyle", "tablet");
    const labelToast = lastToast(m);
    pick(m, "#skFlow", "gold");
    const seen = {
      edits: m.run<number>("EDITS.length"),
      onScreen: m.run<[string, string, boolean]>("[SKIN.label_style,SKIN.flow_style,document.body.classList.contains('lbl-tablet')]"),
      labelToast,
      flowToast: lastToast(m),
      card: card(m),
    };
    m.close();
    expect(seen.onScreen).toEqual(["tablet", "gold", true]);
    expect(seen.edits).toBe(edits);
    expect(seen.labelToast).toContain("Village Settings");
    expect(seen.flowToast).toContain("Village Settings");
    expect(seen.card.bar.publishDisabled).toBe(true);
  });

  it("still logs a label style and flow marks when the map runs on its own", async () => {
    const m = await boot({ shell: false });
    pick(m, "#skLabelStyle", "tablet");
    pick(m, "#skFlow", "gold");
    const last = m.run<string[]>("EDITS.slice(-2).map(e=>e.action)");
    m.close();
    expect(last).toEqual(["label-style", "flow-style"]);
  });
});

/* THE OFFER COUNTS WHAT THE BAR WILL COUNT. A draft waiting to be opened
   says how many changes it holds, and its own comment promises the number
   the draft bar shows once it is open. The bar counts what a publish would
   change (F70), so a change and its undo are none; the offer counted every
   line of the journal, undos included, so a draft of one rename and a
   removal taken back was offered as "3 changes" and opened as "1". A draft
   whose every change was taken back holds nothing of its own, and is not
   offered at all, the rule a draft that is all live already keeps. */
describe("a saved draft offered after an undo", () => {
  /** Saves the work as a draft in the village, then opens the map again with that draft waiting. */
  async function offeredAfter(work: (m: Booted) => void) {
    const m = await boot();
    build(m);
    work(m);
    m.run("saveNow()");
    await settle(50);
    const draft = m.village.draft;
    m.close();
    expect(draft, "the village kept the draft").not.toBeNull();
    const scene = JSON.parse((draft as { scene: string }).scene) as Scene;
    expect(scene.map_structures.length, "the undo put the gate back in the draft").toBe(SEED.map_structures.length);
    const next = await boot();
    next.post({ ...next.village.hand(), draft: { scene, baseVersion: 6 } });
    return next;
  }

  it("says the number of changes the bar shows once the draft is open", async () => {
    const m = await offeredAfter((w) => {
      rename(w, "market", "Renamed Market");
      w.el('.poi[data-k="gate"] .rm').click();
      w.el("#undoBtn").click();
    });
    const offer = m.el("#restoreMsg").textContent ?? "";
    const shown = m.el("#restoreBar").style.display;
    m.el("#restoreYes").click();
    const bar = card(m).bar.state;
    m.close();
    expect(shown, "the draft is offered").toBe("flex");
    expect(bar, "the bar once it is open").toContain("1 unpublished change.");
    expect(offer).toContain("1 change.");
  });

  it("is not offered when every change in it was taken back", async () => {
    const m = await offeredAfter((w) => {
      w.el('.poi[data-k="gate"] .rm').click();
      w.el("#undoBtn").click();
    });
    const shown = m.el("#restoreBar").style.display;
    const offer = m.el("#restoreMsg").textContent ?? "";
    m.close();
    expect(shown, `offered as: ${offer}`).toBe("none");
  });
});

/*
 * ROUND 3 (2026-10-02), THE BUILD-MODE RE-SWEEP. Each was reproduced in
 * Chromium against a stand-in village and again by an independent skeptic,
 * and each case below fails on the artifact as it stood before its fix.
 */

/* Finding 1. View as visitor rebuilds every seat, quest and flow on the way
   back, and a card row's undo record held the old object: Undo said it had
   taken the change back and changed nothing, and the change dropped off the
   publish card while it stayed on the land. */
describe("Undo of a card row after a look at the live map (round 3, finding 1)", () => {
  /* Each list read the way a publish would carry it: a seat or quest by its
     name and its place, a flow whole. A restore fills in fields the live
     export leaves out (a quest's key, a guessed address), so comparing whole
     quest rows called the untouched land different. Each case reads the
     comparison before its edit as well, so a false here is about the edit. */
  const sameAsLive = (m: Booted, block: string) =>
    m.run<(b: string) => boolean>(
      `(b=>{const p={org_roles:r=>r.role+'@'+r.structure_key,quests:r=>r.title+'@'+r.structure_key}[b]||(r=>JSON.stringify(r));
        return JSON.stringify(buildExportJSON()[b].map(p))===JSON.stringify(LIVE_SCENE[b].map(p))})`,
    )(block);
  const roundTrip = (m: Booted) => {
    m.run("toggleVisitor()");
    m.run("toggleVisitor()");
  };

  it("takes back a seat moved on the card, and leaves nothing to publish", async () => {
    const m = await boot();
    build(m);
    const control = sameAsLive(m, "org_roles");
    m.run<(key: string) => void>("openInspect")("library");
    const box = [...m.window.document.querySelectorAll<HTMLInputElement>("[data-seat]")].find((b) => !b.checked);
    expect(box, "the library's card offers a seat to move there").toBeTruthy();
    if (box) {
      box.checked = true;
      box.dispatchEvent(new m.window.Event("change"));
    }
    const moved = !sameAsLive(m, "org_roles");
    roundTrip(m);
    m.el("#undoBtn").click();
    const seen = { toast: lastToast(m), same: sameAsLive(m, "org_roles"), net: m.run<number>("netChanges().length"), card: card(m) };
    m.close();
    expect(control, "the screen matches the live map before the edit").toBe(true);
    expect(moved, "the tick moved a seat").toBe(true);
    expect(seen.toast).toMatch(/^Undid: moved a seat to /);
    expect(seen.same, "the seat is back where the live map has it").toBe(true);
    expect(seen.net).toBe(0);
    expect(seen.card.bar.publishDisabled).toBe(true);
  });

  it("takes back a quest and a flow added on the card, newest first", async () => {
    const m = await boot();
    build(m);
    const control = { quests: sameAsLive(m, "quests"), flows: sameAsLive(m, "map_flows") };
    m.run<(key: string) => void>("openInspect")("market");
    m.el<HTMLInputElement>("#iQTitle").value = "A probe quest";
    m.el("#iQAdd").click();
    m.el("#iFOutAdd").click();
    const added = { quests: !sameAsLive(m, "quests"), flows: !sameAsLive(m, "map_flows") };
    roundTrip(m);
    m.el("#undoBtn").click();
    const flowToast = lastToast(m);
    m.el("#undoBtn").click();
    const seen = { flowToast, questToast: lastToast(m), quests: sameAsLive(m, "quests"), flows: sameAsLive(m, "map_flows"), net: m.run<number>("netChanges().length") };
    m.close();
    expect(control, "the screen matches the live map before the edits").toEqual({ quests: true, flows: true });
    expect(added).toEqual({ quests: true, flows: true });
    expect(seen.flowToast).toMatch(/^Undid: drew a flow/);
    expect(seen.questToast).toBe("Undid: created a quest A probe quest.");
    expect(seen).toMatchObject({ quests: true, flows: true, net: 0 });
  });

  /* The second line of defence: a record that finds nothing to act on says
     so and leaves the journal alone, so the change stays listed. The rows
     are rebuilt here by hand, as any future path that rebuilds them would. */
  it("says a change it cannot reach stays, and leaves it on the publish card", async () => {
    const m = await boot();
    build(m);
    m.run<(key: string) => void>("openInspect")("market");
    m.el<HTMLInputElement>("#iSeatName").value = "Keeper of the scales";
    m.el("#iSeatAdd").click();
    m.run("SCENE.seats=SCENE.seats.map(x=>Object.assign({},x))");
    const edits = m.run<number>("EDITS.length");
    m.el("#undoBtn").click();
    const seen = {
      toast: lastToast(m),
      edits: m.run<number>("EDITS.length"),
      seat: m.run<boolean>("SCENE.seats.some(x=>x.s==='Keeper of the scales')"),
      card: card(m),
    };
    m.close();
    expect(seen.toast).toBe('"created a seat Keeper of the scales" can no longer be taken back, so it stays in your draft.');
    expect(seen.edits, "no undo line was written").toBe(edits);
    expect(seen.seat).toBe(true);
    expect(seen.card.list).toEqual(["created a seat Keeper of the scales"]);
  });
});

/* Finding 6. The refused-publish card listed every unpublished line of the
   journal, so a change taken back before publishing was listed to make
   again, with its undo. */
describe("the refused-publish card (round 3, finding 6)", () => {
  it("lists to make again exactly what the publish card listed", async () => {
    const m = await boot();
    build(m);
    rename(m, "gate", "Renamed Gate");
    drag(m, "gate", 30, 20);
    m.el("#undoBtn").click();
    m.village.publishedBy("Other Admin", (s) => {
      const market = s.map_structures.find((x) => x.key === "market");
      if (market) market.name = "Market by Other Admin";
    });
    const asked = await publish(m);
    const refused = { title: m.el("#pubTitle").textContent ?? "", list: [...m.window.document.querySelectorAll("#pubList li")].map((li) => li.textContent ?? "") };
    m.close();
    expect(asked.list).toEqual(["renamed gate"]);
    expect(refused.title).toBe("The live map moved while you were working");
    expect(refused.list.slice(2)).toEqual(asked.list);
  });
});

