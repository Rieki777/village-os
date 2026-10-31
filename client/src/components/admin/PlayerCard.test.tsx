// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlayerCard, PlayersKey, howReached, ladderLabel, type Player } from "./PlayerCard";

const STAGES = [
  { id: "guest", name: "Guest", rule: { type: "account" } },
  { id: "member", name: "Member", rule: { type: "membership" } },
  { id: "co-creator", name: "Co-Creator", rule: { type: "granted" } },
  { id: "role-holder", name: "Role Holder", rule: { type: "granted" } },
];

const PLAYER: Player = {
  id: "u1",
  name: "Lexi",
  email: "lexi@example.org",
  handle: "lexi",
  role: "member",
  paths: ["steward"],
  joinedAt: "2026-10-26T00:00:00Z",
  balance: 0,
  stageGranted: "role-holder",
  stageComputed: "role-holder",
};

afterEach(cleanup);

describe("howReached", () => {
  it("names the grant when the grant is where they stand", () => {
    expect(howReached(STAGES, PLAYER)).toBe("Granted: Role Holder and every stage below it.");
  });
  it("says their acts carried them when they stand above the grant", () => {
    expect(howReached(STAGES, { stageGranted: "member", stageComputed: "role-holder" })).toBe(
      "Their own acts lifted them past the Member grant.",
    );
  });
  it("says their acts carried them when there is no grant", () => {
    expect(howReached(STAGES, { stageGranted: null, stageComputed: "member" })).toBe("Reached by their own acts.");
  });
});

describe("ladderLabel", () => {
  it("names the ladder after the rung the paths lead to, and falls back on a fork without it", () => {
    expect(ladderLabel(STAGES)).toBe("Co-Creator path");
    expect(ladderLabel([{ id: "guest", name: "Guest" }])).toBe("Village path");
  });
});

describe("PlayerCard", () => {
  const card = (over: Partial<Parameters<typeof PlayerCard>[0]> = {}) =>
    render(
      <PlayerCard
        player={PLAYER}
        stages={STAGES}
        paths={[{ id: "steward", label: "Village Steward" }]}
        canSetAccess
        gameStarted={false}
        picked={false}
        onPick={() => {}}
        onAccess={() => {}}
        onStage={() => {}}
        onSignOut={() => {}}
        onDelete={() => {}}
        {...over}
      />,
    );

  it("labels access and the path separately, each with what it means", () => {
    card();
    expect(screen.getByRole("region", { name: "Access" })).toHaveTextContent("Plays the village. No admin panel.");
    const path = screen.getByRole("region", { name: "Co-Creator path" });
    expect(path).toHaveTextContent("Now at");
    expect(path).toHaveTextContent("Role Holder");
    expect(path).toHaveTextContent("Paths they chose: Village Steward");
  });

  it("offers no new founder after launch, and keeps it on a founder's own card", () => {
    card({ gameStarted: true });
    expect(screen.queryByRole("option", { name: "Founder" })).toBeNull();
    cleanup();
    card({ gameStarted: true, player: { ...PLAYER, role: "founder" } });
    expect(screen.getByLabelText("Access for Lexi")).toHaveValue("founder");
  });

  it("shows access as a pill when the viewer may not change it", () => {
    card({ canSetAccess: false });
    expect(screen.queryByLabelText("Access for Lexi")).toBeNull();
    expect(screen.getByRole("region", { name: "Access" })).toHaveTextContent("Member");
  });

  it("sends the access change and the account actions", () => {
    const onAccess = vi.fn();
    const onDelete = vi.fn();
    card({ onAccess, onDelete });
    fireEvent.change(screen.getByLabelText("Access for Lexi"), { target: { value: "admin" } });
    expect(onAccess).toHaveBeenCalledWith("admin");
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(onDelete).toHaveBeenCalled();
  });
});

describe("PlayersKey", () => {
  it("counts each access level and says who sets access before launch", () => {
    render(<PlayersKey players={[PLAYER, { ...PLAYER, id: "u2", role: "founder" }]} stages={STAGES} gameStarted={false} />);
    expect(screen.getByText("Member · 1")).toBeInTheDocument();
    expect(screen.getByText("Founder · 1")).toBeInTheDocument();
    expect(screen.getByText(/only a founder can change access/)).toBeInTheDocument();
  });
});
