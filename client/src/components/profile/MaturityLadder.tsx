/**
 * YOUR WALK: the stages a member has walked through, and nothing ahead of them.
 *
 * THE PRUNE (waves 1 and 2, display only; 11 Nov 2026). This card used to be
 * the full twelve-rung ladder with "ahead of you" on every rung not yet
 * reached, a countdown ("2 more consented quests and you reach Quest Seeker"),
 * a progress bar toward the next rung, and the next rung's allowance put as a
 * reason to climb. Nothing scores or ranks a person, so it now draws only the
 * walk so far: each stage crossed, in the village's own words, the one they
 * stand in described. The next step is the Your path card's to say, once.
 *
 * Engine untouched: `stages` arrives on `/api/game/config` and `stageIndex` on
 * `/api/game/progression`, the same reads the gate decides on. The ids are
 * never renamed, reordered or dropped here; a stage is only left undrawn.
 *
 * Accessibility kept from the earlier rebuild: an ordered list with no
 * separator character, `aria-current="step"` on the stage they stand in, and
 * the standing said in words as well as by the chip's look.
 */
import LadderChip from "@/components/sheet/LadderChip";
import type { GameStagePublic } from "@/lib/gameApi";
import { DEFAULT_LADDER_TITLE } from "@shared/villagePaths";

export default function MaturityLadder({
  title,
  stages,
  stageIndex,
}: {
  /** The ladder's name in this village's words (`/api/game/config` `ladder.title`). Absent reads as the platform's. */
  title?: string;
  stages: GameStagePublic[];
  stageIndex: number;
}) {
  const walked = stages.slice(0, Math.max(0, stageIndex) + 1);
  if (walked.length === 0) return null;
  const here = stages[stageIndex];

  return (
    <section aria-labelledby="maturity-h" className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 id="maturity-h" className="font-display text-2xl font-bold text-card-foreground">
        {title?.trim() || DEFAULT_LADDER_TITLE}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Your walk so far, in the village's own words.</p>

      {here ? (
        <div className="mt-5">
          <p className="font-display text-xl font-semibold text-card-foreground">{here.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{here.description}</p>
        </div>
      ) : null}

      <ol className="mt-6 flex flex-wrap gap-2">
        {walked.map((s, i) => {
          const current = i === stageIndex;
          return (
            <li key={s.id}>
              <LadderChip
                look={current ? "inverted" : "lit"}
                current={current}
                title={`${s.name}: ${s.description}`}
                label={s.name}
                srWords={current ? ", where you are now" : ", walked"}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
