/**
 * A DECLINED CAP AND AN UNSET CAP, HELD APART.
 *
 * Rye: founders are asked for the village-wide issuance cap during the launch
 * journey "and they can opt to not set a cap at that moment". Two of the three
 * answers leave the game_variables table looking identical, so this file is
 * about the one thing that tells them apart and about what each one means.
 *
 * The other half of the ruling is asserted here too, because it is the half a
 * later lane could quietly undo: DECLINING NEVER UNCAPS ANYTHING. The
 * platform's number keeps binding every door underneath a founder who said no.
 */
import { describe, expect, it } from "vitest";
import {
  ISSUANCE_CAP_KEY,
  ISSUANCE_CAP_REQUIREMENT,
  issuanceCapDecision,
  issuanceCapDetail,
  issuanceCapSentence,
} from "./issuanceCap";
import { LAUNCH_REQUIREMENTS } from "./launchRequirements";
import { VARIABLES_BY_KEY } from "./gameVariables";

const DEFAULT = "10000";

describe("the three answers", () => {
  it("reads UNSET when nobody has answered and no number was typed", () => {
    const d = issuanceCapDecision({ declined: null, overrideValue: null, platformDefault: DEFAULT });
    expect(d.answer).toBe("unset");
    expect(d.overridden).toBe(false);
    expect(d.by).toBeNull();
    // AND THE CAP STILL BINDS. An unanswered question is not an open faucet.
    expect(d.capTokens).toBe(10000);
  });

  it("reads SET when the village holds a number of its own", () => {
    const d = issuanceCapDecision({ declined: null, overrideValue: "500", platformDefault: DEFAULT });
    expect(d.answer).toBe("set");
    expect(d.capTokens).toBe(500);
    expect(d.overridden).toBe(true);
  });

  it("reads DECLINED when the founder answered, and keeps who and when", () => {
    const d = issuanceCapDecision({
      declined: { by: "usr-founder", at: "2026-09-07T10:00:00.000Z" },
      overrideValue: null,
      platformDefault: DEFAULT,
    });
    expect(d.answer).toBe("declined");
    expect(d.by).toBe("usr-founder");
    expect(d.at).toBe("2026-09-07T10:00:00.000Z");
    // THE RULING'S OTHER HALF: declining names no number, and does not uncap.
    expect(d.capTokens).toBe(10000);
    expect(d.overridden).toBe(false);
  });

  it("HOLDS DECLINED AND UNSET APART ON THE SAME DATABASE STATE", () => {
    /*
     * THE WHOLE POINT OF THIS FILE. Both inputs have no override row, both
     * report the same binding number, and they are two different facts: one is
     * a decision with a person on it, the other is a question nobody answered.
     */
    const declined = issuanceCapDecision({
      declined: { by: "usr-founder", at: "2026-09-07T10:00:00.000Z" },
      overrideValue: null,
      platformDefault: DEFAULT,
    });
    const unset = issuanceCapDecision({ declined: null, overrideValue: null, platformDefault: DEFAULT });

    expect(declined.overridden, "neither village holds a number of its own").toBe(unset.overridden);
    expect(declined.capTokens).toBe(unset.capTokens);
    expect(declined.answer).not.toBe(unset.answer);
    expect(issuanceCapSentence(declined)).not.toBe(issuanceCapSentence(unset));
    expect(issuanceCapDetail(declined).state).toBe("ok");
    expect(issuanceCapDetail(unset).state).toBe("missing");
  });

  it("does not rewrite a decline into a SET when somebody names a number later", () => {
    /*
     * Two facts side by side. The founder was asked at launch and said no, and
     * a number exists now. Promoting the answer would erase the record of what
     * was decided at launch, which is the thing the record is for.
     */
    const d = issuanceCapDecision({
      declined: { by: "usr-founder", at: "2026-09-07T10:00:00.000Z" },
      overrideValue: "250",
      platformDefault: DEFAULT,
    });
    expect(d.answer).toBe("declined");
    expect(d.overridden).toBe(true);
    expect(d.capTokens).toBe(250);
    expect(issuanceCapSentence(d)).toContain("has been set since");
  });

  it("promotes an UNSET village that already typed a number, so answered work is not asked again", () => {
    const d = issuanceCapDecision({ declined: null, overrideValue: "7", platformDefault: DEFAULT });
    expect(d.answer).toBe("set");
  });
});

describe("failing closed", () => {
  it("reads an unparseable override as ZERO, because a cap of zero means zero", () => {
    const d = issuanceCapDecision({ declined: null, overrideValue: "not a number", platformDefault: DEFAULT });
    expect(d.capTokens, "guessing loose would be guessing at an uncapped village").toBe(0);
  });

  it("reads a negative override as ZERO for the same reason", () => {
    expect(
      issuanceCapDecision({ declined: null, overrideValue: "-5", platformDefault: DEFAULT }).capTokens,
    ).toBe(0);
  });
});

describe("the three sentences", () => {
  it("are three, and none of them says a village is uncapped", () => {
    const said = [
      issuanceCapSentence(issuanceCapDecision({ declined: null, overrideValue: null, platformDefault: DEFAULT })),
      issuanceCapSentence(issuanceCapDecision({ declined: null, overrideValue: "5", platformDefault: DEFAULT })),
      issuanceCapSentence(
        issuanceCapDecision({ declined: { by: "u", at: "2026-09-07T00:00:00.000Z" }, overrideValue: null, platformDefault: DEFAULT }),
      ),
    ];
    expect(new Set(said).size).toBe(3);
    for (const s of said) expect(s.toLowerCase()).not.toContain("no cap");
  });
});

describe("the launch requirement", () => {
  it("is on the journey, blocks the launch vote, and is the ONLY declinable row", () => {
    const row = LAUNCH_REQUIREMENTS.find((r) => r.id === ISSUANCE_CAP_REQUIREMENT);
    expect(row, "the founder has to be asked").toBeTruthy();
    expect(row!.severity, "blocking is what makes declining a real answer").toBe("blocking");
    expect(row!.declinable).toBe(true);
    expect(row!.checkKey).toBe("decide:issuance-cap");

    /*
     * DECLINABILITY IS HANDED OUT ONE ROW AT A TIME, and this assertion is the
     * guard on that. If it ever spreads to another row, somebody has to come
     * here and say which one and why, because a village that could decline
     * "Give every admin their own login" would reach `readyToLaunch` with the
     * platform's oldest debt untouched.
     */
    const declinable = LAUNCH_REQUIREMENTS.filter((r) => r.declinable).map((r) => r.id);
    expect(declinable).toEqual([ISSUANCE_CAP_REQUIREMENT]);
  });

  it("names a dial the registry actually holds", () => {
    expect(VARIABLES_BY_KEY[ISSUANCE_CAP_KEY], "a key nothing knows is a read that throws").toBeTruthy();
    expect(VARIABLES_BY_KEY[ISSUANCE_CAP_KEY]!.default).toBe(DEFAULT);
  });
});
