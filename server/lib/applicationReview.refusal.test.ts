/**
 * NO AI IN SELECTION (role journey L5, Rye's rule): no companion, guide, agent
 * or Sera tool reads an application, a score, an interview note or the terms
 * on one. Each case below has a control that fails for the reason claimed.
 *
 * Two kinds of proof, because one alone can lie:
 *  - behaviour: the tool tables and the admin-path rule refuse the reads;
 *  - structure: no source a model can reach names the review tables or doors,
 *    and the review's own files import no model client.
 * The structural scan is itself tested on planted text, so an empty result
 * means the scan looked, not that it was blind.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SELECTION_IS_HUMAN } from "../../shared/applicationReview";
import { adminRequestDecision, DEFAULT_AGENT_ADMIN_PATHS } from "../../shared/agentAdmin";
import { MCP_TOOLS } from "./agentMcp";
import { runSeraTool, SERA_TOOLS, type SeraActor } from "./seraAgent";

const ROOT = path.resolve(__dirname, "..", "..");

/** What a model-facing source must never name. */
const FORBIDDEN = [...SELECTION_IS_HUMAN, "applicationReview", "scorecards", "/applications/", "interviewer_roles", "selection_criteria"];

export function namesForbidden(source: string): string[] {
  return FORBIDDEN.filter((f) => source.includes(f));
}

/** Every file a companion, the guide, an agent token or Sera can run through. */
const MODEL_FACING = [
  "server/lib/companions.ts",
  "server/lib/companionSera.ts",
  "server/lib/roleGuide.ts",
  "server/lib/roleGuideContext.ts",
  "server/lib/saberraGuide.ts",
  "server/lib/seraAgent.ts",
  "server/lib/agentMcp.ts",
  "server/lib/agentInbox.ts",
  "server/lib/agentProfile.ts",
  "shared/companionItems.ts",
  "shared/agentAdmin.ts",
  "shared/seraBridgeBoard.ts",
];

describe("the scan sees what it is told to look for", () => {
  it("CONTROL: planted text naming a review table or door is found", () => {
    expect(namesForbidden("select * from application_scores")).toContain("application_scores");
    expect(namesForbidden("GET /api/governance/applications/:ref/scorecards")).toEqual(expect.arrayContaining(["scorecards", "/applications/"]));
    expect(namesForbidden("a harmless line")).toEqual([]);
  });
});

describe("no model-facing source names the review", () => {
  for (const file of MODEL_FACING) {
    it(`${file}`, () => {
      const full = path.join(ROOT, file);
      expect(fs.existsSync(full), `${file} should exist; update this list if it moved`).toBe(true);
      expect(namesForbidden(fs.readFileSync(full, "utf8"))).toEqual([]);
    });
  }
});

describe("the review's own files call no model", () => {
  const OWN = ["server/lib/applicationReview.ts", "server/routes/applicationReview.ts", "server/repos/applicationReview.ts", "shared/applicationReview.ts"];
  const MODEL_IMPORT = /anthropic|openai|saberra|seraAgent|companions|roleGuide|llm|generateText|messages\.create/i;
  for (const file of OWN) {
    it(`${file} imports no model client`, () => {
      const imports = fs
        .readFileSync(path.join(ROOT, file), "utf8")
        .split("\n")
        .filter((l) => /^\s*import\b/.test(l));
      expect(imports.filter((l) => MODEL_IMPORT.test(l))).toEqual([]);
    });
  }
  it("CONTROL: the import filter does catch a model import", () => {
    expect(['import Anthropic from "@anthropic-ai/sdk";'].filter((l) => MODEL_IMPORT.test(l))).toHaveLength(1);
  });
});

describe("the agent tool tables are refused the reads", () => {
  it("no MCP tool reaches an application, a score or an interview", () => {
    const routes = MCP_TOOLS.flatMap((t) => t.routes);
    expect(routes.length).toBeGreaterThan(5);
    expect(routes.filter((r) => /applications\/|open-proposals|application-status|scorecards|recuse/.test(r))).toEqual([]);
  });
  it("CONTROL: the same filter does match a route that would read them", () => {
    expect(["GET /api/governance/applications/:ref/scorecards"].filter((r) => /applications\/|scorecards/.test(r))).toHaveLength(1);
  });
  it("admin_request refuses the review's doors, whatever the village's list holds", () => {
    const doc = DEFAULT_AGENT_ADMIN_PATHS;
    for (const p of ["/api/governance/applications/op-0123456789abcdef0123/scorecards", "/api/application-status/op-0123456789abcdef0123", "/api/governance/open-proposals/op-0123456789abcdef0123"]) {
      expect(adminRequestDecision("GET", p, doc, "u1").ok, p).toBe(false);
    }
    // CONTROL: a path the list does hold is allowed, so the refusals above are about the path.
    expect(adminRequestDecision("GET", "/api/admin/member-tasks/access", doc, "u1").ok).toBe(true);
  });
});

describe("Sera's tools", () => {
  const actor: SeraActor = { userId: "u-sera", tokenId: "atk-sera", tokenPrefix: "vat_sera" };
  const deps = { listDefault: true, today: "2026-11-09" } as any;
  it("has no tool that names the review", () => {
    expect(SERA_TOOLS.length).toBeGreaterThan(0);
    expect(SERA_TOOLS.filter((t) => /application|score|interview|applicant/i.test(t))).toEqual([]);
  });
  it("refuses a request to read applications, scores or interviews before touching anything", async () => {
    const pool = new Proxy({}, { get: () => { throw new Error("the pool was touched"); } }) as any;
    for (const tool of ["read_applications", "list_application_scores", "get_scorecards", "summarise_candidates", "rank_applicants"]) {
      const out = await runSeraTool(pool, actor, tool as any, {}, deps);
      expect(out.ok, tool).toBe(false);
      expect((out as any).error).toMatch(/no such Sera tool/);
    }
  });
});
