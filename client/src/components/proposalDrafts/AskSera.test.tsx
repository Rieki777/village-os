// @vitest-environment jsdom
/**
 * "ASK SERA FOR A FIRST DRAFT" (joining lane PR 5), in the browser.
 *
 * Pinned: no button for a visitor with no account; the press sends exactly
 * `draftBody` (roles, why, aim) and nothing else; drafted goals arrive marked
 * and flagged, the mark goes when the person edits or keeps one, a draft blocks
 * the member door's send until then, and the flag never reaches what is sent;
 * with Sera down the button says so plainly and the form is untouched.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";

let user: unknown = { id: "u1" };
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user }) }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/gameApi")>()), authToken: () => "tok" }));
vi.mock("@/lib/guideApi", () => ({
  fetchGuide: async () => ({ choice: null, options: [{ id: "saberra", name: "Sera", named: true, available: true }], answering: "saberra", note: null, canChoose: false }),
}));

import GoalsList from "@/components/governance/GoalsList";
import { goalsForRoute, goalsProblem } from "@/components/governance/roleApplicationType";
import { settleDraftAnswers } from "@/components/governance/seraDraftAnswers";
import { AskSera } from "./AskSera";
import { BLANK_GOAL } from "@shared/proposalGoals";
import { DRAFT_WORDS, goalsFromDraft, placeDraftGoals, type DraftableGoal } from "@shared/seraDrafts";

i18n.load("en", {});
i18n.activate("en");
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  user = { id: "u1" };
});

const wrap = (node: React.ReactNode) => <I18nProvider i18n={i18n}>{node}</I18nProvider>;
const ROLES = [{ roleId: "r1", note: "I cook for forty" }];

describe("the button", () => {
  it("is not drawn for a visitor with no account, so the form works without it", () => {
    user = null;
    render(wrap(<AskSera kind="aim" roles={ROLES} why="why" aim="" onDraft={() => {}} />));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sends exactly the roles, why and aim on a press, and nothing before it", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ guide: { id: "saberra", name: "Sera" }, note: null, kind: "aim", aim: "Food grows here" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const got: unknown[] = [];
    render(wrap(<AskSera kind="aim" roles={ROLES} why="  my why " aim=" my aim " onDraft={(r) => got.push(r)} />));
    const button = await screen.findByRole("button", { name: "Ask Sera for a first draft" });
    expect(screen.getByText(/It sends the roles you picked, your "Why you" and your aim, and nothing else/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(got).toHaveLength(1));
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0]!;
    expect(url).toBe("/api/governance/proposal-drafts");
    expect(JSON.parse(String(init.body))).toEqual({ kind: "aim", roles: [{ roleId: "r1", note: "I cook for forty" }], why: "my why", aim: "my aim" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("says plainly that Sera cannot answer, and hands the form nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: DRAFT_WORDS.unavailable }) })));
    const onDraft = vi.fn();
    render(wrap(<AskSera kind="goals" roles={ROLES} why="why" aim="" onDraft={onDraft} />));
    fireEvent.click(await screen.findByRole("button", { name: "Ask Sera for a first draft" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Your form works without it");
    expect(onDraft).not.toHaveBeenCalled();
    // The form can still be sent: nothing is marked, nothing blocks.
    expect(goalsProblem([{ ...BLANK_GOAL, title: "Plant", doneWhen: "planted", roleId: "r1" }])).toBeNull();
  });

  it("says so when the guide is slow, and the form carries on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }));
    render(wrap(<AskSera kind="story" roles={ROLES} why="why" aim="" onDraft={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: "Ask Sera for a first draft" }));
    expect((await screen.findByRole("alert")).textContent).toContain("taking longer than it should");
  });
});

describe("drafted goals", () => {
  const drafted = goalsFromDraft([
    { title: "Cook the first menu", doneWhen: "the menu is posted", moves: "Plan the weekly menu", roleId: "r1" },
    { title: "Order the dry goods", doneWhen: "the order is in", moves: "", roleId: "r1" },
  ]);
  const Harness = ({ start }: { start: DraftableGoal[] }) => {
    const [goals, set] = useState<DraftableGoal[]>(start);
    (globalThis as any).__goals = goals;
    return wrap(<GoalsList goals={goals} onChange={set} roles={[{ id: "r1", name: "Kitchen keeper", goals: ["Plan the weekly menu"] }]} today="2026-11-10" />);
  };
  const now = (): DraftableGoal[] => (globalThis as any).__goals;

  it("arrive marked, block the send, and leave nothing behind once kept or edited", () => {
    render(<Harness start={placeDraftGoals([{ ...BLANK_GOAL }], drafted, 8)} />);
    // The blank row made room; the two drafts are marked.
    expect(screen.getAllByText("Draft from Sera")).toHaveLength(2);
    expect(goalsProblem(now())).toBe(DRAFT_WORDS.blocked(["goals"]));

    // Keep this on the first.
    fireEvent.click(screen.getAllByRole("button", { name: "Keep this" })[0]!);
    expect(screen.getAllByText("Draft from Sera")).toHaveLength(1);
    expect(goalsProblem(now())).toBe(DRAFT_WORDS.blocked(["goals"]));

    // Editing the second makes it theirs.
    fireEvent.change(screen.getAllByLabelText("The goal")[1]!, { target: { value: "Order the dry goods on Friday" } });
    expect(screen.queryByText("Draft from Sera")).toBeNull();
    expect(goalsProblem(now())).toBeNull();

    // What is sent carries no flag and no trace of where a goal began.
    const sent = goalsForRoute({ seatIds: ["r1"], goals: now() });
    expect(JSON.stringify(sent)).not.toContain("seraDraft");
    expect(sent.map((g) => g.title)).toEqual(["Cook the first menu", "Order the dry goods on Friday"]);
  });

  it("never draws a goal that moves a role goal the role does not list", () => {
    const goals = goalsFromDraft([{ title: "T", doneWhen: "D", moves: "", roleId: "r1" }]);
    expect(goals[0]!.moves).toBe("");
  });
});

describe("a drafted aim or story on the member door", () => {
  it("is blocked while it holds exactly Sera's words, and its mark goes the moment it is edited", () => {
    const a = { aim: "Food grows here", seraDrafts: { aim: "Food grows here" } };
    expect(settleDraftAnswers(a)).toEqual(a);
    const edited = settleDraftAnswers({ ...a, aim: "Food grows here, every season" });
    expect(edited).toEqual({ aim: "Food grows here, every season" });
    expect("seraDrafts" in edited).toBe(false);
  });
});

beforeEach(() => {
  (globalThis as any).__goals = [];
});
