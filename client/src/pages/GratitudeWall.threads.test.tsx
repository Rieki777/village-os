// @vitest-environment jsdom
/**
 * THE WALL AS THREADS (Phase C, decision 4), driven through the page.
 *
 * - The newest thanks come first, even when the server sends them oldest first.
 * - No amount is drawn beside a thanks, and "Where you stand" (people who
 *   thanked you, totals) is gone: the page never asks for those counts.
 * - A send shows the lantern on its way, then arrived, and the new thread is
 *   on the wall.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/CycleClock", () => ({ default: () => null }));
vi.mock("@/components/profile/MoonDock", () => ({ default: () => null }));
vi.mock("@/components/profile/NightMotes", () => ({ default: () => null }));
vi.mock("@/components/gratitude/MoonsPast", () => ({ default: () => null }));
vi.mock("@/components/gratitude/SuggestionChips", () => ({ default: () => null }));
vi.mock("@/components/gratitude/VoicesHero", () => ({ default: () => null }));
vi.mock("@/components/voice/VoiceArea", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/ExamplesBanner", () => ({ forgetExamplesCache: () => {} }));
vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Gratitude" }));
vi.mock("@/hooks/useVillagePaths", () => ({ useLadderTitle: () => "path" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", name: "Mara Sol", handle: "mara" } }) }));

const budget = { total: 100, remaining: 60, fullSends: 5, cap: 20, cycleId: "cy1" };
let wall: any[] = [];
const asked: string[] = [];
let sendResult: { ok: boolean; body: any } = { ok: true, body: { success: true, entry: { toName: "Ana Rio" } } };

vi.mock("@/lib/gameApi", () => ({
  fetchGameMe: async () => ({ gratitude: { budget } }),
  gameFetch: async (url: string, init?: RequestInit) => {
    asked.push(url);
    if (url === "/api/game/gratitude/send") {
      if (sendResult.ok) {
        const body = JSON.parse(String(init?.body));
        wall = [{ id: "new", from: person("Mara Sol", "mara"), to: person("Ana Rio", "ana"), amount: body.amount, message: body.message, at: "2026-11-11T12:00:00Z" }, ...wall];
      }
      return { ok: sendResult.ok, json: async () => sendResult.body };
    }
    if (url === "/api/game/gratitude/me") return { ok: true, json: async () => ({ sent: [] }) };
    if (url === "/api/game/rules") return { ok: true, json: async () => ({ gratitude: { requireMessage: false } }) };
    return { ok: false, json: async () => null };
  },
}));

const person = (name: string, handle: string) => ({ name, handle, avatar: null });

import GratitudeWall from "./GratitudeWall";

i18n.load("en", {});
i18n.activate("en");

beforeEach(() => {
  asked.length = 0;
  sendResult = { ok: true, body: { success: true, entry: { toName: "Ana Rio" } } };
  // Oldest first on purpose: the page must not trust the server's order.
  wall = [
    { id: "a", from: person("Bo", "bo"), to: person("Zoe", "zoe"), amount: 41, message: "the oldest words", at: "2026-10-02T10:00:00Z" },
    { id: "b", from: person("Zoe", "zoe"), to: person("Bo", "bo"), amount: 17, message: "the middle words", at: "2026-11-03T10:00:00Z" },
    { id: "c", from: person("Ana Rio", "ana"), to: person("Bo", "bo"), amount: 23, message: "the newest words", at: "2026-11-09T10:00:00Z" },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: any) => {
    asked.push(String(url));
    if (String(url) === "/api/game/gratitude/wall") return { ok: true, json: async () => wall };
    if (String(url) === "/api/game/cycle") return { ok: true, json: async () => ({ startsAt: "2026-11-01T00:00:00Z" }) };
    return { ok: false, json: async () => null };
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => vi.unstubAllGlobals());

const page = () => render(<I18nProvider i18n={i18n}><GratitudeWall /></I18nProvider>);
const cardWords = () => screen.getAllByTestId("thread-card").map((c) => c.querySelector("blockquote")?.textContent);

describe("the gratitude wall as threads", () => {
  it("puts the newest thanks first and draws no amount", async () => {
    const { container } = page();
    await waitFor(() => expect(screen.getAllByTestId("thread-card")).toHaveLength(3));
    expect(cardWords()).toEqual(["“the newest words”", "“the middle words”", "“the oldest words”"]);
    const cards = screen.getAllByTestId("thread-card").map((c) => c.textContent ?? "");
    for (const text of cards) expect(text).not.toMatch(/\b(41|17|23)\b/);
    expect(container.querySelector("[data-mutual='true']")).toBeTruthy();
  });

  it("never asks for a person's totals: where you stand left the wall", async () => {
    page();
    await waitFor(() => expect(screen.getAllByTestId("thread-card")).toHaveLength(3));
    expect(asked).not.toContain("/api/game/gratitude/flows");
    expect(screen.queryByText(/Where you stand/)).toBeNull();
  });

  it("draws this moon's web, leaving out last moon's thread", async () => {
    const { container } = page();
    await waitFor(() => expect(container.querySelectorAll("[data-testid='thread-web']").length).toBeGreaterThan(0));
    const web = container.querySelector("[data-testid='thread-web']")!;
    // Bo and Zoe thanked each other this moon; Ana thanked Bo. Last moon's Bo to Zoe adds nothing.
    expect(web.querySelectorAll("path[data-pair]")).toHaveLength(2);
  });

  it("carries a thanks as a lantern, and it arrives as a thread", async () => {
    page();
    await waitFor(() => expect(screen.getAllByTestId("thread-card")).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Who you are thanking, by handle"), { target: { value: "@ana" } });
    fireEvent.change(screen.getByLabelText("What you saw them do"), { target: { value: "the bread on Friday" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send the lantern" }));
    });
    await waitFor(() => expect(screen.getByTestId("lantern").getAttribute("data-moment")).toBe("arrived"));
    expect(screen.getByText("Your lantern reached Ana")).toBeTruthy();
    await waitFor(() => expect(cardWords()[0]).toBe("“the bread on Friday”"));
  });

  it("shows no lantern when the send is refused, only the reason", async () => {
    sendResult = { ok: false, body: { message: "That handle is not a member here." } };
    page();
    await waitFor(() => expect(screen.getAllByTestId("thread-card")).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Who you are thanking, by handle"), { target: { value: "@nobody" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send the lantern" }));
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That handle is not a member here."));
    expect(screen.queryByTestId("lantern")).toBeNull();
  });
});
