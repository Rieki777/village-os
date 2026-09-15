/**
 * The resources lib holds its promises: a map of rules that can never touch
 * the ledger (harm metric a, held by reading the source), tiers that keep
 * holders rules with their holders, sentences that answer the four
 * questions, and a pre-fill that rides the EXISTING decision primitive.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  amountWords,
  answerFourQuestions,
  budgetProblem,
  buildApprovalRequest,
  MEASURED_ACCOUNTS,
  measuredInflows,
  publicSources,
  requestKeyFor,
  ruleAppliesTo,
  ruleProblem,
  sourceProblem,
  unitProblem,
  upsertBudget,
  visibleRules,
  vocabulary,
  type CircleBudgetRow,
  type FundingSourceRow,
  type ResourcesViewer,
  type SpendingRuleRow,
} from "./resources";

const SOURCE = fs.readFileSync(path.resolve(__dirname, "resources.ts"), "utf8");

// ── Harm metric (a): no write path to the ledger or payments ────────────────

describe("the lib can never move value", () => {
  it("writes only the three declaration tables", () => {
    // Every INSERT / UPDATE / DELETE statement in the source names its table
    // on the same line as the verb; collect them all and hold the list.
    const verbs = SOURCE.match(/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+`?([a-z_]+)`?/g) ?? [];
    expect(verbs.length).toBeGreaterThan(0);
    for (const stmt of verbs) {
      expect(stmt).toMatch(/\b(spending_rules|funding_sources|circle_budgets)\b/);
    }
  });

  it("never calls the ledger's transfer functions", () => {
    expect(SOURCE.includes("postTransferPair")).toBe(false);
    expect(SOURCE.includes("postTransfer")).toBe(false);
  });

  it("reads fiat_charges and token_ledger by SELECT only", () => {
    for (const line of SOURCE.split("\n")) {
      if (/fiat_charges|token_ledger/.test(line)) {
        expect(line, `a measured read stays a read: ${line.trim()}`).not.toMatch(
          /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/,
        );
      }
    }
  });

  it("restricts the measured token read to the four system accounts", async () => {
    const seen: string[] = [];
    const fake = {
      query: async (sql: string, params?: unknown[]) => {
        seen.push(sql);
        if (/token_ledger/.test(sql)) {
          expect(params).toEqual([...MEASURED_ACCOUNTS]);
        }
        expect(sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
        return [[]];
      },
    } as any;
    const out = await measuredInflows(fake);
    expect(seen.length).toBe(3);
    expect(out.fiat).toEqual([]);
    expect(out.tokens).toEqual([]);
  });
});

// ── Units and validation ────────────────────────────────────────────────────

const knowsStayCredit = (slug: string) => slug === "stay-credit";

describe("units", () => {
  it("accepts ISO codes and registered tokens, refuses the rest with a sentence", () => {
    expect(unitProblem("CHF", knowsStayCredit)).toBeNull();
    expect(unitProblem("CRC", knowsStayCredit)).toBeNull();
    expect(unitProblem("token:stay-credit", knowsStayCredit)).toBeNull();
    expect(unitProblem("chf", knowsStayCredit)).toMatch(/three letter/);
    expect(unitProblem("token:unknown", knowsStayCredit)).toMatch(/No token called/);
    expect(unitProblem("", knowsStayCredit)).toBeTruthy();
  });
});

const baseRule = {
  scope: "circle",
  scopeId: "kitchen",
  amountMinor: 5000,
  unit: "CHF",
  approval: "none",
  paidFrom: "circle-budget",
};

describe("rule validation", () => {
  it("accepts the plain case", () => {
    expect(ruleProblem(baseRule, knowsStayCredit)).toBeNull();
  });

  it("requires the note that says what other means (R28)", () => {
    expect(ruleProblem({ ...baseRule, approval: "other" }, knowsStayCredit)).toMatch(/approvalNote/);
    expect(ruleProblem({ ...baseRule, approval: "other", approvalNote: "the elders" }, knowsStayCredit)).toBeNull();
    expect(ruleProblem({ ...baseRule, paidFrom: "other" }, knowsStayCredit)).toMatch(/note/);
    expect(ruleProblem({ ...baseRule, paidFrom: "other", note: "the festival jar" }, knowsStayCredit)).toBeNull();
  });

  it("refuses amounts that are not whole positive minor units", () => {
    expect(ruleProblem({ ...baseRule, amountMinor: 0 }, knowsStayCredit)).toBeTruthy();
    expect(ruleProblem({ ...baseRule, amountMinor: 12.5 }, knowsStayCredit)).toBeTruthy();
    expect(ruleProblem({ ...baseRule, amountMinor: -5 }, knowsStayCredit)).toBeTruthy();
  });

  it("refuses words outside the vocabulary", () => {
    expect(ruleProblem({ ...baseRule, approval: "manager" }, knowsStayCredit)).toMatch(/approval must be/);
    expect(ruleProblem({ ...baseRule, paidFrom: "wallet" }, knowsStayCredit)).toMatch(/paidFrom must be/);
    expect(ruleProblem({ ...baseRule, scope: "person" }, knowsStayCredit)).toMatch(/scope/);
  });
});

describe("source and budget validation", () => {
  it("holds funding sources to their vocabulary and the other note", () => {
    expect(sourceProblem({ name: "Stays", kind: "stays" }, knowsStayCredit)).toBeNull();
    expect(sourceProblem({ name: "X", kind: "other" }, knowsStayCredit)).toMatch(/note/);
    expect(sourceProblem({ name: "X", kind: "other", note: "the bakery" }, knowsStayCredit)).toBeNull();
    expect(sourceProblem({ name: "X", kind: "stays", sharePct: 140 }, knowsStayCredit)).toMatch(/percentage/);
    expect(
      sourceProblem({ name: "X", kind: "grants", amountMinorPerYear: 100000, unit: "CHF" }, knowsStayCredit),
    ).toBeNull();
    expect(sourceProblem({ name: "X", kind: "grants", amountMinorPerYear: 100000 }, knowsStayCredit)).toBeTruthy();
  });

  it("holds budgets to a circle, an amount and a unit", () => {
    expect(budgetProblem({ circleId: "kitchen", amountMinor: 120000, unit: "CHF" }, knowsStayCredit)).toBeNull();
    expect(budgetProblem({ circleId: "", amountMinor: 1, unit: "CHF" }, knowsStayCredit)).toBeTruthy();
    expect(budgetProblem({ circleId: "kitchen", amountMinor: 1, unit: "money" }, knowsStayCredit)).toBeTruthy();
  });
});

// ── Tiers (harm metric c) ───────────────────────────────────────────────────

const rules: SpendingRuleRow[] = [
  {
    id: "r-village",
    scope: "circle",
    scopeId: "kitchen",
    amountMinor: 5000,
    unit: "CHF",
    approval: "none",
    approvalNote: null,
    paidFrom: "circle-budget",
    visibility: "village",
    note: null,
    createdBy: null,
    isExample: false,
  },
  {
    id: "r-holders-kitchen",
    scope: "circle",
    scopeId: "kitchen",
    amountMinor: 50000,
    unit: "CHF",
    approval: "circle-consent",
    approvalNote: null,
    paidFrom: "treasury",
    visibility: "holders",
    note: null,
    createdBy: null,
    isExample: false,
  },
  {
    id: "r-holders-garden-role",
    scope: "role",
    scopeId: "seat-gardener",
    amountMinor: 2000,
    unit: "CHF",
    approval: "none",
    approvalNote: null,
    paidFrom: "circle-budget",
    visibility: "holders",
    note: null,
    createdBy: null,
    isExample: false,
  },
];

const viewer = (over: Partial<ResourcesViewer>): ResourcesViewer => ({
  userId: "u1",
  isAdmin: false,
  canDeclare: false,
  canRequest: true,
  heldRoleIds: [],
  circleIds: [],
  ...over,
});

describe("who sees which rules", () => {
  it("shows admins and declarers everything", () => {
    expect(visibleRules(rules, viewer({ isAdmin: true })).length).toBe(3);
    expect(visibleRules(rules, viewer({ canDeclare: true })).length).toBe(3);
  });

  it("shows a member village rules plus holders rules for their own seats", () => {
    const kitchenHolder = viewer({ circleIds: ["kitchen"] });
    expect(visibleRules(rules, kitchenHolder).map((r) => r.id)).toEqual(["r-village", "r-holders-kitchen"]);
    const gardener = viewer({ heldRoleIds: ["seat-gardener"] });
    expect(visibleRules(rules, gardener).map((r) => r.id)).toEqual(["r-village", "r-holders-garden-role"]);
    const plain = viewer({});
    expect(visibleRules(rules, plain).map((r) => r.id)).toEqual(["r-village"]);
  });

  it("shows a stranger no rules at all, and sources as name and kind only", () => {
    expect(visibleRules(rules, viewer({ userId: null }))).toEqual([]);
    const sources: FundingSourceRow[] = [
      {
        id: "s1",
        name: "Guest stays",
        kind: "stays",
        sharePct: 40,
        amountMinorPerYear: 1200000,
        unit: "CHF",
        note: "words",
        sortOrder: 1,
        isExample: false,
      },
    ];
    expect(publicSources(sources)).toEqual([{ name: "Guest stays", kind: "stays" }]);
  });

  it("applies role rules to role holders and circle rules to seat holders", () => {
    expect(ruleAppliesTo(rules[2], viewer({ heldRoleIds: ["seat-gardener"] }))).toBe(true);
    expect(ruleAppliesTo(rules[2], viewer({ circleIds: ["garden"] }))).toBe(false);
    expect(ruleAppliesTo(rules[1], viewer({ circleIds: ["kitchen"] }))).toBe(true);
  });
});

// ── Sentences ───────────────────────────────────────────────────────────────

const ctx = {
  circleName: (id: string) => (id === "kitchen" ? "the Kitchen" : id),
  roleName: (id: string) => (id === "seat-gardener" ? "Gardener" : id),
  moneyMethod: (id: string) => (id === "kitchen" ? "consent" : null),
};

describe("the four questions", () => {
  it("answers in the brief's shape: alone, with approval, the pots, the sources", () => {
    const budgets: CircleBudgetRow[] = [
      { id: "b1", circleId: "kitchen", seasonId: null, amountMinor: 120000, cycleAmountMinor: null, mode: "cap", pending: null, dormant: null, unit: "CHF", note: null, isExample: false },
    ];
    const sources: FundingSourceRow[] = [
      { id: "s1", name: "Stays", kind: "stays", sharePct: 40, amountMinorPerYear: null, unit: null, note: null, sortOrder: 1, isExample: false },
      { id: "s2", name: "Memberships", kind: "memberships", sharePct: null, amountMinorPerYear: 2000000, unit: "CHF", note: null, sortOrder: 2, isExample: false },
    ];
    const answers = answerFourQuestions(
      { rules, budgets, sources },
      viewer({ circleIds: ["kitchen"] }),
      ctx,
    );
    expect(answers.alone[0]).toContain("without asking");
    expect(answers.alone[0]).toContain("the Kitchen");
    expect(answers.withApproval.some((s) => s.includes("consent"))).toBe(true);
    expect(answers.withApproval.some((s) => s.includes("About money"))).toBe(true);
    expect(answers.paidFrom[0]).toContain("holds");
    expect(answers.comesFrom[0]).toContain("about 40%");
    expect(answers.comesFrom[1]).toContain("a year");
  });

  it("stays honest when nothing names the viewer", () => {
    const answers = answerFourQuestions({ rules, budgets: [], sources: [] }, viewer({}), ctx);
    expect(answers.alone[0]).toContain("No spending rule names a seat you hold yet");
    expect(answers.comesFrom[0]).toContain("No funding source is written down yet");
  });
});

describe("amounts as words", () => {
  it("formats ISO currencies through the shared formatter", () => {
    expect(amountWords(5000, "CHF")).toContain("50");
  });

  it("formats tokens by their registry name and decimals", () => {
    const words = (slug: string) => (slug === "stay-credit" ? { name: "Stay Credits", decimals: 0 } : undefined);
    expect(amountWords(3, "token:stay-credit", words)).toBe("3 Stay Credits");
    expect(amountWords(3, "token:mystery")).toBe("3 mystery");
  });
});

describe("the vocabulary and its overrides", () => {
  it("applies config.labels overrides by namespaced id (R29 P4)", () => {
    const v = vocabulary({ "approval.founders": "The elders", "sourceKind.stays": "Guest nights" });
    expect(v.approvals.find((a) => a.id === "founders")?.label).toBe("The elders");
    expect(v.sourceKinds.find((k) => k.id === "stays")?.label).toBe("Guest nights");
    expect(v.paidFrom.find((p) => p.id === "treasury")?.label).toBe("The village treasury");
  });
});

// ── The pre-fill ────────────────────────────────────────────────────────────

describe("buildApprovalRequest", () => {
  const categories = [{ id: "village-life" }, { id: "governance" }];

  it("builds a decision pre-fill carrying the resourcesRequest meta", () => {
    const prefill = buildApprovalRequest(rules[1], 20000, "a new oven", ctx, categories, "governance");
    expect(prefill.kind).toBe("decision");
    expect(prefill.category).toBe("governance");
    expect(prefill.title).toContain("Spending approval");
    expect(prefill.body).toContain("a new oven");
    expect(prefill.meta.resourcesRequest.ruleId).toBe("r-holders-kitchen");
    expect(prefill.meta.resourcesRequest.requestKey).toBe(requestKeyFor("r-holders-kitchen", 20000));
  });

  it("falls back to the forum's first category when the configured one is gone", () => {
    const prefill = buildApprovalRequest(rules[1], 20000, "a new oven", ctx, categories, "missing");
    expect(prefill.category).toBe("village-life");
  });
});

// ── The budget upsert dedupes the NULL season itself ────────────────────────

describe("upsertBudget", () => {
  it("updates the standing (no season) row instead of inserting a twin", async () => {
    const statements: string[] = [];
    const fake = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.startsWith("UPDATE circle_budgets")) return [{ affectedRows: 1 }];
        if (sql.startsWith("SELECT id FROM circle_budgets")) return [[{ id: "b-existing" }]];
        return [{ affectedRows: 1 }];
      },
    } as any;
    const id = await upsertBudget(fake, { circleId: "kitchen", amountMinor: 100, unit: "CHF" }, "u1");
    expect(id).toBe("b-existing");
    expect(statements.some((s) => s.startsWith("INSERT INTO circle_budgets"))).toBe(false);
  });
});
