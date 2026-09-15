// @vitest-environment jsdom
/**
 * The needs ceremony, read off the rendered screen.
 *
 * WHAT THIS PINS, and every one of them is a thing this repository has been
 * bitten by before:
 *
 *   1. THE INPUT SURVIVES A KEYSTROKE. `Section` was once declared inside
 *      `SetupWizard`'s body, which made a new component TYPE on every render,
 *      and React replaced the whole subtree on every letter. The founder of
 *      the live village reported it as "every time I type a single letter it
 *      takes down my keyboard". The custom-need field is this file's version
 *      of that input, and the assertion is node identity (`toBe`, never
 *      `toEqual`: two inputs with identical attributes ARE the bug).
 *   2. THE TEN CARDS CARRY THE DECK'S OWN EXPRESSIONS. They come from
 *      `shared/needs.ts` and are never retyped here, so a rename there is a
 *      rename on screen and this test reads the shared value.
 *   3. A REFUSAL IS PRINTED AS RECEIVED. The server refuses in whole
 *      sentences; a toast that paraphrases one is a toast that drifts.
 *   4. UNTICKING RETIRES AND RE-TICKING PUTS. The route retires nothing on a
 *      PUT by design, so unticking has to be its own call, and re-ticking has
 *      to go back through the PUT because the upsert is what clears
 *      `retired_at`.
 *   5. THE SUMMARY SENTENCE IS EXACT. It is the one a founder reads aloud.
 *
 * `fetch` is stubbed. What is under test is this panel's wiring and its words;
 * the routes behind it have their own server tests.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HUMAN_NEEDS, expressionsLine } from "@shared/needs";

import NeedsPanel from "./NeedsPanel";
import { needSentence, totalitySentence, uncoveredSentence, type ScopeRow } from "./needsCopy";

const scopeRow = (over: Partial<ScopeRow> & { needKey: string; label: string }): ScopeRow => ({
  id: `vneed-${over.needKey}`,
  isCustom: false,
  depthTarget: "satisfied",
  breadthTargetPct: 100,
  note: null,
  sortOrder: 0,
  active: true,
  ...over,
});

/** Four of the ten, at Satisfied, for everyone. The summary case in the brief. */
const FOUR_OF_TEN: ScopeRow[] = [
  scopeRow({ needKey: "vitality", label: "Vitality & Survival Needs", sortOrder: 0 }),
  scopeRow({ needKey: "love", label: "Love", sortOrder: 2 }),
  scopeRow({ needKey: "growth", label: "Growth", sortOrder: 3 }),
  scopeRow({ needKey: "play", label: "Play", sortOrder: 8 }),
];

const summaryOf = (rows: ScopeRow[]) => ({
  answered: rows.length > 0,
  adopted: rows.filter((r) => r.active).length,
  platformAdopted: rows.filter((r) => r.active && !r.isCustom).length,
  customAdopted: rows.filter((r) => r.active && r.isCustom).length,
  retired: rows.filter((r) => !r.active).length,
  deepestTarget: "satisfied" as const,
});

interface StubOptions {
  scope?: ScopeRow[];
  /** The body and status a PUT to the scope answers with. */
  putRefusal?: { status: number; body: unknown };
}

const calls: Array<{ url: string; method: string; body: any }> = [];

function stubFetch(opts: StubOptions = {}) {
  const scope = opts.scope ?? [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const path = String(url);
      const method = String(init?.method ?? "GET");
      calls.push({ url: path, method, body: init?.body ? JSON.parse(init.body) : null });
      if (method === "GET" && path.endsWith("/needs/scope")) {
        return { ok: true, status: 200, json: async () => ({ scope, summary: summaryOf(scope) }) };
      }
      if (method === "GET" && path.endsWith("/needs/coverage")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            answered: scope.length > 0,
            summary: summaryOf(scope),
            coverage: scope
              .filter((r) => r.active)
              .map((r) => ({
                needKey: r.needKey,
                label: r.label,
                depthTarget: r.depthTarget,
                breadthTargetPct: r.breadthTargetPct,
                counts: { quest: 0, role: 0, sink: 0, stay: 0, event: 0, place: 0 },
                total: 0,
                primaryCount: 0,
                uncovered: true,
              })),
            seatings: [],
            uncovered: scope.filter((r) => r.active).map((r) => r.needKey),
          }),
        };
      }
      if (method === "GET" && path.endsWith("/org")) {
        return { ok: true, status: 200, json: async () => ({ roles: [{ id: "r1", name: "Water Steward" }] }) };
      }
      if (method === "GET" && path.endsWith("/quests")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (method === "PUT" && path.endsWith("/admin/needs/scope")) {
        if (opts.putRefusal) {
          return { ok: false, status: opts.putRefusal.status, json: async () => opts.putRefusal!.body };
        }
        return { ok: true, status: 200, json: async () => ({ success: true, saved: [] }) };
      }
      if (method === "POST" && path.endsWith("/admin/needs/retire")) {
        return { ok: true, status: 200, json: async () => ({ success: true, changed: true }) };
      }
      if (method === "POST" && path.endsWith("/admin/needs/links")) {
        return { ok: true, status: 200, json: async () => ({ success: true, link: { id: "nlink-1" } }) };
      }
      if (method === "DELETE" && path.includes("/admin/needs/links/")) {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

const openPanel = async () => {
  render(<NeedsPanel password="secret" />);
  return await screen.findByRole("heading", { level: 3, name: "What this village is for" });
};

describe("NeedsPanel", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the ten needs with the deck's own expressions as the hint", async () => {
    stubFetch();
    await openPanel();
    expect(HUMAN_NEEDS).toHaveLength(10);
    for (const need of HUMAN_NEEDS) {
      expect(screen.getByText(need.label)).toBeInTheDocument();
      // The hint line is `expressionsLine`'s value and is never retyped here,
      // so a rename in shared/needs.ts is a rename on screen.
      expect(screen.getByText(expressionsLine(need))).toBeInTheDocument();
    }
  });

  it("holds the same custom-need input, still focused, after every keystroke", async () => {
    stubFetch();
    const user = userEvent.setup();
    await openPanel();
    const input = screen.getByLabelText("A need this list does not name");

    input.focus();
    expect(document.activeElement).toBe(input);

    const letters = ["Q", "u", "i", "e", "t"];
    for (let i = 0; i < letters.length; i += 1) {
      await user.keyboard(letters[i]);
      const now = screen.getByLabelText("A need this list does not name");
      expect(now, `the input was replaced on keystroke ${i + 1}`).toBe(input);
      expect(
        document.activeElement,
        `focus left the input on keystroke ${i + 1}, which is what drops the phone keyboard`,
      ).toBe(input);
      expect(input).toHaveValue(letters.slice(0, i + 1).join(""));
    }
  });

  it("refuses a custom need that names one of the ten, in the shared rule's own words", async () => {
    stubFetch();
    const user = userEvent.setup();
    await openPanel();
    await user.type(screen.getByLabelText("A need this list does not name"), "Love");
    await user.click(screen.getByRole("button", { name: "Add this need" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "is one of the ten needs. Tick it in the list instead of writing your own.",
    );
  });

  it("prints a refused save exactly as the server said it", async () => {
    const sentence = "A breadth is a whole number of percent, from 0 to 100.";
    stubFetch({ putRefusal: { status: 400, body: { error: sentence } } });
    const user = userEvent.setup();
    await openPanel();
    await user.click(screen.getByRole("checkbox", { name: /Love/ }));
    await user.click(screen.getByRole("button", { name: "Save what this village is for" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
  });

  it("puts a re-ticked need and retires an unticked one, and never the other way round", async () => {
    // Love is in scope; Play is not. Untick Love, tick Play, save.
    stubFetch({ scope: [scopeRow({ needKey: "love", label: "Love" })] });
    const user = userEvent.setup();
    await openPanel();
    await user.click(screen.getByRole("checkbox", { name: /Love/ }));
    await user.click(screen.getByRole("checkbox", { name: /Play/ }));
    await user.click(screen.getByRole("button", { name: "Save what this village is for" }));
    await screen.findByText(/Saved\./);

    const put = calls.find((c) => c.method === "PUT" && c.url.endsWith("/admin/needs/scope"));
    const retire = calls.find((c) => c.method === "POST" && c.url.endsWith("/admin/needs/retire"));
    expect(put).toBeTruthy();
    expect(retire).toBeTruthy();
    // The PUT carries only what is ticked, and NEVER the need being taken out:
    // the route retires nothing, so a PUT naming Love would revive it.
    expect(put!.body.needs.map((n: any) => n.needKey)).toEqual(["play"]);
    expect(retire!.body).toEqual({ needKey: "love" });
    // Order matters: a refused PUT must not leave needs already retired.
    expect(calls.indexOf(put!)).toBeLessThan(calls.indexOf(retire!));
  });

  it("says the summary sentence for four of ten at Satisfied for everyone", async () => {
    stubFetch({ scope: FOUR_OF_TEN });
    const user = userEvent.setup();
    await openPanel();
    await user.click(screen.getByRole("button", { name: "6. The whole of it" }));

    const sentence =
      "This village aims to meet 4 of the 10 needs, at Satisfied or better, for all of its members.";
    expect(totalitySentence(FOUR_OF_TEN, true)).toBe(sentence);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(needSentence(FOUR_OF_TEN[1])).toBe("Love, at Satisfied or better, for every member.");
    expect(screen.getByText(needSentence(FOUR_OF_TEN[1]))).toBeInTheDocument();
  });

  it("names a need nothing meets, and never prints a bare zero for it", async () => {
    stubFetch({ scope: FOUR_OF_TEN });
    const user = userEvent.setup();
    await openPanel();
    await user.click(screen.getByRole("button", { name: "5. What meets them" }));
    expect(uncoveredSentence("Growth")).toBe(
      "Nothing in this village meets Growth yet. A quest or a seat tagged to it will show here.",
    );
    expect(await screen.findByText(uncoveredSentence("Growth"))).toBeInTheDocument();
  });

  it("tags a thing as meeting a need, and takes that tag off again", async () => {
    stubFetch({ scope: FOUR_OF_TEN });
    const user = userEvent.setup();
    await openPanel();
    await user.click(screen.getByRole("button", { name: "5. What meets them" }));
    await screen.findByText("Tag one thing as meeting one need");

    await user.selectOptions(await screen.findByLabelText("The need"), "love");
    await user.selectOptions(await screen.findByLabelText("What meets it"), "role:r1");
    await user.click(screen.getByRole("button", { name: "Tag it" }));

    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/admin/needs/links"));
    expect(post!.body).toMatchObject({ needKey: "love", subjectType: "role", subjectRef: "r1" });

    await user.click(await screen.findByRole("button", { name: "Take this tag off" }));
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/admin/needs/links/nlink-1"))).toBe(true);
  });

  it("says nobody has looked when the scope read refuses, and never prints a zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "auth_required" }) })),
    );
    render(<NeedsPanel password="secret" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("auth_required");
    expect(screen.queryByText(/aims to meet 0 of/)).not.toBeInTheDocument();
  });

  it("keeps a village that took on nothing apart from one that has not answered", async () => {
    expect(totalitySentence([], false)).toBe("This village has not said which needs it is taking on.");
    expect(totalitySentence([], true)).toBe(
      "This village has taken on none of the needs on its list. Everything it named has been retired.",
    );
  });

  it("keeps the six screens reachable and marks the one a founder is on", async () => {
    stubFetch({ scope: FOUR_OF_TEN });
    const user = userEvent.setup();
    await openPanel();
    const rail = screen.getByRole("navigation", { name: "The six screens of the needs setup" });
    expect(within(rail).getAllByRole("button")).toHaveLength(6);
    await user.click(within(rail).getByRole("button", { name: "4. How much of each person's needs" }));
    expect(within(rail).getByRole("button", { name: "4. How much of each person's needs" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    // Screen 4 says the figure and says plainly that no dial reads it.
    expect(
      await screen.findByText(/The dial that would take this figure and size the economy around it is not built/),
    ).toBeInTheDocument();
  });

  it("gives the depth ladder five keyboard-operable rungs per need", async () => {
    stubFetch({ scope: FOUR_OF_TEN });
    const user = userEvent.setup();
    await openPanel();
    await user.click(screen.getByRole("button", { name: "2. How far, on each" }));
    const group = await screen.findByRole("radiogroup", {
      name: "How far this village means to get on Love",
    });
    const rungs = within(group).getAllByRole("radio");
    expect(rungs).toHaveLength(5);
    expect(within(group).getByRole("radio", { name: /Satisfied/ })).toBeChecked();
    await user.click(within(group).getByRole("radio", { name: /Thriving/ }));
    expect(within(group).getByRole("radio", { name: /Thriving/ })).toBeChecked();
  });
});
