// @vitest-environment jsdom
/**
 * The flower round the portrait, and the roster it opens.
 *
 * Where each petal sits is tested in shared/badgeFlower.test.ts. These hold
 * the drawing to it (one petal per badge up to each screen's cap, and a count
 * for the rest) and hold the roster's picker to the existing featured door.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import BadgeFlower, { DESKTOP_CAP, PHONE_CAP, type FlowerBadge } from "./BadgeFlower";
import BadgeRoster from "./BadgeRoster";

const many = (n: number): FlowerBadge[] =>
  Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `Badge ${i}`, kind: i % 3 ? "earned" : "granted", featured: i < 2 }));

afterEach(() => vi.unstubAllGlobals());

describe("BadgeFlower", () => {
  it("draws nothing for no badges", () => {
    const { container } = render(<BadgeFlower badges={[]} label="x" onOpen={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("draws one petal per badge on both screens, each naming its badge", () => {
    const { container } = render(<BadgeFlower badges={many(5)} label="Your badges" onOpen={() => {}} />);
    const [phone, wide] = container.querySelectorAll("svg");
    expect(phone.querySelectorAll("path")).toHaveLength(5);
    expect(wide.querySelectorAll("path")).toHaveLength(5);
    expect(wide.querySelector("title")?.textContent).toMatch(/^Badge \d$/);
    expect(container.textContent).not.toContain("+");
  });

  it("caps the phone at one ring and counts the rest", () => {
    const { container } = render(<BadgeFlower badges={many(100)} label="Your badges" onOpen={() => {}} />);
    const [phone, wide] = container.querySelectorAll("svg");
    expect(phone.querySelectorAll("path")).toHaveLength(PHONE_CAP);
    expect(wide.querySelectorAll("path")).toHaveLength(Math.min(100, DESKTOP_CAP));
    expect(container.textContent).toContain(`+${100 - PHONE_CAP}`);
  });

  it("colours a petal by its kind with a token", () => {
    const { container } = render(<BadgeFlower badges={many(3)} label="Your badges" onOpen={() => {}} />);
    for (const p of container.querySelectorAll("path")) expect(p.getAttribute("fill")).toMatch(/^var\(--color-dash-/);
  });

  it("opens the roster on a click", () => {
    const onOpen = vi.fn();
    render(<BadgeFlower badges={many(3)} label="Your badges, 3 held" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Your badges, 3 held" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("BadgeRoster", () => {
  const renderRoster = (props: Partial<Parameters<typeof BadgeRoster>[0]> = {}) =>
    render(
      <Router>
        <BadgeRoster open onOpenChange={() => {}} badges={many(4)} maxFeatured={3} whose={null} editable {...props} />
      </Router>,
    );

  it("lists every badge and says how many are picked", () => {
    renderRoster();
    for (let i = 0; i < 4; i++) expect(screen.getByText(`Badge ${i}`)).toBeTruthy();
    expect(screen.getAllByText("Pick up to 3 to show on your card. 2 of 3 picked.").length).toBeGreaterThan(0);
  });

  it("adds a pick through PUT /api/badges/featured with the whole list", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderRoster({ onChanged });
    const add = screen.getAllByRole("button", { name: "Show on card" })[0];
    fireEvent.click(add);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/badges/featured");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ badgeIds: ["b0", "b1", "b2"] });
  });

  it("takes a pick off", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    renderRoster();
    fireEvent.click(screen.getAllByRole("button", { name: "On your card" })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ badgeIds: ["b1"] });
  });

  it("stops new picks at the cap", () => {
    renderRoster({ maxFeatured: 2 });
    for (const b of screen.getAllByRole("button", { name: "Show on card" })) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("is read-only on somebody else's roster", () => {
    renderRoster({ editable: false, whose: "Wren" });
    expect(screen.getByText("Wren's badges")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show on card" })).toBeNull();
  });
});
