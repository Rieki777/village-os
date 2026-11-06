/**
 * A file of its own, beside useReducedMotion.ts rather than inside it, because
 * sixteen test files mock that module wholesale with exactly two exports, and
 * a third export there would be undefined in every one of them. Reading the
 * preference through prefersReducedMotion keeps those mocks in charge here too.
 */
import { prefersReducedMotion } from "./useReducedMotion";

/**
 * The `behavior` for a scroll the app starts itself.
 *
 * index.css answers "reduce motion" for scrolling with
 * `scroll-behavior: auto !important`, and that rule only reaches a scroll that
 * leaves the choice to the stylesheet (a plain `#anchor` link does). A call
 * that names the smooth behaviour outright overrules the stylesheet, so the
 * page glides anyway. Measured under emulated reduce, cold, at 390 wide: the
 * home page's second "Pick your path" link slid through 14 positions over
 * about 650ms on its way to the paths, exactly as it does with motion on.
 *
 * So every scroll the app starts reads its behaviour here: a glide for whoever
 * is fine with motion, an instant jump for whoever asked for less. Read at call
 * time, so a member who changes the setting with the page open gets the new
 * answer on the next scroll.
 */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "instant" : "smooth";
}
