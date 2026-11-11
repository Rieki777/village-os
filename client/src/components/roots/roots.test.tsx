// @vitest-environment jsdom
/**
 * The roots, as drawings and as controls (the five archetypes as roots).
 *
 *  - each root has its own shape, the same shape every time, inside its box;
 *  - a tag list is named "Grows from" and says the village's own names;
 *  - an editor's fourth root is refused with a sentence, never silently;
 *  - "Use these" on a coverage row sets the boxes from the kind of work;
 *  - the filter switch is a real switch and remembers being turned off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import type { ReactNode } from "react";
import { ARCHETYPES } from "@shared/archetypes";
import { rootGlyph, seedOf } from "./rootGlyph";
import RootTags from "./RootTags";
import RootPicker from "./RootPicker";
import RootsFilterToggle from "./RootsFilterToggle";
import { ROOTS_FILTER_OFF_KEY, useRootsFilter } from "./useRootsFilter";
import { forgetRootCast } from "./rootCast";

i18n.loadAndActivate({ locale: "en", messages: {} });
const wrap = ({ children }: { children: ReactNode }) => <I18nProvider i18n={i18n}>{children}</I18nProvider>;

const store = new Map<string, string>();
beforeEach(() => {
  forgetRootCast();
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (String(path) === "/api/archetypes") return { ok: true, json: async () => ARCHETYPES };
      if (String(path).includes("/api/me/characters")) {
        return { ok: true, json: async () => ({ party: [{ archetypeKey: "storytelling" }, { archetypeKey: "building" }] }) };
      }
      return { ok: false, json: async () => ({}) };
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("rootGlyph", () => {
  it("draws the same root for the same key, and a different root for each of the five", () => {
    expect(rootGlyph("building")).toEqual(rootGlyph("building"));
    const shapes = new Set(ARCHETYPES.map((a) => rootGlyph(a.key).strokes.map((s) => s.d).join("|")));
    expect(shapes.size).toBe(5);
    expect(seedOf("building")).not.toBe(seedOf("researching"));
  });

  it("branches three generations deep and stays inside its 24px box", () => {
    for (const a of ARCHETYPES) {
      const g = rootGlyph(a.key);
      expect(g.strokes.length, a.key).toBeGreaterThanOrEqual(1 + 2 + 4);
      for (const s of g.strokes) {
        const nums = s.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
        for (const n of nums) {
          expect(n).toBeGreaterThanOrEqual(-6);
          expect(n).toBeLessThanOrEqual(30);
        }
      }
      // Thinner the further from the crown, the way a root grows.
      expect(g.strokes[0].width).toBeGreaterThan(g.strokes[g.strokes.length - 1].width);
    }
  });
});

describe("RootTags", () => {
  it("names the list 'Grows from' and says each root by the village's own name, without 'The'", async () => {
    render(<RootTags roots={["catalyzing", "researching"]} />, { wrapper: wrap });
    const list = screen.getByRole("list", { name: "Grows from" });
    await waitFor(() => expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Connector + Catalyst", "Architect"]));
    // The drawing is decoration.
    expect(list.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws nothing for work with no roots", () => {
    const { container } = render(<RootTags roots={[]} />, { wrapper: wrap });
    expect(container.innerHTML).toBe("");
  });

  it("gives a desktop the second name on a md tag", async () => {
    render(<RootTags roots={["researching"]} size="md" />, { wrapper: wrap });
    await screen.findByText("Researching & Designing");
    expect(screen.getByText("Researching & Designing").className).toContain("lg:inline");
  });
});

describe("RootPicker", () => {
  it("refuses a fourth root with a sentence and keeps the three", async () => {
    const onChange = vi.fn();
    render(<RootPicker value={["building", "researching", "facilitating"]} onChange={onChange} />, { wrapper: wrap });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Storyteller" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Up to 3 roots");
  });

  it("sets the boxes from a coverage row", async () => {
    const onChange = vi.fn();
    render(<RootPicker value={[]} onChange={onChange} />, { wrapper: wrap });
    fireEvent.click(await screen.findByRole("button", { name: "Use the roots for Finance and accounting" }));
    expect(onChange).toHaveBeenCalledWith(["researching", "catalyzing", "building"]);
  });
});

describe("show only what matches my roots", () => {
  it("is on by default once the member has roots, and a real switch turns it off and remembers", async () => {
    const { result } = renderHook(() => useRootsFilter("u1"));
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.on).toBe(true);
    expect(result.current.apply([{ r: ["building"] }, { r: ["researching"] }], (x) => x.r).shown).toEqual([{ r: ["building"] }]);

    render(<RootsFilterToggle filter={result.current} total={2} shown={1} noun="quests" />, { wrapper: wrap });
    const sw = screen.getByRole("switch", { name: "Show only what matches my roots" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Showing 1 of 2 quests/)).toBeTruthy();
    act(() => fireEvent.click(sw));
    await waitFor(() => expect(result.current.on).toBe(false));
    expect(store.get(ROOTS_FILTER_OFF_KEY)).toBe("1");
  });

  it("filters nothing for a visitor", () => {
    const { result } = renderHook(() => useRootsFilter(null));
    expect(result.current.available).toBe(false);
    expect(result.current.apply([1, 2], () => [])).toEqual({ shown: [1, 2], hidden: 0, tagged: false });
  });
});
