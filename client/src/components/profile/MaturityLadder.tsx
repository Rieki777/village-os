/**
 * MATURITY: the rung ladder, and the one sentence that says what opens the next.
 *
 * This block used to live inside `GameDashboard` as "Path of Growth" and it
 * carried four defects that a rebuild is the cheapest way to end:
 *
 *   1. Unreached rungs were `text-stone-400`, which measures 2.52:1 on the
 *      white card. Every rung a member has not walked yet was the hardest
 *      text on the page to read.
 *   2. The rung somebody is standing on was signalled by BACKGROUND COLOUR
 *      alone, with no `aria-current`. A screen reader read twelve identical
 *      list items.
 *   3. The separator between rungs was a literal `·`, which is announced. The
 *      ladder read as "Visitor dot Guest dot Immersant dot".
 *   4. It could not say how a rung is EARNED, because the ladder payload
 *      stripped `rule` before it left the server. That is fixed upstream now
 *      (`servedLadder`), so the sentence a member actually wants, "two more
 *      consented quests and you reach Quest Seeker", is finally sayable.
 *
 * ── WHERE THE NUMBERS COME FROM ─────────────────────────────────────────────
 *
 * `stages` arrives on `/api/game/config`, which the client already caches, and
 * every rule on it is OVERLAID with this village's own variable by
 * `servedRule` before it is served. Nothing here reads `GAME_CONFIG`: a
 * village that raised its quest threshold to five would otherwise be told the
 * platform's three by a page styled exactly like the gate that refuses them.
 *
 * `consentedQuests` and `stageIndex` arrive on `/api/game/progression`, from
 * the same single query `computeStage` uses to DECIDE the rung. The figure a
 * member reads and the figure the gate compares against are one number.
 *
 * ── COLOUR ──────────────────────────────────────────────────────────────────
 *
 * Surface and text are migrated together to the semantic tokens, which are the
 * only foregrounds in this build that answer to `.dark`. `text-sage` and
 * `text-amber-ink` are frozen dark inks defined once in `@theme` and never
 * redefined under `.dark`. Measured against the compiled stylesheet, sage goes
 * 5.95:1 on white to 2.89:1 on `bg-card` at night, and amber-ink 5.60:1 to
 * 3.07:1. This card uses neither.
 */
import { CheckCircle2, Circle } from "lucide-react";
import type { GameStagePublic } from "@/lib/gameApi";
import type { StageRule } from "@shared/gameConfig";

/**
 * HOW EACH KIND OF RUNG IS EARNED, keyed by the union.
 *
 * Typed `Record<string, string>` this would be a promise nobody checks: a
 * seventh rule type added in `shared/gameConfig.ts` would render an empty
 * paragraph where a sentence belonged, with no error and no console line.
 * Keyed by `StageRule["type"]` the compiler refuses the build instead.
 *
 * The words are the platform's own mechanics and carry no village's name. The
 * one number in here is `min`, which arrives already overlaid.
 */
type RuleWords = { [K in StageRule["type"]]: (rule: Extract<StageRule, { type: K }>) => string };

const RULE_WORDS: RuleWords = {
  default: () => "Everyone starts here.",
  account: () => "Opens when you create a profile.",
  "training-complete": () => "Opens when you finish the community training.",
  membership: () => "Opens when you sign the membership agreement.",
  quests: (rule) => `Opens at ${rule.min} consented quest${rule.min === 1 ? "" : "s"}.`,
  granted: () => "The village grants this one. No amount of climbing reaches it.",
};

const ruleSentence = (rule: StageRule): string =>
  (RULE_WORDS[rule.type] as (r: StageRule) => string)(rule);

/**
 * The line a member came here for, or null when there is nothing true to say.
 *
 * Only the quests rung has a countable distance, so only the quests rung gets
 * a count. Every other rule type says how it opens and stops there: inventing
 * "60% of the way to Member" for a rung that turns on a signature would be the
 * same fabrication the path progress bars were deleted for.
 */
function distanceToNext(next: GameStagePublic, consentedQuests: number): string | null {
  if (next.rule.type !== "quests") return null;
  const left = Math.max(0, next.rule.min - consentedQuests);
  if (left === 0) return `You have the ${next.rule.min} consented quests this rung asks for.`;
  return `${left} more consented quest${left === 1 ? "" : "s"} and you reach ${next.name}.`;
}

/** "2 times" / "1 time", so a multiplier of one does not read as "1 times". */
const times = (n: number): string => `${n} time${n === 1 ? "" : "s"}`;

export default function MaturityLadder({
  stages,
  stageIndex,
  consentedQuests,
}: {
  stages: GameStagePublic[];
  stageIndex: number;
  consentedQuests: number;
}) {
  if (stages.length === 0) return null;

  const here = stages[stageIndex];
  const next = stages[stageIndex + 1] ?? null;
  const distance = next ? distanceToNext(next, consentedQuests) : null;

  return (
    <section aria-labelledby="maturity-h" className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 id="maturity-h" className="font-display text-2xl font-bold text-card-foreground">
        Maturity
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Where you stand on this village's ladder, and what opens the next rung.
      </p>

      {here ? (
        <div className="mt-5">
          <p className="font-display text-xl font-semibold text-card-foreground">{here.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{here.description}</p>
        </div>
      ) : null}

      {/*
        THE NEXT RUNG, said as a distance when there is one to say.

        `aria-live` is deliberate: this whole page had none, so every async
        change on it was silent. The rung and the count arrive after a fetch,
        and a member using a screen reader got no announcement that the answer
        to "what is next" had landed.
      */}
      {next && here ? (
        <div aria-live="polite" className="mt-4 rounded-xl border border-border bg-muted p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Next rung</p>
          <p className="mt-1 font-semibold text-foreground">{next.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {/* The distance when the rung counts something, the mechanic when
                it does not. Said ONCE: a second copy of this sentence under the
                ladder is what a component test caught. */}
            {distance ?? ruleSentence(next.rule)}
          </p>
          {/*
            THE BAR EXISTS ONLY WHERE THERE IS A DENOMINATOR.

            A quests rung has one: `min`, already overlaid with this village's
            own variable. Every other rule type turns on a signature, a
            training record or somebody's decision, and drawing a bar across
            one of those would be inventing the very kind of number this whole
            review has been deleting. So the bar is inside the quests branch
            and there is no `else`.

            `role="progressbar"` with real bounds, because a bar with no
            accessible value is a decoration that looks like information.
          */}
          {next.rule.type === "quests" ? (
            <>
              <p className="mt-2 text-sm text-foreground">
                <span className="font-semibold">{consentedQuests}</span> of {next.rule.min} consented so far.
              </p>
              <div
                role="progressbar"
                aria-valuenow={Math.min(consentedQuests, next.rule.min)}
                aria-valuemin={0}
                aria-valuemax={next.rule.min}
                aria-label={`Consented quests toward ${next.name}`}
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-background"
              >
                <div
                  className="h-full rounded-full bg-foreground"
                  /* Clamped both ways. A threshold lowered mid-climb can leave
                     the count above the minimum, and a bar wider than its track
                     is a rendering fault that reads as a data one. */
                  style={{
                    width: `${Math.min(100, Math.max(0, (consentedQuests / Math.max(1, next.rule.min)) * 100))}%`,
                  }}
                />
              </div>
            </>
          ) : null}

          {/*
            WHAT THE NEXT RUNG PAYS, said only when it pays something different.

            `gratitudeMultiplier` now ships on every rung of the served ladder,
            through the same expression that resolves the member's own stage, so
            this is the village's tuned number and never the config default.
            Rendered only when the two differ: "rises to 2 at Member" is worth
            reading, and "stays at 2" is noise.
          */}
          {next.gratitudeMultiplier !== here.gratitudeMultiplier ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Your sending allowance is {times(here.gratitudeMultiplier)} the base now, and{" "}
              {times(next.gratitudeMultiplier)} at {next.name}.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          You stand on the last rung this village has named.
        </p>
      )}

      {/*
        THE LADDER ITSELF.

        An ordered list, one item per rung, no separator character between
        them. The current rung carries `aria-current="step"`, which is what
        makes twelve identical items readable, and every rung states its
        standing in words as well as in colour.
      */}
      <ol className="mt-6 flex flex-wrap gap-2">
        {stages.map((s, i) => {
          const reached = i <= stageIndex;
          const current = i === stageIndex;
          return (
            <li key={s.id}>
              <span
                aria-current={current ? "step" : undefined}
                title={`${s.name}: ${s.description}`}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  current
                    ? "bg-foreground text-background"
                    : reached
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground"
                }`}
              >
                {reached ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                {s.name}
                {/* The icon carries the standing visually. This carries it to
                    a reader who gets no icon, so the ladder is not colour and
                    shape alone. */}
                <span className="sr-only">
                  {current ? ", where you stand" : reached ? ", walked" : ", ahead of you"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

    </section>
  );
}
