/**
 * THE CONFIDENTIALITY AGREEMENT'S WORDS, AND THE KEY IT GUARDS (role journey L7).
 *
 *   1. The words are the village's own: none written, no agreement; a title
 *      left blank reads as the generic name.
 *   2. The version is the words: a changed body or title is a new version,
 *      and line endings or trailing spaces are not.
 *   3. `records.confidential` reaches nobody without the alignment, the admin
 *      and the break-glass included, and reaches its holder with it.
 *      CONTROL: every other key is judged exactly as before.
 */
import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES, ALIGNMENT_BOUND, capabilityDecision, type CapabilityCtx } from "../../shared/capabilities";
import { AGREEMENT_VERSION, DEFAULT_AGREEMENT_TITLE, readConfidentialityRef, renderAgreement } from "../../shared/confidentiality";
import { currentAgreement } from "./confidentiality";

const WORDS = { title: "Confidentiality agreement", body: "What you read stays with you." };

describe("the words are the village's own", () => {
  it("no words, no agreement; a blank title reads as the generic name", () => {
    expect(renderAgreement(undefined)).toBeNull();
    expect(renderAgreement({ title: "Only a title" })).toBeNull();
    expect(renderAgreement({ body: "  Words.  " })).toMatchObject({ title: DEFAULT_AGREEMENT_TITLE, body: "Words.\n" });
    expect(renderAgreement(WORDS)?.intent).toBe("I align with the Confidentiality agreement.");
  });

  it("the version is the words: new words, new version; a CRLF save is the same words", () => {
    const a = currentAgreement(WORDS)!;
    expect(a.version).toMatch(AGREEMENT_VERSION);
    expect(currentAgreement({ ...WORDS })!.version).toBe(a.version);
    expect(currentAgreement({ ...WORDS, body: "What you read stays with you.  \r\n" })!.version).toBe(a.version);
    expect(currentAgreement({ ...WORDS, body: "What you read stays with you, always." })!.version).not.toBe(a.version);
    expect(currentAgreement({ ...WORDS, title: "Privacy agreement" })!.version).not.toBe(a.version);
  });

  it("a text's ref names its version and nothing else parses as one", () => {
    expect(readConfidentialityRef("cv-0123456789abcdef:ca-1")).toEqual({ version: "cv-0123456789abcdef", alignmentId: "ca-1" });
    expect(readConfidentialityRef("lv-0123456789abcdef:sg-1")).toBeNull();
  });
});

describe("records.confidential is held only with a current alignment", () => {
  const base: CapabilityCtx = { stageIndex: 9, stageIndexOf: () => 0, roleCapabilities: ["records.confidential"] };

  it("a role holding it without the alignment is refused, and with it passes", () => {
    expect(capabilityDecision("records.confidential", base)).toMatchObject({ allowed: false, source: "needs an alignment" });
    expect(capabilityDecision("records.confidential", { ...base, alignedConfidentiality: true })).toMatchObject({ allowed: true, source: "role" });
  });

  it("the admin short-circuit and the break-glass do not reach past it", () => {
    const admin: CapabilityCtx = { ...base, roleCapabilities: ["steward.veto"], isAdmin: true, isFounder: true, adminOverride: true, villageHeld: ["records.confidential"] };
    expect(capabilityDecision("records.confidential", admin).allowed).toBe(false);
    expect(capabilityDecision("records.confidential", { ...admin, villageHeld: [] }).allowed).toBe(false);
    expect(capabilityDecision("records.confidential", { ...admin, villageHeld: [], alignedConfidentiality: true })).toMatchObject({ allowed: true, source: "admin" });
  });

  it("the alignment alone grants nothing", () => {
    expect(capabilityDecision("records.confidential", { ...base, roleCapabilities: [], alignedConfidentiality: true }).allowed).toBe(false);
  });

  it("CONTROL: no other key is bound, and each is judged the same with or without the alignment", () => {
    expect([...ALIGNMENT_BOUND]).toEqual(["records.confidential"]);
    for (const cap of ALL_CAPABILITIES.filter((c) => !ALIGNMENT_BOUND.includes(c))) {
      const ctx: CapabilityCtx = { ...base, roleCapabilities: [cap] };
      expect(capabilityDecision(cap, ctx), cap).toEqual(capabilityDecision(cap, { ...ctx, alignedConfidentiality: true }));
      expect(capabilityDecision(cap, ctx).source, cap).not.toBe("needs an alignment");
    }
  });
});
