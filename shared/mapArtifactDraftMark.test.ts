/**
 * "OPEN MY DRAFT" COUNTS THE DRAFT'S OWN CHANGES, AND NOTHING THE LIVE MAP ALREADY HAS.
 *
 * A cartographer's draft is saved whole: the live map's history with their
 * own changes on the end. On 2026-10-01 opening one with a single change of
 * their own showed "54 unpublished changes", and the publish card listed 53
 * edits that were already live as about to "become the map every visitor
 * sees". The handler set PUBLISH_MARK to 0 after restoring the draft, so every
 * edit in its history counted. #399 had fixed the same count on the live-scene
 * path and left this one.
 *
 * The mark is now the newest edit the draft SHARES with the live journal, an
 * edit being the same one on both sides when its seq and its time agree. The
 * highest live seq would be shorter to write and wrong: a draft forked from
 * an older version numbers its own changes from where that version stopped,
 * and a colleague who published since used the same numbers, so the stale
 * case below hides two of the draft's three changes under that rule.
 *
 * Runs the real artifact in jsdom, outside any shell, and plays the shell's
 * side by dispatching the messages LivingMap.tsx posts. The platform stubs
 * mirror mapArtifactBoot.test.ts, which says why each one exists.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ARTIFACT = path.resolve(__dirname, "../docs/prototypes/grounds-v0.html");
const html = fs.readFileSync(ARTIFACT, "utf8");
/** The key the artifact keeps this browser's saved work under, read from the
    line that offers it back, so a rename moves this test with it. */
const SAVE_KEY = /localStorage\.getItem\('([^']*grounds-scene)'\)/.exec(html)?.[1] ?? "";

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

interface Edit {
  seq: number;
  actor: string;
  action: string;
  target: string;
  diff: Record<string, unknown>;
  at: string;
}
interface Scene {
  map_edits: Edit[];
  map_structures: { key: string; name: string }[];
  [k: string]: unknown;
}

interface Booted {
  window: ArtifactWindow;
  uncaught: unknown[];
  run<T>(src: string): T;
  /** A message from the shell, in the shape LivingMap.tsx posts it. */
  post(data: Record<string, unknown>): void;
  close(): void;
}

function boot(localSave?: Scene): Booted {
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
      if (localSave) w.localStorage.setItem(SAVE_KEY, JSON.stringify(localSave));
    },
  });
  return {
    window,
    uncaught,
    run: <T>(src: string) => window.eval(src) as T,
    post(data) {
      // Through the window's own JSON, so the artifact holds objects of its
      // own realm, the way a structured clone arrives.
      const own = window.eval("JSON").parse(JSON.stringify(data));
      window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
    },
    close: () => window.close(),
  };
}

const edit = (seq: number, action: string, target: string, at: string): Edit => ({
  seq,
  actor: "founder",
  action,
  target,
  diff: {},
  at,
});

/** The live history every scene below shares: three edits made in August. */
const HISTORY = [
  edit(1, "phase", "structure:kitchen", "2026-08-01T10:00:00.000Z"),
  edit(2, "blurb", "structure:library", "2026-08-02T10:00:00.000Z"),
  edit(3, "circle", "structure:market", "2026-08-03T10:00:00.000Z"),
];
/** The cartographer's own work, made after forking from version 6. */
const MINE = [
  edit(4, "rename", "structure:gate", "2026-10-01T12:00:00.000Z"),
  edit(5, "rename", "structure:welcome", "2026-10-01T12:01:00.000Z"),
  edit(6, "phase", "structure:gate", "2026-10-01T12:02:00.000Z"),
];
/** A colleague's, published as version 7 from the same fork. Seqs 4 and 5
    again, at other times. */
const THEIRS = [
  edit(4, "phase", "structure:kitchen", "2026-09-30T09:00:00.000Z"),
  edit(5, "blurb", "structure:market", "2026-09-30T09:05:00.000Z"),
];
const DRAFT_GATE = "The Draft Gate";

let BASE: Scene;
function scene(edits: Edit[], gateName?: string): Scene {
  const s = JSON.parse(JSON.stringify(BASE)) as Scene;
  s.map_edits = edits.map((e) => ({ ...e }));
  if (gateName) {
    const gate = s.map_structures.find((r) => r.key === "gate");
    if (gate) gate.name = gateName;
  }
  return s;
}
const live6 = () => scene(HISTORY);
const live7 = () => scene([...HISTORY, ...THEIRS]);
const draftOf = (mine: Edit[]) => ({ scene: scene([...HISTORY, ...mine], DRAFT_GATE), baseVersion: 6 });

const config = (s: Scene | null, version: number) => (s ? { type: "config", scene: s, sceneVersion: version } : { type: "config" });
const hand = (liveVersion: number, draft: unknown) => ({
  type: "hand",
  canEdit: true,
  canPublish: true,
  liveVersion,
  live: liveVersion ? { version: liveVersion, by: "the founder", previous: liveVersion - 1 } : null,
  draft,
});

const offerText = (m: Booted) => m.window.document.getElementById("restoreMsg")?.textContent ?? "";
const press = (m: Booted, id: string) => (m.window.document.getElementById(id) as HTMLElement | null)?.click();
const unpublished = (m: Booted) => m.run<{ seq: number; target: string }[]>("unpublished().map(e=>({seq:e.seq,target:e.target}))");
function publishCard(m: Booted) {
  m.run("openPublish()");
  const doc = m.window.document;
  const card = {
    open: !!doc.getElementById("pubWrap")?.classList.contains("show"),
    blast: doc.getElementById("pubBlast")?.textContent ?? "",
    list: [...doc.querySelectorAll("#pubList li")].map((li) => li.textContent ?? ""),
  };
  m.run("closePublish()");
  return card;
}

beforeAll(async () => {
  // The scenes below are the artifact's own export with a journal written
  // in, so they are exactly the shape its restore reads.
  const m = boot();
  await settle(200);
  BASE = JSON.parse(JSON.stringify(m.run<Scene>("buildExportJSON()")));
  m.close();
});

it("the artifact still has the parts this guard drives (the positive control)", () => {
  expect(html).toContain('id="restoreYes"');
  expect(html).toContain("function unpublished(");
  expect(SAVE_KEY, "the key the browser's saved work is offered back from").not.toBe("");
  expect(BASE.map_structures.some((r) => r.key === "gate"), "the seed has a gate to rename").toBe(true);
  expect(BASE.map_edits, "the seed export carries no journal of its own").toEqual([]);
});

interface Seen {
  offer: string;
  gate: string;
  unpublished: { seq: number; target: string }[];
  base: number;
  card: ReturnType<typeof publishCard>;
}
/** What a cartographer sees once the draft is open: read before anything else moves. */
function look(m: Booted, offer: string): Seen {
  return {
    offer,
    gate: m.run<string>("BY.gate.name"),
    unpublished: unpublished(m),
    base: m.run<number>("BASE_VERSION"),
    card: publishCard(m),
  };
}

describe("a draft with one change of its own, over the live journal it forked from", () => {
  let m: Booted;
  let seen: Seen;
  beforeAll(async () => {
    m = boot();
    await settle(200);
    m.post(config(live6(), 6));
    m.post(hand(6, draftOf(MINE.slice(0, 1))));
    const offer = offerText(m);
    press(m, "restoreYes");
    seen = look(m, offer);
  });
  afterAll(() => m?.close());

  it("is offered as one change", () => {
    expect(seen.offer).toContain("1 change.");
  });

  it("draws the draft, and counts one unpublished change", () => {
    expect(seen.gate).toBe(DRAFT_GATE);
    expect(seen.unpublished).toEqual([{ seq: 4, target: "structure:gate" }]);
  });

  it("puts only that change on the publish card", () => {
    expect(seen.card.open).toBe(true);
    expect(seen.card.blast).toMatch(/^1 change will become the map/);
    expect(seen.card.list).toEqual(["renamed gate"]);
  });

  it("threw nothing", () => {
    expect(m.uncaught).toEqual([]);
  });
});

describe("a stale draft, whose own seqs collide with a colleague's newer live edits", () => {
  let m: Booted;
  let seen: Seen;
  beforeAll(async () => {
    m = boot();
    await settle(200);
    m.post(config(live7(), 7));
    m.post(hand(7, draftOf(MINE)));
    const offer = offerText(m);
    press(m, "restoreYes");
    seen = look(m, offer);
  });
  afterAll(() => m?.close());

  it("is the case it says it is: the live map's newest seq is above two of the draft's own", () => {
    expect(Math.max(...live7().map_edits.map((e) => e.seq))).toBe(5);
    expect(MINE.filter((e) => e.seq <= 5)).toHaveLength(2);
  });

  it("counts all three of the draft's own changes, and none of the colleague's", () => {
    expect(seen.offer).toContain("3 changes.");
    expect(seen.unpublished.map((e) => e.seq)).toEqual([4, 5, 6]);
    expect(seen.card.list).toEqual(["changed the phase of gate", "renamed welcome", "renamed gate"]);
  });

  it("keeps the base it forked from, so the publish is refused and explains itself", () => {
    expect(seen.base).toBe(6);
  });
});

describe("a draft when nothing has been published yet", () => {
  let m: Booted;
  let seen: Seen;
  beforeAll(async () => {
    m = boot();
    await settle(200);
    m.post(config(null, 0));
    m.post(hand(0, { ...draftOf(MINE.slice(0, 1)), baseVersion: 0 }));
    const offer = offerText(m);
    press(m, "restoreYes");
    seen = look(m, offer);
  });
  afterAll(() => m?.close());

  it("counts every edit in it, because none of them is live", () => {
    expect(m.run<unknown>("LIVE_SCENE")).toBeNull();
    expect(seen.offer).toContain("4 changes.");
    expect(seen.unpublished).toHaveLength(4);
    expect(seen.card.blast).toContain("This is the first published version.");
  });
});

describe("the live scene landing after the draft was offered", () => {
  it("re-counts the offer once it can tell which edits are live", async () => {
    const m = boot();
    await settle(200);
    m.post(hand(6, draftOf(MINE.slice(0, 1))));
    m.post(config(live6(), 6));
    const offer = offerText(m);
    m.close();
    expect(offer).toContain("1 change.");
  });

  it("does not paint the live land over a draft that was already opened", async () => {
    const m = boot();
    await settle(200);
    m.post(hand(6, draftOf(MINE.slice(0, 1))));
    press(m, "restoreYes");
    m.post(config(live6(), 6));
    const seen = look(m, "");
    m.close();
    expect(seen.gate, "the draft is still on screen").toBe(DRAFT_GATE);
    expect(seen.unpublished).toEqual([{ seq: 4, target: "structure:gate" }]);
    expect(seen.base).toBe(6);
  });
});

describe("viewing as a visitor while the live map moves", () => {
  let m: Booted;
  let visiting: { edits: number; unpublished: { seq: number; target: string }[]; publish: string };
  let seen: Seen;
  beforeAll(async () => {
    m = boot();
    await settle(200);
    m.post(config(live6(), 6));
    m.post(hand(6, draftOf(MINE.slice(0, 1))));
    press(m, "restoreYes");
    m.run("toggleVisitor()");
    m.post(config(live7(), 7));
    m.run("openPublish()");
    visiting = {
      edits: m.run<number>("EDITS.length"),
      unpublished: unpublished(m),
      publish: m.window.document.getElementById("toasts")?.lastElementChild?.textContent ?? "",
    };
    m.run("closePublish()");
    m.run("toggleVisitor()");
    seen = look(m, "");
  });
  afterAll(() => m?.close());

  it("shows the new live map to the visitor", () => {
    expect(visiting.edits).toBe(5);
  });

  it("counts the draft's work while visiting, never the colleague's live edits on screen", () => {
    // Discard draft reads this count while the visitor view is up.
    expect(visiting.unpublished).toEqual([{ seq: 4, target: "structure:gate" }]);
  });

  it("will not publish from the visitor view, where the land on screen is the live map", () => {
    expect(visiting.publish).toContain("Go back to your draft to publish it.");
  });

  it("brings the draft back with its own change still unpublished and its base unmoved", () => {
    expect(seen.gate).toBe(DRAFT_GATE);
    expect(seen.unpublished).toEqual([{ seq: 4, target: "structure:gate" }]);
    expect(seen.base, "a silent rebase would publish over the colleague").toBe(6);
  });
});

describe("work this browser saved, restored over a live map that has moved", () => {
  let m: Booted;
  let seen: Seen;
  beforeAll(async () => {
    m = boot(scene([...HISTORY, ...MINE.slice(0, 1)], DRAFT_GATE));
    await settle(200);
    m.post(config(live7(), 7));
    m.post(hand(7, null));
    const offer = offerText(m);
    press(m, "restoreYes");
    seen = look(m, offer);
  });
  afterAll(() => m?.close());

  it("counts the saved work's own change, which the live map's newer seqs would hide", () => {
    expect(seen.offer).toContain("Saved work found in this browser");
    expect(seen.gate).toBe(DRAFT_GATE);
    expect(seen.unpublished).toEqual([{ seq: 4, target: "structure:gate" }]);
  });
});
