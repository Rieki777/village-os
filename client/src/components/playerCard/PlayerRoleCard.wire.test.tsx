// @vitest-environment jsdom
/**
 * PR 8: the pieces that were modelled and tested but on no page, drawn on the
 * live card from the real model. Accomplished, the owner's own words saved
 * through the season plan routes (#530), the load slider, the role's handover
 * words proposed by consent (#534), and the handover meter from the shared
 * six checks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HANDOVER_CHECK_WORDS, ROLE_HANDOVER_WORDS } from "@shared/roleHandover";
import { EDIT_WORDS } from "@shared/playerCardEdit";
import { PlayerRoleCardView } from "./PlayerRoleCard";
import { cardBodyFor } from "./playerCardApi";
import { FIXTURE_ROLE_TITLE, fixturePayload } from "@/test/playerCardFixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Call = { url: string; method: string; body: unknown };

/** A fetch that answers by path, and records every call. */
function routes(answers: Record<string, { status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET");
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const a = answers[`${method} ${url}`] ?? { status: 404, body: { error: "Not found" } };
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body };
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const MINE = {
  season: { id: "s2", name: "Season of Foundations", startsOn: "2026-10-01", endsOn: "2026-12-31", goals: ["Clear organisation", "Food forest"] },
  window: null,
  plan: {
    version: 2,
    aim: "Every role has a ratified card.",
    servesGoal: "Clear organisation",
    servesGoals: [{ goal: "Clear organisation", howItHelps: "Cards for every role." }],
    seasonalGoals: [],
    commitments: {},
    handingBack: [],
    savedOn: "2026-10-20",
  },
  filed: null,
  changedSinceFiling: false,
  heldSeats: [],
  applications: [],
  questsThisMoon: { done: 0 },
  cardWords: { howIHold: "Slowly and in the open.", findMe: "Mornings." },
  moonLoad: null,
};

const MOONS = [
  {
    id: "m2",
    startsAt: "2026-10-10T12:00:00Z",
    endsAt: "2026-11-09T12:00:00Z",
    items: [
      { entryId: 41, text: "Welcome pack written", ownerNo: 3, roleId: "r1", doneByNo: 3, doneAt: "2026-10-18T15:00:00Z", acceptedAt: "2026-10-20T15:00:00Z", note: "Clear and kind." },
    ],
  },
  {
    id: "m1",
    startsAt: "2026-09-10T12:00:00Z",
    endsAt: "2026-10-10T12:00:00Z",
    items: [{ entryId: 7, text: "Intake form tested", ownerNo: 3, roleId: null, doneByNo: 3, doneAt: null, acceptedAt: "2026-09-21T15:00:00Z", note: null }],
  },
];

describe("Accomplished, on the live card", () => {
  it("draws the tasks grouped by moon, each with its date and note, under Accomplished", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "member", { accomplished: MOONS })} />);
    const section = document.querySelector("[data-card-accomplished]") as HTMLElement;
    expect(within(section).getByRole("heading", { name: "Accomplished" })).toBeTruthy();
    const moons = within(section).getAllByRole("heading", { level: 4 });
    expect(moons).toHaveLength(2);
    expect(within(section).getByText("Welcome pack written")).toBeTruthy();
    expect(within(section).getByText("Accepted on 20 Oct")).toBeTruthy();
    expect(within(section).getByText("Clear and kind.")).toBeTruthy();
    expect(within(section).getByText(FIXTURE_ROLE_TITLE(1))).toBeTruthy();
    // The newest moon first, as the model orders it.
    const text = section.textContent ?? "";
    expect(text.indexOf("Welcome pack written")).toBeLessThan(text.indexOf("Intake form tested"));
    expect(text).not.toMatch(/[–—]/);
  });

  it("sits after the moon cycle, says so plainly when nothing is accepted, and draws nothing when unread", () => {
    render(<PlayerRoleCardView data={fixturePayload(1)} />);
    const all = document.querySelector("[data-player-card]")!.textContent ?? "";
    expect(all.indexOf("My moon cycle")).toBeLessThan(all.indexOf("Accomplished"));
    expect(screen.getByText("Nothing accepted as accomplished yet")).toBeTruthy();
    cleanup();
    render(<PlayerRoleCardView data={fixturePayload(1, "stranger", { accomplished: undefined })} />);
    expect(document.querySelector("[data-card-accomplished]")).toBeNull();
  });
});

describe("the owner's own words save through the season plan routes", () => {
  it("merges one card word into the stored ones and sends it to PUT /api/season-plans/mine/card", async () => {
    const calls = routes({
      "GET /api/season-plans/mine": { status: 200, body: MINE },
      "PUT /api/season-plans/mine/card": { status: 200, body: { ...MINE, cardWords: { ...MINE.cardWords, growingEdge: "Saying no." } } },
    });
    const reload = vi.fn();
    render(<PlayerRoleCardView data={fixturePayload(1, "self", { growingEdge: null })} reload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit my card" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit: Growing edge" }));
    fireEvent.change(screen.getByLabelText("Growing edge"), { target: { value: "Saying no." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/season-plans/mine/card");
    expect(put.body).toEqual({ cardWords: { howIHold: "Slowly and in the open.", findMe: "Mornings.", growingEdge: "Saying no." } });
    expect(reload).toHaveBeenCalled();
  });

  it("says a 409 no_season as a plain sentence, and the card is not reloaded", async () => {
    routes({
      "GET /api/season-plans/mine": { status: 200, body: { ...MINE, season: null, plan: null } },
      "PUT /api/season-plans/mine/card": {
        status: 409,
        body: { error: "no_season", message: "There is no season to plan yet. Planning opens one moon before the next season starts." },
      },
    });
    const reload = vi.fn();
    render(<PlayerRoleCardView data={fixturePayload(1)} reload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit my card" }));
    fireEvent.click(screen.getByRole("button", { name: /^Edit: My seasonal goals?$/ }));
    fireEvent.change(screen.getByLabelText(/^My seasonal goals?$/), { target: { value: "Ten new members: they each hold a role" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(EDIT_WORDS.noSeason)).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("builds each card body from what the newest version holds: an omitted group is kept, blank clears", () => {
    const held = { servesGoals: [{ goal: "Clear organisation", howItHelps: "Cards." }], cardWords: { howIHold: "Slowly." } };
    expect(cardBodyFor("whoCouldHoldNext", "Anyone keen", held)).toEqual({ cardWords: { howIHold: "Slowly.", nextHolder: "Anyone keen" } });
    expect(cardBodyFor("howIHold", " ", held)).toEqual({ cardWords: null });
    expect(cardBodyFor("seasonalGoals", "One: done\nTwo", held)).toEqual({
      seasonalGoals: [
        { title: "One", doneWhen: "done" },
        { title: "Two", doneWhen: null },
      ],
    });
    expect(cardBodyFor("seasonalGoals", "", held)).toEqual({ seasonalGoals: null });
    expect(cardBodyFor("servesGoal", "Clear organisation\nFood forest", held)).toEqual({
      servesGoals: [
        { goal: "Clear organisation", howItHelps: "Cards." },
        { goal: "Food forest", howItHelps: null },
      ],
    });
    expect(cardBodyFor("howItHelps", "Every role named.", held, { goal: "Clear organisation" })).toEqual({
      servesGoals: [{ goal: "Clear organisation", howItHelps: "Every role named." }],
    });
    expect(cardBodyFor("aim", "x", held)).toBeNull();
    expect(cardBodyFor("loadRead", "3", held)).toBeNull();
  });
});

describe("the load slider", () => {
  it("saves the owner's read on change with PUT /api/season-plans/mine/load", async () => {
    const calls = routes({ "PUT /api/season-plans/mine/load": { status: 200, body: { moonLoad: { cycleId: "m2", level: 4 } } } });
    const reload = vi.fn();
    render(<PlayerRoleCardView data={fixturePayload(1)} reload={reload} />);
    const slider = screen.getByRole("slider", { name: "How this moon feels, from Healthy to Heavy" });
    fireEvent.change(slider, { target: { value: "4" } });
    expect(await screen.findByText(EDIT_WORDS.loadSaved)).toBeTruthy();
    expect(calls).toEqual([{ url: "/api/season-plans/mine/load", method: "PUT", body: { level: 4 } }]);
    expect(reload).toHaveBeenCalled();
  });

  it("is one save for a drag, the last value", async () => {
    const calls = routes({ "PUT /api/season-plans/mine/load": { status: 200, body: { moonLoad: { cycleId: "m2", level: 5 } } } });
    render(<PlayerRoleCardView data={fixturePayload(1)} />);
    const slider = screen.getByRole("slider");
    for (const v of ["2", "3", "4", "5"]) fireEvent.change(slider, { target: { value: v } });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ level: 5 });
  });

  it("is read only for anybody else: a meter, no slider", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "member", { loadRead: 2 })} />);
    expect(screen.queryByRole("slider")).toBeNull();
    const meter = screen.getByRole("meter", { name: "How this moon feels, from Healthy to Heavy" });
    expect(meter.getAttribute("aria-valuenow")).toBe("2");
    expect(screen.getByText("Leaning healthy")).toBeTruthy();
  });
});

describe("the role's handover words, proposed by consent", () => {
  it("draws Bring me and the Runbook, the runbook link as a link", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "member")} />);
    const article = document.getElementById("role-r1")!;
    expect(within(article).getByText("Runbook")).toBeTruthy();
    expect(within(article).queryByText("How the work is done")).toBeNull();
    expect(within(article).getByRole("link", { name: "https://example.org/intake-runbook" }).getAttribute("href")).toBe("https://example.org/intake-runbook");
    expect(within(article).getByText("The newcomer list for the week.")).toBeTruthy();
  });

  it("proposes Bring me as one org draft change through the card's route", async () => {
    const calls = routes({
      "POST /api/people/me/role-card/roles/r1/propose": { status: 200, body: { success: true, draftId: "d1", key: "bringMe", review: "/review" } },
    });
    render(<PlayerRoleCardView data={fixturePayload(1)} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit my card" }));
    fireEvent.click(screen.getByRole("button", { name: `Edit: Bring me, ${FIXTURE_ROLE_TITLE(1)}` }));
    expect(screen.getByText(ROLE_HANDOVER_WORDS.bringMeHint)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(`Bring me, ${FIXTURE_ROLE_TITLE(1)}`), { target: { value: "Names\nDates" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose this change" }));
    await screen.findByRole("link", { name: EDIT_WORDS.seeProposal });
    expect(calls).toEqual([{ url: "/api/people/me/role-card/roles/r1/propose", method: "POST", body: { key: "bringMe", text: "Names\nDates" } }]);
  });

  it("refuses a runbook link that is not https in the browser, with the parser's sentence, and sends nothing", async () => {
    const calls = routes({});
    render(<PlayerRoleCardView data={fixturePayload(1)} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit my card" }));
    fireEvent.click(screen.getByRole("button", { name: `Edit: Runbook, ${FIXTURE_ROLE_TITLE(1)}` }));
    fireEvent.change(screen.getByLabelText(`Runbook, ${FIXTURE_ROLE_TITLE(1)}`), { target: { value: "http://example.org/run" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose this change" }));
    expect(await screen.findByText(ROLE_HANDOVER_WORDS.httpsOnly)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe("the handover meter", () => {
  it("reads N of 4 ready: card complete with its five parts, runbook, decisions, someone ready to step in", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "member")} />);
    const article = document.getElementById("role-r1")!;
    expect(within(article).getByText("2 of 4 ready")).toBeTruthy();
    const checks = Array.from(article.querySelectorAll("[data-handover-checks] > li"));
    expect(checks.map((li) => li.getAttribute("data-check"))).toEqual(["card", "runbook", "decisions", "stepIn"]);
    expect(checks.map((li) => li.getAttribute("data-ready"))).toEqual(["false", "true", "true", "false"]);
    expect(checks[0].textContent).toContain("Card complete: 4 of 5 parts written: Not mine to hold missing");
    const parts = Array.from(checks[0].querySelectorAll("[data-handover-parts] li")).map((li) => li.textContent);
    expect(parts).toEqual([
      HANDOVER_CHECK_WORDS.purpose.done,
      HANDOVER_CHECK_WORDS.decide.done,
      HANDOVER_CHECK_WORDS.countOnMe.done,
      HANDOVER_CHECK_WORDS.bringMe.done,
      HANDOVER_CHECK_WORDS.notMine.missing,
    ]);
    expect(checks[1].textContent).toContain(HANDOVER_CHECK_WORDS.runbook.done);
    expect(checks[2].textContent).toContain("2 decisions recorded");
    expect(checks[3].textContent).toContain("Nobody named yet");
    expect(article.textContent).not.toMatch(/\d+\s*%|percent/i);
  });
});
