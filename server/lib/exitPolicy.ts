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
