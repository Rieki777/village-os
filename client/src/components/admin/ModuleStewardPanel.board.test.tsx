// @vitest-environment jsdom
/**
 * SABERRA'S BOARD IS ON ITS OWN PAGE. A steward on /modules/saberra sees the
 * whole board open, not only behind Settings, and never twice; another
 * module's page shows no board.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./SaberraConfigPanel", () => ({ default: () => <p>saberra board</p> }));

import ModuleStewardPanel from "./ModuleStewardPanel";
import type { LibraryViewer } from "@shared/moduleSwitch";

const steward: LibraryViewer = { mode: "steward", launched: false, canSwitch: true, canPause: true };
const row = (id: string) => ({
  id, name: id, description: "", core: false, lifecycle: "preview", served: "preview", tier: "included",
  dataClass: "none", group: "coordinate", setup: "none", ready: { ready: true }, requires: [], recommends: [],
  capabilities: [], maxLifecycle: "public", examplesAvailable: false, showingExamples: false, config: {}, health: [],
});
const panel = (id: string) => {
  const m = row(id);
  return render(<ModuleStewardPanel m={m} all={[m]} extra={{ orphans: [], hypha: null }} viewer={steward} onChanged={() => {}} />);
};

beforeEach(() => {
  window.history.replaceState({}, "", "/modules/x");
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 404, ok: false, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the module board on the module's page", () => {
  it("shows Saberra's board open, once", async () => {
    panel("saberra");
    expect(await screen.findByText("saberra board")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect((await screen.findAllByText("saberra board")).length).toBe(1);
  });

  it("shows no board for another module", () => {
    panel("events");
    expect(screen.queryByTestId("module-board")).toBeNull();
  });
});
