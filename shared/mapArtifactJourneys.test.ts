/**
 * THE JOURNEYS WALK THEIR OWN STEPS, AT THE VISITOR'S PACE, AND ONLY WHILE SHE CAN BE SEEN.
 *
 * The Welcome Walk is switched off (WELCOME_WALK_ON, #402), and the Resident,
 * Steward and Investor journeys still walk on the same engine: playJourney in
 * the map artifact flies the camera stop by stop and writes each stop into
 * Maia's log with a row of answers under it. A QA sweep on 2026-10-01 found
 * five things wrong with that engine. Each block below names its finding, and
 * each was reproduced here on the unfixed artifact before it was fixed.
 *
 * HOW IT RUNS. The real artifact boots in jsdom with the platform it lacks
 * stubbed, exactly as mapArtifactBoot.test.ts does, which says why each stub
 * exists. Added here is A FAST CLOCK. Every setTimeout and setInterval the
 * artifact asks for, and Date.now, run SPEED times faster, so a 6.5 s dwell
 * takes 325 ms and the whole file runs in seconds. The artifact's own
 * arithmetic is untouched: it still asks for 6500, and a test that reads the
 * clock reads it in the artifact's units. What is NOT sped up is the camera,
 * which flies on requestAnimationFrame at jsdom's real 60 frames a second, so
 * a landing still takes about 0.6 s of real time.
 *
 * WHAT THIS CANNOT SEE. jsdom never wires an inline handler parsed inside a
 * <template>, and maiaClean parses every log line there, so a click on a
 * button in her log does nothing here at all. press() below does what a
 * browser does instead: nothing for a disabled button, and the button's own
 * onclick otherwise. It cannot see layout either, so "visible" here means
 * the classes that decide visibility (body.msheet on a phone, #maia.min, an
 * open drawer, door or Loom). The real browser runs, with the device voice
 * and real taps, are in the commit messages that brought each fix.
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
  VirtualConsole: new () => {
    on(event: "jsdomError", listener: (e: Error & { type?: string; cause?: unknown }) => void): void;
  };
}
const { JSDOM, VirtualConsole } = createRequire(import.meta.url)("jsdom") as Jsdom;

/** How much faster than real time the artifact's timers and Date.now run. */
const SPEED = 20;
/** The artifact's dwell between stops, read off the file so a retune moves this test with it. */
const JDWELL = Number(/const JDWELL=(\d+);/.exec(html)?.[1] ?? NaN);

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Real milliseconds for a span of the artifact's milliseconds. */
const real = (artifactMs: number) => artifactMs / SPEED;

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

/** What the stub voice takes per word, in the artifact's milliseconds. Zira,
    the device voice the sweep used, measured 350 to 380. */
const VOICE_MS_PER_WORD = 380;

interface Utterance {
  text: string;
  words: number;
  /** How long the line needs, in the artifact's milliseconds. */
  needs: number;
  ended: boolean;
  /** Set when cancel() stopped the line while it was still speaking. */
  cutAt: number | null;
}

/** A device voice. It takes VOICE_MS_PER_WORD a word, fires `end` when it is
    done, and on cancel() fires `error` the way Chrome does and records that
    the line was cut while it was still speaking. `neverEnds` is the Chrome
    that sometimes drops `end`; `drops` is the Chrome that now and then drops a
    whole utterance said straight after a cancel, with no start, no end and no
    error. */
function stubVoice(window: ArtifactWindow, neverEnds: boolean, drops = false): Utterance[] {
  const said: Utterance[] = [];
  let current: { u: { onend?: (e: unknown) => void; onerror?: (e: unknown) => void }; rec: Utterance; t0: number; h: number } | null = null;
  class SpeechSynthesisUtterance {
    text: string;
    constructor(text: string) {
      this.text = text;
    }
  }
  const synth = {
    get speaking() {
      return !!current;
    },
    getVoices: () => [{ name: "Zira", lang: "en-US" }],
    speak(u: { text: string; onstart?: (e: unknown) => void; onend?: (e: unknown) => void }) {
      if (current) synth.cancel();
      const words = u.text.split(/\s+/).filter(Boolean).length;
      const rec: Utterance = { text: u.text, words, needs: words * VOICE_MS_PER_WORD, ended: false, cutAt: null };
      said.push(rec);
      if (drops) return;
      const t0 = window.Date.now();
      const h = neverEnds
        ? 0
        : window.setTimeout(() => {
            rec.ended = true;
            current = null;
            u.onend?.({});
          }, rec.needs);
      current = { u, rec, t0, h };
      u.onstart?.({});
    },
    cancel() {
      if (!current) return;
      const c = current;
      current = null;
      window.clearTimeout(c.h);
      c.rec.cutAt = window.Date.now() - c.t0;
      c.u.onerror?.({ error: "interrupted" });
    },
  };
  Object.assign(window, { speechSynthesis: synth, SpeechSynthesisUtterance });
  return said;
}

interface Booted {
  window: ArtifactWindow;
  doc: Document;
  uncaught: string[];
  said: Utterance[];
  run<T>(src: string): T;
  close(): void;
}

function boot(
  hash: string,
  viewport: { width: number; height: number },
  voice?: { neverEnds?: boolean; drops?: boolean },
): Booted {
  const uncaught: string[] = [];
  let said: Utterance[] = [];
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
      if (voice) said = stubVoice(w, !!voice.neverEnds, !!voice.drops);
    },
  });
  return {
    window,
    doc: window.document,
    uncaught,
    get said() {
      return said;
    },
    run: <T,>(src: string) => window.eval(src) as T,
    close: () => window.close(),
  };
}

const lines = (b: Booted) => [...b.doc.querySelectorAll<HTMLElement>("#maiaLog .mline")];
/** The lines that are stops: each carries the "n of total" counter. */
const stopLines = (b: Booted) => lines(b).filter((d) => d.querySelector(".jrow .jn"));
const lastLine = (b: Booted) => lines(b).slice(-1)[0];
const rowButtons = (b: Booted) => [...b.doc.querySelectorAll<HTMLButtonElement>("#maiaLog .jrow button")];
const live = (bs: HTMLButtonElement[]) => bs.filter((x) => !x.disabled);
/** A tap on a button in her log, as a browser takes it: nothing when disabled. */
function press(b: Booted, button: HTMLButtonElement | undefined): boolean {
  if (!button || button.disabled) return false;
  b.window.eval(button.getAttribute("onclick") ?? "");
  return true;
}
const walking = (b: Booted) => b.run<{ id: string; i: number; paused: boolean } | null>("JWALK");

async function until(test: () => boolean, realMs: number): Promise<boolean> {
  const end = Date.now() + realMs;
  while (Date.now() < end) {
    if (test()) return true;
    await settle(20);
  }
  return test();
}
/** Wait for the nth stop to land (1-based). A landing is about 0.6 s of real
    time, and far longer on a machine other work is loading: three artifacts
    flying at once there once took more than 6 s to land the first stop. */
async function landed(b: Booted, n: number): Promise<HTMLElement> {
  await until(() => stopLines(b).length >= n, 30000);
  const line = stopLines(b)[n - 1];
  expect(line, `stop ${n} landed`).toBeTruthy();
  return line as HTMLElement;
}
/** What a stop says about itself: the line, less its bold title and its row of answers. */
const narration = (stop: HTMLElement) =>
  [...stop.querySelectorAll(":scope > div")]
    .filter((d) => !d.classList.contains("jrow"))
    .map((d) => d.textContent ?? "")
    .join(" ")
    .trim();

it("reads the artifact this file is about (the positive control)", () => {
  expect(JDWELL, "the dwell, read off the file").toBe(6500);
  expect(html).toContain("function playJourney(");
  expect(html).toContain("const WELCOME_WALK_ON=false;");
});

/* F43. Rows from stops already passed stayed live. Every row calls the same
   three globals, which belong to the newest walk, so an old `stay here`
   cleared the address of an open place and announced the end of a walk
   nobody was on, or ended a different, newer walk. */
describe("a row from a stop already passed does nothing (F43)", () => {
  let b: Booted;
  beforeAll(async () => {
    b = boot("#skipIntro", DESK);
    await settle(200);
    b.run("playJourney('j2')");
    await landed(b, 1);
    b.run("jNext()");
    await landed(b, 2);
    b.run("jNext()");
    await landed(b, 3);
  });
  afterAll(() => b?.close());

  it("leaves only the newest stop's row live while the walk runs", () => {
    const newest = stopLines(b)[2];
    const liveNow = live(rowButtons(b));
    expect(liveNow.length, "live buttons in the log").toBeGreaterThan(0);
    expect(liveNow.every((x) => newest?.contains(x)), "every live button is in the newest row").toBe(true);
  });

  it("switches every row off when the walk ends", () => {
    b.doc.dispatchEvent(new b.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(walking(b), "Escape ended the walk").toBeNull();
    expect(rowButtons(b).length, "rows still in the log").toBeGreaterThanOrEqual(6);
    expect(live(rowButtons(b)), "live buttons after the walk ended").toEqual([]);
  });

  it("an old `stay here` under an open place keeps its address and says nothing", async () => {
    b.run("openPanel('ponds')");
    await settle(100);
    expect(b.window.location.hash).toBe("#/place/ponds");
    const mark = lastLine(b);
    const stay = rowButtons(b).find((x) => /stay here/.test(x.textContent ?? ""));
    expect(press(b, stay), "the old button took the tap").toBe(false);
    // The call itself, as a script or an old copy of the row would make it.
    b.run("jEnd()");
    await settle(50);
    expect(b.window.location.hash, "the place's address").toBe("#/place/ponds");
    expect(b.doc.getElementById("panel")?.classList.contains("open")).toBe(true);
    // Only her ending counts: the village news may write a line of its own at any moment.
    const added = lines(b).slice(lines(b).indexOf(mark as HTMLElement) + 1);
    expect(added.filter((d) => /The walk ends here/.test(d.textContent ?? "")).length, "endings she announced").toBe(0);
  });

  it("an old `stay here` cannot end a newer walk", async () => {
    b.run("playJourney('j3')");
    await landed(b, 4);
    const stale = rowButtons(b).find((x) => /stay here/.test(x.textContent ?? ""));
    expect(press(b, stale), "the stale button took the tap").toBe(false);
    expect(walking(b)?.id, "the Steward Journey is still walking").toBe("j3");
    expect(b.uncaught).toEqual([]);
  });
});

/* F37. Every journey narrated the Welcome Walk's monologue at its stops,
   because the stop's words were looked up by PLACE. The Steward Journey said
   it at all 8 stops, and "Where shall we start?" came word for word three
   times in the middle of the Resident Journey. */
describe("each journey says its own steps (F37)", () => {
  const JOURNEYS = ["j2", "j3", "j4"] as const;
  const walked = new Map<string, { title: string; said: string; more: boolean }[]>();
  let walkLines: string[] = [];
  let control: { gate: string; council: string; mine: string } = { gate: "", council: "", mine: "" };

  beforeAll(async () => {
    await Promise.all(
      JOURNEYS.map(async (id) => {
        const b = boot("#skipIntro", DESK);
        await settle(200);
        walkLines = b.run<string[]>("Object.values(MAIA_STOPS)");
        control = b.run("({gate:MAIA_STOPS.gate,council:MAIA_STOPS.council,mine:jLine({at:'council'},BY.council)})");
        const total = b.run<number>(`jById('${id}').steps.filter(st=>st.at&&BY[st.at]).length`);
        b.run(`playJourney('${id}')`);
        const stops: { title: string; said: string; more: boolean }[] = [];
        for (let n = 1; n <= total; n++) {
          const line = await landed(b, n);
          stops.push({
            title: line.querySelector("b")?.textContent ?? "",
            said: narration(line),
            more: !!line.querySelector('.jrow button[onclick="jMore()"]'),
          });
          if (n < total) b.run("jNext()");
        }
        walked.set(id, stops);
        expect(b.uncaught).toEqual([]);
        b.run("jEnd()");
        b.close();
      }),
    );
  });

  it.each(JOURNEYS)("%s walks every placed step", (id) => {
    expect(walked.get(id)?.length, `stops of ${id}`).toBeGreaterThan(3);
  });

  it.each(JOURNEYS)("%s never says the Welcome Walk's monologue at a stop", (id) => {
    expect(walkLines.length, "the monologue, read off the page").toBe(8);
    const heard = (walked.get(id) ?? []).filter((s) => walkLines.some((w) => s.said.includes(w))).map((s) => s.title);
    expect(heard, "stops that said a Welcome Walk line").toEqual([]);
  });

  it.each(JOURNEYS)("%s never says the same thing at two stops", (id) => {
    const said = (walked.get(id) ?? []).map((s) => s.said);
    const twice = said.filter((s, i) => said.indexOf(s) !== i);
    expect(twice, "narration repeated word for word").toEqual([]);
  });

  it.each(JOURNEYS)("%s offers `tell me more` only where the stop has not just said it", (id) => {
    for (const s of walked.get(id) ?? []) {
      // A stop that has just described its place is what jMore would say again.
      const described = !/^We stood here at stop \d+ as well\.$/.test(s.said);
      expect(s.more, `${s.title}: ${s.said}`).toBe(!described);
    }
  });

  it("counts seats in agreement with the verb", () => {
    const all = [...walked.values()].flat().map((s) => s.said);
    expect(all.filter((s) => /open seats belongs/.test(s)), "plural seats with a singular verb").toEqual([]);
    expect(all.some((s) => /\d+ open seats belong to this place/.test(s)), "the plural form is said somewhere").toBe(true);
  });

  it("still gives the Welcome Walk its own words (the control: the monologue is kept, for its walk)", () => {
    expect(control.gate).toMatch(/^I am Maia\./);
    expect(control.mine, "jLine at the council fire").toBe(control.council);
  });
});

/* F41. A journey that ran to its end took her sheet down on a phone one line
   before she said where the whole journey lives, so the closing line and its
   link went into a dock nobody could see. */
describe("a journey that runs to its end on a phone (F41)", () => {
  let b: Booted;
  let during = false;
  beforeAll(async () => {
    b = boot("#hud=pocket&skipIntro", PHONE);
    await settle(200);
    b.run("playJourney('j4')");
    await landed(b, 1);
    during = b.doc.body.classList.contains("msheet");
    // Left alone: the dwell carries it to the end.
    await until(() => walking(b) === null, 60000);
  });
  afterAll(() => b?.close());

  it("ran to its end on its own", () => {
    expect(during, "her sheet was up during the walk").toBe(true);
    expect(walking(b)).toBeNull();
    expect(b.run<string>("GUIDE.why")).toBe("done");
  });

  it("keeps her sheet up for the closing line and its link", () => {
    expect(b.doc.body.classList.contains("msheet"), "body.msheet after the finish").toBe(true);
    // Her closing line, after her last stop. Village news may follow it on the fast clock.
    const all = lines(b);
    const closing = all.filter((d) => (d.textContent ?? "").includes("The walk ends here.")).pop();
    expect(closing, "the closing line").toBeTruthy();
    expect(all.indexOf(closing as HTMLElement)).toBeGreaterThan(all.indexOf(stopLines(b).slice(-1)[0] as HTMLElement));
    expect(closing?.querySelector("a")?.getAttribute("href") ?? "").toMatch(/\/investor$/);
    // #gresume is not asserted: while the Welcome Walk is switched off, guideAffordance keeps it down whatever happens.
  });

  it("leaves no live row behind", () => {
    expect(live(rowButtons(b))).toEqual([]);
  });

  it("hands the sheet to the visitor: ASK MAIA puts it away", () => {
    (b.doc.getElementById("pbAsk") as HTMLButtonElement).click();
    expect(b.doc.body.classList.contains("msheet")).toBe(false);
  });

  it("a walk ended early still gives the phone its screen back (the control)", async () => {
    b.doc.body.classList.remove("msheet");
    b.run("playJourney('j4')");
    await landed(b, stopLines(b).length + 1);
    expect(b.doc.body.classList.contains("msheet")).toBe(true);
    b.run("jEnd()");
    expect(b.doc.body.classList.contains("msheet"), "body.msheet after `stay here`").toBe(false);
    expect(b.uncaught).toEqual([]);
  });
});

/* F39. Hiding her (ASK MAIA, Help, Your view, More, a door, the Loom, the
   header on a desk) left the walk flying and narrating out of sight. */
interface Hide {
  name: string;
  pocket: boolean;
  hide(b: Booted): void;
  show(b: Booted): void;
}
/* Whether she can be seen, by the classes that decide it. Written out here and
   not read from the artifact, so a case fails for what the visitor would see
   and not for a helper the page lacks. A phone shows her only with body.msheet,
   and the More drawer is drawn over her; a door's card and the Loom cover
   both profiles. */
function inView(b: Booted): boolean {
  const on = (id: string, c: string) => !!b.doc.getElementById(id)?.classList.contains(c);
  const body = b.doc.body.classList;
  if (on("maia", "min") || on("module", "show") || body.contains("loom")) return false;
  if (!body.contains("pocket")) return true;
  return body.contains("msheet") && !on("pdrawer", "open");
}
const tap = (b: Booted, sel: string) => (b.doc.querySelector(sel) as HTMLElement | null)?.click();
const HIDES: Hide[] = [
  { name: "the header on a desk", pocket: false, hide: (b) => tap(b, "#maiaHead"), show: (b) => tap(b, "#maiaHead") },
  {
    name: "a door's card on a desk",
    pocket: false,
    hide: (b) => tap(b, "#dock button"),
    // The card's own button is an inline handler jsdom will not run; the backdrop is a listener.
    show: (b) => b.doc.getElementById("module")?.dispatchEvent(new b.window.MouseEvent("click", { bubbles: true })),
  },
  { name: "the Loom on a desk", pocket: false, hide: (b) => tap(b, "#loomBtn"), show: (b) => tap(b, "#loomClose") },
  { name: "ASK MAIA on a phone", pocket: true, hide: (b) => tap(b, "#pbAsk"), show: (b) => tap(b, "#pbAsk") },
  { name: "Help on a phone", pocket: true, hide: (b) => tap(b, "#pbAttn"), show: (b) => tap(b, "#help .help-close") },
  { name: "the More drawer on a phone", pocket: true, hide: (b) => tap(b, "#pbMore"), show: (b) => tap(b, "#pbMore") },
  {
    name: "Your view on a phone",
    pocket: true,
    hide: (b) => {
      tap(b, "#pbMore");
      tap(b, '#pdrawer [data-pa="mask"]');
    },
    show: (b) => tap(b, "#skX"),
  },
];

describe("out of sight, the walk waits (F39)", () => {
  it("the control: left in view, a journey walks on by itself", async () => {
    const b = boot("#skipIntro", DESK);
    await settle(200);
    b.run("playJourney('j2')");
    await landed(b, 1);
    expect(await until(() => (walking(b)?.i ?? 0) >= 1, 10000), "stops walked on, unasked").toBe(true);
    b.close();
  });

  describe.each(HIDES)("hidden by $name", (h) => {
    let b: Booted;
    let hidden: { i: number | undefined; paused: boolean | undefined; stops: number };
    beforeAll(async () => {
      b = boot(h.pocket ? "#hud=pocket&skipIntro" : "#skipIntro", h.pocket ? PHONE : DESK);
      await settle(200);
      b.run("playJourney('j2')");
      await landed(b, 1);
      h.hide(b);
      await settle(real(JDWELL * 3));
      hidden = { i: walking(b)?.i, paused: walking(b)?.paused, stops: stopLines(b).length };
    });
    afterAll(() => b?.close());

    it("hid her (the case is the one it says it is)", () => {
      expect(inView(b)).toBe(false);
    });

    it("stops the walk where it was for three dwells", () => {
      expect(hidden).toEqual({ i: 0, paused: true, stops: 1 });
      expect(b.run<boolean>("GUIDE.on"), "the walk is paused, not ended").toBe(true);
    });

    it("offers the walk back when she is seen again, and walks on when asked", async () => {
      h.show(b);
      await settle(50);
      expect(inView(b), "she is back").toBe(true);
      // Her offer, after the stop she was hidden at. The village news may follow it.
      const all = lines(b);
      const offer = all.filter((d) => (d.textContent ?? "").includes("Say the word and we walk on.")).pop();
      expect(offer, "the offer to walk on").toBeTruthy();
      expect(all.indexOf(offer as HTMLElement)).toBeGreaterThan(all.indexOf(stopLines(b)[0] as HTMLElement));
      const walkOn = live(rowButtons(b)).find((x) => /walk on/.test(x.textContent ?? ""));
      expect(walkOn && offer?.contains(walkOn), "the offer's own `walk on` is the live one").toBe(true);
      expect(press(b, walkOn)).toBe(true);
      await landed(b, 2);
      expect(walking(b)?.i).toBe(1);
      expect(b.uncaught).toEqual([]);
    });
  });
});
