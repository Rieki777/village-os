/**
 * Which admin paths an agent may call (addendum v6, B6). What each case pins:
 *
 *   allow-list  the shipped Operations paths open; a new admin path is closed
 *               until a person adds it; who confirms comes from the entry
 *   check 53    every "always a person" item is refused, against the real
 *               admin paths that carry it, even when the list names it, and a
 *               list naming one is refused when it is saved
 *   paths       dots, doubled slashes and foreign prefixes are refused, and
 *               the agent's own account is never a subject
 */
import { describe, expect, it } from "vitest";
import { adminRequestDecision, DEFAULT_AGENT_ADMIN_PATHS, effectiveAgentAdminPaths, parseAgentAdminPaths, pathMatches, type AgentAdminPathsDoc } from "./agentAdmin";

const SHIPPED = DEFAULT_AGENT_ADMIN_PATHS;

describe("the allow-list", () => {
  it("opens the shipped Operations paths, and the agent confirms them", () => {
    for (const [m, p] of [
      ["GET", "/api/admin/member-tasks/access"],
      ["PUT", "/api/admin/member-tasks/access/u-123"],
      ["GET", "/api/admin/member-tasks/bridge"],
      ["POST", "/api/admin/member-tasks/bridge/sync"],
      ["GET", "/api/moon-review/rhythm"],
      ["PUT", "/api/moon-review/rhythm"],
    ] as const) {
      const d = adminRequestDecision(m, p, SHIPPED, "agent-1");
      expect(d.ok, `${m} ${p}`).toBe(true);
      if (d.ok) expect(d.confirm).toBe("agent");
    }
  });

  it("keeps a new admin route closed until a person adds it", () => {
    const d = adminRequestDecision("POST", "/api/admin/some-new-thing", SHIPPED, "agent-1");
    expect(d).toMatchObject({ ok: false, code: "not_allowed" });
    const wrongMethod = adminRequestDecision("DELETE", "/api/admin/member-tasks/access/u-1", SHIPPED, "agent-1");
    expect(wrongMethod).toMatchObject({ ok: false, code: "not_allowed" });
  });

  it("makes an added write a person's to confirm unless it says otherwise", () => {
    const parsed = parseAgentAdminPaths({ paths: [{ method: "POST", path: "/api/admin/events", label: "Put a gathering on the calendar" }] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.paths[0].confirm).toBe("person");
    const d = adminRequestDecision("POST", "/api/admin/events", parsed.value, "agent-1");
    expect(d).toMatchObject({ ok: true, write: true, confirm: "person" });
  });

  it("reads a broken stored list as the shipped one", () => {
    expect(effectiveAgentAdminPaths(null)).toEqual(SHIPPED);
    expect(effectiveAgentAdminPaths({ paths: "nope" })).toEqual(SHIPPED);
  });

  it("matches one segment per :name and nothing more", () => {
    expect(pathMatches("/api/admin/member-tasks/access/:userId", "/api/admin/member-tasks/access/u-1")).toBe(true);
    expect(pathMatches("/api/admin/member-tasks/access/:userId", "/api/admin/member-tasks/access/u-1/more")).toBe(false);
    expect(pathMatches("/api/admin/member-tasks/access/:userId", "/api/admin/member-tasks/access")).toBe(false);
  });
});

describe("always a person (check 53)", () => {
  // Real admin paths on the platform, one or more per item on the list.
  const CASES: Array<[string, string, string]> = [
    ["erasure", "DELETE", "/api/admin/players/u-9"],
    ["powers", "PUT", "/api/admin/capabilities/moon.approve/holding"],
    ["powers", "DELETE", "/api/admin/capabilities/cash.pay/holding"],
    ["powers", "POST", "/api/admin/badges/b-1/award"],
    ["powers", "PUT", "/api/admin/power-affinity/governance"],
    ["powers", "PUT", "/api/admin/roles/r-1/capabilities"],
    ["powers", "PUT", "/api/admin/roles/r-1/admin-access"],
    ["powers", "POST", "/api/admin/org/roles/r-1/holders"],
    ["money", "PUT", "/api/moon-review/payers"],
    ["money", "PUT", "/api/moon-review/settings"],
    ["money", "POST", "/api/moon-review/invoices/i-1/approve"],
    ["money", "POST", "/api/admin/cycles/settlement-proposal"],
    ["money", "POST", "/api/admin/tokens/seed/mint"],
    ["money", "POST", "/api/admin/exchange/tokens/seed/price"],
    ["secrets", "PUT", "/api/admin/integrations/stripe"],
    ["accounts", "PUT", "/api/admin/users/u-9/role"],
    ["accounts", "POST", "/api/admin/users/u-9/revoke-sessions"],
    ["agents", "PUT", "/api/admin/players/u-9/agent"],
    ["agents", "PUT", "/api/admin/agent-admin-paths"],
    ["agents", "GET", "/api/admin/agent-actions"],
    // Widened after the adversarial reviews: each a real route the first list let through.
    ["money", "POST", "/api/admin/mint-requests/m-1/approve"],
    ["money", "POST", "/api/admin/products/purchases/p-1/confirm"],
    ["money", "POST", "/api/admin/resources/budgets/b-2/spend"],
    ["money", "PATCH", "/api/admin/economy/rules/e-1"],
    ["powers", "POST", "/api/admin/org/drafts/d-1/publish"],
    ["powers", "PUT", "/api/admin/governance/rules"],
    ["members", "POST", "/api/admin/exits/x-1/resolve"],
    ["members", "PUT", "/api/admin/exit-policy"],
    ["members", "POST", "/api/admin/join-requests/j-1/approve"],
    ["settings", "PUT", "/api/admin/email-config"],
    ["settings", "PUT", "/api/admin/settings"],
    ["settings", "PUT", "/api/admin/variables/membership.invite_only"],
    ["settings", "PUT", "/api/admin/modules/m-2/config"],
    ["settings", "POST", "/api/admin/comms/run"],
  ];

  it("refuses each item through the shipped list", () => {
    for (const [key, m, p] of CASES) {
      const d = adminRequestDecision(m, p, SHIPPED, "agent-1");
      expect(d, `${m} ${p}`).toMatchObject({ ok: false, code: "always_a_person" });
      if (!d.ok) expect(d.words.length).toBeGreaterThan(10);
      expect(key).toBeTruthy();
    }
  });

  it("refuses each item even when a list names it", () => {
    const everything: AgentAdminPathsDoc = { paths: CASES.map(([, m, p]) => ({ method: m as any, path: p, confirm: "agent", label: "x" })) };
    for (const [, m, p] of CASES) expect(adminRequestDecision(m, p, everything, "agent-1")).toMatchObject({ ok: false, code: "always_a_person" });
  });

  it("refuses to save a list that names one", () => {
    for (const [, m, p] of CASES) {
      const r = parseAgentAdminPaths({ paths: [{ method: m, path: p.replace(/u-9|r-1|b-1|i-1|seed|stripe|governance/g, ":id"), confirm: "agent", label: "x" }] });
      expect(r.ok, `${m} ${p}`).toBe(false);
    }
  });

  it("never lets an agent act on its own account", () => {
    const own: AgentAdminPathsDoc = { paths: [{ method: "PUT", path: "/api/admin/member-tasks/access/:userId", confirm: "agent", label: "x" }] };
    expect(adminRequestDecision("PUT", "/api/admin/member-tasks/access/agent-1", own, "agent-1")).toMatchObject({ ok: false, code: "always_a_person" });
  });
});

describe("paths", () => {
  it("refuses a query string or a fragment, and never trims one off", () => {
    for (const p of ["/api/admin/member-tasks/access?userId=u-9", "/api/admin/member-tasks/access#x", "/api/moon-review/rhythm?cycle=2026-10"]) {
      expect(adminRequestDecision("GET", p, SHIPPED, "agent-1"), p).toMatchObject({ ok: false, code: "bad_path" });
    }
  });

  it("refuses to save a pattern that stands for many routes", () => {
    for (const path of ["/api/admin/:area", "/api/admin/:area/:id", "/api/:anything/rhythm", "/api/admin/member-tasks/:a/:b/:c"]) {
      expect(parseAgentAdminPaths({ paths: [{ method: "GET", path, confirm: "person", label: "x" }] }).ok, path).toBe(false);
    }
    expect(parseAgentAdminPaths({ paths: SHIPPED.paths }).ok).toBe(true);
  });

  it("refuses anything that is not a plain /api/ path", () => {
    for (const p of ["/api/admin/../agent/tokens", "/api/admin//member-tasks/access", "/health", "api/admin/member-tasks/access", "/api/admin/member-tasks/access/%2e%2e"]) {
      expect(adminRequestDecision("GET", p, SHIPPED, "agent-1"), p).toMatchObject({ ok: false });
    }
  });
});

describe("reads of what a person alone changes (part B)", () => {
  const listed = (...entries: Array<[string, string]>): AgentAdminPathsDoc => ({
    paths: entries.map(([method, path]) => ({ method: method as any, path, confirm: "agent", label: "x" })),
  });

  it("answers an allow-listed GET of an org draft, expiring roles and settings", () => {
    const doc = listed(["GET", "/api/admin/org/drafts"], ["GET", "/api/admin/org/drafts/:id/preview"], ["GET", "/api/admin/org/expiring"], ["GET", "/api/admin/settings"], ["GET", "/api/admin/variables/:key"], ["GET", "/api/admin/modules/:id/config"]);
    for (const p of ["/api/admin/org/drafts", "/api/admin/org/drafts/d-1/preview", "/api/admin/org/expiring", "/api/admin/settings", "/api/admin/variables/org.start_after_open", "/api/admin/modules/m-1/config"]) {
      expect(adminRequestDecision("GET", p, doc, "agent-1"), p).toMatchObject({ ok: true, write: false });
    }
  });

  it("keeps a GET closed until a person lists it", () => {
    expect(adminRequestDecision("GET", "/api/admin/org/drafts", SHIPPED, "agent-1")).toMatchObject({ ok: false, code: "not_allowed" });
  });

  it("still refuses every write in the powers, members, settings and letters categories, listed or not", () => {
    const WRITES: Array<[string, string]> = [
      ["POST", "/api/admin/org/drafts"],
      ["POST", "/api/admin/org/drafts/d-1/changes"],
      ["PUT", "/api/admin/org/drafts/d-1/vision"],
      ["POST", "/api/admin/org/drafts/d-1/publish"],
      ["PUT", "/api/admin/settings"],
      ["PUT", "/api/admin/variables/org.start_after_open"],
      ["PUT", "/api/admin/modules/m-1/lifecycle"],
      ["POST", "/api/admin/letters/send"],
      ["POST", "/api/admin/letter-drafts/l-1/send"],
      ["POST", "/api/admin/invites"],
      ["POST", "/api/admin/exits/x-1/resolve"],
      ["POST", "/api/admin/join-requests/j-1/approve"],
      ["PUT", "/api/admin/roles/r-1/capabilities"],
      ["POST", "/api/admin/org/roles/r-1/holders"],
    ];
    for (const [m, p] of WRITES) {
      const doc: AgentAdminPathsDoc = { paths: [{ method: m as any, path: p.replace(/\/(d|m|l|x|j|r)-1/g, "/:id"), confirm: "agent", label: "x" }] };
      expect(adminRequestDecision(m, p, doc, "agent-1", { applicantDataOpen: true }), `${m} ${p}`).toMatchObject({ ok: false, code: "always_a_person" });
    }
  });

  it("keeps reads closed for secrets, integration keys, agent accounts and tokens, listed or not", () => {
    for (const p of ["/api/admin/integrations/stripe", "/api/admin/secrets", "/api/admin/api-keys", "/api/admin/agent-accounts", "/api/admin/agent-actions", "/api/admin/agent-admin-paths", "/api/admin/ai-agents-approval"]) {
      const doc = listed(["GET", p]);
      expect(adminRequestDecision("GET", p, doc, "agent-1", { applicantDataOpen: true }), p).toMatchObject({ ok: false, code: "always_a_person" });
    }
  });

  it("keeps pay, terms and money reads closed", () => {
    for (const p of ["/api/admin/role-pay/r-1", "/api/admin/org/roles/r-1/terms", "/api/moon-review/invoices"]) {
      expect(adminRequestDecision("GET", p, listed(["GET", p.replace("r-1", ":id")]), "agent-1", { applicantDataOpen: true }), p).toMatchObject({ ok: false, code: "always_a_person" });
    }
  });

  it("closes a GET of applicant and member data while the Anchor switch is off, and answers it after", () => {
    const PERSONAL = ["/api/admin/open-proposals", "/api/admin/join-requests", "/api/governance/applications/a-1/scorecards", "/api/admin/players", "/api/admin/members/u-3"];
    for (const p of PERSONAL) {
      const doc = listed(["GET", p.replace(/\/(a|u)-\d/, "/:id")]);
      expect(adminRequestDecision("GET", p, doc, "agent-1"), `${p} off`).toMatchObject({ ok: false, code: "always_a_person" });
      expect(adminRequestDecision("GET", p, doc, "agent-1", { applicantDataOpen: false }), `${p} off`).toMatchObject({ ok: false, code: "always_a_person" });
      expect(adminRequestDecision("GET", p, doc, "agent-1", { applicantDataOpen: true }), `${p} on`).toMatchObject({ ok: true, write: false });
    }
  });

  it("still refuses every write on applicant and member data once the switch is on", () => {
    for (const [m, p] of [["PUT", "/api/admin/open-proposals/settings"], ["POST", "/api/admin/open-proposals/links"], ["POST", "/api/admin/join-requests/j-1/approve"], ["POST", "/api/governance/applications/a-1/interviews/3/score"], ["PUT", "/api/admin/players/u-3"], ["DELETE", "/api/admin/members/u-3"]] as const) {
      const doc: AgentAdminPathsDoc = { paths: [{ method: m, path: p.replace(/\/(a|j|u)-\d/g, "/:id").replace(/\/3\//, "/:n/"), confirm: "agent", label: "x" }] };
      expect(adminRequestDecision(m, p, doc, "agent-1", { applicantDataOpen: true }), `${m} ${p}`).toMatchObject({ ok: false, code: "always_a_person" });
    }
  });

  it("saves a list that reads org drafts or applicant data, and refuses one that reads a secret or writes either", () => {
    expect(parseAgentAdminPaths({ paths: [{ method: "GET", path: "/api/admin/org/drafts", label: "Drafts" }] }).ok).toBe(true);
    expect(parseAgentAdminPaths({ paths: [{ method: "GET", path: "/api/admin/open-proposals", label: "Proposals" }] }).ok).toBe(true);
    expect(parseAgentAdminPaths({ paths: [{ method: "GET", path: "/api/admin/integrations/stripe", label: "x" }] }).ok).toBe(false);
    expect(parseAgentAdminPaths({ paths: [{ method: "POST", path: "/api/admin/open-proposals/links", label: "x" }] }).ok).toBe(false);
    expect(parseAgentAdminPaths({ paths: [{ method: "POST", path: "/api/admin/org/drafts", label: "x" }] }).ok).toBe(false);
  });
});
