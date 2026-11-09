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

/** The screen: 1280 px when `on`, else a tablet's 800 px, or a phone's 375 px when `phone`. */
function wideScreen(on: boolean, phone = false) {
  const width = on ? 1280 : phone ? 375 : 800;
  vi.stubGlobal("matchMedia", vi.fn((q: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? NaN);
    return { matches: Number.isFinite(min) && width >= min, media: q, addEventListener: () => {}, removeEventListener: () => {} };
  }));
  window.matchMedia = globalThis.matchMedia as typeof window.matchMedia;
}

/** The status strip as drawn: the words a sighted reader sees, with its Undo. */
async function theStrip(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>("[data-sera-strip]");
    if (!el) throw new Error("no strip yet");
    return el;
  });
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
    const strip = await theStrip();
    await waitFor(() => expect(strip.textContent).toContain("Added to the draft. It goes live when the draft is published."));
    // Said once, in the one live region (review 28).
    expect(screen.getAllByRole("status").map((s) => s.textContent).filter((t) => t?.includes("Added to the draft"))).toHaveLength(1);
    list = [m, ...list];
    fireEvent.click(within(strip).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(posts("/api/saberra/differences/undo")).toHaveLength(1));
    expect(posts("/api/saberra/differences/undo")[0].body).toEqual({ keys: [m.key] });
    await waitFor(() => expect(document.querySelector("[data-sera-strip]")?.textContent).toContain("Undone. It waits in the list again."));
    // Focus goes to the row that came back, never to the page (review 23).
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.seraRow).toBe(m.key));
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
    const strip = await theStrip();
    await waitFor(() => expect(strip.textContent).toContain("Sera changed this since you opened it."));
    expect(within(strip).queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("never offers a row whose words name a member as a take, starts its edit from ours, and gives focus back when the edit is left (R9, review 1, 23)", async () => {
    const named = { ...words(), takeable: false, namesAMember: true, flags: [{ key: "namesAMember" as const }] };
    serve({ "GET /api/saberra/differences": [200, listAnswer([named])] });
    render(<Harness />);
    const row = (await screen.findByText(/Well Keeper/)).closest("article") as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Add to draft" })).toBeNull();
    const edit = within(row).getByRole("button", { name: "Edit" });
    expect(edit.className, "never the primary button").not.toContain("bg-teal-deep");
    fireEvent.click(edit);
    const box = screen.getByRole("textbox", { name: "Well Keeper's purpose" }) as HTMLTextAreaElement;
    expect(box.value, "starts from ours, never the service's words").toBe("Keeps the wells.");
    expect(screen.queryByRole("button", { name: /Start from Sera's instead/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(within(row).getByRole("button", { name: "Edit" })));
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
    const strip = await theStrip();
    await waitFor(() => expect(strip.textContent).toContain("Added 2 to the draft"));
    expect(strip.textContent).toContain("Left out: Well Monitor (Check first); Land Stewardship (Check first).");
  });

  it("is a real modal: Escape closes it and focus goes back to the button that opened it (review 20)", async () => {
    serve({ "GET /api/saberra/differences": [200, listAnswer([move(), words()])] });
    render(<Harness />);
    await screen.findByText(/moving Water Steward/);
    fireEvent.click(screen.getByRole("button", { name: "Tick all shown" }));
    const opener = screen.getByRole("button", { name: "Take Sera's for 2" });
    opener.focus();
    fireEvent.click(opener);
    const sheet = await screen.findByRole("dialog");
    // The page behind is shut out while it is open.
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Take Sera's for 2" })));
  });

  it("confirms a bulk keep first, from the bar's overflow", async () => {
    const a = move();
    serve({ "GET /api/saberra/differences": [200, listAnswer([a, words()])], "POST /api/saberra/differences/answer": [200, { done: [{ key: a.key }], refused: [] }] });
    render(<Harness />);
    const row = (await screen.findByText(/moving Water Steward/)).closest("article") as HTMLElement;
    fireEvent.click(within(row).getByRole("checkbox"));
    // Named for what it holds, so it never reads as the tab bar's own "More" (review 31), and Escape closes it.
    fireEvent.click(screen.getByRole("button", { name: "Keep or untick" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Keep ours for 1" }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Keep ours for 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep or untick" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep ours for 1" }));
    expect(posts("/api/saberra/differences/answer")).toHaveLength(0);
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Keep ours for 1 change?" })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep 1" }));
    await waitFor(() => expect(posts("/api/saberra/differences/answer")[0]?.body.act).toBe("keep"));
  });
});

describe("in a draft (R13, R38)", () => {
  const it_ = (over: Record<string, unknown>) => ({ answer: "taken", value: null, field: null, about: null, by: null, changed: false, now: null, ...over });
  const group = {
    draftId: "d-1", title: "Sera's suggestions", with: 4, changes: 6, changeIds: ["c1", "c2", "c3", "c4", "c5", "c6"], hasChanged: false,
    items: [it_({ key: "k1", sentence: "Sera suggests a new circle, Land Stewardship, with 4 roles." }), it_({ key: "k2", sentence: "Sera has new words for Treasurer's purpose." })],
  };
  /** The card, found by its heading: its count is the draft's own, and says the nested roles are in it (review 3, 31). */
  const findCard = async (): Promise<HTMLElement> => {
    const h = await screen.findByText(/^In a draft, not live yet: 6 changes$/);
    expect(h.textContent?.replace(/\s+/g, " ")).toBe("In a draft, not live yet: 6 changes (including 4 roles inside a new circle)");
    return h.closest("section") as HTMLElement;
  };

  it("is its own card with the draft's doors: Publish for whoever may, and Withdraw", async () => {
    serve({
      "GET /api/saberra/differences": [200, listAnswer([move()], { inDraft: [group] })],
      "GET /api/org/drafts/d-1/decide": [200, { youMayPublish: true, adminMayPublish: false, youMayPutToVillage: false, ballot: null, blocked: 0, blockedLines: [] }],
      "POST /api/org/drafts/d-1/publish-by-power": [200, { success: true }],
    });
    render(<Harness />);
    // Its count is the draft's own, nested roles included (review 3, 31).
    const card = await findCard();
    expect(card.textContent).toContain("Sera suggests a new circle, Land Stewardship, with 4 roles.");
    expect(card.textContent).toContain("Sera has new words for Treasurer's purpose.");
    fireEvent.click(await within(card).findByRole("button", { name: "Publish the draft" }));
    expect(within(card).getByRole("button", { name: "Withdraw it" })).toBeTruthy();
    await waitFor(() => expect(posts("/api/org/drafts/d-1/publish-by-power")).toHaveLength(1));
    // It sends what it showed, so a draft that moved since is refused (review 12).
    expect(posts("/api/org/drafts/d-1/publish-by-power")[0].body).toEqual({ expectedChanges: group.changeIds });
    await waitFor(() => expect(document.querySelector("[data-sera-strip]")?.textContent).toContain("Published. The changes are on the chart now."));
    // Focus goes to the strip, never to the page (review 23).
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.hasAttribute("data-sera-strip")).toBe(true));
  });

  it("shows an edit as whose words they are, and a take that changed since with Take it again and Undo, and never offers Publish then (review 3, 11)", async () => {
    const changed = {
      ...group,
      hasChanged: true,
      items: [
        it_({ key: "k1", answer: "edited", sentence: "Sera has new words for Pump Keeper's purpose.", value: "Keeps the pumps and the filters.", field: "aim", about: "Pump Keeper", by: "you" }),
        it_({ key: "k2", sentence: "Sera has new words for Treasurer's purpose.", changed: true, now: { key: "k2", seraHash: "s-new", oursHash: "o-1" } }),
      ],
    };
    serve({
      "GET /api/saberra/differences": [200, listAnswer([move()], { inDraft: [changed] })],
      "GET /api/org/drafts/d-1/decide": [200, { youMayPublish: true, adminMayPublish: false, youMayPutToVillage: false, ballot: null, blocked: 0, blockedLines: [] }],
      "POST /api/saberra/differences/answer": [200, { done: [{ key: "k2" }], refused: [] }],
    });
    render(<Harness />);
    const card = await findCard();
    expect(card.textContent).toContain("Your words for Pump Keeper's purpose: Keeps the pumps and the filters.");
    expect(card.textContent).toContain("Changed since it was taken");
    await within(card).findByRole("button", { name: "Withdraw it" });
    expect(within(card).queryByRole("button", { name: "Publish the draft" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Take it again" }));
    await waitFor(() => expect(posts("/api/saberra/differences/answer")[0]?.body).toEqual({ act: "take", items: [{ key: "k2", seraHash: "s-new", oursHash: "o-1" }] }));
  });

  it("while the village votes on it, Withdraw says it ends the vote and asks first (review 27)", async () => {
    serve({
      "GET /api/saberra/differences": [200, listAnswer([move()], { inDraft: [group] })],
      "GET /api/org/drafts/d-1/decide": [200, { youMayPublish: true, adminMayPublish: false, youMayPutToVillage: false, ballot: { id: "b-1", closesAt: "2026-11-20T12:00:00.000Z" }, blocked: 0, blockedLines: [] }],
      "POST /api/review/drafts/d-1/withdraw": [200, { success: true, reopened: 0, ballotWithdrawn: "b-1" }],
    });
    render(<Harness />);
    const card = await findCard();
    fireEvent.click(await within(card).findByRole("button", { name: "Withdraw it and end the vote" }));
    expect(posts("/api/review/drafts/d-1/withdraw")).toHaveLength(0);
    expect(card.textContent).toContain("Withdrawing it ends the village's vote on it");
    expect(within(card).queryByRole("button", { name: "Publish the draft" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Withdraw it and end the vote" }));
    await waitFor(() => expect(posts("/api/review/drafts/d-1/withdraw")).toHaveLength(1));
    await waitFor(() => expect(document.querySelector("[data-sera-strip]")?.textContent).toContain("Withdrawn, and the village's vote on it ended."));
  });

  it("offers the village's vote, never a publish, when nobody may publish and the door is open to any member", async () => {
    serve({
      "GET /api/saberra/differences": [200, listAnswer([move()], { inDraft: [group] })],
      "GET /api/org/drafts/d-1/decide": [200, { youMayPublish: false, adminMayPublish: false, youMayPutToVillage: true, ballotNeeded: true, ballot: null, blocked: 0, blockedLines: [] }],
      "POST /api/org/drafts/d-1/put-to-village": [200, { success: true, ballot: { id: "b-1" } }],
    });
    render(<Harness />);
    const card = await findCard();
    fireEvent.click(await within(card).findByRole("button", { name: "Put it to the village" }));
    expect(within(card).queryByRole("button", { name: "Publish the draft" })).toBeNull();
    await waitFor(() => expect(posts("/api/org/drafts/d-1/put-to-village")).toHaveLength(1));
  });

  it("gives a member the village's door on the draft the list opened, through its own decide answer", async () => {
    serve({
      "GET /api/saberra/differences/count": [200, { ...COUNT, total: 1, toDecide: 1, lanes: { facts: 0, lowRisk: 0, decision: 1 }, decides: { by: "admins" }, drafts: [{ id: "d-1", changes: 2, changeIds: ["c1", "c2"], hasChanged: false }, { id: "d-2", changes: 1, changeIds: ["c3"], hasChanged: false }], reader: { mayRead: false, decides: false } }],
      "GET /api/guide": [200, { options: [{ id: "saberra", name: "Sera" }] }],
      "GET /api/org/drafts/d-1/decide": [200, { youMayPublish: false, adminMayPublish: false, youMayPutToVillage: true, ballotNeeded: true, ballot: null, blocked: 0, blockedLines: [] }],
      "GET /api/org/drafts/d-2/decide": [200, { youMayPublish: false, adminMayPublish: false, youMayPutToVillage: true, ballotNeeded: true, ballot: null, blocked: 0, blockedLines: [] }],
      "POST /api/org/drafts/d-1/put-to-village": [200, { success: true, ballot: { id: "b-1" } }],
      "POST /api/org/drafts/d-2/put-to-village": [200, { success: true, ballot: { id: "b-2" } }],
    });
    render(<Harness />);
    // When the reader may open the vote, the village decides: never also "the admins decide them" (review 30).
    expect(await screen.findByText("Nobody holds the power to decide these right now, so the village decides by vote.")).toBeTruthy();
    expect(screen.queryByText(/The admins decide/)).toBeNull();
    // Every draft from the list, by its size (review 16).
    expect(screen.getByText("2 changes are in a draft, waiting to be published.")).toBeTruthy();
    expect(screen.getByText("1 change is in a draft, waiting to be published.")).toBeTruthy();
    const doors = await screen.findAllByRole("button", { name: "Put it to the village" });
    expect(doors).toHaveLength(2);
    fireEvent.click(doors[1]);
    await waitFor(() => expect(posts("/api/org/drafts/d-2/put-to-village")).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByRole("status").map((s) => s.textContent).join(" ")).toContain("The village is voting on it now."));
    // A member never asked the list.
    expect(calls.some((c) => c.path === "/api/saberra/differences")).toBe(false);
  });
});

describe("a decider on the member page (review 21)", () => {
  it("publishes a draft the doors say they may, sending the changes it was shown", async () => {
    serve({
      "GET /api/saberra/differences/count": [200, { ...COUNT, total: 1, toDecide: 1, lanes: { facts: 0, lowRisk: 0, decision: 1 }, decides: { by: "holders", labels: ["Ops lead (Rye)"], more: 0, stewards: false, others: 0, admins: false }, drafts: [{ id: "d-1", changes: 2, changeIds: ["c1", "c2"], hasChanged: false }], reader: { mayRead: false, decides: true } }],
      "GET /api/guide": [200, { options: [{ id: "saberra", name: "Sera" }] }],
      "GET /api/org/drafts/d-1/decide": [200, { youMayPublish: true, adminMayPublish: false, youMayPutToVillage: false, ballot: null, blocked: 0, blockedLines: [] }],
      "POST /api/org/drafts/d-1/publish-by-power": [200, { success: true }],
    });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Publish the draft" }));
    await waitFor(() => expect(posts("/api/org/drafts/d-1/publish-by-power")[0]?.body).toEqual({ expectedChanges: ["c1", "c2"] }));
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

  it("does nothing below 768 px, even remembered on (review 29)", async () => {
    window.localStorage.setItem("village.seraReview.keys", "on");
    wideScreen(false, true);
    serve({ "GET /api/saberra/differences": [200, listAnswer([move(), words()])] });
    render(<Harness />);
    await screen.findByText(/moving Water Steward/);
    const rows = screen.getAllByRole("article");
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "j" });
    expect(document.activeElement).toBe(rows[0]);
  });

  it("at 1280 px, a row that takes focus is the one shown, and a key presses the pane's button for that row only (review 8)", async () => {
    window.localStorage.setItem("village.seraReview.keys", "on");
    wideScreen(true);
    const a = move();
    const b = words();
    serve({ "GET /api/saberra/differences": [200, listAnswer([a, b])], "POST /api/saberra/differences/answer": [200, { done: [{ key: b.key }], refused: [] }] });
    render(<Harness />);
    await screen.findAllByText(/moving Water Steward/);
    const row = document.querySelector<HTMLElement>(`[data-sera-row="${b.key}"]`)!;
    // Focus on something inside the row (its tick) selects it.
    within(row).getByRole("checkbox").focus();
    await waitFor(() => expect(document.getElementById("sera-pane")?.dataset.paneKey).toBe(b.key));
    fireEvent.keyDown(row, { key: "t" });
    await waitFor(() => expect(posts("/api/saberra/differences/answer")[0]?.body.items[0].key).toBe(b.key));
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
