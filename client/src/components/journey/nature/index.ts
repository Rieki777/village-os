/**
 * THE NATURE KIT (game feel wave 2, 11 Nov 2026): the shared drawings the
 * chosen designs grow from. Organic, mycelial, lit by fireflies, with sacred
 * geometry as structure (docs/DESIGN_RULE.md, "The organic art direction").
 *
 * Keep it out of the first page: import a piece where it is used, inside a
 * page that is already a lazy route, or through React.lazy, and never from
 * the app shell. Its CSS (nature.css) travels with whichever chunk imports it.
 */
export { default as Fireflies } from "./Fireflies";
export type { FirefliesProps } from "./Fireflies";
export { default as SeedOfLife } from "./SeedOfLife";
export type { SeedOfLifeProps } from "./SeedOfLife";
export { default as FernUnfurl } from "./FernUnfurl";
export type { FernUnfurlProps } from "./FernUnfurl";
export { default as Vesica } from "./Vesica";
export type { VesicaProps } from "./Vesica";
export { default as MoonPhase, moonFor } from "./MoonPhase";
export type { MoonPhaseProps } from "./MoonPhase";
export { default as RootStrip } from "./RootStrip";
export type { RootStripProps } from "./RootStrip";
export { REST_AFTER_MS, useRest } from "./useRest";
export * from "./geometry";
