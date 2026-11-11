/**
 * The lead-approved writes (the lead's ruling of 10 and 11 November 2026; shared/agentAdmin.ts).
 *
 *   off       the opt-in off answers exactly as before, over the whole always-a-person list and every
 *             lead-approved route: a regression pin
 *   on        each newly allowed route passes, with a body the ruling allows
 *   still     the veto seat, the break-glass seat, a badge-ungrantable power, an admin-panel seat, money,
 *             erasure, secrets, agent accounts and direct capability grants all still refuse
 *   approval  a seating or unseating with no approvedBy or approvalNote refuses
 *   seed      the village seed list saves with the opt-in on and refuses with it off
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  adminRequestDecision,
  AGENT_WORDING_VARIABLES,
  ALWAYS_A_PERSON,
  alwaysAPerson,
  LEAD_APPROVED_WRITES,
  leadApprovedBodyProblem,
  LIFTABLE_RULES,
  mergePastedAgentPaths,
  parseAgentAdminPaths,
  type AgentAdminPathsDoc,
  type LeadSeatFacts,
} from "./agentAdmin";
import { VARIABLES_BY_KEY } from "./gameVariables";

const ON = { leadApprovedWrites: true } as const;
const seed = JSON.parse(readFileSync(path.resolve(process.cwd(), "server/seeds/amora/agent-paths-seed.json"), "utf8")) as AgentAdminPathsDoc; // brand-ok: the first village's own record
const listed = (rows: Array<[string, string]>): AgentAdminPathsDoc => ({ paths: rows.map(([method, p]) => ({ method: method as any, path: p, confirm: "agent", label: "x" })) });

const NEWLY_OPEN: Array<[string, string]> = [
  ["POST", "/api/admin/org/roles"],
  ["PUT", "/api/admin/org/roles/r-gardener"],
  ["POST", "/api/org/role-edit/r-gardener"],
  ["POST", "/api/admin/org/drafts"],
  ["POST", "/api/admin/org/drafts/d-1/changes"],
  ["PUT", "/api/admin/org/drafts/d-1/vision"],
  ["POST", "/api/admin/org/roles/r-gardener/holders"],
  ["DELETE", "/api/admin/org/seatings/s-1"],
  ...AGENT_WORDING_VARIABLES.map((k) => ["PUT", `/api/admin/variables/${k}`] as [string, string]),
];

// Every route the existing check-53 table pins, plus the person-only neighbours of the new ones.
const STILL_A_PERSON: Array<[string, string]> = [
  ["DELETE", "/api/admin/players/u-9"],
  ["POST", "/api/admin/players/u-9/anonymize"],
  ["PUT", "/api/admin/capabilities/moon.approve/holding"],
  ["POST", "/api/admin/badges/b-1/award"],
  ["PUT", "/api/admin/roles/r-1/capabilities"],
  ["POST", "/api/admin/roles/r-1/holders"],
  ["PUT", "/api/admin/org-roles/r-1/power-groups"],
  ["PUT", "/api/admin/roles/r-1/admin-access"],
  ["POST", "/api/admin/org/drafts/d-1/publish"],
  ["PUT", "/api/org/roles/r-1/pay"],
  ["PUT", "/api/moon-review/payers"],
  ["POST", "/api/moon-review/invoices/i-1/approve"],
  ["POST", "/api/admin/tokens/seed/mint"],
  ["PUT", "/api/admin/integrations/stripe"],
  ["PUT", "/api/admin/users/u-9/role"],
  ["PUT", "/api/admin/players/u-9/agent"],
  ["PUT", "/api/admin/agent-admin-paths"],
  ["PUT", "/api/admin/settings"],
  ["PUT", "/api/admin/brand"],
  ["PUT", "/api/admin/variables/membership.invite_only"],
  ["PUT", "/api/admin/variables/agents.lead_approved_writes"],
  ["PUT", "/api/admin/modules/m-2/config"],
  ["POST", "/api/admin/org/seatings/s-1/forget"],
  // A role or seat id that also reads as money is still money: the lift never reaches that rule.
  ["PUT", "/api/admin/org/roles/treasury-keeper"],
  ["POST", "/api/admin/org/roles/cash-steward/holders"],
];

describe("with the opt-in off, nothing changes", () => {
  it("answers every path exactly as the list did before, rule by rule", () => {
    for (const [m, p] of [...NEWLY_OPEN, ...STILL_A_PERSON]) {
      const before = alwaysAPerson(m, p, "agent-1", {});
      expect(alwaysAPerson(m, p, "agent-1", { leadApprovedWrites: false }), `${m} ${p}`).toEqual(before);
      // The answer the list gave before the lead-approved writes existed: the first matching rule, by its own test.
      const first = ALWAYS_A_PERSON.find((r) => r.test(m, p) && !(m === "GET" && r.mode !== "always"));
      expect(before?.key ?? null, `${m} ${p}`).toBe(first?.key ?? null);
    }
  });

  it("keeps every newly opened write refused but the role editor, which no rule ever named", () => {
    for (const [m, p] of NEWLY_OPEN) {
      const d = adminRequestDecision(m, p, listed([[m, p]]), "agent-1");
      if (p.startsWith("/api/org/role-edit/")) expect(d.ok && d.leadApproved, `${m} ${p}`).toBeFalsy();
      else expect(d, `${m} ${p}`).toMatchObject({ ok: false, code: "always_a_person" });
    }
  });

  it("refuses to save the seed list", () => {
    expect(parseAgentAdminPaths(seed).ok).toBe(false);
  });
});

describe("with the opt-in on", () => {
  it("opens each lead-approved route and marks it, through the seed list", () => {
    for (const [m, p] of NEWLY_OPEN) {
      const d = adminRequestDecision(m, p, seed, "agent-1", ON);
      expect(d, `${m} ${p}`).toMatchObject({ ok: true, write: true, confirm: "agent" });
      if (d.ok) expect(d.leadApproved, `${m} ${p}`).toBeTruthy();
    }
  });

  it("still refuses every person-only path, even when a list names it", () => {
    for (const [m, p] of STILL_A_PERSON) {
      expect(adminRequestDecision(m, p, listed([[m, p]]), "agent-1", ON), `${m} ${p}`).toMatchObject({ ok: false, code: "always_a_person" });
    }
  });

  it("saves the seed list, 88 paths, with every lead-approved write confirmed by the agent", () => {
    const r = parseAgentAdminPaths(seed, ON);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.paths).toHaveLength(88);
  });

  it("never lifts erasure, money, members, personal data, secrets, accounts or agents", () => {
    for (const e of LEAD_APPROVED_WRITES) for (const l of e.lifts) expect(LIFTABLE_RULES).toContain(l);
    expect(LIFTABLE_RULES).toEqual(["powers", "tier_c", "settings"]);
  });

  it("names only real wording variables that move no money, and none under agents.", () => {
    for (const k of AGENT_WORDING_VARIABLES) {
      const def = VARIABLES_BY_KEY[k];
      expect(def, k).toBeTruthy();
      expect(["boolean", "integer", "text"]).toContain(def.type);
      expect(["Ledger", "The Mint", "Gratitude"]).not.toContain(def.category);
      expect(k.startsWith("agents.")).toBe(false);
    }
    expect(VARIABLES_BY_KEY["agents.lead_approved_writes"]?.default).toBe("false");
  });
});

describe("the body half", () => {
  const plainSeat: LeadSeatFacts = { found: true, roleId: "r-gardener", isExample: false, capabilities: ["quest.consent", "org.seat"], grantsAdmin: false };
  const approval = { approvedBy: "The lead", approvalNote: "Yes, seat Ana as Gardener from today." };
  const seatPath = "/api/admin/org/roles/r-gardener/holders";

  it("lets a role card's words through and refuses money and powers by name", () => {
    expect(leadApprovedBodyProblem("role_text", "/api/admin/org/roles/r-1", { aim: "Tend the beds", accountabilities: ["a", "b", "c"], bookingUrl: "https://example.test/book", selectionCriteria: ["care"], accessBundle: ["drive"], conversations: [] })).toBeNull();
    for (const k of ["valueMinor", "valueTokens", "cashMinor", "budgetLine", "fundedFrom", "capabilities", "active", "expiresEachSeason"]) {
      expect(leadApprovedBodyProblem("role_text", "/api/admin/org/roles/r-1", { aim: "x", [k]: 1 }), k).toContain(k);
    }
    expect(leadApprovedBodyProblem("role_edit", "/api/org/role-edit/r-1", { words: { aim: "x" }, parameters: { bookingUrl: "https://example.test" } })).toBeNull();
    expect(leadApprovedBodyProblem("role_edit", "/api/org/role-edit/r-1", { pay: { kind: "cash" } })).toContain("pay");
    expect(leadApprovedBodyProblem("role_edit", "/api/org/role-edit/r-1", { parameters: { budgetLine: "ops" } })).toContain("parameters.budgetLine");
  });

  it("lets a draft carry the terms' wording and refuses their money groups and other ops", () => {
    const p = "/api/admin/org/drafts/d-1/changes";
    expect(leadApprovedBodyProblem("role_draft", p, { op: "update_seat", orgRoleId: "r-1", payload: { aim: "x", termsOffer: { v: 1, term: { words: "We renew together each moon." } } } })).toBeNull();
    for (const g of ["pay", "allowance", "bonus"]) {
      expect(leadApprovedBodyProblem("role_draft", p, { op: "update_seat", orgRoleId: "r-1", payload: { termsOffer: { v: 1, [g]: {} } } }), g).toContain(`termsOffer.${g}`);
    }
    expect(leadApprovedBodyProblem("role_draft", p, { op: "update_seat", orgRoleId: "r-1", payload: { valueMinor: 5 } })).toContain("valueMinor");
    expect(leadApprovedBodyProblem("role_draft", p, { op: "seat_holder", orgRoleId: "r-1", payload: {} })).toBeTruthy();
    expect(leadApprovedBodyProblem("role_draft", "/api/admin/org/drafts", { title: "Roles for the new season" })).toBeNull();
  });

  it("seats a person into a plain seat with the approval, and refuses without it", () => {
    expect(leadApprovedBodyProblem("seat", seatPath, { userId: "u-ana", ...approval }, { holderId: "agent-1", seat: plainSeat })).toBeNull();
    for (const body of [{ userId: "u-ana" }, { userId: "u-ana", approvedBy: "The lead" }, { userId: "u-ana", approvalNote: "yes please" }, { userId: "u-ana", approvedBy: " ", approvalNote: "yes please" }]) {
      expect(leadApprovedBodyProblem("seat", seatPath, body, { holderId: "agent-1", seat: plainSeat })).toContain("approvedBy");
    }
    expect(leadApprovedBodyProblem("unseat", "/api/admin/org/seatings/s-1", {}, { holderId: "agent-1", seat: { ...plainSeat, seatingUserId: "u-ana" } })).toContain("approvedBy");
  });

  it("refuses the veto seat, the break-glass seat, an ungrantable power and an admin-panel seat", () => {
    const ctx = (seat: Partial<LeadSeatFacts>) => ({ holderId: "agent-1", seat: { ...plainSeat, ...seat } });
    for (const capabilities of [["steward.veto"], ["ballot.vote", "steward.veto"], ["power.assign"], ["operator.secrets"], ["role.pay"], ["moon.approve"], ["brief.private"]]) {
      expect(leadApprovedBodyProblem("seat", seatPath, { userId: "u-ana", ...approval }, ctx({ capabilities })), capabilities.join()).toContain("badge may never carry");
      expect(leadApprovedBodyProblem("unseat", "/api/admin/org/seatings/s-1", approval, ctx({ capabilities, seatingUserId: "u-ana" })), capabilities.join()).toContain("badge may never carry");
    }
    expect(leadApprovedBodyProblem("seat", seatPath, { userId: "u-ana", ...approval }, ctx({ grantsAdmin: true }))).toContain("admin panel");
  });

  it("refuses an agent seat, the agent itself, an example and a seat that is not there", () => {
    const c = { holderId: "agent-1", seat: plainSeat };
    expect(leadApprovedBodyProblem("seat", seatPath, { isAgent: true, agentSlug: "sera", ...approval }, c)).toContain("agent");
    expect(leadApprovedBodyProblem("seat", seatPath, { userId: "agent-1", ...approval }, c)).toContain("itself");
    expect(leadApprovedBodyProblem("unseat", "/api/admin/org/seatings/s-1", approval, { holderId: "agent-1", seat: { ...plainSeat, seatingUserId: "agent-1" } })).toContain("itself");
    expect(leadApprovedBodyProblem("unseat", "/api/admin/org/seatings/s-1", approval, { holderId: "agent-1", seat: { ...plainSeat, seatingIsAgent: true } })).toContain("agent");
    expect(leadApprovedBodyProblem("seat", seatPath, { userId: "u-ana", ...approval }, { holderId: "agent-1", seat: { ...plainSeat, isExample: true } })).toContain("example");
    expect(leadApprovedBodyProblem("seat", seatPath, { userId: "u-ana", ...approval }, { holderId: "agent-1", seat: null })).toContain("no such");
  });
});

describe("pasting a list in the panel", () => {
  const current = [
    { method: "GET" as const, path: "/api/admin/member-tasks/access", confirm: "agent" as const, label: "Who has a task board" },
    { method: "PUT" as const, path: "/api/admin/faqs/:pathway", confirm: "person" as const, label: "FAQs" },
  ];

  it("adds new paths, changes a matching one, and never drops one already there", () => {
    const r = mergePastedAgentPaths(current, JSON.stringify({ paths: [
      { method: "PUT", path: "/api/admin/faqs/:pathway", confirm: "agent", label: "Replace a pathway's FAQs" },
      { method: "GET", path: "/api/admin/events", confirm: "agent", label: "Events" },
      { method: "GET", path: "/api/admin/events", confirm: "agent", label: "Events" },
    ] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.merged.map((e) => `${e.method} ${e.path} ${e.confirm}`)).toEqual([
      "GET /api/admin/member-tasks/access agent",
      "PUT /api/admin/faqs/:pathway agent",
      "GET /api/admin/events agent",
    ]);
    expect(r.plan.added).toHaveLength(1);
    expect(r.plan.changed).toHaveLength(1);
    expect(r.plan.changed[0].before.confirm).toBe("person");
  });

  it("refuses with the save parser's own reason, and refuses what is not JSON", () => {
    const bad = mergePastedAgentPaths(current, [{ method: "PUT", path: "/api/admin/integrations/:id", confirm: "agent", label: "x" }]);
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) expect(bad.error).toContain("Secrets and integration keys are always a person's act.");
    expect(mergePastedAgentPaths(current, "{paths:")).toMatchObject({ ok: false });
  });

  it("follows the opt-in: the seed merges with it on and is refused with it off", () => {
    expect(mergePastedAgentPaths(current, seed).ok).toBe(false);
    const on = mergePastedAgentPaths(current, seed, ON);
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.plan.merged).toHaveLength(88); // both paths on screen are on the seed list already
  });
});
