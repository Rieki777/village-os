import { describe, expect, it } from "vitest";
import { needsFor, planSummary, type BasketModule } from "./planBasket";

const mod = (id: string, over: Partial<BasketModule> = {}): BasketModule => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  core: false,
  requires: [],
  lifecycle: "off",
  ...over,
});

const monthly = (amount: number) => ({ amount, currency: "USD", period: "month" as const });

describe("planSummary", () => {
  const all = [
    mod("map"),
    mod("resources", { requires: ["map"] }),
    mod("stays", { legalReview: true, pricing: monthly(1500), priceLine: "$15.00 a month" }),
    mod("saberra", { pricing: monthly(1000), priceLine: "$10.00 a month" }),
    mod("old", { withdrawn: { since: "2026-01-01" } }),
  ];

  it("pulls in what the picks need, and says so", () => {
    const s = planSummary(["resources"], all);
    expect(s.plan.map((m) => m.id)).toEqual(["map", "resources"]);
    expect(s.pulledIn.map((m) => m.id)).toEqual(["map"]);
  });

  it("adds up a monthly price when every paid module bills monthly in one currency", () => {
    const s = planSummary(["stays", "saberra"], all);
    expect(s.monthly).toEqual({ amount: 2500, currency: "USD" });
    expect(s.prices.map((p) => p.line)).toEqual(["$15.00 a month", "$10.00 a month"]);
  });

  it("gives no total when the bills do not add up honestly", () => {
    const mixed = [...all, mod("yearly", { pricing: { amount: 100, currency: "USD", period: "year" }, priceLine: "$1.00 a year" })];
    expect(planSummary(["stays", "yearly"], mixed).monthly).toBeNull();
  });

  it("flags the money modules for the funds card, and blocks a withdrawn pick", () => {
    const s = planSummary(["stays", "old"], all);
    expect(s.fundsCard.map((m) => m.id)).toEqual(["stays"]);
    expect(s.blocked).toEqual([{ name: "Old", why: "is no longer offered" }]);
    expect(s.plan.map((m) => m.id)).toEqual(["stays"]);
  });

  it("keeps the guild-seed seam empty until shared/guilds.ts lands", () => {
    expect(needsFor(all)).toEqual([]);
    expect(planSummary(["map"], all).needs).toEqual([]);
  });
});
