// @vitest-environment jsdom
/**
 * The chips editor in Village settings: a founder names each chip, points it
 * at something the village keeps, orders them, and saves.
 *
 * Rye, deciding F29 (2026-10-02): "wire them to admin where we can add in a
 * label and a datasource ... and make them highly customizable this way.
 * Label as example - this label goes away once set."
 *
 * What is under test is what the editor SENDS and what it TELLS the founder,
 * so the server is a stub that answers the way server/routes/mapChips.ts does
 * (it sanitises with the same shared function). The routes themselves are
 * server/routes/mapChips.test.ts, on a real schema. Who may see this panel at
 * all is MapEditorsAuth.test.tsx, beside the other three map editors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  DEFAULT_MAP_CHIPS,
  MAP_CHIPS_SAVED_EVENT,
  MAP_CHIPS_SAVED_KEY,
  MAX_MAP_CHIPS,
  STAT_SOURCES,
  STAT_SOURCE_KEYS,
  resolveChips,
  sanitiseMapChips,
  type MapChip,
} from "@shared/mapStatChips";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useIsAdmin: () => true, useAuth: () => ({ user: { id: "u1", role: "founder" } }) }));

const sent: Array<{ url: string; method: string; body: any }> = [];
let stored: MapChip[] = DEFAULT_MAP_CHIPS.map((c) => ({ ...c }));
/** Why a source would not draw for a visitor, as the server says it. */
let hidden: Record<string, string> = {};

const view = (chips: MapChip[]) => ({
  chips,
  preview: resolveChips(
    chips,
    Object.fromEntries(
      STAT_SOURCE_KEYS.map((k) => [k, hidden[k] ? { ok: false, why: hidden[k] } : { ok: true, n: 41, countedAt: "2026-10-02T12:00:00.000Z" }]),
    ),
  ),
  sources: STAT_SOURCE_KEYS.map((key) => ({ key, ...STAT_SOURCES[key], hiddenFromVisitors: hidden[key] ?? null })),
});

vi.mock("@/lib/gameApi", () => ({
  gameFetch: async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    sent.push({ url, method, body });
    if (method === "PUT") stored = sanitiseMapChips({ chips: body.chips }).chips;
    return new Response(JSON.stringify({ success: method === "PUT", ...view(stored) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
}));

import MapChipsPanel from "./MapChipsPanel";

const store = new Map<string, string>();
beforeEach(() => {
  sent.length = 0;
  stored = DEFAULT_MAP_CHIPS.map((c) => ({ ...c }));
  hidden = {};
  store.clear();
  // Node 25's own inert localStorage wins over jsdom's; see MapEditorsAuth.test.tsx.
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open() {
  render(<MapChipsPanel />);
  await screen.findByRole("button", { name: "Save the chips" });
}
const rows = () => screen.getAllByRole("listitem");
const sourceOf = (row: HTMLElement) => within(row).getByLabelText("What it reads") as HTMLSelectElement;

describe("the chips editor", () => {
  it("lists the five examples a fresh village has, and says each one shows an example", async () => {
    await open();
    expect(rows()).toHaveLength(5);
    expect(rows().map((r) => sourceOf(r).value)).toEqual(["none", "none", "none", "none", "none"]);
    expect(screen.getAllByText("The map shows its example number, marked as an example.")).toHaveLength(5);
  });

  it("offers every source the server can count, and a number the founder types", async () => {
    await open();
    const options = Array.from(sourceOf(rows()[0]).querySelectorAll("option"), (o) => o.value);
    expect(options.slice(0, 2)).toEqual(["none", "manual"]);
    expect(options.slice(2).sort()).toEqual([...STAT_SOURCE_KEYS].sort());
  });

  it("saves the founder's own list: a source, a new name, a new order, a chip removed and one added", async () => {
    await open();
    fireEvent.change(sourceOf(rows()[0]), { target: { value: "members" } });
    fireEvent.change(within(rows()[0]).getByLabelText("Name on the chip"), { target: { value: "Members" } });
    fireEvent.click(within(rows()[3]).getByRole("button", { name: "Move Canopy earlier" }));
    fireEvent.click(within(rows()[1]).getByRole("button", { name: "Take Food off the map" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a chip" }));
    expect(screen.getByText("Save to see what the map will show.")).toBeTruthy();

    const heard = vi.fn();
    window.addEventListener(MAP_CHIPS_SAVED_EVENT, heard);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save the chips" })); });
    window.removeEventListener(MAP_CHIPS_SAVED_EVENT, heard);

    const put = sent.find((s) => s.method === "PUT");
    expect(put?.url).toBe("/api/admin/map/chips");
    expect(put?.body.chips.map((c: MapChip) => [c.id, c.source, c.label])).toEqual([
      ["people", "members", "Members"],
      ["canopy", "none", "Canopy"],
      ["water", "none", "Water"],
      ["hearts", "none", "Hearts"],
      ["chip", "none", "New chip"],
    ]);
    // The door a source suggests comes along with it.
    expect(put?.body.chips[0].link).toBe("/team");
    // An open map, in this tab and in others, is told to ask again.
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.get(MAP_CHIPS_SAVED_KEY)).toBeTruthy();
    // And what comes back is what the map now draws.
    await waitFor(() => expect(screen.getByText("The map shows 41, members.")).toBeTruthy());
  });

  it("asks for a typed number and the day it was true, and sends both", async () => {
    await open();
    fireEvent.change(sourceOf(rows()[1]), { target: { value: "manual" } });
    fireEvent.change(within(rows()[1]).getByLabelText("Your number"), { target: { value: "62" } });
    fireEvent.change(within(rows()[1]).getByLabelText("True as of"), { target: { value: "2026-09-30" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save the chips" })); });
    const food = sent.find((s) => s.method === "PUT")!.body.chips[1];
    expect(food).toMatchObject({ source: "manual", manual: { value: "62", asOf: "2026-09-30" } });
  });

  it("warns when a chip will not draw for visitors, before the founder saves it", async () => {
    hidden = { trees_planted: "Village Health is switched off, so this chip is not drawn." };
    await open();
    fireEvent.change(sourceOf(rows()[3]), { target: { value: "trees_planted" } });
    expect(within(rows()[3]).getByText("Village Health is switched off, so this chip is not drawn.")).toBeTruthy();
  });

  it("stops adding at the six a phone's bar can hold", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a chip" }));
    expect(rows()).toHaveLength(MAX_MAP_CHIPS);
    expect((screen.getByRole("button", { name: "Add a chip" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("puts the five examples back in one press", async () => {
    await open();
    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Take People off the map" }));
    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Take Food off the map" }));
    expect(rows()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Put back the five examples" }));
    expect(rows()).toHaveLength(5);
  });
});
