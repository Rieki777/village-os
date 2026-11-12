// @vitest-environment jsdom
/**
 * `/circles/:id` is a hearth (Phase D, lane D1). This holds the wiring the
 * page owns: the roles become stones that land on their row, "I'll be there"
 * answers through the gatherings' own door for the right evening and is the
 * page's ONE lit act, the work shows as plants, each decision carries a
 * vesica, a circle with no roles is a quiet hearth with one door, and the
 * pulse mounts only for somebody who keeps the circle. The card's own words
 * are CircleCardView's tests.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type Reply = { status?: number; body: unknown };
const state = vi.hoisted(() => ({
  routes: {} as Record<string, Reply>,
  calls: [] as { url: string; init?: RequestInit }[],
  pulse: [] as unknown[],
}));

vi.mock("@/lib/gameApi", () => ({
  gameFetch: async (url: string, init?: RequestInit) => {
    state.calls.push({ url, init });
    const key = Object.keys(state.routes).find((k) => url === k || url.startsWith(`${k}?`));
    const r = key ? state.routes[key]! : { status: 404, body: { error: "Not found" } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  },
}));
vi.mock("wouter", () => ({
  useParams: () => ({ id: "c-garden" }),
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/sessions/CirclePulse", () => ({
  default: (props: unknown) => {
    state.pulse.push(props);
    return <div data-testid="pulse" />;
  },
}));

import CircleCardPage from "./CircleCardPage";

const roleRow = (id: string, name: string, filled: boolean) => ({
  id,
  name,
  href: `/roles?seat=${id}`,
  stateWords: filled ? "Filled" : "Open",
  filled,
  holderCards: filled ? [{ href: `/profile/cai#role-${id}`, label: "See their card", ariaLabel: `See the card of who holds ${name}` }] : [],
  applyHref: filled ? null : `/propose?seat=${id}`,
  applyLabel: "Apply for this role",
});

const cardWith = (roles: unknown[] | "empty") => ({
  header: {
    eyebrow: "Circle",
    name: "Garden circle",
    parent: { name: "Coordinating", href: "/circles/c-root", label: "Part of" },
    status: null,
    existsWhile: { kind: "unread" },
    existsWhileLabel: "This circle exists while",
    existsWhileTerm: null,
    termsKey: null,
  },
  sections: [
    { key: "purpose", heading: "Why we exist", term: null, kind: "text", slot: { kind: "shown", value: "Grow food together." } },
    {
      key: "roles",
      heading: "Roles in this circle",
      term: null,
      kind: "roles",
      slot: roles === "empty" ? { kind: "empty", words: "No roles in this circle yet" } : { kind: "shown", value: roles },
      note: null,
    },
    {
      key: "meet",
      heading: "How we meet",
      term: null,
      kind: "facts",
      slot: { kind: "shown", value: { lines: ["Meeting rhythm: Every Thursday at 18:00", "Next meeting: Thursday at 18:00", "Last met on 5 Nov 2026"], links: [{ label: "Open Sessions", href: "/sessions" }] } },
    },
    {
      key: "adoption",
      heading: "Who agreed to these words",
      term: null,
      kind: "adoption",
      slot: { kind: "shown", value: { latest: "Adopted by a village vote on 4 Sep 2026", summary: null, lines: [{ day: "4 Sep 2026", what: "The circle was created", how: "Adopted by a village vote on 4 Sep 2026" }] } },
    },
  ],
  pending: [],
  pendingWords: "Proposed, waiting for consent",
  proposals: [],
});

const EVENT = {
  id: "ev-sessions-abc",
  startsAt: "2099-11-20T00:00:00.000Z",
  endsAt: "2099-11-20T01:00:00.000Z",
  status: "scheduled",
  sourceModule: "sessions",
  sourceId: "c-garden",
  occurrenceKey: "2099-11-19",
  goingCount: 2,
  myRsvp: null,
  seatPrice: 0,
  spotsLeft: null,
};

function village(over: { roles?: unknown[] | "empty"; keeps?: boolean; myRsvp?: string | null } = {}) {
  const roles = over.roles ?? [roleRow("r-water", "Water Keeper", true), roleRow("r-seed", "Seed Keeper", false)];
  state.routes = {
    "/api/org/circles/c-garden/card": { body: { circleId: "c-garden", card: cardWith(roles), viewer: { signedIn: true, mayPropose: false, sessionsOn: true } } },
    "/api/events": { body: { events: [{ ...EVENT, myRsvp: over.myRsvp ?? null }], timezone: "UTC", rsvpEnabled: true } },
    "/api/events/ev-sessions-abc/rsvp": { body: { ok: true } },
    "/api/quests": {
      body: [
        { id: "q1", title: "Mulch the beds", circle: "Garden circle", status: "open", order: 1 },
        { id: "q2", title: "Save the seeds", circle: "c-garden", status: "open", order: 2 },
        { id: "q3", title: "Kitchen work", circle: "Kitchen", status: "open" },
      ],
    },
    "/api/quests/field": { body: { perQuest: { q1: { active: 1, done: 0 } }, recent: [] } },
    "/api/org": { body: { circles: [{ id: "c-herbs", name: "Herbs", parentCircleId: "c-garden" }] } },
    "/api/sessions/circles/c-garden/summary": { body: { canKeep: over.keeps ?? true } },
    "/api/sessions/circles/c-garden/decisions": {
      body: { circleId: "c-garden", decisions: [{ entryId: 7, text: "We plant garlic in the new moon.", decidedOn: "2026-11-05", session: null, review: null }], canSetReview: true, today: "2026-11-12" },
    },
  };
}

beforeEach(() => {
  state.calls = [];
  state.pulse = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the circle hearth", () => {
  it("draws the roles as stones round the fire, each landing on its row, carrying the role's letter", async () => {
    village();
    render(<CircleCardPage />);
    const hearth = await screen.findByRole("img", { name: /Garden circle hearth: 2 roles around the fire, 1 held/ });
    const held = document.querySelector('[data-stone="r-water"]')!;
    expect(held.getAttribute("href")).toBe("#role-stone-r-water");
    expect(held.getAttribute("data-held")).toBe("true");
    expect(document.querySelector('[data-stone="r-seed"]')!.getAttribute("data-held")).toBe("false");
    expect(document.getElementById("role-stone-r-water")).not.toBeNull();
    // A stone names the role, never its holder.
    expect(hearth.textContent).toContain("W");
    expect(hearth.textContent).not.toContain("cai");
  });

  it("threads reach the circle we sit in and the circles in ours", async () => {
    village();
    render(<CircleCardPage />);
    await waitFor(() => expect(document.querySelectorAll("[data-thread]")).toHaveLength(2));
    expect(screen.getByRole("link", { name: "Linked circle: Herbs" }).getAttribute("href")).toBe("/circles/c-herbs");
    expect(screen.getByRole("link", { name: "Linked circle: Coordinating" }).getAttribute("href")).toBe("/circles/c-root");
  });

  it("says I'll be there through the gatherings' own door, for that evening, and it is the one lit act", async () => {
    village();
    render(<CircleCardPage />);
    const go = await screen.findByRole("button", { name: "I'll be there" });
    expect(document.querySelectorAll('[data-testid="fireflies"]')).toHaveLength(1);
    expect(go.closest(".nk-ff-host")).not.toBeNull();
    expect(screen.getByText("2 of us said we will be there.")).toBeTruthy();
    expect(document.querySelector('[data-hearth-meet] [data-walked="2"]')).not.toBeNull();
    fireEvent.click(go);
    expect(await screen.findByText("We will see you there. Your circle fills the seed.")).toBeTruthy();
    const sent = state.calls.find((c) => c.url === "/api/events/ev-sessions-abc/rsvp")!;
    expect(sent.init?.method).toBe("POST");
    expect(JSON.parse(String(sent.init?.body))).toEqual({ status: "going", occurrenceKey: "2099-11-19" });
    // The card's own "Next meeting" line steps aside for the calendar's evening; the rhythm stays.
    expect(document.body.textContent).toContain("Meeting rhythm: Every Thursday at 18:00");
    expect(document.body.textContent).not.toContain("Next meeting: Thursday at 18:00");
  });

  it("offers a way out once you said you will come, with no fireflies on it", async () => {
    village({ myRsvp: "going" });
    render(<CircleCardPage />);
    expect(await screen.findByRole("button", { name: "I can't come after all" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I'll be there" })).toBeNull();
    expect(document.querySelectorAll('[data-testid="fireflies"]')).toHaveLength(0);
  });

  it("shows the circle's work as plants, and each decision with a vesica", async () => {
    village();
    render(<CircleCardPage />);
    await waitFor(() => expect(document.querySelectorAll("[data-tend]")).toHaveLength(2));
    expect(Array.from(document.querySelectorAll("[data-tend]")).map((e) => e.getAttribute("data-tend"))).toEqual(["bud", "seed"]);
    expect(document.body.textContent).not.toContain("Kitchen work");
    await screen.findByText("We plant garlic in the new moon.");
    const decided = document.querySelector("[data-hearth-decided]")!;
    expect(decided.querySelectorAll('.nk-vesica[data-met="true"]')).toHaveLength(2);
    expect(decided.textContent).toContain("Adopted by a village vote on 4 Sep 2026");
  });

  it("mounts the pulse only for somebody who keeps the circle", async () => {
    village({ keeps: false });
    render(<CircleCardPage />);
    await screen.findByRole("button", { name: "I'll be there" });
    await waitFor(() => expect(state.calls.some((c) => c.url.endsWith("/summary"))).toBe(true));
    expect(screen.queryByTestId("pulse")).toBeNull();
    expect(state.calls.some((c) => c.url.endsWith("/decisions"))).toBe(false);
    cleanup();
    village({ keeps: true });
    render(<CircleCardPage />);
    expect(await screen.findByTestId("pulse")).toBeTruthy();
    expect(state.pulse.at(-1)).toMatchObject({ keepCircleIds: ["c-garden"], myCircleIds: ["c-garden"] });
  });

  it("is a quiet hearth with one door when the circle has no roles yet", async () => {
    village({ roles: "empty" });
    render(<CircleCardPage />);
    expect(await screen.findByText("No roles sit at this hearth yet. The fire is lit for the first.")).toBeTruthy();
    const quiet = document.querySelector("[data-hearth-quiet]")!;
    expect(quiet.querySelectorAll("a")).toHaveLength(1);
    expect(quiet.querySelector("a")!.getAttribute("href")).toBe("/role-proposals/new");
    expect(document.querySelector("[data-hearth-meet]")).toBeNull();
    expect(document.querySelector("[data-hearth-tend]")).toBeNull();
    expect(document.querySelectorAll('[data-testid="fireflies"]')).toHaveLength(0);
  });
});

describe("the hearth's own spelling of the Sessions door", () => {
  it("is the card model's", async () => {
    const [{ SESSIONS_HREF: mine }, { SESSIONS_HREF: model }] = await Promise.all([import("@/components/circleCard/HearthSections"), import("@shared/circleCard")]);
    expect(mine).toBe(model);
  });
});
