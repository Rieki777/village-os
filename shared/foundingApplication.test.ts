/**
 * THE FOUNDING-TEAM APPLICATION'S VILLAGE WORDS (shared/foundingApplication.ts)
 * and the application's own fields on the body (shared/openProposals.ts).
 */
import { describe, expect, it } from "vitest";
import { FOUNDING_KEYS, foundingSetupFrom, foundingSetupOf, linesOf, shareOf, shareWords } from "./foundingApplication";
import { readFileSync } from "node:fs";
import { VARIABLES_BY_KEY, validateVariable } from "./gameVariables";
import { OPEN_APPLY_ROLES, openBodyOf, parseOpenProposal } from "./openProposals";

const defaults = (key: string) => VARIABLES_BY_KEY[key]?.default ?? "";

describe("the village's words", () => {
  it("every key is a registered village setting under The founding team, and a fresh village names no village", () => {
    for (const key of Object.values(FOUNDING_KEYS)) {
      expect(VARIABLES_BY_KEY[key], key).toBeTruthy();
      expect(VARIABLES_BY_KEY[key].category).toBe("The founding team");
    }
    const fresh = JSON.stringify(foundingSetupFrom(defaults));
    expect(fresh).not.toMatch(/Amora|Costa Rica|Dominical/i); // brand-ok: proves the platform defaults name no village
  });

  it("a fresh village shows N% for every share: the shares are data a village sets, never a platform figure", () => {
    const fresh = foundingSetupFrom(defaults);
    expect(fresh.shares).toEqual({ cash: null, equity: null, credits: null });
    expect(shareWords(fresh.shares.cash)).toBe("N%");
    expect(fresh.footer).toBe("Indicative only. Equity, land credit, token and credit terms are still being defined and are subject to legal review.");
    expect(fresh.atRisk).toMatch(/at risk/);
    expect(fresh.knowUs).toHaveLength(3);
  });

  it("reads a village's own values, the shares as whole percents", () => {
    const set: Record<string, string> = {
      [FOUNDING_KEYS.cashPct]: "40",
      [FOUNDING_KEYS.equityPct]: "55",
      [FOUNDING_KEYS.creditsPct]: "5",
      [FOUNDING_KEYS.knowUs]: "Attend the webinar\r\n\r\nCome on a land tour\nJoin the potluck",
      [FOUNDING_KEYS.firstConversations]: "Technical Operations\n",
    };
    const s = foundingSetupFrom((k) => set[k] ?? defaults(k));
    expect(s.shares).toEqual({ cash: 40, equity: 55, credits: 5 });
    expect(s.knowUs).toEqual(["Attend the webinar", "Come on a land tour", "Join the potluck"]);
    expect(s.firstConversations).toEqual(["Technical Operations"]);
  });

  it("the first village's seed sets only these settings, each with a value the settings accept, and the 40/55/5 shares", () => {
    const seed = JSON.parse(readFileSync(new URL("../server/seeds/amora/founding-application-seed.json", import.meta.url), "utf8")) as Record<string, string>; // brand-ok: reads the first tenant's own seed folder
    const keys = Object.keys(seed).filter((k) => !k.startsWith("_"));
    expect(keys.sort()).toEqual(Object.values(FOUNDING_KEYS).sort());
    for (const k of keys) expect(validateVariable(VARIABLES_BY_KEY[k], seed[k]), k).toBeNull();
    const s = foundingSetupFrom((k) => seed[k]);
    expect(s.shares).toEqual({ cash: 40, equity: 55, credits: 5 });
    expect(s.atRisk).toMatch(/at risk/);
    expect(s.firstConversations.join(" ")).toMatch(/Technical Operations/);
  });

  it("a share that is not a whole percent from 0 to 100 reads as unset", () => {
    expect(["", " ", "-1", "101", "4.5", "forty", "1000"].map(shareOf)).toEqual([null, null, null, null, null, null, null]);
    expect(["0", "100", " 7 "].map(shareOf)).toEqual([0, 100, 7]);
  });

  it("the form's answer is read back safely, whatever arrives", () => {
    expect(foundingSetupOf(undefined)).toMatchObject({ knowUs: [], shares: { cash: null, equity: null, credits: null }, footer: "" });
    expect(foundingSetupOf({ knowUs: ["A", 3, "B"], shares: { cash: 40, equity: "x" }, compNotes: "not a list" })).toMatchObject({ knowUs: ["A", "B"], shares: { cash: 40, equity: null, credits: null }, compNotes: [] });
    expect(linesOf("a\n\n b \n")).toEqual(["a", "b"]);
  });
});

describe("the application's own fields", () => {
  const ctx = { roleIds: new Set(["r1"]), address: (s: string) => (s.includes("@") ? s.trim() : null), knowUs: ["Visit the land", "Share a meal"] };
  const base = { name: "Rowan", email: "rowan@example.test", roles: [{ roleId: "r1" }], why: "Because.", aim: "" };

  it("keeps the ticks the village lists, the ramp-up, and Human Design or Gene Keys", () => {
    const p = parseOpenProposal({ ...base, knowUs: ["Share a meal", "Not listed", "Share a meal"], rampUp: true, selfKnowledge: " Generator 2/4 " }, ctx);
    expect(p.ok && p.value.body).toMatchObject({ knowUs: ["Share a meal"], rampUp: true, selfKnowledge: "Generator 2/4" });
  });

  it("with nothing ticked, no ramp-up and no Human Design, stores none of them (the step never locks)", () => {
    const p = parseOpenProposal({ ...base, knowUs: [], rampUp: "yes" }, ctx);
    expect(p.ok).toBe(true);
    if (p.ok) for (const k of ["knowUs", "rampUp", "selfKnowledge"]) expect(p.value.body).not.toHaveProperty(k);
  });

  it("a stored body reads them back, and the form never sends more than one role", () => {
    expect(openBodyOf({ roles: [{ roleId: "r1" }], why: "w", aim: "a", knowUs: ["x", 1], rampUp: true, selfKnowledge: "y" })).toMatchObject({ knowUs: ["x"], rampUp: true, selfKnowledge: "y" });
    expect(OPEN_APPLY_ROLES).toBe(1);
  });
});
