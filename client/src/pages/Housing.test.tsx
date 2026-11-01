// @vitest-environment jsdom
/**
 * The housing page, held to the founder's ruling (0131).
 *
 * A VILLAGE THAT HAS NOT DESCRIBED ITS HOMES SHOWS NO TIER SECTION AT ALL.
 * Not a heading over a gap, not an empty grid, not a placeholder card. And a
 * village that HAS described them publishes exactly what was typed: no unit
 * appended, no currency supplied, no figure reformatted.
 *
 * BOTH DIRECTIONS ARE THE TEST. `client/src/lib/housingForm.test.ts` reads
 * this page as text, which catches a literal coming back but cannot see what
 * the browser draws. This file renders it. A suite that only ever sees the
 * populated case would go green on a page that draws "Housing Options" over
 * nothing, which is the state this change exists to produce and the one most
 * likely to look broken.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  // The helpers under test are real; only the config reads are stubbed.
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "", contactEmail: "", mailTo: () => "" }),
  useGameConfig: () => ({ project: { name: "Willowbrook" }, currency: { name: "Thanks" } }),
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
// `legal` is the Legal section (the transfer note); `page` is what
// GET /api/content/page-housing answers (null = never saved).
const saved = vi.hoisted(() => ({ legal: null as Record<string, unknown> | null, page: null as unknown }));
vi.mock("@/hooks/useVillageContent", () => ({
  useVillageContent: (section: string) =>
    section === "legal"
      ? { content: saved.legal, loading: false, isPlaceholder: !saved.legal }
      : { content: null, loading: false, isPlaceholder: true },
  readVillageSection: () => Promise.resolve(saved.page),
}));

import Housing from "./Housing";
import { HOUSING_PAGE } from "@shared/pageContent/housing";
import { fillVars, markerDocument } from "@shared/pageContent/resolve";

/** What `GET /api/housing/public` answers, with only `homes` varying. */
const answering = (homes: unknown[]) =>
  vi.fn(async () => ({
    ok: true,
    json: async () => ({ entries: [], configured: false, homes }),
  })) as unknown as typeof fetch;

const casita = {
  homeType: "casita",
  name: "Cabina",
  size: "0,5 hectáreas",
  price: "₡45.000.000",
  description: "Two rooms and a covered porch.",
  features: ["Covered patio", "Kitchen, bathroom and a porch"],
};

const renderPage = () =>
  render(
    <Router>
      <Housing />
    </Router>,
  );

beforeEach(() => {
  saved.legal = null;
  saved.page = null;
  // afterEach's unstubAllGlobals takes the module-level stub with it.
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe("a village that has not described its homes", () => {
  beforeEach(() => vi.stubGlobal("fetch", answering([])));

  it("draws no tier section at all, heading included", async () => {
    renderPage();
    // Waited for, not asserted immediately: the read has to have landed, or
    // this passes for the wrong reason on any page at all.
    await waitFor(() => expect(screen.queryByText("Land Share Agreements")).toBeTruthy());
    expect(screen.queryByText("Housing Options")).toBeNull();
  });

  it("draws no empty grid and no Reserve button with nothing behind it", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.queryByText("Land Share Agreements")).toBeTruthy());
    expect(screen.queryByText("Reserve this home")).toBeNull();
    expect(container.querySelector('a[href^="/reserve"]')).toBeNull();
  });

  it("leaves the rest of the page standing", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText("Land Share Agreements")).toBeTruthy());
    // The hero, the Land Share explainer and the closing call to action all
    // stay. The tier cards are conditional, and so are the land features,
    // which ship empty (2026-10-23) and draw no band until a village lists one.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Housing at Willowbrook");
    expect(document.querySelector("section.bg-aqua-light")).toBeNull();
    expect(screen.getByText("Interested in Housing?")).toBeTruthy();
    expect(screen.getByText("Learn About Residency")).toBeTruthy();
  });

  it("names no home type anywhere, so the hero cannot promise one", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.queryByText("Land Share Agreements")).toBeTruthy());
    const text = container.textContent ?? "";
    for (const word of ["Tiny Home", "Casita", "Family Home", "Luxury Villa", "sq ft"]) {
      expect(text.includes(word), `the page still says ${word} with no homes published`).toBe(false);
    }
  });
});

describe("a village that HAS described its homes", () => {
  it("prints a non-imperial size and a non-USD price exactly as typed", async () => {
    vi.stubGlobal("fetch", answering([casita]));
    renderPage();
    await screen.findByText("Cabina");
    // The whole point. Nothing converts, reformats, or appends a unit or a
    // symbol the founder did not type.
    expect(screen.getByText("0,5 hectáreas")).toBeTruthy();
    expect(screen.getByText("₡45.000.000")).toBeTruthy();
  });

  it("draws the heading and the card together", async () => {
    vi.stubGlobal("fetch", answering([casita]));
    renderPage();
    await screen.findByText("Cabina");
    expect(screen.getByText("Housing Options")).toBeTruthy();
    expect(screen.getByText("Two rooms and a covered porch.")).toBeTruthy();
    expect(screen.getByText("Covered patio")).toBeTruthy();
    // A comma inside a feature stays inside it. Splitting on commas would cut
    // this line into three bullets.
    expect(screen.getByText("Kitchen, bathroom and a porch")).toBeTruthy();
  });

  it("links the card to the reservation form under the platform key", async () => {
    vi.stubGlobal("fetch", answering([casita]));
    const { container } = renderPage();
    await screen.findByText("Cabina");
    // The NAME is the village's and the KEY is the contract: a renamed home
    // still reaches the form the server validates against.
    expect(container.querySelector('a[href="/reserve?type=casita"]')).toBeTruthy();
  });

  it("draws nothing for a field the village left blank", async () => {
    vi.stubGlobal(
      "fetch",
      answering([{ ...casita, price: "", description: "", features: [] }]),
    );
    const { container } = renderPage();
    await screen.findByText("Cabina");
    expect(screen.getByText("0,5 hectáreas")).toBeTruthy();
    // No empty price badge, no empty paragraph, no bullet list with no bullets.
    expect(container.querySelector("ul")).toBeNull();
    expect(screen.queryByText("₡45.000.000")).toBeNull();
  });

  it("shows no tier section while the read is still in flight", () => {
    // `unknown` is not `none`. A village that HAS published homes must never
    // flash a missing section on the way to showing them, and a village that
    // has not must never flash four cards.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);
    renderPage();
    expect(screen.queryByText("Housing Options")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Housing at Willowbrook");
  });

  it("shows no tier section when the read fails", async () => {
    // Fail closed: a network blip must never publish a figure, and there is
    // no figure to publish when nothing arrived.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    renderPage();
    await waitFor(() => expect(screen.queryByText("Land Share Agreements")).toBeTruthy());
    expect(screen.queryByText("Housing Options")).toBeNull();
  });
});

/* ── THE PAGE'S WORDS (Admin, Pages, Housing) ──────────────────────────────
 *
 * Every word on this page about the village is a field in
 * shared/pageContent/housing.ts. A field a founder can save and the page
 * never reads is the defect this system exists to end, so every field gets a
 * distinct marker and every marker has to reach the page.
 */
describe("every field in the Housing spec reaches the page", () => {
  beforeEach(() => vi.stubGlobal("fetch", answering([])));

  it("renders a distinct marker typed into each field and each list row", async () => {
    const doc = markerDocument(HOUSING_PAGE);
    saved.page = doc;
    renderPage();
    await screen.findByText(String((doc.hero as Record<string, string>).lede));

    const text = document.body.textContent ?? "";
    const missing: string[] = [];
    for (const [sectionId, section] of Object.entries(doc)) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        const rows = Array.isArray(value) ? (value as Record<string, string>[]) : [{ [key]: value as string }];
        for (const row of rows) {
          for (const [field, v] of Object.entries(row)) {
            // An icon is a word that picks a picture, never text on the
            // page; the next test follows it to the picture it picks.
            if (field === "id" || field === "icon") continue;
            if (!text.includes(v)) missing.push(`${sectionId}.${key}.${field} (${v})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("draws the picture the icon word names, and a plain one for a word it does not know", async () => {
    saved.page = {
      features: {
        items: [
          { title: "Springs", body: "Clean water.", icon: "water" },
          { title: "Typo", body: "Still a feature.", icon: "wtaer" },
        ],
      },
    };
    renderPage();
    const springs = await screen.findByText("Springs");
    expect(springs.parentElement?.querySelector("svg.lucide-droplets")).toBeTruthy();
    const typo = screen.getByText("Typo");
    expect(typo.parentElement?.querySelector("svg.lucide-mountain")).toBeTruthy();
  });

  it("draws nothing of a section the village hid, and no empty band for an empty list", async () => {
    saved.page = { features: { items: [] }, tenure: { hidden: true } };
    renderPage();
    await screen.findByText(HOUSING_PAGE.sections.find((s) => s.id === "cta")!.fields[0].default);

    expect(screen.queryByText("Mountain Views")).toBeNull();
    expect(screen.queryByText("Land Share Agreements")).toBeNull();
    expect(screen.queryByText("Learn About Residency")).toBeNull();
    expect(document.querySelector("section.bg-aqua-light")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Housing at Willowbrook");
  });

  it("fills {village} in the defaults", async () => {
    const intro = HOUSING_PAGE.sections.find((s) => s.id === "tenure")!.fields.find((f) => f.key === "intro")!.default;
    expect(intro).toContain("{village}");
    renderPage();
    expect(await screen.findByText(fillVars(intro, { village: "Willowbrook" }))).toBeTruthy();
  });

  it("ships no land features, because views, springs and forest are one piece of land's facts", async () => {
    expect(HOUSING_PAGE.sections.find((s) => s.id === "features")!.lists![0].default).toEqual([]);
    saved.page = { features: { items: [{ title: "River Meadow", body: "A meadow by the river.", icon: "water" }] } };
    renderPage();
    expect(await screen.findByText("River Meadow")).toBeTruthy();
    expect(document.querySelector("section.bg-aqua-light")).toBeTruthy();
  });
});

describe("the Transferable card and the Legal transfer note", () => {
  beforeEach(() => vi.stubGlobal("fetch", answering([])));

  it("says to ask a steward when the village has written no note", async () => {
    renderPage();
    expect(await screen.findByText(/Ask a steward about this village's specific transfer and tax terms/)).toBeTruthy();
  });

  it("carries the note while the card keeps the platform's description", async () => {
    saved.legal = { landShareTransferNote: "under the 2019 succession rules" };
    renderPage();
    expect(
      await screen.findByText("Pass your land share to your children under the 2019 succession rules, keeping it in the family."),
    ).toBeTruthy();
  });

  it("keeps the village's own description when it wrote one, note or no note", async () => {
    saved.legal = { landShareTransferNote: "under the 2019 succession rules" };
    saved.page = { tenure: { points: [{ id: "transferable", body: "Leave it to whoever you choose." }] } };
    renderPage();
    expect(await screen.findByText("Leave it to whoever you choose.")).toBeTruthy();
    expect(screen.queryByText(/succession rules/)).toBeNull();
  });
});
