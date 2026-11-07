// @vitest-environment jsdom
/**
 * THE OUTSIDE SERVICE'S DIFFERENCES ON /review, AS A READER SEES THEM.
 *
 * The approved boards (Rye, 2026-11-06) are the spec for what each state
 * looks like; spec section 8.6 is the spec for what each one says. Each case
 * below is one board or one rule:
 *
 *   - "Waiting for you": the headline counts only what waits (R29), the
 *     applied line stands on its own, groups by circle with the count in the
 *     heading, more than eight collapsed, Check first on top (R37), roles
 *     under a new circle (R31), and the facts digest folded at the bottom.
 *   - "A conflict, stacked": Here now, then the service's version with one
 *     merged diff, struck and underlined, clamped to four lines (R33).
 *   - "Sera didn't answer" and "In step" (R29, R36).
 *   - "What a member sees": the count and who decides, never a subject (R38).
 *   - "1280 px": the list beside a sticky detail pane, true columns.
 *
 * And two rules no board can show: no raw kind, trust tier, page id or address
 * is ever on screen, and the agent's name is the one the server sends (R34).
 *
 * The rows are built with the server's own sentence builders, so the words
 * are the words the route sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { Router } from "wouter";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token" }));

import SeraDifferences, { SeraSummaryLine, useSeraDifferences } from "./SeraDifferences";
import { listed } from "@/test/seraDifferences";
import type { ListedDifference } from "@/lib/seraReview";
import { countDifferences } from "@shared/seraDifferences";

type Answer = [status: number, body: unknown];

const COUNT = {
  total: 0, toDecide: 0, small: 0, facts: 0, lanes: { facts: 0, lowRisk: 0, decision: 0 }, conflicts: 0, checkFirst: 0, oursAhead: 0,
  decides: { by: "admins" }, paySetBy: { by: "vote" },
};
const TODAY_1405 = () => {
  const d = new Date();
  d.setHours(14, 5, 0, 0);
  return d.toISOString();
};

function listAnswer(differences: ListedDifference[], over: Record<string, unknown> = {}) {
  return {
    agent: "Sera",
    lastReadAt: TODAY_1405(),
    lastReadWhole: true,
    reads: { circles: "whole", roles: "whole" },
    count: COUNT,
    differences: differences.map((d) => ({ batchId: d.lane === "facts" || d.state === "oursAhead" ? null : "sync-1", ...d })),
    circleOrder: ["c-water", "c-kitchen"],
    heldBatches: ["sync-1"],
    ...over,
  };
}

function serve(routes: { count?: Answer; list?: Answer; guide?: Answer; sync?: Answer; listAfterSync?: Answer }) {
  let synced = false;
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    const path = String(url);
    if (path === "/api/saberra/sync" && init?.method === "POST") {
      synced = true;
      const [s, b] = routes.sync ?? [200, {}];
      return { ok: s >= 200 && s < 300, status: s, json: async () => b };
    }
    if (path === "/api/saberra/differences" && synced && routes.listAfterSync) {
      const [s, b] = routes.listAfterSync;
      return { ok: s >= 200 && s < 300, status: s, json: async () => b };
    }
    const [status, body]: Answer =
      path === "/api/saberra/differences/count"
        ? (routes.count ?? [200, { ...COUNT, lastReadAt: TODAY_1405(), lastReadWhole: true }])
        : path === "/api/saberra/differences"
          ? (routes.list ?? [200, listAnswer([])])
          : path === "/api/guide"
            ? (routes.guide ?? [404, {}])
            : [404, {}];
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function Harness({ draftOpen = false, witness = 0 }) {
  const { read, load } = useSeraDifferences();
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Router>
      <SeraSummaryLine read={read} witness={witness} />
      <SeraDifferences read={read} draftOpen={draftOpen} onRetry={load} />
    </Router>
  );
}

const show = (props: Parameters<typeof Harness>[0] = {}) => render(<Harness {...props} />);

/** A wide screen, for the 1280 px board. */
function wideScreen(on: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({ matches: on && q.includes("1280"), media: q, addEventListener: () => {}, removeEventListener: () => {} })),
  );
  window.matchMedia = globalThis.matchMedia as typeof window.matchMedia;
}

const HERE = "Keeps the village's water running: the pumps, the tanks and the lines from the spring, so every house has water every day, and logs every repair in the book by the pump house door so the next keeper knows.";
const SERA = "Keeps the village's water running: the pumps, the storage tanks, the filters and the lines from the spring, so every house has clean water every day, and logs every repair in the book by the pump house door so the next keeper knows.";

/** The "Waiting for you" board: Water with a move, a conflict and a new role; Kitchen with a rest and pay. */
function mainBoard(): ListedDifference[] {
  return [
    listed({ kind: "roleMove", field: "circle", sera: "c-land", ours: "c-water", params: { from: "Water", to: ["Land & Ecology"] }, subject: { name: "Water Steward" } }, "Sera", ["Ana Moss"]),
    listed({ kind: "textField", field: "aim", lane: "lowRisk", state: "conflict", sera: SERA, ours: HERE, subject: { name: "Pump Keeper" } }),
    listed({
      kind: "roleAdd",
      field: null,
      sera: "live",
      ours: null,
      flags: [{ key: "baseUnknown" }, { key: "firstSight" }],
      subject: { ourId: null, name: "Well Monitor" },
    }),
    listed({ kind: "roleRest", field: null, sera: "gone", ours: "live", subject: { name: "Dish Rota", circleId: "c-kitchen", circleName: "Kitchen" } }, "Sera", []),
    listed({
      kind: "pay",
      field: "pay",
      ours: "none",
      sera: "stipend|1200",
      // As the server sends it: pay's base is never known, and the flag rides in the data.
      flags: [{ key: "baseUnknown" }],
      bulkEligible: false,
      params: { model: "Stipend", monthlyUsd: 1200, standing: "pending" },
      subject: { name: "Cook", circleId: "c-kitchen", circleName: "Kitchen" },
    }),
    listed({ kind: "textField", field: "aim", lane: "lowRisk", sera: "Runs the dish rota", ours: "Washes up", subject: { name: "Dishwasher", circleId: "c-kitchen", circleName: "Kitchen" } }),
    listed({ kind: "textField", field: "aim", lane: "lowRisk", sera: "Keeps the pantry", ours: "Pantry", subject: { name: "Pantry Keeper", circleId: "c-kitchen", circleName: "Kitchen" } }),
    listed({ kind: "valueField", field: "Next Review Date", lane: "facts", sera: "1 Dec", ours: null, subject: { name: "Well Monitor" } }),
    listed({ kind: "valueField", field: "Sector", lane: "facts", sera: "Water", ours: null, subject: { name: "Pump Keeper" } }),
    listed({ kind: "rename", state: "oursAhead", sera: "Old Name", ours: "New Name", subject: { name: "Gardener" } }),
  ];
}

beforeEach(() => {
  vi.restoreAllMocks();
  wideScreen(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Waiting for you board", () => {
  it("counts only what waits for a person in the headline, and says the small changes on their own line", async () => {
    serve({ list: [200, listAnswer(mainBoard())] });
    show({ witness: 2 });
    const h2 = await screen.findByRole("heading", { level: 2 });
    // Five: the move, the conflict, the new role, the rest and the pay. The two
    // small changes, the two facts and the one of ours are not in it.
    expect(h2.textContent).toBe("Sera suggests 5 changes for you to decide");
    expect(screen.getByText(/^2 small changes also wait for you, because automatic apply is off\. Last checked 14:05 today\.$/)).toBeTruthy();
    // The summary line's jump links (R37), counting what the headline counts.
    const sera = screen.getByRole("link", { name: "5 Sera changes" });
    expect(sera.getAttribute("href")).toBe("#sera-changes");
    expect(screen.getByRole("link", { name: "2 finished Quests to witness" }).getAttribute("href")).toBe("#witness");
  });

  it("puts what applied by itself on its own line, and the facts folded at the bottom", async () => {
    serve({ list: [200, listAnswer(mainBoard())] });
    show();
    await screen.findByRole("heading", { level: 2 });
    const line = screen.getByText("2 facts updated by themselves since yesterday.", { exact: false });
    expect(line.tagName).toBe("P");
    expect(line.textContent).not.toContain("changes for you to decide");
    const digest = screen.getByText("Facts updated since yesterday: 2").closest("details") as HTMLDetailsElement;
    expect(digest.open).toBe(false);
    // The jump opens it.
    fireEvent.click(screen.getByRole("link", { name: "See them at the bottom of this page." }));
    expect(digest.open).toBe(true);
    expect(within(digest).getByText("Sera's Sector for Pump Keeper is now Water.")).toBeTruthy();
  });

  it("groups by circle with the count in each heading, and puts Check first rows on top", async () => {
    serve({ list: [200, listAnswer(mainBoard())] });
    show();
    const water = await screen.findByRole("heading", { level: 3, name: "Water: 3 changes" });
    // In chart order, which the server sends: Water before Kitchen, though K sorts first.
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Water: 3 changes", "Kitchen: 2 changes"]);
    const rows = within(water.closest("section") as HTMLElement).getAllByRole("article");
    // The new role carries Check first, so it leads the group though it was sent third.
    expect(rows[0].textContent).toContain("Sera suggests a new role, Well Monitor, in Water.");
    expect(rows[0].textContent).toContain("Check first: the first time Sera has sent this");
    // A first sight implies the unknown base, so the screen says only the first (R39).
    expect(rows[0].textContent).not.toContain("no earlier version");
    // Named with who holds it here, in the house form.
    expect(rows[1].textContent).toContain("Sera suggests moving Water Steward (Ana) from Water to Land & Ecology.");
    // The pay row carries the unknown base in its data and shows no chip, so it is not sorted first.
    const kitchen = within(screen.getByRole("heading", { level: 3, name: "Kitchen: 2 changes" }).closest("section") as HTMLElement).getAllByRole("article");
    expect(kitchen[0].textContent).toContain("Sera has archived Dish Rota. It is still live here, and nobody holds it.");
    expect(kitchen[1].textContent).toContain("Sera lists Cook's pay");
    expect(kitchen[1].textContent).not.toContain("Check first");
  });

  it("starts a group of more than eight collapsed, and opens it on request", async () => {
    const many = Array.from({ length: 9 }, (_, i) => listed({ subject: { name: `Role ${i}`, circleId: "c-big", circleName: "Big" } }));
    serve({ list: [200, listAnswer([...many, listed()])] });
    show();
    const toggle = await screen.findByRole("button", { name: /^Big: 9 changes/ });
    expect(screen.getByRole("heading", { level: 3, name: /^Big: 9 changes/ })).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/renaming Role 0/)).toBeNull();
    // Eight or fewer is never collapsed.
    expect(screen.getByRole("heading", { level: 3, name: "Water: 1 change" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/renaming Role 0/)).toBeTruthy();
  });

  it("nests the roles of a new circle under it, and says leaving the circle leaves them", async () => {
    const circle = listed({
      kind: "circleAdd",
      field: null,
      params: { roles: 2 },
      subject: { kind: "circle", pageId: "landpage", ourId: null, name: "Land Stewardship", circleId: null, circleName: null },
    });
    const role = (name: string) =>
      listed({ kind: "roleAdd", field: null, subject: { ourId: null, name, circleId: "sera:landpage", circleName: "Land Stewardship" } });
    serve({ list: [200, listAnswer([role("Soil Keeper"), circle, role("Seed Saver")])] });
    show();
    const h = await screen.findByRole("heading", { level: 3, name: "Land Stewardship: 3 changes" });
    const rows = within(h.closest("section") as HTMLElement).getAllByRole("article");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Sera suggests a new circle, Land Stewardship, with 2 roles.");
    expect(within(rows[0]).getByText("Its 2 roles come with it, and leaving the circle out leaves them out too.")).toBeTruthy();
    expect(within(rows[0]).getByText("Sera suggests a new role, Soil Keeper, in Land Stewardship.")).toBeTruthy();
  });

  it("filters to the Check first and the conflicts, and back", async () => {
    serve({ list: [200, listAnswer(mainBoard())] });
    show();
    await screen.findByRole("heading", { level: 2 });
    // What is shown is said under the chips, in the status line (Q4).
    const shown = () => screen.getAllByRole("status").map((s) => s.textContent).join(" ");
    expect(shown()).toContain("Showing 5 changes: To decide");
    fireEvent.click(screen.getByRole("button", { name: "Conflicts 1" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(shown()).toContain("Showing 1 change: Conflicts");
    expect(screen.getByRole("button", { name: "Conflicts 1" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Check first 1" }));
    expect(screen.getAllByRole("article")[0].textContent).toContain("Well Monitor");
    fireEvent.click(screen.getByRole("button", { name: "To decide 5" }));
    expect(screen.getAllByRole("article")).toHaveLength(5);
    // The lane and the circle live behind Filter.
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Which changes"), { target: { value: "all" } });
    expect(shown()).toContain("Showing all 7 waiting changes");
    fireEvent.change(screen.getByLabelText("Which changes"), { target: { value: "small" } });
    expect(screen.getAllByRole("article")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Circle"), { target: { value: "c-water" } });
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Show everything waiting" }));
    expect(screen.getAllByRole("article")).toHaveLength(7);
  });

  it("tells our changes the service has not caught up with in one quiet line", async () => {
    serve({ list: [200, listAnswer(mainBoard())] });
    show();
    await screen.findByRole("heading", { level: 2 });
    expect(
      screen.getByText(
        /^1 thing you changed here is still the old way in Sera\. Sera doesn't hear about changes made here, so update it in Sera if you want both to match\./,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See which one" }));
    expect(screen.getByText("Gardener was renamed here. Sera still calls it Old Name.")).toBeTruthy();
  });

  it("offers no button that would do nothing: each decision goes to the structure review", async () => {
    serve({ list: [200, listAnswer(mainBoard())] });
    show();
    await screen.findByRole("heading", { level: 2 });
    for (const dead of [/Add to draft/, /Keep ours/, /Apply now/, /Take Sera/, /^Edit/, /Undo/, /Retire it here/, /Ask the Treasurer/]) {
      expect(screen.queryByRole("button", { name: dead })).toBeNull();
      expect(screen.queryByRole("link", { name: dead })).toBeNull();
    }
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    const links = screen.getAllByRole("link", { name: "Decide it in the structure review" });
    // The move, the new role and the rest. The conflict compares first, and pay is set by hand.
    expect(links).toHaveLength(3);
    for (const l of links) expect(l.getAttribute("href")).toBe("/review/structure/sync-1");
    // Who sets pay comes from the count's door (S2): after launch with nobody holding it, the vote line.
    expect(screen.getByText("Nobody holds the power to set pay right now.")).toBeTruthy();
  });

  it("says who sets pay, from who holds the power to set it here, in the house form", async () => {
    serve({
      list: [200, listAnswer(mainBoard())],
      count: [200, { ...COUNT, lastReadAt: TODAY_1405(), lastReadWhole: true, paySetBy: { by: "holders", labels: ["Treasurer (Rick)"], more: 0, stewards: false, others: 0 } }],
    });
    show();
    expect(await screen.findByText("The Treasurer (Rick) sets pay.")).toBeTruthy();
    expect(screen.queryByText(/Nobody holds the power to set pay/)).toBeNull();
  });

  it("counts Check first by the flags shown, never by a flag the screen leaves off", async () => {
    serve({ list: [200, listAnswer(mainBoard())] });
    show();
    await screen.findByRole("heading", { level: 2 });
    // Two rows carry a flag in their data (the new role and the pay); one shows a chip.
    expect(screen.getByRole("button", { name: "Check first 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check first 1" }));
    expect(screen.getAllByRole("article").map((a) => a.textContent?.includes("Well Monitor"))).toEqual([true]);
  });

  it("links each row to the arrival that holds it, and says plainly when none does (C7)", async () => {
    const board = mainBoard();
    serve({ list: [200, listAnswer(board.map((d) => ({ ...d, batchId: d.kind === "roleMove" ? "sync-move" : null })))] });
    show();
    await screen.findByRole("heading", { level: 2 });
    const links = screen.getAllByRole("link", { name: "Decide it in the structure review" });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/review/structure/sync-move"]);
    expect(screen.getAllByText("No arrival from Sera waits in the structure review right now.").length).toBe(2);
  });

  it("puts a new circle and its roles in one group when the service sends dashed page ids (C4)", async () => {
    const C = "1a2b3c4d-1111-2222-3333-444455556666";
    const circle = listed({ kind: "circleAdd", field: null, params: { roles: 1 }, subject: { kind: "circle", pageId: C, ourId: null, name: "Land Stewardship", circleId: null, circleName: null } });
    const role = listed({ kind: "roleAdd", field: null, subject: { ourId: null, name: "Seed Keeper", circleId: `sera:${C.replace(/-/g, "")}`, circleName: "Land Stewardship" } });
    serve({ list: [200, listAnswer([circle, role])] });
    show();
    expect(await screen.findByRole("heading", { level: 3, name: "Land Stewardship: 2 changes" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
  });

  it("draws one Not in a circle group, never two", async () => {
    const a = listed({ subject: { name: "Alpha", circleId: null, circleName: null } });
    const b = listed({ subject: { name: "Beta", circleId: "c-gone", circleName: null } });
    serve({ list: [200, listAnswer([a, b])] });
    show();
    expect(await screen.findByRole("heading", { level: 3, name: "Not in a circle: 2 changes" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
  });

  it("says one set of numbers everywhere: the summary, the headline, the member view, the small line and the count (C8)", async () => {
    const mix = [
      ...["A", "B", "C"].map((n) => listed({ subject: { name: `Decide ${n}` } })),
      ...["D", "E"].map((n) => listed({ kind: "textField", field: "aim", lane: "lowRisk", subject: { name: `Small ${n}` } })),
      ...["F", "G", "H", "I"].map((n) => listed({ kind: "valueField", field: "Role Type", lane: "facts", sera: "Core", ours: null, subject: { name: `Fact ${n}` } })),
    ];
    const count = { ...countDifferences(mix), lastReadAt: TODAY_1405(), lastReadWhole: true, decides: { by: "admins" }, paySetBy: { by: "admins" } };
    expect(count).toMatchObject({ toDecide: 3, small: 2, facts: 4, total: 5 });
    serve({ count: [200, count], list: [200, listAnswer(mix, { count })] });
    show({ witness: 0 });
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("Sera suggests 3 changes for you to decide");
    expect(screen.getByRole("link", { name: "3 Sera changes" })).toBeTruthy();
    expect(screen.getByText(/^2 small changes also wait for you/)).toBeTruthy();
    cleanup();
    serve({ count: [200, count], list: [401, { error: "auth_required" }], guide: [200, { options: [{ id: "saberra", name: "Sera" }] }] });
    show();
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("Sera suggests 3 changes for the chart");
  });
});

describe("the conflict board", () => {
  it("diffs the compared form, so a name the swap took out is never struck (K5)", async () => {
    const both = listed({ kind: "textField", field: "aim", lane: "lowRisk", state: "conflict", sera: "a member keeps the wells clear.", ours: "a member keeps the wells.", subject: { name: "Well Keeper" } });
    serve({ list: [200, listAnswer([{ ...both, oursAsStored: "Jane Example keeps the wells." }])] });
    show();
    await screen.findByRole("heading", { level: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Compare them" }));
    const theirs = screen.getByRole("heading", { level: 3, name: "Sera's version" }).closest("section") as HTMLElement;
    expect(Array.from(theirs.querySelectorAll("del")).map((d) => d.textContent).join(" ")).not.toContain("Jane");
    expect(Array.from(theirs.querySelectorAll("ins")).map((d) => d.textContent).join(" ")).toContain("clear.");
    expect(theirs.querySelector("p")?.textContent).not.toContain("Jane");
    // Here now still shows our words as stored.
    const here = screen.getByRole("heading", { level: 3, name: "Here now" }).closest("section") as HTMLElement;
    expect(here.querySelector("p")?.textContent).toBe("Jane Example keeps the wells.");
  });

  it("shows our words as stored under Here now, never the compared form", async () => {
    const both = listed({ kind: "textField", field: "aim", lane: "lowRisk", state: "conflict", sera: "Keeps the wells.", ours: "keeps the wells clear.", subject: { name: "Well Keeper" } });
    serve({ list: [200, listAnswer([{ ...both, oursAsStored: "Keeps  the wells clear, with Jane Example." }])] });
    show();
    await screen.findByRole("heading", { level: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Compare them" }));
    const here = screen.getByRole("heading", { level: 3, name: "Here now" }).closest("section") as HTMLElement;
    expect(here.querySelector("p")?.textContent).toBe("Keeps  the wells clear, with Jane Example.");
  });

  it("stacks Here now over the service's version, with one merged diff and a four-line clamp", async () => {
    serve({ list: [200, listAnswer(mainBoard())] });
    show();
    await screen.findByRole("heading", { level: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Compare them" }));
    const h2 = screen.getByRole("heading", { level: 2 });
    // The board's own sentence, the same on the row, here and in the 1280 pane.
    expect(h2.textContent).toBe("You and Sera both changed Pump Keeper's purpose.");
    expect(document.activeElement).toBe(h2);
    const [here, theirs] = screen.getAllByRole("heading", { level: 3 });
    expect(here.textContent).toBe("Here now");
    expect(theirs.textContent).toBe("Sera's version");
    // Stacked: Here now comes first in the reading order.
    expect(here.compareDocumentPosition(theirs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const seraBlock = theirs.closest("section") as HTMLElement;
    const struck = Array.from(seraBlock.querySelectorAll("del")).map((d) => d.textContent);
    const added = Array.from(seraBlock.querySelectorAll("ins")).map((d) => d.textContent).join(" ");
    expect(struck.length).toBeGreaterThan(0);
    expect(added).toContain("filters");
    expect(added).toContain("clean");
    // Never colour alone: the marks are strike and underline, and a sentence says which is which.
    expect(seraBlock.querySelector("del")?.className).toContain("line-through");
    expect(seraBlock.querySelector("ins")?.className).toContain("underline");
    expect(within(seraBlock).getByText("Struck words are only here. Underlined words are only in Sera's version.")).toBeTruthy();
    // A screen reader hears which words went and which came (nit).
    expect(seraBlock.querySelector("del")?.previousElementSibling?.textContent).toBe("removed: ");
    expect(seraBlock.querySelector("ins")?.previousElementSibling?.textContent).toBe("added: ");
    // Clamped to four lines until the reader asks for both in full.
    const ours = (here.closest("section") as HTMLElement).querySelector("p") as HTMLElement;
    expect(ours.className).toContain("line-clamp-4");
    const more = within(seraBlock).getByRole("button", { name: "Read both in full" });
    fireEvent.click(more);
    expect(ours.className).not.toContain("line-clamp-4");
    expect(more.getAttribute("aria-expanded")).toBe("true");
    // Back to the list, focus on the button that opened it, settled inside the click itself.
    fireEvent.click(screen.getByRole("button", { name: "Back to all 5" }));
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe("Compare them");
  });
});

describe("the read states", () => {
  const at = (h: number) => {
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    return d.toISOString();
  };

  it("says the service did not answer, which check the list is from, and checks again", async () => {
    const fetchMock = serve({
      list: [200, listAnswer(mainBoard(), { lastReadWhole: false, reads: { circles: "failed", roles: "failed" }, lastWholeAt: { circles: at(9), roles: at(9) } })],
    });
    show();
    expect(await screen.findByRole("heading", { level: 3, name: "Sera didn't answer at 14:05" })).toBeTruthy();
    expect(screen.getByText("This list is from the last full check, at 09:00. Nothing changed on the chart.")).toBeTruthy();
    expect(screen.getByText(/^Nothing counts as removed because of a check that failed\./)).toBeTruthy();
    // The list it is from still shows.
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Sera suggests 5 changes for you to decide");
    // Check again asks the service through the by-hand sync (Q3), and says so inside the card.
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    const card = screen.getByRole("heading", { level: 3, name: "Sera didn't answer at 14:05" }).closest("section") as HTMLElement;
    await waitFor(() => expect(within(card).getByRole("status").textContent).toMatch(/^Sera still didn't answer at \d\d:\d\d\.$/));
    expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/saberra/sync" && (i as { method?: string } | undefined)?.method === "POST")).toBe(true);
  });

  it("says the service answered when the by-hand sync reads it whole, and a refusal in its own words (Q3)", async () => {
    const failed = listAnswer(mainBoard(), { lastReadWhole: false, reads: { circles: "failed", roles: "failed" } });
    serve({ list: [200, failed], sync: [200, {}], listAfterSync: [200, listAnswer(mainBoard())] });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getAllByRole("status").map((s) => s.textContent).join(" ")).toMatch(/Sera answered at \d\d:\d\d\./));
    cleanup();
    serve({ list: [200, failed], sync: [409, { error: "A sync is already running. Its report appears under Sync now when it finishes.", state: "busy" }] });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    // The words are true on this page: there is no Sync now here (R3-2).
    await waitFor(() => expect(screen.getAllByRole("status").map((s) => s.textContent).join(" ")).toContain("A sync is already running. Try again in a minute."));
    expect(document.body.textContent).not.toContain("Sync now");
  });

  it("names the one kind that did not come through, and never empties the list for it", async () => {
    serve({
      list: [200, listAnswer(mainBoard(), { lastReadWhole: false, reads: { circles: "whole", roles: "failed" }, lastWholeAt: { circles: TODAY_1405(), roles: at(9) } })],
    });
    show();
    expect(await screen.findByText("Roles didn't come through at 14:05, so roles show the 09:00 check. Circles are current.")).toBeTruthy();
    expect(screen.queryByText(/didn't answer/)).toBeNull();
    expect(screen.getAllByRole("article").length).toBe(5);
  });

  it("is in step only when the read was whole, nothing waits and no draft is open", async () => {
    const facts = mainBoard().filter((d) => d.lane === "facts");
    serve({ list: [200, listAnswer(facts)] });
    show();
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("The chart and Sera are in step");
    expect(screen.getByText("Last checked 14:05 today. Nothing waits for you, and no draft is open.")).toBeTruthy();
    expect(screen.getByText("2 facts updated by themselves since yesterday.", { exact: false })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Small changes apply by themselves: off" })).toBeTruthy();
    cleanup();

    serve({ list: [200, listAnswer(facts)] });
    show({ draftOpen: true });
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("Nothing from Sera waits for you");
    cleanup();

    serve({ list: [200, listAnswer(facts, { lastReadWhole: false, reads: { circles: "cut-short", roles: "whole" } })] });
    show();
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("Nothing from Sera waits for you");
    expect(screen.getByText(/^Circles came through cut short at 14:05/)).toBeTruthy();
  });

  it("renders a failed read of the list as a failure, never as an empty list or in step", async () => {
    serve({ list: [500, { error: "Could not read the differences." }] });
    show();
    expect(await screen.findByRole("heading", { level: 2, name: "The list of changes did not load" })).toBeTruthy();
    expect(screen.getByText(/this is not an empty list/)).toBeTruthy();
    expect(screen.queryByText(/in step/)).toBeNull();
  });

  it("draws nothing at all for a village with the module off", async () => {
    const fetchMock = serve({ count: [404, { error: "module_disabled" }] });
    const { container } = show();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual(["/api/saberra/differences/count"]);
  });
});

describe("what a member sees", () => {
  // The board's set: four decisions and a purpose conflict to decide, two small changes, three facts.
  const count = {
    ...COUNT, total: 7, toDecide: 5, small: 2, facts: 3, lanes: { facts: 3, lowRisk: 3, decision: 4 }, conflicts: 1, lastReadAt: TODAY_1405(), lastReadWhole: true,
    decides: { by: "holders", labels: ["Ops lead (Rye)"], more: 0, stewards: true, others: 0 },
  };
  const guide = { choice: "village", options: [{ id: "village", name: "the village guide" }, { id: "saberra", name: "Sera" }] };

  it("shows the count and who decides, and never a subject", async () => {
    serve({
      count: [200, count],
      list: [401, { error: "auth_required" }],
      guide: [200, guide],
    });
    show();
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("Sera suggests 5 changes for the chart");
    expect(await screen.findByText("Ops lead (Rye) and the stewards decide them.")).toBeTruthy();
    expect(screen.getByText("Small changes applying by themselves: off.")).toBeTruthy();
    expect(screen.getByText(/^Members see how many changes wait and who decides them\./)).toBeTruthy();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("asks no list a member may not read, and tells a decider how the changes reach them (Q5)", async () => {
    const fetchMock = serve({ count: [200, { ...count, reader: { mayRead: false, decides: true } }], guide: [200, guide] });
    show();
    expect(await screen.findByText("These reach you as a draft to publish, once someone who reads the list puts them in one.")).toBeTruthy();
    expect(fetchMock.mock.calls.map(([u]) => String(u))).not.toContain("/api/saberra/differences");
    cleanup();
    serve({ count: [200, { ...count, reader: { mayRead: false, decides: false } }], guide: [200, guide] });
    show();
    await screen.findByRole("heading", { level: 2 });
    expect(screen.queryByText(/These reach you as a draft/)).toBeNull();
  });

  it("says the village decides by vote when nobody holds the power", async () => {
    serve({
      count: [200, { ...count, decides: { by: "vote" } }],
      list: [401, { error: "auth_required" }],
      guide: [200, guide],
    });
    show();
    expect(await screen.findByText("Nobody holds the power to decide these right now, so the village decides by vote.")).toBeTruthy();
  });
});

describe("what is never on screen", () => {
  it("shows no raw kind, lane, state, trust tier, page id, key or address", async () => {
    const board = mainBoard();
    serve({ list: [200, listAnswer(board)] });
    show();
    await screen.findByRole("heading", { level: 2 });
    fireEvent.click(screen.getByText("Facts updated since yesterday: 2"));
    fireEvent.click(screen.getByRole("button", { name: "See which one" }));
    const text = document.body.textContent ?? "";
    for (const raw of ["circleAdd", "roleAdd", "roleRest", "roleMove", "textField", "valueField", "lowRisk", "oursAhead", "baseUnknown", "firstSight", "extracted_unreviewed", "https://", "dashboard.example.org", "c-water", "c-land", "stipend|1200"]) {
      expect(text).not.toContain(raw);
    }
    for (const d of board) {
      expect(text).not.toContain(d.key);
      expect(text).not.toContain(String(d.source.pageId));
    }
    // The address is only ever the link's target, under the words "Open in Sera".
    const open = screen.getAllByRole("link", { name: "Open in Sera" });
    expect(open.length).toBeGreaterThan(0);
    expect(open[0].getAttribute("href")).toMatch(/^https:\/\/dashboard\.example\.org\/ws\//);
  });

  it("names the agent the server names and no village, anywhere (R34)", async () => {
    const maia = mainBoard().map((d) => listed({ ...d, subject: d.subject }, "Maia"));
    serve({ list: [200, listAnswer(maia, { agent: "Maia", lastReadWhole: false, reads: { circles: "failed", roles: "failed" } })] });
    show({ witness: 1 });
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("Maia suggests 5 changes for you to decide");
    // Every view the reader can reach, each read whole: the list, the compare, and the folded parts.
    const seen: string[] = [];
    fireEvent.click(screen.getByText("Facts updated since yesterday: 2"));
    fireEvent.click(screen.getByRole("button", { name: "See which one" }));
    seen.push(document.body.textContent ?? "");
    fireEvent.click(screen.getByRole("button", { name: "Compare them" }));
    expect(screen.getByRole("heading", { level: 3, name: "Maia's version" })).toBeTruthy();
    seen.push(document.body.textContent ?? "");
    fireEvent.click(screen.getByRole("button", { name: "Back to all 5" }));
    expect(seen[0]).toContain("Maia didn't answer");
    expect(seen[1]).toContain("Underlined words are only in Maia's version.");
    for (const text of seen) {
      expect(text).not.toMatch(/\bSera\b/);
      expect(text).not.toMatch(/amora/i); // brand-ok: the assertion that the copy names no village
    }
  });
});

describe("the 1280 px board", () => {
  it("puts the list beside a sticky detail pane, with true columns for a conflict", async () => {
    wideScreen(true);
    serve({ list: [200, listAnswer(mainBoard())] });
    show();
    await screen.findByRole("heading", { level: 2 });
    const pane = document.getElementById("sera-pane") as HTMLElement;
    expect(pane).toBeTruthy();
    expect(pane.className).toContain("sticky");
    // The first row is shown first, and pressing another shows that one.
    const firstRow = screen.getAllByRole("button", { current: true })[0];
    expect(within(pane).getByRole("heading", { level: 3 }).textContent).toBe(firstRow.querySelector("span")?.textContent?.replace(/\.$/, ""));
    fireEvent.click(screen.getByRole("button", { name: /You and Sera both changed Pump Keeper's purpose/ }));
    expect(within(pane).getByRole("heading", { level: 3 }).textContent).toBe("You and Sera both changed Pump Keeper's purpose");
    const cols = within(pane).getAllByRole("heading", { level: 4 });
    expect(cols.map((h) => h.textContent)).toEqual(["Here now", "Sera's version"]);
    expect((cols[0].parentElement?.parentElement as HTMLElement).className).toContain("grid-cols-2");
    // A button holds phrasing content only: its chips are spans (nit).
    expect(firstRow.querySelector("p")).toBeNull();
    // Compact rows: no source line and no actions in the list column.
    expect(screen.getAllByRole("link", { name: "Decide it in the structure review" })).toHaveLength(1);
    expect(screen.getAllByRole("article").every((a) => !a.textContent?.includes("Edited in Sera"))).toBe(true);
  });
});
