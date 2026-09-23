/**
 * The haptic util carries MobileFab's behaviour, so the test pins the two
 * things that behaviour depended on: it never throws where the API is absent,
 * and it never fires at all once a member has asked for quiet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HAPTIC_MS, haptic, hapticsEnabled, hapticsSupported, setHapticsEnabled } from "./haptics";

const real = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function withNavigator(value: unknown) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

beforeEach(() => setHapticsEnabled(true));

afterEach(() => {
  if (real) Object.defineProperty(globalThis, "navigator", real);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

describe("the vocabulary", () => {
  it("names five intensities and keeps every single pulse short", () => {
    const names = Object.keys(HAPTIC_MS);
    expect(names).toEqual(["tick", "tap", "press", "confirm", "arrive"]);
    for (const value of Object.values(HAPTIC_MS)) {
      const pulses = Array.isArray(value) ? value.filter((_, i) => i % 2 === 0) : [value];
      for (const ms of pulses) expect(ms).toBeLessThanOrEqual(30);
    }
  });

  it("keeps MobileFab's two numbers, so its feel does not change", () => {
    expect(HAPTIC_MS.press).toBe(10);
    expect(HAPTIC_MS.tap).toBe(8);
  });

  it("rises in weight from tick to confirm", () => {
    expect(HAPTIC_MS.tick).toBeLessThan(HAPTIC_MS.tap as number);
    expect(HAPTIC_MS.tap).toBeLessThan(HAPTIC_MS.press as number);
    expect(HAPTIC_MS.press).toBeLessThan(HAPTIC_MS.confirm as number);
  });
});

describe("firing", () => {
  it("passes the named duration to the device", () => {
    const vibrate = vi.fn(() => true);
    withNavigator({ vibrate });
    expect(haptic("confirm")).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(18);
    expect(haptic("arrive")).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith([12, 40, 12]);
  });

  it("defaults to a tap", () => {
    const vibrate = vi.fn(() => true);
    withNavigator({ vibrate });
    haptic();
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it("says no on a device with no motor, and does not throw", () => {
    withNavigator({});
    expect(hapticsSupported()).toBe(false);
    expect(haptic("tap")).toBe(false);
  });

  it("swallows a device that throws", () => {
    withNavigator({
      vibrate: () => {
        throw new Error("blocked by permissions policy");
      },
    });
    expect(haptic("tick")).toBe(false);
  });

  it("stays silent once quiet is asked for", () => {
    const vibrate = vi.fn(() => true);
    withNavigator({ vibrate });
    setHapticsEnabled(false);
    expect(hapticsEnabled()).toBe(false);
    expect(haptic("confirm")).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    setHapticsEnabled(true);
    expect(haptic("confirm")).toBe(true);
  });
});

// SWEEP FINDING F9 (2026-09-21): a celebration that fires on page load asked
// for a vibrate before the member had touched the page, and the browser
// logged a refusal on /profile. The util now asks the engine first.
describe("before the member has touched the page", () => {
  it("stays silent, so the browser has nothing to refuse", () => {
    const vibrate = vi.fn(() => true);
    withNavigator({ vibrate, userActivation: { hasBeenActive: false, isActive: false } });
    expect(haptic("arrive")).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("fires once the page has had a gesture", () => {
    const vibrate = vi.fn(() => true);
    const userActivation = { hasBeenActive: false, isActive: false };
    withNavigator({ vibrate, userActivation });
    expect(haptic("press")).toBe(false);
    userActivation.hasBeenActive = true;
    expect(haptic("press")).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it("fires as it always did where the engine reports no activation at all", () => {
    const vibrate = vi.fn(() => true);
    withNavigator({ vibrate });
    expect(haptic("tap")).toBe(true);
  });

  it("does not throw where there is no navigator", () => {
    delete (globalThis as { navigator?: unknown }).navigator;
    expect(haptic("tap")).toBe(false);
  });
});
