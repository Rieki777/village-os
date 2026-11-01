// @vitest-environment jsdom
/**
 * THE INVITATION TO THE CARD (Rye, 2026-11-01: "have the opt in pop-up on
 * members screen when the admin pulls a card so everyone can easily
 * participate in the card reading if they want", with a way to find their
 * lines so it works as a quick onboarding too).
 *
 * When a card is in the room and the viewer is not read on it, a pop-up asks
 * them in. One tap turns on exactly what being read needs, and the pop-up
 * names each of those things first. "Not today" closes it for this session.
 * Somebody with no lines yet is sent to find them and brought back. Nobody
 * already read sees it, nor anybody outside the room, nor anybody while the
 * module is off. The room's card poll is shared: the pop-up adds no request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { skyAt } from "@shared/geneKeysSky";
import type { CardView, CardsAnswer } from "@shared/sessionCard";
import type { OwnGeneKeysView } from "@shared/geneKeys";
import { makeView } from "@/components/sessions/__tests__/roomFixture";

const modules = vi.hoisted(() => ({ on: true }));
vi.mock("@/modules/ModuleProvider", () => ({
  useModuleOn: (id: string) => (id === "session-card" || id === "gene-keys") && modules.on,
  useModule: (id: string) => (id === "gene-keys" && modules.on ? { id, lifecycle: "members" } : undefined),
}));

const api = vi.hoisted(() => ({ read: vi.fn(), changed: [] as unknown[] }));
vi.mock("@/lib/sessionCardApi", () => ({
  CardRefusal: class extends Error {},
  readCards: api.read,
  pullCard: vi.fn(),
  shareMyLine: vi.fn(),
}));
vi.mock("@/lib/geneKeysApi", () => ({
  readMyGeneKeys: async () => null,
  changeMyGeneKeys: async (patch: unknown) => {
    api.changed.push(patch);
    return null;
  },
  GeneKeysRefusal: class extends Error {},
}));

import CardInvite, { INVITE_WORDS } from "./CardInvite";
import { forgetSharedCards } from "./sharedCards";
import { setMyGeneKeys } from "@/components/geneKeys/useMyGeneKeys";

const SKY = skyAt(new Date("2024-08-05T17:00:00Z"));
const card = (id = 70): CardView => ({
  id, n: 1, pulledByName: "Ada", pulledAt: SKY.at, sky: SKY, collective: [], suggestions: [], welcomed: ["Bo"],
  source: "plain", mine: null, mineShared: false, shared: [],
});
const answer = (cards: CardView[], notRead: CardsAnswer["notRead"]): CardsAnswer => ({ cards, mayPull: true, notRead });
const mine = (over: Partial<OwnGeneKeysView> = {}) =>
  ({ visibility: "hide", maia: false, cardIn: false, cardOut: false, inCards: false, ...over }) as OwnGeneKeysView;

const show = (view = makeView()) => render(<Router hook={memoryLocation({ path: `/sessions/${view.id}` }).hook}><CardInvite view={view} /></Router>);

beforeEach(() => {
  modules.on = true;
  api.read.mockReset();
  api.changed = [];
  forgetSharedCards();
  setMyGeneKeys(null);
  try {
    localStorage.clear();
  } catch {
    /* a browser without storage still runs the pop-up */
  }
});
afterEach(cleanup);

describe("the invitation to the card", () => {
  it("waits until a card is in the room", async () => {
    api.read.mockResolvedValue(answer([], "not-asked"));
    show();
    await waitFor(() => expect(api.read).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names each thing one tap turns on, then turns on exactly those", async () => {
    setMyGeneKeys(mine());
    api.read.mockResolvedValue(answer([card()], "not-asked"));
    show();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(INVITE_WORDS.consent.show);
    expect(dialog.textContent).toContain(INVITE_WORDS.consent.maia);
    expect(dialog.textContent).toContain(INVITE_WORDS.consent.cards);
    expect(dialog.textContent).toContain(INVITE_WORDS.nextCard);
    fireEvent.click(screen.getByRole("button", { name: INVITE_WORDS.yes }));
    await waitFor(() => expect(api.changed).toEqual([{ visibility: "show", maia: true, cards: true }]));
  });

  it("asks only for what is still off: lines already shown and Maia allowed means the card's own yes alone", async () => {
    setMyGeneKeys(mine({ visibility: "show", maia: true }));
    api.read.mockResolvedValue(answer([card()], "not-asked"));
    show();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).not.toContain(INVITE_WORDS.consent.show);
    expect(dialog.textContent).not.toContain(INVITE_WORDS.consent.maia);
    fireEvent.click(screen.getByRole("button", { name: INVITE_WORDS.yes }));
    await waitFor(() => expect(api.changed).toEqual([{ cards: true }]));
  });

  it("closes on Not today and never comes back in this session, but asks again in the next", async () => {
    setMyGeneKeys(mine());
    api.read.mockResolvedValue(answer([card()], "left-out"));
    show(makeView({ id: 7 }));
    fireEvent.click(await screen.findByRole("button", { name: INVITE_WORDS.notToday }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.changed).toEqual([]);
    cleanup();
    forgetSharedCards();
    api.read.mockResolvedValue(answer([card(71)], "left-out"));
    show(makeView({ id: 7 }));
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    forgetSharedCards();
    show(makeView({ id: 8 }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("sends somebody with no lines to find them, and back to this room after", async () => {
    api.read.mockResolvedValue(answer([card()], "no-lines"));
    show(makeView({ id: 7 }));
    const link = await screen.findByRole("link", { name: INVITE_WORDS.findLines });
    expect(link.getAttribute("href")).toBe("/profile/gene-keys?next=%2Fsessions%2F7");
    expect(screen.queryByRole("button", { name: INVITE_WORDS.yes })).toBeNull();
  });

  it("is never shown to somebody the card already reads", async () => {
    setMyGeneKeys(mine({ visibility: "show", maia: true, cardIn: true, inCards: true }));
    api.read.mockResolvedValue(answer([card()], null));
    show();
    await waitFor(() => expect(api.read).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is never shown, and asks nothing, while the module is off or to somebody outside the room", async () => {
    modules.on = false;
    show();
    show(makeView({ status: "closed" } as never));
    modules.on = true;
    const outside = makeView();
    outside.me = { ...outside.me, joined: false };
    show(outside);
    await new Promise((r) => setTimeout(r, 30));
    expect(api.read).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays quiet for a former member the card door refuses", async () => {
    api.read.mockRejectedValue(new Error("auth_required"));
    show();
    await waitFor(() => expect(api.read).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shares the room's one card poll: two readers in the room make one request", async () => {
    api.read.mockResolvedValue(answer([], "not-asked"));
    const view = makeView();
    render(
      <Router hook={memoryLocation({ path: `/sessions/${view.id}` }).hook}>
        <CardInvite view={view} />
        <CardInvite view={view} />
      </Router>,
    );
    await waitFor(() => expect(api.read).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(api.read).toHaveBeenCalledTimes(1);
  });

  it("gives every tap the room's 44 pixel height", async () => {
    setMyGeneKeys(mine());
    api.read.mockResolvedValue(answer([card()], "not-asked"));
    show();
    await screen.findByRole("dialog");
    for (const b of screen.getAllByRole("button")) {
      // The dialog's own corner close is the shared primitive's, not this pop-up's.
      if ((b.textContent ?? "").trim() === "Close") continue;
      expect(b.className, b.textContent ?? "").toMatch(/min-h-11/);
    }
  });
});
