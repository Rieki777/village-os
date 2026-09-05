/**
 * The Setup Wizard's seven steps, and which of them the screen can actually count.
 *
 * THE STEPS, IN ONE PLACE. There used to be two lists: the wizard's own, and a
 * copy in the Admin shell that decides whether setup is finished. Adding a
 * seventh step to one of them would leave the shell calling setup complete
 * while a step sat undone, which is the kind of drift that only shows up as
 * "why is it still telling me I'm done". Both callers now read this file.
 *
 * Order is the order a founder works: name the place, say what it is for,
 * dress it, set its numbers, write its words, style its map, then ship. Go
 * live stays last because it is the step you stop coming back to. The second
 * step arrived after the other six; see the block above its entry for why it
 * sits where it does.
 *
 * WHY COMPLETION IS NOW READ RATHER THAN TICKED. All six steps used to be
 * checkboxes a founder ticked, and a ticked box outlives whatever it was
 * ticked about. What is measured on the live deployment: /api/game/config
 * serves all nine images as empty strings, every hero draws the placeholder,
 * and this checklist read none of those nine fields. So a village whose
 * Pictures box was ever ticked showed six of six while carrying no art at all,
 * on the exact screen a founder opens to ask whether the village is set up.
 * Who ticked it, and when, is not recorded anywhere this lane could read, so
 * that part is left unsaid. Nothing was lying. Nothing was reading anything
 * either.
 *
 * So the two steps whose fields live in the brand record this same screen
 * already loads are MEASURED: their completion is derived from the record and
 * there is no box to tick. The needs step is measured too, from a different
 * read; see `needsObservation`. The other four keep a checkbox, because what
 * they ask about is genuinely not in that record:
 *
 *   numbers    the figures on the Settings tab, where every single one is
 *              allowed to stay blank on purpose (a village states its own
 *              land figures or states none), so "blank" is a finished answer
 *              and an unfinished one and this file cannot tell them apart
 *   content    nine separate editors behind nine separate endpoints
 *   map        a skin and a walk with no "finished" state to read
 *   technical  a Railway deploy, a volume and three env vars, none of which
 *              a browser can see
 *
 * The UI says which row is which. A checklist that mixes measured and
 * self-reported rows without saying so is how the empty images survived.
 *
 * WHAT CHANGED AFTER THAT, AND WHY IT WAS NOT ENOUGH. On 2026-09-02 all six
 * brand hero slots were found holding empty strings in the `brand` row of
 * `app_config` on the live site, with the wizard complete and reachable and
 * having been for months. Two holes were left in the rewrite above:
 *
 *   A tick was still rendered as a completion. The four unmeasured steps kept
 *   a plain checkbox whose ticked state was reported through the same `done`
 *   field a counted row uses, so a screen could not tell a founder's memory
 *   from a reading even though this file knew the difference. `done` is now
 *   joined by `state`, `source` and `declaredDone`, and an untouched step
 *   reports `unknown` instead of a quiet `false`.
 *
 *   An unread record counted as a read one. `measureSetup(null)` returned
 *   `filled: 0, total: 9`, so a document that never arrived and a village with
 *   no pictures printed the same sentence. `filled` and `total` are now null
 *   when nothing was counted, and the row is `unknown`.
 *
 * Derivation is the default and a tick is the exception, marked as one. The
 * four unmeasured steps take their reading from `SetupObservations` when a
 * caller has one; see that type for where those readings already exist.
 *
 * WHICH FIELDS COUNT, for a measured row: the ones the wizard renders without
 * calling them optional. Site URL, events URL and contact email each say in
 * their own label that blank is a real answer (blank hides the link or the
 * button rather than pointing a visitor at the wrong village), so requiring
 * them would leave a finished village reading as unfinished forever.
 *
 * A blank field and a real zero are different facts, and this file only ever
 * reports the first: `filled` counts what the village has typed, and an empty
 * string is always "not yet", never "deliberately none". Any future step whose
 * blank is a legitimate final answer belongs in the self-reported group above,
 * not in `fields`.
 */
import { HUMAN_NEEDS } from "@shared/needs";

/** How many needs the platform offers. The denominator of the needs row. */
const PLATFORM_NEED_COUNT = HUMAN_NEEDS.length;

export type SetupStepKey =
  | "identity"
  | "needs"
  | "images"
  | "numbers"
  | "content"
  | "map"
  | "technical";

/** A field of the brand record, named the way the wizard labels it. */
export interface SetupField {
  group: "project" | "images";
  key: string;
  label: string;
}

export interface SetupStep {
  key: SetupStepKey;
  label: string;
  /** Empty on a self-reported step. A non-empty list makes the step measured. */
  fields: readonly SetupField[];
}

/**
 * THE IDENTITY BOXES THE WIZARD DRAWS, in order, as data.
 *
 * A SUPERSET of the identity step's `fields` below, and the difference is the
 * point of having two lists. `fields` is what the progress readout MEASURES,
 * so a field belongs there only when a village that has not filled it in is
 * genuinely unfinished. This list is what a founder SEES, so it also carries
 * the boxes that ship with a working default and are a rename rather than a
 * blank: `catalystName` is the first of those. Counting a defaulted field
 * would leave Identity reading unfinished forever for a village happy with
 * the platform's word.
 *
 * It lives here beside `SETUP_STEPS` so the two are read together, and so
 * `client/src/pages/Admin.tsx` stays under the monolith ratchet
 * (`scripts/check-file-lines.mjs`) while gaining a box.
 */
export const IDENTITY_WIZARD_FIELDS = [
  ["name", "Project name"],
  ["tagline", "Tagline"],
  ["memberName", "What a member is called"],
  ["catalystName", "What whoever runs this village is called"],
  ["location", "Location"],
] as const;

export const SETUP_STEPS: readonly SetupStep[] = [
  {
    key: "identity",
    label: "Identity",
    fields: [
      { group: "project", key: "name", label: "Project name" },
      { group: "project", key: "tagline", label: "Tagline" },
      { group: "project", key: "memberName", label: "What a member is called" },
      { group: "project", key: "location", label: "Location" },
      { group: "project", key: "footerBlurb", label: "Footer introduction" },
      /*
       * THE TWO CURRENCY FIELDS ARE GONE FROM THIS COUNT because the boxes
       * they measured are gone from the wizard, and those boxes were dead
       * before they were removed: `mergedConfig()` takes the recognition
       * currency's name from the token registry ahead of the brand document,
       * so nothing a founder typed there was ever displayed anywhere.
       *
       * Leaving them counted here would have been the worse half of the bug:
       * two fields nobody can fill, so Identity never finishes and the village
       * reads as half set up forever. A token's name is set under Admin then
       * Tokens, which is not part of the brand record and so is not this
       * file's to measure.
       */
    ],
  },
  /*
   * SECOND, AND THE ORDER IS THE ARGUMENT (R1, lane N2).
   *
   * The order this file's header states is "name the place, dress it, set its
   * numbers". What the village is FOR belongs before what it looks like and
   * before its numbers, because the scope orients the scale: a village meeting
   * one need for a tenth of its members and a village meeting all ten for all
   * of them are two different economic engines, and a founder who dresses the
   * village first and then discovers the engine is ten times too small has
   * done the work in the wrong order.
   *
   * `fields` is empty because the answer is not in the brand document: it is
   * rows in `village_needs`, read over `GET /api/needs/scope`. So this step is
   * OBSERVED, and `needsObservation` below is the only thing that turns that
   * read into a row. Pass no observation and this step is `unknown`, which is
   * the honest answer while nobody has looked, and never a quiet `todo`.
   */
  { key: "needs", label: "What this village is for", fields: [] },
  {
    key: "images",
    label: "Pictures",
    fields: [
      { group: "images", key: "hero", label: "Homepage hero" },
      { group: "images", key: "investorHero", label: "Investor hero" },
      { group: "images", key: "residentHero", label: "Resident hero" },
      { group: "images", key: "stewardHero", label: "Steward hero" },
      { group: "images", key: "prosperityHero", label: "Prosperity hero" },
      { group: "images", key: "masterPlanHero", label: "Master plan hero" },
      { group: "images", key: "logo", label: "Header logo" },
      { group: "images", key: "heartLogo", label: "Footer mark" },
      { group: "images", key: "favicon", label: "Browser tab icon" },
    ],
  },
  { key: "numbers", label: "Numbers", fields: [] },
  { key: "content", label: "Content", fields: [] },
  { key: "map", label: "Map & styling", fields: [] },
  { key: "technical", label: "Go live", fields: [] },
];

/** The brand document as `GET /api/admin/brand` returns it, loosely typed
 *  because the wizard holds it as `any` and every field is optional. */
export interface BrandLike {
  project?: Record<string, unknown> | null;
  images?: Record<string, unknown> | null;
  setup?: Record<string, unknown> | null;
  /* `currency` is still IN the stored document and is deliberately not here.
     Nothing measures it any more, and a key on this interface is a key some
     future step could start counting again. */
}

/**
 * THREE STATES, BECAUSE THERE ARE THREE FACTS.
 *
 * `done` and `todo` are both readings. `unknown` is the absence of one, and it
 * has to be its own value because the two ways of not being done are different
 * facts and this repository has already been bitten by code that printed the
 * same thing for both. Before this, an unread brand document produced
 * `filled: 0, total: 9` on the pictures row: a village whose record had never
 * arrived was told it had none of its nine pictures, in the same words as a
 * village that genuinely had none. That is the silent zero, on the one screen
 * built to answer the question.
 *
 * A row is `unknown` in exactly two situations, and never any other:
 *   1. The brand document has not been read (null or undefined). An empty
 *      object is NOT this: `{}` is a record that arrived carrying nothing,
 *      which is the outage state, and it reads `todo`.
 *   2. The step has nothing to read from. The four steps whose values live
 *      behind other endpoints are unknown until an observation is passed in.
 */
export type SetupState = "done" | "todo" | "unknown";

/** Whether the row's state was read from data, or asserted by a person. */
export type SetupSource = "measured" | "declared";

export interface SetupRow {
  key: SetupStepKey;
  label: string;
  /** True when `done` was read from data. False when a founder ticked it. */
  measured: boolean;
  source: SetupSource;
  state: SetupState;
  /** `state === "done"`. Kept so existing callers read the same answer. */
  done: boolean;
  /**
   * True when this row says done ONLY because a founder ticked the box. The UI
   * must render it differently from a measured completion: a tick outlives
   * whatever it was ticked about, and a screen that draws the two identically
   * is the screen that scored an empty village six of six.
   */
  declaredDone: boolean;
  /**
   * Null when nothing was counted, which is not the same as counting zero.
   * A row with `total: null` must never render as "0 of N".
   */
  filled: number | null;
  total: number | null;
  /** Labels of the measured fields still blank, for the row's own hint. */
  blank: string[];
  /** One sentence of live detail, when an observation supplied one. */
  detail?: string;
}

/**
 * A reading of one step, taken from somewhere this file cannot reach.
 *
 * The four steps that are not in the brand document (numbers, content, map,
 * technical) are readable, just not from here: the launch resolver already
 * observes the deploy, the domain, the session secret and the email sender at
 * `GET /api/admin/launch`, and the figures live behind
 * `GET /api/admin/settings`. Passing those in is how a tick stops being the
 * only thing this file can ask. Pass nothing and those rows read `unknown`,
 * which is the honest answer while nobody has looked.
 */
export interface SetupObservation {
  state: SetupState;
  filled?: number;
  total?: number;
  detail?: string;
  /**
   * Whether a founder's tick may still carry this step. Defaults to true,
   * which is the behaviour every step had before this field existed.
   *
   * FALSE IS FOR A STEP WHOSE BLANK IS NEVER A DELIBERATE ANSWER. The carry
   * exists because a blank is sometimes the real answer: a village states its
   * own land figures or states none, so a founder may say "this is finished"
   * over a reading of `todo`. That reasoning does not reach the needs scope. A
   * village with no needs in scope has not answered the question, and the row
   * renders no checkbox anyway (SetupSection draws one only for a `declared`
   * row), so a carry there would be a `true` sitting in the brand document
   * from some earlier version of this list with no control able to clear it.
   * That is the ticked-box outage in its newest shape.
   */
  carryable?: boolean;
}

export type SetupObservations = Partial<Record<SetupStepKey, SetupObservation>>;

/** A field counts as filled when the village's own record holds a non-blank
 *  string. Whitespace does not count: a space bar is not a village name. */
function hasValue(brand: BrandLike | null | undefined, field: SetupField): boolean {
  const group = brand?.[field.group];
  return String(group?.[field.key] ?? "").trim().length > 0;
}

/**
 * One row per step, in order, ready to render.
 *
 * Pass the brand document, and any observations of the steps that live outside
 * it. A document that has not arrived at all (null or undefined) yields every
 * row `unknown` with nothing counted, because nothing has been seen.
 *
 * WHERE A TICK STILL COUNTS, and where it stops counting. Derived wins by
 * default. A founder's tick can still carry a step whose reading says `todo`,
 * because a blank is sometimes a deliberate answer (a village states its own
 * land figures or states none), but the row then comes back `declaredDone`, so
 * the screen can say whose word it is.
 */
export function measureSetup(
  brand: BrandLike | null | undefined,
  observed: SetupObservations = {},
): SetupRow[] {
  /* Read, versus not yet read. `{}` counts as read. */
  const seen = brand !== null && brand !== undefined;

  return SETUP_STEPS.map((step) => {
    const ticked = Boolean(brand?.setup?.[step.key]);
    const observation = observed[step.key];
    const base = {
      key: step.key,
      label: step.label,
      blank: [] as string[],
      detail: observation?.detail,
    };

    /* Nothing has arrived. Every row is unknown and nothing is counted, ticks
       included: a tick read out of a document nobody has is not a reading. */
    if (!seen) {
      return {
        ...base,
        measured: false,
        source: "measured" as const,
        state: "unknown" as const,
        done: false,
        declaredDone: false,
        filled: null,
        total: null,
      };
    }

    /* A step whose values are in the brand document. Counted, every time. */
    if (step.fields.length > 0) {
      const blank = step.fields.filter((f) => !hasValue(brand, f)).map((f) => f.label);
      const state: SetupState = blank.length === 0 ? "done" : "todo";
      return {
        ...base,
        blank,
        measured: true,
        source: "measured" as const,
        state,
        done: state === "done",
        declaredDone: false,
        filled: step.fields.length - blank.length,
        total: step.fields.length,
      };
    }

    /* A step read from somewhere else. The observation is the default answer,
       and a tick may still carry it, visibly. */
    if (observation) {
      const carried = observation.carryable !== false && observation.state !== "done" && ticked;
      const state: SetupState = carried ? "done" : observation.state;
      return {
        ...base,
        measured: !carried,
        source: carried ? ("declared" as const) : ("measured" as const),
        state,
        done: state === "done",
        declaredDone: carried,
        filled: observation.filled ?? null,
        total: observation.total ?? null,
      };
    }

    /* Nobody has looked at this step. A tick is the founder's own note and is
       reported as exactly that; an empty box says nothing either way, so the
       row is unknown and not `todo`. */
    return {
      ...base,
      measured: false,
      source: "declared" as const,
      state: ticked ? ("done" as const) : ("unknown" as const),
      done: ticked,
      declaredDone: ticked,
      filled: null,
      total: null,
    };
  });
}

/** Whether every step is finished, for the Admin shell's nav posture. The
 *  shell and the wizard have to agree, so they share this one answer. An
 *  `unknown` row is never finished. */
export function setupIsComplete(
  brand: BrandLike | null | undefined,
  observed: SetupObservations = {},
): boolean {
  return measureSetup(brand, observed).every((row) => row.state === "done");
}

/**
 * The three counts, for a caller that needs to tell "still to do" apart from
 * "nobody has looked". A progress bar built on `done / total` alone reports the
 * same fraction for both, which is the reading this file exists to refuse.
 */
export function setupCounts(
  brand: BrandLike | null | undefined,
  observed: SetupObservations = {},
): { done: number; todo: number; unknown: number; declared: number; total: number } {
  const rows = measureSetup(brand, observed);
  return {
    done: rows.filter((r) => r.state === "done").length,
    todo: rows.filter((r) => r.state === "todo").length,
    unknown: rows.filter((r) => r.state === "unknown").length,
    declared: rows.filter((r) => r.declaredDone).length,
    total: rows.length,
  };
}

/**
 * What this screen knows about the needs scope, as `GET /api/needs/scope`
 * answers it. `null` means the read has not come back.
 *
 * A SUBSET OF `scopeSummary`'s return and not the whole of it, so this file
 * stays a pure reader with no server type crossing into it. The three fields
 * are the only ones a completion reading turns on.
 */
export interface NeedsScopeReading {
  /** False when this village has no rows at all: it has not answered yet. */
  answered: boolean;
  /** Needs in scope right now. A retired need is not counted here. */
  adopted: number;
  /** How many of those are the village's own, outside the platform ten. */
  customAdopted: number;
}

/**
 * The needs step's row, read from the scope. This is the completion predicate.
 *
 * THREE READINGS, AND THE THIRD IS WHY THIS IS NOT A BOOLEAN.
 *
 *   nothing read yet -> `unknown`. The fetch has not landed, or it refused.
 *                       Nobody has looked, so this screen says nothing.
 *   read, none in scope -> `todo`. Two ways to get here and the detail
 *                       sentence keeps them apart: a village that has not
 *                       said anything yet, and a village that said something
 *                       and later retired all of it. Both are real answers to
 *                       "is this step finished" and both are no.
 *   read, one or more in scope -> `done`.
 *
 * WHY THE TOTAL IS TEN PLUS THE CUSTOM ONES. The header row reads "4 of 10
 * filled in", and the denominator has to be the list this village actually
 * chose from. A village that wrote a need of its own is choosing from eleven,
 * and a fixed 10 would print "11 of 10" the day it adopts them all.
 */
export function needsObservation(reading: NeedsScopeReading | null | undefined): SetupObservations {
  if (!reading) {
    return {
      needs: {
        state: "unknown",
        carryable: false,
        detail: "The needs scope has not been read back yet, so this row says nothing either way.",
      },
    };
  }
  const total = PLATFORM_NEED_COUNT + Math.max(0, reading.customAdopted);
  if (reading.adopted > 0) {
    return {
      needs: {
        state: "done",
        carryable: false,
        filled: reading.adopted,
        total,
        detail: `This village has taken on ${reading.adopted} of the ${total} needs on its list.`,
      },
    };
  }
  return {
    needs: {
      state: "todo",
      carryable: false,
      filled: 0,
      total,
      detail: reading.answered
        ? "Every need this village took on has since been retired, so nothing is in scope."
        : "This village has not said which needs it is taking on.",
    },
  };
}
