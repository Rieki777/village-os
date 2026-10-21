/**
 * THE NATURAL INTERFACE KIT: one import for the whole vocabulary.
 *
 * The contract lives in docs/modules/natural-interface.md. Read the moon's
 * three rules there before using MoonProgress anywhere, and the celebration
 * intensity table before reaching for `moment`.
 */
export { default as MoonProgress } from "./MoonProgress";
export type { MoonProgressProps, MoonThresholdTone } from "./MoonProgress";

export { default as BreathingLoader } from "./BreathingLoader";
export type { BreathingLoaderProps } from "./BreathingLoader";

export { default as Celebration, Blossom, Dawn, Fireflies, Ripples, Seeds } from "./Celebration";
export type { CelebrationProps } from "./Celebration";

export {
  CELEBRATION_INTENSITIES,
  CELEBRATION_KINDS,
  celebrationCount,
  celebrationDuration,
  celebrationPlan,
  STILL_STATE,
} from "./celebrationPlan";
export type { CelebrationElement, CelebrationIntensity, CelebrationKind, CelebrationPlan } from "./celebrationPlan";

export {
  MOON_STEPS,
  clamp01,
  illuminatedFraction,
  litPath,
  litSideOf,
  moonPathParts,
  readLunation,
  readProgress,
  terminatorPath,
  terminatorRadius,
  waxingPhase,
} from "./moonGeometry";
export type { LitSide, MoonReading } from "./moonGeometry";

export { prefersReducedMotion, useReducedMotion } from "./useReducedMotion";
export { scrollBehavior } from "./scrollBehavior";
