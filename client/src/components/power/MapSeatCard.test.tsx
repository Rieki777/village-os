// @vitest-environment jsdom
/**
 * THE MAP'S SEAT CARD: the old seat card's props in, the role card out.
 *
 * `VillageMap` mounts this twice on purpose (the standing panel and the phone
 * sheet, one hidden by CSS), so the two reads it makes, the season and the
 * village's class names, must cost one request each however many cards ask.
 * And a stranger on the map must not trigger a members-only read: the seat's
 * history sits behind `map.viewPeople`, and only a reader who can see people
 * asks for it.
 *
 * THE FIRST TEST COUNTS REQUESTS, and it is first on purpose: both reads are
 * cached for the life of the module, which is this file, so a later test
 * would see the cache and count nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MapSeatCard from "./MapSeatCard";
import type { PowerData, PowerSeat } from "./types";

vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

const asked: string[] = [];
const ARCHETYPES = [
  { key: "researching", name: "The Architect" },
  { key: "building", name: "The Builder" },
];

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      asked.push(u);
      const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (u === "/api/archetypes") return reply(ARCHETYPES);
      if (u === "/api/season") return reply({ current: { name: "Season of Foundations", endsOn: "2099-03-21" }, daysLeft: 171 });
      return reply([]);
    }),
  );
});

const SEAT = {
  id: "water-keeper",
  name: "Water Keeper",
  description: "Keep the village's water clean.",
  circleId: "land",
  seats: 2,
  holderCount: 1,
  vacant: true,
  state: "partial",
  archetypes: ["researching"],
  holders: [{ userId: "u-mara", name: "Mara Quill", kind: "member", lapsed: false, avatar: null }],
} as unknown as PowerSeat;
const CIRCLE = { id: "land", name: "Land & Water" };

const data = (viewPeople: boolean) =>
  ({
    circles: [CIRCLE],
    roles: [SEAT],
    quests: [],
    power: { shape: null, shapeGloss: null, decidesBy: "consent", decidesByGloss: null, glossary: { shapes: [], decidesBy: [], domains: [], howChosen: [] } },
    relationTypes: [],
    relations: [],
    season: { current: null, nextRollAt: null },
    viewer: { viewPeople, canContact: false },
    vacantHighlight: false,
    conciergeEnabled: false,
  }) as unknown as PowerData;

const historyAsks = () => asked.filter((u) => u.includes("/history"));

describe("MapSeatCard", () => {
  it("makes one season read and one class-name read for two mounted cards", async () => {
    render(
      <>
        <MapSeatCard seat={SEAT} circle={CIRCLE} data={data(true)} />
        <MapSeatCard seat={SEAT} circle={CIRCLE} data={data(true)} />
      </>,
    );
    // Both cards have read both: the class name and the season clock are drawn twice.
    await waitFor(() => expect(screen.getAllByText("The Architect")).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByText("Season of Foundations ends 21 Mar 2099")).toHaveLength(2));
    expect(asked.filter((u) => u === "/api/archetypes")).toHaveLength(1);
    expect(asked.filter((u) => u === "/api/season")).toHaveLength(1);
  });

  it("renders the role card from the map's own props", () => {
    render(<MapSeatCard seat={SEAT} circle={CIRCLE} data={data(true)} />);
    expect(screen.getByRole("heading", { level: 3, name: "Water Keeper" })).toBeTruthy();
    expect(screen.getByText("Mara Quill")).toBeTruthy();
    expect(document.querySelector("article[data-power-card]")).toBeTruthy();
    // Nobody is signed in here, so the door is the sign-in link, back to this page.
    expect(screen.getByRole("link", { name: /Sign in to raise your hand/ }).getAttribute("href")).toMatch(/^\/login\?next=/);
  });

  it("filters the map to a holder when their row is tapped", () => {
    const pick = vi.fn();
    render(<MapSeatCard seat={SEAT} circle={CIRCLE} data={data(true)} onPickPerson={pick} />);
    screen.getByRole("button", { name: "Show every role Mara Quill holds" }).click();
    expect(pick).toHaveBeenCalledWith("u-mara", "Mara Quill");
  });

  it("tells the seat's story below a real seat, and not below an example", async () => {
    render(<MapSeatCard seat={SEAT} circle={CIRCLE} data={data(true)} />);
    await waitFor(() => expect(historyAsks()).toEqual(["/api/org/roles/water-keeper/history"]));
    // The history sits outside the night card, in the lens's own ink.
    const host = document.querySelector("div[data-power-card]")!;
    expect(host.querySelector(":scope > div.border-t")).toBeTruthy();
    expect(host.querySelector("article")!.contains(host.querySelector(":scope > div.border-t"))).toBe(false);

    asked.length = 0;
    render(<MapSeatCard seat={{ ...SEAT, id: "example-seat", isExample: true }} circle={CIRCLE} data={data(true)} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(asked.filter((u) => u.includes("example-seat"))).toEqual([]);
  });

  it("asks a stranger's map for nothing members-only", async () => {
    render(<MapSeatCard seat={{ ...SEAT, holders: [] }} circle={CIRCLE} data={data(false)} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(historyAsks()).toEqual([]);
    expect(asked.every((u) => !u.startsWith("/api/me") && !u.startsWith("/api/org/"))).toBe(true);
    expect(screen.getByText("Sign in to see who holds it.")).toBeTruthy();
  });
});
