// @vitest-environment jsdom
/**
 * The visit page: its two page fields (Admin, Pages, Visit), and the three
 * ways it used to misread what a village saved in Visit Program.
 *
 *  - A card whose button has a label and no link of its own said "Contact
 *    the team" whatever the label said. All three seeded cards are that
 *    shape, so no village ever saw its own button labels.
 *  - A cleared subtitle or contact note drew an empty paragraph, because
 *    `??` keeps an empty string.
 *  - Every cost sat beside a dollar sign, "Free" included, whatever the
 *    village's currency.
 *
 * And the line after the form is sent ("within 48 hours") is a promise only
 * the village can make, so it is the village's field now, and blank hides it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => ({ project: { name: "Willowbrook" }, currency: { name: "Thanks" } }),
}));
// What GET /api/content/page-visit answers (null = never saved).
const saved = vi.hoisted(() => ({ page: null as unknown }));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: () => Promise.resolve(saved.page),
}));

import Visit from "./Visit";
import { VISIT_PAGE } from "@shared/pageContent/visit";
import { markerDocument } from "@shared/pageContent/resolve";

type VisitType = { id: string; title: string; duration: string; format: string; cost: string; description: string; cta_label: string; cta_url: string; order: number };

const card = (over: Partial<VisitType> = {}): VisitType => ({
  id: "call",
  title: "Community Call",
  duration: "90 minutes",
  format: "Online",
  cost: "Free",
  description: "Meet the people.",
  cta_label: "Join the Next Call",
  cta_url: "",
  order: 1,
  ...over,
});

let program: Record<string, unknown>;
let submitted: unknown[];

const stubFetch = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/visit-config")) return { ok: true, status: 200, json: async () => program };
      if (String(url).includes("/api/forms/submit")) {
        submitted.push(JSON.parse(String(init?.body ?? "{}")));
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch,
  );

beforeEach(() => {
  saved.page = null;
  submitted = [];
  program = {
    hero_subtitle: "Walk the land with us.",
    visit_types: [card()],
    logistics: { getting_there: "Bus from town.", accommodation: "Tents.", what_to_bring: "Boots.", contact_note: "Write to us below." },
  };
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

const headline = () => screen.findByRole("heading", { level: 1, name: /\S/ });
/** The program has landed once a card title is on the page. */
const programLoaded = () => screen.findByText("Community Call", { selector: "h3" });

const sendForm = async () => {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Send request" }));
  await screen.findByText("Thank you.");
};

describe("every field in the Visit spec reaches the page", () => {
  it("renders a distinct marker typed into each field", async () => {
    const doc = markerDocument(VISIT_PAGE) as Record<string, Record<string, string>>;
    saved.page = doc;
    render(<Visit />);
    expect(await headline()).toHaveTextContent(doc.hero.headline);
    await sendForm();
    expect(screen.getByText(doc.form.thanks)).toBeTruthy();
  });

  it("says today's words until the village writes its own", async () => {
    render(<Visit />);
    expect(await headline()).toHaveTextContent("Come and see for yourself");
    await sendForm();
    expect(screen.getByText("We'll be in touch within 48 hours to coordinate.")).toBeTruthy();
  });

  it("promises nothing after sending when the village cleared that line", async () => {
    saved.page = { form: { thanks: "" } };
    render(<Visit />);
    await headline();
    await sendForm();
    const box = screen.getByText("Thank you.").parentElement as HTMLElement;
    expect(box.querySelectorAll("p")).toHaveLength(1);
  });
});

describe("a card's button when the card has no link of its own", () => {
  it("carries the label the village wrote, and leads to the form", async () => {
    program.visit_types = [card({ cta_label: "Request a Visit", cta_url: "" })];
    render(<Visit />);
    const button = await screen.findByRole("link", { name: /Request a Visit/ });
    expect(button).toHaveAttribute("href", "#visit-form");
    expect(screen.queryByText(/Contact the team/)).toBeNull();
  });

  it("says Contact the team only when there is no label either", async () => {
    program.visit_types = [card({ cta_label: "  ", cta_url: "" })];
    render(<Visit />);
    expect(await screen.findByRole("link", { name: /Contact the team/ })).toHaveAttribute("href", "#visit-form");
  });

  it("still links out under its label when it has a link", async () => {
    program.visit_types = [card({ cta_label: "Book a call", cta_url: "https://example.test/book" })];
    render(<Visit />);
    expect(await screen.findByRole("link", { name: /Book a call/ })).toHaveAttribute("href", "https://example.test/book");
  });
});

describe("a sentence the village cleared in Visit Program", () => {
  it("draws no empty paragraph under the headline", async () => {
    program.hero_subtitle = "";
    render(<Visit />);
    await programLoaded();
    const hero = document.querySelector("section") as HTMLElement;
    expect(hero.querySelector("p")).toBeNull();
    expect(hero.textContent).not.toContain("decide if");
  });

  it("draws the village's subtitle when there is one", async () => {
    render(<Visit />);
    await programLoaded();
    expect(screen.getByText("Walk the land with us.")).toBeTruthy();
  });

  it("draws no empty contact note above the form", async () => {
    (program.logistics as Record<string, string>).contact_note = "";
    render(<Visit />);
    await programLoaded();
    const formHead = screen.getByRole("heading", { name: "Tell us you're coming" }).parentElement as HTMLElement;
    expect(formHead.querySelector("p")).toBeNull();
  });

  it("draws no logistics card for a cleared logistics line", async () => {
    (program.logistics as Record<string, string>).what_to_bring = " ";
    render(<Visit />);
    await programLoaded();
    expect(screen.queryByText("What to bring")).toBeNull();
    expect(screen.getByText("Getting there")).toBeTruthy();
  });
});

describe("the cost of a visit", () => {
  it("sits beside an icon that names no currency", async () => {
    program.visit_types = [card({ cost: "₡15.000" })];
    render(<Visit />);
    await programLoaded();
    const cost = screen.getByText("₡15.000", { exact: false });
    expect(cost.querySelector("svg.lucide-wallet")).toBeTruthy();
    expect(document.querySelector("svg.lucide-dollar-sign, svg.lucide-circle-dollar-sign")).toBeNull();
  });

  it("draws no cost line at all when the program leaves it blank", async () => {
    program.visit_types = [card({ cost: "" })];
    render(<Visit />);
    await programLoaded();
    await waitFor(() => expect(document.querySelector("svg.lucide-wallet")).toBeNull());
  });
});

describe("the ways to visit as the village arranged them (Admin, Pages, Visit)", () => {
  it("offers them in the form in the order the cards show", async () => {
    program.visit_types = [card({ id: "tour", title: "Land Tour", order: 2 }), card({ id: "call", title: "Community Call", order: 1 })];
    render(<Visit />);
    await programLoaded();
    const cards = Array.from(document.querySelectorAll("h3")).map((h) => h.textContent);
    expect(cards.slice(0, 2)).toEqual(["Community Call", "Land Tour"]);
    const options = Array.from((screen.getByLabelText("Visit type") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["Choose one", "Community Call", "Land Tour"]);
  });

  it("draws no empty grid and no empty choice when the village offers none, and keeps the form", async () => {
    program.visit_types = [];
    render(<Visit />);
    await screen.findByText("Getting there");
    expect(screen.queryByText("Pick a way to visit")).toBeNull();
    expect(screen.queryByLabelText("Visit type")).toBeNull();
    expect(screen.getByRole("button", { name: "Send request" })).toBeTruthy();
  });

  it("draws no empty paragraph for a cleared description", async () => {
    program.visit_types = [card({ description: "" })];
    render(<Visit />);
    const title = await programLoaded();
    const cardBox = title.parentElement as HTMLElement;
    expect(Array.from(cardBox.querySelectorAll("p")).some((p) => p.textContent === "")).toBe(false);
    expect(screen.getByRole("link", { name: /Join the Next Call/ })).toBeTruthy();
  });
});
