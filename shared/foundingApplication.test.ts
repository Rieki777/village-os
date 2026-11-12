/**
 * THE FOUNDING-TEAM APPLICATION'S VILLAGE WORDS (shared/foundingApplication.ts)
 * and the application's own fields on the body (shared/openProposals.ts).
 */
import { describe, expect, it } from "vitest";
import { FOUNDING_KEYS, PAY_SHAPE_KEYS, UPDATED_NOTE_KEY, foundingSetupFrom, foundingSetupOf, linesOf, payShapeOf, shareWords } from "./foundingApplication";
import { readFileSync } from "node:fs";
import { VARIABLES_BY_KEY, validateVariable } from "./gameVariables";
import { OPEN_APPLY_ROLES, openBodyOf, parseOpenProposal } from "./openProposals";

/** What the server hands in: a setting's default, and "" for one the registry does not know (the pay shape until lane A3 lands). */
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

  it("a fresh village has no pay shape (the page shows N%), no risk line and no footer it did not write", () => {
    const fresh = foundingSetupFrom(defaults);
    expect(fresh).toMatchObject({ shares: [], atRisk: "", footer: "" });
    expect(shareWords(null)).toBe("N%");
    expect(fresh.knowUs).toHaveLength(3);
  });

  it("reads a village's own values: the pay shape in the role cards' spelling, the ways and the conversations by line", () => {
    const set: Record<string, string> = {
      [PAY_SHAPE_KEYS.shape]: "Cash 40, Equity 55; Village credits 5%",
      [PAY_SHAPE_KEYS.atRisk]: "These are at risk.",
      [FOUNDING_KEYS.knowUs]: "Attend the webinar\r\n\r\nCome on a land tour\nJoin the potluck",
      [FOUNDING_KEYS.firstConversations]: "Technical Operations\n",
    };
    const s = foundingSetupFrom((k) => set[k] ?? defaults(k));
    expect(s.shares).toEqual([{ label: "Cash", pct: 40 }, { label: "Equity", pct: 55 }, { label: "Village credits", pct: 5 }]);
    expect(s.atRisk).toBe("These are at risk.");
    expect(s.knowUs).toEqual(["Attend the webinar", "Come on a land tour", "Join the potluck"]);
    expect(s.firstConversations).toEqual(["Technical Operations"]);
  });

  it("a shape that does not read cleanly, or adds up past 100, is no shape: never half a breakdown", () => {
    for (const bad of ["Cash forty", "Cash 40, 55", "Cash 60, Equity 55", "Cash 101", "$4,000 a month"]) expect(payShapeOf(bad), bad).toEqual([]);
    expect(payShapeOf("Cash: 40%")).toEqual([{ label: "Cash", pct: 40 }]);
  });

  it("the first village's seed sets only these settings, each with a value the settings accept, and the 40/55/5 shares", () => {
    const seed = JSON.parse(readFileSync(new URL("../server/seeds/amora/founding-application-seed.json", import.meta.url), "utf8")) as Record<string, string>; // brand-ok: reads the first tenant's own seed folder
    const keys = Object.keys(seed).filter((k) => !k.startsWith("_"));
    expect(keys.sort()).toEqual([...Object.values(FOUNDING_KEYS), ...Object.values(PAY_SHAPE_KEYS)].sort());
    // Each setting this branch registers takes its value; the pay shape's are lane A3's to register.
    for (const k of Object.values(FOUNDING_KEYS)) expect(validateVariable(VARIABLES_BY_KEY[k], seed[k]), k).toBeNull();
    for (const k of Object.values(PAY_SHAPE_KEYS)) if (VARIABLES_BY_KEY[k]) expect(validateVariable(VARIABLES_BY_KEY[k], seed[k]), k).toBeNull();
    const s = foundingSetupFrom((k) => seed[k]);
    expect(s.shares.map((x) => x.pct)).toEqual([40, 55, 5]);
    expect(s.atRisk).toMatch(/at risk/);
    expect(s.firstConversations.join(" ")).toMatch(/Technical Operations/);
  });

  it("QA2-14: the note under the title is its own setting, empty by default, and read back safely", () => {
    expect(VARIABLES_BY_KEY[UPDATED_NOTE_KEY]?.default).toBe("");
    expect(foundingSetupFrom(() => "").updatedNote).toBe("");
    expect(foundingSetupFrom((k) => (k === UPDATED_NOTE_KEY ? "  We updated this application on 14 November.  " : "")).updatedNote).toBe("We updated this application on 14 November.");
    expect(foundingSetupOf({ updatedNote: 7 }).updatedNote).toBe("");
    expect(foundingSetupOf({ updatedNote: "Changed today." }).updatedNote).toBe("Changed today.");
  });

  it("the form's answer is read back safely, whatever arrives", () => {
    expect(foundingSetupOf(undefined)).toMatchObject({ knowUs: [], shares: [], footer: "" });
    expect(foundingSetupOf({ knowUs: ["A", 3, "B"], shares: [{ label: "Cash", pct: 40 }, { label: 7 }], firstConversations: "not a list" })).toMatchObject({ knowUs: ["A", "B"], shares: [{ label: "Cash", pct: 40 }], firstConversations: [] });
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

  it("the server refuses an application naming more than one role, and takes one", () => {
    const two = { ...ctx, roleIds: new Set(["r1", "r2"]) };
    expect(parseOpenProposal({ ...base, roles: [{ roleId: "r1" }, { roleId: "r2" }] }, two)).toMatchObject({ ok: false, field: "roles" });
    expect(parseOpenProposal({ ...base, roles: [{ roleId: "r2" }] }, two)).toMatchObject({ ok: true });
  });
});
