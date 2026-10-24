/**
 * The exit policy's acknowledgement is a claim, and this is the check behind it.
 *
 * A village could tick "these terms were decided by the community", which
 * removes the caution card from /exit-policy, while the editor offered no field
 * for three of the five terms that page prints. The result was the platform's
 * boilerplate published as a village's own settled exit terms, on the
 * highest-stakes page on the site.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXIT_POLICY,
  ELEMENT_NEUTRAL,
  RETIRED_DEFAULT_TERMS,
  blankTerms,
  exitElementRefusal,
  exitLeverFindings,
  exitLeverProblem,
  exitLeverRefusal,
  exitSetRefusals,
  normalizeExitPolicy,
  platformDefaultTerms,
  withPolicyDefaults,
  type ExitLeverReading,
  type ExitLeverToken,
} from "./exitPolicy";
import { VARIABLES, VARIABLES_BY_KEY } from "../../shared/gameVariables";

/** A whole policy in the village's own words, as a starting point to spoil. */
const own = () => ({
  placeholder: false,
  voluntary: {
    noticePeriodDays: 30,
    valuationMethod: "Hours are honoured at the rate the circle agreed.",
    unwindSteps: ["Hand back the keys", "Walk the land"],
  },
  involuntary: { decidingDomainId: "", appealDomainId: "", process: "The care circle hears it first." },
  restorative: { intakeContactRole: "", steps: ["Tea", "A sit-down"] },
});

describe("the acknowledgement cannot be ticked over the platform's words", () => {
  it("names every rendered term still at the platform default", () => {
    const stale = platformDefaultTerms(normalizeExitPolicy(DEFAULT_EXIT_POLICY));
    expect(stale).toEqual([
      "How contributed value is honored",
      "The steps of a voluntary departure",
      "If the village asks someone to leave",
      "The restorative path",
    ]);
  });

  it("a policy written in the village's own words is clear", () => {
    expect(platformDefaultTerms(normalizeExitPolicy(own()))).toEqual([]);
  });

  it("names exactly the one term left untouched", () => {
    const half = { ...own(), restorative: { intakeContactRole: "", steps: [...DEFAULT_EXIT_POLICY.restorative.steps] } };
    expect(platformDefaultTerms(normalizeExitPolicy(half))).toEqual(["The restorative path"]);
  });

  it("whitespace and case are formatting, so retyping the default in caps does not count", () => {
    const cosmetic = {
      ...own(),
      voluntary: {
        ...own().voluntary,
        valuationMethod: `   ${DEFAULT_EXIT_POLICY.voluntary.valuationMethod.toUpperCase()}\n\n`,
      },
    };
    expect(platformDefaultTerms(normalizeExitPolicy(cosmetic))).toEqual(["How contributed value is honored"]);
  });

  it("a reordered step list is the village's own, and a shorter one is too", () => {
    const reordered = {
      ...own(),
      restorative: { intakeContactRole: "", steps: [...DEFAULT_EXIT_POLICY.restorative.steps].reverse() },
    };
    expect(platformDefaultTerms(normalizeExitPolicy(reordered))).toEqual([]);
    const shorter = {
      ...own(),
      voluntary: { ...own().voluntary, unwindSteps: DEFAULT_EXIT_POLICY.voluntary.unwindSteps.slice(0, 2) },
    };
    expect(platformDefaultTerms(normalizeExitPolicy(shorter))).toEqual([]);
  });

  it("the notice period is deliberately not a term: 30 days can be a real decision", () => {
    const sameNotice = { ...own(), voluntary: { ...own().voluntary, noticePeriodDays: 30 } };
    expect(platformDefaultTerms(normalizeExitPolicy(sameNotice))).toEqual([]);
  });

  it("the platform's wording from before 2026-10-23 is still the platform's, so it cannot be published as the village's", () => {
    /*
     * A village that saved its draft before the ruling holds the old words,
     * and `dbDocument.get()` never merges them away. Compared against today's
     * wording alone they would no longer match, and the banner could be
     * cleared over boilerplate nobody in the village wrote.
     */
    const old = {
      ...own(),
      voluntary: {
        ...own().voluntary,
        valuationMethod: RETIRED_DEFAULT_TERMS.valuationMethod[0],
        unwindSteps: [...RETIRED_DEFAULT_TERMS.unwindSteps[0]],
      },
    };
    expect(platformDefaultTerms(normalizeExitPolicy(old))).toEqual([
      "How contributed value is honored",
      "The steps of a voluntary departure",
    ]);
  });

  it("today's voluntary terms say a holder stays on as a former member, and the old tombstone promise is retired", () => {
    expect(DEFAULT_EXIT_POLICY.voluntary.valuationMethod).toContain("former member");
    expect(DEFAULT_EXIT_POLICY.voluntary.unwindSteps.join(" ")).toContain("former member");
    expect(DEFAULT_EXIT_POLICY.voluntary.unwindSteps).not.toContain(
      "The account becomes a tombstone; contributions stay part of the village record",
    );
    expect(RETIRED_DEFAULT_TERMS.unwindSteps[0]).toContain(
      "The account becomes a tombstone; contributions stay part of the village record",
    );
  });
});

describe("normalizing an admin body", () => {
  it("merges per section, so a partial body cannot drop a published term", () => {
    // The old route spread the body over the defaults at the TOP level only, so
    // a `voluntary` without `unwindSteps` replaced the whole section.
    const partial = {
      placeholder: true,
      voluntary: { noticePeriodDays: 14 },
      involuntary: {},
      restorative: {},
    };
    const next = normalizeExitPolicy(partial);
    expect(next.voluntary.noticePeriodDays).toBe(14);
    expect(next.voluntary.unwindSteps).toEqual(DEFAULT_EXIT_POLICY.voluntary.unwindSteps);
    expect(next.voluntary.valuationMethod).toBe(DEFAULT_EXIT_POLICY.voluntary.valuationMethod);
  });

  it("drops blank steps and trims, and keeps the order typed", () => {
    const next = normalizeExitPolicy({
      ...own(),
      restorative: { intakeContactRole: "", steps: ["  first  ", "", "   ", "second"] },
    });
    expect(next.restorative.steps).toEqual(["first", "second"]);
  });

  it("refuses a negative or unreadable notice period by falling back to the default", () => {
    expect(normalizeExitPolicy({ ...own(), voluntary: { ...own().voluntary, noticePeriodDays: -3 } })
      .voluntary.noticePeriodDays).toBe(30);
    expect(normalizeExitPolicy({ ...own(), voluntary: { ...own().voluntary, noticePeriodDays: "soon" } })
      .voluntary.noticePeriodDays).toBe(30);
  });

  it("placeholder is only ever cleared by an explicit true, never by a truthy string", () => {
    expect(normalizeExitPolicy({ ...own(), placeholder: "yes" }).placeholder).toBe(false);
    expect(normalizeExitPolicy({ ...own(), placeholder: true }).placeholder).toBe(true);
  });
});

describe("a published policy cannot leave a term empty", () => {
  it("an emptied prose field falls back rather than publishing blank", () => {
    const emptied = normalizeExitPolicy({ ...own(), involuntary: { decidingDomainId: "", appealDomainId: "", process: "   " } });
    expect(emptied.involuntary.process).toBe(DEFAULT_EXIT_POLICY.involuntary.process);
    expect(blankTerms(emptied)).toEqual([]);
  });

  it("blankTerms names a term that somehow arrived empty", () => {
    const broken = { ...normalizeExitPolicy(own()), restorative: { intakeContactRole: "", steps: [] } };
    expect(blankTerms(broken)).toEqual(["The restorative path"]);
  });
});

/*
 * ── THE EXIT LEVERS: FIVE REFUSALS AND ONE WARNING (R4) ────────────────────
 *
 * There were seven refusals until 2026-10-23. A share of equity and keeping
 * Voice were lifted by the founder's ruling that members keep their tokens:
 * a leaver still holding value now stays on as a former member, which is the
 * condition the Voice refusal itself named. Both are asserted below as
 * coherent, so neither can come back by accident.
 *
 * Every case below is a POLICY a village could describe with the dials and the
 * engine could not honour. The sentences are asserted whole, never by a
 * fragment, because the sentence IS the deliverable: a founder meets it on the
 * save and it has to say what is wrong and what to do instead.
 *
 * The coherent case is derived from the REGISTRY and not retyped here. If a
 * later lane changes an Exit default to something the guard refuses, that test
 * goes red on the day the default moves rather than on the day a village
 * upgrades into a refusal it never asked for.
 *
 * No database, no registry load, no server. `exitLeverFindings` takes every
 * fact it needs in its argument, which is the same property `DEFAULT_EXIT_POLICY`
 * lives in this file for.
 */
const platformCredit: ExitLeverToken = {
  slug: "credits",
  name: "Village Credits",
  kind: "credit",
  governance: "platform",
  active: true,
  hasFaucet: true,
  listedForTrade: false,
};

/** A fork's own credit token. `faucetFor` knows five slugs and this is not one. */
const ownCredit: ExitLeverToken = {
  ...platformCredit,
  slug: "harvest-credit",
  name: "Harvest Credit",
  hasFaucet: false,
};

/** Governed on Base, mirrored here. `validateLeg` refuses to move it at all. */
const equityMirror: ExitLeverToken = {
  ...platformCredit,
  slug: "village-equity",
  name: "Village Equity",
  kind: "equity",
  governance: "hypha",
  hasFaucet: false,
};

/** Retired from the registry. Nothing is issued or burned into it any more. */
const retired: ExitLeverToken = { ...ownCredit, slug: "old-credit", name: "Old Credit", active: false };

/** On the exchange right now, purchasable or swappable. */
const buyable: ExitLeverToken = { ...platformCredit, slug: "traded-credit", name: "Traded Credit", listedForTrade: true };

/** The platform's own answers, read off the registry so the two cannot drift. */
const registryDefaults = (): Record<string, string> =>
  Object.fromEntries(VARIABLES.filter((v) => v.category === "Exit").map((v) => [v.key, v.default]));

const reading = (
  over: Record<string, string> = {},
  tokens: ExitLeverToken[] = [platformCredit],
  noticePeriodDays = DEFAULT_EXIT_POLICY.voluntary.noticePeriodDays,
): ExitLeverReading => {
  const values = { ...registryDefaults(), ...over };
  return { value: (k) => values[k] ?? "", noticePeriodDays, tokens };
};

describe("the platform's own defaults describe a policy the engine can honour", () => {
  it("the ten shipped defaults raise nothing at all, refusal or warning", () => {
    // Read off VARIABLES, so this is a claim about what actually ships.
    expect(exitLeverFindings(reading())).toEqual([]);
    expect(exitLeverProblem(reading())).toBeNull();
  });

  it("the coherent case is not vacuous: the same reading with one dial moved does refuse", () => {
    // A guard that returned [] for everything would pass the test above. This
    // is the control that says the empty array meant something.
    expect(exitLeverProblem(reading({ "exit.keep_pct.recognition": "1" }))).not.toBeNull();
  });

  it("on a village with a credit somebody can buy, the shipped defaults carry the warning and never a refusal", () => {
    // A full credit keep with no vote is the shipped answer since the ruling,
    // so a village that lists a credit token meets the withdrawal-window
    // sentence on its test run. It saves: the warning is the village's to read.
    const found = exitLeverFindings(reading({}, [platformCredit, buyable]));
    expect(found.map((f) => f.severity)).toEqual(["warning"]);
    expect(exitLeverProblem(reading({}, [platformCredit, buyable]))).toBeNull();
  });

  it("the neutral values an element pass reads are exactly the registry's defaults", () => {
    // `exitElementRefusal` judges one dial against every other at its default,
    // and the file keeps those written out. Held here so the two cannot drift.
    expect({ ...ELEMENT_NEUTRAL }).toEqual(registryDefaults());
  });
});

describe("what a leaver cannot keep, whatever the village types", () => {
  it("recognition: a share of a record is not a holding", () => {
    expect(exitLeverProblem(reading({ "exit.keep_pct.recognition": "40" }))).toBe(
      "Recognition is a record of what happened, not a holding. It stays on the village's books either way, so a share of it is not a thing a leaver can keep. Leave this share at zero.",
    );
  });

  it("recognition: one percent is refused the same as forty, and zero is not refused", () => {
    // "Above 0" is the rule. A village typing 1 has described the same
    // impossible thing as a village typing 40.
    expect(exitLeverProblem(reading({ "exit.keep_pct.recognition": "1" }))).toMatch(/^Recognition is a record/);
    expect(exitLeverProblem(reading({ "exit.keep_pct.recognition": "0" }))).toBeNull();
  });

  it("equity: any share is coherent since 2026-10-23, because Earned Equity is a platform token", () => {
    // The refusal was written when the only equity token was the Hypha mirror,
    // which this ledger never moves. Earned Equity (0266) is kind `equity` and
    // platform-governed, and a leaver keeps it by the founder's ruling.
    for (const share of ["0", "10", "100"]) {
      expect(exitLeverProblem(reading({ "exit.keep_pct.equity": share }, [platformCredit, equityMirror])), share).toBeNull();
    }
  });
});

describe("burning back to a faucet that does not exist", () => {
  it("names the token that has nowhere to go", () => {
    expect(
      exitLeverProblem(reading({ "exit.remainder_account": "burn" }, [platformCredit, ownCredit])),
    ).toBe(
      "Harvest Credit has no faucet, so there is nowhere to burn it back to. " +
        "Send what a leaver does not keep to an account the village can hold it in.",
    );
  });

  it("names every one of them, and reads as English when there are several", () => {
    const second: ExitLeverToken = { ...ownCredit, slug: "gift-credit", name: "Gift Credit" };
    expect(
      exitLeverProblem(reading({ "exit.remainder_account": "burn" }, [ownCredit, second, platformCredit])),
    ).toBe(
      "Harvest Credit and Gift Credit have no faucet, so there is nowhere to burn them back to. " +
        "Send what a leaver does not keep to an account the village can hold it in.",
    );
  });

  it("says nothing when every token the ledger moves has a faucet", () => {
    expect(exitLeverProblem(reading({ "exit.remainder_account": "burn" }, [platformCredit]))).toBeNull();
  });

  it("ignores a Hypha mirror and a retired token, because neither is burned into anything", () => {
    // Both have `hasFaucet: false`. A guard that counted them would refuse
    // `burn` in every village that has ever retired a token or mirrors equity,
    // which is a refusal about nothing.
    expect(
      exitLeverProblem(reading({ "exit.remainder_account": "burn" }, [platformCredit, equityMirror, retired])),
    ).toBeNull();
  });

  it("only fires on burn, and not on the other three destinations", () => {
    for (const account of ["settlement", "treasury", "cycle-pool"]) {
      expect(
        exitLeverProblem(reading({ "exit.remainder_account": account }, [platformCredit, ownCredit])),
        account,
      ).toBeNull();
    }
  });
});

describe("the Voice pair", () => {
  it("convert at a rate of zero is a forfeit with extra steps", () => {
    expect(
      exitLeverProblem(reading({ "exit.voice_on_exit": "convert", "exit.voice_convert_rate": "0" })),
    ).toBe("A conversion at zero is a forfeit. Say forfeit, or set a rate.");
  });

  it("convert at a real rate is accepted, including a fraction", () => {
    expect(
      exitLeverProblem(
        reading({ "exit.voice_on_exit": "convert", "exit.voice_convert_rate": "0.25", "exit.keep_pct.voice": "50" }),
      ),
    ).toBeNull();
  });

  it("convert with a Voice share of zero is refused: nothing would convert", () => {
    // D2-3. `sweepBalances` converts only a share above zero, so this saved
    // and then settled as a forfeit.
    const zeroShare = { "exit.voice_on_exit": "convert", "exit.voice_convert_rate": "2.5", "exit.keep_pct.voice": "0" };
    const sentence =
      "Convert turns the share of Voice a leaver keeps into credits, and that share is 0, so nothing would convert. Set the share of Voice a leaver keeps, or say forfeit.";
    // The single-write guard, from either half of the pair.
    expect(exitLeverProblem(reading(zeroShare), "exit.voice_on_exit")).toBe(sentence);
    expect(exitLeverProblem(reading(zeroShare), "exit.keep_pct.voice")).toBe(sentence);
    // The set predicate, on the final state, with both keys named.
    expect(exitSetRefusals(reading(zeroShare))).toEqual([
      { sentence, keys: ["exit.voice_on_exit", "exit.keep_pct.voice"] },
    ]);
    // A set carrying the share as well is coherent.
    expect(exitSetRefusals(reading({ ...zeroShare, "exit.keep_pct.voice": "1" }))).toEqual([]);
    // And a zero share is never refused outside convert, under keep or forfeit.
    expect(exitLeverProblem(reading({ "exit.keep_pct.voice": "0" }), "exit.keep_pct.voice")).toBeNull();
    expect(
      exitLeverProblem(reading({ "exit.keep_pct.voice": "0", "exit.voice_on_exit": "forfeit" }), "exit.keep_pct.voice"),
    ).toBeNull();
  });

  it("a rate of zero on its own is fine, because only convert reads it", () => {
    // An empty state and a real zero are different facts. The rate at 0 while
    // the mode says keep is the shipped default and describes nothing
    // impossible.
    expect(exitLeverProblem(reading({ "exit.voice_convert_rate": "0" }))).toBeNull();
  });

  it("keeping Voice is the shipped answer, and no share of it is refused", () => {
    // Refused until 2026-10-23 because a resolved exit made the account a
    // tombstone. A leaver still holding value now stays on as a former member
    // (server/lib/exitResolve.ts), which is the condition that refusal named.
    for (const share of ["0", "50", "100"]) {
      expect(exitLeverProblem(reading({ "exit.voice_on_exit": "keep", "exit.keep_pct.voice": share })), share).toBeNull();
    }
    // And forfeit, the departure before the ruling, is still a village's to choose.
    expect(exitLeverProblem(reading({ "exit.voice_on_exit": "forfeit" }))).toBeNull();
  });
});

describe("a cooling period the published policy does not admit to", () => {
  it("refuses, and names BOTH numbers", () => {
    expect(exitLeverProblem(reading({ "exit.cooling_days": "45" }, [platformCredit], 30))).toBe(
      "Your published policy says 30 days of notice and this would hold balances for 45. Change the published term first.",
    );
  });

  it("reads the village's own notice period and not the platform's 30", () => {
    // The whole point of the refusal is the gap between what the page says and
    // what the engine would do, so the number in the sentence has to come off
    // the published document.
    expect(exitLeverProblem(reading({ "exit.cooling_days": "10" }, [platformCredit], 7))).toBe(
      "Your published policy says 7 days of notice and this would hold balances for 10. Change the published term first.",
    );
  });

  it("equal is allowed: the page and the engine agree", () => {
    expect(exitLeverProblem(reading({ "exit.cooling_days": "30" }, [platformCredit], 30))).toBeNull();
  });

  it("shorter is allowed", () => {
    expect(exitLeverProblem(reading({ "exit.cooling_days": "29" }, [platformCredit], 30))).toBeNull();
  });
});

describe("the withdrawal window: a warning, and never a refusal", () => {
  const window = { "exit.keep_pct.credit": "100", "exit.vote_over": "0" };

  it("saves, and says what it is", () => {
    const found = exitLeverFindings(reading(window, [buyable]));
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
    expect(found[0].message).toBe(
      "Somebody can buy Traded Credit, open an exit, and take all of it back out with nobody asked. That is a withdrawal window wearing an exit. A village may mean exactly this, so it saves; the test run flags it every time.",
    );
    // THE LOAD-BEARING HALF. A village may genuinely mean this, so the save
    // goes through: `exitLeverProblem` is what the write route reads.
    expect(exitLeverProblem(reading(window, [buyable]))).toBeNull();
  });

  it("a vote over any amount closes the window, so nothing is said", () => {
    expect(exitLeverFindings(reading({ ...window, "exit.vote_over": "1" }, [buyable]))).toEqual([]);
  });

  it("nothing is said about a credit token nobody can buy", () => {
    expect(exitLeverFindings(reading(window, [platformCredit]))).toEqual([]);
  });

  it("nothing is said below a full keep", () => {
    expect(exitLeverFindings(reading({ ...window, "exit.keep_pct.credit": "99" }, [buyable]))).toEqual([]);
  });
});

describe("which sentence a founder meets when two things are wrong at once", () => {
  // Burn with a token that has no faucet, beside a share of recognition. This
  // pair held keeping Voice until 2026-10-23, when that stopped being wrong.
  const twoWrong = { "exit.keep_pct.recognition": "5", "exit.remainder_account": "burn" };
  const withOwnCredit = [platformCredit, ownCredit];
  const read = (over: Record<string, string>) => reading(over, withOwnCredit);

  it("the refusal about the dial being written wins", () => {
    // A founder editing the remainder account is told about the remainder
    // account. Being handed the recognition sentence instead would send them
    // to a field they did not touch.
    expect(exitLeverProblem(read(twoWrong), "exit.remainder_account")).toMatch(/^Harvest Credit has no faucet/);
    expect(exitLeverProblem(read(twoWrong), "exit.keep_pct.recognition")).toMatch(/^Recognition is a record/);
  });

  it("a refusal about a pair answers to either half of it", () => {
    const pair = { "exit.voice_on_exit": "convert", "exit.voice_convert_rate": "0" };
    expect(exitLeverProblem(reading(pair), "exit.voice_convert_rate")).toMatch(/^A conversion at zero/);
    expect(exitLeverProblem(reading(pair), "exit.voice_on_exit")).toMatch(/^A conversion at zero/);
  });

  it("with no key named, the first in order comes back", () => {
    expect(exitLeverProblem(read(twoWrong))).toMatch(/^Recognition is a record/);
  });

  it("a dial the founder is fixing stops refusing the moment they set it back", () => {
    expect(exitLeverProblem(read({ ...twoWrong, "exit.keep_pct.recognition": "0" }), "exit.keep_pct.recognition")).toBeNull();
  });

  it("TWO bad values do not deadlock each other: either one can be fixed first", () => {
    /*
     * THE CASE THAT MADE THIS NARROWING NECESSARY, and it is reachable.
     * Every Exit dial is Ring 2, and the governance apply path writes through
     * `setVariable` without passing this guard, so a village can hold two
     * refused values at once. A route that judged a write against the whole
     * reading would refuse BOTH repairs: fixing recognition fails on burn,
     * fixing burn fails on recognition, and nobody can go first.
     */
    expect(exitLeverProblem(read(twoWrong), "exit.cooling_days")).toBeNull();
    const fixBurn = read({ ...twoWrong, "exit.remainder_account": "settlement" });
    expect(exitLeverProblem(fixBurn, "exit.remainder_account")).toBeNull();
    const fixRecognition = read({ ...twoWrong, "exit.keep_pct.recognition": "0" });
    expect(exitLeverProblem(fixRecognition, "exit.keep_pct.recognition")).toBeNull();
    // Both are still standing as findings. The write route is silent about
    // the one it was not asked about; the test run is where it is reported.
    expect(exitLeverFindings(read(twoWrong)).map((f) => f.severity)).toEqual(["refusal", "refusal"]);
  });
});

describe("the live adapter the write route calls", () => {
  const raw = (key: string) => VARIABLES_BY_KEY[key]?.default ?? "";

  it("refuses a real incoherent write, reading the shipped defaults for everything else", () => {
    expect(exitLeverRefusal("exit.keep_pct.recognition", "40", DEFAULT_EXIT_POLICY, raw)).toMatch(
      /^Recognition is a record/,
    );
  });

  it("trims what it was handed, so a value with spaces is judged on its word", () => {
    // `convert` is matched exactly, so only a trimmed value can meet the
    // zero-rate refusal the shipped rate of 0 sets up.
    expect(exitLeverRefusal("exit.voice_on_exit", " convert ", DEFAULT_EXIT_POLICY, raw)).toMatch(/^A conversion at zero/);
  });

  it("passes keeping Voice and a share of equity straight through, the two refusals the ruling lifted", () => {
    expect(exitLeverRefusal("exit.voice_on_exit", "keep", DEFAULT_EXIT_POLICY, raw)).toBeNull();
    expect(exitLeverRefusal("exit.voice_on_exit", "forfeit", DEFAULT_EXIT_POLICY, raw)).toBeNull();
    expect(exitLeverRefusal("exit.keep_pct.equity", "40", DEFAULT_EXIT_POLICY, raw)).toBeNull();
  });

  it("passes a coherent write straight through", () => {
    expect(exitLeverRefusal("exit.cooling_days", "14", DEFAULT_EXIT_POLICY, raw)).toBeNull();
  });

  it("reads the published notice period off the policy it is handed", () => {
    const short = { ...DEFAULT_EXIT_POLICY, voluntary: { ...DEFAULT_EXIT_POLICY.voluntary, noticePeriodDays: 7 } };
    expect(exitLeverRefusal("exit.cooling_days", "14", short, raw)).toBe(
      "Your published policy says 7 days of notice and this would hold balances for 14. Change the published term first.",
    );
  });

  it("says nothing at all about a key outside the Exit category", () => {
    // The write route runs this on EVERY save, so the cost of a gratitude
    // edit passing through here has to be one string comparison.
    let reads = 0;
    const counted = (key: string) => {
      reads += 1;
      return raw(key);
    };
    expect(exitLeverRefusal("gratitude.base_budget", "500", DEFAULT_EXIT_POLICY, counted)).toBeNull();
    expect(reads).toBe(0);
  });
});

describe("the two predicates a change-set executor calls before it writes anything", () => {
  /*
   * A two-phase executor validates every element of a set BEFORE it makes any
   * irreversible write, and refuses the whole set naming what blocked it. That
   * needs a refusal reachable with no write, and it needs the refusal to be
   * about the state the set would PRODUCE.
   *
   * The deadlock these two shapes exist to dissolve is real and was measured
   * on this file's own guard: judging each element against current-plus-one
   * refuses a set that turns Voice conversion on AND sets a rate under it,
   * because the conversion is judged against a rate the same set is about to
   * supply. That intermediate state never exists in the world.
   */

  it("an ELEMENT is judged alone, so a second dial in the same set cannot make the answer wrong", () => {
    // Every other dial reads as the platform's own answer during an element
    // pass, so `convert` is NOT refused here even though the neutral rate is
    // zero: that pairing is the set predicate's to see.
    expect(exitElementRefusal("exit.voice_on_exit", "convert")).toBeNull();
    expect(exitElementRefusal("exit.cooling_days", "365")).toBeNull();

    // The two that are wrong on their own come back with their own sentence.
    expect(exitElementRefusal("exit.keep_pct.recognition", "40")).toBe(
      "Recognition is a record of what happened, not a holding. It stays on the village's books either way, so a share of it is not a thing a leaver can keep. Leave this share at zero.",
    );
    expect(exitElementRefusal("exit.remainder_account", "burn", [ownCredit])).toContain("no faucet");
    // And the two the ruling of 2026-10-23 lifted come back with nothing.
    expect(exitElementRefusal("exit.keep_pct.equity", "1")).toBeNull();
    expect(exitElementRefusal("exit.voice_on_exit", "keep")).toBeNull();
    // And burn is fine when every token this village issues has one.
    expect(exitElementRefusal("exit.remainder_account", "burn", [platformCredit])).toBeNull();
  });

  it("an element pass says nothing about a key outside the Exit category, and nothing about a coherent one", () => {
    expect(exitElementRefusal("gratitude.base_budget", "500")).toBeNull();
    expect(exitElementRefusal("exit.keep_pct.credit", "100")).toBeNull();
    expect(exitElementRefusal("exit.remainder_account", "treasury")).toBeNull();
  });

  it("the SET predicate answers about the resulting reading, and names every element implicated", () => {
    // The pair, which no element pass can see: conversion on, rate at zero.
    const both = exitSetRefusals(reading({ "exit.voice_on_exit": "convert", "exit.keep_pct.voice": "50" }));
    expect(both).toEqual([
      {
        sentence: "A conversion at zero is a forfeit. Say forfeit, or set a rate.",
        keys: ["exit.voice_on_exit", "exit.voice_convert_rate"],
      },
    ]);

    // The same set, with the rate the executor is about to apply, is coherent.
    // This is the state a per-element pass over current-plus-one refuses and
    // the resulting reading allows, which is the whole reason for the shape.
    expect(
      exitSetRefusals(
        reading({ "exit.voice_on_exit": "convert", "exit.voice_convert_rate": "2.5", "exit.keep_pct.voice": "50" }),
      ),
    ).toEqual([]);
  });

  it("the set predicate reaches the published notice period, which is a document and no dial at all", () => {
    expect(exitSetRefusals(reading({ "exit.cooling_days": "45" }, [platformCredit], 30))).toEqual([
      {
        sentence:
          "Your published policy says 30 days of notice and this would hold balances for 45. Change the published term first.",
        keys: ["exit.cooling_days"],
      },
    ]);
    expect(exitSetRefusals(reading({ "exit.cooling_days": "45" }, [platformCredit], 60))).toEqual([]);
  });

  it("the set predicate returns element-scope refusals too, so one pass alone cannot miss anything", () => {
    // A caller running both passes drops duplicates by sentence; a caller
    // running only this one is still complete, which is the safer default for
    // a guard somebody else wires.
    const all = exitSetRefusals(reading({ "exit.keep_pct.recognition": "40", "exit.cooling_days": "45" }));
    expect(all.map((r) => r.keys)).toEqual([["exit.keep_pct.recognition"], ["exit.cooling_days"]]);
    // The WARNING never comes back through either predicate.
    const window = { "exit.keep_pct.credit": "100", "exit.vote_over": "0" };
    expect(exitLeverFindings(reading(window, [buyable])).map((f) => f.severity)).toEqual(["warning"]);
    expect(exitSetRefusals(reading(window, [buyable]))).toEqual([]);
  });

  it("the shipped defaults raise nothing through either predicate", () => {
    expect(exitSetRefusals(reading())).toEqual([]);
    for (const v of VARIABLES.filter((d) => d.category === "Exit")) {
      expect(exitElementRefusal(v.key, v.default, [platformCredit]), v.key).toBeNull();
    }
  });
});

/**
 * A field added to DEFAULT_EXIT_POLICY reaches new instances and no existing
 * one, because `dbDocument.get()` answers `cache ?? fallback` and never merges
 * the two. Thirteen villages are running documents frozen at the shape of
 * whichever release last saved them, so this is the difference between a
 * feature that works everywhere and one that works only on a fresh checkout.
 */
describe("a stored policy gets fields it was saved before", () => {
  /** Exactly what a village that published before `grounds` existed holds. */
  const preGrounds = () => ({
    placeholder: false,
    voluntary: { noticePeriodDays: 14, valuationMethod: "Our valuation.", unwindSteps: ["Our step"] },
    involuntary: { decidingDomainId: "", appealDomainId: "", process: "Our process." },
    restorative: { intakeContactRole: "", steps: ["Our repair step"] },
  });

  it("fills the questions a steward is asked, which would otherwise be empty on every live village", () => {
    const filled = withPolicyDefaults(preGrounds());
    expect(filled.involuntary.grounds).toEqual(DEFAULT_EXIT_POLICY.involuntary.grounds);
    expect(filled.involuntary.grounds.length).toBeGreaterThan(0);
  });

  it("does not touch a single word the village wrote", () => {
    const filled = withPolicyDefaults(preGrounds());
    expect(filled.involuntary.process).toBe("Our process.");
    expect(filled.voluntary.valuationMethod).toBe("Our valuation.");
    expect(filled.voluntary.unwindSteps).toEqual(["Our step"]);
    expect(filled.voluntary.noticePeriodDays).toBe(14);
    expect(filled.restorative.steps).toEqual(["Our repair step"]);
  });

  it("never answers the placeholder question on the village's behalf", () => {
    /*
     * THE REASON THIS IS NOT normalizeExitPolicy. That function reads
     * `placeholder: body?.placeholder === true`, so running it over a stored
     * document that lacks the key would record "this village adopted these
     * terms as its own", which is a claim only a founder can make. A READ must
     * never change what a village is on record as having decided.
     */
    expect(withPolicyDefaults(preGrounds()).placeholder).toBe(false);
    expect(withPolicyDefaults({ ...preGrounds(), placeholder: true }).placeholder).toBe(true);
    const noKey: any = preGrounds();
    delete noKey.placeholder;
    expect(normalizeExitPolicy(noKey).placeholder, "normalize would have answered it").toBe(false);
    expect(withPolicyDefaults(noKey).placeholder, "the read must leave it as the platform default").toBe(true);
  });

  it("keeps a village's own edited questions over the platform's", () => {
    const theirs = { ...preGrounds(), involuntary: { ...preGrounds().involuntary, grounds: ["Only our question?"] } };
    expect(withPolicyDefaults(theirs).involuntary.grounds).toEqual(["Only our question?"]);
  });

  describe("a draft saved before 2026-10-23 still holds the platform's old words", () => {
    /** What a village that saved its draft once, keeping the platform's terms, holds. */
    const oldDraft = (placeholder: boolean | undefined) => ({
      ...(placeholder === undefined ? {} : { placeholder }),
      voluntary: {
        noticePeriodDays: 21,
        valuationMethod: RETIRED_DEFAULT_TERMS.valuationMethod[0],
        unwindSteps: [...RETIRED_DEFAULT_TERMS.unwindSteps[0]],
      },
      involuntary: { decidingDomainId: "", appealDomainId: "", process: "Our process." },
      restorative: { intakeContactRole: "", steps: ["Our repair step"] },
    });

    it("reads today's platform words in their place, because the old ones promise a tombstone to every leaver", () => {
      for (const placeholder of [true, undefined]) {
        const read = withPolicyDefaults(oldDraft(placeholder));
        expect(read.voluntary.valuationMethod, String(placeholder)).toBe(DEFAULT_EXIT_POLICY.voluntary.valuationMethod);
        expect(read.voluntary.unwindSteps, String(placeholder)).toEqual(DEFAULT_EXIT_POLICY.voluntary.unwindSteps);
        // Nothing else moves: the village's own notice and process stay.
        expect(read.voluntary.noticePeriodDays).toBe(21);
        expect(read.involuntary.process).toBe("Our process.");
      }
    });

    it("leaves a published policy exactly as the village saved it", () => {
      // A village that published claimed the words as its own, so a read does
      // not rewrite them, even when they match a retired platform wording.
      const read = withPolicyDefaults(oldDraft(false));
      expect(read.voluntary.valuationMethod).toBe(RETIRED_DEFAULT_TERMS.valuationMethod[0]);
      expect(read.voluntary.unwindSteps).toEqual(RETIRED_DEFAULT_TERMS.unwindSteps[0]);
    });

    it("leaves a draft alone once a single word differs, because then the words are the village's", () => {
      const edited = oldDraft(true);
      edited.voluntary.unwindSteps[4] = "Our own last step";
      edited.voluntary.valuationMethod = `${RETIRED_DEFAULT_TERMS.valuationMethod[0]} We will vote on it in spring.`;
      const read = withPolicyDefaults(edited);
      expect(read.voluntary.unwindSteps[4]).toBe("Our own last step");
      expect(read.voluntary.valuationMethod).toContain("We will vote on it in spring.");
    });
  });
});
