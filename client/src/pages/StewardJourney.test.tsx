// @vitest-environment jsdom
/**
 * /steward is ONE flow (build list section 8, 11 Nov 2026): the first steps
 * everyone takes, the fork into two paths, the role path ending in the
 * optional step onto the resident path (the lead's final ruling), and the
 * founding team's invitation as the page's one gold act. It carries no doors,
 * no second journey, no ladder of levels and no intake form.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { Router } from "wouter";
import { STEWARD_JOURNEY, RESIDENT_JOURNEY } from "@shared/pageContent/journeys";
import { pageContentProblem } from "@shared/pageContent";
import { memoryLocation } from "wouter/memory-location";
import type { ReactNode } from "react";

const auth = vi.hoisted(() => ({ admin: false }));

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/FaqSection", () => ({ default: ({ heading }: { heading?: string }) => <h2>{heading}</h2> }));
vi.mock("@/contexts/AuthContext", () => ({ useIsAdmin: () => auth.admin }));
vi.mock("@/lib/gameApi", () => ({
  useVillageLinks: () => ({ eventsUrl: "https://example.org/events", mailTo: (s: string) => `mailto:team@example.org?subject=${encodeURIComponent(s)}` }),
  useBrandImages: () => ({}),
  altOr: (a: string | undefined, b: string) => a || b,
  useGameConfig: () => ({ project: { name: "Hollow Oak", adminPath: "/admin" } }),
}));
const stored = vi.hoisted(() => ({ doc: null as unknown }));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(section === "page-journey-steward" ? stored.doc : null),
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Hollow Oak" }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: (fallback: string) => fallback }));
// The founding roles the band names: the same read as the Roles page's founding section.
const founding = vi.hoisted(() => ({ answer: { on: false, roleIds: [] as string[], names: {} as Record<string, string> } }));
vi.mock("@/components/roleCard/roleCardApi", () => ({
  readFoundingTeam: () => Promise.resolve({ ...founding.answer, sections: {}, showPayRanges: false, villagePay: { shape: [], atRisk: "", note: "" } }),
}));

import StewardJourney from "./StewardJourney";

const show = () =>
  render(
    <Router hook={memoryLocation({ path: "/steward" }).hook}>
      <StewardJourney />
    </Router>,
  );

beforeEach(() => {
  auth.admin = false;
  stored.doc = null;
  founding.answer = { on: false, roleIds: [], names: {} };
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

const seed = (id: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), `server/seeds/amora/pages/page-journey-${id}.json`), "utf8")); // brand-ok: the first village's own record, read to prove it carries its own link
const FOUNDING = "https://amora.cr/founding-seeder/"; // brand-ok: the first village's own record, read to prove it carries its own link

const hrefOf = (name: RegExp) => screen.getAllByRole("link", { name }).map((a) => a.getAttribute("href"));

describe("/steward", () => {
  it("is one flow: first steps, the fork, the role path, then the founding team", async () => {
    show();
    await screen.findByText("Get to know us");
    const text = document.body.textContent ?? "";
    const order = ["Get to know us", "Two paths from here", "From your application to the role, in seven steps", "Join the resident path too", "The team that builds Hollow Oak", "Optional, whenever you like"].map((t) => text.indexOf(t));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // The duplicates are gone: no doors, no second journey, no moon band.
    expect(screen.queryByText("Which door is yours?")).toBeNull();
    expect(screen.queryByText("One moon")).toBeNull();
    expect(screen.getAllByRole("heading", { name: "Get to know us" })).toHaveLength(1);
  });

  it("lists the three first steps in order, each tickable, with the exceptions line beside them", async () => {
    show();
    await screen.findByText("Get to know us");
    const list = document.querySelector("#first-steps ol") as HTMLElement;
    expect(within(list).getAllByRole("checkbox")).toHaveLength(3);
    expect(list).toHaveTextContent(/Come to an open call.*Walk the land with us.*Share a meal with the village/);
    expect(screen.getAllByText(/you can still apply, especially if we invited you/).length).toBeGreaterThan(0);
  });

  it("opens a first step to its button, and an external link opens safely", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    show();
    await userEvent.setup().click(await screen.findByRole("button", { name: /Walk the land with us/ }));
    const link = within(document.getElementById("first-steps")!).getByRole("link", { name: /See upcoming events/ });
    expect(link).toHaveAttribute("href", "https://example.org/events");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("forks into two paths, marks the role path as here and links across to /resident", async () => {
    show();
    await screen.findByText("Two paths from here");
    const steward = document.querySelector('[data-track="steward"]') as HTMLElement;
    const resident = document.querySelector('[data-track="resident"]') as HTMLElement;
    expect(within(steward).getByText("You are here")).toBeInTheDocument();
    expect(within(resident).queryByText("You are here")).toBeNull();
    expect(within(resident).getByRole("link", { name: /Live here/ })).toHaveAttribute("href", "/resident");
  });

  it("walks the role path in order, each step with whose move it is", async () => {
    show();
    const list = (await screen.findByText("Find the role that is yours")).closest("ol")!;
    const items = within(list).getAllByRole("listitem");
    // Seven steps, then the optional step onto the resident path.
    expect(items).toHaveLength(8);
    expect(within(items[0]).getByText("Your move")).toBeInTheDocument();
    expect(within(items[2]).getByText("The circle's move")).toBeInTheDocument();
    expect(items[7]).toHaveTextContent(/Join the resident path too/);
    expect(within(items[7]).getByText("Optional")).toBeInTheDocument();
    expect(within(items[7]).getByRole("link", { name: /See the resident path/ })).toHaveAttribute("href", "/resident");
    expect(hrefOf(/^See the open roles/)).toEqual(["/roles"]);
  });

  it("ends the role path on the crossover alone: no early supporters step of its own (the lead's ruling)", async () => {
    show();
    const list = (await screen.findByText("Find the role that is yours")).closest("ol")!;
    expect(list.querySelectorAll("[data-track-tile]")).toHaveLength(1);
    expect(STEWARD_JOURNEY.sections.map((s) => s.id)).not.toContain("seeders");
  });

  it("leads into the founding team as the page's one gold act, with fireflies on it", async () => {
    show();
    await screen.findByText("The team that builds Hollow Oak");
    const band = document.getElementById("founding-team")!;
    const act = within(band).getByRole("link", { name: /^Join the founding team/ });
    expect(act).toHaveAttribute("href", "/roles");
    expect(band.querySelector('[data-testid="fireflies"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-testid="fireflies"]')).toHaveLength(1);
  });

  it("pins the same act in thumb reach while the band is ahead, and lets it go once the band is reached", async () => {
    const { act: flush } = await import("@testing-library/react");
    let report: (top: number, visible: boolean) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (entries: unknown[]) => void) {
          report = (top, visible) => cb([{ isIntersecting: visible, boundingClientRect: { top } }]);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    show();
    await screen.findByText("The team that builds Hollow Oak");
    flush(() => report(3000, false));
    expect(within(await screen.findByTestId("thumb-act")).getByRole("link")).toHaveAttribute("href", "/roles");
    flush(() => report(200, true));
    expect(screen.queryByTestId("thumb-act")).toBeNull();
    flush(() => report(-900, false));
    expect(screen.queryByTestId("thumb-act")).toBeNull();
  });

  it("speaks in the founding register: no game words anywhere on the page", async () => {
    show();
    await screen.findByText("The team that builds Hollow Oak");
    expect(document.body.textContent).not.toMatch(/\bquests?\b|\bmoons?\b|\bXP\b|level up/i);
  });

  it("names the founding roles open now, live, as links to their cards, wherever {foundingRoles} is written", async () => {
    stored.doc = { foundingTeam: { body: "We are building the team. The roles open now are {foundingRoles}. Read each card." } };
    founding.answer = { on: true, roleIds: ["land", "cook"], names: { land: "Land Lead", cook: "Village Cook" } };
    show();
    await screen.findByText("The team that builds Hollow Oak");
    const band = document.getElementById("founding-team")!;
    expect(await within(band).findByText("We are building the team. The roles open now are the Land Lead and the Village Cook. Read each card.")).toBeInTheDocument();
    const list = within(band).getByTestId("founding-roles");
    expect(within(list).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Land Lead", "/roles?seat=land"],
      ["Village Cook", "/roles?seat=cook"],
    ]);
    // Control: a role the village opens later is named with no edit to the words.
    cleanup();
    founding.answer = { on: true, roleIds: ["land", "cook", "well"], names: { land: "Land Lead", cook: "Village Cook", well: "Water Keeper" } };
    show();
    expect(await screen.findByText(/are the Land Lead, the Village Cook and the Water Keeper\./)).toBeInTheDocument();
  });

  it("says something true and names nobody when the founding team is off", async () => {
    stored.doc = { foundingTeam: { body: "We are building the team. The roles open now are {foundingRoles}. Read each card." } };
    show();
    await screen.findByText("The team that builds Hollow Oak");
    const band = document.getElementById("founding-team")!;
    expect(await within(band).findByText("We are building the team. Read each card.")).toBeInTheDocument();
    expect(within(band).queryByTestId("founding-roles")).toBeNull();
    expect(band.textContent).not.toContain("{foundingRoles}");
  });

  it("hides the crossover and the founding band when the village hides them", async () => {
    stored.doc = { crossover: { hidden: true }, foundingTeam: { hidden: true } };
    show();
    await screen.findByText("Find the role that is yours");
    expect(screen.queryByText("Join the resident path too")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Join the founding team/ })).toBeNull();
  });

  it("opens the admin door only for an admin", async () => {
    show();
    await screen.findByText("Get to know us");
    expect(screen.queryByText("Stewarding the roles")).toBeNull();
    cleanup();
    auth.admin = true;
    show();
    expect(await screen.findByText("Stewarding the roles")).toBeInTheDocument();
    expect(hrefOf(/^Open the approval inbox/)).toEqual(["/approvals"]);
    expect(hrefOf(/^Open admin/)).toEqual(["/admin"]);
  });

  it("keeps the rights link without claiming ownership, and links the exit policy", async () => {
    show();
    expect(await screen.findByRole("link", { name: /Read rights and responsibilities/ })).toHaveAttribute("href", "/steward-rights");
    expect(screen.getByRole("link", { name: /How leaving a role works/ })).toHaveAttribute("href", "/exit-policy");
    expect(document.body.textContent).not.toMatch(/co-owner|real ownership/i);
  });

  it("has no ladder of levels, no festival copy and no intake form", async () => {
    show();
    await screen.findByText("Get to know us");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Role Holder|\bSage\b|\bGuide\b|highest voice|Path of Growth|every 3 months|Begin My Stewardship/i);
    expect(document.querySelector("form")).toBeNull();
    expect(screen.getByRole("link", { name: /Ask us a question/ })).toHaveAttribute("href", expect.stringMatching(/^mailto:/));
  });
});

describe("expand only: a village that saved the old page keeps it", () => {
  it("still reads the old sections, and the old record still validates", async () => {
    const old = seed("steward");
    expect(pageContentProblem("page-journey-steward", old)).toBeNull();
    stored.doc = old;
    show();
    // The old four cards are its first steps, the old eleven steps its role path.
    await screen.findByText(old.steps.items[0].title);
    expect(within(document.querySelector("#first-steps ol") as HTMLElement).getByText(old.getToKnow.items[0].title)).toBeInTheDocument();
    const list = screen.getByText(old.steps.items[0].title).closest("ol")!;
    expect(list.querySelectorAll(":scope > li:not([data-track-tile])")).toHaveLength(old.steps.items.length);
  });
});

describe("the village's draft for the one flow (server/seeds/amora/journey-tracks-seed.json)", () => { // brand-ok: the first village's own draft, read to prove the pages accept it
  const draft = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "server/seeds/amora/journey-tracks-seed.json"), "utf8")); // brand-ok: the first village's own draft, read to prove the pages accept it

  it("is a document each page accepts", () => {
    expect(pageContentProblem("page-journey-steward", draft["page-journey-steward"])).toBeNull();
    expect(pageContentProblem("page-journey-resident", draft["page-journey-resident"])).toBeNull();
  });

  it("carries the lead's words for the optional step, and no early supporters step on the steward path", () => {
    const s = draft["page-journey-steward"];
    expect(`${s.crossover.title}: ${s.crossover.body}`).toBe("Join the resident path too: We prefer to work with people who also want to live here at least part time.");
    expect(s.crossover.mark).toBe("Optional");
    expect(s.crossover.ctaTarget).toBe("/resident");
    expect(JSON.stringify(s.steps)).not.toMatch(/Founding Seeder/);
  });

  it("asks for the webinar or community call, the land tour and the potluck, in that order, with the exceptions line", () => {
    const s = draft["page-journey-steward"];
    expect(s.getToKnow.items.map((r: Record<string, string>) => r.title)).toEqual(["Attend the webinar or community call", "Come on a land tour", "Join the potluck"]);
    expect(s.getToKnow.exceptions).toMatch(/more than a week away/);
  });

  it("names the resident path's stages from the journey doc, with Founding Seeders inside it", () => {
    const stages = draft["page-journey-resident"].steps.items.map((r: Record<string, string>) => r.stage);
    expect(stages.slice(0, 8)).toEqual(["Guest", "Founding Seeder", "Potential Steward", "Connection Ceremony", "Steward of {village}", "Wisdom Council", "Connection Ceremony", "Invitation"]);
  });
});

describe("the Founding Seeders live in the village's own words, not the platform's", () => {
  const items = (doc: any) => (doc.getToKnow.items as Record<string, string>[]);

  it("carries the link and the extended immersion in the village's steward file", () => {
    const immersion = items(seed("steward"))[2];
    expect(immersion.title).toBe("Village Weaving Immersion");
    expect(immersion.mark).toBe("Optional");
    expect(immersion.description).toMatch(/Founding Seeders/);
    expect(immersion.actionLabel).toBe("Meet the Founding Seeders");
    expect(immersion.actionTarget).toBe(FOUNDING);
    expect(items(seed("steward")).map((r) => r.mark)).toEqual(["", "Optional", "Optional", ""]);
  });

  it("links the village's resident step to the same page", () => {
    const step = seed("resident").steps.items.find((r: Record<string, string>) => /Founding Seeder/.test(r.title));
    expect(step.actionTarget).toBe(FOUNDING);
  });

  it("leaves both platform defaults free of that name and link", () => {
    for (const spec of [STEWARD_JOURNEY, RESIDENT_JOURNEY]) {
      expect(JSON.stringify(spec)).not.toMatch(/Founding Seeder|amora\.cr/i); // brand-ok: the first village's own record, read to prove it carries its own link
    }
  });
});
