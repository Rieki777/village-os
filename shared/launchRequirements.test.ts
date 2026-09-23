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

  it("carries both as recommended, never blocking, and links to the control", () => {
    const ids = ["village-timezone", "village-currency"];
    for (const id of ids) {
      const req = LAUNCH_REQUIREMENTS.find((r) => r.id === id);
      expect(req, `no launch requirement "${id}"`).toBeTruthy();
      // A warning warns. A village that means to launch on the defaults may.
      expect(req!.severity).toBe("recommended");
      // The address names the control, not just the screen it sits on.
      expect(req!.fixAt).toContain("setting=");
    }
  });
});
