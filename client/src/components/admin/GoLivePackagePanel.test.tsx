// @vitest-environment jsdom
/**
 * THE PANEL, RENDERED, because "the page and the download cannot drift apart"
 * is a claim about a screen and the only honest way to check a screen is to
 * draw it.
 *
 * `goLivePlan.test.ts` proves the markdown carries the whole plan. This file
 * proves the other half: that the screen carries the same plan, and that the
 * button hands over exactly what `renderGoLivePackage` produced rather than a
 * second copy assembled somewhere in the component.
 *
 * The download itself is stubbed at `URL.createObjectURL`, which jsdom does not
 * implement, and the Blob it was handed is read back and compared. An anchor
 * click is stubbed too: jsdom cannot navigate to a blob: URL and would log a
 * "not implemented" error that reads like a test failure.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import GoLivePackagePanel from "./GoLivePackagePanel";
import {
  GO_LIVE_ENV,
  GO_LIVE_PREREQS,
  GO_LIVE_STEPS,
  needWord,
  renderGoLivePackage,
} from "./goLivePlan";

/** Every Blob handed to URL.createObjectURL during one test. */
let captured: Blob[] = [];

beforeEach(() => {
  captured = [];
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn((b: Blob) => {
      captured.push(b);
      return "blob:stub";
    }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Go live panel", () => {
  it("brings the person to the connector after the download, and not before", async () => {
    render(<GoLivePackagePanel />);
    expect(screen.queryByTestId("connector-setup")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Download the go-live package/ }));
    expect(screen.getByTestId("connector-setup")).toBeTruthy();
    expect(screen.getByTestId("connector-url").textContent).toMatch(/\/api\/agent\/v1\/mcp$/);
  });

  it("draws every step the plan holds, in order", () => {
    render(<GoLivePackagePanel />);
    for (const s of GO_LIVE_STEPS) {
      expect(screen.getByText(new RegExp("^" + s.n + "\\. " + escape(s.title)))).toBeTruthy();
    }
  });

  it("draws every prerequisite with what it costs", () => {
    render(<GoLivePackagePanel />);
    for (const p of GO_LIVE_PREREQS) {
      const heading = screen.getByText(p.name);
      const row = heading.closest("li");
      expect(row, `no row for ${p.id}`).toBeTruthy();
      expect(within(row as HTMLElement).getByText(/Cost:/)).toBeTruthy();
      expect((row as HTMLElement).textContent).toContain(p.cost);
      expect((row as HTMLElement).textContent).toContain(needWord(p.need));
      if (p.when) expect((row as HTMLElement).textContent).toContain(p.when);
    }
  });

  it("says which prerequisites are unverified, in the founder's own view", () => {
    render(<GoLivePackagePanel />);
    for (const p of GO_LIVE_PREREQS.filter((e) => e.certainty === "unverified")) {
      const row = screen.getByText(p.name).closest("li") as HTMLElement;
      expect(row.textContent).toContain("Unverified.");
    }
  });

  it("draws every variable and what breaks without it", () => {
    render(<GoLivePackagePanel />);
    for (const v of GO_LIVE_ENV) {
      expect(screen.getByText(v.name), `no row for ${v.name}`).toBeTruthy();
    }
  });

  it("hands over exactly what the renderer produced", async () => {
    render(<GoLivePackagePanel villageName="Rio Nuevo" />);
    await userEvent.click(screen.getByRole("button", { name: /download the go-live package/i }));

    expect(captured).toHaveLength(1);
    const text = await captured[0]!.text();
    const today = new Date().toISOString().slice(0, 10);
    expect(text).toBe(renderGoLivePackage({ villageName: "Rio Nuevo", generatedOn: today }));
    expect(captured[0]!.type).toContain("text/markdown");
  });

  it("names the download after the village", async () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    render(<GoLivePackagePanel villageName="Rio Nuevo" />);
    await userEvent.click(screen.getByRole("button", { name: /download the go-live package/i }));
    expect(clicked).toEqual(["go-live-rio-nuevo.md"]);
    expect(screen.getByText(/Saved as go-live-rio-nuevo\.md/)).toBeTruthy();
  });

  it("still works with no village name", async () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    render(<GoLivePackagePanel />);
    await userEvent.click(screen.getByRole("button", { name: /download the go-live package/i }));
    expect(clicked).toEqual(["go-live.md"]);
  });
});

/** Escape a title for use inside a RegExp. */
function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
