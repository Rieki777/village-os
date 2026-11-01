// @vitest-environment jsdom
/**
 * WHAT THE CO-CREATORS GUIDE SAYS ABOUT THE WORK: counts and links, no pay.
 *
 * Rye, 2026-10-23: no sentence restates pay, because each quest and role card
 * shows its own value. So this card counts the open quests and the roles,
 * links to both, and says nothing about what anything pays, whatever the
 * board answers: work with values, work without, none at all, or no answer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const ctl = vi.hoisted(() => ({ org: null as unknown, orgOk: true, roleName: "" }));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/gameApi", () => ({
  gameFetch: async () => ({ ok: ctl.orgOk, status: ctl.orgOk ? 200 : 500, json: async () => ctl.org }),
  useGameConfig: () => ({ project: { roleName: ctl.roleName } }),
}));

import EarningsFromTheWork, { questLine, roleLine } from "./EarningsFromTheWork";

const PAY = { value: { minor: 2500000, currency: "CRC" }, lines: [{ token: "credits", name: "Village Credits", amount: 40 }], source: "own", cadence: "once" };

function serveQuests(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );
}

/** No pay words anywhere: pays, paid, value, earn, cash, credits. */
const PAY_WORDS = /\b(pays?|paid|value|earns?|cash|credits?)\b/i;

describe("the work, counted", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    ctl.roleName = "";
  });

  it("counts the open quests and the roles, leaving out examples and closed quests", async () => {
    serveQuests([
      { id: "a", status: "open", pay: PAY },
      { id: "b", status: "open" },
      { id: "c", status: "Closed", pay: PAY },
      { id: "d", status: "open", isExample: true, pay: PAY },
    ]);
    ctl.orgOk = true;
    ctl.org = { roles: [{ id: "r1", pay: PAY }, { id: "r2" }, { id: "r3", isExample: true }] };
    render(<EarningsFromTheWork />);
    expect(await screen.findByText("2 open quests")).toBeTruthy();
    expect(await screen.findByText("2 roles")).toBeTruthy();
    expect(screen.getByText("See the quest board").getAttribute("href")).toBe("/quests");
    expect(screen.getByText("See the roles").getAttribute("href")).toBe("/roles");
    expect(document.body.textContent).not.toMatch(PAY_WORDS);
  });

  it("says one, and says none, in plain words", async () => {
    serveQuests([{ id: "a", status: "open" }]);
    ctl.orgOk = true;
    ctl.org = { roles: [] };
    render(<EarningsFromTheWork />);
    expect(await screen.findByText("1 open quest")).toBeTruthy();
    expect(await screen.findByText("No roles yet.")).toBeTruthy();
  });

  it("points at the pages when neither answers, and says no pay words", async () => {
    serveQuests(null, false);
    ctl.orgOk = false;
    ctl.org = null;
    render(<EarningsFromTheWork />);
    expect(await screen.findByText("The quest board lists every open quest.")).toBeTruthy();
    expect(await screen.findByText("The roles page lists every role.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(PAY_WORDS);
  });

  it("names roles in the village's own word", async () => {
    serveQuests([]);
    ctl.orgOk = true;
    ctl.roleName = "Office";
    ctl.org = { roles: [{ id: "r1" }, { id: "r2" }, { id: "r3" }] };
    render(<EarningsFromTheWork />);
    expect(await screen.findByText("3 offices")).toBeTruthy();
    expect(screen.getByText("Offices")).toBeTruthy();
    expect(screen.getByText("See the offices").getAttribute("href")).toBe("/roles");
    expect(screen.getByText("No open quests yet.")).toBeTruthy();
  });

  it("says no pay words while it reads, or for an empty board", () => {
    for (const line of [questLine(null), roleLine(null), questLine({ quests: 0, roles: 0 }), roleLine({ quests: 0, roles: 0 })]) {
      expect(line).not.toMatch(PAY_WORDS);
    }
    expect(questLine({ quests: 0, roles: 0 })).toBe("No open quests yet.");
    expect(questLine(null)).toBe("Reading the quest board.");
  });
});
