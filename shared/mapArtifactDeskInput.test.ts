/**
 * THE LIVING MAP ANSWERS A KEYBOARD, A WHEEL AND A RELOAD THE WAY A PERSON EXPECTS.
 *
 * A QA sweep on 2026-10-01 found the artifact taking input it should leave
 * alone and refusing input it should take: Tab walked into sheets parked off
 * the screen, Ctrl+V switched the lens, Space on a focused button opened an
 * unrelated card, and so on. Each block below pins one of those, against the
 * real artifact booted in jsdom the way mapArtifactBoot.test.ts boots it.
 * The platform stubs mirror that file, which says why each one exists.
 *
 * WHAT THIS CANNOT SEE. jsdom lays nothing out, runs no transitions and never
 * activates a button from a key. So these tests read the computed style the
 * cascade gives, the default a key event was left with, and the state the
 * artifact's own handlers set. That the sheet slides out before it hides,
 * that a focused button really fires on Space, and that the land really
 * zooms under the pointer were each measured in Playwright; the commit that
 * added each block says how.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ARTIFACT = path.resolve(__dirname, "../docs/prototypes/grounds-v0.html");
const html = fs.readFileSync(ARTIFACT, "utf8");
/** The artifact's own storage key for a saved scene, read from it so this file names no village. */
const SCENE_KEY = /localStorage\.getItem\('([\w-]+-grounds-scene)'\)/.exec(html)?.[1] ?? "";
/** And the one for this person's own view (the mask). */
const MASK_KEY = /const MASK_KEY='([\w-]+)'/.exec(html)?.[1] ?? "";

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
  VirtualConsole: new () => {
    on(event: "jsdomError", listener: (e: Error & { type?: string; cause?: unknown }) => void): void;
  };
}
const { JSDOM, VirtualConsole } = createRequire(import.meta.url)("jsdom") as Jsdom;

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
/** Long enough for every boot timer to fire (see mapArtifactBoot.test.ts). */
const SETTLE_MS = 1000;
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
  const pixels = (w: number, h: number) => ({
    width: w,
    height: h,
    data: new Uint8ClampedArray(Math.max(0, w * h * 4) || 0),
  });
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
  doc: Document;
  uncaught: unknown[];
  run<T>(src: string): T;
  /** A message from the shell, in the shape LivingMap.tsx posts it. */
  post(data: Record<string, unknown>): void;
  close(): void;
}

function boot(
  hash: string,
  viewport: { width: number; height: number },
  before?: (w: ArtifactWindow) => void,
): Booted {
  const uncaught: unknown[] = [];
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
      Object.assign(w, { innerWidth: viewport.width, innerHeight: viewport.height });
      stubTheMissingPlatform(w);
      before?.(w);
    },
  });
  return {
    window,
    doc: window.document,
    uncaught,
    run: <T>(src: string) => window.eval(src) as T,
    post(data) {
      const own = window.eval("JSON").parse(JSON.stringify(data));
      window.dispatchEvent(new window.MessageEvent("message", { data: own, origin: window.location.origin }));
    },
    close: () => window.close(),
  };
}

it("the artifact is the file the shell mounts (the positive control)", () => {
  expect(html.length).toBeGreaterThan(100_000);
  for (const id of ["panel", "panelClose", "inspect", "inspClose", "skin", "pdrawer", "attnBtn", "lyVision", "wallBtn"]) {
    expect(html, `#${id} in the markup`).toContain(`id="${id}"`);
  }
  expect(SCENE_KEY, "the saved scene's storage key").toMatch(/-grounds-scene$/);
  expect(MASK_KEY, "the mask's storage key").toMatch(/-map-mask$/);
});

/* F01. A sheet parked past the edge took keyboard focus. Tab 20 and 21 of
   every desk lap landed on #panel's and #inspect's close buttons, which
   nobody could see, and 73 of 120 presses on a phone landed in the closed
   #skin. jsdom has no tab order of its own, so this reads what decides it:
   the computed visibility of every control inside each sheet, closed and
   then open. A hidden control is out of the order; a visible one is in it. */
describe("a closed sheet is out of the tab order", () => {
  const controls = (b: Booted, id: string) =>
    [...(b.doc.getElementById(id)?.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href]") ?? [])];
  const shown = (b: Booted, els: HTMLElement[]) =>
    els.filter((e) => b.window.getComputedStyle(e).visibility !== "hidden").map((e) => e.id || e.tagName);

  describe("on a desk", () => {
    let b: Booted;
    beforeAll(async () => {
      b = boot("#skipIntro", DESK);
      await settle(SETTLE_MS);
    });
    afterAll(() => b?.close());

    it("hides every control of the closed place panel and inspector, and shows them when open", () => {
      // The positive control: something outside the sheets is visible, so a
      // cascade that hid everything would fail here.
      expect(b.window.getComputedStyle(b.doc.getElementById("attnBtn") as HTMLElement).visibility).toBe("visible");
      expect(controls(b, "panel").length, "#panel has controls to count").toBeGreaterThan(0);
      expect(shown(b, controls(b, "panel")), "controls left in the closed #panel").toEqual([]);
      expect(shown(b, controls(b, "inspect")), "controls left in the closed #inspect").toEqual([]);

      b.run("openPanel('greenhouse')");
      const open = controls(b, "panel");
      expect(open.length, "the open panel renders its controls").toBeGreaterThan(1);
      expect(shown(b, open).length, "every control of the open panel").toBe(open.length);
      b.run("$('panel').classList.remove('open');panelKey=null");
      expect(shown(b, controls(b, "panel")), "controls left once it closes again").toEqual([]);

      b.run("openInspect('greenhouse')");
      const insp = controls(b, "inspect");
      expect(shown(b, insp).length, "every control of the open inspector").toBe(insp.length);
      b.run("closeInspect()");
      expect(shown(b, controls(b, "inspect"))).toEqual([]);
      expect(b.uncaught).toEqual([]);
    });
  });

  describe("on a phone", () => {
    let b: Booted;
    beforeAll(async () => {
      b = boot("#hud=pocket&skipIntro", PHONE);
      await settle(SETTLE_MS);
    });
    afterAll(() => b?.close());

    it("hides the closed Your view sheet and the drawer, and shows them when open", () => {
      expect(b.doc.body.classList.contains("pocket"), "the pocket profile").toBe(true);
      const skin = controls(b, "skin");
      expect(skin.length, "#skin has controls to count").toBeGreaterThan(5);
      expect(shown(b, skin), "controls left in the closed #skin").toEqual([]);
      b.run("$('skin').classList.add('show')");
      expect(shown(b, controls(b, "skin")).length).toBe(controls(b, "skin").length);
      b.run("$('skin').classList.remove('show')");

      b.run("renderDrawer()");
      const cells = controls(b, "pdrawer");
      expect(cells.length, "the drawer renders its cells").toBeGreaterThan(0);
      expect(shown(b, cells), "cells left in the closed drawer").toEqual([]);
      b.run("$('pdrawer').classList.add('open')");
      expect(shown(b, controls(b, "pdrawer")).length).toBe(cells.length);
      b.run("$('pdrawer').classList.remove('open')");

      b.run("openPanel('greenhouse')");
      expect(shown(b, controls(b, "panel")).length, "the open pocket panel").toBe(controls(b, "panel").length);
      b.run("$('panel').classList.remove('open');panelKey=null");
      expect(shown(b, controls(b, "panel")), "controls left in the closed pocket panel").toEqual([]);
      expect(b.uncaught).toEqual([]);
    });
  });
});

/** A keydown sent from `target` the way a browser sends one: it bubbles to
    the window and can be cancelled. Returns whether a handler cancelled it. */
function press(b: Booted, target: EventTarget, key: string, mods: KeyboardEventInit = {}) {
  const ev = new b.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(ev);
  return ev.defaultPrevented;
}

/* F30. Every map shortcut tested e.key alone, so a browser shortcut fired it
   too: Ctrl+V outside a field switched the lens to Vision, Ctrl+= and Ctrl+-
   zoomed the map as well as the page, Ctrl+H flew home, Alt+Left panned and
   Ctrl+L opened the Loom while the address bar took focus. The bare keys are
   the positive control: each one still does its job. */
describe("the map's shortcuts leave a key held with Ctrl, Cmd or Alt to the browser", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  const cam = () => b.run<{ x: number; y: number; z: number }>("({x:cam.x,y:cam.y,z:cam.z})");
  const home = () => b.run("travel=null;cam.x=1200;cam.y=600;cam.z=0.84;if(mode!=='now')setMode('now')");

  it("ignores Ctrl+V, Cmd+V, Ctrl+=, Ctrl+-, Ctrl+H and Alt+Left", () => {
    const body = b.doc.body;
    for (const [key, mods] of [
      ["v", { ctrlKey: true }],
      ["v", { metaKey: true }],
      ["=", { ctrlKey: true }],
      ["-", { ctrlKey: true }],
      ["h", { ctrlKey: true }],
      ["ArrowLeft", { altKey: true }],
    ] as [string, KeyboardEventInit][]) {
      home();
      const before = cam();
      press(b, body, key, mods);
      expect(b.run<string>("mode"), `the lens after ${JSON.stringify(mods)} ${key}`).toBe("now");
      expect(cam(), `the camera after ${JSON.stringify(mods)} ${key}`).toEqual(before);
      expect(b.run<unknown>("travel"), `no flight after ${JSON.stringify(mods)} ${key}`).toBeNull();
    }
  });

  it("leaves Ctrl+L to the address bar, and the Loom shut", () => {
    press(b, b.doc.body, "l", { ctrlKey: true });
    expect(b.doc.body.classList.contains("loom")).toBe(false);
  });

  it("still answers the bare keys (the positive control)", () => {
    home();
    press(b, b.doc.body, "v");
    expect(b.run<string>("mode")).toBe("vision");
    home();
    const z = cam().z;
    press(b, b.doc.body, "=");
    expect(cam().z).toBeGreaterThan(z);
    home();
    press(b, b.doc.body, "ArrowLeft");
    expect(cam().x).toBeLessThan(1200);
    press(b, b.doc.body, "l");
    expect(b.doc.body.classList.contains("loom"), "l opens the Loom").toBe(true);
    press(b, b.doc.body, "Escape");
    expect(b.doc.body.classList.contains("loom"), "Escape closes it").toBe(false);
    expect(b.uncaught).toEqual([]);
  });
});

/* F23. Space on any focused HUD button opened What needs hands, and the
   button did nothing. A button activates on Space only when its keydown
   default runs, and the map's handler cancelled it. jsdom never activates a
   button from a key, so this reads the two things that decide it: whether
   the keydown was cancelled, and whether the card opened. */
describe("Space presses the focused control, and is the shortcut only on the land", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  const attn = () => !!b.doc.getElementById("attnCard")?.classList.contains("show");
  const shut = () => b.doc.getElementById("attnCard")?.classList.remove("show");

  it("leaves Space on a focused button, a dock door and Get Involved to the button", () => {
    for (const el of [
      b.doc.getElementById("lyVision"),
      b.doc.getElementById("wallBtn"),
      b.doc.querySelector<HTMLElement>("#dock button"),
    ]) {
      expect(el, "the control to focus").not.toBeNull();
      shut();
      el?.focus();
      const cancelled = press(b, el as HTMLElement, " ");
      expect(cancelled, `Space on ${el?.id || el?.tagName} left to the browser`).toBe(false);
      expect(attn(), `no card from Space on ${el?.id || el?.tagName}`).toBe(false);
    }
  });

  it("still opens What needs hands from the land (the positive control)", () => {
    shut();
    (b.doc.activeElement as HTMLElement | null)?.blur?.();
    expect(press(b, b.doc.body, " "), "Space on the land is taken").toBe(true);
    expect(attn()).toBe(true);
  });

  it("keeps Escape working while a button inside an open panel has focus", () => {
    b.run("openPanel('greenhouse')");
    b.doc.getElementById("panelClose")?.focus();
    press(b, b.doc.getElementById("panelClose") as HTMLElement, "Escape");
    expect(b.doc.getElementById("panel")?.classList.contains("open")).toBe(false);
    expect(b.uncaught).toEqual([]);
  });
});

/* F26. The seven dock doors were icon-only buttons whose only text lived in
   data-tip, which no screen reader reads, and the hour button's name was the
   glyph. Chromium's own tree (read over CDP) is where the bare names were
   measured; here the attributes that feed it are read back. */
describe("every door on the right rail, and the hour, has a name", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  it("names each dock door after the first sentence of its tip, and hides its icon", () => {
    const doors = [...b.doc.querySelectorAll<HTMLElement>("#dock button")];
    expect(doors.length, "the seven doors").toBe(7);
    for (const d of doors) {
      const tip = (d.getAttribute("data-tip") ?? "").split(".")[0];
      expect(tip, `${d.dataset.m} has a tip to agree with`).not.toBe("");
      expect(d.getAttribute("aria-label"), `the name of the ${d.dataset.m} door`).toBe(tip);
      const svg = d.querySelector("svg");
      expect(svg, `${d.dataset.m} carries its MICON`).not.toBeNull();
      expect(svg?.getAttribute("aria-hidden"), `${d.dataset.m}'s icon is decoration`).toBe("true");
    }
  });

  it("names the hour, and says which hour once a person has set it", () => {
    const day = b.doc.getElementById("dayBtn") as HTMLButtonElement;
    expect(day.getAttribute("aria-label")).toBe("Time of day");
    day.click();
    expect(day.textContent).toBe("🌇");
    expect(day.getAttribute("aria-label")).toBe("Time of day: dusk");
    day.click();
    expect(day.getAttribute("aria-label")).toBe("Time of day: night");
    expect(b.uncaught).toEqual([]);
  });
});

/* F27. The segmented controls clip with overflow:hidden, which cut the
   browser's focus ring away, Maia's box had outline:none with nothing in its
   place, and the tab order ran right, left, right across the top bar. */
describe("focus can be seen, and moves across the top bar the way it reads", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  it("puts the top bar in the DOM in the order it stands on the screen", () => {
    const ids = ["topNav", "vitals", "themeBtn", "dayBtn", "layers", "dock"];
    const els = ids.map((id) => b.doc.getElementById(id) as HTMLElement);
    for (let i = 1; i < els.length; i++) {
      const follows = !!(els[i - 1].compareDocumentPosition(els[i]) & b.window.Node.DOCUMENT_POSITION_FOLLOWING);
      expect(follows, `#${ids[i]} comes after #${ids[i - 1]}`).toBe(true);
    }
  });

  it("draws the ring inside the segmented buttons and Maia's box, where no clip reaches it", () => {
    // jsdom never matches :focus-visible, so this reads the rule the cascade
    // would apply: a :focus-visible rule that selects the control once the
    // pseudo-class is set aside, with a solid ring and a negative offset.
    const rules: CSSStyleRule[] = [];
    for (const sheet of [...b.doc.styleSheets]) {
      for (const r of [...sheet.cssRules]) if ("selectorText" in r) rules.push(r as CSSStyleRule);
    }
    for (const id of ["lyNow", "lyVision", "msLiving", "msCircles", "maiaText"]) {
      const el = b.doc.getElementById(id) as HTMLElement;
      const ring = rules.filter((r) =>
        r.selectorText
          .split(",")
          .some((sel) => sel.includes(":focus-visible") && el.matches(sel.replace(/:focus-visible/g, "").trim())),
      );
      expect(ring.length, `a :focus-visible rule reaches #${id}`).toBeGreaterThan(0);
      const r = ring[ring.length - 1].style;
      expect(r.outlineStyle || r.outline, `#${id}'s ring`).toMatch(/solid/);
      expect(parseFloat(r.outlineOffset), `#${id}'s ring is inset`).toBeLessThan(0);
    }
  });
});

/* F44. Maia's minimise control was a span and her inline links were <a> with
   no href, so neither could take focus. */
describe("Maia's minimise control and her inline links take the keyboard", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  it("minimises from a button that says what it will do", async () => {
    const min = b.doc.getElementById("maiaMin") as HTMLElement;
    const maia = b.doc.getElementById("maia") as HTMLElement;
    expect(min.tagName).toBe("BUTTON");
    min.focus();
    expect(b.doc.activeElement, "the control takes focus").toBe(min);
    expect(min.getAttribute("aria-expanded")).toBe("true");
    min.click();
    await settle(0);
    expect(maia.classList.contains("min"), "one press minimises, once").toBe(true);
    expect(min.getAttribute("aria-expanded")).toBe("false");
    expect(min.getAttribute("aria-label")).toBe("Show Maia");
    // .min is also cleared by code that never touches the button.
    maia.classList.remove("min");
    await settle(0);
    expect(min.getAttribute("aria-label")).toBe("Minimise Maia");
  });

  it("writes Claim it as a button the keyboard can reach, with its handler kept", async () => {
    const q = b.run<{ q: string }>("SCENE.quests.find(q=>q.at&&BY[q.at])");
    (b.doc.getElementById("maiaText") as HTMLInputElement).value = q.q;
    (b.doc.getElementById("maiaSend") as HTMLElement).click();
    await settle(500); // she answers 350ms after the question
    const lines = b.doc.querySelectorAll("#maiaLog .mline");
    const link = lines[lines.length - 1]?.querySelector<HTMLElement>("[onclick]");
    expect(link?.textContent).toBe("Claim it");
    expect(link?.tagName).toBe("BUTTON");
    expect(link?.getAttribute("onclick"), "maiaClean kept the handler").toMatch(/^claimQuest\(/);
    link?.focus();
    expect(b.doc.activeElement).toBe(link);
    expect(b.run<string[]>("MSAY_STRIPPED"), "nothing was stripped").toEqual([]);
    expect(b.uncaught).toEqual([]);
  });
});

/* F25. The Get Involved rows and the vital chips were divs with an onclick:
   the list opened for a keyboard and none of its rows could be chosen, and
   the chips and the doors inside their drop-downs were mouse only. */
describe("the Get Involved rows and the vital chips take the keyboard", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  it("makes every row that opens a place a button, and leaves a row with no place plain", () => {
    b.run("$('wall').classList.add('show');buildWall()");
    const rows = [...b.doc.querySelectorAll<HTMLElement>("#wallList .wallrow")];
    expect(rows.length, "the wall has rows").toBeGreaterThan(10);
    const acting = rows.filter((r) => r.hasAttribute("onclick"));
    expect(acting.length, "rows that open a place").toBeGreaterThan(10);
    expect(
      acting.filter((r) => r.tagName !== "BUTTON").map((r) => r.textContent?.slice(0, 30)),
      "rows that open a place but are not buttons",
    ).toEqual([]);
    expect(rows.filter((r) => r.tagName === "BUTTON" && !r.hasAttribute("onclick")).length, "buttons that do nothing").toBe(0);
    acting[0].focus();
    expect(b.doc.activeElement, "a row takes focus").toBe(acting[0]);
    acting[0].click();
    expect(b.doc.getElementById("panel")?.classList.contains("open"), "and opens its place").toBe(true);
    b.run("$('panel').classList.remove('open');panelKey=null;$('wall').classList.remove('show')");
  });

  it("makes each vital chip a named button that opens its reading and gives focus back on Escape", async () => {
    const chips = [...b.doc.querySelectorAll<HTMLElement>("#vitals .vital")];
    expect(chips.length, "the chips").toBeGreaterThan(4);
    expect(chips.filter((c) => c.tagName !== "BUTTON").length, "chips that are not buttons").toBe(0);
    const people = chips.find((c) => c.dataset.k === "people") as HTMLElement;
    expect(people.getAttribute("aria-label"), "the reading, and that it is a sample").toMatch(/^People: .+, sample reading$/);
    people.focus();
    people.click(); // jsdom's click() carries detail 0, the mark of a key
    await settle(0);
    const drop = b.doc.getElementById("vdrop") as HTMLElement;
    expect(drop.classList.contains("show"), "the reading opens").toBe(true);
    expect(drop.contains(b.doc.activeElement), "focus goes into it").toBe(true);
    expect(people.getAttribute("aria-expanded")).toBe("true");
    press(b, b.doc.activeElement as HTMLElement, "Escape");
    await settle(0);
    expect(drop.classList.contains("show"), "Escape closes it").toBe(false);
    expect(b.doc.activeElement, "and hands focus back to the chip").toBe(people);
    expect(people.getAttribute("aria-expanded")).toBe("false");
    expect(b.uncaught).toEqual([]);
  });
});

/* F21 and F72. The leave prompt tested EDITS.length, and every visitor
   arrives with the published journal in EDITS, so everyone who touched the
   map was told "Changes you made may not be saved" on reload, close or a
   typed address, having changed nothing. jsdom shows no dialog; it does run
   the listener, and a cancelled beforeunload event is the prompt. The
   visitor is played inside a stand-in for the shell's frame, which is where
   a visitor is; the edit is played standalone (file://), where this
   browser's copy is the only save there is. */
describe("the leave prompt guards unsaved work, and nothing else", () => {
  let visitor: Booted;
  let alone: Booted;
  beforeAll(async () => {
    visitor = boot("#skipIntro", DESK, (w) =>
      Object.defineProperty(w, "parent", { configurable: true, get: () => ({ postMessage() {} }) }),
    );
    alone = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
  });
  afterAll(() => {
    visitor?.close();
    alone?.close();
  });

  const prompts = (b: Booted) => {
    const ev = new b.window.Event("beforeunload", { cancelable: true });
    b.window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const edit = (seq: number) => ({
    seq,
    actor: "founder",
    action: "rename",
    target: "structure:gate",
    diff: {},
    at: `2026-08-0${seq}T10:00:00.000Z`,
  });

  it("stays quiet for a visitor who arrives with the published journal and changes nothing", () => {
    const b = visitor;
    expect(b.run<boolean>("inShell()"), "inside the village").toBe(true);
    const scene = b.run<{ map_edits: unknown[] }>("JSON.parse(JSON.stringify(buildExportJSON()))");
    scene.map_edits = [edit(1), edit(2), edit(3)];
    b.post({ type: "config", scene, sceneVersion: 6 });
    b.post({ type: "hand", canEdit: false, canPublish: false, liveVersion: 6, live: { version: 6, by: "the founder" } });
    expect(b.run<number>("EDITS.length"), "the published journal arrived (the positive control)").toBe(3);
    expect(prompts(b), "a prompt for a visitor who changed nothing").toBe(false);
    expect(b.uncaught).toEqual([]);
  });

  it("prompts while an edit waits for its save, and stops once it has saved", async () => {
    const b = alone;
    b.run("logEdit('rename','structure:gate',{to:'Probe'})");
    expect(prompts(b), "an edit not yet saved").toBe(true);
    await settle(2800); // the autosave waits 2.5 s, then writes this browser's copy
    expect(b.window.localStorage.getItem(SCENE_KEY), "the save landed").not.toBeNull();
    expect(prompts(b), "a prompt after the save").toBe(false);
    expect(b.uncaught).toEqual([]);
  });
});

/* F20 and F68. The wheel, a trackpad pinch (ctrl-wheel) and a mouse drag
   were bound to the canvas alone, and a building's plate, a name and a mark
   are their own elements beside it, so over any of them a notch did nothing,
   a pinch was left to the browser and a drag moved nothing. jsdom hit-tests
   nothing, so the events are dispatched on the elements a pointer lands on,
   which is what a browser does; the land's own camera says whether it moved. */
describe("the wheel, a pinch and a drag work over a building, a name and a mark", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
  });
  afterAll(() => b?.close());

  type Cam = { x: number; y: number; z: number };
  const cam = () => b.run<Cam>("({x:cam.x,y:cam.y,z:cam.z})");
  const home = () =>
    b.run("travel=null;cam.x=1200;cam.y=600;cam.z=0.84;cam.vx=cam.vy=0;panelKey=null;$('panel').classList.remove('open')");
  const at = { clientX: 700, clientY: 450 };
  const wheel = (el: Element, init: WheelEventInit) => {
    const ev = new b.window.WheelEvent("wheel", { bubbles: true, cancelable: true, ...at, ...init });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const pointer = (el: EventTarget, type: string, x: number, y: number) =>
    el.dispatchEvent(
      new b.window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
      }),
    );
  const click = (el: Element, x: number, y: number) =>
    el.dispatchEvent(new b.window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 }));
  /** Down on the element, 150 px across the window, up and the click a browser sends after it. */
  const drag = (el: Element) => {
    pointer(el, "pointerdown", 700, 450);
    pointer(el, "pointermove", 775, 490);
    pointer(el, "pointermove", 850, 525);
    const moved = cam();
    pointer(el, "pointerup", 850, 525);
    click(el, 850, 525);
    return moved;
  };
  const marks = () => {
    const seal = b.doc.querySelector("#badges .bseal");
    return {
      "the Greenhouse's plate": b.run<Element>("pEls.greenhouse"),
      "the Greenhouse's name": b.run<Element>("bEls.greenhouse"),
      "a district plate": b.run<Element>("bEls['d_'+SCENE.districts[0].id]"),
      "a mark": seal as Element,
    };
  };

  it("finds each kind of mark on the land (the positive control)", () => {
    for (const [what, el] of Object.entries(marks())) {
      expect(el, what).toBeTruthy();
      expect(b.doc.getElementById("scene")?.contains(el), `${what} is outside the canvas`).toBe(false);
    }
  });

  it("zooms the land on a wheel notch and takes a pinch from the browser, over each of them", () => {
    for (const [what, el] of Object.entries(marks())) {
      home();
      expect(wheel(el, { deltaY: -100 }), `the notch over ${what} is the map's`).toBe(true);
      expect(cam().z, `a notch over ${what} zooms`).toBeGreaterThan(0.9);
      home();
      expect(wheel(el, { deltaY: -10, ctrlKey: true }), `a pinch over ${what} is not the page's`).toBe(true);
      expect(cam().z, `a pinch over ${what} zooms`).toBeGreaterThan(0.84);
    }
    home();
    expect(wheel(b.doc.getElementById("scene") as Element, { deltaY: -100 }), "the canvas, as before").toBe(true);
  });

  /* Safari sends a trackpad pinch as its own gesture events and never as a
     ctrl-wheel. The mark layers take them in one place, the loop that zooms
     the map, which is also the only thing that refuses the page zoom there. */
  it("takes Safari's gesture pinch from the browser over each of them, and zooms the map", () => {
    const gesture = (el: Element, type: string, scale: number) => {
      const ev = new b.window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(ev, { scale, clientX: at.clientX, clientY: at.clientY });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    for (const [what, el] of Object.entries(marks())) {
      home();
      expect(gesture(el, "gesturestart", 1), `Safari's pinch over ${what} starts as the map's`).toBe(true);
      expect(gesture(el, "gesturechange", 1.5), `and goes on as the map's`).toBe(true);
      expect(gesture(el, "gestureend", 1.5), `and ends as the map's`).toBe(true);
      expect(cam().z, `Safari's pinch over ${what} zooms`).toBeGreaterThan(0.84);
    }
  });

  it("pans on a drag begun on each of them, and the click at the end opens nothing", async () => {
    for (const [what, el] of Object.entries(marks())) {
      home();
      const moved = drag(el);
      expect(Math.round(1200 - moved.x), `a drag from ${what} pans across`).toBe(Math.round(150 / 0.84));
      expect(b.run<string | null>("panelKey"), `the drag from ${what} opens no place`).toBeNull();
      expect(b.run<boolean>("!!travel"), `nor flies anywhere`).toBe(false);
      await settle(120); // the swallow lasts 80 ms past the release
    }
  });

  it("still opens the place on a plain click on a building, a name or a mark", async () => {
    for (const [what, el] of Object.entries(marks())) {
      if (what === "a district plate") continue; // it flies to its district, checked below
      home();
      pointer(el, "pointerdown", 700, 450);
      pointer(el, "pointerup", 700, 450);
      click(el, 700, 450);
      expect(b.run<string | null>("panelKey"), `a click on ${what}`).toBeTruthy();
      await settle(120);
    }
    home();
    const plate = marks()["a district plate"];
    pointer(plate, "pointerdown", 700, 450);
    pointer(plate, "pointerup", 700, 450);
    click(plate, 700, 450);
    expect(b.run<boolean>("!!travel"), "a click on a district plate flies to it").toBe(true);
    b.run("travel=null");
    expect(b.uncaught).toEqual([]);
  });
});

/* F22 and F63. "Your view" says it changes how the map looks to you and to
   nobody else. Inside the village the label style and the flow marks wrote
   an entry in the village's edit log instead, which set off a 66 KB save of
   the whole land and a "Saved work found... Restore it" bar on every later
   visit, and neither they nor the theme were kept: F5 put Emerald Atlas
   back, and the shell's config push put the village's building size back
   over the person's own. A reload here is a second jsdom booted with the
   first one's localStorage, inside a stand-in for the shell's frame. */
describe("Your view is kept for the person, and stays out of the village's record", () => {
  const LIVE_SKIN = { theme: "", accent: "#157f7d", global_scale: 1, flow_style: "glyph", label_style: "ribbon" };
  const inTheVillage =
    (stored: Record<string, string> = {}) =>
    (w: ArtifactWindow) => {
      Object.defineProperty(w, "parent", { configurable: true, get: () => ({ postMessage() {} }) });
      for (const [k, v] of Object.entries(stored)) w.localStorage.setItem(k, v);
    };
  const storage = (b: Booted) => {
    const out: Record<string, string> = {};
    for (let i = 0; i < b.window.localStorage.length; i++) {
      const k = b.window.localStorage.key(i) as string;
      out[k] = b.window.localStorage.getItem(k) as string;
    }
    return out;
  };
  /** The shell's two pushes, as LivingMap.tsx sends them, with a published journal of 3 edits. */
  const arrive = (b: Booted, canEdit: boolean) => {
    const scene = b.run<{ map_edits: unknown[] }>("JSON.parse(JSON.stringify(buildExportJSON()))");
    scene.map_edits = [1, 2, 3].map((seq) => ({
      seq,
      actor: "founder",
      action: "rename",
      target: "structure:gate",
      diff: {},
      at: `2026-08-0${seq}T10:00:00.000Z`,
    }));
    b.post({ type: "config", scene, sceneVersion: 6, skin: LIVE_SKIN });
    b.post({ type: "hand", canEdit, canPublish: canEdit, liveVersion: 6, live: { version: 6, by: "the founder" } });
  };
  const choose = (b: Booted, id: string, value: string) => {
    const sel = b.doc.getElementById(id) as HTMLSelectElement;
    sel.value = value;
    sel.dispatchEvent(new b.window.Event("change", { bubbles: true }));
  };
  const look = (b: Booted) =>
    b.run<{ theme: string; scale: number; tablet: boolean; flow: string; skinLabel: string; skinTheme: string; edits: number; bar: string }>(
      `({theme:THEME.label,scale:Math.round(GSCALE*100),tablet:document.body.classList.contains('lbl-tablet'),
        flow:window.dressOf?dressOf('flow_style'):SKIN.flow_style,skinLabel:SKIN.label_style,skinTheme:SKIN.theme,edits:EDITS.length,
        bar:$('restoreBar').style.display})`,
    );

  let first: Booted;
  let kept: Record<string, string>;
  let arrived: number;
  let during: ReturnType<typeof look>;
  let afterPush: ReturnType<typeof look>;
  beforeAll(async () => {
    first = boot("#skipIntro", DESK, inTheVillage());
    await settle(SETTLE_MS);
    arrive(first, false);
    arrived = first.run<number>("EDITS.length");
    first.run("openMask()");
    (first.doc.querySelector('#skTheme .swb[data-t="Terra Sol"]') as HTMLElement).click();
    choose(first, "skLabelStyle", "tablet");
    choose(first, "skFlow", "gold");
    first.run("setGScale(130)"); // the dial's change event, which is the one that keeps it
    during = look(first);
    await settle(2800); // longer than the autosave's 2.5 s
    // The village pushes its look again, as the shell does after every scene.
    first.post({ type: "config", skin: LIVE_SKIN });
    afterPush = look(first);
    kept = storage(first);
  });
  afterAll(() => first?.close());

  it("arrives inside the village with the published journal (the positive control)", () => {
    expect(first.run<boolean>("inShell()")).toBe(true);
    expect(arrived, "the published journal").toBe(3);
    expect(during.theme, "the swatch took").toBe("Terra Sol");
  });

  it("writes nothing to the village's edit log or its look, and saves no copy of the land", () => {
    expect(during.edits, "edits after a label style and flow marks change").toBe(3);
    expect(during.skinLabel, "the village's own label style").toBe("ribbon");
    expect(kept[SCENE_KEY], "a saved copy of the whole land").toBeUndefined();
    expect(JSON.parse(kept[MASK_KEY] ?? "{}")).toEqual({
      theme: "Terra Sol",
      label_style: "tablet",
      flow_style: "gold",
      scale: 130,
    });
  });

  it("keeps the person's view over the village's own look when the village pushes it", () => {
    expect(afterPush).toMatchObject({ theme: "Terra Sol", scale: 130, tablet: true, flow: "gold" });
    expect(afterPush.skinTheme, "SKIN stays the village's record").toBe("Emerald Atlas");
  });

  it("brings the whole view back on the next visit, with no restore bar", async () => {
    const again = boot("#skipIntro", DESK, inTheVillage(kept));
    await settle(SETTLE_MS);
    arrive(again, false);
    expect(look(again)).toMatchObject({ theme: "Terra Sol", scale: 130, tablet: true, flow: "gold", bar: "none" });
    expect(again.uncaught).toEqual([]);
    again.close();
  });

  it("lets a preference go when the person picks the village's own look again", () => {
    (first.doc.querySelector('#skTheme .swb[data-t="Emerald Atlas"]') as HTMLElement).click();
    choose(first, "skLabelStyle", "ribbon");
    expect(first.run<Record<string, unknown>>("maskRead()")).toEqual({ flow_style: "gold", scale: 130 });
    first.run("setGScale(100)");
    expect(first.run<Record<string, unknown>>("maskRead()")).toEqual({ flow_style: "gold" });
    expect(first.uncaught).toEqual([]);
  });

  it("offers a copy of the land this browser holds only where it is the save, and Start fresh lets it go", async () => {
    const copy = JSON.stringify(first.run("buildExportJSON()"));
    const visitor = boot("#skipIntro", DESK, inTheVillage({ [SCENE_KEY]: copy }));
    await settle(SETTLE_MS);
    arrive(visitor, false);
    expect(look(visitor).bar, "the bar for someone who cannot edit").toBe("none");
    visitor.close();

    /* Inside the village an editor's own work comes back from the village's
       draft, or from the copy of an unconfirmed save that offerWaiting reads
       (RESCUE_KEY, with the version it forked from), and
       mapArtifactDraftMark.test.ts plays both. This older copy of the whole
       land carries no version: restored over a newer live map, a publish from
       it replaced a colleague's work (F75). So inside the village it is
       offered to nobody, the editor included. */
    const editor = boot("#skipIntro", DESK, inTheVillage({ [SCENE_KEY]: copy }));
    await settle(SETTLE_MS);
    arrive(editor, true);
    expect(look(editor).bar, "the old copy, for an editor inside the village").toBe("none");
    editor.close();

    // On its own the copy is the only save there is, so it is offered at boot.
    const alone = boot("#skipIntro", DESK, (w) => w.localStorage.setItem(SCENE_KEY, copy));
    await settle(SETTLE_MS);
    expect(look(alone).bar, "the bar when the map runs on its own").toBe("flex");
    expect(alone.doc.getElementById("restoreMsg")?.textContent).toContain("Saved work found in this browser");
    (alone.doc.getElementById("restoreNo") as HTMLElement).click();
    expect(alone.window.localStorage.getItem(SCENE_KEY), "Start fresh").toBeNull();
    alone.close();
  });

  it("still dresses and logs the scene when the map runs on its own (file://, the export is the outlet)", async () => {
    const alone = boot("#skipIntro", DESK);
    await settle(SETTLE_MS);
    expect(alone.run<boolean>("inShell()")).toBe(false);
    const before = alone.run<number>("EDITS.length");
    choose(alone, "skLabelStyle", "tablet");
    expect(alone.run<string>("EDITS[EDITS.length-1].action")).toBe("label-style");
    expect(alone.run<number>("EDITS.length")).toBe(before + 1);
    expect(alone.run<string>("SKIN.label_style")).toBe("tablet");
    alone.close();
  });
});
