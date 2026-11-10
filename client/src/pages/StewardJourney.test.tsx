// @vitest-environment jsdom
/**
 * /steward is the front door to the eleven-step way into a role: it points at
 * /roles, lists the steps with whose move each is, and no longer carries the
 * old nine-step journey, the ladder of levels or its own intake form.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { Router } from "wouter";
import { STEWARD_JOURNEY, RESIDENT_JOURNEY } from "@shared/pageContent/journeys";
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
vi.mock("@/hooks/useVillageContent", () => ({ readVillageSection: () => Promise.resolve(null) }));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Hollow Oak" }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: (fallback: string) => fallback }));

import StewardJourney from "./StewardJourney";

const show = () =>
  render(
    <Router hook={memoryLocation({ path: "/steward" }).hook}>
      <StewardJourney />
    </Router>,
  );

beforeEach(() => {
  auth.admin = false;
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

const seed = (id: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), `server/seeds/amora/pages/page-journey-${id}.json`), "utf8")); // brand-ok: the first village's own record, read to prove it carries its own link
const FOUNDING = "https://amora.cr/founding-seeder/"; // brand-ok: the first village's own record, read to prove it carries its own link

const hrefOf = (name: RegExp) => screen.getAllByRole("link", { name }).map((a) => a.getAttribute("href"));

describe("/steward", () => {
  it("shows the eleven steps in order, each with whose move it is", async () => {
    show();
    const list = (await screen.findByText("Start at the roles")).closest("ol")!;
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(11);
    expect(items[0]).toHaveTextContent(/Start at the roles/);
    expect(items[2]).toHaveTextContent(/Propose yourself/);
    expect(items[10]).toHaveTextContent(/Join the moon rhythm/);
    expect(within(items[6]).getByText("The circle's move")).toBeInTheDocument();
    expect(within(items[0]).getByText("Your move")).toBeInTheDocument();
  });

  it("says step 3 asks for references, or a background check, and when they are contacted", async () => {
    show();
    const step = (await screen.findByText("Propose yourself")).closest("li")!;
    expect(step).toHaveTextContent(/three references, or a background check in their place/);
    expect(step).toHaveTextContent(/only after our first conversation/);
  });

  it("links each step to its page", async () => {
    show();
    await screen.findByText("Propose yourself");
    expect(hrefOf(/^See the roles/)).toContain("/roles");
    expect(hrefOf(/^Pick your roles/)).toEqual(["/roles/select"]);
    expect(hrefOf(/^Propose a role/)).toContain("/propose-a-role");
  });

  it("opens three doors for a visitor, to the right places", async () => {
    show();
    await screen.findByText("Which door is yours?");
    expect(hrefOf(/^Find your role/)).toContain("/roles");
    expect(hrefOf(/^Propose a role/)).toContain("/role-proposals/new");
    expect(hrefOf(/^See the quests/)).toEqual(["/quests"]);
    expect(hrefOf(/^Explore the map/)).toEqual(["/map"]);
    expect(screen.queryByText("Stewarding the roles")).toBeNull();
  });

  it("opens the fourth door only for an admin", async () => {
    auth.admin = true;
    show();
    expect(await screen.findByText("Stewarding the roles")).toBeInTheDocument();
    expect(hrefOf(/^Open the approval inbox/)).toEqual(["/approvals"]);
    expect(hrefOf(/^Open admin/)).toEqual(["/admin"]);
  });

  it("says the optional ones are not required, and gives one moon in brief", async () => {
    show();
    expect(await screen.findByText(/Nobody has to do the optional ones/)).toBeInTheDocument();
    expect(screen.getByText(/never for hours/)).toBeInTheDocument();
  });

  it("keeps the rights link without claiming ownership, and links the exit policy", async () => {
    show();
    expect(await screen.findByRole("link", { name: /Read rights and responsibilities/ })).toHaveAttribute("href", "/steward-rights");
    expect(screen.getByRole("link", { name: /How leaving a role works/ })).toHaveAttribute("href", "/exit-policy");
    expect(document.body.textContent).not.toMatch(/co-owner|real ownership/i);
  });

  it("has no ladder of levels, no season festival copy and no intake form", async () => {
    show();
    await screen.findByText("Which door is yours?");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Role Holder|\bSage\b|\bGuide\b|highest voice|Path of Growth|every 3 months|Begin My Stewardship/i);
    expect(document.querySelector("form")).toBeNull();
    expect(screen.getByRole("link", { name: /Ask us a question/ })).toHaveAttribute("href", expect.stringMatching(/^mailto:/));
  });

  it("shows four cards under Getting to know us, with Optional on the second and third only", async () => {
    show();
    await screen.findByText("Getting to know us");
    const cards = ["Come to an Event", "Take Part in Events", "Village Immersion", "Community Training"].map((t) => screen.getByText(t).closest("div.bg-card") as HTMLElement);
    expect(cards.map((c) => !!within(c).queryByText("Optional"))).toEqual([false, true, true, false]);
    expect(screen.queryByText(/steps completed/)).toBeNull();
  });

  it("opens a card to its button, and an external link opens safely", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    show();
    await screen.findByText("Getting to know us");
    await userEvent.setup().click(screen.getByText("Take Part in Events"));
    const link = screen.getByRole("link", { name: /View Events/ });
    expect(link).toHaveAttribute("href", "https://example.org/events");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
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
