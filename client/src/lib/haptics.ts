/**
 * HAPTICS: the one place the product touches navigator.vibrate.
 *
 * The pattern was invented in MobileFab, where it was the only vibrate call
 * in the codebase, and its behaviour is carried here unchanged: a duration in
 * milliseconds, wrapped in try/catch, silently ignored anywhere the API is
 * absent. Two things are added.
 *
 * NAMED INTENSITIES instead of numbers at the call site. `haptic(8)` and
 * `haptic(10)` were two different taps for no reason anybody could state, and
 * a number carries no rule about what it is for. A name does, and the whole
 * vocabulary is five entries so it stays memorable.
 *
 * A MUTE THAT MEANS BOTH. A member who silences sound is asking for a quieter
 * device, and a phone buzzing at every tap is not that. `setHapticsEnabled`
 * is called by the sound layer's mute so the two travel together, and
 * client/src/lib/sound.ts owns the persistence for both.
 *
 * iOS Safari does not implement navigator.vibrate at all. That is not a bug
 * to work around: nothing here is ever the only feedback, so a device with no
 * motor loses a flourish and no information.
 */

export type HapticIntensity = "tick" | "tap" | "press" | "confirm" | "arrive";

/**
 * Milliseconds per intensity. Short by design. Anything above about 30ms
 * reads as an error buzz on Android, whatever it was meant to mean.
 */
export const HAPTIC_MS: Record<HapticIntensity, number | number[]> = {
  /** The lightest possible acknowledgement: a value stepping, a row toggling. */
  tick: 6,
  /** A normal control taking a tap. The old MobileFab row value. */
  tap: 8,
  /** Opening or closing something. The old MobileFab trigger value. */
  press: 10,
  /** A submission that was accepted. */
  confirm: 18,
  /** Something arrived on its own: a notification, a delivery landing. */
  arrive: [12, 40, 12],
};

let enabled = true;

/** Turn every haptic on or off. The sound layer's mute drives this. */
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export function hapticsEnabled(): boolean {
  return enabled;
}

/** True where the device can actually vibrate. */
export function hapticsSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof (navigator as Navigator & { vibrate?: unknown }).vibrate === "function";
}

/**
 * One haptic. Returns true only when the device accepted it, so a caller can
 * tell the difference between silence and refusal without guessing.
 */
export function haptic(intensity: HapticIntensity = "tap"): boolean {
  if (!enabled) return false;
  const pattern = HAPTIC_MS[intensity] ?? HAPTIC_MS.tap;
  // NOT BEFORE THE MEMBER HAS TOUCHED THE PAGE. The browser refuses a vibrate
  // until the page has had a user gesture, and says so in the console:
  // "Blocked call to navigator.vibrate because user hasn't tapped on the
  // frame". A celebration can fire on page load (the gratitude bloom on
  // /profile plays its moment as soon as its fetch lands), which put that
  // error on a page members open every day (sweep finding F9, 2026-09-21).
  // Where the engine reports activation, ask first; where it does not, this
  // is the same call as before. Inside the try, because `navigator` itself
  // can be absent.
  try {
    const activation = (navigator as unknown as { userActivation?: { hasBeenActive?: boolean } }).userActivation;
    if (activation && activation.hasBeenActive === false) return false;
    // Through unknown: the DOM lib types vibrate's pattern as an iterable in
    // this TypeScript version, and a plain number is the form every engine
    // actually takes. The shape here is the one the platform ships.
    const nav = navigator as unknown as { vibrate?: (p: number | number[]) => boolean };
    return typeof nav.vibrate === "function" ? nav.vibrate(pattern) === true : false;
  } catch {
    return false;
  }
}
