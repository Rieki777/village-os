/**
 * PROVING PLUMBING THAT CARRIES NOTHING YET.
 *
 * No audio file is committed, on purpose, so the thing to prove is that the
 * mechanism is correct while empty and correct once filled: it resolves
 * rather than hanging, it honours mute, it honours reduce-motion, it fails
 * silently on a missing file, and it does not go on retrying that file.
 *
 * The seam is `configureSounds({ createAudio })`, which is the only browser
 * API this file touches. Everything else here is arithmetic and storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hapticsEnabled, setHapticsEnabled } from "./haptics";
import {
  SOUND_MANIFEST,
  SOUND_MOMENTS,
  configureSounds,
  isMuted,
  onMuteChange,
  playSound,
  resetSounds,
  setMuted,
  setSoundMember,
  soundUrl,
  type SoundHandle,
} from "./sound";

// ── A browser, small enough to hold in the head ─────────────────────────────

let store: Map<string, string>;
let reduceMotion = false;

function fakeWindow() {
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    matchMedia: (q: string) => ({ matches: reduceMotion && q.includes("reduce") }),
  };
}

/** An audio element that always plays. */
const okAudio = () => {
  const played: string[] = [];
  const create = (src: string): SoundHandle => ({
    volume: 1,
    play: () => {
      played.push(src);
      return Promise.resolve();
    },
  });
  return { create, played };
};

const FILES = {
  quest_complete: { ogg: "1755000000000-a1b2-quest.ogg", mp3: "1755000000000-a1b2-quest.mp3" },
  gratitude: { ogg: "1755000000001-c3d4-gratitude.ogg" },
};

beforeEach(() => {
  store = new Map();
  reduceMotion = false;
  (globalThis as { window?: unknown }).window = fakeWindow();
  setSoundMember("");
  setMuted(false);
  setHapticsEnabled(true);
  configureSounds({ files: {}, createAudio: undefined, volume: 0.5 });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

// ── The manifest ────────────────────────────────────────────────────────────

describe("the manifest", () => {
  it("names five moments and briefs every one of them", () => {
    expect(SOUND_MOMENTS).toHaveLength(5);
    for (const moment of SOUND_MOMENTS) {
      const spec = SOUND_MANIFEST[moment];
      expect(spec.moment.length).toBeGreaterThan(10);
      expect(spec.wanted.length).toBeGreaterThan(10);
      const [lo, hi] = spec.seconds;
      expect(lo).toBeGreaterThan(0);
      expect(hi).toBeGreaterThan(lo);
      expect(spec.maxKb).toBeGreaterThan(0);
    }
  });

  it("holds every one-shot inside the 50 to 150 KB budget", () => {
    for (const moment of SOUND_MOMENTS) {
      expect(SOUND_MANIFEST[moment].maxKb).toBeGreaterThanOrEqual(50);
      expect(SOUND_MANIFEST[moment].maxKb).toBeLessThanOrEqual(150);
    }
  });

  it("keeps every one-shot under three seconds", () => {
    for (const moment of SOUND_MOMENTS) {
      expect(SOUND_MANIFEST[moment].seconds[1]).toBeLessThanOrEqual(3);
    }
  });
});

// ── Where the bytes come from ───────────────────────────────────────────────

describe("asset addresses", () => {
  it("serves from the uploads volume, never from the bundle", () => {
    configureSounds({ files: FILES });
    const url = soundUrl("quest_complete");
    expect(url).toBe("/api/uploads/1755000000000-a1b2-quest.ogg");
    expect(url).not.toContain("/assets/");
  });

  it("has no address for a moment the village never supplied", () => {
    configureSounds({ files: FILES });
    expect(soundUrl("stage_advance")).toBeNull();
    expect(soundUrl("ui_tick")).toBeNull();
  });

  it("ships silent: nothing is configured by default", () => {
    for (const moment of SOUND_MOMENTS) expect(soundUrl(moment)).toBeNull();
  });

  it("falls back to the MP3 where the browser refuses OGG", () => {
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ canPlayType: (t: string) => (t === "audio/ogg" ? "" : "maybe") }),
    };
    configureSounds({ files: FILES });
    expect(soundUrl("quest_complete")).toBe("/api/uploads/1755000000000-a1b2-quest.mp3");
    delete (globalThis as { document?: unknown }).document;
  });
});

// ── Playing ─────────────────────────────────────────────────────────────────

describe("playing", () => {
  it("resolves rather than hanging when nothing is configured", async () => {
    await expect(playSound("quest_complete")).resolves.toBe("no-asset");
  });

  it("plays a configured moment once the village supplies the file", async () => {
    const audio = okAudio();
    configureSounds({ files: FILES, createAudio: audio.create });
    await expect(playSound("quest_complete")).resolves.toBe("played");
    expect(audio.played).toEqual(["/api/uploads/1755000000000-a1b2-quest.ogg"]);
  });

  it("reuses one element per moment rather than minting one per call", async () => {
    const create = vi.fn((): SoundHandle => ({ play: () => Promise.resolve() }));
    configureSounds({ files: FILES, createAudio: create });
    await playSound("gratitude");
    await playSound("gratitude");
    await playSound("gratitude");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("applies the village volume ceiling", async () => {
    const handles: SoundHandle[] = [];
    configureSounds({
      files: FILES,
      volume: 0.25,
      createAudio: () => {
        const h: SoundHandle = { volume: 1, play: () => Promise.resolve() };
        handles.push(h);
        return h;
      },
    });
    await playSound("gratitude");
    expect(handles[0].volume).toBe(0.25);
  });

  it("never autoplays: no element exists until a moment is played", () => {
    const create = vi.fn((): SoundHandle => ({ play: () => Promise.resolve() }));
    configureSounds({ files: FILES, createAudio: create });
    expect(create).not.toHaveBeenCalled();
  });
});

// ── Failing quietly ─────────────────────────────────────────────────────────

describe("a missing file", () => {
  it("no-ops instead of throwing, and stops retrying", async () => {
    const play = vi.fn(() => Promise.reject(new Error("404")));
    configureSounds({ files: FILES, createAudio: () => ({ play }) });
    await expect(playSound("quest_complete")).resolves.toBe("unavailable");
    await expect(playSound("quest_complete")).resolves.toBe("unavailable");
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("leaves the other moments working", async () => {
    const create = (src: string): SoundHandle => ({
      play: () => (src.includes("quest") ? Promise.reject(new Error("404")) : Promise.resolve()),
    });
    configureSounds({ files: FILES, createAudio: create });
    await expect(playSound("quest_complete")).resolves.toBe("unavailable");
    await expect(playSound("gratitude")).resolves.toBe("played");
  });

  it("tries again once the village uploads the file", async () => {
    const play = vi.fn(() => Promise.reject(new Error("404")));
    configureSounds({ files: FILES, createAudio: () => ({ play }) });
    await playSound("quest_complete");
    resetSounds();
    await playSound("quest_complete");
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("survives a browser with no Audio constructor at all", async () => {
    configureSounds({ files: FILES });
    await expect(playSound("quest_complete")).resolves.toBe("no-asset");
  });
});

/**
 * A BLOCKED AUTOPLAY IS NOT A MISSING FILE.
 *
 * A browser refuses `play()` with a `NotAllowedError` until the page has had a
 * gesture, and lifts that the moment the member taps anything. It used to land
 * in the same catch as a 404 and mark the moment broken for the visit, so a
 * celebration that fired on load silenced every later sound of that moment,
 * after the tap too. The gratitude bloom on /profile fires on load, before any
 * tap, so it silenced gratitude for the whole visit.
 *
 * Real `DOMException`s, because that is what a browser throws, and because the
 * tempting wrong fix is `e instanceof DOMException`: a missing or undecodable
 * file is ALSO a DOMException, so that fix would retry a file that is not there
 * on every celebration forever. The second case is the guard against it.
 */
describe("an autoplay block", () => {
  it("is reported as blocked and not remembered, so the moment plays once the member has tapped", async () => {
    let mayPlay = false;
    const play = vi.fn(() =>
      mayPlay ? Promise.resolve() : Promise.reject(new DOMException("no gesture yet", "NotAllowedError")),
    );
    configureSounds({ files: FILES, createAudio: () => ({ play }) });
    await expect(playSound("gratitude")).resolves.toBe("blocked");
    mayPlay = true; // the member taps something
    await expect(playSound("gratitude")).resolves.toBe("played");
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("still remembers a file that genuinely cannot play, which is a DOMException too", async () => {
    const play = vi.fn(() => Promise.reject(new DOMException("no supported source", "NotSupportedError")));
    configureSounds({ files: FILES, createAudio: () => ({ play }) });
    await expect(playSound("gratitude")).resolves.toBe("unavailable");
    await expect(playSound("gratitude")).resolves.toBe("unavailable");
    expect(play).toHaveBeenCalledTimes(1);
  });
});

// ── Mute ────────────────────────────────────────────────────────────────────

describe("mute", () => {
  it("silences every moment", async () => {
    const audio = okAudio();
    configureSounds({ files: FILES, createAudio: audio.create });
    setMuted(true);
    for (const moment of SOUND_MOMENTS) {
      await expect(playSound(moment)).resolves.toBe("muted");
    }
    expect(audio.played).toEqual([]);
  });

  it("persists, and is read back on a fresh page", () => {
    setSoundMember(42);
    setMuted(true);
    expect(store.get("village.sound.muted:42")).toBe("1");
    // A fresh page: the same storage, the in-memory cache dropped.
    setSoundMember("");
    setSoundMember(42);
    expect(isMuted()).toBe(true);
  });

  it("belongs to a member, not to a laptop", () => {
    setSoundMember(1);
    setMuted(true);
    setSoundMember(2);
    expect(isMuted()).toBe(false);
    setSoundMember(1);
    expect(isMuted()).toBe(true);
  });

  it("takes the haptics with it, because quiet means the device", () => {
    setMuted(true);
    expect(hapticsEnabled()).toBe(false);
    setMuted(false);
    expect(hapticsEnabled()).toBe(true);
  });

  it("tells every control that is showing the state", () => {
    const seen: boolean[] = [];
    const off = onMuteChange((on) => seen.push(on));
    setMuted(true);
    setMuted(false);
    off();
    setMuted(true);
    expect(seen).toEqual([true, false]);
  });

  it("survives storage that refuses to write", () => {
    (globalThis as { window?: { localStorage: unknown } }).window = {
      ...fakeWindow(),
      localStorage: {
        getItem: () => {
          throw new Error("private browsing");
        },
        setItem: () => {
          throw new Error("private browsing");
        },
      },
    } as never;
    setSoundMember("");
    setSoundMember(9);
    expect(() => setMuted(true)).not.toThrow();
    expect(isMuted()).toBe(true);
  });
});

// ── Reduce motion ───────────────────────────────────────────────────────────

describe("reduce motion", () => {
  it("is silence, without touching the member's own mute", async () => {
    const audio = okAudio();
    configureSounds({ files: FILES, createAudio: audio.create });
    reduceMotion = true;
    await expect(playSound("quest_complete")).resolves.toBe("reduced-motion");
    expect(audio.played).toEqual([]);
    expect(isMuted()).toBe(false);
    reduceMotion = false;
    await expect(playSound("quest_complete")).resolves.toBe("played");
  });
});
