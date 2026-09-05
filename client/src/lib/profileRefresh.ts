/**
 * ONE SIGNAL THAT SAYS "THE PROFILE MOVED".
 *
 * Every card on the character sheet reads its own endpoint once on mount and
 * then never again. That is fine until something on the same page WRITES:
 * fronting a character, walking a new path, leaving one. The card that
 * performed the write updates itself from the response it holds, and every
 * other card on the page keeps painting the answer it fetched before the
 * write happened. A member fronts a new character and the hero swaps while
 * the quest chips, the balance and the journey underneath still describe the
 * profile as it was, with nothing on screen saying so.
 *
 * This is deliberately the smallest thing that fixes that: a named window
 * event, the same shape `modules:changed` and `MAP_SKIN_SAVED_EVENT` already
 * use in this codebase. It carries NO payload, so nothing can come to depend
 * on its contents, and it is not a cache, a store or a query client. A writer
 * calls `announceProfileChange()` after the server confirmed; a reader calls
 * `onProfileRefresh(load)` in an effect and re-runs the read it already had.
 *
 * WHY A WINDOW EVENT AND NOT A CONTEXT. The readers are not siblings under
 * one provider: the hero, the dashboard and the journey are three separate
 * children of the profile page, and the character select is a different route
 * entirely. A context would mean a provider wrapping the page and every
 * caller becoming a consumer, which is a rebuild of data fetching. This is
 * four lines and it works across routes.
 *
 * NOT A POLL. Nothing here runs on a timer. A read happens when a write said
 * one should.
 */

/** The event name. Exported so a test can dispatch it without this module. */
export const PROFILE_REFRESH_EVENT = "profile:refresh";

/**
 * Say that something on the profile changed, AFTER the server confirmed it.
 *
 * Guarded on `window` so a module imported in a node test file does not throw
 * at call time.
 */
export function announceProfileChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROFILE_REFRESH_EVENT));
}

/**
 * Re-run `reload` whenever a write is announced. Returns the unsubscribe, so
 * an effect can `return onProfileRefresh(load)` and nothing leaks.
 */
export function onProfileRefresh(reload: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PROFILE_REFRESH_EVENT, reload);
  return () => window.removeEventListener(PROFILE_REFRESH_EVENT, reload);
}
