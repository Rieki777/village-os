/**
 * NO AI READS THE REFERENCES (joining lane PR 2). Two kinds of proof, as the
 * selection refusal test does (applicationReview.refusal.test.ts), each with a
 * control that fails for the reason claimed:
 *
 *  - behaviour: `forAssistants`, the one allow-list a model may be handed a
 *    proposal through, lets none of a planted reference out;
 *  - structure: no source a model can reach names the About-you fields or the
 *    open-proposal store, and every model-facing source is scanned.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { forAssistants, AI_SAFE_PROPOSAL_FIELDS } from "../../shared/proposalAbout";

const ROOT = path.resolve(__dirname, "..", "..");

/** What a model-facing source must never name: the About-you data, and the stores it lives in. */
const FORBIDDEN = ["proposalAbout", "backgroundCheck", "checkConsent", "referencesOf", "openBodyOf", "open_role_proposals", "readOpenProposal", "AboutYou"];
export const namesForbidden = (source: string): string[] => FORBIDDEN.filter((f) => source.includes(f));

/** Every file a companion, the guide, Sera, an agent token, the moon recap or the admin helper can run through. */
const MODEL_FACING = [
  "server/lib/companions.ts",
  "server/lib/companionSera.ts",
  "server/lib/roleGuide.ts",
  "server/lib/roleGuideContext.ts",
  "server/lib/saberraGuide.ts",
  "server/lib/seraAgent.ts",
  "server/lib/seraGuideCall.ts",
  "server/lib/seraGuideQuestion.ts",
  "server/lib/agentMcp.ts",
  "server/lib/agentMcpTierB.ts",
  "server/lib/agentInbox.ts",
  "server/lib/agentProfile.ts",
  "server/lib/adminHelperSera.ts",
  "server/lib/moonRecapSera.ts",
  "server/lib/assistant.ts",
  "server/lib/assistantTemplates.ts",
  "server/lib/villageReaders.ts",
  "server/lib/saberraSnapshot.ts",
  "server/lib/saberraSync.ts",
  "shared/companionItems.ts",
  "shared/agentAdmin.ts",
  "shared/seraBridgeBoard.ts",
];

describe("the scan sees what it is told to look for", () => {
  it("CONTROL: planted text naming the About-you data is found", () => {
    expect(namesForbidden("const r = body.backgroundCheck")).toContain("backgroundCheck");
    expect(namesForbidden('import { referencesOf } from "../../shared/proposalAbout"')).toEqual(expect.arrayContaining(["referencesOf", "proposalAbout"]));
    expect(namesForbidden("a harmless line")).toEqual([]);
  });
});

describe("no model-facing source names the references, the check, or the proposal store", () => {
  for (const file of MODEL_FACING) {
    it(file, () => {
      const full = path.join(ROOT, file);
      expect(fs.existsSync(full), `${file} should exist; update this list if it moved`).toBe(true);
      expect(namesForbidden(fs.readFileSync(full, "utf8"))).toEqual([]);
    });
  }
});

describe("what a model may be handed of a proposal", () => {
  const planted = {
    roles: [{ roleId: "r1", note: "note" }],
    why: "why",
    aim: "aim",
    references: [{ name: "Ines Vargas", how: "fence", contact: "ines@example.org" }],
    backgroundCheck: { needed: true, because: "role", consent: { at: "2026-11-10T00:00:00.000Z", version: "cc-1" } },
    about: { based: "Uvita", story: "my story" },
    links: [{ label: "L", url: "https://l.example" }],
    files: [{ id: "pf-1" }],
  };
  /** The fields a leak check looks for, in whatever shape they come out. */
  const leaks = (out: unknown): string[] => ["Ines Vargas", "ines@example.org", "fence", "backgroundCheck", "cc-1", "Uvita", "my story", "https://l.example", "pf-1"].filter((s) => JSON.stringify(out).includes(s));

  it("lets no reference, consent, fact, link or file out", () => {
    expect(leaks(forAssistants(planted))).toEqual([]);
    expect(Object.keys(forAssistants(planted)).sort()).toEqual([...AI_SAFE_PROPOSAL_FIELDS].sort());
  });
  it("BREAK-THE-FIX CONTROL: a door that copies the whole body is caught by the same check", () => {
    const leaky = (body: unknown) => ({ ...(body as object) });
    expect(leaks(leaky(planted)).length).toBeGreaterThan(5);
  });
  it("the allow-list names no About-you field", () => {
    expect(AI_SAFE_PROPOSAL_FIELDS.filter((f) => /refer|check|consent|about|link|file|name|email/i.test(f))).toEqual([]);
  });
});
