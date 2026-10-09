/**
 * THE CLOSING SECTION'S WRITE RULES, ITS LAUNCH READING, AND THE TWO HOOKS IN
 * THE EXIT POLICY, with no server and no database.
 *
 * The route (server/routes/closingPolicy.ts) is four lines around
 * `closingWrite`, and the launch row is one line around `closingCheckOf`, so
 * every decision either makes is driven here. The same rules over HTTP, with a
 * real "no" and a real "yes" from the launch vote, are in
 * server/closingPolicy.routes.e2e.test.ts.
 */
import { describe, expect, it } from "vitest";
import { CLOSING_CHECK_KEY, closingCheckOf, closingWrite } from "./closingPolicy";
import { normalizeExitPolicy, withPolicyDefaults, DEFAULT_EXIT_POLICY } from "./exitPolicy";
import { PROPORTIONAL_CLOSING_STATEMENT } from "../../shared/closingPolicies";
import { LAUNCH_REQUIREMENTS } from "../../shared/launchRequirements";

const OWN_WORDS =
  "If the village closes, the land passes to a community land trust and the cash is shared equally among whoever still lives here.";
const NOW = new Date("2026-10-03T10:00:00.000Z");
const EARLIER = "2026-09-30T08:00:00.000Z";

const DEFAULT_CHOICE = { policyId: "proportional-closing-balance", statement: PROPORTIONAL_CLOSING_STATEMENT };

describe("closingWrite", () => {
  it("refuses what the editor refuses, with the editor's sentence", () => {
    const r = closingWrite({ policyId: "own-words", statement: "TBD", adopt: true }, undefined, "user-a", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toBe("closing_policy_invalid");
      expect(r.message).toMatch(/at least 8 words/);
    }
    for (const body of [null, "closing", [], { statement: OWN_WORDS }]) {
      expect(closingWrite(body, undefined, "user-a", NOW).ok, JSON.stringify(body)).toBe(false);
    }
  });

  it("saves the default's words WITHOUT adopt as a draft: the placeholder alone does not count", () => {
    const r = closingWrite(DEFAULT_CHOICE, undefined, "user-a", NOW);
    expect(r).toEqual({
      ok: true,
      section: { ...DEFAULT_CHOICE, adoptedBy: null, adoptedAt: null },
    });
    expect(closingCheckOf(r.ok ? r.section : null).state).toBe("missing");
  });

  it("ignores an adoption the BODY claims: who adopted is stamped from the session", () => {
    const r = closingWrite({ ...DEFAULT_CHOICE, adoptedBy: "somebody-else", adoptedAt: EARLIER }, undefined, "user-a", NOW);
    expect(r.ok && r.section.adoptedBy).toBeNull();
    expect(r.ok && r.section.adoptedAt).toBeNull();
    const adopted = closingWrite({ ...DEFAULT_CHOICE, adopt: true, adoptedBy: "somebody-else", adoptedAt: EARLIER }, undefined, "user-a", NOW);
    expect(adopted.ok && adopted.section.adoptedBy).toBe("user-a");
    expect(adopted.ok && adopted.section.adoptedAt).toBe(NOW.toISOString());
  });

  it("adopt only means literally true", () => {
    for (const adopt of ["true", 1, "yes"]) {
      const r = closingWrite({ ...DEFAULT_CHOICE, adopt }, undefined, "user-a", NOW);
      expect(r.ok && r.section.adoptedAt, String(adopt)).toBeNull();
    }
  });

  it("refuses to adopt with nobody named to record", () => {
    const r = closingWrite({ ...DEFAULT_CHOICE, adopt: true }, undefined, null, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("re-adopting the same words keeps the first adoption, and changed words are a new one", () => {
    const stored = { ...DEFAULT_CHOICE, adoptedBy: "user-a", adoptedAt: EARLIER };
    const same = closingWrite({ ...DEFAULT_CHOICE, statement: `  ${PROPORTIONAL_CLOSING_STATEMENT}  `, adopt: true }, stored, "user-b", NOW);
    expect(same.ok && same.section).toMatchObject({ adoptedBy: "user-a", adoptedAt: EARLIER });

    const changed = closingWrite({ policyId: "own-words", statement: OWN_WORDS, adopt: true }, stored, "user-b", NOW);
    expect(changed.ok && changed.section).toMatchObject({ policyId: "own-words", adoptedBy: "user-b", adoptedAt: NOW.toISOString() });
  });

  it("a save without adopt NEVER replaces adopted words: it is refused, and the promise stands", () => {
    // Review of 2026-09-27: this used to store a draft over the adoption, which
    // withdrew the village's promise and erased the adopted words.
    const stored = { ...DEFAULT_CHOICE, adoptedBy: "user-a", adoptedAt: EARLIER };
    for (const body of [DEFAULT_CHOICE, { policyId: "own-words", statement: OWN_WORDS }, { ...DEFAULT_CHOICE, adopt: false }]) {
      const r = closingWrite(body, stored, "user-a", NOW);
      expect(r.ok, JSON.stringify(body)).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(409);
        expect(r.error).toBe("closing_policy_adopted");
        expect(r.message).toMatch(/Adopt the new words to replace them/);
      }
    }
  });

  it("before anything is adopted, a save without adopt replaces a draft with a draft", () => {
    const stored = { ...DEFAULT_CHOICE, adoptedBy: null, adoptedAt: null };
    const r = closingWrite({ policyId: "own-words", statement: OWN_WORDS }, stored, "user-a", NOW);
    expect(r).toEqual({ ok: true, section: { policyId: "own-words", statement: OWN_WORDS, adoptedBy: null, adoptedAt: null } });
  });

  it("refuses to file other words under the default's name, adopted or drafted", () => {
    for (const adopt of [true, false]) {
      const r = closingWrite({ policyId: "proportional-closing-balance", statement: OWN_WORDS, adopt }, undefined, "user-a", NOW);
      expect(r.ok, String(adopt)).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/keep the sentence that choice stands for/);
    }
  });
});

describe("closingCheckOf: the launch row", () => {
  it("is blocking, sits beside the exit terms, and points at the editor", () => {
    const i = LAUNCH_REQUIREMENTS.findIndex((r) => r.id === CLOSING_CHECK_KEY);
    const row = LAUNCH_REQUIREMENTS[i];
    expect(row?.checkKey).toBe(CLOSING_CHECK_KEY);
    expect(row?.severity).toBe("blocking");
    expect(row?.title).toBe("Name what closing this village means");
    expect(row?.fixAt).toBe("/admin?tab=exits-admin&setting=exit.closing");
    expect(LAUNCH_REQUIREMENTS[i - 1]?.id).toBe("exit-policy-terms");
  });

  it("reads MISSING, with a sentence and no error, on a policy saved before closing existed", () => {
    // Live Amora's shape: an exit policy with no closing key at all.
    for (const nothing of [undefined, null, "closing", 3]) {
      const r = closingCheckOf(nothing);
      expect(r.state).toBe("missing");
      expect(r.detail).toMatch(/Nothing is named yet/);
    }
  });

  it("reads MISSING on a draft, and on stored words the editor would refuse", () => {
    expect(closingCheckOf({ ...DEFAULT_CHOICE, adoptedBy: null, adoptedAt: null }).detail).toMatch(/not adopted yet/);
    const odd = closingCheckOf({ policyId: "equal-shares", statement: OWN_WORDS, adoptedBy: "u", adoptedAt: EARLIER });
    expect(odd.state).toBe("missing");
    expect(odd.detail).toMatch(/cannot be adopted as it stands/);
  });

  it("never reads OK for the default's name over words that dropped its sentence", () => {
    const r = closingCheckOf({ policyId: "proportional-closing-balance", statement: OWN_WORDS, adoptedBy: "u", adoptedAt: EARLIER });
    expect(r.state).toBe("missing");
    expect(r.detail).not.toMatch(/Named and adopted/);
    expect(r.detail).toMatch(/keep the sentence that choice stands for/);
  });

  it("reads OK once adopted, naming the policy", () => {
    const r = closingCheckOf({ ...DEFAULT_CHOICE, adoptedBy: "user-a", adoptedAt: EARLIER });
    expect(r).toEqual({ state: "ok", detail: "Named and adopted: Shared by closing-day balances" });
  });
});

describe("the exit policy's two hooks", () => {
  const section = { ...DEFAULT_CHOICE, adoptedBy: "user-a", adoptedAt: EARLIER };

  it("a save of the rest of the policy CARRIES the stored section and ignores one in the body", () => {
    const body = { ...DEFAULT_EXIT_POLICY, closing: { policyId: "own-words", statement: OWN_WORDS, adoptedBy: "forged", adoptedAt: NOW.toISOString() } };
    expect(normalizeExitPolicy(body, { ...DEFAULT_EXIT_POLICY, closing: section }).closing).toEqual(section);
    // With nothing stored, nothing is invented, whatever the body says.
    expect(normalizeExitPolicy(body, DEFAULT_EXIT_POLICY)).not.toHaveProperty("closing");
    expect(normalizeExitPolicy(body)).not.toHaveProperty("closing");
  });

  it("a reader gets the words and the date and never the account", () => {
    const read = withPolicyDefaults({ ...DEFAULT_EXIT_POLICY, closing: section });
    expect(read.closing).toEqual({ policyId: section.policyId, statement: section.statement, adoptedAt: EARLIER });
    expect(JSON.stringify(read)).not.toContain("user-a");
  });

  it("a policy with no section reads with none, so absent stays absent", () => {
    expect(withPolicyDefaults({ ...DEFAULT_EXIT_POLICY }).closing).toBeUndefined();
    expect(withPolicyDefaults(undefined).closing).toBeUndefined();
  });
});
