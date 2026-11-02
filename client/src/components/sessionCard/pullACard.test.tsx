// @vitest-environment jsdom
/**
 * PULL A CARD in the room: it waits face down, anyone in the room may pull,
 * the card shows both skies labelled, the viewer's own line stays private until
 * they share it, and the facilitator can park an item for a tension. Nothing at
 * all while the module is off, for somebody outside the room, or once closed.
 *
 * The API is mocked; the shapes are the real ones from shared/sessionCard.ts,
 * and the reading is the real plain builder's on a real sky.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { chartAt, skyAt, zonedToUtc } from "@shared/geneKeysSky";
import { plainReading, readRoom, type CardView, type CardsAnswer } from "@shared/sessionCard";
import type { SessionItem } from "@shared/sessions";
import { makeView } from "@/components/sessions/__tests__/roomFixture";
import type { RoomActions } from "@/components/sessions/useSessionRoom";

const modules = { on: true };
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: (id: string) => id === "session-card" && modules.on }));

const api = vi.hoisted(() => ({ read: vi.fn(), pull: vi.fn(), share: vi.fn() }));
vi.mock("@/lib/sessionCardApi", () => ({
  CardRefusal: class extends Error {},
  readCards: api.read,
  pullCard: api.pull,
  shareMyLine: api.share,
}));

import PullACard, { CARD_WORDS } from "./PullACard";

const SKY = skyAt(new Date("2024-08-05T17:00:00Z"));
const facts = readRoom(
  [
    { userId: "2", name: "Bo Fern", chart: chartAt(zonedToUtc(1990, 6, 15, 14, 30, "America/New_York")) },
    { userId: "1", name: "Ada Moss", chart: null },
  ],
  SKY,
);
const reading = plainReading(facts);

function cardOf(over: Partial<CardView> = {}): CardView {
  return {
    id: 70,
    n: 1,
    pulledByName: "Ada",
    pulledAt: SKY.at,
    sky: SKY,
    collective: reading.collective,
    suggestions: reading.suggestions,
    welcomed: reading.welcomed,
    source: "plain",
    mine: reading.lines["2"],
    mineShared: false,
    shared: [],
    ...over,
  };
}

const answer = (cards: CardView[], over: Partial<CardsAnswer> = {}): CardsAnswer => ({ cards, mayPull: true, notRead: null, ...over });

const item = (id: number, title: string): SessionItem =>
  ({ id, title, aim: "decide", minutes: 10, position: id, status: "waiting", presenterUserId: null, addedBy: 1, startedAt: null, endedAt: null, usedSeconds: 0, fromSessionId: null }) as SessionItem;

function doors(log: unknown[]): RoomActions {
  return { patchItem: async (...a: unknown[]) => { log.push(a); return { ok: true, body: {}, room: null }; } } as unknown as RoomActions;
}

const show = (ui: React.ReactElement) => render(<Router hook={memoryLocation({ path: "/sessions/1" }).hook}>{ui}</Router>);

beforeEach(() => {
  modules.on = true;
  api.read.mockReset().mockResolvedValue(answer([]));
  api.pull.mockReset();
  api.share.mockReset();
});
afterEach(cleanup);

describe("pull a card", () => {
  it("draws nothing while the module is off, for somebody outside the room, or once the session closes", () => {
    modules.on = false;
    const off = show(<PullACard view={makeView()} />);
    expect(off.container.textContent).toBe("");
    off.unmount();
    modules.on = true;
    const outside = show(<PullACard view={makeView({ me: { userId: 9, joined: false, facilitates: false, secretary: false, admin: false } })} />);
    expect(outside.container.textContent).toBe("");
    outside.unmount();
    expect(show(<PullACard view={makeView({ status: "closed" })} />).container.textContent).toBe("");
    expect(api.read).not.toHaveBeenCalled();
  });

  it("waits face down with its promise, and turns over the card anyone pulls", async () => {
    show(<PullACard view={makeView()} />);
    expect(screen.getByText(CARD_WORDS.lede)).toBeTruthy();
    api.pull.mockResolvedValue(answer([cardOf()]));
    fireEvent.click(screen.getByRole("button", { name: CARD_WORDS.pull }));
    await waitFor(() => expect(screen.getByText(`Gate ${SKY.gates.Sun.gate}.${SKY.gates.Sun.line}`)).toBeTruthy());
    expect(api.pull).toHaveBeenCalledWith(7);
    // Both skies, each labelled with its system.
    expect(screen.getAllByText("Human Design and Gene Keys").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Western astrology").length).toBeGreaterThan(0);
    expect(screen.getByText(/Retrograde: Mercury/)).toBeTruthy();
    expect(screen.getByText("Welcome too, Ada.")).toBeTruthy();
    expect(screen.getByRole("button", { name: CARD_WORDS.again })).toBeTruthy();
  });

  it("keeps the viewer's line private until they share it", async () => {
    api.read.mockResolvedValue(answer([cardOf()]));
    show(<PullACard view={makeView()} />);
    await waitFor(() => expect(screen.getByText(reading.lines["2"])).toBeTruthy());
    expect(screen.getByText(CARD_WORDS.privateMine)).toBeTruthy();
    api.share.mockResolvedValue(answer([cardOf({ mineShared: true })]));
    fireEvent.click(screen.getByRole("button", { name: CARD_WORDS.shareMine }));
    await waitFor(() => expect(screen.getByText(CARD_WORDS.sharedMine)).toBeTruthy());
    expect(api.share).toHaveBeenCalledWith(7, 70, true);
  });

  it("tells somebody the card did not read how to be read, and shows the lines others shared", async () => {
    api.read.mockResolvedValue(answer([cardOf({ mine: null, shared: [{ name: "Bo", line: "Bo's own words." }] })], { notRead: "no-maia" }));
    show(<PullACard view={makeView()} />);
    await waitFor(() => expect(screen.getByText(CARD_WORDS.notRead["no-maia"], { exact: false })).toBeTruthy());
    expect(screen.getByText("Bo's own words.")).toBeTruthy();
  });

  it("lets the facilitator park an item when the card counsels holding a tension", async () => {
    const hold = { kind: "hold-conflict" as const, system: "western" as const, words: "The Moon is void of course." };
    api.read.mockResolvedValue(answer([cardOf({ suggestions: [hold] })]));
    const log: unknown[] = [];
    const view = makeView({ items: [item(4, "The fence between us")], me: { userId: 2, joined: true, facilitates: true, secretary: false, admin: false } });
    show(<PullACard view={view} actions={doors(log)} />);
    await waitFor(() => expect(screen.getByText("The fence between us")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: CARD_WORDS.park }));
    await waitFor(() => expect(screen.getByText(CARD_WORDS.parked)).toBeTruthy());
    expect(log).toEqual([[4, { status: "parked" }]]);
  });

  it("pages back through earlier cards, newest first", async () => {
    api.read.mockResolvedValue(answer([cardOf({ id: 8, n: 2, pulledByName: "Bo" }), cardOf()]));
    show(<PullACard view={makeView()} />);
    await waitFor(() => expect(screen.getByText(/Card 2 · pulled by Bo/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: CARD_WORDS.earlier }));
    await waitFor(() => expect(screen.getByText(/Card 1 · pulled by Ada/)).toBeTruthy());
  });
});
