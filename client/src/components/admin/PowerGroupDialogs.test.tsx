// @vitest-environment jsdom
/**
 * THE TWO QUESTIONS THE POWER GROUPS TAB ASKS (Rye, 2026-10-23).
 *
 * The founder took himself out of a power group with one click on the ×, and
 * could not appoint a member below a group's stage floor because the panel
 * only ever said no. These read what the admin is shown and what goes over the
 * wire, in order, because both halves are the fix:
 *
 *   - the × sends NOTHING; only the Remove button inside the question does,
 *     and Keep them sends nothing at all;
 *   - removing yourself says so, in the words Rye asked for;
 *   - the warning about a power left with nobody is the server's answer,
 *     printed, and absent when the server sends none;
 *   - an appointment refused for the floor becomes a question, and promoting
 *     sends the stage route `{ stageId }` (an absent key CLEARS a grant) BEFORE
 *     the appointment is sent again; helping them first sends nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const auth = vi.hoisted(() => ({ user: { id: "u-sam", name: "Sam Reed" } as { id: string; name: string } | null }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@/lib/gameApi", () => ({
  useSeason: () => null,
  useGameConfig: () => ({
    stages: [
      { id: "guest", name: "Guest", description: "Created a profile.", rule: { type: "account" } },
      { id: "participant", name: "Participant", description: "Completed training.", rule: { type: "training-complete" } },
      { id: "member", name: "Member", description: "Signed the agreement and joined.", rule: { type: "membership" } },
    ],
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import GameRolesTab from "./GameRolesTab";
import { listWords, stageNeeds } from "./PowerGroupDialogs";

type Call = { url: string; method: string; body: any };
let calls: Call[] = [];
let holdersReply: (body: any) => { status: number; body: any };
let stageReply: { status: number; body: any };
let holdingBody: any;

const STEWARDS = {
  id: "steward-circle",
  name: "Steward Circle",
  minStage: "member",
  capabilities: ["org.seat", "proposal.decide"],
  // GET /api/roles serves a holder by first name only; the tab names them from the roster.
  holders: [
    { userId: "u-sam", name: "Sam" },
    { userId: "u-ana", name: "Ana" },
  ],
};
const PLAYERS = [
  { id: "u-sam", name: "Sam Reed", stageComputed: "member" },
  { id: "u-ana", name: "Ana Ortiz", stageComputed: "member" },
  { id: "u-ben", name: "Ben Cole", stageComputed: "participant" },
];

beforeEach(() => {
  calls = [];
  auth.user = { id: "u-sam", name: "Sam Reed" };
  holdersReply = () => ({ status: 200, body: { holders: 1 } });
  stageReply = { status: 200, body: { success: true, stageComputed: "member" } };
  holdingBody = {
    powers: [{ capability: "org.seat", title: "Seating people in roles" }],
    leftEmptyByRemoval: { "steward-circle": { "u-ana": ["org.seat"] } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const json = (status: number, b: any) => ({ ok: status < 400, status, json: async () => b });
    if (url === "/api/roles") return json(200, [STEWARDS]);
    if (url === "/api/admin/players") return json(200, PLAYERS);
    if (url === "/api/admin/capabilities/holding") return json(200, holdingBody);
    if (url.endsWith("/stage")) return json(stageReply.status, stageReply.body);
    if (url.endsWith("/holders")) { const r = holdersReply(body); return json(r.status, r.body); }
    return json(404, {});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const writes = () => calls.filter((c) => c.method !== "GET");
const openTab = async () => {
  render(<GameRolesTab password="t" />);
  await screen.findByText("Steward Circle");
};

describe("removing somebody from a power group", () => {
  it("asks first: the × sends nothing, and Keep them sends nothing either", async () => {
    await openTab();
    await userEvent.click(screen.getByRole("button", { name: "Remove Ana Ortiz from Steward Circle" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Remove Ana Ortiz from Steward Circle?")).toBeTruthy();
    expect(within(dialog).getByText("They lose the power to:")).toBeTruthy();
    // The group's powers in plain words, never the keys.
    expect(within(dialog).getByText("seat people in the village's roles, and take them out again")).toBeTruthy();
    expect(within(dialog).getByText("record the outcome of a governance decision and close it")).toBeTruthy();
    expect(within(dialog).queryByText("org.seat")).toBeNull();
    expect(within(dialog).getByText("They stop being able to do it straight away.")).toBeTruthy();
    expect(writes()).toEqual([]);

    await userEvent.click(within(dialog).getByRole("button", { name: "Keep them" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toEqual([]);
  });

  it("removes only from the Remove button inside the question", async () => {
    await openTab();
    await userEvent.click(screen.getByRole("button", { name: "Remove Ana Ortiz from Steward Circle" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      url: "/api/admin/roles/steward-circle/holders",
      method: "POST",
      body: { userId: "u-ana", action: "remove" },
    });
  });

  it("says when the removal would leave a power the village holds with nobody", async () => {
    await openTab();
    await userEvent.click(screen.getByRole("button", { name: "Remove Ana Ortiz from Steward Circle" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Nobody else holds Seating people in roles\./)).toBeTruthy();
    expect(within(dialog).getByText(/once Ana Ortiz is out, nobody can use it/)).toBeTruthy();
  });

  it("warns about nobody only on the server's word", async () => {
    holdingBody = { powers: [] };
    await openTab();
    await userEvent.click(screen.getByRole("button", { name: "Remove Ana Ortiz from Steward Circle" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/Nobody else holds/)).toBeNull();
  });

  it("says it louder when the person being removed is you", async () => {
    await openTab();
    await userEvent.click(screen.getByRole("button", { name: "Remove Sam Reed from Steward Circle" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "You are removing yourself. If nobody else in the village holds these powers, only an admin can give them back.",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText("You lose the power to:")).toBeTruthy();
    // Somebody else's removal never carries the self warning.
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep them" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Ana Ortiz from Steward Circle" }));
    expect(within(await screen.findByRole("dialog")).queryByText(/You are removing yourself/)).toBeNull();
  });
});

describe("appointing somebody below the group's stage floor", () => {
  const floorRefusal = { status: 409, body: { error: "Ben has not reached the Member stage this role asks for.", minStage: "member" } };

  const tryToAppointBen = async () => {
    await openTab();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Appoint a member" }), "u-ben");
    await userEvent.click(screen.getByRole("button", { name: "Appoint" }));
    return screen.findByRole("dialog");
  };

  it("warns and asks, instead of only refusing", async () => {
    let n = 0;
    holdersReply = () => (n++ === 0 ? floorRefusal : { status: 200, body: { holders: 3 } });
    const dialog = await tryToAppointBen();
    expect(within(dialog).getByText("Ben Cole has not reached the Member stage")).toBeTruthy();
    expect(within(dialog).getByText(/Steward Circle asks for Member or above\. Ben Cole is at Participant today\./)).toBeTruthy();
    expect(within(dialog).getByText(/Are you sure you want to promote them\?/)).toBeTruthy();
    expect(within(dialog).getByText("A stage granted at Member also lets them into the village as a member.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Promote to Member and appoint" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Help them reach Member first" })).toBeTruthy();
    // The refused attempt is the only write so far: no stage moved.
    expect(writes().map((c) => c.method + " " + c.url)).toEqual(["POST /api/admin/roles/steward-circle/holders"]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("promotes through the stage route with stageId, THEN appoints", async () => {
    let n = 0;
    holdersReply = () => (n++ === 0 ? floorRefusal : { status: 200, body: { holders: 3 } });
    const dialog = await tryToAppointBen();
    await userEvent.click(within(dialog).getByRole("button", { name: "Promote to Member and appoint" }));
    await waitFor(() => expect(writes()).toHaveLength(3));
    expect(writes()[1]).toEqual({ url: "/api/admin/players/u-ben/stage", method: "PUT", body: { stageId: "member" } });
    expect(writes()[2]).toEqual({
      url: "/api/admin/roles/steward-circle/holders",
      method: "POST",
      body: { userId: "u-ben", action: "add" },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ben Cole is at Member now, and appointed"));
  });

  it("appoints nobody when the stage route refuses", async () => {
    holdersReply = () => floorRefusal;
    stageReply = { status: 401, body: { error: "auth_required" } };
    const dialog = await tryToAppointBen();
    await userEvent.click(within(dialog).getByRole("button", { name: "Promote to Member and appoint" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only an admin can change a stage. Nobody was appointed."));
    expect(writes().map((c) => c.method)).toEqual(["POST", "PUT"]);
  });

  it("says both halves when the promotion lands and the appointment does not", async () => {
    let n = 0;
    holdersReply = () => (n++ === 0 ? floorRefusal : { status: 409, body: { error: "That term ends after the season." } });
    const dialog = await tryToAppointBen();
    await userEvent.click(within(dialog).getByRole("button", { name: "Promote to Member and appoint" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Ben Cole is at Member now, but the appointment did not go through: That term ends after the season.",
      ),
    );
  });

  it("helping them first shows what the stage needs and sends nothing", async () => {
    holdersReply = () => floorRefusal;
    const dialog = await tryToAppointBen();
    await userEvent.click(within(dialog).getByRole("button", { name: "Help them reach Member first" }));
    expect(within(dialog).getByText("What Member needs")).toBeTruthy();
    expect(within(dialog).getByText(/It opens when they sign the membership agreement\./)).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Players tab" }).getAttribute("href")).toBe("/admin?tab=players");
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes().map((c) => c.method)).toEqual(["POST"]);
  });
});

describe("the words", () => {
  it("joins a list the way a sentence does", () => {
    expect(listWords(["a"])).toBe("a");
    expect(listWords(["a", "b"])).toBe("a and b");
    expect(listWords(["a", "b", "c"])).toBe("a, b and c");
  });

  it("says how every kind of stage is reached, about somebody else", () => {
    expect(stageNeeds({ type: "quests", min: 1 })).toBe("It opens at 1 consented quest.");
    expect(stageNeeds({ type: "quests", min: 3 })).toBe("It opens at 3 consented quests.");
    expect(stageNeeds({ type: "granted" })).toMatch(/Players tab/);
    expect(stageNeeds(undefined)).toBe("");
  });
});
