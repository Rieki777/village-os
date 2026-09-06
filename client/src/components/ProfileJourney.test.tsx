// @vitest-environment jsdom
/**
 * Three reads that used to share a fate.
 *
 * `Promise.all` fails fast. The three journey reads were wired through one
 * with no `.catch`, so a single rejection abandoned the other two whatever
 * they had already answered, left every state null, and the component
 * returned null: stage history, recognition flows AND the ledger gone
 * because one of the three did not come back. The tests below are one per
 * failure shape, and each asserts BOTH halves of the fix: what still drew,
 * and that the page said what did not.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

vi.mock("@/hooks/useTokenNames", () => ({
  useTokenName: () => "Recognition",
  useTokenNameLower: () => "recognition",
  useValueTokenName: () => "village tokens",
}));

import { TOKEN_KEY } from "@/lib/gameApi";
import { announceProfileChange } from "@/lib/profileRefresh";
import ProfileJourney from "./ProfileJourney";

const progression = {
  capabilities: ["forum.post"],
  roles: [{ id: "orchard-crew", name: "Orchard Crew" }],
  firsts: { vote: null, objection: null, seat: null },
  history: [{ fromStage: "guest", toStage: "member", at: "2026-01-02", unlocked: [] }],
};
const flows = { totals: { received: 4, sent: 2, distinctAcknowledgers: 3 }, byCycle: [] };
const ledger = { currency: "recognition", entries: [] };

/** Route each of the four reads this component makes, by path. */
const routing = (answer: (path: string) => Promise<any>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => answer(String(path))),
  );

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const boom = { ok: false, status: 500, json: async () => ({}) };

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

describe("ProfileJourney", () => {
  it("draws all three when all three land", async () => {
    routing(async (p) =>
      p.includes("progression")
        ? ok(progression)
        : p.includes("flows")
          ? ok(flows)
          : p.includes("ledger")
            ? ok(ledger)
            : ok({ received: [] }),
    );
    render(<ProfileJourney />);

    expect(await screen.findByText("Your Progression")).toBeTruthy();
    expect(screen.getByText("Recognition Flows")).toBeTruthy();
    expect(screen.getByText("Where It Came From")).toBeTruthy();
    expect(screen.queryByText(/Could not load/)).toBeNull();
  });

  it("keeps the other two when one read answers 500, and names the one that did not", async () => {
    routing(async (p) =>
      p.includes("progression")
        ? boom
        : p.includes("flows")
          ? ok(flows)
          : p.includes("ledger")
            ? ok(ledger)
            : ok({ received: [] }),
    );
    render(<ProfileJourney />);

    expect(await screen.findByText("Recognition Flows")).toBeTruthy();
    expect(screen.getByText("Where It Came From")).toBeTruthy();
    expect(screen.queryByText("Your Progression")).toBeNull();
    expect((await screen.findByText(/Could not load/)).textContent).toContain("Your Progression");
  });

  it("survives a read that REJECTS, which is the fail-fast path", async () => {
    routing(async (p) => {
      if (p.includes("ledger")) throw new TypeError("network");
      if (p.includes("progression")) return ok(progression);
      if (p.includes("flows")) return ok(flows);
      return ok({ received: [] });
    });
    render(<ProfileJourney />);

    // Before the fix, this rejection took the other two down with it.
    expect(await screen.findByText("Your Progression")).toBeTruthy();
    expect(screen.getByText("Recognition Flows")).toBeTruthy();
    expect((await screen.findByText(/Could not load/)).textContent).toContain("Where It Came From");
  });

  it("says all three failed rather than rendering nothing at all", async () => {
    routing(async () => boom);
    const { container } = render(<ProfileJourney />);

    const banner = await screen.findByText(/Could not load/);
    expect(banner.textContent).toContain("Your Progression");
    expect(banner.textContent).toContain("Recognition Flows");
    expect(banner.textContent).toContain("Where It Came From");
    expect(container.textContent).not.toBe("");
  });

  it("renders nothing for a reader with no session, and no failure banner", async () => {
    store.clear();
    routing(async () => ok({}));
    const { container } = render(<ProfileJourney />);

    await waitFor(() => expect(container.textContent).not.toContain("Reading your journey"));
    expect(container.textContent).toBe("");
  });

  it("re-reads on Retry", async () => {
    let fail = true;
    routing(async (p) => {
      if (p.includes("progression")) return fail ? boom : ok(progression);
      if (p.includes("flows")) return ok(flows);
      if (p.includes("ledger")) return ok(ledger);
      return ok({ received: [] });
    });
    render(<ProfileJourney />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    fail = false;
    fireEvent.click(retry);

    expect(await screen.findByText("Your Progression")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
  });

  it("re-reads when a write elsewhere on the profile announces a change", async () => {
    let received = 4;
    routing(async (p) => {
      if (p.includes("progression")) return ok(progression);
      if (p.includes("flows")) return ok({ ...flows, totals: { ...flows.totals, received } });
      if (p.includes("ledger")) return ok(ledger);
      return ok({ received: [] });
    });
    render(<ProfileJourney />);
    expect(await screen.findByText("4")).toBeTruthy();

    received = 9;
    announceProfileChange();
    expect(await screen.findByText("9")).toBeTruthy();
  });
});
