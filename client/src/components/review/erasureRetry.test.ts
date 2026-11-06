/**
 * What the "Ask again" press on /review says (server/routes/erasureQueue.ts,
 * POST /api/review/erasure/retry). Two lanes add to the one answer: the
 * stayed members whose deletions were ended (round 4, the engine) and the
 * owed Stripe cancels (round 4, the subscriptions). The words live here so
 * the page stays under its line ratchet.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const said: Array<[string, string]> = [];
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => said.push(["success", m]),
    error: (m: string) => said.push(["error", m]),
  },
}));

import { announceErasureRetry } from "./erasureRetry";

beforeEach(() => {
  said.length = 0;
});

describe("the erasure retry answer", () => {
  it("says the sweeps that completed, and the stores asked", () => {
    announceErasureRetry({ resumed: 3, swept: 2, asked: 4, finished: 1 });
    expect(said).toEqual([
      ["success", "2 of 3 unfinished sweeps completed here."],
      ["success", "1 of 4 finished. The rest have still not confirmed."],
    ]);
  });

  it("says members who stayed had their deletions ended, and the stuck count otherwise", () => {
    announceErasureRetry({ resumed: 2, swept: 0, stillStuck: 0, stayed: 2 });
    announceErasureRetry({ resumed: 2, swept: 0, stillStuck: 1, stayed: 1 });
    expect(said).toEqual([
      ["success", "2 of these members stayed, so their deletions were ended."],
      ["success", "1 unfinished sweeps are still stuck. The queue says which step."],
    ]);
  });

  it("names the owed cancels, and says nothing was outstanding only when nothing was", () => {
    announceErasureRetry({ cancels: { owed: 2, cleared: 1, connected: true } as any });
    announceErasureRetry({});
    expect(said).toEqual([
      ["success", "1 of 2 owed recurring payments are now cancelled in Stripe."],
      ["success", "Nothing was outstanding."],
    ]);
  });
});
