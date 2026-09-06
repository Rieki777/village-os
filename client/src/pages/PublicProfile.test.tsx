// @vitest-environment jsdom
/**
 * Somebody else's sheet, and the section that carried nothing.
 *
 * "Paths they walk" is a heading over a row of portraits, and every one of
 * those portraits shipped `alt=""`. No text on the page named a single path,
 * so which paths a member walks, the whole point of the section, reached
 * exactly the readers who could see the pictures. To a screen reader it was
 * a heading followed by an empty list.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useTokenNames", () => ({
  useTokenName: () => "Recognition",
  useTokenNameLower: () => "recognition",
  useValueTokenName: () => "village tokens",
}));

import PublicProfile from "./PublicProfile";

const archetypes = [
  { key: "steward", name: "The Steward", subtitle: "Keeper of what is held in common" },
  { key: "weaver", name: "The Weaver", subtitle: "Maker of connection" },
];

const sheet = {
  handle: "rowan",
  name: "Rowan Fell",
  title: null,
  moonsOnTheLand: 3,
  party: [
    { id: "c1", archetypeKey: "steward", avatar: "/images/a.webp", isPrimary: true },
    { id: "c2", archetypeKey: "weaver", avatar: "/images/b.webp", isPrimary: false },
  ],
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const routing = (answer: (path: string) => Promise<any>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => answer(String(path))),
  );

const store = new Map<string, string>();
const stubStorage = () =>
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => store.clear(),
  });

const draw = () => {
  window.history.pushState({}, "", "/profile/rowan");
  return render(
    <Router>
      <PublicProfile />
    </Router>,
  );
};

beforeEach(() => {
  store.clear();
  stubStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PublicProfile: Paths they walk", () => {
  it("names every path in text and in the portrait's alt", async () => {
    routing(async (p) => (p.includes("/api/archetypes") ? ok(archetypes) : ok(sheet)));
    const { container } = draw();

    const heading = await screen.findByText("Paths they walk");
    const section = heading.closest("section") as HTMLElement;

    // The list is no longer a heading followed by nothing.
    expect(within(section).getByText("The Steward")).toBeTruthy();
    expect(within(section).getByText("The Weaver")).toBeTruthy();

    const alts = Array.from(container.querySelectorAll("section img")).map((i) =>
      i.getAttribute("alt"),
    );
    expect(alts).toEqual(["The Steward", "The Weaver"]);
    expect(alts).not.toContain("");

    // ONCE, not twice. The alt is the accessible carrier and the caption is
    // the visual one, so the caption is hidden from the reader: two carriers
    // of one fact would announce "The Steward The Steward" per portrait.
    for (const caption of Array.from(section.querySelectorAll("li > p"))) {
      expect(caption.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("names the hero portrait too", async () => {
    routing(async (p) => (p.includes("/api/archetypes") ? ok(archetypes) : ok(sheet)));
    const { container } = draw();

    await screen.findByText("Rowan Fell");
    const hero = container.querySelector("header img");
    expect(hero?.getAttribute("alt")).toBe("The Steward");
  });

  it("falls back to the key rather than to nothing when the class list is unavailable", async () => {
    routing(async (p) =>
      p.includes("/api/archetypes")
        ? { ok: false, status: 500, json: async () => ({}) }
        : ok(sheet),
    );
    const { container } = draw();

    await screen.findByText("Paths they walk");
    const alts = Array.from(container.querySelectorAll("section img")).map((i) =>
      i.getAttribute("alt"),
    );
    // Poor labels, and still infinitely better than the empty string that
    // shipped: a reader learns there are two different paths here.
    expect(alts).toEqual(["steward", "weaver"]);
  });
});

describe("PublicProfile: the page says which state it is in", () => {
  it("keeps the SAME polite region node when the sheet arrives", async () => {
    // The announcement only fires if the region survives the state change. A
    // region unmounted and replaced by an identical one holding new text is
    // silent, which is the failure mode this asserts against by identity.
    let land: (v: any) => void = () => {};
    const pending = new Promise<any>((res) => {
      land = res;
    });
    routing(async (p) => (p.includes("/api/archetypes") ? ok(archetypes) : pending));
    const { container } = draw();

    const before = container.querySelector("[aria-live='polite']");
    expect(before?.textContent).toContain("Looking");

    land(ok(sheet));
    await waitFor(() =>
      expect(container.querySelector("[aria-live='polite']")?.textContent).toContain("Rowan Fell"),
    );
    expect(container.querySelector("[aria-live='polite']")).toBe(before);
  });

  it("says nobody is there when the lookup comes back empty", async () => {
    routing(async (p) => (p.includes("/api/archetypes") ? ok(archetypes) : ok(null)));
    const { container } = draw();

    await screen.findByText("Nobody here by that name");
    expect(container.querySelector("[aria-live='polite']")?.textContent).toContain(
      "Nobody here by that name",
    );
  });
});
