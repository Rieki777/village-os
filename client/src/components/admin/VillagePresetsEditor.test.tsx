// @vitest-environment jsdom
/**
 * The village presets panel, when its first read fails.
 *
 * WHY THIS EXISTS. The panel reads on mount, so it joins every test that
 * renders the Org Chart tab. Its read was a bare `fetch` with no catch, and CI
 * on #452 ran 786 files green and still exited 1 on one unhandled rejection
 * from this read, fired after a sibling test had unstubbed `fetch`. Two things
 * follow, and each case below pins one:
 *
 *   1. A READ THAT THROWS IS CAUGHT. No rejection escapes the component.
 *   2. AN UNREAD LIST IS NOT AN EMPTY ONE. A failed read says so, and never
 *      draws "No village presets yet.", which would tell a founder the village
 *      has none when nobody looked.
 *
 * And the known positive: a read that answers draws the presets.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import VillagePresetsEditor, { PRESET_EDITOR_WORDS } from "./VillagePresetsEditor";

afterEach(() => vi.unstubAllGlobals());

describe("the village presets panel", () => {
  it("catches a read that throws and says the list was not read", async () => {
    const rejected: unknown[] = [];
    const onRejection = (e: PromiseRejectionEvent | unknown) => rejected.push(e);
    process.on("unhandledRejection", onRejection);
    try {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to parse URL from /api/admin/seat-presets"); }));
      render(<VillagePresetsEditor password="secret" />);
      expect(await screen.findByText(PRESET_EDITOR_WORDS.unread)).toBeTruthy();
      expect(screen.queryByText(PRESET_EDITOR_WORDS.none)).toBeNull();
      await new Promise((r) => setTimeout(r, 0));
      expect(rejected).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("says the list was not read when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    render(<VillagePresetsEditor password="secret" />);
    expect(await screen.findByText(PRESET_EDITOR_WORDS.unread)).toBeTruthy();
    expect(screen.queryByText(PRESET_EDITOR_WORDS.none)).toBeNull();
  });

  it("says there are none only when a read answered with none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ presets: [] }) })));
    render(<VillagePresetsEditor password="secret" />);
    expect(await screen.findByText(PRESET_EDITOR_WORDS.none)).toBeTruthy();
    expect(screen.queryByText(PRESET_EDITOR_WORDS.unread)).toBeNull();
  });
});
