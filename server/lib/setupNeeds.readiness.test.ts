/**
 * A MODULE'S FIRST NEED AND ITS READINESS LINK ARE THE SAME DOOR.
 *
 * Every module with setup to do carries a readiness reader and a target
 * (server/lib/modules.ts) that the module card links to, and its setup needs
 * manifest (shared/modules.ts) names where the same first step is done. Two
 * spellings of one address drift apart one rename at a time, so this holds
 * each module's needs to contain the readiness link exactly.
 */
import { describe, expect, it } from "vitest";
import { MODULES_BY_ID } from "../../shared/modules";
import { setupHref } from "../../shared/moduleSetupLink";
import { READINESS_TARGETS } from "./modules";

describe("a module's first need points where its readiness link points", () => {
  for (const [id, target] of Object.entries(READINESS_TARGETS)) {
    it(id, () => {
      const href = setupHref(id, target, { on: true });
      const needs = MODULES_BY_ID[id]?.setupNeeds ?? [];
      expect(needs.map((n) => n.fixAt), `${id} should name ${href}`).toContain(href);
    });
  }
});
