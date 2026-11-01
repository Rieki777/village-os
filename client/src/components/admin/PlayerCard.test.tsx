// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PathLadder } from "@shared/pathLadders";
import {
  NO_FILTER,
  PlayerCard,
  PlayersFilters,
  PlayersKey,
  filterPlayers,
  howReached,
  ladderLabel,
  type Player,
  type PlayerDetail,
} from "./PlayerCard";

const STAGES = [
  { id: "guest", name: "Guest", rule: { type: "account" } },
  { id: "member", name: "Member", rule: { type: "membership" } },
  { id: "co-creator", name: "Co-Creator", rule: { type: "granted" } },
  { id: "role-holder", name: "Role Holder", rule: { type: "role" } },
];

const PATHS = [
  { id: "steward", label: "Village Steward" },
  { id: "resident", label: "Resident" },
  { id: "investor", label: "Investor" },
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

const rung = (id: string, name: string, lit: boolean, fell = false) => ({
  id,
  name,
  meaning: `${name} meaning.`,
  column: "x",
  lit,
  fell,
  note: null,
  moon: null,
});

const STEWARD: PathLadder = {
  pathId: "steward",
  rungs: [rung("seated", "Seated", true), rung("mandate", "Mandate current", true), rung("speaks", "Speaks for its circle", false)],
  position: 2,
  empty: null,
};

const DETAIL: PlayerDetail = {
  ladders: [STEWARD],
  holdings: [
    { slug: "gratitude", name: "Gratitude", balance: 1, decimals: 0 },
    { slug: "credits", name: "Village Credits", balance: 150, decimals: 2 },
  ],
  stageSet: { at: "2026-10-26T12:00:00Z", by: "Rye" },
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
        detail={DETAIL}
        stages={STAGES}
        paths={PATHS}
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

  it("labels access and the stage separately, each with what it means", () => {
    card();
    expect(screen.getByRole("region", { name: "Access" })).toHaveTextContent("Plays the village. No admin panel.");
    const stage = screen.getByRole("region", { name: "Co-Creator path" });
    expect(stage).toHaveTextContent("Now at");
    expect(stage).toHaveTextContent("Role Holder");
    expect(stage).toHaveTextContent("Stage last set by Rye on");
  });

  it("shows where they stand on each path they walk, rung by rung", () => {
    card({ player: { ...PLAYER, paths: ["steward", "investor"] } });
    const paths = screen.getByRole("region", { name: "Paths they walk" });
    // The highest lit rung is where they stand.
    expect(paths).toHaveTextContent("Village Steward");
    expect(paths).toHaveTextContent("Mandate current");
    const steps = within(paths).getByRole("list", { name: "Village Steward steps" });
    expect(steps).toHaveTextContent("Seated, holds now");
    expect(steps).toHaveTextContent("Speaks for its circle, not yet");
    // A chosen path with no ladder served says so, and is not drawn as empty steps.
    expect(paths).toHaveTextContent("Investor");
    expect(paths).toHaveTextContent("This path has no steps tracked yet.");
  });

  it("says Not started on a path whose ladder has nothing lit", () => {
    const dark = { ...STEWARD, rungs: STEWARD.rungs.map((r) => ({ ...r, lit: false })), position: 0 };
    card({ detail: { ...DETAIL, ladders: [dark] } });
    expect(screen.getByRole("region", { name: "Paths they walk" })).toHaveTextContent("Not started");
  });

  it("formats each token at its own scale", () => {
    card();
    expect(screen.getByText("Gratitude").parentElement).toHaveTextContent("1 Gratitude");
    expect(screen.getByText("Village Credits").parentElement).toHaveTextContent("1.5 Village Credits");
  });

  it("says when they hold nothing, and when the detail is still loading", () => {
    card({ detail: { ...DETAIL, holdings: [] } });
    expect(screen.getByText("Holds no tokens yet")).toBeInTheDocument();
    cleanup();
    card({ detail: undefined });
    expect(screen.getAllByText("Loading...").length).toBeGreaterThan(0);
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

describe("filterPlayers", () => {
  const ROSTER: Player[] = [
    PLAYER,
    { ...PLAYER, id: "u2", name: "Rick", handle: "rick", email: "rick@example.org", role: "founder", paths: [], stageComputed: "member" },
    { ...PLAYER, id: "u3", name: "Ada", handle: null, email: "ada@village.test", role: "admin", paths: ["resident"], stageComputed: "guest" },
  ];
  const names = (f: Partial<typeof NO_FILTER>) => filterPlayers(ROSTER, { ...NO_FILTER, ...f }).map((p) => p.name);

  it("matches name, handle and email, ignoring case", () => {
    expect(names({ text: "RICK" })).toEqual(["Rick"]);
    expect(names({ text: "village.test" })).toEqual(["Ada"]);
    expect(names({})).toEqual(["Lexi", "Rick", "Ada"]);
  });

  it("filters by access, stage and path, and by having chosen no path", () => {
    expect(names({ access: "founder" })).toEqual(["Rick"]);
    expect(names({ stage: "role-holder" })).toEqual(["Lexi"]);
    expect(names({ path: "resident" })).toEqual(["Ada"]);
    expect(names({ path: "none" })).toEqual(["Rick"]);
    expect(names({ access: "member", path: "resident" })).toEqual([]);
  });

  it("the filter bar counts what it shows and clears back to everyone", () => {
    const onChange = vi.fn();
    render(<PlayersFilters value={{ ...NO_FILTER, text: "x" }} onChange={onChange} stages={STAGES} paths={PATHS} shown={1} total={3} />);
    expect(screen.getByText("1 of 3 players")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith(NO_FILTER);
  });
});

describe("PlayersKey", () => {
  it("counts each access level and says who sets access before launch", () => {
    render(<PlayersKey players={[PLAYER, { ...PLAYER, id: "u2", role: "founder" }]} stages={STAGES} gameStarted={false} />);
    expect(screen.getByText("Member · 1")).toBeInTheDocument();
    expect(screen.getByText("Founder · 1")).toBeInTheDocument();
    expect(screen.getByText(/only a founder can change access/)).toBeInTheDocument();
  });

  it("outlines only the stages an admin grants, so Role Holder is no longer one", () => {
    render(<PlayersKey players={[PLAYER]} stages={STAGES} gameStarted={false} />);
    expect(screen.getByText("Co-Creator").className).toContain("border-amber-300");
    expect(screen.getByText("Role Holder").className).not.toContain("border-amber-300");
  });
});
