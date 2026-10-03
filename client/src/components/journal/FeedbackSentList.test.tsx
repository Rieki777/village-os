// @vitest-environment jsdom
/**
 * The arrival of a queued message reads in VILLAGE time, named.
 *
 * The batch goes out on Monday at 09:00 in the village's zone. A member whose
 * own clock runs eleven hours behind the village used to read "Waiting for
 * the Monday batch, arrives Sunday", because the date was printed in their
 * zone under copy that names Monday. The reader here sits in Los Angeles and
 * the village in Auckland, so the two days differ by construction.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FeedbackSent } from "@shared/journal";
import { TOKEN_KEY } from "@/lib/gameApi";
import FeedbackSentList, { statusLine } from "./FeedbackSentList";

const VILLAGE = "Pacific/Auckland";
// Monday 5 October 2026, 09:00 in Auckland (NZDT, UTC+13), which is Sunday
// 4 October, 13:00 in Los Angeles.
const MONDAY_NINE_IN_THE_VILLAGE = "2026-10-04T20:00:00.000Z";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const queued: FeedbackSent = {
  id: "fb-1",
  recipientId: "usr-ash",
  observation: "",
  feeling: "",
  need: "",
  request: "",
  recipientName: "Ash",
  message: "Thank you for holding the call.",
  status: "queued",
  deliverAfter: MONDAY_NINE_IN_THE_VILLAGE,
  delivered: false,
  createdAt: "2026-10-02T10:00:00.000Z",
};

let tzWas: string | undefined;
beforeAll(() => {
  tzWas = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  if (tzWas === undefined) delete process.env.TZ;
  else process.env.TZ = tzWas;
});

beforeEach(() => {
  const map = new Map<string, string>([[TOKEN_KEY, "tok-wren"]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/season") return json({ current: null, upcoming: null, timezone: VILLAGE, cadence: "seasonal" });
      if (url === "/api/journal/feedback/sent") return json([queued]);
      return json({ error: "not-here" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when a queued message arrives", () => {
  it("is printed on the village's Monday, named as village time, with the reader's own day beneath", async () => {
    render(<FeedbackSentList />);
    const main = await screen.findByText(/village time/);
    expect(main).toHaveTextContent(/^Waiting for the Monday batch, arrives Monday/);
    expect(main).not.toHaveTextContent(/Sunday/);
    // The reader's own clock reads a different day, so it is said too.
    expect(screen.getByText(/where you are/)).toHaveTextContent(/^Sunday/);
  });

  it("makes no weekday promise while the village's zone is unknown", () => {
    const line = statusLine(queued, null);
    expect(line.main).not.toMatch(/Monday batch/);
    expect(line.main).toMatch(/where you are$/);
    expect(line.local).toBeNull();
  });

  it("prints no second line when the reader lives in the village's zone", () => {
    const line = statusLine(queued, "America/Los_Angeles");
    expect(line.main).toMatch(/village time$/);
    expect(line.local).toBeNull();
  });

  it("says Delivered once the time has passed", () => {
    expect(statusLine({ ...queued, delivered: true }, VILLAGE)).toEqual({ main: "Delivered", local: null });
  });

  it("says it is waiting while the recipient is not taking feedback, and names no Monday", () => {
    const line = statusLine({ ...queued, held: true }, VILLAGE);
    expect(line.main).toBe("They are not taking feedback right now, so this waits until they are.");
    expect(line.main).not.toMatch(/Monday|arrives/);
  });
});
