/**
 * The launch checklist's recognition-token row, pinned in both directions.
 *
 * The bug this exists to stop coming back: the resolver read
 * `brand.currency.name` while `mergedConfig()` took the displayed name from
 * the token registry. So the item was red for a founder who renamed correctly
 * and green for one who typed into a box that changed nothing. Both halves get
 * a case here, plus the link, because the row was wrong in both directions and
 * fixing one half would have left the other reading exactly as before.
 */
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "./gameConfig";
import {
  LAUNCH_REQUIREMENTS,
  projectCurrencyCheck,
  recognitionNameCheck,
  starterQuestsCheck,
  timezoneAnswerCheck,
} from "./launchRequirements";

const DEFAULT_WORD = GAME_CONFIG.currency.name;

describe("recognitionNameCheck", () => {
  it("passes when the registry carries the village's own word", () => {
    const r = recognitionNameCheck("Thanks", DEFAULT_WORD);
    expect(r.state).toBe("ok");
    expect(r.detail).toContain("Thanks");
  });

  it("stays open while the registry still carries the platform's word", () => {
    const r = recognitionNameCheck(DEFAULT_WORD, DEFAULT_WORD);
    expect(r.state).toBe("missing");
    expect(r.detail).toContain(DEFAULT_WORD);
  });

  it("ignores case and surrounding space, because a chip reads the same either way", () => {
    expect(recognitionNameCheck(`  ${DEFAULT_WORD.toLowerCase()} `, DEFAULT_WORD).state).toBe("missing");
  });

  it("says so plainly when the registry has no row to read", () => {
    for (const missing of [undefined, null, "", "   "]) {
      const r = recognitionNameCheck(missing, DEFAULT_WORD);
      expect(r.state).toBe("missing");
      expect(r.detail).toMatch(/no name in this village's registry/);
    }
  });

  it("never quotes an empty name at the founder", () => {
    // `Recognition still carries the platform's own word, “”` is the shape
    // this branch exists to avoid.
    expect(recognitionNameCheck("", DEFAULT_WORD).detail).not.toContain("“”");
  });
});

describe("the recognition-token requirement", () => {
  const item = LAUNCH_REQUIREMENTS.find((r) => r.id === "brand-token-names")!;

  it("sends a founder to the registry, which is the only surface that can change it", () => {
    expect(item).toBeDefined();
    expect(item.fixAt).toBe("/admin?tab=tokens");
    // The Setup Wizard's two currency boxes were the old destination and could
    // never win against the registry. They are gone; this must not point back.
    expect(item.fixAt).not.toContain("tab=setup");
  });
});

/**
 * THE TWO FACTS ONLY A VILLAGE CAN STATE, and the difference between them.
 *
 * The platform ships a timezone and a currency, and a fork inherits both in
 * silence: nothing renders as broken, so nothing ever asks. These two items
 * ask, once each.
 *
 * They read what is STORED, never what is rendered, and the two questions are
 * not the same shape. A stored currency IS an answer, because that box holds
 * the village's own value and blank means inherit. A stored timezone is not,
 * because the Season tab is handed the normalised document and writes the
 * platform's zone back on any save, so the season document carries a separate
 * answer and `timezoneAnswerCheck` reads that.
 */
describe("the village's own facts", () => {
  it("asks about the timezone, and says which one it is running on", () => {
    const missing = timezoneAnswerCheck(false, "America/Costa_Rica");
    expect(missing.state).toBe("missing");
    expect(missing.detail).toContain("America/Costa_Rica");
    // The sentence names no village and blames nobody: an inherited default is
    // not a mistake, it is a question that was never put.
    expect(missing.detail).toContain("not an answer anybody here gave");
    const answered = timezoneAnswerCheck(true, "Pacific/Auckland");
    expect(answered.state).toBe("ok");
    expect(answered.detail).toContain("Pacific/Auckland");
  });

  it("counts a stored currency as the answer, whatever it is", () => {
    // Deliberately NOT compared against the platform's own code, unlike the
    // recognition name above: a village may count in the same currency the
    // platform ships, and typing it is the answer.
    expect(projectCurrencyCheck("CHF").state).toBe("ok");
    expect(projectCurrencyCheck("CRC").state).toBe("ok");
    expect(projectCurrencyCheck("crc").detail).toContain("CRC");
  });

  it("counts blank, and whitespace, as unanswered", () => {
    // Blank means inherit, which is a real state and not an error. Whitespace
    // used to be storable and read as non-empty, which is how a village could
    // look answered on one surface and unanswered on another.
    for (const v of ["", "   ", null, undefined]) {
      expect(projectCurrencyCheck(v as any).state).toBe("missing");
    }
  });

  it("carries the currency as recommended and the timezone as blocking, both linking to the control", () => {
    const severity: Record<string, string> = {
      // A village may launch on the platform's currency.
      "village-currency": "recommended",
      // Readiness R059: the platform keeps UTC, which is nobody's home, so a
      // village answers (confirming UTC counts) before its launch vote.
      "village-timezone": "blocking",
    };
    for (const [id, want] of Object.entries(severity)) {
      const req = LAUNCH_REQUIREMENTS.find((r) => r.id === id);
      expect(req, `no launch requirement "${id}"`).toBeTruthy();
      expect(req!.severity, id).toBe(want);
      // The address names the control, not just the screen it sits on.
      expect(req!.fixAt).toContain("setting=");
    }
  });

  it("tells a founder why the timezone matters, and names no village's clock", () => {
    const req = LAUNCH_REQUIREMENTS.find((r) => r.id === "village-timezone")!;
    expect(req.why).toContain("UTC");
    expect(req.why).toMatch(/Season turns, role terms/);
    expect(req.why).toMatch(/confirm UTC/i);
    expect(req.why).not.toMatch(/Costa Rica|America\//);
  });
});

/**
 * THE VILLAGE'S OWN WELCOME AND WALK, ON THE JOURNEY (Rye, 2026-10-02).
 *
 * "Onboarding is something that founders should do and really personalize
 * and put their spirit into it. So just add this to a journey to launch
 * that's suggested remove the example journey for now."
 *
 * SUGGESTED is the word that sets the severity: a village launches without a
 * walk and the map simply offers none. The check itself is pinned in
 * shared/mapWalkDocument.test.ts and server/lib/launchVillageFacts.test.ts;
 * this pins the row.
 */
describe("the welcome-and-walk requirement", () => {
  const item = LAUNCH_REQUIREMENTS.find((r) => r.id === "welcome-walk");

  it("is on the journey, recommended and never blocking", () => {
    expect(item, "no launch requirement \"welcome-walk\"").toBeTruthy();
    expect(item!.severity).toBe("recommended");
    expect(item!.group).toBe("brand");
  });

  it("asks only a village that runs the map, which is where the walk is written and walked", () => {
    expect(item!.appliesWhenModule).toBe("map");
  });

  it("is a real check read from the walk's document, never a box a founder ticks", () => {
    expect(item!.checkKey).toBe("village:walk");
    expect(item!.checkKey.startsWith("manual:")).toBe(false);
    expect(item!.declinable).toBeFalsy();
  });

  it("links to the walk editor on the map, where the walk is written", () => {
    // The editor moved onto the map on 2026-09-23 (VillageSettingsDoor); the
    // client test pins that this address opens it.
    expect(item!.fixAt).toBe("/map?settings=walk");
  });

  it("names no persona and no dash in its copy", () => {
    // Platform copy, read aloud by whatever guide a village runs: the same
    // reasoning as the assistant rows above, which name no persona and no
    // pronoun for it. The village's name is held off by check-brand-refs.
    for (const words of [item!.title, item!.why, item!.fixLabel]) {
      expect(words).not.toMatch(/\b(she|her|hers)\b/i);
      expect(words).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

/**
 * THE STARTER QUESTS, ON THE JOURNEY (Rye, sheet A8 / 19g: "a new village
 * starts with a neutral, fully editable starter set"). The row asks a founder
 * to keep the starters that fit and clear the rest. Its live behaviour on a
 * real schema is in server/starterQuests.test.ts; this pins the row and the
 * sentence it reads from the count.
 */
describe("the starter-quests requirement", () => {
  const item = LAUNCH_REQUIREMENTS.find((r) => r.id === "starter-quests");

  it("is on the journey for every village, recommended and never blocking", () => {
    expect(item, "no launch requirement \"starter-quests\"").toBeTruthy();
    expect(item!.severity).toBe("recommended");
    expect(item!.group).toBe("brand");
    // Quests is a core module: every village has a board to review.
    expect(item!.appliesWhenModule).toBeUndefined();
  });

  it("is read live from the board, never a box a founder ticks", () => {
    expect(item!.checkKey).toBe("village:starter-quests");
    expect(item!.declinable).toBeFalsy();
  });

  it("links to the admin Quests tab, where Keep and Clear are", () => {
    expect(item!.fixAt).toBe("/admin?tab=quests-admin");
    expect(item!.fixLabel).toBe("Open Quests");
  });

  it("says what to do in its own words, with no dash, no persona and no token", () => {
    expect(item!.title).toBe("Review the starter quests");
    expect(item!.why).toContain("Keep the ones that fit");
    expect(item!.why).toContain("clear the rest");
    for (const words of [item!.title, item!.why, item!.fixLabel]) {
      expect(words).not.toMatch(/[–—]/);
      expect(words).not.toMatch(/(she|her|hers|token|tokens|paid|pays|earn)/i);
    }
  });

  it("reads open while any starter waits, and done when none does", () => {
    expect(starterQuestsCheck(0)).toEqual({ state: "ok", detail: "No starter quests are waiting. The board is the village's own" });
    expect(starterQuestsCheck(1)).toEqual({ state: "missing", detail: "1 starter quest is still waiting. Keep the ones that fit and clear the rest" });
    expect(starterQuestsCheck(11).detail).toContain("11 starter quests are still waiting");
    // Junk never reads as waiting work.
    for (const v of [NaN, -3, undefined as any, null as any]) expect(starterQuestsCheck(v).state).toBe("ok");
  });
});
