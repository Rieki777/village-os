// @vitest-environment jsdom
/**
 * PR 9: tensions on the player role card, drawn from the real model.
 *
 * The count in plain words for every member, the words only where the server
 * sent them, never "No tensions raised" while one is open behind the holders,
 * and the raise control for a signed-in member who does not hold the role.
 * Guests and holders get no raise control; the holder's own card links to
 * Waiting on you instead. A proposal card reads "Starts once adopted".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PlayerCardInput, PlayerRoleIn, TensionIn } from "@shared/playerCard";
import { TENSION_COPY } from "@shared/roleTensions";
import { TASK_BOARD_PATH } from "@shared/sessionTasks";
import { PlayerRoleCardView } from "./PlayerRoleCard";
import { fixturePayload, fixtureRole } from "@/test/playerCardFixture";

let signedIn = true;
vi.mock("sonner", () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: signedIn ? { id: "u-reader" } : null }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  signedIn = true;
});

/** Any fetch fails the test: the card already knows who may raise, so the control asks nothing. */
function noFetch() {
  const fn = vi.fn(async () => {
    throw new Error("the card's raise control must not fetch");
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const withTensions = (tensions: TensionIn[] | undefined, over: Partial<PlayerRoleIn> = {}): PlayerRoleIn => ({ ...fixtureRole(1), tensions, ...over });

function draw(level: "member" | "self", extra: Partial<PlayerCardInput>) {
  render(<PlayerRoleCardView data={fixturePayload(1, level, extra)} />);
  return document.querySelector("[data-role-tensions='r1']") as HTMLElement | null;
}

const RAISE = new RegExp(`^${TENSION_COPY.raise}`);

describe("tensions on the card", () => {
  it("a member whose words are withheld reads the count, private to the holders, never No tensions raised", () => {
    const fetchFn = noFetch();
    const box = draw("member", { viewerMember: true, roles: [withTensions([{ id: "t1", status: "open", raisedBy: "", text: "" }])] })!;
    expect(box).toBeTruthy();
    expect(within(box).getByText("1 open tension, private to the role's holders")).toBeTruthy();
    expect(box.textContent).not.toContain("No tensions raised");
    expect(box.querySelector("[data-tension-words]")).toBeNull();
    // A member who does not hold the role may raise one, without a read of their own.
    expect(within(box).getByRole("button", { name: RAISE })).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("the raise box says who can read it before a word is written", () => {
    noFetch();
    const box = draw("member", { viewerMember: true, roles: [withTensions([])] })!;
    expect(within(box).getByText("No tensions raised")).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: RAISE }));
    expect(within(box).getByText("Only the role's holders and you can read this until it's answered.")).toBeTruthy();
  });

  it("counts answered this moon and shows the words brought to the circle to every member", () => {
    noFetch();
    const box = draw("member", {
      viewerMember: true,
      roles: [
        withTensions([
          { id: "a1", status: "answered", raisedBy: "", text: "", answeredAt: "2026-10-20T12:00:00Z" },
          { id: "a2", status: "answered", raisedBy: "", text: "Weekend intake needs a second person.", broughtToCircle: true, answeredAt: "2026-10-21T12:00:00Z" },
        ]),
      ],
    })!;
    expect(within(box).getByText("2 answered this moon")).toBeTruthy();
    expect(within(box).getByText("Brought to the circle")).toBeTruthy();
    expect(within(box).getByText("Weekend intake needs a second person.")).toBeTruthy();
  });

  it("the holder reads the open words on their own card, links to Waiting on you, and is offered no raise", () => {
    noFetch();
    const box = draw("self", { viewerMember: true, roles: [withTensions([{ id: "t1", status: "open", raisedBy: "", text: "Intake is slow on weekends." }])] })!;
    expect(within(box).getByText("1 open tension")).toBeTruthy();
    expect(within(box).getByText("Intake is slow on weekends.")).toBeTruthy();
    const link = within(box).getByRole("link", { name: "Answer them in Waiting on you" });
    expect(link.getAttribute("href")).toBe(TASK_BOARD_PATH);
    expect(within(box).queryByRole("button", { name: RAISE })).toBeNull();
  });

  it("a co-holder on another holder's card is offered no raise", () => {
    noFetch();
    const box = draw("member", { viewerMember: true, roles: [withTensions([], { viewerHolds: true })] })!;
    expect(within(box).queryByRole("button", { name: RAISE })).toBeNull();
    expect(within(box).queryByRole("link", { name: "Answer them in Waiting on you" })).toBeNull();
  });

  it("a guest reads no tensions and gets no raise control", () => {
    signedIn = false;
    noFetch();
    // The server sends a reader who is not a member no tensions at all: unread.
    const box = draw("member", { viewerMember: false, roles: [withTensions(undefined)] });
    expect(box).toBeNull();
    expect(screen.queryByRole("button", { name: RAISE })).toBeNull();
    expect(document.body.textContent).not.toContain("open tension");
  });

  it("a signed-in reader who is not a member is offered no raise even where tensions arrive", () => {
    noFetch();
    const box = draw("member", { viewerMember: false, roles: [withTensions([])] })!;
    expect(within(box).queryByRole("button", { name: RAISE })).toBeNull();
  });

  it("a proposal card reads Starts once adopted, with no raise control", () => {
    noFetch();
    const box = draw("member", { viewerMember: true, mode: "proposal", roles: [withTensions([])] })!;
    expect(within(box).getByText("Starts once adopted")).toBeTruthy();
    expect(within(box).queryByRole("button", { name: RAISE })).toBeNull();
  });
});
