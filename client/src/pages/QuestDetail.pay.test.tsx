// @vitest-environment jsdom
/**
 * WHAT A QUEST'S PAGE SAYS IT PAYS (0265, Rye 2026-10-21).
 *
 * Every quest shows every token assigned to it, or "Inquire for payment
 * details" when nothing is known, and never a Gratitude reward: no quest pays
 * Gratitude. The figures are the server's `pay`, rendered as they arrive. This
 * replaces the file that asserted one payment sentence per consent cap setting;
 * those settings left with the Gratitude grant they bounded.
 *
 * Asserted through the rendered page, from the payload `GET /api/quests/:id`
 * answers. Nothing here reads the component's source or its props.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, { id: "q-1" }],
  Link: ({ children }: { children: ReactNode }) => <a href="/quests">{children}</a>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/QuestActions", () => ({ default: () => <div /> }));
vi.mock("@/components/QuestCrews", () => ({ default: () => <div /> }));
vi.mock("@/components/messages/WorkChatButton", () => ({ default: () => <div /> }));
vi.mock("@/components/NeedChips", () => ({ default: () => <div /> }));
vi.mock("@/components/admin/NeedTagPicker", () => ({ default: () => <div /> }));
vi.mock("@/components/QuestCard", () => ({
  default: () => <div />,
  QuestPoster: () => <div />,
  iconFor: () => () => <span />,
  difficultyColors: {} as Record<string, string>,
}));

const ctl = vi.hoisted(() => ({ quest: {} as Record<string, unknown> }));

vi.mock("@/lib/gameApi", async (importOriginal) => ({
  // The pure word helpers (villageWord, articleFor) stay real.
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  fetchGameMe: async () => null,
  gameFetch: async () => ({ ok: true, status: 200, json: async () => ({ quest: ctl.quest, related: [] }) }),
  useGameConfig: () => ({ stages: [{ id: "member", name: "Member", description: "" }] }),
}));

import QuestDetail from "./QuestDetail";
import { forgetDisplayRates } from "@/lib/workPay";

const BASE = {
  id: "q-1",
  title: "Mend the north fence",
  description: "A morning with wire and gloves.",
  gratitude: "50-100",
  circle: "Land",
  status: "open",
  difficulty: "gentle",
};

/** Every anonymous read answers nothing worth drawing; the rates answer a CRC and a USD quote. */
function serve(rates: Record<string, number> | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/fx/rates")) {
        return { ok: !!rates, json: async () => (rates ? { base: "EUR", asOf: "2026-10-21", rates } : null) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ perQuest: {}, recent: [] }) } as unknown as Response;
    }),
  );
}

describe("a quest's page says what the quest pays", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    forgetDisplayRates();
  });
  afterEach(() => {
    cleanup();
  });

  it("leads with the value in the village's currency, converts it, and names every token", async () => {
    ctl.quest = {
      ...BASE,
      pay: {
        value: { minor: 2500000, currency: "CRC" },
        lines: [
          { token: "credits", name: "Village Credits", amount: 40 },
          { token: "village-voice", name: "Village Voice", amount: 5 },
        ],
        source: "own",
        cadence: "once",
      },
    };
    // 500 colones and 1.1 dollars to the euro: 25,000 colones is about $55.
    serve({ CRC: 500, USD: 1.1 });
    // The viewer chose to see dollars. With no choice and no currency the village
    // named, the value stays as it is: no borrowed dollar (readiness R154).
    localStorage.setItem("power-display-currency", "USD");
    try {
      render(<QuestDetail />);
      await waitFor(() => expect(screen.getByText(/^Worth/)).toBeTruthy());
      await waitFor(() => expect(screen.getByText(/^Worth/).textContent).toContain("about $55.00"));
      expect(screen.getByText(/^Worth/).textContent).toContain("25,000");
    } finally {
      localStorage.removeItem("power-display-currency");
    }
    expect(screen.getAllByText("40 Village Credits").length).toBeGreaterThan(0);
    // The value block says it; no sentence restates that the work is paid (Rye, 2026-10-23).
    expect(document.body.textContent).not.toContain("the quest pays what it says here");
    // No Gratitude reward anywhere on the page.
    expect(document.body.textContent).not.toContain("50-100");
  });

  it("says to inquire when nobody has set a value and nothing pays", async () => {
    ctl.quest = { ...BASE, pay: { value: null, lines: [], source: "standard", cadence: "once" } };
    serve(null);
    render(<QuestDetail />);
    await waitFor(() => expect(screen.getAllByText(/Inquire for payment details/).length).toBeGreaterThan(0));
  });

  it("shows the standard amounts on a quest nobody valued, and says they are the standard", async () => {
    ctl.quest = {
      ...BASE,
      pay: { value: null, lines: [{ token: "credits", name: "Village Credits", amount: 25 }], source: "standard", cadence: "once" },
    };
    serve(null);
    render(<QuestDetail />);
    await waitFor(() => expect(screen.getByText("These are the village's standard amounts.")).toBeTruthy());
    expect(screen.getByText("No value set yet. Inquire for the full payment details.")).toBeTruthy();
  });

  it("draws no value converted without a rate, and no pay paragraph from an older server", async () => {
    ctl.quest = { ...BASE, pay: { value: { minor: 2500000, currency: "CRC" }, lines: [], source: "own", cadence: "once" } };
    serve(null);
    const first = render(<QuestDetail />);
    await waitFor(() => expect(screen.getByText(/^Worth/)).toBeTruthy());
    expect(screen.getByText(/^Worth/).textContent).not.toContain("about");
    first.unmount();

    ctl.quest = { ...BASE };
    serve(null);
    render(<QuestDetail />);
    await waitFor(() => expect(screen.getAllByText("A morning with wire and gloves.").length).toBeGreaterThan(0));
    expect(document.body.textContent).not.toContain("the quest pays what it says here");
  });
});

describe("a quest's page shows both of the admin's boxes", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    forgetDisplayRates();
  });
  afterEach(() => {
    cleanup();
  });

  it("leads with what it asks for and puts why it matters under its heading", async () => {
    ctl.quest = { ...BASE, story: "The fence keeps the goats out of the orchard." };
    serve(null);
    render(<QuestDetail />);
    const lead = await screen.findByText("A morning with wire and gloves.");
    expect(lead.hasAttribute("data-quest-lead")).toBe(true);
    expect(screen.getByText("Why this quest matters")).toBeTruthy();
    const story = screen.getByText("The fence keeps the goats out of the orchard.");
    // The lead comes first in the reading column.
    expect(lead.compareDocumentPosition(story) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the same words once when both boxes hold them, and no empty heading", async () => {
    ctl.quest = { ...BASE, story: "A morning with wire and gloves." };
    serve(null);
    render(<QuestDetail />);
    await screen.findByText("A morning with wire and gloves.");
    expect(screen.getAllByText("A morning with wire and gloves.")).toHaveLength(1);
    expect(screen.queryByText("Why this quest matters")).toBeNull();
  });
});
