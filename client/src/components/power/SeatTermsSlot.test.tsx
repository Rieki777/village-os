// @vitest-environment jsdom
/**
 * THE DRAWER ON A LIVE SEAT CARD, and who it is for (seat settings PR3).
 *
 * The server sends `termsOffer` on a seat only to a reader holding
 * `terms.read`. The hosts never ask again: `termsSlotFor` reads the presence
 * of the key, so a visitor's and a guest's card draws no tray, no trigger and
 * no empty state, and makes no request for the village's presets. A member
 * reads the drawer, or "No terms on offer yet." with a way to propose some.
 *
 * Every figure is fake: XTS is the ISO 4217 code reserved for testing.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MapSeatCard from "./MapSeatCard";
import { termsSlotFor } from "./SeatTermsSlot";
import type { PowerData, PowerSeat } from "./types";

vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));
const session = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => session.token,
}));

const asked: string[] = [];
beforeEach(() => {
  asked.length = 0;
  session.token = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      asked.push(String(url));
      const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (String(url) === "/api/seat-presets") return reply({ presets: [] });
      return reply([]);
    }),
  );
});

const BASE = {
  id: "water-keeper",
  name: "Water Keeper",
  description: "Keep the village's water clean.",
  circleId: "land",
  seats: 2,
  holderCount: 0,
  vacant: true,
  state: "open",
  holders: [],
};
const FAKE_OFFER = { v: 1, pay: { kind: "fixed", currency: "XTS", amountMinor: 100000, per: "month" } };

const data = (seat: object) =>
  ({
    circles: [{ id: "land", name: "Land & Water" }],
    roles: [seat],
    quests: [],
    power: { shape: null, shapeGloss: null, decidesBy: "consent", decidesByGloss: null, glossary: { shapes: [], decidesBy: [], domains: [], howChosen: [] } },
    relationTypes: [],
    relations: [],
    season: { current: null, nextRollAt: null },
    viewer: { viewPeople: false, canContact: false },
    vacantHighlight: false,
    conciergeEnabled: false,
  }) as unknown as PowerData;

const mount = (seat: object) =>
  render(<MapSeatCard seat={seat as PowerSeat} circle={{ id: "land", name: "Land & Water" } as any} data={data(seat)} />);

describe("the slot decides on the key the server sent", () => {
  it("no key: nothing at all, so a visitor's card has no tray", () => {
    expect(termsSlotFor(BASE)).toBeUndefined();
    expect(termsSlotFor(null)).toBeUndefined();
  });

  it("the key present, null or set: a slot", () => {
    expect(termsSlotFor({ ...BASE, termsOffer: null })).toBeDefined();
    expect(termsSlotFor({ ...BASE, termsOffer: FAKE_OFFER })).toBeDefined();
  });
});

describe("a host, the map's seat card", () => {
  it("a visitor's seat (no termsOffer key) renders no drawer and asks for no presets", () => {
    const { container } = mount(BASE);
    expect(container.querySelector("[data-seat-terms]")).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByText("No terms on offer yet.")).toBeNull();
    expect(asked).not.toContain("/api/seat-presets");
  });

  it("control: a member's seat with an offer renders the drawer", () => {
    session.token = "member-token";
    const { container } = mount({ ...BASE, termsOffer: FAKE_OFFER });
    expect(container.querySelector("[data-seat-terms]")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Settings/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("a member's seat with no offer says so, and links to proposing terms", () => {
    session.token = "member-token";
    mount({ ...BASE, termsOffer: null });
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(screen.getByText("No terms on offer yet.")).toBeVisible();
    const link = screen.getByRole("link", { name: "Propose terms" });
    expect(link.getAttribute("href")).toBe("/propose?type=role_application&seat=water-keeper");
  });

  it("a standing example offers no way to propose terms for it", () => {
    session.token = "member-token";
    mount({ ...BASE, isExample: true, termsOffer: null });
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(screen.getByText("No terms on offer yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Propose terms" })).toBeNull();
  });
});

describe("every live-card host goes through the one slot", () => {
  const ROOT = path.resolve(__dirname, "../../../..");
  for (const file of ["client/src/pages/Roles.tsx", "client/src/pages/Circles.tsx", "client/src/components/power/MapSeatCard.tsx"]) {
    it(`${file} passes settings={termsSlotFor(...)}`, () => {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      expect(src).toMatch(/settings=\{termsSlotFor\(/);
      // And never decides on a rung or a key of its own.
      expect(src).not.toMatch(/terms\.read/);
    });
  }
});

describe("a proposed change of terms, read before it is true", () => {
  it("lights only the groups that differ from the offer standing now", async () => {
    const { default: ProposedSeatPreview } = await import("./ProposedSeatPreview");
    const base = { v: 1, pay: { kind: "honorary" }, quests: { perMoonMin: 3, perMoonMax: 5, doneWhenRequired: true } };
    const { container } = render(
      <ProposedSeatPreview text={JSON.stringify({ name: "Water Keeper" })} terms={{ offer: { ...base, pay: FAKE_OFFER.pay }, base }} />,
    );
    const lit = Array.from(container.querySelectorAll("[data-changed]")).map((li) => li.textContent ?? "");
    expect(lit).toHaveLength(1);
    expect(lit[0]).toMatch(/changed/);
  });

  it("passes no drawer at all when the draft carries no terms (the review queue's vendor proposals)", async () => {
    const { default: ProposedSeatPreview } = await import("./ProposedSeatPreview");
    const { container } = render(<ProposedSeatPreview text={JSON.stringify({ name: "Water Keeper" })} />);
    expect(container.querySelector("[data-seat-terms]")).toBeNull();
  });
});
