/**
 * The one line before a model, and the member's yes to it (Wave 4, plan 5.4).
 * Pure: the route suite (server/routes/companion.test.ts) drives the same
 * functions over HTTP against a real database.
 */
import { describe, expect, it } from "vitest";
import {
  CONSENT_PREFS_KEY,
  MAX_CONSENTS,
  companionDisclosure,
  consentFor,
  readConsents,
  withConsent,
  withoutConsents,
} from "./companionConsent";

describe("the line", () => {
  it("names the provider and whoever holds the key, for each kind of key", () => {
    expect(companionDisclosure("village", null, "Riverbend", {})).toMatchObject({ provider: "Anthropic", operator: "Riverbend", source: "village" });
    expect(companionDisclosure("member", { provider: "anthropic" }, "Riverbend", {}).sentence).toContain("to Anthropic, on your own key.");
    const own = companionDisclosure("member", { provider: "openai_compatible", baseUrl: "https://llm.example.org/v1" }, "Riverbend", {});
    expect(own).toMatchObject({ provider: "the service at llm.example.org", operator: "you" });
    const borrowed = companionDisclosure("platform", null, "Riverbend", { PLATFORM_ASSISTANT_OPERATOR: "Hosting Co-op" });
    expect(borrowed.sentence).toContain("on a key Hosting Co-op shares with Riverbend.");
  });

  it("names the member's own note when it would ride along, and marks the line as carrying it", () => {
    const plain = companionDisclosure("village", null, "Riverbend", {});
    const noted = companionDisclosure("village", null, "Riverbend", {}, { note: true });
    expect(plain.sentence).not.toContain("your note");
    expect(noted.sentence).toBe(
      "To answer in its own words, the guide sends your question, your note to your agent, and what it reads from the village's record for you, to Anthropic, on Riverbend's own key.",
    );
    expect({ ...noted, sentence: "" }).toEqual({ ...plain, sentence: "", note: true });
  });

  it("says so when a borrowed key's operator is not named, and never invents one", () => {
    const d = companionDisclosure("platform", null, "Riverbend", {});
    expect(d.operator).toBe("");
    expect(d.sentence).toContain("a shared key whose operator is not named on this deployment");
  });
});

describe("the yes", () => {
  const village = companionDisclosure("village", null, "Riverbend", {});
  const borrowed = companionDisclosure("platform", null, "Riverbend", { PLATFORM_ASSISTANT_OPERATOR: "Hosting Co-op" });

  it("is to one line: a yes to the village's key is not a yes to a borrowed one", () => {
    const prefs = withConsent({ notify: { digest: "weekly" } }, village, "2026-10-03T10:00:00.000Z");
    expect(consentFor(prefs, village)).toEqual({ provider: "Anthropic", operator: "Riverbend", source: "village", at: "2026-10-03T10:00:00.000Z" });
    expect(consentFor(prefs, borrowed)).toBeNull();
    // Nothing else in prefs is touched.
    expect(prefs.notify).toEqual({ digest: "weekly" });
  });

  it("keeps one entry per line, the newest last, and a bounded list", () => {
    let prefs: Record<string, unknown> = {};
    for (let i = 0; i < MAX_CONSENTS + 3; i++) {
      prefs = withConsent(prefs, companionDisclosure("village", null, `Village ${i}`, {}), `2026-10-0${(i % 9) + 1}T00:00:00.000Z`);
    }
    prefs = withConsent(prefs, village, "2026-10-04T00:00:00.000Z");
    prefs = withConsent(prefs, village, "2026-10-05T00:00:00.000Z");
    const list = readConsents(prefs);
    expect(list).toHaveLength(MAX_CONSENTS);
    expect(list.at(-1)).toMatchObject({ operator: "Riverbend", at: "2026-10-05T00:00:00.000Z" });
    expect(list.filter((c) => c.operator === "Riverbend")).toHaveLength(1);
  });

  /*
   * A yes given while the member had no note does not cover sending a note
   * written later (audit of Wave 4): the line they agreed to never named it.
   * A yes given to the line that named the note still covers a question asked
   * without one, since it agreed to more.
   */
  it("asks again once the member's note would ride along, and a yes to the note covers both", () => {
    const plain = companionDisclosure("village", null, "Riverbend", {});
    const noted = companionDisclosure("village", null, "Riverbend", {}, { note: true });
    const before = withConsent({}, plain, "2026-10-03T10:00:00.000Z");
    expect(consentFor(before, plain)).not.toBeNull();
    expect(consentFor(before, noted), "the yes never covered the note").toBeNull();
    const after = withConsent(before, noted, "2026-10-04T10:00:00.000Z");
    expect(consentFor(after, noted)).toEqual({ provider: "Anthropic", operator: "Riverbend", source: "village", at: "2026-10-04T10:00:00.000Z", note: true });
    expect(consentFor(after, plain)).not.toBeNull();
    expect(readConsents(after), "one entry per who and which key").toHaveLength(1);
  });

  it("drops anything in prefs that is not a well-formed yes, and can be taken back whole", () => {
    const prefs = { [CONSENT_PREFS_KEY]: [{ provider: "Anthropic", operator: "Riverbend", source: "village", at: "x" }, { provider: 3 }, "yes", { provider: "a", operator: "b", source: "someone", at: "y" }] };
    expect(readConsents(prefs)).toEqual([{ provider: "Anthropic", operator: "Riverbend", source: "village", at: "x" }]);
    expect(withoutConsents(prefs)[CONSENT_PREFS_KEY]).toBeUndefined();
    expect(readConsents({ [CONSENT_PREFS_KEY]: "all of them" })).toEqual([]);
  });
});
