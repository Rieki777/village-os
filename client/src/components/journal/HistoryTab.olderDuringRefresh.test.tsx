// @vitest-environment jsdom
/**
 * The twin of HistoryTab.test.tsx, in the other order: "Show older entries"
 * is tapped while a refresh is ALREADY out, and the refresh answers first.
 *
 * The list on the page still holds pages 1 and 2, so the older read is asked
 * from page 2's cursor. The refresh then replaces the list with page 1 alone.
 * If the older page is appended after that, page 2's entries are missing
 * between page 1 and page 3 with nothing said, which is the gap finding #28
 * named. A generation counter bumped only when a refresh STARTS cannot see
 * this order, because the older read started after the bump.
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

const page = (p: number) => Array.from({ length: PAGE }, (_, i) => entry(`p${p}-${i}`, (p - 1) * PAGE + i));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

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

async function answer(index: number, body: unknown) {
  await act(async () => {
    reads[index]!.answer(body);
  });
}

const shows = (name: string) => screen.queryByText(`entry ${name}`) !== null;

describe("Show older entries, tapped while a refresh is already out", () => {
  it("never shows page 3 without page 2 when the refresh answers first", async () => {
    const { rerender } = render(<HistoryTab owner="usr-wren" refreshKey={0} />);
    await answer(0, page(1));
    fireEvent.click(screen.getByRole("button", { name: "Show older entries" }));
    await answer(1, page(2));
    expect(shows("p2-29")).toBe(true);

    // A refresh starts (a finished sync) and is held.
    rerender(<HistoryTab owner="usr-wren" refreshKey={1} />);
    const refresh = 2;
    expect(reads).toHaveLength(3);

    // The member taps Show older while it is out: pages 1 and 2 are still on
    // the page, so the cursor is page 2's last entry.
    fireEvent.click(screen.getByRole("button", { name: "Show older entries" }));
    const older = 3;
    expect(reads[older]!.url).toContain(encodeURIComponent(page(2)[PAGE - 1]!.id));

    // The refresh answers first and replaces the list with page 1.
    await answer(refresh, page(1));
    // Then page 3 arrives, for a list that no longer has page 2 in it.
    await answer(older, page(3));

    expect(shows("p1-0")).toBe(true);
    // The gap: page 3 must not sit under page 1 with page 2 missing.
    expect(shows("p3-0") && !shows("p2-0")).toBe(false);
  });
});
