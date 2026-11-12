/**
 * Proposed changes, the pure half: what may never be proposed, how a proposal is read, the lessons, and the
 * coverage promise (every setting a village admin can change has a proposal kind).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  fieldDiffs,
  groupLessons,
  mergeOnto,
  neverProposed,
  proposalNever,
  readProposalInput,
  routeOf,
  SETTING_PREFIXES,
  variableNever,
} from "./proposedChanges";
import { adminRequestDecision, parseAgentAdminPaths } from "./agentAdmin";
import { VARIABLES } from "./gameVariables";
import { MODULES } from "./modules";
import { PAGE_SPECS, pageSectionKey } from "./pageContent";

const read = (raw: unknown) => {
  const r = readProposalInput(raw);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("never proposable, refused with a plain reason", () => {
  const cases: Array<[string, string, string, Record<string, unknown>?]> = [
    ["secrets", "PUT", "/api/admin/integrations/resend"],
    ["secrets", "PUT", "/api/admin/secrets/stripe"],
    ["erasure", "POST", "/api/admin/members/u-1/anonymize"],
    ["agents", "POST", "/api/admin/agent-accounts"],
    ["agents", "POST", "/api/admin/proposals/accept"],
    ["powers", "POST", "/api/admin/badges/grant"],
    ["powers", "PUT", "/api/admin/capabilities/x"],
    ["money", "POST", "/api/admin/payouts/run"],
    ["money", "POST", "/api/admin/treasury/move"],
    ["money", "POST", "/api/admin/invoices"],
    ["seating", "POST", "/api/admin/org/roles/r-1/holders"],
    ["seating", "DELETE", "/api/admin/org/seatings/s-1"],
    ["sending", "POST", "/api/admin/comms/letters/l-1/send"],
    ["sending", "POST", "/api/admin/invites"],
    ["legal", "PUT", "/api/admin/modules/library/config", { creditSaleAck: { cardVersion: "1" } }],
  ];
  for (const [key, method, p, body] of cases) {
    it(`${method} ${p} is ${key}`, () => {
      expect(neverProposed(method, p, body ?? {})?.key).toBe(key);
    });
  }

  it("a seating's focus and note may be proposed; its holder may not", () => {
    expect(neverProposed("PATCH", "/api/admin/org/seatings/s-1", { focus: "Water", note: "Spring" })).toBeNull();
    expect(neverProposed("PATCH", "/api/admin/org/seatings/s-1", { userId: "u-2" })?.key).toBe("seating");
  });

  it("a page or a role whose name reads like a power or money is still words", () => {
    expect(proposalNever(read({ kind: "page_content", target: { section: "page-journey-steward" }, body: {}, summary: "Reword the steward page." }))).toBeNull();
    expect(proposalNever(read({ kind: "role_card", target: { roleId: "payroll-treasury-steward" }, body: { words: {} }, summary: "Reword it." }))).toBeNull();
  });

  it("a sealed or agent-governing variable is refused; the rest are open", () => {
    expect(variableNever({ key: "tokens.base_rpc_url", movedToSecret: "x" })?.key).toBe("secrets");
    expect(variableNever({ key: "agents.lead_approved_writes" })?.key).toBe("agents");
    expect(variableNever({ key: "org.applicant_reply_days" })).toBeNull();
  });

  it("control: with the money rule's words gone, a payout would be proposable", () => {
    // The break-the-fix control: a payout path passes only the money rule's test.
    expect(neverProposed("POST", "/api/admin/payouts/run", {})?.key).toBe("money");
    expect(neverProposed("POST", "/api/admin/brand", {})).toBeNull();
  });
});

describe("reading a proposal", () => {
  it("a setting that names a known route becomes that kind, so its own validator runs", () => {
    expect(read({ kind: "setting", target: { method: "PUT", path: "/api/admin/variables/org.ccos_terms" }, body: { value: "x" }, summary: "Set the terms words." }).kind).toBe("variable");
    expect(read({ kind: "setting", target: { method: "PUT", path: "/api/admin/modules/events/config" }, body: { config: { a: 1 } }, summary: "Tune events." })).toMatchObject({ kind: "module_config", body: { a: 1 } });
    expect(read({ target: { method: "PUT", path: "/api/admin/brand" }, body: { tagline: "x" }, summary: "A new tagline." }).kind).toBe("setting");
  });

  it("refuses a route outside the admin settings, a missing summary, and a body that is not an object", () => {
    expect(readProposalInput({ kind: "setting", target: { method: "POST", path: "/api/auth/login" }, summary: "Sign in." }).ok).toBe(false);
    expect(readProposalInput({ kind: "variable", target: { key: "a" }, body: { value: 1 } }).ok).toBe(false);
    expect(readProposalInput({ kind: "variable", target: { key: "a" }, body: [1], summary: "Set it." }).ok).toBe(false);
  });

  it("a known kind's route is filled from its target", () => {
    expect(routeOf("faq_remove", { pathway: "steward", id: "ste-1" })).toMatchObject({ method: "DELETE", path: "/api/admin/faqs/steward/ste-1" });
  });

  it("merges proposed fields onto what is live, lists replaced whole", () => {
    expect(mergeOnto({ hero: { headline: "A", badge: "B" }, list: [1, 2] }, { hero: { headline: "C" }, list: [3] })).toEqual({ hero: { headline: "C", badge: "B" }, list: [3] });
  });
});

describe("the connector cannot accept", () => {
  it("accept and discard are always a person's act, even on the agent paths list", () => {
    const doc = { paths: [{ method: "POST" as const, path: "/api/admin/proposals/accept", confirm: "agent" as const, label: "x" }] };
    expect(adminRequestDecision("POST", "/api/admin/proposals/accept", doc)).toMatchObject({ ok: false, code: "always_a_person" });
    expect(adminRequestDecision("POST", "/api/admin/proposals/discard", doc)).toMatchObject({ ok: false, code: "always_a_person" });
    expect(parseAgentAdminPaths(doc).ok).toBe(false);
  });
});

describe("lessons: what a person changed", () => {
  it("records each edited field, and nothing for a field left as proposed", () => {
    const proposed = { words: { aim: "Hold the money.", domain: "Finance" }, parameters: { languages: ["en"] } };
    const accepted = { words: { aim: "Hold the village's money with care.", domain: "Finance" }, parameters: { languages: ["en", "es"] } };
    expect(fieldDiffs(proposed, accepted)).toEqual([
      { field: "words.aim", proposed: "Hold the money.", accepted: "Hold the village's money with care." },
      { field: "parameters.languages", proposed: ["en"], accepted: ["en", "es"] },
    ]);
    expect(fieldDiffs(proposed, proposed)).toEqual([]);
  });

  it("groups by kind and field, newest first", () => {
    const l = (field: string, at: string) => ({ proposalId: at, kind: "faq_edit" as const, target: "FAQ", summary: "s", field, proposed: "a", accepted: "b", acceptedAt: at });
    const g = groupLessons([l("goals.0.text", "2026-01-01"), l("goals.1.text", "2026-02-01"), l("answer", "2026-01-05")]);
    expect(g[0].kind).toBe("faq_edit");
    expect(g[0].fields.find((f) => f.field === "goals.n.text")!.changes.map((c) => c.acceptedAt)).toEqual(["2026-02-01", "2026-01-01"]);
  });
});

// ── Coverage: every Admin-editable setting has a proposal kind ───────────────

const ROOT = path.resolve(__dirname, "..");

describe("every setting an admin can change has a proposal kind", () => {
  it("every variable in the registry is proposable, or refused for a named reason", () => {
    for (const v of VARIABLES) {
      const p = read({ kind: "variable", target: { key: v.key }, body: { value: v.default }, summary: "Set it." });
      expect(proposalNever(p), v.key).toBeNull();
      const n = variableNever(v);
      if (n) expect(["secrets", "agents"], v.key).toContain(n.key);
    }
  });

  it("every module's lifecycle and settings are proposable", () => {
    for (const m of MODULES) {
      expect(proposalNever(read({ kind: "module_lifecycle", target: { id: m.id }, body: { lifecycle: "members" }, summary: "Turn it on." })), m.id).toBeNull();
      expect(proposalNever(read({ kind: "module_config", target: { id: m.id }, body: {}, summary: "Tune it." })), m.id).toBeNull();
    }
  });

  it("every page, the training pages among them, is proposable", () => {
    for (const spec of PAGE_SPECS) {
      expect(proposalNever(read({ kind: "page_content", target: { section: pageSectionKey(spec) }, body: {}, summary: "Reword it." })), spec.id).toBeNull();
    }
  });

  /** Every admin write route the server registers, with each parameter filled. */
  function serverWriteRoutes(): Array<{ method: string; path: string; re: RegExp }> {
    const files = [path.join(ROOT, "server/index.ts"), ...fs.readdirSync(path.join(ROOT, "server/routes")).filter((f) => f.endsWith(".ts") && !f.includes(".test.")).map((f) => path.join(ROOT, "server/routes", f))];
    const out: Array<{ method: string; path: string; re: RegExp }> = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/app\.(put|post|patch|delete)\(\s*["`](\/api\/[^"`]+)["`]/g)) {
        const pattern = m[2];
        const concrete = pattern.replace(/:[A-Za-z]+/g, "x").replace(/\$\{[^}]+\}/g, "x");
        const re = new RegExp(`^${pattern.replace(/[.]/g, "\\.").replace(/:[A-Za-z]+/g, "[^/]+").replace(/\$\{[^}]+\}/g, "[^/]+")}$`);
        out.push({ method: m[1].toUpperCase(), path: concrete, re });
      }
    }
    return out;
  }

  it("every admin write route reads as a proposal kind, or as a named never", () => {
    const routes = serverWriteRoutes().filter((r) => r.path.startsWith("/api/admin/"));
    expect(routes.length).toBeGreaterThan(100);
    const kinds = new Set<string>();
    for (const r of routes) {
      const p = readProposalInput({ kind: "setting", target: { method: r.method, path: r.path }, body: {}, summary: "A change." });
      expect(p.ok, `${r.method} ${r.path}`).toBe(true);
      if (!p.ok) continue;
      kinds.add(p.value.kind);
      const never = proposalNever(p.value);
      if (never) expect(never.words.length, r.path).toBeGreaterThan(10);
    }
    // The routes with their own validator are recognised as their kind.
    for (const k of ["page_content", "variable", "faq_add", "faq_remove", "module_lifecycle", "module_config", "role_listing", "onboarding_path", "setting"]) expect(kinds, k).toContain(k);
  });

  /**
   * Admin's own write paths outside /api/admin: each is under a settings prefix, or named here as not a setting with
   * the reason. A NEW one fails this test until it is given a kind or a reason.
   */
  const NOT_A_SETTING: Record<string, string> = {
    "/api/auth/google/start": "signing in",
    "/api/cash-owed/transfers": "moving value",
    "/api/confidentiality": "a person's own signature",
    "/api/map/draft": "the map's own draft, published by its own door",
    "/api/needs/scope": "a read",
    "/api/quests/pay-options": "money",
    "/api/quests/x/pay": "money",
    "/api/saberra/sync": "a sync run, not a setting",
    "/api/saberra/outbox": "a sync queue, not a setting",
    "/api/uploads/x": "a file upload",
    "/api/events/x": "a gathering, edited on its own page",
    "/api/forum/threads/x/moderate": "moderating a member's post",
    "/api/saberra/quest-feed": "a sync run with the organisational memory",
    "/api/saberra/links/x": "linking a member to the organisational memory, a member's record",
    "/api/saberra/person-match/backfill": "a sync run with the organisational memory",
    "/api/member-tasks/me/feedback": "a member's own feedback",
  };

  it("every write path Admin calls outside /api/admin is a settings prefix or named as not a setting", () => {
    const routes = serverWriteRoutes();
    const adminFiles = [path.join(ROOT, "client/src/pages/Admin.tsx"), ...fs.readdirSync(path.join(ROOT, "client/src/components/admin")).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test.")).map((f) => path.join(ROOT, "client/src/components/admin", f))];
    const used = new Set<string>();
    for (const f of adminFiles) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:\$\{API_BASE\}|["'`]\/api)(\/[A-Za-z0-9_\-/.]*(?:\$\{[^}]+\}[A-Za-z0-9_\-/.]*)*)/g)) {
        const p = `/api${m[1].replace(/\$\{[^}]+\}/g, "x")}`.replace(/\/$/, "");
        if (p.startsWith("/api/admin/") || p === "/api/admin") continue;
        if (routes.some((r) => r.re.test(p))) used.add(p);
      }
    }
    const uncovered = Array.from(used).filter((p) => !SETTING_PREFIXES.some((pre) => p.startsWith(pre) || p === pre.replace(/\/$/, "")) && !(p in NOT_A_SETTING));
    expect(uncovered).toEqual([]);
  });
});
