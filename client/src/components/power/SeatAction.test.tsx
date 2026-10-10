// @vitest-environment jsdom
/**
 * THE CARD'S ONE DOOR, held to what the routes receive.
 *
 * Moved here from the map's old seat card test with its fetch stub and its
 * reason intact. Rye, 2026-09-14: "we need to have the UI created when
 * applying for a seat to have the end date." A field that renders and never
 * reaches the request is the defect this would otherwise hide, so the body is
 * read back off the stubbed fetch, and the server's refusal is read back off
 * the card.
 *
 * The action is rendered the way every host renders it: inside the seat card,
 * reading the card's view through the slot, so these also prove the slot.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fromMapSeat } from "@shared/roleSheetInputs";
import type { SheetContext } from "@shared/roleSheet";
import SeatTradingCard from "./SeatTradingCard";
import SeatAction from "./SeatAction";

vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

const DAY = 86400000;
const civil = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const SEASON_END = civil(Date.now() + 60 * DAY);
const ASKED = civil(Date.now() + 30 * DAY);
const SEASON = {
  current: { id: "now", name: "Now", startsOn: civil(Date.now() - 30 * DAY), endsOn: SEASON_END },
  upcoming: null,
  seasons: [{ id: "now", name: "Now", startsOn: civil(Date.now() - 30 * DAY), endsOn: SEASON_END }],
  timezone: "UTC",
  today: civil(Date.now()),
};

let raiseAnswer: { status: number; body: unknown } = { status: 200, body: { success: true } };
let contactAnswer: { status: number; body: unknown } = { status: 200, body: { success: true } };
const posted: Array<{ url: string; body: unknown }> = [];

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      const u = String(url);
      const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
      if (u === "/api/season") return reply(200, SEASON);
      if (u.includes("/raise-hand")) {
        posted.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")) });
        return reply(raiseAnswer.status, raiseAnswer.body);
      }
      if (u === "/api/map/contact") {
        posted.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")) });
        return reply(contactAnswer.status, contactAnswer.body);
      }
      return reply(200, []);
    }),
  );
});
afterAll(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  posted.length = 0;
  raiseAnswer = { status: 200, body: { success: true } };
  contactAnswer = { status: 200, body: { success: true } };
});

const CTX: SheetContext = { now: new Date(), season: null, classNames: null };
const DATA = { circles: [{ id: "land", name: "Land & Water" }], power: { decidesBy: null }, viewer: { viewPeople: true } };

const OPEN = {
  id: "seat-water",
  name: "Water Keeper",
  description: "",
  circleId: "land",
  seats: 1,
  holderCount: 0,
  vacant: true,
  state: "open",
  holders: [],
};
const HELD = {
  ...OPEN,
  id: "seat-bridge",
  name: "Bridge Keeper",
  holderCount: 1,
  vacant: false,
  state: "filled",
  holders: [{ userId: "u-ana", name: "Ana", kind: "member", lapsed: false }],
};

const cardFor = (seat: object) => (
  <SeatTradingCard input={fromMapSeat(seat, DATA, { signedIn: true })} ctx={CTX} action={<SeatAction circleId="land" />} />
);

async function openTheForm() {
  render(cardFor(OPEN));
  fireEvent.click(screen.getByRole("button", { name: "Raise your hand for Water Keeper" }));
  expect(await screen.findByText(new RegExp(`Ends with the season on ${SEASON_END}\\.`))).toBeTruthy();
}

describe("raising a hand", () => {
  it("sends the end date the member picked, after saying when the seat would end", async () => {
    await openTheForm();
    fireEvent.change(screen.getByLabelText("End date for your seat (optional)"), { target: { value: ASKED } });
    expect(await screen.findByText(new RegExp(`Ends on ${ASKED}\\.`))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Raise my hand" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ url: "/api/map/roles/seat-water/raise-hand", body: { note: "", termEndsOn: ASKED } });
    expect(await screen.findByText("Hand raised. The founding team will be in touch.", { selector: "p:not(.sr-only)" })).toBeTruthy();
  });

  it("sends no date when none was picked, so the seat ends with the season", async () => {
    await openTheForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise my hand" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body).toEqual({ note: "" });
  });

  it("shows the server's refusal in its own words, and says it in the card's live region", async () => {
    raiseAnswer = {
      status: 409,
      body: { error: "That end date has already passed. Pick a date after today.", code: "already_over" },
    };
    await openTheForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise my hand" }));
    const refusal = "That end date has already passed. Pick a date after today.";
    expect(await screen.findByText(refusal, { selector: "p:not(.sr-only)" })).toBeTruthy();
    // The card's own region, a child of the article. (The term field keeps its
    // own polite line for the date sentence, inside the open form.)
    await waitFor(() => expect(document.querySelector("article > p[aria-live]")!.textContent).toBe(refusal));
  });

  it("says who a raised hand reaches before it goes up", () => {
    render(cardFor(OPEN));
    expect(screen.getByText("A raised hand reaches the founding team, who will be in touch.")).toBeTruthy();
  });
});

describe("reaching a holder", () => {
  it("posts the message to the relay with the seat and its circle", async () => {
    render(cardFor(HELD));
    fireEvent.click(screen.getAllByRole("button", { name: "Contact Ana" })[0]);
    fireEvent.change(screen.getByLabelText("A few words for Ana"), { target: { value: "Can we talk about the bridge?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      url: "/api/map/contact",
      body: { toUserId: "u-ana", roleId: "seat-bridge", circleId: "land", message: "Can we talk about the bridge?" },
    });
    expect(await screen.findByText("Sent. They'll get an email they can reply to directly.", { selector: "p:not(.sr-only)" })).toBeTruthy();
  });

  it("shows the server's own sentence on a 403", async () => {
    const sentence = "Reaching people through the relay opens at the member stage";
    contactAnswer = { status: 403, body: { error: "stage_required", message: sentence } };
    render(cardFor(HELD));
    fireEvent.click(screen.getAllByRole("button", { name: "Contact Ana" })[0]);
    fireEvent.change(screen.getByLabelText("A few words for Ana"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(sentence, { selector: "p:not(.sr-only)" })).toBeTruthy();
  });
});

describe("a different seat", () => {
  it("clears a half-written note, so it never lands under another name", async () => {
    const { rerender } = render(cardFor(OPEN));
    fireEvent.click(screen.getByRole("button", { name: "Raise your hand for Water Keeper" }));
    fireEvent.change(screen.getByLabelText("Why this role calls to you (optional)"), { target: { value: "I keep bees" } });
    expect((screen.getByLabelText("Why this role calls to you (optional)") as HTMLTextAreaElement).value).toBe("I keep bees");

    rerender(cardFor({ ...OPEN, id: "seat-seed", name: "Seed Keeper" }));
    expect(screen.queryByLabelText("Why this role calls to you (optional)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Raise your hand for Seed Keeper" }));
    expect((screen.getByLabelText("Why this role calls to you (optional)") as HTMLTextAreaElement).value).toBe("");
  });

  it("control: the same seat keeps the note across a re-render", () => {
    const { rerender } = render(cardFor(OPEN));
    fireEvent.click(screen.getByRole("button", { name: "Raise your hand for Water Keeper" }));
    fireEvent.change(screen.getByLabelText("Why this role calls to you (optional)"), { target: { value: "I keep bees" } });
    rerender(cardFor({ ...OPEN }));
    expect((screen.getByLabelText("Why this role calls to you (optional)") as HTMLTextAreaElement).value).toBe("I keep bees");
  });
});

describe("outside a card", () => {
  it("renders nothing, because there is no seat to act on", () => {
    const { container } = render(<SeatAction />);
    expect(container.innerHTML).toBe("");
  });
});

/*
 * ONE DOOR FOR A MEMBER WHO READS TERMS (seat settings PR4). The host passes
 * `applyHref` only when the seat came with a `termsOffer` key, which the
 * server sends only to a reader holding terms.read. That reader's raised hand
 * opens "Apply for a seat" with this seat picked; nothing is posted to the
 * inbox. Everybody else keeps the inbox hand, above.
 */
describe("a member who reads terms", () => {
  it("is sent to the application wizard with the seat picked, and posts nothing", async () => {
    const { applyHrefFor } = await import("./SeatTermsSlot");
    const href = applyHrefFor({ ...OPEN, termsOffer: null });
    expect(href).toBe("/propose?type=role_application&seat=seat-water");
    render(<SeatTradingCard input={fromMapSeat(OPEN, DATA, { signedIn: true })} ctx={CTX} action={<SeatAction circleId="land" applyHref={href} />} />);
    const door = screen.getByRole("link", { name: "Raise your hand for Water Keeper" });
    expect(door.getAttribute("href")).toBe("/propose?type=role_application&seat=seat-water");
    expect(screen.getByText("Opens your application for this seat and its terms. A seat holder or the village adopts it.")).toBeTruthy();
    fireEvent.click(door);
    expect(posted).toHaveLength(0);
  });

  it("CONTROL: a reader served no termsOffer key keeps the inbox hand", async () => {
    const { applyHrefFor } = await import("./SeatTermsSlot");
    expect(applyHrefFor(OPEN)).toBeNull();
    expect(applyHrefFor({ ...OPEN, termsOffer: null, isExample: true })).toBeNull();
    render(cardFor(OPEN));
    expect(screen.getByRole("button", { name: "Raise your hand for Water Keeper" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Raise your hand for Water Keeper" })).toBeNull();
  });
});
