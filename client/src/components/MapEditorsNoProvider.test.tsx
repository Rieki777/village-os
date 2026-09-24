// @vitest-environment jsdom
/**
 * The map editors survive having NO AuthProvider above them.
 *
 * THE DEFECT THIS EXISTS FOR, and it reached CI before it reached this file.
 * `useIsAdmin` was written as a one-line wrapper over `useAuth`, which THROWS
 * outside an AuthProvider by design. The three map panels are mounted by
 * `SetupWizard` at step 6, and three Admin test files render that wizard bare.
 * So one throw from a panel took down every unrelated field on the page: ten
 * failures across Admin.fiatCurrency, Admin.setupWizard and the currency-box
 * tests, none of which had anything to do with maps.
 *
 * The lesson is the one about mounting a component somewhere new. These panels
 * are LEAVING Admin, which is the whole point of the change, so "no provider
 * above me" stops being a wiring bug and becomes a tree they can legitimately
 * find themselves in. A gate that blanks the screen it is guarding is worse
 * than whatever it was guarding against.
 *
 * WHY THIS IS A SEPARATE FILE. MapEditorsAuth.test.tsx mocks
 * `@/contexts/AuthContext` wholesale so it can drive the admin flag directly,
 * and a module mock is file-wide. A test of what the REAL hook does with no
 * provider cannot live beside a mock that replaces it. Sibling file, real
 * import, no mock.
 *
 * It asserts both halves, because failing closed means both: nothing rendered
 * AND nothing requested. A panel that hid its output and still called would
 * pass a render-only assertion.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import MapSkinPanel from "./MapSkinPanel";
import WalkEditorPanel from "./WalkEditorPanel";
import MapVocabularyPanel from "./admin/MapVocabularyPanel";

let calls: string[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

const PANELS = {
  MapSkinPanel: <MapSkinPanel />,
  WalkEditorPanel: <WalkEditorPanel />,
  MapVocabularyPanel: <MapVocabularyPanel />,
};

describe("a map editor with no AuthProvider above it", () => {
  for (const [name, element] of Object.entries(PANELS)) {
    it(`${name} renders empty and asks for nothing, instead of throwing`, async () => {
      // The throw is the regression. If `useIsAdmin` reaches for `useAuth`
      // again, this render is where it dies, and the assertions below never
      // run.
      const { container } = render(element);
      // A beat, because the failure mode being guarded is a request fired from
      // an effect after the first paint.
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(container.innerHTML).toBe("");
      expect(calls).toEqual([]);
    });
  }
});
