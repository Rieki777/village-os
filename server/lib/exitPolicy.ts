/**
 * The PUBLISHED exit policy (S52, F12) and the one rule that makes publishing
 * it honest.
 *
 * The flow is platform structure; the TERMS are a community decision. The
 * document therefore ships with `placeholder: true` and `/exit-policy` prints
 * a caution card above the terms while that flag stands.
 *
 * The hole this file closes: the admin editor offered a checkbox that clears
 * the caution card, and it offered no field for three of the five things the
 * page actually prints (`voluntary.valuationMethod`, `voluntary.unwindSteps`,
 * `restorative.steps`). A village could therefore tick "the community decided
 * these" and publish the platform's boilerplate as its own settled exit terms,
 * which is the highest-stakes copy on the site saying something false about
 * where it came from.
 *
 * So the acknowledgement is now a claim the server checks. `platformDefaultTerms`
 * compares each rendered term against the platform default and returns the
 * labels of the ones that still match; the route refuses to clear the flag
 * while that list is non-empty, and names every field. Adopting the platform's
 * wording is still available: write it in the village's own words, which is
 * the act the flag is claiming happened.
 *
 * `DEFAULT_EXIT_POLICY` lives here rather than in the server file so this
 * comparison is unit-testable without booting a server.
 */
import { faucetFor } from "./economy";
import { isListedForTrade } from "./exchange";
import { allTokens } from "./ledger";

export interface ExitPolicyVoluntary {
  noticePeriodDays: number;
  valuationMethod: string;
  unwindSteps: string[];
}

export interface ExitPolicyInvoluntary {
  /** The circle that decides an involuntary exit. Empty means unstated. */
  decidingDomainId: string;
  /** The circle that hears an appeal. Empty means unstated. */
  appealDomainId: string;
  process: string;
  /**
   * The questions a steward answers on the record when opening an involuntary
   * exit. Each is answered yes, no, or does not apply.
   *
   * THE QUESTIONS ARE THE VILLAGE'S, WHICH IS WHY THEY LIVE IN THE POLICY.
   * Asking somebody to leave is the heaviest act this software supports, and
   * the grounds a village recognises for it are a community decision in
   * exactly the way `process` above is. A list compiled into the platform
   * would make every fork answer Amora's questions about their own members.
   * The platform seeds a starting set and a village edits it here, the same
   * arrangement `unwindSteps` and `restorative.steps` already have.
   *
   * DELIBERATELY NOT IN `EXIT_POLICY_TERMS`. That list gates publishing:
   * `platformDefaultTerms` runs on every save where `placeholder` is false,
   * so a fifth entry would start refusing edits from villages that published
   * their policy before this field existed and have no idea it is now theirs
   * to rewrite. Tightening that gate is a decision to take deliberately, not
   * a side effect of adding a field.
   */
  grounds: string[];
}

export interface ExitPolicyRestorative {
  intakeContactRole: string;
  steps: string[];
}

export interface ExitPolicy {
  placeholder: boolean;
  voluntary: ExitPolicyVoluntary;
  involuntary: ExitPolicyInvoluntary;
  restorative: ExitPolicyRestorative;
}

/**
 * S52 (F12): ships as an explicit PLACEHOLDER. The two prose fields say so in
 * plain language, and the two step lists are procedure a village is expected
 * to rewrite in its own words before claiming them.
 */
export const DEFAULT_EXIT_POLICY: ExitPolicy = {
  placeholder: true,
  voluntary: {
    noticePeriodDays: 30,
    valuationMethod:
      "To be decided by the community: how contributed value is honored when someone leaves. Until then, settled balances are held in exit settlement and recorded on the exit.",
    unwindSteps: [
      "Return borrowed items and settle library loans",
      "Complete or hand off any active stay; resolve open purchases",
      "Hand off roles and open work",
      "Balances are settled and recorded",
      "The account becomes a tombstone; contributions stay part of the village record",
    ],
  },
  involuntary: {
    decidingDomainId: "",
    appealDomainId: "",
    process:
      "To be decided by the community. Until then: a private conversation with the stewards precedes any formal step, always.",
    /*
     * A starting set, phrased as questions a steward can answer honestly
     * about a real situation. The first one is first on purpose: it asks
     * whether the village tried to repair the relationship before ending it,
     * and a steward who has to answer "no" on the record has been told
     * something by the form itself.
     *
     * The last two are the cases that are not conflict at all, and they are
     * here because a village with no way to record them ends up filing a
     * death or a long silence as though somebody had done something wrong.
     */
    grounds: [
      "Has a non-violent dispute resolution process been attempted?",
      "Is this an unexpected death?",
      "Has this member been unreachable for twelve lunar months?",
      "Is this for unpaid dues, fees or other obligations?",
    ],
  },
  restorative: {
    intakeContactRole: "",
    steps: [
      "Private intake with the contact role, never a public thread",
      "A facilitated repair conversation",
      "A written agreement with a review date; only the agreement and its status enter the record",
    ],
  },
};

/**
 * Every term `/exit-policy` prints as prose, with the label a founder reads in
 * the editor and in a refusal. The notice period is deliberately absent: 30
 * days is a number a community can genuinely land on unchanged, and a rule
 * that forced it to differ would teach founders to type 31.
 */
export const EXIT_POLICY_TERMS = [
  { key: "valuationMethod", label: "How contributed value is honored" },
  { key: "unwindSteps", label: "The steps of a voluntary departure" },
  { key: "involuntaryProcess", label: "If the village asks someone to leave" },
  { key: "restorativeSteps", label: "The restorative path" },
] as const;

export type ExitPolicyTermKey = (typeof EXIT_POLICY_TERMS)[number]["key"];

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const steps = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((s) => text(s)).filter((s) => s.length > 0) : [];

/** Whitespace and case are formatting, so they never count as new words. */
const same = (a: string, b: string): boolean =>
  a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

const sameSteps = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((s, i) => same(s, b[i]));

/**
 * Coerce an admin body into a whole policy document.
 *
 * Section-wise merge on purpose. The old route spread the body over the
 * defaults at the TOP level only, so a client that sent `voluntary` without
 * `unwindSteps` replaced the whole section and silently dropped published
 * terms. Merging per section means a partial body can only add.
 */
export function normalizeExitPolicy(body: any): ExitPolicy {
  const v = body?.voluntary ?? {};
  const i = body?.involuntary ?? {};
  const r = body?.restorative ?? {};
  const notice = Number(v.noticePeriodDays);
  return {
    placeholder: body?.placeholder === true,
    voluntary: {
      noticePeriodDays: Number.isFinite(notice) && notice >= 0 ? Math.floor(notice) : DEFAULT_EXIT_POLICY.voluntary.noticePeriodDays,
      valuationMethod: text(v.valuationMethod) || DEFAULT_EXIT_POLICY.voluntary.valuationMethod,
      unwindSteps: steps(v.unwindSteps).length ? steps(v.unwindSteps) : [...DEFAULT_EXIT_POLICY.voluntary.unwindSteps],
    },
    involuntary: {
      decidingDomainId: text(i.decidingDomainId),
      appealDomainId: text(i.appealDomainId),
      process: text(i.process) || DEFAULT_EXIT_POLICY.involuntary.process,
      /*
       * Falls back to the platform's list when absent, which is what every
       * policy document saved before this field existed looks like. An empty
       * list would leave those villages with a form that asks nothing.
       *
       * A village CANNOT choose to ask nothing, and that is the one case
       * this deliberately does not honour. `steps()` drops blank lines, so an
       * emptied box is indistinguishable from a document saved before the
       * field existed, and both get the seed back. It is the right way round:
       * asking one question too many before removing a person is recoverable,
       * and asking none is not. A village that wants different questions
       * replaces them rather than clearing them.
       */
      grounds: steps(i.grounds).length ? steps(i.grounds) : [...DEFAULT_EXIT_POLICY.involuntary.grounds],
    },
    restorative: {
      intakeContactRole: text(r.intakeContactRole),
      steps: steps(r.steps).length ? steps(r.steps) : [...DEFAULT_EXIT_POLICY.restorative.steps],
    },
  };
}

/**
 * A STORED policy, given whatever keys it was saved before existing.
 *
 * `dbDocument.get()` returns `cache ?? fallback` and never merges the two, so
 * a village that has saved its exit policy even once holds a document frozen
 * at the shape of the release that saved it. Adding a field to
 * `DEFAULT_EXIT_POLICY` therefore reaches new instances and NO existing one:
 * `involuntary.grounds` would read `undefined` on all thirteen live villages,
 * and the form that asks a steward the village's own questions would quietly
 * ask none.
 *
 * This is deliberately NOT `normalizeExitPolicy`, which is the write path.
 * That function reads `placeholder: body?.placeholder === true`, so running it
 * over a stored document missing that key would silently answer "this village
 * adopted these terms as its own" on the village's behalf. A read must not be
 * able to change what a village is on record as having decided. This fills
 * gaps and touches nothing that is present.
 */
export function withPolicyDefaults(stored: any): ExitPolicy {
  const d = DEFAULT_EXIT_POLICY;
  const inv = stored?.involuntary ?? {};
  return {
    ...(stored ?? {}),
    ...d,
    ...(stored ?? {}),
    voluntary: { ...d.voluntary, ...(stored?.voluntary ?? {}) },
    involuntary: {
      ...d.involuntary,
      ...inv,
      // Length-checked rather than presence-checked: a document saved with an
      // explicit empty list is the same "nobody has chosen questions" state as
      // one saved before the field existed, and both want the seed.
      grounds: steps(inv.grounds).length ? steps(inv.grounds) : [...d.involuntary.grounds],
    },
    restorative: { ...d.restorative, ...(stored?.restorative ?? {}) },
  } as ExitPolicy;
}

/**
 * The labels of every rendered term whose text is still the platform's.
 *
 * An empty array is the only state in which a village may record that its
 * community decided these terms.
 */
export function platformDefaultTerms(policy: ExitPolicy): string[] {
  const d = DEFAULT_EXIT_POLICY;
  const stale: string[] = [];
  const label = (key: ExitPolicyTermKey) => EXIT_POLICY_TERMS.find((t) => t.key === key)!.label;
  if (same(policy.voluntary.valuationMethod, d.voluntary.valuationMethod)) stale.push(label("valuationMethod"));
  if (sameSteps(policy.voluntary.unwindSteps, d.voluntary.unwindSteps)) stale.push(label("unwindSteps"));
  if (same(policy.involuntary.process, d.involuntary.process)) stale.push(label("involuntaryProcess"));
  if (sameSteps(policy.restorative.steps, d.restorative.steps)) stale.push(label("restorativeSteps"));
  return stale;
}

/** The labels of every rendered term a founder emptied. A blank policy is not a policy. */
export function blankTerms(policy: ExitPolicy): string[] {
  const blank: string[] = [];
  const label = (key: ExitPolicyTermKey) => EXIT_POLICY_TERMS.find((t) => t.key === key)!.label;
  if (!policy.voluntary.valuationMethod) blank.push(label("valuationMethod"));
  if (!policy.voluntary.unwindSteps.length) blank.push(label("unwindSteps"));
  if (!policy.involuntary.process) blank.push(label("involuntaryProcess"));
  if (!policy.restorative.steps.length) blank.push(label("restorativeSteps"));
  return blank;
}

/*
 * ── THE EXIT LEVERS, AND THE COMBINATIONS THAT ARE REFUSED (R4) ────────────
 *
 * R4, in the founder's words: "This exit policy can be many things, I think we
 * build some levers so that each village can create the policy that matters
 * for them." Ten of those levers are game variables in the `Exit` category of
 * `shared/gameVariables.ts`. Six combinations of them describe a policy the
 * engine cannot honour, and a village that saves one has been told something
 * false about its own departure terms on the highest-stakes page on the site.
 *
 * WHY THE GUARD LIVES HERE. Same reason `DEFAULT_EXIT_POLICY` does, stated at
 * the top of this file: the comparison has to be unit-testable without booting
 * a server. `exitLeverFindings` and `exitLeverProblem` are PURE. Every fact
 * they need about the world arrives in the `reading` they are handed: the
 * effective value of each dial, the notice period the village publishes, and
 * the token registry reduced to the four facts a lever asks about. That is
 * what lets `exitPolicy.test.ts` drive all six refusals and the warning with
 * no database, no registry load and no Express.
 *
 * `exitLeverRefusal` is the one impure function, and it is a four-line
 * adapter: it reads the live registry and hands the pure pair a reading. The
 * variables write route calls that, so `server/index.ts` keeps one line.
 *
 * A REFUSAL AND A WARNING ARE DIFFERENT ANSWERS, and the difference is whose
 * decision it is. A refusal says the engine cannot do what the dials describe.
 * A warning says the village may genuinely mean this and somebody should see
 * it said out loud; the seventh finding is the only one of those, and it saves
 * every time.
 *
 * WHERE IT RUNS, and it is no longer one door. `setVariable`
 * (`server/lib/variables.ts`) calls it on EVERY write through a guard wired
 * once at boot, so the admin variables route, the governance apply loop and
 * any writer added later are judged by this one function. It used to run at
 * the admin route alone while the apply loop wrote straight past it, and every
 * Exit dial is Ring 2, so a passed proposal could land a combination the
 * product refuses to let an admin type.
 *
 * WHAT THIS GUARD CANNOT SEE, stated the way the other guards in this
 * repository state their own blind spots:
 *
 *   1. It reads the published notice period at the moment a DIAL is written.
 *      Editing the published policy down to a shorter notice through
 *      `PUT /api/admin/exit-policy` does not come back through here, because
 *      that route writes a DOCUMENT and no document is an element of a change
 *      set (`CHANGE_ITEM_KINDS`, `shared/dryRun/types.ts`, has no document
 *      kind). So an already-saved cooling period can outlive the term it was
 *      checked against. What that can no longer do is hold a departing
 *      member's balance past the date their own exit row promised:
 *      `settlesFrom` (`server/lib/exit.ts`) caps the settle date at
 *      `notice_ends_at`.
 *   2. It judges dials. Whether the SETTLEMENT honours them is
 *      `server/lib/exit.ts`, and `server/lib/exitSplit.test.ts` is where that
 *      is measured.
 */

/** The four facts a lever asks about one token. */
export interface ExitLeverToken {
  slug: string;
  /** The display name a refusal prints. */
  name: string;
  /** Levers-spec taxonomy: recognition | equity | voice | credit. */
  kind: string;
  /** 'platform' = this ledger moves it; 'hypha' = read-only mirror. */
  governance: "platform" | "hypha";
  active: boolean;
  /** `faucetFor(slug) !== null`: whether there is anywhere to burn it back to. */
  hasFaucet: boolean;
  /** `isListedForTrade(slug)`: purchasable or swappable on the exchange right now. */
  listedForTrade: boolean;
}

/** Everything the levers are judged against, with nothing read from the world. */
export interface ExitLeverReading {
  /** The effective raw value of one dial: the village's override, or the default. */
  value: (key: string) => string;
  /** `voluntary.noticePeriodDays` off the PUBLISHED policy, in whole days. */
  noticePeriodDays: number;
  /** The token registry, reduced. */
  tokens: ReadonlyArray<ExitLeverToken>;
}

export interface ExitLeverFinding {
  /** The dials this is about. A route refusal prefers the one being written. */
  keys: string[];
  severity: "refusal" | "warning";
  /**
   * ELEMENT: true or false about ONE dial and the world, whatever else is
   * being written alongside it. SET: only answerable about the whole resulting
   * reading, because a second dial or the published policy is half the answer.
   *
   * The distinction is what lets a two-phase change-set executor refuse a set
   * without ever judging an intermediate state. A set that turns Voice
   * conversion on AND sets a rate under it is coherent; judged one element at
   * a time against what stands today, the conversion is refused for a rate the
   * same set is about to supply, and the state it was judged against never
   * exists in the world.
   */
  scope: "element" | "set";
  message: string;
}

const pct = (reading: ExitLeverReading, key: string): number => {
  const n = Number(reading.value(key));
  return Number.isFinite(n) ? n : 0;
};

/** "A", "A and B", "A, B and C"   the shape `platformDefaultTerms` names fields in. */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Every incoherent thing this reading describes, refusals and warnings alike.
 *
 * The order is C.3's order, which is the order a founder meets them: the two
 * kinds that can never be kept, then the account, then the Voice pair, then
 * the published term, then the one warning.
 */
export function exitLeverFindings(reading: ExitLeverReading): ExitLeverFinding[] {
  const out: ExitLeverFinding[] = [];

  // 1. Recognition. `sendRefusal` already says why in a member's words:
  // recognition "is given, never handed over". A leaver "keeping" a share of
  // it means it sits in an account that becomes a tombstone at resolve, where
  // nobody can read it. A policy that does nothing, dressed as one that does.
  if (pct(reading, "exit.keep_pct.recognition") > 0) {
    out.push({
      keys: ["exit.keep_pct.recognition"],
      severity: "refusal",
      scope: "element",
      message:
        "Recognition is a record of what happened, not a holding. It stays on the village's books either way, so a share of it is not a thing a leaver can keep. Leave this share at zero.",
    });
  }

  // 2. Equity. `validateLeg` refuses to move a hypha-governed token and a boot
  // invariant requires zero equity rows in this ledger, so any share here is a
  // promise about a book this platform does not write.
  if (pct(reading, "exit.keep_pct.equity") > 0) {
    out.push({
      keys: ["exit.keep_pct.equity"],
      severity: "refusal",
      scope: "element",
      message:
        "Equity is governed on Base under Hypha and this platform never moves it. What happens to it on departure is decided there.",
    });
  }

  // 3. Burn, where something a member can hold has no faucet to go back to.
  // `faucetFor` returns null for anything outside the slugs it knows, and this
  // borrows the wording `ruleCannotPay` already uses for the same fact.
  if (reading.value("exit.remainder_account") === "burn") {
    const stranded = reading.tokens
      .filter((t) => t.governance === "platform" && t.active && !t.hasFaucet)
      .map((t) => t.name);
    if (stranded.length) {
      const one = stranded.length === 1;
      out.push({
        keys: ["exit.remainder_account"],
        severity: "refusal",
        scope: "element",
        message:
          `${nameList(stranded)} ${one ? "has" : "have"} no faucet, so there is nowhere to burn ${one ? "it" : "them"} back to. ` +
          "Send what a leaver does not keep to an account the village can hold it in.",
      });
    }
  }

  // 4. A conversion that pays nothing. It would read to a departing member as
  // a conversion, and settle as a forfeit.
  if (reading.value("exit.voice_on_exit") === "convert" && pct(reading, "exit.voice_convert_rate") <= 0) {
    out.push({
      keys: ["exit.voice_on_exit", "exit.voice_convert_rate"],
      severity: "refusal",
      scope: "set",
      message: "A conversion at zero is a forfeit. Say forfeit, or set a rate.",
    });
  }

  // 5. Keeping Voice, while resolve anonymizes. `anonymizeMember` runs at
  // resolve and a tombstone is not a person who can hold voting weight. The
  // refusal names the condition that would make it available, because a
  // village reading "no" deserves to know what "yes" would take.
  if (reading.value("exit.voice_on_exit") === "keep") {
    out.push({
      keys: ["exit.voice_on_exit"],
      severity: "refusal",
      scope: "element",
      message:
        "Keeping Voice needs an account that still exists after the departure, and a resolved exit makes the account a tombstone. This becomes available when a village can record a departure without one.",
    });
  }

  // 6. A cooling period longer than the notice the village PUBLISHES. The page
  // would tell a member one number while the engine held their balance for
  // another, which is the same class of dishonesty `platformDefaultTerms`
  // already guards. Both numbers go in the sentence, because a refusal that
  // names one of them sends the founder looking for the other.
  const cooling = pct(reading, "exit.cooling_days");
  if (cooling > reading.noticePeriodDays) {
    out.push({
      keys: ["exit.cooling_days"],
      severity: "refusal",
      scope: "set",
      message: `Your published policy says ${reading.noticePeriodDays} days of notice and this would hold balances for ${cooling}. Change the published term first.`,
    });
  }

  // 7. THE WARNING, and the one finding that is never a refusal. Full credit
  // keep, no vote at any amount, on a credit token somebody can buy today: a
  // member can buy in, leave, and take everything back out with nobody asked.
  // A village may genuinely mean that, so it saves and the test run says it.
  if (pct(reading, "exit.keep_pct.credit") >= 100 && pct(reading, "exit.vote_over") === 0) {
    const buyable = reading.tokens
      .filter((t) => t.governance === "platform" && t.active && t.kind === "credit" && t.listedForTrade)
      .map((t) => t.name);
    if (buyable.length) {
      out.push({
        keys: ["exit.keep_pct.credit", "exit.vote_over"],
        severity: "warning",
        scope: "set",
        message: `Somebody can buy ${nameList(buyable)}, open an exit, and take all of it back out with nobody asked. That is a withdrawal window wearing an exit. A village may mean exactly this, so it saves; the test run flags it every time.`,
      });
    }
  }

  return out;
}

/**
 * The one sentence a save is refused with, or null when the reading is
 * coherent. Warnings never come back through here.
 *
 * `aboutKey` NARROWS the answer to the dial being written, and that narrowing
 * is load-bearing rather than cosmetic. Judging a write against every finding
 * in the reading DEADLOCKS a village holding two bad values at once: fixing
 * either one is refused because the other still stands, and neither can go
 * first. That state is reachable, because the governance apply path writes
 * through `setVariable` without passing this guard at all. So a write is
 * judged on ITSELF: a refusal comes back only when the dial being written is
 * one the finding names, and every other finding in the reading belongs to
 * the test run to report. Called with no key, which is what a whole-reading
 * check does, the first refusal in C.3's order comes back.
 */
export function exitLeverProblem(reading: ExitLeverReading, aboutKey?: string): string | null {
  const refusals = exitLeverFindings(reading).filter((f) => f.severity === "refusal");
  if (!refusals.length) return null;
  if (!aboutKey) return refusals[0].message;
  return refusals.find((f) => f.keys.includes(aboutKey))?.message ?? null;
}

/**
 * The live adapter the variables write route calls, and the only impure thing
 * in this file.
 *
 * It exists so `server/index.ts` costs one statement and no new imports beyond
 * this name: the file is under a ratchet that only turns down, and the three
 * registry reads below would otherwise be three more lines in the monolith.
 *
 * Keys outside `exit.` return null without reading anything, because no other
 * dial can move a lever and the write route runs this on every save.
 */
export function exitLeverRefusal(
  key: string,
  proposed: string,
  policy: ExitPolicy,
  rawValue: (key: string) => string,
): string | null {
  if (!key.startsWith("exit.")) return null;
  const value = String(proposed).trim();
  return exitLeverProblem(
    exitLeverReading((k) => (k === key ? value : rawValue(k)), policy),
    key,
  );
}

/**
 * The token registry reduced to the six facts a lever asks about. Live, and
 * read-only: `allTokens` is the in-memory registry, so this needs no pool and
 * no connection.
 */
export function exitLeverTokens(): ExitLeverToken[] {
  return allTokens().map((t) => ({
    slug: t.slug,
    name: t.name,
    kind: t.kind,
    governance: t.governance,
    active: t.active,
    hasFaucet: faucetFor(t.slug) !== null,
    listedForTrade: isListedForTrade(t.slug),
  }));
}

/**
 * A whole reading, assembled from an effective-value lookup and a published
 * policy. A change-set executor builds the RESULTING lookup in memory (every
 * element of the set applied) and hands it here, so the judgement is about the
 * state the set would produce and never about an intermediate one.
 */
export function exitLeverReading(value: (key: string) => string, policy: ExitPolicy | null | undefined): ExitLeverReading {
  return {
    value,
    noticePeriodDays: Number(policy?.voluntary?.noticePeriodDays ?? DEFAULT_EXIT_POLICY.voluntary.noticePeriodDays),
    tokens: exitLeverTokens(),
  };
}

/*
 * ── TWO PHASES, TWO PREDICATES, ONE SET OF RULES ──────────────────────────
 *
 * A change-set executor validates every element before it makes any
 * irreversible write, and refuses the whole set naming the elements that
 * blocked it. That needs a refusal reachable WITHOUT writing, and it needs the
 * refusal to be about the state the set would produce.
 *
 * ELEMENT (`exitElementRefusal`): true or false about one dial and the world.
 * A share of recognition, a share of equity, burning a token that has no
 * faucet, and keeping Voice are each wrong on their own, whatever else is in
 * the set, so an element pass catches them at the cheapest possible moment.
 *
 * SET (`exitSetRefusals`): the complete answer about a resulting reading. It
 * returns EVERY refusal that reading carries, element-scope ones included, so
 * a caller running only this one cannot miss anything; a caller running both
 * passes drops duplicates by sentence. The two rules that ONLY this can see
 * are the pair (`exit.voice_on_exit` with `exit.voice_convert_rate`, where a
 * set turning conversion on and setting a rate under it is coherent and each
 * half alone is not) and the published notice period, which is a document
 * field and no dial at all.
 *
 * NEITHER PASS EVER JUDGES AN INTERMEDIATE STATE. `exitLeverProblem`, which
 * `setVariable` reaches through the wired guard, judges current-plus-one and
 * that stays right: a single admin write has no set, so the state it is judged
 * against is the state the write produces.
 */

/** One set-level refusal. `keys` is PLURAL: two elements can be wrong together. */
export interface ExitSetRefusal {
  sentence: string;
  keys: string[];
}

/**
 * Every refusal the RESULTING reading carries. Pure, no write, no transaction.
 * Warnings never come back through here; they belong to the test run.
 */
export function exitSetRefusals(reading: ExitLeverReading): ExitSetRefusal[] {
  return exitLeverFindings(reading)
    .filter((f) => f.severity === "refusal")
    .map((f) => ({ sentence: f.message, keys: f.keys }));
}

/**
 * What is wrong with ONE element, whatever else is being written beside it.
 * Pure, no write, no transaction, and no pool or connection: the token
 * registry it reads is already in memory.
 *
 * Only element-scope rules run, and they run against a reading in which every
 * other dial sits at a value that cannot itself trigger anything, so a second
 * dial the same set is about to move can never make this answer wrong. The set
 * pass is where a pair is judged.
 */
export function exitElementRefusal(
  key: string,
  proposed: string,
  tokens: ReadonlyArray<ExitLeverToken> = exitLeverTokens(),
): string | null {
  if (!key.startsWith("exit.")) return null;
  const value = String(proposed).trim();
  const found = exitLeverFindings({
    value: (k) => (k === key ? value : ELEMENT_NEUTRAL[k] ?? ""),
    // Nothing an element can say about a cooling period is true on its own,
    // and this is what keeps that rule silent here instead of guessing a term.
    noticePeriodDays: Number.POSITIVE_INFINITY,
    tokens,
  }).find((f) => f.severity === "refusal" && f.scope === "element" && f.keys.includes(key));
  return found?.message ?? null;
}

/**
 * The value every OTHER dial reads as during an element pass: the platform
 * default, which by construction triggers nothing. Written out rather than
 * read from the registry so this file keeps its three imports and stays
 * unit-testable with no registry loaded.
 */
const ELEMENT_NEUTRAL: Record<string, string> = {
  "exit.keep_pct.credit": "0",
  "exit.keep_pct.voice": "0",
  "exit.keep_pct.recognition": "0",
  "exit.keep_pct.equity": "0",
  "exit.remainder_account": "settlement",
  "exit.cooling_days": "0",
  "exit.voice_on_exit": "forfeit",
  "exit.voice_convert_rate": "0",
  "exit.vote_over": "0",
  "exit.sellback_enabled": "false",
};
