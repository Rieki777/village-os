// @vitest-environment jsdom
/**
 * ANSWERING THE OUTSIDE SERVICE'S DIFFERENCES ON /review (spec R13 to R16,
 * R30 to R33, R38; the approved "Waiting for you", "A conflict, stacked",
 * "Take many at once" and "1280 px" boards).
 *
 * The server is a fetch stub that records every call: what a test asserts is
 * what the page SENDS (the key and both hashes, R14) and what it then says,
 * in the one status strip, with its Undo (R30).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { Router } from "wouter";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token" }));

import SeraDifferences, { useSeraDifferences } from "./SeraDifferences";
import { listed } from "@/test/seraDifferences";
import type { ListedDifference } from "@/lib/seraReview";

const COUNT = {
  total: 0, toDecide: 0, small: 0, facts: 0, lanes: { facts: 0, lowRisk: 0, decision: 0 }, conflicts: 0, checkFirst: 0, oursAhead: 0,
  decides: { by: "admins" }, paySetBy: { by: "vote" }, lastReadAt: new Date().toISOString(), lastReadWhole: true,
};

function listAnswer(differences: ListedDifference[], over: Record<string, unknown> = {}) {
  return {
    agent: "Sera", lastReadAt: new Date().toISOString(), lastReadWhole: true, reads: { circles: "whole", roles: "whole" },
    count: COUNT, differences, circleOrder: ["c-water", "c-kitchen"], heldBatches: [], ...over,
  };
}

type Call = { path: string; method: string; body: any };
let calls: Call[] = [];
type Route = (body: any) => [number, unknown];

function serve(routes: Record<string, Route | [number, unknown]>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const path = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body) : null;
      calls.push({ path, method, body });
      const r = routes[`${method} ${path}`];
      const [status, out] = typeof r === "function" ? r(body) : (r ?? (path === "/api/saberra/differences/count" ? [200, COUNT] : [404, {}]));
      return { ok: status >= 200 && status < 300, status, json: async () => out };
    }),
  );
}
const posts = (path: string) => calls.filter((c) => c.method === "POST" && c.path === path);

function Harness() {
  const { read, load } = useSeraDifferences();
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Router>
      <SeraDifferences read={read} draftOpen={false} onRetry={load} />
    </Router>
  );
}

function wideScreen(on: boolean) {
  vi.stubGlobal("matchMedia", vi.fn((q: string) => ({ matches: on && q.includes("1280"), media: q, addEventListener: () => {}, removeEventListener: () => {} })));
  window.matchMedia = globalThis.matchMedia as typeof window.matchMedia;
}

const move = () =>
  listed({ kind: "roleMove", field: "circle", sera: "c-land", ours: "c-water", seraHash: "s-move", oursHash: "o-move", params: { from: "Water", to: ["Land & Ecology"] }, subject: { name: "Water Steward" } }, "Sera", ["Ana Moss"]);
const words = () =>
  listed({ kind: "textField", field: "aim", lane: "decision", sera: "Keeps the wells clean.", ours: "Keeps the wells.", seraHash: "s-words", oursHash: "o-words", subject: { name: "Well Keeper" } });
const conflict = (changedHereAt?: string) => ({
  ...listed({
    kind: "textField", field: "aim", lane: "lowRisk", state: "conflict", seraHash: "s-pump", oursHash: "o-pump",
    sera: "Keeps the pumps, the storage tanks and the filters.", ours: "Keeps the pumps and the tanks.", subject: { name: "Pump Keeper" },
  }),
  ...(changedHereAt ? { changedHereAt } : {}),
});
const firstSight = () =>
  listed({ kind: "roleAdd", field: null, sera: "Well Monitor", ours: null, flags: [{ key: "baseUnknown" }, { key: "firstSight" }], bulkEligible: false, subject: { ourId: null, name: "Well Monitor" } });
const LS = "c0ffee00c0ffee00c0ffee00c0ffee00";
const newCircle = () =>
  listed({ kind: "circleAdd", field: null, sera: "Land Stewardship", ours: null, params: { roles: 1 }, flags: [{ key: "baseUnknown" }, { key: "firstSight" }], bulkEligible: false, subject: { kind: "circle", pageId: LS, ourId: null, name: "Land Stewardship", circleId: null, circleName: null } });
const seedRole = () =>
  listed({ kind: "roleAdd", field: null, sera: "Seed Keeper", ours: null, flags: [{ key: "baseUnknown" }, { key: "firstSight" }], bulkEligible: false, subject: { ourId: null, name: "Seed Keeper", circleId: `sera:${LS}`, circleName: "Land Stewardship" } });

beforeEach(() => {
  vi.restoreAllMocks();
  wideScreen(false);
  try {
    window.localStorage.clear();
  } catch {
    // jsdom keeps one
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("one answer, and its Undo (R13, R14, R30)", () => {
  it("sends the key and both hashes as seen, says what happened in the one strip, and undoes it from there", async () => {
    const m = move();
    let list = [m, words()];
    serve({
      "GET /api/saberra/differences": () => [200, listAnswer(list)],
      "POST /api/saberra/differences/answer": () => {
        list = list.filter((d) => d.key !== m.key);
        return [200, { done: [{ key: m.key, answer: "taken", draftId: "d-1", with: [] }], refused: [], draftId: "d-1" }];
      },
      "POST /api/saberra/differences/undo": () => [200, { undone: [m.key], refused: [] }],
    });
    render(<Harness />);
    const row = (await screen.findByText(/moving Water Steward/)).closest("article") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Add to draft" }));
    await waitFor(() => expect(posts("/api/saberra/differences/answer")).toHaveLength(1));
    expect(posts("/api/saberra/differences/answer")[0].body).toEqual({ act: "take", items: [{ key: m.key, seraHash: "s-move", oursHash: "o-move" }] });
    const strip = await screen.findByRole("status", { name: "" }).catch(() => null);
    const said = await screen.findByText("Added to the draft. It goes live when the draft is published.");
    expect(said.closest("[role=status]")).toBeTruthy();
    void strip;
    fireEvent.click(within(said.closest("[role=status]") as HTMLElement).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(posts("/api/saberra/differences/undo")).toHaveLength(1));
    expect(posts("/api/saberra/differences/undo")[0].body).toEqual({ keys: [m.key] });
    expect(await screen.findByText("Undone. It waits in the list again.")).toBeTruthy();
  });

  it("says the server's refusal in its own words, with no Undo, when the service changed it since it was opened", async () => {
    const m = move();
    serve({
      "GET /api/saberra/differences": [200, listAnswer([m])],
      "POST /api/saberra/differences/answer": [409, { error: "Sera changed this since you opened it.", why: "seraChanged" }],
    });
    render(<Harness />);
    const row = (await screen.findByText(/moving Water Steward/)).closest("article") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Keep ours" }));
    const said = await screen.findByText("Sera changed this since you opened it.");
    expect(within(said.closest("[role=status]") as HTMLElement).queryByRole("button", { name: "Undo" })).toBeNull();
  });
});

describe("the conflict, stacked, and its edit (R33, the conflict board)", () => {
  it("says when somebody here rewrote it only when the server knows, offers the board's three, and edits from either side", async () => {
    const c = conflict("2026-11-01T12:00:00.000Z");
    serve({
      "GET /api/saberra/differences": [200, listAnswer([c])],
      "POST /api/saberra/differences/answer": [200, { done: [{ key: c.key, answer: "edited" }], refused: [], draftId: "d-1" }],
    });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Compare them" }));
    expect(await screen.findByText(/Someone here rewrote it on 1 Nov\. Choose one, or write your own\./)).toBeTruthy();
    expect(screen.getAllByRole("button").filter((b) => b.dataset.act).map((b) => b.textContent)).toEqual(["Take Sera's: add to draft", "Keep ours", "Edit: start from Sera's"]);
    expect(screen.getByText(/Keep ours means Sera's version stays out of the list until Sera changes it again/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit: start from Sera's" }));
    const box = screen.getByRole("textbox", { name: "Pump Keeper's purpose" }) as HTMLTextAreaElement;
    expect(box.value).toBe(c.sera);
    expect(document.activeElement).toBe(box);
    fireEvent.click(screen.getByRole("button", { name: "Start from ours instead" }));
    expect((screen.getByRole("textbox", { name: "Pump Keeper's purpose" }) as HTMLTextAreaElement).value).toBe(c.ours);
    fireEvent.change(screen.getByRole("textbox", { name: "Pump Keeper's purpose" }), { target: { value: "Keeps the pumps, the tanks and the filters." } });
    fireEvent.click(screen.getByRole("button", { name: "Add my words to draft" }));
    await waitFor(() => expect(posts("/api/saberra/differences/answer")).toHaveLength(1));
    expect(posts("/api/saberra/differences/answer")[0].body).toEqual({
      act: "edit",
      items: [{ key: c.key, seraHash: "s-pump", oursHash: "o-pump", value: "Keeps the pumps, the tanks and the filters." }],
    });
  });

  it("leaves the time out when published history gives none, and says only the choice", async () => {
    serve({ "GET /api/saberra/differences": [200, listAnswer([conflict()])] });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Compare them" }));
    expect(await screen.findByText("Choose one, or write your own.")).toBeTruthy();
    expect(screen.queryByText(/Someone here/)).toBeNull();
  });
});

describe("many at once (R2, R30, R31, the bulk board)", () => {
  it("opens a sheet with the split in words, leaves out Check first and the new circle's roles with it, and sends only what may go together", async () => {
    const a = move();
    const b = words();
    const well = firstSight();
    const circle = newCircle();
    const seed = seedRole();
    serve({
      "GET /api/saberra/differences": [200, listAnswer([a, b, well, circle, seed])],
      "POST /api/saberra/differences/answer": [200, { done: [{ key: a.key }, { key: b.key }], refused: [], draftId: "d-1" }],
    });
    render(<Harness />);
    await screen.findByText(/moving Water Steward/);
    expect(screen.queryByRole("button", { name: /^Take Sera's for/ }), "the bar only once something is ticked").toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tick all shown" }));
    fireEvent.click(screen.getByRole("button", { name: "Take Sera's for 4" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Take Sera's for 2 changes?" })).toBeTruthy();
    expect(within(sheet).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "2 go into a draft. They go live when the draft is published.",
      "2 marked Check first are left out. Take each of them on its own.",
      "Leaving out Land Stewardship also leaves out its role.",
      "Left out: Well Monitor, Land Stewardship.",
    ]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Take 2" }));
    await waitFor(() => expect(posts("/api/saberra/differences/answer")).toHaveLength(1));
    expect(posts("/api/saberra/differences/answer")[0].body.items.map((i: { key: string }) => i.key)).toEqual([a.key, b.key]);
    expect(await screen.findByText(/Added 2 to the draft/)).toBeTruthy();
    expect(screen.getByText(/Left out: Well Monitor \(Check first\); Land Stewardship \(Check first\)\./)).toBeTruthy();
  });

  it("confirms a bulk keep first, from the bar's overflow", async () => {
    const a = move();
    serve({ "GET /api/saberra/differences": [200, listAnswer([a, words()])], "POST /api/saberra/differences/answer": [200, { done: [{ key: a.key }], refused: [] }] });
    render(<Harness />);
    const row = (await screen.findByText(/moving Water Steward/)).closest("article") as HTMLElement;
    fireEvent.click(within(row).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep ours for 1" }));
    expect(posts("/api/saberra/differences/answer")).toHaveLength(0);
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Keep ours for 1 change?" })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep 1" }));
    await waitFor(() => expect(posts("/api/saberra/differences/answer")[0]?.body.act).toBe("keep"));
  });
});

describe("in a draft (R13, R38)", () => {
  const group = { draftId: "d-1", title: "Sera's suggestions", items: [{ key: "k1", sentence: "Sera suggests a new circle, Land Stewardship, with 4 roles." }, { key: "k2", sentence: "Sera has new words for Treasurer's purpose." }], with: 4 };

  it("is its own card with the draft's doors: Publish for whoever may, and Withdraw", async () => {
    serve({
      "GET /api/saberra/differences": [200, listAnswer([move()], { inDraft: [group] })],
      "GET /api/org/drafts/d-1/decide": [200, { youMayPublish: true, adminMayPublish: false, youMayPutToVillage: false, ballot: null, blocked: 0, blockedLines: [] }],
      "POST /api/org/drafts/d-1/publish-by-power": [200, { success: true }],
    });
    render(<Harness />);
    const card = (await screen.findByRole("heading", { name: "In a draft, not live yet: 2 changes" })).closest("section") as HTMLElement;
    expect(card.textContent).toContain("Sera suggests a new circle, Land Stewardship, with 4 roles. Sera has new words for Treasurer's purpose.");
    fireEvent.click(await within(card).findByRole("button", { name: "Publish the draft" }));
    expect(within(card).getByRole("button", { name: "Withdraw it" })).toBeTruthy();
    await waitFor(() => expect(posts("/api/org/drafts/d-1/publish-by-power")).toHaveLength(1));
    expect(await screen.findByText("Published. The changes are on the chart now.")).toBeTruthy();
  });

  it("offers the village's vote, never a publish, when nobody may publish and the door is open to any member", async () => {
    serve({
      "GET /api/saberra/differences": [200, listAnswer([move()], { inDraft: [group] })],
      "GET /api/org/drafts/d-1/decide": [200, { youMayPublish: false, adminMayPublish: false, youMayPutToVillage: true, ballotNeeded: true, ballot: null, blocked: 0, blockedLines: [] }],
      "POST /api/org/drafts/d-1/put-to-village": [200, { success: true, ballot: { id: "b-1" } }],
    });
    render(<Harness />);
    const card = (await screen.findByRole("heading", { name: "In a draft, not live yet: 2 changes" })).closest("section") as HTMLElement;
    fireEvent.click(await within(card).findByRole("button", { name: "Put it to the village" }));
    expect(within(card).queryByRole("button", { name: "Publish the draft" })).toBeNull();
    await waitFor(() => expect(posts("/api/org/drafts/d-1/put-to-village")).toHaveLength(1));
  });

  it("gives a member the village's door on the draft the list opened, through its own decide answer", async () => {
    serve({
      "GET /api/saberra/differences/count": [200, { ...COUNT, total: 1, toDecide: 1, lanes: { facts: 0, lowRisk: 0, decision: 1 }, decides: { by: "vote" }, drafts: [{ id: "d-1", changes: 2 }], reader: { mayRead: false, decides: false } }],
      "GET /api/guide": [200, { options: [{ id: "saberra", name: "Sera" }] }],
      "GET /api/org/drafts/d-1/decide": [200, { youMayPublish: false, adminMayPublish: false, youMayPutToVillage: true, ballotNeeded: true, ballot: null, blocked: 0, blockedLines: [] }],
      "POST /api/org/drafts/d-1/put-to-village": [200, { success: true, ballot: { id: "b-1" } }],
    });
    render(<Harness />);
    expect(await screen.findByText("Nobody holds the power to decide these right now, so the village decides by vote.")).toBeTruthy();
    expect(screen.getByText("2 of them are in a draft, waiting to be published.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Put it to the village" }));
    await waitFor(() => expect(posts("/api/org/drafts/d-1/put-to-village")).toHaveLength(1));
    expect(await screen.findByText("The village is voting on it now.")).toBeTruthy();
    // A member never asked the list.
    expect(calls.some((c) => c.path === "/api/saberra/differences")).toBe(false);
  });
});

describe("the keyboard (R32)", () => {
  const press = (el: Element, key: string) => fireEvent.keyDown(el, { key });

  it("is off by default, behind a toggle shown from 768 px, and does nothing while off", async () => {
    serve({ "GET /api/saberra/differences": [200, listAnswer([move(), words()])] });
    render(<Harness />);
    await screen.findByText(/moving Water Steward/);
    const toggle = screen.getByRole("checkbox", { name: "Keyboard keys" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.closest("label")?.className).toMatch(/\bhidden\b.*\bmd:flex\b/);
    expect(screen.queryByText(/^Keys: j or/)).toBeNull();
    const first = screen.getAllByRole("article")[0];
    first.focus();
    press(first, "j");
    expect(document.activeElement).toBe(first);
    press(first, "x");
    expect(within(first).getByRole("checkbox")).toHaveProperty("checked", false);
  });

  it("once on, is remembered, lists its keys, moves with j and the arrows, ticks with x and takes with t", async () => {
    const a = move();
    const b = words();
    serve({
      "GET /api/saberra/differences": [200, listAnswer([a, b])],
      "POST /api/saberra/differences/answer": [200, { done: [{ key: b.key }], refused: [] }],
    });
    const first = render(<Harness />);
    await screen.findByText(/moving Water Steward/);
    fireEvent.click(screen.getByRole("checkbox", { name: "Keyboard keys" }));
    expect(screen.getByText(/^Keys: j or Down for the next, k or Up for the one before, x tick, t take, a keep, e edit\. Escape leaves an edit\.$/)).toBeTruthy();
    first.unmount();
    render(<Harness />);
    await screen.findByText(/moving Water Steward/);
    expect((screen.getByRole("checkbox", { name: "Keyboard keys" }) as HTMLInputElement).checked, "remembered in this browser").toBe(true);

    const rows = screen.getAllByRole("article");
    rows[0].focus();
    press(rows[0], "j");
    expect(document.activeElement).toBe(rows[1]);
    press(rows[1], "ArrowUp");
    expect(document.activeElement).toBe(rows[0]);
    press(rows[0], "ArrowDown");
    press(rows[1], "x");
    expect((within(rows[1]).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    press(rows[1], "t");
    await waitFor(() => expect(posts("/api/saberra/differences/answer")).toHaveLength(1));
    expect(posts("/api/saberra/differences/answer")[0].body.items[0].key).toBe(rows[1].dataset.seraRow);
  });

  it("never acts while typing, and Escape leaves an edit", async () => {
    window.localStorage.setItem("village.seraReview.keys", "on");
    const c = conflict();
    serve({ "GET /api/saberra/differences": [200, listAnswer([listed({ ...c, state: "suggestion", takeable: false, namesAMember: true })])] });
    render(<Harness />);
    const row = (await screen.findByText(/Pump Keeper/)).closest("article") as HTMLElement;
    row.focus();
    press(row, "e");
    const box = await screen.findByRole("textbox", { name: "Pump Keeper's purpose" });
    press(box, "t");
    press(box, "j");
    expect(posts("/api/saberra/differences/answer")).toHaveLength(0);
    expect(document.activeElement).toBe(box);
    press(box, "Escape");
    expect(screen.queryByRole("textbox", { name: "Pump Keeper's purpose" })).toBeNull();
  });
});
