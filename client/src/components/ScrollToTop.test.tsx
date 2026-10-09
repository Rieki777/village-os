// @vitest-environment jsdom
/**
 * THE DEFECT THIS PINS: every Living Map deep link threw on arrival.
 *
 * ScrollToTop used to hand the whole URL hash to `document.querySelector` so
 * that `/#choose-path` from another page lands on its section. The map's hash
 * is an ADDRESS, not an anchor: `#/place/greenhouse`, `#/circles`, `#/loom`,
 * `#hud=pocket`. None of those is a valid CSS selector, so the lookup threw a
 * SyntaxError inside a timer, which nothing catches. A browser run against the
 * #401 tree logged one "is not a valid selector" page error on every one of
 * five deep links at both desktop and phone width, ten in all, and the
 * fallback scroll to the top after the lookup never ran.
 *
 * The promise is two-sided, so both sides are asserted here: a hash that
 * names no element never throws and lands at the top, and a hash that names
 * an element still scrolls to it, including the ids `querySelector` could
 * never reach (a leading digit, a percent-encoded character).
 *
 * The timer is driven with fake timers because the lookup runs 100ms after
 * the page renders. A throw inside the callback surfaces from
 * `advanceTimersByTime`, which is exactly where a visitor's console caught it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import ScrollToTop from "./ScrollToTop";

let scrollTo: ReturnType<typeof vi.spyOn>;
let scrollIntoView: ReturnType<typeof vi.fn>;
const planted: HTMLElement[] = [];

/** Put an element in the document the way a rendered page would hold it. */
function plant(id: string): HTMLElement {
  const el = document.createElement("section");
  el.id = id;
  document.body.appendChild(el);
  planted.push(el);
  return el;
}

/** Arrive at `url`, let the anchor timer fire, and report whether it threw. */
function arriveAt(url: string): () => void {
  window.history.replaceState(null, "", url);
  render(<ScrollToTop />);
  return () => vi.advanceTimersByTime(250);
}

beforeEach(() => {
  vi.useFakeTimers();
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  // jsdom has no layout, so it ships no scrollIntoView at all.
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
});

afterEach(() => {
  vi.useRealTimers();
  scrollTo.mockRestore();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
  for (const el of planted.splice(0)) el.remove();
  window.history.replaceState(null, "", "/");
});

const toTop = { top: 0, behavior: "instant" };

describe("ScrollToTop on a route-shaped hash", () => {
  it.each([
    "/map#/place/greenhouse",
    "/map#/circles",
    "/map#/loom",
    "/map#hud=pocket",
    "/map#/place/greenhouse&skipIntro",
  ])("%s does not throw and leaves the document at the top", (url) => {
    const fire = arriveAt(url);
    expect(fire).not.toThrow();
    expect(scrollTo).toHaveBeenCalledWith(toTop);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not throw on a page other than the map either", () => {
    const fire = arriveAt("/circles#/loom");
    expect(fire).not.toThrow();
    expect(scrollTo).toHaveBeenCalledWith(toTop);
  });

  it("does not throw on a malformed percent escape", () => {
    const fire = arriveAt("/#%E0%A4%A");
    expect(fire).not.toThrow();
    expect(scrollTo).toHaveBeenCalledWith(toTop);
  });

  it("never reads the map's hash as an anchor, even when the page holds that id", () => {
    // The map is a fixed, full-screen surface, and scrollIntoView scrolls
    // ancestors that cannot scroll by hand, so an accidental match would slide
    // the land sideways. The hash on /map is the map's address and nothing else.
    plant("loom");
    const fire = arriveAt("/map#loom");
    expect(fire).not.toThrow();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith(toTop);
  });
});

describe("ScrollToTop on a plain element anchor", () => {
  it("/#choose-path still scrolls to its section, smoothly", () => {
    const section = plant("choose-path");
    const fire = arriveAt("/#choose-path");
    expect(fire).not.toThrow();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(section);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("reaches an id that is not a valid selector", () => {
    const section = plant("2026-plan");
    const fire = arriveAt("/#2026-plan");
    expect(fire).not.toThrow();
    expect(scrollIntoView.mock.contexts[0]).toBe(section);
  });

  it("reaches a percent-encoded id", () => {
    const section = plant("jardín");
    const fire = arriveAt("/#jard%C3%ADn");
    expect(fire).not.toThrow();
    expect(scrollIntoView.mock.contexts[0]).toBe(section);
  });

  it("with no hash at all, goes straight to the top", () => {
    window.history.replaceState(null, "", "/quests");
    render(<ScrollToTop />);
    expect(scrollTo).toHaveBeenCalledWith(toTop);
  });
});
