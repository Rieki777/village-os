// @vitest-environment jsdom
/**
 * THE TEAM PAGE'S WORDS ARE THE VILLAGE'S (2026-10-22).
 *
 * Every word on /team that is not a person's moved into Admin, Pages, Team
 * (shared/pageContent/team.ts). What is pinned:
 *
 *   - every field and list row reaches the page (a marker typed into each one
 *     comes out), which is how a field the page ignores gets caught;
 *   - the advisory council, the board and the closing box can be hidden;
 *   - the "roles are open" line is said ONLY while a role has a place nobody
 *     holds. It used to print under a village with every role filled;
 *   - the people grid is still /api/org merged with the Team cards.
 *
 * Every name is made up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
// framer-motion's `whileInView` reaches for IntersectionObserver, which jsdom
// does not implement. A stub that never fires is right here: these tests ask
// what the page renders, not what it animates on scroll.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

import { render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { TEAM_PAGE } from "@shared/pageContent/team";
import { markerDocument } from "@shared/pageContent/resolve";

/** /api/org as a public reader gets it: one circle, its roles, first names. */
let org: Record<string, unknown>;
/** The saved page, as GET /api/content/page-team would answer it (null = never saved). */
let storedTeam: unknown;
let teamCards: unknown;
let eventsUrl = "";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", () => ({
  gameFetch: async () => ({ ok: true, json: async () => org }),
  useGameConfig: () => ({ project: { name: "Willowbrook" }, currency: { name: "Thanks" } }),
  useVillageLinks: () => ({ siteUrl: "", eventsUrl, contactEmail: "", mailTo: () => "" }),
}));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(section === "team" ? teamCards : section === "page-team" ? storedTeam : null),
}));

import Team, { openRoleCount } from "./Team";

const role = (name: string, seats: number, holders: string[], extra: Record<string, unknown> = {}) => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  circleId: "c-garden",
  seats,
  holderCount: holders.length,
  holders: holders.map((n) => ({ name: n })),
  ...extra,
});

const renderTeam = () =>
  render(
    <Router>
      <Team />
    </Router>,
  );

/** The page has its words once the leadership heading is drawn visible. */
const wordsArrived = () =>
  waitFor(() => {
    const first = document.querySelector("h2");
    expect(first).toBeTruthy();
    expect(first).not.toHaveClass("invisible");
  });

beforeEach(() => {
  org = {
    people: { visible: true, membersOnly: false, signedIn: false },
    circles: [{ id: "c-garden", name: "Garden Circle" }],
    roles: [role("Garden Lead", 1, ["Juno"]), role("Seed Keeper", 2, ["Ash"])],
  };
  storedTeam = null;
  teamCards = [{ name: "Juno", bio: "Grows the beans." }];
  eventsUrl = "";
});

describe("every field in the Team spec reaches the page", () => {
  it("renders a distinct marker typed into each field and each list row", async () => {
    const doc = markerDocument(TEAM_PAGE);
    storedTeam = doc;
    // The open-roles line shows only while a role is open (Seed Keeper has
    // one place free), and the call button only with an Events page.
    eventsUrl = "https://example.org/events";
    renderTeam();
    await screen.findByText((doc.leadership as Record<string, string>).openLink);

    const text = document.body.textContent ?? "";
    const missing: string[] = [];
    for (const [sectionId, section] of Object.entries(doc)) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        const values = Array.isArray(value)
          ? value.flatMap((row) => Object.entries(row as Record<string, string>).filter(([k]) => k !== "id").map(([, v]) => v))
          : [value as string];
        for (const v of values) if (!text.includes(v)) missing.push(`${sectionId}.${key} (${v})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("draws today's words by default", async () => {
    renderTeam();
    await wordsArrived();

    expect(screen.getByText("The people holding roles here, and the circles they hold them in.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Leadership Circle" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Community Advisory Council" })).toBeInTheDocument();
    expect(screen.getByText("Cultural Liaisons from where the village sits")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Development Board of Directors" })).toBeInTheDocument();
    expect(screen.getByText("Quarterly Sessions")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Join Our Community" })).toBeInTheDocument();
    expect(screen.getByText(/there's a place for you at Willowbrook\./)).toBeInTheDocument();
  });

  it("draws nothing of a section the village hid", async () => {
    storedTeam = { advisory: { hidden: true }, board: { hidden: true }, cta: { hidden: true } };
    renderTeam();
    await wordsArrived();

    expect(screen.queryByText("Community Advisory Council")).toBeNull();
    expect(screen.queryByText("Development Board of Directors")).toBeNull();
    expect(screen.queryByText("Join Our Community")).toBeNull();
    expect(screen.getByRole("heading", { name: "Leadership Circle" })).toBeInTheDocument();
  });

  it("leaves a blank board line out", async () => {
    storedTeam = { board: { columns: [{ heading: "Rhythm", first: "Weekly", second: "", third: "  ", fourth: "Yearly" }] } };
    renderTeam();
    await screen.findByText("Rhythm");

    const items = Array.from(screen.getByText("Rhythm").parentElement!.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual(["Weekly", "Yearly"]);
  });
});

describe("the open-roles line says only what is true", () => {
  it("is said while a role has a place nobody holds", async () => {
    renderTeam();
    expect(await screen.findByText("The team is growing, and several leadership roles and steward roles are open right now.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See the open roles/ })).toHaveAttribute("href", "/roles");
  });

  it("is not said when every role is filled", async () => {
    org = { ...org, roles: [role("Garden Lead", 1, ["Juno"]), role("Seed Keeper", 2, ["Ash", "Rowan"])] };
    renderTeam();
    await wordsArrived();
    // The grid has drawn its people, so /api/org has answered.
    await screen.findByText("Rowan");

    expect(screen.queryByText(/are open right now/)).toBeNull();
    expect(screen.queryByRole("link", { name: /See the open roles/ })).toBeNull();
  });

  it("does not count the platform's example roles", () => {
    expect(openRoleCount([{ seats: 1, holderCount: 0, isExample: true }])).toBe(0);
    expect(openRoleCount([{ seats: 1, holderCount: 0 }])).toBe(1);
    expect(openRoleCount([{ seats: 2, holderCount: 3 }])).toBe(0);
    // A role with no seat count is one place, as /api/org defaults it.
    expect(openRoleCount([{ holderCount: 0 }])).toBe(1);
  });

  it("a village can blank the sentence and keep the link", async () => {
    storedTeam = { leadership: { openNote: "" } };
    renderTeam();
    expect(await screen.findByRole("link", { name: /See the open roles/ })).toBeInTheDocument();
    expect(screen.queryByText(/are open right now/)).toBeNull();
  });
});

describe("the people are still the village's roles and Team cards", () => {
  it("merges a role holder with their Team card", async () => {
    renderTeam();
    expect(await screen.findByText("Juno")).toBeInTheDocument();
    expect(screen.getByText("Grows the beans.")).toBeInTheDocument();
    expect(screen.getByText("Garden Lead")).toBeInTheDocument();
  });
});
