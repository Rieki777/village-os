/**
 * THE JOURNEY KIT: the joining journey drawn as a walk through the world
 * (game feel lane, 10 Nov 2026). Its CSS is the `jw-` block at the end of
 * client/src/index.css: .jw-btn (rest, hover, press, focus, disabled),
 * .jw-pick (a ring on the water when something is chosen), .jw-ring (a
 * portrait's frame growing in), .jw-unfurl / .jw-seal (growth), .jw-trail and
 * .jw-trail-v (the path). Celebrations come from components/natural.
 */
export { default as Trail, trailFill } from "./Trail";
export type { TrailProps } from "./Trail";
export { default as Leaf } from "./Leaf";
