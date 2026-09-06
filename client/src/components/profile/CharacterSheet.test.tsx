// @vitest-environment jsdom
/**
 * The three character-sheet sections, rendered.
 *
 * These carry the claims the sheet makes about a member, and every one of them
 * is a claim that can be wrong in a way `tsc` cannot see: a rung pointed at
 * that opens nothing, a count invented for a rung that counts nothing, a
 * closed power described as opening at a rung the member walked past months
 * ago. Each of those renders perfectly and says something untrue.
 *
 * So these are behaviour tests over the payload shapes the server actually
 * sends, and they assert the ABSENCE of the fabrications as hard as they
 * assert the presence of the facts.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import MaturityLadder from "./MaturityLadder";
import PowersMap from "./PowersMap";
import PathsPanel from "./PathsPanel";
import type { GameStagePublic, ProgressionCapability } from "@/lib/gameApi";

/**
 * A ladder shaped like the one `servedLadder()` sends: rules of several types,
 * and the quests rung carrying the threshold ALREADY overlaid from the
 * variables registry. 7 is deliberately not the platform default, so a test
 * that passed by reading `GAME_CONFIG` would fail here.
 */
const stages: GameStagePublic[] = [
  { id: "visitor", name: "Visitor", description: "Discovering what this village is.", rule: { type: "default" } , gratitudeMultiplier: 0 },
  { id: "guest", name: "Guest", description: "Created a profile.", rule: { type: "account" } , gratitudeMultiplier: 1 },
  { id: "immersant", name: "Immersant", description: "Spent immersive time here.", rule: { type: "granted" } , gratitudeMultiplier: 1 },
  { id: "member", name: "Member", description: "Joined the community.", rule: { type: "membership" } , gratitudeMultiplier: 2 },
  { id: "contributor", name: "Contributor", description: "Completed a first quest.", rule: { type: "quests", min: 1 } , gratitudeMultiplier: 2 },
  { id: "quest-seeker", name: "Quest Seeker", description: "Contributing steadily.", rule: { type: "quests", min: 7 } , gratitudeMultiplier: 2 },
  { id: "co-creator", name: "Co-Creator", description: "Consented by the circle.", rule: { type: "granted" } , gratitudeMultiplier: 3 },
];

const cap = (
  key: string,
  label: string,
  held: boolean,
  opens: ProgressionCapability["opens"],
): ProgressionCapability => ({ key, label, held, opens }) as ProgressionCapability;

describe("MaturityLadder", () => {
  it("marks the rung you stand on with aria-current and no separator character", () => {
    const { container } = render(
      <MaturityLadder stages={stages} stageIndex={4} consentedQuests={5} />,
    );
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Contributor");

    // The old ladder joined rungs with a literal middle dot, which screen
    // readers announce. Nothing in this list may reintroduce one.
    const list = container.querySelector("ol");
    expect(list?.textContent ?? "").not.toContain("·");
  });

  it("says the distance to the next rung from the SERVED threshold", () => {
    render(<MaturityLadder stages={stages} stageIndex={4} consentedQuests={5} />);
    // 7 is the overlaid village number, so the distance is 2 and never 3.
    expect(screen.getByText(/2 more consented quests and you reach Quest Seeker/)).toBeTruthy();
    expect(screen.getByText(/of 7 consented so far/).textContent).toContain("5");
  });

  it("uses the singular when exactly one is left", () => {
    render(<MaturityLadder stages={stages} stageIndex={4} consentedQuests={6} />);
    expect(screen.getByText(/1 more consented quest and you reach Quest Seeker/)).toBeTruthy();
  });

  it("invents no count for a rung that counts nothing", () => {
    // Standing at Immersant, the next rung is Member, earned by signing. There
    // is no numerator for that, so no fraction may appear.
    render(<MaturityLadder stages={stages} stageIndex={2} consentedQuests={4} />);
    // Exactly once. It rendered twice before this test existed, because the
    // box and a trailing paragraph both printed the same sentence.
    expect(screen.getAllByText(/Opens when you sign the membership agreement/)).toHaveLength(1);
    expect(screen.queryByText(/consented so far/)).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("draws the bar only where the rule has a denominator", () => {
    // Contributor -> Quest Seeker is a quests rung: 5 of 7, so a bar is honest.
    const { container: counted } = render(
      <MaturityLadder stages={stages} stageIndex={4} consentedQuests={5} />,
    );
    const bar = counted.querySelector('[role="progressbar"]');
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute("aria-valuenow")).toBe("5");
    expect(bar?.getAttribute("aria-valuemax")).toBe("7");

    // Immersant -> Member turns on a signature. There is no denominator, so
    // there must be no bar at all.
    const { container: uncounted } = render(
      <MaturityLadder stages={stages} stageIndex={2} consentedQuests={4} />,
    );
    expect(uncounted.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("clamps the bar when the threshold moved under a member's feet", () => {
    // A village lowering its threshold can leave the count above the minimum.
    const { container } = render(
      <MaturityLadder stages={stages} stageIndex={4} consentedQuests={99} />,
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("7");
    expect((bar?.firstElementChild as HTMLElement).style.width).toBe("100%");
  });

  it("says what the next rung pays only when it pays something different", () => {
    // member(2) -> contributor(2): identical, so the clause stays away.
    render(<MaturityLadder stages={stages} stageIndex={3} consentedQuests={0} />);
    expect(screen.queryByText(/sending allowance/)).toBeNull();
  });

  it("names the rise in the allowance from the SERVED multiplier", () => {
    // immersant(1) -> member(2), and the singular is handled.
    render(<MaturityLadder stages={stages} stageIndex={2} consentedQuests={0} />);
    expect(screen.getByText(/1 time the base now, and 2 times at Member/)).toBeTruthy();
  });

  it("says so plainly on the last rung instead of pointing at nothing", () => {
    render(<MaturityLadder stages={stages} stageIndex={6} consentedQuests={9} />);
    expect(screen.getByText(/last rung this village has named/)).toBeTruthy();
  });
});

describe("PowersMap", () => {
  const catalogue: ProgressionCapability[] = [
    cap("forum.post", "Start a thread in the forum", true, { via: "stage", stage: "member" }),
    cap("map.viewPeople", "See who holds seats", true, { via: "stage", stage: "guest" }),
    // Nothing opens at co-creator here, and quest-seeker opens two. The next
    // rung is therefore quest-seeker, which is stageIndex + 1 by luck; the
    // test below removes that luck.
    cap("member.vouch", "Vouch for an applicant", false, { via: "stage", stage: "quest-seeker" }),
    cap("proposal.open", "Open a governance decision", false, { via: "stage", stage: "co-creator" }),
    cap("org.seat", "Seat and unseat holders", false, { via: "appointment" }),
  ];

  it("names the lowest rung that opens something, skipping rungs that open nothing", () => {
    // Standing at member (index 3). The rung immediately above is contributor
    // (index 4), which opens NOTHING in this catalogue. Pointing at it would
    // promise a reward the config does not hold, so the next group must name
    // Quest Seeker.
    render(<PowersMap catalogue={catalogue} stages={stages} stageIndex={3} />);
    expect(screen.getByText("Opens at Quest Seeker")).toBeTruthy();
    expect(screen.queryByText("Opens at Contributor")).toBeNull();
  });

  it("counts what is open against what this village runs", () => {
    render(<PowersMap catalogue={catalogue} stages={stages} stageIndex={3} />);
    expect(screen.getByText(/5 powers exist in this village/)).toBeTruthy();
    // The open tally sits in its own span next to the sentence. Queried by its
    // element, because a bare "2" also matches the per-group counts.
    const openTally = screen.getByText(/5 powers exist in this village/).querySelector("span");
    expect(openTally?.textContent).toBe("2");
  });

  it("separates what is appointed from what is climbed", () => {
    render(<PowersMap catalogue={catalogue} stages={stages} stageIndex={3} />);
    const appointed = screen.getByText("The village appoints these").closest("div")?.parentElement;
    expect(within(appointed as HTMLElement).getByText("Seat and unseat holders")).toBeTruthy();
  });

  it("never tells a member a closed power opens at a rung they already walked", () => {
    // A badge deny beats the ladder, so this member stands at co-creator with
    // a member-rung power still closed. The honest bucket says it is closed;
    // what it must not say is "At Member".
    const denied = [cap("forum.post", "Start a thread in the forum", false, { via: "stage", stage: "member" })];
    render(<PowersMap catalogue={denied} stages={stages} stageIndex={6} />);
    expect(screen.getByText("Closed on your account")).toBeTruthy();
    expect(screen.queryByText("Opens at Member")).toBeNull();
  });

  it("hides the closed groups on request and keeps what is open", () => {
    render(<PowersMap catalogue={catalogue} stages={stages} stageIndex={3} />);
    const toggle = screen.getByRole("button", { name: /Hide what is closed/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.getByText("Open to you")).toBeTruthy();
    expect(screen.queryByText("The village appoints these")).toBeNull();
  });
});

describe("PathsPanel", () => {
  const tiles = [
    { id: "investor", label: "Investor", role: "Capital Contributor", route: "/investor", offered: true },
    { id: "steward", label: "Village Steward", role: "Co-Creator", route: "/steward", offered: true },
  ];

  it("says which paths you walk and offers the door for each", () => {
    render(
      <PathsPanel
        tiles={tiles}
        claimedIds={["steward"]}
        offerKnown
        saving={null}
        error=""
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("You walk this path.")).toBeTruthy();
    expect(screen.getByText("You do not walk this path.")).toBeTruthy();
    expect(screen.getAllByText("What this path asks")).toHaveLength(2);
  });

  // Ladders now exist and arrive as their own payload; a caller that has not
  // fetched one still gets exactly the panel it used to. The bar stays gone in
  // every case, and `PathLadder.test.tsx` holds that line where a ladder IS
  // drawn.
  it("draws no ladder and no progress bar for a caller that fetched none", () => {
    const { container } = render(
      <PathsPanel tiles={tiles} claimedIds={["steward"]} offerKnown saving={null} error="" onToggle={() => {}} />,
    );
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent).not.toMatch(/%/);
    expect(container.textContent).not.toMatch(/\bof \d+ seasons\b/);
  });

  it("stays silent about a retired path until the offer has actually arrived", () => {
    const held = [{ id: "elder", label: "elder", role: "", route: "", offered: false }];
    const { rerender } = render(
      <PathsPanel tiles={held} claimedIds={["elder"]} offerKnown={false} saving={null} error="" onToggle={() => {}} />,
    );
    expect(screen.queryByText("No longer offered here.")).toBeNull();

    rerender(
      <PathsPanel tiles={held} claimedIds={["elder"]} offerKnown saving={null} error="" onToggle={() => {}} />,
    );
    expect(screen.getByText("No longer offered here.")).toBeTruthy();
  });

  it("reports a refusal and leaves the tile as it was", () => {
    const onToggle = vi.fn();
    render(
      <PathsPanel
        tiles={tiles}
        claimedIds={[]}
        offerKnown
        saving={null}
        error="Your session ended. Sign in again to change your paths."
        onToggle={onToggle}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Your session ended");
    expect(screen.getAllByText("You do not walk this path.")).toHaveLength(2);
  });
});
