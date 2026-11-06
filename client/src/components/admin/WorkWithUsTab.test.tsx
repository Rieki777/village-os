// @vitest-environment jsdom
/**
 * The Work With Us tab has to survive its own config arriving.
 *
 * WHAT THE FOUNDER REPORTED. Opening Admin, Site Content, "Work With Us"
 * showed the unexpected-error screen every time, carrying "Minified React
 * error #310".
 *
 * WHAT WAS ACTUALLY HAPPENING. `WorkWithUsTab` returns early while its config
 * is still loading (`if (!cfg) return <Loading/>`), and BELOW that early
 * return, inside the JSX, it called the hook `useGameConfig()` inline to label
 * one field. So the first render stopped before the hook and the second render
 * reached it: the hook count changed between renders and React threw
 * "Rendered more hooks than during the previous render". The fetch always
 * resolves after the first paint, so the tab crashed every single time, for
 * every village.
 *
 * The unminified message was read off a running dev server before this test
 * was written, so the diagnosis is not inferred from the error number alone.
 *
 * The field that hook labelled set the Gratitude an accepted proposal minted.
 * It is gone (Rye, 2026-10-23: Gratitude is only sent member to member), and
 * the hook with it, so the second case now asserts what replaced it: where an
 * accepted proposal's pay is set, and no Gratitude field.
 *
 * THIS TEST WAS RED FIRST. Run against the inline call, it failed with
 * "Rendered more hooks than during the previous render" captured by the
 * boundary below.
 */
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import WorkWithUsTab from "@/components/admin/WorkWithUsTab";

const CURRENCY = "FIXTURE-RECOGNITION";

/**
 * A boundary, because the failure is a throw during a state update rather
 * than a rejected promise: without one, React unmounts the tree and the test
 * sees an empty screen with no explanation of why.
 */
class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <p data-testid="boundary">{this.state.error.message}</p>;
    return this.props.children as any;
  }
}

const stubFetch = () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any) => {
      const path = String(url);
      if (path.includes("/game/config")) {
        return { ok: true, status: 200, json: async () => ({ currency: { name: CURRENCY } }) };
      }
      if (path.includes("/admin/work-with-us-config")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            intro: "",
            assistantName: "",
            assistantGreeting: "",
            reciprocityOptions: [],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
};

describe("the Work With Us tab opens", () => {
  beforeEach(stubFetch);
  // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders its form once the config loads, instead of crashing the panel", async () => {
    render(<Boundary><WorkWithUsTab password="secret" /></Boundary>);

    // The transition that used to crash: loading render, then loaded render.
    await waitFor(() => expect(screen.queryByText(/Loading/i)).toBeNull());

    const boundary = screen.queryByTestId("boundary");
    expect(boundary?.textContent ?? "no crash", "the panel crashed on the render after its config arrived").toBe("no crash");
    // getAllBy, because the phrase labels a group and also appears on the
    // control inside it. Either one proves the form rendered; requiring
    // exactly one would be a test of the markup, not of the crash.
    expect(screen.getAllByText(/Reciprocity \(exchange\) options/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Guide's opening greeting/i)).toBeTruthy();
  });

  it("says where an accepted proposal's pay is set, and offers no Gratitude for it", async () => {
    render(<Boundary><WorkWithUsTab password="secret" /></Boundary>);
    await waitFor(() => expect(screen.getByText(/What an accepted proposal pays/i)).toBeTruthy());
    expect(screen.getByText(/set on the Mint panel/i)).toBeTruthy();
    expect(screen.queryByText(new RegExp(`${CURRENCY} on accepted proposal`, "i"))).toBeNull();
  });
});
