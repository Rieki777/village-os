// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { revealCard } from "./revealCard";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("reveal a connection card", () => {
  it("waits until the card is in the page, then highlights it and focuses the heading", () => {
    vi.useFakeTimers();
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    revealCard("sera");
    vi.advanceTimersByTime(100);
    expect(document.querySelector("[data-lit]")).toBeNull();

    const card = document.createElement("div");
    card.id = "integration-sera";
    const heading = document.createElement("p");
    heading.textContent = "Sera";
    card.append(heading);
    document.body.append(card);
    heading.focus = vi.fn();

    vi.advanceTimersByTime(100);
    expect(card.getAttribute("data-lit")).toBe("1");
    expect(scrollTo).toHaveBeenCalled();
    vi.advanceTimersByTime(900);
    expect(heading.focus).toHaveBeenCalled();
  });
});