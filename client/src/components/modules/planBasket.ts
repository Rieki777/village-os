/**
 * THE FOUNDER'S PLANNING BASKET (Rye approved, 2026-10-09).
 *
 * Before launch a founder picks several modules, sees what they add up to in
 * one place, and turns them on together. The basket is a plan and nothing
 * else: it lives in this browser only (safeStorage, which never throws), it is
 * never sent anywhere, and losing it loses nothing but a list. Turning the
 * plan on goes through the same switch route as one module does.
 *
 * `planSummary` is pure so it is tested without a page: the modules the picks
 * pull in, the price, and which ones ask for the funds card.
 *
 * ── THE SEAM FOR GUILD SEEDS ─────────────────────────────────────────────
 *
 * `shared/guilds.ts` lives on the unlanded branch wt/guild-manifests. Once it
 * lands, each module names the keys and co-signers it needs, and the panel
 * shows them as one "what you'll need" list. `needsFor` below is where that
 * list is built: today it answers nothing, and `PlanBasketPanel` already
 * renders whatever it returns under its own heading, so the guild work is one
 * function body and no layout.
 */
import { useEffect, useState } from "react";
import { readStoredJson, writeStoredJson } from "@/lib/safeStorage";
import { turnOnPlan, type PlanModule } from "@shared/moduleSwitch";
import { planNeeds, type ModuleNeed } from "@shared/moduleNeeds";

const KEY = "modules.planBasket";
export const BASKET_EVENT = "modules:basket";

export function readBasket(): string[] {
  const r = readStoredJson("local", KEY);
  return r.status === "value" && Array.isArray(r.value) ? (r.value as unknown[]).map(String) : [];
}

export function writeBasket(ids: string[]): void {
  writeStoredJson("local", KEY, Array.from(new Set(ids)));
  window.dispatchEvent(new Event(BASKET_EVENT));
}

export function toggleInBasket(id: string): void {
  const now = readBasket();
  writeBasket(now.includes(id) ? now.filter((x) => x !== id) : [...now, id]);
}

/** The basket, kept in step across the shelf, the detail page and other tabs. */
export function useBasket(): string[] {
  const [ids, setIds] = useState<string[]>(() => readBasket());
  useEffect(() => {
    const on = () => setIds(readBasket());
    window.addEventListener(BASKET_EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(BASKET_EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  return ids;
}

/** The slice of an admin module row the summary reads. */
export interface BasketModule extends PlanModule {
  pricing?: { amount: number; currency: string; period: "month" | "year" | "once" } | null;
  priceLine?: string | null;
  needs?: ModuleNeed[] | null;
}

/** One thing a plan needs set up before it can run, from the guild seeds. */
export interface NeedLine {
  moduleId: string;
  text: string;
}

/**
 * The guild seeds the whole plan needs, each once. Two money modules share
 * the card-payment key, and a founder plants it once, so it reads once with
 * both names. Keystones say so, because those need a second founder.
 */
export function needsFor(plan: readonly BasketModule[]): NeedLine[] {
  return planNeeds(plan).map(({ need, forModules }) => ({
    moduleId: need.id,
    text: `${need.title} (${forModules.join(", ")}): ${need.provider}.${need.keystone ? " A keystone, so a second founder agrees to it." : ""}`,
  }));
}

export interface PlanSummary {
  /** Everything that would turn on, dependencies first. */
  plan: BasketModule[];
  /** Modules the picks pull in that were not picked. */
  pulledIn: BasketModule[];
  /** Price lines of the paid modules in the plan. */
  prices: { name: string; line: string }[];
  /** A monthly total, when every paid module bills monthly in one currency. */
  monthly: { amount: number; currency: string } | null;
  /** Modules that show the funds card first. */
  fundsCard: BasketModule[];
  /** Picks that can never turn on, with why. */
  blocked: { name: string; why: string }[];
  needs: NeedLine[];
}

export function planSummary(picked: readonly string[], all: readonly BasketModule[]): PlanSummary {
  const byId = new Map(all.map((m) => [m.id, m]));
  const blocked: PlanSummary["blocked"] = [];
  const usable = picked.filter((id) => {
    const m = byId.get(id);
    if (!m) return false;
    if (m.withdrawn && (m.lifecycle ?? "off") === "off") {
      blocked.push({ name: m.name, why: "is no longer offered" });
      return false;
    }
    return true;
  });
  const plan = turnOnPlan(usable, "preview", all) as BasketModule[];
  const pulledIn = plan.filter((m) => !picked.includes(m.id));
  const paid = plan.filter((m) => m.pricing && m.pricing.amount > 0);
  const prices = paid.map((m) => ({ name: m.name, line: m.priceLine ?? "" }));
  const currencies = new Set(paid.map((m) => m.pricing!.currency));
  const allMonthly = paid.every((m) => m.pricing!.period === "month");
  const monthly =
    paid.length > 0 && currencies.size === 1 && allMonthly
      ? { amount: paid.reduce((n, m) => n + m.pricing!.amount, 0), currency: paid[0].pricing!.currency }
      : null;
  return {
    plan,
    pulledIn,
    prices,
    monthly,
    fundsCard: plan.filter((m) => m.legalReview),
    blocked,
    needs: needsFor(plan),
  };
}
