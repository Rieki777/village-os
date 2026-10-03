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

/** A message the map posted to its shell. */
interface Asked {
  type: string;
  nonce?: string;
  scene?: Scene;
  baseVersion?: number;
  [k: string]: unknown;
}

interface Booted {
  window: ArtifactWindow;
  uncaught: unknown[];
  /** Everything the map posted to its parent, in order. Empty standalone. */
  asked: Asked[];
  run<T>(src: string): T;
  /** A message from the shell, in the shape LivingMap.tsx posts it. */
  post(data: Record<string, unknown>): void;
  /** The shell's answer to one of the map's questions, as relayScene sends it. */
  answer(q: Asked, result: Record<string, unknown>): Promise<void>;
  close(): void;
}

interface BootOptions {
  /** Run inside a shell: `window.parent` is not the window, and what the map
      posts to it is kept in `asked`. Standalone otherwise, as in every QA suite. */
  shell?: boolean;
  /** This browser's storage as a previous visit left it. */
  storage?: Record<string, string>;
}

function boot(localSave?: Scene | null, opts: BootOptions = {}): Booted {
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
      if (opts.shell) {
        // The one thing that makes the map believe it is framed. Its
        // inShell() asks exactly this, and shellPost writes to it.
        const shell = { postMessage: (m: Asked) => asked.push(m) };
        Object.defineProperty(w, "parent", { configurable: true, get: () => shell });
      }
      for (const [k, v] of Object.entries(opts.storage ?? {})) w.localStorage.setItem(k, v);
      if (localSave) w.localStorage.setItem(SAVE_KEY, JSON.stringify(localSave));
    },
  });
  const post = (data: Record<string, unknown>) => {
    // Through the window's own JSON, so the artifact holds objects of its
    // own realm, the way a structured clone arrives.
    const own = window.eval("JSON").parse(JSON.stringify(data));
    window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
  };
  return {
    window,
    uncaught,
    asked,
    run: <T>(src: string) => window.eval(src) as T,
    post,
    async answer(q, result) {
      post({ type: "scene-result", of: q.type, nonce: q.nonce, ...result });
      await settle(0);
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

describe("a vital number held in the draft", () => {
  let seen: { liveCopy: string; held: string; visitor: string; back: string; discarded: string; noHolds: string };
  beforeAll(async () => {
    const m = boot();
    await settle(200);
    m.post(config(live6(), 6));
    m.run("buildMode=true;openVitalDrop('people',document.body);document.getElementById('vOvr').value='99';vitalSet('people')");
    const src = () => m.run<string>("vitalsData().people.src");
    const liveCopy = m.run<string>("JSON.stringify(LIVE_SCENE.vital_overrides||{})");
    const held = src();
    m.run("toggleVisitor()");
    const visitor = src();
    m.run("toggleVisitor()");
    const back = src();
    m.run("restoreScene(LIVE_SCENE)"); // what Discard draft puts back
    const discarded = src();
    // A scene that carries no holds at all, the shape every scene published
    // before holds existed has.
    m.run("vitalSet('people');const s=JSON.parse(JSON.stringify(LIVE_SCENE));delete s.vital_overrides;restoreScene(s)");
    seen = { liveCopy, held, visitor, back, discarded, noHolds: src() };
    m.close();
  });

  it("never reaches the live map's copy", () => {
    expect(seen.liveCopy).toBe("{}");
  });

  it("is the draft's: held there, absent from the visitor's view, back with the draft, gone on discard", () => {
    expect(seen.held).toBe("founder-set");
    expect(seen.visitor).not.toBe("founder-set");
    expect(seen.back).toBe("founder-set");
    expect(seen.discarded).not.toBe("founder-set");
  });

  it("is cleared by a scene that holds nothing, where it used to stay on screen", () => {
    expect(seen.noHolds).not.toBe("founder-set");
  });
});

/*
 * INSIDE A SHELL: THE SAVE, THE VISITOR VIEW, AND THE WAY BACK FROM A REFUSAL.
 *
 * Everything below runs the map framed, the way /map runs it: `window.parent`
 * is a stand-in that keeps what the map posts, and each answer is posted back
 * in the shape relayScene sends. Where a sentence on screen, a message to the
 * shell, or the next visit can say what happened, that is what is read,
 * because those are what a cartographer meets.
 *
 * The 2.5 s autosave is waited out for real. The jsdom window owns its own
 * timers, so a fake clock in this process would not reach them. Each boot of
 * the artifact costs about two seconds, so a case shares one where it can.
 */
const SAVE_WAIT = 2700;
const asks = (m: Booted, type: string) => m.asked.filter((q) => q.type === type);
const lastAsk = (m: Booted, type: string) => {
  const all = asks(m, type);
  return all[all.length - 1];
};
const nameIn = (s: Scene | undefined, key: string) => s?.map_structures.find((r) => r.key === key)?.name;
const bar = (m: Booted) => m.window.document.getElementById("draftState")?.textContent ?? "";
const cardOpen = (m: Booted) => !!m.window.document.getElementById("pubWrap")?.classList.contains("show");
const restoreShown = (m: Booted) => (m.window.document.getElementById("restoreBar") as HTMLElement | null)?.style.display !== "none";
const publishDisabled = (m: Booted) => (m.window.document.getElementById("pubGo") as HTMLButtonElement).disabled;
/** The inspect card's own two steps: the name changes, then the edit is logged.
    The values go in as arguments, never spliced into the code the page runs. */
const rename = (m: Booted, key: string, to: string) =>
  m.run<(key: string, to: string) => void>("((k,to)=>{BY[k].name=to;logEdit('rename','structure:'+k,{to})})")(key, to);
/** Whether closing the page now would ask first. */
const asksBeforeLeaving = (m: Booted) =>
  m.run<boolean>("(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented})()");
/** Answer the newest question of a kind, after checking it was asked at all. */
async function answerLast(m: Booted, type: string, result: Record<string, unknown>) {
  const q = lastAsk(m, type);
  expect(q, `the map asked the village for a ${type}`).toBeDefined();
  await m.answer(q, result);
  return q;
}
function storageOf(m: Booted): Record<string, string> {
  const s = m.window.localStorage;
  const out: Record<string, string> = {};
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k) out[k] = s.getItem(k) ?? "";
  }
  return out;
}
function recordToasts(m: Booted) {
  m.run(`window.__toasts=[];new MutationObserver(ms=>ms.forEach(x=>x.addedNodes.forEach(n=>__toasts.push(n.textContent))))
    .observe(document.getElementById('toasts'),{childList:true})`);
}
async function toasts(m: Booted) {
  await settle(0);
  return m.run<string[]>("__toasts.slice()");
}
const visitorHand = (liveVersion: number) => ({ ...hand(liveVersion, null), canEdit: false, canPublish: false });
const REACH = "The village could not be reached. Your work is still here.";

/** On /map, version 6 live and nothing waiting: a cartographer unless a hand is given. */
async function framed(opts: BootOptions = {}, theHand: Record<string, unknown> = hand(6, null)) {
  const m = boot(null, { shell: true, ...opts });
  await settle(200);
  recordToasts(m);
  m.post(config(live6(), 6));
  m.post(theHand);
  return m;
}

describe("an edit, on the draft bar", () => {
  it("counts the moment it is made, and Publish opens for it, with no wait for the save", async () => {
    const m = await framed();
    press(m, "buildBtn");
    const before = { bar: bar(m), publishDisabled: publishDisabled(m) };
    rename(m, "gate", "Edit One");
    const after = { bar: bar(m), publishDisabled: publishDisabled(m) };
    rename(m, "welcome", "Edit Two");
    const second = bar(m);
    m.close();
    expect(before).toEqual({ bar: "Editing a draft. The live map is unchanged.", publishDisabled: true });
    expect(after.bar).toMatch(/^1 unpublished change\./);
    expect(after.publishDisabled).toBe(false);
    expect(second).toMatch(/^2 unpublished changes\./);
  });
});

describe("a config push from the shell, under an open inspect card", () => {
  let m: Booted;
  let sameVersion: { card: boolean };
  let newVersion: { onMap: string; saved: string };
  let againWithWork: string[];
  beforeAll(async () => {
    m = await framed();
    m.run("openInspect('market');window.__card=BY.market");
    // A skin saved in Village Settings re-pushes the config, scene and all.
    m.post(config(live6(), 6));
    sameVersion = { card: m.run<boolean>("BY.market===window.__card") };
    m.post(config(live7(), 7));
    m.run(`(()=>{const i=document.getElementById('iName');i.value='Typed after the push';
      i.dispatchEvent(new Event('input'));i.dispatchEvent(new Event('change'))})()`);
    newVersion = {
      onMap: m.run<string>("BY.market.name"),
      saved: m.run<string>("buildExportJSON().map_structures.find(r=>r.key==='market').name"),
    };
    m.run("__toasts.length=0");
    m.post(config(live7(), 7));
    againWithWork = await toasts(m);
  });
  afterAll(() => m?.close());

  it("of the version already on screen leaves the card bound to the place it is editing", () => {
    expect(sameVersion.card).toBe(true);
  });

  it("of a new version binds the card to the new place, so what is typed is what is saved", () => {
    expect(newVersion).toEqual({ onMap: "Typed after the push", saved: "Typed after the push" });
  });

  it("of the version already on screen is not news to a draft", () => {
    expect(againWithWork.join(" ")).not.toContain("The live map changed");
  });
});

describe("a save the village refuses", () => {
  let m: Booted;
  let refused: { bar: string; toasts: string[]; leaving: boolean };
  beforeAll(async () => {
    m = await framed();
    press(m, "buildBtn");
    rename(m, "gate", "Edit One");
    await settle(SAVE_WAIT);
    await answerLast(m, "draft-save", { ok: false, error: "auth_required" });
    refused = { bar: bar(m), toasts: await toasts(m), leaving: asksBeforeLeaving(m) };
  });
  afterAll(() => m?.close());

  it("says so on the bar, in words, where it used to go on counting changes", () => {
    expect(refused.bar).toMatch(/^Not saved\. You are signed out\. Sign in again/);
    expect(refused.bar).toContain("Your changes are still on this screen.");
  });

  it("says it once in a toast, and never that the work saved itself", () => {
    expect(refused.toasts.filter((t) => t.startsWith("Not saved."))).toHaveLength(1);
    expect(refused.toasts.join(" ")).not.toContain("saves itself");
  });

  it("asks before the page closes over the refused work", () => {
    expect(refused.leaving).toBe(true);
  });

  it("tries again from the bar, sends the newer work once the retry has answered, and a save the village takes clears it", async () => {
    const before = asks(m, "draft-save").length;
    press(m, "saveRetry");
    expect(asks(m, "draft-save")).toHaveLength(before + 1);
    const retried = lastAsk(m, "draft-save");
    expect(nameIn(retried.scene, "gate")).toBe("Edit One");
    rename(m, "welcome", "Edit Two");
    await settle(SAVE_WAIT);
    // One save on the wire at a time: the newer work waits for the retry.
    expect(asks(m, "draft-save")).toHaveLength(before + 1);
    await m.answer(retried, { ok: true, baseVersion: 6 });
    const newest = lastAsk(m, "draft-save");
    expect(asks(m, "draft-save")).toHaveLength(before + 2);
    expect(nameIn(newest.scene, "welcome")).toBe("Edit Two");
    expect(asksBeforeLeaving(m), "the newer work is still on its way").toBe(true);
    await m.answer(newest, { ok: true, baseVersion: 6 });
    // A second answer to the retry, arriving late, must not undo the newer yes.
    await m.answer(retried, { ok: false, error: REACH });
    expect(bar(m)).toMatch(/^2 unpublished changes\./);
    expect(asksBeforeLeaving(m)).toBe(false);
  });
});


describe("work the village refused, on the next visit", () => {
  /** What the village took (the draft row), and what this browser kept. */
  let took: Asked;
  let kept: Record<string, string>;
  beforeAll(async () => {
    const m = await framed();
    rename(m, "gate", "Edit One");
    await settle(SAVE_WAIT);
    took = await answerLast(m, "draft-save", { ok: true, baseVersion: 6 });
    rename(m, "welcome", "Edit Two");
    await settle(SAVE_WAIT);
    await answerLast(m, "draft-save", { ok: false, error: REACH });
    kept = storageOf(m);
    m.close();
  });

  it("is offered over the older draft the village still holds, opens whole, and goes to the village", async () => {
    const m = boot(null, { shell: true, storage: kept });
    await settle(200);
    m.post(config(live6(), 6));
    m.post(hand(6, { scene: took.scene, baseVersion: 6 }));
    const offer = offerText(m);
    press(m, "restoreYes");
    const opened = { gate: m.run<string>("BY.gate.name"), welcome: m.run<string>("BY.welcome.name") };
    const resent = lastAsk(m, "draft-save");
    m.close();
    expect(offer).toContain("2 changes.");
    expect(opened).toEqual({ gate: "Edit One", welcome: "Edit Two" });
    expect(nameIn(resent?.scene, "welcome")).toBe("Edit Two");
  });

  it("opens on the version it forked from, so a publish over a colleague's newer one is refused", async () => {
    const m = boot(null, { shell: true, storage: kept });
    await settle(200);
    m.post(config(live7(), 7));
    m.post(hand(7, null));
    press(m, "restoreYes");
    m.run("openPublish()");
    press(m, "pubConfirm");
    // Opening this browser's copy sent it to the village, and a publish lets
    // a save on the wire land first.
    await answerLast(m, "draft-save", { ok: true, baseVersion: 6 });
    const published = lastAsk(m, "publish");
    m.close();
    expect(published?.baseVersion).toBe(6);
  });

  it("is not offered to whoever uses the browser next without a hand, and their page closes without asking", async () => {
    const m = await framed({ storage: kept }, visitorHand(6));
    const offered = restoreShown(m);
    // The live map arrives with its own history, which used to count as unsaved.
    rename(m, "gate", "A visitor's own local change");
    const leaving = asksBeforeLeaving(m);
    m.close();
    expect(offered).toBe(false);
    expect(leaving).toBe(false);
  });
});


describe("an edit committed by the click on View as visitor", () => {
  it("reaches the village before the live map is drawn, and nothing saves the live map in its place", async () => {
    const m = await framed();
    press(m, "buildBtn");
    rename(m, "market", "Renamed then looked");
    m.run("toggleVisitor()");
    const atOnce = asks(m, "draft-save").map((q) => nameIn(q.scene, "market"));
    await settle(SAVE_WAIT);
    const later = asks(m, "draft-save").map((q) => nameIn(q.scene, "market"));
    m.close();
    expect(atOnce).toEqual(["Renamed then looked"]);
    expect(later).toEqual(["Renamed then looked"]);
  });
});


describe("publishing or discarding inside the 2.5 s save window", () => {
  let saves: { afterPublish: number; afterDiscard: number; afterRefusal: (string | undefined)[] };
  beforeAll(async () => {
    const m = await framed();
    rename(m, "gate", "Q1");
    m.run("openPublish()");
    press(m, "pubConfirm");
    await answerLast(m, "publish", { ok: true, version: 7, live: { version: 7, by: "me", previous: 6 } });
    await settle(SAVE_WAIT);
    const afterPublish = asks(m, "draft-save").length;
    rename(m, "gate", "Q2");
    m.run("openDiscard()");
    press(m, "pubConfirm");
    await answerLast(m, "draft-discard", { ok: true });
    await settle(SAVE_WAIT);
    const afterDiscard = asks(m, "draft-save").length;
    rename(m, "gate", "Q3");
    m.run("openPublish()");
    press(m, "pubConfirm");
    await answerLast(m, "publish", { ok: false, error: "Publishing the map is a cartographer's work. Your draft is safe and still yours." });
    await settle(SAVE_WAIT);
    saves = { afterPublish, afterDiscard, afterRefusal: asks(m, "draft-save").slice(afterDiscard).map((q) => nameIn(q.scene, "gate")) };
    m.close();
  });

  it("leaves no save behind a publish the village took", () => {
    expect(saves.afterPublish).toBe(0);
  });

  it("leaves no save behind a discard the village took", () => {
    expect(saves.afterDiscard).toBe(0);
  });

  // The guard on the guard: holding the save back for a publish must not
  // lose it when the publish is refused. The old map passed this one too.
  it("still saves the work when the village refuses the publish", () => {
    expect(saves.afterRefusal).toEqual(["Q3"]);
  });
});


describe("discarded work and this browser", () => {
  it("is not offered back on the next visit", async () => {
    const m = await framed();
    rename(m, "market", "Work I threw away");
    await settle(SAVE_WAIT);
    // Refused, so this browser is holding a copy of it when the discard comes.
    await answerLast(m, "draft-save", { ok: false, error: REACH });
    m.run("openDiscard()");
    press(m, "pubConfirm");
    await answerLast(m, "draft-discard", { ok: true });
    const kept = storageOf(m);
    m.close();
    const next = await framed({ storage: kept });
    const offered = restoreShown(next);
    next.close();
    expect(offered).toBe(false);
  });
});


describe("a saved draft with nothing of its own", () => {
  // What a save landing after a publish used to leave on the server: the live
  // land again, a timestamp apart, offered as "no changes" on every visit.
  it("is not offered, and does not hold the build hand closed", async () => {
    const m = await framed({}, hand(6, { scene: live6(), baseVersion: 6 }));
    const offered = restoreShown(m);
    press(m, "buildBtn");
    const build = m.run<boolean>("buildMode");
    m.close();
    expect(offered).toBe(false);
    expect(build).toBe(true);
  });
});


describe("View as visitor", () => {
  let m: Booted;
  let visiting: {
    build: boolean;
    bodyBuild: boolean;
    discardShown: boolean;
    buildAfterPress: boolean;
    discardCard: boolean;
    toasts: string[];
  };
  beforeAll(async () => {
    m = await framed();
    press(m, "buildBtn");
    rename(m, "gate", "Held while visiting");
    m.run("toggleVisitor()");
    const doc = m.window.document;
    const build = m.run<boolean>("buildMode");
    const bodyBuild = doc.body.classList.contains("build");
    const discardShown = (doc.getElementById("dropBtn") as HTMLElement).style.display !== "none";
    press(m, "buildBtn");
    const buildAfterPress = m.run<boolean>("buildMode");
    m.run("openDiscard()");
    // A change that still reaches the land while visiting, such as a sheet
    // left open: twice, to hear the note once.
    rename(m, "market", "Made while visiting");
    rename(m, "market", "Made while visiting again");
    visiting = { build, bodyBuild, discardShown, buildAfterPress, discardCard: cardOpen(m), toasts: await toasts(m) };
    m.run("closePublish();toggleVisitor()");
  });
  afterAll(() => m?.close());

  it("puts the editor's hand down: no build mode, and no Discard draft on the bar", () => {
    expect(visiting.build).toBe(false);
    expect(visiting.bodyBuild).toBe(false);
    expect(visiting.discardShown).toBe(false);
  });

  it("keeps it down, and says why", () => {
    expect(visiting.buildAfterPress).toBe(false);
    expect(visiting.toasts).toContain("You are looking at the live map. Go back to your draft to build.");
  });

  it("will not throw away a draft it is not showing", () => {
    expect(visiting.discardCard).toBe(false);
    expect(visiting.toasts).toContain("You are looking at the live map. Go back to your draft to throw it away.");
  });

  it("says once that a change made on the live map does not stay", () => {
    expect(visiting.toasts.filter((t) => t.startsWith("That change is on the live map you are looking at"))).toHaveLength(1);
  });

  it("gives the hand back with the draft, as the draft was", () => {
    expect(m.run<boolean>("buildMode")).toBe(true);
    expect(m.run<string>("BY.gate.name")).toBe("Held while visiting");
    expect(m.run<string>("BY.market.name")).not.toContain("Made while visiting");
    expect(unpublished(m)).toHaveLength(1);
  });
});

describe("a saved draft waiting to be chosen", () => {
  let m: Booted;
  let card: { open: boolean; blast: string; discards: number };
  let held: { build: boolean; saves: number; bar: string };
  beforeAll(async () => {
    m = await framed({}, hand(6, draftOf(MINE.slice(0, 1))));
    press(m, "restoreNo");
    card = {
      open: cardOpen(m),
      blast: m.window.document.getElementById("pubBlast")?.textContent ?? "",
      discards: asks(m, "draft-discard").length,
    };
    press(m, "pubCancel");
    press(m, "buildBtn");
    // Build mode is refused while the draft waits, but a person who was
    // already building when the offer arrived can still change the land.
    // The edit is played in directly, the inspect card's own two steps.
    rename(m, "library", "Touched while choosing");
    await settle(SAVE_WAIT);
    held = { build: m.run<boolean>("buildMode"), saves: asks(m, "draft-save").length, bar: bar(m) };
  });
  afterAll(() => m?.close());

  it("asks before Start over throws it away, counting the draft's own change", () => {
    expect(card.open).toBe(true);
    expect(card.blast).toMatch(/^Your 1 unpublished change will be gone\./);
    expect(card.discards).toBe(0);
  });

  it("is not saved over while nobody has chosen, and the bar says the new change is not saved", () => {
    expect(held.saves).toBe(0);
    expect(held.bar).toMatch(/^Not saved yet\. Your saved draft is waiting/);
  });

  it("keeps the build hand closed until a choice is made", () => {
    expect(held.build).toBe(false);
  });

  it("once thrown away for real, saves the change made while it waited", async () => {
    press(m, "restoreNo");
    press(m, "pubConfirm");
    await answerLast(m, "draft-discard", { ok: true });
    expect(restoreShown(m)).toBe(false);
    const saved = lastAsk(m, "draft-save");
    expect(nameIn(saved?.scene, "library")).toBe("Touched while choosing");
    expect(nameIn(saved?.scene, "gate"), "nothing of the thrown-away draft").not.toBe(DRAFT_GATE);
  });
});


describe("a publish refused because a colleague published first", () => {
  let m: Booted;
  let refused: { live: number; liveEdits: number; list: string[] };
  let looked: { visiting: boolean; edits: number };
  beforeAll(async () => {
    m = await framed();
    // The village's public config, which now says version 7.
    (m.window as unknown as { fetch: unknown }).fetch = async () => ({
      ok: true,
      json: async () => ({ scene: JSON.stringify(live7()), sceneVersion: 7 }),
    });
    rename(m, "gate", "Mine");
    m.run("openPublish()");
    press(m, "pubConfirm");
    await answerLast(m, "publish", {
      ok: false,
      reason: "stale",
      error: "Other Admin published a change to the live map while you were working.",
      live: { version: 7, by: "Other Admin", at: "2026-10-01" },
    });
    await settle(50);
    refused = {
      live: m.run<number>("LIVE.version"),
      liveEdits: m.run<number>("LIVE_SCENE.map_edits.length"),
      list: [...m.window.document.querySelectorAll("#pubList li")].map((li) => li.textContent ?? ""),
    };
    press(m, "pubConfirm"); // Show me the live map, once the newer land is in
    await settle(0);
    looked = { visiting: m.run<boolean>("VISITOR_VIEW"), edits: m.run<number>("EDITS.length") };
    m.run("toggleVisitor()");
  });
  afterAll(() => m?.close());

  it("brings the live map up to the version the refusal names", () => {
    expect(refused.live).toBe(7);
    expect(refused.liveEdits).toBe(5);
  });

  it("shows that version when asked for the live map", () => {
    expect(looked).toEqual({ visiting: true, edits: 5 });
  });

  it("lists the change to make again", () => {
    expect(refused.list).toContain("renamed gate");
  });

  it("starts the next draft from the new version once this one is thrown away", async () => {
    // The look at the live map sent the refused work to the village, and a
    // discard lets a save on the wire land first.
    await answerLast(m, "draft-save", { ok: true, baseVersion: 6 });
    m.run("openDiscard()");
    press(m, "pubConfirm");
    await answerLast(m, "draft-discard", { ok: true });
    rename(m, "welcome", "Made again");
    m.run("openPublish()");
    press(m, "pubConfirm");
    expect(lastAsk(m, "publish")?.baseVersion).toBe(7);
  });
});


describe("a stale draft opened, then thrown away", () => {
  it("starts from the version on screen, not the one the draft forked from", async () => {
    const m = boot(null, { shell: true });
    await settle(200);
    m.post(config(live7(), 7));
    m.post(hand(7, draftOf(MINE.slice(0, 1))));
    press(m, "restoreYes");
    const opened = m.run<number>("BASE_VERSION");
    m.run("openDiscard()");
    press(m, "pubConfirm");
    await answerLast(m, "draft-discard", { ok: true });
    const after = m.run<number>("BASE_VERSION");
    m.close();
    expect(opened).toBe(6);
    expect(after).toBe(7);
  });
});

/*
 * ROUND 3 (2026-10-02): THE SAVE, THE PUBLISH AND THE UNDO ON A VILLAGE THAT
 * TAKES ITS TIME.
 *
 * Each of these was reproduced in Chromium against a stand-in village by the
 * build-mode re-sweep and again by an independent skeptic. Here the village
 * is the test: a question is answered when the test answers it, so a slow
 * village is one that has not answered yet, and the ORDER in which the map
 * asks is what the village would see.
 */
const RESCUE = "grounds-unsaved-draft";
const rescued = (m: Booted) => {
  const raw = storageOf(m)[RESCUE];
  return raw ? (JSON.parse(raw) as { scene: Scene }) : null;
};
const undoThis = (m: Booted) =>
  [...m.window.document.querySelectorAll<HTMLButtonElement>("#maiaLog button")].filter((b) => /^Undo this$|^Undone$|^Not undone$/.test(b.textContent ?? "")).pop();
const PUBLISHED_7 = { ok: true, version: 7, live: { version: 7, by: "me", previous: 6 } };

describe("two saves on the wire (round 3, finding 3)", () => {
  it("never happens: newer work waits for the answer, goes whole, and only its own yes lets the browser's copy go", async () => {
    const m = await framed();
    rename(m, "market", "Moved first");
    await settle(SAVE_WAIT);
    const first = lastAsk(m, "draft-save");
    rename(m, "gate", "Renamed second");
    await settle(SAVE_WAIT);
    const whileOut = { saves: asks(m, "draft-save").length, leaving: asksBeforeLeaving(m), kept: nameIn(rescued(m)?.scene, "gate") };
    await m.answer(first, { ok: true, baseVersion: 6 });
    const second = lastAsk(m, "draft-save");
    const afterFirst = { saves: asks(m, "draft-save").length, leaving: asksBeforeLeaving(m), kept: !!rescued(m) };
    await m.answer(second, { ok: true, baseVersion: 6 });
    const done = { leaving: asksBeforeLeaving(m), kept: !!rescued(m), bar: bar(m) };
    m.close();
    expect(whileOut, "the newer work waits, and this browser holds it").toEqual({ saves: 1, leaving: true, kept: "Renamed second" });
    expect(afterFirst).toEqual({ saves: 2, leaving: true, kept: true });
    expect(nameIn(second.scene, "gate")).toBe("Renamed second");
    expect(nameIn(second.scene, "market")).toBe("Moved first");
    expect(done.leaving).toBe(false);
    expect(done.kept).toBe(false);
    expect(done.bar).toMatch(/^2 unpublished changes\./);
  });
});

describe("Discard draft while a save is on the wire (round 3, finding 4)", () => {
  it("lets the save land, then throws the draft away, and nothing writes it back", async () => {
    const m = await framed();
    rename(m, "market", "Work I threw away");
    await settle(SAVE_WAIT);
    const out = lastAsk(m, "draft-save");
    m.run("openDiscard()");
    press(m, "pubConfirm");
    const early = asks(m, "draft-discard").length;
    await m.answer(out, { ok: true, baseVersion: 6 });
    const order = m.asked.map((q) => q.type);
    await answerLast(m, "draft-discard", { ok: true });
    await settle(SAVE_WAIT);
    const after = { saves: asks(m, "draft-save").length, kept: !!rescued(m), market: m.run<string>("BY.market.name") };
    m.close();
    expect(early, "the delete waited for the save on the wire").toBe(0);
    expect(order.filter((t) => t === "draft-save" || t === "draft-discard")).toEqual(["draft-save", "draft-discard"]);
    expect(after.saves, "nothing saved the thrown-away work again").toBe(1);
    expect(after.kept).toBe(false);
    expect(after.market).not.toBe("Work I threw away");
  });
});

describe("Publish while a save is on the wire (N25)", () => {
  it("lets the save land first, so it cannot write over the copy the publish rebased", async () => {
    const m = await framed();
    rename(m, "gate", "Saved, then published");
    await settle(SAVE_WAIT);
    const out = lastAsk(m, "draft-save");
    m.run("openPublish()");
    press(m, "pubConfirm");
    const early = asks(m, "publish").length;
    await m.answer(out, { ok: true, baseVersion: 6 });
    const pub = lastAsk(m, "publish");
    await answerLast(m, "publish", PUBLISHED_7);
    await settle(SAVE_WAIT);
    const order = m.asked.map((q) => q.type).filter((t) => t === "draft-save" || t === "publish");
    m.close();
    expect(early, "the publish waited for the save on the wire").toBe(0);
    expect(order).toEqual(["draft-save", "publish"]);
    expect(nameIn(pub?.scene, "gate")).toBe("Saved, then published");
  });
});

describe("a village slower than eight seconds (round 3, finding 5; N23)", () => {
  /* One map, three slow answers in turn: each case leaves the map where the
     next one starts, so each fails on its own when its own answer is misread. */
  let m: Booted;
  beforeAll(async () => {
    m = await framed();
  });
  afterAll(() => m?.close());

  it("says a slow save is still saving, never that it was not saved, and takes the late yes", async () => {
    rename(m, "gate", "Slow one");
    await settle(SAVE_WAIT);
    const q = lastAsk(m, "draft-save");
    await settle(8500);
    const slow = { bar: bar(m), leaving: asksBeforeLeaving(m) };
    await m.answer(q, { ok: true, baseVersion: 6 });
    const late = { bar: bar(m), leaving: asksBeforeLeaving(m) };
    expect(slow.bar).toBe("Still saving. The village has not answered yet. Your changes are still on this screen.");
    expect(slow.leaving).toBe(true);
    expect(late.bar).toMatch(/^1 unpublished change\./);
    expect(late.leaving).toBe(false);
    expect((await toasts(m)).filter((t) => t.startsWith("Not saved."))).toEqual([]);
  }, 30_000);

  it("keeps the publish card open on a slow publish, and a late yes is a yes", async () => {
    m.run("openPublish()");
    press(m, "pubConfirm");
    const p = lastAsk(m, "publish");
    await settle(8500);
    const during = { open: cardOpen(m), button: m.window.document.getElementById("pubConfirm")?.textContent ?? "" };
    await m.answer(p, PUBLISHED_7);
    const said = await toasts(m);
    expect(during).toEqual({ open: true, button: "Still publishing..." });
    expect(said).toContain("The village has not answered yet. Your publish may still land.");
    expect(said.join(" ")).not.toContain("running on its own");
    expect(m.run<number>("LIVE.version")).toBe(7);
    expect(m.window.document.getElementById("draftLive")?.textContent).toBe("Live: version 7, by me");
  }, 30_000);

  it("keeps Undo this pressed while a slow undo is answered, and never calls the village absent", async () => {
    const b = undoThis(m);
    expect(b, "Maia offers Undo this under the publish that landed").toBeTruthy();
    b?.click();
    const r = lastAsk(m, "restore");
    await settle(8500);
    const waiting = { disabled: !!b?.disabled, label: b?.textContent ?? "" };
    await m.answer(r, { ok: true, version: 8, live: { version: 8, by: "me", previous: 7 } });
    const said = await toasts(m);
    expect(waiting).toEqual({ disabled: true, label: "Undo this" });
    expect(said).toContain("The village has not answered yet. The undo may still land.");
    expect(said.join(" ")).not.toContain("No village to reach");
    expect(b?.textContent).toBe("Undone");
  }, 30_000);
});

describe("a save refused for a reason no retry can fix (D28)", () => {
  /** A save the village refuses with this answer, then six seconds, longer than the first retry's five. */
  async function refusedWith(answer: Record<string, unknown>) {
    const m = await framed();
    rename(m, "gate", "Edit One");
    await settle(SAVE_WAIT);
    await answerLast(m, "draft-save", answer);
    const saves = asks(m, "draft-save").length;
    await settle(6000);
    return { m, saves, later: asks(m, "draft-save").length, bar: bar(m) };
  }

  it("stops on a 401, says so, keeps newer work in this browser, and Try again sends the newest", async () => {
    const r = await refusedWith({ ok: false, status: 401, error: "Sign in to keep a draft of the map." });
    rename(r.m, "welcome", "Edit Two");
    await settle(SAVE_WAIT);
    const held = { saves: asks(r.m, "draft-save").length, kept: nameIn(rescued(r.m)?.scene, "welcome"), leaving: asksBeforeLeaving(r.m) };
    press(r.m, "saveRetry");
    const sent = lastAsk(r.m, "draft-save");
    const total = asks(r.m, "draft-save").length;
    r.m.close();
    expect(r.later, "no retry on its own").toBe(r.saves);
    expect(r.bar).toBe(
      "Not saved. You are signed out. Sign in again to carry on. Saving has stopped. Try again sends your changes. Your changes are still on this screen.",
    );
    expect(held).toEqual({ saves: r.saves, kept: "Edit Two", leaving: true });
    expect(total).toBe(r.saves + 1);
    expect(nameIn(sent?.scene, "welcome")).toBe("Edit Two");
  });

  it("stops on a 403, in the village's own words", async () => {
    const r = await refusedWith({ ok: false, status: 403, error: "Shaping the map is a cartographer's work." });
    r.m.close();
    expect(r.later).toBe(r.saves);
    expect(r.bar).toMatch(/^Not saved\. Shaping the map is a cartographer's work\. Saving has stopped\./);
  });

  it("still tries again on its own when the connection dropped (the control)", async () => {
    const r = await refusedWith({ ok: false, error: REACH });
    r.m.close();
    expect(r.later).toBe(r.saves + 1);
    expect(r.bar).not.toContain("Saving has stopped");
  });
});

describe("Undo this refused because the session ended (N22)", () => {
  it("says so in words, where it used to toast the code", async () => {
    const m = await framed();
    rename(m, "gate", "Published then undone");
    m.run("openPublish()");
    press(m, "pubConfirm");
    await answerLast(m, "publish", PUBLISHED_7);
    const b = undoThis(m);
    b?.click();
    await answerLast(m, "restore", { ok: false, error: "auth_required" });
    const seen = { said: await toasts(m), disabled: !!b?.disabled };
    m.close();
    expect(seen.said).toContain("You are signed out. Sign in again to carry on.");
    expect(seen.said).not.toContain("auth_required");
    expect(seen.disabled, "another press can still work once signed in").toBe(false);
  });
});
