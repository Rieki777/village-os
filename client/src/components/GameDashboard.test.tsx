// @vitest-environment jsdom
/**
 * The top of the character sheet, and the three things that can be true of it.
 *
 * This card used to be `if (!me) return null`, over a helper that answers null
 * for a dropped connection, a 500 and a signed-out reader alike. So a failed
 * request silently deleted the next-step banner, the balance, the sending
 * budget and every quest chip, and what remained looked exactly like a member
 * with no game state. The three cases below are the three answers that used to
 * be one, and the last one is the one that matters: a failure has to be
 * distinguishable from an emptiness, on screen, by a member.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";

vi.mock("@/hooks/useTokenNames", () => ({
  useTokenName: () => "Recognition",
  useTokenNameLower: () => "recognition",
  useValueTokenName: () => "village tokens",
}));

import { TOKEN_KEY } from "@/lib/gameApi";
import { announceProfileChange } from "@/lib/profileRefresh";
import GameDashboard from "./GameDashboard";

/** What `GET /api/game/me` answers for a member who is mid-quest. */
const payload = {
  nextAction: { href: "/quests", label: "Continue your community training" },
  stages: [],
  lastAdvance: null,
  gratitude: { balance: 12, budget: { total: 20, remaining: 8 } },
  quests: [
    { id: "c1", questId: "q1", questTitle: "Tend the orchard", status: "claimed" },
    { id: "c2", questId: "q2", questTitle: "Mend the fence", status: "submitted" },
    { id: "c3", questId: "q3", questTitle: "Carry the water", status: "consented" },
    { id: "c4", questId: "q4", questTitle: "Raise the barn", status: "declined" },
  ],
};

const answering = (impl: () => Promise<any>) => vi.stubGlobal("fetch", vi.fn(impl));

/**
 * A working `localStorage`, stubbed the way this repo's other tests do.
 *
 * Node 25 ships its own `localStorage` global that is inert without
 * `--localstorage-file`, and it wins over jsdom's under vitest, so the real
 * `authToken()` would throw rather than read. The shim keeps `authToken` and
 * `gameFetch` unmocked, which is the point: this file exercises the token
 * path the browser takes.
 */
const store = new Map<string, string>();
const stubStorage = () =>
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  });

const draw = () =>
  render(
    <Router>
      <GameDashboard />
    </Router>,
  );

beforeEach(() => {
  store.clear();
  store.set(TOKEN_KEY, "a-session");
  // Re-applied every test: `unstubAllGlobals` below takes it off with fetch.
  stubStorage();
});

afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

describe("GameDashboard", () => {
  it("draws the next step and the quest chips once the read lands", async () => {
    answering(async () => ({ ok: true, status: 200, json: async () => payload }));
    draw();

    expect(await screen.findByText("Continue your community training")).toBeTruthy();
    expect(screen.getByText("Tend the orchard")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Awaiting consent")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  /**
   * THE BALANCE IS NOT ON THIS CARD ANY MORE, and that is the assertion.
   *
   * This dashboard used to print the balance and the sending budget beside the
   * quest chips, which made it one of SIX places on the profile talking about
   * the same token. TheVessel owns all of it now, beside the send control.
   *
   * Asserting the absence rather than deleting the test: a balance quietly
   * reappearing here is the exact regression the consolidation exists to
   * prevent, and nothing else would catch it.
   */
  it("does NOT print the balance, which the vessel owns now", async () => {
    answering(async () => ({ ok: true, status: 200, json: async () => payload }));
    draw();
    await screen.findByText("Continue your community training");
    expect(screen.queryByText("12")).toBeNull();
    expect(screen.queryByText(/left this cycle/i)).toBeNull();
  });

  /**
   * WHY THE "Not accepted" CHIP IS NOT ASSERTED ABOVE.
   *
   * Its colours were audited at 4.41:1 and are fixed in the source, but the
   * chip cannot currently reach a screen from this card: the list is built
   * from `claimed`/`submitted` plus `consented`, and `declined` is in neither
   * half. So the contrast fix is a latent one, and this test pins the reason
   * rather than pretending to have rendered it. If a later change adds
   * declined claims to this list, this test fails and whoever makes that
   * change reads the note.
   */
  it("leaves a declined claim out of the four it lists", async () => {
    answering(async () => ({ ok: true, status: 200, json: async () => payload }));
    const { container } = draw();

    expect(await screen.findByText("Tend the orchard")).toBeTruthy();
    expect(container.textContent).not.toContain("Raise the barn");
    expect(container.textContent).not.toContain("Not accepted");
  });

  it("says it is loading rather than rendering an empty sheet", () => {
    answering(() => new Promise(() => {}));
    draw();
    const line = screen.getByRole("status");
    expect(line.textContent).toContain("Loading your next step");
    // The failure branch must not be showing at the same time.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("says the read failed and offers a retry, instead of vanishing", async () => {
    answering(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const { container } = draw();

    const line = await screen.findByRole("status");
    expect(line.textContent).toContain("Couldn't load your next step");
    // The whole point: this is NOT an empty sheet. Nothing that would be
    // drawn from a real payload is on screen claiming to be a fact.
    expect(container.textContent).not.toContain("You haven't claimed a quest yet");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("re-reads on Retry and draws what comes back", async () => {
    let fail = true;
    answering(async () =>
      fail
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => payload },
    );
    draw();

    const retry = await screen.findByRole("button", { name: "Retry" });
    fail = false;
    fireEvent.click(retry);

    expect(await screen.findByText("Continue your community training")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("re-reads when a write elsewhere on the profile announces a change", async () => {
    /*
     * THE OBSERVABLE CHANGED WITH THE CARD, AND THE SUBJECT DID NOT.
     *
     * This proved the re-read by watching the balance move 12 -> 30. The
     * balance moved to TheVessel, so the assertion moves to something this card
     * still draws: the next step's own label. The defect under test is
     * unchanged and is still the one that matters, a card that fetches once on
     * mount and keeps painting what it read before somebody's write.
     */
    let label = "Continue your community training";
    answering(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...payload, nextAction: { ...payload.nextAction, label } }),
    }));
    draw();
    expect(await screen.findByText("Continue your community training")).toBeTruthy();

    label = "Claim a quest on the land";
    announceProfileChange();

    expect(await screen.findByText("Claim a quest on the land")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Continue your community training")).toBeNull());
  });

  it("does not paint a Retry at a reader with no session", async () => {
    store.clear();
    const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }));
    vi.stubGlobal("fetch", spy);
    const { container } = draw();

    await waitFor(() => expect(container.textContent).not.toContain("Loading your next step"));
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
