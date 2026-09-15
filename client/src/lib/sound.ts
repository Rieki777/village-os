/**
 * THE AUDIO LAYER. Mechanism only: this file ships no sound.
 *
 * The ruling is that the game should honour nature everywhere, sound
 * included. There was no audio anywhere in the product, so this is the
 * plumbing, and it is deliberately inert until a village supplies files.
 *
 * WHY NO FILES ARE COMMITTED. A licence is a human check, and a fabricated
 * one is worse than silence: every fork inherits the obligation and violates
 * it without ever being told. `SOUND_MANIFEST` below names each moment, the
 * sound wanted and its size budget, and docs/modules/natural-interface.md
 * carries the sourcing rules. The short version, because it is the part that
 * gets skipped: CC0 ONLY, and the BBC library is not usable here because its
 * terms are personal, educational and research, and this is a commercial
 * product.
 *
 * WHERE THE BYTES LIVE. The uploads volume, served by `/api/uploads/:file`,
 * never client/public. That directory is cached one-year-immutable and
 * counts against the dist budget, so a village that wanted its own sounds
 * would have to fork the platform to get them. The uploads volume is hashed,
 * swappable and per-deployment, which is what a village asset is.
 *
 * FIVE RULES THE MECHANISM KEEPS.
 *
 *   1. Nothing autoplays. A sound happens because `playSound` was called for
 *      a moment that just occurred, and the browser's own gesture rule is the
 *      floor under that.
 *   2. Mute is persisted per member and honoured everywhere, including the
 *      haptics, because a member asking for quiet means the device.
 *   3. Silence under `prefers-reduced-motion`. Someone managing sensory load
 *      is not asking for a soundtrack.
 *   4. Nothing blocks. Every call returns a promise that resolves and never
 *      rejects; a blocked or missing file resolves false.
 *   5. A missing file fails silently and is remembered, so a village with
 *      three of the five sounds gets three sounds and no console noise.
 */
import { useCallback, useEffect, useState } from "react";
import { prefersReducedMotion } from "@/components/natural/useReducedMotion";
import { haptic, setHapticsEnabled, type HapticIntensity } from "./haptics";
import { storedText, writeStored } from "./safeStorage";

/** The five moments the product makes a sound for. */
export const SOUND_MOMENTS = [
  "quest_complete",
  "gratitude",
  "stage_advance",
  "notification",
  "ui_tick",
] as const;

export type SoundMoment = (typeof SOUND_MOMENTS)[number];

export interface SoundSpec {
  /** What a member is being told. */
  moment: string;
  /** The sound wanted, in the terms a search on a CC0 library uses. */
  wanted: string;
  /** Seconds. A one-shot that outstays this becomes an interruption. */
  seconds: [number, number];
  /** Kilobytes for the OGG. The MP3 fallback may run to twice this. */
  maxKb: number;
}

/**
 * THE MANIFEST. This is the brief a village hands to whoever sources the
 * audio, and the budget the result has to fit. Formats: OGG Vorbis as the
 * primary with an MP3 fallback for Safari, mono, 44.1kHz, normalised to about
 * -16 LUFS so one moment is not twice the loudness of another.
 */
export const SOUND_MANIFEST: Record<SoundMoment, SoundSpec> = {
  quest_complete: {
    moment: "A quest was consented and the work is done",
    wanted: "A short wooden wind chime settling, three or four notes falling",
    seconds: [0.8, 1.6],
    maxKb: 120,
  },
  gratitude: {
    // village-ok: this manifest is a sourcing brief for whoever records the
    // audio, and `moment` is never rendered anywhere (nothing in client/src or
    // server reads it). It names the platform event, so it stays in the
    // platform's own words rather than a village's configured token name.
    moment: "Gratitude was sent, and the same sound when it arrives",
    wanted: "One soft water drop into a still pool, with a little room tail",
    seconds: [0.4, 0.9],
    maxKb: 80,
  },
  stage_advance: {
    moment: "A member moved a stage along the Path of Growth",
    wanted: "Dawn birdsong opening, two or three birds, no traffic underneath",
    seconds: [1.2, 2.5],
    maxKb: 150,
  },
  notification: {
    moment: "Something arrived that was not asked for",
    wanted: "A single low bamboo knock, dry and close",
    seconds: [0.2, 0.5],
    maxKb: 60,
  },
  ui_tick: {
    moment: "A control took an input",
    wanted: "A leaf brushing a leaf, almost under hearing",
    seconds: [0.05, 0.15],
    maxKb: 50,
  },
};

// ── The handle the layer plays through ──────────────────────────────────────

/**
 * The slice of HTMLAudioElement this file uses. Narrow on purpose: it is the
 * seam a test drives, and a narrow seam cannot drift from the real element.
 */
export interface SoundHandle {
  play(): Promise<void> | void;
  canPlayType?(type: string): string;
  volume?: number;
}

export interface SoundFiles {
  /** Filename in the uploads volume, no path. */
  ogg?: string;
  /** Filename in the uploads volume, no path. */
  mp3?: string;
}

export interface SoundConfig {
  /** Which uploaded file serves which moment. Absent moments stay silent. */
  files?: Partial<Record<SoundMoment, SoundFiles>>;
  /** Where uploads are served from. The platform's own route by default. */
  base?: string;
  /** 0 to 1. Village-wide ceiling, under the member's own mute. */
  volume?: number;
  /** Test seam. Defaults to the browser's Audio constructor. */
  createAudio?: (src: string) => SoundHandle;
}

const UPLOADS_BASE = "/api/uploads";

let config: Required<Pick<SoundConfig, "base" | "volume">> & SoundConfig = {
  base: UPLOADS_BASE,
  volume: 0.5,
  files: {},
};

/** Cached handles, and the moments already proven unplayable. */
const handles = new Map<SoundMoment, SoundHandle>();
const broken = new Set<SoundMoment>();

/**
 * Point the layer at a village's uploaded files. Called once at boot with
 * whatever the deployment configured; calling it with nothing leaves every
 * moment silent, which is the shipped default.
 */
export function configureSounds(next: SoundConfig): void {
  config = {
    base: next.base ?? config.base ?? UPLOADS_BASE,
    volume: typeof next.volume === "number" ? Math.min(1, Math.max(0, next.volume)) : config.volume,
    files: next.files ?? config.files,
    // Presence, not truthiness: passing `createAudio: undefined` has to be a
    // way of saying "back to the browser's own Audio", or a test that once
    // installed a stub can never take it out again.
    createAudio: "createAudio" in next ? next.createAudio : config.createAudio,
  };
  handles.clear();
  broken.clear();
}

/** The address a moment's audio is served from, or null when none is set. */
export function soundUrl(moment: SoundMoment): string | null {
  const files = config.files?.[moment];
  if (!files) return null;
  const name = pickFormat(files);
  return name ? `${config.base}/${name}` : null;
}

/**
 * OGG where the browser admits it, MP3 otherwise. Safari answers "" for OGG
 * and "maybe" for MP3, every other engine takes the OGG.
 */
function pickFormat(files: SoundFiles): string | undefined {
  const canOgg = (() => {
    if (!files.ogg) return false;
    if (typeof document === "undefined") return true;
    try {
      const probe = document.createElement("audio");
      return probe.canPlayType("audio/ogg") !== "";
    } catch {
      return true;
    }
  })();
  if (canOgg && files.ogg) return files.ogg;
  return files.mp3 ?? files.ogg;
}

// ── Mute, per member ────────────────────────────────────────────────────────

/**
 * Mute lives in localStorage under the member's id, the way the first walk's
 * progress and the landing preference already do: per browser and per person,
 * no server state, nothing to migrate, and a cleared browser loses a
 * preference rather than anything that matters. Set the member at sign-in
 * with `setSoundMember` so two people sharing a laptop do not share a mute.
 */
const MUTE_KEY = "village.sound.muted";

let memberId = "";
let muted: boolean | null = null;

function storageKey(): string {
  return memberId ? `${MUTE_KEY}:${memberId}` : MUTE_KEY;
}

function read(key: string): string | null {
  return storedText("local", key);
}

function write(key: string, value: string): void {
  /* private browsing: the preference simply never sticks */
  writeStored("local", key, value);
}

/** Scope the mute to a member. Call at sign-in and again at sign-out with "". */
export function setSoundMember(id: string | number | null | undefined): void {
  const next = id === null || id === undefined ? "" : String(id);
  if (next === memberId) return;
  memberId = next;
  muted = null;
  setHapticsEnabled(!isMuted());
}

export function isMuted(): boolean {
  if (muted !== null) return muted;
  if (typeof window === "undefined") return false;
  muted = read(storageKey()) === "1";
  // The stored preference has to reach the haptics too, and until now only
  // `setMuted` and `setSoundMember` told them about it. Neither runs on a
  // fresh page load, so a member who muted yesterday came back to a silent
  // product that still buzzed: the mute was read here and never forwarded.
  // Forwarding it at the moment it resolves fixes that wherever the read
  // happens first, and `playMoment` below makes sure it always does.
  setHapticsEnabled(!muted);
  return muted;
}

/** Mute or unmute. Haptics follow, because quiet means the whole device. */
export function setMuted(on: boolean): void {
  muted = on;
  if (typeof window !== "undefined") write(storageKey(), on ? "1" : "0");
  setHapticsEnabled(!on);
  listeners.forEach((listener) => listener(on));
}

const listeners = new Set<(on: boolean) => void>();

/** Subscribe to mute changes, so every control showing the state agrees. */
export function onMuteChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── Playing ─────────────────────────────────────────────────────────────────

/** Why a call made no sound. Useful in a test, never shown to a member. */
export type SoundOutcome = "played" | "muted" | "reduced-motion" | "no-asset" | "unavailable";

function handleFor(moment: SoundMoment): SoundHandle | null {
  const cached = handles.get(moment);
  if (cached) return cached;
  const url = soundUrl(moment);
  if (!url) return null;
  const make =
    config.createAudio ??
    (typeof Audio === "function" ? (src: string) => new Audio(src) as SoundHandle : null);
  if (!make) return null;
  try {
    const h = make(url);
    if (typeof h.volume === "number") h.volume = config.volume;
    handles.set(moment, h);
    return h;
  } catch {
    return null;
  }
}

/**
 * Play one moment. Resolves when the attempt is over and never rejects, so a
 * caller can ignore the result entirely and nothing waits on audio.
 *
 * A moment that fails once is remembered and skipped, which is how a village
 * with three of the five files gets three sounds and a quiet console.
 */
export async function playSound(moment: SoundMoment): Promise<SoundOutcome> {
  if (isMuted()) return "muted";
  if (prefersReducedMotion()) return "reduced-motion";
  if (broken.has(moment)) return "unavailable";
  const handle = handleFor(moment);
  if (!handle) return "no-asset";
  try {
    await handle.play();
    return "played";
  } catch {
    // A blocked autoplay and a 404 look identical here. Both mean this
    // moment stays quiet, and neither is worth a member's attention.
    broken.add(moment);
    return "unavailable";
  }
}

/** Forget the failures, for a village that just uploaded the missing file. */
export function resetSounds(): void {
  handles.clear();
  broken.clear();
}

/**
 * ONE MOMENT, THROUGH BOTH CHANNELS. The call every celebration makes.
 *
 * Sound and haptics are one gesture from a member's point of view and were
 * two imports at every call site, which is how they drift: a surface that
 * remembers the chime and forgets the buzz, or the reverse. This is the
 * pairing, and it is the only thing the wired moments call.
 *
 * ORDER MATTERS HERE. `playSound` reads `isMuted()` first, and that read is
 * what forwards a stored mute to the haptics, so the vibrate below is asking
 * a question that has just been answered correctly. Calling `haptic` first
 * would buzz once for a muted member on every fresh page load.
 *
 * REDUCED MOTION SILENCES BOTH. `playSound` already refuses under it, and a
 * vibration is sensory load by the same argument the sound layer makes: a
 * member managing it is not asking for a buzz either.
 *
 * Fire and forget. Nothing here blocks, throws, or is ever the only signal.
 */
export function playMoment(moment: SoundMoment, intensity: HapticIntensity = "confirm"): void {
  void playSound(moment).then((outcome) => {
    if (outcome === "muted" || outcome === "reduced-motion") return;
    haptic(intensity);
  });
}

// ── The hook ────────────────────────────────────────────────────────────────

export interface SoundApi {
  /** Play a moment. Fire and forget. */
  play: (moment: SoundMoment) => void;
  muted: boolean;
  setMuted: (on: boolean) => void;
  toggleMute: () => void;
}

/**
 * The component-facing form. `play` swallows its own promise so a click
 * handler can call it on one line and never await anything.
 */
export function useSound(): SoundApi {
  const [mutedState, setMutedState] = useState<boolean>(isMuted);

  useEffect(() => {
    setMutedState(isMuted());
    return onMuteChange(setMutedState);
  }, []);

  const play = useCallback((moment: SoundMoment) => {
    void playSound(moment);
  }, []);

  const set = useCallback((on: boolean) => setMuted(on), []);
  const toggle = useCallback(() => setMuted(!isMuted()), []);

  return { play, muted: mutedState, setMuted: set, toggleMute: toggle };
}
