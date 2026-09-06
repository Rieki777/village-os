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
 * WHY THE ASSERTION IS ABOUT A RENDERED LABEL. `useGameConfig()` reads like a
 * getter and is a hook, which is precisely how this survived review. Asserting
 * only "did not throw" would pass against a version that deleted the label to
 * make the crash go away. So the test also requires the value that hook exists
 * to supply to reach the screen: the village's own recognition-currency name,
 * on the field it labels. Both halves have to hold.
 *
 * THIS TEST WAS RED FIRST. Run against the inline call, it failed with
 * "Rendered more hooks than during the previous render" captured by the
 * boundary below.
 */
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
            acceptGratitude: 0,
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
  afterEach(() => {
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

  it("still labels the field with the village's own recognition currency", async () => {
    render(<Boundary><WorkWithUsTab password="secret" /></Boundary>);

    /*
     * The hook has to keep doing its job from its new home at the top of the
     * component. Deleting the call would also stop the crash, and would be a
     * regression: the label would read "recognition" in a village that calls
     * it something else.
     */
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`${CURRENCY} on accepted proposal`, "i"))).toBeTruthy(),
    );
  });
});
