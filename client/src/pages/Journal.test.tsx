// @vitest-environment jsdom
/**
 * The Journal page over a real outbox: what a member sees of the pages still
 * on this device.
 *
 * A page the journal turned down is listed with the journal's own sentence,
 * never as one "on its way", and the member can try it again or remove it.
 * Another member's waiting pages are never listed, whoever signed in last.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { JournalEntryInput } from "@shared/journal";

let signedIn: { id: string } | null = { id: "usr-wren" };

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: signedIn }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "journal", lifecycle: "members" }] }),
}));
vi.mock("@/hooks/useVillageName", () => ({
  useVillageName: () => "Willowbrook",
}));
vi.mock("@/components/modules/ModuleGate", () => ({
  default: () => <p>Module gate</p>,
  SignInToSee: () => <p>Sign in to see</p>,
}));

import { TOKEN_KEY } from "@/lib/gameApi";
import { enqueue, flushOutbox, pendingFor } from "@/lib/journalOutbox";
import Journal from "./Journal";

const ME = "usr-wren";
const SOMEONE_ELSE = "usr-fen";
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

const entry = (clientId: string, text: string): JournalEntryInput => ({
  clientId,
  practice: "evening",
  depth: "light",
  answers: [{ questionKey: "q", prompt: "What happened?", text }],
  writtenAt: "2026-10-02T20:00:00.000Z",
  localHour: 20,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
let entriesAnswer: () => Response;

beforeEach(() => {
  signedIn = { id: ME };
  const store = memoryStorage();
  vi.stubGlobal("localStorage", store);
  store.setItem(TOKEN_KEY, tokenFor(ME));
  entriesAnswer = () => json({ error: AHEAD }, 400);
  fetchMock = vi.fn(async (url: string) => (url === "/api/journal/entries" ? entriesAnswer() : json([])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Queue a page and have the journal turn it down, the way a flush would. */
async function refusedPage(clientId: string) {
  enqueue(ME, entry(clientId, "A private evening."));
  await flushOutbox(ME);
  expect(pendingFor(ME)[0]!.refused).toBe(true);
}

describe("a page the journal turned down", () => {
  it("is listed with the journal's sentence, apart from the pages on their way", async () => {
    await refusedPage("c1");
    render(<Journal />);

    const panel = await screen.findByRole("region", { name: "Pages the journal did not take" });
    expect(within(panel).getByText(AHEAD)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // Not counted as a page that goes "as soon as you are back online".
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
  });

  it("goes to the journal on Try again once the journal will take it", async () => {
    await refusedPage("c1");
    render(<Journal />);
    entriesAnswer = () => json({ id: "e1" }, 201);

    const retry = await screen.findByRole("button", { name: "Try again" });
    await act(async () => {
      fireEvent.click(retry);
    });

    await waitFor(() => expect(pendingFor(ME)).toEqual([]));
    expect(screen.queryByRole("region", { name: "Pages the journal did not take" })).toBeNull();
  });

  it("can be removed from the device, after a second tap that says what removing means", async () => {
    await refusedPage("c1");
    render(<Journal />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove from this device" }));
    const confirm = screen.getByRole("group", { name: "Confirm removing this page" });
    expect(confirm).toHaveTextContent("cannot be brought back");
    expect(pendingFor(ME)).toHaveLength(1);

    fireEvent.click(within(confirm).getByRole("button", { name: "Yes, remove it" }));
    expect(pendingFor(ME)).toEqual([]);
    expect(screen.queryByRole("region", { name: "Pages the journal did not take" })).toBeNull();
  });
});

describe("another member's pages on the same device", () => {
  it("are never listed for whoever signs in next", async () => {
    // The last member signed out with a page refused and one still waiting.
    enqueue(SOMEONE_ELSE, entry("theirs-1", "Their private evening."));
    enqueue(SOMEONE_ELSE, entry("theirs-2", "Their other evening."));
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

    render(<Journal />);

    expect(screen.queryByRole("region", { name: "Pages the journal did not take" })).toBeNull();
    expect(screen.queryByText(/saved on this device and not yet in your/)).toBeNull();
    expect(screen.queryByText("Their private evening.")).toBeNull();
    // Still theirs, still on the device, never sent under this session.
    expect(pendingFor(SOMEONE_ELSE)).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/journal/entries")).toEqual([]);
  });
});
