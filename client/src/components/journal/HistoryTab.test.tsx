// @vitest-environment jsdom
/**
 * A refresh that lands while "Show older entries" is in flight leaves no gap.
 *
 * A refresh replaces the list with page 1. An older page asked for from page
 * 2's cursor and answered after that used to be appended to the fresh page 1,
 * so page 2's thirty entries vanished with nothing said, and the next "Show
 * older" carried on past them. Two refreshes answered out of order also let
 * the older answer overwrite the newer one. Every read here is held open and
 * answered by hand, in the order that broke it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { JournalEntry } from "@shared/journal";
import { TOKEN_KEY } from "@/lib/gameApi";
import HistoryTab from "./HistoryTab";

const PAGE = 30;
const BASE = Date.parse("2026-10-02T12:00:00.000Z");

function entry(name: string, minutesAgo: number): JournalEntry {
  const at = new Date(BASE - minutesAgo * 60_000).toISOString();
  return {
    id: `id-${name}`,
    clientId: `c-${name}`,
    practice: "free",
    depth: "light",
    answers: [{ questionKey: "free", prompt: "Write", text: `entry ${name}` }],
    scores: null,
    writtenAt: at,
    localHour: null,
    privacy: "private",
    meta: null,
    reflection: null,
    confirmed: false,
    createdAt: at,
    updatedAt: at,
  };
}

/** Page `p` (1-based) of a journal of 90 entries, newest first. */
const page = (p: number) => Array.from({ length: PAGE }, (_, i) => entry(`p${p}-${i}`, (p - 1) * PAGE + i));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/** Every read of the entries, held until the test answers it. */
let reads: Array<{ url: string; answer: (body: unknown) => void }>;

beforeEach(() => {
  reads = [];
  const map = new Map<string, string>([[TOKEN_KEY, "tok-wren"]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          if (!url.startsWith("/api/journal/entries")) return resolve(new Response("{}", { status: 404 }));
          reads.push({ url, answer: (body) => resolve(json(body)) });
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answer the read at `index` and let React settle. */
async function answer(index: number, body: unknown) {
  await act(async () => {
    reads[index]!.answer(body);
  });
}

const shows = (name: string) => screen.queryByText(`entry ${name}`) !== null;

describe("Show older entries, with a refresh in the middle", () => {
  it("never shows page 3 without page 2, and the newest refresh wins", async () => {
    const { rerender } = render(<HistoryTab owner="usr-wren" refreshKey={0} />);
    await answer(0, page(1));
    expect(shows("p1-0")).toBe(true);

    // Page 2, normally.
    fireEvent.click(screen.getByRole("button", { name: "Show older entries" }));
    expect(reads[1]!.url).toContain("before=");
    await answer(1, page(2));
    expect(shows("p2-29")).toBe(true);

    // Page 3 is asked for from page 2's cursor, and held.
    fireEvent.click(screen.getByRole("button", { name: "Show older entries" }));
    const older = 2;
    expect(reads[older]!.url).toContain(encodeURIComponent(page(2)[PAGE - 1]!.id));

    // Two refreshes land while it is out (a finished sync, then Sync now).
    rerender(<HistoryTab owner="usr-wren" refreshKey={1} />);
    rerender(<HistoryTab owner="usr-wren" refreshKey={2} />);
    const [first, second] = [3, 4];
    expect(reads).toHaveLength(5);

    // The newer refresh answers first, and carries an entry just synced.
    const fresh = [entry("new", -1), ...page(1).slice(0, PAGE - 1)];
    await answer(second, fresh);
    // The older refresh answers late, from before that entry reached the server.
    await answer(first, page(1));
    // Then page 3 arrives, for a list that no longer has page 2 in it.
    await answer(older, page(3));

    expect(shows("new")).toBe(true);
    expect(shows("p1-0")).toBe(true);
    expect(shows("p2-0")).toBe(false);
    // The gap: page 3 must not sit under page 1 with page 2 missing.
    expect(shows("p3-0")).toBe(false);

    // Show older carries on from the fresh page 1's last entry, so nothing is skipped.
    fireEvent.click(screen.getByRole("button", { name: "Show older entries" }));
    expect(reads[5]!.url).toContain(encodeURIComponent(fresh[PAGE - 1]!.id));
  });
});
