// @vitest-environment jsdom
/**
 * Raising a hand on an open seat carries the end date the member asks for.
 *
 * Rye, 2026-09-14: "we need to have the UI created when applying for a seat to
 * have the end date." Pinned here against what the route receives, because a
 * field that renders and never reaches the request is the defect this would
 * otherwise hide: the body is read back off the stubbed fetch, and the
 * server's refusal is read back off the card.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HolderCard from "./HolderCard";
import type { PowerData, PowerSeat } from "./types";

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
const posted: unknown[] = [];

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      const u = String(url);
      const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
      if (u === "/api/season") return reply(200, SEASON);
      if (u.includes("/raise-hand")) {
        posted.push(JSON.parse(String(init?.body ?? "{}")));
        return reply(raiseAnswer.status, raiseAnswer.body);
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
});

const seat: PowerSeat = {
  id: "seat-water",
  name: "Water Keeper",
  description: "",
  circleId: null,
  seats: 1,
  holderCount: 0,
  vacant: true,
  holders: [],
};

const data = {
  circles: [],
  roles: [seat],
  quests: [],
  power: {
    shape: null,
    shapeGloss: null,
    decidesBy: null,
    decidesByGloss: null,
    glossary: { shapes: [], decidesBy: [], domains: [], howChosen: [] },
  },
  relationTypes: [],
  relations: [],
  season: { current: null, nextRollAt: null },
  viewer: { viewPeople: false, canContact: false },
  vacantHighlight: false,
  conciergeEnabled: false,
} as PowerData;

async function openTheForm() {
  render(<HolderCard seat={seat} circle={null} data={data} />);
  fireEvent.click(screen.getByRole("button", { name: /raise your hand/ }));
  expect(await screen.findByText(new RegExp(`Ends with the season on ${SEASON_END}\\.`))).toBeTruthy();
}

describe("HolderCard, raising a hand", () => {
  it("sends the end date the member picked, after saying when the seat would end", async () => {
    await openTheForm();
    fireEvent.change(screen.getByLabelText("End date for your seat (optional)"), { target: { value: ASKED } });
    expect(await screen.findByText(new RegExp(`Ends on ${ASKED}\\.`))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Raise my hand" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ note: "", termEndsOn: ASKED });
    expect(await screen.findByText(/Hand raised\./)).toBeTruthy();
  });

  it("sends no date when none was picked, so the seat ends with the season", async () => {
    await openTheForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise my hand" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ note: "" });
  });

  it("shows the server's refusal in its own words", async () => {
    raiseAnswer = {
      status: 409,
      body: { error: "That end date has already passed. Pick a date after today.", code: "already_over" },
    };
    await openTheForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise my hand" }));
    expect(await screen.findByText("That end date has already passed. Pick a date after today.")).toBeTruthy();
  });
});
