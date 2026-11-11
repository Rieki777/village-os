import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "./gameConfig";
import { LOCALES } from "./i18nLocales";
import {
  COMPANION_LANGUAGES,
  COMPANION_STEPS,
  COMPANION_WORDS,
  MAX_LINE,
  MAX_SHORT,
  MAX_WHY,
  MEMBER_STEPS,
  VISITOR_LINE_LIMIT,
  VISITOR_STEPS,
  companionLanguage,
  companionLine,
  echoesHeading,
} from "./companionLine";
import { FOUNDER_SETUP_STEP } from "../server/lib/nextAction";

const ALL_TEXT = COMPANION_LANGUAGES.flatMap((lang) =>
  COMPANION_STEPS.flatMap((step) => {
    const w = COMPANION_WORDS[lang][step];
    return [w.short, w.line, w.why].map((text) => ({ lang, step, text }));
  }),
);

describe("the companion speaks the path's own steps", () => {
  it("knows every member step the path can name, and no step the path cannot", () => {
    const pathIds = [...GAME_CONFIG.nextActions.map((r) => r.id), FOUNDER_SETUP_STEP.id].sort();
    expect([...MEMBER_STEPS].sort()).toEqual(pathIds);
  });

  it("stays quiet on a step it does not know", () => {
    expect(companionLine({ step: "somewhere-else" })).toBeNull();
    expect(companionLine({ step: undefined })).toBeNull();
    expect(companionLine({ step: 7 })).toBeNull();
  });

  it("offers only languages the site offers", () => {
    const offered = LOCALES.map((l) => l.tag);
    for (const lang of COMPANION_LANGUAGES) expect(offered).toContain(lang);
  });
});

describe("one short line, in the reader's language", () => {
  it("reads Spanish for es and its regions, English for anything else", () => {
    expect(companionLanguage("es")).toBe("es");
    expect(companionLanguage("es-CR")).toBe("es");
    expect(companionLanguage("ES_mx")).toBe("es");
    expect(companionLanguage("en-US")).toBe("en");
    expect(companionLanguage("fr")).toBe("en");
    expect(companionLanguage(null)).toBe("en");
  });

  it("gives the same step in English and in Spanish", () => {
    const en = companionLine({ step: "first-quest", locale: "en" });
    const es = companionLine({ step: "first-quest", locale: "es-CR" });
    expect(en?.language).toBe("en");
    expect(es?.language).toBe("es");
    expect(en?.short).toBe("Pick a first Quest that suits you.");
    expect(es?.short).toBe("Elige una primera misión a tu medida.");
  });

  it("keeps every line within its length, with a long village word put in", () => {
    for (const lang of COMPANION_LANGUAGES) {
      for (const step of COMPANION_STEPS) {
        const l = companionLine({ step, locale: lang, isNew: true, commitment: "Village Agreement" });
        expect(l, `${lang}/${step}`).not.toBeNull();
        expect(l!.short.length, `${lang}/${step} short`).toBeLessThanOrEqual(MAX_SHORT);
        expect(l!.line.length, `${lang}/${step} line`).toBeLessThanOrEqual(MAX_LINE);
        expect(l!.why!.length, `${lang}/${step} why`).toBeLessThanOrEqual(MAX_WHY);
      }
    }
  });

  it("puts the village's word in, and never leaves a brace", () => {
    const l = companionLine({ step: "membership", commitment: "Village Agreement", isNew: true });
    expect(l?.short).toContain("Village Agreement");
    const bare = companionLine({ step: "membership-waiting", locale: "es", isNew: true });
    expect(bare?.short).toContain("carta");
    for (const lang of COMPANION_LANGUAGES) {
      for (const step of COMPANION_STEPS) {
        const x = companionLine({ step, locale: lang, isNew: true });
        expect(`${x!.short}${x!.line}${x!.why}`).not.toMatch(/[{}]/);
      }
    }
  });
});

describe("newness without singling anybody out", () => {
  it("adds the reason for someone new and nothing else changes", () => {
    const settled = companionLine({ step: "training" });
    const fresh = companionLine({ step: "training", isNew: true });
    expect(settled?.why).toBeNull();
    expect(fresh?.why).toBeTruthy();
    expect(fresh?.short).toBe(settled?.short);
    expect(fresh?.line).toBe(settled?.line);
  });

  it("never calls anybody new, in either language", () => {
    const labels = /\b(new|newcomer|newbie|beginner|first[- ]timer)\b|\bnuev[oa]s?\b|\bnovat[oa]s?\b|\bprincipiante/i;
    for (const { lang, step, text } of ALL_TEXT) expect(text, `${lang}/${step}`).not.toMatch(labels);
  });

  it("never names the guide, so no village borrows another's name", () => {
    for (const { text } of ALL_TEXT) expect(text).not.toMatch(/\b(Sera|Maia|guide|guía)\b/i);
  });
});

describe("visitors hear it too, with a strict limit", () => {
  it("speaks to a visitor only on the joining steps", () => {
    for (const step of VISITOR_STEPS) expect(companionLine({ step, visitor: true })).not.toBeNull();
    for (const step of MEMBER_STEPS) expect(companionLine({ step, visitor: true })).toBeNull();
  });

  it("goes quiet after the limit in one visit", () => {
    expect(companionLine({ step: "propose", visitor: true, shownThisVisit: VISITOR_LINE_LIMIT - 1 })).not.toBeNull();
    expect(companionLine({ step: "propose", visitor: true, shownThisVisit: VISITOR_LINE_LIMIT })).toBeNull();
  });

  it("puts no limit on a member", () => {
    expect(companionLine({ step: "propose", shownThisVisit: 50 })).not.toBeNull();
  });
});

describe("never the heading again", () => {
  it("is quiet when the heading already says it", () => {
    const line = companionLine({ step: "check-email" })!.short;
    expect(companionLine({ step: "check-email", heading: line })).toBeNull();
    expect(companionLine({ step: "check-email", heading: `  ${line.toUpperCase()}!` })).toBeNull();
    expect(companionLine({ step: "first-quest", heading: "a first Quest" })).toBeNull();
  });

  it("speaks under a heading that names the place in a word or two", () => {
    expect(companionLine({ step: "explore", heading: "Quests" })).not.toBeNull();
    expect(companionLine({ step: "training", heading: "The training" })).not.toBeNull();
  });

  it("matches whole words only", () => {
    expect(echoesHeading("Pick one Quest that suits you", "one Quest that")).toBe(true);
    expect(echoesHeading("Pick one Quest that suits you", "ne Quest tha")).toBe(false);
    expect(echoesHeading("anything", "")).toBe(false);
    expect(echoesHeading("anything", null)).toBe(false);
  });
});

describe("the house voice", () => {
  it("has no dashes, no contrast framing and no hours", () => {
    for (const { lang, step, text } of ALL_TEXT) {
      expect(text, `${lang}/${step}`).not.toMatch(/[–—]/);
      expect(text, `${lang}/${step}`).not.toMatch(/\brather than\b|\bnot just\b|\bnot only\b|\ben lugar de\b/i);
      expect(text, `${lang}/${step}`).not.toMatch(/\bhours?\b|\bhoras?\b/i);
    }
  });

  it("never scores, ranks or rates a person", () => {
    for (const { text } of ALL_TEXT) expect(text).not.toMatch(/\b(rank|ranked|score[sd]?|rating|leaderboard|level up)\b/i);
  });
});
