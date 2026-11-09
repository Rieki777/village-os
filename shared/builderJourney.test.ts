import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BUILDER_GUIDE_URL } from "./moduleCatalog";
import {
  BUILDER_EXAMPLES,
  BUILDER_STEPS,
  MODULE_CONTRACT_URL,
  REPO_BLOB_ROOT,
  REPO_HOME,
  START_HERE_URL,
  agentHandoffText,
} from "./builderJourney";

describe("the builder's journey", () => {
  it("derives every link from the upstream guide, so a fork can never point two links at two repositories", () => {
    expect(START_HERE_URL).toBe(BUILDER_GUIDE_URL);
    expect(BUILDER_GUIDE_URL.startsWith(REPO_BLOB_ROOT)).toBe(true);
    expect(MODULE_CONTRACT_URL).toBe(`${REPO_BLOB_ROOT}docs/MODULE_LIBRARY_CONTRACT.md`);
    expect(REPO_BLOB_ROOT.startsWith(`${REPO_HOME}/blob/`)).toBe(true);
    for (const e of BUILDER_EXAMPLES) expect(e.href.startsWith(REPO_BLOB_ROOT), e.title).toBe(true);
  });

  it("links only documents that exist in this repository", () => {
    const docs = [MODULE_CONTRACT_URL, START_HERE_URL, ...BUILDER_EXAMPLES.map((e) => e.href)];
    for (const href of docs) {
      const rel = href.slice(REPO_BLOB_ROOT.length);
      expect(fs.existsSync(path.resolve(process.cwd(), rel)), rel).toBe(true);
    }
  });

  it("has the five steps in order, with the facts command on the third", () => {
    expect(BUILDER_STEPS.map((s) => s.title)).toEqual([
      "Read the contract",
      "Paste the guide into your agent",
      "Run the module facts",
      "Open the pull request",
      "Get listed",
    ]);
    expect(BUILDER_STEPS[2].command).toBe("node scripts/module-facts.mjs");
    expect(fs.existsSync(path.resolve(process.cwd(), "scripts/module-facts.mjs"))).toBe(true);
  });

  it("hands an agent both documents by full address and the command to run", () => {
    const text = agentHandoffText();
    expect(text).toContain(START_HERE_URL);
    expect(text).toContain(MODULE_CONTRACT_URL);
    expect(text).toContain("node scripts/module-facts.mjs");
    expect(text).toContain(REPO_HOME);
  });
});
