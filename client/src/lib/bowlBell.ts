/**
 * THE SINGING BOWL. A bowl struck once, made in the browser from a handful of
 * tones, so there is no recording to licence (see the sourcing rules in
 * `sound.ts`) and nothing to download.
 *
 * A real bowl rings at a low fundamental with a few higher partials that are
 * not whole multiples of it, and each partial is two close tones that beat
 * against each other, which is the slow wobble a bowl is known for. The higher
 * partials fade first, so the strike is bright and the tail is warm.
 *
 * Browsers keep audio locked until a person taps the page, so `unlockBell`
 * has to run inside a tap. After that, `ringBell` can sound at the moment a
 * shared sit ends with nobody touching the screen. Mute is honoured: a member
 * who asked for quiet gets quiet here too.
 */
import { isMuted } from "./sound";

type Ctx = AudioContext;

let ctx: Ctx | null = null;

function context(): Ctx | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** True once the browser has let this page make sound. */
export function bellReady(): boolean {
  return ctx?.state === "running";
}

/** Call from a tap. Resolves true when the page may now ring the bowl. */
export async function unlockBell(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  try {
    if (c.state !== "running") await c.resume();
  } catch {
    return false;
  }
  return c.state === "running";
}

/** Partials as [ratio to the fundamental, loudness, seconds to fade]. */
const PARTIALS: readonly [number, number, number][] = [
  [1, 0.5, 9],
  [2.71, 0.22, 6],
  [5.13, 0.1, 3.5],
  [8.41, 0.05, 2],
];

/** How far apart the two tones of a partial sit, in hertz: the beat. */
const BEAT_HZ = 0.9;

/**
 * Strike the bowl. `soft` is a lighter strike, for the start of a sit.
 * Resolves false when nothing sounded (muted, locked or unsupported).
 */
export async function ringBell({ soft = false, fundamental = 196 }: { soft?: boolean; fundamental?: number } = {}): Promise<boolean> {
  if (isMuted()) return false;
  const c = context();
  if (!c || c.state !== "running") return false;
  const t0 = c.currentTime + 0.02;
  const master = c.createGain();
  master.gain.value = soft ? 0.35 : 0.7;
  master.connect(c.destination);
  let longest = 0;
  for (const [ratio, level, fade] of PARTIALS) {
    for (const detune of [-BEAT_HZ / 2, BEAT_HZ / 2]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = fundamental * ratio + detune;
      // A quick strike, then a long exponential fade.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(level / 2, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + fade);
      osc.connect(gain).connect(master);
      osc.start(t0);
      osc.stop(t0 + fade + 0.1);
      longest = Math.max(longest, fade);
    }
  }
  window.setTimeout(() => master.disconnect(), (longest + 0.5) * 1000);
  return true;
}
