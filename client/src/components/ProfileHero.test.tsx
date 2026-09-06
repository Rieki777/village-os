// @vitest-environment jsdom
/**
 * The top of your own sheet, and the sentence it must never say by accident.
 *
 * `party` started as `[]` and the sentence under the name read off its
 * length, so a member with six characters was told "No path chosen yet.
 * Choose who you will be" for the whole of the loading window, and forever
 * after a failed read. An empty state is a CLAIM ABOUT THE MEMBER, and this
 * one is close to insulting when it is wrong, so the tests below hold it to
 * being made only when the server actually said so.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

import { TOKEN_KEY } from "@/lib/gameApi";
import { PROFILE_REFRESH_EVENT } from "@/lib/profileRefresh";
import ProfileHero from "./ProfileHero";

const archetypes = [
  { key: "steward", name: "The Steward", subtitle: "Keeper of what is held in common" },
  { key: "weaver", name: "The Weaver", subtitle: "Maker of connection" },
];
const party = [
  { id: "c1", archetypeKey: "steward", avatar: "/images/a.webp", isPrimary: true },
  { id: "c2", archetypeKey: "weaver", avatar: "/images/b.webp", isPrimary: false },
];

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const boom = { ok: false, status: 500, json: async () => ({}) };

const routing = (answer: (path: string, init?: RequestInit) => Promise<any>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => answer(String(path), init)),
  );

const store = new Map<string, string>();
const stubStorage = () =>
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  });

const draw = () =>
  render(
    <Router>
      <ProfileHero name="Rowan Fell" handle="rowan" />
    </Router>,
  );

beforeEach(() => {
  store.clear();
  store.set(TOKEN_KEY, "a-session");
  stubStorage();
});

afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
});

describe("ProfileHero", () => {
  it("names the fronted character once the read lands", async () => {
    routing(async (p) =>
      p.includes("archetypes") ? ok(archetypes) : ok({ party, title: null, moonsOnTheLand: 3 }),
    );
    draw();

    expect(await screen.findByText(/The Steward/)).toBeTruthy();
    expect(screen.queryByText(/No path chosen yet/)).toBeNull();
  });

  it("does not say a member has no path while the read is still out", () => {
    routing((p) => (p.includes("archetypes") ? Promise.resolve(ok(archetypes)) : new Promise(() => {})));
    const { container } = draw();

    expect(container.textContent).not.toContain("No path chosen yet");
    expect(container.textContent).toContain("Reading your paths");
  });

  it("says the read failed instead of claiming an empty party", async () => {
    routing(async (p) => (p.includes("archetypes") ? ok(archetypes) : boom));
    const { container } = draw();

    await waitFor(() => expect(container.textContent).toContain("Couldn't load your paths"));
    expect(container.textContent).not.toContain("No path chosen yet");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("still says 'No path chosen yet' when the server really answered with none", async () => {
    routing(async (p) =>
      p.includes("archetypes") ? ok(archetypes) : ok({ party: [], title: null, moonsOnTheLand: 0 }),
    );
    draw();

    expect(await screen.findByText(/No path chosen yet/)).toBeTruthy();
  });

  it("re-reads on Retry", async () => {
    let fail = true;
    routing(async (p) => {
      if (p.includes("archetypes")) return ok(archetypes);
      return fail ? boom : ok({ party, title: null, moonsOnTheLand: 3 });
    });
    draw();

    const retry = await screen.findByRole("button", { name: "Retry" });
    fail = false;
    fireEvent.click(retry);

    expect(await screen.findByText(/The Steward/)).toBeTruthy();
  });

  it("announces a fronting, and tells the rest of the page to re-read", async () => {
    const heard = vi.fn();
    window.addEventListener(PROFILE_REFRESH_EVENT, heard);
    routing(async (p, init) => {
      if (p.includes("archetypes")) return ok(archetypes);
      if (init?.method === "POST") {
        return ok({
          party: [
            { ...party[0], isPrimary: false },
            { ...party[1], isPrimary: true },
          ],
        });
      }
      return ok({ party, title: null, moonsOnTheLand: 3 });
    });
    const { container } = draw();

    fireEvent.click(await screen.findByRole("button", { name: "Front The Weaver" }));

    await waitFor(() =>
      expect(container.querySelector("[aria-live='polite']")?.textContent).toContain(
        "The Weaver now fronts your sheet",
      ),
    );
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(PROFILE_REFRESH_EVENT, heard);
  });

  it("says so when a fronting is refused, instead of changing nothing in silence", async () => {
    routing(async (p, init) => {
      if (p.includes("archetypes")) return ok(archetypes);
      if (init?.method === "POST") return boom;
      return ok({ party, title: null, moonsOnTheLand: 3 });
    });
    const { container } = draw();

    fireEvent.click(await screen.findByRole("button", { name: "Front The Weaver" }));

    await waitFor(() =>
      expect(container.querySelector("[aria-live='polite']")?.textContent).toContain(
        "could not be fronted",
      ),
    );
  });
});
