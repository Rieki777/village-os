/**
 * WHAT A MEMBER IS TOLD WHEN THE MODEL SAYS NO (plan 5.5; audit of 2026-09-28).
 *
 * `callAssistant` answers 503 `assistant-unavailable` for a spent day budget,
 * the platform cap and a member key's own daily cap alike. The route answers
 * `NO_MODEL` before this is reached when no key exists, so here a 503 means a
 * spent allowance, and the member must never be told no model is connected
 * while their own key still is.
 *
 * The model call is a stand-in: no network runs here.
 */
import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

const answer = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("./assistant", () => ({
  DEFAULT_ASSISTANT_MODEL: "stand-in-model",
  callAssistant: vi.fn(async () => answer.current),
}));
vi.mock("./assistantUsage", () => ({ recordAssistantUsage: vi.fn(async () => undefined) }));
vi.mock("./identity", () => ({ instanceIdentity: () => ({ instanceId: "stand-in" }) }));

import { draftWithModel } from "./documentDraftModel";

const ask = () =>
  draftWithModel({ pool: {} as Pool, userId: "u1", clientIp: "127.0.0.1", title: "Notes", text: "## Money\n\nDues.", memberKey: { provider: "anthropic", key: "sk-own" } });

beforeEach(() => {
  answer.current = null;
});

describe("the model's refusals, from the member's side", () => {
  it("says a spent allowance is spent for today, and never that no model is connected", async () => {
    answer.current = { ok: false, status: 503, error: "assistant-unavailable" };
    const got = await ask();
    expect(got).toEqual({ ok: false, status: 503, error: "The model has done all it can for today. The words-only draft still works." });
    expect(JSON.stringify(got)).not.toContain("connected");
  });

  it("passes a guard's own words through, as it said them", async () => {
    answer.current = { ok: false, status: 429, error: "Slow down a moment, then keep going." };
    expect(await ask()).toEqual({ ok: false, status: 429, error: "Slow down a moment, then keep going." });
  });
});
