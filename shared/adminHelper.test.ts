import { describe, expect, it } from "vitest";
import { VARIABLES, VARIABLES_BY_KEY } from "./gameVariables";
import { buildProposal, cleanTabs, mayPropose, proposalRefusal, queryWords, searchAdmin, type HelperDial } from "./adminHelper";

const dials: HelperDial[] = VARIABLES.map((v) => ({
  key: v.key, label: v.label, category: v.category, description: v.description, type: v.type, value: v.default, isDefault: true,
}));

describe("cleanTabs", () => {
  it("keeps only real tab keys with a label, once each, and bounds the list", () => {
    const tabs = cleanTabs([
      { key: "players", label: "Players", group: "Who runs this village", help: "Everyone" },
      { key: "players", label: "Again" },
      { key: "javascript:alert(1)", label: "Bad" },
      { key: "no-label" },
      "junk",
    ]);
    expect(tabs).toEqual([{ key: "players", label: "Players", group: "Who runs this village", help: "Everyone" }]);
    expect(cleanTabs(Array.from({ length: 500 }, (_, i) => ({ key: `t-${i}`, label: "x" }))).length).toBe(200);
    expect(cleanTabs("nope")).toEqual([]);
  });
});

describe("money stays manual", () => {
  it("refuses every dial in a money category, and every key that names money", () => {
    for (const v of VARIABLES) {
      if (["Ledger", "The Mint", "Tokens", "Payments", "Exchange"].includes(v.category)) expect(mayPropose(v), v.key).toBe(false);
      if (/pay|price|cash|budget|redeem|redemption/i.test(v.key)) expect(mayPropose(v), v.key).toBe(false);
      if (v.movedToSecret) expect(mayPropose(v), v.key).toBe(false);
    }
    expect(proposalRefusal(undefined)).toContain("not a setting");
  });

  it("still leaves plenty an admin can be helped with", () => {
    expect(VARIABLES.filter((v) => mayPropose(v)).length).toBeGreaterThan(50);
  });
});

describe("buildProposal", () => {
  it("is null when there is nothing proposed", () => {
    expect(buildProposal(null, () => undefined)).toBeNull();
    expect(buildProposal({ why: "x" }, () => undefined)).toBeNull();
  });

  it("reads the current value it is handed, not the default", () => {
    const v = VARIABLES.find((d) => d.type === "boolean" && mayPropose(d))!;
    const out = buildProposal({ key: v.key, value: "true" }, () => "false");
    expect(out).toMatchObject({ ok: true, proposal: { from: "false", to: "true" } });
    expect(VARIABLES_BY_KEY[v.key]).toBeTruthy();
  });
});

describe("searchAdmin", () => {
  it("ranks pages and settings by the question's own words", () => {
    const tabs = cleanTabs([
      { key: "players", label: "Players", group: "Who runs this village", help: "Everyone in the village" },
      { key: "org-chart", label: "Org Chart", group: "Who runs this village", help: "Roles and who holds them" },
    ]);
    const out = searchAdmin("where is the org chart with roles", tabs, dials);
    expect(out.pages[0].key).toBe("org-chart");
    expect(queryWords("How do I change the settings?")).toEqual([]);
  });

  it("marks which settings may be proposed and withholds a credential-shaped value", () => {
    const withheld = VARIABLES.find((v) => v.withheld);
    const out = searchAdmin("calendar hemisphere moon", [], dials);
    expect(out.settings.length).toBeGreaterThan(0);
    for (const s of out.settings) expect(typeof s.proposable).toBe("boolean");
    if (withheld) {
      const hit = searchAdmin(withheld.label, [], dials.map((d) => (d.key === withheld.key ? { ...d, value: "https://x.example/v2/abcdef0123456789abcdef0123456789" } : d)));
      const row = hit.settings.find((s) => s.key === withheld.key);
      if (row) expect(row.value).toContain("withheld");
    }
  });
});
