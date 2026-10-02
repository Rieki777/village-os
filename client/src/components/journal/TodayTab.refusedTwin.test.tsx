// @vitest-environment jsdom
/**
 * A refused page lives in two places at once: open on Today, and listed
 * above the tabs with "Try again". When "Try again" goes through first, the
 * open page still carries that clientId, and a second save under it is the
 * server's duplicate no-op: it answers 200 and keeps none of the new words.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { questionsFor, type JournalEntryInput } from "@shared/journal";
import { TOKEN_KEY } from "@/lib/gameApi";
import { flushOutbox, retryEntry } from "@/lib/journalOutbox";
import TodayTab from "./TodayTab";

const OWNER = "usr-wren";
const AHEAD = "That entry is dated more than a day ahead. Check this device's clock.";

function tokenFor(userId: string): string {
  const claims = JSON.stringify({ userId, email: `${userId}@example.test`, timestamp: 1, v: 0 });
  return `${btoa(claims).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.sig`;
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
const entryBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === "/api/journal/entries")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as JournalEntryInput);

beforeEach(() => {
  const store = memoryStorage();
  vi.stubGlobal("localStorage", store);
  store.setItem(TOKEN_KEY, tokenFor(OWNER));
  fetchMock = vi.fn(async () => json({ error: AHEAD }, 400));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => {
    await flushOutbox(OWNER);
  });
  vi.unstubAllGlobals();
});

it("saves the open page under a new clientId once Try again has sent the refused copy", async () => {
  render(<TodayTab owner={OWNER} village="Willowbrook" now={() => new Date(2026, 9, 2, 9, 0, 0)} />);
  fireEvent.click(screen.getByRole("button", { name: /^Morning/ }));
  const qs = questionsFor("morning", "light");
  fireEvent.change(screen.getByRole("textbox", { name: qs[0]!.prompt }), { target: { value: "Slept deep." } });
  for (let i = 0; i < qs.length; i++) fireEvent.click(screen.getByRole("button", { name: /^(Next|Review)$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(AHEAD);
  const firstId = entryBodies()[0]!.clientId;

  // The member fixes the clock and taps "Try again" in the list above the tabs.
  fetchMock.mockImplementation(async () => json({ id: "e1" }, 201));
  await act(async () => {
    expect((await retryEntry(OWNER, firstId)).sent).toEqual([firstId]);
  });

  // Back on the still-open page, they add a sentence and save it.
  fireEvent.change(screen.getByRole("textbox", { name: qs[0]!.prompt }), {
    target: { value: "Slept deep. Woke at five." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));
  expect(await screen.findByText("Saved to your journal.")).toBeInTheDocument();

  const fuller = entryBodies().find((e) => e.answers[0]?.text === "Slept deep. Woke at five.");
  expect(fuller).toBeDefined();
  // Under the first clientId the server would keep the first row and drop these words.
  expect(fuller!.clientId).not.toBe(firstId);
});
