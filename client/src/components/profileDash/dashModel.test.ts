import { describe, expect, it } from "vitest";
import {
  abilitiesAtStage,
  cashSummary,
  daysUntil,
  earnedIn,
  moonRows,
  nextRungProgress,
  pickTokens,
  rungStates,
  stagePill,
  whole,
  wholeMoney,
} from "./dashModel";
import { todayCards } from "./TodayStrip";

const rung = (id: string, rule: any) => ({ id, name: id[0].toUpperCase() + id.slice(1), rule });

describe("nextRungProgress", () => {
  it("counts consented quests against the quests rung, capped at the rung", () => {
    expect(nextRungProgress(rung("contributor", { type: "quests", min: 3 }), { consentedQuests: 2 })).toEqual({ done: 2, total: 3 });
    expect(nextRungProgress(rung("contributor", { type: "quests", min: 3 }), { consentedQuests: 9 })).toEqual({ done: 3, total: 3 });
  });
  it("counts mandatory lessons against the training rung", () => {
    expect(nextRungProgress(rung("immersant", { type: "training-complete" }), { consentedQuests: 0, training: { done: 2, required: 3 } })).toEqual({ done: 2, total: 3 });
  });
  it("draws no steps for a rung that is one act", () => {
    expect(nextRungProgress(rung("member", { type: "membership" }), { consentedQuests: 4 })).toBeNull();
    expect(nextRungProgress(rung("guide", { type: "granted" }), { consentedQuests: 4 })).toBeNull();
    expect(nextRungProgress(null, { consentedQuests: 4 })).toBeNull();
  });
  it("says nothing while the count is unknown", () => {
    expect(nextRungProgress(rung("contributor", { type: "quests", min: 3 }), { consentedQuests: null })).toBeNull();
  });
});

describe("the ladder and the pill", () => {
  const stages = ["visitor", "guest", "member", "contributor", "sage"].map((id) => ({ id, name: id }));
  it("marks reached, current, next and ahead", () => {
    expect(rungStates(stages, 2).map((r) => r.state)).toEqual(["reached", "reached", "current", "next", "ahead"]);
  });
  it("names the stage once both halves are known", () => {
    expect(stagePill(stages, 2)).toBe("Stage 3 · member");
    expect(stagePill(null, 2)).toBeNull();
    expect(stagePill(stages, null)).toBeNull();
  });
});

describe("abilitiesAtStage", () => {
  it("lists the held powers this rung opened, never an appointed one", () => {
    const cat = [
      { label: "Vote on a ballot", held: true, opens: { via: "stage" as const, stage: "member" } },
      { label: "Post", held: true, opens: { via: "stage" as const, stage: "guest" } },
      { label: "Seat roles", held: true, opens: { via: "appointment" as const } },
      { label: "Veto", held: false, opens: { via: "stage" as const, stage: "member" } },
    ];
    expect(abilitiesAtStage(cat, "member")).toEqual(["Vote on a ballot"]);
  });
});

describe("treasury arithmetic", () => {
  const ledger = [
    { tokenType: "credit", amount: 4000, decimals: 2, at: "2026-10-20T10:00:00Z" },
    { tokenType: "credit", amount: -1000, decimals: 2, at: "2026-10-21T10:00:00Z" },
    { tokenType: "credit", amount: 14000, decimals: 2, at: "2026-09-25T10:00:00Z" },
    { tokenType: "voice", amount: 5, decimals: 0, at: "2026-10-22T10:00:00Z" },
  ];
  it("earnedIn sums credits only, in whole units, inside the window", () => {
    expect(earnedIn(ledger, "credit", "2026-10-15T00:00:00Z")).toBe(40);
    expect(earnedIn(ledger, "credit", "2026-09-15T00:00:00Z", "2026-10-15T00:00:00Z")).toBe(140);
    expect(earnedIn(ledger, "voice", "2026-10-15T00:00:00Z")).toBe(5);
  });
  it("moonRows reads the village's own moon bounds, newest first", () => {
    const rows = moonRows(
      ledger,
      {
        current: { startsAt: "2026-10-15T00:00:00Z", endsAt: "2026-11-13T00:00:00Z" },
        past: [
          { startsAt: "2026-08-16T00:00:00Z", endsAt: "2026-09-15T00:00:00Z", cycleNumber: 1 },
          { startsAt: "2026-09-15T00:00:00Z", endsAt: "2026-10-15T00:00:00Z", cycleNumber: 2 },
        ],
      },
      { village: "credit", voice: "voice" },
      [{ amountMinor: 5000, state: "paid", owedAt: "2026-09-20T00:00:00Z" }],
    );
    expect(rows.map((r) => [r.label, r.tokens, r.voice, r.cashMinor, r.cashPaid])).toEqual([
      ["This moon", 40, 5, 0, false],
      ["Last moon", 140, 0, 5000, true],
      ["2 moons ago", 0, 0, 0, false],
    ]);
  });
  it("cashSummary counts every state and refuses to sum mixed currencies", () => {
    const one = cashSummary([
      { amountMinor: 1000, currency: "USD", state: "owed" },
      { amountMinor: 500, currency: "USD", state: "claimed" },
      { amountMinor: 900, currency: "USD", state: "paid" },
    ]);
    expect(one).toEqual({ outstandingMinor: 1500, currency: "USD", owed: 1, claimed: 1, paid: 1 });
    expect(cashSummary([
      { amountMinor: 1000, currency: "USD", state: "owed" },
      { amountMinor: 500, currency: "CRC", state: "owed" },
    ]).currency).toBeNull();
  });
  /** The rows in the order /api/me/wallet really returns them (E2E finding E6, 2026-10-31). */
  const realWallet = [
    { token: "earned-equity", kind: "equity", role: "claimable" },
    { token: "village-voice", kind: "voice", role: "claimable" },
    { token: "library-credit", kind: "credit", role: "village" },
    { token: "stay-credit", kind: "credit", role: "village" },
    { token: "credits", kind: "credit", role: "village" },
    { token: "gratitude", kind: "recognition", role: "gratitude" },
  ];
  it("pickTokens finds the village's value token by its slug, whatever the wallet's order", () => {
    const got = pickTokens(realWallet, "credits");
    expect(got.village?.token).toBe("credits");
    expect(got.voice?.token).toBe("village-voice");
  });
  it("pickTokens still reads right when the value token is the first row", () => {
    const first = [realWallet[4], ...realWallet.slice(0, 4), realWallet[5]];
    expect(pickTokens(first, "credits").village?.token).toBe("credits");
  });
  it("pickTokens follows a village that renamed or repointed its value token", () => {
    const renamed = realWallet.map((r) => (r.token === "credits" ? { ...r, token: "seeds" } : r));
    expect(pickTokens(renamed, "seeds").village?.token).toBe("seeds");
    expect(pickTokens(realWallet, "stay-credit").village?.token).toBe("stay-credit");
  });
  it("pickTokens draws nothing, never another token, when the value token is missing", () => {
    const without = realWallet.filter((r) => r.token !== "credits");
    expect(pickTokens(without, "credits").village).toBeNull();
    // The config has not answered yet.
    expect(pickTokens(realWallet, null).village).toBeNull();
    expect(pickTokens(realWallet, undefined).village).toBeNull();
    expect(pickTokens([], "credits")).toEqual({ village: null, voice: null });
  });
  it("pickTokens never takes the recognition row as the value token", () => {
    expect(pickTokens(realWallet, "gratitude").village).toBeNull();
  });
  it("wholeMoney prints whole units of the currency, never cents", () => {
    expect(wholeMoney(4_500_000, "CRC")).not.toMatch(/[.,]00/);
    expect(wholeMoney(4_500_000, "CRC")).toMatch(/45,000/);
    expect(wholeMoney(12_345, "USD")).toBe("$123");
    expect(wholeMoney(5000, "JPY")).toMatch(/5,000/);
  });
  it("whole rounds once and groups", () => {
    expect(whole(1239.6)).toMatch(/1.?240/);
  });
  it("daysUntil never goes below zero", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    expect(daysUntil("2026-11-01T12:00:00Z", now)).toBe(2);
    expect(daysUntil("2026-10-01T12:00:00Z", now)).toBe(0);
    expect(daysUntil("not a date", now)).toBeNull();
  });
});

describe("todayCards", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  it("draws nothing for reads that did not answer", () => {
    expect(todayCards({ consents: null, tasks: null, messages: null, session: null }, now)).toEqual([]);
  });
  it("keeps the design's order and says only what the reads hold", () => {
    const cards = todayCards(
      {
        consents: [{ proposalId: 1, applicationId: 2, href: "/role-applications/2", roles: ["Cook"], circle: "Kitchen circle", applicant: "Ada", closesOn: "2026-11-01T12:00:00Z" } as any],
        tasks: { waiting: 2, nextDue: "2026-10-30" },
        messages: { unreadTotal: 2, top: { id: "9", title: "Seed bank shelves", preview: "Trays arrive Monday", unread: 2 }, parties: [] },
        session: { circle: "General circle", title: null, words: "Thu at 17:00", href: "/sessions" },
      },
      now,
    );
    expect(cards.map((c) => c.key)).toEqual(["consent", "tasks", "messages", "session"]);
    expect(cards[0]).toMatchObject({ kicker: "Your consent · 2 days left", title: "Kitchen circle: Cook", href: "/role-applications/2" });
    expect(cards[1]).toMatchObject({ kicker: "Due today", title: "2 tasks from your sessions" });
    expect(cards[2]).toMatchObject({ kicker: "2 unread", title: "Seed bank shelves", href: "/messages/9" });
    expect(cards[3]).toMatchObject({ kicker: "Live session · Thu at 17:00", title: "General circle" });
  });
  it("leaves out a card with nothing in it", () => {
    const cards = todayCards({ consents: [], tasks: { waiting: 0, nextDue: null }, messages: { unreadTotal: 0, top: null, parties: [] }, session: null }, now);
    expect(cards).toEqual([]);
    expect(todayCards({ consents: null, tasks: null, messages: null, session: null, asks: { waiting: 0, blocking: 0 } }, now)).toEqual([]);
  });
  it("leads with the asks waiting on the member, and says when someone is stuck", () => {
    const stuck = todayCards({ consents: null, tasks: { waiting: 1, nextDue: null }, messages: null, session: null, asks: { waiting: 3, blocking: 1 } }, now);
    expect(stuck.map((c) => c.key)).toEqual(["asks", "tasks"]);
    expect(stuck[0]).toMatchObject({ kicker: "Someone is stuck on you", title: "3 asks waiting on you", meta: "1 blocking · Open your asks", href: "/profile#waiting" });
    const calm = todayCards({ consents: null, tasks: null, messages: null, session: null, asks: { waiting: 1, blocking: 0 } }, now);
    expect(calm[0]).toMatchObject({ kicker: "Asked of you", title: "One ask waiting on you", meta: "Open your asks" });
  });
});
