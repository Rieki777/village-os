// @vitest-environment jsdom
/**
 * THE NATURE KIT, RENDERED: each piece's props, its still drawing under
 * reduced motion, and the motion rule (fireflies rest after twenty seconds,
 * a circle that closes draws once, the bloom only when the seed is whole).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { moonPhase } from "@shared/lunar";
import Fireflies from "./Fireflies";
import SeedOfLife from "./SeedOfLife";
import FernUnfurl from "./FernUnfurl";
import Vesica from "./Vesica";
import MoonPhase, { moonFor } from "./MoonPhase";
import RootStrip from "./RootStrip";
import { REST_AFTER_MS } from "./useRest";

function motion(reduce: boolean, wide = false) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: (reduce && q.includes("reduce")) || (wide && q.includes("min-width: 1024px")),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Fireflies", () => {
  it("wraps the act with five to eight lights, hidden from a screen reader", () => {
    motion(false);
    render(
      <Fireflies count={12}>
        <button type="button">Next</button>
      </Fireflies>,
    );
    const layer = screen.getByTestId("fireflies");
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.querySelectorAll(".nk-ff")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    expect(layer.closest(".nk")?.getAttribute("data-motion")).toBe("live");
  });

  it("is a still drawing under reduced motion and never rests", () => {
    motion(true);
    vi.useFakeTimers();
    render(<Fireflies count={3} />);
    const host = screen.getByTestId("fireflies").closest(".nk")!;
    expect(host.getAttribute("data-motion")).toBe("still");
    expect(screen.getByTestId("fireflies").querySelectorAll(".nk-ff")).toHaveLength(5);
    act(() => void vi.advanceTimersByTime(REST_AFTER_MS + 1000));
    expect(host.getAttribute("data-rest")).toBe("false");
  });

  it("rests after about twenty seconds without input and wakes on the next", () => {
    motion(false);
    vi.useFakeTimers();
    render(
      <Fireflies>
        <button type="button">Next</button>
      </Fireflies>,
    );
    const host = screen.getByTestId("fireflies").closest(".nk")!;
    act(() => void vi.advanceTimersByTime(REST_AFTER_MS - 1000));
    expect(host.getAttribute("data-rest")).toBe("false");
    act(() => void vi.advanceTimersByTime(1500));
    expect(REST_AFTER_MS).toBe(20_000);
    expect(host.getAttribute("data-rest")).toBe("true");
    act(() => void fireEvent.keyDown(window, { key: "Tab" }));
    expect(host.getAttribute("data-rest")).toBe("false");
  });
});

describe("SeedOfLife", () => {
  it("closes walked circles, marks the current one and leaves the rest open", () => {
    motion(false);
    render(<SeedOfLife total={7} walked={3} label="Step 4 of 7" labels={["One", "Two", "Three", "Four"]} />);
    const img = screen.getByRole("img", { name: "Step 4 of 7" });
    const states = Array.from(img.querySelectorAll("circle[data-state]")).map((c) => c.getAttribute("data-state"));
    expect(states).toEqual(["closed", "closed", "closed", "current", "open", "open", "open"]);
    expect(img.querySelectorAll("title")[3].textContent).toBe("Four");
    // Already walked on arrival: nothing redraws.
    expect(img.querySelectorAll(".nk-draw")).toHaveLength(0);
  });

  it("draws a circle once when it closes", () => {
    motion(false);
    const { rerender, container } = render(<SeedOfLife total={7} walked={2} label="path" />);
    rerender(<SeedOfLife total={7} walked={3} label="path" />);
    const drawn = container.querySelectorAll("circle.nk-draw");
    expect(drawn).toHaveLength(1);
    expect(drawn[0].getAttribute("data-state")).toBe("closed");
  });

  it("continues into the Flower of Life past seven", () => {
    motion(false);
    const { container } = render(<SeedOfLife total={12} walked={9} label="path" />);
    expect(container.querySelector("[data-shape]")!.getAttribute("data-shape")).toBe("flower");
    expect(container.querySelectorAll("circle[data-state]")).toHaveLength(12);
  });

  it("blooms only when every circle is closed", () => {
    motion(false);
    const { rerender } = render(<SeedOfLife total={7} walked={6} bloom label="path" />);
    expect(screen.queryByTestId("seed-bloom")).toBeNull();
    rerender(<SeedOfLife total={7} walked={7} bloom label="path" />);
    const bloom = screen.getByTestId("seed-bloom");
    expect(bloom.querySelectorAll("path")).toHaveLength(6);
    // The last petal starts by 0.4s and runs 1.1s: inside the 1.6s a bloom may take.
    const last = (bloom.querySelectorAll("path")[5] as SVGElement).style.getPropertyValue("--nk-delay");
    expect(parseFloat(last) + 1.1).toBeLessThanOrEqual(1.6);
  });

  it("is still under reduced motion, bloom and all", () => {
    motion(true);
    const { container } = render(<SeedOfLife total={7} walked={7} bloom drawFrom={6} label="path" />);
    expect(container.querySelector(".nk")!.getAttribute("data-motion")).toBe("still");
    expect(screen.getByTestId("seed-bloom")).toBeTruthy();
  });

  it("puts fireflies on the current circle when asked", () => {
    motion(false);
    render(<SeedOfLife total={7} walked={2} glowCurrent label="path" />);
    expect(screen.getByTestId("fireflies")).toBeTruthy();
  });
});

describe("FernUnfurl", () => {
  it("draws stem first and grows richer on a wide screen", () => {
    motion(false, true);
    const { container } = render(<FernUnfurl label="A fern" />);
    expect(container.querySelector("[data-iterations]")!.getAttribute("data-iterations")).toBe("4");
    const paths = Array.from(container.querySelectorAll("path[data-depth]"));
    expect(paths[0].getAttribute("data-depth")).toBe("0");
    expect(screen.getByRole("img", { name: "A fern" })).toBeTruthy();
  });

  it("keeps the lighter frond on a phone and is decoration without a label", () => {
    motion(false, false);
    const { container } = render(<FernUnfurl />);
    expect(container.querySelector("[data-iterations]")!.getAttribute("data-iterations")).toBe("3");
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("is still under reduced motion", () => {
    motion(true);
    const { container } = render(<FernUnfurl detail={2} />);
    expect(container.querySelector(".nk")!.getAttribute("data-motion")).toBe("still");
    expect(container.querySelector("[data-iterations]")!.getAttribute("data-iterations")).toBe("2");
  });
});

describe("Vesica", () => {
  it("fills the lens only once the two have met", () => {
    motion(false);
    const { rerender } = render(<Vesica met={false} label="Threshold" names={["You", "Us"]} />);
    expect(screen.getByTestId("vesica-lens").getAttribute("opacity")).toBe("0");
    rerender(<Vesica met label="Threshold" names={["You", "Us"]} />);
    expect(screen.getByTestId("vesica-lens").getAttribute("opacity")).toBe("1");
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Threshold" })).toBeTruthy();
  });

  it("is still under reduced motion", () => {
    motion(true);
    const { container } = render(<Vesica met label="Threshold" />);
    expect(container.querySelector(".nk")!.getAttribute("data-motion")).toBe("still");
  });
});

describe("MoonPhase", () => {
  it("draws the real phase for a date, with no network", () => {
    // A known full moon: 2026-03-03, 11:38 UTC.
    const full = new Date(Date.UTC(2026, 2, 3, 11, 38));
    const { phase, reading } = moonFor(full);
    expect(phase).toBeCloseTo(moonPhase(full), 12);
    expect(reading.fraction).toBeGreaterThan(0.99);
    // A known new moon: 2026-02-17, 12:01 UTC.
    expect(moonFor(new Date(Date.UTC(2026, 1, 17, 12, 1))).reading.fraction).toBeLessThan(0.01);
  });

  it("lights the right limb waxing and the left waning", () => {
    const waxing = new Date(Date.UTC(2026, 1, 24));
    const waning = new Date(Date.UTC(2026, 2, 10));
    const a = render(<MoonPhase date={waxing} />);
    expect(a.container.querySelector("[data-side]")!.getAttribute("data-side")).toBe("right");
    cleanup();
    const b = render(<MoonPhase date={waning} showName />);
    expect(b.container.querySelector("[data-side]")!.getAttribute("data-side")).toBe("left");
    expect(b.container.textContent).toMatch(/Waning|Last|Third/i);
  });

  it("draws no lit path at a new moon and names itself", () => {
    render(<MoonPhase date={new Date(Date.UTC(2026, 1, 17, 12, 1))} label="Tonight's moon" />);
    expect(screen.getByRole("img", { name: "Tonight's moon" })).toBeTruthy();
    expect(screen.queryByTestId("moon-lit")).toBeNull();
  });
});

describe("RootStrip", () => {
  it("is a shell with a seed slot and a text slot", () => {
    motion(false);
    render(
      <RootStrip seed={<span data-testid="seed-slot" />} detail="By 16 November">
        The circle reads your proposal.
      </RootStrip>,
    );
    expect(screen.getByTestId("seed-slot")).toBeTruthy();
    expect(screen.getByText("The circle reads your proposal.")).toBeTruthy();
    expect(screen.getByText("By 16 November").className).toContain("lg:block");
    expect(screen.getByTestId("root-strip").tagName).toBe("DIV");
  });

  it("becomes one button when it opens the path", () => {
    motion(true);
    const onOpen = vi.fn();
    render(
      <RootStrip onOpen={onOpen} openLabel="Your path. Open the whole path.">
        Next step
      </RootStrip>,
    );
    const btn = screen.getByRole("button", { name: "Your path. Open the whole path." });
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(btn.getAttribute("data-motion")).toBe("still");
  });
});
