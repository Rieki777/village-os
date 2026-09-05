// @vitest-environment jsdom
/**
 * The one signal that says the profile moved.
 *
 * It is four lines, and the two ways four lines like this go wrong are both
 * checked here: a subscriber that never hears anything, and an unsubscribe
 * that does not unsubscribe. The second one is the expensive one, because a
 * leaked listener on a card that has unmounted re-runs its fetch and calls
 * setState on a dead component for the rest of the session.
 */
import { describe, expect, it, vi } from "vitest";
import { PROFILE_REFRESH_EVENT, announceProfileChange, onProfileRefresh } from "./profileRefresh";

describe("profileRefresh", () => {
  it("runs every subscriber when a change is announced", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onProfileRefresh(a);
    const offB = onProfileRefresh(b);

    announceProfileChange();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it("stops running a subscriber that has unsubscribed", () => {
    const seen = vi.fn();
    const off = onProfileRefresh(seen);
    announceProfileChange();
    off();
    announceProfileChange();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("carries no payload, so nothing can come to depend on one", () => {
    let got: Event | null = null;
    const off = onProfileRefresh(function (this: unknown, ...args: unknown[]) {
      got = args[0] as Event;
    });
    announceProfileChange();
    off();
    expect(got).not.toBeNull();
    expect((got as unknown as Event).type).toBe(PROFILE_REFRESH_EVENT);
    // A plain Event, not a CustomEvent: there is no `detail` to read.
    expect("detail" in (got as unknown as Event)).toBe(false);
  });
});
