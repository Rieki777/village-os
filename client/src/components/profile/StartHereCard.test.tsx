// @vitest-environment jsdom
/**
 * The "Start here" card at the top of a member's own profile.
 *
 * Five states are pinned, each by the condition that decides it: a guest is
 * sent to the real joining door, a guest who already signed is told it is
 * with the village, a member is sent to the quest and role doors, and nobody
 * but the owner, signed in, ever sees the card. Each case names the line in
 * StartHereCard.tsx whose removal turns it red.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const session = vi.hoisted(() => ({
  user: null as null | { id: string; name: string; handle?: string },
  modulesOn: new Set<string>(),
}));
const gameFetch = vi.hoisted(() => vi.fn());
/** The member's own Gene Keys: off, and nothing saved, unless a test says otherwise. */
const geneKeys = vi.hoisted(() => ({ on: false, mine: null as unknown }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: session.user, token: session.user ? "t" : null, loading: false }),
}));
vi.mock("@/lib/gameApi", () => ({ gameFetch: (...args: unknown[]) => gameFetch(...args) }));
// The real catalog rule: a module is present, with a lifecycle, only when on.
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: (id: string) => (session.modulesOn.has(id) ? { id, lifecycle: "members" } : undefined),
}));
vi.mock("@/components/geneKeys/useMyGeneKeys", () => ({ useMyGeneKeys: () => ({ on: geneKeys.on, mine: geneKeys.on ? geneKeys.mine : null }) }));

import StartHereCard, { isAdmittedHere, opensAtMembership, viewerOwns } from "./StartHereCard";
import type { GameMe, ProgressionCapability, PublicGameConfig } from "@/lib/gameApi";

/** The platform ladder's ids, in order. Only `id` and the index matter here. */
const STAGES = ["visitor", "guest", "immersant", "participant", "member", "contributor"].map((id) => ({
  id,
  name: id,
  description: "",
  rule: { type: "default" },
}));

const me = (over: Partial<GameMe> = {}): GameMe =>
  ({ membership: false, stageIndex: 1, stages: STAGES, ...over }) as unknown as GameMe;

const config = (over: Partial<PublicGameConfig> = {}): PublicGameConfig =>
  ({ project: { name: "Test Village", commitmentName: "Love Letter" }, brochurePages: true, ...over }) as unknown as PublicGameConfig;

const answer = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

const VOUCHES = { state: { count: 1, needed: 3, met: false, off: false, bySuper: false, vouchers: ["u9"] }, sentence: "1 of 3 vouches. 2 more people to go." };

const CATALOGUE = [
  { key: "ballot.vote", label: "Cast a vote on a ballot", held: false, opens: { via: "stage", stage: "member" } },
  { key: "event.rsvp", label: "Say you are coming to a gathering", held: true, opens: { via: "stage", stage: "guest" } },
] as unknown as ProgressionCapability[];

/** The card's own section, found by its one heading. */
const card = () => screen.getByRole("region", { name: "Start here" });
const link = (name: string | RegExp) => within(card()).getByRole("link", { name });

beforeEach(() => {
  gameFetch.mockReset();
  gameFetch.mockReturnValue(answer(VOUCHES));
  session.user = { id: "u1", name: "Wren Alder", handle: "wren" };
  session.modulesOn = new Set(["map"]);
  geneKeys.on = false;
  geneKeys.mine = null;
});

describe("StartHereCard: a signed-in guest who has not asked yet", () => {
  // CONTROL: make `isAdmittedHere` answer true for everybody and this goes red,
  // because the card then shows the member's quest step instead.
  it("names becoming a member as the one step and sends them to the letter", async () => {
    render(<StartHereCard ownerId="u1" me={me()} signing={null} config={config()} catalogue={CATALOGUE} />);

    expect(within(card()).getAllByRole("heading")).toHaveLength(1);
    expect(within(card()).getByText("Become a member")).toBeInTheDocument();
    expect(link(/Sign the Love Letter/)).toHaveAttribute("href", "/love-letter");
    expect(within(card()).getByText(/people who look after joining read it and answer/)).toBeInTheDocument();
    // What membership opens comes off the power map, and only the unheld rows that open at Member.
    expect(within(card()).getByText("Membership opens one power for you here: cast a vote on a ballot.")).toBeInTheDocument();
    // The server's own vouch sentence, beside the page where members vouch.
    expect(await within(card()).findByText(/1 of 3 vouches\. 2 more people to go\./)).toBeInTheDocument();
    expect(link("Open your page")).toHaveAttribute("href", "/profile/wren");
    expect(gameFetch).toHaveBeenCalledWith("/api/me/vouches");
    // A quest idea is open to anybody, so a guest has that door too, smaller.
    expect(link("Propose a quest")).toHaveAttribute("href", "/propose-quest");
    // The member doors are not offered to somebody who is not in yet.
    expect(within(card()).queryByRole("link", { name: /Raise your hand/ })).toBeNull();
  });

  it("names the step in the village's own word for a member", () => {
    const named = config({ project: { name: "Test Village", commitmentName: "Love Letter", memberName: "Elderling" } } as Partial<PublicGameConfig>);
    render(<StartHereCard ownerId="u1" me={me()} signing={null} config={named} catalogue={CATALOGUE} />);
    expect(within(card()).getByText("Become an Elderling")).toBeInTheDocument();
    expect(within(card()).queryByText("Become a member")).toBeNull();
  });

  it("waits, drawing nothing, until it knows whether they already asked", () => {
    const { container } = render(<StartHereCard ownerId="u1" me={me()} signing={undefined} config={config()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers no letter in a village that does not serve one, and points at the vouches", async () => {
    render(<StartHereCard ownerId="u1" me={me()} signing={null} config={config({ brochurePages: false })} />);
    expect(within(card()).queryByRole("link", { name: /Sign the/ })).toBeNull();
    expect(await within(card()).findByRole("link", { name: "Open your page" })).toHaveAttribute("href", "/profile/wren");
  });
});

describe("StartHereCard: a signed-in guest who already signed", () => {
  // CONTROL: turn the `if (signing && signing.answer !== "left")` branch off
  // and this goes red: the card tells somebody who signed to sign again.
  it("says the request is with the village, when they signed, and offers no second signature", () => {
    render(
      <StartHereCard
        ownerId="u1"
        me={me()}
        signing={{ at: "2026-10-01T12:00:00.000Z", answer: "waiting" }}
        config={config()}
      />,
    );
    expect(within(card()).getByText("Your request is with the village")).toBeInTheDocument();
    expect(within(card()).getByText(/^You signed the Love Letter on .*2026\.$/)).toBeInTheDocument();
    expect(within(card()).getByText(/You get a notice when they do, and this card changes when you are in/)).toBeInTheDocument();
    expect(within(card()).queryByRole("link", { name: /Sign the Love Letter/ })).toBeNull();
    expect(within(card()).queryByText("Become a member")).toBeNull();
  });

  it("offers the letter again, plainly, after the village said no", () => {
    render(
      <StartHereCard ownerId="u1" me={me()} signing={{ at: "2026-10-01T12:00:00.000Z", answer: "left" }} config={config()} />,
    );
    expect(within(card()).getByText("Become a member")).toBeInTheDocument();
    expect(within(card()).getByText(/left your last request where it is for now/)).toBeInTheDocument();
    expect(link(/Sign the Love Letter/)).toHaveAttribute("href", "/love-letter");
  });
});

describe("StartHereCard: a member", () => {
  // CONTROL: make `isAdmittedHere` answer false for everybody and both cases
  // go red, because the card then sends a member to the joining door.
  it("names proposing a quest as the one step, with the seat door smaller", () => {
    render(<StartHereCard ownerId="u1" me={me({ membership: true, stageIndex: 4 })} signing={null} config={config()} />);

    expect(within(card()).getAllByRole("heading")).toHaveLength(1);
    expect(link(/Propose a quest/)).toHaveAttribute("href", "/propose-quest");
    expect(link("Raise your hand for an open role")).toHaveAttribute("href", "/roles");
    // Every door says what happens after it.
    expect(within(card()).getByText(/A steward reads it, and if it goes on the board/)).toBeInTheDocument();
    expect(within(card()).getByText(/read your offer and answer\. You get a notice when they do\./)).toBeInTheDocument();
    expect(within(card()).queryByText("Become a member")).toBeNull();
    expect(within(card()).queryByRole("link", { name: /Sign the/ })).toBeNull();
    // No new-role door on this base: nothing a member presses would carry it anywhere.
    expect(within(card()).queryByRole("link", { name: /Propose a role/ })).toBeNull();
    // A member is never asked about their vouches.
    expect(gameFetch).not.toHaveBeenCalled();
  });

  it("counts a stage an admin granted at Member or above as in, with no membership flag", () => {
    render(<StartHereCard ownerId="u1" me={me({ membership: false, stageIndex: 5 })} signing={null} config={config()} />);
    expect(link(/Propose a quest/)).toHaveAttribute("href", "/propose-quest");
    expect(within(card()).queryByText("Become a member")).toBeNull();
  });

  // CONTROL: drop `handsOpen` from the seat door and this goes red.
  it("leaves the seat door out while the map module is off, because /roles then offers no hand", () => {
    session.modulesOn = new Set();
    render(<StartHereCard ownerId="u1" me={me({ membership: true, stageIndex: 4 })} signing={null} config={config()} />);
    expect(within(card()).queryByRole("link", { name: /Raise your hand/ })).toBeNull();
    expect(link(/Propose a quest/)).toBeInTheDocument();
  });
});

describe("StartHereCard: finding your lines", () => {
  const member = () => me({ membership: true, stageIndex: 4 });
  const doors = () => within(within(card()).getByRole("list", { name: "Other ways forward" })).getAllByRole("link").map((a) => a.getAttribute("href"));

  // CONTROL: drop the `myLines === null` test and the saved and reading cases go red.
  it("offers it last among the other doors while Gene Keys are on and nothing is saved, the quest still the step", () => {
    geneKeys.on = true;
    render(<StartHereCard ownerId="u1" me={member()} signing={null} config={config()} />);
    expect(link(/Propose a quest/)).toHaveAttribute("href", "/propose-quest");
    expect(link("Find your lines")).toHaveAttribute("href", "/profile/gene-keys");
    expect(doors()).toEqual(["/roles", "/profile/gene-keys"]);
    expect(within(card()).getByText(/so the roles and teams we suggest fit you/)).toBeInTheDocument();
  });

  it("offers it to a guest as well, beside the joining door", () => {
    geneKeys.on = true;
    render(<StartHereCard ownerId="u1" me={me()} signing={null} config={config()} />);
    expect(link(/Sign the Love Letter/)).toHaveAttribute("href", "/love-letter");
    expect(link("Find your lines")).toHaveAttribute("href", "/profile/gene-keys");
    expect(doors().at(-1)).toBe("/profile/gene-keys");
  });

  it("leaves it out once lines are saved, while they are still being read, and while the module is off", () => {
    geneKeys.on = true;
    geneKeys.mine = { lines: [2, 5] };
    const { unmount } = render(<StartHereCard ownerId="u1" me={member()} signing={null} config={config()} />);
    expect(within(card()).queryByRole("link", { name: "Find your lines" })).toBeNull();
    unmount();
    geneKeys.mine = undefined;
    const second = render(<StartHereCard ownerId="u1" me={member()} signing={null} config={config()} />);
    expect(within(card()).queryByRole("link", { name: "Find your lines" })).toBeNull();
    second.unmount();
    geneKeys.on = false;
    geneKeys.mine = null;
    render(<StartHereCard ownerId="u1" me={member()} signing={null} config={config()} />);
    expect(within(card()).queryByRole("link", { name: "Find your lines" })).toBeNull();
  });
});

describe("StartHereCard: never for anybody but the owner", () => {
  // CONTROL: make `viewerOwns` return true after its blank check and this goes
  // red: the card draws on somebody else's profile.
  it("draws nothing on another member's profile, and asks nothing about them", async () => {
    session.user = { id: "u1", name: "Wren Alder", handle: "wren" };
    const { container } = render(<StartHereCard ownerId="u2" me={me()} signing={null} config={config()} />);
    expect(container).toBeEmptyDOMElement();
    await new Promise((r) => setTimeout(r, 10));
    expect(gameFetch).not.toHaveBeenCalled();
  });

  // CONTROL: delete the `if (!viewer) return false` line in `viewerOwns` and
  // this goes red: a blank viewer and an owner not known yet compare equal.
  it("draws nothing for a visitor, even with a payload in hand and the owner not known yet", async () => {
    session.user = null;
    const { container } = render(<StartHereCard ownerId={undefined} me={me({ membership: true, stageIndex: 4 })} signing={null} config={config()} />);
    expect(container).toBeEmptyDOMElement();
    await new Promise((r) => setTimeout(r, 10));
    expect(gameFetch).not.toHaveBeenCalled();
  });

  it("draws nothing for a visitor on a named profile either", () => {
    session.user = null;
    const { container } = render(<StartHereCard ownerId="u1" me={me()} signing={null} config={config()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the card's pure rules", () => {
  it("reads admission the way server/lib/admission.ts does", () => {
    expect(isAdmittedHere({ membership: true, stageIndex: 1, stages: STAGES } as never)).toBe(true);
    expect(isAdmittedHere({ membership: false, stageIndex: 4, stages: STAGES } as never)).toBe(true);
    expect(isAdmittedHere({ membership: false, stageIndex: 3, stages: STAGES } as never)).toBe(false);
    // A ladder with no admission rung has no door, so nobody is kept out by one.
    expect(isAdmittedHere({ membership: false, stageIndex: 0, stages: [STAGES[0]] } as never)).toBe(true);
  });

  it("never matches two blanks as an owner", () => {
    expect(viewerOwns("u1", "u1")).toBe(true);
    expect(viewerOwns("u1", "u2")).toBe(false);
    expect(viewerOwns(undefined, undefined)).toBe(false);
    expect(viewerOwns("", "")).toBe(false);
  });

  it("names at most three powers and says there are more", () => {
    const rows = ["A one", "B two", "C three", "D four"].map((label) => ({
      key: label,
      label,
      held: false,
      opens: { via: "stage", stage: "member" },
    })) as unknown as ProgressionCapability[];
    expect(opensAtMembership(rows)).toBe("Membership opens 4 powers for you here: a one, b two, c three, and more.");
    expect(opensAtMembership(null)).toBe("");
  });
});
